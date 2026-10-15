'use strict';

// Isolated, read-only visual study: no production account, backend or storage.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { start } = require('./lib/exploration-leaf-preview');
let checks = 0;
function check(value, description) { assert(value, description); checks++; }

(async () => {
  const server = await start();
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const out = path.join(__dirname, '../artifacts/exploration-leaf-demo');
  fs.mkdirSync(out, { recursive: true });
  const errors = [], requests = [], storageWrites = [];
  async function page(options = {}) {
    const p = await browser.newPage({ viewport: { width: 390, height: 900 }, ...options });
    p.on('pageerror', e => errors.push(e.message));
    p.on('request', r => requests.push({ url: r.url(), method: r.method() }));
    await p.exposeFunction('__storageWrite', (method, key) => storageWrites.push({ method, key }));
    await p.addInitScript(() => {
      for (const method of ['setItem', 'removeItem', 'clear']) {
        const original = Storage.prototype[method];
        Storage.prototype[method] = function (...args) {
          window.__storageWrite(method, args[0]);
          return original.apply(this, args);
        };
      }
    });
    return p;
  }
  const go = async p => {
    await p.goto(server.url + '/explore-leaf-demo.html');
    await p.locator('#scene-index button[data-scene=tower]').waitFor();
    await p.evaluate(() => document.fonts.ready);
  };
  const open = async (p, scene = 'tower') => {
    await p.locator('#scene-index button[data-scene=' + scene + ']').click();
    await p.locator('#scene-leaf[open][data-state=open][data-scene=' + scene + ']').waitFor();
  };
  const close = async p => {
    await p.locator('#leaf-close').click();
    await p.locator('#scene-leaf').waitFor({ state: 'hidden' });
  };
  const inside = async p => p.evaluate(() => document.querySelector('#scene-leaf').contains(document.activeElement));
  try {
    check((await fetch(server.url + '/explore-leaf-demo.html')).status === 200, 'static demo served');
    const head = await fetch(server.url + '/', { method: 'HEAD' });
    check(head.status === 200 && (await head.text()) === '', 'HEAD has no response body');
    check((await fetch(server.url + '/explore-leaf-demo.html', { method: 'POST' })).status === 405, 'preview rejects writes');
    for (const target of ['/admin.html', '/index.html', '/AGENTS.md', '/cloudbaserc.json', '/.git/config', '/static/../AGENTS.md', '/%2e%2e%2fAGENTS.md', '/%']) {
      check((await fetch(server.url + target)).status === 404, 'preview rejects unrelated path ' + target);
    }
    const p = await page();
    await go(p);
    check(await p.locator('.scene-point').count() === 4, 'four painted scene hit areas');
    check(await p.locator('#scene-index button[data-scene]').count() === 4, 'four equivalent scene index entries');
    check(await p.locator('#scene-leaf').isHidden(), 'no unrequested opening');
    check(await p.locator('#leaf-world').count() === 1, 'one original artwork world');
    const motifs = new Set(), titles = new Set();
    for (const scene of ['tower', 'copper', 'baiyun', 'pond']) {
      await open(p, scene);
      check(await p.locator('#leaf-copy').isVisible(), 'readable body ' + scene);
      titles.add((await p.locator('#leaf-title').textContent()).trim());
      motifs.add(await p.locator('#leaf-motif').evaluate(e => e.innerHTML + '|' + e.getAttribute('style') + '|' + e.className));
      check(await inside(p), 'initial focus in leaf ' + scene);
      await p.screenshot({ path: path.join(out, 'leaf-' + scene + '-390.png') });
      await close(p);
      check(await p.locator('#scene-index button[data-scene=' + scene + ']').evaluate(e => e === document.activeElement), 'focus returns to scene ' + scene);
    }
    check(titles.size === 4, 'four contextual page titles');
    check(motifs.size === 4, 'four distinct paper edge motifs');
    // Exercise the artwork itself, not only its accessible equivalent index.
    await p.locator('.scene-point[data-scene=tower]').scrollIntoViewIfNeeded();
    await p.locator('.scene-point[data-scene=tower]').click();
    await p.locator('#scene-leaf[open][data-state=open][data-scene=tower]').waitFor();
    check(await p.locator('#leaf-title').textContent() === '黄鹤楼', 'painted hotspot opens matching paper');
    await close(p);
    check(await p.locator('.scene-point[data-scene=tower]').evaluate(e => e === document.activeElement), 'painted hotspot regains focus');
    await p.locator('#leaf-canvas').focus();
    const beforeArrow = await p.locator('#leaf-canvas').evaluate(e => e.scrollLeft);
    await p.keyboard.press('ArrowRight');
    check(await p.locator('#leaf-canvas').evaluate((e, before) => e.scrollLeft > before, beforeArrow), 'keyboard pans original art');
    const initialMotion = await p.locator('#scene-index button[data-scene=pond]').evaluate(e => {
      e.click();
      const dialog = document.querySelector('#scene-leaf');
      return { state: dialog.dataset.state, transform: getComputedStyle(dialog).transform };
    });
    check(initialMotion.state === 'opening' && initialMotion.transform !== 'none', 'normal mode has real opening transform');
    await p.locator('#scene-leaf[open][data-state=open]').waitFor();
    check(await p.locator('#scene-leaf').evaluate(e => getComputedStyle(e).transform === 'none'), 'opening settles without permanent transform');
    await close(p);
    await open(p);
    await p.locator('#leaf-return').focus();
    await p.keyboard.press('Tab');
    check(await inside(p), 'Tab stays inside paper');
    await p.locator('#leaf-close').focus();
    await p.keyboard.press('Shift+Tab');
    check(await inside(p), 'Shift Tab stays inside paper');
    await p.locator('#scene-index button').first().evaluate(e => e.focus());
    check(await inside(p), 'background controls inert');
    await p.keyboard.press('Escape');
    await p.locator('#scene-leaf').waitFor({ state: 'hidden' });
    check(await p.locator('#scene-index button[data-scene=tower]').evaluate(e => e === document.activeElement), 'Escape restores trigger focus');
    await open(p, 'pond');
    await p.mouse.click(2, 2);
    await p.locator('#scene-leaf').waitFor({ state: 'hidden' });
    check(await p.locator('#scene-index button[data-scene=pond]').evaluate(e => e === document.activeElement), 'backdrop closes and restores focus');

    for (const size of [{ width: 320, height: 780 }, { width: 390, height: 900 }, { width: 768, height: 900 }, { width: 1440, height: 960 }, { width: 667, height: 320 }]) {
      await p.setViewportSize(size);
      await p.evaluate(() => scrollTo(0, 0));
      await p.screenshot({ path: path.join(out, 'main-' + size.width + '.png'), fullPage: true });
      check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'page no horizontal overflow ' + size.width);
      check(await p.locator('#leaf-canvas').evaluate(e => e.scrollWidth > e.clientWidth || innerWidth >= 1200), 'small artwork is internally scrollable ' + size.width);
      check(await p.locator('#scene-index button[data-scene]').evaluateAll(es => es.every(e => { const r = e.getBoundingClientRect(); return r.width >= 44 && r.height >= 44; })), 'scene targets at least 44px ' + size.width);
      await open(p, 'tower');
      // The curled paper's decorative under-sheet intentionally extends a few pixels.
      // Check readable content instead of treating that clipped artwork as overflow.
      check(await p.locator('.leaf-body').evaluate(e => e.scrollWidth <= e.clientWidth + 1), 'leaf copy no horizontal overflow ' + size.width);
      check(await p.locator('#leaf-close').evaluate(e => { const r = e.getBoundingClientRect(); return r.width >= 44 && r.height >= 44 && r.top >= 0 && r.bottom <= innerHeight; }), 'close target and reach ' + size.width);
      check(await p.locator('#leaf-return').evaluate(e => { const r = e.getBoundingClientRect(); return r.height >= 44 && r.top >= 0 && r.bottom <= innerHeight; }), 'return target and reach ' + size.width);
      await p.screenshot({ path: path.join(out, 'leaf-responsive-' + size.width + '.png') });
      await p.locator('#leaf-copy').evaluate(e => { window.__originalLeafCopy = e.innerHTML; e.innerHTML += '<p>' + '长文排版测试，不是景区事实。'.repeat(150) + '</p>'; });
      check(await p.locator('#leaf-copy').evaluate(e => {
        for (let n = e; n && n.tagName !== 'DIALOG'; n = n.parentElement) {
          const style = getComputedStyle(n);
          if (/(auto|scroll)/.test(style.overflowY) && n.scrollHeight > n.clientHeight && n.clientHeight > 20) return true;
        }
        return false;
      }), 'long content has internal scroll ' + size.width);
      check(await p.locator('#leaf-close').evaluate(e => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }), 'long content keeps close reachable ' + size.width);
      check(await p.locator('#leaf-return').evaluate(e => e.getBoundingClientRect().bottom <= innerHeight), 'long content keeps return reachable ' + size.width);
      await p.locator('#leaf-copy').evaluate(e => { e.innerHTML = window.__originalLeafCopy; });
      await close(p);
    }

    await p.setViewportSize({ width: 390, height: 900 });
    // Close during opening, then repeatedly alternate; stale animations must not reopen a paper.
    for (const scene of ['tower', 'pond', 'baiyun']) {
      await p.locator('#scene-index button[data-scene=' + scene + ']').click();
      await p.keyboard.press('Escape');
      await p.locator('#scene-leaf').waitFor({ state: 'hidden' });
      await p.waitForTimeout(850);
      check(await p.locator('#scene-leaf').isHidden(), 'late animation never reopens ' + scene);
    }
    await open(p, 'copper');
    await p.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await p.waitForFunction(() => !document.querySelector('#scene-leaf').open || document.querySelector('#scene-leaf').dataset.state === 'open');
    check(await p.evaluate(() => !window.gsap || !gsap.globalTimeline.getChildren(true, true, true).some(t => t.isActive())), 'hidden page settles or cancels motion');
    await p.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    if (await p.locator('#scene-leaf').isVisible()) await close(p);
    await p.locator('#scene-index button[data-scene=tower]').click();
    await p.setViewportSize({ width: 768, height: 700 });
    await p.waitForFunction(() => !document.querySelector('#scene-leaf').open || document.querySelector('#scene-leaf').dataset.state === 'open');
    check(await p.evaluate(() => !document.querySelector('#scene-leaf').open || document.querySelector('#leaf-close').getBoundingClientRect().bottom <= innerHeight), 'resize during animation stays usable');
    if (await p.locator('#scene-leaf').isVisible()) await close(p);
    await p.close();

    const reduced = await page({ reducedMotion: 'reduce', viewport: { width: 320, height: 700 } });
    await go(reduced); await open(reduced, 'pond');
    check(await reduced.evaluate(() => !window.gsap || !gsap.globalTimeline.getChildren(true, true, true).some(t => t.isActive())), 'reduced motion no active tween');
    check(await reduced.locator('#scene-leaf').evaluate(e => !e.getAnimations({ subtree: true }).some(a => a.playState === 'running')), 'reduced motion no running CSS animation');
    await close(reduced); await reduced.close();

    const fallback = await page();
    await fallback.route('**/gsap-*.js', route => route.abort());
    await go(fallback); await open(fallback, 'baiyun');
    check(await fallback.locator('#leaf-copy').isVisible(), 'missing GSAP retains reading');
    await close(fallback); await fallback.close();

    const noArt = await page();
    await noArt.route('**/exploration-motion/*', route => /\.(webp|png|jpe?g|avif)(\?|$)/i.test(route.request().url()) ? route.abort() : route.continue());
    await go(noArt);
    await noArt.locator('#art-failure').waitFor();
    check(await noArt.locator('#art-failure').isVisible(), 'missing original art clearly explained');
    await open(noArt, 'tower');
    check(await noArt.locator('#leaf-copy').isVisible(), 'missing artwork still permits reading');
    await close(noArt); await noArt.close();

    check(storageWrites.length === 0, 'no storage writes');
    check(requests.every(r => r.url.startsWith(server.url + '/') || r.url.startsWith('data:')), 'no external network requests');
    check(requests.every(r => r.method === 'GET'), 'read-only static preview');
    check(errors.length === 0, 'no uncaught JavaScript errors: ' + JSON.stringify(errors));
    console.log('PASS scene paper demo: ' + checks + ' checks; four scenes/responsive/keyboard/motion interruption/reduced motion/fallback/isolation.');
  } finally { await browser.close(); await server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
