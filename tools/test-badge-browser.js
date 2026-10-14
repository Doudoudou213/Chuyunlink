'use strict';
// Component integration with the real gallery markup/styles and isolated cloud fixtures.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { fixture: databaseFixture, approved } = require('./test-badge-service');
const { createBadgeService } = require('../cloudfunctions/appCore/domains/badges');
const { createBadgeLearning, LESSONS } = require('../cloudfunctions/appCore/domains/badge-learning');
const { createAdminBadgeService } = require('../cloudfunctions/adminSubmissions/domains/badges');
const db = databaseFixture();
db.data.submissions.set('browser-source', { ...approved, title: '本地测试投稿' });
db.data.resources.set('browser-resource', { status: 'published' });
const service = createBadgeService({ db }), learning = createBadgeLearning({ db }), admin = createAdminBadgeService({ db });
const root = path.resolve(__dirname, '..');
const output = process.argv[2];
if (!output || !path.isAbsolute(output)) throw Error('Pass an absolute output directory');
fs.mkdirSync(output, { recursive: true });
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const dialog = html.match(/<dialog id="paper-badge-dialog"[\s\S]*?<\/dialog>/)[0];
const fixture = `<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/static/paper-editorial.css"><link rel="stylesheet" href="/static/discover-paper.css"><link rel="stylesheet" href="/static/profile-paper.css"><link rel="stylesheet" href="/static/profile-badges.css">
<body class="profile-paper-active"><main id="view-profile"><section id="paper-profile-badges"><div class="paper-profile-badge-row"></div></section><div id="paper-badge-catalog"></div>${dialog}</main>
<script src="/static/badge-catalog.js"></script><script src="/static/profile-badges.js"></script></body></html>`;
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, 'http://local').pathname;
  if (pathname === '/api' && request.method === 'POST') {
    let body = '';
    request.on('data', chunk => { body += chunk; if (body.length > 16000) request.destroy(); });
    request.on('end', async () => {
      response.setHeader('Content-Type', 'application/json');
      try {
        const event = JSON.parse(body);
        let result;
        if (event.action === 'get') result = await service.get('test-owner', event);
        else if (event.action === 'claim') result = await service.claim('test-owner', event);
        else if (event.action === 'lesson') result = await learning.start('test-owner', event);
        else if (event.action === 'answer') result = await learning.answer('test-owner', event);
        else if (event.action === 'getBadgeEvidence') result = await admin.lookup(event);
        else if (event.action === 'saveBadgeEvidence') result = await admin.save(event, 'test-reviewer');
        else throw Error('Unknown test route');
        response.end(JSON.stringify(result));
      } catch (error) { response.end(JSON.stringify({ ok: false, error: { message: error.message, code: error.code } })); }
    });
    return;
  }
  if (pathname === '/admin-fixture') {
    const style = fs.readFileSync(path.join(root, 'admin.html'), 'utf8').match(/<style[\s\S]*?<\/style>/g).join('\n');
    return response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(`<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${style}<link rel="stylesheet" href="/static/admin-badges.css"><body><main id="admin-panel"><button id="story-themes-refresh">主题专题</button><div id="list"></div></main><script>
      function setActiveView(view){document.getElementById('admin-panel').dataset.view=view;}
      async function callAdmin(event){const r=await fetch('/api',{method:'POST',body:JSON.stringify(event)});const v=await r.json();if(!v.ok)throw Error(v.error.message);return v;}
      </script><script src="/static/admin-badges.js"></script></body></html>`);
  }
  if (pathname === '/') return response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(fixture);
  const file = path.resolve(root, '.' + pathname);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return response.writeHead(404).end();
  response.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'application/octet-stream');
  response.end(fs.readFileSync(file));
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://**/*', route => route.abort());
    await page.addInitScript(() => {
      window.testBadgeStatus = 'eligible'; window.testClaimCount = 0;
      function result(id, status) {
        const badge = window.ChuBadgeCatalog.get(id);
        return { schemaVersion: 1, badgeId: id, ruleVersion: badge.ruleVersion, status,
          eligible: status === 'eligible' || status === 'earned', earned: status === 'earned',
          progress: badge.requirements.map(r => ({ metric: r.metric, target: r.target,
            current: status === 'eligible' || status === 'earned' ? r.target : 0 })), checkedAt: '2026-10-13T00:00:00Z', earnedAt: status === 'earned' ? '2026-10-13T00:00:00Z' : null };
      }
      window.ChuBadgeTransport = {
        async query(id) {
          if (id === 'lamplight') return (await (await fetch('/api', { method: 'POST', body: JSON.stringify({ action: 'get', badgeId: id }) })).json()).badge;
          const status = window.testBadgeStatus;
          if (status === 'offline') throw Error('fixture offline');
          if (status === 'login_required') return { status };
          return result(id, status);
        },
        async claim(id) {
          if (id === 'lamplight') return (await (await fetch('/api', { method: 'POST', body: JSON.stringify({ action: 'claim', badgeId: id, ruleVersion: window.ChuBadgeCatalog.ruleVersion }) })).json()).badge;
          window.testClaimCount++;
          await new Promise(resolve => setTimeout(resolve, 150));
          if (window.testClaimFails) throw Error('fixture failed');
          window.testBadgeStatus = 'earned'; return result(id, 'earned');
        },
        async lesson(lessonId) {
          return (await fetch('/api', { method: 'POST', body: JSON.stringify({ action: 'lesson', lessonId }) })).json();
        },
        async answer(lessonId, token, answer) {
          return (await fetch('/api', { method: 'POST', body: JSON.stringify({ action: 'answer', lessonId, token, answer }) })).json();
        }
      };
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.locator('#paper-profile-badges [data-badge-id="fieldnotes"]').click();
      const action = page.locator('#paper-badge-dialog .paper-badge-claim');
      await action.waitFor();
      assert.equal(await action.innerText(), '收下徽章');
      const bounds = await page.locator('#paper-badge-dialog').boundingBox();
      assert.notEqual(await page.locator('#paper-badge-dialog').evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)', 'paper tokens must be present');
      assert(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
      assert(await action.evaluate(el => el.getBoundingClientRect().height >= 44));
      await page.locator('#paper-badge-dialog').screenshot({ path: path.join(output, `badge-eligible-${width}.png`) });
      await page.keyboard.press('Escape');
      assert(await page.locator('#paper-profile-badges [data-badge-id="fieldnotes"]').evaluate(el => document.activeElement === el));
    }
    await page.locator('#paper-profile-badges [data-badge-id="fieldnotes"]').click();
    await page.locator('.paper-badge-claim').click();
    await page.waitForFunction(() => document.querySelector('#paper-badge-dialog-status').dataset.eligibility === 'earned');
    assert.equal(await page.evaluate(() => window.testClaimCount), 1);
    assert.equal(await page.locator('.paper-badge-claim').count(), 0);
    await page.locator('#paper-badge-dialog').screenshot({ path: path.join(output, 'badge-earned-desktop.png') });
    await page.keyboard.press('Escape');
    for (const state of ['in_progress', 'needs_review', 'login_required', 'offline']) {
      await page.evaluate(value => { window.testBadgeStatus = value; }, state);
      await page.locator('#paper-profile-badges [data-badge-id="fieldnotes"]').click();
      await page.waitForFunction(() => document.querySelector('#paper-badge-dialog-status').dataset.eligibility !== 'loading');
      assert.equal(await page.locator('#paper-badge-dialog-status').getAttribute('data-eligibility'), state === 'offline' ? 'unavailable' : state);
      assert(!(await page.locator('#paper-badge-dialog-status').innerText()).includes('已收入'));
      await page.keyboard.press('Escape');
    }
    await page.evaluate(() => { window.testBadgeStatus = 'eligible'; window.testClaimFails = true; });
    await page.locator('#paper-profile-badges [data-badge-id="fieldnotes"]').click();
    await page.locator('.paper-badge-claim').click();
    await page.locator('.paper-badge-error').waitFor();
    assert(await page.locator('.paper-badge-claim').isEnabled());
    await page.evaluate(() => { window.testClaimFails = false; });
    await page.locator('.paper-badge-claim').click();
    await page.waitForFunction(() => document.querySelector('#paper-badge-dialog-status').dataset.eligibility === 'earned');
    await page.keyboard.press('Escape');
    await page.locator('#paper-badge-catalog [data-badge-id="lamplight"]').click();
    await page.getByRole('button', { name: '开始采集小课' }).click();
    for (const lesson of LESSONS) {
      await page.getByRole('heading', { name: lesson.title }).waitFor();
      await page.locator('.paper-badge-lesson-options button').nth(lesson.answer).click();
      await page.getByRole('button', { name: '继续下一课' }).click();
    }
    await page.getByRole('button', { name: '收下徽章', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#paper-badge-dialog-status').dataset.eligibility === 'earned');
    assert.equal(db.data.badge_awards.size, 1, 'real local service issued the learning badge');
    await page.locator('#paper-badge-dialog').screenshot({ path: path.join(output, 'badge-learning-complete.png') });
    await page.goto(`http://127.0.0.1:${server.address().port}/admin-fixture`);
    await page.getByRole('button', { name: '徽章核验', exact: true }).click();
    await page.locator('[name="sourceId"]').fill('browser-source');
    await page.getByRole('button', { name: '读取材料', exact: true }).click();
    await page.locator('[name="category"]').selectOption('architecture');
    await page.locator('[name="resourceId"]').fill('browser-resource');
    await page.locator('[name="note"]').fill('这是本地模拟核验材料，不使用任何生产数据。');
    await page.locator('[name="humanReviewed"]').check();
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 950 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: path.join(output, `badge-admin-${width}.png`), fullPage: true });
    }
    await page.getByRole('button', { name: '保存核验', exact: true }).click();
    await page.waitForFunction(() => document.getElementById('badge-admin-message').textContent.includes('核验已保存'));
    assert.equal(db.data.badge_evidence.size, 1);
    page.once('dialog', prompt => prompt.accept());
    await page.getByRole('button', { name: '撤销核验', exact: true }).click();
    await page.waitForFunction(() => document.getElementById('badge-admin-message').textContent.includes('核验已撤销'));
    assert.equal([...db.data.badge_evidence.values()][0].status, 'revoked');
    assert.deepEqual(errors, []);
    console.log('Badge browser: responsive gallery, focus, retry, five lessons -> real local-service claim, admin verify/revoke passed. In-memory fixtures, no cloud writes.');
  } finally { if (browser) await browser.close(); server.close(); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
