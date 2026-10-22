'use strict';
// Metadata only: no document query, collection creation, or permission changes.
// Uses read APIs documented by the installed CLI and the reviewed import helper.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const cli = process.env.CHULINK_CLOUDBASE_CLI || 'C:/Users/lenovo/AppData/Local/npm-cache/_npx/9a8789722ddc2fbe/node_modules/@cloudbase/cli/bin/tcb';
const collections = ['guide_question_usage', 'site_walks', 'site_walk_versions', 'site_walk_logs', 'exploration_assets', 'visit_sessions'];
const allowed = new Set(['tcb:DescribeEnvs', 'flexdb:DescribeTable', 'tcb:DescribeSafeRule']);
function safeError(raw, timedOut) {
  if (timedOut) return 'TIMEOUT';
  if (/TableNotExist|TableNotFound|CollectionNotExist|COLLECTION_NOT_EXIST|collection.*not.*exist|table.*not.*exist/i.test(raw)) return 'COLLECTION_NOT_FOUND';
  if (/ResourceNotFound/i.test(raw)) return 'RESOURCE_NOT_FOUND';
  if (/not.?login|未登录|请.*登录|login expired|登录.*失效|no valid credential/i.test(raw)) return 'AUTHENTICATION_REQUIRED';
  if (/permission|Unauthorized|Forbidden|access.?denied/i.test(raw)) return 'PERMISSION_DENIED';
  if (/ECONN|ENOTFOUND|TLS|SSL|socket|network|网络/i.test(raw)) return 'NETWORK_UNAVAILABLE';
  return 'METADATA_READ_FAILED';
}
function call(service, action, body, environment, apiVersion) {
  if (!allowed.has(service + ':' + action)) throw Error('READ_ONLY_ALLOWLIST');
  const args = [cli, 'api', service, action, '--body', JSON.stringify(body), '-e', environment, '--json'];
  if (apiVersion) args.push('--api-version', apiVersion);
  const response = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 45000,
    maxBuffer: 4 * 1024 * 1024, windowsHide: true, env: { ...process.env, CI: 'true' } });
  const raw = String(response.stdout || '') + '\n' + String(response.stderr || '');
  if (response.error || response.status !== 0) throw Error(safeError(raw, response.error?.code === 'ETIMEDOUT'));
  let parsed;
  try {
    const output = String(response.stdout || '').replace(/\u001b\[[0-9;]*m/g, '');
    parsed = JSON.parse(output.slice(output.indexOf('{'), output.lastIndexOf('}') + 1));
  } catch { throw Error('INVALID_METADATA_RESPONSE'); }
  const data = parsed.data?.Response || parsed.data || parsed.Response || parsed;
  if (parsed.error || data.Error) throw Error(safeError(JSON.stringify(parsed.error || data.Error), false));
  return data;
}
function summarizeRule(rule) {
  const acl = ['ADMINONLY', 'READONLY', 'ADMINWRITE', 'PRIVATE', 'CUSTOM'].includes(rule?.AclTag) ? rule.AclTag : 'UNKNOWN';
  let custom = rule?.Rule || rule?.SecurityRule || null;
  if (typeof custom === 'string') { try { custom = JSON.parse(custom); } catch { custom = null; } }
  const falseValue = value => value === false || value === 'false';
  const customDenied = custom && typeof custom === 'object' && falseValue(custom.read) && falseValue(custom.write);
  // Do not infer equivalence from arbitrary executable rules or UID lists.
  return { acl, clientReadWriteDenied: acl === 'ADMINONLY' || acl === 'CUSTOM' && !!customDenied,
    ruleHash: crypto.createHash('sha256').update(JSON.stringify({ acl, rule: rule?.Rule || rule?.SecurityRule || null })).digest('hex') };
}
function targetPath(value) {
  if (!value) return null;
  const target = path.resolve(root, value), relative = path.relative(path.join(root, 'artifacts'), target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || path.extname(target) !== '.json') throw Error('OUTPUT_MUST_BE_ARTIFACTS_JSON');
  let directory = path.dirname(target);
  while (directory !== root && !fs.existsSync(directory)) directory = path.dirname(directory);
  if (path.relative(fs.realpathSync(root), fs.realpathSync(directory)).startsWith('..')) throw Error('OUTPUT_OUTSIDE_WORKSPACE');
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw Error('OUTPUT_LINK_REJECTED');
  return target;
}
function selfTest() {
  const assert = require('node:assert/strict');
  assert.equal(summarizeRule({ AclTag: 'ADMINONLY' }).clientReadWriteDenied, true);
  assert.equal(summarizeRule({ AclTag: 'CUSTOM', Rule: '{"read":false,"write":false}' }).clientReadWriteDenied, true);
  assert.equal(summarizeRule({ AclTag: 'CUSTOM', Rule: '{"read":"auth.uid == private-id","write":false}' }).clientReadWriteDenied, false);
  assert.equal(summarizeRule({ AclTag: 'PRIVATE' }).clientReadWriteDenied, false);
  assert(!JSON.stringify(summarizeRule({ AclTag: 'CUSTOM', Rule: 'private-identity' })).includes('private-identity'));
  assert.throws(() => targetPath('../unsafe.json'));
  assert.equal(safeError('ECONNRESET', false), 'NETWORK_UNAVAILABLE');
  assert.equal(safeError('ResourceNotFound', false), 'RESOURCE_NOT_FOUND');
  console.log('Scenic database metadata safety checks passed (8 assertions; no cloud calls).');
}
function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--self-test') return selfTest();
  if (args.length && !(args.length === 2 && args[0] === '--output')) throw Error('INVALID_ARGUMENT');
  const target = targetPath(args[1]);
  const environment = process.env.TCB_ENV_ID || JSON.parse(fs.readFileSync(path.join(root, 'cloudbaserc.json'), 'utf8')).envId;
  if (!/^[\w-]{1,128}$/.test(environment || '')) throw Error('INVALID_ENVIRONMENT');
  const summary = { capturedAt: new Date().toISOString(), operation: 'read-only collection existence and permission metadata',
    containsDocumentsOrUserIdentifiers: false, metadataCompleted: false, releasePermissionsReady: false, collections: [] };
  try {
    const environments = call('tcb', 'DescribeEnvs', { EnvId: environment }, environment, '2018-06-08');
    const current = environments.EnvList?.find(item => item.EnvId === environment) || environments.Envs?.find(item => item.EnvId === environment);
    const tag = current?.Databases?.[0]?.InstanceId;
    if (typeof tag !== 'string' || !tag) throw Error('DATABASE_INSTANCE_NOT_RESOLVED');
    for (const name of collections) {
      const row = { name, exists: null, acl: null, clientReadWriteDenied: null };
      try {
        call('flexdb', 'DescribeTable', { Tag: tag, TableName: name }, environment, '2018-11-27');
        row.exists = true;
      } catch (error) {
        row.existenceError = error.message;
        if (['COLLECTION_NOT_FOUND', 'RESOURCE_NOT_FOUND'].includes(error.message)) row.exists = false;
      }
      if (row.exists === true) {
        try { Object.assign(row, summarizeRule(call('tcb', 'DescribeSafeRule', { EnvId: environment, CollectionName: name }, environment, '2018-06-08'))); }
        catch (error) { row.permissionError = error.message; }
      }
      summary.collections.push(row);
    }
    summary.metadataCompleted = summary.collections.length === collections.length && summary.collections.every(row => row.exists !== null && (row.exists === false || row.clientReadWriteDenied !== null));
    summary.releasePermissionsReady = summary.metadataCompleted && summary.collections.every(row => row.exists && row.clientReadWriteDenied);
  } catch (error) { summary.failure = /^[A-Z_]{3,60}$/.test(error.message) ? error.message : 'METADATA_CHECK_FAILED'; }
  finally {
    if (target) { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, JSON.stringify(summary, null, 2) + '\n'); }
    console.log(JSON.stringify(summary, null, 2));
  }
  if (!summary.releasePermissionsReady) process.exitCode = 1;
}
if (require.main === module) {
  try { main(); } catch (error) {
    console.error(JSON.stringify({ completed: false, error: /^[A-Z_]{3,60}$/.test(error.message) ? error.message : 'METADATA_CHECK_FAILED', rawOutputSuppressed: true })); process.exitCode = 1;
  }
}
module.exports = { summarizeRule, safeError };
