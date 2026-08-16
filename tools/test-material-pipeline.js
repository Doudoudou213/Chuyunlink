'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  PIPELINE_VERSION,
  CONSENT_VERSION,
  CONSENT_SCOPE,
  sourceFingerprint,
  jobIdFor,
  analysisIdFor,
  isEligibleImageSubmission,
  createMockExtraction,
  normalizeReviewText
} = require('../cloudfunctions/materialWorker/lib/material-contract');

const projectRoot = path.resolve(__dirname, '..');
function read(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');
}

function main() {
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

  const config = JSON.parse(read('cloudbaserc.json'));
  const worker = config.functions.find((item) => item.name === 'materialWorker');
  assert.ok(worker, 'cloudbaserc.json 必须注册 materialWorker');
  assert.equal(worker.envVariables.MATERIAL_MODE, 'mock_only');
  assert.equal(Object.hasOwn(worker.envVariables, 'OCR_API_KEY'), false);

  const workerSource = read('cloudfunctions/materialWorker/index.js');
  assert.match(workerSource, /requireAdmin/);
  assert.match(workerSource, /usableForStory:\s*false/);
  assert.match(workerSource, /isEligibleImageSubmission/);
  assert.doesNotMatch(workerSource, /TOKENHUB_API_KEY|OCR_API_KEY|SECRET_KEY/);
  const contractSource = read('cloudfunctions/materialWorker/lib/material-contract.js');
  assert.match(contractSource, /materialAnalysisConsent\s*===\s*true/);

  const appCore = read('cloudfunctions/appCore/index.js');
  assert.match(appCore, /materialConsentVersion:\s*materialAnalysisConsent\s*\?\s*'multimodal-material-consent-v1'/);
  const userHtml = read('index.html');
  assert.match(userHtml, /id="collect-material-consent"/);
  assert.match(userHtml, /不会自动公开/);
  const adminHtml = read('admin.html');
  assert.match(adminHtml, /MATERIAL_FUNCTION_NAME\s*=\s*"materialWorker"/);
  assert.match(adminHtml, /data-material-synthetic-test/);
  assert.match(adminHtml, /不会进入正式链迹故事/);
  const deployScript = read('tools/deploy-cloudbase.ps1');
  assert.match(deployScript, /fn', 'deploy', 'materialWorker'/);
  assert.match(deployScript, /fn', 'code', 'update', 'materialWorker'/);

  console.log(`Material pipeline tests passed (${PIPELINE_VERSION}, explicit consent, idempotency, mock-only story boundary).`);
}

main();
