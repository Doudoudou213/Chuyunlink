'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const output = process.argv[2];
if (!output || !path.isAbsolute(output)) throw Error('Pass an absolute screenshot directory');
fs.mkdirSync(output, { recursive: true });
const server = http.createServer((request, response) => {
  const name = new URL(request.url, 'http://local').pathname;
  const file = path.resolve(root, '.' + name);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile())
    return response.writeHead(404).end();
  response.setHeader('Content-Type', name.endsWith('.js') ? 'application/javascript' :
    name.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream');
  response.end(fs.readFileSync(file));
});

async function main() {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const page = await browser.newPage();
    const source = fs.readFileSync(path.join(root, 'static/cloudbase-app.js'), 'utf8');
    const marker = '  document.addEventListener(\'DOMContentLoaded\', async () => {';
    assert.ok(source.includes(marker));
    const script = source.replace(marker, '  if (false) document.addEventListener(\'DOMContentLoaded\', async () => {')
      .replace(/\}\)\(\);\s*$/, `  window.__themeProfileRender = data => {
        cloudUser = { uid: 'test_member', email: 'test@example.org' };
        latestBootstrap = data;
        injectAccountUi();
        renderCloudSubmissionRecords();
        renderCloudContributionImpact(data);
      };
    })();`);
    await page.route('**/static/cloudbase-app.js', route => route.fulfill({
      contentType: 'application/javascript', body: script
    }));
    await page.route('https://**/*', route => route.abort());
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof window.__themeProfileRender === 'function');
    await page.evaluate(() => {
      window.__themeProfileRender({
        mySubmissions: [{ id: 'test_submission', title: '虚构凤鸟纹照片', status: 'approved',
          assetType: 'image', createdAt: '2026-09-26', publicContributorConsent: false,
          materialAnalysisConsent: true, aiAnalysisConsent: true, rewardPoints: 100 }],
        contributionImpact: { adoptedCount: 1, storyCount: 0, themeCount: 1,
          totalRewardPoints: 0, items: [{ type: 'theme_adoption', status: 'adopted',
            themeTitle: '虚构文化专题', chapterIndex: 0, currentlyPublic: true }] }
      });
      const profile = document.getElementById('view-profile');
      profile.classList.remove('hidden');
      profile.style.display = 'block';
    });
    assert.equal(await page.locator('[data-public-attribution]').count(), 1);
    assert.equal(await page.locator('#cloud-impact-adopted').innerText(), '1');
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 950 });
      await page.locator('#view-profile').screenshot({
        path: path.join(output, 'theme-profile-' + width + '.png')
      });
      const bounds = await page.evaluate(() => ({
        page: document.documentElement.scrollWidth, window: innerWidth,
        profile: document.getElementById('view-profile').scrollWidth,
        profileWidth: document.getElementById('view-profile').clientWidth
      }));
      assert.equal(bounds.profile > bounds.profileWidth, false,
        'profile horizontal overflow at ' + width + ': ' + JSON.stringify(bounds));
    }
    await page.evaluate(() => {
      const collect = document.getElementById('view-collect');
      collect.classList.remove('hidden'); collect.style.display = 'block';
      const task = document.getElementById('collect-gap-task-context');
      task.classList.remove('hidden');
      document.getElementById('collect-gap-task-title').textContent = '虚构资料征集';
      document.getElementById('collect-gap-task-description').textContent = '补充一份可核对的现场材料。';
      document.getElementById('collect-gap-task-reward').textContent = '经确认后按征集规则处理';
      collect.querySelector('.collect-consent-disclosure').open = true;
    });
    for (const id of ['collect-ai-consent', 'collect-material-consent',
      'collect-material-research-consent', 'collect-material-excerpt-consent'])
      assert.equal(await page.locator('#view-collect #' + id).isChecked(), false);
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 950 });
      await page.locator('#view-collect').screenshot({
        path: path.join(output, 'theme-collect-' + width + '.png')
      });
      const collectBounds = await page.evaluate(() => {
        const collect = document.getElementById('view-collect');
        return { scroll: collect.scrollWidth, client: collect.clientWidth,
          wide: [...collect.querySelectorAll('*')].filter(el => el.getBoundingClientRect().right >
            collect.getBoundingClientRect().right + 2).slice(0, 5).map(el => el.className || el.tagName) };
      });
      assert.ok(collectBounds.scroll - collectBounds.client <= 12,
        'collect content exceeds the decorative roller margin at ' + width + ': ' +
        JSON.stringify(collectBounds));
    }
    console.log('Merged visual profile, contribution, collection and default-off consent passed at 390/768/1440.');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
