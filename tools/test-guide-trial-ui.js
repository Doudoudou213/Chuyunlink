'use strict';
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { fakeDb } = require('./lib/fake-material-db');
const { fixture } = require('./test-guide-generation');
const { config, output } = require('./test-guide-generation-jobs');
const { createGuideGenerationService } = require('../cloudfunctions/storyWorker/lib/guide-generation');
const { createGuideClient } = require('../cloudfunctions/storyWorker/lib/guide-client');
const { createGuideFragmentService } = require('../cloudfunctions/adminSubmissions/domains/guide-fragments');
const root = path.resolve(__dirname, '..');
(async () => {
  const db = fakeDb(fixture());
  let calls = 0;
  const client = createGuideClient({ config, transport: async () => {
    calls++;
    if (calls <= 2) throw Object.assign(Error('provider-private-detail'), { code: 'ETIMEDOUT', retryable: true });
    return { choices: [{ message: { content: JSON.stringify(output()) } }], usage: { prompt_tokens: 50, completion_tokens: 80, total_tokens: 130 } };
  } });
  const generator = createGuideGenerationService({ db, config, client });
  const fragments = createGuideFragmentService({ db });
  const actions = { checkGuideTrial: 'preflight', getGuideTrialReport: 'report', generateGuideDraft: 'generate', retryGuideTrial: 'retry', saveGuideTrialReview: 'review' };
  const server = http.createServer((req, res) => {
    const file = path.resolve(root, '.' + new URL(req.url, 'http://local').pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return res.writeHead(404).end();
    res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8');
    res.end(fs.readFileSync(file));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('https://**/*', r => r.request().url().includes('static.cloudbase.net') ? r.fulfill({ contentType: 'application/javascript', body: 'window.cloudbase={init:()=>({auth:()=>({getLoginState:async()=>null})})};' }) : r.abort());
    await page.exposeFunction('localGuideAdmin', e => fragments.handle(e, 'test-admin'));
    await page.exposeFunction('localGuideGenerate', e => generator[actions[e.action]](e, 'test-admin'));
    await page.goto('http://127.0.0.1:' + server.address().port + '/admin.html');
    await page.evaluate(() => {
      callAdmin = window.localGuideAdmin; callAiWorker = window.localGuideGenerate;
      document.getElementById('admin-panel').classList.remove('hidden'); document.getElementById('login-panel').style.display = 'none';
    });
    await page.getByRole('button', { name: '随行讲解', exact: true }).click();
    await page.locator('[data-gf-claim]').check();
    await page.locator('#guide-trial > summary').click();
    await page.locator('#gt-check').click();
    await page.waitForFunction(() => document.getElementById('gt-preflight').textContent.includes('基础条件就绪'));
    assert.equal(calls, 0);
    await page.locator('#gf-generate').click();
    await page.waitForFunction(() => document.getElementById('message').textContent.includes('连接'));
    assert.equal(calls, 2);
    await page.locator('#gt-refresh').click();
    await page.locator('[data-gt-item] > summary').click();
    await page.locator('[data-gt-retry]').click();
    await page.waitForFunction(() => document.getElementById('gt-records').textContent.includes('已完成'));
    assert.equal(calls, 3);
    await page.locator('[data-gt-item] > summary').click();
    for (const [key, value] of Object.entries({ firstPass: 'no', modification: 'small', sourceSufficient: 'yes', accuracy: 'correct', listenSuitable: 'partial' })) await page.locator('[data-gt-field=' + key + ']').selectOption(value);
    await page.locator('[data-gt-save]').click();
    await page.waitForFunction(() => document.querySelector('[data-gt-review]')?.dataset.revision === '1');
    await page.locator('[data-gt-item] > summary').click();
    assert.equal(await page.locator('[data-gt-field=accuracy]').inputValue(), 'correct');
    assert.equal(Object.keys(db.data().guide_fragment_versions || {}).length, 0, 'judgement must not publish');
    assert.equal(Object.keys(db.data().story_agent_evaluations || {}).length, 0, 'judgement must not auto-enrol fixed samples');
    const dir = path.join(require('node:os').tmpdir(), 'chulink-guide-qa'); fs.mkdirSync(dir, { recursive: true });
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'horizontal overflow at ' + width);
      await page.locator('#guide-trial').screenshot({ path: path.join(dir, 'guide-trial-' + width + '.png') });
    }
    await db.collection('submissions').doc('s').update({ aiAnalysisConsent: false });
    await page.locator('#gt-refresh').click();
    await page.waitForFunction(() => document.getElementById('gt-records').textContent.includes('来源失效'));
    assert.equal(await page.locator('[data-gt-save]').count(), 0);
    assert.equal(await page.locator('[data-gt-retry]').count(), 0);
    await page.locator('#gt-check').click();
    await page.waitForFunction(() => document.getElementById('gt-preflight').textContent.includes('暂不具备'));
    assert.equal(calls, 3);
    assert.deepEqual(errors, []);
    console.log('Guide trial UI passed: no-call check, timeout diagnostics, bounded retry, real client/fixed transport, human review, no publication, withdrawal, 390/768/1440.');
  } finally { await browser?.close(); await new Promise(r => server.close(r)); }
})().catch(e => { console.error(e); process.exit(1); });
