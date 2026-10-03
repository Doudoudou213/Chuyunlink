'use strict';

// Real page and submit handler, with an in-memory CloudBase SDK boundary.
// No account, user file, GPS or production request is used.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const output = process.argv[2];
if (!output || !path.isAbsolute(output)) throw Error('Pass an absolute screenshot directory');
fs.mkdirSync(output, { recursive: true });
const server = http.createServer((req, res) => {
  const name = new URL(req.url, 'http://local').pathname;
  const file = path.resolve(root, '.' + name);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return res.writeHead(404).end();
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2' };
  res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});

async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultNavigationTimeout(180000);
    await page.route('**/*', async route => {
      const url = route.request().url();
      if (url.startsWith('http://127.0.0.1:')) return route.continue();
      if (route.request().method() === 'GET' && /^https:\/\/(cdn\.tailwindcss\.com|unpkg\.com\/lucide)/.test(url)) {
        const response = await route.fetch({ timeout: 60000, maxRetries: 2 });
        assert.ok(response.ok(), 'visual dependency must load');
        return route.fulfill({ response });
      }
      return route.abort();
    });
    await page.addInitScript(() => {
      const profile = { uid: 'fixture_member', nickname: '本地演示', points: 0 };
      window.submissionCalls = [];
      window.localSubmissions = [];
      window.failSubmission = false;
      const app = {
        auth: () => ({ getLoginState: async () => ({ user: { uid: profile.uid, email: 'fixture@example.invalid' } }) }),
        uploadFile: async ({ cloudPath }) => ({ fileID: 'cloud://local-fixture/' + cloudPath }),
        deleteFile: async () => ({}),
        getTempFileURL: async () => ({ fileList: [] }),
        callFunction: async ({ data }) => {
          window.submissionCalls.push(data);
          if (data.action === 'createSubmission') {
            if (window.failSubmission) return { result: { ok: false, error: { message: '本地模拟：请稍后再试' } } };
            const item = { ...data, id: 'fixture_' + (window.localSubmissions.length + 1), status: 'pending' };
            window.localSubmissions.unshift(item);
            return { result: { ok: true, submission: item } };
          }
          if (data.action === 'bootstrap') return { result: { ok: true, profile,
            stats: { total: window.localSubmissions.length, pending: window.localSubmissions.length },
            mySubmissions: window.localSubmissions, publicSubmissions: [], rewards: [], myRedemptions: [], myFeedback: [] } };
          return { result: { ok: true, items: [], resources: [], unreadCount: 0, enabled: false } };
        }
      };
      window.cloudbase = { init: () => app };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !document.getElementById('chu-startup'), {}, { timeout: 30000 });
    await page.evaluate(() => window.switchTab('collect'));
    assert.equal(await page.locator('#collect-title').count(), 1, 'only active form title field');
    assert.equal(await page.locator('#collect-title').getAttribute('maxlength'), '120');
    await page.getByLabel('资料标题（选填）').fill('老巷门楣上的凤鸟纹');
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 950 });
      await page.locator('#collect-title').scrollIntoViewIfNeeded();
      assert.ok(await page.locator('#collect-title').evaluate(el => el.getBoundingClientRect().height >= 44));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: path.join(output, `submission-title-${width}.png`) });
    }
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRfkAAAAASUVORK5CYII=', 'base64');
    async function selectLocalFile() {
      await page.evaluate(() => {
        window.switchTab('collect');
        currentLocation = { isReal: true, latitude: 30.5, longitude: 114.3, accuracy: 20 };
      });
      await page.locator('#view-collect input[type=file]').first().setInputFiles({ name: 'IMG_0001.png', mimeType: 'image/png', buffer: png });
    }
    await selectLocalFile();
    const title = '  门楣上的凤鸟纹 <script>测试</script>  ';
    await page.locator('#collect-title').fill(title);
    await page.locator('#collect-description').fill('本地固定测试资料。');
    await page.locator('#collect-form button[type=submit]').click();
    await page.waitForFunction(() => submissionCalls.some(c => c.action === 'createSubmission'));
    await page.waitForFunction(() => !document.getElementById('collect-form').querySelector('button[type=submit]').disabled);
    const payload = await page.evaluate(() => submissionCalls.find(c => c.action === 'createSubmission'));
    assert.equal(payload.title, title.trim());
    assert.equal(payload.description, '本地固定测试资料。');
    for (const key of ['aiAnalysisConsent', 'materialAnalysisConsent', 'materialResearchConsent', 'materialExcerptConsent']) assert.equal(payload[key], false);
    assert.equal(await page.locator('#collect-title').inputValue(), '');
    assert.equal(await page.locator('#cloud-my-submissions script').count(), 0, 'title rendered as text');
    assert.ok((await page.locator('#cloud-my-submissions').innerText()).includes('门楣上的凤鸟纹'));
    await selectLocalFile();
    await page.locator('#collect-title').fill('上传失败也要保留的标题');
    await page.evaluate(() => { window.failSubmission = true; });
    await page.locator('#collect-form button[type=submit]').click();
    await page.waitForFunction(() => submissionCalls.filter(c => c.action === 'createSubmission').length === 2);
    await page.waitForFunction(() => !document.getElementById('collect-form').querySelector('button[type=submit]').disabled);
    assert.equal(await page.locator('#collect-title').inputValue(), '上传失败也要保留的标题');
    await page.evaluate(() => { window.failSubmission = false; });
    await page.locator('#collect-title').fill('   ');
    await page.locator('#collect-form button[type=submit]').click();
    await page.waitForFunction(() => submissionCalls.filter(c => c.action === 'createSubmission').length === 3);
    assert.equal(await page.evaluate(() => submissionCalls.filter(c => c.action === 'createSubmission').at(-1).title), 'IMG_0001.png');
    await page.waitForFunction(() => !document.getElementById('collect-form').querySelector('button[type=submit]').disabled);
    await page.evaluate(async () => {
      localSubmissions[0].status = 'withdrawn';
      localSubmissions[0].reviewNote = '本地测试：资料需要复核';
      await refreshCloudProfile();
    });
    assert.ok((await page.locator('#cloud-my-submissions').innerText()).includes('已撤下'));
    assert.deepEqual(errors, []);
    console.log('Submission title UI passed: custom title payload, escaping, empty fallback, failed-upload retention, successful clearing, default-off consent, withdrawn label and 390/768/1440 layout.');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
