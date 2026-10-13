'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const { start, allowedPath } = require('./lib/exploration-motion-demo-preview');
const output = path.resolve(__dirname, '../artifacts/exploration-motion-demo');

function request(url, pathname, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request(url + '/', { path: pathname, method }, res => {
      res.resume(); res.on('end', () => resolve(res.statusCode));
    });
    req.once('error', reject); req.end();
  });
}

(async () => {
  const local = await start();
  let browser;
  let checks = 0;
  const record = (value, label) => { assert(value, label); checks++; };
  const at = (page, value) => page.waitForFunction(v => document.querySelector('#motion-demo').dataset.selected === v, value);
  const phase = page => page.waitForFunction(() => document.querySelector('#motion-demo')?.dataset.phase === 'ready', undefined, { timeout: 15000 });
  const scale = async page => Number(await page.locator('#motion-map-transform').getAttribute('data-scale'));
  const camera = page => page.locator('#motion-map-transform').evaluate(e => getComputedStyle(e).transform + '|' + e.getAttribute('transform'));
  const failures = [];
  const external = [];
  const contexts = [];
  async function newPage(options = {}, failImages = false) {
    const context = await browser.newContext(options); contexts.push(context);
    const page = await context.newPage();
    page.on('pageerror', error => failures.push(error.message));
    await page.route('**/*', route => {
      const req = route.request();
      if (!req.url().startsWith(local.url + '/') && !/^(?:data|blob):/.test(req.url())) {
        external.push(req.url()); return route.abort();
      }
      if (failImages && req.resourceType() === 'image') return route.abort();
      return route.continue();
    });
    return page;
  }
  try {
    for (const denied of ['/AGENTS.md', '/admin.html', '/static/cloudbase-app.js', '/__exploration', '/%2e%2e/AGENTS.md', '/static/assets/exploration-motion/../../cloudbase-app.js', '/static/assets/exploration-motion/%2e%2e%5cprivate.png']) {
      record(allowedPath(denied) === null && await request(local.url, denied) === 404, 'server rejects non-preview/traversal path ' + denied);
    }
    record(await request(local.url, '/', 'POST') === 405, 'preview does not accept writes');
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    fs.mkdirSync(output, { recursive: true });

    const narrow = await newPage({ viewport: { width: 320, height: 740 }, reducedMotion: 'reduce' });
    await narrow.goto(local.url); await phase(narrow);
    record(await narrow.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '320px default layout has no horizontal overflow');
    const clippedTargets = await narrow.locator('[data-point]').evaluateAll(nodes => {
      const stage = document.querySelector('#motion-stage').getBoundingClientRect();
      return nodes.map(node => ({ id: node.dataset.point, rect: node.getBoundingClientRect() }))
        .filter(({ rect }) => rect.left < stage.left - .5 || rect.right > stage.right + .5 || rect.top < stage.top - .5 || rect.bottom > stage.bottom + .5)
        .map(({ id, rect }) => ({ id, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, stageRight: stage.right, stageBottom: stage.bottom }));
    });
    record(clippedTargets.length === 0, '320px default point hit rectangles fit inside the map: ' + JSON.stringify(clippedTargets));
    await narrow.close();

    for (const width of [390, 768, 1440]) {
      const page = await newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
      await page.goto(local.url + '/explore-motion-demo.html');
      await page.locator('button[data-point="tower"]').waitFor();
      // The opening is decorative: a real user click must work before it finishes.
      await page.locator('button[data-point="pond"]').click({ timeout: 2500 });
      await at(page, 'pond');
      record(await page.locator('[data-point="pond"]').getAttribute('aria-pressed') === 'true', 'opening can be interrupted at ' + width);
      await phase(page);
      record(await page.locator('button[data-point]').count() === 4, 'four independently selectable objects');
      await page.evaluate(() => {
        for (const id of ['copper', 'baiyun', 'pond', 'tower']) document.querySelector('[data-point="' + id + '"]').click();
      });
      await at(page, 'tower'); await page.waitForTimeout(800);
      record(await page.locator('[data-point="tower"]').getAttribute('aria-pressed') === 'true' && await page.locator('[aria-pressed="true"][data-point]').count() === 1, 'latest selection wins');
      record((await page.locator('#motion-title').textContent()).includes('黄鹤楼'), 'selected card follows object');

      for (const [open, dialog, close] of [
        ['#motion-details', '#motion-dialog', '#motion-close'],
        ['#motion-sources', '#motion-sources-dialog', '#motion-sources-close'],
        ['#motion-notebook', '#motion-notebook-dialog', '#motion-notebook-close']
      ]) {
        await page.locator(open).click();
        record(await page.locator(dialog).evaluate(el => el.open), 'dialog opens ' + open);
        await page.locator(close).click();
        record(!await page.locator(dialog).evaluate(el => el.open), 'dialog closes ' + open);
        record(await page.evaluate(selector => document.activeElement === document.querySelector(selector), open), 'dialog restores focus ' + open);
      }
      await page.locator('#motion-details').click(); await page.keyboard.press('Escape');
      record(!await page.locator('#motion-dialog').evaluate(el => el.open), 'Escape closes native dialog');
      await page.locator('#motion-question').fill('这里应该看什么？');
      await page.locator('#motion-send').click();
      await page.waitForFunction(() => document.querySelector('#motion-answer').textContent.trim().length > 0);
      record(/(?:样板|演示|示意|未接|未调用|没有调用|不调用|本地)/.test(await page.locator('#motion-answer').textContent()), 'question answer does not claim a model call');

      await page.locator('#motion-reset').click(); await page.waitForTimeout(650);
      const initial = await scale(page), home = await camera(page);
      const stage = page.locator('#motion-stage');
      await stage.focus(); await page.keyboard.press('ArrowRight');
      record(await camera(page) !== home, 'keyboard pans map');
      await page.keyboard.press('Home'); await page.waitForTimeout(450);
      record(Math.abs((await scale(page)) - initial) < .001, 'Home restores overview scale');

      await page.locator('#motion-zoom-in').click();
      record(await scale(page) > initial, 'zoom in works');
      await page.evaluate(() => { for (let i = 0; i < 25; i++) document.querySelector('#motion-zoom-in').click(); });
      const maximum = await scale(page);
      await page.locator('#motion-zoom-in').evaluate(button => button.click());
      record(Number.isFinite(maximum) && maximum <= 5 && await scale(page) === maximum, 'zoom maximum is bounded');
      await page.evaluate(() => { for (let i = 0; i < 40; i++) document.querySelector('#motion-zoom-out').click(); });
      const minimum = await scale(page);
      record(Number.isFinite(minimum) && minimum > 0 && minimum < maximum, 'zoom minimum is bounded');
      const undersizedPoints = await page.locator('[data-point]').evaluateAll(nodes => nodes.filter(node => {
        const rect = node.getBoundingClientRect(); return rect.width < 43.5 || rect.height < 43.5;
      }).map(node => node.dataset.point));
      record(undersizedPoints.length === 0, 'zooming out retains 44px transparent hit targets: ' + undersizedPoints.join(', '));
      await page.locator('#motion-reset').click(); await page.waitForTimeout(450);
      const beforeDrag = await camera(page), selected = await page.locator('#motion-demo').getAttribute('data-selected');
      const box = await stage.boundingBox();
      await page.mouse.move(box.x + box.width * .08, box.y + box.height * .30);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * .30, box.y + box.height * .36, { steps: 8 });
      await page.mouse.up();
      record(await camera(page) !== beforeDrag, 'drag moves map');
      record(await page.locator('#motion-demo').getAttribute('data-selected') === selected, 'drag does not select another object');
      await page.locator('#motion-reset').click(); await page.waitForTimeout(800);

      record(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow at ' + width);
      const small = await page.locator('button').evaluateAll(nodes => nodes.filter(node => {
        const r = node.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.width < 43.5 || r.height < 43.5);
      }).map(node => node.id || node.getAttribute('data-point')));
      record(small.length === 0, 'visible buttons meet 44px target: ' + small.join(', '));
      await page.screenshot({ path: path.join(output, 'map-' + width + '.png'), fullPage: true });
      await page.locator('[data-point="pond"]').click(); await page.waitForTimeout(850);
      await page.screenshot({ path: path.join(output, 'pond-' + width + '.png'), fullPage: true });
      await page.locator('#motion-sources').click();
      await page.screenshot({ path: path.join(output, 'sources-' + width + '.png'), fullPage: true });
      await page.close();
    }

    const reduced = await newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    await reduced.goto(local.url); await phase(reduced);
    record(await reduced.locator('#motion-demo').getAttribute('data-reduced') === 'true', 'reduced-motion preference is applied');
    await reduced.locator('#motion-replay').click();
    await reduced.locator('[data-point="copper"]').click(); await at(reduced, 'copper');
    record(await reduced.evaluate(() => document.getAnimations().filter(a => a.playState === 'running').length === 0), 'reduced motion has no ongoing decorative animation');
    await reduced.locator('#motion-notebook').click();
    await reduced.locator('#motion-clear-notebook').click();
    record(/(?:0|空|还没有|尚未|暂无|已清)/.test(await reduced.locator('#motion-notebook-dialog').textContent()), 'local viewed notebook can be cleared');
    await reduced.locator('#motion-notebook-close').click();
    await reduced.close();

    const history = await newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', hasTouch: true });
    await history.goto(local.url); await phase(history);
    for (const point of ['pond', 'copper']) await history.locator('[data-point="' + point + '"]').click();
    await history.reload(); await phase(history);
    await history.locator('#motion-notebook').click();
    const remembered = await history.locator('#motion-viewed').textContent();
    record(remembered.includes('鹅池') && remembered.includes('古铜顶'), 'reload preserves explicitly viewed objects on this device');
    record(/(?:不代表实际到访|并不代表到访)/.test(await history.locator('#motion-notebook-dialog').textContent()), 'viewed notebook never claims an actual visit');
    await history.locator('#motion-notebook-close').click();
    await history.locator('#motion-question').fill('这是什么？'); await history.locator('#motion-send').click();
    await history.evaluate(() => {
      for (const id of ['copper', 'baiyun', 'pond']) document.querySelector('[data-point="' + id + '"]').click();
    });
    await at(history, 'pond');
    record(await history.locator('#motion-answer').textContent() === '' && !await history.locator('#motion-answer').isVisible(), 'changing object removes old answer');
    await history.locator('#motion-details').click();
    record((await history.locator('#detail-title').textContent()).includes('鹅池'), 'rapidly switched detail matches final selected object');
    await history.locator('#motion-close').click();
    await history.locator('#motion-clear-notebook').evaluate(button => button.click());
    await history.reload(); await phase(history);
    await history.locator('#motion-notebook').click();
    record((await history.locator('#motion-viewed').textContent()).includes('还没有'), 'clearing local records survives reload');
    await history.locator('#motion-notebook-close').click();

    await history.locator('[data-point="copper"]').click();
    const towerArt = await history.locator('[data-art="tower"]').boundingBox();
    await history.mouse.click(towerArt.x + towerArt.width / 2, towerArt.y + towerArt.height / 2);
    record(await history.locator('#motion-demo').getAttribute('data-selected') === 'tower', 'tapping the building itself selects it without a new button');
    const worldBox = await history.locator('#motion-map-transform').boundingBox();
    await history.mouse.click(worldBox.x + worldBox.width * .35, worldBox.y + worldBox.height * .65);
    record(await history.locator('#motion-demo').getAttribute('data-selected') === 'pond', 'tapping open water selects the pond without touching its label');
    await history.mouse.move(towerArt.x + towerArt.width / 2, towerArt.y + towerArt.height / 2);
    await history.mouse.down();
    await history.mouse.move(towerArt.x + towerArt.width / 2 + 65, towerArt.y + towerArt.height / 2 + 50, { steps: 8 });
    await history.mouse.up();
    record(await history.locator('#motion-demo').getAttribute('data-selected') === 'pond', 'dragging from a building does not activate it on release');
    await history.locator('#motion-reset').click();

    // Chromium touch events exercise the actual two-pointer handler, not an app test hook.
    const client = await history.context().newCDPSession(history);
    const touchBox = await history.locator('#motion-stage').boundingBox();
    const cx = touchBox.x + touchBox.width / 2, cy = touchBox.y + touchBox.height * .3;
    const touchScale = await scale(history), touchSelection = await history.locator('#motion-demo').getAttribute('data-selected');
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x: cx - 25, y: cy }, { id: 2, x: cx + 25, y: cy }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x: cx - 55, y: cy }, { id: 2, x: cx + 55, y: cy }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    record(await scale(history) > touchScale && await scale(history) <= 2.4, 'two-finger gesture zooms within the same bound');
    record(await history.locator('#motion-demo').getAttribute('data-selected') === touchSelection, 'pinch does not activate a map point');
    await client.detach();
    record(await history.locator('iframe, object, embed').count() === 0, 'sample does not embed external browsing or plugins');
    const unsafeLinks = await history.locator('a[target="_blank"]').evaluateAll(links => links.filter(a => a.protocol !== 'https:' || !a.relList.contains('noopener') || !a.relList.contains('noreferrer')).map(a => a.href));
    record(unsafeLinks.length === 0, 'source links use HTTPS and do not expose opener/referrer');
    await history.close();

    const tampered = await newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    await tampered.addInitScript(() => {
      localStorage.setItem('chulink:motion-demo:viewed:v1', JSON.stringify(['pond', '__proto__', '<img src=x onerror=alert(1)>', 'unknown-place']));
    });
    await tampered.goto(local.url); await phase(tampered);
    await tampered.locator('#motion-notebook').click();
    record((await tampered.locator('#motion-viewed').textContent()).trim() === '鹅池', 'local storage can only restore known scene IDs');
    record(await tampered.locator('#motion-viewed img, #motion-viewed script').count() === 0, 'restored notebook does not interpret HTML');
    await tampered.close();

    const noStorage = await newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    await noStorage.addInitScript(() => {
      for (const name of ['getItem', 'setItem', 'removeItem']) Storage.prototype[name] = () => { throw new DOMException('Local storage unavailable', 'SecurityError'); };
    });
    await noStorage.goto(local.url); await phase(noStorage);
    await noStorage.locator('[data-point="baiyun"]').click(); await at(noStorage, 'baiyun');
    await noStorage.locator('#motion-notebook').click();
    record((await noStorage.locator('#motion-viewed').textContent()).includes('白云阁'), 'storage failure keeps in-memory exploration usable');
    await noStorage.locator('#motion-clear-notebook').click();
    record((await noStorage.locator('#motion-viewed').textContent()).includes('还没有'), 'storage failure does not prevent clearing in-memory records');
    await noStorage.close();

    const paused = await newPage({ viewport: { width: 390, height: 844 } });
    await paused.goto(local.url); await phase(paused);
    // Simulate the browser visibility event; this is not a physical-device battery test.
    await paused.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    record(await paused.locator('#motion-demo').getAttribute('data-paused') === 'true', 'background pauses decoration');
    await paused.evaluate(() => {
      delete document.hidden; delete document.visibilityState;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    record(await paused.locator('#motion-demo').getAttribute('data-paused') === 'false', 'foreground can resume');
    await paused.close();

    const broken = await newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' }, true);
    await broken.goto(local.url); await phase(broken);
    await broken.locator('[data-point="pond"]').click(); await at(broken, 'pond');
    record((await broken.locator('#motion-title').textContent()).includes('鹅池'), 'missing artwork still permits label selection');
    await broken.locator('#motion-sources').click();
    record(await broken.locator('#motion-sources-dialog').evaluate(e => e.open), 'missing artwork keeps source disclosure accessible');
    await broken.screenshot({ path: path.join(output, 'missing-artwork-390.png'), fullPage: true });
    await broken.close();

    const recovered = await newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    await recovered.route('**/hhl-tower-v1.webp', route => route.abort());
    await recovered.goto(local.url); await phase(recovered);
    await recovered.waitForFunction(() => { const img = document.querySelector('#detail-image'); return img.complete && img.naturalWidth === 0; });
    await recovered.locator('[data-point="baiyun"]').click();
    await recovered.locator('#motion-details').click();
    await recovered.waitForFunction(() => { const img = document.querySelector('#detail-image'); return img.complete && img.naturalWidth > 0 && getComputedStyle(img).visibility === 'visible'; });
    record((await recovered.locator('#detail-image').getAttribute('src')).includes('baiyun'), 'a failed image does not hide the next successfully loaded object');
    await recovered.screenshot({ path: path.join(output, 'recovered-artwork-390.png'), fullPage: true });
    await recovered.close();

    const recorderInstalled = fs.existsSync(path.join(process.env.LOCALAPPDATA || '', 'ms-playwright/ffmpeg-1011/ffmpeg-win64.exe'));
    const film = await newPage({
      viewport: { width: 390, height: 844 }, deviceScaleFactor: 1,
      ...(recorderInstalled ? { recordVideo: { dir: path.join(output, 'recordings'), size: { width: 390, height: 844 } } } : {})
    });
    const video = film.video();
    await film.goto(local.url); await phase(film); await film.waitForTimeout(2000);
    await film.screenshot({ path: path.join(output, 'initial-390.png') });
    const halo = await film.locator('#motion-halo').evaluate(node => {
      const style = getComputedStyle(node), rect = node.getBoundingClientRect();
      return { width: rect.width, height: rect.height, x: rect.x, y: rect.y, opacity: style.opacity, visibility: style.visibility, display: style.display, filter: style.filter, zIndex: style.zIndex, border: style.border, boxShadow: style.boxShadow };
    });
    console.log('Selected tower halo after opening: ' + JSON.stringify(halo));
    record(halo.width > 0 && halo.height > 0 && halo.visibility === 'visible' && Number(halo.opacity) > 0, 'selected tower highlight is present in the resting frame');
    await film.locator('#motion-replay').click();
    const replayStarted = Date.now();
    for (const target of [120, 500, 1100, 1900]) {
      const remaining = target - (Date.now() - replayStarted);
      if (remaining > 0) await film.waitForTimeout(remaining);
      await film.screenshot({ path: path.join(output, 'replay-' + target + 'ms-390.png') });
    }
    for (const point of ['pond', 'copper', 'tower']) {
      await film.locator('[data-point="' + point + '"]').click(); await film.waitForTimeout(1300);
    }
    await film.locator('#motion-details').click(); await film.waitForTimeout(1500);
    await film.locator('#motion-close').click(); await film.waitForTimeout(700);
    await film.context().close();
    if (video) await video.saveAs(path.join(output, 'motion-walkthrough-390.webm'));
    else console.log('NOT RECORDED: optional WebM capture needs the Playwright ffmpeg runtime; actual browser frames are saved.');

    record(failures.length === 0, 'no page errors: ' + failures.join('; '));
    record(external.length === 0, 'no external model/cloud/analytics requests: ' + external.join('; '));
    console.log('PASS exploration motion demo: ' + checks + ' checks; three viewport screenshots; isolated local artwork only.');
  } finally {
    for (const context of contexts) await context.close().catch(() => {});
    if (browser) await browser.close();
    await local.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
