'use strict';

const cloudbase = require('@cloudbase/node-sdk');
const crypto = require('crypto');
const { loadConfig, publicConfig } = require('./lib/config');
const { createTokenHubClient } = require('./lib/tokenhub-client');

const app = cloudbase.init({ env: process.env.TCB_ENV || cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();
const JOB_COLLECTION = 'ai_jobs';
const ANALYSIS_COLLECTION = 'ai_analyses';
const USAGE_COLLECTION = 'ai_usage_daily';
const SUBMISSION_COLLECTION = 'submissions';
const RESOURCE_COLLECTION = 'resources';
const CANDIDATE_COLLECTION = 'ai_link_candidates';
const LINK_COLLECTION = 'story_evidence_links';
const STORY_COLLECTION = 'story_chains';
let collectionsReady = null;

function cleanText(value, maxLength) {
  return String(value == null ? '' : value).trim().slice(0, maxLength);
}

function cleanId(value, label = '记录') {
  const id = cleanText(value, 128);
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    throw Object.assign(new Error(`${label} ID 格式不正确`), { code: 'INVALID_ID' });
  }
  return id;
}

function firstDocument(result) {
  if (!result) return null;
  if (Array.isArray(result.data)) return result.data[0] || null;
  return result.data || null;
}

function dateMs(value) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function getAdminUids() {
  return new Set(String(process.env.ADMIN_UIDS || '').split(/[\s,;]+/).map((item) => item.trim()).filter(Boolean));
}

function requireAdmin() {
  const userInfo = app.auth().getUserInfo() || {};
  const uid = cleanText(userInfo.uid, 128);
  if (!uid) throw Object.assign(new Error('请先登录管理员账号'), { code: 'UNAUTHENTICATED' });
  const admins = getAdminUids();
  if (!admins.size) throw Object.assign(new Error('storyWorker 尚未配置 ADMIN_UIDS'), { code: 'ADMIN_NOT_CONFIGURED' });
  if (!admins.has(uid)) throw Object.assign(new Error('当前账号没有 AI 管理权限'), { code: 'FORBIDDEN' });
  return uid;
}

async function ensureCollections() {
  if (!collectionsReady) {
    collectionsReady = Promise.all([JOB_COLLECTION, ANALYSIS_COLLECTION, USAGE_COLLECTION, CANDIDATE_COLLECTION, STORY_COLLECTION].map(async (name) => {
      try {
        await db.createCollection(name);
      } catch (error) {
        const details = `${error && error.code || ''} ${error && error.message || ''}`;
        if (!/exist/i.test(details)) throw error;
      }
    })).catch((error) => {
      collectionsReady = null;
      throw error;
    });
  }
  return collectionsReady;
}

function syntheticInput() {
  return {
    submission: {
      title: '虚构测试：黄鹤楼碑廊题刻记录',
      description: '这是一条不对应真实用户的联调文本：照片内容为黄鹤楼东侧碑廊的一处题刻，记录其当前保存状态。',
      assetType: 'text',
      regionName: '武汉 · 武昌'
    },
    allowedResources: [
      { id: 'yellow-crane-tower', title: '武汉黄鹤楼周边碑刻', type: 'landmark', summary: '黄鹤楼及周边碑刻、楼阁营造与题刻文化。' },
      { id: 'hubei-museum', title: '湖北省博物馆东湖片区', type: 'landmark', summary: '湖北历史文物与曾侯乙编钟等馆藏文化。' },
      { id: 'wuhan-eastlake', title: '武汉东湖文化路线', type: 'route', summary: '串联东湖周边文化空间的游览路线。' }
    ]
  };
}

function syntheticJobId(config) {
  const fingerprint = crypto.createHash('sha256')
    .update(`${config.provider}:${config.textModel}:${config.promptVersion}:synthetic-v1`)
    .digest('hex')
    .slice(0, 32);
  return `ai_smoke_${fingerprint}`;
}

function analysisIdFor(jobId) {
  return `analysis_${jobId}`;
}

function candidateIdFor(submissionId, resourceId) {
  const digest = crypto.createHash('sha256')
    .update(`${submissionId}:${resourceId}`, 'utf8')
    .digest('hex')
    .slice(0, 40);
  return `ai_candidate_${digest}`;
}

function sanitizedSubmission(item) {
  return {
    title: cleanText(item.title || item.description || '社区投稿', 120),
    description: cleanText(item.description, 1800),
    assetType: cleanText(item.assetType || 'image', 20),
    regionName: cleanText(item.regionName || '湖北', 80)
  };
}

function sanitizedResource(item) {
  const region = item && item.region;
  const regionText = region && typeof region === 'object'
    ? [region.province, region.city, region.district, region.name].filter(Boolean).join(' · ')
    : region;
  return {
    id: cleanText(item._id || item.id, 128),
    title: cleanText(item.title, 120),
    type: cleanText(item.type || 'article', 40),
    summary: cleanText(item.summary || item.description, 260),
    region: cleanText(regionText, 120)
  };
}

function submissionJobId(config, submissionId, input) {
  const fingerprint = crypto.createHash('sha256')
    .update(JSON.stringify({
      provider: config.provider,
      model: config.textModel,
      promptVersion: config.promptVersion,
      submissionId,
      input
    }))
    .digest('hex')
    .slice(0, 32);
  return `ai_story_${fingerprint}`;
}

function storyDraftJobId(config, resourceId, input) {
  const fingerprint = crypto.createHash('sha256')
    .update(JSON.stringify({
      provider: config.provider,
      model: config.textModel,
      storyPromptVersion: config.storyPromptVersion,
      resourceId,
      input
    }))
    .digest('hex')
    .slice(0, 32);
  return `ai_draft_${fingerprint}`;
}

function storyDraftIdFor(jobId) {
  return `story_${jobId.slice('ai_draft_'.length)}`;
}

function storyReadiness(input) {
  const sources = Array.isArray(input && input.sources) ? input.sources : [];
  const descriptions = sources.map((item) => cleanText(item && item.submission && item.submission.description, 900));
  const evidence = sources.map((item) => cleanText(item && item.evidenceSummary, 500));
  const supplementCount = sources.reduce((total, item) => (
    total + (Array.isArray(item && item.submission && item.submission.supplements) ? item.submission.supplements.length : 0)
  ), 0);
  const relationTypes = new Set(sources.map((item) => item.relationType).filter(Boolean));
  const hasDetailedDescription = descriptions.some((text) => text.length >= 60);
  const hasUsefulEvidence = evidence.some((text) => text.length >= 20);
  const score = Math.min(100,
    Math.min(50, sources.length * 25)
    + Math.min(15, supplementCount * 8)
    + (hasDetailedDescription ? 20 : 0)
    + (hasUsefulEvidence ? 15 : 0)
    + (relationTypes.size >= 2 ? 15 : 0)
  );
  const missing = [];
  if (sources.length < 2 && supplementCount < 1) missing.push('再补充一份不同角度的已审核资料');
  if (!hasDetailedDescription) missing.push('补充至少 60 字的现场细节或背景说明');
  if (!hasUsefulEvidence) missing.push('把投稿与文化资源的关系说明得更具体');
  if (relationTypes.size < 2) missing.push('补充题刻、口述、地点现状或时间变化等不同类型证据');
  return {
    ready: sources.length >= 1 && score >= 55,
    score,
    sourceCount: sources.length,
    supplementCount,
    missing: missing.slice(0, 3)
  };
}

function shanghaiDayId() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function ensureSyntheticJob(config, adminUid) {
  const jobId = syntheticJobId(config);
  const ref = db.collection(JOB_COLLECTION).doc(jobId);
  let current = firstDocument(await ref.get());
  if (!current) {
    const now = db.serverDate();
    await ref.set({
      type: 'synthetic_contract_test',
      schemaVersion: 1,
      idempotencyKey: jobId,
      status: 'pending',
      attempts: 0,
      maxAttempts: config.maxAttempts,
      provider: config.provider,
      model: config.textModel,
      promptVersion: config.promptVersion,
      input: syntheticInput(),
      synthetic: true,
      createdBy: adminUid,
      createdAt: now,
      updatedAt: now
    });
    current = firstDocument(await ref.get());
  }
  return { jobId, job: current };
}

async function reserveDailyCall(config, jobId) {
  const dayId = shanghaiDayId();
  await db.runTransaction(async (transaction) => {
    const ref = transaction.collection(USAGE_COLLECTION).doc(dayId);
    const current = firstDocument(await ref.get());
    const callsAttempted = Math.max(0, Number(current && current.callsAttempted) || 0);
    const totalTokens = Math.max(0, Number(current && current.totalTokens) || 0);
    if (callsAttempted >= config.dailyCallLimit) {
      throw Object.assign(new Error('已达到 AI 每日调用次数上限'), { code: 'AI_DAILY_CALL_LIMIT' });
    }
    if (totalTokens >= config.dailyTokenLimit) {
      throw Object.assign(new Error('已达到 AI 每日 Token 上限'), { code: 'AI_DAILY_TOKEN_LIMIT' });
    }
    const record = {
      day: dayId,
      callsAttempted: callsAttempted + 1,
      callsCompleted: Math.max(0, Number(current && current.callsCompleted) || 0),
      inputTokens: Math.max(0, Number(current && current.inputTokens) || 0),
      outputTokens: Math.max(0, Number(current && current.outputTokens) || 0),
      totalTokens,
      lastJobId: jobId,
      updatedAt: db.serverDate()
    };
    if (current) await ref.update(record);
    else await ref.set({ ...record, createdAt: db.serverDate() });
  });
  return dayId;
}

async function recordCompletedUsage(dayId, jobId, usage) {
  await db.runTransaction(async (transaction) => {
    const ref = transaction.collection(USAGE_COLLECTION).doc(dayId);
    const current = firstDocument(await ref.get()) || {};
    const inputTokens = Math.max(0, Number(usage.inputTokens) || 0);
    const outputTokens = Math.max(0, Number(usage.outputTokens) || 0);
    const totalTokens = Math.max(inputTokens + outputTokens, Number(usage.totalTokens) || 0);
    await ref.update({
      callsCompleted: Math.max(0, Number(current.callsCompleted) || 0) + 1,
      inputTokens: Math.max(0, Number(current.inputTokens) || 0) + inputTokens,
      outputTokens: Math.max(0, Number(current.outputTokens) || 0) + outputTokens,
      totalTokens: Math.max(0, Number(current.totalTokens) || 0) + totalTokens,
      lastJobId: jobId,
      updatedAt: db.serverDate()
    });
  });
}

async function acquireJob(jobId, config) {
  return db.runTransaction(async (transaction) => {
    const ref = transaction.collection(JOB_COLLECTION).doc(jobId);
    const current = firstDocument(await ref.get());
    if (!current) throw Object.assign(new Error('AI 测试任务不存在'), { code: 'AI_JOB_NOT_FOUND' });
    if (current.status === 'completed') return { cached: true, job: current };
    const attempts = Math.max(0, Number(current.attempts) || 0);
    if (attempts >= config.maxAttempts) {
      throw Object.assign(new Error('AI 测试任务已达到最大尝试次数'), { code: 'AI_JOB_MAX_ATTEMPTS' });
    }
    if (current.status === 'processing' && Date.now() - dateMs(current.lockedAt) < config.lockTimeoutMs) {
      throw Object.assign(new Error('AI 测试任务正在运行'), { code: 'AI_JOB_BUSY' });
    }
    await ref.update({
      status: 'processing',
      attempts: attempts + 1,
      lockedAt: db.serverDate(),
      lockedBy: 'storyWorker',
      lastError: null,
      updatedAt: db.serverDate()
    });
    return { cached: false, job: { ...current, attempts: attempts + 1 } };
  });
}

async function publicResult(jobId) {
  const job = firstDocument(await db.collection(JOB_COLLECTION).doc(jobId).get());
  if (!job) return null;
  let analysis = null;
  if (job.analysisId) analysis = firstDocument(await db.collection(ANALYSIS_COLLECTION).doc(job.analysisId).get());
  return {
    job: {
      id: jobId,
      type: job.type,
      status: job.status,
      attempts: Math.max(0, Number(job.attempts) || 0),
      maxAttempts: Math.max(1, Number(job.maxAttempts) || 1),
      provider: job.provider || '',
      model: job.model || '',
      promptVersion: job.promptVersion || '',
      synthetic: job.synthetic === true,
      lastError: job.lastError ? { code: job.lastError.code || '', message: job.lastError.message || '', retryable: job.lastError.retryable === true } : null
    },
    analysis: analysis ? {
      id: job.analysisId,
      output: analysis.output || null,
      usage: analysis.usage || {},
      providerAttempts: Math.max(1, Number(analysis.providerAttempts) || 1),
      provider: analysis.provider || '',
      model: analysis.model || '',
      promptVersion: analysis.promptVersion || '',
      synthetic: analysis.synthetic === true
    } : null
  };
}

async function eligibleSubmission(submissionId) {
  const submission = firstDocument(await db.collection(SUBMISSION_COLLECTION).doc(submissionId).get());
  if (!submission) {
    throw Object.assign(new Error('没有找到这条投稿'), { code: 'SUBMISSION_NOT_FOUND' });
  }
  if (submission.status !== 'approved') {
    throw Object.assign(new Error('只有审核通过的投稿可以进行 AI 链迹分析'), { code: 'APPROVED_SUBMISSION_REQUIRED' });
  }
  if (submission.aiAnalysisConsent !== true) {
    throw Object.assign(new Error('投稿人没有授权 AI 分析，不能创建任务'), { code: 'AI_CONSENT_REQUIRED' });
  }
  return submission;
}

async function realWorkspace() {
  const [submissionResult, candidateResult] = await Promise.all([
    db.collection(SUBMISSION_COLLECTION).where({ status: 'approved' }).limit(100).get(),
    db.collection(CANDIDATE_COLLECTION).limit(100).get()
  ]);
  const submissions = (submissionResult.data || [])
    .filter((item) => item.aiAnalysisConsent === true)
    .map((item) => ({
      id: item._id || item.id || '',
      title: cleanText(item.title || item.description || '社区投稿', 120),
      description: cleanText(item.description, 300),
      assetType: cleanText(item.assetType || 'image', 20),
      regionName: cleanText(item.regionName || '湖北', 80),
      aiAnalysisStatus: cleanText(item.aiAnalysisStatus || 'eligible', 40),
      analysisId: cleanText(item.aiAnalysisId, 128)
    }));
  const submissionMap = new Map(submissions.map((item) => [item.id, item]));
  const candidates = (candidateResult.data || [])
    .filter((item) => item.synthetic !== true)
    .map((item) => ({
      id: item._id || item.id || '',
      submissionId: item.submissionId || '',
      submissionTitle: item.submissionTitle || submissionMap.get(item.submissionId)?.title || '社区投稿',
      resourceId: item.resourceId || '',
      resourceTitle: item.resourceTitle || '文化资源',
      relationType: item.relationType || 'supports_story',
      confidence: Math.max(0, Math.min(1, Number(item.confidence) || 0)),
      reason: cleanText(item.reason, 500),
      evidence: cleanText(item.evidence, 500),
      status: cleanText(item.status || 'pending_admin', 40),
      analysisId: cleanText(item.analysisId, 128)
    }));
  return {
    ok: true,
    action: 'getSubmissionWorkspace',
    submissions,
    candidates,
    counts: {
      consentedApproved: submissions.length,
      pendingCandidates: candidates.filter((item) => item.status === 'pending_admin').length,
      confirmedCandidates: candidates.filter((item) => item.status === 'confirmed').length,
      rejectedCandidates: candidates.filter((item) => item.status === 'rejected').length
    }
  };
}

async function ensureSubmissionJob(config, adminUid, submissionId, input) {
  const jobId = submissionJobId(config, submissionId, input);
  const ref = db.collection(JOB_COLLECTION).doc(jobId);
  let current = firstDocument(await ref.get());
  if (!current) {
    const now = db.serverDate();
    await ref.set({
      type: 'submission_story_link_analysis',
      schemaVersion: 1,
      idempotencyKey: jobId,
      submissionId,
      status: 'pending',
      attempts: 0,
      maxAttempts: config.maxAttempts,
      provider: config.provider,
      model: config.textModel,
      promptVersion: config.promptVersion,
      input,
      synthetic: false,
      createdBy: adminUid,
      createdAt: now,
      updatedAt: now
    });
    current = firstDocument(await ref.get());
  }
  return { jobId, job: current };
}

async function persistRealAnalysis({ config, adminUid, submissionId, submission, jobId, result }) {
  const analysisId = analysisIdFor(jobId);
  const resourceIds = [...new Set((result.output.candidateLinks || []).map((item) => item.resourceId))];
  const resourcePairs = await Promise.all(resourceIds.map(async (resourceId) => [
    resourceId,
    firstDocument(await db.collection(RESOURCE_COLLECTION).doc(resourceId).get())
  ]));
  const resourceMap = new Map(resourcePairs);
  const validCandidates = (result.output.candidateLinks || [])
    .filter((candidate) => {
      const resource = resourceMap.get(candidate.resourceId);
      return resource && resource.status === 'published';
    });
  await db.runTransaction(async (transaction) => {
    const submissionRef = transaction.collection(SUBMISSION_COLLECTION).doc(submissionId);
    const latestSubmission = firstDocument(await submissionRef.get());
    if (!latestSubmission || latestSubmission.status !== 'approved' || latestSubmission.aiAnalysisConsent !== true) {
      throw Object.assign(new Error('投稿状态或 AI 授权已变化，已停止保存结果'), { code: 'AI_ELIGIBILITY_CHANGED' });
    }
    const candidateStates = await Promise.all(validCandidates.map(async (candidate) => {
      const candidateId = candidateIdFor(submissionId, candidate.resourceId);
      const candidateRef = transaction.collection(CANDIDATE_COLLECTION).doc(candidateId);
      return { candidate, candidateId, candidateRef, current: firstDocument(await candidateRef.get()) };
    }));
    await transaction.collection(ANALYSIS_COLLECTION).doc(analysisId).set({
      jobId,
      submissionId,
      type: 'story_link_analysis',
      schemaVersion: 1,
      provider: config.provider,
      model: config.textModel,
      promptVersion: config.promptVersion,
      providerRequestId: result.providerRequestId,
      providerAttempts: result.providerAttempts,
      output: result.output,
      usage: result.usage,
      synthetic: false,
      createdBy: adminUid,
      createdAt: db.serverDate()
    });
    for (const state of candidateStates) {
      const { candidate, candidateRef, current } = state;
      const resource = resourceMap.get(candidate.resourceId);
      if (current && (current.status === 'confirmed' || current.status === 'rejected')) continue;
      const record = {
        submissionId,
        submissionTitle: submission.title || submission.description || '社区投稿',
        resourceId: candidate.resourceId,
        resourceTitle: resource.title || '文化资源',
        relationType: candidate.relationType,
        confidence: candidate.confidence,
        reason: candidate.reason,
        evidence: candidate.evidence,
        analysisId,
        jobId,
        status: 'pending_admin',
        synthetic: false,
        proposedBy: 'ai',
        updatedAt: db.serverDate()
      };
      if (current) await candidateRef.update(record);
      else await candidateRef.set({ ...record, createdAt: db.serverDate() });
    }
    await submissionRef.update({
      aiAnalysisStatus: (result.output.candidateLinks || []).length ? 'candidate_ready' : 'analyzed_no_candidates',
      aiAnalysisId: analysisId,
      aiAnalysisUpdatedAt: db.serverDate(),
      updatedAt: db.serverDate()
    });
    await transaction.collection(JOB_COLLECTION).doc(jobId).update({
      status: 'completed',
      analysisId,
      finishedAt: db.serverDate(),
      lockedAt: null,
      lockedBy: '',
      updatedAt: db.serverDate()
    });
  });
  return analysisId;
}

async function runSubmissionAnalysis(config, adminUid, event) {
  if (!config.enabled) throw Object.assign(new Error('AI_ENABLED 仍为 false'), { code: 'AI_DISABLED' });
  if (!config.apiKey) throw Object.assign(new Error('尚未配置 TOKENHUB_API_KEY'), { code: 'AI_KEY_NOT_CONFIGURED' });
  const submissionId = cleanId(event.submissionId, '投稿');
  const submission = await eligibleSubmission(submissionId);
  const resourceResult = await db.collection(RESOURCE_COLLECTION).where({ status: 'published' }).limit(50).get();
  const allowedResources = (resourceResult.data || []).map(sanitizedResource).filter((item) => item.id && item.title);
  if (!allowedResources.length) {
    throw Object.assign(new Error('当前没有可供匹配的已发布文化资源'), { code: 'AI_RESOURCES_REQUIRED' });
  }
  const input = { submission: sanitizedSubmission(submission), allowedResources };
  const { jobId } = await ensureSubmissionJob(config, adminUid, submissionId, input);
  const acquired = await acquireJob(jobId, config);
  if (acquired.cached) {
    return { ok: true, action: 'analyzeSubmission', cached: true, submissionId, ...(await publicResult(jobId)) };
  }

  let dayId = '';
  try {
    await db.collection(SUBMISSION_COLLECTION).doc(submissionId).update({
      aiAnalysisStatus: 'processing',
      aiAnalysisUpdatedAt: db.serverDate(),
      updatedAt: db.serverDate()
    });
    const client = createTokenHubClient({ config });
    const result = await client.analyze(acquired.job.input || input, {
      beforeAttempt: async () => {
        dayId = await reserveDailyCall(config, jobId);
      }
    });
    await persistRealAnalysis({ config, adminUid, submissionId, submission, jobId, result });
    await recordCompletedUsage(dayId, jobId, result.usage);
    return { ok: true, action: 'analyzeSubmission', cached: false, submissionId, ...(await publicResult(jobId)) };
  } catch (error) {
    const safeError = {
      code: cleanText(error && error.code || 'AI_CALL_FAILED', 80),
      message: cleanText(error && error.message || 'AI 接口调用失败', 500),
      retryable: error && error.retryable === true
    };
    try {
      await Promise.all([
        db.collection(JOB_COLLECTION).doc(jobId).update({
          status: 'failed',
          lastError: safeError,
          lockedAt: null,
          lockedBy: '',
          finishedAt: db.serverDate(),
          updatedAt: db.serverDate()
        }),
        db.collection(SUBMISSION_COLLECTION).doc(submissionId).update({
          aiAnalysisStatus: 'failed',
          aiAnalysisLastError: safeError,
          aiAnalysisUpdatedAt: db.serverDate(),
          updatedAt: db.serverDate()
        })
      ]);
    } catch (_) {}
    throw Object.assign(new Error(safeError.message), { code: safeError.code });
  }
}

async function buildConfirmedStoryInput(resourceId) {
  const resource = firstDocument(await db.collection(RESOURCE_COLLECTION).doc(resourceId).get());
  if (!resource || resource.status !== 'published') {
    throw Object.assign(new Error('文化资源不存在或尚未发布'), { code: 'PUBLISHED_RESOURCE_REQUIRED' });
  }
  const linkResult = await db.collection(LINK_COLLECTION).where({ resourceId }).limit(100).get();
  const links = (linkResult.data || []).filter((item) => item.status === 'confirmed').slice(0, 30);
  const sources = [];
  for (const link of links) {
    const linkId = cleanText(link._id || link.id, 128);
    if (!linkId) continue;
    const submission = firstDocument(await db.collection(SUBMISSION_COLLECTION).doc(link.submissionId || '').get());
    if (!submission || submission.status !== 'approved') continue;
    sources.push({
      linkId,
      relationType: cleanText(link.relationType || 'supports_story', 40),
      evidenceSummary: cleanText(link.evidenceSummary, 500),
      submission: {
        title: cleanText(submission.title || submission.description || '社区投稿', 120),
        description: cleanText(submission.description, 900),
        assetType: cleanText(submission.assetType || 'image', 20),
        regionName: cleanText(submission.regionName || '湖北', 80),
        recordedAt: dateMs(submission.createdAt) ? new Date(dateMs(submission.createdAt)).toISOString() : '',
        materialRevision: Math.max(0, Number(submission.storyMaterialRevision) || 0),
        supplements: (Array.isArray(submission.approvedSupplements) ? submission.approvedSupplements : []).slice(-6).map((item) => ({
          slotTitle: cleanText(item && item.slotTitle, 120),
          assetType: cleanText(item && item.assetType || 'image', 20),
          approvedAt: dateMs(item && item.approvedAt) ? new Date(dateMs(item.approvedAt)).toISOString() : ''
        }))
      }
    });
  }
  if (!sources.length) {
    throw Object.assign(new Error('该资源还没有可用于写作的已确认链迹'), { code: 'CONFIRMED_STORY_SOURCES_REQUIRED' });
  }
  return {
    resource: {
      id: resourceId,
      title: cleanText(resource.title, 120),
      type: cleanText(resource.type || 'article', 40),
      summary: cleanText(resource.summary || resource.description, 800)
    },
    sources
  };
}

async function ensureStoryDraftJob(config, adminUid, resourceId, input) {
  const jobId = storyDraftJobId(config, resourceId, input);
  const ref = db.collection(JOB_COLLECTION).doc(jobId);
  let current = firstDocument(await ref.get());
  if (!current) {
    const now = db.serverDate();
    await ref.set({
      type: 'sourced_story_draft',
      schemaVersion: 1,
      idempotencyKey: jobId,
      resourceId,
      status: 'pending',
      attempts: 0,
      maxAttempts: config.maxAttempts,
      provider: config.provider,
      model: config.textModel,
      promptVersion: config.storyPromptVersion,
      input,
      synthetic: false,
      createdBy: adminUid,
      createdAt: now,
      updatedAt: now
    });
    current = firstDocument(await ref.get());
  }
  return { jobId, job: current };
}

async function runStoryDraft(config, adminUid, event) {
  if (!config.enabled) throw Object.assign(new Error('AI_ENABLED 仍为 false'), { code: 'AI_DISABLED' });
  if (!config.apiKey) throw Object.assign(new Error('尚未配置 TOKENHUB_API_KEY'), { code: 'AI_KEY_NOT_CONFIGURED' });
  const resourceId = cleanId(event.resourceId, '资源');
  const input = await buildConfirmedStoryInput(resourceId);
  const readiness = storyReadiness(input);
  if (!readiness.ready) {
    throw Object.assign(new Error(`资料暂不足以生成可靠短故事：${readiness.missing.join('；')}`), {
      code: 'STORY_EVIDENCE_INSUFFICIENT'
    });
  }
  const { jobId } = await ensureStoryDraftJob(config, adminUid, resourceId, input);
  const acquired = await acquireJob(jobId, config);
  const draftId = storyDraftIdFor(jobId);
  if (acquired.cached) {
    return { ok: true, action: 'generateStoryDraft', cached: true, resourceId, draftId };
  }
  let dayId = '';
  try {
    const client = createTokenHubClient({ config });
    const result = await client.draftStory(acquired.job.input || input, {
      beforeAttempt: async () => {
        dayId = await reserveDailyCall(config, jobId);
      }
    });
    const sourceLinkIds = [...new Set(result.output.chapters.flatMap((chapter) => chapter.sourceLinkIds))];
    await db.runTransaction(async (transaction) => {
      const currentLinks = await Promise.all(sourceLinkIds.map(async (linkId) => ({
        linkId,
        record: firstDocument(await transaction.collection(LINK_COLLECTION).doc(linkId).get())
      })));
      if (currentLinks.some(({ record }) => !record || record.status !== 'confirmed' || record.resourceId !== resourceId)) {
        throw Object.assign(new Error('链迹来源状态已变化，已停止保存故事草稿'), { code: 'STORY_SOURCE_CHANGED' });
      }
      const now = db.serverDate();
      await transaction.collection(STORY_COLLECTION).doc(draftId).set({
        resourceId,
        resourceTitle: input.resource.title,
        title: result.output.title,
        introduction: result.output.introduction,
        chapters: result.output.chapters,
        closing: result.output.closing,
        sourceLinkIds,
        status: 'draft',
        version: 1,
        provider: config.provider,
        model: config.textModel,
        promptVersion: config.storyPromptVersion,
        jobId,
        usage: result.usage,
        createdBy: adminUid,
        createdAt: now,
        updatedAt: now
      });
      await transaction.collection(JOB_COLLECTION).doc(jobId).update({
        status: 'completed',
        storyDraftId: draftId,
        finishedAt: now,
        lockedAt: null,
        lockedBy: '',
        updatedAt: now
      });
    });
    await recordCompletedUsage(dayId, jobId, result.usage);
    return { ok: true, action: 'generateStoryDraft', cached: false, resourceId, draftId };
  } catch (error) {
    const safeError = {
      code: cleanText(error && error.code || 'AI_STORY_FAILED', 80),
      message: cleanText(error && error.message || 'AI 故事草稿生成失败', 500),
      retryable: error && error.retryable === true
    };
    try {
      await db.collection(JOB_COLLECTION).doc(jobId).update({
        status: 'failed',
        lastError: safeError,
        lockedAt: null,
        lockedBy: '',
        finishedAt: db.serverDate(),
        updatedAt: db.serverDate()
      });
    } catch (_) {}
    throw Object.assign(new Error(safeError.message), { code: safeError.code });
  }
}

async function storyDraftWorkspace() {
  const [linkResult, resourceResult, storyResult] = await Promise.all([
    db.collection(LINK_COLLECTION).limit(100).get(),
    db.collection(RESOURCE_COLLECTION).where({ status: 'published' }).limit(100).get(),
    db.collection(STORY_COLLECTION).limit(100).get()
  ]);
  const links = (linkResult.data || []).filter((item) => item.status === 'confirmed');
  const submissionIds = [...new Set(links.map((item) => item.submissionId).filter(Boolean))];
  const submissionPairs = await Promise.all(submissionIds.map(async (submissionId) => ({
    submissionId,
    record: firstDocument(await db.collection(SUBMISSION_COLLECTION).doc(submissionId).get())
  })));
  const submissions = new Map(submissionPairs.map((item) => [item.submissionId, item.record]));
  const counts = new Map();
  links.forEach((item) => counts.set(item.resourceId, (counts.get(item.resourceId) || 0) + 1));
  const supplementIdsByResource = new Map();
  const latestMaterialByResource = new Map();
  links.forEach((link) => {
    const submission = submissions.get(link.submissionId);
    if (!submission || submission.status !== 'approved') return;
    if (!supplementIdsByResource.has(link.resourceId)) supplementIdsByResource.set(link.resourceId, new Set());
    (Array.isArray(submission.approvedSupplements) ? submission.approvedSupplements : []).forEach((supplement, index) => {
      supplementIdsByResource.get(link.resourceId).add(supplement.id || `${link.submissionId}_${index}`);
    });
    const materialTime = Math.max(
      dateMs(submission.storyMaterialUpdatedAt),
      ...(Array.isArray(submission.approvedSupplements) ? submission.approvedSupplements : []).map((item) => dateMs(item && item.approvedAt))
    );
    latestMaterialByResource.set(link.resourceId, Math.max(latestMaterialByResource.get(link.resourceId) || 0, materialTime));
  });
  const latestPublishedByResource = new Map();
  (storyResult.data || []).filter((item) => item.status === 'published').forEach((story) => {
    latestPublishedByResource.set(story.resourceId, Math.max(
      latestPublishedByResource.get(story.resourceId) || 0,
      dateMs(story.publishedAt)
    ));
  });
  const resources = (resourceResult.data || [])
    .filter((item) => counts.has(item._id || item.id))
    .map((item) => {
      const resourceId = item._id || item.id || '';
      const confirmedSourceCount = counts.get(resourceId) || 0;
      const approvedSupplementCount = (supplementIdsByResource.get(resourceId) || new Set()).size;
      const latestMaterialAt = latestMaterialByResource.get(resourceId) || 0;
      const latestPublishedAt = latestPublishedByResource.get(resourceId) || 0;
      return {
        id: resourceId,
        title: cleanText(item.title, 120),
        type: cleanText(item.type || 'article', 40),
        confirmedSourceCount,
        approvedSupplementCount,
        hasNewMaterial: latestMaterialAt > latestPublishedAt,
        readiness: {
          ready: confirmedSourceCount >= 2 || approvedSupplementCount >= 1,
          score: Math.min(100, confirmedSourceCount * 25 + approvedSupplementCount * 8),
          missing: confirmedSourceCount >= 2 || approvedSupplementCount >= 1
            ? []
            : ['建议再补充一份不同角度的已审核资料；系统还会在生成前检查文字与关系说明。']
        }
      };
    });
  const drafts = (storyResult.data || []).map((item) => ({
    id: item._id || item.id || '',
    resourceId: item.resourceId || '',
    resourceTitle: item.resourceTitle || '',
    title: item.title || '',
    introduction: item.introduction || '',
    chapters: Array.isArray(item.chapters) ? item.chapters : [],
    closing: item.closing || '',
    sourceLinkIds: Array.isArray(item.sourceLinkIds) ? item.sourceLinkIds : [],
    status: item.status || 'draft',
    version: Math.max(1, Number(item.version) || 1)
  }));
  return {
    ok: true,
    action: 'getStoryDraftWorkspace',
    resources,
    drafts,
    counts: {
      sourceReadyResources: resources.length,
      drafts: drafts.filter((item) => item.status === 'draft').length,
      published: drafts.filter((item) => item.status === 'published').length
    }
  };
}

async function runSyntheticTest(config, adminUid) {
  if (!config.enabled) throw Object.assign(new Error('AI_ENABLED 仍为 false，尚未允许真实模型调用'), { code: 'AI_DISABLED' });
  if (!config.apiKey) throw Object.assign(new Error('尚未配置 TOKENHUB_API_KEY'), { code: 'AI_KEY_NOT_CONFIGURED' });
  const { jobId } = await ensureSyntheticJob(config, adminUid);
  const acquired = await acquireJob(jobId, config);
  if (acquired.cached) return { ok: true, action: 'runSyntheticTest', cached: true, ...(await publicResult(jobId)) };

  let dayId = '';
  try {
    const client = createTokenHubClient({ config });
    const result = await client.analyze(acquired.job.input || syntheticInput(), {
      beforeAttempt: async () => {
        dayId = await reserveDailyCall(config, jobId);
      }
    });
    const analysisId = analysisIdFor(jobId);
    await db.runTransaction(async (transaction) => {
      await transaction.collection(ANALYSIS_COLLECTION).doc(analysisId).set({
        jobId,
        type: 'story_link_analysis',
        schemaVersion: 1,
        provider: config.provider,
        model: config.textModel,
        promptVersion: config.promptVersion,
        providerRequestId: result.providerRequestId,
        providerAttempts: result.providerAttempts,
        output: result.output,
        usage: result.usage,
        synthetic: true,
        createdBy: adminUid,
        createdAt: db.serverDate()
      });
      await transaction.collection(JOB_COLLECTION).doc(jobId).update({
        status: 'completed',
        analysisId,
        finishedAt: db.serverDate(),
        lockedAt: null,
        lockedBy: '',
        updatedAt: db.serverDate()
      });
    });
    await recordCompletedUsage(dayId, jobId, result.usage);
    return { ok: true, action: 'runSyntheticTest', cached: false, ...(await publicResult(jobId)) };
  } catch (error) {
    const safeError = {
      code: cleanText(error && error.code || 'AI_CALL_FAILED', 80),
      message: cleanText(error && error.message || 'AI 接口调用失败', 500),
      retryable: error && error.retryable === true
    };
    if (error && error.providerRequestId) safeError.providerRequestId = cleanText(error.providerRequestId, 160);
    if (error && error.providerAttempts) safeError.providerAttempts = Math.max(1, Number(error.providerAttempts) || 1);
    try {
      await db.collection(JOB_COLLECTION).doc(jobId).update({
        status: 'failed',
        lastError: safeError,
        lockedAt: null,
        lockedBy: '',
        finishedAt: db.serverDate(),
        updatedAt: db.serverDate()
      });
    } catch (_) {}
    throw Object.assign(new Error(safeError.message), { code: safeError.code });
  }
}

async function status(config) {
  const jobId = syntheticJobId(config);
  const result = await publicResult(jobId);
  const dayId = shanghaiDayId();
  const usage = firstDocument(await db.collection(USAGE_COLLECTION).doc(dayId).get());
  return {
    ok: true,
    action: 'status',
    config: publicConfig(config),
    syntheticTest: result,
    todayUsage: usage ? {
      day: dayId,
      callsAttempted: Math.max(0, Number(usage.callsAttempted) || 0),
      callsCompleted: Math.max(0, Number(usage.callsCompleted) || 0),
      inputTokens: Math.max(0, Number(usage.inputTokens) || 0),
      outputTokens: Math.max(0, Number(usage.outputTokens) || 0),
      totalTokens: Math.max(0, Number(usage.totalTokens) || 0)
    } : { day: dayId, callsAttempted: 0, callsCompleted: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 }
  };
}

exports.main = async (event = {}) => {
  try {
    const adminUid = requireAdmin();
    const config = loadConfig();
    await ensureCollections();
    const action = cleanText(event.action, 40);
    if (action === 'status') return await status(config);
    if (action === 'getSubmissionWorkspace') return await realWorkspace();
    if (action === 'analyzeSubmission') return await runSubmissionAnalysis(config, adminUid, event);
    if (action === 'getStoryDraftWorkspace') return await storyDraftWorkspace();
    if (action === 'generateStoryDraft') return await runStoryDraft(config, adminUid, event);
    if (action === 'runSyntheticTest') return await runSyntheticTest(config, adminUid);
    return { ok: false, error: { code: 'INVALID_ACTION', message: '不支持的 AI 操作' } };
  } catch (error) {
    console.error('[storyWorker]', error && error.code || 'ERROR', error && error.message || '');
    return {
      ok: false,
      error: {
        code: cleanText(error && error.code || 'AI_WORKER_FAILED', 80),
        message: cleanText(error && error.message || 'AI 云函数执行失败', 500)
      }
    };
  }
};
