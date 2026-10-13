'use strict';

// Runs against the isolated artwork server. No CloudBase, paid service or user data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { start } = require('./lib/exploration-motion-demo-preview');
const output = path.resolve(__dirname, '../artifacts/exploration-motion-demo');

(async () => {
  const local = await start();
  const contexts = [];
  const pageErrors = [], external = [], failures = [];
  let browser, checks = 0;
  const record = (value, label) => { assert(value, label); checks++; };
  const phase = page => page.waitForFunction(() => document.querySelector('#motion-demo')?.dataset.phase === 'ready', undefined, { timeout: 15000 });
  const imageState = page => page.locator('#motion-study-canvas').evaluate(canvas => {
    const box = canvas.getBoundingClientRect();
    const ctx = canvas.getContext('2d');
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 2166136261, occupied = 0, gold = 0;
    const channels = [0, 0, 0, 0];
    for (let i = 0; i < data.length; i += 64) {
      hash = Math.imul(hash ^ data[i], 16777619);
      hash = Math.imul(hash ^ data[i + 1], 16777619);
      hash = Math.imul(hash ^ data[i + 2], 16777619);
      hash = Math.imul(hash ^ data[i + 3], 16777619);
      for (let channel = 0; channel < 4; channel++) channels[channel] += data[i + channel];
      if (data[i + 3] > 12) occupied++;
      if (data[i + 3] > 50 && data[i] > 140 && data[i + 1] > 90 && data[i] > data[i + 2] * 1.2) gold++;
    }
    return { hash: hash >>> 0, occupied, gold, channels, samples: Math.ceil(data.length / 64), width: canvas.width, height: canvas.height,
      rect: { x: box.x, y: box.y, width: box.width, height: box.height },
      transform: getComputedStyle(canvas).transform, phase: canvas.dataset.phase || '', progress: canvas.dataset.progress || '' };
  });
  // Edge's GPU->CPU readback can round a minority of channels by one between
  // identical getImageData calls. Require identical phase/progress and <0.1%
  // channel-mean drift instead of treating those rounding bits as animation.
  const pixelDelta = (a, b) => Math.max(...a.channels.map((sum, index) => Math.abs(sum - b.channels[index]) / (a.samples * 255)));
  const samePixels = (a, b) => a.width === b.width && a.height === b.height && a.phase === b.phase && a.progress === b.progress && pixelDelta(a, b) < .001;
  const sameBox = (a, b) => Object.keys(a.rect).every(key => Math.abs(a.rect[key] - b.rect[key]) < .1) && a.transform === b.transform;
  async function pageAt(width, options = {}) {
    const context = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 }, deviceScaleFactor: 1, ...options });
    contexts.push(context);
    const page = await context.newPage();
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.route('**/*', route => {
      const url = route.request().url();
      if (!url.startsWith(local.url + '/') && !/^(?:data|blob):/.test(url)) { external.push(url); return route.abort(); }
      return route.continue();
    });
    return page;
  }
  async function openStudy(page) {
    await page.locator('#motion-study').click();
    await page.waitForFunction(() => {
      const canvas = document.querySelector('#motion-study-canvas');
      return document.querySelector('#motion-study-dialog').open && canvas.width > 0 && canvas.height > 0;
    });
  }
  function visibleTargets(page, scope) {
    return page.locator(scope + ' button').evaluateAll(nodes => nodes.filter(node => {
      const box = node.getBoundingClientRect();
      return box.width && box.height && (box.width < 43.5 || box.height < 43.5);
    }).map(node => node.id || node.dataset.parkPoint));
  }
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    fs.mkdirSync(output, { recursive: true });
    for (const width of [320, 390, 768, 1440]) {
      const page = await pageAt(width, { reducedMotion: 'reduce' });
      await page.goto(local.url); await phase(page);
      await openStudy(page); await page.waitForTimeout(200);
      const still = await imageState(page);
      record(still.occupied > 100 && still.width > 100 && still.height > 100, 'reduced motion renders a genuine tower image at ' + width);
      const next = await imageState(page);
      record(sameBox(still, next) && samePixels(still, next), 'reduced motion stays still at ' + width);
      record((await visibleTargets(page, '#motion-study-dialog')).length === 0, 'study controls retain 44px at ' + width);
      record(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'study does not overflow the page at ' + width);
      await page.screenshot({ path: path.join(output, 'gilded-study-' + width + '.png'), fullPage: true });
      await page.locator('#motion-study-close').click();
      record(await page.evaluate(() => document.activeElement === document.querySelector('#motion-study')), 'study returns focus at ' + width);

      await page.locator('#motion-park').click();
      record(await page.locator('#motion-park-dialog').evaluate(node => node.open), 'park overview opens at ' + width);
      await page.locator('#park-art').evaluate(async image => { await image.decode(); });
      record(await page.locator('#park-art').evaluate(image => image.naturalWidth > 100 && image.naturalHeight > 100), 'full-park artwork is decoded at ' + width);
      const pointCount = await page.locator('[data-park-point]').count();
      record(pointCount >= 10, 'park overview includes more than the four motion specimens at ' + width);
      record((await visibleTargets(page, '#motion-park-dialog')).length === 0, 'park controls retain 44px at ' + width);
      const park = page.locator('#motion-park-stage');
      record(await park.evaluate(node => node.scrollWidth > node.clientWidth || node.scrollHeight > node.clientHeight), 'large park is a navigable viewport at ' + width);
      if (width === 1440) await page.screenshot({ path: path.join(output, 'full-park-overview-1440.png'), fullPage: true });
      await page.locator('[data-park-point]').last().click();
      record((await page.locator('#park-point-title').textContent()).trim().length > 0, 'park selection gives matching text at ' + width);
      record(/(?:草图|示意|待核|核实|导航)/.test(await page.locator('#motion-park-dialog').textContent()), 'park layout distinguishes research from live navigation at ' + width);
      record(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'large park does not overflow the page at ' + width);
      await page.screenshot({ path: path.join(output, 'full-park-' + width + '.png'), fullPage: true });
      if (width === 390) {
        await park.focus(); await page.keyboard.press('Home');
        await page.keyboard.press('ArrowRight');
        record(await park.evaluate(node => node.scrollLeft) > 0, 'keyboard explores the larger park');
        await page.keyboard.press('Home');
        record(await park.evaluate(node => node.scrollLeft === 0 && node.scrollTop === 0), 'park Home key restores the beginning');
        const pointBeforeDrag = await page.locator('#motion-park-world').getAttribute('data-selected');
        const box = await park.boundingBox();
        await page.mouse.move(box.x + box.width * .7, box.y + box.height * .55);
        await page.mouse.down(); await page.mouse.move(box.x + box.width * .3, box.y + box.height * .5, { steps: 8 }); await page.mouse.up();
        record(await park.evaluate(node => node.scrollLeft) > 40, 'mouse dragging explores the larger park');
        record(await page.locator('#motion-park-world').getAttribute('data-selected') === pointBeforeDrag, 'park drag does not select a different landmark');
      }
      await page.keyboard.press('Escape');
      record(!await page.locator('#motion-park-dialog').evaluate(node => node.open), 'Escape closes park at ' + width);
      record(await page.evaluate(() => document.activeElement === document.querySelector('#motion-park')), 'park returns focus at ' + width);
      await page.close();
    }

    const live = await pageAt(390);
    await live.goto(local.url); await phase(live);
    await live.waitForTimeout(6700);
    await live.screenshot({ path: path.join(output, 'initial-settled-390.png'), fullPage: true });
    await openStudy(live);
    await live.locator('#motion-study-replay').click();
    const started = Date.now(), frames = [];
    for (const target of [250, 1200, 3200, 6500]) {
      const wait = target - (Date.now() - started);
      if (wait > 0) await live.waitForTimeout(wait);
      frames.push({ milliseconds: target, ...(await imageState(live)) });
      await live.screenshot({ path: path.join(output, 'gilded-frame-' + target + 'ms-390.png') });
    }
    record(frames.every(frame => sameBox(frames[0], frame)), 'tower canvas stays at the same position and scale throughout the reveal');
    record(frames.filter((frame, index) => index && pixelDelta(frames[index - 1], frame) > .005).length >= 2, 'tracing and pigment stages actually paint distinct pixels');
    record(frames.every(frame => frame.occupied > 0), 'none of the drawing phases is an empty canvas');
    record(frames.some(frame => frame.gold > 20), 'the reveal contains warm gilded strokes');
    fs.writeFileSync(path.join(output, 'gilded-frame-measurements.json'), JSON.stringify(frames, null, 2));

    await live.locator('#motion-study-replay').click(); await live.waitForTimeout(800);
    await live.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await live.waitForTimeout(80);
    const hidden = await imageState(live); await live.waitForTimeout(500);
    record(samePixels(await imageState(live), hidden), 'backgrounding pauses actual canvas drawing');
    await live.evaluate(() => {
      delete document.hidden; delete document.visibilityState;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await live.waitForTimeout(450);
    record(!samePixels(await imageState(live), hidden), 'foregrounding resumes drawing');

    await live.locator('#motion-study-replay').click(); await live.waitForTimeout(600);
    await live.locator('#motion-study-close').click(); await live.waitForTimeout(100);
    const closed = await imageState(live); await live.waitForTimeout(500);
    record(samePixels(await imageState(live), closed), 'closed study does not keep drawing offscreen');
    await openStudy(live); await live.waitForTimeout(500);
    record((await imageState(live)).occupied > 0, 'reopening a canceled study remains usable');
    await live.locator('#motion-study-replay').click();
    await live.locator('#motion-study-replay').click();
    await live.locator('#motion-study-replay').click();
    await live.waitForTimeout(6700);
    const settled = await imageState(live); await live.waitForTimeout(250);
    record(samePixels(await imageState(live), settled), 'repeated replay settles into one completed drawing');
    await live.locator('#motion-study-replay').click(); await live.waitForTimeout(600);
    await live.emulateMedia({ reducedMotion: 'reduce' }); await live.waitForTimeout(100);
    const reduced = await imageState(live); await live.waitForTimeout(350);
    record(samePixels(await imageState(live), reduced), 'enabling reduced motion during playback stops decorative drawing');
    await live.emulateMedia({ reducedMotion: 'no-preference' });
    await live.locator('#motion-study-replay').click(); await live.waitForTimeout(350);
    // Simulate lifecycle dispatch, rather than claiming a physical-device BFCache test.
    await live.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
    record(await live.locator('#motion-study-canvas').getAttribute('data-phase') === 'destroyed', 'pagehide disposes the study renderer');
    record(await live.locator('#motion-tower-canvas').getAttribute('data-phase') === 'destroyed', 'pagehide disposes the inline renderer');
    await live.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await live.waitForTimeout(500);
    record(await live.locator('#motion-study-canvas').getAttribute('data-phase') !== 'destroyed' && (await imageState(live)).occupied > 0, 'persisted-page restore rebuilds an open study');
    await live.locator('#motion-study-close').click();
    await live.close();

    const noEngine = await pageAt(390, { reducedMotion: 'reduce' });
    await noEngine.route('**/gsap-3.15.0.min.js', route => route.abort());
    await noEngine.goto(local.url); await phase(noEngine);
    await noEngine.locator('[data-point="pond"]').click();
    record((await noEngine.locator('#motion-title').textContent()).includes('鹅池'), 'missing animation library keeps map selection usable');
    await openStudy(noEngine); await noEngine.waitForTimeout(200);
    record((await imageState(noEngine)).occupied > 0, 'missing animation library retains a static tower');
    await noEngine.locator('#motion-study-close').click(); await noEngine.close();

    const slow = await pageAt(390);
    let releaseTower;
    const towerGate = new Promise(resolve => { releaseTower = resolve; });
    await slow.route('**/hhl-tower-v1.webp', async route => { await towerGate; return route.continue(); });
    await slow.goto(local.url, { waitUntil: 'domcontentloaded' }); await phase(slow);
    await slow.locator('#motion-park').click();
    record(await slow.locator('#motion-park-dialog').evaluate(node => node.open), 'slow tower artwork does not block opening the park');
    releaseTower();
    await slow.waitForFunction(() => document.querySelector('#motion-tower-canvas').dataset.phase === 'settled');
    record(await slow.locator('#motion-tower-canvas').getAttribute('data-paused') === 'true', 'late artwork remains paused behind an open park');
    await slow.locator('#motion-park-close').click();
    record(await slow.locator('#motion-tower-canvas').getAttribute('data-paused') === 'false', 'returning from the park restores the late-loaded renderer');
    await slow.close();

    for (const missing of ['**/hhl-tower-v1.webp', '**/exploration-gilded-reveal.js']) {
      const failed = await pageAt(390, { reducedMotion: 'reduce' });
      await failed.route(missing, route => route.abort());
      await failed.goto(local.url); await phase(failed);
      await failed.locator('#motion-study').click();
      await failed.locator('#motion-study-error').waitFor({ state: 'visible' });
      record((await failed.locator('#motion-study-error').textContent()).trim().length > 0, 'failed study asset explains the problem: ' + missing);
      await failed.locator('#motion-study-replay').click();
      record(await failed.locator('#motion-study-error').isVisible(), 'failed replay retains a useful explanation: ' + missing);
      await failed.locator('#motion-study-close').click();
      await failed.locator('[data-point="pond"]').click();
      record((await failed.locator('#motion-title').textContent()).includes('鹅池'), 'failed study does not break the map: ' + missing);
      await failed.close();
    }

    if (process.argv.includes('--record')) {
      // Record actual live canvas frames. The matte only fills transparent pixels;
      // it does not invent, interpolate or replace the renderer's animation.
      const capture = await pageAt(390);
      await capture.goto(local.url); await phase(capture); await openStudy(capture);
      await capture.waitForTimeout(1000);
      const canRecord = await capture.evaluate(() => typeof MediaRecorder === 'function' && typeof HTMLCanvasElement.prototype.captureStream === 'function');
      record(canRecord, 'browser supports recording real canvas frames');
      await capture.evaluate(() => {
        const source = document.querySelector('#motion-study-canvas');
        const matte = document.createElement('canvas');
        const ratio = Math.min(1, 768 / source.width);
        matte.width = Math.round(source.width * ratio); matte.height = Math.round(source.height * ratio);
        const ctx = matte.getContext('2d');
        let frame, stopped = false;
        function draw() {
          ctx.fillStyle = '#19221e'; ctx.fillRect(0, 0, matte.width, matte.height);
          ctx.drawImage(source, 0, 0, matte.width, matte.height);
          if (!stopped) frame = requestAnimationFrame(draw);
        }
        draw();
        const stream = matte.captureStream(30);
        const type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(value => MediaRecorder.isTypeSupported(value));
        const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 3000000 });
        const chunks = [];
        recorder.addEventListener('dataavailable', event => { if (event.data.size) chunks.push(event.data); });
        window.__actualMotionRecording = {
          stop: () => new Promise((resolve, reject) => {
            recorder.addEventListener('error', event => reject(new Error(event.error?.message || 'Recording failed')), { once: true });
            recorder.addEventListener('stop', () => {
              stopped = true; cancelAnimationFrame(frame); stream.getTracks().forEach(track => track.stop());
              const reader = new FileReader();
              reader.addEventListener('load', () => resolve(String(reader.result).split(',')[1]), { once: true });
              reader.addEventListener('error', () => reject(reader.error), { once: true });
              reader.readAsDataURL(new Blob(chunks, { type }));
            }, { once: true });
            recorder.stop();
          })
        };
        recorder.start(250);
      });
      await capture.locator('#motion-study-replay').click(); await capture.waitForTimeout(8000);
      const encoded = await capture.evaluate(() => window.__actualMotionRecording.stop());
      const videoBytes = Buffer.from(encoded, 'base64');
      record(videoBytes.length > 10000, 'recording contains actual browser video data');
      fs.writeFileSync(path.join(output, 'gilded-reveal-study.webm'), videoBytes);
      console.log('Recorded real canvas reveal: gilded-reveal-study.webm (' + videoBytes.length + ' bytes, 8 seconds, matte background).');
      await capture.close();
    }

    record(pageErrors.length === 0, 'no browser exceptions: ' + pageErrors.join('; '));
    record(external.length === 0, 'all rendering stays local: ' + external.join('; '));
    console.log('PASS gilded reveal / park overview: ' + checks + ' checks; 4 viewport screenshots and actual canvas phase captures.');
  } finally {
    for (const context of contexts) await context.close().catch(error => failures.push(error.message));
    if (browser) await browser.close();
    await local.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
