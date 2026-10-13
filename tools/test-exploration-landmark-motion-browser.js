'use strict';

// Real local browser rendering, never a CloudBase call or a mocked canvas.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { start } = require('./lib/exploration-motion-demo-preview');
const output = path.resolve(__dirname, '../artifacts/exploration-motion-demo');
const landmarks = [['copper', '古铜顶'], ['baiyun', '白云阁'], ['pond', '鹅池']];

(async () => {
  const server = await start();
  const contexts = [], errors = [], external = [];
  let browser, checks = 0;
  const record = (value, label) => { assert(value, label); checks++; };
  const ready = page => page.waitForFunction(() => document.querySelector('#motion-demo')?.dataset.phase === 'ready', undefined, { timeout: 15000 });
  const canvasFor = id => '#motion-' + id + '-canvas';
  async function pageAt(width = 390, options = {}) {
    const context = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 }, deviceScaleFactor: 1, ...options });
    contexts.push(context);
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const url = route.request().url();
      if (!url.startsWith(server.url + '/') && !/^(?:data|blob):/.test(url)) { external.push(url); return route.abort(); }
      return route.continue();
    });
    return page;
  }
  async function pixels(page, selector) {
    return page.locator(selector).evaluate(canvas => {
      const box = canvas.getBoundingClientRect(), style = getComputedStyle(canvas);
      const context = canvas.getContext('2d');
      const bytes = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const sums = [0, 0, 0, 0];
      let occupied = 0, gold = 0;
      for (let i = 0; i < bytes.length; i += 32) {
        for (let channel = 0; channel < 4; channel++) sums[channel] += bytes[i + channel];
        if (bytes[i + 3] > 12) occupied++;
        if (bytes[i + 3] > 50 && bytes[i] > 150 && bytes[i + 1] > 95 && bytes[i] > bytes[i + 2] * 1.25) gold++;
      }
      return { sums, occupied, gold, samples: Math.ceil(bytes.length / 32), profile: canvas.dataset.profile,
        phase: canvas.dataset.phase, progress: canvas.dataset.progress, width: canvas.width, height: canvas.height,
        box: [box.x, box.y, box.width, box.height], transform: style.transform, visible: style.visibility !== 'hidden' && style.display !== 'none' };
    });
  }
  // A few GPU readback values may round by one. Compare channel means instead
  // of a byte hash, which would mistake those rounding bits for animation.
  const delta = (a, b) => Math.max(...a.sums.map((sum, i) => Math.abs(sum / a.samples - b.sums[i] / b.samples) / 255));
  const still = (a, b) => a.phase === b.phase && a.progress === b.progress && delta(a, b) < .001;
  const sameBox = (a, b) => a.transform === b.transform && a.box.every((value, i) => Math.abs(value - b.box[i]) < .1);
  async function select(page, id) {
    await page.locator('[data-point="' + id + '"]').click();
    await page.waitForFunction(value => {
      const canvas = document.querySelector('#motion-' + value + '-canvas');
      return document.querySelector('#motion-demo').dataset.selected === value && canvas?.dataset.profile === value && canvas.width > 100;
    }, id);
  }
  async function study(page, id) {
    await page.locator('#motion-study').click();
    await page.waitForFunction(value => document.querySelector('#motion-study-dialog').open && document.querySelector('#motion-study-canvas').dataset.profile === value, id);
  }
  async function background(page, hidden) {
    await page.evaluate(value => {
      if (value) {
        Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      } else { delete document.hidden; delete document.visibilityState; }
      document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);
  }
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    fs.mkdirSync(output, { recursive: true });
    const live = await pageAt();
    await live.goto(server.url); await ready(live);
    const measurements = {};
    for (const [id, title] of landmarks) {
      await select(live, id);
      const began = Date.now(), frames = [];
      for (const target of [300, 1450, 3500, 6700]) {
        const wait = target - (Date.now() - began);
        if (wait > 0) await live.waitForTimeout(wait);
        frames.push(await pixels(live, canvasFor(id)));
        await live.screenshot({ path: path.join(output, 'landmark-' + id + '-' + target + 'ms-390.png') });
      }
      measurements[id] = frames;
      record(frames.every(frame => frame.profile === id && frame.occupied > 0 && frame.visible), title + ' paints its own visible canvas through every stage');
      record(frames.every(frame => sameBox(frames[0], frame)), title + ' remains registered at the same position and size');
      record(frames.filter((frame, i) => i && delta(frame, frames[i - 1]) > .003).length >= 2, title + ' has genuine contour and color pixel progression');
      record(frames.some(frame => frame.gold > 8), title + ' includes visible warm gold strokes');
      record(frames.at(-1).phase === 'settled', title + ' finishes as a stable illustration');
      await study(live, id);
      record((await live.locator('#motion-study-title').textContent()).includes(title), title + ' detail names the chosen landmark');
      await live.waitForTimeout(1100);
      const before = await pixels(live, '#motion-study-canvas');
      await live.waitForTimeout(1250);
      const after = await pixels(live, '#motion-study-canvas');
      record(before.profile === id && after.profile === id && delta(before, after) > .004, title + ' detail animates its own illustration');
      record(sameBox(before, after), title + ' detail does not grow or translate');
      await live.screenshot({ path: path.join(output, 'landmark-' + id + '-study-390.png') });
      await background(live, true); await live.waitForTimeout(80);
      const hidden = await pixels(live, '#motion-study-canvas');
      await live.waitForTimeout(280);
      record(still(hidden, await pixels(live, '#motion-study-canvas')), title + ' detail stops in background');
      await background(live, false); await live.waitForTimeout(300);
      record(!still(hidden, await pixels(live, '#motion-study-canvas')), title + ' detail resumes in foreground');
      await live.locator('#motion-study-close').click(); await live.waitForTimeout(70);
      const closed = await pixels(live, '#motion-study-canvas');
      await live.waitForTimeout(280);
      record(still(closed, await pixels(live, '#motion-study-canvas')), title + ' detail stops after closing');
    }
    fs.writeFileSync(path.join(output, 'landmark-motion-measurements.json'), JSON.stringify(measurements, null, 2));

    await live.evaluate(() => { for (const id of ['copper', 'pond', 'baiyun', 'copper', 'pond']) document.querySelector('[data-point="' + id + '"]').click(); });
    await live.waitForTimeout(600);
    record(await live.locator('#motion-demo').getAttribute('data-selected') === 'pond' && (await live.locator('#motion-title').textContent()).includes('鹅池'), 'rapid selection keeps final landmark and text');
    await study(live, 'pond');
    await live.locator('#motion-study-replay').click(); await live.locator('#motion-study-replay').click(); await live.locator('#motion-study-replay').click();
    await live.waitForTimeout(6700);
    const replayed = await pixels(live, '#motion-study-canvas'); await live.waitForTimeout(240);
    record(replayed.profile === 'pond' && replayed.phase === 'settled' && still(replayed, await pixels(live, '#motion-study-canvas')), 'rapid replays settle once with correct pond content');
    await live.locator('#motion-study-replay').click(); await live.waitForTimeout(350);
    await live.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
    for (const [id] of landmarks) record(await live.locator(canvasFor(id)).getAttribute('data-phase') === 'destroyed', 'pagehide disposes ' + id + ' inline renderer');
    record(await live.locator('#motion-study-canvas').getAttribute('data-phase') === 'destroyed', 'pagehide disposes current landmark detail');
    await live.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await live.waitForFunction(() => document.querySelector('#motion-study-canvas').dataset.phase !== 'destroyed' && document.querySelector('#motion-study-canvas').dataset.profile === 'pond');
    record((await pixels(live, '#motion-study-canvas')).occupied > 0, 'persisted page restores matching pond detail');
    await live.locator('#motion-study-close').click(); await live.close();

    for (const width of [320, 390, 768, 1440]) {
      const page = await pageAt(width, { reducedMotion: 'reduce' });
      await page.goto(server.url); await ready(page);
      for (const [id, title] of landmarks) {
        await select(page, id); await study(page, id); await page.waitForTimeout(80);
        const first = await pixels(page, '#motion-study-canvas'); await page.waitForTimeout(90);
        record(first.profile === id && first.occupied > 100 && still(first, await pixels(page, '#motion-study-canvas')), title + ' reduced motion renders a stable image at ' + width);
        record((await page.locator('#motion-study-title').textContent()).includes(title), title + ' title matches at ' + width);
        record(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), title + ' does not overflow at ' + width);
        const small = await page.locator('#motion-study-dialog button').evaluateAll(nodes => nodes.filter(node => { const b = node.getBoundingClientRect(); return b.width && b.height && (b.width < 43.5 || b.height < 43.5); }).map(node => node.id));
        record(small.length === 0, title + ' detail buttons retain 44px at ' + width);
        await page.screenshot({ path: path.join(output, 'landmark-' + id + '-reduced-' + width + '.png') });
        await page.locator('#motion-study-close').click();
      }
      await page.close();
    }

    // A late copper decode must not overwrite a newer Baiyun selection or study.
    const slow = await pageAt(390, { reducedMotion: 'reduce' });
    let releaseCopper;
    const gate = new Promise(resolve => { releaseCopper = resolve; });
    await slow.route('**/hhl-copper-v1.webp', async route => { await gate; await route.continue().catch(() => {}); });
    await slow.goto(server.url, { waitUntil: 'domcontentloaded' }); await ready(slow);
    await slow.locator('[data-point="copper"]').click();
    await slow.locator('#motion-study').click();
    await slow.locator('#motion-study-close').click();
    await select(slow, 'baiyun'); await study(slow, 'baiyun');
    releaseCopper(); await slow.waitForTimeout(550);
    record((await pixels(slow, '#motion-study-canvas')).profile === 'baiyun' && (await slow.locator('#motion-study-title').textContent()).includes('白云阁'), 'out-of-order copper artwork cannot replace the selected Baiyun study');
    record(await slow.locator(canvasFor('copper')).getAttribute('data-paused') === 'true', 'late copper renderer stays paused behind another study');
    await slow.locator('#motion-study-close').click(); await slow.close();

    for (const [id, title] of landmarks) {
      const failed = await pageAt(390, { reducedMotion: 'reduce' });
      await failed.route('**/hhl-' + (id === 'pond' ? 'ground' : id) + '-v1.webp', route => route.abort());
      await failed.goto(server.url); await ready(failed);
      await failed.locator('[data-point="' + id + '"]').click();
      await failed.locator('#motion-study').click();
      await failed.locator('#motion-study-error').waitFor({ state: 'visible' });
      record((await failed.locator('#motion-study-error').textContent()).trim().length > 0, title + ' missing illustration gives a useful message');
      await failed.locator('#motion-study-close').click();
      await select(failed, 'tower'); await study(failed, 'tower');
      record(!await failed.locator('#motion-study-error').isVisible() && (await pixels(failed, '#motion-study-canvas')).occupied > 0, title + ' image failure does not poison the next available illustration');
      await failed.locator('#motion-study-close').click(); await failed.close();
    }

    const noEngine = await pageAt(390);
    await noEngine.route('**/gsap-3.15.0.min.js', route => route.abort());
    await noEngine.goto(server.url); await ready(noEngine);
    for (const [id, title] of landmarks) {
      await select(noEngine, id); await study(noEngine, id); await noEngine.waitForTimeout(100);
      const first = await pixels(noEngine, '#motion-study-canvas'); await noEngine.waitForTimeout(120);
      record(first.profile === id && first.occupied > 100 && still(first, await pixels(noEngine, '#motion-study-canvas')), title + ' remains readable without the animation library');
      await noEngine.locator('#motion-study-close').click();
    }
    await noEngine.close();

    const park = await pageAt(); await park.goto(server.url); await ready(park);
    await park.locator('#motion-park').click();
    for (const [id, title] of landmarks) {
      await park.locator('[data-park-point="' + id + '"]').click();
      await park.waitForFunction(value => document.querySelector('#park-motion-canvas')?.dataset.profile === value, id);
      await park.waitForTimeout(350); const before = await pixels(park, '#park-motion-canvas');
      await park.waitForTimeout(1350); const after = await pixels(park, '#park-motion-canvas');
      record(before.profile === id && after.profile === id && delta(before, after) > .003, title + ' also animates in the expanded park');
      record(sameBox(before, after), title + ' remains fixed in the expanded painting');
      record((await park.locator('#park-point-title').textContent()).includes(title), title + ' expanded map retains matching content');
      await park.screenshot({ path: path.join(output, 'landmark-' + id + '-park-390.png') });
    }
    const unfinished = park.locator('[data-park-point][data-illustrated="false"]').first();
    await unfinished.click();
    record(/(?:补绘|草图|未完成|待补)/.test(await park.locator('#park-point-copy').textContent()), 'unfinished park objects retain an honest artwork notice');
    record(await park.locator('#park-motion-canvas').evaluate(canvas => canvas.hidden || getComputedStyle(canvas).display === 'none' || getComputedStyle(canvas).visibility === 'hidden'), 'unfinished park point does not display an unrelated landmark animation');
    await park.locator('#motion-park-close').click(); await park.close();

    record(errors.length === 0, 'no browser exceptions: ' + errors.join('; '));
    record(external.length === 0, 'all landmark rendering stays local: ' + external.join('; '));
    console.log('PASS landmark motion: ' + checks + ' checks; copper, Baiyun and pond pixels, lifecycle, slow loading and four viewport screenshots.');
  } finally {
    for (const context of contexts) await context.close().catch(() => {});
    if (browser) await browser.close();
    await server.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
