'use strict';

const assert = require('assert');
const {
  claimIdFor,
  normalizeClaimInput
} = require('../cloudfunctions/adminSubmissions/domains/story-claims');
const {
  buildPublicTrail,
  createStoryEvidenceService
} = require('../cloudfunctions/appCore/domains/story-evidence');

function createReadDb(fixtures) {
  return {
    collection(name) {
      const rows = fixtures[name] || [];
      return {
        doc(id) {
          return { async get() { return { data: rows.find((item) => (item._id || item.id) === id) || null }; } };
        },
        where(query) {
          const matched = rows.filter((item) => Object.entries(query).every(([key, value]) => item[key] === value));
          return { limit() { return { async get() { return { data: matched }; } }; } };
        }
      };
    }
  };
}

async function main() {
  const normalized = normalizeClaimInput({
    storyId: 'story-one',
    chapterIndex: 0,
    claimText: '  这是一条有材料支撑的事实。  ',
    sourceLinkIds: ['link-one', 'link-one'],
    status: 'supported'
  });
  assert.deepStrictEqual(normalized.sourceLinkIds, ['link-one']);
  assert.strictEqual(normalized.claimText, '这是一条有材料支撑的事实。');
  assert.strictEqual(
    claimIdFor('story-one', 2, 0, normalized.claimText),
    claimIdFor('story-one', 2, 0, normalized.claimText),
    '同一故事版本和事实原句应得到稳定 ID'
  );
  assert.throws(() => normalizeClaimInput({
    storyId: 'story-one', chapterIndex: 0, claimText: '事实句子', status: 'supported', sourceLinkIds: []
  }), /至少需要一份来源/);

  const fixtures = {
    resources: [{ _id: 'yellow-crane-tower', title: '黄鹤楼', summary: '江城文化地标', status: 'published' }],
    story_evidence_links: [{
      _id: 'link-one', resourceId: 'yellow-crane-tower', submissionId: 'submission-one',
      status: 'confirmed', relationType: 'documents_inscription', evidenceSummary: '照片记录了楼内题刻。'
    }],
    submissions: [{
      _id: 'submission-one', status: 'approved', title: '黄鹤楼题刻近景', description: '现场拍摄',
      contributorName: '江城记录者', regionName: '武汉', assetType: 'image', fileID: 'cloud://image-one'
    }],
    story_chains: [{
      _id: 'story-one', resourceId: 'yellow-crane-tower', status: 'published', version: 2,
      title: '楼阁与题刻', introduction: '从现场记录认识黄鹤楼。', publishedAt: '2026-08-24T00:00:00.000Z',
      chapters: [{ title: '题刻记录', body: '楼内现存多处题刻。它们记录了不同时期的游览记忆。', sourceLinkIds: ['link-one'] }]
    }],
    story_claims: [
      { _id: 'claim-valid', storyId: 'story-one', storyVersion: 2, resourceId: 'yellow-crane-tower', chapterIndex: 0, claimText: '楼内现存多处题刻。', sourceLinkIds: ['link-one'], status: 'supported' },
      { _id: 'claim-draft', storyId: 'story-one', storyVersion: 2, resourceId: 'yellow-crane-tower', chapterIndex: 0, claimText: '它们记录了不同时期的游览记忆。', sourceLinkIds: ['link-one'], status: 'needs_evidence' },
      { _id: 'claim-wrong-text', storyId: 'story-one', storyVersion: 2, resourceId: 'yellow-crane-tower', chapterIndex: 0, claimText: '正文中不存在的断言。', sourceLinkIds: ['link-one'], status: 'supported' }
    ]
  };
  const service = createStoryEvidenceService({
    db: createReadDb(fixtures),
    app: { async getTempFileURL() { return { fileList: [{ fileID: 'cloud://image-one', tempFileURL: 'https://example.test/image.jpg' }] }; } }
  });
  const result = await service.list({ resourceId: 'yellow-crane-tower' });
  assert.strictEqual(result.claims.length, 1, '公开端只返回当前故事中有依据且可定位的事实');
  assert.strictEqual(result.claims[0].id, 'claim-valid');
  assert.strictEqual(result.trail.nodes.length, 2, '轻量链迹应包含资源起点和来源节点');
  assert.ok(!JSON.stringify(result).includes('reviewedBy'), '公开结果不得泄露管理员身份');

  const trail = buildPublicTrail({ id: 'r', title: '资源' }, Array.from({ length: 8 }, (_, index) => ({
    id: `l${index}`, evidenceSummary: `依据${index}`, submission: { title: `材料${index}` }
  })));
  assert.strictEqual(trail.nodes.length, 5, '首屏轻量链迹最多展示五个节点');
  assert.strictEqual(trail.totalEvidenceCount, 8);
  console.log('story claims: ok');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
