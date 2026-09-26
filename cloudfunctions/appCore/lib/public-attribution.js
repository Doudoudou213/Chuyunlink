'use strict';

const ANONYMOUS = '匿名贡献者';

function publicContributorName(submission, profile) {
  if (!submission || submission.publicContributorConsent !== true ||
    submission.status !== 'approved' || submission.withdrawnAt ||
    submission.disabledAt || submission.sourceUnavailable === true) return ANONYMOUS;
  return String(profile && profile.nickname || '').trim().slice(0, 40) || ANONYMOUS;
}

async function contributorNameFor(db, submission, cache = new Map()) {
  if (!submission || submission.publicContributorConsent !== true || !submission.userId)
    return ANONYMOUS;
  const uid = submission.userId;
  if (!cache.has(uid)) {
    try {
      const result = await db.collection('user_profiles').doc(uid).get();
      const profile = Array.isArray(result && result.data) ? result.data[0] : result && result.data;
      cache.set(uid, profile || null);
    } catch (_) { cache.set(uid, null); }
  }
  return publicContributorName(submission, cache.get(uid));
}

module.exports = { ANONYMOUS, publicContributorName, contributorNameFor };
