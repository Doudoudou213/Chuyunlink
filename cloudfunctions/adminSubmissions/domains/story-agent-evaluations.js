'use strict';

const crypto = require('crypto');

const SET_COLLECTION = 'story_agent_evaluation_sets';
const SAMPLE_COLLECTION = 'story_agent_evaluations';
const REQUIRED_COLLECTIONS = [SET_COLLECTION, SAMPLE_COLLECTION, 'story_agent_reviews', 'story_agent_candidates', 'story_agent_jobs'];
const DEFAULT_SET = { id: 'agent_feedback_v1', version: 'feedback-v1', title: '管理员反馈评测集 V1' };
const RATINGS = new Set(['correct', 'partial', 'incorrect']);
const SPLITS = new Set(['debug', 'fixed']);
const text = (value, limit = 500) => String(value == null ? '' : value).trim().slice(0, limit);
const first = result => Array.isArray(result && result.data) ? result.data[0] : result && result.data;
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const id = value => { const key = text(value, 128); if (!/^[\w.-]+$/.test(key)) fail('INVALID_ID', '记录编号无效'); return key; };
const hasCurrentAiConsent = item => Boolean(item && item.status === 'approved' && item.aiAnalysisConsent === true
  && item.aiConsentVersion === 'ai-analysis-consent-v1'
  && item.aiConsentScope === 'approved_public_submission_text'
  && !item.aiConsentRevokedAt && item.aiAnalysisStatus !== 'consent_revoked');
const sampleIdFor = (setId, reviewId) => `agent_eval_${crypto.createHash('sha256').update(`${setId}:${reviewId}`).digest('hex').slice(0, 40)}`;
const setIdFor = version => `agent_eval_set_${crypto.createHash('sha256').update(version).digest('hex').slice(0, 24)}`;
const percent = (count, total) => total ? Number((count * 100 / total).toFixed(1)) : 0;

function calculateMetrics(samples) {
  const all = samples || [];
  const active = all.filter(item => item.active !== false && item.sourceValid !== false);
  const decisions = active.filter(item => ['approve', 'reject'].includes(item.decision));
  const direct = decisions.filter(item => item.decision === 'approve' && !(item.changedFields || []).length).length;
  const modified = decisions.filter(item => item.decision === 'approve' && (item.changedFields || []).length).length;
  const rejected = decisions.filter(item => item.decision === 'reject').length;
  const relations = active.filter(item => item.candidateType === 'relation' && item.decision === 'approve'
    && item.original && item.final && item.original.relationType && item.final.relationType);
  const consistent = relations.filter(item => item.original.relationType === item.final.relationType).length;
  return {
    total: all.length,
    activeTotal: active.length,
    directApprovalRate: percent(direct, decisions.length),
    modificationRate: percent(modified, decisions.length),
    rejectionRate: percent(rejected, decisions.length),
    sourceValidityRate: percent(all.filter(item => item.sourceValid !== false && item.active !== false).length, all.length),
    relationTypeConsistencyRate: percent(consistent, relations.length),
    ratingCounts: {
      correct: active.filter(item => item.humanRating === 'correct').length,
      partial: active.filter(item => item.humanRating === 'partial').length,
      incorrect: active.filter(item => item.humanRating === 'incorrect').length,
      unrated: active.filter(item => !RATINGS.has(item.humanRating)).length
    }
  };
}

function comparisonRows(samples) {
  const groups = new Map();
  for (const sample of samples || []) {
    const versions = {
      model: text(sample.model || 'unknown', 100),
      promptVersion: text(sample.promptVersion || 'unknown', 100),
      codeVersion: text(sample.codeVersion || 'legacy', 100)
    };
    const key = JSON.stringify(versions);
    if (!groups.has(key)) groups.set(key, { ...versions, samples: [] });
    groups.get(key).samples.push(sample);
  }
  return [...groups.values()].map(group => ({ ...group, metrics: calculateMetrics(group.samples) }))
    .sort((a, b) => b.metrics.total - a.metrics.total).map(({ samples, ...row }) => row);
}

function evidenceRefs(review, job) {
  const refs = new Map();
  for (const source of job && job.input && job.input.evidenceLinks || []) {
    if (source && source.id) refs.set(source.id, { id: source.id, resourceId: text(source.resourceId, 128) });
  }
  for (const evidenceId of review && review.evidenceLinkIds || review && review.original && review.original.evidenceLinkIds || []) {
    if (evidenceId && !refs.has(evidenceId)) refs.set(evidenceId, { id: evidenceId, resourceId: '' });
  }
  return [...refs.values()];
}

function createStoryAgentEvaluationService({ db }) {
  let ready;
  async function ensure() {
    if (!ready) ready = Promise.all(REQUIRED_COLLECTIONS.map(async name => {
      try { await db.createCollection(name); } catch (error) {
        if (!/exist/i.test(`${error.code || ''} ${error.message || ''}`)) throw error;
      }
    })).catch(error => { ready = null; throw error; });
    await ready;
    const existing = first(await db.collection(SET_COLLECTION).doc(DEFAULT_SET.id).get());
    if (!existing) await db.collection(SET_COLLECTION).doc(DEFAULT_SET.id).set({
      version: DEFAULT_SET.version, title: DEFAULT_SET.title, status: 'active', createdAt: db.serverDate()
    });
  }

  async function currentSourceState(sample) {
    if (!sample.submissionId) return { valid: false, reason: '缺少来源投稿' };
    const submission = first(await db.collection('submissions').doc(sample.submissionId).get());
    if (!hasCurrentAiConsent(submission)) return { valid: false, reason: '来源投稿已失效或撤回 AI 授权' };
    if (sample.jobId) {
      const job = first(await db.collection('story_agent_jobs').doc(sample.jobId).get());
      if (!job || job.status === 'consent_revoked') return { valid: false, reason: '原分析任务已停用' };
    }
    for (const source of sample.evidenceRefs || []) {
      const link = first(await db.collection('story_evidence_links').doc(source.id).get());
      const origin = link && link.submissionId ? first(await db.collection('submissions').doc(link.submissionId).get()) : null;
      if (!link || link.status !== 'confirmed' || link.needsSourceReview === true
        || (source.resourceId && link.resourceId !== source.resourceId) || !hasCurrentAiConsent(origin)) {
        return { valid: false, reason: '关联证据已失效或撤回 AI 授权' };
      }
    }
    return { valid: true, reason: '' };
  }

  async function refreshSourceStates(samples) {
    return Promise.all((samples || []).map(async sample => {
      if (sample.active === false) return sample;
      const state = await currentSourceState(sample);
      if (state.valid) return { ...sample, sourceValid: true };
      const disabledAt = db.serverDate();
      await db.collection(SAMPLE_COLLECTION).doc(sample._id).update({
        active: false, sourceValid: false, disabledReason: state.reason, disabledAt, updatedAt: disabledAt
      });
      return { ...sample, active: false, sourceValid: false, disabledReason: state.reason, disabledAt };
    }));
  }

  async function workspace(event = {}) {
    await ensure();
    const setsResult = await db.collection(SET_COLLECTION).limit(30).get();
    const sets = (setsResult.data || []).map(item => ({ id: item._id, version: item.version, title: item.title, status: item.status || 'active' }));
    const requested = text(event.setId, 128);
    const selectedSet = sets.find(item => item.id === requested) || sets.find(item => item.id === DEFAULT_SET.id) || sets[0];
    const samplesResult = selectedSet
      ? await db.collection(SAMPLE_COLLECTION).where({ setId: selectedSet.id }).limit(200).get()
      : { data: [] };
    const samples = await refreshSourceStates(samplesResult.data || []);
    return { ok: true, sets, selectedSet, metrics: calculateMetrics(samples), comparisons: comparisonRows(samples),
      samples: samples.map(item => ({ id: item._id, setId: item.setId, setVersion: item.setVersion,
        reviewId: item.reviewId, candidateId: item.candidateId, candidateType: item.candidateType,
        split: item.split, decision: item.decision, reasonCategory: item.reasonCategory || '', changedFields: item.changedFields || [],
        model: item.model || '', promptVersion: item.promptVersion || '', codeVersion: item.codeVersion || 'legacy',
        humanRating: item.humanRating || '', ratingNote: item.ratingNote || '', active: item.active !== false,
        sourceValid: item.sourceValid !== false, disabledReason: item.disabledReason || '' })),
      selectedReviewIds: samples.map(item => item.reviewId) };
  }

  async function createSet(event, adminUid) {
    await ensure();
    id(adminUid);
    const version = text(event.version, 40);
    const title = text(event.title || `管理员反馈评测集 ${version}`, 80);
    if (!/^[a-zA-Z0-9._-]{2,40}$/.test(version)) fail('INVALID_VERSION', '版本只能使用字母、数字、点、横线或下划线');
    if (title.length < 2) fail('INVALID_TITLE', '请填写评测集名称');
    const setId = setIdFor(version);
    const existing = first(await db.collection(SET_COLLECTION).doc(setId).get());
    if (existing) return { ok: true, cached: true, set: { id: setId, ...existing } };
    const record = { version, title, status: 'active', createdBy: adminUid, createdAt: db.serverDate() };
    await db.collection(SET_COLLECTION).doc(setId).set(record);
    return { ok: true, set: { id: setId, ...record } };
  }

  async function selectSample(event, adminUid) {
    await ensure();
    id(adminUid);
    const setId = id(event.setId || DEFAULT_SET.id);
    const reviewId = id(event.reviewId);
    const split = text(event.split, 16);
    if (!SPLITS.has(split)) fail('INVALID_EVALUATION_SPLIT', '请选择调试集或固定验收集');
    const setRecord = first(await db.collection(SET_COLLECTION).doc(setId).get());
    if (!setRecord || setRecord.status !== 'active') fail('EVALUATION_SET_UNAVAILABLE', '评测集不存在或已停用');
    const review = first(await db.collection('story_agent_reviews').doc(reviewId).get());
    if (!review) fail('REVIEW_NOT_FOUND', '管理员反馈记录不存在');
    const candidate = first(await db.collection('story_agent_candidates').doc(review.candidateId || reviewId).get());
    const jobId = review.jobId || candidate && candidate.jobId || '';
    const job = jobId ? first(await db.collection('story_agent_jobs').doc(jobId).get()) : null;
    const submissionId = review.submissionId || candidate && candidate.submissionId || job && job.submissionId || '';
    const key = sampleIdFor(setId, reviewId);
    const existing = first(await db.collection(SAMPLE_COLLECTION).doc(key).get());
    if (existing) return { ok: true, cached: true, sample: { id: key, ...existing } };
    const sample = {
      setId, setVersion: setRecord.version, reviewId, candidateId: review.candidateId || reviewId,
      jobId, submissionId, candidateType: review.candidateType || candidate && candidate.candidateType || '',
      risk: review.risk || candidate && candidate.risk || '', split, decision: review.decision,
      original: review.original || null, final: review.final || null, note: text(review.note, 500),
      reasonCategory: text(review.reasonCategory || 'other', 40), changedFields: review.changedFields || [],
      model: review.model || job && job.model || '', promptVersion: review.promptVersion || job && job.promptVersion || '',
      codeVersion: review.codeVersion || job && job.codeVersion || 'legacy', inputFingerprint: review.inputFingerprint || job && job.idempotencyKey || '',
      evidenceRefs: evidenceRefs(review, job), humanRating: '', ratingNote: '', active: true, sourceValid: true,
      selectedBy: adminUid, selectedAt: db.serverDate(), updatedAt: db.serverDate()
    };
    const state = await currentSourceState(sample);
    if (!state.valid) fail('SOURCE_UNAVAILABLE', state.reason);
    await db.collection(SAMPLE_COLLECTION).doc(key).set(sample);
    return { ok: true, sample: { id: key, ...sample } };
  }

  async function rateSample(event, adminUid) {
    await ensure();
    id(adminUid);
    const evaluationId = id(event.evaluationId);
    const rating = text(event.rating, 16);
    if (!RATINGS.has(rating)) fail('INVALID_HUMAN_RATING', '请选择正确、部分正确或错误');
    const sample = first(await db.collection(SAMPLE_COLLECTION).doc(evaluationId).get());
    if (!sample) fail('EVALUATION_SAMPLE_NOT_FOUND', '评测样本不存在');
    const state = await currentSourceState(sample);
    if (!state.valid) {
      await db.collection(SAMPLE_COLLECTION).doc(evaluationId).update({ active: false, sourceValid: false,
        disabledReason: state.reason, disabledAt: db.serverDate(), updatedAt: db.serverDate() });
      fail('SOURCE_UNAVAILABLE', '来源已经失效，样本已自动停用');
    }
    await db.collection(SAMPLE_COLLECTION).doc(evaluationId).update({ humanRating: rating,
      ratingNote: text(event.ratingNote, 500), ratedBy: adminUid, ratedAt: db.serverDate(), updatedAt: db.serverDate() });
    return { ok: true, evaluationId, humanRating: rating };
  }

  return { workspace, createSet, selectSample, rateSample };
}

module.exports = { createStoryAgentEvaluationService, calculateMetrics, comparisonRows, sampleIdFor, DEFAULT_SET };
