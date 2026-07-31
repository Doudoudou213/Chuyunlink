'use strict';

const cloudbase = require('@cloudbase/node-sdk');

const app = cloudbase.init({
  env: process.env.TCB_ENV || cloudbase.SYMBOL_CURRENT_ENV
});
const db = app.database();

const PROFILE_COLLECTION = 'user_profiles';
const SUBMISSION_COLLECTION = 'submissions';
const COMMENT_COLLECTION = 'submission_comments';
const LIKE_COLLECTION = 'submission_likes';
const REPORT_COLLECTION = 'content_reports';
const FEEDBACK_COLLECTION = 'system_feedback';
const SUPPLEMENT_COLLECTION = 'submission_supplements';
const ALLOWED_ASSET_TYPES = new Set(['image', 'audio', 'video']);
const ALLOWED_REPORT_REASONS = new Set(['spam', 'abuse', 'false_information', 'copyright', 'other']);
const ALLOWED_FEEDBACK_TYPES = new Set(['suggestion', 'bug', 'content', 'other']);
const MAX_FILE_BYTES = 25 * 1024 * 1024;
let interactionCollectionsReady = null;

async function ensureInteractionCollections() {
  if (!interactionCollectionsReady) {
    interactionCollectionsReady = Promise.all(
      [COMMENT_COLLECTION, LIKE_COLLECTION, REPORT_COLLECTION, FEEDBACK_COLLECTION, SUPPLEMENT_COLLECTION].map(async (name) => {
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

function cleanText(value, maxLength) {
  return String(value == null ? '' : value).trim().slice(0, maxLength);
}

function cleanResourceId(value, label = '资源') {
  const id = cleanText(value, 128).replace(/^approved-/, '');
  if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) {
    const error = new Error(`${label} ID 格式不正确`);
    error.code = 'INVALID_RESOURCE_ID';
    throw error;
  }
  return id;
}

function requireStableAccount(userInfo) {
  const loginType = cleanText(userInfo && userInfo.loginType, 40).toUpperCase();
  if (!userInfo || !userInfo.uid || loginType === 'ANONYMOUS') {
    const error = new Error('请先登录正式账号后再参与互动');
    error.code = 'STABLE_ACCOUNT_REQUIRED';
    throw error;
  }
}

function firstDocument(result) {
  if (!result) return null;
  if (Array.isArray(result.data)) return result.data[0] || null;
  return result.data || null;
}

function sortNewest(items) {
  return [...items].sort((left, right) => {
    const leftTime = new Date(left.createdAt || 0).getTime() || 0;
    const rightTime = new Date(right.createdAt || 0).getTime() || 0;
    return rightTime - leftTime;
  });
}

function publicProfile(profile) {
  return {
    uid: profile.uid || profile._id || '',
    nickname: profile.nickname || '楚韵守护者',
    avatarUrl: profile.avatarUrl || '',
    points: Number(profile.points) || 0,
    uploadCount: Number(profile.uploadCount) || 0,
    approvedCount: Number(profile.approvedCount) || 0,
    createdAt: profile.createdAt || null,
    updatedAt: profile.updatedAt || null
  };
}

function submissionView(item, includeOwnerDetails = false) {
  const completeness = Number.isFinite(Number(item.completeness))
    ? Math.max(0, Math.min(100, Math.round(Number(item.completeness))))
    : 60;
  const view = {
    id: item._id || item.id || '',
    title: item.title || '',
    description: item.description || '',
    assetType: item.assetType || 'image',
    mimeType: item.mimeType || '',
    size: Number(item.size) || 0,
    fileID: item.imageFileID || item.fileID || '',
    imageFileID: item.imageFileID || item.fileID || '',
    imageCloudPath: item.imageCloudPath || item.cloudPath || '',
    cloudPath: item.imageCloudPath || item.cloudPath || '',
    regionName: item.regionName || '湖北',
    longitude: Number.isFinite(Number(item.longitude)) ? Number(item.longitude) : null,
    latitude: Number.isFinite(Number(item.latitude)) ? Number(item.latitude) : null,
    locationAccuracy: Number.isFinite(Number(item.locationAccuracy)) ? Number(item.locationAccuracy) : null,
    status: item.status || 'pending',
    contributorName: item.contributorName || '楚韵守护者',
    rewardPoints: Number(item.rewardPoints) || 100,
    createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || null,
    reviewedAt: item.reviewedAt || null,
    reviewNote: item.reviewNote || '',
    reviewPipelineVersion: Number(item.reviewPipelineVersion) || 1,
    aiReviewStatus: item.aiReviewStatus || 'not_requested',
    aiReviewDecision: item.aiReviewDecision || '',
    aiReviewProvider: item.aiReviewProvider || '',
    aiReviewSummary: item.aiReviewSummary || '',
    aiReviewUpdatedAt: item.aiReviewUpdatedAt || null,
    likeCount: Math.max(0, Number(item.likeCount) || 0),
    commentCount: Math.max(0, Number(item.commentCount) || 0),
    completeness,
    board: item.board === 'share' || item.board === 'needs'
      ? item.board
      : (completeness >= 82 ? 'share' : 'needs'),
    supplementCount: Math.max(0, Number(item.supplementCount) || 0),
    approvedSupplements: Array.isArray(item.approvedSupplements)
      ? item.approvedSupplements.slice(-12).map((supplement) => ({
        id: supplement.id || '',
        slotId: supplement.slotId || '',
        slotTitle: supplement.slotTitle || '',
        assetType: supplement.assetType || 'image',
        fileID: supplement.fileID || '',
        contributorName: supplement.contributorName || '社区用户',
        approvedAt: supplement.approvedAt || null
      }))
      : []
  };
  if (includeOwnerDetails) view.userId = item.userId || '';
  return view;
}

async function ensureProfile(uid, userInfo) {
  const ref = db.collection(PROFILE_COLLECTION).doc(uid);
  const existing = firstDocument(await ref.get());
  if (existing) return existing;

  const profile = {
    uid,
    nickname: cleanText(userInfo.nickName || userInfo.name || '', 40) || `楚韵守护者-${uid.slice(-4)}`,
    avatarUrl: '',
    points: 0,
    uploadCount: 0,
    approvedCount: 0,
    createdAt: db.serverDate(),
    updatedAt: db.serverDate()
  };
  await ref.set(profile);
  return profile;
}

async function listOwn(uid, limit = 50) {
  const result = await db.collection(SUBMISSION_COLLECTION)
    .where({ userId: uid })
    .limit(Math.max(1, Math.min(Number(limit) || 50, 100)))
    .get();
  return sortNewest(result.data || []).map((item) => submissionView(item, true));
}

async function listPublic(limit = 30, viewerUid = '') {
  await ensureInteractionCollections();
  const result = await db.collection(SUBMISSION_COLLECTION)
    .where({ status: 'approved' })
    .limit(Math.max(1, Math.min(Number(limit) || 30, 100)))
    .get();
  const items = sortNewest(result.data || []).map((item) => submissionView(item, false));
  const fileList = [...new Set(items.flatMap((item) => [
    item.fileID,
    ...(item.approvedSupplements || []).map((supplement) => supplement.fileID)
  ]).filter(Boolean))].slice(0, 50);
  if (!fileList.length) return items;
  const fileResult = await app.getTempFileURL({
    fileList: fileList.map((fileID) => ({ fileID, maxAge: 7200 }))
  });
  const urls = new Map(
    (fileResult.fileList || []).map((file) => [file.fileID, file.tempFileURL || ''])
  );
  let likedSubmissionIds = new Set();
  if (viewerUid) {
    try {
      const liked = await db.collection(LIKE_COLLECTION)
        .where({ userId: viewerUid })
        .limit(100)
        .get();
      likedSubmissionIds = new Set((liked.data || []).map((item) => item.submissionId));
    } catch (error) {
      console.warn('[appCore] unable to load viewer likes', error);
    }
  }
  return items.map((item) => ({
    ...item,
    fileUrl: urls.get(item.fileID) || '',
    approvedSupplements: (item.approvedSupplements || []).map((supplement) => ({
      ...supplement,
      fileUrl: urls.get(supplement.fileID) || ''
    })),
    viewerLiked: likedSubmissionIds.has(item.id)
  }));
}

function supplementSlotFor(submission, requestedSlotId) {
  const assetType = submission.assetType || 'image';
  const slots = assetType === 'audio'
    ? [
      { id: 'oral-consent', title: '补充讲述授权记录', rewardPoints: 30, completenessGain: 18, accepts: ['audio', 'image'] },
      { id: 'oral-context', title: '补充技艺或地点背景', rewardPoints: 35, completenessGain: 18, accepts: ['image'] }
    ]
    : [
      { id: 'detail-photo', title: '补充关键细节照片', rewardPoints: 35, completenessGain: 18, accepts: ['image'] },
      { id: 'context-photo', title: '补充点位环境照片', rewardPoints: 30, completenessGain: 18, accepts: ['image'] }
    ];
  return slots.find((slot) => slot.id === requestedSlotId) || null;
}

function supplementView(item, includePrivate = false) {
  const view = {
    id: item._id || item.id || '',
    submissionId: item.submissionId || '',
    slotId: item.slotId || '',
    slotTitle: item.slotTitle || '',
    assetType: item.assetType || 'image',
    status: item.status || 'pending',
    rewardPoints: Number(item.rewardPoints) || 0,
    contributorName: item.contributorName || '社区用户',
    createdAt: item.createdAt || null,
    reviewedAt: item.reviewedAt || null,
    reviewNote: item.reviewNote || ''
  };
  if (includePrivate || item.status === 'approved') {
    view.fileID = item.fileID || '';
    view.cloudPath = item.cloudPath || '';
    view.mimeType = item.mimeType || '';
    view.size = Number(item.size) || 0;
  }
  return view;
}

async function listSupplements(uid, event) {
  await ensureInteractionCollections();
  const submissionId = cleanResourceId(event.submissionId, '作品');
  const submission = await getApprovedSubmission(submissionId);
  const result = await db.collection(SUPPLEMENT_COLLECTION)
    .where({ submissionId })
    .limit(100)
    .get();
  const items = sortNewest(result.data || [])
    .filter((item) => item.status === 'approved' || item.userId === uid)
    .map((item) => supplementView(item, item.userId === uid));
  const fileIDs = [...new Set(items.map((item) => item.fileID).filter(Boolean))].slice(0, 50);
  let urls = new Map();
  if (fileIDs.length) {
    const fileResult = await app.getTempFileURL({
      fileList: fileIDs.map((fileID) => ({ fileID, maxAge: 7200 }))
    });
    urls = new Map((fileResult.fileList || []).map((file) => [file.fileID, file.tempFileURL || '']));
  }
  return {
    ok: true,
    action: 'getSupplements',
    submissionId,
    completeness: Number(submission.completeness) || 60,
    board: submission.board || ((Number(submission.completeness) || 60) >= 82 ? 'share' : 'needs'),
    items: items.map((item) => ({ ...item, fileUrl: urls.get(item.fileID) || '' }))
  };
}

async function createSupplement(uid, userInfo, event) {
  requireStableAccount(userInfo);
  await ensureInteractionCollections();
  const submissionId = cleanResourceId(event.submissionId, '作品');
  const slotId = cleanResourceId(event.slotId, '补充位置');
  const submission = await getApprovedSubmission(submissionId);
  const slot = supplementSlotFor(submission, slotId);
  if (!slot) {
    const error = new Error('该作品没有这个补充位置');
    error.code = 'INVALID_SUPPLEMENT_SLOT';
    throw error;
  }
  const assetType = cleanText(event.assetType, 20);
  const mimeType = cleanText(event.mimeType, 120);
  const size = Number(event.size);
  const fileID = cleanText(event.fileID, 1000);
  const cloudPath = cleanText(event.cloudPath, 500);
  if (!ALLOWED_ASSET_TYPES.has(assetType) || !slot.accepts.includes(assetType)) {
    const error = new Error('文件类型不符合该补充位置要求');
    error.code = 'INVALID_SUPPLEMENT_TYPE';
    throw error;
  }
  if (!fileID.startsWith('cloud://') ||
      !cloudPath.startsWith(`supplements/${uid}/`) ||
      !fileID.endsWith(`/${cloudPath}`)) {
    const error = new Error('补充文件路径与当前用户不匹配');
    error.code = 'FILE_OWNER_MISMATCH';
    throw error;
  }
  if (!Number.isFinite(size) || size <= 0 || size > MAX_FILE_BYTES) {
    const error = new Error('补充文件大小必须在 25MB 以内');
    error.code = 'INVALID_FILE_SIZE';
    throw error;
  }
  const profile = await ensureProfile(uid, userInfo);
  const recordId = `${submissionId}_${slotId}_${uid}`;
  const ref = db.collection(SUPPLEMENT_COLLECTION).doc(recordId);
  const existing = firstDocument(await ref.get());
  if (existing && ['pending', 'approved'].includes(existing.status)) {
    const error = new Error(existing.status === 'pending' ? '这项资料已经在等待审核' : '你已经完成过这项补充');
    error.code = 'SUPPLEMENT_EXISTS';
    throw error;
  }
  await ref.set({
    submissionId,
    submissionTitle: submission.title || '未命名采集内容',
    slotId,
    slotTitle: slot.title,
    userId: uid,
    contributorName: profile.nickname || '社区用户',
    assetType,
    mimeType,
    size,
    fileID,
    cloudPath,
    status: 'pending',
    rewardPoints: slot.rewardPoints,
    completenessGain: slot.completenessGain,
    reviewNote: '',
    reviewerId: '',
    reviewedAt: null,
    createdAt: db.serverDate(),
    updatedAt: db.serverDate()
  });
  return {
    ok: true,
    action: 'createSupplement',
    supplement: { id: recordId, submissionId, slotId, slotTitle: slot.title, status: 'pending' }
  };
}

function feedbackView(item) {
  return {
    id: item._id || item.id || '',
    type: item.type || 'other',
    content: item.content || '',
    status: item.status || 'open',
    response: item.response || '',
    createdAt: item.createdAt || null,
    resolvedAt: item.resolvedAt || null
  };
}

async function listOwnFeedback(uid, limit = 10) {
  await ensureInteractionCollections();
  const result = await db.collection(FEEDBACK_COLLECTION)
    .where({ userId: uid })
    .limit(Math.max(1, Math.min(Number(limit) || 10, 30)))
    .get();
  return sortNewest(result.data || []).map(feedbackView);
}

async function bootstrap(uid, userInfo) {
  const profile = await ensureProfile(uid, userInfo);
  const [mySubmissions, publicSubmissions, myFeedback] = await Promise.all([
    listOwn(uid, 50),
    listPublic(30, uid),
    listOwnFeedback(uid, 10)
  ]);
  const stats = mySubmissions.reduce((result, item) => {
    result.total += 1;
    result[item.status] = (result[item.status] || 0) + 1;
    return result;
  }, { total: 0, pending: 0, approved: 0, rejected: 0, needs_revision: 0 });

  return {
    ok: true,
    action: 'bootstrap',
    profile: publicProfile(profile),
    stats,
    mySubmissions,
    publicSubmissions,
    myFeedback
  };
}

async function getApprovedSubmission(submissionId) {
  const submission = firstDocument(
    await db.collection(SUBMISSION_COLLECTION).doc(submissionId).get()
  );
  if (!submission || submission.status !== 'approved') {
    const error = new Error('该作品不存在或尚未公开');
    error.code = 'SUBMISSION_NOT_PUBLIC';
    throw error;
  }
  return submission;
}

async function getInteractions(uid, event) {
  const submissionId = cleanResourceId(event.submissionId, '作品');
  const submission = await getApprovedSubmission(submissionId);
  const requestedOffset = Number(event.commentOffset);
  const requestedLimit = Number(event.commentLimit);
  const commentOffset = Number.isFinite(requestedOffset)
    ? Math.max(0, Math.min(Math.floor(requestedOffset), 100))
    : 0;
  const commentLimit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(Math.floor(requestedLimit), 20))
    : 10;
  const result = await db.collection(COMMENT_COLLECTION)
    .where({ submissionId, status: 'visible' })
    .limit(100)
    .get();
  const allComments = [...(result.data || [])]
    .sort((left, right) => {
      const leftTime = new Date(left.createdAt || 0).getTime() || 0;
      const rightTime = new Date(right.createdAt || 0).getTime() || 0;
      return leftTime - rightTime;
    })
    .map((comment) => ({
      id: comment._id || '',
      parentId: comment.parentId || '',
      content: comment.content || '',
      authorName: comment.authorName || '社区用户',
      createdAt: comment.createdAt || null,
      isMine: comment.userId === uid
    }));
  const comments = allComments.slice(commentOffset, commentOffset + commentLimit);
  let viewerLiked = false;
  let likers = [];
  try {
    const likeId = `${submissionId}_${uid}`;
    viewerLiked = Boolean(firstDocument(await db.collection(LIKE_COLLECTION).doc(likeId).get()));
  } catch (_) {}
  try {
    const liked = await db.collection(LIKE_COLLECTION)
      .where({ submissionId })
      .limit(20)
      .get();
    const likedWithNames = await Promise.all([...(liked.data || [])].map(async (item) => {
      let userName = cleanText(item.userName, 40);
      if (!userName && item.userId) {
        try {
          const profile = firstDocument(
            await db.collection(PROFILE_COLLECTION).doc(item.userId).get()
          );
          userName = cleanText(profile && profile.nickname, 40);
        } catch (_) {}
      }
      return { ...item, resolvedUserName: userName };
    }));
    likers = likedWithNames
      .sort((left, right) => {
        const leftTime = new Date(left.createdAt || 0).getTime() || 0;
        const rightTime = new Date(right.createdAt || 0).getTime() || 0;
        return rightTime - leftTime;
      })
      .map((item) => item.resolvedUserName)
      .filter(Boolean)
      .slice(0, 12);
  } catch (_) {}
  return {
    ok: true,
    action: 'getInteractions',
    submissionId,
    likeCount: Math.max(0, Number(submission.likeCount) || 0),
    commentCount: allComments.length,
    commentOffset,
    commentLimit,
    hasMoreComments: commentOffset + comments.length < allComments.length,
    viewerLiked,
    likers,
    comments
  };
}

async function toggleLike(uid, userInfo, event) {
  requireStableAccount(userInfo);
  const submissionId = cleanResourceId(event.submissionId, '作品');
  const profile = await ensureProfile(uid, userInfo);
  const likeId = `${submissionId}_${uid}`;
  return db.runTransaction(async (transaction) => {
    const submissionRef = transaction.collection(SUBMISSION_COLLECTION).doc(submissionId);
    const likeRef = transaction.collection(LIKE_COLLECTION).doc(likeId);
    const submission = firstDocument(await submissionRef.get());
    if (!submission || submission.status !== 'approved') {
      const error = new Error('该作品不存在或尚未公开');
      error.code = 'SUBMISSION_NOT_PUBLIC';
      throw error;
    }
    const existingLike = firstDocument(await likeRef.get());
    const wasLiked = Boolean(existingLike);
    const currentCount = Math.max(0, Number(submission.likeCount) || 0);
    if (wasLiked) {
      await likeRef.remove();
      await submissionRef.update({
        likeCount: Math.max(0, currentCount - 1),
        updatedAt: db.serverDate()
      });
    } else {
      await likeRef.set({
        submissionId,
        userId: uid,
        userName: profile.nickname || '社区用户',
        createdAt: db.serverDate()
      });
      await submissionRef.update({
        likeCount: currentCount + 1,
        updatedAt: db.serverDate()
      });
    }
    return {
      ok: true,
      action: 'toggleLike',
      submissionId,
      liked: !wasLiked,
      likeCount: wasLiked ? Math.max(0, currentCount - 1) : currentCount + 1
    };
  });
}

async function createComment(uid, userInfo, event) {
  requireStableAccount(userInfo);
  const submissionId = cleanResourceId(event.submissionId, '作品');
  const parentId = event.parentId ? cleanResourceId(event.parentId, '评论') : '';
  const content = cleanText(event.content, 500);
  if (!content) {
    const error = new Error('评论内容不能为空');
    error.code = 'COMMENT_REQUIRED';
    throw error;
  }
  await getApprovedSubmission(submissionId);
  if (parentId) {
    const parent = firstDocument(await db.collection(COMMENT_COLLECTION).doc(parentId).get());
    if (!parent || parent.submissionId !== submissionId || parent.status !== 'visible') {
      const error = new Error('要回复的评论不存在');
      error.code = 'PARENT_COMMENT_NOT_FOUND';
      throw error;
    }
  }
  const profile = await ensureProfile(uid, userInfo);
  const commentId = `${Date.now().toString(36)}_${uid.slice(-10)}_${Math.random().toString(36).slice(2, 8)}`;
  await db.runTransaction(async (transaction) => {
    const submissionRef = transaction.collection(SUBMISSION_COLLECTION).doc(submissionId);
    const commentRef = transaction.collection(COMMENT_COLLECTION).doc(commentId);
    const submission = firstDocument(await submissionRef.get());
    if (!submission || submission.status !== 'approved') {
      const error = new Error('该作品不存在或尚未公开');
      error.code = 'SUBMISSION_NOT_PUBLIC';
      throw error;
    }
    await commentRef.set({
      submissionId,
      userId: uid,
      parentId,
      content,
      authorName: profile.nickname || '社区用户',
      status: 'visible',
      createdAt: db.serverDate(),
      updatedAt: db.serverDate()
    });
    await submissionRef.update({
      commentCount: Math.max(0, Number(submission.commentCount) || 0) + 1,
      updatedAt: db.serverDate()
    });
  });
  return { ok: true, action: 'createComment', submissionId, commentId };
}

async function deleteComment(uid, userInfo, event) {
  requireStableAccount(userInfo);
  const commentId = cleanResourceId(event.commentId, '评论');
  return db.runTransaction(async (transaction) => {
    const commentRef = transaction.collection(COMMENT_COLLECTION).doc(commentId);
    const comment = firstDocument(await commentRef.get());
    if (!comment || comment.status !== 'visible') {
      const error = new Error('评论不存在或已删除');
      error.code = 'COMMENT_NOT_FOUND';
      throw error;
    }
    if (comment.userId !== uid) {
      const error = new Error('只能删除自己的评论');
      error.code = 'FORBIDDEN';
      throw error;
    }
    const submissionRef = transaction.collection(SUBMISSION_COLLECTION).doc(comment.submissionId);
    const submission = firstDocument(await submissionRef.get());
    await commentRef.update({
      status: 'deleted',
      content: '',
      deletedAt: db.serverDate(),
      updatedAt: db.serverDate()
    });
    if (submission) {
      await submissionRef.update({
        commentCount: Math.max(0, (Number(submission.commentCount) || 0) - 1),
        updatedAt: db.serverDate()
      });
    }
    return { ok: true, action: 'deleteComment', commentId, submissionId: comment.submissionId };
  });
}

async function createReport(uid, userInfo, event) {
  requireStableAccount(userInfo);
  const submissionId = cleanResourceId(event.submissionId, '作品');
  const targetType = cleanText(event.targetType || 'submission', 20);
  const targetId = targetType === 'comment'
    ? cleanResourceId(event.targetId, '评论')
    : submissionId;
  const reason = cleanText(event.reason, 40);
  const detail = cleanText(event.detail, 500);
  if (!['submission', 'comment'].includes(targetType) || !ALLOWED_REPORT_REASONS.has(reason)) {
    const error = new Error('举报类型或原因不正确');
    error.code = 'INVALID_REPORT';
    throw error;
  }
  await getApprovedSubmission(submissionId);
  if (targetType === 'comment') {
    const comment = firstDocument(await db.collection(COMMENT_COLLECTION).doc(targetId).get());
    if (!comment || comment.submissionId !== submissionId || comment.status !== 'visible') {
      const error = new Error('被举报的评论不存在');
      error.code = 'COMMENT_NOT_FOUND';
      throw error;
    }
  }
  const reportId = `${targetType}_${targetId}_${uid}`;
  const reportRef = db.collection(REPORT_COLLECTION).doc(reportId);
  const existing = firstDocument(await reportRef.get());
  if (existing && existing.status === 'pending') {
    const error = new Error('你已经举报过该内容，请等待管理员处理');
    error.code = 'REPORT_EXISTS';
    throw error;
  }
  const profile = await ensureProfile(uid, userInfo);
  await reportRef.set({
    submissionId,
    targetType,
    targetId,
    reporterId: uid,
    reporterName: profile.nickname || '社区用户',
    reason,
    detail,
    status: 'pending',
    createdAt: db.serverDate(),
    updatedAt: db.serverDate()
  });
  return { ok: true, action: 'createReport', reportId };
}

async function createFeedback(uid, userInfo, event) {
  requireStableAccount(userInfo);
  await ensureInteractionCollections();
  const profile = await ensureProfile(uid, userInfo);
  const type = cleanText(event.type || 'suggestion', 32);
  const content = cleanText(event.content, 1200);
  const page = cleanText(event.page, 120);
  if (!ALLOWED_FEEDBACK_TYPES.has(type)) {
    const error = new Error('反馈类型不正确');
    error.code = 'INVALID_FEEDBACK_TYPE';
    throw error;
  }
  if (content.length < 5) {
    const error = new Error('请至少填写 5 个字，方便我们理解问题');
    error.code = 'FEEDBACK_TOO_SHORT';
    throw error;
  }
  const result = await db.collection(FEEDBACK_COLLECTION).add({
    userId: uid,
    userName: profile.nickname || '社区用户',
    type,
    content,
    page,
    status: 'open',
    response: '',
    createdAt: db.serverDate(),
    updatedAt: db.serverDate(),
    resolvedAt: null,
    resolvedBy: ''
  });
  return {
    ok: true,
    action: 'createFeedback',
    feedbackId: result.id || result._id || '',
    feedback: {
      id: result.id || result._id || '',
      type,
      content,
      status: 'open',
      response: '',
      createdAt: new Date().toISOString(),
      resolvedAt: null
    }
  };
}

async function updateProfile(uid, userInfo, event) {
  await ensureProfile(uid, userInfo);
  const nickname = cleanText(event.nickname, 40);
  const avatarUrl = cleanText(event.avatarUrl, 500);
  if (!nickname) {
    const error = new Error('昵称不能为空');
    error.code = 'NICKNAME_REQUIRED';
    throw error;
  }

  await db.collection(PROFILE_COLLECTION).doc(uid).update({
    nickname,
    avatarUrl,
    updatedAt: db.serverDate()
  });
  const updated = firstDocument(await db.collection(PROFILE_COLLECTION).doc(uid).get());
  return { ok: true, action: 'updateProfile', profile: publicProfile(updated) };
}

async function createSubmission(uid, userInfo, event) {
  const profile = await ensureProfile(uid, userInfo);
  const assetType = cleanText(event.assetType || 'image', 20);
  const fileID = cleanText(event.fileID || event.imageFileID, 1000);
  const cloudPath = cleanText(event.cloudPath || event.imageCloudPath, 500);
  const title = cleanText(event.title, 120) || '未命名文化采集素材';
  const description = cleanText(event.description, 2000);
  const mimeType = cleanText(event.mimeType, 120);
  const size = Number(event.size) || 0;

  if (!ALLOWED_ASSET_TYPES.has(assetType)) {
    const error = new Error('不支持的素材类型');
    error.code = 'INVALID_ASSET_TYPE';
    throw error;
  }
  if (!fileID || !cloudPath) {
    const error = new Error('缺少云存储文件信息');
    error.code = 'FILE_REQUIRED';
    throw error;
  }
  if (!cloudPath.startsWith(`submissions/${uid}/`)) {
    const error = new Error('文件路径与当前用户不匹配');
    error.code = 'FILE_OWNER_MISMATCH';
    throw error;
  }
  if (!fileID.startsWith('cloud://') || !fileID.endsWith(`/${cloudPath}`)) {
    const error = new Error('云存储文件标识与文件路径不匹配');
    error.code = 'FILE_ID_MISMATCH';
    throw error;
  }
  if (size <= 0 || size > MAX_FILE_BYTES) {
    const error = new Error('文件大小必须在 25MB 以内');
    error.code = 'INVALID_FILE_SIZE';
    throw error;
  }

  const longitude = Number(event.longitude);
  const latitude = Number(event.latitude);
  const locationAccuracy = Number(event.locationAccuracy);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    const error = new Error('请先取得有效定位');
    error.code = 'LOCATION_REQUIRED';
    throw error;
  }

  const record = {
    userId: uid,
    contributorName: profile.nickname || '楚韵守护者',
    title,
    description,
    assetType,
    mimeType,
    size,
    fileID,
    imageFileID: fileID,
    cloudPath,
    imageCloudPath: cloudPath,
    longitude,
    latitude,
    locationAccuracy: Number.isFinite(locationAccuracy) ? locationAccuracy : null,
    regionName: cleanText(event.regionName, 80) || '湖北',
    status: 'pending',
    rewardPoints: 100,
    reviewPipelineVersion: 1,
    aiReviewStatus: 'not_requested',
    aiReviewDecision: '',
    aiReviewProvider: '',
    aiReviewSummary: '',
    aiReviewUpdatedAt: null,
    likeCount: 0,
    commentCount: 0,
    completeness: 60,
    board: 'needs',
    supplementCount: 0,
    approvedSupplements: [],
    source: 'cloudbase_formal_web',
    createdAt: db.serverDate(),
    updatedAt: db.serverDate()
  };

  const added = await db.collection(SUBMISSION_COLLECTION).add(record);
  await db.collection(PROFILE_COLLECTION).doc(uid).update({
    uploadCount: (Number(profile.uploadCount) || 0) + 1,
    updatedAt: db.serverDate()
  });

  return {
    ok: true,
    action: 'createSubmission',
    submission: {
      id: added.id || added._id || '',
      status: 'pending',
      rewardPoints: 100,
      title,
      cloudPath
    }
  };
}

exports.main = async (event = {}) => {
  try {
    const userInfo = app.auth().getUserInfo() || {};
    const uid = cleanText(userInfo.uid, 128);
    if (!uid) {
      return { ok: false, error: { code: 'UNAUTHENTICATED', message: '请先登录' } };
    }

    const action = cleanText(event.action, 40);
    if (action === 'bootstrap') return await bootstrap(uid, userInfo);
    if (action === 'getPublic') {
      return { ok: true, action, items: await listPublic(event.limit, uid) };
    }
    if (action === 'getMySubmissions') {
      return { ok: true, action, items: await listOwn(uid, event.limit) };
    }
    if (action === 'getMyFeedback') {
      return { ok: true, action, items: await listOwnFeedback(uid, event.limit) };
    }
    if (action === 'updateProfile') return await updateProfile(uid, userInfo, event);
    if (action === 'createSubmission') return await createSubmission(uid, userInfo, event);
    if (action === 'getSupplements') return await listSupplements(uid, event);
    if (action === 'createSupplement') return await createSupplement(uid, userInfo, event);
    if (action === 'getInteractions') return await getInteractions(uid, event);
    if (action === 'toggleLike') return await toggleLike(uid, userInfo, event);
    if (action === 'createComment') return await createComment(uid, userInfo, event);
    if (action === 'deleteComment') return await deleteComment(uid, userInfo, event);
    if (action === 'createReport') return await createReport(uid, userInfo, event);
    if (action === 'createFeedback') return await createFeedback(uid, userInfo, event);

    return { ok: false, error: { code: 'INVALID_ACTION', message: '不支持的操作' } };
  } catch (error) {
    console.error('[appCore]', error);
    return {
      ok: false,
      error: {
        code: error && error.code ? String(error.code) : 'OPERATION_FAILED',
        message: error && error.message ? String(error.message) : '云端操作失败'
      }
    };
  }
};
