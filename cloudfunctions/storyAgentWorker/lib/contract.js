'use strict';

const ENTITY_TYPES = Object.freeze([
  'detail_or_motif',
  'heritage_object',
  'building_or_site',
  'person_or_group',
  'event',
  'text_or_archive',
  'craft_or_practice',
  'time_period',
  'place'
]);

const RELATION_TYPES = Object.freeze([
  'located_at',
  'documents',
  'depicts',
  'uses_craft',
  'associated_with_person',
  'associated_with_event',
  'mentioned_in',
  'changed_over_time',
  'visually_similar_to',
  'influenced_or_transmitted_to'
]);

const GAP_TYPES = Object.freeze([
  'dating_evidence',
  'location_evidence',
  'visual_detail',
  'archival_source',
  'oral_history',
  'craft_process',
  'conflicting_record',
  'other'
]);

const HIGH_RISK_RELATIONS = new Set([
  'associated_with_person',
  'associated_with_event',
  'changed_over_time',
  'influenced_or_transmitted_to'
]);

const AGENT_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'entities', 'relations', 'missingEvidence'],
  properties: {
    summary: { type: 'string', minLength: 1, maxLength: 240 },
    entities: {
      type: 'array',
      maxItems: 12,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['temporaryId', 'name', 'entityType', 'summary', 'aliases'],
        properties: {
          temporaryId: { type: 'string', pattern: '^entity_[A-Za-z0-9_-]{1,40}$' },
          name: { type: 'string', minLength: 2, maxLength: 100 },
          entityType: { type: 'string', enum: ENTITY_TYPES },
          summary: { type: 'string', minLength: 6, maxLength: 360 },
          aliases: {
            type: 'array',
            maxItems: 6,
            items: { type: 'string', minLength: 1, maxLength: 80 }
          }
        }
      }
    },
    relations: {
      type: 'array',
      maxItems: 16,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['fromTemporaryId', 'toResourceId', 'relationType', 'reason', 'evidenceLinkIds', 'confidence'],
        properties: {
          fromTemporaryId: { type: 'string', pattern: '^entity_[A-Za-z0-9_-]{1,40}$' },
          toResourceId: { type: 'string', minLength: 1, maxLength: 128 },
          relationType: { type: 'string', enum: RELATION_TYPES },
          reason: { type: 'string', minLength: 8, maxLength: 500 },
          evidenceLinkIds: {
            type: 'array',
            maxItems: 8,
            items: { type: 'string', minLength: 1, maxLength: 128 }
          },
          confidence: { type: 'number', minimum: 0, maximum: 1 }
        }
      }
    },
    missingEvidence: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['gapType', 'request', 'reason'],
        properties: {
          gapType: { type: 'string', enum: GAP_TYPES },
          request: { type: 'string', minLength: 6, maxLength: 240 },
          reason: { type: 'string', minLength: 6, maxLength: 300 }
        }
      }
    }
  }
};

function cleanText(value, maxLength) {
  return String(value == null ? '' : value).trim().slice(0, maxLength);
}

function uniqueTexts(values, limit, maxLength) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => cleanText(value, maxLength))
    .filter(Boolean))].slice(0, limit);
}

function contractError(code, message) {
  return Object.assign(new Error(message), { code });
}

function validateAgentOutput(value, context = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw contractError('AGENT_INVALID_OUTPUT', '模型输出必须是结构化对象');
  }
  const allowedResourceIds = new Set(Array.isArray(context.allowedResourceIds) ? context.allowedResourceIds : []);
  const allowedEvidenceIds = new Set(Array.isArray(context.allowedEvidenceIds) ? context.allowedEvidenceIds : []);
  const rawEntities = Array.isArray(value.entities) ? value.entities : [];
  const rawRelations = Array.isArray(value.relations) ? value.relations : [];
  const rawGaps = Array.isArray(value.missingEvidence) ? value.missingEvidence : [];
  const summary = cleanText(value.summary, 240);
  if (!summary) throw contractError('AGENT_INVALID_SUMMARY', '模型没有返回有效摘要');
  if (rawEntities.length > 12 || rawRelations.length > 16 || rawGaps.length > 8) {
    throw contractError('AGENT_OUTPUT_TOO_LARGE', '模型返回的候选数量超过限制');
  }

  const temporaryIds = new Set();
  const entities = rawEntities.map((item) => {
    const temporaryId = cleanText(item && item.temporaryId, 48);
    const name = cleanText(item && item.name, 100);
    const entityType = cleanText(item && item.entityType, 40);
    const summary = cleanText(item && item.summary, 360);
    if (!/^entity_[A-Za-z0-9_-]{1,40}$/.test(temporaryId) || temporaryIds.has(temporaryId)) {
      throw contractError('AGENT_INVALID_ENTITY_ID', '模型返回了无效或重复的临时实体编号');
    }
    if (!ENTITY_TYPES.includes(entityType)) {
      throw contractError('AGENT_INVALID_ENTITY_TYPE', '模型返回了不支持的实体类型');
    }
    if (name.length < 2 || summary.length < 6) {
      throw contractError('AGENT_INVALID_ENTITY', '模型返回的实体信息不完整');
    }
    temporaryIds.add(temporaryId);
    return {
      temporaryId,
      name,
      entityType,
      summary,
      aliases: uniqueTexts(item && item.aliases, 6, 80)
    };
  });

  const relations = rawRelations.map((item) => {
    const fromTemporaryId = cleanText(item && item.fromTemporaryId, 48);
    const toResourceId = cleanText(item && item.toResourceId, 128);
    const relationType = cleanText(item && item.relationType, 60);
    const reason = cleanText(item && item.reason, 500);
    const confidence = Number(item && item.confidence);
    if (!temporaryIds.has(fromTemporaryId)) {
      throw contractError('AGENT_UNKNOWN_ENTITY_REFERENCE', '关系引用了不存在的临时实体');
    }
    if (!allowedResourceIds.has(toResourceId)) {
      throw contractError('AGENT_UNKNOWN_RESOURCE_REFERENCE', '关系引用了未提供给模型的资源');
    }
    if (!RELATION_TYPES.includes(relationType)) {
      throw contractError('AGENT_INVALID_RELATION_TYPE', '模型返回了不支持的关系类型');
    }
    if (reason.length < 8 || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      throw contractError('AGENT_INVALID_RELATION', '模型返回的关系说明或可信度不正确');
    }
    const evidenceLinkIds = uniqueTexts(item && item.evidenceLinkIds, 8, 128);
    if (evidenceLinkIds.some((id) => !allowedEvidenceIds.has(id))) {
      throw contractError('AGENT_UNKNOWN_EVIDENCE_REFERENCE', '关系引用了不存在或未确认的来源');
    }
    const observationIds=new Set(context.observationEvidenceIds||[]);
    if(evidenceLinkIds.length && evidenceLinkIds.every(id=>observationIds.has(id)) && !['depicts','visually_similar_to'].includes(relationType)) {
      throw contractError('AGENT_OBSERVATION_SCOPE','画面观察不能独立支持历史关系，请补充文字或口述来源');
    }
    return { fromTemporaryId, toResourceId, relationType, reason, evidenceLinkIds, confidence };
  });

  const missingEvidence = rawGaps.map((item) => {
    const gapType = cleanText(item && item.gapType, 40);
    const request = cleanText(item && item.request, 240);
    const reason = cleanText(item && item.reason, 300);
    if (!GAP_TYPES.includes(gapType) || request.length < 6 || reason.length < 6) {
      throw contractError('AGENT_INVALID_GAP', '模型返回的资料缺口不完整');
    }
    return { gapType, request, reason };
  });

  return {
    summary,
    entities,
    relations,
    missingEvidence
  };
}

function classifyRelationRisk(relation) {
  if (!relation || !RELATION_TYPES.includes(relation.relationType)) return 'blocked';
  if (!Array.isArray(relation.evidenceLinkIds) || !relation.evidenceLinkIds.length) return 'insufficient';
  if (!Number.isFinite(Number(relation.confidence)) || Number(relation.confidence) < 0.6) return 'insufficient';
  if (HIGH_RISK_RELATIONS.has(relation.relationType)) return 'high';
  return 'medium';
}

module.exports = {
  ENTITY_TYPES,
  RELATION_TYPES,
  GAP_TYPES,
  HIGH_RISK_RELATIONS,
  AGENT_OUTPUT_SCHEMA,
  validateAgentOutput,
  classifyRelationRisk
};
