'use strict';

const LINK_COLLECTION = 'story_evidence_links';
const SUBMISSION_COLLECTION = 'submissions';
const RESOURCE_COLLECTION = 'resources';
const STORY_COLLECTION = 'story_chains';

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

function timeValue(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (typeof value === 'string') return value;
  return null;
}

function createStoryEvidenceService({ db, app }) {
  async function list(event = {}) {
    const resourceId = cleanText(event.resourceId, 128);
    if (!/^[A-Za-z0-9_-]+$/.test(resourceId)) {
      const error = new Error('资源 ID 格式不正确');
      error.code = 'INVALID_RESOURCE_ID';
      throw error;
    }
    const resource = firstDocument(await db.collection(RESOURCE_COLLECTION).doc(resourceId).get());
    if (!resource || resource.status !== 'published') {
      const error = new Error('没有找到已发布资源');
      error.code = 'RESOURCE_NOT_FOUND';
      throw error;
    }

    let links = [];
    try {
      const result = await db.collection(LINK_COLLECTION).where({ resourceId }).limit(100).get();
      links = (result.data || []).filter((item) => item.status === 'confirmed');
    } catch (error) {
      if (!isMissingCollectionError(error)) throw error;
      return {
        ok: true,
        action: 'getStoryEvidence',
        resource: { id: resourceId, title: resource.title || '', summary: resource.summary || '' },
        count: 0,
        contributorCount: 0,
        items: [],
        story: null,
        collectionReady: false
      };
    }

    const evidence = [];
    for (const link of links) {
      try {
        const submission = firstDocument(
          await db.collection(SUBMISSION_COLLECTION).doc(link.submissionId || '').get()
        );
        if (!submission || submission.status !== 'approved') continue;
        evidence.push({ link, submission });
      } catch (_) {}
    }

    const fileList = evidence
      .map(({ submission }) => submission.imageFileID || submission.fileID || '')
      .filter(Boolean);
    let fileUrls = new Map();
    if (fileList.length) {
      try {
        const result = await app.getTempFileURL({
          fileList: [...new Set(fileList)].map((fileID) => ({ fileID, maxAge: 7200 }))
        });
        fileUrls = new Map((result.fileList || []).map((item) => [
          item.fileID,
          item.tempFileURL || item.download_url || ''
        ]));
      } catch (_) {}
    }

    const items = evidence
      .map(({ link, submission }) => ({
        id: link._id || link.id || '',
        relationType: link.relationType || 'supports_story',
        evidenceSummary: link.evidenceSummary || '',
        reviewedAt: timeValue(link.reviewedAt),
        submission: {
          id: submission._id || submission.id || '',
          title: submission.title || submission.description || '社区投稿',
          description: submission.description || '',
          assetType: submission.assetType || 'image',
          contributorName: submission.contributorName || '社区守护者',
          regionName: submission.regionName || '',
          createdAt: timeValue(submission.createdAt),
          fileUrl: fileUrls.get(submission.imageFileID || submission.fileID || '') || ''
        }
      }))
      .sort((left, right) => String(left.submission.createdAt || '').localeCompare(String(right.submission.createdAt || '')));
    const contributors = new Set(items.map((item) => item.submission.contributorName).filter(Boolean));
    let story = null;
    try {
      const storyResult = await db.collection(STORY_COLLECTION).where({ resourceId }).limit(20).get();
      const published = (storyResult.data || [])
        .filter((item) => item.status === 'published')
        .sort((left, right) => String(timeValue(right.publishedAt) || '').localeCompare(String(timeValue(left.publishedAt) || '')));
      const selected = published[0];
      if (selected) {
        const validLinkIds = new Set(items.map((item) => item.id));
        const chapters = (Array.isArray(selected.chapters) ? selected.chapters : []).map((chapter) => ({
          title: cleanText(chapter && chapter.title, 100),
          body: cleanText(chapter && chapter.body, 1800),
          sourceLinkIds: [...new Set((Array.isArray(chapter && chapter.sourceLinkIds) ? chapter.sourceLinkIds : [])
            .map((id) => cleanText(id, 128))
            .filter((id) => validLinkIds.has(id)))]
        })).filter((chapter) => chapter.title && chapter.body && chapter.sourceLinkIds.length);
        if (chapters.length) {
          story = {
            id: selected._id || selected.id || '',
            title: cleanText(selected.title, 100),
            introduction: cleanText(selected.introduction, 800),
            chapters,
            closing: cleanText(selected.closing, 600),
            version: Math.max(1, Number(selected.version) || 1),
            publishedAt: timeValue(selected.publishedAt)
          };
        }
      }
    } catch (error) {
      if (!isMissingCollectionError(error)) throw error;
    }
    return {
      ok: true,
      action: 'getStoryEvidence',
      resource: { id: resourceId, title: resource.title || '', summary: resource.summary || '' },
      count: items.length,
      contributorCount: contributors.size,
      items,
      story
    };
  }

  return { list };
}

module.exports = {
  LINK_COLLECTION,
  createStoryEvidenceService
};
