'use strict';

function positiveInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.floor(parsed)));
}

function normalizeBaseUrl(value) {
  const raw = String(value || 'https://tokenhub.tencentmaas.com/v1').trim().replace(/\/+$/, '');
  let url;
  try {
    url = new URL(raw);
  } catch (_) {
    throw Object.assign(new Error('AI_BASE_URL 格式不正确'), { code: 'INVALID_AI_BASE_URL' });
  }
  if (url.protocol !== 'https:') {
    throw Object.assign(new Error('AI_BASE_URL 必须使用 HTTPS'), { code: 'INSECURE_AI_BASE_URL' });
  }
  return url.toString().replace(/\/$/, '');
}

function loadConfig(env = process.env) {
  const provider = String(env.AI_PROVIDER || 'tokenhub').trim().toLowerCase();
  if (!/^[a-z0-9_-]{2,32}$/.test(provider)) {
    throw Object.assign(new Error('AI_PROVIDER 格式不正确'), { code: 'INVALID_AI_PROVIDER' });
  }
  return {
    enabled: String(env.AI_ENABLED || '').trim().toLowerCase() === 'true',
    provider,
    baseUrl: normalizeBaseUrl(env.AI_BASE_URL),
    textModel: String(env.AI_TEXT_MODEL || 'hy3').trim().slice(0, 100),
    apiKey: String(env.TOKENHUB_API_KEY || '').trim(),
    requestTimeoutMs: positiveInteger(env.AI_REQUEST_TIMEOUT_MS, 24000, 5000, 45000),
    maxOutputTokens: positiveInteger(env.AI_MAX_OUTPUT_TOKENS, 1800, 200, 8000),
    providerMaxAttempts: positiveInteger(env.AI_PROVIDER_MAX_ATTEMPTS, 2, 1, 3),
    retryBaseDelayMs: positiveInteger(env.AI_RETRY_BASE_DELAY_MS, 1200, 100, 5000),
    dailyCallLimit: positiveInteger(env.AI_DAILY_CALL_LIMIT, 20, 1, 10000),
    dailyTokenLimit: positiveInteger(env.AI_DAILY_TOKEN_LIMIT, 200000, 1000, 100000000),
    maxAttempts: positiveInteger(env.AI_JOB_MAX_ATTEMPTS, 2, 1, 5),
    lockTimeoutMs: positiveInteger(env.AI_JOB_LOCK_TIMEOUT_MS, 120000, 30000, 900000),
    promptVersion: 'story-link-contract-v3'
  };
}

function publicConfig(config) {
  let endpointHost = '';
  try { endpointHost = new URL(config.baseUrl).host; } catch (_) {}
  return {
    enabled: Boolean(config.enabled),
    provider: config.provider,
    endpointHost,
    textModel: config.textModel,
    apiKeyConfigured: Boolean(config.apiKey),
    requestTimeoutMs: config.requestTimeoutMs,
    maxOutputTokens: config.maxOutputTokens,
    providerMaxAttempts: config.providerMaxAttempts,
    dailyCallLimit: config.dailyCallLimit,
    dailyTokenLimit: config.dailyTokenLimit,
    maxAttempts: config.maxAttempts,
    promptVersion: config.promptVersion
  };
}

module.exports = { loadConfig, normalizeBaseUrl, positiveInteger, publicConfig };
