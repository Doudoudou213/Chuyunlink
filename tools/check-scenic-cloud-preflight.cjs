'use strict';
// Read-only cloud metadata preflight. No function invocation, data write, login
// flow, environment update, or deployment. Raw CLI output never leaves memory.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const names = ['appCore', 'adminSubmissions', 'storyWorker', 'storyAgentWorker', 'materialWorker', 'miniProgramAuth'];
const flagNames = ['EXPLORATION_QA_ENABLED', 'AI_ENABLED', 'AGENT_ENABLED', 'AGENT_SHADOW_MODE', 'MATERIAL_REAL_OCR_ENABLED', 'BADGES_ENABLED', 'CONTENT_EFFECTS_ENABLED'];
const defaultCli = 'C:/Users/lenovo/AppData/Local/npm-cache/_npx/9a8789722ddc2fbe/node_modules/@cloudbase/cli/bin/tcb';
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = value => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
function cleanText(value, max = 80) {
  return typeof value === 'string' && value.length <= max && /^[\w.:+ /-]+$/.test(value) ? value : null;
}
function summarize(name, data) {
  if (!names.includes(name) || !data || !data.Runtime || !data.Environment) throw Error('INCOMPLETE_METADATA');
  const variables = Array.isArray(data.Environment.Variables) ? [...data.Environment.Variables].sort((a, b) => String(a.Key).localeCompare(String(b.Key))) : [];
  const environment = new Map(variables.map(item => [item.Key, item.Value]));
  const config = { Environment: { ...data.Environment, Variables: variables }, Runtime: data.Runtime,
    Timeout: data.Timeout, MemorySize: data.MemorySize, Handler: data.Handler, Triggers: data.Triggers };
  const possibleCodeHash = data.CodeSha256 || data.CodeHash || data.CodeInfo?.CodeSha256;
  const codeHash = typeof possibleCodeHash === 'string' && /^[a-zA-Z0-9+/=_-]{32,128}$/.test(possibleCodeHash) ? possibleCodeHash : null;
  return { name, status: cleanText(data.Status), runtime: cleanText(data.Runtime), modified: cleanText(data.ModTime),
    configHash: hash(config), codeHash,
    flags: Object.fromEntries(flagNames.filter(flag => environment.has(flag)).map(flag => {
      const value = environment.get(flag);
      return [flag, value === 'true' ? true : value === 'false' ? false : null];
    })) };
}
function readDetail(name, cli, environment) {
  const result = spawnSync(process.execPath, [cli, 'fn', 'detail', name, '-e', environment, '--json', '--yes'], {
    cwd: root, encoding: 'utf8', timeout: 45000, maxBuffer: 8 * 1024 * 1024,
    windowsHide: true, env: { ...process.env, CI: 'true' }
  });
  const raw = String(result.stdout || '') + '\n' + String(result.stderr || '');
  if (result.error || result.status !== 0) {
    // Classify only; never print provider messages which may contain identities.
    const code = result.error?.code === 'ETIMEDOUT' ? 'TIMEOUT' : /not.?login|未登录|请.*登录|login expired|登录.*失效|UNAUTHORIZED|no valid credential/i.test(raw)
      ? 'AUTHENTICATION_REQUIRED' : /ECONN|ENOTFOUND|TLS|SSL|socket|network|网络/i.test(raw) ? 'NETWORK_UNAVAILABLE' : 'CLI_READ_FAILED';
    throw Error(code);
  }
  let payload;
  try {
    const text = String(result.stdout || '').replace(/\u001b\[[0-9;]*m/g, '');
    payload = JSON.parse(text.slice(text.indexOf('{'))).data;
  } catch { throw Error('INVALID_METADATA_RESPONSE'); }
  return summarize(name, payload);
}
function actionMatrix() {
  const entry = fs.readFileSync(path.join(root, 'cloudfunctions/appCore/index.js'), 'utf8');
  const publicReads = ['getResources', 'getResourceDetail', 'getGuideStation', 'getGuideAudio', 'getSiteWalk', 'getSiteExploration', 'getSiteExplorationQuestionContext'];
  // The matrix describes code wiring, NOT a successful live request.
  return {
    publicReads: publicReads.map(action => ({ function: 'appCore', action, implementationPresent: entry.includes("'" + action + "'"), cloudTested: false })),
    stableAccount: ['createSiteWalkSession', 'listSiteWalkSessions', 'getSiteWalkSession', 'siteWalkSessionEvent', 'deleteSiteWalkSession', 'askSiteExploration', 'recognizeSiteExploration'],
    administrator: ['getSiteWalkWorkspace', 'getSiteWalkDraft', 'getExplorationAssets', 'previewSiteWalk', 'saveSiteWalkDraft', 'publishSiteWalk', 'pauseSiteWalk', 'saveExplorationAsset', 'revokeExplorationAsset'],
    notes: ['Metadata availability does not verify action routing, authenticated business operations, content approval, database permissions, or transactions.',
      'Admin read actions currently call prepare(), which may create missing collections; do not use them as a no-write cloud smoke test.',
      'Site-walk session listing currently attempts collection creation; real account tests require a separately reviewed scope.',
      'Do not invoke askSiteExploration or any worker as a connectivity probe: paid provider calls may be enabled in existing configuration.',
      'Four-scene tools fixtures are not production-approved content.']
  };
}
function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === '--self-test') args.selfTest = true;
    else if (['--output', '--compare', '--cli'].includes(key) && argv[i + 1] && !argv[i + 1].startsWith('--')) args[key.slice(2)] = argv[++i];
    else throw Error('INVALID_ARGUMENT');
  }
  return args;
}
function outputPath(value) {
  if (!value) return null;
  const base = path.join(root, 'artifacts');
  const target = path.resolve(root, value);
  const relative = path.relative(base, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || path.extname(target) !== '.json') throw Error('OUTPUT_MUST_BE_ARTIFACTS_JSON');
  // Avoid an existing symlink/junction escaping the ignored artifact directory.
  let directory = path.dirname(target);
  while (directory !== root && !fs.existsSync(directory)) directory = path.dirname(directory);
  const real = fs.realpathSync(directory);
  if (path.relative(fs.realpathSync(root), real).startsWith('..')) throw Error('OUTPUT_OUTSIDE_WORKSPACE');
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw Error('OUTPUT_LINK_REJECTED');
  return target;
}
function selfTest() {
  const assert = require('node:assert/strict');
  const fixture = { Runtime: 'Nodejs18.15', Status: 'Active', ModTime: '2026-10-22 00:00:00', Timeout: 15, MemorySize: 256,
    Handler: 'index.main', Triggers: [], Environment: { Variables: [{ Key: 'ADMIN_UIDS', Value: 'private-user' },
      { Key: 'API_KEY', Value: 'private-secret' }, { Key: 'AI_ENABLED', Value: 'false' }] } };
  const summary = summarize('appCore', fixture), serialized = JSON.stringify(summary);
  assert(!serialized.includes('private-')); assert(!serialized.includes('ADMIN_UIDS')); assert.equal(summary.flags.AI_ENABLED, false);
  assert.equal(summary.configHash, summarize('appCore', { ...fixture, Environment: { Variables: fixture.Environment.Variables.slice().reverse() } }).configHash);
  assert.notEqual(summary.configHash, summarize('appCore', { ...fixture, Timeout: 16 }).configHash);
  assert.throws(() => summarize('unknown', fixture)); assert.throws(() => summarize('appCore', {}));
  assert.throws(() => outputPath('../preflight.json')); assert.equal(actionMatrix().publicReads.every(item => item.cloudTested === false), true);
  console.log('Scenic cloud preflight safety checks passed (9 assertions; no cloud calls).');
}
function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) return selfTest();
  const target = outputPath(args.output), cli = args.cli || process.env.CHULINK_CLOUDBASE_CLI || defaultCli;
  if (!fs.existsSync(cli)) throw Error('CLI_NOT_FOUND');
  const config = JSON.parse(fs.readFileSync(path.join(root, 'cloudbaserc.json'), 'utf8'));
  const environment = process.env.TCB_ENV_ID || config.envId;
  if (!/^[\w-]{1,128}$/.test(environment || '')) throw Error('INVALID_ENVIRONMENT');
  const summary = { capturedAt: new Date().toISOString(), operation: 'read-only function metadata', containsEnvironmentValues: false,
    completed: false, functions: [], actionMatrix: actionMatrix(), failures: [] };
  let comparison;
  if (args.compare) {
    comparison = JSON.parse(fs.readFileSync(path.resolve(root, args.compare), 'utf8'));
    if (!Array.isArray(comparison.functions) || !comparison.completed) throw Error('INVALID_COMPARISON');
  }
  try {
    for (const name of names) {
      try {
        const row = readDetail(name, cli, environment);
        if (comparison) row.matchesBefore = comparison.functions.find(item => item.name === name)?.configHash === row.configHash;
        summary.functions.push(row);
        if (row.matchesBefore === false) summary.failures.push({ name, code: 'CONFIGURATION_CHANGED' });
      } catch (error) { summary.failures.push({ name, code: error.message }); break; }
    }
    summary.completed = summary.functions.length === names.length && summary.failures.length === 0;
  } finally {
    if (target) { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, JSON.stringify(summary, null, 2) + '\n'); }
    console.log(JSON.stringify(summary, null, 2));
  }
  if (!summary.completed) process.exitCode = 1;
}
if (require.main === module) {
  try { main(); } catch (error) {
    // File/OS errors can carry full paths or copied command fragments; suppress them.
    const code = /^[A-Z_]{3,60}$/.test(error.message) ? error.message : 'PREFLIGHT_FAILED';
    console.error(JSON.stringify({ completed: false, error: code, rawOutputSuppressed: true })); process.exitCode = 1;
  }
}
module.exports = { summarize, actionMatrix, parseArgs };
