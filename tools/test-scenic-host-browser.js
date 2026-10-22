'use strict';
// Real main HTML, existing map/profile code, isolated SDK and fixed test responses.
// No model calls, production credentials, production writes or real personal data.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { chromium } = require('playwright'), { start } = require('./preview-integrated-ui');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'artifacts/scenic-host');
let checks = 0;
function check(value, message) { assert(value, message); checks++; }
function publicFixture() {
  const ids = ['tower', 'copper', 'baiyun', 'pond'], titles = ['主楼', '古铜顶', '白云阁', '鹅池'];
  return { ok: true, available: true, validUntil: new Date(Date.now() + 3600000).toISOString(), checkedAt: new Date().toISOString(),
    walk: { resourceId: 'yellow-crane-tower', title: '黄鹤楼 · 固定测试内容', fingerprint: 'host-test-published-version', version: 3,
      points: ids.map((id, i) => ({ id, title: titles[i], text: '此句仅用于本地连通性测试，不是正式景区讲解。', reading: '这是隔离浏览器测试的固定内容。\n\n不代表来源审核、现场核验或正式发布。', sources: [{ title: '测试出处', excerpt: '固定测试文字' }] })) },
    map: { objects: ids.map((id, i) => ({ id: 'object_' + id, pointId: id, artScene: id, x: 100 + i * 200, y: 300, symbol: 'tower' })), edges: [] } };
}
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const server = await start(0), base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const cameraFailures = [];
  try {
    for (const width of [320, 390, 768, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 960 }, reducedMotion: 'reduce' });
      const errors = [], unexpectedCloud = [], writes = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('request', r => {
        if (!['GET', 'HEAD'].includes(r.method())) writes.push(r.method() + ' ' + new URL(r.url()).pathname);
        if (/tcloudbase|cloudbase\.net|tencentcloudapi/.test(r.url())) unexpectedCloud.push(new URL(r.url()).hostname);
      });
      await page.addInitScript(() => {
        localStorage.setItem('chulink-onboarding-state', JSON.stringify({ seen: true, dismissed: true, tasks: {} }));
        window.__startupSeen = false;
        new MutationObserver(records => {
          for (const record of records) for (const node of record.addedNodes) {
            if (node.nodeType === 1 && (node.id === 'chu-startup' || node.querySelector?.('#chu-startup'))) window.__startupSeen = true;
          }
        }).observe(document, { childList: true, subtree: true });
      });
      await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (!url.href.startsWith(base + '/')) return route.abort();
        if (url.pathname === '/explore-journey.html') {
          const value = publicFixture();
          const adapter = '<script>window.__journeyCalls=[];window.ExplorationAdapter={identity:async()=>"local-test-reader",call:async data=>{window.__journeyCalls.push(data);if(data.action!=="getSiteExploration")throw Error("Only read-only test action allowed");return ' + JSON.stringify(value) + ';}};</script>';
          const body = fs.readFileSync(path.join(root, 'explore-journey.html'), 'utf8').replace('<!-- journey-local-adapter -->', adapter);
          return route.fulfill({ contentType: 'text/html;charset=utf-8', body });
        }
        return route.continue();
      });
      async function wire() {
        await page.locator('#chu-startup').waitFor({ state: 'detached' });
        await page.waitForFunction(() => !!window.ChuScenicEntry && !!window.ChuScenicApi);
        await page.evaluate(async value => { window.__entryCalls = []; window.ChuScenicApi = async data => { __entryCalls.push(data); return value; }; await ChuScenicEntry.refresh(true); }, publicFixture());
      }
      await page.goto(base + '/index.html?view=discover', { waitUntil: 'load' }); await wire();
      check(await page.locator('.page-view').count() === 5, 'five views ' + width);
      check(await page.locator('[data-scenic-entry=discover]').count() === 1, 'single Discover invitation ' + width);
      check(await page.locator('[data-scenic-entry=discover]').isVisible(), 'published invitation visible ' + width);
      await page.locator('[data-scenic-entry=discover]').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(output, 'discover-' + width + '.png') });
      check(await page.locator('[data-scenic-entry=discover]').evaluate(e => e.getBoundingClientRect().height >= 44), 'Discover target size ' + width);

      await page.evaluate(() => { switchTab('map'); focusLandmark(heritageLandmarks.find(v => v.id === 'yellow-crane-tower')); });
      await page.locator('#view-map:not(.hidden)').waitFor();
      await page.locator('[data-scenic-entry=map]').waitFor();
      await page.waitForFunction(() => typeof heritageMap !== 'undefined' && heritageMap?.getCenter());
      await page.evaluate(() => {
        heritageMap.setView([30.545, 114.301], 15, { animate: false });
        mapPlannerSelectedIds = ['yellow-crane-tower', 'hubei-museum']; saveMapPlannerState();
      });
      await page.waitForTimeout(450);
      await page.locator('[data-scenic-entry=map]').scrollIntoViewIfNeeded();
      const before = await page.evaluate(() => ({ selectedIds: [...mapPlannerSelectedIds], center: [heritageMap.getCenter().lat, heritageMap.getCenter().lng], zoom: heritageMap.getZoom() }));
      check(await page.locator('[data-scenic-entry=map]').evaluate(e => e.getBoundingClientRect().height >= 44), 'map entry size ' + width);
      await page.screenshot({ path: path.join(output, 'map-' + width + '.png') });
      await page.locator('[data-scenic-entry=map]').click();
      await page.waitForURL('**/explore-journey.html?**'); await page.locator('#content:not([hidden])').waitFor();
      const saved = await page.evaluate(() => JSON.parse(sessionStorage.getItem('chulink:scenic-return:v1')).context);
      check(saved.view === 'map' && saved.landmarkId === 'yellow-crane-tower', 'map context identity ' + width);
      check(saved.zoom === before.zoom && Math.abs(saved.center[0] - before.center[0]) < 0.00001 && Math.abs(saved.center[1] - before.center[1]) < 0.00001, 'map viewport captured ' + width);
      check(await page.locator('.masthead>a').textContent() === '← 返回地图', 'real journey contextual back ' + width);
      check(await page.evaluate(() => __journeyCalls.length > 0 && __journeyCalls.every(v => v.action === 'getSiteExploration')), 'journey uses actual read contract ' + width);
      await page.screenshot({ path: path.join(output, 'journey-' + width + '.png') });
      await page.locator('.masthead>a').click(); await page.waitForURL('**/index.html?**'); await wire();
      await page.waitForFunction(() => !new URL(location.href).searchParams.has('scenicReturn'));
      await page.waitForTimeout(500);
      const after = await page.evaluate(() => ({ view: document.querySelector('.page-view:not(.hidden)').id, landmark: activeLandmark.id,
        center: [heritageMap.getCenter().lat, heritageMap.getCenter().lng], zoom: heritageMap.getZoom(), scroll: document.getElementById('app-viewport').scrollTop,
        selectedIds: [...mapPlannerSelectedIds], drawer: document.querySelector('#landmark-drawer').getAttribute('aria-hidden') }));
      check(after.view === 'view-map' && after.landmark === 'yellow-crane-tower' && after.drawer === 'false', 'map point restored ' + width);
      check(await page.evaluate(() => !window.__startupSeen), 'valid map return never mounts startup cover ' + width);
      if (!(after.zoom === saved.zoom && Math.abs(after.center[0] - saved.center[0]) < 0.0001 && Math.abs(after.center[1] - saved.center[1]) < 0.0001)) cameraFailures.push({ width, saved, after });
      else checks++;
      check(Math.abs(after.scroll - saved.scroll) <= 2, 'map scroll restored ' + width);
      check(JSON.stringify(after.selectedIds) === JSON.stringify(before.selectedIds), 'itinerary never replaced ' + width);

      await page.evaluate(() => {
        localStorage.setItem('chulink:journey-content:v1:yellow-crane-tower', JSON.stringify({ 'host-test-published-version': {
          fingerprint: 'host-test-published-version', selected: 'pond', observed: ['tower'], updatedAt: Date.now(), note: 'PRIVATE_HOST_TEST_NOTE'
        } })); switchTab('profile');
      }); await page.evaluate(() => ChuScenicEntry.refresh(true));
      await page.locator('#cloud-profile-card').waitFor(); await page.locator('[data-scenic-entry=profile]').waitFor();
      check(await page.locator('[data-scenic-entry=profile]').count() === 1, 'single resume after actual profile injection ' + width);
      check((await page.locator('[data-scenic-entry=profile]').innerText()).includes('本机续读'), 'resume labeled local ' + width);
      check(!(await page.locator('#view-profile').innerText()).includes('PRIVATE_HOST_TEST_NOTE'), 'private note absent from profile ' + width);
      await page.locator('[data-scenic-entry=profile]').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(output, 'profile-' + width + '.png') });
      for (const sourceView of ['discover', 'profile']) {
        await page.evaluate(view => switchTab(view), sourceView);
        await page.locator('[data-scenic-entry=' + sourceView + ']').scrollIntoViewIfNeeded();
        await page.evaluate(() => {
          const viewport = document.getElementById('app-viewport');
          viewport.scrollTop += 100;
          window.scrollTo({ top: window.scrollY + 100, behavior: 'instant' });
        });
        await page.waitForTimeout(100);
        await page.locator('[data-scenic-entry=' + sourceView + ']').click();
        await page.waitForURL('**/explore-journey.html?**'); await page.locator('#content:not([hidden])').waitFor();
        const context = await page.evaluate(() => JSON.parse(sessionStorage.getItem('chulink:scenic-return:v1')).context);
        check(context.view === sourceView, 'source section captured ' + sourceView + ' ' + width);
        if (sourceView === 'profile') check(new URL(page.url()).searchParams.get('pointId') === 'pond', 'actual profile resumes pond ' + width);
        check(context.windowScroll + context.scroll > 0, 'real page scroll exercised ' + sourceView + ' ' + width + ': ' + JSON.stringify(context));
        await page.locator('.masthead>a').click(); await page.waitForURL('**/index.html?**'); await wire();
        await page.waitForFunction(() => !new URL(location.href).searchParams.has('scenicReturn'));
        await page.waitForTimeout(500);
        const restored = await page.evaluate(() => ({ view: document.querySelector('.page-view:not(.hidden)').id, scroll: document.getElementById('app-viewport').scrollTop, windowScroll: window.scrollY }));
        check(restored.view === 'view-' + sourceView, 'returns to correct real section ' + sourceView + ' ' + width);
        check(Math.abs(restored.scroll - context.scroll) <= 2 && Math.abs(restored.windowScroll - context.windowScroll) <= 2, 'both scroll containers restored ' + sourceView + ' ' + width + ': ' + JSON.stringify({ context, restored }));
        check(await page.evaluate(() => !window.__startupSeen), 'no cover replay ' + sourceView + ' ' + width);
      }
      for (const view of ['discover', 'map', 'collect', 'community', 'profile']) {
        await page.evaluate(v => switchTab(v), view); await page.locator('#view-' + view + ':not(.hidden)').waitFor();
        check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'existing view no overflow ' + view + ' ' + width);
      }
      if (width === 390) {
        const token = await page.evaluate(() => ChuScenicReturn.save({ view: 'map', landmarkId: 'yellow-crane-tower', center: [30.545, 114.301], zoom: 15, scroll: 0, windowScroll: 0 }));
        await page.goto(base + '/index.html?view=map&scenicReturn=' + token);
        await page.waitForFunction(() => typeof activeLandmark !== 'undefined' && activeLandmark?.id === 'yellow-crane-tower' && document.querySelector('#landmark-drawer')?.getAttribute('aria-hidden') === 'false');
        await page.evaluate(() => switchTab('profile'));
        await page.waitForTimeout(1300);
        check(await page.locator('#view-profile:not(.hidden)').count() === 1, 'user changed section interrupts pending map restore');
        check(!new URL(page.url()).searchParams.has('scenicReturn'), 'cancelled one-shot restore clears return token');
      }
      await page.goto(base + '/explore-journey.html?resourceId=yellow-crane-tower&returnToken=https://evil.example');
      await page.locator('#content:not([hidden])').waitFor();
      check(await page.locator('.masthead>a').getAttribute('href') === '/index.html?view=map', 'invalid token safe fallback ' + width);
      check(errors.length === 0, 'no JS errors ' + width + ': ' + errors.join('; '));
      check(unexpectedCloud.length === 0, 'no cloud connection ' + width);
      check(writes.length === 0, 'no POST or production writes ' + width);
      await page.close();
    }
    assert.deepEqual(cameraFailures, [], 'map cameras must restore at every size');
    console.log(JSON.stringify({ checks, screenshots: 'artifacts/scenic-host', scope: 'actual main HTML and journey HTML, local fixed read responses; not production cloud acceptance' }));
  } finally { await browser.close(); await new Promise(r => server.close(r)); }
})().catch(e => { console.error(e); process.exitCode = 1; });
