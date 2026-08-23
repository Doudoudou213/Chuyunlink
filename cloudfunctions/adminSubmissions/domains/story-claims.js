'use strict';

const crypto = require('crypto');

const CLAIM_COLLECTION = 'story_claims';
const CLAIM_LOG_COLLECTION = 'story_claim_logs';
const STORY_COLLECTION = 'story_chains';
const LINK_COLLECTION = 'story_evidence_links';
const SUBMISSION_COLLECTION = 'submissions';
const ACTIVE_STATUSES = new Set(['supported', 'needs_evidence', 'disputed']);

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

function claimIdFor(storyId, storyVersion, chapterIndex, claimText) {
  const digest = crypto.createHash('sha256')
    .update(`${storyId}:${storyVersion}:${chapterIndex}:${claimText}`)
    .digest('hex')
    .slice(0, 40);
  return `claim_${digest}`;
}

function normalizeClaimInput(event = {}) {
  const storyId = cleanId(event.storyId, '故事');
  const chapterIndex = Number(event.chapterIndex);
  const claimText = cleanText(event.claimText, 360);
  const status = cleanText(event.status || 'supported', 32);
  const sourceLinkIds = [...new Set((Array.isArray(event.sourceLinkIds) ? event.sourceLinkIds : [])
    .map((id) => cleanId(id, '资料来源')))].slice(0, 12);
  if (!Number.isInteger(chapterIndex) || chapterIndex < 0 || chapterIndex > 20) {
    throw Object.assign(new Error('故事章节位置不正确'), { code: 'INVALID_CHAPTER_INDEX' });
  }
  if (claimText.length < 4) {
    throw Object.assign(new Error('请选择或填写至少 4 个字的事实原句'), { code: 'INVALID_CLAIM_TEXT' });
  }
  if (!ACTIVE_STATUSES.has(status)) {
    throw Object.assign(new Error('事实状态不正确'), { code: 'INVALID_CLAIM_STATUS' });
  }
  if (status === 'supported' && !sourceLinkIds.length) {
    throw Object.assign(new Error('确认有依据的事实至少需要一份来源'), { code: 'CLAIM_SOURCE_REQUIRED' });
  }
  return { storyId, chapterIndex, claimText, status, sourceLinkIds };
}

function createAdminStoryClaimService({ db }) {
  async function workspace() {
    const [result, linkResult] = await Promise.all([
      db.collection(CLAIM_COLLECTION).limit(200).get(),
      db.collection(LINK_COLLECTION).limit(200).get()
    ]);
    const claims = (result.data || [])
      .filter((item) => item.status !== 'retired')
      .map((item) => ({
        id: item._id || item.id || '',
        storyId: item.storyId || '',
        storyVersion: Math.max(1, Number(item.storyVersion) || 1),
        resourceId: item.resourceId || '',
        chapterIndex: Math.max(0, Number(item.chapterIndex) || 0),
        claimText: cleanText(item.claimText, 360),
        sourceLinkIds: Array.isArray(item.sourceLinkIds) ? item.sourceLinkIds : [],
        status: ACTIVE_STATUSES.has(item.status) ? item.status : 'needs_evidence'
      }));
    const confirmedLinks = (linkResult.data || []).filter((item) => item.status === 'confirmed');
    const sources = [];
    for (const link of confirmedLinks) {
      let submission = null;
      try {
        submission = firstDocument(await db.collection(SUBMISSION_COLLECTION).doc(link.submissionId || '').get());
      } catch (_) {}
      if (!submission || submission.status !== 'approved') continue;
      sources.push({
        id: link._id || link.id || '',
        resourceId: link.resourceId || '',
        label: cleanText(submission.title || submission.description || '社区投稿', 120),
        evidenceSummary: cleanText(link.evidenceSummary, 240)
      });
    }
    return { ok: true, action: 'getStoryClaimWorkspace', claims, sources, count: claims.length };
  }

  async function save(event, reviewerId) {
    const input = normalizeClaimInput(event);
    const story = firstDocument(await db.collection(STORY_COLLECTION).doc(input.storyId).get());
    if (!story || !['draft', 'published'].includes(story.status)) {
      throw Object.assign(new Error('故事不存在或已经归档'), { code: 'STORY_NOT_ACTIVE' });
    }
    const chapters = Array.isArray(story.chapters) ? story.chapters : [];
    const chapter = chapters[input.chapterIndex];
    if (!chapter || !cleanText(chapter.body, 1800).includes(input.claimText)) {
      throw Object.assign(new Error('事实原句必须完整出现在所选章节正文中'), { code: 'CLAIM_NOT_IN_CHAPTER' });
    }
    const chapterSourceIds = new Set(Array.isArray(chapter.sourceLinkIds) ? chapter.sourceLinkIds : []);
    if (input.sourceLinkIds.some((id) => !chapterSourceIds.has(id))) {
      throw Object.assign(new Error('事实依据必须来自该章节已经确认的来源'), { code: 'CLAIM_SOURCE_NOT_IN_CHAPTER' });
    }
    const linkStates = await Promise.all(input.sourceLinkIds.map(async (linkId) => ({
      linkId,
      link: firstDocument(await db.collection(LINK_COLLECTION).doc(linkId).get())
    })));
    if (linkStates.some(({ link }) => !link || link.status !== 'confirmed' || link.resourceId !== story.resourceId)) {
      throw Object.assign(new Error('事实引用了失效或不属于该资源的链迹'), { code: 'INVALID_CLAIM_SOURCE' });
    }
    const submissions = await Promise.all(linkStates.map(({ link }) => (
      db.collection(SUBMISSION_COLLECTION).doc(link.submissionId || '').get().then(firstDocument)
    )));
    if (submissions.some((submission) => !submission || submission.status !== 'approved')) {
      throw Object.assign(new Error('事实引用的投稿已不再公开'), { code: 'INVALID_CLAIM_SUBMISSION' });
    }
    const storyVersion = Math.max(1, Number(story.version) || 1);
    const claimId = claimIdFor(input.storyId, storyVersion, input.chapterIndex, input.claimText);
    const now = db.serverDate();
    const payload = {
      storyId: input.storyId,
      storyVersion,
      resourceId: story.resourceId || '',
      chapterIndex: input.chapterIndex,
      claimText: input.claimText,
      sourceLinkIds: input.sourceLinkIds,
      status: input.status,
      reviewedBy: reviewerId,
      reviewedAt: now,
      updatedAt: now
    };
    const existing = firstDocument(await db.collection(CLAIM_COLLECTION).doc(claimId).get());
    if (existing) await db.collection(CLAIM_COLLECTION).doc(claimId).update(payload);
    else await db.collection(CLAIM_COLLECTION).doc(claimId).set({ ...payload, createdAt: now });
    await db.collection(CLAIM_LOG_COLLECTION).add({
      claimId,
      storyId: input.storyId,
      resourceId: story.resourceId || '',
      action: existing ? 'update' : 'create',
      status: input.status,
      sourceLinkIds: input.sourceLinkIds,
      reviewerId,
      createdAt: now
    });
    return { ok: true, action: 'saveStoryClaim', claimId, status: input.status };
  }

  async function retire(event, reviewerId) {
    const claimId = cleanId(event.claimId, '事实依据');
    const reason = cleanText(event.reason, 300);
    if (reason.length < 4) {
      throw Object.assign(new Error('请填写至少 4 个字的停用原因'), { code: 'CLAIM_RETIRE_REASON_REQUIRED' });
    }
    const claim = firstDocument(await db.collection(CLAIM_COLLECTION).doc(claimId).get());
    if (!claim || claim.status === 'retired') {
      throw Object.assign(new Error('事实依据不存在或已经停用'), { code: 'CLAIM_NOT_ACTIVE' });
    }
    const now = db.serverDate();
    await db.collection(CLAIM_COLLECTION).doc(claimId).update({
      status: 'retired',
      retireReason: reason,
      retiredBy: reviewerId,
      retiredAt: now,
      updatedAt: now
    });
    await db.collection(CLAIM_LOG_COLLECTION).add({
      claimId,
      storyId: claim.storyId || '',
      resourceId: claim.resourceId || '',
      action: 'retire',
      reason,
      reviewerId,
      createdAt: now
    });
    return { ok: true, action: 'retireStoryClaim', claimId, status: 'retired' };
  }

  return { workspace, save, retire };
}

module.exports = {
  CLAIM_COLLECTION,
  CLAIM_LOG_COLLECTION,
  claimIdFor,
  normalizeClaimInput,
  createAdminStoryClaimService
};
