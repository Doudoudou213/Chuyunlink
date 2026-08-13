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
let collectionsReady = null;

function cleanText(value, maxLength) {
  return String(value == null ? '' : value).trim().slice(0, maxLength);
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
    collectionsReady = Promise.all([JOB_COLLECTION, ANALYSIS_COLLECTION, USAGE_COLLECTION].map(async (name) => {
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
      provider: analysis.provider || '',
      model: analysis.model || '',
      promptVersion: analysis.promptVersion || '',
      synthetic: analysis.synthetic === true
    } : null
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
    dayId = await reserveDailyCall(config, jobId);
    const client = createTokenHubClient({ config });
    const result = await client.analyze(acquired.job.input || syntheticInput());
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
