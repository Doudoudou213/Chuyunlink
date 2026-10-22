'use strict';
// Real cloud READ endpoints only, in a fresh isolated Edge context. Anonymous
// sign-in supplies the normal SDK identity; never loads the user's browser data.
// No admin prepare(), profile bootstrap, business write, worker, or paid AI call.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const origin = 'https://chulink-legacy-d8god1687a5d60743-1458884983.tcloudbaseapp.com';
const environment = 'chulink-legacy-d8god1687a5d60743';
const sdk = 'https://static.cloudbase.net/cloudbase-js-sdk/2.28.6/cloudbase.full.js';
async function browserChecks({ phase, environment }, testApp) {
  const results = [];
  const allowed = new Set(['getResources', 'getResourceDetail', 'getGuideStation', 'getGuideAudio', 'getSiteWalk', 'getSiteExploration', 'getSiteExplorationQuestionContext']);
  const knownCodes = new Set(['RESOURCE_NOT_FOUND', 'INVALID_RESOURCE_ID', 'INVALID_ACTION', 'GUIDE_SOURCE_INVALID', 'WALK_SOURCE', 'QA_SOURCE', 'EXPLORATION_INPUT', 'UNAUTHENTICATED', 'FORBIDDEN', 'PERMISSION_DENIED', 'OPERATION_FAILED']);
  function connectionCode(error) {
    const text = String(error?.code || '') + ' ' + String(error?.message || '');
    return /TIMEOUT|timeout|超时/i.test(text) ? 'TIMEOUT' : /permission|FORBIDDEN|unauthoriz|access.?denied|权限/i.test(text) ? 'PERMISSION_DENIED'
      : /LOGIN|AUTH|sign.?in|登录/i.test(text) ? 'AUTHENTICATION_FAILED' : /network|fetch|ECONN|ENOTFOUND|TLS|SSL|socket|网络/i.test(text) ? 'NETWORK_UNAVAILABLE' : 'SDK_CALL_FAILED';
  }
  let app;
  try {
    app = testApp || window.cloudbase.init({ env: environment, region: 'ap-shanghai' });
    const auth = app.auth({ persistence: 'session' });
    await auth.anonymousAuthProvider().signIn();
  } catch (error) { return { connected: false, authentication: connectionCode(error), results }; }
  async function call(name, data) {
    if (!(name === 'appCore' && allowed.has(data.action) || name === 'adminSubmissions' && data.action === 'whoami')) throw Error('READ_ONLY_ALLOWLIST');
    const started = performance.now();
    try {
      let timer;
      const response = await Promise.race([app.callFunction({ name, data }), new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(Error('timeout'), { code: 'TIMEOUT' })), 25000); })]).finally(() => clearTimeout(timer));
      let value;
      try { value = typeof response.result === 'string' ? JSON.parse(response.result) : response.result; }
      catch { results.push({ function: name, action: data.action, ok: false, code: 'INVALID_RESPONSE', latencyMs: Math.round(performance.now() - started) }); return null; }
      const code = value?.ok ? null : knownCodes.has(value?.error?.code) ? value.error.code : 'CLOUD_OPERATION_FAILED';
      const row = { function: name, action: data.action, ok: value?.ok === true, code, latencyMs: Math.round(performance.now() - started) };
      if (typeof value?.available === 'boolean') row.available = value.available;
      if (typeof value?.ready === 'boolean') row.ready = value.ready;
      if (Array.isArray(value?.items)) row.count = value.items.length;
      if (typeof value?.collectionReady === 'boolean') row.collectionReady = value.collectionReady;
      if (name === 'adminSubmissions') row.anonymousNotAdmin = value?.ok === true && value.isAdmin === false;
      if (data.action === 'getSiteExplorationQuestionContext') {
        row.expectedControlledSourceFailure = code === 'QA_SOURCE' || code === 'WALK_SOURCE';
        row.expectedOldEndpoint = phase === 'before' && code === 'INVALID_ACTION';
      }
      results.push(row);
      return value;
    } catch (error) { results.push({ function: name, action: data.action, ok: false, code: connectionCode(error), latencyMs: Math.round(performance.now() - started) }); return null; }
  }
  const resources = await call('appCore', { action: 'getResources', limit: 100 });
  const resource = resources?.items?.find(item => item.id === 'yellow-crane-tower' || item.legacyAliases?.includes('yellow-crane-tower'))
    || resources?.items?.find(item => /黄鹤楼/.test(item.title || '') && ['landmark', 'hotspot'].includes(item.type));
  const resourceId = /^[\w-]{1,128}$/.test(resource?.id || '') ? resource.id : 'yellow-crane-tower';
  const detail = await call('appCore', { action: 'getResourceDetail', resourceId });
  const station = await call('appCore', { action: 'getGuideStation', resourceId });
  await call('appCore', { action: 'getSiteWalk', resourceId });
  const exploration = await call('appCore', { action: 'getSiteExploration', resourceId });
  const objectId = exploration?.available && /^[\w-]{1,128}$/.test(exploration.map?.objects?.[0]?.id || '') ? exploration.map.objects[0].id : 'connectivity-invalid-object';
  await call('appCore', { action: 'getSiteExplorationQuestionContext', resourceId, objectId });
  const versionId = station?.items?.[0]?.versionId;
  if (/^[\w-]{1,128}$/.test(versionId || '')) await call('appCore', { action: 'getGuideAudio', resourceId, versionId });
  else results.push({ function: 'appCore', action: 'getGuideAudio', skipped: true, reason: 'NO_PUBLISHED_GUIDE_VERSION' });
  await call('adminSubmissions', { action: 'whoami' });
  return { connected: results.some(row => row.ok), authentication: 'anonymous-isolated', matchedYellowCraneResource: !!resource,
    publicResourceId: resourceId, resourceAvailable: detail?.ok === true, publishedGuideCount: station?.items?.length || 0,
    explorationAvailable: exploration?.available === true, results };
}
function parseArgs(argv) {
  const args = { phase: 'before' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--self-test') args.selfTest = true;
    else if (['--phase', '--output'].includes(argv[i]) && argv[i + 1] && !argv[i + 1].startsWith('--')) args[argv[i].slice(2)] = argv[++i];
    else throw Error('INVALID_ARGUMENT');
  }
  if (!['before', 'after'].includes(args.phase)) throw Error('INVALID_PHASE');
  return args;
}
function targetPath(value) {
  if (!value) return null;
  const target = path.resolve(root, value), base = path.join(root, 'artifacts'), relative = path.relative(base, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || path.extname(target) !== '.json') throw Error('OUTPUT_MUST_BE_ARTIFACTS_JSON');
  let directory = path.dirname(target);
  while (directory !== root && !fs.existsSync(directory)) directory = path.dirname(directory);
  if (path.relative(fs.realpathSync(root), fs.realpathSync(directory)).startsWith('..')) throw Error('OUTPUT_OUTSIDE_WORKSPACE');
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw Error('OUTPUT_LINK_REJECTED');
  return target;
}
function assess(result, phase) {
  const allowedFailures = row => row.expectedControlledSourceFailure || (phase === 'before' && row.expectedOldEndpoint);
  const errors = result.results.filter(row => !row.skipped && !row.ok && !allowedFailures(row));
  const admin = result.results.find(row => row.function === 'adminSubmissions');
  return { cloudConnectivityPassed: result.connected && errors.length === 0 && admin?.anonymousNotAdmin === true,
    contentReady: result.resourceAvailable && result.publishedGuideCount > 0 && result.explorationAvailable,
    failureCount: errors.length, untested: ['stable-account writes and recovery', 'admin publication and permissions', 'database transactions and security rules', 'paid model/audio/recognition', 'onsite approval'] };
}
async function selfTest() {
  const assert = require('node:assert/strict'), calls = [];
  const app = { auth: () => ({ anonymousAuthProvider: () => ({ signIn: async () => ({ uid: 'private-identity' }) }) }),
    async callFunction({ name, data }) { calls.push(data.action); return { result: data.action === 'getResources'
      ? { ok: true, items: [{ id: 'hhl-public', title: '黄鹤楼', type: 'landmark', private: 'private-content' }] }
      : data.action === 'getGuideStation' ? { ok: true, items: [] }
        : data.action === 'getSiteExplorationQuestionContext' ? { ok: false, error: { code: 'INVALID_ACTION', message: 'private-error' } }
          : name === 'adminSubmissions' ? { ok: true, uid: 'private-identity', isAdmin: false } : { ok: true, available: false } }; } };
  const before = await browserChecks({ phase: 'before', environment: 'test' }, app);
  assert(!JSON.stringify(before).includes('private-')); assert.equal(before.publicResourceId, 'hhl-public');
  assert.equal(assess(before, 'before').cloudConnectivityPassed, true); assert.equal(assess(before, 'after').cloudConnectivityPassed, false);
  assert.equal(assess(before, 'before').contentReady, false); assert(!calls.includes('getGuideAudio')); assert(!calls.includes('bootstrap'));
  assert.throws(() => targetPath('../unsafe.json')); assert.throws(() => parseArgs(['--phase', 'bad']));
  console.log('Scenic cloud browser safety checks passed (9 assertions; no browser/cloud calls).');
}
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) return selfTest();
  const target = targetPath(args.output), { chromium } = require('playwright');
  const summary = { capturedAt: new Date().toISOString(), phase: args.phase, operation: 'anonymous read-only cloud API smoke',
    containsUserIdentityOrContent: false, completed: false, pageErrorCount: 0 };
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    // Fulfill just this synthetic test shell. SDK and function requests are real.
    const url = origin + '/__scenic-check.html';
    await context.route(url, route => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<!doctype html><html lang="zh-CN"><title>Scenic connection check</title><script src="' + sdk + '"></script><body>Read-only connection check</body></html>' }));
    const page = await context.newPage();
    page.on('pageerror', () => { summary.pageErrorCount++; });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForFunction(() => !!window.cloudbase, null, { timeout: 30000 });
    const result = await page.evaluate(browserChecks, { phase: args.phase, environment });
    Object.assign(summary, result, assess(result, args.phase), { completed: true });
    if (!summary.cloudConnectivityPassed || summary.pageErrorCount) process.exitCode = 1;
  } catch (error) {
    const text = String(error?.message || '');
    summary.failure = /timeout|timed out/i.test(text) ? 'BROWSER_TIMEOUT' : /network|ERR_|fetch|SSL|TLS/i.test(text) ? 'BROWSER_NETWORK_ERROR' : 'BROWSER_CHECK_FAILED';
    process.exitCode = 1;
  } finally {
    await browser.close();
    if (target) { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, JSON.stringify(summary, null, 2) + '\n'); }
    console.log(JSON.stringify(summary, null, 2));
  }
}
if (require.main === module) main().catch(error => {
  const code = /^[A-Z_]{3,60}$/.test(error.message) ? error.message : 'BROWSER_PREFLIGHT_FAILED';
  console.error(JSON.stringify({ completed: false, error: code, rawOutputSuppressed: true })); process.exitCode = 1;
});
module.exports = { browserChecks, assess };
