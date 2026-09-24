'use strict';
const assert = require('node:assert/strict');
const { createStoryThemeService } = require('../cloudfunctions/adminSubmissions/domains/story-themes');

function memoryDb(seed) {
  const data = Object.fromEntries(Object.entries(seed).map(([name, rows]) =>
    [name, new Map(rows.map(item => [item._id, structuredClone(item)]))]));
  let nextLog = 0;
  const collection = name => {
    if (!data[name]) data[name] = new Map();
    const records = data[name];
    return {
      doc(key) { return {
        async get() { const item = records.get(key); return { data: item ? [{ _id: key, ...structuredClone(item) }] : [] }; },
        async set(value) { records.set(key, structuredClone(value)); },
        async update(value) { records.set(key, { ...records.get(key), ...structuredClone(value) }); }
      }; },
      async add(value) { records.set('log_' + ++nextLog, structuredClone(value)); },
      limit(count) { return { async get() { return { data: [...records].slice(0, count).map(([key, value]) => ({ _id: key, ...structuredClone(value) })) }; } }; },
      where(filter) { return { limit(count) { return { async get() {
        return { data: [...records].filter(([, value]) =>
          Object.entries(filter).every(([key, expected]) => value[key] === expected))
          .slice(0, count).map(([key, value]) => ({ _id: key, ...structuredClone(value) })) };
      } }; } }; }
    };
  };
  return {
    data, collection, serverDate() { return '2026-09-24T00:00:00.000Z'; },
    async runTransaction(fn) {
      const old = Object.fromEntries(Object.entries(data).map(([name, rows]) => [name, new Map(rows)]));
      try { return await fn({ collection }); } catch (error) {
        for (const name of Object.keys(data)) delete data[name];
        Object.assign(data, old);
        throw error;
      }
    }
  };
}

function fixture() {
  return memoryDb({
    resources: [
      { _id: 'r_hb', status: 'published', title: '湖北漆器', regionName: '湖北', latitude: 30.58, longitude: 114.3 },
      { _id: 'r_hn', status: 'published', title: '河南纹样', regionName: '河南', latitude: 34.75, longitude: 113.66 }
    ],
    story_entities: [
      { _id: 'e_hb', status: 'confirmed', resourceId: 'r_hb', name: '凤鸟纹', region: { province: '湖北' }, timeRange: { startYear: -400 } },
      { _id: 'e_hn', status: 'confirmed', resourceId: 'r_hn', name: '鸟纹', region: { province: '河南' }, timeRange: { startYear: -300 } }
    ],
    story_evidence_links: [
      { _id: 'l_hb', status: 'confirmed', resourceId: 'r_hb', submissionId: 's_hb', evidenceSummary: '漆器上的鸟纹' },
      { _id: 'l_hn', status: 'confirmed', resourceId: 'r_hn', submissionId: 's_hn', evidenceSummary: '纹样记录' }
    ],
    submissions: [
      { _id: 's_hb', status: 'approved', aiAnalysisConsent: true,
        aiConsentVersion: 'ai-analysis-consent-v1', aiConsentScope: 'approved_public_submission_text' },
      { _id: 's_hn', status: 'approved', aiAnalysisConsent: true,
        aiConsentVersion: 'ai-analysis-consent-v1', aiConsentScope: 'approved_public_submission_text' }
    ],
    story_relations: [
      { _id: 'rel1', status: 'confirmed', resourceId: 'r_hb', fromEntityId: 'e_hb',
        toEntityId: 'e_hn', relationType: 'visually_similar_to', why: '两件材料轮廓具有可描述的相似性',
        evidenceLinkIds: ['l_hb'] }
    ],
    story_chains: [
      { _id: 'story_hb', status: 'published', resourceId: 'r_hb', version: 1, sourceLinkIds: ['l_hb'] },
      { _id: 'story_hn', status: 'published', resourceId: 'r_hn', version: 1, sourceLinkIds: ['l_hn'] }
    ],
    story_claims: [
      { _id: 'claim_hb', status: 'supported', resourceId: 'r_hb', storyId: 'story_hb',
        storyVersion: 1, claimText: '漆器记录了凤鸟纹样。', sourceLinkIds: ['l_hb'] },
      { _id: 'claim_hn', status: 'supported', resourceId: 'r_hn', storyId: 'story_hn',
        storyVersion: 1, claimText: '这份材料呈现鸟纹。', sourceLinkIds: ['l_hn'] }
    ]
  });
}

const draft = () => ({
  title: '凤鸟纹样跨地区观察', introduction: '从两地已确认的材料出发，观察鸟纹在不同器物上的表现。',
  questions: ['两地的纹样各有哪些可核对的特点？'],
  nodes: [
    { entityId: 'e_hb', resourceId: 'r_hb', storyId: 'story_hb', sourceLinkIds: ['l_hb'] },
    { entityId: 'e_hn', resourceId: 'r_hn', storyId: 'story_hn', sourceLinkIds: ['l_hn'] }
  ],
  relationIds: ['rel1'],
  chapters: [
    { title: '湖北的器物', body: '漆器记录了凤鸟纹样。这里仅描述已审核材料呈现的可见线索。',
      nodeIds: ['e_hb'], sourceLinkIds: ['l_hb'], claimIds: ['claim_hb'] },
    { title: '河南的材料', body: '这份材料呈现鸟纹。两地资料分别成章，不把视觉相似当作传播证据。',
      nodeIds: ['e_hn'], sourceLinkIds: ['l_hn'], claimIds: ['claim_hn'] }
  ]
});

async function main() {
  const db = fixture();
  const service = createStoryThemeService({ db });
  const saved = await service.save(draft(), 'admin1');
  assert.equal(saved.revision, 1);
  assert.equal((await service.workspace()).themes.length, 1);
  await assert.rejects(service.save({ ...draft(), themeId: saved.themeId, expectedRevision: 0 }, 'admin1'),
    { code: 'THEME_EDIT_CONFLICT' });
  await assert.rejects(service.publish({ themeId: saved.themeId, expectedRevision: 1 }, 'admin1'),
    { code: 'THEME_REVIEW_REQUIRED' });
  const published = await service.publish({ themeId: saved.themeId, expectedRevision: 1,
    humanReviewed: true, reviewNote: '两章事实与各自来源已经逐条核对' }, 'admin1');
  assert.equal(published.version, 1);
  assert.equal(db.data.story_theme_versions.size, 1);
  const snapshot = db.data.story_theme_versions.get(saved.themeId + '_v1');
  assert.deepEqual(snapshot.nodes.map(node => node.region.province), ['湖北', '河南']);
  assert.equal(snapshot.relations[0].relationType, 'visually_similar_to');
  db.data.submissions.get('s_hn').aiConsentRevokedAt = 'now';
  await assert.rejects(service.save({ ...draft(), themeId: saved.themeId, expectedRevision: 1 }, 'admin1'),
    { code: 'THEME_SOURCE_UNAVAILABLE' });
  assert.equal(db.data.story_themes.get(saved.themeId).status, 'published', '失败的编辑不能覆盖旧版');
  console.log('Story theme local lifecycle checks passed.');
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { memoryDb, fixture, draft };
