'use strict';

const QUALITY_VERSION = 'story-quality-v2';
const GENERATION_THRESHOLD = 55;
const PUBLICATION_THRESHOLD = 70;
const GENERIC_PHRASES = ['穿越千年', '文化瑰宝', '历史长河', '诉说着古老故事', '见证了时代变迁', '承载着深厚底蕴', '熠熠生辉', '源远流长'];
const SENSITIVE_PATTERNS = [/(?<!\d)1[3-9]\d{9}(?!\d)/g, /(?<!\d)\d{17}[\dXx](?!\d)/g, /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi];
function cleanText(value, maxLength = 5000) { return String(value == null ? '' : value).trim().slice(0, maxLength); }
function clamp(value, minimum = 0, maximum = 100) { return Math.max(minimum, Math.min(maximum, Math.round(Number(value) || 0))); }
function unique(values) { return [...new Set(values.filter(Boolean))]; }
function gradeFor(score, hardFailures) {
  if (hardFailures.length || score < GENERATION_THRESHOLD) return 'blocked';
  if (score < PUBLICATION_THRESHOLD) return 'preview';
  if (score < 85) return 'reviewable';
  return 'strong';
}
function factualTokens(value) {
  const text = cleanText(value, 12000);
  return unique([...(text.match(/(?:公元前)?\d{2,4}年/g) || []), ...(text.match(/\d+(?:\.\d+)?(?:米|公里|千米|件|座|处|次|人|岁)/g) || [])]).slice(0, 20);
}
function repeatedSentences(value) {
  const normalized = cleanText(value, 12000).split(/[。！？!?\n]+/).map((item) => item.replace(/[，、；：:“”‘’\s]/g, '').trim()).filter((item) => item.length >= 8);
  return normalized.filter((item, index) => normalized.indexOf(item) !== index);
}
function assessStoryQuality(story, context = {}) {
  const title = cleanText(story && story.title, 60);
  const introduction = cleanText(story && story.introduction, 300);
  const closing = cleanText(story && story.closing, 300);
  const chapters = (Array.isArray(story && story.chapters) ? story.chapters : []).slice(0, 4).map((item) => ({
    title: cleanText(item && item.title, 60),
    body: cleanText(item && item.body, 1200),
    sourceLinkIds: unique((Array.isArray(item && item.sourceLinkIds) ? item.sourceLinkIds : []).map((id) => cleanText(id, 128)))
  }));
  const allowed = new Set(Array.isArray(context.allowedSourceIds) ? context.allowedSourceIds : []);
  const hardFailures = [];
  const warnings = [];
  if (title.length < 4 || introduction.length < 12 || !chapters.length) hardFailures.push('story_structure_incomplete');
  if (chapters.some((chapter) => chapter.title.length < 2 || chapter.body.length < 12)) hardFailures.push('chapter_text_incomplete');
  if (chapters.some((chapter) => !chapter.sourceLinkIds.length)) hardFailures.push('chapter_source_missing');
  if (chapters.some((chapter) => chapter.sourceLinkIds.some((id) => allowed.size && !allowed.has(id)))) hardFailures.push('unknown_source_reference');
  const fullText = [title, introduction, ...chapters.flatMap((chapter) => [chapter.title, chapter.body]), closing].join('\n');
  if (SENSITIVE_PATTERNS.some((pattern) => { pattern.lastIndex = 0; return pattern.test(fullText); })) hardFailures.push('sensitive_information_detected');
  const genericHits = GENERIC_PHRASES.filter((phrase) => fullText.includes(phrase));
  if (genericHits.length) warnings.push('减少空泛表达：' + genericHits.slice(0, 3).join('、'));
  if (repeatedSentences(fullText).length) warnings.push('存在重复或近似重复的句子');
  if (chapters.some((chapter) => chapter.body.length < 40)) warnings.push('部分正文过短，缺少可感知的现场细节');
  const unsupportedTokens = [];
  chapters.forEach((chapter) => {
    const citedText = chapter.sourceLinkIds.map((id) => cleanText(context.sourceTextById && context.sourceTextById[id], 5000)).join('\n');
    const evidenceText = cleanText(context.resourceText, 3000) + '\n' + citedText;
    factualTokens(chapter.body).forEach((token) => { if (evidenceText && !evidenceText.includes(token)) unsupportedTokens.push(token); });
  });
  if (unsupportedTokens.length) warnings.push('核对来源中未直接出现的信息：' + unique(unsupportedTokens).slice(0, 4).join('、'));
  const usedSourceIds = unique(chapters.flatMap((chapter) => chapter.sourceLinkIds));
  const totalBodyLength = chapters.reduce((total, chapter) => total + chapter.body.length, 0);
  const metrics = {
    evidence: clamp(30 - (chapters.some((chapter) => !chapter.sourceLinkIds.length) ? 20 : 0) - (usedSourceIds.length < 1 ? 10 : 0), 0, 30),
    specificity: clamp(25 - genericHits.length * 4 - unsupportedTokens.length * 3 - (totalBodyLength < 80 ? 8 : 0), 0, 25),
    traceability: clamp(20 - (hardFailures.includes('unknown_source_reference') ? 20 : 0), 0, 20),
    completeness: clamp(15 - (title.length < 4 ? 5 : 0) - (introduction.length < 20 ? 4 : 0) - (chapters.length < 1 ? 6 : 0), 0, 15),
    style: clamp(10 - genericHits.length * 2 - repeatedSentences(fullText).length * 3, 0, 10)
  };
  const score = Object.values(metrics).reduce((total, value) => total + value, 0);
  const grade = gradeFor(score, hardFailures);
  return { version: QUALITY_VERSION, score, grade, publicationEligible: !hardFailures.length && score >= PUBLICATION_THRESHOLD, metrics, hardFailures: unique(hardFailures), warnings: unique(warnings).slice(0, 5), usedSourceIds, evaluatedAt: new Date().toISOString() };
}
module.exports = { QUALITY_VERSION, GENERATION_THRESHOLD, PUBLICATION_THRESHOLD, GENERIC_PHRASES, assessStoryQuality };
