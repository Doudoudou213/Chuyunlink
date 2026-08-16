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

function cleanList(value, maxItems = 20, maxLength = 64) {
  const list = Array.isArray(value)
    ? value
    : String(value == null ? '' : value).split(/[,，\s]+/);
  return [...new Set(list
    .map((item) => cleanText(item, maxLength).toLowerCase())
    .filter(Boolean))]
    .slice(0, maxItems);
}

function overlapValues(left, right) {
  const rightSet = new Set(cleanList(right));
  return cleanList(left).filter((value) => rightSet.has(value));
}

function regionText(region) {
  if (!region || typeof region !== 'object') return '';
  return [region.province, region.city, region.district]
    .map((value) => cleanText(value, 40))
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function scoreResource(candidate, options = {}) {
  const base = options.base || null;
  const queryTokens = cleanList(options.query, 12, 40);
  let score = 0;
  const reasons = [];

  if (base) {
    const baseRelations = new Set(Array.isArray(base.relatedResourceIds) ? base.relatedResourceIds : []);
    const candidateRelations = new Set(Array.isArray(candidate.relatedResourceIds) ? candidate.relatedResourceIds : []);
    if (baseRelations.has(candidate._id || candidate.id) || candidateRelations.has(base._id || base.id)) {
      score += 80;
      reasons.push('已确认链迹');
    }

    const sharedCategories = overlapValues(base.categoryIds, candidate.categoryIds);
    if (sharedCategories.length) {
      score += Math.min(36, sharedCategories.length * 18);
      reasons.push('同类文化资源');
    }

    const sharedTags = overlapValues(base.tags, candidate.tags);
    if (sharedTags.length) {
      score += Math.min(30, sharedTags.length * 10);
      reasons.push(`共同标签：${sharedTags.slice(0, 2).join('、')}`);
    }

    const baseCity = cleanText(base.region && base.region.city, 40).toLowerCase();
    const candidateCity = cleanText(candidate.region && candidate.region.city, 40).toLowerCase();
    if (baseCity && candidateCity && baseCity === candidateCity) {
      score += 12;
      reasons.push(`同在${candidate.region.city}`);
    }

    if (score > 0 && base.type && candidate.type && base.type === candidate.type) {
      score += 6;
      reasons.push('相同资源类型');
    }
  }

  if (queryTokens.length) {
    const title = cleanText(candidate.title, 160).toLowerCase();
    const summary = cleanText(candidate.summary, 600).toLowerCase();
    const tags = cleanList(candidate.tags).join(' ');
    const categories = cleanList(candidate.categoryIds).join(' ');
    const region = regionText(candidate.region);
    let matchedTokens = 0;
    queryTokens.forEach((token) => {
      let tokenScore = 0;
      if (title.includes(token)) tokenScore = Math.max(tokenScore, 24);
      if (tags.includes(token)) tokenScore = Math.max(tokenScore, 18);
      if (categories.includes(token)) tokenScore = Math.max(tokenScore, 14);
      if (region.includes(token)) tokenScore = Math.max(tokenScore, 12);
      if (summary.includes(token)) tokenScore = Math.max(tokenScore, 8);
      if (tokenScore) matchedTokens += 1;
      score += tokenScore;
    });
    if (matchedTokens) reasons.unshift(`匹配 ${matchedTokens} 个检索词`);
    if (!matchedTokens) return { score: 0, reasons: [] };
  }

  return { score, reasons: [...new Set(reasons)].slice(0, 4) };
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

  async function search(event = {}) {
    const query = cleanText(event.query || event.q, 120);
    const resourceId = cleanText(event.resourceId, 128);
    const requestedType = cleanText(event.type, 24);
    const requestedCity = cleanText(event.city, 40).toLowerCase();
    const requestedTags = cleanList(event.tags, 12, 40);
    const limit = Math.max(1, Math.min(Number(event.limit) || 12, 20));

    if (resourceId && !/^[A-Za-z0-9_-]+$/.test(resourceId)) {
      const error = new Error('资源 ID 格式不正确');
      error.code = 'INVALID_RESOURCE_ID';
      throw error;
    }
    if (requestedType && !ALLOWED_RESOURCE_TYPES.has(requestedType)) {
      const error = new Error('资源类型不受支持');
      error.code = 'INVALID_RESOURCE_TYPE';
      throw error;
    }
    if (!query && !resourceId && !requestedType && !requestedCity && !requestedTags.length) {
      const error = new Error('请至少提供一个检索条件');
      error.code = 'RESOURCE_SEARCH_EMPTY';
      throw error;
    }

    try {
      const result = await db.collection(RESOURCE_COLLECTION)
        .where({ status: 'published' })
        .limit(100)
        .get();
      const resources = result.data || [];
      const base = resourceId
        ? resources.find((item) => String(item._id || item.id || '') === resourceId) || null
        : null;
      if (resourceId && !base) {
        const error = new Error('没有找到已发布资源');
        error.code = 'RESOURCE_NOT_FOUND';
        throw error;
      }

      const ranked = resources
        .filter((item) => String(item._id || item.id || '') !== resourceId)
        .filter((item) => !requestedType || item.type === requestedType)
        .filter((item) => !requestedCity || cleanText(item.region && item.region.city, 40).toLowerCase() === requestedCity)
        .filter((item) => !requestedTags.length || overlapValues(requestedTags, item.tags).length > 0)
        .map((item) => {
          const ranking = scoreResource(item, { base, query });
          const filterReasons = [];
          let filterScore = 0;
          if (requestedType) {
            filterScore += 6;
            filterReasons.push('符合资源类型');
          }
          if (requestedCity) {
            filterScore += 6;
            filterReasons.push(`位于${item.region && item.region.city || requestedCity}`);
          }
          if (requestedTags.length) {
            const matchedTags = overlapValues(requestedTags, item.tags);
            filterScore += matchedTags.length * 8;
            filterReasons.push(`标签：${matchedTags.slice(0, 2).join('、')}`);
          }
          return {
            item,
            score: ranking.score + filterScore,
            reasons: [...new Set([...ranking.reasons, ...filterReasons])].slice(0, 4)
          };
        })
        .filter((entry) => entry.score > 0)
        .sort((left, right) => right.score - left.score ||
          Number(right.item.completeness || 0) - Number(left.item.completeness || 0) ||
          String(left.item.title || '').localeCompare(String(right.item.title || ''), 'zh-CN'))
        .slice(0, limit)
        .map((entry) => ({
          ...publicResource(entry.item),
          relevanceScore: entry.score,
          relationReasons: entry.reasons
        }));
      return { ok: true, action: 'searchResources', items: ranked, deterministic: true };
    } catch (error) {
      if (isMissingCollectionError(error)) {
        return { ok: true, action: 'searchResources', items: [], collectionReady: false, deterministic: true };
      }
      throw error;
    }
  }

  return { list, detail, search };
}

module.exports = {
  ALLOWED_RESOURCE_TYPES,
  RESOURCE_COLLECTION,
  createResourceService,
  publicResource,
  scoreResource
};
