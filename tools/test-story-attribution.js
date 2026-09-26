'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { fixture, draft } = require('./test-story-themes');
const { createSubmissionAttributionService } = require('../cloudfunctions/appCore/domains/submission-attribution');
const { createStoryThemeService } = require('../cloudfunctions/adminSubmissions/domains/story-themes');
const { createPublicStoryThemeService } = require('../cloudfunctions/appCore/domains/story-themes');

async function main() {
  const db = fixture();
  db.createCollection = async () => {};
  db.data.submissions.get('s_hb').userId = 'owner_1';
  db.data.submissions.get('s_hb').title = '凤鸟纹投稿';
  db.data.submissions.get('s_hb').contributorName = '旧昵称';
  db.data.submissions.get('s_hn').userId = 'owner_2';
  db.data.user_profiles = new Map([['owner_1', { nickname: '现在的昵称' }]]);
  const attribution = createSubmissionAttributionService({ db });
  const admin = createStoryThemeService({ db });
  const saved = await admin.save(draft(), 'admin');
  await admin.publish({ themeId: saved.themeId, expectedRevision: saved.revision,
    humanReviewed: true, reviewNote: '已核对章节、事实和来源' }, 'admin');
  const publicTheme = createPublicStoryThemeService({ db });
  const sources = async () => (await publicTheme.get({ themeId: saved.themeId })).theme.sources;
  assert.equal((await sources()).find(item => item.id === 'l_hb').contributorName, '匿名贡献者');
  assert.equal((await sources()).find(item => item.id === 'l_hb').submissionTitle, '凤鸟纹投稿');
  assert.equal((await sources()).find(item => item.id === 'l_hn').contributorName, '匿名贡献者');
  await assert.rejects(attribution.change({ submissionId: 's_hb', showNickname: true }, 'other'),
    { code: 'SUBMISSION_NOT_OWNED' });
  await assert.rejects(attribution.change({ submissionId: 's_hb', showNickname: 'true' }, 'owner_1'),
    { code: 'INVALID_ATTRIBUTION_CHOICE' });
  const granted = await attribution.change({ submissionId: 's_hb', showNickname: true }, 'owner_1');
  assert.equal(granted.revision, 1);
  assert.equal((await sources()).find(item => item.id === 'l_hb').contributorName, '现在的昵称');
  db.data.user_profiles.get('owner_1').nickname = '更新后的昵称';
  assert.equal((await sources()).find(item => item.id === 'l_hb').contributorName, '更新后的昵称');
  assert.equal((await attribution.change({ submissionId: 's_hb', showNickname: true }, 'owner_1')).cached, true);
  await attribution.change({ submissionId: 's_hb', showNickname: false }, 'owner_1');
  assert.equal((await sources()).find(item => item.id === 'l_hb').contributorName, '匿名贡献者');
  assert.equal(db.data.submission_attribution_logs.size, 2);
  const indexSource = fs.readFileSync(path.join(__dirname, '../cloudfunctions/appCore/index.js'), 'utf8');
  const submissionViewSource = indexSource.slice(indexSource.indexOf('function submissionView('),
    indexSource.indexOf('async function ensureProfile(', indexSource.indexOf('function submissionView(')));
  const submissionView = vm.runInNewContext(`${submissionViewSource}\nsubmissionView`,
    { ANONYMOUS: '匿名贡献者' });
  assert.equal(submissionView({ status: 'approved', contributorName: '旧昵称' }).contributorName,
    '匿名贡献者', '公开投稿列表也不能泄露旧署名');
  assert.equal(submissionView({ status: 'approved', publicContributorConsent: true }, true).publicContributorConsent,
    true, '个人主页能读取逐条署名选择');
  db.data.submissions.get('s_hb').status = 'pending';
  await assert.rejects(attribution.change({ submissionId: 's_hb', showNickname: true }, 'owner_1'),
    { code: 'SUBMISSION_NOT_APPROVED' });
  console.log('Per-submission attribution, live nickname and anonymous defaults passed.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
