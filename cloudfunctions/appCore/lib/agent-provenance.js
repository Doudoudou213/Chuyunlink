'use strict';

const { materialLinkValid } = require('./material-evidence');
const first = result => Array.isArray(result?.data) ? result.data[0] || null : result?.data || null;
const missingCollection = error => /collection.*not.*exist|DATABASE_COLLECTION_NOT_EXIST|ResourceNotFound/i
  .test(`${error?.code || ''} ${error?.message || ''}`);

// Formal records predate inline provenance. Inverse candidate references also
// cover aliases merged into manually created entities, without hiding unrelated data.
function createAgentProvenanceValidator(db) {
  const reads = new Map();
  const checks = new Map();
  const read = (collection, id) => {
    if (!id) return Promise.resolve(null);
    const key = `${collection}:${id}`;
    if (!reads.has(key)) reads.set(key, db.collection(collection).doc(id).get().then(first));
    return reads.get(key);
  };
  const available = item => Boolean(item && item.status === 'approved' && !item.withdrawnAt &&
    !item.disabledAt && !item.sourceUnavailable && !item.aiConsentRevokedAt && item.aiAnalysisStatus !== 'consent_revoked');

  async function validCandidate(candidate) {
    if (!candidate || candidate.status !== 'approved' || candidate.needsSourceReview ||
        !available(await read('submissions', candidate.submissionId))) return false;
    if (!candidate.jobId) return true;
    const job = await read('story_agent_jobs', candidate.jobId);
    if (!job || job.needsSourceReview || ['source_invalid', 'consent_revoked'].includes(job.status)) return false;
    for (const source of job.input?.evidenceLinks || []) {
      const link = await read('story_evidence_links', source.id);
      const origin = link && await read('submissions', link.submissionId);
      if (!link || link.status !== 'confirmed' || link.needsSourceReview ||
          link.resourceId !== source.resourceId || !available(origin) ||
          !await materialLinkValid(db, link, origin)) return false;
    }
    return true;
  }

  async function inspect(item, field) {
    for (const sourceId of [item.originSubmissionId, item.sourceSubmissionId].filter(Boolean)) {
      if (!available(await read('submissions', sourceId))) return false;
    }
    if (item.sourceAgentCandidateId) {
      const candidate = await read('story_agent_candidates', item.sourceAgentCandidateId);
      if (!candidate || !await validCandidate(candidate)) return false;
    }
    for (let offset = 0; ; offset += 100) {
      let candidates;
      try {
        candidates = (await db.collection('story_agent_candidates').where({ [field]: item._id || item.id })
          .orderBy('_id', 'asc').skip(offset).limit(100).get()).data || [];
      } catch (error) {
        if (missingCollection(error)) return true;
        throw error;
      }
      for (const candidate of candidates) if (!await validCandidate(candidate)) return false;
      if (candidates.length < 100) return true;
    }
  }

  const validate = (item, field) => {
    const key = `${field}:${item._id || item.id}`;
    if (!checks.has(key)) checks.set(key, inspect(item, field));
    return checks.get(key);
  };
  validate.candidate = validCandidate;
  return validate;
}

module.exports = { createAgentProvenanceValidator };
