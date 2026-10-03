'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { fakeDb } = require('./lib/fake-material-db');
const entry = path.resolve(__dirname, '../cloudfunctions/appCore/index.js');
const source = fs.readFileSync(entry, 'utf8');

async function main() {
  const db = fakeDb({ user_profiles: { fixture_owner: { nickname: '本地测试', uploadCount: 0 } } });
  const context = { require: createRequire(entry), db,
    ensureProfile: async () => ({ nickname: '本地测试', uploadCount: 0 }),
    cleanText: (value, max) => String(value == null ? '' : value).trim().slice(0, max),
    ALLOWED_ASSET_TYPES: new Set(['image']), MAX_FILE_BYTES: 25 * 1024 * 1024,
    SUBMISSION_COLLECTION: 'submissions', PROFILE_COLLECTION: 'user_profiles', ANONYMOUS: '匿名贡献者' };
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('async function createSubmission('), source.indexOf('exports.main =')) +
    '\nthis.submit=createSubmission;', context);
  vm.runInContext(source.slice(source.indexOf('function submissionView('), source.indexOf('async function ensureProfile(')) +
    '\nthis.view=submissionView;', context);
  const input = { fileID: 'cloud://local/submissions/fixture_owner/image.png',
    cloudPath: 'submissions/fixture_owner/image.png', size: 100, assetType: 'image',
    latitude: 30.5, longitude: 114.3, title: '  老巷门楣的凤鸟纹  ', description: '原始说明不会被标题替换' };
  const first = await context.submit('fixture_owner', {}, input);
  const stored = db.data().submissions[first.submission.id];
  assert.equal(stored.title, '老巷门楣的凤鸟纹');
  assert.equal(stored.description, input.description);
  assert.equal(stored.status, 'pending');
  assert.equal(stored.resourceId, undefined);
  assert.equal(stored.aiAnalysisConsent, false);
  assert.equal(stored.materialAnalysisConsent, false);
  assert.equal(first.submission.title, stored.title);
  const empty = await context.submit('fixture_owner', {}, { ...input, title: '' });
  assert.equal(empty.submission.title, '未命名文化采集素材');
  const long = await context.submit('fixture_owner', {}, { ...input, title: '字'.repeat(130) });
  assert.equal(long.submission.title.length, 120);
  const withdrawn = { ...stored, status: 'withdrawn', reviewNote: '首次通过', withdrawalNote: '请补充原始出处', withdrawnBy: 'private-admin' };
  assert.equal(context.view(withdrawn, true).reviewNote, withdrawn.withdrawalNote);
  assert.equal(context.view(withdrawn, false).reviewNote, '首次通过');
  assert.equal(context.view(withdrawn, true).withdrawnBy, undefined);
  assert.equal(db.data().point_ledger, undefined);
  console.log('Submission title persistence passed: custom/empty/long title, independent description, pending review, no binding or rewards, owner withdrawal reason.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
