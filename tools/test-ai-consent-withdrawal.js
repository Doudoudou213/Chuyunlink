'use strict';

const assert = require('node:assert/strict');
const { fakeDb } = require('./test-story-agent-reviews');
const { createAiConsentService } = require('../cloudfunctions/appCore/domains/ai-consent');
const { loadPublicStoryGraph } = require('../cloudfunctions/appCore/domains/story-graph');

function fixture() {
  return {
    submissions: {
      s1: { userId: 'user-1', aiAnalysisConsent: true, aiAnalysisStatus: 'ready', status: 'approved' },
      s2: { userId: 'user-1', aiAnalysisConsent: false, aiAnalysisStatus: 'not_requested', status: 'approved' }
    },
    story_evidence_links: {
      ev1: { submissionId: 's1', resourceId: 'r1', status: 'confirmed' },
      ev2: { submissionId: 'other', resourceId: 'r1', status: 'confirmed' }
    },
    story_agent_candidates: {
      entityCandidate: { submissionId: 's1', status: 'approved', formalEntityId: 'entity1' },
      pendingRelation: { submissionId: 's1', status: 'pending_review' }
    },
    story_agent_jobs: { agent1: { submissionId: 's1', status: 'awaiting_review' } },
    ai_jobs: { ai1: { submissionId: 's1', status: 'queued' } },
    ai_analyses: { analysis1: { submissionId: 's1', status: 'completed' } },
    story_entities: {
      entity1: { resourceId: 'r1', status: 'confirmed', name: '凤鸟纹', entityType: 'detail_or_motif' },
      entity2: { resourceId: 'r1', status: 'confirmed', name: '木雕花窗', entityType: 'heritage_object' }
    },
    story_relations: {
      relation1: { resourceId: 'r1', status: 'confirmed', fromEntityId: 'entity1', toEntityId: 'entity2', relationType: 'depicts', reason: '花窗上的纹样描绘凤鸟', evidenceLinkIds: ['ev1'] },
      relation2: { resourceId: 'r1', status: 'confirmed', fromEntityId: 'entity2', toEntityId: 'entity1', relationType: 'documents', reason: '另一来源记录了花窗', evidenceLinkIds: ['ev2'] }
    },
    story_chains: {
      story1: { resourceId: 'r1', status: 'published', title: '花窗故事', sourceLinkIds: ['ev1'] },
      story2: { resourceId: 'r1', status: 'published', title: '其他故事', sourceLinkIds: ['ev2'] }
    },
    story_gap_tasks: {
      task1: { resourceId: 'r1', status: 'published', sourceSubmissionId: 's1' },
      task2: { resourceId: 'r1', status: 'published', sourceSubmissionId: 'other' }
    }
  };
}

async function main() {
  const notGrantedDb = fakeDb(fixture());
  await assert.rejects(
    createAiConsentService({ db: notGrantedDb }).withdraw({ submissionId: 's2' }, 'user-1'),
    (error) => error.code === 'AI_CONSENT_NOT_GRANTED'
  );
  await assert.rejects(
    createAiConsentService({ db: fakeDb(fixture()) }).withdraw({ submissionId: 's1' }, 'user-2'),
    (error) => error.code === 'SUBMISSION_NOT_OWNED'
  );

  const db = fakeDb(fixture());
  const service = createAiConsentService({ db });
  const result = await service.withdraw({ submissionId: 's1' }, 'user-1');
  const state = db.data();
  assert.equal(result.cached, false);
  assert.deepEqual(result.impactCounts, { candidates: 1, entities: 1, relations: 1, stories: 1, gapTasks: 1 });
  assert.equal(state.submissions.s1.aiAnalysisConsent, false);
  assert.equal(state.submissions.s1.aiAnalysisStatus, 'consent_revoked');
  assert.equal(state.story_agent_candidates.pendingRelation.status, 'consent_revoked');
  assert.equal(state.story_agent_jobs.agent1.status, 'consent_revoked');
  assert.equal(state.ai_jobs.ai1.status, 'consent_revoked');
  assert.equal(state.ai_analyses.analysis1.sourceConsentStatus, 'revoked');
  assert.equal(state.story_entities.entity1.needsSourceReview, true);
  assert.equal(state.story_relations.relation1.needsSourceReview, true);
  assert.equal(state.story_relations.relation2.needsSourceReview, undefined);
  assert.equal(state.story_chains.story1.needsSourceReview, true);
  assert.equal(state.story_chains.story2.needsSourceReview, undefined);
  assert.equal(state.story_gap_tasks.task1.status, 'paused_source_review');
  assert.equal(state.story_gap_tasks.task2.status, 'published');
  assert.equal(Object.keys(state.ai_consent_logs).length, 1);
  assert.equal(Object.keys(state.story_source_impacts).length, 4);

  const graph = await loadPublicStoryGraph(db, 'r1');
  assert.equal(graph.ready, false, '待来源复核的实体和关系不得继续公开展示');
  const repeated = await service.withdraw({ submissionId: 's1' }, 'user-1');
  assert.equal(repeated.cached, true, '重复撤回必须保持幂等');
  assert.equal(Object.keys(db.data().ai_consent_logs).length, 1);
  console.log('AI consent withdrawal: ownership, propagation, public hiding and idempotency passed.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
