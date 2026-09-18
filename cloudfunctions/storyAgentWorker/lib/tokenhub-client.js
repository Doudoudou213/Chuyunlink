'use strict';

const https = require('https');
const { AGENT_OUTPUT_SCHEMA, ENTITY_TYPES, RELATION_TYPES, GAP_TYPES, validateAgentOutput } = require('./contract');

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryAfterMs(value) {
  const seconds = Number(String(value || '').trim());
  return Number.isFinite(seconds) ? Math.max(0, Math.min(10000, seconds * 1000)) : 0;
}

function requestJson(urlValue, options, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const request = https.request(new URL(urlValue), {
      method: 'POST', headers: options.headers || {}, timeout: timeoutMs
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
          const error = Object.assign(new Error(String(data && data.error && data.error.message || `模型接口返回 HTTP ${response.statusCode}`).slice(0, 500)), {
            code: `AI_PROVIDER_HTTP_${response.statusCode}`,
            retryable: response.statusCode === 429 || response.statusCode >= 500,
            retryAfterMs: retryAfterMs(response.headers['retry-after'])
          });
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
  try { return JSON.parse(text); } catch (_) {
    throw Object.assign(new Error('模型输出无法解析为 JSON'), { code: 'AI_INVALID_JSON_OUTPUT', retryable: true });
  }
}

function createTokenHubClient({ config, transport = requestJson }) {
  async function analyze(input, hooks = {}) {
    const allowedResourceIds = input.allowedResources.map((item) => item.id);
    const allowedEvidenceIds = input.evidenceLinks.map((item) => item.id);
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
          content: `你是文化资料研究智能体的影子分析器。只允许使用输入中的投稿文字、已发布资源和已确认来源；不得读取图片，不得虚构事实，不得写入正式故事或链迹。实体类型仅限：${ENTITY_TYPES.join(', ')}。关系类型仅限：${RELATION_TYPES.join(', ')}。缺口类型仅限：${GAP_TYPES.join(', ')}。没有来源支撑时必须放入 missingEvidence，不要伪造 evidenceLinkIds。严格按 JSON Schema 输出。`
        },
        {
          role: 'user',
          content: JSON.stringify({
            task: '从已授权投稿文字中提取待管理员复核的实体、关系和资料缺口',
            submission: input.submission,
            allowedResources: input.allowedResources,
            confirmedEvidence: input.evidenceLinks,
            knownEntities: input.knownEntities
          })
        }
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'chulink_research_agent_shadow', strict: true, schema: AGENT_OUTPUT_SCHEMA } }
    };
    const maxAttempts = Math.max(1, Math.min(config.providerMaxAttempts, config.maxCallsPerJob));
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (typeof hooks.beforeAttempt === 'function') await hooks.beforeAttempt(attempt, body);
      try {
        const response = await transport(`${config.baseUrl}/chat/completions`, {
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json',
            'User-Agent': 'ChuLink-ResearchAgent/1.0'
          }
        }, JSON.stringify(body), config.requestTimeoutMs);
        const output = validateAgentOutput(parseModelContent(response), { allowedResourceIds, allowedEvidenceIds });
        const usage = response.usage || {};
        return {
          output,
          providerAttempts: attempt,
          providerRequestId: String(response.id || '').slice(0, 160),
          usage: {
            inputTokens: Math.max(0, Number(usage.prompt_tokens || usage.input_tokens) || 0),
            outputTokens: Math.max(0, Number(usage.completion_tokens || usage.output_tokens) || 0),
            totalTokens: Math.max(0, Number(usage.total_tokens) || 0)
          }
        };
      } catch (error) {
        error.providerAttempts = attempt;
        if (typeof hooks.onAttemptFailure === 'function') await hooks.onAttemptFailure({ attempt, error });
        if (!error.retryable || attempt >= maxAttempts) throw error;
        const delayMs = Math.max(Number(error.retryAfterMs) || 0, Math.min(5000, config.retryBaseDelayMs * (2 ** (attempt - 1))));
        if (typeof hooks.onRetry === 'function') await hooks.onRetry({ attempt, delayMs, error });
        await wait(delayMs);
      }
    }
    throw Object.assign(new Error('模型接口未返回可用结果'), { code: 'AI_NO_VALID_RESULT' });
  }
  return { analyze };
}

module.exports = { createTokenHubClient, parseModelContent, requestJson, retryAfterMs };
