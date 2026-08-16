'use strict';

const cloudbase = require('@cloudbase/node-sdk');
const {
  PIPELINE_VERSION,
  CONSENT_VERSION,
  CONSENT_SCOPE,
  cleanText,
  sourceFingerprint,
  jobIdFor,
  analysisIdFor,
  isEligibleImageSubmission,
  createMockExtraction,
  normalizeReviewText
} = require('./lib/material-contract');

const app = cloudbase.init({
  env: process.env.TCB_ENV || cloudbase.SYMBOL_CURRENT_ENV
});
const db = app.database();
const JOB_COLLECTION = 'material_analysis_jobs';
const ANALYSIS_COLLECTION = 'material_analyses';
const LOG_COLLECTION = 'material_analysis_logs';
const SUBMISSION_COLLECTION = 'submissions';
const SYNTHETIC_SOURCE_ID = 'synthetic-image-ocr-preview';
let collectionsReady = null;

function getAdminUids() {
  return new Set(String(process.env.ADMIN_UIDS || '')
    .split(/[\s,;]+/)
    .map((item) => item.trim())
    .filter(Boolean));
}

function requireAdmin() {
  const userInfo = app.auth().getUserInfo() || {};
  const uid = cleanText(userInfo.uid, 128);
  if (!uid) throw Object.assign(new Error('请先登录管理员账号'), { code: 'UNAUTHENTICATED' });
  const adminUids = getAdminUids();
  if (!adminUids.size) throw Object.assign(new Error('materialWorker 尚未配置 ADMIN_UIDS'), { code: 'ADMIN_NOT_CONFIGURED' });
  if (!adminUids.has(uid)) throw Object.assign(new Error('当前账号没有材料识别管理权限'), { code: 'FORBIDDEN' });
  return uid;
}

async function ensureCollections() {
  if (!collectionsReady) {
    collectionsReady = Promise.all([JOB_COLLECTION, ANALYSIS_COLLECTION, LOG_COLLECTION].map(async (name) => {
      try {
        await db.createCollection(name);
      } catch (error) {
        const message = `${error && error.code || ''} ${error && error.message || ''}`;
        if (!/exist/i.test(message)) throw error;
      }
    })).catch((error) => {
      collectionsReady = null;
      throw error;
    });
  }
  return collectionsReady;
}

function firstDocument(result) {
  if (!result) return null;
  return Array.isArray(result.data) ? result.data[0] || null : result.data || null;
}

function cleanId(value, label = '记录') {
  const id = cleanText(value, 128);
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    throw Object.assign(new Error(`${label} ID 格式不正确`), { code: 'INVALID_ID' });
  }
  return id;
}

function submissionSource(submission) {
  return {
    sourceType: 'submission',
    sourceId: cleanText(submission._id || submission.id, 128),
    submissionId: cleanText(submission._id || submission.id, 128),
    title: cleanText(submission.title || '未命名图片投稿', 120),
    description: cleanText(submission.description, 1200),
    contributorName: cleanText(submission.contributorName || '社区用户', 120),
    assetType: cleanText(submission.assetType || 'image', 20),
    mimeType: cleanText(submission.mimeType, 120),
    size: Math.max(0, Number(submission.size) || 0),
    fileID: cleanText(submission.imageFileID || submission.fileID, 1000),
    resourceId: cleanText(submission.resourceId, 128),
    synthetic: false
  };
}

function syntheticSource() {
  return {
    sourceType: 'synthetic',
    sourceId: SYNTHETIC_SOURCE_ID,
    submissionId: '',
    title: '虚构图片 OCR 流程演示',
    description: '黄鹤楼碑廊题刻流程演示文本，仅验证任务、校对和审核流程，不对应任何真实投稿。',
    contributorName: '系统演示',
    assetType: 'image',
    mimeType: 'image/jpeg',
    size: 1024,
    fileID: 'synthetic://image-ocr-preview',
    resourceId: '',
    synthetic: true
  };
}

function publicAnalysis(record) {
  if (!record) return null;
  return {
    id: record._id || record.id || '',
    jobId: record.jobId || '',
    sourceType: record.sourceType || '',
    sourceId: record.sourceId || '',
    submissionId: record.submissionId || '',
    status: record.status || '',
    provider: record.provider || '',
    model: record.model || '',
    pipelineVersion: record.pipelineVersion || '',
    simulated: record.simulated === true,
    usableForStory: record.usableForStory === true,
    extractedText: record.extractedText || '',
    reviewedText: record.reviewedText || '',
    reviewDecision: record.reviewDecision || '',
    quality: record.quality || null,
    privacy: record.privacy || null,
    createdAt: record.createdAt || null,
    reviewedAt: record.reviewedAt || null,
    reviewedBy: record.reviewedBy || ''
  };
}

async function analysisForSource(source) {
  const jobId = jobIdFor(source);
  const analysisId = analysisIdFor(jobId);
  return publicAnalysis(firstDocument(await db.collection(ANALYSIS_COLLECTION).doc(analysisId).get()));
}

async function temporaryUrls(sources) {
  const fileIDs = [...new Set(sources
    .filter((source) => !source.synthetic)
    .map((source) => source.fileID)
    .filter((fileID) => fileID.startsWith('cloud://')))].slice(0, 50);
  if (!fileIDs.length) return new Map();
  const result = await app.getTempFileURL({
    fileList: fileIDs.map((fileID) => ({ fileID, maxAge: 3600 }))
  });
  return new Map((result.fileList || []).map((item) => [item.fileID, item.tempFileURL || '']));
}

async function getWorkspace() {
  const result = await db.collection(SUBMISSION_COLLECTION)
    .where({ status: 'approved' })
    .orderBy('createdAt', 'desc')
    .limit(100)
    .get();
  const sources = (result.data || [])
    .filter(isEligibleImageSubmission)
    .map(submissionSource)
    .slice(0, 50);
  const urls = await temporaryUrls(sources);
  const items = await Promise.all(sources.map(async (source) => ({
    ...source,
    fileUrl: urls.get(source.fileID) || '',
    analysis: await analysisForSource(source)
  })));
  const synthetic = syntheticSource();
  return {
    ok: true,
    action: 'getWorkspace',
    mode: 'mock_only',
    pipelineVersion: PIPELINE_VERSION,
    consentVersion: CONSENT_VERSION,
    eligibleCount: items.length,
    needsReviewCount: items.filter((item) => item.analysis && item.analysis.status === 'needs_review').length,
    confirmedCount: items.filter((item) => item.analysis && item.analysis.status === 'approved').length,
    synthetic: { ...synthetic, analysis: await analysisForSource(synthetic) },
    items
  };
}

async function writeMockAnalysis(source, adminUid) {
  const jobId = jobIdFor(source);
  const analysisId = analysisIdFor(jobId);
  const existing = firstDocument(await db.collection(ANALYSIS_COLLECTION).doc(analysisId).get());
  if (existing && existing.status !== 'rejected') {
    return { cached: true, analysis: publicAnalysis(existing) };
  }

  const extraction = createMockExtraction(source);
  const now = db.serverDate();
  await db.collection(JOB_COLLECTION).doc(jobId).set({
    sourceType: source.sourceType,
    sourceId: source.sourceId,
    submissionId: source.submissionId || '',
    sourceFingerprint: sourceFingerprint(source),
    assetType: 'image',
    status: 'completed',
    provider: extraction.provider,
    model: extraction.model,
    pipelineVersion: PIPELINE_VERSION,
    simulated: true,
    usableForStory: false,
    attempts: 1,
    requestedBy: adminUid,
    startedAt: now,
    finishedAt: now,
    updatedAt: now,
    createdAt: now
  });
  const record = {
    jobId,
    sourceType: source.sourceType,
    sourceId: source.sourceId,
    submissionId: source.submissionId || '',
    resourceId: source.resourceId || '',
    sourceFingerprint: sourceFingerprint(source),
    status: 'needs_review',
    provider: extraction.provider,
    model: extraction.model,
    pipelineVersion: PIPELINE_VERSION,
    simulated: true,
    usableForStory: false,
    extractedText: extraction.extractedText,
    reviewedText: '',
    reviewDecision: '',
    blocks: extraction.blocks,
    quality: extraction.quality,
    privacy: extraction.privacy,
    createdBy: adminUid,
    createdAt: now,
    updatedAt: now,
    reviewedAt: null,
    reviewedBy: ''
  };
  await db.collection(ANALYSIS_COLLECTION).doc(analysisId).set(record);
  await db.collection(LOG_COLLECTION).add({
    action: 'mock_analysis_created',
    analysisId,
    jobId,
    sourceType: source.sourceType,
    sourceId: source.sourceId,
    operatorId: adminUid,
    pipelineVersion: PIPELINE_VERSION,
    createdAt: now
  });
  if (source.submissionId) {
    await db.collection(SUBMISSION_COLLECTION).doc(source.submissionId).update({
      materialAnalysisStatus: 'needs_review',
      materialAnalysisId: analysisId,
      materialAnalysisUpdatedAt: now,
      updatedAt: now
    });
  }
  return { cached: false, analysis: publicAnalysis({ _id: analysisId, ...record }) };
}

async function startMockImageAnalysis(event, adminUid) {
  const submissionId = cleanId(event.submissionId, '投稿');
  const submission = firstDocument(await db.collection(SUBMISSION_COLLECTION).doc(submissionId).get());
  if (!submission) throw Object.assign(new Error('没有找到这条投稿'), { code: 'SUBMISSION_NOT_FOUND' });
  if (!isEligibleImageSubmission(submission)) {
    throw Object.assign(new Error('只有已通过、明确授权原始材料识别的图片投稿才能进入处理'), { code: 'MATERIAL_NOT_ELIGIBLE' });
  }
  return { ok: true, action: 'startMockImageAnalysis', submissionId, ...(await writeMockAnalysis(submissionSource(submission), adminUid)) };
}

async function runSyntheticTest(adminUid) {
  const source = syntheticSource();
  const jobId = jobIdFor(source);
  const analysisId = analysisIdFor(jobId);
  await Promise.all([
    db.collection(JOB_COLLECTION).doc(jobId).remove().catch(() => null),
    db.collection(ANALYSIS_COLLECTION).doc(analysisId).remove().catch(() => null)
  ]);
  return { ok: true, action: 'runSyntheticTest', synthetic: true, ...(await writeMockAnalysis(source, adminUid)) };
}

async function reviewAnalysis(event, adminUid) {
  const analysisId = cleanId(event.analysisId, '识别结果');
  const decision = cleanText(event.decision, 20);
  if (!['approved', 'rejected'].includes(decision)) {
    throw Object.assign(new Error('校对结果只能是确认或退回'), { code: 'INVALID_REVIEW_DECISION' });
  }
  const ref = db.collection(ANALYSIS_COLLECTION).doc(analysisId);
  const current = firstDocument(await ref.get());
  if (!current) throw Object.assign(new Error('没有找到识别结果'), { code: 'ANALYSIS_NOT_FOUND' });
  if (current.status !== 'needs_review') {
    throw Object.assign(new Error('这条识别结果已经处理，请刷新页面'), { code: 'ANALYSIS_ALREADY_REVIEWED' });
  }
  const reviewedText = decision === 'approved'
    ? normalizeReviewText(event.reviewedText)
    : cleanText(event.reviewedText, 5000);
  const now = db.serverDate();
  await ref.update({
    status: decision,
    reviewDecision: decision,
    reviewedText,
    reviewedBy: adminUid,
    reviewedAt: now,
    updatedAt: now,
    usableForStory: false
  });
  await db.collection(LOG_COLLECTION).add({
    action: 'analysis_reviewed',
    analysisId,
    jobId: current.jobId || '',
    sourceType: current.sourceType || '',
    sourceId: current.sourceId || '',
    decision,
    operatorId: adminUid,
    simulated: current.simulated === true,
    usableForStory: false,
    createdAt: now
  });
  if (current.submissionId) {
    await db.collection(SUBMISSION_COLLECTION).doc(current.submissionId).update({
      materialAnalysisStatus: decision === 'approved' ? 'confirmed_mock' : 'rejected_mock',
      materialAnalysisId: analysisId,
      materialAnalysisUpdatedAt: now,
      updatedAt: now
    });
  }
  return {
    ok: true,
    action: 'reviewAnalysis',
    analysisId,
    decision,
    usableForStory: false
  };
}

async function status() {
  return {
    ok: true,
    action: 'status',
    enabled: true,
    mode: 'mock_only',
    provider: 'mock',
    pipelineVersion: PIPELINE_VERSION,
    consentVersion: CONSENT_VERSION,
    consentScope: CONSENT_SCOPE,
    readsOriginalFiles: false,
    usableForStory: false
  };
}

exports.main = async (event = {}) => {
  try {
    const adminUid = requireAdmin();
    await ensureCollections();
    const action = cleanText(event.action, 40);
    if (action === 'status') return await status();
    if (action === 'getWorkspace') return await getWorkspace();
    if (action === 'startMockImageAnalysis') return await startMockImageAnalysis(event, adminUid);
    if (action === 'runSyntheticTest') return await runSyntheticTest(adminUid);
    if (action === 'reviewAnalysis') return await reviewAnalysis(event, adminUid);
    return { ok: false, error: { code: 'INVALID_ACTION', message: '不支持的材料识别操作' } };
  } catch (error) {
    console.error('[materialWorker]', error);
    return {
      ok: false,
      error: {
        code: error && error.code ? String(error.code) : 'MATERIAL_OPERATION_FAILED',
        message: error && error.message ? String(error.message) : '材料识别操作失败'
      }
    };
  }
};
