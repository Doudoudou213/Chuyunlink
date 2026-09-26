'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const output = process.argv[2];
if (!output || !path.isAbsolute(output)) throw Error('Pass an absolute screenshot directory outside the repository');
const catalog = {
  resources: [{ id: 'r_hb', title: '湖北漆器', regionName: '湖北' },
    { id: 'r_hn', title: '河南纹样', regionName: '河南' }],
  entities: [{ id: 'e_hb', name: '凤鸟纹', aliases: ['凤纹'], resourceId: 'r_hb', region: { province: '湖北' } },
    { id: 'e_hn', name: '鸟纹', aliases: [], resourceId: 'r_hn', region: { province: '河南' } }],
  links: [{ id: 'l_hb', resourceId: 'r_hb', summary: '漆器上的鸟纹', kind: 'submission' },
    { id: 'l_hn', resourceId: 'r_hn', summary: '纹样记录', kind: 'submission' }],
  stories: [{ id: 'story_hb', resourceId: 'r_hb', title: '湖北故事', version: 1 },
    { id: 'story_hn', resourceId: 'r_hn', title: '河南故事', version: 1 }],
  claims: [{ id: 'claim_hb', resourceId: 'r_hb', storyId: 'story_hb', claimText: '漆器记录了凤鸟纹样。', sourceLinkIds: ['l_hb'] },
    { id: 'claim_hn', resourceId: 'r_hn', storyId: 'story_hn', claimText: '这份材料呈现鸟纹。', sourceLinkIds: ['l_hn'] }],
  relations: [{ id: 'rel1', fromEntityId: 'e_hb', toEntityId: 'e_hn',
    relationType: 'visually_similar_to', why: '外形有可描述的相似处', evidenceLinkIds: ['l_hb'] }]
};
async function main() {
  fs.mkdirSync(output, { recursive: true });
  const server = http.createServer((req, res) => {
    const name = new URL(req.url, 'http://local').pathname;
    if (name !== '/admin.html' && !name.startsWith('/static/')) return res.writeHead(404).end();
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
    await page.route('https://static.cloudbase.net/**', route => route.fulfill({
      contentType: 'application/javascript',
      body: 'window.cloudbase={init:()=>({auth:()=>({getLoginState:async()=>null})})};'
    }));
    await page.route('https://**/*', route => {
      if (route.request().url().includes('static.cloudbase.net'))
        return route.fulfill({ contentType: 'application/javascript',
          body: 'window.cloudbase={init:()=>({auth:()=>({getLoginState:async()=>null})})};' });
      return route.request().url().includes('tailwindcss.com') ? route.continue() : route.abort();
    });
    await page.goto('http://127.0.0.1:' + server.address().port + '/admin.html');
    await page.waitForFunction(() => typeof callAdmin === 'function');
    await page.evaluate(data => {
      window.themeCalls = [];
      window.themeRows = [];
      window.themeAdopted = false;
      window.themeWasRetracted = false;
      callAdmin = async request => {
        themeCalls.push(request);
        if (request.action === 'getStoryThemeWorkspace')
          return { ok: true, themes: themeRows, catalog: data };
        if (request.action === 'getStoryThemeContributionWorkspace')
          return { ok: true, themeId: 'theme_test', version: 1, title: '凤鸟纹样跨地区观察',
            available: true, chapters: themeRows[0].chapters.map((chapter, index) => ({
              id: chapter.id, number: index + 1, title: chapter.title,
              sources: (chapter.sourceLinkIds || []).map(sourceLinkId => ({
                sourceLinkId, submissionId: 'submission_' + index, title: '虚构投稿',
                summary: '已审核来源', adopted: themeAdopted && index === 0,
                retracted: themeWasRetracted && !themeAdopted && index === 0,
                contributionId: 'theme_adopted_' + (index + 1)
              }))
            })) };
        if (request.action === 'adoptStoryThemeContribution') {
          themeAdopted = true; return { ok: true, contributionId: 'theme_adopted_1' };
        }
        if (request.action === 'retractStoryThemeContribution') {
          themeAdopted = false; themeWasRetracted = true;
          return { ok: true, contributionId: request.contributionId };
        }
        if (request.action === 'saveStoryTheme') {
          themeRows = [{
            ...request, id: 'theme_test', revision: (themeRows[0]?.revision || 0) + 1,
            publishedVersion: 0, status: 'draft', proposal: null
          }];
          return { ok: true, themeId: 'theme_test', revision: themeRows[0].revision };
        }
        if (request.action === 'suggestStoryTheme') return { ok: true, proposal: {
          deterministic: { suggestedOrder: [{ entityId: 'e_hb' }, { entityId: 'e_hn' }],
            gaps: [{ request: '补充跨节点关系依据' }] }, ai: null
        } };
        if (request.action === 'publishStoryTheme') {
          themeRows[0].publishedVersion = 1;
          return { ok: true, themeId: 'theme_test', version: 1 };
        }
        return { ok: true };
      };
      document.getElementById('login-panel').classList.add('hidden');
      document.getElementById('login-panel').style.display = 'none';
      document.getElementById('admin-panel').classList.remove('hidden');
      document.getElementById('identity').textContent = '管理员 · 本地虚构数据预览';
    }, catalog);
    await page.locator('#story-themes-refresh').click();
    await page.waitForTimeout(500);
    if (!await page.locator('[data-theme-editor]').count())
      throw Error('Theme editor missing: ' + JSON.stringify({ errors, state: await page.locator('#list').innerText(),
        calls: await page.evaluate(() => window.themeCalls) }));
    await page.locator('[data-theme-editor]').waitFor();
    await page.locator('[data-theme-title]').fill('凤鸟纹样跨地区观察');
    await page.locator('[data-theme-introduction]').fill('从两地已确认的材料出发，观察不同器物上的鸟纹表现。');
    await page.locator('[data-theme-add-select]').selectOption('e_hb');
    await page.locator('[data-theme-add-node]').click();
    await page.locator('[data-theme-node] [data-node-link]').first().check();
    await page.locator('[data-theme-add-select]').selectOption('e_hn');
    await page.locator('[data-theme-add-node]').click();
    await page.locator('[data-theme-node]').nth(1).locator('[data-node-link]').check();
    await page.locator('[data-theme-relation]').check();
    await page.locator('[data-theme-add-chapter]').click();
    await page.locator('[data-theme-chapter] [data-chapter-node]').first().check();
    await page.locator('[data-theme-chapter-refresh]').click();
    await page.locator('[data-theme-chapter] [data-chapter-title]').fill('湖北的器物');
    await page.locator('[data-theme-chapter] [data-chapter-body]').fill('漆器记录了凤鸟纹样。这里讲述已确认的材料内容。');
    await page.locator('[data-theme-chapter] [data-chapter-link]').check();
    await page.locator('[data-theme-chapter] [data-chapter-claim]').check();
    await page.locator('[data-theme-save]').click();
    await page.waitForFunction(() => themeCalls.some(item => item.action === 'saveStoryTheme'));
    const saved = await page.evaluate(() => themeCalls.find(item => item.action === 'saveStoryTheme'));
    assert.deepEqual(saved.nodes.map(item => item.sourceLinkIds[0]), ['l_hb', 'l_hn']);
    assert.deepEqual(saved.chapters[0].claimIds, ['claim_hb']);
    await page.locator('[data-theme-suggest]').click();
    await page.locator('[data-theme-proposal]').waitFor();
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate(() => document.querySelectorAll('#list details').forEach(item => { item.open = true; }));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'overflow ' + width);
      await page.screenshot({ path: path.join(output, 'theme-editor-' + width + '.png'), fullPage: true });
    }
    await page.locator('[data-theme-add-chapter]').click();
    const second = page.locator('[data-theme-chapter]').nth(1);
    await second.locator('[data-chapter-node]').nth(1).check();
    await second.locator('[data-theme-chapter-refresh]').click();
    const ready = page.locator('[data-theme-chapter]').nth(1);
    await ready.locator('[data-chapter-title]').fill('河南的材料');
    await ready.locator('[data-chapter-body]').fill('这份材料呈现鸟纹。这里只讲述已审核材料，不推断传播路径。');
    await ready.locator('[data-chapter-link]').check();
    await ready.locator('[data-chapter-claim]').check();
    await page.locator('[data-theme-save]').click();
    await page.waitForFunction(() => themeCalls.filter(item => item.action === 'saveStoryTheme').length === 2);
    await page.locator('[data-theme-reviewed]').check();
    await page.locator('[data-theme-review-note]').fill('已经逐章核对事实原句与来源');
    await page.locator('[data-theme-publish]').click();
    await page.waitForFunction(() => themeCalls.some(item => item.action === 'publishStoryTheme'));
    const published = await page.evaluate(() => themeCalls.find(item => item.action === 'publishStoryTheme'));
    assert.equal(published.humanReviewed, true);
    assert.equal(published.expectedRevision, 2);
    await page.locator('[data-theme-adoption-source]').first().waitFor();
    await page.locator('[data-theme-adopt]').first().click();
    await page.waitForFunction(() => themeCalls.some(item => item.action === 'adoptStoryThemeContribution'));
    const adoption = await page.evaluate(() => themeCalls.find(item => item.action === 'adoptStoryThemeContribution'));
    assert.equal(adoption.themeVersion, 1);
    assert.equal(adoption.sourceLinkId, 'l_hb');
    assert.equal(adoption.resolvesGap, false);
    assert.equal(await page.locator('[data-theme-adoption-source]').first().locator('text=已正式采用').count(), 1);
    await page.locator('[data-theme-adoption-source]').first().locator('summary').click();
    await page.locator('[data-adoption-retract-reason]').first().fill('管理员误点，撤销记录');
    await page.locator('[data-theme-retract]').first().click();
    await page.waitForFunction(() => themeCalls.some(item => item.action === 'retractStoryThemeContribution'));
    const correction = await page.evaluate(() => themeCalls.find(item => item.action === 'retractStoryThemeContribution'));
    assert.equal(correction.contributionId, 'theme_adopted_1');
    assert.equal(await page.locator('[data-theme-adoption-source]').first().locator('text=采用已撤销').count(), 1);
    await page.screenshot({ path: path.join(output, 'theme-adoption-corrected-390.png'), fullPage: true });
    await page.locator('[data-theme-adopt]').first().click();
    assert.equal(await page.locator('[data-theme-adoption-source]').first().locator('text=已正式采用').count(), 1);
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false,
        'adoption overflow ' + width);
      await page.screenshot({ path: path.join(output, 'theme-adoption-' + width + '.png'), fullPage: true });
    }
    assert.deepEqual(errors, []);
    console.log('Story theme admin UI passed: selection, evidence, chapters, suggestions and 390/768/1440.');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
