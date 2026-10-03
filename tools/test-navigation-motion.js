'use strict';

// Deterministic checks against the actual motion module, without a browser,
// network, private account, fake cloned controls or production writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'static/navigation-motion.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const tabs = ['discover', 'map', 'collect', 'community', 'profile'];
const slotIds = { discover: 'paper-home-navigation', map: 'field-map-navigation', collect: 'field-collect-navigation', community: 'field-community-navigation', profile: 'paper-profile-navigation' };

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
    }
  };
}

function styleDeclaration() {
  const values = new Map();
  const priorities = new Map();
  const methods = {
    setProperty(key, value, priority = '') { values.set(key, String(value)); priorities.set(key, priority); },
    getPropertyValue: key => values.get(key) || '',
    getPropertyPriority: key => priorities.get(key) || '',
    removeProperty(key) { const old = values.get(key); values.delete(key); priorities.delete(key); return old; },
    snapshot: () => [...values.entries()].sort().map(([key, value]) => [key, value, priorities.get(key) || ''])
  };
  return new Proxy(methods, {
    get(target, key) { return key in target ? target[key] : values.get(String(key).replace(/[A-Z]/g, letter => '-' + letter.toLowerCase())) || ''; },
    set(target, key, value) { methods.setProperty(String(key).replace(/[A-Z]/g, letter => '-' + letter.toLowerCase()), value); return true; }
  });
}

function harness(options = {}) {
  let document;
  class Element {
    constructor(tagName = 'div', id = '') {
      this.tagName = tagName.toUpperCase(); this.id = id; this.children = []; this.parentNode = null;
      this.style = styleDeclaration(); this.attributes = {}; this.className = '';
      this.rect = { left: 0, top: 0, width: 1000, height: 52 };
      this.classList = {
        contains: name => this.className.split(/\s+/).includes(name),
        add: name => { if (!this.classList.contains(name)) this.className = (this.className + ' ' + name).trim(); },
        remove: name => { this.className = this.className.split(/\s+/).filter(value => value !== name).join(' '); }
      };
    }
    get isConnected() { return this === document.body || Boolean(this.parentNode && this.parentNode.isConnected); }
    appendChild(child) { child.remove(); child.parentNode = this; this.children.push(child); return child; }
    remove() {
      if (!this.parentNode) return;
      if (this.contains(document.activeElement)) document.activeElement = document.body;
      this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null;
    }
    before(child) { const parent = this.parentNode; child.remove(); child.parentNode = parent; parent.children.splice(parent.children.indexOf(this), 0, child); }
    after(child) { const parent = this.parentNode; child.remove(); child.parentNode = parent; parent.children.splice(parent.children.indexOf(this) + 1, 0, child); }
    replaceWith(child) { this.before(child); this.remove(); }
    contains(child) { return this === child || this.children.some(item => item.contains(child)); }
    setAttribute(key, value) { this.attributes[key] = String(value); }
    removeAttribute(key) { delete this.attributes[key]; }
    getAttribute(key) { return this.attributes[key] ?? null; }
    focus(options) { assert.equal(options.preventScroll, true); document.activeElement = this; document.dispatchEvent({ type: 'focusin', target: this }); }
    querySelectorAll(selector) {
      const selectors = selector.split(',').map(part => part.trim());
      const match = child => selectors.some(part => part[0] === '.' ? child.classList.contains(part.slice(1)) : part[0] === '#' ? child.id === part.slice(1) : child.tagName.toLowerCase() === part);
      return this.children.flatMap(child => [...(match(child) ? [child] : []), ...child.querySelectorAll(selector)]);
    }
    getBoundingClientRect() {
      if (this.classList.contains('paper-nav-flight')) return Object.fromEntries(['left', 'top', 'width', 'height'].map(key => [key, parseFloat(this.style[key]) || 0]));
      if (this.id === 'app-navigation' || this.classList.contains('paper-nav-placeholder')) {
        return { ...this.parentNode.getBoundingClientRect() };
      }
      return { ...this.rect };
    }
  }
  const body = new Element('body');
  body.rect = { left: 0, top: 64, width: 1280, height: 58 };
  document = Object.assign(emitter(), {
    body, activeElement: body, readyState: options.loading ? 'loading' : 'complete', hidden: Boolean(options.hidden),
    createElement: tag => new Element(tag),
    getElementById: id => body.querySelectorAll('#' + id)[0] || null,
    querySelector(selector) {
      assert.equal(selector, '.page-view:not(.hidden)');
      return Object.values(views).find(view => !view.classList.contains('hidden')) || null;
    }
  });
  const anchor = new Element('comment'); body.appendChild(anchor);
  const nav = new Element('nav', 'app-navigation'); body.appendChild(nav);
  nav.style.setProperty('height', '52px', 'important');
  nav.style.setProperty('color', 'sienna');
  const buttons = tabs.map(tab => {
    const button = new Element('button', 'nav-' + tab); button.className = 'nav-item'; nav.appendChild(button);
    const icon = new Element('svg'); icon.className = 'nav-icon'; button.appendChild(icon);
    const label = new Element('span'); label.className = 'nav-label'; button.appendChild(label);
    button.attributes.onclick = `switchTab('${tab}')`;
    return button;
  });
  const views = {}, destinations = {};
  for (const [i, tab] of tabs.entries()) {
    const view = new Element('section', 'view-' + tab); view.className = 'page-view' + (tab === 'discover' ? '' : ' hidden'); body.appendChild(view); views[tab] = view;
    const destination = new Element('div', slotIds[tab]);
    destination.rect = { left: 80 + i * 20, top: 150 + i * 70, width: 1120 - i * 40, height: 52 - i };
    view.appendChild(destination); destinations[tab] = destination;
  }
  const desktop = Object.assign(emitter(), { matches: options.mobile ? false : true });
  const reduced = Object.assign(emitter(), { matches: Boolean(options.reduced) });
  if (options.legacyMedia) for (const media of [desktop, reduced]) {
    const add = media.addEventListener.bind(media); media.addListener = callback => add('change', callback); delete media.addEventListener;
  }
  const tweens = [];
  const gsap = {
    to(state, config) {
      if (options.failGsap) throw Error('fixture GSAP failure');
      const tween = {
        state, config, killed: false,
        kill() { this.killed = true; },
        advance(progress) { assert(!this.killed, 'dead tween must not advance'); state.progress = progress; config.onUpdate(); },
        complete() { this.advance(1); config.onComplete(); }
      };
      tweens.push(tween); return tween;
    }
  };
  const window = Object.assign(emitter(), {
    innerWidth: options.mobile ? 390 : 1280, innerHeight: 900,
    gsap: options.missingGsap ? undefined : gsap,
    matchMedia(query) { if (query.includes('prefers-reduced-motion')) return reduced; assert.equal(query, '(min-width: 768px)'); return desktop; }
  });
  function getComputedStyle(element) {
    return { getPropertyValue(key) {
      const explicit = element.style.getPropertyValue(key);
      if (explicit) return explicit;
      return ({ display: 'flex', 'box-sizing': 'border-box', 'align-items': 'center', 'justify-content': 'center', 'flex-direction': 'row', 'flex-wrap': 'nowrap',
        'flex-grow': '0', 'flex-shrink': '1', 'flex-basis': 'auto', gap: '8px', width: element.getBoundingClientRect().width + 'px', height: '52px',
        'min-width': '0px', 'min-height': '44px', 'max-width': 'none', 'max-height': 'none', 'font-family': 'serif', 'font-size': '12px', 'font-weight': '500',
        'line-height': '18px', 'letter-spacing': '0.5px', order: '2', 'align-self': 'auto', 'margin-top': '16px', 'margin-bottom': '0px',
        'margin-left': '0px', 'margin-right': '0px', 'padding-top': '0px', 'padding-left': '0px', 'padding-bottom': '0px', 'padding-right': '0px' })[key] || '';
    } };
  }
  const originalStyles = new Map([nav, ...nav.querySelectorAll('.nav-item, .nav-icon, .nav-label')].map(element => [element, element.style.snapshot()]));
  vm.runInNewContext(source, { window, document, getComputedStyle }, { filename: 'static/navigation-motion.js' });
  const hasDestination = tab => desktop.matches && options.missingDestination !== tab;
  function place(tab) { window.ChuNavMotion.place(nav, hasDestination(tab) ? destinations[tab] : null, anchor); }
  function change(tab) {
    window.dispatchEvent({ type: 'chu:view-changing', detail: { tabId: tab } });
    for (const name of tabs) views[name].classList[name === tab ? 'remove' : 'add']('hidden');
    place(tab);
  }
  function assertRestored(tab) {
    assert.equal(nav.parentNode, hasDestination(tab) ? destinations[tab] : body);
    assert.equal(body.querySelectorAll('.paper-nav-flight').length, 0);
    assert.equal(body.querySelectorAll('.paper-nav-placeholder').length, 0);
    assert.equal(body.querySelectorAll('#app-navigation').length, 1);
    assert.deepEqual(nav.querySelectorAll('.nav-item'), buttons, 'same five actual controls survive');
    for (const [element, original] of originalStyles) assert.deepEqual(element.style.snapshot(), original, 'owned styles restored exactly including !important');
  }
  place('discover');
  return { document, window, nav, buttons, views, destinations, desktop, reduced, tweens, change, place, assertRestored, originalStyles };
}

let passed = 0;
function test(name, check) { check(); passed++; console.log('PASS ' + name); }

test('first paint is immediate and does not replay the loading screen', () => {
  const h = harness(); h.assertRestored('discover'); assert.equal(h.tweens.length, 0);
  const loading = harness({ loading: true }); loading.change('map'); assert.equal(loading.tweens.length, 0);
  loading.document.dispatchEvent({ type: 'DOMContentLoaded' }); loading.change('collect'); assert.equal(loading.tweens.length, 1);
});
test('all five destinations retain one live row, footprint and exact original styles', () => {
  const h = harness();
  for (const tab of ['map', 'collect', 'community', 'profile', 'discover']) {
    h.change(tab);
    const flight = h.document.body.querySelectorAll('.paper-nav-flight')[0];
    assert(flight); assert.equal(h.nav.parentNode, flight);
    assert.equal(h.document.body.querySelectorAll('.paper-nav-placeholder').length, 1);
    assert.equal(h.document.body.querySelectorAll('#app-navigation').length, 1);
    assert.deepEqual(h.nav.querySelectorAll('.nav-item'), h.buttons);
    const tween = h.tweens.at(-1); assert.equal(tween.config.duration, 0.82);
    tween.advance(0.5);
    assert.equal(h.nav.style.filter, '', 'labels and icons never blur');
    assert.equal(h.nav.style.transform, 'none', 'labels and icons never scale');
    assert.match(flight.children[0].style.filter, /blur/);
    tween.complete(); h.assertRestored(tab);
  }
});
test('a repeated active-view click does not start motion', () => {
  const h = harness(); h.change('discover'); h.assertRestored('discover'); assert.equal(h.tweens.length, 0);
});
test('community lands in its actual paper heading, while a missing destination retains the original fallback', () => {
  const community = harness();
  community.change('community'); community.tweens.at(-1).complete();
  community.assertRestored('community');
  assert.equal(community.nav.parentNode.id, 'field-community-navigation');
  const fallback = harness({ missingDestination: 'community' });
  fallback.change('community'); fallback.tweens.at(-1).complete();
  fallback.assertRestored('community');
  assert.equal(fallback.nav.parentNode, fallback.document.body);
  fallback.change('discover'); fallback.tweens.at(-1).complete();
  fallback.assertRestored('discover');
});
test('repeated observers cannot pull the row out of an ongoing flight', () => {
  const h = harness(); h.change('profile'); const host = h.nav.parentNode;
  h.place('profile'); h.place('profile'); assert.equal(h.nav.parentNode, host); assert.equal(h.tweens.length, 1);
  h.tweens[0].complete(); h.assertRestored('profile');
});
test('rapid retargeting starts at the current interpolated screen rectangle', () => {
  const h = harness(); h.change('profile'); h.tweens[0].advance(0.35);
  const current = h.nav.getBoundingClientRect(); h.change('map');
  assert(h.tweens[0].killed); assert.equal(h.tweens.length, 2);
  assert.deepEqual(h.nav.getBoundingClientRect(), current, 'new flight must not jump to either old endpoint');
  assert.equal(h.document.body.querySelectorAll('.paper-nav-flight').length, 1);
  h.tweens[1].complete(); h.assertRestored('map');
});
test('a rapid repeated click of the active tab continues its current flight without snapping', () => {
  const h = harness(); h.change('profile'); h.tweens[0].advance(0.4);
  const host = h.nav.parentNode, current = h.nav.getBoundingClientRect();
  h.change('profile');
  assert.equal(h.tweens.length, 1); assert.equal(h.tweens[0].killed, false);
  assert.equal(h.nav.parentNode, host); assert.deepEqual(h.nav.getBoundingClientRect(), current);
  h.tweens[0].complete(); h.assertRestored('profile');
});
test('layout changes during flight follow the live destination footprint', () => {
  const h = harness(); h.change('profile'); h.tweens[0].advance(0.4);
  h.destinations.profile.rect.top += 12; h.destinations.profile.rect.width -= 20;
  h.tweens[0].advance(1);
  assert.deepEqual(h.nav.getBoundingClientRect(), h.destinations.profile.getBoundingClientRect());
  h.tweens[0].complete(); h.assertRestored('profile');
});
test('a partially visible source is eligible; an entirely offscreen source is not', () => {
  const partial = harness(); partial.destinations.discover.rect.top = -20; partial.change('map'); assert.equal(partial.tweens.length, 1);
  const offscreen = harness(); offscreen.destinations.discover.rect.top = -100; offscreen.change('map'); assert.equal(offscreen.tweens.length, 0); offscreen.assertRestored('map');
});
test('mobile keeps the original fixed dock without a travelling overlay', () => {
  const h = harness({ mobile: true }); for (const tab of tabs) { h.change(tab); h.assertRestored(tab); }
  assert.equal(h.tweens.length, 0);
});
test('reduced motion and missing GSAP fail open with working controls', () => {
  for (const options of [{ reduced: true }, { missingGsap: true }, { hidden: true }]) {
    const h = harness(options); h.change('map'); h.assertRestored('map'); assert.equal(h.tweens.length, 0);
  }
});
test('a GSAP construction error restores styles, focus and flow', () => {
  const h = harness({ failGsap: true }); h.document.activeElement = h.buttons[1]; h.change('map');
  h.assertRestored('map'); assert.equal(h.document.activeElement, h.buttons[1]); assert.equal(h.tweens.length, 0);
});
test('focused real button is retained both in transit and on arrival', () => {
  const h = harness(); h.document.activeElement = h.buttons[4]; h.change('profile');
  assert.equal(h.document.activeElement, h.buttons[4]); h.tweens[0].complete();
  assert.equal(h.document.activeElement, h.buttons[4]); h.assertRestored('profile');
});
test('resize, page exit, scrolling and keyboard exit cleanly land the current destination', () => {
  for (const event of [{ type: 'resize' }, { type: 'pagehide' }, { type: 'wheel' }, { type: 'touchmove' }]) {
    const h = harness(); h.change('map'); h.tweens[0].advance(0.3); h.window.dispatchEvent(event); h.assertRestored('map'); assert(h.tweens[0].killed);
  }
  for (const key of ['Tab', 'Escape', 'PageDown', 'PageUp', 'Home', 'End']) {
    const h = harness(); h.change('collect'); h.document.dispatchEvent({ type: 'keydown', key }); h.assertRestored('collect');
  }
});
test('document visibility and focus leaving the row cancel without hiding content', () => {
  const h = harness(); h.change('map'); h.document.hidden = true; h.document.dispatchEvent({ type: 'visibilitychange' }); h.assertRestored('map');
  const focus = harness(); focus.document.activeElement = focus.buttons[4]; focus.change('profile');
  focus.document.activeElement = focus.views.profile;
  focus.document.dispatchEvent({ type: 'focusin', target: focus.views.profile }); focus.assertRestored('profile');
  assert.equal(focus.document.activeElement, focus.views.profile, 'cleanup must not steal focus back from the newly focused content');
});
test('modern and legacy motion preferences cancel safely', () => {
  for (const legacyMedia of [false, true]) {
    const h = harness({ legacyMedia }); h.change('collect'); h.reduced.matches = true; h.reduced.dispatchEvent({ type: 'change' }); h.assertRestored('collect');
    const mobile = harness({ legacyMedia }); mobile.change('map'); mobile.desktop.matches = false; mobile.desktop.dispatchEvent({ type: 'change' }); mobile.place('map'); mobile.assertRestored('map');
  }
});
test('a synchronous scroll-to-top notification is not mistaken for user scroll', () => {
  const h = harness(); h.change('map'); h.window.dispatchEvent({ type: 'scroll' }); assert.equal(h.nav.parentNode.className, 'paper-nav-flight');
  h.tweens[0].complete(); h.assertRestored('map');
});
test('unrelated inline changes made in transit are not rolled back', () => {
  const h = harness(); h.change('profile'); h.buttons[0].style.setProperty('--account-state', 'changed'); h.tweens[0].complete();
  assert.equal(h.buttons[0].style.getPropertyValue('--account-state'), 'changed');
  h.buttons[0].style.removeProperty('--account-state'); h.assertRestored('profile');
});
test('actual page bindings, load order, placement integration and release assets are preserved', () => {
  assert.equal((html.match(/id="app-navigation"/g) || []).length, 1);
  for (const tab of tabs) {
    assert.equal((html.match(new RegExp('id="nav-' + tab + '"', 'g')) || []).length, 1);
    assert(html.includes(`onclick="switchTab('${tab}')" id="nav-${tab}"`));
  }
  const gsap = html.indexOf('<script src="./static/assets/gsap-3.15.0.min.js"');
  const motion = html.indexOf('<script src="./static/navigation-motion.js"');
  assert(gsap >= 0 && motion > gsap, 'local GSAP must load first');
  assert(html.includes('<link rel="stylesheet" href="./static/navigation-motion.css">'));
  const owner = fs.readFileSync(path.join(root, 'static/discover-paper.js'), 'utf8');
  assert(owner.includes('ChuNavMotion.place'), 'existing placement owner delegates rather than introducing duplicate observers');
  for (const slot of Object.values(slotIds)) assert(html.includes(`id="${slot}"`), 'actual paper navigation slot is present: ' + slot);
  for (const file of ['tools/deploy-cloudbase.ps1', 'tools/validate-cloudbase-build.js']) {
    const manifest = fs.readFileSync(path.join(root, file), 'utf8');
    for (const asset of ['navigation-motion.js', 'navigation-motion.css']) assert(manifest.includes(asset), file + ' must include ' + asset);
  }
});

console.log(`Navigation motion: ${passed} checks passed.`);
