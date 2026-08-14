'use strict';

const STORY_DRAFT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    introduction: { type: 'string' },
    chapters: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          body: { type: 'string' },
          sourceLinkIds: { type: 'array', items: { type: 'string' } }
        },
        required: ['title', 'body', 'sourceLinkIds']
      }
    },
    closing: { type: 'string' }
  },
  required: ['title', 'introduction', 'chapters', 'closing']
};

function cleanText(value, maxLength) {
  return String(value == null ? '' : value).trim().slice(0, maxLength);
}

function validateStoryDraft(value, allowedSourceIds) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw Object.assign(new Error('模型返回的故事草稿不是对象'), { code: 'AI_INVALID_STORY_OUTPUT' });
  }
  const allowed = new Set(allowedSourceIds || []);
  const title = cleanText(value.title, 100);
  const introduction = cleanText(value.introduction, 800);
  const closing = cleanText(value.closing, 600);
  if (title.length < 4 || introduction.length < 12) {
    throw Object.assign(new Error('故事标题或导语不完整'), { code: 'AI_INVALID_STORY_OUTPUT' });
  }
  const chapters = (Array.isArray(value.chapters) ? value.chapters : []).slice(0, 8).map((item) => {
    const chapterTitle = cleanText(item && item.title, 100);
    const body = cleanText(item && item.body, 1800);
    const sourceLinkIds = [...new Set((Array.isArray(item && item.sourceLinkIds) ? item.sourceLinkIds : [])
      .map((id) => cleanText(id, 128))
      .filter(Boolean))].slice(0, 12);
    if (chapterTitle.length < 2 || body.length < 12 || !sourceLinkIds.length) {
      throw Object.assign(new Error('故事章节缺少标题、正文或资料来源'), { code: 'AI_INVALID_STORY_OUTPUT' });
    }
    if (sourceLinkIds.some((id) => !allowed.has(id))) {
      throw Object.assign(new Error('故事草稿引用了未确认的资料来源'), { code: 'AI_UNKNOWN_STORY_SOURCE' });
    }
    return { title: chapterTitle, body, sourceLinkIds };
  });
  if (!chapters.length) {
    throw Object.assign(new Error('故事草稿没有可发布章节'), { code: 'AI_INVALID_STORY_OUTPUT' });
  }
  return { title, introduction, chapters, closing };
}

module.exports = { STORY_DRAFT_SCHEMA, validateStoryDraft };
