'use strict';

const cloudbase = require('@cloudbase/node-sdk');
const crypto = require('crypto');
const RESOURCE_SEED = require('./data/resources.v1.json');

const app = cloudbase.init({
  env: process.env.TCB_ENV || cloudbase.SYMBOL_CURRENT_ENV
});
const db = app.database();
const REPORT_COLLECTION = 'content_reports';
const COMMENT_COLLECTION = 'submission_comments';
const CONTENT_INTERACTION_COLLECTION = 'content_interactions';
const NOTIFICATION_COLLECTION = 'interaction_notifications';
const SUBMISSION_COLLECTION = 'submissions';
const FEEDBACK_COLLECTION = 'system_feedback';
const SUPPLEMENT_COLLECTION = 'submission_supplements';
const REWARD_COLLECTION = 'rewards';
const REDEMPTION_COLLECTION = 'reward_redemptions';
const REDEMPTION_LOG_COLLECTION = 'reward_redemption_logs';
const RESOURCE_COLLECTION = 'resources';
const RESOURCE_SEED_CONFIRM_TOKEN = 'IMPORT_RESOURCES_V1';
let interactionCollectionsReady = null;

async function ensureInteractionCollections() {
  if (!interactionCollectionsReady) {
    interactionCollectionsReady = Promise.all(
      [REPORT_COLLECTION, COMMENT_COLLECTION, CONTENT_INTERACTION_COLLECTION, NOTIFICATION_COLLECTION, 'submission_likes', FEEDBACK_COLLECTION, SUPPLEMENT_COLLECTION, 'point_ledger', REWARD_COLLECTION, REDEMPTION_COLLECTION, REDEMPTION_LOG_COLLECTION, RESOURCE_COLLECTION].map(async (name) => {
        try {
          await db.createCollection(name);
        } catch (error) {
          const message = String(error && error.message || '');
          const code = String(error && error.code || '');
          if (!/exist/i.test(message) && !/exist/i.test(code)) throw error;
        }
      })
    ).catch((error) => {
      interactionCollectionsReady = null;
      throw error;
    });
  }
  return interactionCollectionsReady;
}

const ALLOWED_LIST_STATUSES = new Set([
  'pending',
  'approved',
  'rejected',
  'needs_revision'
]);
const ALLOWED_REVIEW_STATUSES = new Set([
  'approved',
  'rejected',
  'needs_revision'
]);
const ALLOWED_COMMENT_STATUSES = new Set(['all', 'visible', 'hidden', 'deleted']);
const ALLOWED_COMMENT_TARGET_TYPES = new Set(['all', 'submission', 'hotspot', 'landmark', 'activity', 'content']);

function getAdminUids() {
  return new Set(
    String(process.env.ADMIN_UIDS || '')
      .split(/[\s,;]+/)
      .map((value) => value.trim())
      .filter(Boolean)
  );
}

function cleanText(value, maxLength) {
  return String(value == null ? '' : value).trim().slice(0, maxLength);
}

function cleanId(value) {
  const id = cleanText(value, 128);
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    const error = new Error('投稿 ID 格式不正确');
    error.code = 'INVALID_SUBMISSION_ID';
    throw error;
  }
  return id;
}

function firstDocument(result) {
  if (!result) return null;
  if (Array.isArray(result.data)) return result.data[0] || null;
  return result.data || null;
}

function serializeSubmission(item) {
  return {
    id: item._id || item.id || '',
    status: item.status || '',
    description: item.description || '',
    imageFileID: item.imageFileID || '',
    imageCloudPath: item.imageCloudPath || '',
    userId: item.userId || '',
    location: item.location || null,
    metadata: item.metadata || null,
    createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || null,
    reviewedAt: item.reviewedAt || null,
    reviewerId: item.reviewerId || '',
    reviewNote: item.reviewNote || '',
    title: item.title || '',
    assetType: item.assetType || 'image',
    mimeType: item.mimeType || '',
    size: Number(item.size) || 0,
    contributorName: item.contributorName || '',
    rewardPoints: Number(item.rewardPoints) || 100,
    longitude: Number.isFinite(Number(item.longitude)) ? Number(item.longitude) : null,
    latitude: Number.isFinite(Number(item.latitude)) ? Number(item.latitude) : null,
    regionName: item.regionName || '湖北',
    reviewPipelineVersion: Number(item.reviewPipelineVersion) || 1,
    aiReviewStatus: item.aiReviewStatus || 'not_requested',
    aiReviewDecision: item.aiReviewDecision || '',
    aiReviewProvider: item.aiReviewProvider || '',
    aiReviewSummary: item.aiReviewSummary || '',
    aiReviewUpdatedAt: item.aiReviewUpdatedAt || null
  };
}

async function listSubmissions(event) {
  const requestedStatus = cleanText(event.status || 'pending', 32);
  if (!ALLOWED_LIST_STATUSES.has(requestedStatus)) {
    const error = new Error('不支持的投稿状态');
    error.code = 'INVALID_STATUS';
    throw error;
  }

  const requestedLimit = Number(event.limit);
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(Math.floor(requestedLimit), 50))
    : 20;

  const result = await db
    .collection('submissions')
    .where({ status: requestedStatus })
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get();

  const items = (result.data || []).map(serializeSubmission);
  const fileIDs = items.map((item) => item.imageFileID).filter(Boolean).slice(0, 50);
  let urls = new Map();
  if (fileIDs.length) {
    const fileResult = await app.getTempFileURL({
      fileList: fileIDs.map((fileID) => ({ fileID, maxAge: 7200 }))
    });
    urls = new Map(
      (fileResult.fileList || []).map((file) => [file.fileID, file.tempFileURL || ''])
    );
  }

  return {
    ok: true,
    action: 'list',
    status: requestedStatus,
    items: items.map((item) => ({
      ...item,
      fileUrl: urls.get(item.imageFileID) || ''
    }))
  };
}

async function reviewSubmission(event, reviewerId) {
  const submissionId = cleanId(event.submissionId);
  const nextStatus = cleanText(event.status, 32);
  const reviewNote = cleanText(event.reviewNote, 500);

  if (!ALLOWED_REVIEW_STATUSES.has(nextStatus)) {
    const error = new Error('审核结果只能是通过、拒绝或需修改');
    error.code = 'INVALID_REVIEW_STATUS';
    throw error;
  }
  if (nextStatus !== 'approved' && !reviewNote) {
    const error = new Error('拒绝或要求修改时必须填写审核说明');
    error.code = 'REVIEW_NOTE_REQUIRED';
    throw error;
  }

  return db.runTransaction(async (transaction) => {
    const submissionRef = transaction.collection('submissions').doc(submissionId);
    const current = firstDocument(await submissionRef.get());

    if (!current) {
      const error = new Error('没有找到这条投稿');
      error.code = 'SUBMISSION_NOT_FOUND';
      throw error;
    }
    if (current.status !== 'pending') {
      const error = new Error(`该投稿已是 ${current.status || '未知'} 状态，请刷新列表`);
      error.code = 'STATUS_CONFLICT';
      throw error;
    }

    const reviewedAt = db.serverDate();
    const rewardPoints = nextStatus === 'approved'
      ? Math.max(0, Math.min(Number(current.rewardPoints) || 100, 1000))
      : 0;
    await submissionRef.update({
      status: nextStatus,
      reviewNote,
      reviewerId,
      reviewedAt,
      updatedAt: reviewedAt
    });

    if (rewardPoints > 0 && current.userId) {
      const profileRef = transaction.collection('user_profiles').doc(current.userId);
      const profile = firstDocument(await profileRef.get());
      const balanceBefore = Math.max(0, Number(profile && profile.points) || 0);
      if (profile) {
        await profileRef.update({
          points: balanceBefore + rewardPoints,
          approvedCount: (Number(profile.approvedCount) || 0) + 1,
          updatedAt: db.serverDate()
        });
      } else {
        await profileRef.set({
          uid: current.userId,
          nickname: current.contributorName || '楚韵守护者',
          avatarUrl: '',
          points: rewardPoints,
          uploadCount: 1,
          approvedCount: 1,
          createdAt: db.serverDate(),
          updatedAt: db.serverDate()
        });
      }
      await transaction.collection('point_ledger').doc(`award_submission_${submissionId}`).set({
        userId: current.userId,
        type: 'submission_approved',
        amount: rewardPoints,
        balanceBefore,
        balanceAfter: balanceBefore + rewardPoints,
        submissionId,
        createdAt: db.serverDate()
      });
    }

    await transaction.collection('moderation_logs').add({
      submissionId,
      fromStatus: current.status,
      toStatus: nextStatus,
      reviewNote,
      reviewerId,
      submitterId: current.userId || '',
      rewardPoints,
      aiReviewStatus: current.aiReviewStatus || 'not_requested',
      aiReviewDecision: current.aiReviewDecision || '',
      aiReviewProvider: current.aiReviewProvider || '',
      aiReviewSummary: current.aiReviewSummary || '',
      createdAt: db.serverDate()
    });

    return {
      ok: true,
      action: 'review',
      submissionId,
      fromStatus: current.status,
      status: nextStatus,
      reviewNote,
      reviewerId,
      rewardPoints
    };
  });
}

function commentTargetFromRecord(comment) {
  const targetType = cleanText(comment && comment.targetType, 20) || 'submission';
  const targetId = cleanText(comment && comment.targetId, 128) || cleanText(comment && comment.submissionId, 128);
  return {
    targetType,
    targetId,
    targetKey: cleanText(comment && comment.targetKey, 280) || `${targetType}__${targetId}`,
    targetTitle: cleanText(comment && comment.targetTitle, 120)
  };
}

async function updateCommentCounter(transaction, target, delta) {
  if (target.targetType === 'submission' && target.targetId) {
    const submissionRef = transaction.collection(SUBMISSION_COLLECTION).doc(target.targetId);
    const submission = firstDocument(await submissionRef.get());
    if (submission) {
      await submissionRef.update({
        commentCount: Math.max(0, (Number(submission.commentCount) || 0) + delta),
        updatedAt: db.serverDate()
      });
    }
    return;
  }
  if (!target.targetId) return;
  const counterRef = transaction.collection(CONTENT_INTERACTION_COLLECTION).doc(target.targetKey);
  const counter = firstDocument(await counterRef.get());
  await counterRef.set({
    targetType: target.targetType,
    targetId: target.targetId,
    targetKey: target.targetKey,
    targetTitle: target.targetTitle || (counter && counter.targetTitle) || '',
    commentCount: Math.max(0, (Number(counter && counter.commentCount) || 0) + delta),
    updatedAt: db.serverDate()
  });
}

async function createAdminNotification(transaction, data) {
  const userId = cleanText(data && data.userId, 128);
  if (!userId) return;
  await transaction.collection(NOTIFICATION_COLLECTION).add({
    userId,
    type: cleanText(data.type, 40),
    title: cleanText(data.title, 120),
    message: cleanText(data.message, 300),
    actorName: '内容管理员',
    targetType: cleanText(data.targetType, 20),
    targetId: cleanText(data.targetId, 128),
    targetTitle: cleanText(data.targetTitle, 120),
    commentId: cleanText(data.commentId, 128),
    isRead: false,
    createdAt: db.serverDate(),
    readAt: null
  });
}

function serializeSupplement(item) {
  return {
    id: item._id || item.id || '',
    submissionId: item.submissionId || '',
    submissionTitle: item.submissionTitle || '',
    slotId: item.slotId || '',
    slotTitle: item.slotTitle || '',
    userId: item.userId || '',
    contributorName: item.contributorName || '社区用户',
    assetType: item.assetType || 'image',
    mimeType: item.mimeType || '',
    size: Number(item.size) || 0,
    fileID: item.fileID || '',
    cloudPath: item.cloudPath || '',
    status: item.status || 'pending',
    rewardPoints: Number(item.rewardPoints) || 0,
    completenessGain: Number(item.completenessGain) || 18,
    createdAt: item.createdAt || null
  };
}

async function listSupplements(event) {
  await ensureInteractionCollections();
  const requestedLimit = Number(event.limit);
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(Math.floor(requestedLimit), 50))
    : 30;
  const result = await db.collection(SUPPLEMENT_COLLECTION)
    .where({ status: 'pending' })
    .limit(limit)
    .get();
  const items = [...(result.data || [])]
    .sort((left, right) => {
      const leftTime = new Date(left.createdAt || 0).getTime() || 0;
      const rightTime = new Date(right.createdAt || 0).getTime() || 0;
      return rightTime - leftTime;
    })
    .map(serializeSupplement);
  const fileIDs = items.map((item) => item.fileID).filter(Boolean).slice(0, 50);
  let urls = new Map();
  if (fileIDs.length) {
    const fileResult = await app.getTempFileURL({
      fileList: fileIDs.map((fileID) => ({ fileID, maxAge: 7200 }))
    });
    urls = new Map((fileResult.fileList || []).map((file) => [file.fileID, file.tempFileURL || '']));
  }
  return {
    ok: true,
    action: 'listSupplements',
    items: items.map((item) => ({ ...item, fileUrl: urls.get(item.fileID) || '' }))
  };
}

async function reviewSupplement(event, reviewerId) {
  const supplementId = cleanId(event.supplementId);
  const nextStatus = cleanText(event.status, 32);
  const reviewNote = cleanText(event.reviewNote, 500);
  if (!['approved', 'rejected'].includes(nextStatus)) {
    const error = new Error('补充资料审核结果不正确');
    error.code = 'INVALID_REVIEW_STATUS';
    throw error;
  }
  if (nextStatus === 'rejected' && !reviewNote) {
    const error = new Error('退回补充资料时必须填写原因');
    error.code = 'REVIEW_NOTE_REQUIRED';
    throw error;
  }
  return db.runTransaction(async (transaction) => {
    const supplementRef = transaction.collection(SUPPLEMENT_COLLECTION).doc(supplementId);
    const supplement = firstDocument(await supplementRef.get());
    if (!supplement || supplement.status !== 'pending') {
      const error = new Error('补充资料不存在或已审核，请刷新列表');
      error.code = 'STATUS_CONFLICT';
      throw error;
    }
    const submissionRef = transaction.collection(SUBMISSION_COLLECTION).doc(supplement.submissionId);
    const submission = firstDocument(await submissionRef.get());
    if (!submission || submission.status !== 'approved') {
      const error = new Error('原作品不存在或已停止公开');
      error.code = 'SUBMISSION_NOT_PUBLIC';
      throw error;
    }
    const reviewedAt = db.serverDate();
    const rewardPoints = nextStatus === 'approved'
      ? Math.max(0, Math.min(Number(supplement.rewardPoints) || 0, 200))
      : 0;
    await supplementRef.update({
      status: nextStatus,
      reviewNote,
      reviewerId,
      reviewedAt,
      updatedAt: reviewedAt
    });
    let completeness = Number(submission.completeness) || 60;
    let board = submission.board || (completeness >= 82 ? 'share' : 'needs');
    if (nextStatus === 'approved') {
      completeness = Math.min(100, completeness + Math.max(1, Math.min(Number(supplement.completenessGain) || 18, 30)));
      board = completeness >= 82 ? 'share' : 'needs';
      const approvedSupplements = Array.isArray(submission.approvedSupplements)
        ? submission.approvedSupplements.slice(-11)
        : [];
      approvedSupplements.push({
        id: supplementId,
        slotId: supplement.slotId || '',
        slotTitle: supplement.slotTitle || '',
        assetType: supplement.assetType || 'image',
        fileID: supplement.fileID || '',
        contributorName: supplement.contributorName || '社区用户',
        approvedAt: new Date()
      });
      await submissionRef.update({
        completeness,
        board,
        supplementCount: Math.max(0, Number(submission.supplementCount) || 0) + 1,
        approvedSupplements,
        updatedAt: reviewedAt
      });
      if (supplement.userId && rewardPoints > 0) {
        const profileRef = transaction.collection('user_profiles').doc(supplement.userId);
        const profile = firstDocument(await profileRef.get());
        if (profile) {
          const balanceBefore = Math.max(0, Number(profile.points) || 0);
          await profileRef.update({
            points: balanceBefore + rewardPoints,
            updatedAt: reviewedAt
          });
          await transaction.collection('point_ledger').doc(`award_supplement_${supplementId}`).set({
            userId: supplement.userId,
            type: 'supplement_approved',
            amount: rewardPoints,
            balanceBefore,
            balanceAfter: balanceBefore + rewardPoints,
            supplementId,
            submissionId: supplement.submissionId || '',
            createdAt: db.serverDate()
          });
        }
      }
    }
    await transaction.collection('moderation_logs').add({
      type: 'submission_supplement',
      supplementId,
      submissionId: supplement.submissionId || '',
      slotId: supplement.slotId || '',
      fromStatus: 'pending',
      toStatus: nextStatus,
      reviewNote,
      reviewerId,
      submitterId: supplement.userId || '',
      rewardPoints,
      completeness,
      board,
      createdAt: db.serverDate()
    });
    return {
      ok: true,
      action: 'reviewSupplement',
      supplementId,
      submissionId: supplement.submissionId || '',
      status: nextStatus,
      rewardPoints,
      completeness,
      board
    };
  });
}

async function listComments(event) {
  await ensureInteractionCollections();
  const status = cleanText(event.status || 'visible', 20);
  const targetType = cleanText(event.targetType || 'all', 20);
  if (!ALLOWED_COMMENT_STATUSES.has(status) || !ALLOWED_COMMENT_TARGET_TYPES.has(targetType)) {
    const error = new Error('评论筛选条件不正确');
    error.code = 'INVALID_COMMENT_FILTER';
    throw error;
  }
  const requestedLimit = Number(event.limit);
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(Math.floor(requestedLimit), 100))
    : 50;
  const result = await db.collection(COMMENT_COLLECTION).limit(200).get();
  const filtered = [...(result.data || [])]
    .filter((comment) => status === 'all' || (comment.status || 'visible') === status)
    .filter((comment) => targetType === 'all' || commentTargetFromRecord(comment).targetType === targetType)
    .sort((left, right) => {
      const leftTime = new Date(left.createdAt || 0).getTime() || 0;
      const rightTime = new Date(right.createdAt || 0).getTime() || 0;
      return rightTime - leftTime;
    })
    .slice(0, limit);
  const submissionTitles = new Map();
  const submissionIds = [...new Set(filtered
    .map((comment) => commentTargetFromRecord(comment))
    .filter((target) => target.targetType === 'submission' && target.targetId)
    .map((target) => target.targetId))];
  await Promise.all(submissionIds.map(async (submissionId) => {
    try {
      const submission = firstDocument(await db.collection(SUBMISSION_COLLECTION).doc(submissionId).get());
      if (submission) submissionTitles.set(submissionId, submission.title || '社区投稿');
    } catch (_) {}
  }));
  const items = filtered.map((comment) => {
    const target = commentTargetFromRecord(comment);
    return {
      id: comment._id || comment.id || '',
      content: comment.content || '',
      status: comment.status || 'visible',
      authorName: comment.authorName || '社区用户',
      userId: comment.userId || '',
      parentId: comment.parentId || '',
      rootId: comment.rootId || comment.parentId || comment._id || '',
      targetType: target.targetType,
      targetId: target.targetId,
      targetTitle: target.targetTitle || submissionTitles.get(target.targetId) || '内容讨论',
      createdAt: comment.createdAt || null,
      updatedAt: comment.updatedAt || null,
      hiddenBy: comment.hiddenBy || '',
      hiddenAt: comment.hiddenAt || null,
      deletedAt: comment.deletedAt || null
    };
  });
  return { ok: true, action: 'listComments', status, targetType, items };
}

async function moderateComment(event, reviewerId) {
  await ensureInteractionCollections();
  const commentId = cleanId(event.commentId);
  const nextStatus = cleanText(event.status, 20);
  const moderationNote = cleanText(event.moderationNote, 500);
  if (!['visible', 'hidden'].includes(nextStatus)) {
    const error = new Error('评论处理状态不正确');
    error.code = 'INVALID_COMMENT_STATUS';
    throw error;
  }
  if (nextStatus === 'hidden' && !moderationNote) {
    const error = new Error('隐藏评论时必须填写处理原因');
    error.code = 'MODERATION_NOTE_REQUIRED';
    throw error;
  }
  return db.runTransaction(async (transaction) => {
    const commentRef = transaction.collection(COMMENT_COLLECTION).doc(commentId);
    const comment = firstDocument(await commentRef.get());
    if (!comment) {
      const error = new Error('评论不存在');
      error.code = 'COMMENT_NOT_FOUND';
      throw error;
    }
    const currentStatus = comment.status || 'visible';
    if (currentStatus === 'deleted') {
      const error = new Error('用户已删除的评论不能恢复或再次隐藏');
      error.code = 'COMMENT_DELETED';
      throw error;
    }
    if (currentStatus === nextStatus) {
      const error = new Error('评论已经处于该状态');
      error.code = 'COMMENT_STATUS_UNCHANGED';
      throw error;
    }
    const target = commentTargetFromRecord(comment);
    await updateCommentCounter(transaction, target, nextStatus === 'visible' ? 1 : -1);
    await commentRef.update({
      status: nextStatus,
      moderationNote,
      hiddenBy: nextStatus === 'hidden' ? reviewerId : '',
      hiddenAt: nextStatus === 'hidden' ? db.serverDate() : null,
      restoredBy: nextStatus === 'visible' ? reviewerId : '',
      restoredAt: nextStatus === 'visible' ? db.serverDate() : null,
      updatedAt: db.serverDate()
    });
    await createAdminNotification(transaction, {
      userId: comment.userId,
      type: nextStatus === 'hidden' ? 'comment_hidden' : 'comment_restored',
      title: nextStatus === 'hidden' ? '你的评论已被管理员隐藏' : '你的评论已恢复公开',
      message: moderationNote || (nextStatus === 'visible' ? '管理员复核后恢复了这条评论。' : '评论不符合社区交流规范。'),
      targetType: target.targetType,
      targetId: target.targetId,
      targetTitle: target.targetTitle,
      commentId
    });
    await transaction.collection('moderation_logs').add({
      type: 'comment_moderation',
      commentId,
      contentTargetType: target.targetType,
      contentTargetId: target.targetId,
      fromStatus: currentStatus,
      toStatus: nextStatus,
      moderationNote,
      reviewerId,
      createdAt: db.serverDate()
    });
    return {
      ok: true,
      action: 'moderateComment',
      commentId,
      status: nextStatus,
      targetType: target.targetType,
      targetId: target.targetId
    };
  });
}

async function listReports(event) {
  await ensureInteractionCollections();
  const requestedLimit = Number(event.limit);
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(Math.floor(requestedLimit), 50))
    : 30;
  const result = await db.collection(REPORT_COLLECTION)
    .where({ status: 'pending' })
    .limit(limit)
    .get();
  const reports = [...(result.data || [])].sort((left, right) => {
    const leftTime = new Date(left.createdAt || 0).getTime() || 0;
    const rightTime = new Date(right.createdAt || 0).getTime() || 0;
    return rightTime - leftTime;
  });
  const items = await Promise.all(reports.map(async (report) => {
    let targetContent = '';
    let submissionTitle = report.contentTargetTitle || '';
    if (report.submissionId) try {
      const submission = firstDocument(
        await db.collection(SUBMISSION_COLLECTION).doc(report.submissionId).get()
      );
      submissionTitle = submission && submission.title ? submission.title : '';
    } catch (_) {}
    if (report.targetType === 'comment') {
      try {
        const comment = firstDocument(
          await db.collection(COMMENT_COLLECTION).doc(report.targetId).get()
        );
        targetContent = comment && comment.content ? comment.content : '';
      } catch (_) {}
    }
    return {
      id: report._id || '',
      submissionId: report.submissionId || '',
      submissionTitle,
      contentTargetType: report.contentTargetType || 'submission',
      contentTargetId: report.contentTargetId || report.submissionId || '',
      targetType: report.targetType || 'submission',
      targetId: report.targetId || '',
      targetContent,
      reporterId: report.reporterId || '',
      reporterName: report.reporterName || '社区用户',
      reason: report.reason || 'other',
      detail: report.detail || '',
      createdAt: report.createdAt || null
    };
  }));
  return { ok: true, action: 'listReports', items };
}

async function resolveReport(event, reviewerId) {
  await ensureInteractionCollections();
  const reportId = cleanId(event.reportId);
  const resolution = cleanText(event.resolution, 32);
  const resolutionNote = cleanText(event.resolutionNote, 500);
  if (!['resolved', 'dismissed'].includes(resolution)) {
    const error = new Error('举报处理结果不正确');
    error.code = 'INVALID_REPORT_RESOLUTION';
    throw error;
  }
  return db.runTransaction(async (transaction) => {
    const reportRef = transaction.collection(REPORT_COLLECTION).doc(reportId);
    const report = firstDocument(await reportRef.get());
    if (!report || report.status !== 'pending') {
      const error = new Error('举报不存在或已处理');
      error.code = 'REPORT_NOT_PENDING';
      throw error;
    }
    let commentHidden = false;
    if (resolution === 'resolved' && report.targetType === 'comment') {
      const commentRef = transaction.collection(COMMENT_COLLECTION).doc(report.targetId);
      const comment = firstDocument(await commentRef.get());
      if (comment && comment.status === 'visible') {
        await commentRef.update({
          status: 'hidden',
          hiddenBy: reviewerId,
          hiddenAt: db.serverDate(),
          updatedAt: db.serverDate()
        });
        const contentTargetType = comment.targetType || report.contentTargetType || 'submission';
        const contentTargetId = comment.targetId || report.contentTargetId || comment.submissionId || report.submissionId;
        const contentTargetKey = comment.targetKey || report.contentTargetKey || `${contentTargetType}__${contentTargetId}`;
        if (contentTargetType === 'submission' && contentTargetId) {
          const submissionRef = transaction.collection(SUBMISSION_COLLECTION).doc(contentTargetId);
          const submission = firstDocument(await submissionRef.get());
          if (submission) {
            await submissionRef.update({
              commentCount: Math.max(0, (Number(submission.commentCount) || 0) - 1),
              updatedAt: db.serverDate()
            });
          }
        } else if (contentTargetId) {
          const counterRef = transaction.collection(CONTENT_INTERACTION_COLLECTION).doc(contentTargetKey);
          const counter = firstDocument(await counterRef.get());
          await counterRef.set({
            targetType: contentTargetType,
            targetId: contentTargetId,
            targetKey: contentTargetKey,
            targetTitle: comment.targetTitle || report.contentTargetTitle || (counter && counter.targetTitle) || '',
            commentCount: Math.max(0, (Number(counter && counter.commentCount) || 0) - 1),
            updatedAt: db.serverDate()
          });
        }
        await createAdminNotification(transaction, {
          userId: comment.userId,
          type: 'comment_hidden',
          title: '你的评论已被管理员隐藏',
          message: resolutionNote || '管理员根据社区举报复核后隐藏了这条评论。',
          targetType: contentTargetType,
          targetId: contentTargetId,
          targetTitle: comment.targetTitle || report.contentTargetTitle || '',
          commentId: report.targetId
        });
        commentHidden = true;
      }
    }
    await reportRef.update({
      status: resolution,
      resolutionNote,
      resolvedBy: reviewerId,
      resolvedAt: db.serverDate(),
      updatedAt: db.serverDate()
    });
    await createAdminNotification(transaction, {
      userId: report.reporterId,
      type: resolution === 'resolved' ? 'report_resolved' : 'report_dismissed',
      title: resolution === 'resolved' ? '你的举报已处理' : '你的举报经复核未成立',
      message: resolutionNote || (resolution === 'resolved'
        ? '管理员已核实并处理你举报的内容。'
        : '管理员复核后暂未发现违规情况。'),
      targetType: report.contentTargetType || 'submission',
      targetId: report.contentTargetId || report.submissionId || '',
      targetTitle: report.contentTargetTitle || '',
      commentId: report.targetType === 'comment' ? report.targetId : ''
    });
    await transaction.collection('moderation_logs').add({
      type: 'content_report',
      reportId,
      submissionId: report.submissionId || '',
      targetType: report.targetType || '',
      targetId: report.targetId || '',
      resolution,
      resolutionNote,
      reviewerId,
      commentHidden,
      createdAt: db.serverDate()
    });
    return {
      ok: true,
      action: 'resolveReport',
      reportId,
      resolution,
      commentHidden
    };
  });
}

async function listFeedback(event) {
  await ensureInteractionCollections();
  const requestedLimit = Number(event.limit);
  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(Math.floor(requestedLimit), 50))
    : 30;
  const result = await db.collection(FEEDBACK_COLLECTION)
    .where({ status: 'open' })
    .limit(limit)
    .get();
  const items = [...(result.data || [])]
    .sort((left, right) => {
      const leftTime = new Date(left.createdAt || 0).getTime() || 0;
      const rightTime = new Date(right.createdAt || 0).getTime() || 0;
      return rightTime - leftTime;
    })
    .map((item) => ({
      id: item._id || item.id || '',
      userId: item.userId || '',
      userName: item.userName || '社区用户',
      type: item.type || 'other',
      content: item.content || '',
      page: item.page || '',
      createdAt: item.createdAt || null
    }));
  return { ok: true, action: 'listFeedback', items };
}

async function resolveFeedback(event, reviewerId) {
  await ensureInteractionCollections();
  const feedbackId = cleanId(event.feedbackId);
  const resolution = cleanText(event.resolution, 32);
  const response = cleanText(event.response, 800);
  if (!['resolved', 'dismissed'].includes(resolution)) {
    const error = new Error('反馈处理结果不正确');
    error.code = 'INVALID_FEEDBACK_RESOLUTION';
    throw error;
  }
  if (resolution === 'resolved' && !response) {
    const error = new Error('请填写给用户的处理回复');
    error.code = 'FEEDBACK_RESPONSE_REQUIRED';
    throw error;
  }
  const ref = db.collection(FEEDBACK_COLLECTION).doc(feedbackId);
  const current = firstDocument(await ref.get());
  if (!current || current.status !== 'open') {
    const error = new Error('反馈不存在或已处理');
    error.code = 'FEEDBACK_NOT_OPEN';
    throw error;
  }
  await ref.update({
    status: resolution,
    response,
    resolvedBy: reviewerId,
    resolvedAt: db.serverDate(),
    updatedAt: db.serverDate()
  });
  await createAdminNotification(db, {
    userId: current.userId,
    type: resolution === 'resolved' ? 'feedback_resolved' : 'feedback_closed',
    title: resolution === 'resolved' ? '你的反馈已收到回复' : '你的反馈已关闭',
    message: response || '管理员已完成本次反馈处理。'
  });
  await db.collection('moderation_logs').add({
    type: 'system_feedback',
    feedbackId,
    resolution,
    response,
    reviewerId,
    userId: current.userId || '',
    createdAt: db.serverDate()
  });
  return { ok: true, action: 'resolveFeedback', feedbackId, resolution };
}

function normalizeRedemptionCode(value) {
  const code = cleanText(value, 40).toUpperCase().replace(/\s+/g, '');
  if (!/^CHU-[23456789A-HJ-NP-Z]{4}-[23456789A-HJ-NP-Z]{4}-[23456789A-HJ-NP-Z]{4}$/.test(code)) {
    const error = new Error('兑换码格式不正确');
    error.code = 'INVALID_REDEMPTION_CODE';
    throw error;
  }
  return code;
}

function redemptionEffectiveStatus(item) {
  if (item.status !== 'issued') return item.status || 'issued';
  const expiresAt = new Date(item.expiresAt || 0).getTime();
  return expiresAt > 0 && expiresAt <= Date.now() ? 'expired' : 'issued';
}

function maskedRedemptionCode(code) {
  const value = String(code || '');
  return value.length > 8 ? `${value.slice(0, 8)}-••••-${value.slice(-4)}` : value;
}

function adminRedemptionView(item, includeCode = false) {
  const userId = String(item.userId || '');
  const displayCode = String(item.displayCode || '');
  return {
    id: item._id || item.id || '',
    rewardId: item.rewardId || '',
    rewardTitle: item.rewardTitle || '反哺福利',
    sponsor: item.sponsor || '',
    code: includeCode ? displayCode : maskedRedemptionCode(displayCode),
    status: redemptionEffectiveStatus(item),
    pointsCost: Math.max(0, Number(item.pointsCost) || 0),
    userId: userId.length > 10 ? `${userId.slice(0, 5)}…${userId.slice(-5)}` : userId,
    issuedAt: item.issuedAt || item.createdAt || null,
    expiresAt: item.expiresAt || null,
    redeemedAt: item.redeemedAt || null,
    redeemedBy: item.redeemedBy || '',
    redemptionInstructions: item.redemptionInstructions || ''
  };
}

async function findRedemptionByCode(code) {
  const codeHash = crypto.createHash('sha256').update(code).digest('hex');
  const result = await db.collection(REDEMPTION_COLLECTION).where({ codeHash }).limit(2).get();
  const items = result.data || [];
  if (items.length > 1) {
    const error = new Error('兑换码数据异常，请暂停核销并联系管理员');
    error.code = 'DUPLICATE_REDEMPTION_CODE';
    throw error;
  }
  return items[0] || null;
}

async function lookupRedemption(event) {
  await ensureInteractionCollections();
  const code = normalizeRedemptionCode(event.code);
  const redemption = await findRedemptionByCode(code);
  if (!redemption) {
    const error = new Error('没有找到该兑换码，请核对后重试');
    error.code = 'REDEMPTION_NOT_FOUND';
    throw error;
  }
  return { ok: true, action: 'lookupRedemption', redemption: adminRedemptionView(redemption, true) };
}

async function listRedemptions(event) {
  await ensureInteractionCollections();
  const requestedStatus = cleanText(event.status || 'all', 20);
  if (!['all', 'issued', 'redeemed', 'expired', 'cancelled'].includes(requestedStatus)) {
    const error = new Error('兑换状态筛选不正确');
    error.code = 'INVALID_REDEMPTION_STATUS';
    throw error;
  }
  const result = await db.collection(REDEMPTION_COLLECTION).limit(100).get();
  const items = (result.data || [])
    .map((item) => adminRedemptionView(item, false))
    .filter((item) => requestedStatus === 'all' || item.status === requestedStatus)
    .sort((left, right) => new Date(right.issuedAt || 0).getTime() - new Date(left.issuedAt || 0).getTime())
    .slice(0, Math.max(1, Math.min(Number(event.limit) || 50, 100)));
  return { ok: true, action: 'listRedemptions', items };
}

function isAdminTransactionBusy(error) {
  return /ResourceUnavailableTransactionBusy|Transaction is busy|DATABASE_TRANSACTION_FAIL|TRANSACTION_BUSY/i.test(`${error && error.code || ''} ${error && error.message || ''}`);
}

async function runAdminTransaction(work, maxAttempts = 4) {
  let lastError = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await db.runTransaction(work);
    } catch (error) {
      lastError = error;
      if (!isAdminTransactionBusy(error) || attempt >= maxAttempts - 1) break;
      await new Promise((resolve) => setTimeout(resolve, 100 * (2 ** attempt)));
    }
  }
  if (isAdminTransactionBusy(lastError)) {
    const error = new Error('核销服务正忙，请稍等几秒再试');
    error.code = 'REDEMPTION_SERVICE_BUSY';
    throw error;
  }
  throw lastError;
}

async function redeemRewardCode(event, reviewerId) {
  await ensureInteractionCollections();
  const code = normalizeRedemptionCode(event.code);
  const existing = await findRedemptionByCode(code);
  if (!existing) {
    const error = new Error('没有找到该兑换码，请核对后重试');
    error.code = 'REDEMPTION_NOT_FOUND';
    throw error;
  }
  const redemptionId = existing._id || existing.id || '';
  if (!redemptionId) {
    const error = new Error('兑换凭证数据不完整');
    error.code = 'INVALID_REDEMPTION_RECORD';
    throw error;
  }

  return runAdminTransaction(async (transaction) => {
    const ref = transaction.collection(REDEMPTION_COLLECTION).doc(redemptionId);
    const current = firstDocument(await ref.get());
    if (!current || current.codeHash !== crypto.createHash('sha256').update(code).digest('hex')) {
      const error = new Error('兑换码已变更，请重新查询');
      error.code = 'REDEMPTION_CHANGED';
      throw error;
    }
    const status = redemptionEffectiveStatus(current);
    if (status === 'redeemed') {
      const error = new Error('该兑换码已经核销，不能重复使用');
      error.code = 'ALREADY_REDEEMED';
      throw error;
    }
    if (status === 'expired') {
      const error = new Error('该兑换码已过期');
      error.code = 'REDEMPTION_EXPIRED';
      throw error;
    }
    if (status !== 'issued') {
      const error = new Error('该兑换码当前不可使用');
      error.code = 'REDEMPTION_UNAVAILABLE';
      throw error;
    }

    const redeemedAt = new Date();
    await ref.update({
      status: 'redeemed',
      redeemedAt,
      redeemedBy: reviewerId,
      redemptionChannel: 'admin_console',
      updatedAt: redeemedAt
    });
    await transaction.collection(REDEMPTION_LOG_COLLECTION).doc(redemptionId).set({
      redemptionId,
      rewardId: current.rewardId || '',
      rewardTitle: current.rewardTitle || '',
      userId: current.userId || '',
      codeHash: current.codeHash || '',
      fromStatus: 'issued',
      toStatus: 'redeemed',
      operatorId: reviewerId,
      channel: 'admin_console',
      createdAt: redeemedAt
    });
    if (current.userId) {
      await transaction.collection(NOTIFICATION_COLLECTION).add({
        userId: current.userId,
        type: 'reward_redeemed',
        title: '兑换凭证已核销',
        message: `${current.rewardTitle || '反哺福利'} 已于商家端完成核销。`,
        actorName: '核销员',
        targetType: 'reward',
        targetId: current.rewardId || '',
        targetTitle: current.rewardTitle || '',
        isRead: false,
        createdAt: redeemedAt,
        readAt: null
      });
    }
    const updated = {
      ...current,
      status: 'redeemed',
      redeemedAt,
      redeemedBy: reviewerId
    };
    return { ok: true, action: 'redeemRewardCode', redemption: adminRedemptionView(updated, true) };
  });
}

function resourceSeedFingerprint(resource) {
  return crypto.createHash('sha256').update(JSON.stringify(resource)).digest('hex');
}

function resourceSeedView(resource, existing) {
  return {
    id: resource.id,
    type: resource.type,
    title: resource.title,
    exists: Boolean(existing),
    currentSeedVersion: existing ? Math.max(0, Number(existing.seedVersion) || 0) : 0,
    incomingSeedVersion: Math.max(1, Number(resource.seedVersion) || 1),
    differs: Boolean(existing && existing.seedFingerprint !== resourceSeedFingerprint(resource))
  };
}

async function previewResourceSeed() {
  const items = [];
  for (const resource of RESOURCE_SEED) {
    const existing = firstDocument(await db.collection(RESOURCE_COLLECTION).doc(resource.id).get());
    items.push(resourceSeedView(resource, existing));
  }
  return {
    ok: true,
    action: 'previewResourceSeed',
    modelVersion: 1,
    total: items.length,
    missing: items.filter((item) => !item.exists).length,
    existing: items.filter((item) => item.exists).length,
    differing: items.filter((item) => item.differs).length,
    writePolicy: 'create_missing_only',
    items
  };
}

async function createSeedResourceIfMissing(resource) {
  return db.runTransaction(async (transaction) => {
    const ref = transaction.collection(RESOURCE_COLLECTION).doc(resource.id);
    const existing = firstDocument(await ref.get());
    if (existing) return { id: resource.id, created: false };
    await ref.set({
      ...resource,
      seedFingerprint: resourceSeedFingerprint(resource),
      sourceSubmissionId: '',
      media: Array.isArray(resource.media) ? resource.media : [],
      transport: resource.transport || {},
      collectables: Array.isArray(resource.collectables) ? resource.collectables : [],
      createdBy: 'system_resource_seed',
      createdAt: db.serverDate(),
      updatedAt: db.serverDate(),
      publishedAt: resource.status === 'published' ? db.serverDate() : null
    });
    return { id: resource.id, created: true };
  });
}

async function applyResourceSeed(event, reviewerId) {
  if (cleanText(event.confirmToken, 64) !== RESOURCE_SEED_CONFIRM_TOKEN) {
    const error = new Error('缺少资源导入确认口令，请先执行预览');
    error.code = 'RESOURCE_SEED_CONFIRMATION_REQUIRED';
    throw error;
  }

  const results = [];
  for (const resource of RESOURCE_SEED) {
    results.push(await createSeedResourceIfMissing(resource));
  }
  const createdIds = results.filter((item) => item.created).map((item) => item.id);
  const skippedIds = results.filter((item) => !item.created).map((item) => item.id);
  await db.collection('moderation_logs').add({
    action: 'resource_seed_import',
    reviewerId,
    modelVersion: 1,
    policy: 'create_missing_only',
    createdIds,
    skippedIds,
    createdAt: db.serverDate()
  });
  return {
    ok: true,
    action: 'applyResourceSeed',
    total: results.length,
    created: createdIds.length,
    skipped: skippedIds.length,
    createdIds,
    skippedIds,
    deleted: 0,
    updated: 0
  };
}

exports.main = async (event = {}) => {
  try {
    const userInfo = app.auth().getUserInfo() || {};
    const callerUid = cleanText(userInfo.uid, 128);
    const adminUids = getAdminUids();
    const isAdmin = Boolean(callerUid && adminUids.has(callerUid));
    const action = cleanText(event.action, 32);

    if (action === 'whoami') {
      return {
        ok: true,
        action,
        uid: callerUid,
        isAdmin,
        adminConfigured: adminUids.size > 0
      };
    }

    if (!callerUid) {
      return {
        ok: false,
        error: { code: 'UNAUTHENTICATED', message: '请先登录后再操作' }
      };
    }
    if (adminUids.size === 0) {
      return {
        ok: false,
        error: {
          code: 'ADMIN_NOT_CONFIGURED',
          message: '云函数尚未配置 ADMIN_UIDS'
        }
      };
    }
    if (!isAdmin) {
      return {
        ok: false,
        error: { code: 'FORBIDDEN', message: '当前账号不是管理员' }
      };
    }

    await ensureInteractionCollections();
    if (action === 'list') return await listSubmissions(event);
    if (action === 'review') return await reviewSubmission(event, callerUid);
    if (action === 'listSupplements') return await listSupplements(event);
    if (action === 'reviewSupplement') return await reviewSupplement(event, callerUid);
    if (action === 'listComments') return await listComments(event);
    if (action === 'moderateComment') return await moderateComment(event, callerUid);
    if (action === 'listReports') return await listReports(event);
    if (action === 'resolveReport') return await resolveReport(event, callerUid);
    if (action === 'listFeedback') return await listFeedback(event);
    if (action === 'resolveFeedback') return await resolveFeedback(event, callerUid);
    if (action === 'lookupRedemption') return await lookupRedemption(event);
    if (action === 'listRedemptions') return await listRedemptions(event);
    if (action === 'redeemRewardCode') return await redeemRewardCode(event, callerUid);
    if (action === 'previewResourceSeed') return await previewResourceSeed();
    if (action === 'applyResourceSeed') return await applyResourceSeed(event, callerUid);

    return {
      ok: false,
      error: { code: 'INVALID_ACTION', message: '不支持的操作' }
    };
  } catch (error) {
    console.error('[adminSubmissions]', error);
    return {
      ok: false,
      error: {
        code: error && error.code ? String(error.code) : 'OPERATION_FAILED',
        message: error && error.message ? String(error.message) : '云函数执行失败'
      }
    };
  }
};
