'use strict';

const assert = require('node:assert/strict');
const { validateAgentOutput, classifyRelationRisk } = require('../cloudfunctions/storyAgentWorker/lib/contract');

const context = { allowedResourceIds: ['resource-1'], allowedEvidenceIds: ['evidence-1'] };
const base = () => ({
  summary: '投稿记录了一处有待核验的凤鸟纹木雕。',
  entities: [{ temporaryId: 'entity_1', name: '凤鸟纹', entityType: 'detail_or_motif', summary: '木雕局部可见凤鸟形纹样', aliases: ['凤纹'] }],
  relations: [{ fromTemporaryId: 'entity_1', toResourceId: 'resource-1', relationType: 'documents', reason: '投稿照片直接记录了该处凤鸟纹木雕', evidenceLinkIds: ['evidence-1'], confidence: 0.82 }],
  missingEvidence: [{ gapType: 'visual_detail', request: '补充纹样正面清晰近景照片', reason: '当前照片角度不足以比较完整轮廓' }]
});
const clone = value => structuredClone(value);

const contractCases = [
  ['有效基准', value => value, 'ok'],
  ['根节点为空', () => null, 'AGENT_INVALID_OUTPUT'],
  ['摘要为空', value => { value.summary = ''; return value; }, 'AGENT_INVALID_SUMMARY'],
  ['实体过多', value => { value.entities = Array.from({ length: 13 }, (_, i) => ({ ...value.entities[0], temporaryId: `entity_${i}` })); return value; }, 'AGENT_OUTPUT_TOO_LARGE'],
  ['实体编号重复', value => { value.entities.push(clone(value.entities[0])); return value; }, 'AGENT_INVALID_ENTITY_ID'],
  ['实体编号格式错误', value => { value.entities[0].temporaryId = 'bad id'; return value; }, 'AGENT_INVALID_ENTITY_ID'],
  ['实体类型越界', value => { value.entities[0].entityType = 'imagined_type'; return value; }, 'AGENT_INVALID_ENTITY_TYPE'],
  ['实体名称过短', value => { value.entities[0].name = '纹'; return value; }, 'AGENT_INVALID_ENTITY'],
  ['实体说明过短', value => { value.entities[0].summary = '太短'; return value; }, 'AGENT_INVALID_ENTITY'],
  ['关系引用未知实体', value => { value.relations[0].fromTemporaryId = 'entity_unknown'; return value; }, 'AGENT_UNKNOWN_ENTITY_REFERENCE'],
  ['关系引用未知资源', value => { value.relations[0].toResourceId = 'invented'; return value; }, 'AGENT_UNKNOWN_RESOURCE_REFERENCE'],
  ['关系类型越界', value => { value.relations[0].relationType = 'same_origin'; return value; }, 'AGENT_INVALID_RELATION_TYPE'],
  ['关系理由过短', value => { value.relations[0].reason = '有关'; return value; }, 'AGENT_INVALID_RELATION'],
  ['可信度为负数', value => { value.relations[0].confidence = -0.1; return value; }, 'AGENT_INVALID_RELATION'],
  ['可信度超过一', value => { value.relations[0].confidence = 1.1; return value; }, 'AGENT_INVALID_RELATION'],
  ['关系引用未知证据', value => { value.relations[0].evidenceLinkIds = ['invented']; return value; }, 'AGENT_UNKNOWN_EVIDENCE_REFERENCE'],
  ['关系过多', value => { value.relations = Array.from({ length: 17 }, () => clone(value.relations[0])); return value; }, 'AGENT_OUTPUT_TOO_LARGE'],
  ['缺口过多', value => { value.missingEvidence = Array.from({ length: 9 }, () => clone(value.missingEvidence[0])); return value; }, 'AGENT_OUTPUT_TOO_LARGE'],
  ['缺口类型越界', value => { value.missingEvidence[0].gapType = 'unknown'; return value; }, 'AGENT_INVALID_GAP'],
  ['缺口请求过短', value => { value.missingEvidence[0].request = '补图'; return value; }, 'AGENT_INVALID_GAP']
];

const riskCases = [
  ['无来源', { relationType: 'documents', evidenceLinkIds: [], confidence: 0.9 }, 'insufficient'],
  ['低可信度', { relationType: 'documents', evidenceLinkIds: ['evidence-1'], confidence: 0.59 }, 'insufficient'],
  ['未知关系', { relationType: 'same_origin', evidenceLinkIds: ['evidence-1'], confidence: 0.9 }, 'blocked'],
  ['人物关联', { relationType: 'associated_with_person', evidenceLinkIds: ['evidence-1'], confidence: 0.9 }, 'high'],
  ['事件关联', { relationType: 'associated_with_event', evidenceLinkIds: ['evidence-1'], confidence: 0.9 }, 'high'],
  ['时代演变', { relationType: 'changed_over_time', evidenceLinkIds: ['evidence-1'], confidence: 0.9 }, 'high'],
  ['影响传播', { relationType: 'influenced_or_transmitted_to', evidenceLinkIds: ['evidence-1'], confidence: 0.9 }, 'high'],
  ['直接记录', { relationType: 'documents', evidenceLinkIds: ['evidence-1'], confidence: 0.9 }, 'medium'],
  ['图像描绘', { relationType: 'depicts', evidenceLinkIds: ['evidence-1'], confidence: 0.9 }, 'medium'],
  ['视觉相似', { relationType: 'visually_similar_to', evidenceLinkIds: ['evidence-1'], confidence: 0.9 }, 'medium']
];

function main() {
  assert.equal(contractCases.length + riskCases.length, 30, '固定评测集必须保持 30 条');
  for (const [name, mutate, expected] of contractCases) {
    try {
      validateAgentOutput(mutate(base()), context);
      assert.equal(expected, 'ok', `${name} 应被拒绝`);
    } catch (error) {
      assert.notEqual(expected, 'ok', `${name} 不应失败：${error.message}`);
      assert.equal(error.code, expected, `${name} 返回了错误的失败类型`);
    }
  }
  for (const [name, relation, expected] of riskCases) {
    assert.equal(classifyRelationRisk(relation), expected, `${name} 风险分级错误`);
  }
  console.log('Story agent evaluation v1 passed: 30 fixed contract and risk cases.');
}

main();
