'use strict';
// Real pages with in-memory fixtures. Every nonlocal request is blocked.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const output = process.argv[2] || path.join(os.tmpdir(), 'chulink-stability-qa');
const tick = () => new Promise(resolve => setTimeout(resolve, 10));
async function until(test) {
  for (let i = 0; i < 500; i++) { if (test()) return; await tick(); }
  throw Error('Mock request did not arrive');
}
function mockCloud() {
  const profile = { uid: 'local_fixture', nickname: '本地测试', points: 0 };
  window.cloudbase = { init: () => ({
    auth: () => ({ getLoginState: async () => ({ user: { uid: profile.uid } }) }),
    getTempFileURL: async () => ({ fileList: [] }),
    callFunction: async ({ data }) => ({ result: data.action === 'bootstrap'
      ? { ok: true, profile, stats: { total: 0, pending: 0 }, mySubmissions: [],
        publicSubmissions: [], myRedemptions: [], myFeedback: [], rewards: [] }
      : { ok: true, items: [], resources: [], unreadCount: 0, enabled: false } })
  }) };
}
async function main() {
  fs.mkdirSync(output, { recursive: true });
  const server = http.createServer((req, res) => {
    const file = path.resolve(root, '.' + new URL(req.url, 'http://local').pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile())
      return res.writeHead(404).end();
    const mime = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript',
      '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2',
      '.geojson': 'application/json' };
    res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ channel: process.env.CHULINK_BROWSER_CHANNEL || 'msedge', headless: true });
  const results = [];
  async function pageFor(width, missingIcons = false) {
    const page = await browser.newPage({ viewport: { width, height: 960 }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const url = route.request().url();
      if (!url.startsWith(origin + '/') || (missingIcons && url.includes('/lucide-')))
        return route.abort();
      return route.continue();
    });
    return { page, errors };
  }
  try {
    for (const width of [390, 768, 1440]) {
      for (const missingIcons of [false, true]) {
        const { page, errors } = await pageFor(width, missingIcons);
        await page.addInitScript(mockCloud);
        await page.goto(origin + '/index.html?view=collect', { waitUntil: 'load' });
        await page.waitForFunction(() => document.querySelector('#view-collect:not(.hidden)'));
        assert.equal(await page.locator('#heritage-map .leaflet-map-pane').count(), 1);
        assert.equal(await page.locator('svg.lucide').count() > 0, !missingIcons);
        // Also exercise later calls to the icon decorator during navigation.
        await page.evaluate(() => switchTab('map'));
        await page.evaluate(() => switchTab('collect'));
        await page.locator('#chu-startup').waitFor({ state: 'detached' });
        assert.deepEqual(errors, []);
        if (!missingIcons) await page.screenshot({ path: path.join(output, 'collect-' + width + '.png') });
        results.push({ width, case: missingIcons ? 'missing local icons still navigates and initializes map' : 'all external services blocked, local UI initializes' });
        await page.close();
      }

      const { page, errors } = await pageFor(width);
      await page.addInitScript(() => {
        window.cloudbase = { init: () => ({
          auth: () => ({ getLoginState: async () => null }),
          getTempFileURL: async () => ({ fileList: [] })
        }) };
      });
      const rows = ['a', 'b'].map(id => ({ id, status: 'approved', title: '本地资料 ' + id,
        description: '虚构资料，仅用于本地检查', assetType: 'text' }));
      const pending = [], withdrawals = {};
      await page.exposeFunction('localAdmin', async data => {
        if (data.action === 'listComments') return new Promise((resolve, reject) => pending.push({ resolve, reject }));
        if (data.action === 'list') return { ok: true, items: rows.filter(row => row.status === data.status).map(row => ({ ...row })),
          resourceOptions: [], hasMore: false, nextOffset: null };
        if (data.action === 'withdrawSubmission') return new Promise(resolve => {
          withdrawals[data.submissionId] = () => {
            rows.find(row => row.id === data.submissionId).status = 'withdrawn';
            resolve({ ok: true, sourceReviewPending: false });
          };
        });
        throw Error('Unexpected mock action: ' + data.action);
      });
      await page.goto(origin + '/admin.html', { waitUntil: 'load' });
      await page.evaluate(() => {
        callAdmin = window.localAdmin;
        document.getElementById('admin-panel').classList.remove('hidden');
        document.getElementById('login-panel').style.display = 'none';
        window.oldRead = loadComments();
      });
      await until(() => pending.length === 1);
      await page.evaluate(() => loadResourceBindings());
      pending.shift().resolve({ ok: true, items: [{ id: 'old', content: '迟到评论', status: 'visible' }] });
      await page.evaluate(() => window.oldRead);
      assert.equal(await page.locator('[data-binding-submission-id]').count(), 2);
      assert.equal(await page.locator('[data-comment-id]').count(), 0);

      // Even a stale error must not overwrite the new panel's message.
      await page.evaluate(() => { window.oldRead = loadComments(); });
      await until(() => pending.length === 1);
      await page.evaluate(() => loadResourceBindings());
      pending.shift().reject(Error('迟到错误'));
      await page.evaluate(() => window.oldRead);
      assert(!((await page.locator('#message').textContent()).includes('迟到错误')));

      // Same-view refreshes return out of order.
      await page.evaluate(() => { window.firstRead = loadComments(); });
      await until(() => pending.length === 1);
      await page.evaluate(() => { window.secondRead = loadComments(); });
      await until(() => pending.length === 2);
      pending[1].resolve({ ok: true, items: [{ id: 'newest', status: 'visible', content: '最新评论' }] });
      await page.evaluate(() => window.secondRead);
      pending[0].resolve({ ok: true, items: [] });
      await page.evaluate(() => window.firstRead);
      assert.equal(await page.locator('[data-comment-id="newest"]').count(), 1);
      pending.length = 0;

      await page.evaluate(() => loadResourceBindings());
      for (const id of ['a', 'b']) {
        const card = page.locator('[data-binding-submission-id="' + id + '"]');
        await card.locator(':scope > details > summary').click();
        await card.locator('.admin-withdraw-panel > summary').click();
        await card.locator('[name="reviewNote"]').fill('本地连续撤回检查');
        await card.locator('[data-withdraw-submit]').click();
      }
      await until(() => withdrawals.a && withdrawals.b);
      withdrawals.a();
      await page.waitForFunction(() => document.querySelectorAll('[data-binding-submission-id]').length === 1);
      withdrawals.b();
      await page.waitForFunction(() => document.querySelectorAll('[data-binding-submission-id]').length === 0);
      assert(rows.every(row => row.status === 'withdrawn'));
      assert.deepEqual(errors, []);
      await page.screenshot({ path: path.join(output, 'admin-' + width + '.png') });
      results.push({ width, case: 'stale success/error, reverse refresh order and two concurrent withdrawals' });
      await page.close();

      const theme = await pageFor(width);
      await theme.page.addInitScript(() => {
        window.cloudbase = { init: () => ({
          auth: () => ({ getLoginState: async () => ({ user: { uid: 'fixture' } }) }),
          callFunction: async ({ data }) => {
            if (data.action !== 'getStoryTheme') return { result: { ok: true, enabled: false } };
            await new Promise(resolve => setTimeout(resolve, 120));
            return { result: { ok: true, theme: { id: 'local-theme', title: '本地专题', introduction: '测试材料',
              version: 1, nodes: [], sources: [], claims: [], relations: [],
              chapters: [1, 2].map(i => ({ title: '第' + i + '章', body: '本地测试正文\n'.repeat(50),
                nodeIds: [], sourceLinkIds: [], claimIds: [] })) } } };
          }
        }) };
      });
      await theme.page.goto(origin + '/themes.html?id=local-theme#theme-chapter-2');
      await theme.page.locator('#theme-chapter-2').waitFor();
      await theme.page.waitForFunction(() => Math.abs(document.getElementById('theme-chapter-2').getBoundingClientRect().top) < 150);
      assert((await theme.page.evaluate(() => scrollY)) > 0);
      assert.deepEqual(theme.errors, []);
      await theme.page.screenshot({ path: path.join(output, 'theme-' + width + '.png') });
      results.push({ width, case: 'asynchronous chapter link restores its destination' });
      await theme.page.close();
    }
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
    console.log('PASS ' + results.length + ' stability browser groups, at 390/768/1440; no real cloud/model requests.');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
