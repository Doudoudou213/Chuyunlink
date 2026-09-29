'use strict';
// An isolated public-text experiment. Never creates approved submission/story records.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { createGuideClient, buildGuideRequest } = require('../../cloudfunctions/storyWorker/lib/guide-client');
const { requestJson } = require('../../cloudfunctions/storyWorker/lib/tokenhub-client');
const { createTrialBudget } = require('../../cloudfunctions/storyWorker/lib/guide-trial-budget');
const { validateGuideResult, checkGuidePrivacy } = require('../../cloudfunctions/storyWorker/lib/guide-contract');
const { diagnosis } = require('../../cloudfunctions/storyWorker/lib/guide-diagnostics');
const digest = x => crypto.createHash('sha256').update(x).digest('hex');
const fail = code => { throw Object.assign(new Error(code), { code }); };
function inputFromBundle(bundle, index, interest) {
  if (bundle.environment !== 'local_only' || bundle.productionWrites !== false) fail('TRIAL_BUNDLE');
  const record = bundle.records?.[index];
  if (!record?.testOnly || record.publishAllowed !== false || record.status !== 'local_draft' || record.testBatchId !== bundle.testBatchId) fail('TRIAL_SAMPLE');
  if (!record.interestVersions.includes(interest)) fail('TRIAL_INTEREST');
  const source = bundle.sources.find(s => s.id === record.officialSourceId);
  const allowedHosts = ['ylj.wuhan.gov.cn', 'wlj.wuhan.gov.cn', 'hbww.org.cn'];
  if (!source || !allowedHosts.includes(new URL(source.url).hostname)) fail('TRIAL_SOURCE');
  const claims = record.claimCandidates.map(c => ({ id: c.localId, text: c.text, sourceLinkIds: [source.id] }));
  if (!claims.length || claims.length > 12 || new Set(claims.map(c => c.id)).size !== claims.length || claims.some(c => !c.text || c.text.length > 1200)) fail('TRIAL_CLAIMS');
  const input = { resourceTitle: record.resourceName, interest, claims, sources: [{ id: source.id, excerpt: source.publisher + '公开介绍的摘要：' + claims.map(c => c.text).join(''), context:{kind:'unknown',excerptType:'public_test_summary',attribution:source.publisher,qualifiers:[],boundary:'隔离公开资料测试摘要，不代表应用内已审核证据，不自称亲历。'} }] };
  input.contentPlan=require('../../cloudfunctions/storyWorker/lib/guide-content-plan').contentPlan(claims,interest);
  if (JSON.stringify(input).length > 16000) fail('TRIAL_INPUT_SIZE');
  checkGuidePrivacy(input);
  return { input, record, source };
}
function trialBody(input, config, variant) {
  if (!['baseline', 'no-thinking'].includes(variant)) fail('TRIAL_VARIANT');
  const body = buildGuideRequest(input, config);
  body.messages[0].content = body.messages[0].content.replaceAll('已确认事实', '待核对的公开资料条目') + ' 本次为隔离的公开资料测试，输入条目不是产品内已人工审核的事实；仅生成测试草稿，不可公开。资料不足时宁可短，不添加内容来凑一分钟。';
  if (variant === 'baseline') { delete body.thinking; delete body.reasoning_effort; }
  if (variant === 'no-thinking') { body.thinking = { type: 'disabled' }; body.reasoning_effort = 'none'; }
  return body;
}
function atomic(file, value) {
  const temporary = file + '.next';
  const fd = fs.openSync(temporary, 'w');
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  for (let attempt = 0; ; attempt++) {
    try { fs.renameSync(temporary, file); break; }
    catch (error) { if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code) || attempt >= 20) throw error; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50); }
  }
}
function budgetDb(initial, save) {
  let state = initial;
  const collection = (data, name) => ({ doc: id => ({
    get: async () => ({ data: data[name]?.[id] ? [{ ...data[name][id] }] : [] }),
    set: async value => { (data[name] ||= {})[id] = structuredClone(value); },
    update: async value => { (data[name] ||= {})[id] = { ...data[name][id], ...structuredClone(value) }; }
  }) });
  return { collection: name => collection(state, name), createCollection: async () => {}, runTransaction: async callback => {
    const next = structuredClone(state);
    const result = await callback({ collection: name => collection(next, name) });
    save(next); state = next; return result;
  } };
}
const LEGACY_POLICY = Object.freeze({ id: 'guide-trial-20260928', maxCalls: 8, limitCny: 5 });
function checkedPolicy(policy = LEGACY_POLICY) {
  if (!policy || typeof policy.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(policy.id) || !Number.isInteger(policy.maxCalls) || policy.maxCalls < 1 || policy.maxCalls > 8 || !Number.isFinite(policy.limitCny) || policy.limitCny < 0.000001 || policy.limitCny > 5) fail('TRIAL_POLICY');
  return { id: policy.id, maxCalls: policy.maxCalls, limitCny: policy.limitCny };
}
async function runTrial({ bundlePath, outputDirectory, index = 0, interest = '通用', variant = 'baseline', execute = false, config, policy, transport = requestJson }) {
  policy = checkedPolicy(policy);
  if (config.textModel !== 'hy3' || config.baseUrl !== 'https://tokenhub.tencentmaas.com/v1') fail('TRIAL_PROVIDER_NOT_PRICED');
  config = { ...config, guideTrialId: policy.id, guideTrialLimitCny: policy.limitCny, guideInputCnyPerMillion: 1, guideOutputCnyPerMillion: 4, providerMaxAttempts: 1, maxOutputTokens: 1800 };
  const contents = fs.readFileSync(bundlePath, 'utf8'), fingerprint = digest(contents);
  const { input, record, source } = inputFromBundle(JSON.parse(contents), index, interest);
  const body = trialBody(input, config, variant);
  const bounds = { inputTokens: Buffer.byteLength(JSON.stringify(body)) + 4096, outputTokens: 1800 };
  if (!execute) return { ready: true, paidCall: false, policy, sample: record.localSampleId, variant, sourceCount: input.sources.length, expectedReservationCny: (bounds.inputTokens + 4 * bounds.outputTokens) / 1e6 };
  if (!config.apiKey) fail('TRIAL_KEY_MISSING');
  fs.mkdirSync(outputDirectory, { recursive: true });
  const lock = path.join(outputDirectory, '.trial-lock'), statePath = path.join(outputDirectory, 'trial-state.json');
  let fd;
  try { fd = fs.openSync(lock, 'wx'); } catch (_) { fail('TRIAL_BUSY'); }
  try {
    const existing = fs.existsSync(statePath);
    const state = existing ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : { trialId: config.guideTrialId, policy, db: {}, runs: [] };
    if (JSON.stringify(checkedPolicy(state.policy || LEGACY_POLICY)) !== JSON.stringify(policy)) fail('TRIAL_POLICY_CHANGED');
    if (state.trialId !== config.guideTrialId || !Array.isArray(state.runs) || state.runs.length >= policy.maxCalls) fail('TRIAL_ATTEMPTS');
    if (!existing && fs.readdirSync(outputDirectory).some(n => /^run-/.test(n))) fail('TRIAL_LEDGER_MISSING');
    const db = budgetDb(state.db, data => { state.db = data; atomic(statePath, state); });
    const budget = createTrialBudget({ db, config });
    const runId = 'run-' + String(state.runs.length + 1).padStart(2, '0');
    const report = { runId, trialId: policy.id, policy, testOnly: true, publishAllowed: false, mode: 'real-provider-local-public-text', sampleId: record.localSampleId, resource: input.resourceTitle, interest, variant, model: config.textModel, promptVersion: require('../../cloudfunctions/storyWorker/lib/guide-generation').PROMPT_VERSION + '-public-trial-v1', codeVersion: 'public-guide-trial-v3-grounding', inputFingerprint: fingerprint, source, sourceCount: input.sources.length, status: 'reserved', startedAt: new Date().toISOString(), usage: null, humanReview: null };
    state.runs.push(report);
    atomic(statePath, state);
    const before = () => { if (digest(fs.readFileSync(bundlePath, 'utf8')) !== fingerprint) fail('GUIDE_SOURCE_CHANGED'); };
    const started = Date.now();let diagnosticCandidate=null;
    const client = createGuideClient({ config, transport: async (url, options, unusedBody, timeout) => {
      report.requestStarted = true; atomic(statePath, state);
      const response = await transport(url, options, JSON.stringify(body), timeout);
      const choice = response.choices?.[0], message = choice?.message || {};
      report.response = { finishReason: String(choice?.finish_reason || '').slice(0, 40), contentCharacters: typeof message.content === 'string' ? message.content.length : 0, reasoningCharacters: typeof message.reasoning_content === 'string' ? message.reasoning_content.length : 0 };
      if (typeof message.content === 'string' && message.content.length < 12000) {
        try { const candidate = JSON.parse(message.content); checkGuidePrivacy(candidate); if (!message.content.includes(config.apiKey)) diagnosticCandidate = candidate; } catch (_) {}
      }
      // Never persist hidden reasoning or provider error bodies.
      return response;
    } });
    try {
      const result = await client.generate(input, { beforeAttempt: async () => { before(); await budget.reserve(runId, runId, bounds); }, onUsage: async usage => { await budget.record(runId, usage); if (Number.isSafeInteger(usage.inputTokens) && Number.isSafeInteger(usage.outputTokens) && usage.inputTokens >= 0 && usage.outputTokens >= 0 && usage.totalTokens === usage.inputTokens + usage.outputTokens) report.usage = usage; } });
      before();const checked=validateGuideResult(result.output,input);if(checked.outcome==='insufficient'){report.status='insufficient';report.gaps=checked.gaps;report.characterCount=0;}else{report.grounding=require('../../cloudfunctions/storyWorker/lib/guide-grounding').inspectGuide(checked.output,input);require('../../cloudfunctions/storyWorker/lib/guide-grounding').assertNoBlockers(report.grounding);report.output=result.output;report.status='draft_only';report.characterCount=[...checked.output.text].length;}
    } catch (error) {
      report.status = 'failed'; report.error = diagnosis(error.code);
      if (error.code === 'GUIDE_OUTPUT_INVALID') report.validationIssue = error.message;
    }
    try{before();if(diagnosticCandidate)report.returnedDraftForDiagnosis=diagnosticCandidate;}catch{delete report.output;delete report.grounding;}
    report.elapsedMs = Date.now() - started;
    report.budget = await budget.status();
    atomic(statePath, state);
    atomic(path.join(outputDirectory, runId + '.json'), report);
    return { runId, status: report.status, variant, characterCount: report.characterCount, response: report.response, error: report.error, usage: report.usage, elapsedMs: report.elapsedMs, budget: report.budget };
  } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}
module.exports = { runTrial, inputFromBundle, trialBody };
