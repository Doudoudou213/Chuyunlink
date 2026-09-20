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

const SECTION_REVISION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    chapter: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string' },
        body: { type: 'string' },
        sourceLinkIds: { type: 'array', items: { type: 'string' } }
      },
      required: ['title', 'body', 'sourceLinkIds']
    },
    revisionSummary: { type: 'string' }
  },
  required: ['chapter', 'revisionSummary']
};

function cleanText(value, maxLength) {
  return String(value == null ? '' : value).trim().slice(0, maxLength);
}

function validateStoryDraft(value, allowedSourceIds) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw Object.assign(new Error('模型返回的故事草稿不是对象'), { code: 'AI_INVALID_STORY_OUTPUT' });
  }
  const allowed = new Set(allowedSourceIds || []);
  const title = cleanText(value.title, 24);
  const introduction = cleanText(value.introduction, 100);
  const closing = cleanText(value.closing, 100);
  if (title.length < 4 || introduction.length < 12) {
    throw Object.assign(new Error('故事标题或导语不完整'), { code: 'AI_INVALID_STORY_OUTPUT' });
  }
  const chapters = (Array.isArray(value.chapters) ? value.chapters : []).slice(0, 2).map((item) => {
    const chapterTitle = cleanText(item && item.title, 24);
    const body = cleanText(item && item.body, 260);
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

function validateSectionRevisionOutput(value, allowedSourceIds, requiredSourceIds = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !value.chapter) {
    throw Object.assign(new Error('模型返回的章节修订不是对象'), { code: 'AI_INVALID_SECTION_OUTPUT' });
  }
  if (Object.keys(value).some((key) => !['chapter', 'revisionSummary'].includes(key))
    || typeof value.chapter !== 'object' || Array.isArray(value.chapter)
    || Object.keys(value.chapter).some((key) => !['title', 'body', 'sourceLinkIds'].includes(key))) {
    throw Object.assign(new Error('章节修订包含了目标章节之外的内容'), { code: 'AI_SECTION_SCOPE_VIOLATION' });
  }
  const allowed = new Set(allowedSourceIds || []);
  const required = [...new Set(requiredSourceIds || [])];
  const chapter = {
    title: cleanText(value.chapter.title, 24),
    body: cleanText(value.chapter.body, 320),
    sourceLinkIds: [...new Set((Array.isArray(value.chapter.sourceLinkIds) ? value.chapter.sourceLinkIds : [])
      .map((sourceId) => cleanText(sourceId, 128)).filter(Boolean))].slice(0, 12)
  };
  const revisionSummary = cleanText(value.revisionSummary, 180);
  if (chapter.title.length < 2 || chapter.body.length < 12 || revisionSummary.length < 8) {
    throw Object.assign(new Error('章节标题、正文或修订说明不完整'), { code: 'AI_INVALID_SECTION_OUTPUT' });
  }
  if (!chapter.sourceLinkIds.length || chapter.sourceLinkIds.some((sourceId) => !allowed.has(sourceId))) {
    throw Object.assign(new Error('章节修订引用了未允许的资料来源'), { code: 'AI_UNKNOWN_SECTION_SOURCE' });
  }
  if (required.some((sourceId) => !chapter.sourceLinkIds.includes(sourceId))) {
    throw Object.assign(new Error('章节修订没有保留本次新增来源'), { code: 'AI_REQUIRED_SECTION_SOURCE_MISSING' });
  }
  return { chapter, revisionSummary };
}

function assembleSectionRevision(parentStory, targetChapterIndex, output) {
  const chapters = (Array.isArray(parentStory && parentStory.chapters) ? parentStory.chapters : []).map((chapter) => ({
    title: cleanText(chapter && chapter.title, 24),
    body: cleanText(chapter && chapter.body, 1200),
    sourceLinkIds: [...new Set((Array.isArray(chapter && chapter.sourceLinkIds) ? chapter.sourceLinkIds : [])
      .map((sourceId) => cleanText(sourceId, 128)).filter(Boolean))]
  }));
  if (!Number.isInteger(targetChapterIndex) || targetChapterIndex < 0 || !chapters[targetChapterIndex]) {
    throw Object.assign(new Error('目标章节不存在'), { code: 'INVALID_REVISION_TARGET' });
  }
  chapters[targetChapterIndex] = {
    title: output.chapter.title,
    body: output.chapter.body,
    sourceLinkIds: [...output.chapter.sourceLinkIds]
  };
  return {
    title: cleanText(parentStory.title, 24),
    introduction: cleanText(parentStory.introduction, 150),
    chapters,
    closing: cleanText(parentStory.closing, 120)
  };
}

module.exports = { STORY_DRAFT_SCHEMA, SECTION_REVISION_SCHEMA, validateStoryDraft, validateSectionRevisionOutput, assembleSectionRevision };
