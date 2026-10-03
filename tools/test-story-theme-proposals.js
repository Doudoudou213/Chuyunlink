'use strict';
const assert = require('node:assert/strict');
const { fixture, draft } = require('./test-story-themes');
const { createStoryThemeService, validateTheme } = require('../cloudfunctions/adminSubmissions/domains/story-themes');
const {
  createStoryThemeProposalService, safeAiOutput, createThemeAiAdapter, reserveAiCall
} = require('../cloudfunctions/adminSubmissions/domains/story-theme-proposals');

async function main() {
  assert.equal(createThemeAiAdapter({ THEME_AI_ENABLED: 'false' }), null, '付费接口默认关闭');
  const budgetDb = fixture();
  const priorBudget = process.env.THEME_AI_DAILY_LIMIT;
  process.env.THEME_AI_DAILY_LIMIT = '1';
  try {
    assert.equal(await reserveAiCall(budgetDb), 1);
    await assert.rejects(reserveAiCall(budgetDb), { code: 'THEME_AI_DAILY_LIMIT' });
  } finally {
    if (priorBudget == null) delete process.env.THEME_AI_DAILY_LIMIT;
    else process.env.THEME_AI_DAILY_LIMIT = priorBudget;
  }
  const db = fixture();
  const checked = await validateTheme(db, draft());
  assert.throws(() => safeAiOutput({ chapters: [{ title: '错误引用', purpose: '资料与章节不匹配',
    nodeIds: ['e_hb'], sourceLinkIds: ['l_hn'] }], gaps: [] }, draft(), checked),
    { code: 'THEME_AI_INVALID' });
  const theme = createStoryThemeService({ db });
  const { themeId } = await theme.save(draft(), 'admin1');
  const service = createStoryThemeProposalService({ db });
  const result = await service.suggest({ themeId, expectedRevision: 1 }, 'admin1');
  assert.deepEqual(result.proposal.deterministic.suggestedOrder.map(item => item.entityId), ['e_hb', 'e_hn']);
  assert.equal(result.proposal.deterministic.relations[0].relationId, 'rel1');
  assert.equal(result.proposal.ai, null);
  await assert.rejects(service.suggest({ themeId, expectedRevision: 1, useAi: true }, 'admin1'),
    { code: 'THEME_AI_DISABLED' });

  const bad = createStoryThemeProposalService({ db, aiAdapter: {
    model: 'fixed', promptVersion: 'test',
    async suggest() { return { chapters: [{ title: '来源不明', nodeIds: ['e_hb'],
      sourceLinkIds: ['invented'] }], gaps: [] }; }
  } });
  await assert.rejects(bad.suggest({ themeId, expectedRevision: 1, useAi: true }, 'admin1'),
    { code: 'THEME_AI_INVALID' });
  db.data.submissions.get('s_hn').aiAnalysisConsent = false;
  await assert.rejects(bad.suggest({ themeId, expectedRevision: 1, useAi: true }, 'admin1'),
    { code: 'THEME_AI_CONSENT_REQUIRED' });
  db.data.submissions.get('s_hn').aiAnalysisConsent = true;
  const withdrawn = createStoryThemeProposalService({ db, aiAdapter: {
    model: 'fixed', promptVersion: 'test',
    async suggest() {
      db.data.submissions.get('s_hn').aiConsentRevokedAt = 'during_call';
      return { chapters: [
        { title: '湖北材料', purpose: '只讲湖北材料', nodeIds: ['e_hb'], sourceLinkIds: ['l_hb'] },
        { title: '河南材料', purpose: '只讲河南材料', nodeIds: ['e_hn'], sourceLinkIds: ['l_hn'] }
      ], gaps: [], relationIds: ['rel1'] };
    }
  } });
  await assert.rejects(withdrawn.suggest({ themeId, expectedRevision: 1, useAi: true }, 'admin1'),
    { code: 'THEME_SOURCE_UNAVAILABLE' });
  assert.equal(db.data.story_themes.get(themeId).proposal.ai, null, '撤回后不得覆盖原建议');
  db.data.submissions.get('s_hn').aiConsentRevokedAt = null;
  const fixed = createStoryThemeProposalService({ db, aiAdapter: {
    model: 'fixed', promptVersion: 'test',
    async suggest() { return { title: '凤鸟纹样', introduction: '材料专题提纲',
      chapters: [{ title: '第一章', purpose: '呈现来源', nodeIds: ['e_hb'],
        sourceLinkIds: ['l_hb'] }], gaps: [], relationIds: ['rel1'] }; }
  } });
  const suggested = await fixed.suggest({ themeId, expectedRevision: 1, useAi: true }, 'admin1');
  assert.equal(suggested.proposal.ai.chapters[0].sourceLinkIds[0], 'l_hb');
  assert.equal(suggested.proposal.status, 'candidate');
  assert.equal(db.data.story_themes.get(themeId).status, 'draft');
  assert.equal(typeof safeAiOutput, 'function');
  console.log('Story theme candidate checks passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
