'use strict';

const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const { validateStoryDraft } = require('../cloudfunctions/storyWorker/lib/story-contract');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function main() {
  const valid = validateStoryDraft({
    title: '一块题刻留下的今日回声',
    introduction: '这是一段只依据已审核社区记录整理的故事导语。',
    chapters: [{
      title: '碑廊一隅',
      body: '社区记录显示，这处题刻在拍摄当日仍可以辨认，照片保留了现场状态。',
      sourceLinkIds: ['story_confirmed_1']
    }],
    closing: '更多资料仍可继续补充。'
  }, ['story_confirmed_1']);
  assert.equal(valid.chapters[0].sourceLinkIds[0], 'story_confirmed_1');
  assert.throws(() => validateStoryDraft({
    title: '无来源草稿',
    introduction: '这段导语长度足够但章节引用了不存在的来源。',
    chapters: [{ title: '章节', body: '这是一段长度足够的章节正文内容。', sourceLinkIds: ['unknown'] }],
    closing: ''
  }, ['story_confirmed_1']), (error) => error.code === 'AI_UNKNOWN_STORY_SOURCE');

  const worker = read('cloudfunctions/storyWorker/index.js');
  const adminDomain = read('cloudfunctions/adminSubmissions/domains/story-chains.js');
  const publicDomain = read('cloudfunctions/appCore/domains/story-evidence.js');
  const adminHtml = read('admin.html');
  const client = read('static/cloudbase-app.js');
  const appCore = read('cloudfunctions/appCore/index.js');
  const publicHtml = read('index.html');

  assert.match(worker, /item\.status === 'confirmed'/);
  assert.match(worker, /submission\.status !== 'approved'/);
  assert.match(worker, /status:\s*'draft'/);
  assert.match(worker, /function storyReadiness/);
  assert.match(worker, /STORY_EVIDENCE_INSUFFICIENT/);
  assert.doesNotMatch(worker.match(/async function runStoryDraft[\s\S]*?\n}\n\nasync function storyDraftWorkspace/)[0], /status:\s*'published'/);
  assert.match(adminDomain, /link\.status !== 'confirmed'/);
  assert.match(adminDomain, /submission\.status !== 'approved'/);
  assert.match(adminDomain, /status:\s*'published'/);
  assert.match(adminDomain, /STORY_LOG_COLLECTION/);
  assert.match(publicDomain, /item\.status === 'published'/);
  assert.match(publicDomain, /validLinkIds\.has\(id\)/);
  assert.match(adminHtml, /生成带来源草稿/);
  assert.match(adminHtml, /审核无误并发布/);
  assert.match(client, /故事讲述/);
  assert.match(client, /data-story-open-source/);
  assert.match(client, /function renderStoryEvidenceGraphV2/);
  assert.match(client, /renderStoryEvidenceGraphV2\(result\)/);
  assert.match(appCore, /async function attachSubmissionStoryCards/);
  assert.match(appCore, /storyCard/);
  assert.match(appCore, /storyReadiness/);
  assert.match(publicHtml, /function renderInlineStoryCard/);
  assert.match(publicHtml, /discover-detail-story/);

  console.log('Sourced story draft security and integration tests passed.');
}

main();
