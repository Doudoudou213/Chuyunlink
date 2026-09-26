'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { fixture, draft } = require('./test-story-themes');
const { createStoryThemeService } = require('../cloudfunctions/adminSubmissions/domains/story-themes');
const { createStoryThemeContributionService } = require('../cloudfunctions/adminSubmissions/domains/story-theme-contributions');
const { createPublicStoryThemeService } = require('../cloudfunctions/appCore/domains/story-themes');

async function main() {
  const db = fixture();
  db.data.submissions.get('s_hb').userId = 'user_hb';
  db.data.submissions.get('s_hb').title = '湖北凤鸟纹记录';
  db.data.submissions.get('s_hn').userId = 'user_hn';
  db.data.story_contributions = new Map([['gap_existing', {
    type: 'gap_task_adoption', status: 'adopted', submissionId: 's_hb',
    userId: 'user_hb', rewardPointsAwarded: 50, rewardStatus: 'awarded'
  }]]);
  db.data.point_ledger = new Map([['gap_reward', { submissionId: 's_hb', amount: 50 }]]);
  const themes = createStoryThemeService({ db });
  const contributions = createStoryThemeContributionService({ db });
  const publicThemes = createPublicStoryThemeService({ db });
  const saved = await themes.save(draft(), 'admin_1');
  const firstPublish = await themes.publish({ themeId: saved.themeId, expectedRevision: saved.revision,
    humanReviewed: true, reviewNote: '两个章节与来源已经核对' }, 'admin_1');
  assert.equal(firstPublish.version, 1);
  const workspace = await contributions.workspace({ themeId: saved.themeId });
  assert.equal(workspace.chapters[0].sources[0].adopted, false, '普通引用不算正式采用');
  assert.ok(workspace.chapters[0].id, '章节具有稳定编号');
  const request = { themeId: saved.themeId, themeVersion: 1,
    chapterId: workspace.chapters[0].id, sourceLinkId: 'l_hb' };
  await assert.rejects(contributions.adopt({ ...request, sourceLinkId: 'l_hn' }, 'admin_1'),
    { code: 'THEME_SOURCE_NOT_IN_CHAPTER' });
  await assert.rejects(contributions.adopt({ ...request, resolvesGap: true }, 'admin_1'),
    { code: 'GAP_NOTE_REQUIRED' });
  await assert.rejects(contributions.adopt({ ...request, themeVersion: 0 }, 'admin_1'),
    { code: 'THEME_VERSION_CHANGED' });
  const adopted = await contributions.adopt(request, 'admin_1');
  assert.equal(adopted.cached, false);
  assert.equal((await contributions.adopt(request, 'admin_1')).cached, true, '重复点击不能重复采用或通知');
  const record = db.data.story_contributions.get(adopted.contributionId);
  assert.equal(record.type, 'theme_adoption');
  assert.equal(record.submissionId, 's_hb');
  assert.equal(record.themeId, saved.themeId);
  assert.equal(record.themeVersion, 1);
  assert.equal(record.chapterId, workspace.chapters[0].id);
  assert.equal(record.contributionType, 'source_support');
  assert.equal(record.resolvesGap, false);
  assert.equal(record.rewardPointsAwarded, 0);
  assert.equal(db.data.point_ledger.size, 1, '专题采用不得重复发放征集任务积分');
  assert.equal(db.data.interaction_notifications.size, 1);
  assert.equal((await contributions.workspace({ themeId: saved.themeId })).chapters[0].sources[0].adopted, true);
  let publicTheme = await publicThemes.get({ themeId: saved.themeId });
  assert.deepEqual(publicTheme.theme.chapters[0].adoptedSourceLinkIds, ['l_hb']);
  assert.equal(publicTheme.theme.sources[0].contributorName, '匿名贡献者', '正式采用不改变匿名选择');
  assert.equal(JSON.stringify(publicTheme).includes('user_hb'), false, '公开专题不得泄露用户编号');
  const indexSource = fs.readFileSync(path.join(__dirname, '../cloudfunctions/appCore/index.js'), 'utf8');
  const impactSource = indexSource.slice(indexSource.indexOf('async function getContributionImpact('),
    indexSource.indexOf('async function bootstrap(', indexSource.indexOf('async function getContributionImpact(')));
  const getImpact = vm.runInNewContext(`${impactSource}\ngetContributionImpact`, {
    db, STORY_CONTRIBUTION_COLLECTION: 'story_contributions', storyThemeService: publicThemes,
    cleanText: (value, max) => String(value || '').trim().slice(0, max)
  });
  const impact = await getImpact('user_hb');
  assert.equal(impact.adoptedCount, 2, '征集采用与专题采用分别计数');
  assert.equal(impact.themeCount, 1);
  assert.equal(impact.totalRewardPoints, 50, '旧征集任务奖励保持不变');
  assert.equal(impact.items.find(item => item.type === 'theme_adoption').currentlyPublic, true);
  const edited = await themes.save({ ...draft(), themeId: saved.themeId,
    expectedRevision: 1 }, 'admin_1');
  await themes.publish({ themeId: saved.themeId, expectedRevision: edited.revision,
    humanReviewed: true, reviewNote: '新版本继续核对来源' }, 'admin_1');
  assert.equal(db.data.story_theme_versions.get(saved.themeId + '_v2').chapters[0].id,
    workspace.chapters[0].id, '章节编号跨版本保持稳定');
  publicTheme = await publicThemes.get({ themeId: saved.themeId });
  assert.deepEqual(publicTheme.theme.chapters[0].adoptedSourceLinkIds, [], '旧版采用不自动算入新版');
  assert.ok(db.data.story_contributions.has(adopted.contributionId), '旧版本记录保留');
  assert.equal((await getImpact('user_hb')).items.find(item => item.type === 'theme_adoption').currentlyPublic,
    false, '版本更新后旧采用只作为历史记录');
  await assert.rejects(contributions.adopt(request, 'admin_1'), { code: 'THEME_VERSION_CHANGED' });
  const nextWorkspace = await contributions.workspace({ themeId: saved.themeId });
  const gapAdoption = await contributions.adopt({ themeId: saved.themeId, themeVersion: 2,
    chapterId: nextWorkspace.chapters[1].id, sourceLinkId: 'l_hn',
    resolvesGap: true, gapNote: '补足河南地区鸟纹现场记录' }, 'admin_1');
  assert.equal(db.data.story_contributions.get(gapAdoption.contributionId).resolvesGap, true);
  assert.equal(db.data.story_contributions.get(gapAdoption.contributionId).gapNote,
    '补足河南地区鸟纹现场记录');
  db.data.submissions.get('s_hb').aiConsentRevokedAt = '2026-09-26';
  const current = await contributions.workspace({ themeId: saved.themeId });
  assert.equal(current.available, false, '任一关键来源失效时停止新的专题采用');
  assert.equal(current.chapters[0].sources.length, 0, '失效来源不得再确认采用');
  await assert.rejects(contributions.adopt({ themeId: saved.themeId, themeVersion: 2,
    chapterId: current.chapters[1].id, sourceLinkId: 'l_hn' }, 'admin_1'),
    { code: 'THEME_SOURCE_UNAVAILABLE' });
  assert.equal((await publicThemes.get({ themeId: saved.themeId })).ok, false,
    '来源撤回时公开专题继续隐藏');
  assert.ok(db.data.story_contributions.has(adopted.contributionId), '撤回后保留采用审计');
  console.log('Theme adoption, idempotency, version history, withdrawal and no double rewards passed.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
