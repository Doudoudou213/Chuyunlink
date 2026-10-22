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
  const cleanMotion = async p => p.evaluate(() => {
    const surfaces = document.querySelectorAll('#scene-leaf,.leaf-plane,#leaf-motif,.leaf-head,.leaf-body,.leaf-foot,#leaf-demo-note,.leaf-light,.leaf-shade,#leaf-veil');
    return [...surfaces].every(e => !e.style.transform && !e.style.willChange) &&
      (!window.gsap || !gsap.globalTimeline.getChildren(true, true, true).some(t => t.isActive()));
  });
  try {
    check((await fetch(server.url + '/explore-leaf-demo.html')).status === 200, 'static demo served');
    const motionModule = await fetch(server.url + '/static/exploration-leaf-motion.js');
    check(motionModule.status === 200 && /javascript/.test(motionModule.headers.get('content-type')), 'isolated motion module served by explicit allowlist');
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

    await p.setViewportSize({ width: 1440, height: 960 });
    const arrival = await p.evaluate(() => new Promise(resolve => {
      const dialog = document.querySelector('#scene-leaf'), sheet = document.querySelector('.leaf-plane'), light = document.querySelector('.leaf-light'), frames = [];
      const samplePose = () => {
        const r = dialog.getBoundingClientRect();
        frames.push({ x: r.left + r.width / 2, y: r.top + r.height / 2, fold: getComputedStyle(sheet).transform, light: +getComputedStyle(light).opacity });
      };
      document.querySelector('#scene-index button[data-scene=tower]').click();
      samplePose();
      function sample() {
        samplePose();
        if (dialog.dataset.state === 'open') { resolve(frames); return; }
        requestAnimationFrame(sample);
      }
      requestAnimationFrame(sample);
    }));
    const firstPose = arrival[0], finalPose = arrival.at(-1), flightX = finalPose.x - firstPose.x, flightY = finalPose.y - firstPose.y;
    const curveDistance = Math.max(...arrival.map(f => Math.abs(flightX * (f.y - firstPose.y) - flightY * (f.x - firstPose.x)) / Math.hypot(flightX, flightY)));
    check(curveDistance > 8, 'paper follows a lifted arc rather than straight card translation');
    check(arrival.some(f => f.fold.startsWith('matrix3d(')), 'paper plane has a transient perspective fold');
    check(arrival.some(f => f.light > .15), 'paper edge receives a restrained travelling light');
    check(await p.locator('#leaf-art').count() === 1 && await p.locator('.leaf-plane').count() === 1, 'choreography moves the same paper without cloning art overlays');
    check(await cleanMotion(p), 'arrival ends in a quiet static reading state');
    await close(p);
    await p.setViewportSize({ width: 390, height: 900 });

    // Sample the same JS event turn before and after cancellation. Waiting only for
    // the final closed state misses a transform reset that visibly teleports a leaf.
    for (const elapsed of [90, 370, 760]) {
      const interruption = await p.evaluate(elapsed => new Promise(resolve => {
        const dialog = document.querySelector('#scene-leaf'), sheet = document.querySelector('.leaf-plane'), veil = document.querySelector('#leaf-veil');
        const pose = () => {
          const r = dialog.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height, opacity: +getComputedStyle(dialog).opacity, veil: +getComputedStyle(veil).opacity,
            sheet: getComputedStyle(sheet).transform, state: dialog.dataset.state };
        };
        document.querySelector('#scene-index button[data-scene=tower]').click();
        const start = performance.now();
        function sample(now) {
          if (now - start < elapsed) { requestAnimationFrame(sample); return; }
          const before = pose();
          document.querySelector('#leaf-close').click();
          resolve({ before, after: pose() });
        }
        requestAnimationFrame(sample);
      }), elapsed);
      check(interruption.before.state === 'opening' && interruption.after.state === 'closing', 'early close interrupts active opening at ' + elapsed + 'ms');
      check(['x', 'y', 'width', 'height'].every(k => Math.abs(interruption.before[k] - interruption.after[k]) < 1), 'closing preserves current paper pose without teleport at ' + elapsed + 'ms');
      check(Math.abs(interruption.before.opacity - interruption.after.opacity) < .01 && Math.abs(interruption.before.veil - interruption.after.veil) < .01, 'closing preserves paper and backdrop brightness at ' + elapsed + 'ms');
      check(interruption.before.sheet === interruption.after.sheet, 'closing preserves current paper fold at ' + elapsed + 'ms');
      await p.locator('#scene-leaf').waitFor({ state: 'hidden' });
      check(await cleanMotion(p), 'interrupted close removes transient animation state at ' + elapsed + 'ms');
    }

    await open(p, 'pond');
    const returnFlight = await p.evaluate(() => new Promise(resolve => {
      const dialog = document.querySelector('#scene-leaf');
      const mark = document.querySelector('.scene-point[data-scene=pond]').getBoundingClientRect();
      const target = { x: mark.left + mark.width / 2, y: mark.top + mark.height / 2 };
      const originalWidth = dialog.getBoundingClientRect().width, frames = [];
      document.querySelector('#leaf-return').click();
      function sample() {
        if (!dialog.open) { resolve({ target, originalWidth, frames }); return; }
        const r = dialog.getBoundingClientRect();
        frames.push({ x: r.left + r.width / 2, y: r.top + r.height / 2, width: r.width, opacity: +getComputedStyle(dialog).opacity });
        requestAnimationFrame(sample);
      }
      requestAnimationFrame(sample);
    }));
    check(returnFlight.frames.length > 3, 'return flight has intermediate visual poses');
    const landed = returnFlight.frames.at(-1);
    check(Math.hypot(landed.x - returnFlight.target.x, landed.y - returnFlight.target.y) < 16, 'return flight converges on actual painted hotspot');
    check(landed.width / returnFlight.originalWidth < .16, 'return flight folds down toward the point rather than fading a large card');
    check(await cleanMotion(p), 'completed return removes all temporary animation transforms');

    // Programmatic re-entry exercises a stale timeline race without making the
    // intentionally inert background interactive for real users.
    await open(p, 'tower');
    await p.locator('#leaf-close').evaluate(e => e.click());
    await p.waitForTimeout(120);
    await p.locator('#scene-index button[data-scene=baiyun]').evaluate(e => e.click());
    await p.locator('#scene-leaf[open][data-state=open][data-scene=baiyun]').waitFor();
    await p.waitForTimeout(300);
    check(await p.locator('#scene-leaf[open][data-scene=baiyun]').isVisible(), 'interrupted return cannot close a newly opened scene');
    check(await p.locator('#leaf-title').textContent() === '白云阁', 're-entry shows only new scene content');
    check(await cleanMotion(p), 're-entry settles both paper and internal surfaces');
    await close(p);

    await p.locator('#scene-index button[data-scene=tower]').evaluate(e => e.click());
    await p.waitForTimeout(130);
    await p.emulateMedia({ reducedMotion: 'reduce' });
    await p.locator('#scene-leaf[open][data-state=open]').waitFor();
    check(await cleanMotion(p), 'changing reduced motion during opening settles every surface');
    check(await p.locator('#leaf-copy').isVisible(), 'changing motion preference retains readable paper');
    await close(p);
    await p.emulateMedia({ reducedMotion: 'no-preference' });
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
      check(await p.locator('#scene-index button[data-scene]').evaluateAll(es => es.every(e => {
        const range = document.createRange(); range.selectNodeContents(e.firstChild);
        return range.getBoundingClientRect().height < parseFloat(getComputedStyle(e).lineHeight) * 1.3;
      })), 'scene names remain on one line ' + size.width);
      await open(p, 'tower');
      // Only the reading region scrolls; the paper header and closing controls
      // remain reachable even when the viewport is short or the copy grows.
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
      await p.locator('#leaf-title').evaluate(e => { window.__originalLeafTitle = e.textContent; e.textContent = '长标题布局测试'.repeat(12); });
      check(await p.locator('#leaf-close').evaluate(e => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }), 'long heading keeps close reachable ' + size.width);
      check(await p.locator('#leaf-return').evaluate(e => e.getBoundingClientRect().bottom <= innerHeight), 'long heading keeps return reachable ' + size.width);
      await p.locator('#leaf-title').evaluate(e => { e.textContent = window.__originalLeafTitle; });
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
    check(await cleanMotion(p), 'background transition clears every transient paper layer');
    await p.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    if (await p.locator('#scene-leaf').isVisible()) await close(p);
    await p.locator('#scene-index button[data-scene=tower]').click();
    await p.setViewportSize({ width: 768, height: 700 });
    await p.waitForFunction(() => !document.querySelector('#scene-leaf').open || document.querySelector('#scene-leaf').dataset.state === 'open');
    check(await p.evaluate(() => !document.querySelector('#scene-leaf').open || document.querySelector('#leaf-close').getBoundingClientRect().bottom <= innerHeight), 'resize during animation stays usable');
    check(await cleanMotion(p), 'resize during opening settles internal layers and backdrop hints');
    if (await p.locator('#scene-leaf').isVisible()) await close(p);
    await open(p, 'pond');
    await p.locator('#leaf-close').evaluate(e => e.click());
    await p.setViewportSize({ width: 390, height: 900 });
    await p.locator('#scene-leaf').waitFor({ state: 'hidden' });
    check(await cleanMotion(p), 'resize during return fully finishes and clears motion');
    check(await p.evaluate(() => !document.documentElement.classList.contains('leaf-is-open')), 'resize during return releases document scroll lock');
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

    const noMotion = await page();
    await noMotion.route('**/exploration-leaf-motion.js', route => route.abort());
    await go(noMotion); await open(noMotion, 'pond');
    check(await noMotion.locator('#leaf-copy').isVisible(), 'missing isolated motion module retains reading');
    check(await noMotion.locator('#scene-leaf').evaluate(e => getComputedStyle(e).transform === 'none'), 'missing isolated motion module opens without partial transform');
    await close(noMotion);
    check(await noMotion.evaluate(() => !document.documentElement.classList.contains('leaf-is-open')), 'missing motion module still unlocks page on close');
    await noMotion.close();

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
