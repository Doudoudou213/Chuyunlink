'use strict';

const cloudbase = require('@cloudbase/node-sdk');

const app = cloudbase.init({
  env: process.env.TCB_ENV || cloudbase.SYMBOL_CURRENT_ENV
});
const db = app.database();

const PROFILE_COLLECTION = 'user_profiles';
const SUBMISSION_COLLECTION = 'submissions';
const ALLOWED_ASSET_TYPES = new Set(['image', 'audio', 'video']);
const MAX_FILE_BYTES = 25 * 1024 * 1024;

function cleanText(value, maxLength) {
  return String(value == null ? '' : value).trim().slice(0, maxLength);
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
    aiReviewUpdatedAt: item.aiReviewUpdatedAt || null
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

async function listPublic(limit = 30) {
  const result = await db.collection(SUBMISSION_COLLECTION)
    .where({ status: 'approved' })
    .limit(Math.max(1, Math.min(Number(limit) || 30, 100)))
    .get();
  const items = sortNewest(result.data || []).map((item) => submissionView(item, false));
  const fileList = items.map((item) => item.fileID).filter(Boolean).slice(0, 50);
  if (!fileList.length) return items;
  const fileResult = await app.getTempFileURL({
    fileList: fileList.map((fileID) => ({ fileID, maxAge: 7200 }))
  });
  const urls = new Map(
    (fileResult.fileList || []).map((file) => [file.fileID, file.tempFileURL || ''])
  );
  return items.map((item) => ({ ...item, fileUrl: urls.get(item.fileID) || '' }));
}

async function bootstrap(uid, userInfo) {
  const profile = await ensureProfile(uid, userInfo);
  const [mySubmissions, publicSubmissions] = await Promise.all([
    listOwn(uid, 50),
    listPublic(30)
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
    publicSubmissions
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
      return { ok: true, action, items: await listPublic(event.limit) };
    }
    if (action === 'getMySubmissions') {
      return { ok: true, action, items: await listOwn(uid, event.limit) };
    }
    if (action === 'updateProfile') return await updateProfile(uid, userInfo, event);
    if (action === 'createSubmission') return await createSubmission(uid, userInfo, event);

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
