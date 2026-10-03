'use strict';

// Real merged markup, cached visual libraries and local fixtures. No network fallback.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const output = process.argv[2] || path.join(os.tmpdir(), 'chulink-merged-paper-qa');
const tabs = ['discover', 'map', 'collect', 'community', 'profile'];
const slots = { discover: 'paper-home-navigation', map: 'field-map-navigation', collect: 'field-collect-navigation', community: 'field-community-navigation', profile: 'paper-profile-navigation' };
const dependencies = [
  [/^https:\/\/cdn\.tailwindcss\.com/, 'chulink-submission-tailwind.js', 'application/javascript'],
  [/^https:\/\/unpkg\.com\/lucide/, 'chulink-header-lucide.js', 'application/javascript'],
  [/^https:\/\/cdn\.bootcdn\.net\/ajax\/libs\/leaflet\/1\.9\.4\/leaflet\.js$/, 'chulink-header-leaflet.js', 'application/javascript'],
  [/^https:\/\/cdn\.bootcdn\.net\/ajax\/libs\/leaflet\/1\.9\.4\/leaflet\.css$/, 'chulink-header-leaflet.css', 'text/css']
];
const report = { layouts: [], motion: [], admin: [], cloudActions: [], blockedOrigins: [], errors: [] };

async function preparePage(browser, origin) {
  const page = await browser.newPage({ viewport: { width: 390, height: 1000 }, reducedMotion: 'no-preference' });
  page.on('pageerror', error => report.errors.push(error.message));
  await page.route('**/*', route => {
    const request = route.request(), url = request.url();
    if (url.startsWith(origin + '/') && request.method() === 'GET') return route.continue();
    const dependency = dependencies.find(([pattern]) => pattern.test(url));
    if (dependency && request.method() === 'GET') return route.fulfill({ contentType: dependency[2], body: fs.readFileSync(path.join(os.tmpdir(), dependency[1])) });
    report.blockedOrigins.push(new URL(url).origin);
    return route.abort();
  });
  await page.exposeFunction('recordLocalUiAction', action => report.cloudActions.push(action));
  await page.addInitScript(() => {
    const profile = { uid: 'merged_local_fixture', nickname: '本地测试记录者', points: 0 };
    const theme = {
      id: 'local-theme', title: '本地示例：沿着资料读故事', version: 1,
      introduction: '此内容仅用于整合后的页面检查，不是真实专题。',
      chapters: [{ id: 'local-chapter', title: '资料与来源', body: '本地测试记录了一条资料。', nodeIds: ['local-node'], sourceLinkIds: ['local-source'], claimIds: ['local-claim'], adoptedSourceLinkIds: ['local-source'] }],
      nodes: [{ id: 'local-node', label: '本地测试节点', resourceId: 'local-resource', resourceTitle: '本地测试资料', region: { province: '本地示例' }, location: { latitude: 30, longitude: 114 }, timeRange: { startYear: 2000 }, order: 0 }],
      sources: [{ id: 'local-source', submissionTitle: '本地虚构来源', contributorName: '匿名贡献者', summary: '仅用于浏览器回归。' }],
      claims: [{ id: 'local-claim', text: '本地测试记录了一条资料。', resourceId: 'local-resource', sourceLinkIds: ['local-source'] }], relations: [], questions: [], closing: ''
    };
    window.cloudbase = { init: () => ({
      auth: () => ({ getLoginState: async () => location.pathname.endsWith('/admin.html') ? null : { user: { uid: profile.uid } } }),
      getTempFileURL: async () => ({ fileList: [] }),
      callFunction: async ({ data }) => {
        await window.recordLocalUiAction(data.action);
        if (data.action === 'bootstrap') return { result: { ok: true, profile, stats: { total: 0, pending: 0 }, mySubmissions: [], publicSubmissions: [], rewards: [], myRedemptions: [], myFeedback: [] } };
        if (data.action === 'listStoryThemes') return { result: { ok: true, items: [{ id: theme.id, title: theme.title, introduction: theme.introduction, version: 1, chapterCount: 1, regions: ['本地示例'] }] } };
        if (data.action === 'getStoryTheme') return { result: { ok: true, theme } };
        return { result: { ok: true, items: [], resources: [], unreadCount: 0, enabled: false } };
      }
    }) };
  });
  return page;
}

async function openHome(page, origin) {
  await page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.getElementById('chu-startup') && window.ChuNavMotion && window.gsap);
  await page.evaluate(() => {
    const nav = document.getElementById('app-navigation');
    window.mergedOriginal = { nav, buttons: [...nav.querySelectorAll('.nav-item')], controls: ['header-account-entry', 'header-notification-entry'].map(id => document.getElementById(id)) };
    window.mergedStyles = [nav, ...nav.querySelectorAll('.nav-item, .nav-icon, .nav-label')].map(node => [node, node.style.cssText]);
    window.mergedFlightCount = 0;
    window.mergedFrameProblems = [];
    new MutationObserver(changes => {
      for (const change of changes) for (const node of change.addedNodes) if (node.nodeType === 1 && node.matches('.paper-nav-flight')) window.mergedFlightCount++;
    }).observe(document.body, { childList: true });
    const inspect = () => {
      if (document.querySelector('.paper-nav-flight')) {
        const live = document.getElementById('app-navigation');
        if (live !== window.mergedOriginal.nav || document.querySelectorAll('#app-navigation').length !== 1 || live.querySelectorAll('.nav-item').length !== 5) window.mergedFrameProblems.push('Navigation identity/number changed during motion');
        if (!document.getElementById('view-map').classList.contains('hidden') && getComputedStyle(document.querySelector('.field-map-stage')).transform !== 'none') window.mergedFrameProblems.push('Map stage received a transform');
      }
      requestAnimationFrame(inspect);
    };
    requestAnimationFrame(inspect);
  });
}

async function settled(page, tab, width, label) {
  await page.waitForFunction(() => !document.querySelector('.paper-nav-flight, .paper-nav-placeholder'));
  const state = await page.evaluate(({ tab, width, slot }) => {
    const nav = document.getElementById('app-navigation');
    const view = document.getElementById('view-' + tab);
    const logo = view.querySelector('.paper-home-wordmark img, .field-paper-wordmark img');
    const box = logo.getBoundingClientRect();
    const menu = document.getElementById('paper-home-menu');
    return {
      tab, width, slot: nav.parentElement.id,
      active: !view.classList.contains('hidden'),
      correctSlot: width >= 768 ? nav.parentElement.id === slot : !nav.closest('.page-view'),
      original: nav === window.mergedOriginal.nav && [...nav.querySelectorAll('.nav-item')].every((node, i) => node === window.mergedOriginal.buttons[i]) && window.mergedOriginal.controls.every(node => document.getElementById(node.id) === node),
      restoredStyles: window.mergedStyles.every(([node, css]) => node.style.cssText === css),
      singleNav: document.querySelectorAll('#app-navigation').length === 1,
      menuOrder: [...menu.children].filter(node => node.matches('button,a')).map(node => node.id || node.getAttribute('aria-label')),
      logo: { loaded: logo.complete && logo.naturalWidth > 0, source: logo.getAttribute('src'), width: box.width, height: box.height },
      noOverflow: document.documentElement.scrollWidth <= innerWidth + 1,
      navSizes: [...nav.querySelectorAll('.nav-item')].map(node => { const b = node.getBoundingClientRect(); return [b.width, b.height]; }),
      frameProblems: window.mergedFrameProblems
    };
  }, { tab, width, slot: slots[tab] });
  assert(state.active && state.correctSlot && state.original && state.restoredStyles && state.singleNav && state.noOverflow, label + ': ' + JSON.stringify(state));
  assert(state.logo.loaded && state.logo.source.endsWith('chulink-ink-wordmark-v2.png') && state.logo.width >= 115 && state.logo.height >= 40, JSON.stringify(state));
  assert(state.navSizes.every(([w, h]) => w >= 44 && h >= 44), 'Navigation hit targets ' + JSON.stringify(state.navSizes));
  assert.deepEqual(state.frameProblems, []);
  if (tab === 'discover') assert.equal(state.menuOrder.at(-1), 'paper-home-theme-link');
  return state;
}

async function clickView(page, tab, width) {
  await page.locator('#nav-' + tab).click();
  await page.waitForFunction(tab => !document.getElementById('view-' + tab).classList.contains('hidden'), tab);
  return settled(page, tab, width, 'switch ' + tab);
}

async function motionChecks(page) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await clickView(page, 'discover', 1440);
  await page.evaluate(() => document.getElementById('nav-community').click());
  await page.waitForFunction(() => Boolean(document.querySelector('.paper-nav-flight')));
  await page.evaluate(() => { window.repeatFlight = document.querySelector('.paper-nav-flight'); document.getElementById('nav-community').click(); });
  assert(await page.evaluate(() => document.querySelector('.paper-nav-flight') === window.repeatFlight), 'Repeating the active tab preserves flight');
  // A real pointer hit while moving must reach the original live button.
  const hit = await page.locator('#nav-map').boundingBox();
  await page.mouse.click(hit.x + hit.width / 2, hit.y + hit.height / 2);
  await page.waitForFunction(() => !document.getElementById('view-map').classList.contains('hidden'));
  const mapFrames = await page.evaluate(() => new Promise(resolve => {
    const samples = [];
    function frame() {
      const stage = document.querySelector('.field-map-stage'), box = stage.getBoundingClientRect();
      samples.push({ height: box.height, top: box.top, transform: getComputedStyle(stage).transform });
      if (document.querySelector('.paper-nav-flight')) requestAnimationFrame(frame); else resolve(samples);
    }
    frame();
  }));
  assert(mapFrames.length > 1 && mapFrames.every(frame => frame.transform === 'none'), JSON.stringify(mapFrames));
  assert(Math.max(...mapFrames.map(frame => frame.height)) - Math.min(...mapFrames.map(frame => frame.height)) <= 1, 'Map height is stable throughout flight');
  report.motion.push({ scenario: 'same tab repeat, moving pointer hit, stable map footprint', frames: mapFrames.length });
  await settled(page, 'map', 1440, 'map arrival');

  for (const tab of ['profile', 'discover', 'community', 'map', 'profile', 'discover']) {
    await page.evaluate(tab => document.getElementById('nav-' + tab).click(), tab);
    await page.waitForTimeout(90);
    assert(await page.locator('.paper-nav-flight').count() <= 1, 'Only one moving row during rapid changes');
  }
  await settled(page, 'discover', 1440, 'rapid retarget');
  report.motion.push({ scenario: 'rapid community/map/profile/home retargeting' });
  for (const action of ['Tab', 'Escape', 'wheel', 'resize']) {
    await clickView(page, 'discover', 1440);
    await page.evaluate(() => document.getElementById('nav-map').click());
    await page.waitForFunction(() => Boolean(document.querySelector('.paper-nav-flight')));
    if (action === 'wheel') await page.mouse.wheel(0, 120);
    else if (action === 'resize') await page.setViewportSize({ width: 390, height: 1000 });
    else await page.keyboard.press(action);
    await settled(page, 'map', action === 'resize' ? 390 : 1440, 'cancel ' + action);
    report.motion.push({ scenario: 'in-flight ' + action + ' restores live layout' });
    if (action === 'resize') await page.setViewportSize({ width: 1440, height: 1000 });
  }
  await clickView(page, 'discover', 1440);
  const originalGsap = await page.evaluate(() => { window.savedGsap = window.gsap; window.gsap = undefined; return true; });
  assert(originalGsap);
  await clickView(page, 'community', 1440);
  assert.equal(await page.locator('.paper-nav-flight').count(), 0);
  await page.evaluate(() => { window.gsap = window.savedGsap; });
  report.motion.push({ scenario: 'missing GSAP leaves all real controls usable' });
}

async function retainedFlows(page, origin) {
  await page.setViewportSize({ width: 390, height: 1000 });
  await clickView(page, 'collect', 390);
  await page.getByLabel('资料标题（选填）').fill('本地整合测试标题');
  assert.equal(await page.getByLabel('资料标题（选填）').inputValue(), '本地整合测试标题');
  assert.equal(await page.locator('#collect-effects-preference #content-effects-choice').count(), 1);
  await page.locator('.collect-consent-disclosure > summary').click();
  await page.locator('#content-effects-choice').uncheck();
  assert.equal(await page.evaluate(() => localStorage.getItem('chu-effects-disabled')), 'true');
  await page.locator('#content-effects-choice').check();
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.locator('.collect-title-field').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, `merged-collect-form-${width}.png`) });
  }
  await page.setViewportSize({ width: 390, height: 1000 });
  await clickView(page, 'discover', 390);
  await page.locator('#theme-story-float').waitFor({ state: 'visible' });
  await page.locator('#theme-story-dismiss').click();
  assert.equal(await page.locator('#theme-story-float').isVisible(), false);
  await page.locator('#paper-home-more').click();
  await page.locator('#paper-home-theme-link').click();
  await page.waitForURL('**/themes.html');
  await page.locator('.theme-card a').click();
  await page.locator('.chapter').waitFor();
  assert.equal(await page.locator('.expand > details[open]').count(), 0);
  await page.locator('.chapter-source > summary').first().click();
  assert.match(await page.locator('.chapter-source').first().innerText(), /匿名贡献者/);
  assert.match(await page.locator('.chapter-source').first().innerText(), /正式采用/);
  assert.equal(await page.locator('.brand img').getAttribute('src'), './static/assets/chulink-ink-wordmark-v2.png');
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.screenshot({ path: path.join(output, `merged-theme-reader-${width}.png`), fullPage: true });
  }
  await page.goto(origin + '/index.html');
  await page.waitForFunction(() => !document.getElementById('chu-startup'));
  assert.equal(await page.locator('#theme-story-float').isVisible(), false, 'Dismissal survives a return from themes');
}

async function adminCheck(browser, origin) {
  const page = await preparePage(browser, origin);
  await page.exposeFunction('mergedAdminRead', data => {
    assert.equal(data.action, 'list', 'This smoke check makes no mutations');
    report.cloudActions.push('admin:list:' + data.status);
    return { ok: true, status: data.status, offset: 0, limit: 20, hasMore: false, nextOffset: 20, resourceOptions: [], items: data.status === 'approved' ? [{ id: 'local-approved', status: 'approved', title: '本地测试：已通过的村落资料', description: '只检查管理入口，未执行发布或撤回。', assetType: 'text', regionName: '本地示例', reviewedAt: '2026-10-03T00:00:00Z' }] : [] };
  });
  await page.goto(origin + '/admin.html');
  await page.evaluate(async () => {
    callAdmin = window.mergedAdminRead;
    document.getElementById('admin-panel').classList.remove('hidden');
    document.getElementById('login-panel').style.display = 'none';
    document.getElementById('identity').textContent = '本地虚构数据检查';
    await loadPending();
  });
  await page.locator('[data-submission-status="approved"]').click();
  const card = page.locator('[data-binding-submission-id="local-approved"]');
  await card.locator('details.admin-compact > summary').first().click();
  assert.equal(await card.locator('[data-resource-binding-select]').count(), 1);
  assert.equal(await card.locator('.admin-resource-create').getAttribute('open'), null);
  assert.equal(await card.locator('.admin-withdraw-panel').getAttribute('open'), null);
  await card.locator('.admin-resource-create > summary').click();
  await card.locator('.admin-withdraw-panel > summary').click();
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
    assert(noOverflow);
    await page.screenshot({ path: path.join(output, `merged-admin-approved-${width}.png`), fullPage: true });
    report.admin.push({ width, noOverflow, retained: 'approved management, resource binding, collapsed creation and withdrawal' });
  }
  await page.close();
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  for (const [, file] of dependencies) assert(fs.existsSync(path.join(os.tmpdir(), file)), 'Required cached dependency: ' + file);
  const server = http.createServer((req, res) => {
    const file = path.resolve(root, '.' + new URL(req.url, 'http://local').pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end();
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2' };
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  let browser, page;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    page = await preparePage(browser, origin);
    await openHome(page, origin);
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      const before = await page.evaluate(() => window.mergedFlightCount);
      for (const tab of tabs) {
        report.layouts.push(await clickView(page, tab, width));
        // Let the independent 1.44 s paper entrance finish before visual capture.
        await page.waitForTimeout(1500);
        await page.screenshot({ path: path.join(output, `merged-${tab}-${width}.png`) });
      }
      const flights = await page.evaluate(() => window.mergedFlightCount);
      assert(width < 768 ? flights === before : flights > before, 'Normal motion must run only on desktop/tablet');
    }
    await motionChecks(page);
    await retainedFlows(page, origin);
    await adminCheck(browser, origin);
    assert.deepEqual(report.errors, []);
    report.blockedOrigins = [...new Set(report.blockedOrigins)];
    fs.writeFileSync(path.join(output, 'merged-paper-report.json'), JSON.stringify(report, null, 2));
    console.log('Merged paper UI passed: normal five-view motion, community slot, rapid/cancel/fallback, v2 logos, theme float/menu/reader, collect title/privacy and approved administration at 390/768/1440.');
    console.log('Screenshots: ' + output);
  } catch (error) {
    await page?.screenshot({ path: path.join(output, 'merged-failure.png') }).catch(() => {});
    fs.writeFileSync(path.join(output, 'merged-paper-failure.json'), JSON.stringify({ ...report, failure: error.message }, null, 2));
    throw error;
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
