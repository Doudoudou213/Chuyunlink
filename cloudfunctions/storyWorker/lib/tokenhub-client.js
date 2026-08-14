'use strict';

const https = require('https');
const { ANALYSIS_SCHEMA, validateAnalysis } = require('./contract');

function retryAfterMs(value) {
  const raw = String(value || '').trim();
  if (!raw) return 0;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, Math.min(10000, seconds * 1000));
  const date = new Date(raw).getTime();
  return Number.isFinite(date) ? Math.max(0, Math.min(10000, date - Date.now())) : 0;
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function requestJson(urlValue, options, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlValue);
    const request = https.request(url, {
      method: options.method || 'POST',
      headers: options.headers || {},
      timeout: timeoutMs
    }, (response) => {
      const chunks = [];
      let length = 0;
      response.on('data', (chunk) => {
        length += chunk.length;
        if (length <= 2 * 1024 * 1024) chunks.push(chunk);
      });
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let data = null;
        try { data = text ? JSON.parse(text) : {}; } catch (_) {}
        if (response.statusCode < 200 || response.statusCode >= 300) {
          const providerMessage = data && data.error && data.error.message;
          const error = new Error(String(providerMessage || `模型接口返回 HTTP ${response.statusCode}`).slice(0, 500));
          error.code = `AI_PROVIDER_HTTP_${response.statusCode}`;
          error.retryable = response.statusCode === 429 || response.statusCode >= 500;
          error.retryAfterMs = retryAfterMs(response.headers['retry-after']);
          error.providerRequestId = String(
            response.headers['x-request-id'] || response.headers['x-tcb-request-id'] || data && data.error && data.error.request_id || ''
          ).slice(0, 160);
          reject(error);
          return;
        }
        if (!data) {
          reject(Object.assign(new Error('模型接口没有返回合法 JSON'), { code: 'AI_PROVIDER_INVALID_JSON', retryable: true }));
          return;
        }
        resolve(data);
      });
    });
    request.on('timeout', () => request.destroy(Object.assign(new Error('模型接口请求超时'), { code: 'AI_PROVIDER_TIMEOUT', retryable: true })));
    request.on('error', (error) => reject(Object.assign(error, { code: error.code || 'AI_PROVIDER_NETWORK_ERROR', retryable: true })));
    request.end(body);
  });
}

function parseModelContent(response) {
  const content = response && response.choices && response.choices[0] && response.choices[0].message && response.choices[0].message.content;
  if (content && typeof content === 'object') return content;
  const text = String(content || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  if (!text) throw Object.assign(new Error('模型没有返回结构化内容'), { code: 'AI_EMPTY_OUTPUT' });
  try {
    return JSON.parse(text);
  } catch (_) {
    throw Object.assign(new Error('模型输出无法解析为 JSON'), { code: 'AI_INVALID_JSON_OUTPUT' });
  }
}

function createTokenHubClient({ config, transport = requestJson }) {
  async function analyze(input, hooks = {}) {
    const allowedResources = Array.isArray(input.allowedResources) ? input.allowedResources : [];
    const allowedResourceIds = allowedResources.map((item) => item.id);
    const body = {
      model: config.textModel,
      stream: false,
      temperature: 0.1,
      max_tokens: config.maxOutputTokens,
      thinking: { type: 'disabled' },
      reasoning_effort: 'low',
      messages: [
        {
          role: 'system',
          content: '你是楚韵链迹的文化资料分析助手。你只能从给定资源列表中提出候选关联；无法确定时返回空 candidateLinks。不得虚构历史事实，不得把推测写成确定结论。严格按照 JSON Schema 输出。'
        },
        {
          role: 'user',
          content: JSON.stringify({
            task: '分析投稿并提出候选文化资源关系',
            submission: input.submission,
            allowedResources
          })
        }
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'chulink_story_link_analysis',
          strict: true,
          schema: ANALYSIS_SCHEMA
        }
      }
    };
    const maxAttempts = Math.max(1, Number(config.providerMaxAttempts) || 1);
    let response;
    let providerAttempts = 0;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      providerAttempts = attempt;
      if (typeof hooks.beforeAttempt === 'function') await hooks.beforeAttempt(attempt);
      try {
        response = await transport(`${config.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json',
            'User-Agent': 'ChuLink-StoryWorker/1.1'
          }
        }, JSON.stringify(body), config.requestTimeoutMs);
        break;
      } catch (error) {
        error.providerAttempts = attempt;
        if (!error.retryable || attempt >= maxAttempts) throw error;
        const delayMs = Math.max(
          Number(error.retryAfterMs) || 0,
          Math.min(5000, (Number(config.retryBaseDelayMs) || 1200) * (2 ** (attempt - 1)))
        );
        if (typeof hooks.onRetry === 'function') await hooks.onRetry({ attempt, delayMs, error });
        await wait(delayMs);
      }
    }
    const output = validateAnalysis(parseModelContent(response), allowedResourceIds);
    const usage = response.usage || {};
    return {
      output,
      providerAttempts,
      providerRequestId: String(response.id || '').slice(0, 160),
      usage: {
        inputTokens: Math.max(0, Number(usage.prompt_tokens || usage.input_tokens) || 0),
        outputTokens: Math.max(0, Number(usage.completion_tokens || usage.output_tokens) || 0),
        totalTokens: Math.max(0, Number(usage.total_tokens) || 0)
      }
    };
  }
  return { analyze };
}

module.exports = { createTokenHubClient, parseModelContent, requestJson, retryAfterMs };
