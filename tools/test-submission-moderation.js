'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createSubmissionModerationService } = require('../cloudfunctions/adminSubmissions/domains/submission-moderation');
const { loadPublicStoryGraph } = require('../cloudfunctions/appCore/domains/story-graph');
const { createStoryEvidenceService } = require('../cloudfunctions/appCore/domains/story-evidence');

function fakeDb(seed) {
  let state = structuredClone(seed), failure = '', tail = Promise.resolve();
  const matches = (row, filter) => filter.$and ? filter.$and.every(value => matches(row, value))
    : filter.$or ? filter.$or.some(value => matches(row, value))
      : Object.entries(filter).every(([field, value]) => value instanceof RegExp ? value.test(row[field] || '') : row[field] === value);
  function collection(getState, name) {
    const table = () => getState()[name] ||= {};
    const writable = () => { if (name === failure) throw Error('injected write failure'); };
    let filter = {}, offset = 0, limit = 100, ordering = [];
    const query = {
      doc(id) { return {
        async get() { return { data: table()[id] ? [{ ...structuredClone(table()[id]), _id: id }] : [] }; },
        async update(patch) { writable(); assert(table()[id], `missing ${name}/${id}`); table()[id] = { ...table()[id], ...structuredClone(patch) }; },
        async set(record) { writable(); table()[id] = structuredClone(record); }
      }; },
      async add(record) { writable(); const id = `record_${Object.keys(table()).length}`; table()[id] = structuredClone(record); return { id }; },
      where(value) { filter = value; return query; },
      orderBy(field, direction) { ordering.push([field, direction]); return query; },
      skip(value) { offset = value; return query; }, limit(value) { limit = value; return query; },
      async get() {
        const records = Object.entries(table()).map(([id, record]) => ({ ...structuredClone(record), _id: id })).filter(row => matches(row, filter));
        records.sort((a, b) => { for (const [field, direction] of ordering) { const compared = String(a[field] || '').localeCompare(String(b[field] || '')); if (compared) return direction === 'desc' ? -compared : compared; } return 0; });
        return { data: records.slice(offset, offset + limit) };
      }
    };
    return query;
  }
  return {
    collection: name => collection(() => state, name),
    command: { and: value => ({ $and: value }), or: value => ({ $or: value }) },
    RegExp: ({ regexp, options }) => new RegExp(regexp, options),
    serverDate: () => '2026-10-03T00:00:00Z',
    async createCollection(name) { state[name] ||= {}; },
    runTransaction(handler) {
      const result = tail.then(async () => { const draft = structuredClone(state); const answer = await handler({ collection: name => collection(() => draft, name) }); state = draft; return answer; });
      tail = result.catch(() => {}); return result;
    },
    data: () => state, failOn: name => { failure = name; }
  };
}

function loadAdmin(db, uid = 'admin') {
  const filename = path.resolve(__dirname, '../cloudfunctions/adminSubmissions/index.js');
  const load = createRequire(filename), exported = {};
  const app = { database: () => db, auth: () => ({ getUserInfo: () => ({ uid }) }), getTempFileURL: async () => ({ fileList: [] }) };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { exports: exported,
    require: name => name === '@cloudbase/node-sdk' ? { init: () => app } : load(name),
    process: { env: { ADMIN_UIDS: 'admin' } }, console: { error() {}, warn() {} }, Buffer, setTimeout }, { filename });
  return exported.main;
}

function fixture() {
  return {
    submissions: {
      s1: { status: 'approved', title: '旧窗', description: '原始证据', userId: 'owner', rewardPoints: 100, resourceId: 'r1', reviewNote: '首次审核通过', imageFileID: 'local-original', aiAnalysisConsent: true },
      s2: { status: 'approved', title: '另一来源' }, p1: { status: 'pending', title: '待审', userId: 'owner', rewardPoints: 100 }
    },
    resources: { r1: { status: 'published', title: '测试资源' } },
    user_profiles: { owner: { points: 160, approvedCount: 1, uploadCount: 2 } },
    point_ledger: { award_submission_s1: { userId: 'owner', amount: 100 } },
    moderation_logs: { approval: { submissionId: 's1', fromStatus: 'pending', toStatus: 'approved' } },
    story_evidence_links: { ev1: { submissionId: 's1', resourceId: 'r1', status: 'confirmed', evidenceSummary: '原始审核证据' }, ev2: { submissionId: 's2', resourceId: 'r1', status: 'confirmed' } },
    story_entities: { entity1: { resourceId: 'r1', status: 'confirmed', name: '旧窗', entityType: 'heritage_object' }, entity2: { resourceId: 'r1', status: 'confirmed', name: '纹样', entityType: 'detail_or_motif' } },
    story_relations: { rel1: { resourceId: 'r1', status: 'confirmed', fromEntityId: 'entity1', toEntityId: 'entity2', evidenceLinkIds: ['ev1'], why: '有来源的关系', relationType: 'depicts' },
      directOrigin: { status: 'confirmed', evidenceLinkIds: ['ev2'], why: '直接源于已下架投稿的建议' } },
    story_chains: {
      story1: { resourceId: 'r1', status: 'published', title: '旧窗故事', sourceLinkIds: ['ev1'], chapters: [{ title: '第一章', body: '有证据的正文', sourceLinkIds: ['ev1'] }] },
      chapterOnly: { status: 'draft', chapters: [{ sourceLinkIds: ['ev1'] }] },
      other: { status: 'published', sourceLinkIds: ['ev2'] }
    },
    story_claims: { claim1: { status: 'supported', sourceLinkIds: ['ev1'] } },
    story_agent_jobs: { job1: { submissionId: 's2', status: 'processing', input: { evidenceLinks: [{ id: 'ev1' }] } } },
    ai_jobs: {
      sourcedDraft: { type: 'sourced_story_draft', status: 'processing', input: { sources: [{ linkId: 'ev1' }] } },
      sectionDraft: { type: 'sourced_section_revision_draft', status: 'pending', input: { sources: [{ linkId: 'ev1' }] } },
      directSource: { sourceSubmissionId: 's1', status: 'running' },
      completed: { status: 'completed', input: { sources: [{ submissionId: 's1' }] } },
      unrelated: { status: 'processing', input: { sources: [{ linkId: 'ev2' }] } }
    },
    material_analysis_jobs: { material1: { submissionId: 's1', status: 'processing' } },
    story_agent_candidates: { candidate1: { submissionId: 's1', status: 'approved', formalEntityId: 'entity1' },
      directRelation: { submissionId: 's1', status: 'approved', formalRelationId: 'directOrigin' },
      pending: { jobId: 'job1', status: 'pending_review' } },
    story_gap_tasks: { task1: { status: 'published', storyId: 'story1' }, completed: { status: 'fulfilled', storyId: 'story1', rewardStatus: 'awarded' } },
    story_themes: { theme1: { publishedVersionId: 'theme1_v1' } },
    story_theme_versions: { theme1_v1: { sources: [{ id: 'ev1', submissionId: 's1' }] } },
    guide_fragments: { guide1: { status: 'published', storyId: 'story1' } },
    guide_fragment_versions: { guide1_v1: { status: 'published', storyId: 'story1' } }
  };
}

async function main() {
  const db = fakeDb(fixture()), admin = loadAdmin(db), withdraw = { action: 'withdrawSubmission', submissionId: 's1', reviewNote: '资料待重新核实' };
  assert.equal((await loadAdmin(db, 'ordinary-user')(withdraw)).error.code, 'FORBIDDEN');
  assert.equal((await loadAdmin(db, '')(withdraw)).error.code, 'UNAUTHENTICATED');
  assert.equal((await admin({ ...withdraw, reviewNote: ' ' })).error.code, 'REVIEW_NOTE_REQUIRED');
  assert.equal((await admin({ ...withdraw, submissionId: 'missing' })).error.code, 'SUBMISSION_NOT_FOUND');
  assert.equal((await admin({ ...withdraw, submissionId: 'p1' })).error.code, 'STATUS_CONFLICT');
  const before = structuredClone(db.data());
  const [first, repeated] = await Promise.all([admin(withdraw), admin(withdraw)]);
  assert(first.ok && repeated.ok); assert.equal(Number(first.cached) + Number(repeated.cached), 1);
  assert.equal(db.data().submissions.s1.status, 'withdrawn');
  for (const field of ['description', 'imageFileID', 'reviewNote', 'resourceId', 'aiAnalysisConsent']) assert.equal(db.data().submissions.s1[field], before.submissions.s1[field]);
  assert.deepEqual(db.data().user_profiles, before.user_profiles);
  assert.deepEqual(db.data().point_ledger, before.point_ledger);
  assert.deepEqual(db.data().moderation_logs.approval, before.moderation_logs.approval);
  assert.equal(Object.keys(db.data().moderation_logs).length, 2);
  assert.equal(db.data().story_evidence_links.ev1.evidenceSummary, '原始审核证据');
  for (const [collection, id] of [['story_evidence_links', 'ev1'], ['story_chains', 'story1'], ['story_chains', 'chapterOnly'], ['story_relations', 'rel1'], ['story_claims', 'claim1'], ['story_themes', 'theme1'], ['guide_fragments', 'guide1'], ['guide_fragment_versions', 'guide1_v1']]) assert.equal(db.data()[collection][id].needsSourceReview, true, `${collection}/${id}`);
  assert.equal(db.data().story_chains.other.needsSourceReview, undefined);
  assert.equal(db.data().story_agent_jobs.job1.status, 'source_invalid');
  for (const id of ['sourcedDraft', 'sectionDraft', 'directSource']) assert.equal(db.data().ai_jobs[id].status, 'source_invalid', id);
  assert.equal(db.data().ai_jobs.completed.status, 'completed');
  assert.equal(db.data().ai_jobs.completed.needsSourceReview, true);
  assert.equal(db.data().ai_jobs.unrelated.status, 'processing');
  assert.equal(db.data().ai_jobs.unrelated.needsSourceReview, undefined);
  assert.equal(db.data().material_analysis_jobs.material1.status, 'source_invalid');
  assert.equal(db.data().story_relations.directOrigin.needsSourceReview, true);
  assert.equal(db.data().story_agent_candidates.pending.status, 'source_invalid');
  assert.equal(db.data().story_gap_tasks.task1.status, 'paused_source_review');
  assert.equal(db.data().story_gap_tasks.completed.status, 'fulfilled');
  assert.equal(db.data().story_gap_tasks.completed.rewardStatus, 'awarded');
  assert.equal((await admin({ action: 'review', submissionId: 's1', status: 'approved' })).error.code, 'STATUS_CONFLICT');
  const again = await admin({ ...withdraw, reviewNote: '重复请求不得覆盖原说明' });
  assert(again.cached); assert.equal(db.data().submissions.s1.withdrawalNote, withdraw.reviewNote);
  assert.deepEqual(db.data().point_ledger, before.point_ledger);
  const approval = await admin({ action: 'review', submissionId: 'p1', status: 'approved' });
  assert(approval.ok); assert.equal(approval.rewardPoints, 100);
  assert.equal(db.data().user_profiles.owner.points, 260);
  assert.equal(db.data().point_ledger.award_submission_p1.amount, 100);
  assert.equal((await admin({ action: 'review', submissionId: 'p1', status: 'approved' })).error.code, 'STATUS_CONFLICT');
  assert.equal(db.data().user_profiles.owner.points, 260);

  const rollback = fakeDb(fixture()); rollback.failOn('moderation_logs');
  await assert.rejects(createSubmissionModerationService({ db: rollback }).withdraw(withdraw, 'admin'));
  assert.equal(rollback.data().submissions.s1.status, 'approved');

  const partial = fakeDb(fixture()); partial.failOn('story_evidence_links');
  const partialService = createSubmissionModerationService({ db: partial });
  const failedCascade = await partialService.withdraw(withdraw, 'admin');
  assert(failedCascade.ok && failedCascade.sourceReviewPending);
  assert.equal(partial.data().submissions.s1.status, 'withdrawn');
  const evidence = await createStoryEvidenceService({ db: partial, app: { getTempFileURL: async () => ({ fileList: [] }) } }).list({ resourceId: 'r1' });
  assert.equal(evidence.story, null); assert(!evidence.items.some(item => item.submission.id === 's1'));
  assert.equal((await loadPublicStoryGraph(partial, 'r1')).edges.length, 0);
  partial.failOn('');
  const repaired = await partialService.withdraw(withdraw, 'admin');
  assert(repaired.cached && !repaired.sourceReviewPending);
  assert.equal(partial.data().submissions.s1.sourceReviewPending, false);
  assert.equal(Object.keys(partial.data().moderation_logs).length, 2);

  const many = fixture();
  for (let i = 0; i < 125; i++) {
    many.submissions[`old_${String(i).padStart(3, '0')}`] = { status: 'approved', title: i === 0 ? '早期 [旧窗]' : '普通投稿', createdAt: String(i).padStart(3, '0') };
    many.story_evidence_links[`old_link_${String(i).padStart(3, '0')}`] = { submissionId: 's1', status: 'confirmed' };
  }
  const manyDb = fakeDb(many), manyAdmin = loadAdmin(manyDb);
  const pages = []; let offset = 0;
  do { const page = await manyAdmin({ action: 'list', status: 'approved', limit: 50, offset }); assert(page.ok); pages.push(...page.items); offset = page.nextOffset; } while (offset !== null);
  assert.equal(pages.length, 127); assert.equal(new Set(pages.map(item => item.id)).size, 127);
  const search = await manyAdmin({ action: 'list', status: 'approved', search: '[旧窗]' });
  assert.equal(search.items.length, 1); assert.equal(search.items[0].id, 'old_000');
  assert.equal((await manyAdmin({ action: 'list', status: 'approved', search: 'old_000' })).items[0].id, 'old_000');
  assert.equal((await manyAdmin({ action: 'list', status: 'pending', search: 'old_000' })).items.length, 0);
  await manyAdmin(withdraw);
  assert.equal(manyDb.data().story_evidence_links.old_link_124.needsSourceReview, true);
  assert.equal((await manyAdmin({ action: 'list', status: 'withdrawn' })).items[0].id, 's1');
  console.log('Submission moderation passed: authentication, transactional withdrawal, concurrent/repeated idempotence, unchanged rewards/evidence, cascade retry, public source gating, old-record search and pagination.');
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { fakeDb, loadAdmin, fixture };
