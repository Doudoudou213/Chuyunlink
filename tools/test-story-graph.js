'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  ENTITY_TYPE_LABELS,
  RELATION_TYPE_LABELS,
  publicNode,
  publicEdge,
  buildLightweightPath,
  loadPublicStoryGraph
} = require('../cloudfunctions/appCore/domains/story-graph');
const {
  ENTITY_TYPES,
  RELATION_TYPES,
  entityIdFor,
  relationIdFor
} = require('../cloudfunctions/adminSubmissions/domains/story-graph');

const root = path.resolve(__dirname, '..');

function graphRecords() {
  return {
    story_entities: [
      { _id: 'e1', resourceId: 'r1', status: 'confirmed', entityType: 'detail_or_motif', name: '凤鸟纹', summary: '投稿中可辨认的凤鸟纹样', isPrimary: true },
      { _id: 'e2', resourceId: 'r1', status: 'confirmed', entityType: 'heritage_object', name: '漆木器', summary: '具有相近凤鸟纹样的器物' },
      { _id: 'e3', resourceId: 'r1', status: 'confirmed', entityType: 'text_or_archive', name: '楚辞记载', summary: '与崇凤观念相关的文字材料' },
      { _id: 'private', resourceId: 'r1', status: 'draft', entityType: 'person_or_group', name: '未确认人物', summary: '不能公开' }
    ],
    story_relations: [
      { _id: 'edge1', resourceId: 'r1', status: 'confirmed', fromEntityId: 'e1', toEntityId: 'e2', relationType: 'visually_similar_to', why: '两者都呈现展开双翼的凤鸟轮廓', evidenceLinkIds: ['source1'], reviewedBy: 'must-not-leak' },
      { _id: 'edge2', resourceId: 'r1', status: 'confirmed', fromEntityId: 'e2', toEntityId: 'e3', relationType: 'mentioned_in', why: '器物纹样可与同期文字中的崇凤观念对照阅读', evidenceLinkIds: ['source2'] },
      { _id: 'edge3', resourceId: 'r1', status: 'draft', fromEntityId: 'e1', toEntityId: 'private', relationType: 'associated_with_person', why: '未确认关系', evidenceLinkIds: ['source3'] }
    ],
    story_evidence_links: [
      { _id: 'source1', resourceId: 'r1', submissionId: 's1', status: 'confirmed' },
      { _id: 'source2', resourceId: 'r1', submissionId: 's2', status: 'confirmed' },
      { _id: 'source3', resourceId: 'r1', status: 'archived' }
    ],
    submissions: [
      { _id: 's1', status: 'approved' },
      { _id: 's2', status: 'approved' }
    ]
  };
}

function mockDb(records) {
  return {
    collection(name) {
      return {
        doc(id) {
          return { async get() { return { data: (records[name] || []).filter((item) => item._id === id) }; } };
        },
        where(filter) {
          let offset = 0;
          return {
            orderBy() { return this; },
            skip(value) { offset = value; return this; },
            limit() {
              return {
                async get() {
                  return { data: (records[name] || []).filter((item) =>
                    Object.entries(filter).every(([key, value]) => item[key] === value)).slice(offset) };
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
  assert.equal(ENTITY_TYPES.has('detail_or_motif'), true);
  assert.equal(ENTITY_TYPES.has('submission'), false, '原始投稿继续由 evidence link 管理，不复制为实体');
  assert.equal(RELATION_TYPES.has('visually_similar_to'), true);
  assert.equal(RELATION_TYPES.has('same_origin'), false, '禁止用未经证实的同源关系');
  assert.equal(ENTITY_TYPE_LABELS.detail_or_motif, '纹样与细节');
  assert.equal(RELATION_TYPE_LABELS.visually_similar_to, '外观相似');

  const region = { country: '中国', province: '湖北', city: '随州', district: '' };
  assert.equal(entityIdFor('detail_or_motif', '凤鸟纹', 'r1', region), entityIdFor('detail_or_motif', '凤鸟纹', 'r1', region));
  assert.notEqual(entityIdFor('detail_or_motif', '凤鸟纹', 'r1', region), entityIdFor('heritage_object', '凤鸟纹', 'r1', region));
  assert.equal(relationIdFor('r1', 'e1', 'depicts', 'e2'), relationIdFor('r1', 'e1', 'depicts', 'e2'));

  const records = graphRecords();
  const node = publicNode(records.story_entities[0]);
  const edge = publicEdge(records.story_relations[0], new Set(['e1', 'e2']));
  assert.equal(Object.hasOwn(node, 'reviewedBy'), false);
  assert.equal(Object.hasOwn(edge, 'reviewedBy'), false);
  assert.equal(edge.relationLabel, '外观相似');

  const graph = await loadPublicStoryGraph(mockDb(records), 'r1');
  assert.equal(graph.ready, true);
  assert.equal(graph.nodes.length, 3, '只公开已确认且已连接的实体');
  assert.equal(graph.edges.length, 2, '只公开已确认且有来源的关系');
  assert.deepEqual(graph.lightweight.nodes.map((item) => item.id), ['e1', 'e2', 'e3']);
  assert.equal(JSON.stringify(graph).includes('must-not-leak'), false, '公开链迹不得泄露管理员信息');
  records.submissions[0].aiConsentRevokedAt = '2026-09-07';
  const afterWithdrawal = await loadPublicStoryGraph(mockDb(records), 'r1');
  assert.equal(afterWithdrawal.edges.some((item) => item.id === 'edge1'), false, '撤回来源不能继续支撑公开图谱关系');

  const adminSource = fs.readFileSync(path.join(root, 'cloudfunctions/adminSubmissions/domains/story-graph.js'), 'utf8');
  const adminIndex = fs.readFileSync(path.join(root, 'cloudfunctions/adminSubmissions/index.js'), 'utf8');
  const appEvidence = fs.readFileSync(path.join(root, 'cloudfunctions/appCore/domains/story-evidence.js'), 'utf8');
  assert.equal(/\.remove\s*\(/.test(adminSource), false, '实体和关系只能归档，不能物理删除');
  assert.match(adminSource, /RELATION_EVIDENCE_REQUIRED/);
  assert.match(adminIndex, /saveStoryEntity/);
  assert.match(adminIndex, /archiveStoryEntity/);
  assert.match(adminIndex, /saveStoryRelation/);
  assert.match(adminIndex, /archiveStoryRelation/);
  assert.match(appEvidence, /loadPublicStoryGraph/);
  console.log('Controlled multi-hop story graph tests passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
