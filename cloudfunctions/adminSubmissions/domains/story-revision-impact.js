'use strict';

const STORY_COLLECTION = 'story_chains';
const LINK_COLLECTION = 'story_evidence_links';
const SUBMISSION_COLLECTION = 'submissions';

const RELATION_LABELS = {
  documents_feature: '建筑与工艺记录',
  documents_inscription: '题刻与文字记录',
  documents_place: '地点现状记录',
  documents_oral_history: '口述与回忆',
  shows_change_over_time: '时间变化见证',
  supports_story: '故事线索补充'
};

const RELATION_KEYWORDS = {
  documents_feature: ['工艺', '结构', '构件', '纹样', '建筑', '雕刻', '榫卯'],
  documents_inscription: ['题刻', '碑文', '铭文', '文字', '落款', '书法', '年代'],
  documents_place: ['地点', '位置', '现场', '现状', '空间', '环境'],
  documents_oral_history: ['口述', '回忆', '传说', '访谈', '讲述', '传承'],
  shows_change_over_time: ['变化', '修缮', '修复', '改建', '迁移', '旧貌', '年代'],
  supports_story: []
};

function cleanText(value, maxLength) {
  return String(value == null ? '' : value).trim().slice(0, maxLength);
}

function firstDocument(result) {
  if (!result) return null;
  if (Array.isArray(result.data)) return result.data[0] || null;
  return result.data || null;
}

function dateMs(value) {
  if (!value) return 0;
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  if (Number.isFinite(Number(value.$date))) return Number(value.$date);
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function materialFreshness(link, submission, publishedAt, sourceAlreadyUsed) {
  if (!sourceAlreadyUsed) return 'new_source';
  const publishedMs = dateMs(publishedAt);
  if (!publishedMs) return '';
  const supplementMs = Math.max(0, ...(Array.isArray(submission && submission.approvedSupplements)
    ? submission.approvedSupplements.map((item) => dateMs(item && item.approvedAt))
    : []));
  const materialMs = Math.max(dateMs(submission && submission.storyMaterialUpdatedAt), supplementMs);
  if (materialMs > publishedMs) return 'updated_material';
  if (dateMs(link && (link.updatedAt || link.reviewedAt)) > publishedMs) return 'updated_relation';
  return '';
}

function suggestImpactedChapter({ chapters, link, linkById, submission }) {
  const safeChapters = Array.isArray(chapters) ? chapters : [];
  if (!safeChapters.length) return { chapterIndex: null, confidence: 'none', reason: '故事还没有可定位的章节。' };
  const relationType = link && link.relationType || 'supports_story';
  const relationLabel = RELATION_LABELS[relationType] || RELATION_LABELS.supports_story;
  const sourceText = [link && link.evidenceSummary, submission && submission.title, submission && submission.description]
    .map((value) => cleanText(value, 600)).filter(Boolean).join(' ');
  const keywords = RELATION_KEYWORDS[relationType] || [];
  const scored = safeChapters.map((chapter, chapterIndex) => {
    const chapterText = `${cleanText(chapter && chapter.title, 80)} ${cleanText(chapter && chapter.body, 800)}`;
    const existingRelations = new Set((Array.isArray(chapter && chapter.sourceLinkIds) ? chapter.sourceLinkIds : [])
      .map((id) => linkById.get(id) && linkById.get(id).relationType).filter(Boolean));
    const relationMatched = existingRelations.has(relationType);
    const matchedKeywords = keywords.filter((keyword) => sourceText.includes(keyword) && chapterText.includes(keyword));
    const titleMatches = matchedKeywords.filter((keyword) => cleanText(chapter && chapter.title, 80).includes(keyword)).length;
    return {
      chapterIndex,
      score: (relationMatched ? 5 : 0) + matchedKeywords.length + titleMatches,
      relationMatched,
      matchedKeywords
    };
  }).sort((left, right) => right.score - left.score || left.chapterIndex - right.chapterIndex);
  const best = scored[0];
  if (best.score <= 0 && safeChapters.length === 1) {
    return { chapterIndex: 0, confidence: 'low', reason: '当前故事只有一个章节，建议从该章开始人工核对。' };
  }
  if (best.score <= 0) {
    return { chapterIndex: null, confidence: 'none', reason: '暂时无法可靠定位章节，请管理员人工选择。' };
  }
  const reasons = [];
  if (best.relationMatched) reasons.push(`与本章现有“${relationLabel}”资料同类`);
  if (best.matchedKeywords.length) reasons.push(`共同出现“${best.matchedKeywords.slice(0, 3).join('、')}”`);
  return {
    chapterIndex: best.chapterIndex,
    confidence: best.score >= 6 ? 'high' : 'medium',
    reason: `${reasons.join('，')}；建议先核对第 ${best.chapterIndex + 1} 章。`
  };
}

function createStoryRevisionImpactService({ db }) {
  async function workspace() {
    const [storyResult, linkResult] = await Promise.all([
      db.collection(STORY_COLLECTION).limit(100).get(),
      db.collection(LINK_COLLECTION).limit(200).get()
    ]);
    const publishedStories = (storyResult.data || []).filter((item) => item.status === 'published');
    const confirmedLinks = (linkResult.data || []).filter((item) => item.status === 'confirmed');
    const linkById = new Map(confirmedLinks.map((item) => [item._id || item.id || '', item]));
    const submissionCache = new Map();
    async function submissionFor(id) {
      if (!submissionCache.has(id)) {
        const record = firstDocument(await db.collection(SUBMISSION_COLLECTION).doc(id || '').get());
        submissionCache.set(id, record);
      }
      return submissionCache.get(id);
    }
    const stories = [];
    for (const story of publishedStories) {
      const storyId = story._id || story.id || '';
      const usedSourceIds = new Set(Array.isArray(story.sourceLinkIds) ? story.sourceLinkIds : []);
      const resourceLinks = confirmedLinks.filter((link) => link.resourceId === story.resourceId);
      const candidates = [];
      for (const link of resourceLinks) {
        const linkId = link._id || link.id || '';
        const submission = await submissionFor(link.submissionId);
        if (!submission || submission.status !== 'approved') continue;
        const freshness = materialFreshness(link, submission, story.publishedAt, usedSourceIds.has(linkId));
        if (!freshness) continue;
        const suggestion = suggestImpactedChapter({ chapters: story.chapters, link, linkById, submission });
        candidates.push({
          linkId,
          submissionTitle: cleanText(submission.title || submission.description || link.submissionTitle || '社区投稿', 120),
          relationType: link.relationType || 'supports_story',
          relationLabel: RELATION_LABELS[link.relationType] || RELATION_LABELS.supports_story,
          evidenceSummary: cleanText(link.evidenceSummary, 300),
          freshness,
          suggestedChapterIndex: suggestion.chapterIndex,
          suggestedChapterTitle: suggestion.chapterIndex == null ? '' : cleanText(story.chapters[suggestion.chapterIndex] && story.chapters[suggestion.chapterIndex].title, 80),
          confidence: suggestion.confidence,
          reason: suggestion.reason
        });
      }
      if (candidates.length) {
        stories.push({
          storyId,
          resourceId: story.resourceId || '',
          storyVersion: Math.max(1, Number(story.version) || 1),
          candidates: candidates.slice(0, 20)
        });
      }
    }
    return {
      ok: true,
      action: 'getStoryRevisionImpactWorkspace',
      stories,
      counts: {
        affectedStories: stories.length,
        candidateMaterials: stories.reduce((sum, item) => sum + item.candidates.length, 0)
      }
    };
  }

  return { workspace };
}

module.exports = {
  RELATION_LABELS,
  materialFreshness,
  suggestImpactedChapter,
  createStoryRevisionImpactService
};
