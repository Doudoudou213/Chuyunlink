'use strict';
// Offline content checks: no fetch, model, account, database or production write.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const pack = JSON.parse(read('docs/content-packs/all-points-guide-v1.json'));
const seed = JSON.parse(read('cloudfunctions/adminSubmissions/data/resources.v1.json'));
const sandbox = { window: {} };
vm.runInNewContext(read('static/map-exploration-points.js'), sandbox, { timeout: 1000 });
const expected = [...seed.filter(r => ['landmark', 'hotspot'].includes(r.type)), ...sandbox.window.CHULINK_EXPLORATION_POINTS];
const report = read('docs/content-packs/ALL_POINTS_GUIDE.md');
const hosts = new Set(['ylj.wuhan.gov.cn', 'wlj.wuhan.gov.cn', 'www.hbww.org.cn', 'wlt.hubei.gov.cn',
  'www.wuhan.gov.cn', 'www.whda.org.cn', 'zrzyhghj.xianning.gov.cn', 'www.hanyang.gov.cn']);
assert.equal(pack.environment, 'local_only');
for (const flag of ['productionWrites', 'paidCalls', 'importedToApplication', 'publishAllowed']) assert.equal(pack[flag], false);
assert.equal(pack.evaluation.humanReviewCompleted, false);
assert.equal(pack.evaluation.fixedAcceptanceSet, false);
assert.equal(pack.evaluation.paidAuthorization, null);
assert.equal(pack.coverage.cloudInventoryVerified, false);
assert.equal(pack.coverage.pointCount, expected.length);
assert.deepEqual(pack.records.map(r => r.id).sort(), expected.map(r => r.id).sort());
assert.deepEqual(pack.coverage.excludedResources.map(r => r.id).sort(), seed.filter(r => !['landmark', 'hotspot'].includes(r.type)).map(r => r.id).sort());
const sources = new Map(pack.sources.map(s => [s.id, s]));
assert.equal(sources.size, pack.sources.length, 'Duplicate source IDs');
for (const s of sources.values()) {
  const url = new URL(s.url);
  assert.equal(url.protocol, 'https:');
  assert(hosts.has(url.hostname), 'Unreviewed source host: ' + url.hostname);
  assert.equal(s.readStatus, 'body_read');
  assert.equal(s.excerptPermission, 'needs_review');
  assert(s.section && s.publisher && s.checkedOn);
  assert(report.includes(s.url), 'Source missing from reader document');
}
const allClaims = new Set();
const counts = {};
let drafts = 0;
for (const [index, r] of pack.records.entries()) {
  const entry = expected.find(e => e.id === r.id);
  assert.equal(r.title, entry.title);
  assert(report.includes('id="point-' + (index + 1) + '"'));
  assert(['draft_ready', 'background_only', 'identity_unresolved'].includes(r.status));
  counts[r.status] = (counts[r.status] || 0) + 1;
  assert(r.scope && r.gaps.length && r.boundaries.length);
  for (const flag of ['productionWrites', 'publishAllowed', 'aiAnalysisConsent', 'rewardsEnabled']) assert.equal(r[flag], false);
  assert.equal(r.coordinateReview, 'not_verified_as_entrance');
  assert.equal(r.visit.routeEligible, false);
  for (const field of ['openingHours', 'ticketPrice', 'entrance']) assert.equal(r.visit[field], null);
  for (const id of r.sourceIds) assert(sources.has(id));
  const claims = new Set(r.claims.map(c => c.id));
  assert.equal(claims.size, r.claims.length);
  for (const c of r.claims) {
    assert(!allClaims.has(c.id), 'Duplicate claim ID');
    allClaims.add(c.id);
    assert.equal(c.reviewStatus, 'needs_human_review');
    assert(c.sourceIds.length && c.locatorHint);
    for (const id of c.sourceIds) assert(r.sourceIds.includes(id));
  }
  for (const d of r.narrations) {
    assert.equal(d.authorship, 'assistant_written_not_provider_trial');
    assert.equal(d.reviewStatus, 'needs_human_review');
    assert(d.sentences.length);
    for (const sentence of d.sentences) {
      assert(sentence.text && sentence.claimIds.length);
      for (const id of sentence.claimIds) assert(claims.has(id), 'Cross-point or missing claim: ' + id);
      assert(report.includes(sentence.text), 'Reader draft differs from structured pack');
    }
    drafts++;
  }
  for (const q of r.qa) for (const id of q.claimIds) assert(claims.has(id));
  for (const o of r.observations) {
    assert.equal(o.kind, 'editorial_advice');
    assert.equal(o.onSiteVerified, false);
    assert.equal(o.preciseDirectionsAllowed, false);
  }
  if (r.status === 'identity_unresolved') {
    assert.equal(r.claims.length, 0);
    assert.equal(r.narrations.length, 0);
  } else if (r.status === 'background_only') {
    assert.deepEqual(r.narrations.map(d => d.interest), ['区域背景']);
  } else {
    assert.equal(r.narrations.length, 2);
    assert.equal(new Set(r.narrations.map(d => d.interest)).size, 2);
  }
}
const art = pack.records.find(r => r.id === 'wuhan-art-hankou-exterior');
assert.equal(art.visit.status, 'needs_reopening_confirmation');
assert.equal(art.visit.closureSourceId, 'art-closure');
assert(art.claims.some(c => c.sourceIds.includes('art-closure')));
for (const failed of pack.retrievalFailures) assert(!pack.sources.some(s => s.url === failed.url));
assert.equal(pack.records.length, 19);
assert.equal(counts.draft_ready, 13);
assert.equal(counts.background_only, 4);
assert.equal(counts.identity_unresolved, 2);
console.log('PASS: ' + pack.records.length + ' local points; ' + sources.size + ' sources; ' + allClaims.size + ' claims; ' + drafts + ' drafts/backgrounds with local references.');
console.log('No paid calls or app writes. Human factual review, publication permission and onsite conditions remain unverified.');
