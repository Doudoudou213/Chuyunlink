'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { fixture, approved } = require('./test-badge-service');
const { createBadgeService, RULES, VERSION } = require('../cloudfunctions/appCore/domains/badges');
const { createAdminBadgeService } = require('../cloudfunctions/adminSubmissions/domains/badges');
const { createBadgeLearning, LESSONS } = require('../cloudfunctions/appCore/domains/badge-learning');
const E = require('../cloudfunctions/appCore/lib/badge-evidence');
let tests = 0;
async function test(name, run) { await run(); tests++; console.log('PASS ' + name); }
(async () => {
  const db = fixture(), uid = 'test-owner';
  const service = createBadgeService({ db }), admin = createAdminBadgeService({ db }), learning = createBadgeLearning({ db });
  async function verify(id, category, extra = {}, sourceType = 'submission') {
    return admin.save({ sourceId: id, sourceType, category, status: 'confirmed', revision: 0,
      note: '测试材料已逐项检查，记录仅用于本地测试。', humanReviewed: true, ...extra }, 'test-reviewer');
  }
  function source(id, category, extra = {}) {
    db.data.submissions.set(id, { ...approved, title: '测试资料', ...extra });
    db.data.resources.set(id, { status: 'published', title: '测试资源' });
    return verify(id, category, { resourceId: id, ...extra });
  }
  await test('shared evidence validation stays identical in both deployed function packages', () => {
    assert.equal(fs.readFileSync(require.resolve('../cloudfunctions/appCore/lib/badge-evidence'), 'utf8'), fs.readFileSync(require.resolve('../cloudfunctions/adminSubmissions/lib/badge-evidence'), 'utf8'));
  });
  await test('admin gate, review attestation and revision checks are enforced', async () => {
    db.data.submissions.set('pre', { ...approved });
    await assert.rejects(admin.save({ sourceType: 'submission', sourceId: 'pre' }, ''), { code: 'FORBIDDEN' });
    await assert.rejects(verify('pre', 'document', { humanReviewed: false }), { code: 'BADGE_REVIEW_REQUIRED' });
    await verify('pre', 'document');
    await assert.rejects(verify('pre', 'document'), { code: 'BADGE_REVISION_CONFLICT' });
    const core = fs.readFileSync(require.resolve('../cloudfunctions/adminSubmissions/index'), 'utf8');
    assert(core.indexOf("['getBadgeEvidence', 'saveBadgeEvidence']") > core.indexOf('if (!isAdmin)'));
  });
  await test('same object is not counted twice even across multiple submissions', async () => {
    await source('architecture-0', 'architecture', { onsite: true, placeId: 'architecture-0' });
    db.data.submissions.set('architecture-duplicate', { ...approved });
    await verify('architecture-duplicate', 'architecture', { resourceId: 'architecture-0' });
    assert.equal((await service.get(uid, { badgeId: 'architecture' })).badge.progress[0].current, 1);
    await source('architecture-1', 'architecture', { onsite: true, placeId: 'architecture-1' });
    await source('architecture-2', 'architecture', { onsite: true, placeId: 'architecture-2' });
  });
  await test('confirmed object categories and evidence flags populate all collection badges', async () => {
    for (let i = 0; i < 2; i++) await source('music-' + i, 'music');
    for (let i = 0; i < 3; i++) await source('pattern-' + i, 'pattern', { patternDetails: true });
    for (let i = 0; i < 2; i++) await source('inscription-' + i, 'inscription', { inscriptionTranscript: true });
    await source('oral-0', 'oral', { oralAuthorization: true });
    for (let i = 0; i < 3; i++) await source('artifact-' + i, 'artifact', { artifactDetails: true });
    for (const badgeId of ['architecture','bronze','pattern','inscription','artisan','journey','artifact']) {
      assert.equal((await service.get(uid, { badgeId })).badge.eligible, true, badgeId);
    }
  });
  await test('corrections require actual acceptance and deduplicate a shared issue', async () => {
    for (let i = 0; i < 4; i++) {
      db.data.system_feedback.set('correction-' + i, { userId: uid, type: 'story_correction', status: 'accepted_for_revision', resolvedBy: 'test-reviewer', resolvedAt: 'test-time', content: '测试出处' });
      await verify('correction-' + i, 'document', { citedCorrection: true, issueKey: 'issue-' + Math.min(i, 2) }, 'feedback');
    }
    const badge = (await service.get(uid, { badgeId: 'proofreader' })).badge;
    assert.equal(badge.progress[0].current, 3); assert.equal(badge.eligible, true);
  });
  await test('collaboration excludes self-supplements and groups duplicate targets', async () => {
    for (let i = 0; i < 4; i++) {
      db.data.submissions.set('parent-' + i, { ...approved, userId: i === 0 ? uid : 'other-contributor' });
      db.data.submission_supplements.set('supplement-' + i, { ...approved, submissionId: 'parent-' + i });
      await verify('supplement-' + i, 'document', {}, 'supplement');
    }
    assert.equal((await service.get(uid, { badgeId: 'collaborator' })).badge.eligible, true);
    assert.equal((await service.get(uid, { badgeId: 'heritage' })).badge.eligible, true);
  });
  await test('lesson answer is server-owned, scoped to user, and one use per session', async () => {
    const started = await learning.start(uid, {});
    assert(!Object.hasOwn(started.lesson, 'answer'));
    const lesson = LESSONS.find(l => l.id === started.lesson.id);
    const event = { lessonId: lesson.id, token: started.lesson.token, answer: (lesson.answer + 1) % 3, passed: true };
    await assert.rejects(learning.answer('someone-else', event), { code: 'BADGE_LESSON_EXPIRED' });
    assert.equal((await learning.answer(uid, event)).correct, false);
    assert.equal((await learning.answer(uid, { ...event, answer: lesson.answer })).correct, false);
    assert.equal((await learning.metrics(uid)).correct_quiz_questions, 0);
  });
  await test('five unique completed topics and five correct answers unlock learning badge', async () => {
    for (const lesson of LESSONS) {
      const started = await learning.start(uid, { lessonId: lesson.id });
      await learning.answer(uid, { lessonId: lesson.id, token: started.lesson.token, answer: lesson.answer });
    }
    assert.deepEqual(await learning.metrics(uid), { completed_learning_topics: 5, correct_quiz_questions: 5 });
    assert.equal((await service.get(uid, { badgeId: 'lamplight' })).badge.eligible, true);
    assert.equal((await learning.start(uid, {})).complete, true);
  });
  await test('expired and replaced lesson tokens cannot be reused', async () => {
    let time = 1000;
    const timed = createBadgeLearning({ db, clock: () => time });
    const first = await timed.start(uid, { lessonId: 'permission' });
    const second = await timed.start(uid, { lessonId: 'permission' });
    await assert.rejects(timed.answer(uid, { lessonId: 'permission', token: first.lesson.token, answer: 1 }), { code: 'BADGE_LESSON_EXPIRED' });
    time += 31 * 60 * 1000;
    await assert.rejects(timed.answer(uid, { lessonId: 'permission', token: second.lesson.token, answer: 1 }), { code: 'BADGE_LESSON_EXPIRED' });
    await assert.rejects(timed.start(uid, { lessonId: 'unknown' }), { code: 'BADGE_LESSON_INVALID' });
  });
  await test('all twelve badges claim once, and response omits private evidence', async () => {
    for (const badgeId of Object.keys(RULES)) {
      const first = await service.claim(uid, { badgeId, ruleVersion: VERSION });
      const second = await service.claim(uid, { badgeId, ruleVersion: VERSION });
      assert.equal(first.badge.status, 'earned', badgeId); assert.equal(second.cached, true);
      assert(!JSON.stringify(first).includes(uid)); assert(!Object.hasOwn(first.badge, 'sourceIds'));
    }
    assert.equal(db.data.badge_awards.size, 12); assert.equal(db.data.badge_award_logs.size, 12);
  });
  await test('source changes invalidate attestation and admin can inspect/revoke stale evidence', async () => {
    db.data.submissions.get('oral-0').description = '已变更的材料';
    assert.equal((await service.get(uid, { badgeId: 'artisan' })).badge.status, 'needs_review');
    const lookup = await admin.lookup({ sourceType: 'submission', sourceId: 'oral-0' });
    assert.equal(lookup.evidence.stale, true);
    await admin.save({ sourceType: 'submission', sourceId: 'oral-0', revision: 1, status: 'revoked', note: '原始材料已变更，撤销旧授权核验记录。' }, 'test-reviewer');
    assert.equal(db.data.badge_evidence.get(E.evidenceId('submission','oral-0')).status, 'revoked');
    assert.equal(db.data.badge_awards.size, 12, 'history retained');
  });
  console.log(`Badge closure: ${tests} scenario groups passed. Local fixtures only.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
