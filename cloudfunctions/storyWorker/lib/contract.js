'use strict';

const RELATION_TYPES = new Set([
  'documents_feature',
  'documents_inscription',
  'documents_place',
  'documents_oral_history',
  'shows_change_over_time',
  'supports_story'
]);

const ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    entities: {
      type: 'object',
      additionalProperties: false,
      properties: {
        places: { type: 'array', items: { type: 'string' } },
        people: { type: 'array', items: { type: 'string' } },
        periods: { type: 'array', items: { type: 'string' } },
        crafts: { type: 'array', items: { type: 'string' } },
        inscriptions: { type: 'array', items: { type: 'string' } }
      },
      required: ['places', 'people', 'periods', 'crafts', 'inscriptions']
    },
    candidateLinks: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          resourceId: { type: 'string' },
          relationType: { type: 'string' },
          confidence: { type: 'number' },
          reason: { type: 'string' },
          evidence: { type: 'string' }
        },
        required: ['resourceId', 'relationType', 'confidence', 'reason', 'evidence']
      }
    },
    riskFlags: { type: 'array', items: { type: 'string' } }
  },
  required: ['summary', 'entities', 'candidateLinks', 'riskFlags']
};

function cleanText(value, maxLength) {
  return String(value == null ? '' : value).trim().slice(0, maxLength);
}

function textList(value, maxItems, maxLength) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => cleanText(item, maxLength)).filter(Boolean).slice(0, maxItems);
}

function validateAnalysis(value, allowedResourceIds) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw Object.assign(new Error('模型返回的分析结果不是对象'), { code: 'AI_INVALID_OUTPUT' });
  }
  const allowed = new Set(allowedResourceIds || []);
  const summary = cleanText(value.summary, 500);
  if (summary.length < 4) {
    throw Object.assign(new Error('模型摘要缺失'), { code: 'AI_INVALID_OUTPUT' });
  }
  const entities = value.entities || {};
  const candidates = Array.isArray(value.candidateLinks) ? value.candidateLinks : [];
  const candidateLinks = candidates.slice(0, 8).map((item) => {
    const resourceId = cleanText(item && item.resourceId, 128);
    const relationType = cleanText(item && item.relationType, 40);
    const confidence = Number(item && item.confidence);
    if (!allowed.has(resourceId)) {
      throw Object.assign(new Error('模型返回了不在候选列表中的资源 ID'), { code: 'AI_UNKNOWN_RESOURCE' });
    }
    if (!RELATION_TYPES.has(relationType)) {
      throw Object.assign(new Error('模型返回了不支持的关系类型'), { code: 'AI_INVALID_RELATION_TYPE' });
    }
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      throw Object.assign(new Error('模型置信度必须在 0 到 1 之间'), { code: 'AI_INVALID_CONFIDENCE' });
    }
    const reason = cleanText(item.reason, 500);
    const evidence = cleanText(item.evidence, 500);
    if (!reason || !evidence) {
      throw Object.assign(new Error('模型候选关系缺少理由或证据'), { code: 'AI_INVALID_OUTPUT' });
    }
    return { resourceId, relationType, confidence, reason, evidence };
  });
  return {
    summary,
    entities: {
      places: textList(entities.places, 20, 80),
      people: textList(entities.people, 20, 80),
      periods: textList(entities.periods, 20, 80),
      crafts: textList(entities.crafts, 20, 80),
      inscriptions: textList(entities.inscriptions, 20, 120)
    },
    candidateLinks,
    riskFlags: textList(value.riskFlags, 20, 120)
  };
}

module.exports = { ANALYSIS_SCHEMA, RELATION_TYPES, validateAnalysis };
