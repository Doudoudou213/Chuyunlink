'use strict';

const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function main() {
  const indexHtml = read('index.html');
  const userClient = read('static/cloudbase-app.js');
  const appCore = read('cloudfunctions/appCore/index.js');
  const worker = read('cloudfunctions/storyWorker/index.js');
  const adminService = read('cloudfunctions/adminSubmissions/domains/story-evidence.js');
  const adminFunction = read('cloudfunctions/adminSubmissions/index.js');
  const adminHtml = read('admin.html');

  // Consent is visible, optional, and interpreted strictly on the server.
  assert.match(indexHtml, /id="collect-ai-consent"[^>]*type="checkbox"/);
  assert.doesNotMatch(indexHtml, /id="collect-ai-consent"[^>]*checked/);
  assert.match(userClient, /aiAnalysisConsent:\s*document\.getElementById\('collect-ai-consent'\)\?\.checked === true/);
  assert.match(appCore, /const aiAnalysisConsent = event\.aiAnalysisConsent === true/);
  assert.match(appCore, /aiConsentScope:\s*aiAnalysisConsent \? 'approved_public_submission_text'/);

  // Real analysis is admin-only and re-checks approval + consent immediately before saving.
  assert.match(worker, /const adminUid = requireAdmin\(\)/);
  assert.match(worker, /submission\.status !== 'approved'/);
  assert.match(worker, /submission\.aiAnalysisConsent !== true/);
  assert.match(worker, /latestSubmission\.status !== 'approved' \|\| latestSubmission\.aiAnalysisConsent !== true/);
  assert.match(worker, /function sanitizedSubmission\(item\)[\s\S]*title:[\s\S]*description:[\s\S]*assetType:[\s\S]*regionName:/);
  assert.doesNotMatch(worker.match(/function sanitizedSubmission\(item\)[\s\S]*?\n}\n/)[0], /userId|email|fileID|cloudPath|longitude|latitude/);

  // The worker can only create review candidates; formal links remain an admin transaction.
  assert.match(worker, /CANDIDATE_COLLECTION = 'ai_link_candidates'/);
  assert.match(worker, /status:\s*'pending_admin'/);
  assert.doesNotMatch(worker, /story_evidence_links/);
  assert.match(adminService, /candidate\.status !== 'pending_admin'/);
  assert.match(adminService, /candidate\.submissionId !== submissionId \|\| candidate\.resourceId !== resourceId \|\| candidate\.relationType !== relationType/);
  assert.match(adminService, /status:\s*'confirmed'/);
  assert.match(adminService, /reject_ai_candidate/);
  assert.match(adminFunction, /rejectAiStoryCandidate/);

  // The UI preserves the human decision point.
  assert.match(adminHtml, /data-ai-analyze-submission/);
  assert.match(adminHtml, /data-ai-candidate-confirm/);
  assert.match(adminHtml, /data-ai-candidate-reject/);
  assert.match(adminHtml, /确认并发布链迹/);

  console.log('AI submission pipeline security tests passed.');
}

main();
