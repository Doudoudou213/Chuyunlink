'use strict';

const STORY_COLLECTION = 'story_chains';
const STORY_LOG_COLLECTION = 'story_chain_logs';
const LINK_COLLECTION = 'story_evidence_links';
const SUBMISSION_COLLECTION = 'submissions';
const RESOURCE_COLLECTION = 'resources';

function cleanText(value, maxLength) {
  return String(value == null ? '' : value).trim().slice(0, maxLength);
}

function cleanId(value, label = '记录') {
  const id = cleanText(value, 128);
  if (!/^[A-Za-z0-9_-]+$/.test(id)) {
    throw Object.assign(new Error(`${label} ID 格式不正确`), { code: 'INVALID_ID' });
  }
  return id;
}

function firstDocument(result) {
  if (!result) return null;
  if (Array.isArray(result.data)) return result.data[0] || null;
  return result.data || null;
}

function normalizeChapters(value) {
  const chapters = (Array.isArray(value) ? value : []).slice(0, 2).map((item) => ({
    title: cleanText(item && item.title, 24),
    body: cleanText(item && item.body, 360),
    sourceLinkIds: [...new Set((Array.isArray(item && item.sourceLinkIds) ? item.sourceLinkIds : [])
      .map((id) => cleanId(id, '资料来源')))].slice(0, 12)
  }));
  if (!chapters.length || chapters.some((item) => item.title.length < 2 || item.body.length < 12 || !item.sourceLinkIds.length)) {
    throw Object.assign(new Error('每个故事章节都必须有标题、正文和至少一个资料来源'), { code: 'INVALID_STORY_CHAPTERS' });
  }
  return chapters;
}

function createAdminStoryChainService({ db }) {
  async function publish(event, reviewerId) {
    const draftId = cleanId(event.draftId, '故事草稿');
    const title = cleanText(event.title, 24);
    const introduction = cleanText(event.introduction, 150);
    const closing = cleanText(event.closing, 120);
    const chapters = normalizeChapters(event.chapters);
    if (title.length < 4 || introduction.length < 12) {
      throw Object.assign(new Error('故事标题或导语不完整'), { code: 'INVALID_STORY_TEXT' });
    }
    const sourceLinkIds = [...new Set(chapters.flatMap((chapter) => chapter.sourceLinkIds))];
    const draftBefore = firstDocument(await db.collection(STORY_COLLECTION).doc(draftId).get());
    if (!draftBefore || draftBefore.status !== 'draft') {
      throw Object.assign(new Error('故事草稿不存在或已经处理'), { code: 'STORY_DRAFT_NOT_PENDING' });
    }
    const storyVersions = await db.collection(STORY_COLLECTION).where({ resourceId: draftBefore.resourceId }).limit(100).get();
    const previousPublishedIds = (storyVersions.data || [])
      .filter((item) => item.status === 'published' && (item._id || item.id) !== draftId)
      .map((item) => item._id || item.id);
    const nextVersion = Math.max(0, ...(storyVersions.data || []).map((item) => Number(item.version) || 0)) + 1;
    return db.runTransaction(async (transaction) => {
      const draftRef = transaction.collection(STORY_COLLECTION).doc(draftId);
      const draft = firstDocument(await draftRef.get());
      if (!draft || draft.status !== 'draft') {
        throw Object.assign(new Error('故事草稿不存在或已经处理'), { code: 'STORY_DRAFT_NOT_PENDING' });
      }
      const resource = firstDocument(await transaction.collection(RESOURCE_COLLECTION).doc(draft.resourceId || '').get());
      if (!resource || resource.status !== 'published') {
        throw Object.assign(new Error('故事对应的文化资源已不可发布'), { code: 'PUBLISHED_RESOURCE_REQUIRED' });
      }
      const linkStates = await Promise.all(sourceLinkIds.map(async (linkId) => ({
        linkId,
        link: firstDocument(await transaction.collection(LINK_COLLECTION).doc(linkId).get())
      })));
      if (linkStates.some(({ link }) => !link || link.status !== 'confirmed' || link.resourceId !== draft.resourceId)) {
        throw Object.assign(new Error('故事引用了失效或不属于该资源的链迹'), { code: 'INVALID_STORY_SOURCE' });
      }
      const submissionStates = await Promise.all(linkStates.map(async ({ link }) => (
        firstDocument(await transaction.collection(SUBMISSION_COLLECTION).doc(link.submissionId || '').get())
      )));
      if (submissionStates.some((submission) => !submission || submission.status !== 'approved')) {
        throw Object.assign(new Error('故事引用的投稿已不再公开'), { code: 'INVALID_STORY_SUBMISSION' });
      }
      const previousStories = await Promise.all(previousPublishedIds.map(async (storyId) => ({
        ref: transaction.collection(STORY_COLLECTION).doc(storyId),
        story: firstDocument(await transaction.collection(STORY_COLLECTION).doc(storyId).get())
      })));
      const now = db.serverDate();
      for (const previous of previousStories) {
        if (previous.story && previous.story.status === 'published') {
          await previous.ref.update({ status: 'superseded', supersededBy: draftId, updatedAt: now });
        }
      }
      await draftRef.update({
        title,
        introduction,
        chapters,
        closing,
        sourceLinkIds,
        status: 'published',
        version: nextVersion,
        reviewedBy: reviewerId,
        publishedAt: now,
        updatedAt: now
      });
      await transaction.collection(STORY_LOG_COLLECTION).add({
        storyId: draftId,
        resourceId: draft.resourceId,
        action: 'publish',
        sourceLinkIds,
        reviewerId,
        createdAt: now
      });
      return { ok: true, action: 'publishStoryDraft', storyId: draftId, status: 'published' };
    });
  }

  async function archive(event, reviewerId) {
    const storyId = cleanId(event.storyId, '故事');
    const archiveReason = cleanText(event.archiveReason, 300);
    if (archiveReason.length < 4) {
      throw Object.assign(new Error('请填写至少 4 个字的归档原因'), { code: 'STORY_ARCHIVE_REASON_REQUIRED' });
    }
    return db.runTransaction(async (transaction) => {
      const ref = transaction.collection(STORY_COLLECTION).doc(storyId);
      const story = firstDocument(await ref.get());
      if (!story || !['draft', 'published'].includes(story.status)) {
        throw Object.assign(new Error('故事不存在或已经归档'), { code: 'STORY_NOT_ACTIVE' });
      }
      const now = db.serverDate();
      await ref.update({
        status: 'archived',
        archiveReason,
        archivedBy: reviewerId,
        archivedAt: now,
        updatedAt: now
      });
      await transaction.collection(STORY_LOG_COLLECTION).add({
        storyId,
        resourceId: story.resourceId || '',
        action: 'archive',
        archiveReason,
        reviewerId,
        createdAt: now
      });
      return { ok: true, action: 'archiveStoryChain', storyId, status: 'archived' };
    });
  }

  return { publish, archive };
}

module.exports = { createAdminStoryChainService, normalizeChapters };
