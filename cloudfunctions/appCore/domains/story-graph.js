'use strict';
const {materialLinkValid,isMaterialLink,referenceFor}=require('../lib/material-evidence');
const { createAgentProvenanceValidator } = require('../lib/agent-provenance');

const ENTITY_COLLECTION = 'story_entities';
const RELATION_COLLECTION = 'story_relations';
const EVIDENCE_COLLECTION = 'story_evidence_links';

const ENTITY_TYPE_LABELS = Object.freeze({
  detail_or_motif: '纹样与细节',
  heritage_object: '文物',
  building_or_site: '建筑与遗址',
  person_or_group: '人物与群体',
  event: '历史事件',
  text_or_archive: '古籍与档案',
  craft_or_practice: '技艺与实践',
  time_period: '时代',
  place: '地点'
});

const RELATION_TYPE_LABELS = Object.freeze({
  located_at: '位于',
  documents: '记录',
  depicts: '呈现',
  uses_craft: '采用技艺',
  associated_with_person: '关联人物',
  associated_with_event: '关联事件',
  mentioned_in: '见于记载',
  changed_over_time: '时代演变',
  visually_similar_to: '外观相似',
  influenced_or_transmitted_to: '传播与影响'
});

function cleanText(value, maxLength) {
  return String(value == null ? '' : value).trim().slice(0, maxLength);
}

function timeValue(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (typeof value === 'string') return value;
  return null;
}

function isMissingCollectionError(error) {
  const details = `${error && error.code || ''} ${error && error.message || ''}`;
  return /collection.*not.*exist|DATABASE_COLLECTION_NOT_EXIST|ResourceNotFound/i.test(details);
}

function publicNode(item) {
  const entityType = cleanText(item.entityType, 40);
  return {
    id: item._id || item.id || '',
    kind: entityType,
    kindLabel: ENTITY_TYPE_LABELS[entityType] || '文化线索',
    label: cleanText(item.name, 100),
    summary: cleanText(item.summary, 360),
    aliases: [...new Set((Array.isArray(item.aliases) ? item.aliases : [])
      .map((value) => cleanText(value, 80))
      .filter(Boolean))].slice(0, 6),
    region: {
      country: cleanText(item.region && item.region.country, 40),
      province: cleanText(item.region && item.region.province, 40),
      city: cleanText(item.region && item.region.city, 40),
      district: cleanText(item.region && item.region.district, 40)
    },
    timeRange: {
      label: cleanText(item.timeRange && item.timeRange.label, 80),
      startYear: Number.isInteger(Number(item.timeRange && item.timeRange.startYear))
        ? Number(item.timeRange.startYear)
        : null,
      endYear: Number.isInteger(Number(item.timeRange && item.timeRange.endYear))
        ? Number(item.timeRange.endYear)
        : null
    },
    isPrimary: item.isPrimary === true,
    updatedAt: timeValue(item.updatedAt)
  };
}

function publicEdge(item, validNodeIds) {
  const from = cleanText(item.fromEntityId, 128);
  const to = cleanText(item.toEntityId, 128);
  const relationType = cleanText(item.relationType, 60);
  if (!validNodeIds.has(from) || !validNodeIds.has(to) || !RELATION_TYPE_LABELS[relationType]) return null;
  return {
    id: item._id || item.id || '',
    from,
    to,
    relationType,
    relationLabel: RELATION_TYPE_LABELS[relationType],
    why: cleanText(item.why, 500),
    evidenceLinkIds: [...new Set((Array.isArray(item.evidenceLinkIds) ? item.evidenceLinkIds : [])
      .map((value) => cleanText(value, 128))
      .filter(Boolean))].slice(0, 12),
    evidenceCount: Math.min(12, Array.isArray(item.evidenceLinkIds) ? item.evidenceLinkIds.length : 0)
  };
}

function buildLightweightPath(nodes, edges, maxNodes = 5) {
  if (!nodes.length) return { nodes: [], edges: [] };
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const anchor = nodes.find((node) => node.isPrimary) || nodes[0];
  const selectedIds = new Set([anchor.id]);
  const selectedEdges = [];
  const queue = [anchor.id];
  while (queue.length && selectedIds.size < maxNodes) {
    const currentId = queue.shift();
    for (const edge of edges) {
      const nextId = edge.from === currentId ? edge.to : edge.to === currentId ? edge.from : '';
      if (!nextId || selectedIds.has(nextId) || !nodeById.has(nextId)) continue;
      selectedIds.add(nextId);
      selectedEdges.push(edge);
      queue.push(nextId);
      if (selectedIds.size >= maxNodes) break;
    }
  }
  return {
    nodes: [...selectedIds].map((id) => nodeById.get(id)).filter(Boolean),
    edges: selectedEdges
  };
}

async function loadPublicStoryGraph(db, resourceId) {
  try {
    const [entityResult, relationResult, evidenceResult] = await Promise.all([
      db.collection(ENTITY_COLLECTION).where({ resourceId }).limit(80).get(),
      db.collection(RELATION_COLLECTION).where({ resourceId }).limit(120).get(),
      db.collection(EVIDENCE_COLLECTION).where({ resourceId }).limit(120).get()
    ]);
    const validProvenance = createAgentProvenanceValidator(db);
    const checkedEntities = await Promise.all((entityResult.data || []).map(async item =>
      item.status === 'confirmed' && item.needsSourceReview !== true &&
      await validProvenance(item, 'formalEntityId') ? item : null));
    const nodes = checkedEntities.filter(Boolean)
      .filter((item) => item.status === 'confirmed' && item.needsSourceReview !== true)
      .map(publicNode)
      .filter((item) => item.id && item.label);
    const validNodeIds = new Set(nodes.map((item) => item.id));
    const checkedEvidence = await Promise.all((evidenceResult.data || []).map(async (item) => {
      if (item.status !== 'confirmed' || item.needsSourceReview === true || !item.submissionId) return '';
      const result = await db.collection('submissions').doc(item.submissionId).get();
      const origin = Array.isArray(result && result.data) ? result.data[0] : result && result.data;
      if (!await materialLinkValid(db,item,origin,true)) return '';
      return origin && origin.status === 'approved' && !origin.aiConsentRevokedAt
        && origin.aiAnalysisStatus !== 'consent_revoked' ? item._id || item.id || '' : '';
    }));
    const validEvidenceIds = new Set(checkedEvidence.filter(Boolean));
    const checkedRelations = await Promise.all((relationResult.data || []).map(async item =>
      item.status === 'confirmed' && item.needsSourceReview !== true &&
      await validProvenance(item, 'formalRelationId') ? item : null));
    const edges = checkedRelations.filter(Boolean)
      .filter((item) => item.status === 'confirmed' && item.needsSourceReview !== true)
      .map((item) => publicEdge(item, validNodeIds))
      .map((item) => item ? {
        ...item,
        evidenceLinkIds: item.evidenceLinkIds.every((id) => validEvidenceIds.has(id))
          ? item.evidenceLinkIds : []
      } : null)
      .map((item) => item ? { ...item, evidenceCount: item.evidenceLinkIds.length } : null)
      .filter((item) => item && item.id && item.why && item.evidenceCount > 0);
    const connectedIds = new Set(edges.flatMap((edge) => [edge.from, edge.to]));
    const connectedNodes = nodes.filter((node) => connectedIds.has(node.id));
    const lightweight = buildLightweightPath(connectedNodes, edges, 5);
    return {
      ready: connectedNodes.length > 1 && edges.length > 0,
      schemaVersion: 2,
      nodes: connectedNodes.slice(0, 50),
      edges: edges.slice(0, 80),
      lightweight
    };
  } catch (error) {
    if (!isMissingCollectionError(error)) throw error;
    return { ready: false, schemaVersion: 2, nodes: [], edges: [], lightweight: { nodes: [], edges: [] } };
  }
}

module.exports = {
  ENTITY_COLLECTION,
  RELATION_COLLECTION,
  EVIDENCE_COLLECTION,
  ENTITY_TYPE_LABELS,
  RELATION_TYPE_LABELS,
  publicNode,
  publicEdge,
  buildLightweightPath,
  loadPublicStoryGraph
};
