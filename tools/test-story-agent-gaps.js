'use strict';
const assert = require('node:assert/strict');
const { fakeDb, fixture } = require('./test-story-agent-reviews');
const { createStoryAgentGapService, taskIdFor } = require('../cloudfunctions/adminSubmissions/domains/story-agent-gaps');
function seed() {
  const data = fixture();
  data.story_chains = { story1: { status: 'published', resourceId: 'r1', title: '花窗故事', version: 2, chapters: [{ title: '构造' }] } };
  data.story_agent_candidates.gap1 = { jobId: 'job1', submissionId: 's1', candidateType: 'gap', status: 'pending_review', payload: { request: '需要背面构造照片', reason: '当前只有正面照片' } };
  return data;
}
const request = { candidateId: 'gap1', storyId: 'story1', chapterIndex: '', title: '征集花窗背面照片', description: '请提供花窗背面连接位置的清晰近照', requestedAssetType: 'image', rewardPoints: 0 };
async function main() {
  const db = fakeDb(seed()), service = createStoryAgentGapService({ db });
  await assert.rejects(service.save(request, 'admin', true), { code: 'DRAFT_CHANGED' });
  const saved = await service.save(request, 'admin');
  assert.equal(saved.task.status, 'draft'); assert.equal(saved.task.chapterIndex, null);
  assert.equal(db.data().story_agent_candidates.gap1.status, 'pending_review');
  assert.equal(Object.keys(db.data().story_relations).length, 0);
  await assert.rejects(service.save({ ...request, draftVersion: 1, rewardPoints: 100 }, 'admin', true), { code: 'DRAFT_CHANGED' });
  const publish = { ...request, draftVersion: saved.task.draftVersion };
  const results = await Promise.all([service.save(publish, 'admin', true), service.save(publish, 'admin', true)]);
  assert.equal(results[1].cached, true);
  assert.equal(Object.keys(db.data().story_gap_tasks).length, 1);
  assert.equal(db.data().story_gap_tasks[taskIdFor('gap1')].status, 'published');
  assert.equal(db.data().story_agent_reviews.gap1.decision, 'publish_gap_task');
  assert.equal(db.data().point_ledger, undefined);
  for (const [mutate, code] of [
    [s => { s.submissions.s1.aiAnalysisConsent = false; }, 'CONSENT_CHANGED'],
    [s => { s.story_chains.story1.resourceId = 'other'; }, 'GAP_STORY_MISMATCH'],
    [s => { s.story_chains.story1.status = 'archived'; }, 'GAP_STORY_MISMATCH'],
    [s => { s.resources.r1.status = 'archived'; }, 'RESOURCE_UNAVAILABLE'],
    [s => { s.story_agent_candidates.gap1.status = 'rejected'; }, 'GAP_ALREADY_PROCESSED']
  ]) {
    const d = fakeDb(seed()), svc = createStoryAgentGapService({ db: d });
    await svc.save(request, 'admin'); mutate(d.data());
    await assert.rejects(svc.save(publish, 'admin', true), { code });
    assert.equal(d.data().story_gap_tasks[taskIdFor('gap1')].status, 'draft');
  }
  const d = fakeDb(seed()), svc = createStoryAgentGapService({ db: d });
  await svc.save(request, 'admin');
  d.failOn('story_agent_reviews');
  await assert.rejects(svc.save(publish, 'admin', true), /injected failure/);
  assert.equal(d.data().story_gap_tasks[taskIdFor('gap1')].status, 'draft');
  assert.equal(d.data().story_agent_candidates.gap1.status, 'pending_review');
  const revokedSource = seed();
  revokedSource.submissions.s2 = { ...revokedSource.submissions.s1, aiConsentRevokedAt: '2026-09-07' };
  revokedSource.story_evidence_links.ev1.submissionId = 's2';
  revokedSource.story_agent_jobs.job1.input.evidenceLinks = [{ id: 'ev1', resourceId: 'r1' }];
  await assert.rejects(createStoryAgentGapService({ db: fakeDb(revokedSource) }).save(request, 'admin'),
    { code: 'SOURCE_UNAVAILABLE' });
  console.log('Agent gaps passed: private drafts, version gates, consent, resource/story status, atomic publish, deduplication, no rewards.');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
