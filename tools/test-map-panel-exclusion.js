'use strict';

// Execute the production panel functions in an isolated DOM harness. No cloud
// calls, browser account, route requests or persisted planner data are needed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function productionFunction(name) {
  const match = html.match(new RegExp(`^    function ${name}\\([^]*?^    \\}`, 'm'));
  assert.ok(match, `Production function exists: ${name}`);
  return match[0];
}

const source = ['toggleMapPlanner', 'normalizeLandmark', 'focusLandmark', 'closeLandmarkDrawer']
  .map(productionFunction).join('\n');

function element(classes = []) {
  const tokens = new Set(classes);
  const attributes = {};
  return {
    dataset: {},
    innerText: '',
    classList: {
      contains: token => tokens.has(token),
      add: token => tokens.add(token),
      remove: token => tokens.delete(token),
      toggle(token, force) {
        const on = typeof force === 'boolean' ? force : !tokens.has(token);
        if (on) tokens.add(token); else tokens.delete(token);
        return on;
      }
    },
    setAttribute(name, value) { attributes[name] = String(value); },
    getAttribute: name => attributes[name]
  };
}

function harness(width) {
  const nodes = Object.fromEntries([
    'map-planner-panel', 'landmark-drawer', 'drawer-title', 'drawer-desc',
    'drawer-points', 'drawer-title-slip', 'drawer-status'
  ].map(id => [id, element()]));
  nodes['map-planner-panel'].classList.add('is-collapsed');
  nodes['landmark-drawer'].classList.add('translate-y-[200px]');
  nodes['landmark-drawer'].setAttribute('aria-hidden', 'true');
  const reward = { hidden: false };
  nodes['drawer-points'].closest = selector => {
    assert.equal(selector, '.landmark-ticket-reward');
    return reward;
  };
  const body = element();
  const stats = { renders: 0, invalidations: 0, icons: 0 };
  const selectedIds = ['museum', 'lake'];
  const context = vm.createContext({
    document: { body, getElementById: id => nodes[id] || null },
    window: { matchMedia(query) {
      assert.equal(query, '(max-width: 767px)', 'Uses the existing CSS breakpoint');
      return { matches: width <= 767 };
    } },
    heritageMap: { invalidateSize() { stats.invalidations++; } },
    renderMapPlanner() { stats.renders++; },
    lucide: { createIcons() { stats.icons++; } },
    setTimeout(callback, delay) { assert.equal(delay, 240); callback(); },
    activeLandmark: null,
    mapPlannerSelectedIds: selectedIds,
    localStorage: { setItem() { throw new Error('Panel visibility must not write persisted data'); } }
  });
  vm.runInContext(source, context);
  return { context, nodes, body, stats, selectedIds, reward };
}

let passed = 0;
function test(name, run) {
  run(); passed++;
  console.log(`PASS ${name}`);
}

for (const width of [320, 390, 767]) {
  test(`${width}px: opening planner closes detail semantically, retaining selection`, () => {
    const h = harness(width);
    const item = { id: 'museum', title: '博物馆', desc: '地点说明', points: 10, status: 'verified' };
    h.context.focusLandmark(item);
    h.context.toggleMapPlanner(true);
    assert.equal(h.nodes['map-planner-panel'].classList.contains('is-collapsed'), false);
    assert.equal(h.nodes['map-planner-panel'].getAttribute('aria-hidden'), 'false');
    assert.equal(h.body.classList.contains('map-planner-visible'), true);
    assert.equal(h.nodes['landmark-drawer'].classList.contains('is-open'), false);
    assert.equal(h.nodes['landmark-drawer'].getAttribute('aria-hidden'), 'true');
    assert.equal(h.context.activeLandmark, item);
    assert.equal(h.context.mapPlannerSelectedIds, h.selectedIds);
    assert.deepEqual(h.selectedIds, ['museum', 'lake']);
    assert.equal(h.stats.renders, 1);
    h.context.toggleMapPlanner(false);
    assert.equal(h.nodes['landmark-drawer'].classList.contains('is-open'), false, 'Detail must not reappear on planner close');
  });

  test(`${width}px: opening detail closes planner without losing the current route`, () => {
    const h = harness(width);
    h.context.toggleMapPlanner(true);
    const item = { id: 'lake', title: '东湖', desc: '寻访提示', points: 20, status: 'pending' };
    h.context.focusLandmark(item);
    assert.equal(h.nodes['map-planner-panel'].classList.contains('is-collapsed'), true);
    assert.equal(h.nodes['map-planner-panel'].getAttribute('aria-hidden'), 'true');
    assert.equal(h.body.classList.contains('map-planner-visible'), false);
    assert.equal(h.nodes['landmark-drawer'].classList.contains('is-open'), true);
    assert.equal(h.nodes['landmark-drawer'].getAttribute('aria-hidden'), 'false');
    assert.equal(h.nodes['drawer-title'].innerText, '东湖');
    assert.equal(h.nodes['drawer-status'].innerText, '急需采集');
    assert.equal(h.context.activeLandmark, item);
    assert.deepEqual(h.selectedIds, ['museum', 'lake']);
    assert.equal(h.stats.renders, 1, 'Closing the planner does not re-render it');
  });
}

for (const width of [768, 1440]) {
  test(`${width}px: desktop side-by-side panels retain existing behavior`, () => {
    const h = harness(width);
    h.context.focusLandmark({ title: '博物馆', status: 'verified' });
    h.context.toggleMapPlanner(true);
    assert.equal(h.nodes['landmark-drawer'].classList.contains('is-open'), true);
    assert.equal(h.nodes['map-planner-panel'].classList.contains('is-collapsed'), false);
    h.context.focusLandmark({ title: '东湖', status: 'explore' });
    assert.equal(h.nodes['landmark-drawer'].classList.contains('is-open'), true);
    assert.equal(h.nodes['map-planner-panel'].classList.contains('is-collapsed'), false);
    assert.equal(h.nodes['drawer-status'].innerText, '实地寻访');
  });
}

test('Toggle-without-argument and legacy landmark arguments still work', () => {
  const h = harness(390);
  h.context.focusLandmark('旧点位', '旧说明', 30);
  assert.equal(h.context.activeLandmark.id, 'legacy-landmark');
  assert.equal(h.nodes['drawer-desc'].innerText, '旧说明');
  h.context.toggleMapPlanner();
  assert.equal(h.nodes['map-planner-panel'].classList.contains('is-collapsed'), false);
  h.context.toggleMapPlanner();
  assert.equal(h.nodes['map-planner-panel'].classList.contains('is-collapsed'), true);
  assert.equal(h.stats.renders, 1);
});

test('Explicit planner close leaves an already-open detail untouched', () => {
  const h = harness(390);
  h.context.focusLandmark({ title: '博物馆', status: 'verified' });
  h.context.toggleMapPlanner(false);
  assert.equal(h.nodes['landmark-drawer'].classList.contains('is-open'), true);
  assert.equal(h.nodes['drawer-status'].innerText, '已入藏');
});

test('Missing planner panel remains a safe no-op', () => {
  const h = harness(390);
  delete h.nodes['map-planner-panel'];
  assert.doesNotThrow(() => h.context.toggleMapPlanner(true));
  assert.equal(h.stats.renders, 0);
  assert.equal(h.stats.invalidations, 0);
});

test('Exploration points do not advertise a fabricated reward', () => {
  const h = harness(390);
  h.context.focusLandmark({ title: '探索点', status: 'explore', points: 0 });
  assert.equal(h.reward.hidden, true);
  h.context.focusLandmark({ title: '既有征集', status: 'pending', points: 10 });
  assert.equal(h.reward.hidden, false);
});

console.log(`Map panel exclusion checks: ${passed}/${passed} passed.`);
