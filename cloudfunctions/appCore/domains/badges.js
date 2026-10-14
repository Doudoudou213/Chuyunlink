'use strict';
const crypto = require('node:crypto');
const E = require('../lib/badge-evidence');
const { createBadgeLearning } = require('./badge-learning');
const VERSION = '2026-10-04.v1';
// Server-owned rules. The browser's thresholds and counters are never accepted.
const RULES = Object.freeze({
  architecture: { approved_architecture_objects: 3 }, bronze: { approved_music_objects: 2 },
  fieldnotes: { approved_collections: 1 }, pattern: { approved_pattern_objects: 3 },
  inscription: { approved_inscription_objects: 2 }, artisan: { approved_authorized_oral_records: 1 },
  journey: { approved_onsite_places: 3 }, artifact: { approved_artifact_objects: 3 },
  proofreader: { accepted_sourced_corrections: 3 }, collaborator: { accepted_other_contributor_records: 3 },
  lamplight: { completed_learning_topics: 5, correct_quiz_questions: 5 },
  heritage: { valid_contributions: 10, valid_content_categories: 3, accepted_collaborative_supplements: 2 }
});
Object.values(RULES).forEach(Object.freeze);
const first = result => Array.isArray(result?.data) ? result.data[0] : result?.data;
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const missing = error => /DATABASE_COLLECTION_NOT_EXIST|collection.*not.*exist/i.test(String(error?.code || '') + String(error?.message || ''));
const key = (uid, badgeId) => crypto.createHash('sha256').update(JSON.stringify([uid, badgeId, VERSION])).digest('hex');
function validSubmission(row, uid) {
  return row && row.userId === uid && row.status === 'approved' &&
    row.source === 'cloudbase_formal_web' && !!row.reviewedAt && !!row.reviewerId &&
    !row.withdrawnAt && !row.disabledAt && !row.sourceUnavailable && !row.deletedAt;
}
function evaluate(badgeId, metrics, award, now) {
  if (!Object.hasOwn(RULES, badgeId)) fail('BADGE_NOT_FOUND', '没有找到这枚徽章');
  const progress = Object.entries(RULES[badgeId]).map(([metric, target]) => ({ metric, target,
    current: Number.isSafeInteger(metrics[metric]) && metrics[metric] >= 0 ? Math.min(metrics[metric], target) : null }));
  const known = progress.every(p => p.current !== null);
  const eligible = known ? progress.every(p => p.current >= p.target) : null;
  const issued = award?.badgeId === badgeId && award?.ruleVersion === VERSION && award?.status === 'issued';
  return { schemaVersion: 1, badgeId, ruleVersion: VERSION,
    status: !known ? 'not_connected' : issued && !eligible ? 'needs_review' : issued ? 'earned' : eligible ? 'eligible' : 'in_progress',
    eligible, earned: known ? Boolean(issued && eligible) : null,
    progress, checkedAt: now, earnedAt: known && issued && eligible ? award.earnedAt : null };
}
function createBadgeService({ db, now = () => new Date().toISOString() }) {
  async function evidence(uid, badgeId) {
    const records = [], ids = [];
    for (let offset = 0; offset < 200; offset += 20) {
      const result = await db.collection('badge_evidence').where({ userId: uid, status: 'confirmed' })
        .orderBy('_id', 'asc').skip(offset).limit(20).get();
      for (const row of result.data || []) {
        const checked = await E.verify(db, row, uid);
        if (checked) { records.push(checked); ids.push(row._id || row.id); }
      }
      const metrics = E.metricsFrom(records);
      if (Object.entries(RULES[badgeId]).every(([metric, target]) => metrics[metric] >= target) || result.data.length < 20) return { metrics, ids };
    }
    // Bounded scan: don't turn partial progress into a false disqualification.
    return { metrics: {}, ids };
  }
  async function readAward(store, uid, badgeId) {
    try {
      const row = first(await store.collection('badge_awards').doc(key(uid, badgeId)).get());
      if (row && row.userId !== uid) fail('BADGE_OWNER_MISMATCH', '徽章记录归属异常');
      return row;
    } catch (error) { if (missing(error)) return null; throw error; }
  }
  async function collectionEvidence(uid) {
    // Stable pagination, bounded scanning. An incomplete scan cannot prove zero.
    for (let offset = 0; offset < 1000; offset += 100) {
      const result = await db.collection('submissions').where({ userId: uid, status: 'approved' })
        .orderBy('_id', 'asc').skip(offset).limit(100).get();
      const rows = result.data || [];
      const row = rows.find(item => validSubmission(item, uid));
      if (row) return { count: 1, id: row._id || row.id };
      if (rows.length < 100) return { count: 0, id: null };
    }
    return { count: null, id: null };
  }
  async function get(uid, event) {
    if (!uid) fail('UNAUTHENTICATED', '请先登录');
    const badgeId = String(event.badgeId || '');
    if (!Object.hasOwn(RULES, badgeId)) fail('BADGE_NOT_FOUND', '没有找到这枚徽章');
    let metrics;
    if (badgeId === 'fieldnotes') metrics = { approved_collections: (await collectionEvidence(uid)).count };
    else if (badgeId === 'lamplight') metrics = await createBadgeLearning({ db }).metrics(uid);
    else metrics = (await evidence(uid, badgeId)).metrics;
    return { ok: true, badge: evaluate(badgeId, metrics, await readAward(db, uid, badgeId), now()) };
  }
  async function claim(uid, event) {
    if (!uid) fail('UNAUTHENTICATED', '请先登录');
    const badgeId = String(event.badgeId || '');
    if (!Object.hasOwn(RULES, badgeId)) fail('BADGE_NOT_FOUND', '没有找到这枚徽章');
    if (event.ruleVersion !== VERSION) fail('BADGE_RULE_CHANGED', '获取规则已更新，请重新打开徽章');
    const proof = badgeId === 'fieldnotes' ? await collectionEvidence(uid) : badgeId === 'lamplight' ? {} : await evidence(uid, badgeId);
    if (badgeId === 'fieldnotes' && !proof.id) fail('BADGE_NOT_ELIGIBLE', '尚未找到通过审核的有效采集');
    // Both collections must be provisioned with client read/write denied before release.
    // No silent runtime collection creation and no client-selected source record.
    return db.runTransaction(async tx => {
      let metrics;
      if (badgeId === 'fieldnotes') {
        const source = first(await tx.collection('submissions').doc(proof.id).get());
        if (!validSubmission(source, uid)) fail('BADGE_SOURCE_CHANGED', '采集审核状态已变化，请刷新后再试');
        metrics = { approved_collections: 1 };
      } else if (badgeId === 'lamplight') metrics = await createBadgeLearning({ db }).metrics(uid, tx);
      else {
        const records = [];
        for (const id of proof.ids) {
          const record = await E.read(tx, 'badge_evidence', id);
          const checked = await E.verify(tx, record, uid);
          if (checked) records.push(checked);
        }
        metrics = E.metricsFrom(records);
      }
      if (evaluate(badgeId, metrics, null, now()).eligible !== true) fail('BADGE_NOT_ELIGIBLE', '尚未达到获取条件，请查看最新进度');
      const id = key(uid, badgeId);
      const previous = await readAward(tx, uid, badgeId);
      if (previous?.status === 'issued') {
        return { ok: true, cached: true, badge: evaluate(badgeId, metrics, previous, now()) };
      }
      if (previous) fail('BADGE_REVIEW_REQUIRED', '这枚徽章需要重新核验，请联系管理员');
      const earnedAt = now();
      const award = { userId: uid, badgeId, ruleVersion: VERSION,
        status: 'issued', earnedAt, sourceIds: proof.id ? [proof.id] : proof.ids || [], metrics };
      await tx.collection('badge_awards').doc(id).set(award);
      await tx.collection('badge_award_logs').doc(id).set({ ...award, action: 'issued' });
      return { ok: true, cached: false, badge: evaluate(badgeId, metrics, award, earnedAt) };
    });
  }
  return { get, claim };
}
module.exports = { createBadgeService, evaluate, RULES, VERSION, validSubmission };
