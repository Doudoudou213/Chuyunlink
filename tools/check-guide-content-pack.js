'use strict';
// Offline content preparation only. Never enables or executes a provider request.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { inputFromBundle, runTrial } = require('./lib/public-guide-trial');
const { loadConfig } = require('../cloudfunctions/storyWorker/lib/config');
const { validateGuideResult } = require('../cloudfunctions/storyWorker/lib/guide-contract');
const root = path.resolve(__dirname, '..');
const bundlePath = path.join(root, 'docs/content-packs/wuhan-guide-v1.json');
const p = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));
const resources = require('../cloudfunctions/adminSubmissions/data/resources.v1.json');
(async () => {
  assert.equal(p.environment, 'local_only');
  for (const key of ['productionWrites', 'paidCalls', 'importedToApplication']) assert.equal(p[key], false);
  assert.equal(p.evaluation.fixedAcceptanceSet, false);
  assert.equal(p.evaluation.paidAuthorization, null);
  assert.equal(p.route.status, 'not_planned');
  assert.equal(new Set(p.sources.map(s => s.id)).size, p.sources.length);
  const claimIds = new Set();
  let checked = 0, requests = 0;
  for (const [index, r] of p.records.entries()) {
    assert(resources.some(x => x.id === r.resourceBindingCandidate && x.type === 'landmark'));
    assert.equal(r.resourceId, null);
    for (const key of ['publishAllowed', 'aiAnalysisConsent', 'materialAnalysisConsent', 'formalAdoption', 'rewardsEnabled']) assert.equal(r[key], false);
    assert.equal(r.visitInfo.status, 'needs_current_verification');
    assert.equal(r.visitInfo.entranceCoordinates, null);
    assert.equal(r.visitInfo.walkingMinutes, null);
    for (const c of r.claimCandidates) {
      assert(!claimIds.has(c.localId), 'duplicate claim');
      claimIds.add(c.localId);
      assert.equal(c.sourceId, r.officialSourceId, 'existing trial adapter accepts one source per record');
      assert.equal(c.status, 'needs_human_review');
      assert(c.sourceLocator.section);
    }
    assert.equal(r.referenceDrafts.length, r.interestVersions.length);
    assert.equal(new Set(r.referenceDrafts.map(d => d.interest)).size, r.interestVersions.length);
    for (const d of r.referenceDrafts) {
      assert.equal(d.status, 'needs_human_review');
      assert.equal(d.authorship, 'assistant_written_reference_not_provider_result');
      const { input } = inputFromBundle(p, index, d.interest);
      assert.equal(input.contentPlan.effectiveInterest, d.interest, 'interest silently fell back');
      assert.equal(validateGuideResult(d.output, input).outcome, 'draft');
      const result = await runTrial({
        bundlePath, outputDirectory: path.join(root, 'unused-offline-output'),
        index, interest: d.interest, execute: false, config: loadConfig({}),
        transport: async () => { requests++; throw Error('Network must not be used'); }
      });
      assert.equal(result.paidCall, false);
      checked++;
    }
  }
  assert.equal(requests, 0);
  assert.equal(checked, 6);
  console.log('PASS: 3 resource candidates, ' + claimIds.size + ' fact candidates, 6 offline samples; no provider calls or application writes.');
  console.log('Human factual review, publication rights, onsite checks and actual model quality remain unverified.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
