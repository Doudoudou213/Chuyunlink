'use strict';

// Local behavior checks only: no browser, animation dependency, network or writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'static/paper-motion.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const routeStart = html.indexOf('function switchTab(tabId)');
const routeEnd = html.indexOf('// 2. ', routeStart);
assert(routeStart >= 0 && routeEnd > routeStart, 'actual navigation function must be available');
const routeSource = html.slice(routeStart, routeEnd);

const definitions = {
  discover: ['.paper-home-art', '.paper-home-intro', '.discover-quick-actions'],
  map: ['.field-map-ink'],
  collect: ['.collect-hero-image', '.collect-hero-copy'],
  community: ['.community-cover-figure', '.community-hero-meta', '.community-hero-title', '.community-hero-description', '#community-route-card'],
  profile: ['.paper-home-art', '.profile-identity', '.profile-atlas-banner']
};

function emitter() {
  const listeners = new Map();
  return {
    addEventListener(type, callback, options) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push({ callback, once: Boolean(options && options.once) });
    },
    dispatchEvent(event) {
      for (const item of [...(listeners.get(event.type) || [])]) {
        if (item.once) listeners.set(event.type, listeners.get(event.type).filter(other => other !== item));
        item.callback(event);
      }
      return true;
    }
  };
}

function node(id, owner) {
  const classes = new Set();
  return {
    id, owner,
    style: { opacity: '0.87', transform: 'rotate(-2deg)', color: 'inherit' },
    attributes: {},
    classList: {
      contains: name => classes.has(name),
      add: name => classes.add(name),
      remove: name => classes.delete(name),
      toggle(name, on) { if (on) classes.add(name); else classes.delete(name); }
    },
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { delete this.attributes[name]; }
  };
}

function harness(options = {}) {
  const nodes = new Map();
  const views = {};
  const navs = [];
  for (const [tab, selectors] of Object.entries(definitions)) {
    const view = node('view-' + tab);
    view.children = new Map(selectors.map(selector => [selector, node(tab + ':' + selector, view)]));
    view.querySelectorAll = selector => selector.split(',').flatMap(part => {
      const found = view.children.get(part.trim());
      return found ? [found] : [];
    });
    view.contains = target => target === view || target.owner === view;
    if (tab !== 'discover') view.classList.add('hidden');
    views[tab] = view;
    nodes.set(view.id, view);
    const nav = node('nav-' + tab);
    nodes.set(nav.id, nav);
    navs.push(nav);
  }
  const protectedNodes = [node('heritage-map'), node('leaflet-pane'), node('leaflet-tile'), node('dialog'), node('app-viewport'), ...Object.values(views), ...navs];
  for (const item of protectedNodes) nodes.set(item.id, item);
  const allNodes = [...protectedNodes, ...Object.values(views).flatMap(view => [...view.children.values()])];
  const originals = new Map(allNodes.map(item => [item, { ...item.style }]));
  const document = Object.assign(emitter(), {
    readyState: options.loading ? 'loading' : 'complete',
    hidden: Boolean(options.hidden),
    body: node('body'),
    getElementById: id => nodes.get(id) || null,
    querySelector(selector) {
      assert.equal(selector, '.page-view:not(.hidden)');
      return Object.values(views).find(view => !view.classList.contains('hidden')) || null;
    },
    querySelectorAll(selector) {
      if (selector === '.page-view') return Object.values(views);
      if (selector === '.nav-item') return navs;
      throw Error('Unexpected document-wide selection: ' + selector);
    }
  });
  const media = Object.assign(emitter(), { matches: Boolean(options.reduced) });
  if (options.legacyMedia) {
    media.addListener = callback => emitterAdd('change', callback);
    const emitterAdd = media.addEventListener.bind(media);
    delete media.addEventListener;
  }
  const frames = new Map();
  const cancelled = [];
  const contexts = [];
  const timelines = [];
  const businessCalls = [];
  let nextFrame = 1;
  let recording = null;
  let fromToCalls = 0;

  function paint(item, values) {
    if ('opacity' in values) item.style.opacity = String(values.opacity);
    if ('y' in values) item.style.transform = 'translateY(' + values.y + 'px)';
  }
  const gsap = {
    context(callback, scope) {
      if (options.fail === 'context') throw Error('fixture context failure');
      const context = {
        scope, originals: new Map(), reverted: 0,
        add(callback) {
          recording = context;
          try { callback(); } finally { recording = null; }
        },
        revert() {
          this.reverted++;
          for (const [item, original] of this.originals) {
            for (const key of Object.keys(item.style)) delete item.style[key];
            Object.assign(item.style, original);
          }
          for (const timeline of timelines.filter(item => item.context === this)) timeline.killed = true;
        }
      };
      contexts.push(context);
      context.add(callback);
      return context;
    },
    timeline(config) {
      if (options.fail === 'timeline') throw Error('fixture timeline failure');
      assert(recording, 'timeline belongs to a reversible context');
      const timeline = {
        context: recording, config, steps: [], played: 0, killed: false,
        fromTo(targets, from, to, position) {
          fromToCalls++;
          for (const item of targets) {
            assert.equal(item.owner, recording.scope, 'targets must be scoped to the active view');
            if (!recording.originals.has(item)) recording.originals.set(item, { ...item.style });
            paint(item, from);
          }
          this.steps.push({ targets: [...targets], from, to, position });
          if (options.fail === 'fromTo' && fromToCalls === 2) throw Error('fixture partially rendered failure');
          return this;
        },
        play() {
          if (options.fail === 'play') throw Error('fixture asynchronous playback failure');
          this.played++;
          return this;
        },
        complete() {
          assert(!this.killed, 'cancelled animation must not complete');
          for (const step of this.steps) for (const item of step.targets) paint(item, step.to);
          this.config.onComplete();
        }
      };
      timelines.push(timeline);
      return timeline;
    }
  };
  const window = Object.assign(emitter(), {
    gsap: options.missingGsap ? undefined : gsap,
    matchMedia(query) { assert.equal(query, '(prefers-reduced-motion: reduce)'); return media; },
    requestAnimationFrame(callback) { const id = nextFrame++; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { cancelled.push(id); frames.delete(id); },
    scrollTo() {}
  });
  const sandbox = vm.createContext({
    window, document,
    CustomEvent: class { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } },
    heritageMap: null,
    setTimeout() { throw Error('Unexpected map timer without a map'); },
    ...Object.fromEntries(['initHeritageMap', 'renderMapPlanner', 'closeLandmarkDrawer', 'renderCommunityRouteCard', 'playCollectScrollIntro', 'updateCollectHeroDrift'].map(name => [name, () => businessCalls.push(name)]))
  });
  vm.runInContext(source, sandbox, { filename: 'static/paper-motion.js' });
  vm.runInContext(routeSource, sandbox, { filename: 'index.html:switchTab' });

  return {
    window, document, media, views, navs, frames, cancelled, contexts, timelines, businessCalls, protectedNodes,
    navigate(tab) { sandbox.switchTab(tab); },
    changed(tab, previousViewId = '') { window.dispatchEvent({ type: 'chu:view-changed', detail: { tabId: tab, previousViewId } }); },
    flush() {
      const pending = [...frames.entries()];
      for (const [id, callback] of pending) if (frames.delete(id)) callback();
    },
    assertRestored(items = allNodes) {
      for (const item of items) assert.deepEqual(item.style, originals.get(item), item.id + ' retains its original inline styles');
    }
  };
}

const checks = [];
const test = (name, run) => checks.push([name, run]);

test('initial load and DOMContentLoaded never start an entrance', () => {
  for (const loading of [false, true]) {
    const h = harness({ loading });
    assert.equal(h.contexts.length, 0);
    if (loading) {
      h.navigate('map');
      assert.equal(h.contexts.length, 0);
    }
    h.document.dispatchEvent({ type: 'DOMContentLoaded' });
    assert.equal(h.contexts.length, 0);
    assert.equal(h.frames.size, 0);
    h.assertRestored();
    h.navigate('profile');
    assert.equal(h.contexts.length, 1);
  }
});

for (const tab of Object.keys(definitions)) {
  test(tab + ' uses only its approved layers with a 1.44 second maximum', () => {
    const h = harness();
    if (tab === 'discover') h.views.discover.classList.add('hidden');
    h.navigate(tab);
    assert.equal(h.contexts.length, 1);
    const timeline = h.timelines[0];
    assert.equal(timeline.config.paused, true);
    assert.equal(timeline.config.defaults.ease, 'power2.out');
    assert.equal(timeline.played, 0, 'play waits for one frame');
    assert.equal(Math.max(...timeline.steps.map(step => step.position + step.to.duration)), 1.44);
    assert.deepEqual(timeline.steps.flatMap(step => step.targets.map(item => item.id)).sort(), definitions[tab].map(selector => tab + ':' + selector).sort());
    assert.equal(timeline.steps[0].position, 0);
    assert.equal(timeline.steps[0].to.duration, 1.44);
    assert(!('y' in timeline.steps[0].from) && !('y' in timeline.steps[0].to), 'art transforms are preserved');
    if (tab !== 'map') {
      assert.equal(timeline.steps[1].position, 0.21);
      assert.equal(timeline.steps[1].to.duration, 0.9);
      assert.equal(timeline.steps[1].from.y, 5);
      assert.equal(timeline.steps[1].to.y, 0);
    }
    if (['discover', 'community', 'profile'].includes(tab)) {
      assert.equal(timeline.steps[2].position, 0.36);
      assert.equal(timeline.steps[2].to.duration, 1.02);
      assert(!('y' in timeline.steps[2].from), 'body layers only fade');
    }
    h.assertRestored(h.protectedNodes);
    h.flush();
    assert.equal(timeline.played, 1);
    timeline.complete();
    assert.equal(h.contexts[0].reverted, 1);
    h.assertRestored();
  });
}

test('same-view selection never replays and keeps navigation synchronous', () => {
  const h = harness();
  h.navigate('discover');
  assert.equal(h.contexts.length, 0);
  h.navigate('map');
  assert.deepEqual(h.businessCalls, ['initHeritageMap', 'renderMapPlanner', 'closeLandmarkDrawer']);
  assert.equal(h.views.map.classList.contains('hidden'), false);
  assert.equal(h.navs.find(item => item.id === 'nav-map').attributes['aria-current'], 'page');
  assert.equal(h.timelines[0].played, 0);
  h.navigate('map');
  assert.equal(h.contexts.length, 1);
  assert.equal(h.frames.size, 0);
  h.assertRestored();
});

test('missing or incomplete GSAP leaves the view usable', () => {
  for (const missing of [true, false]) {
    const h = harness({ missingGsap: missing });
    if (!missing) h.window.gsap = {};
    h.navigate('collect');
    assert.equal(h.views.collect.classList.contains('hidden'), false);
    assert.equal(h.frames.size, 0);
    assert.equal(h.contexts.length, 0);
    assert.deepEqual(h.businessCalls, ['playCollectScrollIntro', 'updateCollectHeroDrift']);
    h.assertRestored();
  }
});

for (const fail of ['context', 'timeline', 'fromTo', 'play']) {
  test('GSAP ' + fail + ' failure restores partially changed styles', () => {
    const h = harness({ fail });
    assert.doesNotThrow(() => { h.navigate('community'); h.flush(); });
    assert.equal(h.frames.size, 0);
    assert.equal(h.views.community.classList.contains('hidden'), false);
    h.assertRestored();
  });
}

test('reduced motion at load and changed preferences stop all pending motion', () => {
  for (const legacyMedia of [false, true]) {
    const h = harness({ reduced: true, legacyMedia });
    h.navigate('map');
    assert.equal(h.contexts.length, 0);
    h.media.matches = false;
    h.media.dispatchEvent({ type: 'change' });
    assert.equal(h.contexts.length, 0, 'preference changes do not initiate motion');
    h.navigate('profile');
    assert.equal(h.frames.size, 1);
    h.media.matches = true;
    h.media.dispatchEvent({ type: 'change' });
    assert.equal(h.frames.size, 0);
    h.assertRestored();
    h.navigate('community');
    assert.equal(h.contexts.length, 1);
    h.assertRestored();
  }
});

test('rapid navigation cancels old frames and restores styles before the next view is shown', () => {
  const h = harness();
  h.navigate('community');
  const first = h.contexts[0];
  let restoredBeforeHiding = false;
  h.window.addEventListener('chu:view-changing', () => {
    restoredBeforeHiding = !h.views.community.classList.contains('hidden');
    h.assertRestored();
  }, { once: true });
  h.navigate('profile');
  assert(restoredBeforeHiding, 'cleanup runs before routing hides the previous view');
  assert.equal(first.reverted, 1);
  assert.equal(h.cancelled.length, 1);
  assert.equal(h.frames.size, 1);
  h.flush();
  assert.equal(h.timelines[0].played, 0);
  assert.equal(h.timelines[1].played, 1);
  h.navigate('collect');
  assert.equal(h.contexts[1].reverted, 1, 'playing animations are cancelled too');
  h.window.dispatchEvent({ type: 'pagehide' });
  h.assertRestored();
});

test('restoring the travelling navigation focus does not shorten the slow artwork entrance', () => {
  const h = harness();
  h.navigate('profile');
  h.flush();
  const target = [...h.views.profile.children.values()][1];
  target.closest = selector => selector === '#app-navigation' ? h.navs[0] : null;
  h.document.dispatchEvent({ type: 'focusin', target });
  assert.equal(h.contexts[0].reverted, 0);
  target.closest = () => null;
  h.document.dispatchEvent({ type: 'focusin', target });
  assert.equal(h.contexts[0].reverted, 1, 'real content focus still ends the entrance');
});

test('focus, hidden documents and page exit restore pending and playing animation', () => {
  for (const event of ['focus', 'visibility', 'pagehide']) for (const playing of [false, true]) {
    const h = harness();
    h.navigate('profile');
    if (playing) h.flush();
    if (event === 'focus') {
      h.document.dispatchEvent({ type: 'focusin', target: h.navs[0] });
      assert.equal(h.contexts[0].reverted, 0, 'unrelated focus does not cancel');
      h.document.dispatchEvent({ type: 'focusin', target: [...h.views.profile.children.values()][1] });
    } else if (event === 'visibility') {
      h.document.hidden = true;
      h.document.dispatchEvent({ type: 'visibilitychange' });
    } else h.window.dispatchEvent({ type: 'pagehide' });
    assert.equal(h.contexts[0].reverted, 1);
    assert.equal(h.frames.size, 0);
    h.assertRestored();
  }
});

test('hidden, missing and unknown views are ignored and a hidden pending view cannot play', () => {
  const h = harness();
  h.changed('profile');
  h.changed('unknown');
  const lookup = h.document.getElementById;
  h.document.getElementById = id => id === 'view-map' ? null : lookup(id);
  h.changed('map');
  h.document.getElementById = lookup;
  assert.equal(h.contexts.length, 0);
  h.document.hidden = true;
  h.navigate('map');
  assert.equal(h.contexts.length, 0);
  h.document.hidden = false;
  h.navigate('profile');
  h.views.profile.classList.add('hidden');
  h.flush();
  assert.equal(h.timelines[0].played, 0);
  assert.equal(h.contexts[0].reverted, 1);
  h.assertRestored();
});

test('HTML loads the local GSAP dependency before the entrance layer', () => {
  const dependency = html.indexOf('<script src="./static/assets/gsap-3.15.0.min.js"></script>');
  const motion = html.indexOf('<script src="./static/paper-motion.js"></script>');
  assert(dependency >= 0 && motion > dependency);
  assert(fs.existsSync(path.join(root, 'static/assets/gsap-3.15.0.min.js')));
});

let failures = 0;
for (const [name, run] of checks) {
  try { run(); console.log('PASS ' + name); }
  catch (error) { failures++; console.error('FAIL ' + name + '\n' + error.stack); }
}
assert.equal(failures, 0, failures + ' paper motion checks failed');
console.log('Paper motion passed: ' + checks.length + ' local VM checks; no browser or external services.');
