'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');
const { fakeDb, fixture } = require('./test-submission-moderation');
const { fixture: themeFixture, draft } = require('./test-story-themes');
const { createSubmissionModerationService } = require('../cloudfunctions/adminSubmissions/domains/submission-moderation');
const { loadPublicStoryGraph } = require('../cloudfunctions/appCore/domains/story-graph');
const { loadPublicTheme } = require('../cloudfunctions/appCore/domains/story-themes');
const { createStoryThemeService } = require('../cloudfunctions/adminSubmissions/domains/story-themes');
const { materialLinkValid } = require('../cloudfunctions/storyWorker/lib/material-evidence');

async function graphChecks() {
  const seed = fixture();
  seed.story_relations.independent = { ...seed.story_relations.rel1, evidenceLinkIds: ['ev2'] };
  seed.story_entities.manual1 = { ...seed.story_entities.entity2, name: '独立手工实体一' };
  seed.story_entities.manual2 = { ...seed.story_entities.entity2, name: '独立手工实体二' };
  seed.story_relations.manual = { ...seed.story_relations.independent, fromEntityId: 'manual1', toEntityId: 'manual2' };
  const db = fakeDb(seed);
  assert((await loadPublicStoryGraph(db, 'r1')).nodes.some(node => node.id === 'entity1'));
  db.failOn('story_evidence_links');
  const response = await createSubmissionModerationService({ db }).withdraw({ submissionId: 's1', reviewNote: '下架来源' }, 'admin');
  assert.equal(response.sourceReviewPending, true);
  assert.equal(db.data().story_entities.entity1.needsSourceReview, undefined);
  const graph = await loadPublicStoryGraph(db, 'r1');
  assert.deepEqual(graph.edges.map(edge => edge.id), ['manual']);
  assert.deepEqual(graph.nodes.map(node => node.id), ['manual1', 'manual2']);

  const relationSeed = fixture();
  relationSeed.story_agent_candidates = { fromSource: { submissionId: 's1', status: 'approved', formalRelationId: 'independent' } };
  relationSeed.story_relations.independent = { ...relationSeed.story_relations.rel1, evidenceLinkIds: ['ev2'] };
  relationSeed.submissions.s1.status = 'withdrawn';
  assert.equal((await loadPublicStoryGraph(fakeDb(relationSeed), 'r1')).edges.length, 0);

  const dependentSeed = fixture();
  dependentSeed.story_relations.rel1.evidenceLinkIds = ['ev2'];
  dependentSeed.story_agent_candidates = { crossSource: { submissionId: 's2', jobId: 'job1', status: 'approved', formalEntityId: 'entity1' } };
  dependentSeed.submissions.s1.status = 'withdrawn';
  assert.equal((await loadPublicStoryGraph(fakeDb(dependentSeed), 'r1')).nodes.length, 0);

  const pagedSeed = fixture();
  pagedSeed.story_relations.rel1.evidenceLinkIds = ['ev2'];
  pagedSeed.story_agent_candidates = Object.fromEntries(Array.from({ length: 105 }, (_, i) => [
    `candidate_${String(i).padStart(3, '0')}`, { status: 'approved', formalEntityId: 'entity1', submissionId: i === 104 ? 's1' : 's2' }
  ]));
  pagedSeed.submissions.s1.status = 'withdrawn';
  assert.equal((await loadPublicStoryGraph(fakeDb(pagedSeed), 'r1')).nodes.length, 0, 'check inverse provenance beyond first page');
}

async function themeChecks() {
  const source = themeFixture();
  const db = fakeDb(Object.fromEntries(Object.entries(source.data).map(([name, rows]) => [name, Object.fromEntries(rows)])));
  const service = createStoryThemeService({ db });
  const saved = await service.save(draft(), 'admin');
  await service.publish({ themeId: saved.themeId, expectedRevision: 1, humanReviewed: true, reviewNote: '核对所有资料来源' }, 'admin');
  assert(await loadPublicTheme(db, saved.themeId));
  await db.collection('submissions').doc('origin').set({ status: 'approved' });
  await db.collection('story_agent_candidates').doc('unrelated').set({ status: 'approved', submissionId: 'unrelated', formalEntityId: 'unrelated_entity' });
  await db.collection('submissions').doc('unrelated').set({ status: 'withdrawn', sourceReviewPending: true });
  assert(await loadPublicTheme(db, saved.themeId), 'unrelated pending cascade must not hide this theme');
  await db.collection('story_agent_candidates').doc('originCandidate').set({ status: 'approved', submissionId: 'origin', formalEntityId: 'e_hb' });
  assert(await loadPublicTheme(db, saved.themeId));
  db.failOn('story_agent_candidates');
  const result = await createSubmissionModerationService({ db }).withdraw({ submissionId: 'origin', reviewNote: '实体原始资料下架' }, 'admin');
  assert.equal(result.sourceReviewPending, true);
  assert.equal(db.data().story_entities.e_hb.needsSourceReview, undefined);
  assert.equal(await loadPublicTheme(db, saved.themeId), null, 'theme cannot revive an invalid entity through other valid chapter sources');
}

async function workerCheck(changeDuringModel, expectedFailure) {
  const entry = path.resolve(__dirname, '../cloudfunctions/storyWorker/index.js');
  const source = fs.readFileSync(entry, 'utf8');
  const consent = { status: 'approved', aiAnalysisConsent: true, aiConsentVersion: 'ai-analysis-consent-v1', aiConsentScope: 'approved_public_submission_text' };
  const db = fakeDb({ submissions: { s1: { ...consent }, s2: { ...consent } },
    story_evidence_links: { ev1: { status: 'confirmed', resourceId: 'r1', submissionId: 's1' }, ev2: { status: 'confirmed', resourceId: 'r1', submissionId: 's2' } },
    ai_jobs: { job: { status: 'processing' } }, story_chains: {} });
  const input = { resource: { title: '测试资源' }, sources: [{ linkId: 'ev1' }, { linkId: 'ev2' }], graphContext: [] };
  const context = { db, require: createRequire(entry), JOB_COLLECTION: 'ai_jobs', LINK_COLLECTION: 'story_evidence_links',
    SUBMISSION_COLLECTION: 'submissions', STORY_COLLECTION: 'story_chains', materialLinkValid,
    firstDocument: result => result.data?.[0] || null,
    cleanText: value => String(value || ''), cleanId: value => value,
    hasCurrentAiConsent: row => row?.status === 'approved' && row.aiAnalysisConsent === true && !row.aiConsentRevokedAt,
    buildConfirmedStoryInput: async () => input, storyReadiness: () => ({ ready: true }),
    ensureStoryDraftJob: async () => ({ jobId: 'job' }), acquireJob: async () => ({ cached: false, job: { input } }),
    storyDraftIdFor: () => 'draft', storyDraftJobId: () => 'fingerprint', reserveDailyCall: async () => 'day',
    recordCompletedUsage: async () => {}, evidenceContextFromInput: value => value,
    assessStoryQuality: () => ({ hardFailures: [], publicationEligible: true }),
    createTokenHubClient: () => ({ draftStory: async (_, hooks) => {
      await hooks.beforeAttempt();
      await changeDuringModel(db);
      return { output: { title: '只引用另一个来源', introduction: '已读过两份来源', chapters: [
        { title: '章节', body: '输出只标记第二份来源', sourceLinkIds: ['ev2'] }
      ], closing: '' }, usage: {} };
    } }) };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('async function assertStoryDraftSources('), source.indexOf('async function loadSectionSources(')) + '\nthis.run = runStoryDraft;', context);
  const action = () => context.run({ enabled: true, apiKey: 'local-placeholder' }, 'admin', { resourceId: 'r1' });
  if (expectedFailure) {
    await assert.rejects(action(), { code: 'STORY_SOURCE_CHANGED' });
    assert.equal(db.data().story_chains.draft, undefined);
  } else {
    assert.equal((await action()).cached, false);
    assert.equal(db.data().story_chains.draft.status, 'draft');
  }
  return db;
}

(async () => {
  await graphChecks();
  await themeChecks();
  await workerCheck(async () => {}, false);
  await workerCheck(db => db.collection('submissions').doc('s1').update({ status: 'withdrawn' }), true);
  const stopped = await workerCheck(db => db.collection('ai_jobs').doc('job').update({ status: 'source_invalid' }), true);
  assert.equal(stopped.data().ai_jobs.job.status, 'source_invalid', 'error handler must preserve the source-invalid state');
  console.log('Withdrawal reader checks passed: mixed-source graphs/themes, provenance pagination, unrelated/manual records and all model-input sources before draft persistence.');
})().catch(error => { console.error(error); process.exitCode = 1; });
