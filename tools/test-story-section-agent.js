'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateSectionRevisionOutput, assembleSectionRevision } = require('../cloudfunctions/storyWorker/lib/story-contract');
const { createTokenHubClient } = require('../cloudfunctions/storyWorker/lib/tokenhub-client');

const parent = {
  title: '黄鹤楼题刻记录',
  introduction: '从已经确认的现场记录阅读楼内题刻线索。',
  closing: '这段记录仍可由后续资料继续补充。',
  chapters: [
    { title: '楼阁现场', body: '第一章保持原样，不属于本次修订范围。', sourceLinkIds: ['link_place'] },
    { title: '题刻线索', body: '原章节记录了楼内可以辨认的题刻。', sourceLinkIds: ['link_old'] }
  ]
};

async function main() {
  const output = validateSectionRevisionOutput({
    chapter: { title: '题刻与修缮', body: '新增修缮记录补充了题刻在近期维护中的保存情况。', sourceLinkIds: ['link_old', 'link_new'] },
    revisionSummary: '补充新确认的修缮记录及其来源。'
  }, ['link_old', 'link_new'], ['link_new']);
  const assembled = assembleSectionRevision(parent, 1, output);
  assert.equal(assembled.title, parent.title);
  assert.equal(assembled.introduction, parent.introduction);
  assert.equal(assembled.closing, parent.closing);
  assert.deepEqual(assembled.chapters[0], parent.chapters[0]);
  assert.notDeepEqual(assembled.chapters[1], parent.chapters[1]);
  assert.throws(() => validateSectionRevisionOutput({ ...output, title: '越界改名' }, ['link_old', 'link_new'], ['link_new']),
    error => error.code === 'AI_SECTION_SCOPE_VIOLATION');
  assert.throws(() => validateSectionRevisionOutput({ chapter: { ...output.chapter, sourceLinkIds: ['link_old'] }, revisionSummary: output.revisionSummary },
    ['link_old', 'link_new'], ['link_new']), error => error.code === 'AI_REQUIRED_SECTION_SOURCE_MISSING');
  assert.throws(() => validateSectionRevisionOutput({ chapter: { ...output.chapter, sourceLinkIds: ['invented'] }, revisionSummary: output.revisionSummary },
    ['link_old', 'link_new'], ['link_new']), error => error.code === 'AI_UNKNOWN_SECTION_SOURCE');

  let requestBody;
  const client = createTokenHubClient({
    config: { textModel: 'mock', maxOutputTokens: 1800, providerMaxAttempts: 1, retryBaseDelayMs: 1,
      baseUrl: 'https://example.test/v1', apiKey: 'test-only', requestTimeoutMs: 1000 },
    transport: async (_url, _options, body) => {
      requestBody = JSON.parse(body);
      return { id: 'mock-request', choices: [{ message: { content: JSON.stringify(output) } }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } };
    }
  });
  const result = await client.draftSectionRevision({ storyContext: { storyTitle: parent.title }, targetChapter: parent.chapters[1],
    sources: [{ linkId: 'link_old' }, { linkId: 'link_new' }], requiredSourceLinkIds: ['link_new'] });
  assert.equal(result.output.chapter.title, '题刻与修缮');
  assert.equal(requestBody.response_format.json_schema.name, 'chulink_section_revision_draft');
  assert.deepEqual(Object.keys(requestBody.response_format.json_schema.schema.properties).sort(), ['chapter', 'revisionSummary']);
  assert.equal(JSON.parse(requestBody.messages[1].content).targetChapter.title, parent.chapters[1].title);

  const root = path.resolve(__dirname, '..');
  const worker = fs.readFileSync(path.join(root, 'cloudfunctions/storyWorker/index.js'), 'utf8');
  const publisher = fs.readFileSync(path.join(root, 'cloudfunctions/adminSubmissions/domains/story-chains.js'), 'utf8');
  assert.match(worker, /generateSectionRevisionDraft/);
  assert.match(worker, /beforeAttempt:[\s\S]*buildSectionRevisionInput/);
  assert.match(worker, /runTransaction[\s\S]*buildSectionRevisionInput/);
  assert.match(worker, /generatedBy: 'section_revision_agent'/);
  assert.match(worker, /assembleSectionRevision/);
  assert.match(publisher, /AI_REVISION_SOURCE_CHANGED/);
  assert.match(publisher, /requiredSourceLinkIds/);
  console.log('Evidence-constrained section revision agent passed: scope lock, source contract, consent gates and draft-only persistence.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
