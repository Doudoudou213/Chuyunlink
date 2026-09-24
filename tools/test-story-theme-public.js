'use strict';
const assert = require('node:assert/strict');
const { fixture, draft } = require('./test-story-themes');
const { createStoryThemeService } = require('../cloudfunctions/adminSubmissions/domains/story-themes');
const { createPublicStoryThemeService } = require('../cloudfunctions/appCore/domains/story-themes');

async function publishFixture(db) {
  const admin = createStoryThemeService({ db });
  const saved = await admin.save(draft(), 'private_admin_uid');
  await admin.publish({ themeId: saved.themeId, expectedRevision: saved.revision,
    humanReviewed: true, reviewNote: '两个章节的事实与来源已经逐条核对' }, 'private_admin_uid');
  return { admin, themeId: saved.themeId };
}
async function main() {
  const db = fixture();
  db.data.submissions.get('s_hb').fileID = 'cloud://private-original-image';
  const { admin, themeId } = await publishFixture(db);
  const publicService = createPublicStoryThemeService({ db });
  const listed = await publicService.list();
  assert.equal(listed.items.length, 1);
  assert.deepEqual(listed.items[0].regions, ['湖北', '河南']);
  const first = await publicService.get({ themeId });
  assert.equal(first.ok, true);
  assert.equal(first.theme.chapters.length, 2);
  assert.equal(first.theme.nodes[0].location.latitude, 30.58);
  assert.equal(first.theme.relations[0].type, 'visually_similar_to');
  assert.equal(JSON.stringify(first).includes('private_admin_uid'), false);
  assert.equal(JSON.stringify(first).includes('cloud://private-original-image'), false);
  assert.equal(JSON.stringify(first).includes('s_hb'), false);
  assert.equal(first.theme.sources.length, 2);

  const edited = await admin.save({ ...draft(), title: '尚未发布的新名字',
    themeId, expectedRevision: 1 }, 'private_admin_uid');
  assert.equal(edited.revision, 2);
  assert.equal((await publicService.get({ themeId })).theme.title, first.theme.title,
    '保存草稿不能改写公开版本');
  await admin.publish({ themeId, expectedRevision: 2, humanReviewed: true,
    reviewNote: '新的标题和所有事实来源已经核对' }, 'private_admin_uid');
  assert.equal((await publicService.get({ themeId })).theme.version, 2);
  assert.equal(db.data.story_theme_versions.size, 2, '旧公开版本保留');

  db.data.submissions.get('s_hn').aiConsentRevokedAt = 'withdrawn';
  assert.equal((await publicService.get({ themeId })).ok, false);
  assert.equal((await publicService.list()).items.length, 0, '撤回来源后列表和详情都隐藏');
  db.data.submissions.get('s_hn').aiConsentRevokedAt = null;
  db.data.story_relations.get('rel1').status = 'archived';
  assert.equal((await publicService.get({ themeId })).ok, false, '正式关系归档后隐藏专题');
  db.data.story_relations.get('rel1').status = 'confirmed';
  db.data.story_claims.get('claim_hb').status = 'retired';
  assert.equal((await publicService.get({ themeId })).ok, false, '事实停用后隐藏专题');
  db.data.story_claims.get('claim_hb').status = 'supported';
  await admin.archive({ themeId, reason: '专题需要重新整理', }, 'private_admin_uid');
  assert.equal((await publicService.get({ themeId })).ok, false);
  console.log('Story theme public lifecycle, version and privacy checks passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
