'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { validateSectionRevision } = require('../cloudfunctions/adminSubmissions/domains/story-chains');
const { materialFreshness, suggestImpactedChapter } = require('../cloudfunctions/adminSubmissions/domains/story-revision-impact');

const parentStory = {
  _id: 'story-v1',
  status: 'published',
  version: 1,
  title: '黄鹤楼的题刻记忆',
  introduction: '从两份现场记录认识楼阁中的文字线索。',
  closing: '真实资料仍会继续补充这段故事。',
  chapters: [
    { title: '楼阁现场', body: '黄鹤楼是武汉的重要文化地标。', sourceLinkIds: ['link-place'] },
    { title: '题刻线索', body: '楼内现存多处题刻，记录了游览记忆。', sourceLinkIds: ['link-inscription'] }
  ]
};

function revisionInput() {
  return {
    title: parentStory.title,
    introduction: parentStory.introduction,
    closing: parentStory.closing,
    chapters: parentStory.chapters.map((chapter) => ({ ...chapter, sourceLinkIds: [...chapter.sourceLinkIds] }))
  };
}

const draft = { revisionMode: 'section_patch', parentStoryId: 'story-v1', targetChapterIndex: 1 };
const valid = revisionInput();
valid.chapters[1].body = '楼内现存多处题刻；新审核的修缮记录补充了近现代变化。';
valid.chapters[1].sourceLinkIds.push('link-repair');
const diff = validateSectionRevision(draft, parentStory, valid);
assert.strictEqual(diff.targetChapterIndex, 1);
assert.strictEqual(diff.before.body, parentStory.chapters[1].body);
assert.ok(diff.after.sourceLinkIds.includes('link-repair'));

const changedOtherChapter = revisionInput();
changedOtherChapter.chapters[0].body = '不应修改的第一章。';
changedOtherChapter.chapters[1].body += '新增内容。';
assert.throws(() => validateSectionRevision(draft, parentStory, changedOtherChapter), /不在本次修订范围/);

const changedTitle = revisionInput();
changedTitle.title = '整篇改名';
changedTitle.chapters[1].body += '新增内容。';
assert.throws(() => validateSectionRevision(draft, parentStory, changedTitle), /只能修改所选章节/);

assert.throws(() => validateSectionRevision(draft, parentStory, revisionInput()), /还没有发生变化/);
assert.throws(() => validateSectionRevision(draft, { ...parentStory, status: 'superseded' }, valid), /不是当前发布版本/);

assert.strictEqual(materialFreshness({}, {}, '2026-08-20T00:00:00.000Z', false), 'new_source');
assert.strictEqual(materialFreshness({}, { storyMaterialUpdatedAt: '2026-08-21T00:00:00.000Z' }, '2026-08-20T00:00:00.000Z', true), 'updated_material');
assert.strictEqual(materialFreshness({ reviewedAt: '2026-08-19T00:00:00.000Z' }, {}, '2026-08-20T00:00:00.000Z', true), '');

const linkById = new Map([
  ['link-place', { relationType: 'documents_place' }],
  ['link-inscription', { relationType: 'documents_inscription' }]
]);
const impact = suggestImpactedChapter({
  chapters: parentStory.chapters,
  link: { relationType: 'documents_inscription', evidenceSummary: '新增碑文题刻近景。' },
  linkById,
  submission: { title: '碑文近景', description: '现场记录题刻文字。' }
});
assert.strictEqual(impact.chapterIndex, 1, '同类来源应优先建议到已有题刻章节');
assert.ok(['high', 'medium'].includes(impact.confidence));
const unknownImpact = suggestImpactedChapter({
  chapters: parentStory.chapters,
  link: { relationType: 'supports_story', evidenceSummary: '一条无法分类的补充。' },
  linkById,
  submission: {}
});
assert.strictEqual(unknownImpact.chapterIndex, null, '没有可靠信号时不应强行指定章节');

const root = path.resolve(__dirname, '..');
const adminSource = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
const publicSource = fs.readFileSync(path.join(root, 'static', 'cloudbase-app.js'), 'utf8');
const appCoreSource = fs.readFileSync(path.join(root, 'cloudfunctions', 'appCore', 'domains', 'story-evidence.js'), 'utf8');
const storyWorkerSource = fs.readFileSync(path.join(root, 'cloudfunctions', 'storyWorker', 'index.js'), 'utf8');
assert.match(adminSource, /createStoryRevisionDraft/);
assert.match(adminSource, /本次保持不变/);
assert.match(adminSource, /查看修改前正文/);
assert.match(adminSource, /给读者看的修订说明/);
assert.match(adminSource, /getStoryRevisionImpactWorkspace/);
assert.match(adminSource, /没有调用 AI，也没有修改正文/);
assert.match(publicSource, /本版修订/);
assert.match(appCoreSource, /revisionSummary/);
assert.match(storyWorkerSource, /revisionDiff/);

console.log('story section revisions: ok');
