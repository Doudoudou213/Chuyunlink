'use strict';

const crypto = require('crypto');
const { materialLinkValid, referenceFor } = require('../lib/material-evidence');

const C = Object.freeze({
  themes: 'story_themes', versions: 'story_theme_versions', logs: 'story_theme_logs',
  resources: 'resources', entities: 'story_entities', relations: 'story_relations',
  claims: 'story_claims', stories: 'story_chains', links: 'story_evidence_links',
  submissions: 'submissions'
});
const text = (value, max = 500) => String(value == null ? '' : value).trim().slice(0, max);
const first = result => Array.isArray(result && result.data) ? result.data[0] || null : result && result.data || null;
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const id = (value, label = '记录') => {
  const result = text(value, 128);
  if (!/^[A-Za-z0-9_-]+$/.test(result)) fail('INVALID_ID', label + '编号无效');
  return result;
};
const ids = (values, limit = 40) => {
  if (!Array.isArray(values) || values.length > limit) fail('INVALID_THEME_ITEMS', '专题内容数量超出限制');
  return [...new Set(values.map(value => id(value)))];
};
const read = async (db, collection, key) => first(await db.collection(collection).doc(key).get());
const recordId = item => item && (item._id || item.id) || '';
const time = value => value instanceof Date ? value.toISOString() : value && typeof value.toDate === 'function' ? value.toDate().toISOString() : value || null;
const year = value => Number.isInteger(Number(value)) && String(value == null ? '' : value).trim() !== '' ? Number(value) : null;
const chapterIdFor = (themeId, chapter, index) => chapter && chapter.id ||
  'chapter_' + crypto.createHash('sha256').update(`${themeId}:${index}`).digest('hex').slice(0, 24);

function normalize(input) {
  const title = text(input.title, 100);
  const introduction = text(input.introduction, 800);
  if (title.length < 3 || introduction.length < 12) fail('INVALID_THEME_TEXT', '请填写专题名称和至少 12 字导语');
  const rawNodes = Array.isArray(input.nodes) ? input.nodes : [];
  if (rawNodes.length > 20) fail('INVALID_THEME_ITEMS', '专题最多包含 20 个节点');
  const nodes = rawNodes.map((node, index) => ({
    entityId: id(node.entityId, '实体'),
    resourceId: id(node.resourceId, '资源'),
    storyId: node.storyId ? id(node.storyId, '故事') : '',
    sourceLinkIds: ids(node.sourceLinkIds || [], 12),
    group: text(node.group, 50),
    note: text(node.note, 300),
    order: index
  }));
  if (new Set(nodes.map(node => node.entityId + ':' + node.resourceId)).size !== nodes.length)
    fail('DUPLICATE_THEME_NODE', '同一个实体与资源不能重复加入专题');
  const nodeIds = new Set(nodes.map(node => node.entityId));
  const rawRelations = Array.isArray(input.relationIds) ? input.relationIds : [];
  const relationIds = ids(rawRelations, 30);
  const rawChapters = Array.isArray(input.chapters) ? input.chapters : [];
  if (rawChapters.length > 12) fail('INVALID_THEME_ITEMS', '专题最多包含 12 个章节');
  const chapters = rawChapters.map((chapter, index) => ({
    id: chapter.id ? id(chapter.id, '章节') : '',
    title: text(chapter.title, 100),
    body: text(chapter.body, 2500),
    nodeIds: ids(chapter.nodeIds || [], 20),
    sourceLinkIds: ids(chapter.sourceLinkIds || [], 24),
    claimIds: ids(chapter.claimIds || [], 24),
    order: index
  }));
  if (chapters.some(chapter => chapter.nodeIds.some(entityId => !nodeIds.has(entityId))))
    fail('THEME_CHAPTER_NODE', '章节引用了未加入专题的实体');
  const chapterIds = chapters.map(chapter => chapter.id).filter(Boolean);
  if (new Set(chapterIds).size !== chapterIds.length)
    fail('DUPLICATE_THEME_CHAPTER', '章节编号不能重复');
  return {
    title, introduction, closing: text(input.closing, 800),
    questions: (Array.isArray(input.questions) ? input.questions : []).slice(0, 8).map(value => text(value, 180)).filter(Boolean),
    nodes, relationIds, chapters
  };
}

async function validLink(db, linkId, allowedResourceId, aiUse = false) {
  const link = await read(db, C.links, linkId);
  if (!link || link.status !== 'confirmed' || link.needsSourceReview === true ||
    allowedResourceId && link.resourceId !== allowedResourceId || !link.submissionId)
    fail('THEME_SOURCE_UNAVAILABLE', '专题引用的来源已失效或不属于所选资源');
  const submission = await read(db, C.submissions, link.submissionId);
  if (!submission || submission.status !== 'approved' || submission.aiConsentRevokedAt ||
    submission.aiAnalysisStatus === 'consent_revoked' || submission.withdrawnAt ||
    submission.disabledAt || submission.sourceUnavailable === true ||
    !await materialLinkValid(db, link, submission, true))
    fail('THEME_SOURCE_UNAVAILABLE', '专题引用的投稿已失效或撤回授权');
  if (aiUse && (submission.aiAnalysisConsent !== true ||
    submission.aiConsentVersion !== 'ai-analysis-consent-v1' ||
    submission.aiConsentScope !== 'approved_public_submission_text'))
    fail('THEME_AI_CONSENT_REQUIRED', '专题 AI 只能读取仍有明确授权的来源');
  return {
    id: linkId, resourceId: link.resourceId, submissionId: link.submissionId,
    summary: text(link.evidenceSummary, 400), materialReference: referenceFor(link)
  };
}

async function validateTheme(db, theme, publish = false, aiUse = false) {
  if (publish && (theme.nodes.length < 2 || theme.chapters.length < 2))
    fail('THEME_CONTENT_INCOMPLETE', '发布专题至少需要两个节点和两个章节');
  const resources = new Map();
  const entities = new Map();
  const links = new Map();
  for (const node of theme.nodes) {
    const [resource, entity] = await Promise.all([
      read(db, C.resources, node.resourceId), read(db, C.entities, node.entityId)
    ]);
    if (!resource || resource.status !== 'published' || !entity ||
      entity.status !== 'confirmed' || entity.needsSourceReview === true ||
      entity.resourceId && entity.resourceId !== node.resourceId)
      fail('THEME_NODE_UNAVAILABLE', '专题节点必须是已确认实体和已发布资源');
    if (!node.sourceLinkIds.length) fail('THEME_NODE_SOURCE', '每个节点至少需要一份当前可用来源');
    resources.set(node.resourceId, resource);
    entities.set(node.entityId, entity);
    for (const linkId of node.sourceLinkIds) links.set(linkId, await validLink(db, linkId, node.resourceId, aiUse));
    if (node.storyId) {
      const story = await read(db, C.stories, node.storyId);
      if (!story || story.status !== 'published' || story.needsSourceReview === true ||
        story.resourceId !== node.resourceId)
        fail('THEME_STORY_UNAVAILABLE', '节点故事已失效');
      const storyLinks = ids(story.sourceLinkIds || [], 50);
      for (const linkId of storyLinks) await validLink(db, linkId, node.resourceId, aiUse);
    }
  }
  const relations = [];
  for (const relationId of theme.relationIds) {
    const relation = await read(db, C.relations, relationId);
    if (!relation || relation.status !== 'confirmed' || relation.needsSourceReview === true ||
      !entities.has(relation.fromEntityId) || !entities.has(relation.toEntityId) ||
      !Array.isArray(relation.evidenceLinkIds) || !relation.evidenceLinkIds.length)
      fail('THEME_RELATION_UNAVAILABLE', '专题关系必须来自已确认的正式链迹');
    for (const linkId of relation.evidenceLinkIds)
      links.set(linkId, await validLink(db, linkId, relation.resourceId, aiUse));
    if (['influenced_or_transmitted_to', 'changed_over_time'].includes(relation.relationType) &&
      relation.evidenceLinkIds.every(linkId => {
        const source = links.get(linkId);
        return source && source.materialReference &&
          ['image_observation', 'video_frames'].includes(source.materialReference.kind);
      })) fail('THEME_VISUAL_RELATION', '单靠画面观察不能建立历史传播或演变关系');
    relations.push(relation);
  }
  const claims = new Map();
  if (publish) {
    for (const chapter of theme.chapters) {
      if (chapter.title.length < 2 || chapter.body.length < 20 || !chapter.nodeIds.length ||
        !chapter.sourceLinkIds.length || !chapter.claimIds.length)
        fail('THEME_CHAPTER_INCOMPLETE', '每章需要正文、节点、来源和已确认事实');
      const nodeResources = new Set(theme.nodes.filter(node => chapter.nodeIds.includes(node.entityId)).map(node => node.resourceId));
      for (const linkId of chapter.sourceLinkIds) {
        const link = links.get(linkId) || await validLink(db, linkId);
        if (!nodeResources.has(link.resourceId)) fail('THEME_CHAPTER_SOURCE', '章节来源必须属于本章资源');
        links.set(linkId, link);
      }
      for (const claimId of chapter.claimIds) {
        const claim = await read(db, C.claims, claimId);
        if (!claim || claim.status !== 'supported' || claim.needsSourceReview === true ||
          !nodeResources.has(claim.resourceId) ||
          !text(chapter.body, 2500).includes(text(claim.claimText, 360)) ||
          !Array.isArray(claim.sourceLinkIds) || !claim.sourceLinkIds.length ||
          claim.sourceLinkIds.some(linkId => !chapter.sourceLinkIds.includes(linkId)))
          fail('THEME_CLAIM_UNAVAILABLE', '章节重要事实必须原文出现，并引用本章有效来源');
        const story = await read(db, C.stories, claim.storyId);
        if (!story || story.status !== 'published' || story.needsSourceReview === true ||
          Number(story.version || 1) !== Number(claim.storyVersion || 1))
          fail('THEME_CLAIM_UNAVAILABLE', '章节引用的事实已不属于当前发布故事');
        claims.set(claimId, claim);
      }
    }
  }
  return { resources, entities, links, relations, claims };
}

function snapshot(theme, checked) {
  const nodes = theme.nodes.map(node => {
    const entity = checked.entities.get(node.entityId);
    const resource = checked.resources.get(node.resourceId);
      const region = entity.region || {};
      const resourceRegion = resource.region || {};
      const location = resource.location || {};
    return {
      ...node, label: text(entity.name, 100), summary: text(entity.summary, 360),
      resourceTitle: text(resource.title, 120), region: {
        country: text(region.country || resourceRegion.country || '中国', 40),
        province: text(region.province || resourceRegion.province || resource.regionName, 40),
        city: text(region.city || resourceRegion.city, 40),
        district: text(region.district || resourceRegion.district, 40)
      },
      timeRange: {
        label: text(entity.timeRange && entity.timeRange.label, 80),
        startYear: year(entity.timeRange && entity.timeRange.startYear),
        endYear: year(entity.timeRange && entity.timeRange.endYear)
      },
      location: {
        latitude: location.latitude != null && Number.isFinite(Number(location.latitude)) ? Number(location.latitude) : null,
        longitude: location.longitude != null && Number.isFinite(Number(location.longitude)) ? Number(location.longitude) : null
      }
    };
  });
  return {
    title: theme.title, introduction: theme.introduction, closing: theme.closing,
    questions: theme.questions, nodes, chapters: theme.chapters,
    relations: checked.relations.map(relation => ({
      id: recordId(relation), fromEntityId: relation.fromEntityId,
      toEntityId: relation.toEntityId, relationType: relation.relationType,
      why: text(relation.why, 500), evidenceLinkIds: relation.evidenceLinkIds
    })),
    sources: [...checked.links.values()],
    claims: [...checked.claims].map(([claimId, claim]) => ({
      id: claimId, text: text(claim.claimText, 360), sourceLinkIds: claim.sourceLinkIds
    }))
  };
}

function createStoryThemeService({ db }) {
  async function workspace(event = {}) {
    const themeResult = await db.collection(C.themes).limit(100).get();
    const themes = (themeResult.data || []).filter(item => !item.archivedAt)
      .map(item => ({ id: recordId(item), title: item.title, status: item.status,
        revision: item.revision || 1, publishedVersion: item.publishedVersion || 0,
        nodes: item.nodes || [], relationIds: item.relationIds || [],
        chapters: (item.chapters || []).map((chapter, index) => ({
          ...chapter, id: chapterIdFor(recordId(item), chapter, index) })),
        introduction: item.introduction || '', closing: item.closing || '', questions: item.questions || [],
        proposal: item.proposal || null, updatedAt: time(item.updatedAt) }));
    const query = text(event.query, 80).toLowerCase();
    const [resourceResult, entityResult, relationResult, storyResult, claimResult, linkResult] = await Promise.all([
      db.collection(C.resources).where({ status: 'published' }).limit(200).get(),
      db.collection(C.entities).where({ status: 'confirmed' }).limit(200).get(),
      db.collection(C.relations).where({ status: 'confirmed' }).limit(200).get(),
      db.collection(C.stories).where({ status: 'published' }).limit(100).get(),
      db.collection(C.claims).where({ status: 'supported' }).limit(200).get(),
      db.collection(C.links).where({ status: 'confirmed' }).limit(200).get()
    ]);
    const resources = (resourceResult.data || []).filter(item => !item.needsSourceReview).map(item => ({
      id: recordId(item), title: text(item.title, 120), regionName: text(item.regionName || item.province, 60),
      type: text(item.type, 50)
    })).filter(item => !query || [item.title, item.regionName, item.type].some(value => value.toLowerCase().includes(query)));
    const resourceIds = new Set(resources.map(item => item.id));
    const entities = (entityResult.data || []).filter(item => !item.needsSourceReview &&
      resourceIds.has(item.resourceId)).map(item => ({
      id: recordId(item), name: text(item.name, 100), aliases: item.aliases || [],
      resourceId: item.resourceId, entityType: item.entityType,
      region: item.region || {}, timeRange: item.timeRange || {}
    })).filter(item => !query || [item.name, ...item.aliases, item.region.province, item.region.city]
      .some(value => text(value, 100).toLowerCase().includes(query)) || resourceIds.has(item.resourceId));
    const entityIds = new Set(entities.map(item => item.id));
    const relations = (relationResult.data || []).filter(item => !item.needsSourceReview &&
      entityIds.has(item.fromEntityId) && entityIds.has(item.toEntityId))
      .map(item => ({ id: recordId(item), fromEntityId: item.fromEntityId, toEntityId: item.toEntityId,
        relationType: item.relationType, why: text(item.why, 300), evidenceLinkIds: item.evidenceLinkIds || [] }));
    const stories = (storyResult.data || []).filter(item => !item.needsSourceReview &&
      resourceIds.has(item.resourceId)).map(item => ({
      id: recordId(item), resourceId: item.resourceId, title: text(item.title, 100),
      version: item.version || 1
    }));
    const claims = (claimResult.data || []).filter(item => !item.needsSourceReview &&
      resourceIds.has(item.resourceId)).map(item => ({
      id: recordId(item), resourceId: item.resourceId, storyId: item.storyId,
      claimText: text(item.claimText, 360), sourceLinkIds: item.sourceLinkIds || []
    }));
    const links = [];
    for (const item of linkResult.data || []) {
      if (item.needsSourceReview || !resourceIds.has(item.resourceId)) continue;
      try {
        const link = await validLink(db, recordId(item), item.resourceId);
        links.push({ id: link.id, resourceId: link.resourceId, summary: link.summary,
          kind: link.materialReference && link.materialReference.kind || 'submission' });
      } catch (_) {}
    }
    return { ok: true, action: 'getStoryThemeWorkspace', themes,
      catalog: { resources, entities, relations, stories, claims, links } };
  }

  async function save(event, adminUid) {
    const input = normalize(event);
    const themeId = event.themeId ? id(event.themeId, '专题') : 'theme_' + crypto.randomBytes(16).toString('hex');
    return db.runTransaction(async transaction => {
      const ref = transaction.collection(C.themes).doc(themeId);
      const existing = first(await ref.get());
      if (existing && existing.archivedAt) fail('THEME_ARCHIVED', '专题已经归档');
      if (existing && Number(event.expectedRevision) !== Number(existing.revision || 1))
        fail('THEME_EDIT_CONFLICT', '专题已被别人修改，请刷新后再编辑');
      await validateTheme(transaction, input, false);
      const now = db.serverDate();
      const revision = existing ? Number(existing.revision || 1) + 1 : 1;
      const chapters = input.chapters.map((chapter, index) => ({
        ...chapter, id: chapter.id || (existing && existing.chapters &&
          existing.chapters[index] ? chapterIdFor(themeId, existing.chapters[index], index) :
          'chapter_' + crypto.randomBytes(12).toString('hex')) }));
      const payload = { ...input, chapters, status: 'draft', revision,
        publishedVersion: Number(existing && existing.publishedVersion) || 0,
        createdBy: existing && existing.createdBy || adminUid,
        createdAt: existing && existing.createdAt || now, updatedBy: adminUid, updatedAt: now };
      if (existing) await ref.update(payload); else await ref.set(payload);
      await transaction.collection(C.logs).add({ themeId, action: existing ? 'edit' : 'create',
        revision, adminUid, createdAt: now });
      return { ok: true, action: 'saveStoryTheme', themeId, revision };
    });
  }

  async function publish(event, adminUid) {
    const themeId = id(event.themeId, '专题');
    if (event.humanReviewed !== true || text(event.reviewNote, 300).length < 8)
      fail('THEME_REVIEW_REQUIRED', '请确认已逐章核对历史判断，并填写至少 8 字审核说明');
    return db.runTransaction(async transaction => {
      const ref = transaction.collection(C.themes).doc(themeId);
      const theme = first(await ref.get());
      if (!theme || theme.archivedAt) fail('THEME_UNAVAILABLE', '专题草稿不存在');
      if (theme.status !== 'draft' || Number(event.expectedRevision) !== Number(theme.revision))
        fail('THEME_EDIT_CONFLICT', '请刷新专题后再发布');
      const input = normalize(theme);
      input.chapters = input.chapters.map((chapter, index) => ({
        ...chapter, id: chapterIdFor(themeId, chapter, index) }));
      const checked = await validateTheme(transaction, input, true);
      const version = Number(theme.publishedVersion || 0) + 1;
      const now = db.serverDate();
      const versionId = themeId + '_v' + version;
      const published = { themeId, version, ...snapshot(input, checked), status: 'published',
        reviewedBy: adminUid, reviewNote: text(event.reviewNote, 300),
        publishedAt: now, createdAt: now };
      await transaction.collection(C.versions).doc(versionId).set(published);
      await ref.update({ status: 'published', publishedVersion: version, publishedVersionId: versionId,
        needsSourceReview: false, sourceReviewReason: '',
        updatedBy: adminUid, updatedAt: now });
      await transaction.collection(C.logs).add({ themeId, version, action: 'publish',
        revision: theme.revision, adminUid, reviewNote: published.reviewNote, createdAt: now });
      return { ok: true, action: 'publishStoryTheme', themeId, version };
    });
  }

  async function archive(event, adminUid) {
    const themeId = id(event.themeId, '专题');
    const reason = text(event.reason, 300);
    if (reason.length < 4) fail('THEME_ARCHIVE_REASON', '请填写归档原因');
    return db.runTransaction(async transaction => {
      const ref = transaction.collection(C.themes).doc(themeId);
      const theme = first(await ref.get());
      if (!theme || theme.archivedAt) fail('THEME_UNAVAILABLE', '专题不存在或已归档');
      const now = db.serverDate();
      await ref.update({ status: 'archived', archivedAt: now, archiveReason: reason,
        archivedBy: adminUid, updatedAt: now });
      await transaction.collection(C.logs).add({ themeId, action: 'archive',
        reason, adminUid, createdAt: now });
      return { ok: true, action: 'archiveStoryTheme', themeId };
    });
  }
  return { workspace, save, publish, archive };
}

module.exports = { C, normalize, chapterIdFor, validLink, validateTheme, snapshot, createStoryThemeService };
