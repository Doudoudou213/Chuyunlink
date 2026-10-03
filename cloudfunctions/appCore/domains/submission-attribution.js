'use strict';

const first = result => Array.isArray(result && result.data) ? result.data[0] || null : result && result.data || null;

function createSubmissionAttributionService({ db }) {
  async function change(event, uid) {
    const submissionId = String(event.submissionId || '');
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(submissionId))
      throw Object.assign(new Error('投稿编号无效'), { code: 'INVALID_SUBMISSION_ID' });
    if (typeof event.showNickname !== 'boolean')
      throw Object.assign(new Error('请选择是否公开昵称'), { code: 'INVALID_ATTRIBUTION_CHOICE' });
    try { await db.createCollection('submission_attribution_logs'); }
    catch (error) { if (!/exist/i.test(String(error.message) + String(error.code))) throw error; }
    return db.runTransaction(async transaction => {
      const ref = transaction.collection('submissions').doc(submissionId);
      const submission = first(await ref.get());
      if (!submission || submission.userId !== uid)
        throw Object.assign(new Error('只能设置自己的投稿署名'), { code: 'SUBMISSION_NOT_OWNED' });
      if (submission.status !== 'approved')
        throw Object.assign(new Error('审核通过后才可设置公开署名'), { code: 'SUBMISSION_NOT_APPROVED' });
      const previous = submission.publicContributorConsent === true;
      if (previous === event.showNickname)
        return { ok: true, action: 'setSubmissionAttribution', submissionId,
          showNickname: previous, cached: true };
      const revision = Math.max(0, Number(submission.publicContributorConsentRevision) || 0) + 1;
      const now = db.serverDate();
      await ref.update({ publicContributorConsent: event.showNickname,
        publicContributorConsentRevision: revision, publicContributorConsentUpdatedAt: now,
        updatedAt: now });
      await transaction.collection('submission_attribution_logs').doc(`${submissionId}_${revision}`).set({
        submissionId, userId: uid, revision,
        action: event.showNickname ? 'show_nickname' : 'hide_nickname', createdAt: now
      });
      return { ok: true, action: 'setSubmissionAttribution', submissionId,
        showNickname: event.showNickname, revision };
    });
  }
  return { change };
}

module.exports = { createSubmissionAttributionService };
