'use strict';

const crypto = require('crypto');
const { chapterIdFor, normalize, validateTheme, validLink } = require('./story-themes');

const first = result => Array.isArray(result && result.data) ? result.data[0] || null : result && result.data || null;
const read = async (db, name, key) => first(await db.collection(name).doc(key).get());
const clean = (value, max = 128) => String(value == null ? '' : value).trim().slice(0, max);
const validId = (value, label) => {
  const id = clean(value);
  if (!/^[A-Za-z0-9_-]+$/.test(id))
    throw Object.assign(new Error(label + '编号无效'), { code: 'INVALID_ID' });
  return id;
};
const TYPES = new Set(['source_support', 'oral_history', 'visual_record', 'document_transcription']);
const typeLabel = Object.freeze({ source_support: '资料佐证', oral_history: '口述记录',
  visual_record: '影像记录', document_transcription: '文献转录' });
const contributionIdFor = (themeId, version, chapterId, submissionId) => 'theme_' +
  crypto.createHash('sha256').update(`${themeId}:${version}:${chapterId}:${submissionId}`).digest('hex').slice(0, 32);
const sameIds = (left, right) => JSON.stringify([...(left || [])].sort()) ===
  JSON.stringify([...(right || [])].sort());

async function validatePublished(db, version) {
  const checked = await validateTheme(db, normalize({ ...version,
    relationIds: (version.relations || []).map(item => item.id) }), true);
  for (const old of version.claims || []) {
    const current = checked.claims.get(old.id);
    if (!current || current.claimText !== old.text ||
      !sameIds(current.sourceLinkIds, old.sourceLinkIds))
      throw Object.assign(new Error('专题事实已经变化，请先复核'), { code: 'THEME_CLAIM_CHANGED' });
  }
  for (const old of version.relations || []) {
    const current = checked.relations.find(item => (item._id || item.id) === old.id);
    if (!current || !sameIds(current.evidenceLinkIds, old.evidenceLinkIds))
      throw Object.assign(new Error('专题关系已经变化，请先复核'), { code: 'THEME_RELATION_CHANGED' });
  }
}

function createStoryThemeContributionService({ db }) {
  async function workspace(event) {
    const themeId = validId(event.themeId, '专题');
    const theme = await read(db, 'story_themes', themeId);
    if (!theme || !theme.publishedVersionId || theme.archivedAt)
      throw Object.assign(new Error('专题尚未发布或已归档'), { code: 'THEME_UNAVAILABLE' });
    const version = await read(db, 'story_theme_versions', theme.publishedVersionId);
    if (!version || version.status !== 'published' || version.themeId !== themeId)
      throw Object.assign(new Error('当前专题版本不可用'), { code: 'THEME_VERSION_UNAVAILABLE' });
    let available = theme.needsSourceReview !== true;
    if (available) {
      try { await validatePublished(db, version); }
      catch (_) { available = false; }
    }
    const adopted = await db.collection('story_contributions')
      .where({ themeId, themeVersion: Number(version.version) }).limit(400).get();
    const adoptionById = new Map((adopted.data || []).filter(item => item.type === 'theme_adoption' &&
      Number(item.themeVersion) === Number(version.version))
      .map(item => [item._id || item.id, item]));
    const chapters = [];
    for (const [index, chapter] of (version.chapters || []).entries()) {
      const chapterId = chapterIdFor(themeId, chapter, index);
      const sources = [];
      for (const sourceLinkId of chapter.sourceLinkIds || []) {
        const source = (version.sources || []).find(item => item.id === sourceLinkId);
        if (!source) continue;
        let current;
        try { current = await validLink(db, sourceLinkId, source.resourceId); }
        catch (_) { continue; }
        if (current.submissionId !== source.submissionId) continue;
        const submission = await read(db, 'submissions', current.submissionId);
        const contributionId = contributionIdFor(themeId, version.version, chapterId, current.submissionId);
        const adoption = adoptionById.get(contributionId);
        sources.push({ sourceLinkId, submissionId: current.submissionId,
          title: clean(submission && submission.title, 120) || '社区文化记录',
          summary: current.summary, adopted: Boolean(adoption && adoption.status === 'adopted'),
          retracted: Boolean(adoption && adoption.status === 'retracted'), contributionId });
      }
      chapters.push({ id: chapterId, number: index + 1, title: clean(chapter.title, 100), sources });
    }
    return { ok: true, action: 'getStoryThemeContributionWorkspace', themeId,
      version: version.version, title: clean(version.title, 100),
      available, chapters };
  }

  async function adopt(event, adminUid) {
    const themeId = validId(event.themeId, '专题');
    const chapterId = validId(event.chapterId, '章节');
    const sourceLinkId = validId(event.sourceLinkId, '来源');
    const contributionType = event.contributionType || 'source_support';
    if (!TYPES.has(contributionType))
      throw Object.assign(new Error('请选择有效的贡献类型'), { code: 'INVALID_CONTRIBUTION_TYPE' });
    const resolvesGap = event.resolvesGap === true;
    const gapNote = clean(event.gapNote, 180);
    if (resolvesGap && gapNote.length < 4)
      throw Object.assign(new Error('请写明解决了哪项资料缺口'), { code: 'GAP_NOTE_REQUIRED' });
    return db.runTransaction(async tx => {
      const theme = await read(tx, 'story_themes', themeId);
      if (!theme || theme.archivedAt || theme.needsSourceReview === true ||
        !theme.publishedVersionId || Number(event.themeVersion) !== Number(theme.publishedVersion))
        throw Object.assign(new Error('专题版本已变化，请刷新后再确认'), { code: 'THEME_VERSION_CHANGED' });
      const version = await read(tx, 'story_theme_versions', theme.publishedVersionId);
      if (!version || version.status !== 'published' || version.themeId !== themeId ||
        Number(version.version) !== Number(theme.publishedVersion))
        throw Object.assign(new Error('当前专题版本不可用'), { code: 'THEME_VERSION_UNAVAILABLE' });
      await validatePublished(tx, version);
      const chapterIndex = (version.chapters || []).findIndex((chapter, index) =>
        chapterIdFor(themeId, chapter, index) === chapterId);
      const chapter = version.chapters && version.chapters[chapterIndex];
      const source = (version.sources || []).find(item => item.id === sourceLinkId);
      if (!chapter || !(chapter.sourceLinkIds || []).includes(sourceLinkId) || !source)
        throw Object.assign(new Error('这份投稿不是该章节的已确认来源'), { code: 'THEME_SOURCE_NOT_IN_CHAPTER' });
      const link = await validLink(tx, sourceLinkId, source.resourceId);
      if (link.submissionId !== source.submissionId)
        throw Object.assign(new Error('专题来源已经变化'), { code: 'THEME_SOURCE_CHANGED' });
      const submission = await read(tx, 'submissions', link.submissionId);
      if (!submission || submission.status !== 'approved' || !submission.userId)
        throw Object.assign(new Error('投稿当前不可采用'), { code: 'SUBMISSION_UNAVAILABLE' });
      const contributionId = contributionIdFor(themeId, version.version, chapterId, link.submissionId);
      const existing = await read(tx, 'story_contributions', contributionId);
      if (existing && existing.status === 'adopted') return { ok: true, action: 'adoptStoryThemeContribution',
        contributionId, cached: true };
      if (existing && existing.status !== 'retracted')
        throw Object.assign(new Error('采用记录状态需要管理员复核'), { code: 'CONTRIBUTION_STATE_CHANGED' });
      const adoptedAt = db.serverDate();
      const adoptionCount = existing ? (Number(existing.adoptionCount) || 1) + 1 : 1;
      await tx.collection('story_contributions').doc(contributionId).set({
        id: contributionId, type: 'theme_adoption', status: 'adopted',
        userId: submission.userId, submissionId: link.submissionId, sourceLinkId,
        themeId, themeTitle: clean(version.title, 100), themeVersion: Number(version.version),
        chapterId, chapterIndex, chapterTitle: clean(chapter.title, 100),
        contributionType, resolvesGap, gapNote: resolvesGap ? gapNote : '',
        rewardStatus: 'not_applicable', rewardPointsAwarded: 0,
        adoptedBy: adminUid, adoptedAt, updatedAt: adoptedAt, adoptionCount,
        firstAdoptedAt: existing && existing.firstAdoptedAt ||
          existing && existing.adoptedAt || adoptedAt,
        correctionHistory: existing && existing.correctionHistory || []
      });
      await tx.collection('interaction_notifications').doc('theme_adopted_' + contributionId + '_' + adoptionCount).set({
        userId: submission.userId, type: 'story_contribution_theme_adopted',
        title: '你的材料已被专题采用',
        message: `你的材料被专题《${clean(version.title, 100)}》第 ${chapterIndex + 1} 章采用（${typeLabel[contributionType]}）。`,
        actorName: '内容管理员', targetType: 'theme', targetId: themeId,
        targetTitle: clean(version.title, 100), isRead: false, createdAt: adoptedAt, readAt: null
      });
      if (existing) await tx.collection('story_theme_logs').add({ themeId, themeVersion: Number(version.version),
        action: 'theme_contribution_readopted', contributionId, chapterId,
        sourceLinkId, reviewerId: adminUid, createdAt: adoptedAt });
      return { ok: true, action: 'adoptStoryThemeContribution', contributionId, cached: false };
    });
  }

  async function retract(event, adminUid) {
    const themeId = validId(event.themeId, '专题');
    const contributionId = validId(event.contributionId, '采用记录');
    const reason = clean(event.reason, 180);
    if (reason.length < 4)
      throw Object.assign(new Error('请填写撤销原因'), { code: 'RETRACTION_REASON_REQUIRED' });
    return db.runTransaction(async tx => {
      const record = await read(tx, 'story_contributions', contributionId);
      if (!record || record.type !== 'theme_adoption' || record.themeId !== themeId)
        throw Object.assign(new Error('找不到这条专题采用记录'), { code: 'CONTRIBUTION_NOT_FOUND' });
      if (record.status === 'retracted') return { ok: true, action: 'retractStoryThemeContribution',
        contributionId, cached: true };
      if (record.status !== 'adopted')
        throw Object.assign(new Error('采用记录状态需要管理员复核'), { code: 'CONTRIBUTION_STATE_CHANGED' });
      const correctedAt = db.serverDate();
      const correctionHistory = [...(record.correctionHistory || []),
        { action: 'retracted', reason, reviewerId: adminUid, at: correctedAt }];
      await tx.collection('story_contributions').doc(contributionId).update({
        status: 'retracted', correctionHistory, retractedAt: correctedAt,
        retractedBy: adminUid, retractionReason: reason, updatedAt: correctedAt
      });
      await tx.collection('story_theme_logs').add({ themeId, themeVersion: record.themeVersion,
        action: 'theme_contribution_retracted', contributionId,
        chapterId: record.chapterId, sourceLinkId: record.sourceLinkId,
        reason, reviewerId: adminUid, createdAt: correctedAt });
      await tx.collection('interaction_notifications').doc('theme_retracted_' + contributionId + '_' +
        (Number(record.adoptionCount) || 1)).set({
        userId: record.userId, type: 'story_contribution_theme_retracted',
        title: '专题采用记录已更正',
        message: `专题《${clean(record.themeTitle, 100)}》第 ${Number(record.chapterIndex) + 1} 章的采用记录已更正：${reason}`,
        actorName: '内容管理员', targetType: 'theme', targetId: themeId,
        targetTitle: clean(record.themeTitle, 100), isRead: false,
        createdAt: correctedAt, readAt: null
      });
      return { ok: true, action: 'retractStoryThemeContribution', contributionId, cached: false };
    });
  }
  return { workspace, adopt, retract };
}

module.exports = { createStoryThemeContributionService, contributionIdFor, TYPES };
