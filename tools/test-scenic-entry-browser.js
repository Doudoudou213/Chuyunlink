'use strict';
// Isolated browser contracts. No production data, credentials or cloud requests.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..'), output = path.join(root, 'artifacts/scenic-entry');
let checks = 0;
function check(value, message) { assert(value, message); checks++; }
function response() {
  return { ok: true, available: true, validUntil: new Date(Date.now() + 3600000).toISOString(),
    walk: { resourceId: 'yellow-crane-tower', title: '黄鹤楼', fingerprint: 'published-test-fingerprint', version: 2,
      points: [{ id: 'tower', title: '主楼', text: '固定测试文字，非正式讲解。', sources: [{ title: '固定测试出处' }] },
        { id: 'pond', title: '鹅池', text: '另一段固定测试文字。', sources: [{ title: '固定测试出处' }] }] },
    map: { objects: [{ pointId: 'tower', artScene: 'tower' }, { pointId: 'pond', artScene: 'pond' }] } };
}
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>主站画卷入口 · 本地契约检查</title>
<link rel="stylesheet" href="/static/paper-editorial.css"><link rel="stylesheet" href="/static/scenic-entry.css">
<style>body{margin:0;background:#f8f4eb;color:#30392e}main{max-width:880px;margin:auto;padding:20px 0}h1,h2{font:500 20px/1.5 'Songti SC',SimSun,serif;margin:16px}section{margin-bottom:24px}.scenic-test-quick{padding:16px}.landmark-ticket-quiet-actions,#view-profile{margin:16px}.landmark-ticket-quiet-actions{display:grid;grid-template-columns:1fr 1fr}nav button{min-height:44px} .masthead{padding:16px}.scenic-entry--profile{border-top:1px solid #d8cdb9}</style>
<body><main><h1>楚韵链迹 · 本地入口样例</h1><section id="view-discover"><h2>发现</h2><div class="scenic-test-quick"><nav class="discover-quick-actions"><button>发现</button><button>地图</button><button>采集</button><button>活动科普</button><button>我的</button></nav></div></section><section id="landmark-drawer"><h2>黄鹤楼</h2><div class="landmark-ticket-quiet-actions"></div></section><section id="view-profile"><h2>我的</h2></section></main>
<script src="/static/exploration-journey-content.js"></script><script src="/static/scenic-return.js"></script><script src="/static/scenic-entry.js"></script>
<script>
window.__response=${JSON.stringify(response())};window.__calls=[];
localStorage.setItem('chulink:journey-content:v1:yellow-crane-tower',JSON.stringify({'published-test-fingerprint':{fingerprint:'published-test-fingerprint',selected:'pond',updatedAt:Date.now(),note:'PRIVATE_TEST_NOTE'}}));
window.__configure=()=>ChuScenicEntry.configure({call:async data=>{__calls.push(data);if(window.__fail)throw Error('offline');return window.__response},capture:()=>({view:'map',scroll:320,landmarkId:'yellow-crane-tower',center:[30.54,114.30],zoom:15,note:'MUST_NOT_SAVE',userId:'MUST_NOT_SAVE'}),restore:async c=>{window.__restored=c}});
ChuScenicEntry.onLandmark({id:'yellow-crane-tower'});__configure();
</script></body></html>`;
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://local'); res.setHeader('Cache-Control', 'no-store');
    if (u.pathname === '/' || u.pathname === '/index.html' || u.pathname === '/guide.html') { res.setHeader('Content-Type', 'text/html;charset=utf-8'); return res.end(html); }
    if (u.pathname === '/explore-journey.html') { res.setHeader('Content-Type', 'text/html;charset=utf-8'); return res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>入口落点检查</title><header class="masthead"><a href="index.html">旧返回</a></header><script src="static/scenic-return.js"></script></html>'); }
    const file = path.resolve(root, '.' + decodeURIComponent(u.pathname));
    if (!file.startsWith(root + path.sep + 'static' + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.woff2': 'font/woff2' })[path.extname(file)] || 'application/octet-stream'); res.end(fs.readFileSync(file));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const errors = [], external = [];
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.on('pageerror', e => errors.push(e.message)); page.on('request', r => { if (!r.url().startsWith(base)) external.push(r.url()); });
    const go = async () => { await page.goto(base + '/index.html'); await page.locator('[data-scenic-entry=discover]').waitFor(); };
    const refresh = () => page.evaluate(() => ChuScenicEntry.refresh(true));
    await go();
    check(await page.locator('.discover-quick-actions button').count() === 5, 'five tabs unchanged');
    check(await page.locator('[data-scenic-entry=map]').isVisible(), 'selected tower has direct entry');
    check(await page.locator('[data-scenic-entry=profile]').count() === 0, 'no missing profile DOM assumption');
    await page.evaluate(() => { const card = document.createElement('div'); card.id = 'cloud-profile-card'; card.textContent = '本地资料区'; document.querySelector('#view-profile').append(card); });
    await page.locator('[data-scenic-entry=profile]').waitFor();
    check((await page.locator('[data-scenic-entry=profile]').textContent()).includes('鹅池 · 本机续读'), 'local resume only current point title');
    check(!(await page.locator('body').innerText()).includes('PRIVATE_TEST_NOTE'), 'private note never copied into main page');
    check(await page.evaluate(() => __calls.every(c => Object.keys(c).length === 2 && c.action === 'getSiteExploration' && c.resourceId === 'yellow-crane-tower')), 'read-only approved action only');
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow ' + width);
      for (const view of ['discover', 'map', 'profile']) check(await page.locator('[data-scenic-entry=' + view + ']').evaluate(e => e.getBoundingClientRect().height >= 44), '44px target ' + view + ' ' + width);
      await page.screenshot({ path: path.join(output, 'entry-' + width + '.png'), fullPage: true });
    }
    await page.evaluate(() => ChuScenicEntry.onLandmark({ id: 'different-point' }));
    check(await page.locator('[data-scenic-entry=map]').isHidden(), 'non-tower has no mismatched artwork');
    await page.evaluate(() => ChuScenicEntry.onLandmark({ id: 'yellow-crane-tower' }));
    await page.locator('[data-scenic-entry=map]').click(); await page.waitForURL('**/explore-journey.html?**');
    check(new URL(page.url()).searchParams.get('resourceId') === 'yellow-crane-tower', 'production resource URL not study demo');
    check(await page.locator('.masthead > a').textContent() === '← 返回地图', 'contextual return label');
    const context = await page.evaluate(() => JSON.parse(sessionStorage.getItem('chulink:scenic-return:v1')));
    check(context.context.scroll === 320 && context.context.zoom === 15 && context.context.center[0] === 30.54, 'map viewport captured');
    check(!JSON.stringify(context).includes('MUST_NOT_SAVE'), 'unknown fields and identity omitted');
    await page.locator('.masthead > a').click(); await page.waitForFunction(() => !!window.__restored);
    check(await page.evaluate(() => __restored.landmarkId === 'yellow-crane-tower' && __restored.view === 'map' && __restored.scroll === 320), 'main receives exact safe state');
    check(!new URL(page.url()).searchParams.has('scenicReturn'), 'return token consumed from URL');
    check(await page.evaluate(() => sessionStorage.getItem('chulink:scenic-return:v1') === null), 'restored snapshot removed');
    await page.evaluate(() => ChuScenicEntry.configure({ capture: () => ({ view: 'discover', scroll: 425 }) }));
    await page.locator('[data-scenic-entry=discover]').click(); await page.waitForURL('**/explore-journey.html?**');
    check(await page.locator('.masthead>a').textContent() === '← 返回发现', 'Discover returns to Discover, not map');
    await page.locator('.masthead>a').click(); await page.waitForFunction(() => !!window.__restored);
    check(await page.evaluate(() => __restored.view === 'discover' && __restored.scroll === 425), 'Discover scroll preserved');
    await page.evaluate(() => { const card = document.createElement('div'); card.id = 'cloud-profile-card'; document.querySelector('#view-profile').append(card); }); await page.locator('[data-scenic-entry=profile]').waitFor();
    await page.evaluate(() => ChuScenicEntry.configure({ capture: () => ({ view: 'profile', scroll: 180 }) }));
    await page.locator('[data-scenic-entry=profile]').click(); await page.waitForURL('**/explore-journey.html?**');
    check(new URL(page.url()).searchParams.get('pointId') === 'pond', 'profile resumes selected published point');
    check(await page.locator('.masthead>a').textContent() === '← 返回我的', 'profile return label');
    await page.locator('.masthead>a').click(); await page.waitForFunction(() => !!window.__restored);
    await page.evaluate(() => { window.__response.available = false; }); await refresh();
    check(await page.locator('[data-scenic-entry=discover]').isHidden() && await page.locator('[data-scenic-entry=map]').isHidden(), 'unpublished hidden');
    await page.evaluate(value => { window.__response = value; __response.localTest = true; }, response()); await refresh();
    check(await page.locator('[data-scenic-entry=discover]').isHidden(), 'local sample never promoted');
    await page.evaluate(value => { window.__response = value; __response.walk.simulated = true; }, response()); await refresh();
    check(await page.locator('[data-scenic-entry=discover]').isHidden(), 'simulated walk never promoted');
    await page.evaluate(value => { window.__response = value; __response.map.objects = []; }, response()); await refresh();
    check(await page.locator('[data-scenic-entry=discover]').isHidden(), 'incomplete response blocked');
    await page.evaluate(value => { window.__response = value; }, response()); await refresh();
    await page.evaluate(() => { window.__fail = true; });
    await page.locator('[data-scenic-entry=discover]').click(); await page.waitForFunction(() => !document.querySelector('[data-scenic-entry=discover]').getClientRects().length);
    check(new URL(page.url()).pathname === '/index.html', 'failed preflight keeps existing website');
    check((await page.locator('#scenic-entry-status').textContent()).includes('暂未开放'), 'failed preflight announced');
    await go();
    await page.evaluate(() => { const card = document.createElement('div'); card.id = 'cloud-profile-card'; document.querySelector('#view-profile').append(card); }); await page.locator('[data-scenic-entry=profile]').waitFor();
    for (const patch of [{ updatedAt: Date.now() - 8 * 86400000 }, { fingerprint: 'old-version' }, { selected: 'wrong-point' }, { localTest: true }]) {
      await page.evaluate(patch => { localStorage.setItem('chulink:journey-content:v1:yellow-crane-tower', JSON.stringify({ 'published-test-fingerprint': { fingerprint: 'published-test-fingerprint', selected: 'pond', updatedAt: Date.now(), ...patch } })); }, patch); await refresh();
      check(await page.locator('[data-scenic-entry=profile]').isHidden(), 'invalid local resume hidden ' + Object.keys(patch)[0]);
    }
    await page.evaluate(() => localStorage.setItem('chulink:journey-content:v1:yellow-crane-tower', JSON.stringify({ fingerprint: 'published-test-fingerprint', selected: 'pond', updatedAt: Date.now() })));
    await refresh(); check(await page.locator('[data-scenic-entry=profile]').isHidden(), 'flat record cannot impersonate actual version dictionary');
    await page.evaluate(value => {
      window.__response = value;
      window.__response.validUntil = new Date(Date.now() + 200).toISOString();
    }, response()); await refresh();
    check(await page.locator('[data-scenic-entry=discover]').isVisible(), 'brief valid capability visible');
    await page.waitForFunction(() => document.querySelector('[data-scenic-entry=discover]').hidden);
    check(await page.locator('[data-scenic-entry=map]').isHidden(), 'capability expiry hides all entry points');
    await page.evaluate(async value => {
      let resolveOld;
      const old = ChuScenicEntry.configure({ call: () => new Promise(resolve => { resolveOld = resolve; }) });
      await Promise.resolve();
      await ChuScenicEntry.configure({ call: async () => ({ ok: true, available: false }) });
      resolveOld(value); await old;
    }, response());
    check(await page.locator('[data-scenic-entry=discover]').isHidden(), 'late older success cannot reopen withdrawn entry');
    await page.evaluate(async value => {
      let resolveOld;
      const old = ChuScenicEntry.configure({ call: () => new Promise(resolve => { resolveOld = resolve; }) });
      await Promise.resolve(); window.dispatchEvent(new PageTransitionEvent('pagehide'));
      resolveOld(value); await old;
    }, response());
    check(await page.locator('[data-scenic-entry=discover]').isHidden(), 'pagehide invalidates late success');
    await page.evaluate(async () => {
      const original = window.setTimeout;
      window.setTimeout = (fn, ms, ...args) => original(fn, ms === 12000 ? 20 : ms, ...args);
      try { await ChuScenicEntry.configure({ call: () => new Promise(() => {}) }); }
      finally { window.setTimeout = original; }
    });
    check(await page.locator('[data-scenic-entry=discover]').isHidden(), 'hung cloud call settles through timeout');
    await page.evaluate(async value => { window.__response = value; await __configure(); }, response());
    check(await page.locator('[data-scenic-entry=discover]').isVisible(), 'reconnect recovers without reload');
    check(await page.evaluate(() => ChuScenicReturn.save({ view: 'https://evil.example' }) === null), 'arbitrary destination rejected');
    const token = await page.evaluate(() => ChuScenicReturn.save({ view: 'profile', scroll: 99999999, center: [100, 190], zoom: 100, href: 'https://evil.example' }));
    check(await page.evaluate(t => { const c = ChuScenicReturn.read(t); return c.scroll === 1000000 && !c.center && !c.zoom && !c.href; }, token), 'viewport values bounded and unknown URLs removed');
    await page.goto(base + '/explore-journey.html?returnToken=https://evil.example');
    check((await page.locator('.masthead>a').getAttribute('href')) === '/index.html?view=map', 'invalid token falls back to map');
    await page.evaluate(() => { const raw = JSON.parse(sessionStorage.getItem('chulink:scenic-return:v1')); raw.at -= 3600001; sessionStorage.setItem('chulink:scenic-return:v1', JSON.stringify(raw)); });
    await page.goto(base + '/explore-journey.html?returnToken=' + token);
    check((await page.locator('.masthead>a').getAttribute('href')) === '/index.html?view=map', 'expired context cannot restore');
    check(errors.length === 0, 'no browser errors: ' + errors.join('; ')); check(external.length === 0, 'no external requests');
    console.log(JSON.stringify({ checks, screenshots: 'artifacts/scenic-entry', scope: 'isolated local browser contract; no real cloud acceptance' }));
  } finally { await browser.close(); await new Promise(r => server.close(r)); }
})().catch(e => { console.error(e); process.exitCode = 1; });
