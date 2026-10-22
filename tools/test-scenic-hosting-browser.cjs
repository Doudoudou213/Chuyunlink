'use strict';
// PUBLIC STATIC HOSTING SMOKE ONLY. This is not a live API acceptance test.
// A fresh Edge context has no existing account, login state, or local records.
// Only same-origin static GET/HEAD files can leave the browser. CloudBase SDK,
// authentication, business APIs, external pictures/tiles and WebSockets are blocked.
// There are no injected business fixtures, adapters, account bootstrap or cloud calls.
// Run only after publishing; use check-scenic-cloud-browser.cjs for read-only APIs.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const origin = 'https://chulink-legacy-d8god1687a5d60743-1458884983.tcloudbaseapp.com';
const views = ['discover', 'map', 'collect', 'community', 'profile'];

function args(argv) {
  const value = { release: 'HEAD', output: 'artifacts/scenic-release-20261022/public-browser' };
  for (let i = 0; i < argv.length; i++) {
    if (['--release', '--output'].includes(argv[i]) && argv[i + 1] && !argv[i + 1].startsWith('--')) value[argv[i].slice(2)] = argv[++i];
    else throw Error('INVALID_ARGUMENT');
  }
  if (!/^(?:HEAD|[a-f0-9]{7,40})$/.test(value.release)) throw Error('INVALID_RELEASE');
  const output = path.resolve(root, value.output), base = path.join(root, 'artifacts');
  const relative = path.relative(base, output);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('OUTPUT_MUST_BE_ARTIFACTS_DIRECTORY');
  let existing = output;
  while (!fs.existsSync(existing)) existing = path.dirname(existing);
  const realRoot = fs.realpathSync(root), realExisting = fs.realpathSync(existing);
  const realRelative = path.relative(realRoot, realExisting);
  if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) throw Error('OUTPUT_OUTSIDE_WORKSPACE');
  // Do not follow pre-existing links for any artifact output.
  for (let item = output; item !== root; item = path.dirname(item)) {
    if (fs.existsSync(item) && fs.lstatSync(item).isSymbolicLink()) throw Error('OUTPUT_LINK_REJECTED');
  }
  return { ...value, output };
}

function staticRequest(request) {
  if (!['GET', 'HEAD'].includes(request.method())) return 'blocked-method';
  let url;
  try { url = new URL(request.url()); } catch { return 'blocked-url'; }
  if (url.origin !== origin) return 'blocked-external';
  if (url.username || url.password) return 'blocked-url';
  const filename = url.pathname;
  if (['/', '/index.html', '/explore-journey.html'].includes(filename) && request.resourceType() === 'document') return 'static';
  if (filename === '/hubei_boundary.geojson') return 'static';
  if (filename === '/favicon.ico') return 'static';
  // This excludes function URLs, /api, auth, proxy endpoints and uploaded files.
  // Do not broaden this into a same-origin catch-all: that could allow business writes.
  if (/^\/static\/[a-zA-Z0-9_./%()\-]+\.(?:js|css|woff2?|ttf|otf|png|jpe?g|webp|avif|gif|svg|ico|geojson)$/i.test(filename)
      && !/(?:cloudbase(?:[.-]|\/)?.*(?:sdk|full)|cloudbase-js-sdk|\/\.\.)/i.test(filename)) return 'static';
  return 'blocked-nonstatic';
}

function safeCode(error) {
  if (error?.name === 'TimeoutError') return 'UI_TIMEOUT';
  const value = String(error?.message || '');
  if (/ERR_NAME_NOT_RESOLVED|ERR_CONNECTION|ERR_NETWORK|ERR_CERT|ERR_TIMED_OUT/.test(value)) return 'STATIC_NETWORK_FAILED';
  if (value === 'INVALID_ARGUMENT' || value === 'INVALID_RELEASE' || value.startsWith('OUTPUT_')) return value;
  return 'STATIC_UI_CHECK_FAILED';
}

function publicUrl(filename, release, extra = {}) {
  const url = new URL(filename, origin);
  url.searchParams.set('release', release);
  for (const [key, value] of Object.entries(extra)) url.searchParams.set(key, value);
  return url.href;
}

async function run(options) {
  const { chromium } = require('playwright');
  fs.mkdirSync(options.output, { recursive: true });
  const summary = {
    scope: 'Public static files and network-blocked safe fallback only; NOT live API, account, content-publication or field acceptance.',
    origin, release: options.release, startedAt: new Date().toISOString(),
    isolation: { freshContext: true, authentication: false, businessRequestsAllowed: false, fixtures: false, serviceWorkers: 'block' },
    viewports: [],
    untested: ['live authentication and business interfaces', 'real visitor data and media', 'external map tiles and photos', 'published scenic content', 'animation quality (reduced motion)']
  };
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const width of [390, 1440]) {
      const row = { width, height: width === 390 ? 844 : 1000, checks: [], screenshots: [], blocked: {}, allowedStaticRequests: 0, staticFailureCount: 0, pageErrorCount: 0, failures: [] };
      summary.viewports.push(row);
      const check = (name, ok) => row.checks.push({ name, ok: !!ok });
      const context = await browser.newContext({ viewport: { width, height: row.height }, reducedMotion: 'reduce', serviceWorkers: 'block' });
      // No stored browser credentials, traces, cookies, HARs or response bodies are read/saved.
      await context.route('**/*', async route => {
        const classification = staticRequest(route.request());
        if (classification !== 'static') {
          row.blocked[classification] = (row.blocked[classification] || 0) + 1;
          return route.abort('blockedbyclient');
        }
        row.allowedStaticRequests++;
        return route.continue();
      });
      if (typeof context.routeWebSocket === 'function') await context.routeWebSocket('**/*', socket => {
        row.blocked.websocket = (row.blocked.websocket || 0) + 1;
        socket.close();
      });
      await context.addInitScript(() => {
        // Dismiss only a local first-use overlay, never fabricate account/content state.
        localStorage.setItem('chulink-onboarding-state', JSON.stringify({ seen: true, dismissed: true, tasks: {} }));
        // Defense in depth for browser channels not covered by ordinary request routing.
        window.WebSocket = class DisabledWebSocket { constructor() { throw new DOMException('Static smoke blocks sockets', 'SecurityError'); } };
        window.EventSource = class DisabledEventSource { constructor() { throw new DOMException('Static smoke blocks event streams', 'SecurityError'); } };
        try { Object.defineProperty(navigator, 'sendBeacon', { value: () => false, configurable: false }); } catch {}
      });
      const page = await context.newPage();
      page.setDefaultTimeout(20000);
      page.on('pageerror', () => { row.pageErrorCount++; });
      page.on('response', response => {
        if (staticRequest(response.request()) === 'static' && response.status() >= 400) row.staticFailureCount++;
      });
      page.on('requestfailed', request => {
        if (staticRequest(request) === 'static') row.staticFailureCount++;
      });
      async function shot(name) {
        const filename = name + '-' + width + '.png', target = path.join(options.output, filename);
        if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw Error('OUTPUT_LINK_REJECTED');
        await page.screenshot({ path: target, fullPage: false }); row.screenshots.push(filename);
      }
      async function noEntries(name) {
        check(name, await page.locator('[data-scenic-entry]').evaluateAll(nodes => nodes.every(node => {
          const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
          return node.hidden || style.display === 'none' || style.visibility === 'hidden' || rect.width === 0 || rect.height === 0;
        })));
      }
      try {
        try {
          const response = await page.goto(publicUrl('/index.html', options.release, { view: 'discover' }), { waitUntil: 'load', timeout: 45000 });
          check('main-http-success', response?.ok());
          await page.locator('#chu-startup').waitFor({ state: 'detached' });
          await page.waitForFunction(() => typeof window.switchTab === 'function' && !!window.ChuScenicEntry);
          check('five-main-views', await page.locator('.page-view').count() === 5);
          check('sdk-not-loaded-main', await page.evaluate(() => !window.cloudbase));
          for (const view of views) {
            try {
              await page.evaluate(value => window.switchTab(value), view);
              await page.locator('#view-' + view + ':not(.hidden)').waitFor();
              await page.evaluate(() => { const viewport = document.getElementById('app-viewport'); if (viewport) viewport.scrollTop = 0; window.scrollTo(0, 0); });
              await page.waitForTimeout(250);
              check(view + '-only-selected-view', await page.locator('.page-view:not(.hidden)').count() === 1);
              check(view + '-no-horizontal-overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
              await noEntries(view + '-scenic-entrances-hidden');
              await shot(view);
            } catch (error) { row.failures.push({ stage: 'main-' + view, code: safeCode(error) }); }
          }
        } catch (error) { row.failures.push({ stage: 'main', code: safeCode(error) }); }

        try {
          const response = await page.goto(publicUrl('/explore-journey.html', options.release, { resourceId: 'yellow-crane-tower' }), { waitUntil: 'load', timeout: 45000 });
          check('journey-http-success', response?.ok());
          // Require actual production failure handling, not a mocked available:false response.
          await page.waitForFunction(() => document.getElementById('gate-title')?.textContent === '这一卷还在整理');
          await page.waitForFunction(() => {
            const host = document.getElementById('scenic-reading-fallback');
            return !!host && !host.hidden && !!host.querySelector('.scenic-reading-retry');
          });
          check('journey-sdk-not-loaded', await page.evaluate(() => !window.cloudbase));
          check('journey-no-preview-adapter', await page.evaluate(() => !window.ExplorationAdapter && !window.SiteWalkAdminAdapter));
          check('journey-content-hidden', !(await page.locator('#content').isVisible()) && !(await page.locator('#finished').isVisible()));
          check('journey-no-sample-points', await page.locator('#journey-points > *, #journey-stops > *, .scenic-reading-paper').count() === 0);
          check('journey-no-sample-copy', await page.evaluate(() => ['point-title', 'observation', 'reading-copy', 'source-list'].every(id => !document.getElementById(id)?.textContent.trim())));
          check('journey-no-horizontal-overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
          const back = page.locator('.masthead > a');
          check('journey-visible-return', await back.isVisible() && (await back.textContent()).includes('返回地图'));
          check('journey-return-stays-on-main-map', await back.getAttribute('href') === '/index.html?view=map');
          await shot('journey-unavailable');
          await back.click();
          await page.waitForURL(url => url.origin === origin && url.pathname === '/index.html' && url.searchParams.get('view') === 'map');
          await page.locator('#chu-startup').waitFor({ state: 'detached' });
          await page.locator('#view-map:not(.hidden)').waitFor();
          check('journey-return-works', true);
          await noEntries('return-map-scenic-entrance-hidden');
        } catch (error) { row.failures.push({ stage: 'journey-unavailable', code: safeCode(error) }); }
        check('no-unhandled-page-errors', row.pageErrorCount === 0);
        check('no-missing-published-static-assets', row.staticFailureCount === 0);
      } finally { await context.close(); }
      row.passed = row.failures.length === 0 && row.checks.every(item => item.ok);
    }
  } finally { await browser.close(); }
  summary.completedAt = new Date().toISOString();
  summary.passed = summary.viewports.length === 2 && summary.viewports.every(row => row.passed);
  const report = path.join(options.output, 'summary.json');
  if (fs.existsSync(report) && fs.lstatSync(report).isSymbolicLink()) throw Error('OUTPUT_LINK_REJECTED');
  fs.writeFileSync(report, JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary));
  if (!summary.passed) process.exitCode = 1;
}

run(args(process.argv.slice(2))).catch(error => {
  console.error(JSON.stringify({ passed: false, code: safeCode(error), scope: 'static-hosting-only; no cloud calls permitted' }));
  process.exitCode = 1;
});
