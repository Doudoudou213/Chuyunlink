'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { fixture, draft } = require('./test-story-themes');
const { createStoryThemeService } = require('../cloudfunctions/adminSubmissions/domains/story-themes');
const { loadPublicTheme } = require('../cloudfunctions/appCore/domains/story-themes');
const root = path.resolve(__dirname, '..');
const output = process.argv[2];
if (!output || !path.isAbsolute(output)) throw Error('Pass an absolute screenshot directory outside the repository');

async function main() {
  const db = fixture();
  const admin = createStoryThemeService({ db });
  const saved = await admin.save(draft(), 'private_admin_uid');
  await admin.publish({ themeId: saved.themeId, expectedRevision: 1, humanReviewed: true,
    reviewNote: '两个章节的事实和资料已逐条核对' }, 'private_admin_uid');
  const theme = await loadPublicTheme(db, saved.themeId);
  fs.mkdirSync(output, { recursive: true });
  const server = http.createServer((req, res) => {
    const name = new URL(req.url, 'http://local').pathname;
    if (name !== '/themes.html' && !name.startsWith('/static/')) return res.writeHead(404).end();
    const file = path.resolve(root, '.' + name);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return res.writeHead(404).end();
    res.setHeader('Content-Type', name.endsWith('.js') ? 'application/javascript' : 'text/html; charset=utf-8');
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(data => { window.__themeFixture = data; }, theme);
    await page.route('https://static.cloudbase.net/**', route => route.fulfill({
      contentType: 'application/javascript',
      body: `window.cloudbase={init:()=>({
        auth:()=>({getLoginState:async()=>({user:{uid:'local_anon'}})}),
        callFunction:async({data})=>({result:data.action==='listStoryThemes'?
          {ok:true,items:[{id:window.__themeFixture.id,title:window.__themeFixture.title,
            introduction:window.__themeFixture.introduction,version:window.__themeFixture.version,
            chapterCount:window.__themeFixture.chapters.length,regions:['湖北','河南']}]}:
          {ok:true,theme:window.__themeFixture}})
      })};`
    }));
    const base = 'http://127.0.0.1:' + server.address().port + '/themes.html';
    await page.goto(base);
    await page.locator('.theme-card').waitFor();
    assert.equal(await page.locator('.theme-card').count(), 1);
    await page.locator('.theme-card a').click();
    await page.locator('.chapter').first().waitFor();
    assert.equal(await page.locator('.chapter').count(), 2);
    assert.equal(await page.locator('.claim-item').count(), 2, '每条事实可以单独展开');
    await page.locator('.claim-item summary').first().click();
    assert.equal(await page.locator('.claim-item').first().locator('.claim-sources .source-row').count(), 1);
    assert.match(await page.locator('.claim-item').first().innerText(), /匿名贡献者/);
    assert.match(await page.locator('.claim-item').first().locator('.story-link').getAttribute('href'), /storyResourceId=r_hb/);
    assert.equal(await page.locator('.expand > details').count(), 3);
    assert.equal(await page.locator('.chapter > .chapter-source .source-row').count(), 2);
    assert.equal(await page.locator('.expand > details').first().evaluate(node => node.open), false,
      '故事优先，地图默认收起');
    await page.locator('.expand > details').first().locator(':scope > summary').click();
    assert.equal(await page.locator('.map-point').count(), 2);
    await page.locator('.expand > details').nth(1).locator(':scope > summary').click();
    await page.locator('.expand > details').nth(2).locator(':scope > summary').click();
    assert.equal(await page.locator('.relation-row').count(), 1);
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'overflow ' + width);
      await page.screenshot({ path: path.join(output, 'theme-public-' + width + '.png'), fullPage: true });
    }
    assert.equal((await page.locator('body').innerText()).includes('private_admin_uid'), false);
    assert.deepEqual(errors, []);
    console.log('Story theme public UI passed: story first, sources, map, timeline, chain and 390/768/1440.');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
