'use strict';
// Exercise the real guide page and SDK adapter against local, read-only fixtures.
// This suite cannot contact a cloud environment or modify an account.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'artifacts/scenic-guide');
const KEY = 'chulink:scenic-return:v1';
const catalog = ['fixture-first', 'fixture-second'].map((id, i) => ({
  id, title: i ? '本地测试第二站' : '本地测试第一站', status: 'published',
  region: { city: '测试城' }, location: { latitude: 30 + i * .01, longitude: 114 + i * .01 }
}));
const reads = new Set(['getResources', 'getGuideStation', 'getGuideRoute', 'getSiteWalk', 'getSiteExploration']);
let checks = 0;
const failures = [];
function check(value, message) { if (!value) failures.push(message); checks++; }
const fixtureSdk = `window.cloudbase={init:()=>({
  auth:()=>({getLoginState:async()=>({user:{uid:'isolated-fixture-guest',isAnonymous:true,loginType:'ANONYMOUS'}}),anonymousAuthProvider:()=>({signIn:async()=>{throw Error('Unexpected authentication write')}})}),
  callFunction:async request=>({result:await window.__localRead(request)})
})};`;
const landing = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>本地书页返回测试</title><header class="masthead"><a href="index.html">返回</a></header><p>只测试书页返回，不提供正式景区内容。</p><script src="static/scenic-return.js"></script></html>';

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://local').pathname);
    res.setHeader('Cache-Control', 'no-store');
    if (pathname === '/explore-journey.html') {
      res.setHeader('Content-Type', 'text/html;charset=utf-8'); return res.end(landing);
    }
    const file = path.resolve(root, '.' + pathname);
    const allowed = file === path.join(root, 'guide.html') || file.startsWith(root + path.sep + 'static' + path.sep);
    if (!allowed || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end();
    res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html;charset=utf-8', '.webp': 'image/webp', '.woff2': 'font/woff2' })[path.extname(file)] || 'application/octet-stream');
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    for (const width of [390, 768, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const calls = [], errors = [], unexpectedNetwork = [];
      let catalogLoads = 0;
      await context.exposeBinding('__localRead', async (_, request) => {
        calls.push(request);
        assert.equal(request.name, 'appCore', 'only existing appCore SDK adapter');
        const data = request.data;
        assert(reads.has(data.action), 'Unexpected action: ' + data.action);
        if (data.action === 'getResources') {
          catalogLoads++;
          // Catalog refresh after return must not reset the restored station.
          await new Promise(resolve => setTimeout(resolve, 100));
          return { ok: true, items: catalog };
        }
        if (data.action === 'getGuideStation') {
          await new Promise(resolve => setTimeout(resolve, 80));
          return { ok: true, resourceId: data.resourceId, items: [] };
        }
        if (data.action === 'getGuideRoute') return { ok: true, options: [], theme: null, transitions: [] };
        await new Promise(resolve => setTimeout(resolve, 30));
        return { ok: true, available: true };
      });
      await context.route('**/*', route => {
        const url = route.request().url();
        if (/^https:\/\/static\.cloudbase\.net\/cloudbase-js-sdk\/[^/]+\/cloudbase\.full\.js$/.test(url))
          return route.fulfill({ contentType: 'text/javascript', body: fixtureSdk });
        if (url.startsWith(base + '/')) return route.continue();
        unexpectedNetwork.push(url); return route.abort();
      });
      await context.addInitScript(seed => {
        if (!sessionStorage.getItem('scenic-guide-fixture-seeded')) {
          localStorage.setItem('chu-effects-disabled', 'true');
          localStorage.setItem('chulink-guide-seed', JSON.stringify(seed));
          sessionStorage.setItem('scenic-guide-fixture-seeded', 'true');
        }
      }, { catalog, plan: { stops: catalog.map(r => ({ resourceId: r.id, stayMinutes: 30 })), minutes: 120 } });
      const page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      const settled = async station => {
        await page.waitForFunction(id => window.GuideApp?.getCatalog()?.length === 2 && document.querySelector('#guide-route [aria-current="step"]')?.dataset.index === (id === 'fixture-second' ? '1' : '0'), station, { timeout: 3000 }).catch(() => {});
        await page.waitForFunction(() => !new URL(location.href).searchParams.has('scenicReturn'));
        await page.waitForTimeout(180);
        check(await page.locator('#guide-route [aria-current="step"]').getAttribute('data-index') === (station === 'fixture-second' ? '1' : '0'), 'selection survives catalog refresh ' + width);
      };
      const snapshot = () => page.evaluate(() => {
        const s = GuideApp.getSession();
        return { id: s.id, revision: s.revision, status: s.status, states: s.stops.map(x => x.state), events: s.events, activities: s.activities || [] };
      });
      const openSecond = async () => {
        await page.locator('#guide-route [data-act="view"][data-index="1"]').click();
        await page.waitForFunction(() => document.querySelector('#guide-route [aria-current="step"]')?.dataset.index === '1');
        if (!await page.locator('#guide-station-panel').evaluate(e => e.open)) await page.locator('#guide-station-panel > summary').click();
        await page.locator('[data-guide-station="fixture-second"] [data-site-walk]').waitFor();
      };
      const enter = async () => {
        await page.locator('[data-guide-station="fixture-second"] [data-site-walk]').click();
        await page.waitForURL('**/explore-journey.html?**');
        const saved = await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)), KEY);
        check(saved.context.stationId === 'fixture-second' && saved.context.view === 'guide', 'second station safely captured ' + width);
        check(Object.keys(saved.context).every(key => ['view', 'scroll', 'stationId', 'stationPanelOpen'].includes(key)), 'return context contains no personal record ' + width);
        check(saved.context.stationPanelOpen === true, 'station paper panel state captured ' + width);
        check(new URL(page.url()).searchParams.get('resourceId') === 'fixture-second', 'correct resource opened ' + width);
        return saved;
      };
      await page.goto(base + '/guide.html');
      await settled('fixture-first');
      check(await page.evaluate(() => GuideApp.ready instanceof Promise), 'explicit initialization promise exists ' + width);
      const original = await snapshot();
      await openSecond();
      const saved = await enter();
      check(await page.locator('.masthead > a').textContent() === '← 返回随行向导', 'paper return label ' + width);
      await page.locator('.masthead > a').click();
      await settled('fixture-second');
      assert.deepEqual(await snapshot(), original); checks++;
      check(await page.evaluate(key => !sessionStorage.getItem(key), KEY), 'one-shot return consumed ' + width);
      const restoredScroll = await page.evaluate(() => ({ top: scrollY, max: document.documentElement.scrollHeight - innerHeight, panelOpen: document.getElementById('guide-station-panel').open }));
      check(restoredScroll.panelOpen, 'station paper panel restored ' + width);
      check(Math.abs(restoredScroll.top - saved.context.scroll) <= 3, 'viewport restored ' + width + ': saved=' + saved.context.scroll + ', actual=' + JSON.stringify(restoredScroll));
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no guide horizontal overflow ' + width);
      await page.screenshot({ path: path.join(output, 'guide-return-' + width + '.png'), fullPage: true });

      // Browser Back is also a common way out of a paper page.
      await openSecond(); const backSaved = await enter();
      await page.goBack();
      await settled('fixture-second');
      assert.deepEqual(await snapshot(), original); checks++;
      check(await page.locator('#guide-station-panel').evaluate(e => e.open), 'browser Back restores open paper panel ' + width);
      check(Math.abs(await page.evaluate(() => scrollY) - backSaved.context.scroll) <= 3, 'browser Back restores viewport ' + width);

      // Foreign, missing and malformed return contexts never select a new station.
      await page.goto(base + '/guide.html?scenicReturn=' + 'f'.repeat(32));
      await settled('fixture-first');
      assert.deepEqual(await snapshot(), original); checks++;
      const invalidStation = await page.evaluate(() => ChuScenicReturn.save({ view: 'guide', stationId: 'not-in-this-itinerary', scroll: 0 }));
      await page.goto(base + '/guide.html?scenicReturn=' + invalidStation);
      await settled('fixture-first');
      const invalidShape = await page.evaluate(key => {
        const token = 'a'.repeat(32);
        sessionStorage.setItem(key, JSON.stringify({ token, at: Date.now(), directory: '/', context: { view: 'external', stationId: 'fixture-second', scroll: 0 } }));
        return token;
      }, KEY);
      await page.goto(base + '/guide.html?scenicReturn=' + invalidShape);
      await settled('fixture-first');
      assert.deepEqual(await snapshot(), original); checks++;
      const countBeforeHide = calls.length;
      await page.evaluate(() => {
        window.dispatchEvent(new PageTransitionEvent('pagehide'));
        const box = document.createElement('div');box.dataset.guideStation = 'fixture-hidden';
        document.getElementById('guide-stops').append(box);
      });
      await page.waitForTimeout(150);
      check(calls.length === countBeforeHide, 'pagehide stops mutation-triggered read requests ' + width);
      await page.evaluate(() => document.querySelector('[data-guide-station="fixture-hidden"]').remove());
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
      check(catalogLoads >= 5, 'real guide initialized on returns and invalid context ' + width);
      check(calls.length > 0 && calls.every(r => reads.has(r.data.action)), 'only read actions; no visit, account write, model or voice ' + width);
      assert.deepEqual(errors, []); checks++;
      assert.deepEqual(unexpectedNetwork, []); checks++;
      await context.close();
    }
    assert.deepEqual(failures, [], 'Scenic guide browser regressions');
    console.log('Scenic guide browser passed: ' + checks + ' checks; real guide and SDK adapter, station/scroll return, browser Back, invalid contexts, 390/768/1440; ' + output);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
