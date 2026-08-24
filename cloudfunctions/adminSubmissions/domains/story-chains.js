'use strict';

const crypto = require('crypto');
const STORY_COLLECTION = 'story_chains';
const STORY_LOG_COLLECTION = 'story_chain_logs';
const CLAIM_COLLECTION = 'story_claims';
const CLAIM_LOG_COLLECTION = 'story_claim_logs';
const LINK_COLLECTION = 'story_evidence_links';
const SUBMISSION_COLLECTION = 'submissions';
const RESOURCE_COLLECTION = 'resources';
const { assessStoryQuality } = require('./story-quality');
const { claimIdFor } = require('./story-claims');

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

function chapterSnapshot(chapter) {
  return {
    title: cleanText(chapter && chapter.title, 24),
    body: cleanText(chapter && chapter.body, 360),
    sourceLinkIds: [...new Set((Array.isArray(chapter && chapter.sourceLinkIds) ? chapter.sourceLinkIds : [])
      .map((id) => cleanText(id, 128)).filter(Boolean))].slice(0, 12)
  };
}

function sameChapter(left, right) {
  return JSON.stringify(chapterSnapshot(left)) === JSON.stringify(chapterSnapshot(right));
}

function validateSectionRevision(draft, parentStory, input) {
  if (!parentStory || parentStory.status !== 'published') {
    throw Object.assign(new Error('原故事已不是当前发布版本，请重新创建局部修订'), { code: 'REVISION_PARENT_NOT_CURRENT' });
  }
  const targetChapterIndex = Number(draft.targetChapterIndex);
  const parentChapters = normalizeChapters(parentStory.chapters);
  if (!Number.isInteger(targetChapterIndex) || targetChapterIndex < 0 || targetChapterIndex >= parentChapters.length) {
    throw Object.assign(new Error('局部修订的目标章节不正确'), { code: 'INVALID_REVISION_TARGET' });
  }
  if (input.chapters.length !== parentChapters.length) {
    throw Object.assign(new Error('局部修订不能增加或删除其他章节'), { code: 'REVISION_SCOPE_VIOLATION' });
  }
  if (input.title !== cleanText(parentStory.title, 24)
    || input.introduction !== cleanText(parentStory.introduction, 150)
    || input.closing !== cleanText(parentStory.closing, 120)) {
    throw Object.assign(new Error('局部修订只能修改所选章节'), { code: 'REVISION_SCOPE_VIOLATION' });
  }
  input.chapters.forEach((chapter, index) => {
    if (index !== targetChapterIndex && !sameChapter(chapter, parentChapters[index])) {
      throw Object.assign(new Error(`第 ${index + 1} 章不在本次修订范围内`), { code: 'REVISION_SCOPE_VIOLATION' });
    }
  });
  if (sameChapter(input.chapters[targetChapterIndex], parentChapters[targetChapterIndex])) {
    throw Object.assign(new Error('目标章节还没有发生变化'), { code: 'REVISION_HAS_NO_CHANGE' });
  }
  return {
    targetChapterIndex,
    before: parentChapters[targetChapterIndex],
    after: input.chapters[targetChapterIndex]
  };
}

function createAdminStoryChainService({ db }) {
  async function publish(event, reviewerId) {
    const draftId = cleanId(event.draftId, '故事草稿');
    const title = cleanText(event.title, 24);
    const introduction = cleanText(event.introduction, 150);
    const closing = cleanText(event.closing, 120);
    const qualityOverrideReason = cleanText(event.qualityOverrideReason, 300);
    const revisionSummary = cleanText(event.revisionSummary, 180);
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
    let parentClaims = [];
    if (draftBefore.revisionMode === 'section_patch' && draftBefore.parentStoryId) {
      const claimResult = await db.collection(CLAIM_COLLECTION).where({ storyId: draftBefore.parentStoryId }).limit(100).get();
      parentClaims = claimResult.data || [];
    }
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
      let revisionDiff = null;
      let parentStory = null;
      if (draft.revisionMode === 'section_patch') {
        parentStory = firstDocument(await transaction.collection(STORY_COLLECTION).doc(draft.parentStoryId || '').get());
        revisionDiff = validateSectionRevision(draft, parentStory, { title, introduction, chapters, closing });
        if (revisionSummary.length < 8) {
          throw Object.assign(new Error('请用至少 8 个字说明这一版修订了什么'), { code: 'REVISION_SUMMARY_REQUIRED' });
        }
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
      const sourceTextById = {};
      linkStates.forEach(({ linkId, link }, index) => {
        const submission = submissionStates[index] || {};
        sourceTextById[linkId] = [
          link && link.evidenceSummary,
          submission.title,
          submission.description
        ].map((value) => cleanText(value, 1600)).filter(Boolean).join('\n');
      });
      const qualityAssessment = assessStoryQuality({ title, introduction, chapters, closing }, {
        allowedSourceIds: sourceLinkIds,
        sourceTextById,
        resourceText: [resource.title, resource.summary || resource.description]
          .map((value) => cleanText(value, 1600)).filter(Boolean).join('\n')
      });
      if (qualityAssessment.hardFailures.length) {
        throw Object.assign(new Error('故事仍有来源、结构或隐私问题，请修改后再发布'), { code: 'STORY_QUALITY_BLOCKED' });
      }
      if (!qualityAssessment.publicationEligible && qualityOverrideReason.length < 8) {
        throw Object.assign(new Error('故事质量仍需改进；如确认发布，请填写至少 8 个字的人工判断说明'), {
          code: 'STORY_QUALITY_OVERRIDE_REQUIRED'
        });
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
        qualityAssessment,
        publicationEligible: qualityAssessment.publicationEligible,
        qualityOverrideReason: qualityAssessment.publicationEligible ? '' : qualityOverrideReason,
        revisionMode: draft.revisionMode === 'section_patch' ? 'section_patch' : '',
        parentStoryId: draft.revisionMode === 'section_patch' ? draft.parentStoryId : '',
        previousVersion: draft.revisionMode === 'section_patch' ? Math.max(1, Number(parentStory && parentStory.version) || 1) : null,
        targetChapterIndex: draft.revisionMode === 'section_patch' ? revisionDiff.targetChapterIndex : null,
        revisionReason: draft.revisionMode === 'section_patch' ? cleanText(draft.revisionReason, 300) : '',
        revisionSummary: draft.revisionMode === 'section_patch' ? revisionSummary : '',
        revisionDiff: draft.revisionMode === 'section_patch' ? revisionDiff : null,
        reviewedBy: reviewerId,
        publishedAt: now,
        updatedAt: now
      });
      await transaction.collection(STORY_LOG_COLLECTION).add({
        storyId: draftId,
        resourceId: draft.resourceId,
        action: 'publish',
        sourceLinkIds,
        qualityAssessment,
        qualityOverrideReason: qualityAssessment.publicationEligible ? '' : qualityOverrideReason,
        revisionMode: draft.revisionMode === 'section_patch' ? 'section_patch' : '',
        parentStoryId: draft.revisionMode === 'section_patch' ? draft.parentStoryId : '',
        revisionSummary: draft.revisionMode === 'section_patch' ? revisionSummary : '',
        revisionDiff: draft.revisionMode === 'section_patch' ? revisionDiff : null,
        reviewerId,
        createdAt: now
      });
      if (draft.revisionMode === 'section_patch' && parentStory) {
        const activeClaims = parentClaims.filter((claim) => claim.status !== 'retired'
          && Number(claim.storyVersion || 1) === Math.max(1, Number(parentStory.version) || 1));
        for (const claim of activeClaims) {
          const chapterIndex = Number(claim.chapterIndex);
          const nextChapter = chapters[chapterIndex];
          const claimText = cleanText(claim.claimText, 360);
          const claimSources = (Array.isArray(claim.sourceLinkIds) ? claim.sourceLinkIds : [])
            .map((id) => cleanText(id, 128)).filter(Boolean);
          if (!nextChapter || !nextChapter.body.includes(claimText)
            || claimSources.some((id) => !nextChapter.sourceLinkIds.includes(id))) continue;
          const nextClaimId = claimIdFor(draftId, nextVersion, chapterIndex, claimText);
          await transaction.collection(CLAIM_COLLECTION).doc(nextClaimId).set({
            storyId: draftId,
            storyVersion: nextVersion,
            resourceId: draft.resourceId,
            chapterIndex,
            claimText,
            sourceLinkIds: claimSources,
            status: claim.status,
            reviewedBy: claim.reviewedBy || reviewerId,
            reviewedAt: claim.reviewedAt || now,
            carriedForwardFrom: claim._id || claim.id || '',
            createdAt: now,
            updatedAt: now
          });
          await transaction.collection(CLAIM_LOG_COLLECTION).add({
            claimId: nextClaimId,
            storyId: draftId,
            resourceId: draft.resourceId,
            action: 'carry_forward',
            carriedForwardFrom: claim._id || claim.id || '',
            reviewerId,
            createdAt: now
          });
        }
      }
      return { ok: true, action: 'publishStoryDraft', storyId: draftId, status: 'published', revisionSummary: draft.revisionMode === 'section_patch' ? revisionSummary : '' };
    });
  }

  async function createRevisionDraft(event, reviewerId) {
    const storyId = cleanId(event.storyId, '故事');
    const targetChapterIndex = Number(event.targetChapterIndex);
    const revisionReason = cleanText(event.revisionReason, 300);
    if (!Number.isInteger(targetChapterIndex) || targetChapterIndex < 0 || targetChapterIndex > 20) {
      throw Object.assign(new Error('请选择需要修改的章节'), { code: 'INVALID_REVISION_TARGET' });
    }
    if (revisionReason.length < 4) {
      throw Object.assign(new Error('请填写至少 4 个字的修订原因'), { code: 'REVISION_REASON_REQUIRED' });
    }
    const story = firstDocument(await db.collection(STORY_COLLECTION).doc(storyId).get());
    if (!story || story.status !== 'published') {
      throw Object.assign(new Error('只能从当前发布版本创建局部修订'), { code: 'PUBLISHED_STORY_REQUIRED' });
    }
    const chapters = normalizeChapters(story.chapters);
    if (!chapters[targetChapterIndex]) {
      throw Object.assign(new Error('所选章节不存在'), { code: 'INVALID_REVISION_TARGET' });
    }
    const existingResult = await db.collection(STORY_COLLECTION).where({ parentStoryId: storyId }).limit(20).get();
    const existing = (existingResult.data || []).find((item) => item.status === 'draft' && item.revisionMode === 'section_patch');
    if (existing) {
      return { ok: true, action: 'createStoryRevisionDraft', draftId: existing._id || existing.id || '', cached: true };
    }
    const parentKey = crypto.createHash('sha256').update(storyId).digest('hex').slice(0, 16);
    const draftId = `revision_${parentKey}_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
    const now = db.serverDate();
    await db.collection(STORY_COLLECTION).doc(draftId).set({
      resourceId: story.resourceId || '',
      resourceTitle: story.resourceTitle || '',
      title: cleanText(story.title, 24),
      introduction: cleanText(story.introduction, 150),
      chapters,
      closing: cleanText(story.closing, 120),
      sourceLinkIds: [...new Set(chapters.flatMap((chapter) => chapter.sourceLinkIds))],
      status: 'draft',
      version: Math.max(1, Number(story.version) || 1) + 1,
      revisionMode: 'section_patch',
      parentStoryId: storyId,
      previousVersion: Math.max(1, Number(story.version) || 1),
      targetChapterIndex,
      revisionReason,
      createdBy: reviewerId,
      createdAt: now,
      updatedAt: now
    });
    await db.collection(STORY_LOG_COLLECTION).add({
      storyId: draftId,
      resourceId: story.resourceId || '',
      action: 'create_revision_draft',
      parentStoryId: storyId,
      targetChapterIndex,
      revisionReason,
      reviewerId,
      createdAt: now
    });
    return { ok: true, action: 'createStoryRevisionDraft', draftId, cached: false };
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

  return { publish, archive, createRevisionDraft };
}

module.exports = { createAdminStoryChainService, normalizeChapters, validateSectionRevision, sameChapter };
