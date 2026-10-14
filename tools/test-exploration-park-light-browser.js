'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { start } = require('./lib/exploration-motion-demo-preview');
const output = path.resolve(__dirname, '../artifacts/exploration-park-light');

(async () => {
  const server = await start();
  let browser, checks = 0;
  const errors = [], external = [];
  const check = (value, label) => { assert(value, label); checks++; };
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    fs.mkdirSync(output, { recursive: true });
    for (const width of [320, 390, 768, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => {
        if (!route.request().url().startsWith(server.url)) { external.push(route.request().url()); return route.abort(); }
        return route.continue();
      });
      // Real rendering spy: the visible light canvas must never copy ANY image.
      await page.addInitScript(() => {
        window.parkImageCopies = 0;
        const original = CanvasRenderingContext2D.prototype.drawImage;
        CanvasRenderingContext2D.prototype.drawImage = function (...args) {
          if (this.canvas.id === 'park-motion-canvas') window.parkImageCopies++;
          return original.apply(this, args);
        };
      });
      await page.goto(server.url);
      await page.waitForFunction(() => document.querySelector('#motion-demo').dataset.phase === 'ready');
      await page.locator('#motion-park').click();
      await page.waitForFunction(() => document.querySelector('#park-motion-canvas').dataset.renderMode === 'light-only');
      // Seek on the same renderer used by the UI, without changing production API.
      await page.evaluate(() => {
        const create = ChuGildedReveal.create;
        window.ChuGildedReveal = { ...ChuGildedReveal, create(options) {
          const instance = create(options);
          if (options.mode === 'light-only') window.parkLight = instance;
          return instance;
        } };
      });
      for (const id of ['tower', 'copper', 'baiyun', 'pond']) {
        await page.locator('[data-park-point="' + id + '"]').click();
        await page.waitForFunction(id => window.parkLight?.getState().profile === id, id);
        const sample = time => page.evaluate(time => {
          parkLight.seek(time);
          const canvas = document.querySelector('#park-motion-canvas');
          const bytes = canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
          let transparent = 0, gold = 0, alpha = 0;
          for (let i = 0; i < bytes.length; i += 4) {
            if (!bytes[i+3]) transparent++;
            if (bytes[i+3] > 40 && bytes[i] > 190 && bytes[i+1] > 130 && bytes[i] > bytes[i+2]*1.15) gold++;
            alpha += bytes[i+3];
          }
          const b = canvas.getBoundingClientRect();
          return { transparent: transparent/(bytes.length/4), gold, alpha, box:[b.x,b.y,b.width,b.height] };
        }, time);
        const early = await sample(.3), bright = await sample(2.25);
        check(bright.gold > 30, id + ' visibly glows at ' + width);
        check(bright.transparent > .35, id + ' keeps most of canvas transparent at ' + width);
        check(bright.alpha > early.alpha*2, id + ' blooms progressively at ' + width);
        check(bright.box.every((v,i) => Math.abs(v-early.box[i]) < .1), id + ' stays registered at ' + width);
        await page.screenshot({ path: path.join(output, id + '-' + width + '.png') });
        const settled = await sample(9);
        check(settled.alpha < bright.alpha && settled.transparent > .35, id + ' rests as quiet light, not image tile at ' + width);
      }
      check(await page.evaluate(() => parkImageCopies === 0), 'no picture pasted in scroll at ' + width);
      check(await page.locator('.park-point').evaluateAll(nodes => nodes.every(node => {
        const b = node.getBoundingClientRect(); return b.width >= 44 && b.height >= 44;
      })), '44px labels at ' + width);
      check(await page.locator('.park-point span').evaluateAll(nodes => nodes.every(node => getComputedStyle(node).borderTopWidth === '0px')), 'no label plaques at ' + width);
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no page overflow at ' + width);
      await page.keyboard.press('Tab');
      await page.locator('[data-park-point="tower"]').focus();
      check(await page.locator('[data-park-point="tower"]').evaluate(node => node.matches(':focus-visible') && getComputedStyle(node).outlineStyle !== 'none'), 'keyboard focus visible at ' + width);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.waitForFunction(() => parkLight.getState().reducedMotion);
      const state = await page.evaluate(() => parkLight.getState());
      check(state.complete && state.reducedMotion, 'reduced motion finishes at ' + width);
      await page.locator('[data-park-point="copper"]').click();
      await page.waitForFunction(() => parkLight.getState().profile === 'copper' && parkLight.getState().complete);
      check(await page.evaluate(() => parkImageCopies === 0), 'reduced motion still never pastes art at ' + width);
      await page.evaluate(() => ['tower','pond','copper','baiyun'].forEach(id => document.querySelector('[data-park-point="'+id+'"]').click()));
      await page.waitForFunction(() => parkLight.getState().profile === 'baiyun' && !parkLight.getState().destroyed);
      check(await page.locator('#park-point-title').textContent() === '白云阁', 'latest rapid selection wins at ' + width);
      await page.locator('#motion-park-close').click();
      check(await page.evaluate(() => parkLight.getState().destroyed), 'closing releases renderer at ' + width);
      await page.close();
    }
    const fallback = await browser.newPage();
    await fallback.route('**/gsap-3.15.0.min.js', route => route.abort());
    await fallback.goto(server.url);
    await fallback.waitForFunction(() => document.querySelector('#motion-demo').dataset.phase === 'ready');
    await fallback.locator('#motion-park').click();
    await fallback.waitForFunction(() => document.querySelector('#park-motion-canvas').dataset.phase === 'settled');
    check(await fallback.locator('#park-motion-canvas').getAttribute('data-render-mode') === 'light-only', 'missing engine keeps original art with static contour');
    await fallback.close();
    check(!errors.length, 'no browser errors: ' + errors.join(';'));
    check(!external.length, 'no external traffic');
    console.log('PASS expanded park light: ' + checks + ' checks, four landmarks / four widths; no pasted images.');
  } finally { if (browser) await browser.close(); await server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
