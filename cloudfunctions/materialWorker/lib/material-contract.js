'use strict';

const crypto = require('node:crypto');

const MOCK_PIPELINE_VERSION = 'material-image-mock-v1';
const REAL_OCR_PIPELINE_VERSION = 'material-image-tencent-ocr-v1';
const PIPELINE_VERSION = MOCK_PIPELINE_VERSION;
const CONSENT_VERSION = 'multimodal-material-consent-v1';
const CONSENT_SCOPE = 'approved_original_file_extraction';
const MAX_REVIEW_TEXT_LENGTH = 5000;

function cleanText(value, maxLength = MAX_REVIEW_TEXT_LENGTH) {
  return String(value == null ? '' : value).trim().slice(0, maxLength);
}

function sourceFingerprint(source) {
  return crypto.createHash('sha256').update(JSON.stringify({
    sourceType: cleanText(source && source.sourceType, 32),
    sourceId: cleanText(source && source.sourceId, 128),
    fileID: cleanText(source && source.fileID, 1000),
    mimeType: cleanText(source && source.mimeType, 120),
    size: Math.max(0, Number(source && source.size) || 0)
  })).digest('hex');
}

function jobIdFor(source, pipelineVersion = PIPELINE_VERSION) {
  const digest = crypto.createHash('sha256')
    .update(`${pipelineVersion}:${sourceFingerprint(source)}`)
    .digest('hex')
    .slice(0, 40);
  return `material_job_${digest}`;
}

function analysisIdFor(jobId) {
  const digest = crypto.createHash('sha256').update(cleanText(jobId, 128)).digest('hex').slice(0, 40);
  return `material_analysis_${digest}`;
}

function isEligibleImageSubmission(submission) {
  return Boolean(
    submission &&
    submission.status === 'approved' &&
    (submission.assetType || 'image') === 'image' &&
    submission.materialAnalysisConsent === true &&
    submission.materialConsentVersion === CONSENT_VERSION &&
    submission.materialConsentScope === CONSENT_SCOPE &&
    String(submission.imageFileID || submission.fileID || '').startsWith('cloud://')
  );
}

function createMockExtraction(source) {
  const title = cleanText(source && source.title, 120) || '虚构材料识别演示';
  const description = cleanText(source && source.description, 1200);
  const extractedText = description
    ? `[流程演示，非真实 OCR] ${description}`
    : `[流程演示，非真实 OCR] ${title}。请在接入真实 OCR 后重新识别，不要把本段当作图片原文。`;
  return {
    kind: 'image_ocr',
    provider: 'mock',
    model: 'deterministic-placeholder-v1',
    simulated: true,
    extractedText,
    blocks: [{
      index: 0,
      text: extractedText,
      confidence: 1,
      boundingBox: null
    }],
    quality: {
      score: description ? 0.75 : 0.45,
      flags: ['synthetic_result', ...(description ? [] : ['description_missing'])]
    },
    privacy: {
      requiresHumanReview: true,
      flags: []
    }
  };
}

function normalizeReviewText(value) {
  const text = cleanText(value, MAX_REVIEW_TEXT_LENGTH);
  if (!text) {
    const error = new Error('确认识别结果前请填写校对后的文字');
    error.code = 'REVIEW_TEXT_REQUIRED';
    throw error;
  }
  return text;
}

module.exports = {
  PIPELINE_VERSION,
  MOCK_PIPELINE_VERSION,
  REAL_OCR_PIPELINE_VERSION,
  CONSENT_VERSION,
  CONSENT_SCOPE,
  MAX_REVIEW_TEXT_LENGTH,
  cleanText,
  sourceFingerprint,
  jobIdFor,
  analysisIdFor,
  isEligibleImageSubmission,
  createMockExtraction,
  normalizeReviewText
};
