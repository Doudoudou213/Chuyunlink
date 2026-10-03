'use strict';

const DEFAULT_MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function cleanText(value, maxLength = 500) {
  return String(value == null ? '' : value).trim().slice(0, maxLength);
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(minimum, Math.min(maximum, Math.floor(parsed)))
    : fallback;
}

function loadConfig(env = process.env) {
  const provider = cleanText(env.MATERIAL_PROVIDER || 'tencent_ocr', 40);
  const mode = cleanText(env.MATERIAL_MODE || 'mock_only', 40);
  const realOcrEnabled = String(env.MATERIAL_REAL_OCR_ENABLED || '').toLowerCase() === 'true';
  const secretId = cleanText(env.TENCENT_OCR_SECRET_ID, 256);
  const secretKey = cleanText(env.TENCENT_OCR_SECRET_KEY, 256);
  return {
    provider,
    mode,
    realOcrEnabled,
    secretId,
    secretKey,
    credentialsConfigured: Boolean(secretId && secretKey),
    region: cleanText(env.TENCENT_OCR_REGION || 'ap-shanghai', 40),
    languageType: cleanText(env.TENCENT_OCR_LANGUAGE || 'zh', 20),
    dailyCallLimit: boundedInteger(env.MATERIAL_DAILY_CALL_LIMIT, 20, 1, 500),
    maxImageBytes: boundedInteger(env.MATERIAL_MAX_IMAGE_BYTES, DEFAULT_MAX_IMAGE_BYTES, 128 * 1024, DEFAULT_MAX_IMAGE_BYTES),
    requestTimeoutSeconds: boundedInteger(env.MATERIAL_OCR_TIMEOUT_SECONDS, 15, 5, 25),
    maxAttempts: boundedInteger(env.MATERIAL_OCR_MAX_ATTEMPTS, 2, 1, 3)
  };
}

function isRealOcrReady(config) {
  return Boolean(
    config &&
    config.mode === 'real_ocr' &&
    config.provider === 'tencent_ocr' &&
    config.realOcrEnabled === true &&
    config.credentialsConfigured === true
  );
}

function publicConfig(config) {
  return {
    provider: config.provider,
    mode: config.mode,
    realOcrEnabled: config.realOcrEnabled,
    credentialsConfigured: config.credentialsConfigured,
    realOcrReady: isRealOcrReady(config),
    region: config.region,
    languageType: config.languageType,
    dailyCallLimit: config.dailyCallLimit,
    maxImageBytes: config.maxImageBytes,
    requestTimeoutSeconds: config.requestTimeoutSeconds,
    maxAttempts: config.maxAttempts
  };
}

module.exports = {
  DEFAULT_MAX_IMAGE_BYTES,
  loadConfig,
  isRealOcrReady,
  publicConfig
};
