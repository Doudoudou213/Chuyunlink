'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const { loadConfig, publicConfig } = require('../cloudfunctions/storyWorker/lib/config');
const { validateAnalysis } = require('../cloudfunctions/storyWorker/lib/contract');
const { createTokenHubClient, parseModelContent } = require('../cloudfunctions/storyWorker/lib/tokenhub-client');

function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

async function main() {
  const secret = 'test-secret-never-commit';
  const config = loadConfig({
    AI_ENABLED: 'true',
    AI_PROVIDER: 'tokenhub',
    AI_BASE_URL: 'https://tokenhub.tencentmaas.com/v1/',
    AI_TEXT_MODEL: 'hy3',
    AI_RETRY_BASE_DELAY_MS: '100',
    TOKENHUB_API_KEY: secret
  });
  assert.equal(config.baseUrl, 'https://tokenhub.tencentmaas.com/v1');
  assert.equal(publicConfig(config).apiKeyConfigured, true);
  assert.equal(JSON.stringify(publicConfig(config)).includes(secret), false);
  assert.throws(() => loadConfig({ AI_BASE_URL: 'http://example.com' }), /HTTPS/);

  const validAnalysis = {
    summary: '仅用于验证结构化输出。',
    entities: {
      places: ['虚构地点'],
      people: [],
      periods: [],
      crafts: [],
      inscriptions: []
    },
    candidateLinks: [{
      resourceId: 'synthetic-b',
      relationType: 'documents_place',
      confidence: 0.82,
      reason: '两条虚构内容共享相同主题。',
      evidence: '虚构证据，不对应真实投稿。'
    }],
    riskFlags: []
  };
  const allowedResourceIds = ['synthetic-a', 'synthetic-b'];
  assert.deepEqual(validateAnalysis(validAnalysis, allowedResourceIds), validAnalysis);
  assert.throws(
    () => validateAnalysis({ ...validAnalysis, candidateLinks: [{ ...validAnalysis.candidateLinks[0], resourceId: 'missing' }] }, allowedResourceIds),
    (error) => error && error.code === 'AI_UNKNOWN_RESOURCE'
  );
  assert.throws(
    () => validateAnalysis({ ...validAnalysis, candidateLinks: [{ ...validAnalysis.candidateLinks[0], confidence: 2 }] }, allowedResourceIds),
    (error) => error && error.code === 'AI_INVALID_CONFIDENCE'
  );

  const fenced = '```json\n' + JSON.stringify(validAnalysis) + '\n```';
  assert.deepEqual(parseModelContent({ choices: [{ message: { content: fenced } }] }), validAnalysis);

  let observedRequest;
  const client = createTokenHubClient({
    config,
    transport: async (url, options, body) => {
      observedRequest = { url, options, body: JSON.parse(body) };
      return {
        choices: [{ message: { content: JSON.stringify(validAnalysis) } }],
        usage: { prompt_tokens: 120, completion_tokens: 80, total_tokens: 200 }
      };
    }
  });
  const response = await client.analyze({
    submission: { title: '虚构测试投稿', description: '不对应真实用户。' },
    allowedResources: allowedResourceIds.map((id) => ({ id, title: id }))
  });
  assert.equal(observedRequest.url, 'https://tokenhub.tencentmaas.com/v1/chat/completions');
  assert.equal(observedRequest.options.headers.Authorization, `Bearer ${secret}`);
  assert.equal(observedRequest.body.response_format.type, 'json_schema');
  assert.deepEqual(
    observedRequest.body.response_format.json_schema.schema.properties.candidateLinks.items.properties.relationType.enum,
    ['documents_feature', 'documents_inscription', 'documents_place', 'documents_oral_history', 'shows_change_over_time', 'supports_story']
  );
  assert.deepEqual(observedRequest.body.thinking, { type: 'disabled' });
  assert.equal(observedRequest.body.reasoning_effort, 'low');
  assert.equal(response.usage.totalTokens, 200);
  assert.equal(response.providerAttempts, 1);
  assert.equal(response.output.candidateLinks[0].relationType, 'documents_place');

  let retryCalls = 0;
  let reservedCalls = 0;
  const retryingClient = createTokenHubClient({
    config,
    transport: async () => {
      retryCalls += 1;
      if (retryCalls === 1) {
        throw Object.assign(new Error('temporary upstream timeout'), {
          code: 'AI_PROVIDER_HTTP_504',
          retryable: true
        });
      }
      return {
        choices: [{ message: { content: JSON.stringify(validAnalysis) } }],
        usage: { total_tokens: 50 }
      };
    }
  });
  const retried = await retryingClient.analyze({
    submission: { title: '虚构重试测试' },
    allowedResources: allowedResourceIds.map((id) => ({ id, title: id }))
  }, {
    beforeAttempt: async () => { reservedCalls += 1; }
  });
  assert.equal(retried.providerAttempts, 2);
  assert.equal(retryCalls, 2);
  assert.equal(reservedCalls, 2);

  let invalidOutputCalls = 0;
  const outputRetryClient = createTokenHubClient({
    config,
    transport: async () => {
      invalidOutputCalls += 1;
      const content = invalidOutputCalls === 1
        ? { ...validAnalysis, candidateLinks: [{ ...validAnalysis.candidateLinks[0], relationType: 'same_theme' }] }
        : validAnalysis;
      return { choices: [{ message: { content: JSON.stringify(content) } }], usage: { total_tokens: 30 } };
    }
  });
  const outputRetried = await outputRetryClient.analyze({
    submission: { title: '虚构关系枚举测试' },
    allowedResources: allowedResourceIds.map((id) => ({ id, title: id }))
  });
  assert.equal(outputRetried.providerAttempts, 2);
  assert.equal(invalidOutputCalls, 2);

  const cloudbaseConfig = JSON.parse(read('cloudbaserc.json'));
  const worker = cloudbaseConfig.functions.find((item) => item.name === 'storyWorker');
  assert.ok(worker, 'cloudbaserc.json 必须注册 storyWorker');
  assert.equal(worker.envVariables.AI_ENABLED, 'false');
  assert.equal(Object.hasOwn(worker.envVariables, 'TOKENHUB_API_KEY'), false);

  const workerSource = read('cloudfunctions/storyWorker/index.js');
  assert.match(workerSource, /requireAdmin/);
  assert.match(workerSource, /synthetic:\s*true/);
  assert.match(workerSource, /beforeAttempt:[\s\S]*reserveDailyCall/);
  assert.doesNotMatch(workerSource, /SUBMISSION_COLLECTION/);

  const userClient = read('static/cloudbase-app.js');
  assert.doesNotMatch(userClient, /TOKENHUB_API_KEY/);
  const adminHtml = read('admin.html');
  assert.match(adminHtml, /AI_FUNCTION_NAME\s*=\s*"storyWorker"/);
  assert.match(adminHtml, /data-ai-synthetic-test/);
  const deployScript = read('tools/deploy-cloudbase.ps1');
  assert.match(deployScript, /fn', 'code', 'update', 'storyWorker'/);
  assert.match(deployScript, /preserving its API key/);

  console.log('AI foundation tests passed (config, contract, TokenHub adapter, synthetic-only boundary, secret boundary).');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
