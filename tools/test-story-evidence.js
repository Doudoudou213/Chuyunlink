'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { fakeDb } = require('./test-story-agent-reviews');
const {
  createStoryEvidenceService
} = require('../cloudfunctions/appCore/domains/story-evidence');
const {
  ALLOWED_RELATION_TYPES,
  linkIdFor
} = require('../cloudfunctions/adminSubmissions/domains/story-evidence');

const root = path.resolve(__dirname, '..');

function mockDatabase() {
  const records = {
    resources: {
      'yellow-crane-tower': {
        _id: 'yellow-crane-tower',
        title: '黄鹤楼',
        summary: '武汉文化地标',
        status: 'published'
      }
    },
    submissions: {
      approved_1: {
        _id: 'approved_1',
        status: 'approved',
        title: '东侧题刻记录',
        description: '记录题刻现状',
        assetType: 'image',
        contributorName: '测试记录者',
        userId: 'must-not-leak',
        imageFileID: 'cloud://approved.jpg',
        createdAt: '2026-08-12T00:00:00.000Z'
      },
      rejected_1: {
        _id: 'rejected_1',
        status: 'rejected',
        title: '未公开投稿',
        userId: 'must-not-leak-either'
      }
    },
    user_profiles: { 'must-not-leak': { nickname: '现在的公开昵称' } },
    story_chains: [{
      _id: 'story_1', resourceId: 'yellow-crane-tower', status: 'published', version: 1,
      title: '题刻故事', introduction: '东侧题刻的现场记录', sourceLinkIds: ['story_confirmed'],
      chapters: [{ title: '现场记录', body: '记录了东侧题刻的当前保存状态。', sourceLinkIds: ['story_confirmed'] }]
    }],
    story_claims: [{
      _id: 'claim_1', storyId: 'story_1', resourceId: 'yellow-crane-tower', storyVersion: 1,
      chapterIndex: 0, status: 'supported', claimText: '记录了东侧题刻的当前保存状态。', sourceLinkIds: ['story_confirmed']
    }],
    story_evidence_links: [
      {
        _id: 'story_confirmed',
        resourceId: 'yellow-crane-tower',
        submissionId: 'approved_1',
        status: 'confirmed',
        relationType: 'documents_inscription',
        evidenceSummary: '记录了东侧题刻的当前保存状态。'
      },
      {
        _id: 'story_archived',
        resourceId: 'yellow-crane-tower',
        submissionId: 'approved_1',
        status: 'archived',
        evidenceSummary: '不应公开'
      },
      {
        _id: 'story_rejected_source',
        resourceId: 'yellow-crane-tower',
        submissionId: 'rejected_1',
        status: 'confirmed',
        evidenceSummary: '来源状态不合格'
      }
    ]
  };
  return {
    records,
    collection(name) {
      return {
        doc(id) {
          return { async get() {
            const item = Array.isArray(records[name]) ? records[name].find(row => row._id === id) : records[name] && records[name][id];
            return { data: item ? [item] : [] };
          } };
        },
        where(filter) {
          return {
            limit() {
              return {
                async get() {
                  const source = Array.isArray(records[name]) ? records[name] : Object.values(records[name] || {});
                  return { data: source.filter((item) => Object.entries(filter).every(([key, value]) => item[key] === value)) };
                }
              };
            }
          };
        }
      };
    }
  };
}

async function main() {
  assert.equal(ALLOWED_RELATION_TYPES.has('documents_inscription'), true);
  assert.equal(linkIdFor('approved_1', 'yellow-crane-tower'), linkIdFor('approved_1', 'yellow-crane-tower'));
  assert.notEqual(linkIdFor('approved_1', 'yellow-crane-tower'), linkIdFor('approved_2', 'yellow-crane-tower'));

  const db = mockDatabase();
  const service = createStoryEvidenceService({
    db,
    app: {
      async getTempFileURL() {
        return { fileList: [{ fileID: 'cloud://approved.jpg', tempFileURL: 'https://example.test/approved.jpg' }] };
      }
    }
  });
  const result = await service.list({ resourceId: 'yellow-crane-tower' });
  assert.equal(result.count, 1, '只公开 confirmed 且来源投稿为 approved 的关系');
  assert.equal(result.items[0].submission.fileUrl, 'https://example.test/approved.jpg');
  assert.equal(result.items[0].submission.contributorName, '匿名贡献者', '旧投稿默认匿名');
  db.records.submissions.approved_1.publicContributorConsent = true;
  assert.equal((await service.list({ resourceId: 'yellow-crane-tower' })).items[0].submission.contributorName,
    '现在的公开昵称', '用户主动勾选后才展示当前昵称');
  db.records.submissions.approved_1.publicContributorConsent = false;
  assert.equal(Object.hasOwn(result.items[0].submission, 'userId'), false, '公共接口不得暴露投稿者 UID');
  assert.equal(Object.hasOwn(result.items[0].submission, 'location'), false, '公共接口不得暴露投稿的精确位置');
  assert.equal(JSON.stringify(result).includes('must-not-leak'), false, '公共响应不得泄露用户 UID');
  assert.equal(result.story.id, 'story_1');
  assert.equal(result.claims.length, 1);
  db.records.submissions.gap_source = { _id: 'gap_source', status: 'approved' };
  db.records.story_agent_candidates = { gap_candidate: { status: 'approved', submissionId: 'gap_source' } };
  db.records.story_gap_tasks = [
    { _id: 'manual_gap', status: 'published', storyId: 'story_1', storyVersion: 1,
      resourceId: 'yellow-crane-tower', title: '人工征集', description: '补充现场照片' },
    { _id: 'agent_gap', status: 'published', storyId: 'story_1', storyVersion: 1,
      resourceId: 'yellow-crane-tower', title: '候选形成的征集', description: '补充题刻原文', sourceAgentCandidateId: 'gap_candidate' }
  ];
  assert.equal((await service.list({ resourceId: 'yellow-crane-tower' })).gapTasks.length, 2);
  db.records.submissions.gap_source.status = 'withdrawn';
  const safeTasks = await service.list({ resourceId: 'yellow-crane-tower' });
  assert.equal(safeTasks.story.id, 'story_1', '撤下另一个来源不影响仍有效的故事');
  assert.deepEqual(safeTasks.gapTasks.map(item => item.id), ['manual_gap'], '传播未完成时也不公开已撤下来源的征集任务');
  db.records.submissions.gap_source.status = 'approved';
  db.records.story_agent_candidates.gap_candidate.status = 'source_withdrawn';
  assert.equal((await service.list({ resourceId: 'yellow-crane-tower' })).gapTasks.length, 1);
  db.records.story_agent_candidates.gap_candidate = {
    status: 'approved', submissionId: 'gap_source', jobId: 'gap_job', payload: { evidenceLinkIds: [] }
  };
  db.records.submissions.model_context = { _id: 'model_context', status: 'approved' };
  db.records.story_evidence_links.push({ _id: 'context_link', status: 'confirmed',
    resourceId: 'yellow-crane-tower', submissionId: 'model_context' });
  db.records.story_agent_jobs = { gap_job: { status: 'awaiting_review', input: {
    evidenceLinks: [{ id: 'context_link', resourceId: 'yellow-crane-tower' }]
  } } };
  assert.equal((await service.list({ resourceId: 'yellow-crane-tower' })).gapTasks.length, 2);
  db.records.submissions.model_context.status = 'withdrawn';
  db.records.submissions.model_context.sourceReviewPending = true;
  const withdrawnContext = await service.list({ resourceId: 'yellow-crane-tower' });
  assert.equal(withdrawnContext.story.id, 'story_1', '模型上下文来源下架不应隐藏独立有效的故事');
  assert.deepEqual(withdrawnContext.gapTasks.map(item => item.id), ['manual_gap'],
    '传播未完成时，候选主投稿有效且未引用下架资料，也须复核模型任务全部上下文');
  assert.equal(db.records.story_agent_candidates.gap_candidate.status, 'approved');
  assert.equal(db.records.story_agent_jobs.gap_job.status, 'awaiting_review');
  db.records.submissions.model_context.status = 'approved';
  assert.equal((await service.list({ resourceId: 'yellow-crane-tower' })).gapTasks.length, 2,
    '来源缓存只在本次读取内有效');
  db.records.story_agent_jobs.gap_job.status = 'source_invalid';
  assert.equal((await service.list({ resourceId: 'yellow-crane-tower' })).gapTasks.length, 1);
  delete db.records.story_agent_jobs.gap_job;
  assert.equal((await service.list({ resourceId: 'yellow-crane-tower' })).gapTasks.length, 1);
  db.records.story_evidence_links.pop();
  db.records.story_gap_tasks = [];
  db.records.submissions.approved_1.aiConsentRevokedAt = '2026-09-07';
  const withdrawn = await service.list({ resourceId: 'yellow-crane-tower' });
  assert.equal(withdrawn.items.length, 1, '撤回 AI 授权不删除原公开投稿');
  assert.equal(withdrawn.story, null, '依赖撤回来源的故事应隐藏');
  assert.equal(withdrawn.claims.length, 0, '故事隐藏时事实断言也应隐藏');

  const appSource = fs.readFileSync(path.join(root, 'cloudfunctions/appCore/index.js'), 'utf8');
  const cardFunction = appSource.slice(appSource.indexOf('async function attachSubmissionStoryCards('),
    appSource.indexOf('async function listPublic(', appSource.indexOf('async function attachSubmissionStoryCards(')));
  const cardDb = fakeDb({
    submissions: { approved_1: { status: 'approved' } },
    story_evidence_links: { story_confirmed: {
      status: 'confirmed', submissionId: 'approved_1', resourceId: 'yellow-crane-tower'
    } },
    story_chains: { story_1: {
      status: 'published', needsSourceReview: true, title: '题刻故事', resourceId: 'yellow-crane-tower',
      sourceLinkIds: ['story_confirmed'], chapters: [{ title: '现场', body: '题刻现状记录', sourceLinkIds: ['story_confirmed'] }]
    } }
  });
  const attachCards = vm.runInNewContext(`${cardFunction}\nattachSubmissionStoryCards`, {
    materialLinkValid: require('./lib/material-evidence').materialLinkValid, db: cardDb, STORY_LINK_COLLECTION: 'story_evidence_links', STORY_CHAIN_COLLECTION: 'story_chains',
    SUBMISSION_COLLECTION: 'submissions', console,
    firstDocument: result => result.data[0] || null,
    cleanText: (value, limit) => String(value || '').trim().slice(0, limit)
  });
  const cardInput = [{ id: 'approved_1', description: '现场记录', completeness: 80, approvedSupplements: [] }];
  assert.equal((await attachCards(cardInput))[0].storyCard, null, '待复核故事不能出现在发现页');
  cardDb.data().story_chains.story_1.needsSourceReview = false;
  assert.equal((await attachCards(cardInput))[0].storyCard.id, 'story_1');
  cardDb.data().submissions.approved_1.aiConsentRevokedAt = '2026-09-07';
  assert.equal((await attachCards(cardInput))[0].storyCard, null, '撤回来源不能再支撑发现页故事卡片');

  await assert.rejects(() => service.list({ resourceId: '../unsafe' }), (error) => error.code === 'INVALID_RESOURCE_ID');

  const adminSource = fs.readFileSync(path.join(root, 'cloudfunctions/adminSubmissions/domains/story-evidence.js'), 'utf8');
  const adminIndex = fs.readFileSync(path.join(root, 'cloudfunctions/adminSubmissions/index.js'), 'utf8');
  const appIndex = fs.readFileSync(path.join(root, 'cloudfunctions/appCore/index.js'), 'utf8');
  const adminHtml = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
  const clientSource = fs.readFileSync(path.join(root, 'static/cloudbase-app.js'), 'utf8');
  assert.equal(/\.remove\s*\(/.test(adminSource), false, '关系归档不得执行物理删除');
  assert.match(adminSource, /status:\s*'archived'/);
  assert.match(adminIndex, /saveStoryEvidenceLink/);
  assert.match(adminIndex, /archiveStoryEvidenceLink/);
  assert.match(appIndex, /getStoryEvidence/);
  assert.match(adminHtml, /id="story-link-form"/);
  assert.match(clientSource, /function openStoryEvidence/);
  assert.match(clientSource, /function renderStoryEvidenceGraph/);
  assert.match(clientSource, /data-story-view="graph"/);
  assert.match(clientSource, /data-story-view="timeline"/);
  assert.match(clientSource, /中心资源 → 关系类型 → 已审核投稿/);
  console.log('Story evidence security and integration tests passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
