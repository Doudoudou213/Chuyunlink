'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  QUALITY_VERSION,
  GENERATION_THRESHOLD,
  PUBLICATION_THRESHOLD,
  assessStoryReadiness,
  evidenceContextFromInput,
  assessStoryQuality
} = require('../cloudfunctions/storyWorker/lib/story-quality');
const { assessStoryQuality: assessAdminStoryQuality } = require('../cloudfunctions/adminSubmissions/domains/story-quality');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function sourceInput() {
  return {
    resource: {
      id: 'yellow-crane-tower',
      title: '黄鹤楼',
      summary: '黄鹤楼是武汉的重要文化地标，现有社区资料记录其碑廊与周边空间。'
    },
    sources: [{
      linkId: 'story_confirmed_1',
      relationType: 'documents_inscription',
      evidenceSummary: '投稿记录了黄鹤楼东侧碑廊题刻在2026年的现场状态。',
      submission: {
        title: '碑廊题刻记录',
        description: '拍摄时可以看到题刻表面存在风化痕迹，文字仍能辨认，石面下部颜色较深，照片保留了当日的现场位置和光线。',
        supplements: []
      }
    }]
  };
}

function goodStory() {
  return {
    title: '碑廊里的一次现场记录',
    introduction: '一位记录者把黄鹤楼东侧碑廊的题刻现状留在了社区资料中。',
    chapters: [{
      title: '石面上的痕迹',
      body: '照片中的石面已有风化痕迹，部分文字仍可辨认。较深的下部颜色和拍摄时的光线，共同留下了这次现场观察的具体位置与状态。',
      sourceLinkIds: ['story_confirmed_1']
    }],
    closing: '这份记录仍可由后来的到访者继续补充。'
  };
}

function main() {
  assert.equal(QUALITY_VERSION, 'story-quality-v2');
  assert.equal(GENERATION_THRESHOLD, 55);
  assert.equal(PUBLICATION_THRESHOLD, 70);

  const readiness = assessStoryReadiness(sourceInput());
  assert.equal(readiness.ready, true);
  assert.ok(readiness.score >= GENERATION_THRESHOLD);
  const weak = sourceInput();
  weak.resource.summary = '';
  weak.sources[0].evidenceSummary = '';
  weak.sources[0].submission.description = '只有标题';
  assert.equal(assessStoryReadiness(weak).ready, false);

  const context = evidenceContextFromInput(sourceInput());
  const good = assessStoryQuality(goodStory(), context);
  assert.equal(good.hardFailures.length, 0);
  assert.equal(good.publicationEligible, true);
  assert.ok(good.score >= PUBLICATION_THRESHOLD);
  const adminGood = assessAdminStoryQuality(goodStory(), context);
  assert.deepEqual({ ...adminGood, evaluatedAt: '' }, { ...good, evaluatedAt: '' });

  const unknownSource = goodStory();
  unknownSource.chapters[0].sourceLinkIds = ['unknown_link'];
  assert.ok(assessStoryQuality(unknownSource, context).hardFailures.includes('unknown_source_reference'));

  const sensitive = goodStory();
  sensitive.chapters[0].body += ' 联系电话是13800138000。';
  assert.ok(assessStoryQuality(sensitive, context).hardFailures.includes('sensitive_information_detected'));

  const unsupported = goodStory();
  unsupported.chapters[0].body += ' 这座建筑在1888年完成重建。';
  assert.match(assessStoryQuality(unsupported, context).warnings.join(' '), /1888年/);

  const generic = goodStory();
  generic.introduction = '它穿越千年，在历史长河中成为文化瑰宝，承载着深厚底蕴。';
  generic.chapters[0].body += ' 它诉说着古老故事，见证了时代变迁，至今仍熠熠生辉并且源远流长。';
  const genericResult = assessStoryQuality(generic, context);
  assert.ok(genericResult.score < good.score);
  assert.match(genericResult.warnings.join(' '), /空泛表达/);

  const worker = read('cloudfunctions/storyWorker/index.js');
  const storyConfig = read('cloudfunctions/storyWorker/lib/config.js');
  const tokenHubClient = read('cloudfunctions/storyWorker/lib/tokenhub-client.js');
  const adminDomain = read('cloudfunctions/adminSubmissions/domains/story-chains.js');
  const adminHtml = read('admin.html');
  const appCore = read('cloudfunctions/appCore/index.js');
  const publicHtml = read('index.html');
  assert.match(worker, /assessStoryReadiness/);
  assert.match(worker, /AI_STORY_QUALITY_BLOCKED/);
  assert.match(worker, /qualityAssessment/);
  assert.match(storyConfig, /sourced-story-contract-v2/);
  assert.match(tokenHubClient, /年代、数字、人物和地点必须在所引来源中直接出现/);
  assert.match(adminDomain, /STORY_QUALITY_OVERRIDE_REQUIRED/);
  assert.match(adminDomain, /qualityOverrideReason/);
  assert.match(adminHtml, /校读签/);
  assert.match(adminHtml, /data-story-quality-override/);
  assert.match(appCore, /editorialLabel/);
  assert.match(publicHtml, /共同讲述/);
  assert.doesNotMatch(publicHtml, /qualityAssessment\.score|quality\.score/);

  console.log('Story quality v2 tests passed (evidence, traceability, privacy, specificity and simple UI).');
}

main();
