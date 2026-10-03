'use strict';
const {materialLinkValid}=require('../lib/material-evidence');

const crypto = require('crypto');

const ENTITY_COLLECTION = 'story_entities';
const RELATION_COLLECTION = 'story_relations';
const GRAPH_LOG_COLLECTION = 'story_graph_logs';
const RESOURCE_COLLECTION = 'resources';
const EVIDENCE_COLLECTION = 'story_evidence_links';

const ENTITY_TYPES = new Set([
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

const RELATION_TYPES = new Set([
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

function cleanText(value, maxLength) {
  return String(value == null ? '' : value).trim().slice(0, maxLength);
}

function cleanId(value, label, optional = false) {
  const id = cleanText(value, 128);
  if (!id && optional) return '';
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    const error = new Error(`${label || '记录'} ID 格式不正确`);
    error.code = 'INVALID_ID';
    throw error;
  }
  return id;
}

function firstDocument(result) {
  if (!result) return null;
  if (Array.isArray(result.data)) return result.data[0] || null;
  return result.data || null;
}

function timeValue(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (typeof value === 'string') return value;
  return null;
}

function uniqueTexts(values, limit, maxLength) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => cleanText(value, maxLength))
    .filter(Boolean))].slice(0, limit);
}

function normalizeRegion(value) {
  const region = value && typeof value === 'object' ? value : {};
  return {
    country: cleanText(region.country || '中国', 40),
    province: cleanText(region.province, 40),
    city: cleanText(region.city, 40),
    district: cleanText(region.district, 40)
  };
}

function normalizeTimeRange(value) {
  const range = value && typeof value === 'object' ? value : {};
  const startYear = Number(range.startYear);
  const endYear = Number(range.endYear);
  return {
    label: cleanText(range.label, 80),
    startYear: Number.isInteger(startYear) && startYear >= -5000 && startYear <= 3000 ? startYear : null,
    endYear: Number.isInteger(endYear) && endYear >= -5000 && endYear <= 3000 ? endYear : null
  };
}

function entityIdFor(entityType, name, resourceId, region) {
  const digest = crypto.createHash('sha256')
    .update([entityType, name.toLowerCase(), resourceId, region.province, region.city, region.district].join('|'), 'utf8')
    .digest('hex')
    .slice(0, 32);
  return `entity_${digest}`;
}

function relationIdFor(resourceId, fromEntityId, relationType, toEntityId) {
  const digest = crypto.createHash('sha256')
    .update(`${resourceId}|${fromEntityId}|${relationType}|${toEntityId}`, 'utf8')
    .digest('hex')
    .slice(0, 32);
  return `relation_${digest}`;
}

function serializeEntity(item) {
  return {
    id: item._id || item.id || '',
    entityType: item.entityType || '',
    name: item.name || '',
    aliases: Array.isArray(item.aliases) ? item.aliases : [],
    summary: item.summary || '',
    resourceId: item.resourceId || '',
    resourceTitle: item.resourceTitle || '',
    region: item.region || {},
    timeRange: item.timeRange || {},
    isPrimary: item.isPrimary === true,
    status: item.status || 'confirmed',
    version: Math.max(1, Number(item.version) || 1),
    updatedAt: timeValue(item.updatedAt)
  };
}

function serializeRelation(item) {
  return {
    id: item._id || item.id || '',
    resourceId: item.resourceId || '',
    fromEntityId: item.fromEntityId || '',
    toEntityId: item.toEntityId || '',
    relationType: item.relationType || '',
    why: item.why || '',
    evidenceLinkIds: Array.isArray(item.evidenceLinkIds) ? item.evidenceLinkIds : [],
    confidenceNote: item.confidenceNote || '',
    status: item.status || 'confirmed',
    version: Math.max(1, Number(item.version) || 1),
    updatedAt: timeValue(item.updatedAt)
  };
}

function createAdminStoryGraphService({ db }) {
  async function workspace() {
    const [entityResult, relationResult, resourceResult, evidenceResult] = await Promise.all([
      db.collection(ENTITY_COLLECTION).limit(200).get(),
      db.collection(RELATION_COLLECTION).limit(200).get(),
      db.collection(RESOURCE_COLLECTION).where({ status: 'published' }).limit(100).get(),
      db.collection(EVIDENCE_COLLECTION).limit(200).get()
    ]);
    return {
      ok: true,
      action: 'getStoryGraphWorkspace',
      entityTypes: [...ENTITY_TYPES],
      relationTypes: [...RELATION_TYPES],
      entities: (entityResult.data || []).map(serializeEntity),
      relations: (relationResult.data || []).map(serializeRelation),
      resources: (resourceResult.data || []).map((item) => ({
        id: item._id || item.id || '',
        title: cleanText(item.title, 120),
        type: cleanText(item.type, 40)
      })),
      evidenceLinks: (evidenceResult.data || [])
        .filter((item) => item.status === 'confirmed')
        .map((item) => ({
          id: item._id || item.id || '',
          resourceId: item.resourceId || '',
          submissionTitle: cleanText(item.submissionTitle, 120),
          evidenceSummary: cleanText(item.evidenceSummary, 300)
        }))
    };
  }

  async function saveEntity(event, reviewerId) {
    const entityType = cleanText(event.entityType, 40);
    const name = cleanText(event.name, 100);
    const aliases = uniqueTexts(event.aliases, 10, 80);
    const summary = cleanText(event.summary, 600);
    const resourceId = cleanId(event.resourceId, '资源', true);
    const region = normalizeRegion(event.region);
    const timeRange = normalizeTimeRange(event.timeRange);
    if (!ENTITY_TYPES.has(entityType)) {
      const error = new Error('实体类型不受支持');
      error.code = 'INVALID_ENTITY_TYPE';
      throw error;
    }
    if (name.length < 2) {
      const error = new Error('实体名称至少需要 2 个字');
      error.code = 'ENTITY_NAME_REQUIRED';
      throw error;
    }
    if (summary.length < 6) {
      const error = new Error('请用至少 6 个字说明这个实体');
      error.code = 'ENTITY_SUMMARY_REQUIRED';
      throw error;
    }
    if (timeRange.startYear != null && timeRange.endYear != null && timeRange.startYear > timeRange.endYear) {
      const error = new Error('时间范围的开始年份不能晚于结束年份');
      error.code = 'INVALID_TIME_RANGE';
      throw error;
    }
    const entityId = event.entityId
      ? cleanId(event.entityId, '实体')
      : entityIdFor(entityType, name, resourceId, region);
    return db.runTransaction(async (transaction) => {
      let resource = null;
      if (resourceId) {
        resource = firstDocument(await transaction.collection(RESOURCE_COLLECTION).doc(resourceId).get());
        if (!resource || resource.status !== 'published') {
          const error = new Error('关联的文化资源不存在或尚未发布');
          error.code = 'PUBLISHED_RESOURCE_REQUIRED';
          throw error;
        }
      }
      const ref = transaction.collection(ENTITY_COLLECTION).doc(entityId);
      const current = firstDocument(await ref.get());
      if (current && current.status === 'archived') {
        const error = new Error('已归档实体不能直接覆盖，请创建新实体');
        error.code = 'ENTITY_ARCHIVED';
        throw error;
      }
      const now = db.serverDate();
      const record = {
        entityType,
        name,
        aliases,
        summary,
        resourceId,
        resourceTitle: resource ? cleanText(resource.title, 120) : '',
        region,
        timeRange,
        isPrimary: event.isPrimary === true,
        status: 'confirmed',
        proposedBy: 'admin',
        reviewedBy: reviewerId,
        reviewedAt: now,
        updatedAt: now,
        version: Math.max(0, Number(current && current.version) || 0) + 1
      };
      if (current) await ref.update(record);
      else await ref.set({ ...record, createdAt: now, createdBy: reviewerId });
      await transaction.collection(GRAPH_LOG_COLLECTION).add({
        action: current ? 'update_entity' : 'create_entity',
        entityId,
        reviewerId,
        createdAt: now
      });
      return { ok: true, action: 'saveStoryEntity', entity: { id: entityId, ...record } };
    });
  }

  async function saveRelation(event, reviewerId) {
    const resourceId = cleanId(event.resourceId, '资源');
    const fromEntityId = cleanId(event.fromEntityId, '起点实体');
    const toEntityId = cleanId(event.toEntityId, '终点实体');
    const relationType = cleanText(event.relationType, 60);
    const why = cleanText(event.why, 500);
    const confidenceNote = cleanText(event.confidenceNote, 300);
    const evidenceLinkIds = uniqueTexts(event.evidenceLinkIds, 12, 128).map((id) => cleanId(id, '来源关系'));
    if (fromEntityId === toEntityId) {
      const error = new Error('链迹关系的起点和终点不能相同');
      error.code = 'SELF_RELATION_NOT_ALLOWED';
      throw error;
    }
    if (!RELATION_TYPES.has(relationType)) {
      const error = new Error('链迹关系类型不受支持');
      error.code = 'INVALID_GRAPH_RELATION_TYPE';
      throw error;
    }
    if (why.length < 8) {
      const error = new Error('请用至少 8 个字说明为什么有关');
      error.code = 'RELATION_WHY_REQUIRED';
      throw error;
    }
    if (!evidenceLinkIds.length) {
      const error = new Error('正式链迹关系至少需要一份已确认来源');
      error.code = 'RELATION_EVIDENCE_REQUIRED';
      throw error;
    }
    const relationId = relationIdFor(resourceId, fromEntityId, relationType, toEntityId);
    return db.runTransaction(async (transaction) => {
      const [resource, fromEntity, toEntity] = await Promise.all([
        transaction.collection(RESOURCE_COLLECTION).doc(resourceId).get().then(firstDocument),
        transaction.collection(ENTITY_COLLECTION).doc(fromEntityId).get().then(firstDocument),
        transaction.collection(ENTITY_COLLECTION).doc(toEntityId).get().then(firstDocument)
      ]);
      if (!resource || resource.status !== 'published') {
        const error = new Error('文化资源不存在或尚未发布');
        error.code = 'PUBLISHED_RESOURCE_REQUIRED';
        throw error;
      }
      if (!fromEntity || fromEntity.status !== 'confirmed' || fromEntity.needsSourceReview === true
        || !toEntity || toEntity.status !== 'confirmed' || toEntity.needsSourceReview === true) {
        const error = new Error('关系两端必须是已确认实体');
        error.code = 'CONFIRMED_ENTITIES_REQUIRED';
        throw error;
      }
      const evidenceRecords = await Promise.all(evidenceLinkIds.map((id) =>
        transaction.collection(EVIDENCE_COLLECTION).doc(id).get().then(firstDocument)
      ));
      if (evidenceRecords.some((item) => !item || item.status !== 'confirmed'
        || item.needsSourceReview === true || item.resourceId !== resourceId)) {
        const error = new Error('来源必须是该资源下已确认、仍有效的投稿关系');
        error.code = 'CONFIRMED_RELATION_EVIDENCE_REQUIRED';
        throw error;
      }
      for (const evidence of evidenceRecords) {
        const origin = evidence.submissionId
          ? firstDocument(await transaction.collection('submissions').doc(evidence.submissionId).get()) : null;
        if (!origin || origin.status !== 'approved' || origin.aiConsentRevokedAt
          || origin.aiAnalysisStatus === 'consent_revoked' || !await materialLinkValid(transaction,evidence,origin,true)) {
          const error = new Error('来源投稿已不可用');
          error.code = 'GRAPH_SOURCE_UNAVAILABLE';
          throw error;
        }
      }
      if(evidenceRecords.length && evidenceRecords.every(e=>['image_observation','video_frames'].includes(e.materialKind)) && !['depicts','visually_similar_to'].includes(relationType)) throw Object.assign(new Error('画面观察不足以确认历史关系'),{code:'OBSERVATION_SCOPE'});
      const ref = transaction.collection(RELATION_COLLECTION).doc(relationId);
      const current = firstDocument(await ref.get());
      const now = db.serverDate();
      const record = {
        resourceId,
        resourceTitle: cleanText(resource.title, 120),
        fromEntityId,
        fromEntityName: cleanText(fromEntity.name, 100),
        toEntityId,
        toEntityName: cleanText(toEntity.name, 100),
        relationType,
        why,
        evidenceLinkIds,
        confidenceNote,
        status: 'confirmed',
        proposedBy: 'admin',
        reviewedBy: reviewerId,
        reviewedAt: now,
        updatedAt: now,
        archivedAt: null,
        archivedBy: '',
        archiveReason: '',
        version: Math.max(0, Number(current && current.version) || 0) + 1
      };
      if (current) await ref.update(record);
      else await ref.set({ ...record, createdAt: now, createdBy: reviewerId });
      await transaction.collection(GRAPH_LOG_COLLECTION).add({
        action: current ? 'reconfirm_relation' : 'confirm_relation',
        relationId,
        resourceId,
        fromEntityId,
        toEntityId,
        relationType,
        evidenceLinkIds,
        reviewerId,
        createdAt: now
      });
      return { ok: true, action: 'saveStoryRelation', relation: { id: relationId, ...record } };
    });
  }

  async function archiveRelation(event, reviewerId) {
    const relationId = cleanId(event.relationId, '链迹关系');
    const archiveReason = cleanText(event.archiveReason, 300);
    if (archiveReason.length < 4) {
      const error = new Error('请填写归档原因，便于以后追溯');
      error.code = 'ARCHIVE_REASON_REQUIRED';
      throw error;
    }
    return db.runTransaction(async (transaction) => {
      const ref = transaction.collection(RELATION_COLLECTION).doc(relationId);
      const current = firstDocument(await ref.get());
      if (!current) {
        const error = new Error('没有找到这条多跳链迹关系');
        error.code = 'STORY_RELATION_NOT_FOUND';
        throw error;
      }
      const now = db.serverDate();
      await ref.update({
        status: 'archived',
        archivedAt: now,
        archivedBy: reviewerId,
        archiveReason,
        updatedAt: now,
        version: Math.max(1, Number(current.version) || 1) + 1
      });
      await transaction.collection(GRAPH_LOG_COLLECTION).add({
        action: 'archive_relation',
        relationId,
        resourceId: current.resourceId || '',
        archiveReason,
        reviewerId,
        createdAt: now
      });
      return { ok: true, action: 'archiveStoryRelation', relationId, status: 'archived' };
    });
  }

  async function archiveEntity(event, reviewerId) {
    const entityId = cleanId(event.entityId, '实体');
    const archiveReason = cleanText(event.archiveReason, 300);
    if (archiveReason.length < 4) {
      const error = new Error('请填写归档原因，便于以后追溯');
      error.code = 'ARCHIVE_REASON_REQUIRED';
      throw error;
    }
    const [outgoing, incoming] = await Promise.all([
      db.collection(RELATION_COLLECTION).where({ fromEntityId: entityId }).limit(50).get(),
      db.collection(RELATION_COLLECTION).where({ toEntityId: entityId }).limit(50).get()
    ]);
    const activeRelations = [...(outgoing.data || []), ...(incoming.data || [])]
      .filter((item) => item.status === 'confirmed');
    if (activeRelations.length) {
      const error = new Error('请先归档与该实体相连的正式关系');
      error.code = 'ACTIVE_RELATIONS_EXIST';
      throw error;
    }
    return db.runTransaction(async (transaction) => {
      const ref = transaction.collection(ENTITY_COLLECTION).doc(entityId);
      const current = firstDocument(await ref.get());
      if (!current) {
        const error = new Error('没有找到这个链迹实体');
        error.code = 'STORY_ENTITY_NOT_FOUND';
        throw error;
      }
      const now = db.serverDate();
      await ref.update({
        status: 'archived',
        archivedAt: now,
        archivedBy: reviewerId,
        archiveReason,
        updatedAt: now,
        version: Math.max(1, Number(current.version) || 1) + 1
      });
      await transaction.collection(GRAPH_LOG_COLLECTION).add({
        action: 'archive_entity',
        entityId,
        resourceId: current.resourceId || '',
        archiveReason,
        reviewerId,
        createdAt: now
      });
      return { ok: true, action: 'archiveStoryEntity', entityId, status: 'archived' };
    });
  }

  return { workspace, saveEntity, saveRelation, archiveRelation, archiveEntity };
}

module.exports = {
  ENTITY_COLLECTION,
  RELATION_COLLECTION,
  GRAPH_LOG_COLLECTION,
  ENTITY_TYPES,
  RELATION_TYPES,
  entityIdFor,
  relationIdFor,
  createAdminStoryGraphService
};
