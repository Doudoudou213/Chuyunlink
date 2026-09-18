'use strict';

const crypto = require('crypto');
const { publicTask } = require('./story-gap-tasks');
const text = (value, limit) => String(value == null ? '' : value).trim().slice(0, limit);
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const id = value => { const key = text(value, 128); if (!/^[\w-]+$/.test(key)) fail('INVALID_ID', '请选择有效记录'); return key; };
const first = result => Array.isArray(result && result.data) ? result.data[0] : result && result.data;
const taskIdFor = key => 'agent_gap_' + crypto.createHash('sha256').update(key).digest('hex').slice(0, 32);

// Reuses ordinary gap tasks: drafts are private, published tasks use the existing adoption/reward flow.
function createStoryAgentGapService({ db }) {
  async function save(event, reviewerId, publish = false) {
    const key = id(event.candidateId);
    id(reviewerId);
    return db.runTransaction(async tx => {
      const get = async (collection, key) => first(await tx.collection(collection).doc(id(key)).get());
      const candidate = await get('story_agent_candidates', key);
      if (!candidate || candidate.candidateType !== 'gap') fail('GAP_CANDIDATE_REQUIRED', '请选择待补资料建议');
      const taskId = taskIdFor(key);
      const previous = await get('story_gap_tasks', taskId);
      if (publish && previous && previous.status === 'published') return { ok: true, cached: true, task: publicTask({ ...previous, _id: taskId }) };
      if (candidate.status !== 'pending_review' || (previous && previous.status !== 'draft')) fail('GAP_ALREADY_PROCESSED', '建议或任务已处理，请刷新');
      const job = await get('story_agent_jobs', candidate.jobId);
      const submission = await get('submissions', candidate.submissionId);
      if (!job || !['awaiting_review', 'completed'].includes(job.status)) fail('JOB_NOT_READY', '分析尚未完成');
      if (!submission || submission.status !== 'approved' || submission.aiAnalysisConsent !== true
        || submission.aiConsentVersion !== 'ai-analysis-consent-v1'
        || submission.aiConsentScope !== 'approved_public_submission_text'
        || submission.aiConsentRevokedAt || submission.aiAnalysisStatus === 'consent_revoked') {
        fail('CONSENT_CHANGED', '投稿审核状态或授权已变化');
      }
      for (const source of job.input && job.input.evidenceLinks || []) {
        const link = await get('story_evidence_links', source.id);
        const origin = link && link.submissionId ? await get('submissions', link.submissionId) : null;
        if (!link || link.status !== 'confirmed' || link.needsSourceReview === true
          || link.resourceId !== source.resourceId || !origin || origin.status !== 'approved'
          || origin.aiAnalysisConsent !== true || origin.aiConsentVersion !== 'ai-analysis-consent-v1'
          || origin.aiConsentScope !== 'approved_public_submission_text'
          || origin.aiConsentRevokedAt || origin.aiAnalysisStatus === 'consent_revoked') {
          fail('SOURCE_UNAVAILABLE', '任务引用的来源已失效，不能发布征集');
        }
      }
      const resourceId = id(submission.resourceId || submission.boundResourceId || job.input && job.input.submission && job.input.submission.boundResourceId);
      const resource = await get('resources', resourceId);
      if (!resource || resource.status !== 'published') fail('RESOURCE_UNAVAILABLE', '资源已下架或不存在');
      const storyId = id(event.storyId);
      const story = await get('story_chains', storyId);
      if (!story || story.status !== 'published' || story.resourceId !== resourceId) fail('GAP_STORY_MISMATCH', '请选择该资源当前已发布的故事');
      const chapterIndex = event.chapterIndex === '' || event.chapterIndex == null ? null : Number(event.chapterIndex);
      if (chapterIndex !== null && (!Number.isInteger(chapterIndex) || chapterIndex < 0 || chapterIndex >= (story.chapters || []).length)) fail('INVALID_CHAPTER_INDEX', '对应章节已变化，请重新选择');
      const title = text(event.title, 48), description = text(event.description, 360);
      const requestedAssetType = text(event.requestedAssetType || 'any', 20);
      if (title.length < 4 || description.length < 10) fail('INVALID_GAP_TASK_TEXT', '请填写至少四个字的标题和十个字的资料要求');
      if (!['any', 'image', 'audio', 'video'].includes(requestedAssetType)) fail('INVALID_GAP_TASK_ASSET_TYPE', '资料类型不受支持');
      const rewardPoints = event.rewardPoints === '' || event.rewardPoints == null ? 0 : Number(event.rewardPoints);
      if (!Number.isInteger(rewardPoints) || rewardPoints < 0 || rewardPoints > 500) fail('INVALID_REWARD_POINTS', '额外积分须为 0 至 500 的整数');
      if (publish && (!previous || Number(event.draftVersion) !== previous.draftVersion)) fail('DRAFT_CHANGED', '请先保存草稿，刷新后再确认发布');
      const content = { storyId, storyVersion: Math.max(1, Number(story.version) || 1), resourceId, chapterIndex, title, description, requestedAssetType, rewardPoints };
      if (publish && Object.keys(content).some(k => content[k] !== previous[k])) fail('DRAFT_CHANGED', '内容或故事版本已变化，请重新保存草稿再发布');
      const record = { ...content, storyTitle: text(story.title, 100), status: publish ? 'published' : 'draft',
        sourceAgentCandidateId: key, sourceAgentJobId: candidate.jobId, sourceSubmissionId: candidate.submissionId,
        rewardRule: 'manual_after_approved_and_adopted', draftVersion: (previous && previous.draftVersion || 0) + (publish ? 0 : 1),
        createdBy: previous && previous.createdBy || reviewerId, createdAt: previous && previous.createdAt || db.serverDate(),
        updatedBy: reviewerId, updatedAt: db.serverDate(), publishedAt: publish ? db.serverDate() : null,
        fulfilledAt: null, fulfilledBySubmissionId: '' };
      await tx.collection('story_gap_tasks').doc(taskId).set(record);
      await tx.collection('story_gap_task_logs').doc(`${taskId}_${publish ? 'published' : 'draft_' + record.draftVersion}`).set({ taskId, action: publish ? 'published' : 'draft_saved', candidateId: key, reviewerId, createdAt: db.serverDate() });
      if (publish) {
        await tx.collection('story_agent_candidates').doc(key).update({ status: 'approved', gapTaskId: taskId, reviewedAt: db.serverDate() });
        await tx.collection('story_agent_reviews').doc(key).set({ candidateId: key, jobId: candidate.jobId, decision: 'publish_gap_task', original: candidate.payload,
          final: content, taskId, reviewerId, model: job.model || '', promptVersion: job.promptVersion || '', createdAt: db.serverDate() });
      }
      return { ok: true, task: { ...publicTask({ ...record, _id: taskId }), draftVersion: record.draftVersion } };
    });
  }
  return { save };
}
module.exports = { createStoryAgentGapService, taskIdFor };
