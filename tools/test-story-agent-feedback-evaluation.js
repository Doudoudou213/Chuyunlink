'use strict';

const assert = require('node:assert/strict');
const { createStoryAgentEvaluationService, calculateMetrics, comparisonRows } = require('../cloudfunctions/adminSubmissions/domains/story-agent-evaluations');

function fakeDb(seed = {}) {
  const data = new Map(Object.entries(seed).map(([name, rows]) => [name, new Map(Object.entries(rows))]));
  const collection = name => {
    if (!data.has(name)) data.set(name, new Map());
    const rows = data.get(name);
    return {
      doc(key) { return {
        async get() { const value = rows.get(key); return { data: value ? [{ _id: key, ...value }] : [] }; },
        async set(value) { rows.set(key, structuredClone(value)); return {}; },
        async update(value) { rows.set(key, { ...(rows.get(key) || {}), ...structuredClone(value) }); return {}; }
      }; },
      where(filter) { return {
        limit() { return { async get() { return { data: [...rows].filter(([, value]) => Object.entries(filter).every(([key, expected]) => value[key] === expected)).map(([key, value]) => ({ _id: key, ...structuredClone(value) })) }; } }; }
      }; },
      limit() { return { async get() { return { data: [...rows].map(([key, value]) => ({ _id: key, ...structuredClone(value) })) }; } }; }
    };
  };
  return { data, collection, async createCollection(name) { if (!data.has(name)) data.set(name, new Map()); }, serverDate() { return 'SERVER_DATE'; } };
}

const consent = overrides => ({ status: 'approved', aiAnalysisConsent: true,
  aiConsentVersion: 'ai-analysis-consent-v1', aiConsentScope: 'approved_public_submission_text',
  aiAnalysisStatus: 'ready', ...overrides });

async function main() {
  const metricSamples = [
    { active: true, sourceValid: true, decision: 'approve', changedFields: [], candidateType: 'entity', model: 'm1', promptVersion: 'p1', codeVersion: 'c1' },
    { active: true, sourceValid: true, decision: 'approve', changedFields: ['why'], candidateType: 'relation', original: { relationType: 'documents' }, final: { relationType: 'documents' }, model: 'm1', promptVersion: 'p1', codeVersion: 'c1' },
    { active: true, sourceValid: true, decision: 'reject', changedFields: [], candidateType: 'relation', model: 'm2', promptVersion: 'p2', codeVersion: 'c2' },
    { active: false, sourceValid: false, decision: 'approve', changedFields: [], candidateType: 'entity', model: 'm2', promptVersion: 'p2', codeVersion: 'c2' }
  ];
  const metrics = calculateMetrics(metricSamples);
  assert.equal(metrics.directApprovalRate, 33.3);
  assert.equal(metrics.modificationRate, 33.3);
  assert.equal(metrics.rejectionRate, 33.3);
  assert.equal(metrics.sourceValidityRate, 75);
  assert.equal(metrics.relationTypeConsistencyRate, 100);
  assert.equal(comparisonRows(metricSamples).length, 2, '应按三个版本字段分组');

  const db = fakeDb({
    story_agent_reviews: { review_1: { candidateId: 'candidate_1', jobId: 'job_1', decision: 'approve',
      candidateType: 'relation', risk: 'medium', original: { relationType: 'documents', evidenceLinkIds: ['evidence_1'] },
      final: { relationType: 'documents' }, changedFields: [], reasonCategory: 'accepted_as_is', model: 'm1', promptVersion: 'p1', codeVersion: 'c1' } },
    story_agent_candidates: { candidate_1: { jobId: 'job_1', submissionId: 'submission_1', candidateType: 'relation', risk: 'medium' } },
    story_agent_jobs: { job_1: { submissionId: 'submission_1', status: 'completed', model: 'm1', promptVersion: 'p1', codeVersion: 'c1', input: { evidenceLinks: [{ id: 'evidence_1', resourceId: 'resource_1' }] } } },
    submissions: { submission_1: consent(), source_1: consent() },
    story_evidence_links: { evidence_1: { status: 'confirmed', needsSourceReview: false, resourceId: 'resource_1', submissionId: 'source_1' } }
  });
  const service = createStoryAgentEvaluationService({ db });
  const initial = await service.workspace();
  assert.equal(initial.selectedSet.version, 'feedback-v1');
  assert.equal(initial.samples.length, 0);

  const selected = await service.selectSample({ setId: initial.selectedSet.id, reviewId: 'review_1', split: 'fixed' }, 'admin_1');
  assert.equal(selected.sample.split, 'fixed');
  await service.rateSample({ evaluationId: selected.sample.id, rating: 'correct', ratingNote: '来源和关系均已核对' }, 'admin_1');
  const rated = await service.workspace({ setId: initial.selectedSet.id });
  assert.equal(rated.samples[0].humanRating, 'correct');
  assert.equal(rated.metrics.directApprovalRate, 100);
  assert.equal(rated.metrics.sourceValidityRate, 100);

  db.data.get('submissions').set('source_1', consent({ aiAnalysisConsent: false, aiAnalysisStatus: 'consent_revoked' }));
  const revoked = await service.workspace({ setId: initial.selectedSet.id });
  assert.equal(revoked.samples[0].active, false, '来源撤回后样本应自动停用');
  assert.equal(revoked.metrics.sourceValidityRate, 0);
  assert.equal(revoked.metrics.activeTotal, 0);

  const created = await service.createSet({ version: 'feedback-v2' }, 'admin_1');
  assert.equal(created.set.version, 'feedback-v2');
  console.log('Story agent feedback evaluation passed: metrics, manual set selection, rating, versioning and consent invalidation.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
