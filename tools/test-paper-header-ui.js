'use strict';

// Actual page, styles and shared control coordinator; all cloud calls are local fixtures.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const output = process.argv[2] || path.join(os.tmpdir(), 'chulink-paper-header-qa');
const dependencies = [
  [/^https:\/\/cdn\.tailwindcss\.com/, 'chulink-submission-tailwind.js', 'application/javascript'],
  [/^https:\/\/unpkg\.com\/lucide/, 'chulink-header-lucide.js', 'application/javascript'],
  [/^https:\/\/cdn\.bootcdn\.net\/ajax\/libs\/leaflet\/1\.9\.4\/leaflet\.js$/, 'chulink-header-leaflet.js', 'application/javascript'],
  [/^https:\/\/cdn\.bootcdn\.net\/ajax\/libs\/leaflet\/1\.9\.4\/leaflet\.css$/, 'chulink-header-leaflet.css', 'text/css']
];

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const server = http.createServer((req, res) => {
    const file = path.resolve(root, '.' + new URL(req.url, 'http://local').pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end();
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2' };
    res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ reducedMotion: 'reduce', viewport: { width: 390, height: 950 } });
    const errors = [], results = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      const url = route.request().url();
      if (url.startsWith(`http://127.0.0.1:${server.address().port}/`)) return route.continue();
      const dependency = dependencies.find(([pattern]) => pattern.test(url));
      if (dependency && route.request().method() === 'GET') {
        const cache = path.join(os.tmpdir(), dependency[1]);
        if (fs.existsSync(cache)) return route.fulfill({ contentType: dependency[2], body: fs.readFileSync(cache) });
        const response = await route.fetch({ timeout: 30000 });
        assert(response.ok(), 'Visual dependency must load');
        return route.fulfill({ response });
      }
      return route.abort();
    });
    await page.addInitScript(() => {
      const profile = { uid: 'header_fixture', nickname: '本地演示', points: 0 };
      const app = {
        auth: () => ({ getLoginState: async () => ({ user: { uid: profile.uid, email: 'fixture@example.invalid' } }) }),
        getTempFileURL: async () => ({ fileList: [] }),
        callFunction: async ({ data }) => ({ result: data.action === 'bootstrap'
          ? { ok: true, profile, stats: { total: 0, pending: 0 }, mySubmissions: [], publicSubmissions: [], rewards: [], myRedemptions: [], myFeedback: [] }
          : { ok: true, items: [], resources: [], unreadCount: 0, enabled: false } })
      };
      window.cloudbase = { init: () => app };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !document.getElementById('chu-startup'));
    await page.evaluate(() => {
      window.headerTestOriginals = Object.fromEntries(['app-navigation', 'header-account-entry', 'header-notification-entry'].map(id => [id, document.getElementById(id)]));
      window.headerTestOriginals.help = document.querySelector('button[aria-label="使用帮助"]');
      document.getElementById('header-notification-entry').classList.remove('hidden');
    });
    const slots = { discover: 'paper-home-navigation', map: 'field-map-navigation', collect: 'field-collect-navigation', community: 'field-community-navigation', profile: 'paper-profile-navigation' };
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 950 });
      for (const view of Object.keys(slots)) {
        await page.evaluate(view => window.switchTab(view), view);
        await page.waitForFunction(view => document.querySelector(`.page-view:not(.hidden)`)?.id === `view-${view}`, view);
        await page.evaluate(() => { window.scrollTo(0, 0); document.getElementById('app-viewport').scrollTo(0, 0); });
        const metrics = await page.evaluate(({ view, width, slot }) => {
          const active = document.getElementById(`view-${view}`);
          const image = active.querySelector('.paper-home-wordmark img, .field-paper-wordmark img');
          const logo = image.getBoundingClientRect(), bounds = active.getBoundingClientRect();
          const nav = document.getElementById('app-navigation');
          return {
            view, width, logoWidth: logo.width, logoHeight: logo.height, imageLoaded: image.complete && image.naturalWidth > 0,
            imageSrc: image.getAttribute('src'), centered: Math.abs((logo.left + logo.right) / 2 - (bounds.left + bounds.right) / 2) < 1,
            headerHidden: getComputedStyle(document.getElementById('platform-header')).display === 'none',
            navigationCorrect: width >= 768 ? nav.parentElement.id === slot : !nav.closest('.page-view'),
            uniqueControls: Object.entries(window.headerTestOriginals).every(([id, original]) => id === 'help'
              ? document.querySelector('button[aria-label="使用帮助"]') === original && document.querySelectorAll('button[aria-label="使用帮助"]').length === 1
              : document.getElementById(id) === original && document.querySelectorAll(`[id="${id}"]`).length === 1),
            noOverflow: document.documentElement.scrollWidth <= innerWidth + 1,
            buttonSizes: [...active.querySelectorAll('[data-field-more], #paper-home-more, #cloud-profile-settings, #header-notification-entry')]
              .filter(node => node.getClientRects().length).map(node => { const rect = node.getBoundingClientRect(); return [rect.width, rect.height]; })
          };
        }, { view, width, slot: slots[view] });
        assert(metrics.imageLoaded && metrics.imageSrc.endsWith('chulink-ink-wordmark-v2.png'), JSON.stringify(metrics));
        assert(metrics.logoWidth >= 115 && metrics.logoWidth <= 125 && metrics.logoHeight >= 40, JSON.stringify(metrics));
        assert(metrics.headerHidden && metrics.navigationCorrect && metrics.uniqueControls && metrics.noOverflow, JSON.stringify(metrics));
        assert(metrics.buttonSizes.every(([w, h]) => w >= 44 && h >= 44), JSON.stringify(metrics));
        if (view === 'community') {
          assert(metrics.centered, 'Community wordmark must be centered');
          const more = page.locator('#view-community [data-field-more]');
          const menu = page.locator('#field-community-menu');
          await more.focus();
          await page.keyboard.press('ArrowDown');
          assert(await menu.isVisible());
          assert(await menu.evaluate(node => node.contains(document.activeElement)));
          const hit = await menu.locator('button').evaluateAll(nodes => nodes.map(node => { const box = node.getBoundingClientRect(); const target = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2); return { width: box.width, height: box.height, target: target?.outerHTML.slice(0, 200), clickable: box.width >= 44 && box.height >= 44 && node.contains(target) }; }));
          if (!hit.every(item => item.clickable)) await page.screenshot({ path: path.join(output, `menu-failure-${width}.png`) });
          assert(hit.length === 2 && hit.every(item => item.clickable), 'Original account/help controls must remain clickable above the hero: ' + JSON.stringify(hit));
          await page.keyboard.press('Escape');
          assert(!(await menu.isVisible()) && await more.evaluate(node => node === document.activeElement));
          await more.click();
          await menu.locator('button[onclick="startOnboardingLearning()"]').click();
          await page.locator('#welcome-guide-modal').waitFor({ state: 'visible' });
          await page.waitForFunction(() => document.getElementById('welcome-guide-modal').contains(document.activeElement));
          await page.locator('#welcome-guide-modal button[onclick="closeOnboardingModal()"]').click();
          await page.waitForFunction(() => document.querySelector('#view-community [data-field-more]') === document.activeElement);
        }
        if (width !== 320) await page.screenshot({ path: path.join(output, `header-${view}-${width}.png`) });
        results.push(metrics);
      }
    }
    await page.evaluate(() => window.switchTab('collect'));
    await page.getByLabel('资料标题（选填）').fill('本地标题样式检查');
    const typography = await page.evaluate(() => {
      const label = getComputedStyle(document.querySelector('.collect-title-field > span'));
      const placeholder = getComputedStyle(document.getElementById('collect-description'), '::placeholder');
      const keys = ['fontFamily', 'fontSize', 'fontWeight', 'color'];
      return Object.fromEntries(keys.map(key => [key, [label[key], placeholder[key]]]));
    });
    Object.values(typography).forEach(pair => assert.equal(pair[0], pair[1], 'Title label must match note placeholder typography'));
    assert.equal(await page.locator('.collect-consent-body #collect-effects-preference').count(), 1);
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 950 });
      await page.locator('#collect-description').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(output, `collect-title-label-${width}.png`) });
    }
    assert.equal(await page.locator('.collect-consent-body #content-effects-choice[type="checkbox"]').count(), 1);
    assert.equal(await page.locator('body > footer #content-effects-choice').count(), 0);
    await page.locator('#view-collect .collect-consent-disclosure > summary').click();
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 950 });
      await page.locator('#collect-effects-preference').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(output, `collect-privacy-${width}.png`) });
    }
    // Rapid cycles must never leave controls in the previous hidden page.
    await page.evaluate(() => { ['community', 'discover', 'map', 'profile', 'community'].forEach(view => window.switchTab(view)); });
    await page.waitForFunction(() => document.getElementById('header-account-entry').parentElement.id === 'field-community-menu');
    assert.equal(await page.locator('#app-navigation').count(), 1);
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'header-report.json'), JSON.stringify({ results, typography, errors }, null, 2));
    console.log('Paper header UI passed: five v2 logos, 320/390/768/1440 layouts, unique original controls, menu keyboard/help focus, rapid view cycles, label typography and consent mount.');
    console.log(`Screenshots: ${output}`);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
