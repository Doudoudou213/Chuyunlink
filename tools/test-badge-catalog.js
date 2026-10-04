'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { catalog, get, checkEligibility, ruleVersion } = require('../static/badge-catalog.js');
const root = path.join(__dirname, '..');
let checks = 0;
function test(name, run) { run(); checks++; console.log('PASS ' + name); }
(async () => {
  test('twelve unique, stable badge IDs', () => {
    assert.equal(catalog.length, 12);
    assert.equal(new Set(catalog.map(b => b.id)).size, 12);
    assert.deepEqual(catalog.map(b => b.id), ['architecture', 'bronze', 'fieldnotes', 'pattern', 'inscription', 'artisan', 'journey', 'artifact', 'proofreader', 'collaborator', 'lamplight', 'heritage']);
  });
  test('catalog and nested rule data are immutable', () => {
    assert(Object.isFrozen(catalog));
    assert(Object.isFrozen(catalog[0]));
    assert(Object.isFrozen(catalog[0].requirements[0]));
  });
  test('unknown ID does not resolve a badge', () => assert.equal(get('missing'), null));
  for (const badge of catalog) {
    test(badge.id + ': artwork, version and distinct evidence keys', () => {
      assert.equal(badge.ruleVersion, ruleVersion);
      assert.equal(badge.requirementMode, 'all');
      assert(badge.name && badge.alt && badge.note && badge.story);
      assert(badge.requirements.every(r => Number.isInteger(r.target) && r.target > 0 && r.distinctBy && r.label));
      const buffer = fs.readFileSync(path.join(root, badge.image));
      assert.equal(buffer.toString('ascii', 0, 4), 'RIFF');
      assert.equal(buffer.toString('ascii', 8, 12), 'WEBP');
      assert(buffer.length > 1000);
      assert(buffer.length < 250000, 'individual web image exceeds 250 KB');
    });
    const result = await checkEligibility(badge.id);
    test(badge.id + ': disconnected means unknown, not an earned/locked decision', () => {
      assert.equal(result.badgeId, badge.id);
      assert.equal(result.ruleVersion, ruleVersion);
      assert.equal(result.status, 'not_connected');
      for (const key of ['eligible', 'earned', 'progress', 'checkedAt']) assert.equal(result[key], null);
      assert(Object.isFrozen(result));
    });
  }
  test('approved thresholds and compound all-of conditions', () => {
    assert.deepEqual(catalog.map(b => b.requirements.map(r => r.target)), [[3],[2],[1],[3],[2],[1],[3],[3],[3],[3],[5,5],[10,3,2]]);
    assert.equal(get('pattern').requirements[0].distinctBy, 'resourceId');
    assert.equal(get('collaborator').requirements[0].distinctBy, 'targetRecordId');
    assert.equal(get('lamplight').requirements[1].distinctBy, 'questionId');
  });
  await assert.rejects(checkEligibility('missing'), RangeError); checks++;
  const controller = new AbortController(); controller.abort();
  await assert.rejects(checkEligibility('architecture', { signal: controller.signal }), { name: 'AbortError' }); checks++;
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const ui = fs.readFileSync(path.join(root, 'static/profile-badges.js'), 'utf8');
  const core = fs.readFileSync(path.join(root, 'static/badge-catalog.js'), 'utf8');
  test('dependencies and reserved DOM IDs retained', () => {
    for (const file of ['badge-catalog.js', 'profile-badges.js', 'profile-badges.css']) assert(html.includes('./static/' + file));
    for (const id of ['profile-badges-section', 'badge-wall-count', 'badge-wall-progress-text', 'paper-badge-catalog', 'paper-badge-dialog']) assert(html.includes('id="' + id + '"'));
    assert(html.indexOf('src="./static/badge-catalog.js"') < html.indexOf('src="./static/profile-badges.js"'));
  });
  test('no network, persistence, awarding or raw HTML interpolation', () => {
    assert(!/\b(?:fetch|XMLHttpRequest|localStorage|sessionStorage|callCore|callFunction)\b/.test(core + ui));
    assert(!/innerHTML|insertAdjacentHTML/.test(ui));
  });
  test('native focus/escape contract and reduced motion', () => {
    assert(ui.includes('dialog.showModal()'));
    assert(ui.includes('document.body.append(dialog)'));
    assert(ui.includes("dialog.addEventListener('close', release)"));
    assert(ui.includes('opener.focus'));
    assert(fs.readFileSync(path.join(root, 'static/profile-badges.css'), 'utf8').includes('prefers-reduced-motion: reduce'));
  });
  console.log('Badge collection: ' + checks + ' checks passed. No backend qualification/award flow tested or enabled.');
})().catch(error => { console.error(error); process.exitCode = 1; });
