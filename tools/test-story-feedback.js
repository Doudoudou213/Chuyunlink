'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const core = read('cloudfunctions/appCore/index.js');
const adminFunction = read('cloudfunctions/adminSubmissions/index.js');
const client = read('static/cloudbase-app.js');
const admin = read('admin.html');

const checks = [
  ['故事纠错是独立反馈类型', () => assert.match(core, /ALLOWED_FEEDBACK_TYPES[^\n]+story_correction/)],
  ['纠错类型使用服务端白名单', () => assert.match(core, /ALLOWED_STORY_CORRECTION_KINDS[^\n]+content_error[^\n]+source_suggestion[^\n]+wording/)],
  ['服务端核对故事 ID、资源和版本', () => assert.match(core, /story\.resourceId !== resourceId[\s\S]+story\.version[\s\S]+STORY_VERSION_CHANGED/)],
  ['已发布与刚被替换的版本都能保留反馈', () => assert.match(core, /\['published', 'superseded'\]\.includes\(story\.status\)/)],
  ['章节标题由服务端故事数据推导', () => assert.match(core, /chapterTitle: chapterIndex >= 0 \? cleanText\(chapters\[chapterIndex\]/)],
  ['个人反馈只返回脱敏故事上下文', () => assert.match(core, /storyContext: item\.type === 'story_correction'/)],
  ['管理员日志记录故事版本与章节', () => assert.match(adminFunction, /storyVersion:[\s\S]+resourceId:[\s\S]+chapterIndex:[\s\S]+correctionKind:/)],
  ['管理员可以明确纳入故事修订', () => assert.match(adminFunction, /accepted_for_revision/)],
  ['普通反馈不能被误标为故事修订', () => assert.match(adminFunction, /current\.type !== 'story_correction'[\s\S]+INVALID_FEEDBACK_REVISION_TARGET/)],
  ['故事阅读器内直接提供反馈表单', () => assert.match(client, /id="cloud-story-feedback-form"/)],
  ['客户端绑定当前故事而非自由填写引用', () => assert.match(client, /storyId: story\.id,[\s\S]+storyVersion: story\.version/)],
  ['未登录用户会先进入登录流程', () => assert.match(client, /登录后可以提交故事纠错/)],
  ['管理员界面展示故事版本上下文', () => assert.match(admin, /纳入故事修订/)]
];

for (const [label, check] of checks) {
  check();
  process.stdout.write(`✓ ${label}\n`);
}

process.stdout.write(`故事反馈闭环测试通过：${checks.length} 项。\n`);
