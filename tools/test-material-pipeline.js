'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  PIPELINE_VERSION,
  REAL_OCR_PIPELINE_VERSION,
  CONSENT_VERSION,
  CONSENT_SCOPE,
  sourceFingerprint,
  jobIdFor,
  analysisIdFor,
  isEligibleImageSubmission,
  createMockExtraction,
  normalizeReviewText
} = require('../cloudfunctions/materialWorker/lib/material-contract');
const { loadConfig, isRealOcrReady, publicConfig } = require('../cloudfunctions/materialWorker/lib/config');
const { redactSensitiveText } = require('../cloudfunctions/materialWorker/lib/privacy');
const { buildExtraction, createTencentOcrClient } = require('../cloudfunctions/materialWorker/lib/tencent-ocr-client');

const projectRoot = path.resolve(__dirname, '..');
function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

async function main() {
  const source = {
    sourceType: 'submission',
    sourceId: 'submission-test-1',
    fileID: 'cloud://test-env/submissions/user/test.jpg',
    mimeType: 'image/jpeg',
    size: 2048,
    title: '测试图片',
    description: '仅用于本地结构测试。'
  };
  assert.equal(sourceFingerprint(source), sourceFingerprint({ ...source }));
  assert.equal(jobIdFor(source), jobIdFor({ ...source }));
  assert.notEqual(jobIdFor(source), jobIdFor({ ...source, size: 2049 }));
  assert.match(jobIdFor(source), /^material_job_[a-f0-9]{40}$/);
  assert.match(analysisIdFor(jobIdFor(source)), /^material_analysis_[a-f0-9]{40}$/);

  const eligible = {
    status: 'approved',
    assetType: 'image',
    imageFileID: source.fileID,
    materialAnalysisConsent: true,
    materialConsentVersion: CONSENT_VERSION,
    materialConsentScope: CONSENT_SCOPE
  };
  assert.equal(isEligibleImageSubmission(eligible), true);
  assert.equal(isEligibleImageSubmission({ ...eligible, status: 'pending' }), false);
  assert.equal(isEligibleImageSubmission({ ...eligible, materialAnalysisConsent: false }), false);
  assert.equal(isEligibleImageSubmission({ ...eligible, materialConsentVersion: 'legacy-consent' }), false);
  assert.equal(isEligibleImageSubmission({ ...eligible, assetType: 'audio' }), false);

  const extraction = createMockExtraction(source);
  assert.equal(extraction.simulated, true);
  assert.equal(extraction.provider, 'mock');
  assert.match(extraction.extractedText, /非真实 OCR/);
  assert.deepEqual(extraction.quality.flags, ['synthetic_result']);
  assert.equal(normalizeReviewText('  人工校对结果  '), '人工校对结果');
  assert.throws(() => normalizeReviewText('   '), (error) => error && error.code === 'REVIEW_TEXT_REQUIRED');

  const safeConfig = loadConfig({
    MATERIAL_PROVIDER: 'tencent_ocr',
    MATERIAL_MODE: 'mock_only',
    MATERIAL_REAL_OCR_ENABLED: 'false'
  });
  assert.equal(isRealOcrReady(safeConfig), false);
  const secret = 'test-secret-never-commit';
  const readyConfig = loadConfig({
    MATERIAL_PROVIDER: 'tencent_ocr',
    MATERIAL_MODE: 'real_ocr',
    MATERIAL_REAL_OCR_ENABLED: 'true',
    TENCENT_OCR_SECRET_ID: 'test-secret-id',
    TENCENT_OCR_SECRET_KEY: secret,
    MATERIAL_OCR_MAX_ATTEMPTS: '2'
  });
  assert.equal(isRealOcrReady(readyConfig), true);
  assert.equal(publicConfig(readyConfig).credentialsConfigured, true);
  assert.equal(JSON.stringify(publicConfig(readyConfig)).includes(secret), false);

  const redacted = redactSensitiveText('联系 13800138000，邮箱 test@example.com，证件 420106199001011234。');
  assert.equal(redacted.text.includes('13800138000'), false);
  assert.equal(redacted.text.includes('test@example.com'), false);
  assert.equal(redacted.text.includes('420106199001011234'), false);
  assert.deepEqual(redacted.flags.sort(), ['email_address', 'mainland_id_number', 'mainland_mobile'].sort());

  const providerResult = buildExtraction({
    TextDetections: [
      { DetectedText: '碑刻记录', Confidence: 96, ItemPolygon: { X: 10, Y: 20, Width: 100, Height: 30 } },
      { DetectedText: '联系 13800138000', Confidence: 88, ItemPolygon: { X: 10, Y: 60, Width: 160, Height: 30 } }
    ],
    RequestId: 'request-test-1'
  });
  assert.equal(providerResult.simulated, false);
  assert.equal(providerResult.extractedText.includes('13800138000'), false);
  assert.equal(providerResult.privacy.redacted, true);
  assert.equal(providerResult.blocks.length, 2);
  assert.equal(providerResult.quality.detectedLineCount, 2);

  let calls = 0;
  let reservedCalls = 0;
  let observedParams;
  const client = createTencentOcrClient({
    config: readyConfig,
    transport: async (params) => {
      calls += 1;
      observedParams = params;
      if (calls === 1) throw Object.assign(new Error('temporary timeout'), { code: 'RequestLimitExceeded' });
      return { TextDetections: [{ DetectedText: '重试成功', Confidence: 99 }], RequestId: 'request-test-2' };
    }
  });
  const recognized = await client.recognizeImage('https://example.com/signed-image.jpg?token=hidden', {
    beforeAttempt: async () => { reservedCalls += 1; }
  });
  assert.equal(recognized.providerAttempts, 2);
  assert.equal(reservedCalls, 2);
  assert.equal(recognized.extraction.extractedText, '重试成功');
  assert.equal(observedParams.LanguageType, 'zh');
  assert.equal(Object.hasOwn(observedParams, 'ImageBase64'), false);
  await assert.rejects(() => client.recognizeImage('http://example.com/image.jpg'), (error) => error && error.code === 'INVALID_OCR_IMAGE_URL');

  const config = JSON.parse(read('cloudbaserc.json'));
  const worker = config.functions.find((item) => item.name === 'materialWorker');
  assert.ok(worker, 'cloudbaserc.json 必须注册 materialWorker');
  assert.equal(worker.envVariables.MATERIAL_MODE, 'mock_only');
  assert.equal(worker.envVariables.MATERIAL_REAL_OCR_ENABLED, 'false');
  assert.equal(Object.hasOwn(worker.envVariables, 'TENCENT_OCR_SECRET_ID'), false);
  assert.equal(Object.hasOwn(worker.envVariables, 'TENCENT_OCR_SECRET_KEY'), false);

  const workerSource = read('cloudfunctions/materialWorker/index.js');
  assert.match(workerSource, /requireAdmin/);
  assert.match(workerSource, /usableForStory:\s*false/);
  assert.match(workerSource, /isEligibleImageSubmission/);
  assert.match(workerSource, /runRealImageAnalysis/);
  assert.match(workerSource, /reserveDailyCall/);
  assert.match(workerSource, /beforeAttempt:\s*\(\)\s*=>\s*reserveDailyCall/);
  assert.match(workerSource, /maxAge:\s*600/);
  assert.doesNotMatch(workerSource, /TOKENHUB_API_KEY|OCR_API_KEY|SECRET_KEY/);
  const contractSource = read('cloudfunctions/materialWorker/lib/material-contract.js');
  assert.match(contractSource, /materialAnalysisConsent\s*===\s*true/);
  assert.match(contractSource, new RegExp(REAL_OCR_PIPELINE_VERSION));

  const appCore = read('cloudfunctions/appCore/index.js');
  assert.match(appCore, /materialConsentVersion:\s*materialAnalysisConsent\s*\?\s*'multimodal-material-consent-v1'/);
  const userHtml = read('index.html');
  assert.match(userHtml, /id="collect-material-consent"/);
  assert.match(userHtml, /不会自动公开/);
  const adminHtml = read('admin.html');
  assert.match(adminHtml, /MATERIAL_FUNCTION_NAME\s*=\s*"materialWorker"/);
  assert.match(adminHtml, /data-material-synthetic-test/);
  assert.match(adminHtml, /不会进入正式链迹故事/);
  assert.match(adminHtml, /data-material-real-start/);
  const deployScript = read('tools/deploy-cloudbase.ps1');
  assert.match(deployScript, /fn', 'deploy', 'materialWorker'/);
  assert.match(deployScript, /fn', 'code', 'update', 'materialWorker'/);

  console.log(`Material pipeline tests passed (${PIPELINE_VERSION} + ${REAL_OCR_PIPELINE_VERSION}, consent, redaction, retry, quota and human review boundaries).`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
