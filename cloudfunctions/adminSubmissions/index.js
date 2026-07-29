'use strict';

const cloudbase = require('@cloudbase/node-sdk');

const app = cloudbase.init({
  env: process.env.TCB_ENV || cloudbase.SYMBOL_CURRENT_ENV
});
const db = app.database();
const REPORT_COLLECTION = 'content_reports';
const COMMENT_COLLECTION = 'submission_comments';
const SUBMISSION_COLLECTION = 'submissions';
const FEEDBACK_COLLECTION = 'system_feedback';
let interactionCollectionsReady = null;

async function ensureInteractionCollections() {
  if (!interactionCollectionsReady) {
    interactionCollectionsReady = Promise.all(
      [REPORT_COLLECTION, COMMENT_COLLECTION, 'submission_likes', FEEDBACK_COLLECTION].map(async (name) => {
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
      if (profile) {
        await profileRef.update({
          points: (Number(profile.points) || 0) + rewardPoints,
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
    let submissionTitle = '';
    try {
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
        const submissionRef = transaction.collection(SUBMISSION_COLLECTION).doc(report.submissionId);
        const submission = firstDocument(await submissionRef.get());
        if (submission) {
          await submissionRef.update({
            commentCount: Math.max(0, (Number(submission.commentCount) || 0) - 1),
            updatedAt: db.serverDate()
          });
        }
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

    if (action === 'list') return await listSubmissions(event);
    if (action === 'review') return await reviewSubmission(event, callerUid);
    if (action === 'listReports') return await listReports(event);
    if (action === 'resolveReport') return await resolveReport(event, callerUid);
    if (action === 'listFeedback') return await listFeedback(event);
    if (action === 'resolveFeedback') return await resolveFeedback(event, callerUid);

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
