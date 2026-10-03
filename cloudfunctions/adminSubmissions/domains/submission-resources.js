'use strict';

const crypto = require('crypto');
const { resourceBindingOption } = require('./resource-binding');
const TYPES = new Set(['article', 'landmark']);

function fail(code, message, details = {}) {
  throw Object.assign(new Error(message), { code, ...details });
}

function text(value, max, label) {
  if (value != null && typeof value !== 'string') fail('INVALID_RESOURCE_INPUT', `${label}格式不正确`);
  const result = String(value || '').trim().normalize('NFC').replace(/\s+/g, ' ');
  if (result.length > max) fail('INVALID_RESOURCE_INPUT', `${label}不能超过 ${max} 字`);
  return result;
}

function first(result) {
  return Array.isArray(result?.data) ? result.data[0] || null : result?.data || null;
}

function digest(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 40);
}

function identity(type, title, regionName) {
  return JSON.stringify([type, title.toLowerCase(), regionName.toLowerCase()]);
}

function escapedPattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function regionLabel(resource) {
  const region = resource?.region || {};
  return String(region.label || [region.province, region.city, region.district].filter(Boolean).join(' '))
    .trim().normalize('NFC').replace(/\s+/g, ' ');
}

function duplicate(resource) {
  const resourceId = resource._id || resource.id;
  if (resource.status !== 'published') {
    fail('RESOURCE_UNAVAILABLE_DUPLICATE', `同名、同类、同地区资源「${resource.title}」当前未公开，不能关联。请先核对资源信息，不要重复建立。`);
  }
  fail('RESOURCE_ALREADY_EXISTS', `同名、同类、同地区资源「${resource.title}」已存在，请搜索并选择已有资源（${resourceId}）。`, {
    resourceId, resourceTitle: resource.title
  });
}

function createSubmissionResourceService({ db }) {
  async function search(event = {}) {
    const query = text(event.query, 120, '检索词');
    const offset = event.offset == null ? 0 : Number(event.offset);
    const limit = event.limit == null ? 20 : Number(event.limit);
    if (!Number.isInteger(offset) || offset < 0 || offset > 100000 ||
        !Number.isInteger(limit) || limit < 1 || limit > 20) {
      fail('INVALID_RESOURCE_PAGE', '资源分页参数不正确');
    }
    const where = { status: 'published' };
    if (query) where.title = new db.RegExp({ regexp: escapedPattern(query), options: 'i' });
    const result = await db.collection('resources').where(where).orderBy('_id', 'asc')
      .skip(offset).limit(limit + 1).get();
    const rows = result.data || [];
    const items = rows.slice(0, limit).map(resourceBindingOption);
    return { ok: true, action: 'searchSubmissionResources', items,
      hasMore: rows.length > limit, nextOffset: rows.length > limit ? offset + limit : null };
  }

  async function create(event = {}, reviewerId) {
    const submissionId = text(event.submissionId, 128, '投稿编号');
    if (!/^[A-Za-z0-9_-]+$/.test(submissionId)) fail('INVALID_ID', '投稿编号格式不正确');
    if (!reviewerId) fail('ADMIN_REQUIRED', '需要管理员确认');
    if (event.confirmCreate !== true) fail('RESOURCE_CONFIRMATION_REQUIRED', '请确认已核对新资源名称、类型和地区');
    const title = text(event.title, 120, '资源名称');
    const type = event.resourceType == null ? 'article' : event.resourceType;
    const regionName = text(event.regionName, 80, '地区');
    if (!title) fail('RESOURCE_TITLE_REQUIRED', '请填写资源名称');
    if (!TYPES.has(type)) fail('INVALID_RESOURCE_TYPE', '请选择文化资料或地点');
    const fingerprint = digest(identity(type, title, regionName));
    const resourceId = `community-${fingerprint}`;

    // Legacy resources lack a canonical identity. Prefetch potential IDs outside
    // the transaction; every duplicate decision is rechecked by document inside it.
    // New concurrent creates share the deterministic resource ID and transaction lock.
    const pattern = '^\\s*' + title.split(' ').map(escapedPattern).join('\\s+') + '\\s*$';
    const legacyResult = await db.collection('resources').where({
      type, title: new db.RegExp({ regexp: pattern, options: 'i' })
    }).limit(101).get();
    const candidates = legacyResult.data || [];
    if (candidates.length > 100) fail('RESOURCE_DUPLICATE_REVIEW_REQUIRED', '同名资源较多，请先搜索并核对已有资源');

    return db.runTransaction(async transaction => {
      const submissionRef = transaction.collection('submissions').doc(submissionId);
      const submission = first(await submissionRef.get());
      if (!submission || submission.status !== 'approved' || submission.withdrawnAt || submission.disabledAt || submission.sourceUnavailable) {
        fail('APPROVED_SUBMISSION_REQUIRED', '只有审核通过且仍有效的投稿可以建立资源');
      }
      const resourceRef = transaction.collection('resources').doc(resourceId);
      const existing = first(await resourceRef.get());
      if (submission.createdResourceId) {
        if (submission.createdResourceId === resourceId && existing?.sourceSubmissionId === submissionId &&
            existing.status === 'published' && submission.resourceId === resourceId) {
          return { ok: true, action: 'createResourceFromSubmission', submissionId,
            resourceId, resourceTitle: existing.title, cached: true };
        }
        fail('RESOURCE_CREATION_CONFLICT', '这份投稿已建立过资源或关联已变化，请刷新后使用已有资源');
      }
      if (submission.resourceId) fail('SUBMISSION_ALREADY_BOUND', '这份投稿已关联资源，请先核对现有关联');
      if (existing) duplicate(existing);
      for (const candidate of candidates) {
        const current = first(await transaction.collection('resources').doc(candidate._id || candidate.id).get());
        if (current && current.type === type &&
            identity(type, text(current.title, 120, '已有资源名称'), regionLabel(current)) === identity(type, title, regionName)) {
          duplicate(current);
        }
      }

      const now = db.serverDate();
      await resourceRef.set({
        id: resourceId, modelVersion: 1, type, title, summary: '', status: 'published',
        region: regionName ? { label: regionName } : {}, location: null,
        categoryIds: [], tags: [], media: [], collectables: [], transport: {},
        visitInfo: { status: 'unknown', note: '', source: '', checkedAt: null },
        capabilities: { commentable: false, mappable: false, routable: false, collectable: false },
        relatedResourceIds: [], legacyAliases: [], source: 'admin_reviewed_submission',
        sourceSubmissionId: submissionId, completeness: 0,
        identityFingerprint: fingerprint, reviewedBy: reviewerId, reviewedAt: now,
        publishedAt: now, createdAt: now, updatedAt: now
      });
      await submissionRef.update({
        resourceId, createdResourceId: resourceId, resourceBindingStatus: 'confirmed',
        resourceBoundAt: now, resourceBoundBy: reviewerId,
        resourceBindingSource: 'admin_resource_creation', updatedAt: now
      });
      await transaction.collection('moderation_logs').doc(`resource_creation_${digest(submissionId)}`).set({
        action: 'resource_created_from_submission', submissionId, resourceId, resourceTitle: title,
        resourceType: type, regionName, reviewerId, previousResourceId: '', createdAt: now
      });
      return { ok: true, action: 'createResourceFromSubmission', submissionId,
        resourceId, resourceTitle: title, cached: false };
    });
  }

  return { create, search };
}

module.exports = { createSubmissionResourceService };
