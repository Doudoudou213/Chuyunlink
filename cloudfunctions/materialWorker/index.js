'use strict';

const cloudbase = require('@cloudbase/node-sdk');
const {
  PIPELINE_VERSION,
  MOCK_PIPELINE_VERSION,
  REAL_OCR_PIPELINE_VERSION,
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
const { loadConfig, isRealOcrReady, publicConfig } = require('./lib/config');
const { createTencentOcrClient } = require('./lib/tencent-ocr-client');

const app = cloudbase.init({
  env: process.env.TCB_ENV || cloudbase.SYMBOL_CURRENT_ENV
});
const db = app.database();
const JOB_COLLECTION = 'material_analysis_jobs';
const ANALYSIS_COLLECTION = 'material_analyses';
const LOG_COLLECTION = 'material_analysis_logs';
const USAGE_COLLECTION = 'material_usage_daily';
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
    collectionsReady = Promise.all([JOB_COLLECTION, ANALYSIS_COLLECTION, LOG_COLLECTION, USAGE_COLLECTION].map(async (name) => {
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
    providerAttempts: Math.max(0, Number(record.providerAttempts) || 0),
    requestId: record.requestId || '',
    lastError: record.lastError || null,
    createdAt: record.createdAt || null,
    reviewedAt: record.reviewedAt || null,
    reviewedBy: record.reviewedBy || ''
  };
}

async function analysisForSource(source, pipelineVersion = MOCK_PIPELINE_VERSION) {
  const jobId = jobIdFor(source, pipelineVersion);
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

async function getWorkspace(config) {
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
  const activePipelineVersion = isRealOcrReady(config)
    ? REAL_OCR_PIPELINE_VERSION
    : MOCK_PIPELINE_VERSION;
  const items = await Promise.all(sources.map(async (source) => ({
    ...source,
    fileUrl: urls.get(source.fileID) || '',
    realOcrEligible: source.size > 0 && source.size <= config.maxImageBytes,
    realOcrBlockedReason: source.size <= 0
      ? '文件大小信息缺失，不能安全计费调用'
      : source.size > config.maxImageBytes
        ? `图片超过 ${Math.floor(config.maxImageBytes / 1024 / 1024)}MB，暂不调用真实 OCR`
        : '',
    analysis: await analysisForSource(source, activePipelineVersion)
  })));
  const synthetic = syntheticSource();
  return {
    ok: true,
    action: 'getWorkspace',
    ...publicConfig(config),
    pipelineVersion: activePipelineVersion,
    consentVersion: CONSENT_VERSION,
    eligibleCount: items.length,
    needsReviewCount: items.filter((item) => item.analysis && item.analysis.status === 'needs_review').length,
    confirmedCount: items.filter((item) => item.analysis && item.analysis.status === 'approved').length,
    synthetic: { ...synthetic, analysis: await analysisForSource(synthetic, MOCK_PIPELINE_VERSION) },
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

function shanghaiDayId(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date).replaceAll('/', '-');
}

async function reserveDailyCall(config, jobId) {
  const dayId = shanghaiDayId();
  await db.runTransaction(async (transaction) => {
    const ref = transaction.collection(USAGE_COLLECTION).doc(dayId);
    const current = firstDocument(await ref.get());
    const callCount = Math.max(0, Number(current && current.callCount) || 0);
    if (callCount >= config.dailyCallLimit) {
      throw Object.assign(new Error(`今日真实 OCR 已达到 ${config.dailyCallLimit} 次安全上限`), { code: 'MATERIAL_DAILY_LIMIT_REACHED' });
    }
    const record = {
      provider: 'tencent_ocr',
      dayId,
      callCount: callCount + 1,
      latestJobId: jobId,
      updatedAt: db.serverDate()
    };
    if (current) await ref.update(record);
    else await ref.set({ ...record, createdAt: db.serverDate() });
  });
  return dayId;
}

async function acquireRealJob(source, adminUid) {
  const jobId = jobIdFor(source, REAL_OCR_PIPELINE_VERSION);
  const analysisId = analysisIdFor(jobId);
  const existingAnalysis = firstDocument(await db.collection(ANALYSIS_COLLECTION).doc(analysisId).get());
  if (existingAnalysis && ['needs_review', 'approved'].includes(existingAnalysis.status)) {
    return { acquired: false, cached: true, jobId, analysisId, analysis: publicAnalysis(existingAnalysis) };
  }
  return db.runTransaction(async (transaction) => {
    const ref = transaction.collection(JOB_COLLECTION).doc(jobId);
    const current = firstDocument(await ref.get());
    if (current && current.status === 'processing') {
      throw Object.assign(new Error('这张图片正在识别，请稍后刷新'), { code: 'MATERIAL_JOB_BUSY' });
    }
    const runs = Math.max(0, Number(current && current.runs) || 0);
    if (current && current.status === 'failed' && runs >= 2) {
      throw Object.assign(new Error('这张图片已连续识别失败两次，请检查配置后再创建新版本'), { code: 'MATERIAL_JOB_RETRY_LIMIT' });
    }
    const now = db.serverDate();
    const record = {
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      submissionId: source.submissionId || '',
      sourceFingerprint: sourceFingerprint(source),
      assetType: 'image',
      status: 'processing',
      provider: 'tencent_ocr',
      model: 'GeneralBasicOCR-2018-11-19',
      pipelineVersion: REAL_OCR_PIPELINE_VERSION,
      simulated: false,
      usableForStory: false,
      runs: runs + 1,
      requestedBy: adminUid,
      startedAt: now,
      finishedAt: null,
      lastError: null,
      updatedAt: now
    };
    if (current) await ref.update(record);
    else await ref.set({ ...record, createdAt: now });
    return { acquired: true, cached: false, jobId, analysisId };
  });
}

async function shortImageUrl(fileID) {
  const result = await app.getTempFileURL({
    fileList: [{ fileID, maxAge: 600 }]
  });
  const item = (result.fileList || [])[0] || {};
  const url = cleanText(item.tempFileURL, 2000);
  if (!url.startsWith('https://')) {
    throw Object.assign(new Error('无法为图片生成安全短时地址'), { code: 'MATERIAL_TEMP_URL_FAILED' });
  }
  return url;
}

async function persistRealAnalysis({ source, adminUid, jobId, analysisId, extraction, providerAttempts }) {
  const now = db.serverDate();
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
    pipelineVersion: REAL_OCR_PIPELINE_VERSION,
    simulated: false,
    usableForStory: false,
    extractedText: extraction.extractedText,
    rawTextHash: extraction.rawTextHash,
    reviewedText: '',
    reviewDecision: '',
    blocks: extraction.blocks,
    quality: extraction.quality,
    privacy: extraction.privacy,
    requestId: extraction.requestId,
    providerAttempts,
    createdBy: adminUid,
    createdAt: now,
    updatedAt: now,
    reviewedAt: null,
    reviewedBy: ''
  };
  await Promise.all([
    db.collection(ANALYSIS_COLLECTION).doc(analysisId).set(record),
    db.collection(JOB_COLLECTION).doc(jobId).update({
      status: 'completed',
      providerAttempts,
      requestId: extraction.requestId,
      finishedAt: now,
      updatedAt: now
    }),
    db.collection(LOG_COLLECTION).add({
      action: 'real_ocr_completed',
      analysisId,
      jobId,
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      operatorId: adminUid,
      provider: extraction.provider,
      pipelineVersion: REAL_OCR_PIPELINE_VERSION,
      providerAttempts,
      privacyFlags: extraction.privacy.flags,
      createdAt: now
    })
  ]);
  await db.collection(SUBMISSION_COLLECTION).doc(source.submissionId).update({
    materialAnalysisStatus: 'needs_review',
    materialAnalysisId: analysisId,
    materialAnalysisUpdatedAt: now,
    updatedAt: now
  });
  return publicAnalysis({ _id: analysisId, ...record });
}

async function runRealImageAnalysis(config, event, adminUid) {
  if (!isRealOcrReady(config)) {
    throw Object.assign(new Error('真实 OCR 尚未启用或专用密钥未配置'), { code: 'REAL_OCR_NOT_READY' });
  }
  const submissionId = cleanId(event.submissionId, '投稿');
  const submission = firstDocument(await db.collection(SUBMISSION_COLLECTION).doc(submissionId).get());
  if (!submission) throw Object.assign(new Error('没有找到这条投稿'), { code: 'SUBMISSION_NOT_FOUND' });
  if (!isEligibleImageSubmission(submission)) {
    throw Object.assign(new Error('只有已通过、明确授权原始材料识别的图片投稿才能进入处理'), { code: 'MATERIAL_NOT_ELIGIBLE' });
  }
  const source = submissionSource(submission);
  if (source.size <= 0 || source.size > config.maxImageBytes) {
    throw Object.assign(new Error(`真实 OCR 第一版只处理 1B–${Math.floor(config.maxImageBytes / 1024 / 1024)}MB 的图片`), { code: 'MATERIAL_IMAGE_TOO_LARGE' });
  }
  const acquired = await acquireRealJob(source, adminUid);
  if (acquired.cached) {
    return { ok: true, action: 'runRealImageAnalysis', submissionId, cached: true, analysis: acquired.analysis };
  }
  try {
    const client = createTencentOcrClient({ config });
    const imageUrl = await shortImageUrl(source.fileID);
    const result = await client.recognizeImage(imageUrl, {
      beforeAttempt: () => reserveDailyCall(config, acquired.jobId)
    });
    const analysis = await persistRealAnalysis({
      source,
      adminUid,
      jobId: acquired.jobId,
      analysisId: acquired.analysisId,
      extraction: result.extraction,
      providerAttempts: result.providerAttempts
    });
    return { ok: true, action: 'runRealImageAnalysis', submissionId, cached: false, analysis };
  } catch (error) {
    const safeError = {
      code: cleanText(error && error.code || 'TENCENT_OCR_FAILED', 100),
      message: cleanText(error && error.message || '真实 OCR 调用失败', 500),
      retryable: error && error.retryable === true
    };
    const now = db.serverDate();
    await Promise.all([
      db.collection(JOB_COLLECTION).doc(acquired.jobId).update({
        status: 'failed',
        lastError: safeError,
        finishedAt: now,
        updatedAt: now
      }).catch(() => null),
      db.collection(SUBMISSION_COLLECTION).doc(submissionId).update({
        materialAnalysisStatus: 'failed',
        materialAnalysisLastError: safeError,
        materialAnalysisUpdatedAt: now,
        updatedAt: now
      }).catch(() => null),
      db.collection(LOG_COLLECTION).add({
        action: 'real_ocr_failed',
        jobId: acquired.jobId,
        sourceType: source.sourceType,
        sourceId: source.sourceId,
        operatorId: adminUid,
        error: safeError,
        createdAt: now
      }).catch(() => null)
    ]);
    throw error;
  }
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
  const usableForStory = decision === 'approved' && current.simulated !== true && current.provider === 'tencent_ocr';
  const now = db.serverDate();
  await ref.update({
    status: decision,
    reviewDecision: decision,
    reviewedText,
    reviewedBy: adminUid,
    reviewedAt: now,
    updatedAt: now,
    usableForStory
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
    usableForStory,
    createdAt: now
  });
  if (current.submissionId) {
    await db.collection(SUBMISSION_COLLECTION).doc(current.submissionId).update({
      materialAnalysisStatus: decision === 'approved'
        ? usableForStory ? 'confirmed' : 'confirmed_mock'
        : current.simulated === true ? 'rejected_mock' : 'rejected',
      materialAnalysisId: analysisId,
      materialDerivedTextReady: usableForStory,
      materialAnalysisUpdatedAt: now,
      updatedAt: now
    });
  }
  return {
    ok: true,
    action: 'reviewAnalysis',
    analysisId,
    decision,
    usableForStory
  };
}

async function status(config) {
  return {
    ok: true,
    action: 'status',
    ...publicConfig(config),
    enabled: isRealOcrReady(config),
    pipelineVersion: isRealOcrReady(config) ? REAL_OCR_PIPELINE_VERSION : MOCK_PIPELINE_VERSION,
    consentVersion: CONSENT_VERSION,
    consentScope: CONSENT_SCOPE,
    readsOriginalFiles: isRealOcrReady(config),
    approvedRealResultsCanFeedStory: true
  };
}

exports.main = async (event = {}) => {
  try {
    const adminUid = requireAdmin();
    await ensureCollections();
    const config = loadConfig();
    const action = cleanText(event.action, 40);
    if (action === 'status') return await status(config);
    if (action === 'getWorkspace') return await getWorkspace(config);
    if (action === 'startMockImageAnalysis') return await startMockImageAnalysis(event, adminUid);
    if (action === 'runRealImageAnalysis') return await runRealImageAnalysis(config, event, adminUid);
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
