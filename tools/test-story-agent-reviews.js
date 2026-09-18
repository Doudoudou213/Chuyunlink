'use strict';
const assert = require('node:assert/strict');
const { createStoryAgentReviewService, candidateId } = require('../cloudfunctions/adminSubmissions/domains/story-agent-reviews');
const { candidateIdFor } = require('../cloudfunctions/storyAgentWorker/lib/job-contract');

function fakeDb(seed) {
  let state = structuredClone(seed), failCollection = '', tail = Promise.resolve();
  function collection(data, name) {
    data[name] ||= {};
    let filter = {}, offset = 0, limit = 100;
    const query = {
      doc(key) { return {
        async get() { return { data: data[name][key] ? [{ ...data[name][key], _id: key }] : [] }; },
        async set(record) { if (name === failCollection) throw new Error('injected failure'); data[name][key] = structuredClone(record); },
        async update(record) { if (name === failCollection) throw new Error('injected failure'); data[name][key] = { ...data[name][key], ...structuredClone(record) }; }
      }; },
      where(value) { filter = value; return query; }, orderBy() { return query; },
      skip(value) { offset = value; return query; }, limit(value) { limit = value; return query; },
      async get() { return { data: Object.entries(data[name]).sort().map(([key,v]) => ({ ...v, _id: key }))
        .filter(v => Object.entries(filter).every(([k,x]) => v[k] === x)).slice(offset, offset + limit) }; }
    };
    return query;
  }
  return {
    collection: name => collection(state, name), serverDate: () => '2026-09-05T00:00:00Z',
    async createCollection(name) { state[name] ||= {}; },
    runTransaction(handler) {
      const result = tail.then(async () => { const draft = structuredClone(state); const result = await handler({ collection: name => collection(draft,name) }); state = draft; return result; });
      tail = result.catch(() => {}); return result;
    },
    data: () => state, failOn: name => { failCollection = name; }
  };
}
const entityKey = candidateId('job1', 'entity_1');
function fixture() {
  return {
    story_agent_jobs: { job1: { status: 'awaiting_review', model: 'mock', promptVersion: 'v1', input: { submission: { boundResourceId: 'r1' } } } },
    submissions: { s1: { status: 'approved', aiAnalysisConsent: true,
      aiConsentVersion: 'ai-analysis-consent-v1', aiConsentScope: 'approved_public_submission_text',
      title: '花窗', description: '文字描述凤鸟形花窗' } },
    resources: { r1: { status: 'published', title: '旧宅花窗', type: 'landmark', summary: '有来源的木雕花窗', region: { province: '湖北', city: '随州' } } },
    story_evidence_links: { ev1: { status: 'confirmed', resourceId: 'r1', submissionId: 's1', evidenceSummary: '投稿明确记录窗上凤鸟纹' } },
    story_entities: {}, story_relations: {}, story_graph_logs: {}, story_agent_reviews: {},
    story_agent_candidates: {
      [entityKey]: { jobId: 'job1', submissionId: 's1', status: 'pending_review', candidateType: 'entity', risk: 'medium', payload: { temporaryId: 'entity_1', name: '凤鸟纹', entityType: 'detail_or_motif', summary: '窗上记录的凤鸟形纹样', aliases: [] } },
      relation1: { jobId: 'job1', submissionId: 's1', status: 'pending_review', candidateType: 'relation', risk: 'medium', payload: { fromTemporaryId: 'entity_1', toResourceId: 'r1', relationType: 'depicts', reason: '窗上可辨认的纹样描绘了凤鸟形象', evidenceLinkIds: ['ev1'], confidence: 0.9 } }
    }
  };
}
async function main() {
  assert.equal(entityKey, candidateIdFor('job1', 'entity', 'entity_1'));
  const db = fakeDb(fixture()), service = createStoryAgentReviewService({ db });
  const approve = (key, extra = {}) => service.review({ candidateId: key, decision: 'approve', ...extra }, 'admin');
  assert.equal((await approve('relation1')).results[0].code, 'ENTITY_REVIEW_REQUIRED');
  const entity = (await approve(entityKey)).results[0]; assert.equal(entity.ok, true);
  const [one, two] = await Promise.all([approve('relation1'), approve('relation1')]);
  assert.equal(one.results[0].ok, true); assert.equal(two.results[0].cached, true);
  assert.equal(Object.keys(db.data().story_relations).length, 1);
  assert.equal(Object.keys(db.data().story_agent_reviews).length, 2);
  assert.equal(db.data().story_agent_reviews.relation1.original.reason, fixture().story_agent_candidates.relation1.payload.reason);
  const workspace = await service.workspace({ status: 'approved' });
  assert.equal(workspace.candidates.length, 2);
  assert.equal(JSON.stringify(workspace).includes('reviewerId'), false);
  assert.equal(workspace.candidates.find(c => c.id === 'relation1').evidence[0].summary, '投稿明确记录窗上凤鸟纹');

  for (const [mutate, expected] of [
    [s => { s.submissions.s1.aiAnalysisConsent = false; }, 'CONSENT_CHANGED'],
    [s => { s.submissions.s1.aiConsentVersion = 'old-version'; }, 'CONSENT_CHANGED'],
    [s => { s.submissions.s1.aiConsentRevokedAt = '2026-09-07'; }, 'CONSENT_CHANGED'],
    [s => { s.resources.r1.status = 'archived'; }, 'RESOURCE_UNAVAILABLE'],
    [s => { s.story_agent_jobs.job1.status = 'processing'; }, 'JOB_NOT_READY']
  ]) {
    const seed = fixture(); mutate(seed); const d = fakeDb(seed), svc = createStoryAgentReviewService({ db: d });
    const result = await svc.review({ candidateId: entityKey, decision: 'approve' }, 'admin');
    assert.equal(result.results[0].code, expected); assert.equal(Object.keys(d.data().story_entities).length, 0);
  }
  for (const [mutate, extra, expected] of [
    [s => { s.story_evidence_links.ev1.status = 'archived'; }, {}, 'EVIDENCE_CHANGED'],
    [s => { s.submissions.s1.aiConsentRevokedAt = '2026-09-07'; }, {}, 'CONSENT_CHANGED'],
    [s => { s.story_evidence_links.ev1.resourceId = 'other'; }, {}, 'EVIDENCE_CHANGED'],
    [s => { s.story_agent_candidates.relation1.payload.evidenceLinkIds = []; }, {}, 'INSUFFICIENT_EVIDENCE'],
    [s => { s.story_agent_candidates.relation1.payload.relationType = 'same_origin'; }, {}, 'INVALID_RELATION'],
    [s => { s.story_agent_candidates.relation1.payload.relationType = 'changed_over_time'; }, {}, 'HIGH_RISK_REVIEW_REQUIRED'],
    [s => { s.story_agent_candidates.relation1.risk = 'high'; }, { edits: { relationType: 'depicts' } }, 'HIGH_RISK_REVIEW_REQUIRED']
  ]) {
    const seed = fixture(); mutate(seed); const d = fakeDb(seed), svc = createStoryAgentReviewService({ db: d });
    await svc.review({ candidateId: entityKey, decision: 'approve' }, 'admin');
    const result = await svc.review({ candidateId: 'relation1', decision: 'approve', ...extra }, 'admin');
    assert.equal(result.results[0].code, expected); assert.equal(Object.keys(d.data().story_relations).length, 0);
  }
  const otherSource = fixture();
  otherSource.submissions.s2 = { ...otherSource.submissions.s1, title: '另一位用户的记录' };
  otherSource.story_evidence_links.ev1.submissionId = 's2';
  otherSource.story_agent_jobs.job1.input.evidenceLinks = [{ id: 'ev1', resourceId: 'r1' }];
  const otherDb = fakeDb(otherSource), otherReview = createStoryAgentReviewService({ db: otherDb });
  await otherReview.review({ candidateId: entityKey, decision: 'approve' }, 'admin');
  otherDb.data().submissions.s2.aiConsentRevokedAt = '2026-09-07';
  const stoppedRelation = await otherReview.review({ candidateId: 'relation1', decision: 'approve' }, 'admin');
  assert.equal(stoppedRelation.results[0].code, 'SOURCE_UNAVAILABLE',
    '另一投稿撤回授权后，引用它的候选不得确认');
  assert.equal(Object.keys(otherDb.data().story_relations).length, 0);
  const revokedBeforeReview = fakeDb(otherSource);
  revokedBeforeReview.data().submissions.s2.aiConsentRevokedAt = '2026-09-07';
  const blockedEntity = await createStoryAgentReviewService({ db: revokedBeforeReview })
    .review({ candidateId: entityKey, decision: 'approve' }, 'admin');
  assert.equal(blockedEntity.results[0].code, 'SOURCE_UNAVAILABLE',
    '任务输入来源撤回后，实体候选也不得确认');
  const rollbackDb = fakeDb(fixture()), rollback = createStoryAgentReviewService({ db: rollbackDb });
  rollbackDb.failOn('story_agent_reviews');
  assert.equal((await rollback.review({ candidateId: entityKey, decision: 'approve' }, 'admin')).results[0].ok, false);
  assert.equal(Object.keys(rollbackDb.data().story_entities).length, 0, 'audit failure rolls back formal writes');
  assert.equal(rollbackDb.data().story_agent_candidates[entityKey].status, 'pending_review');

  const seed = fixture(); seed.story_agent_candidates.relation1.risk = 'high';
  const highDb = fakeDb(seed), high = createStoryAgentReviewService({ db: highDb });
  await high.review({ candidateId: entityKey, decision: 'approve' }, 'admin');
  const highRequest = { candidateId: 'relation1', decision: 'approve', highRiskAcknowledged: true, note: '已逐条核对原始文字中的具体描述' };
  assert.equal((await high.review({ items: [highRequest, highRequest] }, 'admin')).results[0].code, 'HIGH_RISK_REVIEW_REQUIRED');
  assert.equal((await high.review(highRequest, 'admin')).results[0].ok, true);

  const mergeSeed = fixture(); mergeSeed.story_entities.existing = { name: '已确认凤纹', entityType: 'detail_or_motif', resourceId: 'r1', status: 'confirmed', summary: '已有说明保持不变' };
  const mergeDb = fakeDb(mergeSeed), merge = createStoryAgentReviewService({ db: mergeDb });
  assert.equal((await merge.review({ candidateId: entityKey, decision: 'approve', edits: { mergeEntityId: 'existing' } }, 'admin')).results[0].formalEntityId, 'existing');
  assert.equal(mergeDb.data().story_entities.existing.summary, '已有说明保持不变');
  assert.equal(Object.keys(mergeDb.data().story_entities).length, 1);
  const rejectedDb = fakeDb(fixture()), rejected = createStoryAgentReviewService({ db: rejectedDb });
  const mixed = await rejected.review({ items: [
    { candidateId: entityKey, decision: 'reject', note: '材料中无法辨认该纹样' },
    { candidateId: 'relation1', decision: 'reject', note: '' }
  ] }, 'admin');
  assert.equal(mixed.results[0].ok, true);
  assert.equal(mixed.results[1].code, 'REVIEW_REASON_REQUIRED');
  assert.equal(Object.keys(rejectedDb.data().story_entities).length, 0);
  assert.equal(rejectedDb.data().story_agent_reviews[entityKey].note, '材料中无法辨认该纹样');
  const manySeed = fixture();
  manySeed.story_agent_candidates = Object.fromEntries(Array.from({length:35},(_,i)=>[`candidate_${String(i).padStart(2,'0')}`, manySeed.story_agent_candidates[entityKey]]));
  const many = createStoryAgentReviewService({ db: fakeDb(manySeed) });
  const page1 = await many.workspace(); const page2 = await many.workspace({offset:page1.nextOffset});
  assert.equal(page1.candidates.length,30); assert.equal(page2.candidates.length,5);
  assert.equal(page2.nextOffset,null);
  console.log('Agent review integration: atomic writes, deduplication, consent, sources, high-risk gates and merge passed.');
}
if (require.main === module) main().catch(e => { console.error(e); process.exitCode = 1; });
module.exports = { fakeDb, fixture };
