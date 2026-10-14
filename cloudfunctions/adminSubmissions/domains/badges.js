'use strict';
const E = require('../lib/badge-evidence');
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const cleanId = value => /^[\w-]{1,128}$/.test(String(value || '')) ? String(value) : '';
function createAdminBadgeService({ db, now = () => new Date().toISOString() }) {
  async function lookup(event) {
    if (!Object.hasOwn(E.TYPES, event.sourceType) || !cleanId(event.sourceId)) fail('BADGE_SOURCE_INVALID', '来源编号不正确');
    const resolved = await E.sourceFor(db, event.sourceType, String(event.sourceId || ''));
    const id = E.evidenceId(event.sourceType, event.sourceId);
    const evidence = await E.read(db, 'badge_evidence', id);
    if (!resolved && !evidence) fail('BADGE_SOURCE_INVALID', '请先完成原投稿、补充或纠错的正式审核');
    const source = resolved?.source || {};
    return { ok: true, title: source.title || source.submissionTitle || (resolved ? '已处理的故事纠错' : '原材料已失效，可撤销旧核验'),
      fileID: source.imageFileID || source.fileID || '',
      description: String(source.description || source.content || source.response || '').slice(0, 1200),
      resourceId: source.resourceId || resolved?.parent?.resourceId || '',
      evidence: evidence ? { revision: evidence.revision, status: evidence.status, category: evidence.category,
        resourceId: evidence.resourceId, placeId: evidence.placeId, patternDetails: evidence.patternDetails,
        inscriptionTranscript: evidence.inscriptionTranscript, oralAuthorization: evidence.oralAuthorization,
        onsite: evidence.onsite, artifactDetails: evidence.artifactDetails, citedCorrection: evidence.citedCorrection,
        issueKey: evidence.issueKey, note: evidence.note, stale: evidence.fingerprint !== resolved?.fingerprint } : null };
  }
  async function save(event, reviewerId) {
    if (!reviewerId) fail('FORBIDDEN', '需要管理员身份');
    if (!Object.hasOwn(E.TYPES, event.sourceType) || !cleanId(event.sourceId)) fail('BADGE_SOURCE_INVALID', '来源编号不正确');
    if (!['confirmed', 'revoked'].includes(event.status)) fail('BADGE_STATUS_INVALID', '请选择核验或撤销核验');
    const note = String(event.note || '').trim().slice(0, 1000);
    if (note.length < 10) fail('BADGE_NOTE_REQUIRED', '请填写至少十字的核验依据，不要录入私人证件或联系方式');
    return db.runTransaction(async tx => {
      const id = E.evidenceId(event.sourceType, event.sourceId);
      const previous = await E.read(tx, 'badge_evidence', id);
      if ((previous?.revision || 0) !== Number(event.revision)) fail('BADGE_REVISION_CONFLICT', '核验记录已更新，请重新读取');
      if (event.status === 'revoked') {
        if (!previous) fail('BADGE_SOURCE_INVALID', '还没有可以撤销的核验记录');
        const revision = previous.revision + 1;
        await tx.collection('badge_evidence').doc(id).set({ ...previous, status: 'revoked', revision, note, reviewerId, reviewedAt: now() });
        await tx.collection('badge_evidence_logs').doc(id + '_' + revision).set({ evidenceId: id, revision, action: 'revoked', note, reviewerId, at: now() });
        return { ok: true, revision };
      }
      const resolved = await E.sourceFor(tx, event.sourceType, event.sourceId);
      if (!resolved) fail('BADGE_SOURCE_INVALID', '原始资料的审核状态已变化');
      if (event.humanReviewed !== true || !E.CATEGORIES.includes(event.category)) fail('BADGE_REVIEW_REQUIRED', '请核对原始材料并选择内容类别');
      const resourceId = cleanId(event.resourceId), placeId = cleanId(event.placeId);
      for (const id of new Set([resourceId, placeId].filter(Boolean))) {
        const resource = await E.read(tx, 'resources', id);
        if (!resource || resource.status !== 'published') fail('BADGE_RESOURCE_INVALID', '对象或地点必须对应已发布的统一资源');
      }
      const submission = event.sourceType === 'submission';
      if (submission && (['architecture','music','artifact'].includes(event.category) || event.patternDetails || event.inscriptionTranscript) && !resourceId)
        fail('BADGE_RESOURCE_REQUIRED', '此类核验需要填写统一资源编号，用于对象去重');
      if (submission && event.onsite && !placeId) fail('BADGE_PLACE_REQUIRED', '实地采集需要统一地点编号');
      if (event.sourceType === 'feedback' && (!event.citedCorrection || !cleanId(event.issueKey))) fail('BADGE_CORRECTION_REQUIRED', '请确认出处已核实，并填写同一问题共用的纠错编号');
      const revision = (previous?.revision || 0) + 1;
      const record = { userId: resolved.source.userId, sourceType: event.sourceType, sourceId: event.sourceId,
        fingerprint: resolved.fingerprint, status: 'confirmed', revision, reviewerId, reviewedAt: now(),
        category: event.category, resourceId, placeId, note,
        patternDetails: submission && event.patternDetails === true,
        inscriptionTranscript: submission && event.inscriptionTranscript === true,
        oralAuthorization: submission && event.oralAuthorization === true,
        artifactDetails: submission && event.artifactDetails === true,
        onsite: submission && event.onsite === true,
        citedCorrection: event.sourceType === 'feedback' && event.citedCorrection === true,
        issueKey: event.sourceType === 'feedback' ? cleanId(event.issueKey) : '' };
      await tx.collection('badge_evidence').doc(id).set(record);
      await tx.collection('badge_evidence_logs').doc(id + '_' + revision).set({ ...record, evidenceId: id, action: 'confirmed' });
      return { ok: true, revision };
    });
  }
  return { lookup, save };
}
module.exports = { createAdminBadgeService };
