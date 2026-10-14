'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createBadgeService, RULES, VERSION, evaluate } = require('../cloudfunctions/appCore/domains/badges');
const catalog = require('../static/badge-catalog');
function fixture() {
  const data = Object.fromEntries(['submissions', 'submission_supplements', 'system_feedback', 'resources',
    'badge_awards', 'badge_award_logs', 'badge_evidence', 'badge_evidence_logs', 'badge_learning', 'badge_learning_sessions'].map(name => [name, new Map()]));
  let transactionQueue = Promise.resolve();
  let beforeTransaction = null;
  let failAudit = false;
  const db = {
    data,
    set beforeTransaction(value) { beforeTransaction = value; },
    set failAudit(value) { failAudit = value; },
    collection(name) {
      if (!data[name]) throw new Error('Unexpected collection: ' + name);
      let filter = {}, skip = 0, limit = 100;
      const query = {
        where(value) { filter = value; return query; }, orderBy() { return query; },
        skip(value) { skip = value; return query; }, limit(value) { limit = value; return query; },
        async get() { return { data: [...data[name]].map(([id, row]) => ({ ...row, _id: id }))
          .filter(row => Object.entries(filter).every(([k, v]) => row[k] === v))
          .sort((a, b) => a._id.localeCompare(b._id)).slice(skip, skip + limit) }; },
        doc(id) { return {
          async get() { return { data: data[name].has(id) ? [{ ...data[name].get(id), _id: id }] : [] }; },
          async set(value) { if (failAudit && name === 'badge_award_logs') throw new Error('audit write failed'); data[name].set(id, structuredClone(value)); }
        }; }
      };
      return query;
    },
    runTransaction(work) {
      const next = transactionQueue.then(async () => {
        if (beforeTransaction) { const hook = beforeTransaction; beforeTransaction = null; hook(); }
        const snapshot = structuredClone(data);
        try { return await work(db); }
        catch (error) { Object.assign(data, snapshot); throw error; }
      });
      transactionQueue = next.catch(() => {});
      return next;
    }
  };
  return db;
}
const approved = { userId: 'test-owner', status: 'approved', source: 'cloudbase_formal_web', reviewerId: 'test-reviewer', reviewedAt: '2026-10-13T00:00:00Z' };
let checks = 0;
async function test(name, run) { await run(); checks++; console.log('PASS ' + name); }
async function main() {
  await test('server rules match all twelve approved client rules', () => {
    for (const badge of catalog.catalog) assert.deepEqual(RULES[badge.id], Object.fromEntries(badge.requirements.map(r => [r.metric, r.target])));
  });
  await test('compound rules require every metric, unknown never becomes zero', () => {
    assert.equal(evaluate('lamplight', { completed_learning_topics: 5 }, null, 'now').eligible, null);
    assert.equal(evaluate('lamplight', { completed_learning_topics: 5, correct_quiz_questions: 4 }, null, 'now').eligible, false);
    assert.equal(evaluate('lamplight', { completed_learning_topics: 5, correct_quiz_questions: 5 }, null, 'now').eligible, true);
  });
  const db = fixture(), service = createBadgeService({ db });
  await test('anonymous service calls rejected', async () => {
    await assert.rejects(service.get('', { badgeId: 'fieldnotes' }), { code: 'UNAUTHENTICATED' });
    await assert.rejects(service.claim('', {}), { code: 'UNAUTHENTICATED' });
  });
  await test('empty account reports zero for the supported badge', async () => {
    const { badge } = await service.get('test-owner', { badgeId: 'fieldnotes' });
    assert.equal(badge.status, 'in_progress'); assert.equal(badge.progress[0].current, 0);
  });
  await test('demo, other owner, unreviewed, withdrawn and pending submissions cannot earn', async () => {
    const invalid = [{ source: 'demo' }, { userId: 'someone-else' }, { reviewedAt: null }, { reviewerId: '' }, { withdrawnAt: 'now' }, { status: 'pending' }];
    invalid.forEach((fields, i) => db.data.submissions.set('invalid-' + i, { ...approved, ...fields }));
    assert.equal((await service.get('test-owner', { badgeId: 'fieldnotes' })).badge.eligible, false);
    await assert.rejects(service.claim('test-owner', { badgeId: 'fieldnotes', ruleVersion: VERSION }), { code: 'BADGE_NOT_ELIGIBLE' });
  });
  await test('client-supplied owner, progress and eligibility are ignored', async () => {
    const { badge } = await service.get('test-owner', { badgeId: 'fieldnotes', userId: 'someone-else', eligible: true, count: 900 });
    assert.equal(badge.eligible, false);
  });
  await test('pagination reaches approved evidence after first 100 records', async () => {
    for (let i = 0; i < 110; i++) db.data.submissions.set('a-' + i.toString().padStart(3, '0'), { ...approved, reviewerId: '' });
    db.data.submissions.set('z-valid', { ...approved });
    assert.equal((await service.get('test-owner', { badgeId: 'fieldnotes' })).badge.status, 'eligible');
  });
  await test('rule changes and unqualified badges cannot be claimed', async () => {
    await assert.rejects(service.claim('test-owner', { badgeId: 'fieldnotes', ruleVersion: 'old' }), { code: 'BADGE_RULE_CHANGED' });
    await assert.rejects(service.claim('test-owner', { badgeId: 'artisan', ruleVersion: VERSION, eligible: true }), { code: 'BADGE_NOT_ELIGIBLE' });
    assert.equal((await service.get('test-owner', { badgeId: 'artisan' })).badge.progress[0].current, 0);
  });
  await test('review changes between eligibility and transaction prevent award', async () => {
    db.beforeTransaction = () => { db.data.submissions.get('z-valid').status = 'rejected'; };
    await assert.rejects(service.claim('test-owner', { badgeId: 'fieldnotes', ruleVersion: VERSION }), { code: 'BADGE_SOURCE_CHANGED' });
    assert.equal(db.data.badge_awards.size, 0); db.data.submissions.get('z-valid').status = 'approved';
  });
  await test('failed audit write rolls back award', async () => {
    db.failAudit = true;
    await assert.rejects(service.claim('test-owner', { badgeId: 'fieldnotes', ruleVersion: VERSION }), /audit write failed/);
    assert.equal(db.data.badge_awards.size, 0); db.failAudit = false;
  });
  await test('concurrent claims create one award and one audit record', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => service.claim('test-owner', { badgeId: 'fieldnotes', ruleVersion: VERSION })));
    assert.equal(results.filter(r => !r.cached).length, 1);
    assert.equal(db.data.badge_awards.size, 1); assert.equal(db.data.badge_award_logs.size, 1);
    assert(results.every(r => r.badge.status === 'earned'));
    assert(!JSON.stringify(results).includes('test-owner')); assert(!JSON.stringify(results).includes('z-valid'));
  });
  await test('withdrawn evidence stops displaying an earned badge without deleting history', async () => {
    db.data.submissions.get('z-valid').withdrawnAt = 'now';
    const { badge } = await service.get('test-owner', { badgeId: 'fieldnotes' });
    assert.equal(badge.status, 'needs_review'); assert.equal(badge.earned, false);
    assert.equal(db.data.badge_awards.size, 1); assert.equal(db.data.badge_award_logs.size, 1);
  });
  await test('scan exhaustion reports unknown rather than false zero', async () => {
    const full = fixture(); for (let i = 0; i < 1000; i++) full.data.submissions.set(String(i), { ...approved, reviewerId: '' });
    const { badge } = await createBadgeService({ db: full }).get('test-owner', { badgeId: 'fieldnotes' });
    assert.equal(badge.eligible, null); assert.equal(badge.progress[0].current, null);
  });
  await test('client rejects malformed server responses and late aborted responses', async () => {
    const browser = { ChuBadgeTransport: { query: async () => ({ badgeId: 'fieldnotes', status: 'earned', eligible: true }) } };
    vm.runInNewContext(fs.readFileSync(require.resolve('../static/badge-catalog'), 'utf8'), { window: browser });
    await assert.rejects(browser.ChuBadgeCatalog.checkEligibility('fieldnotes'), /状态暂不可用/);
    const controller = new AbortController();
    browser.ChuBadgeTransport.query = async () => { controller.abort(); return { status: 'login_required' }; };
    await assert.rejects(browser.ChuBadgeCatalog.checkEligibility('fieldnotes', { signal: controller.signal }), { name: 'AbortError' });
  });
  console.log(`Badge service: ${checks} checks passed (local fixtures; no production writes).`);
}
module.exports = { fixture, approved };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
