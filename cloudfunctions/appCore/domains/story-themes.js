'use strict';
const { materialLinkValid, referenceFor } = require('../lib/material-evidence');

const C = Object.freeze({
  themes: 'story_themes', versions: 'story_theme_versions', resources: 'resources',
  entities: 'story_entities', relations: 'story_relations', claims: 'story_claims',
  stories: 'story_chains', links: 'story_evidence_links', submissions: 'submissions'
});
const text = (value, max = 500) => String(value == null ? '' : value).trim().slice(0, max);
const first = result => Array.isArray(result && result.data) ? result.data[0] || null : result && result.data || null;
const read = async (db, collection, key) => first(await db.collection(collection).doc(key).get());
const time = value => value instanceof Date ? value.toISOString() :
  value && typeof value.toDate === 'function' ? value.toDate().toISOString() : value || null;
const stableIds = values => Array.isArray(values) ? values.map(value => text(value, 128)).sort().join('|') : '';

async function loadPublicTheme(db, themeId) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(themeId)) return null;
  const theme = await read(db, C.themes, themeId);
  if (!theme || theme.archivedAt || Number(theme.publishedVersion) < 1 ||
    !theme.publishedVersionId) return null;
  const version = await read(db, C.versions, theme.publishedVersionId);
  if (!version || version.status !== 'published' || version.themeId !== themeId ||
    Number(version.version) !== Number(theme.publishedVersion) ||
    !Array.isArray(version.nodes) || version.nodes.length < 2 ||
    !Array.isArray(version.chapters) || version.chapters.length < 2 ||
    !Array.isArray(version.sources) || !Array.isArray(version.relations) ||
    !Array.isArray(version.claims)) return null;
  const validSources = new Map();
  for (const source of version.sources) {
    const link = await read(db, C.links, source.id);
    if (!link || link.status !== 'confirmed' || link.needsSourceReview === true ||
      link.resourceId !== source.resourceId || !link.submissionId) return null;
    const submission = await read(db, C.submissions, link.submissionId);
    if (!submission || submission.status !== 'approved' || submission.aiConsentRevokedAt ||
      submission.aiAnalysisStatus === 'consent_revoked' || submission.withdrawnAt ||
      submission.disabledAt || submission.sourceUnavailable === true ||
      !await materialLinkValid(db, link, submission, true)) return null;
    const material = referenceFor(link);
    validSources.set(source.id, {
      id: source.id, resourceId: link.resourceId, summary: text(link.evidenceSummary, 400),
      material: material ? {
        kind: text(material.kind, 40), reviewVersion: Number(material.reviewVersion) || 0,
        locator: material.locator || null
      } : null
    });
  }
  const nodeIds = new Set();
  const nodes = [];
  for (const node of version.nodes) {
    const [entity, resource] = await Promise.all([
      read(db, C.entities, node.entityId), read(db, C.resources, node.resourceId)
    ]);
    if (!entity || entity.status !== 'confirmed' || entity.needsSourceReview === true ||
      !resource || resource.status !== 'published' ||
      entity.resourceId && entity.resourceId !== node.resourceId ||
      !Array.isArray(node.sourceLinkIds) || !node.sourceLinkIds.length ||
      node.sourceLinkIds.some(sourceId => !validSources.has(sourceId) ||
        validSources.get(sourceId).resourceId !== node.resourceId)) return null;
    if (node.storyId) {
      const story = await read(db, C.stories, node.storyId);
      if (!story || story.status !== 'published' || story.needsSourceReview === true ||
        story.resourceId !== node.resourceId) return null;
    }
    nodeIds.add(node.entityId);
    const location = resource.location || {};
    const region = entity.region || resource.region || {};
    const latitude = location.latitude == null ? null : Number(location.latitude);
    const longitude = location.longitude == null ? null : Number(location.longitude);
    nodes.push({
      id: node.entityId, resourceId: node.resourceId,
      label: text(entity.name, 100), summary: text(entity.summary, 360),
      resourceTitle: text(resource.title, 120),
      group: text(node.group, 50), note: text(node.note, 300),
      order: nodes.length, sourceLinkIds: node.sourceLinkIds,
      region: {
        country: text(region.country || '中国', 40),
        province: text(region.province || resource.regionName, 40),
        city: text(region.city, 40), district: text(region.district, 40)
      },
      timeRange: {
        label: text(entity.timeRange && entity.timeRange.label, 80),
        startYear: entity.timeRange && entity.timeRange.startYear != null ?
          Number(entity.timeRange.startYear) : null,
        endYear: entity.timeRange && entity.timeRange.endYear != null ?
          Number(entity.timeRange.endYear) : null
      },
      location: Number.isFinite(latitude) && Math.abs(latitude) <= 90 &&
        Number.isFinite(longitude) && Math.abs(longitude) <= 180 ?
        { latitude, longitude, coordinateSystem: text(location.coordinateSystem || 'gcj02', 16) } : null
    });
  }
  const relations = [];
  for (const old of version.relations) {
    const relation = await read(db, C.relations, old.id);
    if (!relation || relation.status !== 'confirmed' || relation.needsSourceReview === true ||
      relation.fromEntityId !== old.fromEntityId || relation.toEntityId !== old.toEntityId ||
      relation.relationType !== old.relationType ||
      !nodeIds.has(relation.fromEntityId) || !nodeIds.has(relation.toEntityId) ||
      !Array.isArray(relation.evidenceLinkIds) || !relation.evidenceLinkIds.length ||
      stableIds(relation.evidenceLinkIds) !== stableIds(old.evidenceLinkIds) ||
      relation.evidenceLinkIds.some(sourceId => !validSources.has(sourceId))) return null;
    if (['influenced_or_transmitted_to', 'changed_over_time'].includes(relation.relationType) &&
      relation.evidenceLinkIds.every(sourceId => {
        const source = validSources.get(sourceId);
        return source && source.material &&
          ['image_observation', 'video_frames'].includes(source.material.kind);
      })) return null;
    relations.push({
      id: old.id, from: relation.fromEntityId, to: relation.toEntityId,
      type: relation.relationType, why: text(relation.why, 500),
      sourceLinkIds: relation.evidenceLinkIds
    });
  }
  const claims = new Map();
  for (const old of version.claims) {
    const claim = await read(db, C.claims, old.id);
    if (!claim || claim.status !== 'supported' || claim.needsSourceReview === true ||
      claim.claimText !== old.text ||
      stableIds(claim.sourceLinkIds) !== stableIds(old.sourceLinkIds) ||
      !Array.isArray(claim.sourceLinkIds) || !claim.sourceLinkIds.length ||
      claim.sourceLinkIds.some(sourceId => !validSources.has(sourceId))) return null;
    const story = await read(db, C.stories, claim.storyId);
    if (!story || story.status !== 'published' || story.needsSourceReview === true ||
      Number(story.version || 1) !== Number(claim.storyVersion || 1)) return null;
    claims.set(old.id, { id: old.id, text: text(claim.claimText, 360),
      sourceLinkIds: claim.sourceLinkIds });
  }
  const chapters = [];
  for (const chapter of version.chapters) {
    if (!chapter || !Array.isArray(chapter.nodeIds) || !chapter.nodeIds.length ||
      !Array.isArray(chapter.sourceLinkIds) || !chapter.sourceLinkIds.length ||
      !Array.isArray(chapter.claimIds) || !chapter.claimIds.length ||
      chapter.nodeIds.some(nodeId => !nodeIds.has(nodeId)) ||
      chapter.sourceLinkIds.some(sourceId => !validSources.has(sourceId)) ||
      chapter.claimIds.some(claimId => !claims.has(claimId) ||
        !text(chapter.body, 2500).includes(claims.get(claimId).text) ||
        claims.get(claimId).sourceLinkIds.some(sourceId => !chapter.sourceLinkIds.includes(sourceId))))
      return null;
    chapters.push({
      title: text(chapter.title, 100), body: text(chapter.body, 2500),
      nodeIds: chapter.nodeIds, sourceLinkIds: chapter.sourceLinkIds, claimIds: chapter.claimIds
    });
  }
  return {
    id: themeId, version: version.version, title: text(version.title, 100),
    introduction: text(version.introduction, 800), closing: text(version.closing, 800),
    questions: (version.questions || []).map(question => text(question, 180)),
    chapters, nodes, relations, claims: [...claims.values()], sources: [...validSources.values()],
    publishedAt: time(version.publishedAt)
  };
}

function createPublicStoryThemeService({ db }) {
  async function list() {
    let records;
    try { records = await db.collection(C.themes).limit(100).get(); }
    catch (error) {
      if (/collection.*not.*exist|DATABASE_COLLECTION_NOT_EXIST|ResourceNotFound/i.test(String(error.code || '') + String(error.message || '')))
        return { ok: true, action: 'listStoryThemes', items: [] };
      throw error;
    }
    const items = [];
    for (const theme of (records.data || []).filter(item => !item.archivedAt &&
      Number(item.publishedVersion) > 0).slice(0, 30)) {
      const item = await loadPublicTheme(db, theme._id || theme.id);
      if (!item) continue;
      items.push({ id: item.id, title: item.title, introduction: item.introduction,
        version: item.version, chapterCount: item.chapters.length,
        regions: [...new Set(item.nodes.map(node => node.region.province).filter(Boolean))],
        publishedAt: item.publishedAt });
    }
    return { ok: true, action: 'listStoryThemes', items };
  }
  async function get(event = {}) {
    const themeId = text(event.themeId, 128);
    const theme = await loadPublicTheme(db, themeId);
    if (!theme) return { ok: false, error: { code: 'THEME_NOT_AVAILABLE',
      message: '专题暂不可查看，可能正在复核来源' } };
    return { ok: true, action: 'getStoryTheme', theme };
  }
  return { list, get };
}

module.exports = { loadPublicTheme, createPublicStoryThemeService };
