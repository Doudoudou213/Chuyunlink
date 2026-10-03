'use strict';

// Real home page and controls, with local CloudBase fixtures and cached visual dependencies.
// This suite never falls back to the network or sends production requests.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const output = process.argv[2] || path.join(os.tmpdir(), 'chulink-theme-float-qa');
const preferenceKey = 'chulink:theme-story-float:dismissed:v1';
const dependencies = [
  [/^https:\/\/cdn\.tailwindcss\.com/, 'chulink-submission-tailwind.js', 'application/javascript'],
  [/^https:\/\/unpkg\.com\/lucide/, 'chulink-header-lucide.js', 'application/javascript'],
  [/^https:\/\/cdn\.bootcdn\.net\/ajax\/libs\/leaflet\/1\.9\.4\/leaflet\.js$/, 'chulink-header-leaflet.js', 'application/javascript'],
  [/^https:\/\/cdn\.bootcdn\.net\/ajax\/libs\/leaflet\/1\.9\.4\/leaflet\.css$/, 'chulink-header-leaflet.css', 'text/css']
];

async function preparePage(browser, origin, { motion = 'reduce', storageFailure = false } = {}) {
  const page = await browser.newPage({ reducedMotion: motion, viewport: { width: 390, height: 950 } });
  const errors = [], forbiddenRequests = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    const request = route.request(), url = request.url();
    if (url.startsWith(origin + '/')) {
      if (new URL(url).pathname === '/themes.html') return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><title>本地专题导航检查</title><h1 id="theme-navigation-marker">主题故事</h1>' });
      return route.continue();
    }
    const dependency = dependencies.find(([pattern]) => pattern.test(url));
    if (dependency && request.method() === 'GET') {
      return route.fulfill({ contentType: dependency[2], body: fs.readFileSync(path.join(os.tmpdir(), dependency[1])) });
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) forbiddenRequests.push({ url: new URL(url).origin, method: request.method() });
    return route.abort();
  });
  await page.addInitScript(({ preferenceKey, storageFailure }) => {
    if (storageFailure) {
      for (const method of ['getItem', 'setItem', 'removeItem']) {
        const original = Storage.prototype[method];
        Storage.prototype[method] = function (key, ...args) {
          if (key === preferenceKey) throw new DOMException('Local test storage unavailable', 'SecurityError');
          return original.call(this, key, ...args);
        };
      }
    }
    const profile = { uid: 'theme_float_fixture', nickname: '本地测试记录者', points: 0 };
    const fixture = {
      ok: true, resource: { id: 'local_resource', title: '本地故事测试' }, contributorCount: 1,
      items: [{ id: 'local_source', evidenceSummary: '本地测试材料。', submission: { title: '本地材料', description: '材料记录了石刻。', contributorName: '本地测试记录者' } }],
      story: { id: 'local_story', version: 1, title: '本地故事', introduction: '仅用于界面检查。', chapters: [{ title: '观察', body: '材料记录了石刻。', sourceLinkIds: ['local_source'] }] },
      claims: [{ id: 'local_claim', chapterIndex: 0, text: '材料记录了石刻。', sourceLinkIds: ['local_source'] }]
    };
    window.cloudbase = { init: () => ({
      auth: () => ({ getLoginState: async () => ({ user: { uid: profile.uid } }) }),
      getTempFileURL: async () => ({ fileList: [] }),
      callFunction: async ({ data }) => ({ result: data.action === 'bootstrap'
        ? { ok: true, profile, stats: { total: 0, pending: 0 }, mySubmissions: [], publicSubmissions: [], rewards: [], myRedemptions: [], myFeedback: [] }
        : data.action === 'getStoryEvidence' ? fixture : { ok: true, items: [], resources: [], unreadCount: 0, enabled: false } })
    }) };
    window.floatAnimationEvents = [];
    for (const type of ['animationstart', 'animationend']) document.addEventListener(type, event => {
      if (event.animationName !== 'theme-story-settle') return;
      const style = getComputedStyle(event.target);
      window.floatAnimationEvents.push({ type, name: event.animationName, time: performance.now(), elapsed: event.elapsedTime, duration: style.animationDuration, iterations: style.animationIterationCount });
    }, true);
    window.floatStartupOverlap = false;
    new MutationObserver(() => {
      const startup = document.getElementById('chu-startup'), float = document.getElementById('theme-story-float');
      if (startup?.getClientRects().length && float?.getClientRects().length && !float.hidden) window.floatStartupOverlap = true;
      const login = document.getElementById('cloud-login-modal');
      if (login?.getClientRects().length && !login.classList.contains('hidden')) sessionStorage.setItem('theme-float-login-opened', '1');
    }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'hidden', 'style'] });
  }, { preferenceKey, storageFailure });
  return { page, errors, forbiddenRequests };
}

async function openHome(page, origin, visible = true) {
  await page.goto(origin + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.getElementById('chu-startup') && document.getElementById('cloud-login-modal'));
  try {
    await page.locator('#theme-story-float').waitFor({ state: visible ? 'visible' : 'hidden' });
  } catch (error) {
    await page.screenshot({ path: path.join(output, 'theme-float-failure.png') });
    error.message += '\nPage state: ' + JSON.stringify(await page.evaluate(() => ({
      view: document.querySelector('.page-view:not(.hidden)')?.id, documentHidden: document.hidden,
      focus: document.activeElement?.outerHTML.slice(0, 250), viewport: [innerHeight, visualViewport?.height],
      blockers: [...document.querySelectorAll('[id$="-modal"], [id$="-drawer"], [role="dialog"], dialog[open], #external-service-guide, #chu-startup, #paper-home-menu, #paper-activity-panel')]
        .filter(node => node.getClientRects().length && !node.closest('.hidden,[hidden],[inert],[aria-hidden="true"]') && getComputedStyle(node).visibility === 'visible').map(node => node.id)
    })));
    throw new Error(error.message, { cause: error });
  }
  assert.equal(await page.evaluate(() => window.floatStartupOverlap), false, 'Float must stay hidden during startup');
}

async function settleFloat(page, visible) {
  await page.locator('#theme-story-float').waitFor({ state: visible ? 'visible' : 'hidden' });
  assert.equal(await page.locator('#theme-story-float').isVisible(), visible);
}

async function switchView(page, view, visible = view === 'discover') {
  await page.evaluate(view => { document.activeElement?.blur(); window.switchTab(view); }, view);
  await page.waitForFunction(view => !document.getElementById('view-' + view).classList.contains('hidden'), view);
  if (visible === 'layout') await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  else await settleFloat(page, visible);
}

async function assertNativeThemeNavigation(page, act) {
  await page.evaluate(() => sessionStorage.removeItem('theme-float-login-opened'));
  await Promise.all([page.waitForURL('**/themes.html'), act()]);
  await page.locator('#theme-navigation-marker').waitFor();
  assert.equal(await page.evaluate(() => sessionStorage.getItem('theme-float-login-opened')), null, 'Native story link must not open account login');
}

async function verifyHotspotClearance(page, origin) {
  await page.setViewportSize({ width: 390, height: 844 });
  await openHome(page, origin);
  const samples = [];
  for (const bannerHeight of [0, 44]) {
    if (bannerHeight) await page.evaluate(() => {
      const banner = document.createElement('div');
      banner.id = 'local-preview-banner-fixture';
      banner.textContent = '本地预览 · 测试数据';
      banner.style.cssText = 'height:44px;box-sizing:border-box;display:grid;place-items:center;background:#eee8da;color:#30392e;font:12px system-ui';
      document.body.prepend(banner);
    });
    // Scroll the original CTA through both the art and label positions, then back to the top.
    for (const scroll of [0, 24, 48, 72, 96, 128, 176, 0]) {
      await page.evaluate(async scroll => {
        document.activeElement?.blur();
        window.scrollTo({ top: scroll, behavior: 'instant' });
        document.getElementById('app-viewport').scrollTo({ top: scroll, behavior: 'instant' });
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      }, scroll);
      const sample = await page.evaluate(({ bannerHeight, scroll }) => {
        const action = document.getElementById('discover-hotspot-action'), float = document.getElementById('theme-story-float');
        const rect = node => { const box = node.getBoundingClientRect(); return { top: box.top, right: box.right, bottom: box.bottom, left: box.left, width: box.width, height: box.height }; };
        const target = rect(action), floating = rect(float), nav = rect(document.getElementById('app-navigation'));
        const visible = !float.hidden && !!float.getClientRects().length;
        const overlap = visible && floating.left < target.right && floating.right > target.left && floating.top < target.bottom && floating.bottom > target.top;
        const points = [0.1, 0.5, 0.9].flatMap(x => [0.2, 0.5, 0.8].map(y => {
          const hit = document.elementFromPoint(target.left + target.width * x, target.top + target.height * y);
          // The card's decorative compass can receive the hit; it shares the original CTA button.
          return { x, y, reachable: action.closest('button').contains(hit) && !float.contains(hit), hit: hit?.id || hit?.tagName };
        }));
        return { bannerHeight, scroll, actualScroll: window.scrollY + document.getElementById('app-viewport').scrollTop, visible, overlap, target, floating, nav, points };
      }, { bannerHeight, scroll });
      assert(!sample.overlap && sample.points.every(point => point.reachable), 'Hotspot CTA must never be intercepted: ' + JSON.stringify(sample));
      assert(sample.target.top >= 0 && sample.target.bottom <= sample.nav.top, 'Fixture CTA must remain in the usable phone viewport: ' + JSON.stringify(sample));
      if (scroll === 0 || scroll === 72) await page.screenshot({ path: path.join(output, `theme-float-hotspot-390x844-banner${bannerHeight}-scroll${scroll}.png`) });
      // Click the measured CTA center without locator scrolling or force; its original action must open.
      await page.mouse.click((sample.target.left + sample.target.right) / 2, (sample.target.top + sample.target.bottom) / 2);
      await page.locator('#endangered-hotspot-modal').waitFor({ state: 'visible' });
      await settleFloat(page, false);
      await page.locator('#endangered-hotspot-modal button[onclick="closeEndangeredHotspot()"]').click();
      await page.mouse.move(0, 0);
      samples.push(sample);
    }
  }
  assert(samples.some(sample => sample.actualScroll >= 96), 'CTA collision test must actually scroll the page');
  assert(samples.some(sample => !sample.visible), 'Tight CTA collisions must exercise the hidden fallback');
  assert(samples.some(sample => sample.visible), 'Float should remain available where the CTA has room');
  return samples;
}

(async () => {
  dependencies.forEach(([, filename]) => assert(fs.existsSync(path.join(os.tmpdir(), filename)), `Missing cached visual dependency: ${filename}; use the same local cache as test-paper-header-ui.js`));
  assert.match(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), /<aside\b[^>]*id="theme-story-float"[^>]*\bhidden(?:\s|>)/, 'Float must be hidden in initial HTML');
  fs.mkdirSync(output, { recursive: true });
  const server = http.createServer((req, res) => {
    const file = path.resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://local').pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end();
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2' };
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  const report = { layouts: [], checks: [], errors: [], forbiddenRequests: [] };
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const primary = await preparePage(browser, origin), page = primary.page;
    await openHome(page, origin);
    await page.evaluate(() => {
      window.floatOriginalControls = Object.fromEntries(['app-navigation', 'header-account-entry', 'header-notification-entry'].map(id => [id, document.getElementById(id)]));
      window.floatOriginalControls.help = document.querySelector('button[aria-label="使用帮助"]');
    });
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 950 });
      for (const view of ['discover', 'map', 'collect', 'community', 'profile']) {
        await switchView(page, view, view === 'discover' ? 'layout' : false);
        await page.evaluate(() => { window.scrollTo(0, 0); document.getElementById('app-viewport').scrollTo(0, 0); });
        const metrics = await page.evaluate(({ view, width }) => {
          const float = document.getElementById('theme-story-float'), link = document.getElementById('theme-story-link'), close = document.getElementById('theme-story-dismiss'), art = link.querySelector('img');
          const rect = node => { const b = node.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height, top: b.top, right: b.right, bottom: b.bottom, left: b.left }; };
          const wasHidden = float.hidden, actuallyVisible = !wasHidden && !!float.getClientRects().length;
          // Measure the hidden fallback synchronously without painting or altering its final state.
          if (view === 'discover' && wasHidden) float.hidden = false;
          const floatBox = rect(float), linkBox = rect(link), closeBox = rect(close), navBox = rect(document.getElementById('app-navigation'));
          const overlaps = (a, b) => a.width > 0 && a.height > 0 && b.width > 0 && b.height > 0 && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
          const hit = node => { const b = rect(node); return node.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)); };
          const hotspotBox = rect(document.getElementById('discover-hotspot-action'));
          const hotspotLift = Math.ceil(floatBox.bottom - hotspotBox.top + 8);
          const collisionFallback = wasHidden && view === 'discover' && overlaps(floatBox, hotspotBox) && (hotspotLift > 96 || floatBox.top - hotspotLift < 8);
          const result = {
            width, view, visible: actuallyVisible, collisionFallback, hotspotBox, hotspotLift, noOverflow: document.documentElement.scrollWidth <= innerWidth + 1,
            controlsUnique: Object.entries(window.floatOriginalControls).every(([id, original]) => id === 'help'
              ? document.querySelector('button[aria-label="使用帮助"]') === original && document.querySelectorAll('button[aria-label="使用帮助"]').length === 1
              : document.getElementById(id) === original && document.querySelectorAll(`[id="${id}"]`).length === 1),
            menuLinkRetained: document.querySelectorAll('#paper-home-menu > #paper-home-theme-link').length === 1 && document.getElementById('paper-home-theme-link').getAttribute('href') === './themes.html',
            floatBox, linkBox, closeBox, navBox, navOverlap: overlaps(floatBox, navBox), closeOverlap: overlaps(closeBox, linkBox), hits: [hit(link), hit(close)],
            imageLoaded: art.complete && art.naturalWidth > 0, imageWidth: rect(art).width, imageSrc: art.getAttribute('src'), label: link.textContent.trim(), href: link.getAttribute('href'), animation: getComputedStyle(art).animationName
          };
          float.hidden = wasHidden;
          return result;
        }, { width, view });
        assert(metrics.controlsUnique && metrics.menuLinkRetained && metrics.noOverflow, JSON.stringify(metrics));
        assert(view === 'discover' ? metrics.visible || metrics.collisionFallback : !metrics.visible, JSON.stringify(metrics));
        if (view === 'discover') {
          assert(metrics.imageLoaded && metrics.imageSrc.endsWith('/theme-phoenix-book-v1.png'), JSON.stringify(metrics));
          assert.equal(metrics.imageWidth, 72, 'Approved illustration is rendered at 72 px');
          assert.equal(metrics.label, '读故事');
          assert.equal(metrics.href, './themes.html');
          assert.equal(metrics.animation, 'none', 'Reduced motion disables float animation');
          assert(!metrics.navOverlap && !metrics.closeOverlap && metrics.hits.every(Boolean), JSON.stringify(metrics));
          assert(metrics.linkBox.width >= 44 && metrics.linkBox.height >= 44 && metrics.closeBox.width >= 44 && metrics.closeBox.height >= 44, JSON.stringify(metrics));
          assert(metrics.closeBox.bottom <= metrics.linkBox.top && metrics.floatBox.left >= 0 && metrics.floatBox.right <= width && metrics.floatBox.bottom <= 950, JSON.stringify(metrics));
        }
        await page.screenshot({ path: path.join(output, `theme-float-${view}-${width}.png`) });
        if (view === 'discover' && width === 768 && metrics.collisionFallback) {
          await page.evaluate(() => window.scrollTo({ top: 200, behavior: 'instant' }));
          await settleFloat(page, true);
          await page.screenshot({ path: path.join(output, 'theme-float-discover-768-scrolled.png') });
        }
        report.layouts.push(metrics);
      }
    }
    report.checks.push('390/768/1440 layouts, five views, original control identities, separate 44 px targets and navigation clearance');
    await page.setViewportSize({ width: 390, height: 950 });
    await switchView(page, 'discover');
    await page.locator('#paper-home-more').click();
    await page.locator('#paper-home-menu').waitFor({ state: 'visible' });
    await settleFloat(page, false);
    await page.screenshot({ path: path.join(output, 'theme-float-more-menu-390.png') });
    await page.locator('#paper-home-menu button[aria-label="使用帮助"]').click();
    await page.locator('#welcome-guide-modal').waitFor({ state: 'visible' });
    await settleFloat(page, false);
    await page.locator('#welcome-guide-modal button[onclick="closeOnboardingModal()"]').click();
    await settleFloat(page, true);
    await page.locator('#paper-home-more').click();
    await page.locator('#header-account-entry').click();
    await page.locator('#cloud-login-modal').waitFor({ state: 'visible' });
    await settleFloat(page, false);
    await page.locator('#cloud-login-close').click();
    await settleFloat(page, true);
    await page.evaluate(() => window.openStoryEvidence('local_resource', '本地故事测试'));
    await page.locator('[data-story-open-claim="local_claim"]').click();
    await page.locator('#cloud-story-claim-drawer').waitFor({ state: 'visible' });
    await settleFloat(page, false);
    await page.locator('#cloud-story-claim-close').click();
    await settleFloat(page, false);
    await page.locator('#cloud-story-evidence-close').click();
    await settleFloat(page, true);
    await page.evaluate(() => window.openEmbeddedServiceGuide('dianping', '本地测试', 'https://example.invalid'));
    await page.locator('#external-service-guide').waitFor({ state: 'visible' });
    await settleFloat(page, false);
    await page.locator('#external-service-close').click();
    await settleFloat(page, true);
    // The activity note belongs to other page flows. Exercise its existing panel as an overlay on home.
    await page.evaluate(() => { document.getElementById('paper-activity-note').hidden = false; document.getElementById('paper-activity-panel').hidden = false; });
    await page.locator('#paper-activity-panel').waitFor({ state: 'visible' });
    await settleFloat(page, false);
    await page.evaluate(() => { document.getElementById('paper-activity-panel').hidden = true; document.getElementById('paper-activity-note').hidden = true; });
    await settleFloat(page, true);
    report.checks.push('More menu, actual help/login/story source drawer, third-party guide and activity panel hide the float');
    await page.locator('#discover-search-input').focus();
    await settleFloat(page, false);
    await page.locator('#discover-search-input').fill('本地搜索');
    await page.locator('#discover-search-input').fill('');
    await page.locator('#discover-search-input').blur();
    await settleFloat(page, true);
    await page.evaluate(() => {
      const editable = document.createElement('div');
      editable.id = 'local-editable-fixture'; editable.contentEditable = 'true'; editable.textContent = '本地可编辑区';
      document.getElementById('view-discover').appendChild(editable); editable.focus();
    });
    await settleFloat(page, false);
    await page.locator('#local-editable-fixture').blur();
    await settleFloat(page, true);
    await page.evaluate(() => document.getElementById('local-editable-fixture').remove());
    // Browser automation cannot open an OS keyboard; use its real visualViewport resize event and geometry contract.
    await page.evaluate(() => {
      window.floatOriginalViewportHeight = window.visualViewport.height;
      Object.defineProperty(window.visualViewport, 'height', { configurable: true, get: () => window.floatOriginalViewportHeight - 350 });
      window.visualViewport.dispatchEvent(new Event('resize'));
    });
    await settleFloat(page, false);
    await page.evaluate(() => { delete window.visualViewport.height; window.visualViewport.dispatchEvent(new Event('resize')); });
    await settleFloat(page, true);
    report.checks.push('Text input, contenteditable focus and keyboard-sized visualViewport shrink hide the float and restore correctly');
    await assertNativeThemeNavigation(page, () => page.locator('#theme-story-link').click());
    await openHome(page, origin);
    await page.locator('#theme-story-dismiss').click();
    await settleFloat(page, false);
    assert.equal(await page.evaluate(key => localStorage.getItem(key), preferenceKey), '1');
    for (const view of ['map', 'collect', 'community', 'profile', 'discover']) await switchView(page, view, false);
    await openHome(page, origin, false);
    const more = page.locator('#paper-home-more'), menu = page.locator('#paper-home-menu');
    await more.focus();
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'header-account-entry');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), '使用帮助');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'paper-home-theme-link');
    assert.equal((await page.locator('#paper-home-theme-link').textContent()).trim(), '主题故事');
    await page.keyboard.press('Home');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'header-account-entry');
    await page.keyboard.press('End');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'paper-home-theme-link');
    await page.keyboard.press('ArrowUp');
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), '使用帮助');
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'paper-home-theme-link');
    await page.keyboard.press('Escape');
    assert(!(await menu.isVisible()) && await more.evaluate(node => node === document.activeElement));
    assert.equal(await page.locator('#paper-home-menu > #paper-home-theme-link').count(), 1);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('End');
    await assertNativeThemeNavigation(page, () => page.keyboard.press('Enter'));
    report.checks.push('Dismiss survives view changes and reload; native floating/menu links navigate locally without login; ArrowDown/Up, Tab, Home/End, Escape and Enter work');
    const unavailable = await preparePage(browser, origin, { storageFailure: true });
    await openHome(unavailable.page, origin);
    await unavailable.page.locator('#theme-story-dismiss').click();
    await settleFloat(unavailable.page, false);
    for (const view of ['map', 'collect', 'community', 'profile', 'discover', 'community', 'discover']) await switchView(unavailable.page, view, false);
    await unavailable.page.locator('#paper-home-more').click();
    await assertNativeThemeNavigation(unavailable.page, () => unavailable.page.locator('#paper-home-theme-link').click());
    report.checks.push('Unavailable localStorage still permits in-memory dismissal through repeated view switches and menu navigation');
    const animated = await preparePage(browser, origin, { motion: 'no-preference' });
    await openHome(animated.page, origin);
    await animated.page.waitForFunction(() => window.floatAnimationEvents.some(event => event.type === 'animationstart'));
    const start = await animated.page.evaluate(() => window.floatAnimationEvents.find(event => event.type === 'animationstart'));
    assert.equal(start.iterations, '2');
    assert(parseFloat(start.duration) * Number(start.iterations) <= 5.2, JSON.stringify(start));
    await animated.page.waitForFunction(() => !document.getElementById('theme-story-float').classList.contains('theme-story-arriving'), null, { timeout: 6500 });
    const motion = await animated.page.evaluate(() => ({ events: window.floatAnimationEvents, animation: getComputedStyle(document.querySelector('.theme-story-art')).animationName }));
    assert(motion.events.some(event => event.type === 'animationend' && event.elapsed <= 5.2), JSON.stringify(motion));
    assert.equal(motion.animation, 'none');
    await switchView(animated.page, 'map');
    await switchView(animated.page, 'discover');
    assert.equal(await animated.page.locator('#theme-story-float').evaluate(node => node.classList.contains('theme-story-arriving')), false, 'Entrance animation must not replay after switching views');
    report.motion = motion;
    report.checks.push('Normal motion settles within 5.2 seconds after two iterations and never restarts on view switching; reduced motion stays still');
    const shortPhone = await preparePage(browser, origin);
    report.hotspotClearance = await verifyHotspotClearance(shortPhone.page, origin);
    report.checks.push('390x844 phone with and without a 44 px preview banner: hotspot CTA remains hit-testable and clickable through scrolling, including float-hidden fallback');
    for (const run of [primary, unavailable, animated, shortPhone]) {
      report.errors.push(...run.errors); report.forbiddenRequests.push(...run.forbiddenRequests);
    }
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.forbiddenRequests, [], 'No production write request may be attempted');
    fs.writeFileSync(path.join(output, 'theme-float-report.json'), JSON.stringify(report, null, 2));
    console.log(`Theme float UI passed: ${report.layouts.length} layouts; ${report.checks.length} interaction groups; no page errors or production writes.`);
    console.log(`Screenshots and report: ${output}`);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
