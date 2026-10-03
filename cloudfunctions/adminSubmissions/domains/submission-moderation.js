'use strict';

const text = (value, max = 128) => String(value == null ? '' : value).trim().slice(0, max);
const first = result => Array.isArray(result && result.data) ? result.data[0] : result && result.data;
const key = item => item._id || item.id;
const values = value => Array.isArray(value) ? value : [];
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };

// Scan all pages: a source can have dependants older than the first admin page.
async function rows(db, collection, filter = {}) {
  const result = [];
  for (let offset = 0; ; offset += 100) {
    let page;
    try {
      page = (await db.collection(collection).where(filter).orderBy('_id', 'asc').skip(offset).limit(100).get()).data || [];
    } catch (error) {
      if (/DATABASE_COLLECTION_NOT_EXIST|collection.*not.*exist|ResourceNotFound/i.test(`${error.code} ${error.message}`)) return result;
      throw error;
    }
    result.push(...page);
    if (page.length < 100) return result;
  }
}

async function propagateWithdrawal(db, submissionId) {
  const links = await rows(db, 'story_evidence_links', { submissionId });
  const linkIds = new Set(links.map(key));
  const patch = { needsSourceReview: true, sourceReviewReason: 'submission_withdrawn', updatedAt: db.serverDate() };
  const counts = {};
  async function mark(collection, item, extra = {}) {
    await db.collection(collection).doc(key(item)).update({ ...patch, ...extra });
    counts[collection] = (counts[collection] || 0) + 1;
  }
  const hasLinks = ids => values(ids).some(id => linkIds.has(id));
  for (const link of links) await mark('story_evidence_links', link);

  const affectedJobs = new Set();
  for (const collection of ['story_agent_jobs', 'ai_jobs', 'material_analysis_jobs']) {
    for (const job of await rows(db, collection)) {
      const input = job.input || {};
      const sourceAffected = source => source && (linkIds.has(source.id) || linkIds.has(source.linkId)
        || source.submissionId === submissionId || source.sourceSubmissionId === submissionId);
      if (job.submissionId !== submissionId && job.sourceSubmissionId !== submissionId
        && input.sourceSubmissionId !== submissionId
        && !values(input.evidenceLinks).some(sourceAffected)
        && !values(input.sources).some(sourceAffected)) continue;
      affectedJobs.add(key(job));
      const active = ['queued', 'pending', 'processing', 'running', 'awaiting_review', 'pending_review'].includes(job.status);
      await mark(collection, job, active ? { status: 'source_invalid', lockedAt: null } : {});
    }
  }
  const affectedCandidates = new Set();
  for (const collection of ['story_agent_candidates', 'ai_link_candidates']) {
    for (const candidate of await rows(db, collection)) {
      if (candidate.submissionId !== submissionId && !affectedJobs.has(candidate.jobId)
        && !hasLinks(candidate.payload && candidate.payload.evidenceLinkIds)) continue;
      affectedCandidates.add(key(candidate));
      const pending = ['pending_review', 'pending_admin'].includes(candidate.status);
      await mark(collection, candidate, pending ? { status: 'source_invalid' } : {});
      if (candidate.formalEntityId) {
        const entity = first(await db.collection('story_entities').doc(candidate.formalEntityId).get());
        if (entity) await mark('story_entities', entity);
      }
      if (candidate.formalRelationId) {
        const relation = first(await db.collection('story_relations').doc(candidate.formalRelationId).get());
        if (relation) await mark('story_relations', relation);
      }
    }
  }
  const affectedStories = new Set();
  for (const collection of ['story_relations', 'story_chains', 'story_claims']) {
    for (const item of await rows(db, collection)) {
      if (!hasLinks(item.evidenceLinkIds) && !hasLinks(item.sourceLinkIds)
        && !values(item.chapters).some(chapter => hasLinks(chapter.sourceLinkIds))) continue;
      await mark(collection, item);
      if (collection === 'story_chains') affectedStories.add(key(item));
    }
  }
  for (const theme of await rows(db, 'story_themes')) {
    const version = theme.publishedVersionId
      ? first(await db.collection('story_theme_versions').doc(theme.publishedVersionId).get()) : null;
    const affected = [theme, version].filter(Boolean).some(item => values(item.sources)
      .some(source => source.submissionId === submissionId || linkIds.has(source.id)));
    if (affected) await mark('story_themes', theme);
  }
  for (const collection of ['guide_fragments', 'guide_fragment_versions']) {
    for (const item of await rows(db, collection)) {
      if (affectedStories.has(item.storyId) || hasLinks(item.sourceLinkIds)) await mark(collection, item);
    }
  }
  for (const task of await rows(db, 'story_gap_tasks')) {
    if (task.sourceSubmissionId !== submissionId && !affectedCandidates.has(task.sourceAgentCandidateId)
      && !affectedStories.has(task.storyId)) continue;
    await mark('story_gap_tasks', task, ['draft', 'published'].includes(task.status) ? { status: 'paused_source_review' } : {});
  }
  return counts;
}

function createSubmissionModerationService({ db }) {
  async function withdraw(event, reviewerId) {
    const submissionId = text(event.submissionId);
    if (!/^[\w-]+$/.test(submissionId)) fail('INVALID_SUBMISSION_ID', '投稿编号无效');
    const reviewNote = text(event.reviewNote, 500);
    if (!reviewNote) fail('REVIEW_NOTE_REQUIRED', '下架投稿时必须填写处理说明');
    const result = await db.runTransaction(async transaction => {
      const ref = transaction.collection('submissions').doc(submissionId);
      const current = first(await ref.get());
      if (!current) fail('SUBMISSION_NOT_FOUND', '没有找到这条投稿');
      if (current.status === 'withdrawn') return { cached: true, cascadeComplete: current.sourceReviewPending === false };
      if (current.status !== 'approved') fail('STATUS_CONFLICT', '只有已通过投稿可以下架，请刷新列表');
      const now = db.serverDate();
      await ref.update({ status: 'withdrawn', withdrawnAt: now, withdrawnBy: reviewerId,
        withdrawalNote: reviewNote, sourceReviewPending: true, updatedAt: now });
      // Separate action: never re-enter approval, change consent, or alter awarded points.
      await transaction.collection('moderation_logs').doc(`withdraw_submission_${submissionId}`).set({
        action: 'withdraw_submission', submissionId, fromStatus: 'approved', toStatus: 'withdrawn',
        reviewNote, reviewerId, submitterId: current.userId || '', rewardPoints: 0, createdAt: now
      });
      return { cached: false };
    });
    // Public readers validate the source status immediately. Retrying this action repairs
    // a partial cascade without reopening content, duplicating audit, or touching rewards.
    let impactCounts = {};
    let sourceReviewPending = false;
    try {
      if (!result.cascadeComplete) {
        impactCounts = await propagateWithdrawal(db, submissionId);
        await db.collection('submissions').doc(submissionId).update({ sourceReviewPending: false });
      }
    } catch (_) {
      sourceReviewPending = true;
    }
    return { ok: true, action: 'withdrawSubmission', submissionId, status: 'withdrawn',
      cached: result.cached, sourceReviewPending, impactCounts };
  }
  return { withdraw };
}

module.exports = { createSubmissionModerationService, propagateWithdrawal };
