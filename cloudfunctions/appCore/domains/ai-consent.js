'use strict';

const crypto = require('crypto');
const text = (value, max = 128) => String(value == null ? '' : value).trim().slice(0, max);
const first = result => Array.isArray(result && result.data) ? result.data[0] : result && result.data;
const validId = value => { const id = text(value); if (!/^[\w-]+$/.test(id)) throw Object.assign(new Error('投稿编号无效'), { code: 'INVALID_SUBMISSION_ID' }); return id; };
const impactId = (submissionId, type, targetId) => `consent_${crypto.createHash('sha256').update(`${submissionId}:${type}:${targetId}`).digest('hex').slice(0, 32)}`;

function createAiConsentService({ db }) {
  let ready;
  async function ensure() {
    if (!ready) ready = Promise.all(['ai_consent_logs', 'story_source_impacts'].map(async name => {
      try { await db.createCollection(name); } catch (e) { if (!/exist/i.test(`${e.code} ${e.message}`)) throw e; }
    })).catch(e => { ready = null; throw e; });
    await ready;
  }
  async function query(collection, where, limit = 200) {
    try { return (await db.collection(collection).where(where).limit(limit).get()).data || []; }
    catch (e) {
      if (/DATABASE_COLLECTION_NOT_EXIST|collection.*not.*exist|ResourceNotFound/i.test(`${e.code} ${e.message}`)) return [];
      throw e;
    }
  }
  async function mark(collection, item, patch) {
    const id = item._id || item.id;
    if (id) await db.collection(collection).doc(id).update(patch);
  }
  async function withdraw(event, uid) {
    await ensure();
    const submissionId = validId(event.submissionId);
    const ref = db.collection('submissions').doc(submissionId);
    const current = first(await ref.get());
    if (!current || current.userId !== uid) throw Object.assign(new Error('只能管理自己的投稿授权'), { code: 'SUBMISSION_NOT_OWNED' });
    if (current.aiAnalysisConsent !== true && !current.aiConsentRevokedAt) {
      throw Object.assign(new Error('该投稿没有可撤回的 AI 分析授权'), { code: 'AI_CONSENT_NOT_GRANTED' });
    }
    const alreadyRevoked = current.aiAnalysisConsent !== true;
    if (!alreadyRevoked) {
      const now = db.serverDate();
      await ref.update({ aiAnalysisConsent: false, aiAnalysisStatus: 'consent_revoked', aiConsentRevokedAt: now, updatedAt: now });
      await db.collection('ai_consent_logs').doc(`ai_revoke_${submissionId}`).set({ submissionId, userId: uid, action: 'withdraw_ai_analysis', consentVersion: current.aiConsentVersion || '', createdAt: now });
    }

    const now = db.serverDate();
    const [links, candidates, agentJobs, aiJobs, analyses] = await Promise.all([
      query('story_evidence_links', { submissionId }), query('story_agent_candidates', { submissionId }),
      query('story_agent_jobs', { submissionId }), query('ai_jobs', { submissionId }), query('ai_analyses', { submissionId })
    ]);
    const evidenceIds = new Set(links.map(item => item._id || item.id).filter(Boolean));
    const impacted = [];
    for (const item of candidates) if (item.status === 'pending_review') await mark('story_agent_candidates', item, { status: 'consent_revoked', invalidatedAt: now });
    for (const item of candidates) if (item.formalEntityId) {
      const entities = await query('story_entities', { _id: item.formalEntityId }, 1);
      for (const entity of entities) {
        await mark('story_entities', entity, { needsSourceReview: true, sourceReviewReason: 'ai_consent_revoked', updatedAt: now });
        impacted.push(['entity', item.formalEntityId]);
      }
    }
    for (const item of agentJobs) if (!['consent_revoked', 'failed'].includes(item.status)) await mark('story_agent_jobs', item, { status: 'consent_revoked', lockedAt: null, updatedAt: now });
    for (const item of aiJobs) if (!['consent_revoked', 'failed'].includes(item.status)) await mark('ai_jobs', item, { status: 'consent_revoked', lockedAt: null, updatedAt: now });
    for (const item of analyses) await mark('ai_analyses', item, { sourceConsentStatus: 'revoked', updatedAt: now });

    const resourceIds = [...new Set(links.map(item => item.resourceId).filter(Boolean))];
    for (const resourceId of resourceIds) {
      const [relations, stories, tasks] = await Promise.all([
        query('story_relations', { resourceId }), query('story_chains', { resourceId }), query('story_gap_tasks', { resourceId })
      ]);
      for (const item of relations) {
        if (item.status !== 'confirmed' || !(item.evidenceLinkIds || []).some(id => evidenceIds.has(id))) continue;
        await mark('story_relations', item, { needsSourceReview: true, sourceReviewReason: 'ai_consent_revoked', updatedAt: now });
        impacted.push(['relation', item._id || item.id]);
      }
      for (const item of stories) {
        if (!['published', 'draft'].includes(item.status) || !(item.sourceLinkIds || []).some(id => evidenceIds.has(id))) continue;
        await mark('story_chains', item, { needsSourceReview: true, sourceReviewReason: 'ai_consent_revoked', updatedAt: now });
        impacted.push(['story', item._id || item.id]);
      }
      for (const item of tasks) {
        const direct = item.sourceSubmissionId === submissionId || item.sourceAgentCandidateId && candidates.some(c => (c._id || c.id) === item.sourceAgentCandidateId);
        if (!direct || !['draft', 'published'].includes(item.status)) continue;
        await mark('story_gap_tasks', item, { status: 'paused_source_review', sourceReviewReason: 'ai_consent_revoked', updatedAt: now });
        impacted.push(['gap_task', item._id || item.id]);
      }
    }
    const uniqueImpacts = [...new Map(impacted.map(item => [`${item[0]}:${item[1]}`, item])).values()];
    for (const [type, targetId] of uniqueImpacts) {
      const ref = db.collection('story_source_impacts').doc(impactId(submissionId, type, targetId));
      const existing = first(await ref.get());
      await ref.set({ submissionId, resourceIds, targetType: type, targetId, reason: 'ai_consent_revoked', status: 'pending_review', createdAt: existing && existing.createdAt || now, updatedAt: now });
    }
    return { ok: true, action: 'withdrawAiAnalysisConsent', submissionId, cached: alreadyRevoked,
      impactCounts: { candidates: candidates.filter(i => i.status === 'pending_review').length, entities: uniqueImpacts.filter(i => i[0] === 'entity').length, relations: uniqueImpacts.filter(i => i[0] === 'relation').length, stories: uniqueImpacts.filter(i => i[0] === 'story').length, gapTasks: uniqueImpacts.filter(i => i[0] === 'gap_task').length } };
  }
  return { withdraw };
}
module.exports = { createAiConsentService, impactId };
