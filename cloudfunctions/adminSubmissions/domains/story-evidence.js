'use strict';

const crypto = require('crypto');

const SUBMISSION_COLLECTION = 'submissions';
const RESOURCE_COLLECTION = 'resources';
const LINK_COLLECTION = 'story_evidence_links';
const LOG_COLLECTION = 'story_evidence_logs';
const ALLOWED_RELATION_TYPES = new Set([
  'documents_feature',
  'documents_inscription',
  'documents_place',
  'documents_oral_history',
  'shows_change_over_time',
  'supports_story'
]);

function cleanText(value, maxLength) {
  return String(value == null ? '' : value).trim().slice(0, maxLength);
}

function cleanId(value, label) {
  const id = cleanText(value, 128);
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

function linkIdFor(submissionId, resourceId) {
  const digest = crypto.createHash('sha256')
    .update(`${submissionId}:${resourceId}`, 'utf8')
    .digest('hex')
    .slice(0, 40);
  return `story_${digest}`;
}

function createAdminStoryEvidenceService({ db, app }) {
  async function temporaryUrls(items) {
    const fileList = items
      .map((item) => item.imageFileID || item.fileID || '')
      .filter(Boolean);
    if (!fileList.length) return new Map();
    try {
      const result = await app.getTempFileURL({
        fileList: [...new Set(fileList)].map((fileID) => ({ fileID, maxAge: 7200 }))
      });
      return new Map((result.fileList || []).map((item) => [
        item.fileID,
        item.tempFileURL || item.download_url || ''
      ]));
    } catch (_) {
      return new Map();
    }
  }

  async function workspace() {
    const [submissionResult, resourceResult, linkResult] = await Promise.all([
      db.collection(SUBMISSION_COLLECTION).where({ status: 'approved' }).limit(50).get(),
      db.collection(RESOURCE_COLLECTION).where({ status: 'published' }).limit(100).get(),
      db.collection(LINK_COLLECTION).limit(100).get()
    ]);
    const submissionRecords = submissionResult.data || [];
    const resourceRecords = resourceResult.data || [];
    const fileUrls = await temporaryUrls(submissionRecords);
    const submissions = submissionRecords.map((item) => ({
      id: item._id || item.id || '',
      title: item.title || item.description || '社区投稿',
      description: item.description || '',
      assetType: item.assetType || 'image',
      contributorName: item.contributorName || '社区守护者',
      regionName: item.regionName || '',
      createdAt: timeValue(item.createdAt),
      fileUrl: fileUrls.get(item.imageFileID || item.fileID || '') || ''
    }));
    const resources = resourceRecords.map((item) => ({
      id: item._id || item.id || '',
      title: item.title || '',
      type: item.type || 'article',
      summary: item.summary || '',
      region: item.region || {}
    }));
    const submissionMap = new Map(submissions.map((item) => [item.id, item]));
    const resourceMap = new Map(resources.map((item) => [item.id, item]));
    const links = (linkResult.data || [])
      .map((item) => ({
        id: item._id || item.id || '',
        submissionId: item.submissionId || '',
        submissionTitle: item.submissionTitle || submissionMap.get(item.submissionId)?.title || '社区投稿',
        resourceId: item.resourceId || '',
        resourceTitle: item.resourceTitle || resourceMap.get(item.resourceId)?.title || '文化资源',
        relationType: item.relationType || 'supports_story',
        evidenceSummary: item.evidenceSummary || '',
        status: item.status || 'confirmed',
        reviewedBy: item.reviewedBy || '',
        reviewedAt: timeValue(item.reviewedAt),
        archivedAt: timeValue(item.archivedAt),
        archiveReason: item.archiveReason || '',
        version: Math.max(1, Number(item.version) || 1)
      }))
      .sort((left, right) => String(right.reviewedAt || '').localeCompare(String(left.reviewedAt || '')));
    return {
      ok: true,
      action: 'getStoryLinkWorkspace',
      submissions,
      resources,
      links,
      counts: {
        approvedSubmissions: submissions.length,
        publishedResources: resources.length,
        confirmedLinks: links.filter((item) => item.status === 'confirmed').length
      }
    };
  }

  async function save(event, reviewerId) {
    const submissionId = cleanId(event.submissionId, '投稿');
    const resourceId = cleanId(event.resourceId, '资源');
    const relationType = cleanText(event.relationType, 40);
    const evidenceSummary = cleanText(event.evidenceSummary, 500);
    if (!ALLOWED_RELATION_TYPES.has(relationType)) {
      const error = new Error('关系类型不受支持');
      error.code = 'INVALID_RELATION_TYPE';
      throw error;
    }
    if (evidenceSummary.length < 6) {
      const error = new Error('请用至少 6 个字说明这份投稿与资源的关系');
      error.code = 'EVIDENCE_SUMMARY_REQUIRED';
      throw error;
    }
    const linkId = linkIdFor(submissionId, resourceId);
    return db.runTransaction(async (transaction) => {
      const submission = firstDocument(await transaction.collection(SUBMISSION_COLLECTION).doc(submissionId).get());
      if (!submission || submission.status !== 'approved') {
        const error = new Error('投稿不存在或尚未审核通过');
        error.code = 'APPROVED_SUBMISSION_REQUIRED';
        throw error;
      }
      const resource = firstDocument(await transaction.collection(RESOURCE_COLLECTION).doc(resourceId).get());
      if (!resource || resource.status !== 'published') {
        const error = new Error('文化资源不存在或尚未发布');
        error.code = 'PUBLISHED_RESOURCE_REQUIRED';
        throw error;
      }
      const linkRef = transaction.collection(LINK_COLLECTION).doc(linkId);
      const current = firstDocument(await linkRef.get());
      const now = db.serverDate();
      const record = {
        submissionId,
        submissionTitle: submission.title || submission.description || '社区投稿',
        resourceId,
        resourceTitle: resource.title || '文化资源',
        relationType,
        evidenceSummary,
        confidence: 1,
        proposedBy: 'admin',
        status: 'confirmed',
        reviewedBy: reviewerId,
        reviewedAt: now,
        updatedAt: now,
        version: Math.max(0, Number(current && current.version) || 0) + 1,
        archivedAt: null,
        archivedBy: '',
        archiveReason: ''
      };
      if (current) {
        await linkRef.update(record);
      } else {
        await linkRef.set({ ...record, createdAt: now });
      }
      await transaction.collection(LOG_COLLECTION).add({
        linkId,
        action: current ? 'reconfirm' : 'confirm',
        submissionId,
        resourceId,
        relationType,
        evidenceSummary,
        reviewerId,
        createdAt: now
      });
      return {
        ok: true,
        action: 'saveStoryEvidenceLink',
        link: {
          id: linkId,
          ...record,
          submissionTitle: record.submissionTitle,
          resourceTitle: record.resourceTitle
        }
      };
    });
  }

  async function archive(event, reviewerId) {
    const linkId = cleanId(event.linkId, '链迹关系');
    const archiveReason = cleanText(event.archiveReason, 300);
    if (archiveReason.length < 4) {
      const error = new Error('请填写归档原因，便于以后追溯');
      error.code = 'ARCHIVE_REASON_REQUIRED';
      throw error;
    }
    return db.runTransaction(async (transaction) => {
      const linkRef = transaction.collection(LINK_COLLECTION).doc(linkId);
      const current = firstDocument(await linkRef.get());
      if (!current) {
        const error = new Error('没有找到这条链迹关系');
        error.code = 'STORY_LINK_NOT_FOUND';
        throw error;
      }
      const now = db.serverDate();
      await linkRef.update({
        status: 'archived',
        archivedAt: now,
        archivedBy: reviewerId,
        archiveReason,
        updatedAt: now,
        version: Math.max(1, Number(current.version) || 1) + 1
      });
      await transaction.collection(LOG_COLLECTION).add({
        linkId,
        action: 'archive',
        submissionId: current.submissionId || '',
        resourceId: current.resourceId || '',
        reviewerId,
        archiveReason,
        createdAt: now
      });
      return { ok: true, action: 'archiveStoryEvidenceLink', linkId, status: 'archived' };
    });
  }

  return { workspace, save, archive };
}

module.exports = {
  ALLOWED_RELATION_TYPES,
  LINK_COLLECTION,
  LOG_COLLECTION,
  createAdminStoryEvidenceService,
  linkIdFor
};
