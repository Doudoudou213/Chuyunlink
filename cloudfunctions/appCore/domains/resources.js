'use strict';

const RESOURCE_COLLECTION = 'resources';
const ALLOWED_RESOURCE_TYPES = new Set([
  'landmark',
  'hotspot',
  'activity',
  'article',
  'experience',
  'route'
]);

function cleanText(value, maxLength) {
  return String(value == null ? '' : value).trim().slice(0, maxLength);
}

function firstDocument(result) {
  if (!result) return null;
  if (Array.isArray(result.data)) return result.data[0] || null;
  return result.data || null;
}

function isMissingCollectionError(error) {
  const details = `${error && error.code || ''} ${error && error.message || ''}`;
  return /collection.*not.*exist|DATABASE_COLLECTION_NOT_EXIST|ResourceNotFound/i.test(details);
}

function publicResource(item) {
  const location = item && item.location &&
    Number.isFinite(Number(item.location.longitude)) &&
    Number.isFinite(Number(item.location.latitude))
    ? {
        longitude: Number(item.location.longitude),
        latitude: Number(item.location.latitude),
        coordinateSystem: item.location.coordinateSystem || 'gcj02'
      }
    : null;

  return {
    id: item._id || item.id || '',
    modelVersion: Math.max(1, Number(item.modelVersion) || 1),
    type: ALLOWED_RESOURCE_TYPES.has(item.type) ? item.type : 'article',
    title: item.title || '',
    summary: item.summary || '',
    status: item.status || 'draft',
    region: item.region || {},
    location,
    categoryIds: Array.isArray(item.categoryIds) ? item.categoryIds.slice(0, 20) : [],
    tags: Array.isArray(item.tags) ? item.tags.slice(0, 30) : [],
    media: Array.isArray(item.media) ? item.media.slice(0, 20) : [],
    transport: item.transport || {},
    collectables: Array.isArray(item.collectables) ? item.collectables.slice(0, 20) : [],
    capabilities: item.capabilities || {},
    relatedResourceIds: Array.isArray(item.relatedResourceIds)
      ? item.relatedResourceIds.slice(0, 20)
      : [],
    legacyAliases: Array.isArray(item.legacyAliases) ? item.legacyAliases.slice(0, 20) : [],
    source: item.source || 'official',
    sourceSubmissionId: item.sourceSubmissionId || '',
    completeness: Math.max(0, Math.min(100, Number(item.completeness) || 0)),
    publishedAt: item.publishedAt || null,
    updatedAt: item.updatedAt || null
  };
}

function normalizeLimit(value) {
  return Math.max(1, Math.min(Number(value) || 50, 100));
}

function createResourceService({ db }) {
  async function list(event = {}) {
    const requestedType = cleanText(event.type, 24);
    if (requestedType && !ALLOWED_RESOURCE_TYPES.has(requestedType)) {
      const error = new Error('资源类型不受支持');
      error.code = 'INVALID_RESOURCE_TYPE';
      throw error;
    }

    try {
      const result = await db.collection(RESOURCE_COLLECTION)
        .where({ status: 'published' })
        .limit(100)
        .get();
      const items = (result.data || [])
        .filter((item) => !requestedType || item.type === requestedType)
        .slice(0, normalizeLimit(event.limit))
        .map(publicResource);
      return { ok: true, action: 'getResources', items };
    } catch (error) {
      if (isMissingCollectionError(error)) {
        return { ok: true, action: 'getResources', items: [], collectionReady: false };
      }
      throw error;
    }
  }

  async function detail(event = {}) {
    const resourceId = cleanText(event.resourceId, 128);
    if (!/^[A-Za-z0-9_-]+$/.test(resourceId)) {
      const error = new Error('资源 ID 格式不正确');
      error.code = 'INVALID_RESOURCE_ID';
      throw error;
    }

    let item = null;
    try {
      item = firstDocument(await db.collection(RESOURCE_COLLECTION).doc(resourceId).get());
    } catch (error) {
      if (!isMissingCollectionError(error)) throw error;
    }
    if (!item || item.status !== 'published') {
      const error = new Error('没有找到已发布资源');
      error.code = 'RESOURCE_NOT_FOUND';
      throw error;
    }
    return { ok: true, action: 'getResourceDetail', item: publicResource(item) };
  }

  return { list, detail };
}

module.exports = {
  ALLOWED_RESOURCE_TYPES,
  RESOURCE_COLLECTION,
  createResourceService,
  publicResource
};
