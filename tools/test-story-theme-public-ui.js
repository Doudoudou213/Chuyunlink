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
  const published = db.data.story_theme_versions.get(saved.themeId + '_v1');
  db.data.story_contributions = new Map([['theme_adoption_fixture', {
    type: 'theme_adoption', status: 'adopted', themeId: saved.themeId, themeVersion: 1,
    chapterId: published.chapters[0].id, sourceLinkId: 'l_hb', submissionId: 's_hb'
  }]]);
  const theme = await loadPublicTheme(db, saved.themeId);
  // Multiple relation sources must not accidentally inherit chapter adoption marks.
  theme.relations[0].sourceLinkIds = ['l_hb', 'l_hn'];
  fs.mkdirSync(output, { recursive: true });
  const server = http.createServer((req, res) => {
    const name = new URL(req.url, 'http://local').pathname;
    if (name !== '/themes.html' && !name.startsWith('/static/')) return res.writeHead(404).end();
    const file = path.resolve(root, '.' + name);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return res.writeHead(404).end();
    const mime = { '.js': 'application/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp' };
    res.setHeader('Content-Type', mime[path.extname(name)] || 'text/html; charset=utf-8');
    res.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage();
    const errors = [];
    const apiCalls = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.exposeFunction('recordThemeAction', action => apiCalls.push(action));
    await page.addInitScript(data => { window.__themeFixture = data; }, theme);
    await page.route('https://**/*', route => route.abort());
    await page.route('https://static.cloudbase.net/**', route => route.fulfill({
      contentType: 'application/javascript',
      body: `window.cloudbase={init:()=>({
        auth:()=>({getLoginState:async()=>({user:{uid:'local_anon'}})}),
        callFunction:async({data})=>{await window.recordThemeAction(data.action);return {result:window.__themeMode==='error'?{ok:false,error:{message:'本地测试：连接暂时中断'}}:data.action==='listStoryThemes'?
          {ok:true,items:window.__themeMode==='empty'?[]:[{id:window.__themeFixture.id,title:window.__themeFixture.title,
            introduction:window.__themeFixture.introduction,version:window.__themeFixture.version,
            chapterCount:window.__themeFixture.chapters.length,regions:['湖北','河南']}]}:
          {ok:true,theme:window.__themeFixture}};}
      })};`
    }));
    const base = 'http://127.0.0.1:' + server.address().port + '/themes.html';
    await page.goto(base);
    await page.locator('.theme-card').waitFor();
    assert.equal(await page.locator('.theme-card').count(), 1);
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'list overflow ' + width);
      assert.equal(await page.locator('.brand img').evaluate(img => img.naturalWidth > 0), true);
      assert.equal(await page.locator('h1').innerText(), '主题故事');
      await page.screenshot({ path: path.join(output, 'theme-list-' + width + '.png'), fullPage: true });
    }
    await page.locator('.theme-card a').click();
    await page.locator('.chapter').first().waitFor();
    assert.equal(await page.locator('.chapter').count(), 2);
    assert.equal(await page.locator('.claim-item').count(), 2, '每条事实可以单独展开');
    assert.equal(await page.locator('.chapter-directory a').count(), 2);
    assert.equal(await page.locator('.expand > details[open]').count(), 0);
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'reading overflow ' + width);
      await page.screenshot({ path: path.join(output, 'theme-reading-' + width + '.png'), fullPage: true });
    }
    await page.locator('.chapter-directory a').nth(1).click();
    await page.waitForFunction(() => location.hash === '#theme-chapter-2');
    await page.locator('.chapter-directory a').first().click();
    await page.locator('.claim-item summary').first().click();
    assert.equal(await page.locator('.claim-item').first().locator('.claim-sources .source-row').count(), 1);
    assert.match(await page.locator('.claim-item').first().innerText(), /匿名贡献者/);
    assert.match(await page.locator('.claim-item').first().innerText(), /本章正式采用/);
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
    assert.equal(await page.locator('.relation-row .source-row').count(), 2);
    assert.equal(await page.locator('.relation-row .adopted-mark').count(), 0, '关系来源不误标章节正式采用');
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'overflow ' + width);
      await page.screenshot({ path: path.join(output, 'theme-public-' + width + '.png'), fullPage: true });
    }
    assert.equal((await page.locator('body').innerText()).includes('private_admin_uid'), false);
    assert(apiCalls.includes('listStoryThemes') && apiCalls.includes('getStoryTheme'));
    await page.setViewportSize({ width: 390, height: 1000 });
    await page.addInitScript(() => { window.__themeMode = 'empty'; });
    await page.goto(base);
    await page.locator('.theme-empty').waitFor();
    assert.equal(await page.locator('.theme-card').count(), 0, '空列表不伪造专题');
    await page.screenshot({ path: path.join(output, 'theme-empty-390.png'), fullPage: true });
    await page.addInitScript(() => { window.__themeMode = 'error'; });
    await page.goto(base);
    await page.locator('[data-theme-retry]').waitFor();
    await page.screenshot({ path: path.join(output, 'theme-error-390.png'), fullPage: true });
    await page.evaluate(() => { window.__themeMode = 'normal'; });
    await page.locator('[data-theme-retry]').click();
    await page.locator('.theme-card').waitFor();
    assert.equal(await page.locator('#theme-content').getAttribute('aria-busy'), 'false');
    await page.addInitScript(() => {
      window.__themeMode = 'normal';
      const long = '本地虚构排版测试：不同地点的材料记录与长标题章节阅读方式'.repeat(4);
      window.__themeFixture.title = long;
      window.__themeFixture.chapters[0].title = long;
      window.__themeFixture.chapters[0].body = ('本地虚构长文测试。用连续段落核对行距、断行、章节层次与来源入口，不作为真实历史资料。\n\n').repeat(12);
      window.__themeFixture.sources[0].submissionTitle = 'LongSourceWithoutBreak'.repeat(15);
    });
    await page.goto(base + '?id=' + encodeURIComponent(theme.id));
    await page.locator('.chapter').first().waitFor();
    await page.locator('.chapter > .chapter-source > summary').first().click();
    for (const width of [320, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'long content overflow ' + width);
      const targets = await page.locator('a, summary, button').evaluateAll(nodes => nodes.filter(node => node.getBoundingClientRect().height && !node.classList.contains('skip-link')).map(node => ({ text: node.textContent.slice(0, 40), height: node.getBoundingClientRect().height })));
      assert(targets.every(target => target.height >= 44), '44px targets ' + JSON.stringify(targets.filter(target => target.height < 44)));
      await page.screenshot({ path: path.join(output, 'theme-long-' + width + '.png'), fullPage: true });
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior), 'auto');
    assert.equal(await page.locator('#content-effects-choice').isVisible(), true);
    assert.deepEqual(errors, []);
    console.log('Story theme public UI passed: list, reading, sources/adoption, map/timeline/chain, empty/retry, long content, 44px and 320/390/768/1440.');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
