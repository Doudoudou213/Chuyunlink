'use strict';

const crypto = require('crypto');

const TASK_COLLECTION = 'story_gap_tasks';
const TASK_LOG_COLLECTION = 'story_gap_task_logs';
const STORY_COLLECTION = 'story_chains';
const SUBMISSION_COLLECTION = 'submissions';
const PROFILE_COLLECTION = 'user_profiles';
const POINT_LEDGER_COLLECTION = 'point_ledger';
const NOTIFICATION_COLLECTION = 'interaction_notifications';
const CONTRIBUTION_COLLECTION = 'story_contributions';
const ALLOWED_ASSET_TYPES = new Set(['image', 'audio', 'video', 'any']);

function cleanText(value, maxLength) {
  return String(value == null ? '' : value).trim().slice(0, maxLength);
}

function cleanId(value, label) {
  const id = cleanText(value, 128);
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    throw Object.assign(new Error(`${label} ID 格式不正确`), { code: 'INVALID_ID' });
  }
  return id;
}

function contributionIdFor(taskId, submissionId) {
  const digest = crypto.createHash('sha256').update(`${taskId}:${submissionId}`).digest('hex').slice(0, 32);
  return `gap_${digest}`;
}

function firstDocument(result) {
  if (!result) return null;
  if (Array.isArray(result.data)) return result.data[0] || null;
  return result.data || null;
}

function timeValue(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  return typeof value === 'string' ? value : null;
}

function publicTask(item) {
  return {
    id: item._id || item.id || '',
    storyId: item.storyId || '',
    storyVersion: Number(item.storyVersion) || 1,
    resourceId: item.resourceId || '',
    chapterIndex: Number.isInteger(Number(item.chapterIndex)) ? Number(item.chapterIndex) : null,
    title: item.title || '',
    description: item.description || '',
    requestedAssetType: item.requestedAssetType || 'any',
    rewardPoints: Math.max(0, Number(item.rewardPoints) || 0),
    status: item.status || 'draft',
    createdAt: timeValue(item.createdAt),
    publishedAt: timeValue(item.publishedAt),
    fulfilledAt: timeValue(item.fulfilledAt),
    fulfilledBySubmissionId: item.fulfilledBySubmissionId || '',
    rewardStatus: item.rewardStatus || (Number(item.rewardPoints) > 0 ? 'not_started' : 'not_applicable'),
    rewardAwardedAt: timeValue(item.rewardAwardedAt)
  };
}

function createStoryGapTaskService({ db }) {
  async function workspace() {
    const [storiesResult, tasksResult] = await Promise.all([
      db.collection(STORY_COLLECTION).limit(100).get(),
      db.collection(TASK_COLLECTION).limit(200).get()
    ]);
    const stories = (storiesResult.data || []).filter((item) => item.status === 'published');
    const storyIds = new Set(stories.map((item) => item._id || item.id));
    const tasks = (tasksResult.data || []).filter((item) => storyIds.has(item.storyId)).map(publicTask);
    return { ok: true, action: 'getStoryGapTaskWorkspace', tasks, count: tasks.length };
  }

  async function publish(event, reviewerId) {
    const storyId = cleanId(event.storyId, '故事');
    const title = cleanText(event.title, 48);
    const description = cleanText(event.description, 360);
    const requestedAssetType = cleanText(event.requestedAssetType || 'any', 20);
    const rewardPoints = Math.max(0, Math.min(500, Math.round(Number(event.rewardPoints) || 0)));
    const chapterIndex = event.chapterIndex === '' || event.chapterIndex == null ? null : Number(event.chapterIndex);
    if (title.length < 4 || description.length < 10) {
      throw Object.assign(new Error('任务标题或资料要求写得太短'), { code: 'INVALID_GAP_TASK_TEXT' });
    }
    if (!ALLOWED_ASSET_TYPES.has(requestedAssetType)) {
      throw Object.assign(new Error('资料类型不受支持'), { code: 'INVALID_GAP_TASK_ASSET_TYPE' });
    }
    const story = firstDocument(await db.collection(STORY_COLLECTION).doc(storyId).get());
    if (!story || story.status !== 'published') {
      throw Object.assign(new Error('只能为当前已发布故事创建征集任务'), { code: 'STORY_NOT_PUBLISHED' });
    }
    const chapters = Array.isArray(story.chapters) ? story.chapters : [];
    if (chapterIndex != null && (!Number.isInteger(chapterIndex) || chapterIndex < 0 || chapterIndex >= chapters.length)) {
      throw Object.assign(new Error('任务对应章节不正确'), { code: 'INVALID_CHAPTER_INDEX' });
    }
    const record = {
      storyId,
      storyTitle: cleanText(story.title, 100),
      storyVersion: Math.max(1, Number(story.version) || 1),
      resourceId: cleanId(story.resourceId, '资源'),
      chapterIndex,
      title,
      description,
      requestedAssetType,
      rewardPoints,
      rewardRule: 'manual_after_approved_and_adopted',
      status: 'published',
      createdBy: reviewerId,
      createdAt: db.serverDate(),
      updatedAt: db.serverDate(),
      publishedAt: db.serverDate(),
      fulfilledAt: null,
      fulfilledBySubmissionId: ''
    };
    const added = await db.collection(TASK_COLLECTION).add(record);
    const taskId = added.id || added._id || '';
    await db.collection(TASK_LOG_COLLECTION).add({ taskId, action: 'published', reviewerId, createdAt: db.serverDate() });
    return { ok: true, action: 'publishStoryGapTask', task: publicTask({ ...record, _id: taskId }) };
  }

  async function archive(event, reviewerId) {
    const taskId = cleanId(event.taskId, '征集任务');
    const task = firstDocument(await db.collection(TASK_COLLECTION).doc(taskId).get());
    if (!task || task.status !== 'published') {
      throw Object.assign(new Error('任务不存在或已停止征集'), { code: 'GAP_TASK_NOT_ACTIVE' });
    }
    await db.collection(TASK_COLLECTION).doc(taskId).update({ status: 'archived', updatedAt: db.serverDate(), archivedAt: db.serverDate() });
    await db.collection(TASK_LOG_COLLECTION).add({ taskId, action: 'archived', reviewerId, createdAt: db.serverDate() });
    return { ok: true, action: 'archiveStoryGapTask', taskId };
  }

  async function fulfill(event, reviewerId) {
    const taskId = cleanId(event.taskId, '征集任务');
    const submissionId = cleanId(event.submissionId, '投稿');
    const contributionId = contributionIdFor(taskId, submissionId);
    const recordSuffix = contributionId.slice(4);
    return db.runTransaction(async (transaction) => {
      const taskRef = transaction.collection(TASK_COLLECTION).doc(taskId);
      const submissionRef = transaction.collection(SUBMISSION_COLLECTION).doc(submissionId);
      const task = firstDocument(await taskRef.get());
      const submission = firstDocument(await submissionRef.get());
      if (task && task.status === 'fulfilled' && task.fulfilledBySubmissionId === submissionId) {
        return { ok: true, action: 'fulfillStoryGapTask', taskId, submissionId, contributionId, rewardStatus: task.rewardStatus || 'pending_manual_confirmation', cached: true };
      }
      if (!task || task.status !== 'published') throw Object.assign(new Error('任务不存在或已停止征集'), { code: 'GAP_TASK_NOT_ACTIVE' });
      if (!submission || submission.status !== 'approved' || submission.gapTaskId !== taskId) {
        throw Object.assign(new Error('只能使用已审核通过且属于本任务的投稿完成征集'), { code: 'INVALID_GAP_TASK_SUBMISSION' });
      }
      const rewardStatus = Number(task.rewardPoints) > 0 ? 'pending_manual_confirmation' : 'not_applicable';
      const adoptedAt = db.serverDate();
      await taskRef.update({ status: 'fulfilled', fulfilledBySubmissionId: submissionId, fulfilledAt: adoptedAt, updatedAt: adoptedAt, rewardStatus });
      await transaction.collection(CONTRIBUTION_COLLECTION).doc(contributionId).set({
        id: contributionId,
        type: 'gap_task_adoption',
        status: 'adopted',
        userId: submission.userId || '',
        contributorName: submission.contributorName || '楚韵守护者',
        submissionId,
        taskId,
        taskTitle: task.title || '',
        storyId: task.storyId || '',
        storyTitle: task.storyTitle || '',
        storyVersion: Math.max(1, Number(task.storyVersion) || 1),
        resourceId: task.resourceId || '',
        chapterIndex: Number.isInteger(Number(task.chapterIndex)) ? Number(task.chapterIndex) : null,
        rewardPointsProposed: Math.max(0, Number(task.rewardPoints) || 0),
        rewardPointsAwarded: 0,
        rewardStatus,
        adoptedBy: reviewerId,
        adoptedAt,
        updatedAt: adoptedAt
      });
      if (submission.userId) {
        await transaction.collection(NOTIFICATION_COLLECTION).doc(`gap_adopted_${recordSuffix}`).set({
          userId: submission.userId,
          type: 'story_contribution_adopted',
          title: '你的资料已被故事采用',
          message: `“${cleanText(task.title, 48)}”已补入${cleanText(task.storyTitle, 80) || '相关文化故事'}。${Number(task.rewardPoints) > 0 ? '任务积分等待管理员确认。' : ''}`,
          actorName: '内容管理员',
          targetType: 'story',
          targetId: task.storyId || '',
          targetTitle: task.storyTitle || task.title || '',
          isRead: false,
          createdAt: adoptedAt,
          readAt: null
        });
      }
      await transaction.collection(TASK_LOG_COLLECTION).doc(`fulfilled_${recordSuffix}`).set({ taskId, submissionId, contributionId, action: 'fulfilled', reviewerId, createdAt: adoptedAt });
      return { ok: true, action: 'fulfillStoryGapTask', taskId, submissionId, contributionId, rewardStatus };
    });
  }

  async function award(event, reviewerId) {
    const taskId = cleanId(event.taskId, '征集任务');
    return db.runTransaction(async (transaction) => {
      const taskRef = transaction.collection(TASK_COLLECTION).doc(taskId);
      const task = firstDocument(await taskRef.get());
      if (!task || task.status !== 'fulfilled' || !task.fulfilledBySubmissionId) {
        throw Object.assign(new Error('请先确认采用一份已审核投稿'), { code: 'GAP_TASK_NOT_FULFILLED' });
      }
      const submissionId = task.fulfilledBySubmissionId;
      const contributionId = contributionIdFor(taskId, submissionId);
      const recordSuffix = contributionId.slice(4);
      const ledgerId = `award_gap_${recordSuffix}`;
      const ledgerRef = transaction.collection(POINT_LEDGER_COLLECTION).doc(ledgerId);
      const existingLedger = firstDocument(await ledgerRef.get());
      if (existingLedger) {
        if (task.rewardStatus !== 'awarded') await taskRef.update({ rewardStatus: 'awarded', updatedAt: db.serverDate() });
        return { ok: true, action: 'awardStoryGapTask', taskId, submissionId, contributionId, rewardPoints: Number(existingLedger.amount) || 0, cached: true };
      }
      const rewardPoints = Math.max(0, Math.min(500, Number(task.rewardPoints) || 0));
      if (!rewardPoints) throw Object.assign(new Error('这项任务没有设置额外积分'), { code: 'GAP_TASK_HAS_NO_REWARD' });
      const submission = firstDocument(await transaction.collection(SUBMISSION_COLLECTION).doc(submissionId).get());
      if (!submission || submission.status !== 'approved' || !submission.userId) {
        throw Object.assign(new Error('投稿状态或投稿用户不符合发放条件'), { code: 'INVALID_REWARD_RECIPIENT' });
      }
      const profileRef = transaction.collection(PROFILE_COLLECTION).doc(submission.userId);
      const profile = firstDocument(await profileRef.get());
      const balanceBefore = Math.max(0, Number(profile && profile.points) || 0);
      const awardedAt = db.serverDate();
      if (profile) {
        await profileRef.update({ points: balanceBefore + rewardPoints, updatedAt: awardedAt });
      } else {
        await profileRef.set({ uid: submission.userId, nickname: submission.contributorName || '楚韵守护者', avatarUrl: '', points: rewardPoints, uploadCount: 1, approvedCount: 1, createdAt: awardedAt, updatedAt: awardedAt });
      }
      await ledgerRef.set({ userId: submission.userId, type: 'gap_task_adopted', amount: rewardPoints, balanceBefore, balanceAfter: balanceBefore + rewardPoints, taskId, submissionId, contributionId, reviewerId, createdAt: awardedAt });
      await transaction.collection(CONTRIBUTION_COLLECTION).doc(contributionId).update({ rewardStatus: 'awarded', rewardPointsAwarded: rewardPoints, rewardAwardedBy: reviewerId, rewardAwardedAt: awardedAt, updatedAt: awardedAt });
      await taskRef.update({ rewardStatus: 'awarded', rewardAwardedAt: awardedAt, rewardAwardedBy: reviewerId, updatedAt: awardedAt });
      await transaction.collection(NOTIFICATION_COLLECTION).doc(`gap_reward_${recordSuffix}`).set({
        userId: submission.userId,
        type: 'story_contribution_rewarded',
        title: '贡献积分已到账',
        message: `你为“${cleanText(task.title, 48)}”补充的资料已获得 ${rewardPoints} 积分。`,
        actorName: '内容管理员',
        targetType: 'story',
        targetId: task.storyId || '',
        targetTitle: task.storyTitle || task.title || '',
        isRead: false,
        createdAt: awardedAt,
        readAt: null
      });
      await transaction.collection(TASK_LOG_COLLECTION).doc(`reward_${recordSuffix}`).set({ taskId, submissionId, contributionId, action: 'reward_awarded', rewardPoints, reviewerId, createdAt: awardedAt });
      return { ok: true, action: 'awardStoryGapTask', taskId, submissionId, contributionId, rewardPoints, balanceAfter: balanceBefore + rewardPoints };
    });
  }

  return { workspace, publish, archive, fulfill, award };
}

module.exports = { TASK_COLLECTION, TASK_LOG_COLLECTION, CONTRIBUTION_COLLECTION, contributionIdFor, publicTask, createStoryGapTaskService };
