'use strict';

// Browser contract tests use synthetic records and never contact CloudBase.
// Set SUBMISSION_QA_TAILWIND_PATH to a cached Tailwind CDN script for visual QA.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const os = require('node:os');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const out = path.join(os.tmpdir(), 'chulink-submission-management-qa');

const submissions = [
  ...Array.from({ length: 27 }, (_, i) => ({ id: `pending-${i}`, status: 'pending', title: `待审地方资料 ${i}`, description: '本地虚构资料，仅用于验证审核界面。', regionName: '湖北省荆州市', assetType: 'text', createdAt: '2026-10-03T00:00:00Z' })),
  ...Array.from({ length: 61 }, (_, i) => ({ id: `approved-${i}`, status: 'approved', title: i === 60 ? '较早的村落石刻' : `已通过地方资料 ${i}`, description: '一份已经人工核对的村落资料。', regionName: '湖北省荆州市', assetType: 'text', resourceId: i === 0 ? 'existing' : '', reviewedAt: '2026-10-01T00:00:00Z' })),
  { id: 'withdrawn-retry', status: 'withdrawn', title: '等待同步的撤回记录', withdrawalNote: '资料来源需要复核', sourceReviewPending: true }
];
const resources = [{ id: 'existing', title: '已有文化资料', type: 'article', regionName: '荆州' }];
const requests = [];
let failBind = false;
let failCreate = false;
let failList = false;
let delayList = 0;
let delayMutation = 0;

async function adminAction(data) {
  requests.push(structuredClone(data));
  if (data.action === 'list') {
    if (delayList) { const delay = delayList; delayList = 0; await new Promise(resolve => setTimeout(resolve, delay)); }
    if (failList) { failList = false; throw new Error('模拟读取失败'); }
    const matches = submissions.filter(item => item.status === data.status && (!data.search || item.id === data.search || item.title.includes(data.search)));
    const offset = data.offset || 0;
    const limit = data.limit || 20;
    return { ok: true, items: matches.slice(offset, offset + limit), resourceOptions: resources, status: data.status, offset, limit, hasMore: matches.length > offset + limit, nextOffset: offset + limit };
  }
  if (data.action === 'searchSubmissionResources') {
    const found = Array.from({ length: 23 }, (_, i) => ({ id: `found-${i}`, title: `远端文化资料 ${i}`, type: 'article', regionName: '荆州' }));
    const matches = data.query.includes('不存在') ? [] : found;
    return { ok: true, items: matches.slice(data.offset, data.offset + data.limit), hasMore: matches.length > data.offset + data.limit, nextOffset: data.offset + data.limit };
  }
  if (delayMutation) { const delay = delayMutation; delayMutation = 0; await new Promise(resolve => setTimeout(resolve, delay)); }
  const item = submissions.find(row => row.id === data.submissionId);
  assert(item, `Unknown mock submission: ${data.submissionId}`);
  if (data.action === 'review') {
    item.status = data.status;
    item.resourceId = data.resourceId;
    return { ok: true, rewardPoints: 100, resourceId: item.resourceId };
  }
  if (data.action === 'bindSubmissionResource') {
    if (failBind) { failBind = false; throw new Error('模拟保存失败'); }
    item.resourceId = data.resourceId;
    return { ok: true, resourceId: data.resourceId, resourceTitle: data.resourceId === 'existing' ? '已有文化资料' : '远端文化资料 0' };
  }
  if (data.action === 'createResourceFromSubmission') {
    if (failCreate) { failCreate = false; throw new Error('同名资源已经存在，请搜索已有资源'); }
    assert.equal(item.status, 'approved');
    assert.equal(data.confirmCreate, true);
    assert(!('longitude' in data));
    assert(!('latitude' in data));
    item.resourceId = 'new-resource';
    resources.push({ id: item.resourceId, title: data.title, type: data.resourceType, regionName: data.regionName });
    return { ok: true, resourceId: item.resourceId, resourceTitle: data.title };
  }
  if (data.action === 'withdrawSubmission') {
    assert(data.reviewNote.trim(), 'Withdrawal and retries require the existing reason');
    const wasWithdrawn = item.status === 'withdrawn';
    item.status = 'withdrawn';
    item.withdrawalNote ||= data.reviewNote;
    item.sourceReviewPending = !wasWithdrawn;
    return { ok: true, sourceReviewPending: item.sourceReviewPending };
  }
  throw new Error(`Unhandled mock action: ${data.action}`);
}

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const server = http.createServer((req, res) => {
    const file = path.resolve(root, '.' + new URL(req.url, 'http://local').pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return res.writeHead(404).end();
    res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8');
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://**/*', route => {
      if (route.request().url().includes('static.cloudbase.net')) return route.fulfill({ contentType: 'application/javascript', body: 'window.cloudbase={init:()=>({auth:()=>({getLoginState:async()=>null}),getTempFileURL:async()=>({fileList:[]})})};' });
      if (route.request().url().includes('cdn.tailwindcss.com') && process.env.SUBMISSION_QA_TAILWIND_PATH) return route.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(process.env.SUBMISSION_QA_TAILWIND_PATH, 'utf8') });
      return route.abort();
    });
    await page.exposeFunction('localSubmissionAdmin', adminAction);
    await page.goto(`http://127.0.0.1:${server.address().port}/admin.html`);
    await page.addStyleTag({ content: '.hidden{display:none!important;}' });
    await page.evaluate(async () => {
      callAdmin = window.localSubmissionAdmin;
      document.getElementById('admin-panel').classList.remove('hidden');
      document.getElementById('login-panel').style.display = 'none';
      document.getElementById('identity').textContent = '虚构数据预览';
      await loadPending();
    });
    await page.locator('article[data-id]').first().waitFor();
    assert.equal(await page.locator('[data-create-resource-form]').count(), 0, 'Pending records cannot create a resource');
    await page.locator('[data-id="pending-0"] [data-status="approved"]').click();
    await page.locator('[data-manage-submission="pending-0"]').waitFor();
    assert.equal(submissions[0].status, 'approved');
    await page.locator('#submission-page-next').click();
    await page.locator('[data-id="pending-20"]').waitFor({ state: 'attached' });
    assert.equal(requests.filter(req => req.action === 'list').at(-1).offset, 19, 'Reviewing a row must not skip the next pending record');
    await page.locator('#submission-page-prev').click();
    await page.locator('[data-id="pending-1"]').waitFor({ state: 'attached' });
    await page.locator('[data-manage-submission="pending-0"]').click();
    let card = page.locator('[data-binding-submission-id="pending-0"]');
    await card.locator('details.admin-compact[open]').waitFor();
    assert.equal(await page.locator('#submission-search').inputValue(), 'pending-0');
    assert.equal(requests.filter(req => req.action === 'review').length, 1, 'Opening management never repeats approval');

    await card.locator('[data-resource-binding-select]').selectOption('existing');
    delayMutation = 200;
    await card.locator('[data-save-resource-binding]').click();
    assert.equal(await card.locator('[data-resource-binding-select]').isDisabled(), true);
    assert.equal(await card.locator('[data-save-resource-binding]').isDisabled(), true);
    await card.locator('[data-submission-result]').filter({ hasText: '已将投稿关联到' }).waitFor();
    assert.equal(await page.locator('#admin-panel').getAttribute('data-view'), 'submissions');
    assert.equal(await card.locator('details.admin-compact').getAttribute('open'), '');

    await card.locator('[data-resource-search]').fill('远端文化资料');
    await card.locator('[data-resource-search]').press('Enter');
    await card.locator('[data-resource-search-result]').filter({ hasText: '已加载 20' }).waitFor();
    assert.equal(await card.locator('[data-resource-binding-select]').inputValue(), 'existing');
    await card.locator('[data-search-resources-more]').click();
    await card.locator('[data-resource-search-result]').filter({ hasText: '已加载 23' }).waitFor();
    await card.locator('[data-resource-binding-select]').selectOption('found-0');
    failBind = true;
    await card.locator('[data-save-resource-binding]').click();
    await card.locator('[data-submission-result]').filter({ hasText: '模拟保存失败' }).waitFor();
    assert.equal(await card.locator('[data-resource-binding-select]').inputValue(), 'found-0');
    assert.equal(await card.locator('[data-save-resource-binding]').isEnabled(), true);
    await card.locator('[data-save-resource-binding]').click();
    await card.locator('[data-submission-result]').filter({ hasText: '远端文化资料 0' }).waitFor();

    await card.locator('.admin-resource-create > summary').click();
    await card.locator('[name="title"]').fill('地方文化资料新资源');
    await card.locator('[name="resourceType"]').selectOption('landmark');
    const beforeCreate = requests.filter(req => req.action === 'createResourceFromSubmission').length;
    await card.locator('[data-create-resource-submit]').click();
    assert.equal(requests.filter(req => req.action === 'createResourceFromSubmission').length, beforeCreate, 'Explicit confirmation is required');
    await card.locator('[name="confirmCreate"]').check();
    failCreate = true;
    await card.locator('[data-create-resource-submit]').click();
    await card.locator('[data-submission-result]').filter({ hasText: '同名资源已经存在' }).waitFor();
    assert.equal(await card.locator('[name="title"]').inputValue(), '地方文化资料新资源');
    delayMutation = 200;
    await card.locator('[data-create-resource-submit]').click();
    assert.equal(await card.locator('[data-create-resource-submit]').isDisabled(), true);
    assert.equal(await card.locator('[data-save-resource-binding]').isDisabled(), true);
    await card.locator('[data-submission-result]').filter({ hasText: '已新建公开资源' }).waitFor();
    assert.equal(await card.locator('[data-resource-binding-select]').inputValue(), 'new-resource');
    assert.equal(await card.locator('.admin-resource-create').getAttribute('open'), null);

    await card.locator('.admin-resource-create > summary').click();
    await card.locator('.admin-withdraw-panel > summary').click();
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(() => window.scrollTo(0, 0));
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Horizontal overflow at ${width}`);
      const targets = await page.locator('#submission-tools button:visible, .admin-submission-card button:visible, .admin-submission-card summary:visible').evaluateAll(nodes => nodes.map(node => ({ text: node.textContent.trim(), height: node.getBoundingClientRect().height })));
      assert(targets.every(target => target.height >= 44), JSON.stringify(targets.filter(target => target.height < 44)));
      await page.screenshot({ path: path.join(out, `submission-management-${width}.png`), fullPage: true });
    }
    const beforeWithdraw = requests.filter(req => req.action === 'withdrawSubmission').length;
    await card.locator('[data-withdraw-submit]').click();
    assert.equal(requests.filter(req => req.action === 'withdrawSubmission').length, beforeWithdraw, 'Withdrawal requires a reason');
    await card.locator('[name="reviewNote"]').fill('重复资料，核对来源后再公开');
    delayMutation = 200;
    await card.locator('[data-withdraw-submit]').click();
    assert.equal(await card.locator('[name="reviewNote"]').isDisabled(), true);
    await page.locator('[data-show-withdrawn-submission="pending-0"]').waitFor();
    assert((await page.locator('#submission-notice').innerText()).includes('尚未全部同步'));
    await page.locator('[data-show-withdrawn-submission="pending-0"]').click();
    card = page.locator('[data-binding-submission-id="pending-0"]');
    await card.locator('[data-retry-withdraw]').click();
    await page.waitForFunction(() => !document.querySelector('[data-retry-withdraw]'));
    const withdrawals = requests.filter(req => req.action === 'withdrawSubmission');
    assert.equal(withdrawals[1].reviewNote, withdrawals[0].reviewNote, 'Retry preserves the original withdrawal note');
    assert.equal(await page.locator('[data-create-resource-form]').count(), 0);

    await page.locator('[data-submission-status="approved"]').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-binding-submission-id]').length === 20);
    await page.locator('#submission-page-next').click();
    await page.locator('[data-binding-submission-id="approved-20"]').waitFor();
    assert((await page.locator('#submission-page-info').innerText()).includes('第 2 页'));
    await page.locator('#submission-page-prev').click();
    await page.locator('[data-binding-submission-id="approved-0"]').waitFor();
    await page.locator('#submission-search').fill('较早的村落石刻');
    await page.locator('#submission-search-form button[type=submit]').click();
    await page.locator('[data-binding-submission-id="approved-60"]').waitFor();
    assert.equal(await page.locator('[data-binding-submission-id]').count(), 1);
    failList = true;
    await page.locator('#submission-search-form button[type=submit]').click();
    await page.locator('#message').filter({ hasText: '模拟读取失败' }).waitFor();
    await page.locator('#submission-search-form button[type=submit]').click();
    await page.locator('[data-binding-submission-id="approved-60"]').waitFor();

    await page.locator('[data-admin-view="resource-bindings"]').click();
    await page.locator('[data-binding-submission-id="approved-0"]').waitFor();
    assert.equal(await page.locator('.admin-submission-tabs').isVisible(), false);
    await page.locator('[data-binding-submission-id="approved-0"] > details > summary').click();
    assert.equal(await page.locator('[data-binding-submission-id="approved-0"] .admin-resource-create > summary').isVisible(), true);

    // A delayed response from a prior view cannot overwrite the current workspace.
    delayList = 150;
    await page.evaluate(() => { loadSubmissionPage('submissions'); setActiveView('comments', '评论管理'); document.getElementById('list').textContent = 'current-workspace'; });
    await page.waitForTimeout(250);
    assert.equal(await page.locator('#list').innerText(), 'current-workspace');
    assert.equal(await page.locator('#submission-tools').isVisible(), false);
    assert.deepEqual(errors, []);
    console.log('Submission management UI passed: approval handoff, server search/pagination, same-view binding, resource search/create confirmation/retry, withdrawal reason/propagation retry, stale-response guard, 390/768/1440 viewport checks.');
    console.log(`Screenshots: ${out}`);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
