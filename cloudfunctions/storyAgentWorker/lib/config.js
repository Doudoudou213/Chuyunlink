'use strict';

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.floor(parsed)));
}

function boundedNumber(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
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
    enabled: String(env.AGENT_ENABLED || '').trim().toLowerCase() === 'true',
    shadowMode: String(env.AGENT_SHADOW_MODE || 'true').trim().toLowerCase() === 'true',
    provider,
    baseUrl: normalizeBaseUrl(env.AI_BASE_URL),
    textModel: String(env.AI_TEXT_MODEL || 'hy3').trim().slice(0, 100),
    apiKey: String(env.TOKENHUB_API_KEY || '').trim(),
    requestTimeoutMs: boundedInteger(env.AGENT_REQUEST_TIMEOUT_MS || env.AI_REQUEST_TIMEOUT_MS, 24000, 5000, 45000),
    maxOutputTokens: boundedInteger(env.AGENT_MAX_OUTPUT_TOKENS, 1800, 300, 4000),
    providerMaxAttempts: boundedInteger(env.AGENT_PROVIDER_MAX_ATTEMPTS, 2, 1, 2),
    retryBaseDelayMs: boundedInteger(env.AGENT_RETRY_BASE_DELAY_MS, 1200, 100, 5000),
    dailyCallLimit: boundedInteger(env.AGENT_DAILY_CALL_LIMIT, 20, 1, 500),
    dailyTokenLimit: boundedInteger(env.AGENT_DAILY_TOKEN_LIMIT, 200000, 1000, 10000000),
    maxCallsPerJob: boundedInteger(env.AGENT_MAX_CALLS_PER_JOB, 2, 1, 2),
    lockTimeoutMs: boundedInteger(env.AGENT_JOB_LOCK_TIMEOUT_MS, 120000, 30000, 900000),
    maxInputChars: boundedInteger(env.AGENT_MAX_INPUT_CHARS, 12000, 1000, 30000),
    topResourceLimit: boundedInteger(env.AGENT_TOP_RESOURCE_LIMIT, 12, 3, 20),
    minTextChars: boundedInteger(env.AGENT_MIN_TEXT_CHARS, 16, 8, 200),
    inputPricePerMillion: boundedNumber(env.AGENT_INPUT_PRICE_PER_MILLION, 1, 0, 1000),
    outputPricePerMillion: boundedNumber(env.AGENT_OUTPUT_PRICE_PER_MILLION, 4, 0, 1000),
    promptVersion: 'cultural-research-agent-shadow-v1',
    codeVersion: String(env.AGENT_CODE_VERSION || 'story-agent-code-v1').trim().slice(0, 100)
  };
}

function publicConfig(config) {
  let endpointHost = '';
  try { endpointHost = new URL(config.baseUrl).host; } catch (_) {}
  return {
    enabled: config.enabled === true,
    shadowMode: config.shadowMode === true,
    provider: config.provider,
    endpointHost,
    textModel: config.textModel,
    apiKeyConfigured: Boolean(config.apiKey),
    dailyCallLimit: config.dailyCallLimit,
    dailyTokenLimit: config.dailyTokenLimit,
    maxCallsPerJob: config.maxCallsPerJob,
    maxOutputTokens: config.maxOutputTokens,
    topResourceLimit: config.topResourceLimit,
    promptVersion: config.promptVersion,
    codeVersion: config.codeVersion
  };
}

module.exports = {
  boundedInteger,
  boundedNumber,
  normalizeBaseUrl,
  loadConfig,
  publicConfig
};
