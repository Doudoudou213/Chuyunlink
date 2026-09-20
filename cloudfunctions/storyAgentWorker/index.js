'use strict';

const cloudbase = require('@cloudbase/node-sdk');
const { loadConfig, publicConfig } = require('./lib/config');
const { validateAgentOutput, classifyRelationRisk } = require('./lib/contract');
const { createTokenHubClient } = require('./lib/tokenhub-client');
const {
  cleanText,
  sanitizeSubmission,
  sanitizeResource,
  selectRelevantResources,
  resolveEntityMatches
} = require('./lib/retrieval');
const {
  inputFingerprint,
  jobIdFor,
  candidateIdFor,
  estimateTokens,
  estimateCostYuan
} = require('./lib/job-contract');

const app = cloudbase.init({ env: process.env.TCB_ENV || cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();
const JOBS = 'story_agent_jobs';
const STEPS = 'story_agent_steps';
const CANDIDATES = 'story_agent_candidates';
const USAGE = 'story_agent_usage_daily';
const SUBMISSIONS = 'submissions';
const RESOURCES = 'resources';
const EVIDENCE = 'story_evidence_links';
const ENTITIES = 'story_entities';
const RELATIONS = 'story_relations';
let collectionsReady = null;

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

function cleanId(value, label = '记录') {
  const id = cleanText(value, 128);
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    throw Object.assign(new Error(`${label} ID 格式不正确`), { code: 'INVALID_ID' });
  }
  return id;
}

function hasCurrentAiConsent(item) {
  return Boolean(item && item.status === 'approved' && item.aiAnalysisConsent === true
    && item.aiConsentVersion === 'ai-analysis-consent-v1'
    && item.aiConsentScope === 'approved_public_submission_text'
    && !item.aiConsentRevokedAt && item.aiAnalysisStatus !== 'consent_revoked');
}

function getAdminUids() {
  return new Set(String(process.env.ADMIN_UIDS || '').split(/[\s,;]+/).map((item) => item.trim()).filter(Boolean));
}

function requireAdmin() {
  const userInfo = app.auth().getUserInfo() || {};
  const uid = cleanText(userInfo.uid, 128);
  if (!uid) throw Object.assign(new Error('请先登录管理员账号'), { code: 'UNAUTHENTICATED' });
  const admins = getAdminUids();
  if (!admins.size) throw Object.assign(new Error('storyAgentWorker 尚未配置 ADMIN_UIDS'), { code: 'ADMIN_NOT_CONFIGURED' });
  if (!admins.has(uid)) throw Object.assign(new Error('当前账号没有研究智能体管理权限'), { code: 'FORBIDDEN' });
  return uid;
}

async function ensureCollections() {
  if (!collectionsReady) {
    collectionsReady = Promise.all([JOBS, STEPS, CANDIDATES, USAGE].map(async (name) => {
      try { await db.createCollection(name); } catch (error) {
        if (!/exist/i.test(`${error && error.code || ''} ${error && error.message || ''}`)) throw error;
      }
    })).catch((error) => { collectionsReady = null; throw error; });
  }
  return collectionsReady;
}

function shanghaiDayId() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function safeError(error) {
  return {
    code: cleanText(error && error.code || 'AGENT_FAILED', 80),
    message: cleanText(error && error.message || '智能体任务失败', 300),
    retryable: error && error.retryable === true
  };
}

function stepIdFor(jobId, sequence) {
  return `${jobId}_step_${String(sequence).padStart(2, '0')}`;
}

async function recordStep(jobId, sequence, name, status, metadata = {}) {
  const ref = db.collection(STEPS).doc(stepIdFor(jobId, sequence));
  const current = firstDocument(await ref.get());
  const record = {
    jobId,
    sequence,
    name: cleanText(name, 80),
    status: cleanText(status, 40),
    metadata,
    updatedAt: db.serverDate()
  };
  if (current) await ref.update(record);
  else await ref.set({ ...record, createdAt: db.serverDate() });
}

async function eligibleSubmission(submissionId, config) {
  const item = firstDocument(await db.collection(SUBMISSIONS).doc(submissionId).get());
  if (!item) throw Object.assign(new Error('没有找到这条投稿'), { code: 'SUBMISSION_NOT_FOUND' });
  if (!hasCurrentAiConsent(item)) {
    throw Object.assign(new Error('投稿审核状态或 AI 授权已失效'), { code: 'AI_CONSENT_REQUIRED' });
  }
  const submission = sanitizeSubmission(item);
  const textLength = `${submission.title}${submission.description}`.replace(/\s+/g, '').length;
  if (textLength < config.minTextChars) {
    throw Object.assign(new Error('投稿文字过少，暂不进入智能体分析'), { code: 'AGENT_TEXT_TOO_SHORT' });
  }
  submission.description = submission.description.slice(0, Math.max(100, config.maxInputChars - submission.title.length - 300));
  return { item, submission };
}

async function loadContext(submission, config) {
  const [resourceResult, evidenceResult, entityResult, relationResult] = await Promise.all([
    db.collection(RESOURCES).where({ status: 'published' }).limit(100).get(),
    db.collection(EVIDENCE).limit(200).get(),
    db.collection(ENTITIES).limit(200).get(),
    db.collection(RELATIONS).limit(200).get()
  ]);
  const allowedResources = selectRelevantResources(submission, resourceResult.data || [], config.topResourceLimit);
  const resourceIds = new Set(allowedResources.map((item) => item.id));
  const possibleEvidence = (evidenceResult.data || [])
    .filter((item) => resourceIds.has(cleanText(item.resourceId, 128))
      && item.status === 'confirmed' && item.needsSourceReview !== true);
  const checkedEvidence = await Promise.all(possibleEvidence.map(async (item) => {
    if (!item.submissionId) return null;
    const origin = firstDocument(await db.collection(SUBMISSIONS).doc(item.submissionId).get());
    if (!hasCurrentAiConsent(origin)) return null;
    return {
      id: cleanText(item._id || item.id, 128),
      resourceId: cleanText(item.resourceId, 128),
      summary: cleanText(item.evidenceSummary || item.summary || item.evidence || item.note, 300),
      sourceType: cleanText(item.sourceType || item.materialType || 'submission', 40)
    };
  }));
  const evidenceLinks = checkedEvidence.filter((item) => item && item.id && item.summary).slice(0, 60);
  const relationResourcesByEntity = new Map();
  (relationResult.data || []).filter((item) => item.status === 'confirmed' && item.needsSourceReview !== true)
    .forEach((relation) => {
      [relation.fromEntityId, relation.toEntityId].filter(Boolean).forEach((entityId) => {
        if (!relationResourcesByEntity.has(entityId)) relationResourcesByEntity.set(entityId, new Set());
        if (relation.resourceId) relationResourcesByEntity.get(entityId).add(cleanText(relation.resourceId, 128));
      });
    });
  const knownEntities = (entityResult.data || [])
    .filter((item) => {
      const linkedResources = [item.resourceId, ...(Array.isArray(item.resourceIds) ? item.resourceIds : [])]
        .map((id) => cleanText(id, 128)).filter(Boolean);
      return item.status === 'confirmed' && item.needsSourceReview !== true
        && linkedResources.some((id) => resourceIds.has(id));
    })
    .map((item) => ({
      id: cleanText(item._id || item.id, 128),
      name: cleanText(item.name, 100),
      entityType: cleanText(item.entityType, 40),
      aliases: (Array.isArray(item.aliases) ? item.aliases : []).map((value) => cleanText(value, 80)).filter(Boolean).slice(0, 6),
      resourceId: cleanText(item.resourceId, 128),
      resourceIds: (Array.isArray(item.resourceIds) ? item.resourceIds : []).map((value) => cleanText(value, 128)).filter(Boolean),
      region: item.region || {},
      relationResourceIds: [...(relationResourcesByEntity.get(item._id || item.id) || new Set())]
    }))
    .filter((item) => item.id && item.name)
    .slice(0, 80);
  return { allowedResources, evidenceLinks, knownEntities };
}

async function assertCurrentSources(reader, submissionId, input, jobId) {
  const primary = firstDocument(await reader.collection(SUBMISSIONS).doc(submissionId).get());
  if (!hasCurrentAiConsent(primary)) {
    throw Object.assign(new Error('投稿 AI 授权已变化，停止分析'), { code: 'AGENT_CONSENT_CHANGED' });
  }
  const job = firstDocument(await reader.collection(JOBS).doc(jobId).get());
  if (!job || job.status !== 'processing') {
    throw Object.assign(new Error('任务已停止，不能继续分析'), { code: 'AGENT_JOB_STOPPED' });
  }
  for (const source of input.evidenceLinks || []) {
    const link = firstDocument(await reader.collection(EVIDENCE).doc(source.id).get());
    const origin = link && link.submissionId
      ? firstDocument(await reader.collection(SUBMISSIONS).doc(link.submissionId).get()) : null;
    if (!link || link.status !== 'confirmed' || link.needsSourceReview === true
      || link.resourceId !== source.resourceId || !hasCurrentAiConsent(origin)) {
      throw Object.assign(new Error('关联来源授权或状态已变化，停止分析'), { code: 'AGENT_SOURCE_CHANGED' });
    }
  }
}

async function ensureJob(config, adminUid, submissionId, input) {
  const fingerprint = inputFingerprint(config, submissionId, input);
  const jobId = jobIdFor(fingerprint);
  const ref = db.collection(JOBS).doc(jobId);
  let job = firstDocument(await ref.get());
  if (!job) {
    await ref.set({
      type: 'submission_research_shadow',
      schemaVersion: 1,
      idempotencyKey: fingerprint,
      submissionId,
      status: 'pending',
      shadowMode: true,
      attempts: 0,
      modelCalls: 0,
      provider: config.provider,
      model: config.textModel,
      promptVersion: config.promptVersion,
      codeVersion: config.codeVersion,
      input,
      createdBy: adminUid,
      createdAt: db.serverDate(),
      updatedAt: db.serverDate()
    });
    job = firstDocument(await ref.get());
  }
  return { jobId, job };
}

async function acquireJob(jobId, config) {
  return db.runTransaction(async (transaction) => {
    const ref = transaction.collection(JOBS).doc(jobId);
    const current = firstDocument(await ref.get());
    if (!current) throw Object.assign(new Error('智能体任务不存在'), { code: 'AGENT_JOB_NOT_FOUND' });
    if (['awaiting_review', 'completed'].includes(current.status)) return { cached: true, job: current };
    const lockedAt = dateMs(current.lockedAt);
    if (current.status === 'processing' && Date.now() - lockedAt < config.lockTimeoutMs) {
      throw Object.assign(new Error('智能体任务正在运行'), { code: 'AGENT_JOB_BUSY' });
    }
    const attempts = Math.max(0, Number(current.attempts) || 0);
    if (attempts >= 3) throw Object.assign(new Error('智能体任务已达到最大执行次数'), { code: 'AGENT_JOB_MAX_ATTEMPTS' });
    await ref.update({
      status: 'processing', attempts: attempts + 1, lockedAt: db.serverDate(), lockedBy: 'storyAgentWorker',
      lastError: null, updatedAt: db.serverDate()
    });
    return { cached: false, job: { ...current, attempts: attempts + 1 } };
  });
}

async function reserveAttempt(config, jobId, estimatedInputTokens, attempt) {
  const dayId = shanghaiDayId();
  const predictedTokens = estimatedInputTokens + config.maxOutputTokens;
  await db.runTransaction(async (transaction) => {
    const usageRef = transaction.collection(USAGE).doc(dayId);
    const jobRef = transaction.collection(JOBS).doc(jobId);
    const [usageResult, jobResult] = await Promise.all([usageRef.get(), jobRef.get()]);
    const usage = firstDocument(usageResult) || {};
    const job = firstDocument(jobResult) || {};
    const callsAttempted = Math.max(0, Number(usage.callsAttempted) || 0);
    const reservedTokens = Math.max(0, Number(usage.reservedTokens) || 0);
    const totalTokens = Math.max(0, Number(usage.totalTokens) || 0);
    const modelCalls = Math.max(0, Number(job.modelCalls) || 0);
    if (callsAttempted >= config.dailyCallLimit) throw Object.assign(new Error('已达到智能体每日调用次数上限'), { code: 'AGENT_DAILY_CALL_LIMIT' });
    if (totalTokens + reservedTokens + predictedTokens > config.dailyTokenLimit) throw Object.assign(new Error('本次调用可能超过智能体每日 Token 上限'), { code: 'AGENT_DAILY_TOKEN_LIMIT' });
    if (modelCalls >= config.maxCallsPerJob) throw Object.assign(new Error('当前任务已达到模型调用次数上限'), { code: 'AGENT_JOB_CALL_LIMIT' });
    const record = {
      day: dayId,
      callsAttempted: callsAttempted + 1,
      callsCompleted: Math.max(0, Number(usage.callsCompleted) || 0),
      inputTokens: Math.max(0, Number(usage.inputTokens) || 0),
      outputTokens: Math.max(0, Number(usage.outputTokens) || 0),
      totalTokens,
      reservedTokens: reservedTokens + predictedTokens,
      estimatedCostYuan: Math.max(0, Number(usage.estimatedCostYuan) || 0),
      lastJobId: jobId,
      updatedAt: db.serverDate()
    };
    if (firstDocument(usageResult)) await usageRef.update(record);
    else await usageRef.set({ ...record, createdAt: db.serverDate() });
    await jobRef.update({ modelCalls: modelCalls + 1, lastProviderAttempt: attempt, updatedAt: db.serverDate() });
  });
  return { dayId, predictedTokens, released: false };
}

async function releaseReservation(reservation) {
  if (!reservation || reservation.released) return;
  await db.runTransaction(async (transaction) => {
    const ref = transaction.collection(USAGE).doc(reservation.dayId);
    const current = firstDocument(await ref.get()) || {};
    await ref.update({
      reservedTokens: Math.max(0, Number(current.reservedTokens) || 0) - reservation.predictedTokens,
      updatedAt: db.serverDate()
    });
  });
  reservation.released = true;
}

async function completeReservation(reservation, jobId, usage, config) {
  if (!reservation || reservation.released) return;
  const inputTokens = Math.max(0, Number(usage.inputTokens) || 0);
  const outputTokens = Math.max(0, Number(usage.outputTokens) || 0);
  const totalTokens = Math.max(inputTokens + outputTokens, Number(usage.totalTokens) || 0);
  const cost = estimateCostYuan({ inputTokens, outputTokens }, config);
  await db.runTransaction(async (transaction) => {
    const ref = transaction.collection(USAGE).doc(reservation.dayId);
    const current = firstDocument(await ref.get()) || {};
    await ref.update({
      callsCompleted: Math.max(0, Number(current.callsCompleted) || 0) + 1,
      inputTokens: Math.max(0, Number(current.inputTokens) || 0) + inputTokens,
      outputTokens: Math.max(0, Number(current.outputTokens) || 0) + outputTokens,
      totalTokens: Math.max(0, Number(current.totalTokens) || 0) + totalTokens,
      reservedTokens: Math.max(0, Number(current.reservedTokens) || 0) - reservation.predictedTokens,
      estimatedCostYuan: Number((Math.max(0, Number(current.estimatedCostYuan) || 0) + cost).toFixed(6)),
      lastJobId: jobId,
      updatedAt: db.serverDate()
    });
  });
  reservation.released = true;
}

async function persistCandidates({ jobId, submissionId, input, output, knownEntities, usage, providerAttempts }) {
  const resourceById = new Map((input.allowedResources || []).map((resource) => [resource.id, resource]));
  const contexts = Object.fromEntries(output.entities.map((entity) => {
    const relationResourceIds = [...new Set(output.relations
      .filter((relation) => relation.fromTemporaryId === entity.temporaryId)
      .map((relation) => relation.toResourceId).filter(Boolean))];
    const resourceId = relationResourceIds[0] || input.submission && input.submission.boundResourceId || '';
    const resource = resourceById.get(resourceId) || {};
    return [entity.temporaryId, { resourceId, resourceIds: relationResourceIds,
      relationResourceIds, region: resource.region || input.submission && input.submission.regionName || '' }];
  }));
  const entities = resolveEntityMatches(output.entities, knownEntities, contexts);
  const writes = [];
  entities.forEach((entity) => {
    const id = candidateIdFor(jobId, 'entity', entity.temporaryId);
    writes.push([id, {
      jobId, submissionId, candidateType: 'entity', status: 'pending_review', risk: 'medium', shadowMode: true,
      payload: entity, createdAt: db.serverDate(), updatedAt: db.serverDate()
    }]);
  });
  output.relations.forEach((relation, index) => {
    const id = candidateIdFor(jobId, 'relation', `${relation.fromTemporaryId}:${relation.toResourceId}:${relation.relationType}:${index}`);
    writes.push([id, {
      jobId, submissionId, candidateType: 'relation', status: 'pending_review', risk: classifyRelationRisk(relation), shadowMode: true,
      payload: relation, createdAt: db.serverDate(), updatedAt: db.serverDate()
    }]);
  });
  output.missingEvidence.forEach((gap, index) => {
    const id = candidateIdFor(jobId, 'gap', `${gap.gapType}:${index}`);
    writes.push([id, {
      jobId, submissionId, candidateType: 'gap', status: 'pending_review', risk: 'insufficient', shadowMode: true,
      payload: gap, createdAt: db.serverDate(), updatedAt: db.serverDate()
    }]);
  });
  const candidateCounts = { entities: entities.length, relations: output.relations.length, gaps: output.missingEvidence.length };
  await db.runTransaction(async (transaction) => {
    await assertCurrentSources(transaction, submissionId, input, jobId);
    for (const [id, record] of writes) {
      await transaction.collection(CANDIDATES).doc(id).set(record);
    }
    await transaction.collection(JOBS).doc(jobId).update({
      status: 'awaiting_review', summary: output.summary, candidateCounts,
      providerAttempts, usage, lockedAt: null, updatedAt: db.serverDate()
    });
  });
  return candidateCounts;
}

async function publicWorkspace(config) {
  const [jobsResult, candidatesResult, usageResult] = await Promise.all([
    db.collection(JOBS).limit(50).get(),
    db.collection(CANDIDATES).limit(100).get(),
    db.collection(USAGE).doc(shanghaiDayId()).get()
  ]);
  const jobs = (jobsResult.data || []).map((item) => ({
    id: item._id || item.id || '', submissionId: item.submissionId || '', status: item.status || 'pending',
    attempts: Math.max(0, Number(item.attempts) || 0), modelCalls: Math.max(0, Number(item.modelCalls) || 0),
    provider: item.provider || '', model: item.model || '', promptVersion: item.promptVersion || '',
    summary: cleanText(item.summary, 240), candidateCounts: item.candidateCounts || {}, lastError: item.lastError || null
  }));
  const candidates = (candidatesResult.data || []).map((item) => ({
    id: item._id || item.id || '', jobId: item.jobId || '', submissionId: item.submissionId || '',
    candidateType: item.candidateType || '', status: item.status || '', risk: item.risk || '', payload: item.payload || null
  }));
  const usage = firstDocument(usageResult) || {};
  return {
    ok: true,
    config: publicConfig(config),
    usage: {
      day: shanghaiDayId(), callsAttempted: Number(usage.callsAttempted) || 0,
      callsCompleted: Number(usage.callsCompleted) || 0, totalTokens: Number(usage.totalTokens) || 0,
      estimatedCostYuan: Number(usage.estimatedCostYuan) || 0
    },
    jobs,
    candidates,
    counts: {
      jobs: jobs.length,
      awaitingReview: jobs.filter((item) => item.status === 'awaiting_review').length,
      entityCandidates: candidates.filter((item) => item.candidateType === 'entity').length,
      relationCandidates: candidates.filter((item) => item.candidateType === 'relation').length,
      gapCandidates: candidates.filter((item) => item.candidateType === 'gap').length,
      highRisk: candidates.filter((item) => item.risk === 'high').length,
      insufficientEvidence: candidates.filter((item) => item.risk === 'insufficient').length
    }
  };
}

async function analyzeSubmission(event, adminUid, config) {
  if (!config.enabled) throw Object.assign(new Error('研究智能体总开关尚未开启'), { code: 'AGENT_DISABLED' });
  if (!config.shadowMode) throw Object.assign(new Error('第一阶段只允许影子模式运行'), { code: 'AGENT_SHADOW_MODE_REQUIRED' });
  if (!config.apiKey) throw Object.assign(new Error('研究智能体尚未配置 API Key'), { code: 'AGENT_API_KEY_MISSING' });
  const submissionId = cleanId(event.submissionId, '投稿');
  const { submission } = await eligibleSubmission(submissionId, config);
  const context = await loadContext(submission, config);
  if (!context.allowedResources.length) throw Object.assign(new Error('当前没有可用于比对的已发布资源'), { code: 'AGENT_NO_RESOURCES' });
  const input = { submission, ...context };
  const { jobId } = await ensureJob(config, adminUid, submissionId, input);
  const lock = await acquireJob(jobId, config);
  if (lock.cached) return { ok: true, cached: true, jobId, workspace: await publicWorkspace(config) };
  const reservations = new Map();
  try {
    await recordStep(jobId, 1, 'eligibility_and_consent', 'completed', { submissionId, textOnly: true });
    await recordStep(jobId, 2, 'bounded_retrieval', 'completed', {
      resources: context.allowedResources.length, confirmedEvidence: context.evidenceLinks.length, knownEntities: context.knownEntities.length
    });
    await recordStep(jobId, 3, 'model_analysis', 'processing', { provider: config.provider, model: config.textModel });
    const client = createTokenHubClient({ config });
    const estimatedInputTokens = estimateTokens(input);
    const result = await client.analyze(input, {
      beforeAttempt: async (attempt) => {
        await assertCurrentSources(db, submissionId, input, jobId);
        const reservation = await reserveAttempt(config, jobId, estimatedInputTokens, attempt);
        reservations.set(attempt, reservation);
      },
      onAttemptFailure: async ({ attempt }) => {
        await releaseReservation(reservations.get(attempt));
      }
    });
    const validOutput = validateAgentOutput(result.output, {
      allowedResourceIds: context.allowedResources.map((item) => item.id),
      allowedEvidenceIds: context.evidenceLinks.map((item) => item.id)
    });
    await completeReservation(reservations.get(result.providerAttempts), jobId, result.usage, config);
    await recordStep(jobId, 3, 'model_analysis', 'completed', {
      providerAttempts: result.providerAttempts, totalTokens: result.usage.totalTokens
    });
    await recordStep(jobId, 4, 'server_validation', 'completed', {
      entities: validOutput.entities.length, relations: validOutput.relations.length, gaps: validOutput.missingEvidence.length
    });
    const candidateCounts = await persistCandidates({
      jobId, submissionId, input, output: validOutput, knownEntities: context.knownEntities,
      usage: result.usage, providerAttempts: result.providerAttempts
    });
    await recordStep(jobId, 5, 'shadow_candidate_persistence', 'completed', { candidateCounts, formalGraphWrites: 0 });
    return { ok: true, cached: false, jobId, candidateCounts, workspace: await publicWorkspace(config) };
  } catch (error) {
    await Promise.all([...reservations.values()].map(releaseReservation));
    await db.runTransaction(async (transaction) => {
      const ref = transaction.collection(JOBS).doc(jobId);
      const currentJob = firstDocument(await ref.get());
      if (currentJob && currentJob.status === 'processing') {
        await ref.update({ status: 'failed', lastError: safeError(error), lockedAt: null, updatedAt: db.serverDate() });
      }
    });
    await recordStep(jobId, 99, 'failed', 'failed', { error: safeError(error) });
    throw error;
  }
}

exports.main = async (event = {}) => {
  const action = cleanText(event.action || 'status', 80);
  try {
    const adminUid = requireAdmin();
    await ensureCollections();
    const config = loadConfig();
    if (action === 'status' || action === 'getWorkspace') return await publicWorkspace(config);
    if (action === 'analyzeSubmission') return await analyzeSubmission(event, adminUid, config);
    return { ok: false, code: 'UNKNOWN_ACTION', message: '不支持的研究智能体操作' };
  } catch (error) {
    console.error('storyAgentWorker failed', { action, code: error && error.code, message: error && error.message });
    return { ok: false, ...safeError(error) };
  }
};
