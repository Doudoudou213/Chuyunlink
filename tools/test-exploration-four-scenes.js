'use strict';
// No browser or external service. Editorial traceability and local-only serving
// are checked here; historical accuracy still requires human content review.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), http = require('node:http'), vm = require('node:vm');
const preview = require('./lib/exploration-four-scenes-preview');
const tower = require('./lib/exploration-tower-study-preview');
const {validateDraft} = require('./lib/exploration-editorial-preview');
const draft = require('./fixtures/four-scenes-study.json'), towerDraft = require('./fixtures/tower-study.json');
const content = require('../static/exploration-journey-content');
const study = require('../static/exploration-journey-study-scenes');
const root = path.join(__dirname, '..'), resourceId = 'hhl-four-scenes-study';
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const profileContext = {window:{}};
vm.runInNewContext(read('static/exploration-gilded-profiles.js'), profileContext);
const profiles = profileContext.window.ChuParkGildedProfiles;
let count = 0;
function check(value, label) {assert(value, label);count++;}
function rejectsDraft(change, label) {const value = structuredClone(draft);change(value);assert.throws(() => validateDraft(value), /待审/);count++;}
(async () => {
  validateDraft(draft);
  const expected = ['tower', 'copper', 'baiyun', 'pond'], now = Date.parse('2026-10-20T08:00:00Z');
  const response = preview.response(now), data = content.project(response, resourceId, now);
  check(response.localTest === true && response.walk.simulated === true, 'explicitly local, never simulated human approval');
  check(draft.status === 'editorial-draft' && draft.publishAllowed === false, 'unpublished draft remains closed');
  check(JSON.stringify(data.points.map(point => point.id)) === JSON.stringify(expected), 'four narrative chapters in deliberate reading order');
  check(new Set(draft.points.map(point => point.theme)).size === 4, 'four different editorial questions');
  check(Date.parse(response.validUntil) - now === 3600000, 'one-hour local preview freshness only');
  check(response.walk.fingerprint === crypto.createHash('sha256').update(JSON.stringify(draft)).digest('hex'), 'draft changes invalidate reading session');
  check(Object.keys(response.map.assets).length === 0, 'no fabricated real photo, audio, or rights record');
  for (const [index, point] of draft.points.entries()) {
    const projected = data.points[index];
    check(point.paragraphs.length >= 2 && point.paragraphs.length <= 4, point.id + ' has a concise distinct chapter');
    check(projected.reading === point.paragraphs.join('\n\n'), point.id + ' preserves editorial paragraphs');
    check(projected.observation === point.observation, point.id + ' has its own observation');
    check(projected.artScene === point.artScene && point.id === point.artScene, point.id + ' uses its explicit original-art binding');
    check(['x','y','width','height'].every((key,i) => study[point.id].rect[i] === profiles[point.id].sourceRect[key]), point.id + ' study uses registered source image geometry');
    check(study[point.id].contours.every(index => profiles[point.id].contours[index]), point.id + ' detail outlines exist in original-art registry');
    check(projected.sources.length === point.sources.length, point.id + ' keeps all research sources');
    check(projected.sources.every(source => source.credit.includes('未通过人工审稿') && source.credit.includes(draft.webReadDate)), point.id + ' source credits disclose draft boundary');
    check(point.sources.every(source => source.url.startsWith('https://') && source.publishedDate && source.locator && source.summary), point.id + ' public dated provenance is traceable');
    check(point.claims.every(claim => claim.sourceIds.every(id => point.sources.some(source => source.id === id))), point.id + ' claims point only to own sources');
    check(point.claims.every(claim => claim.paragraphs.every(index => Number.isInteger(index) && index >= 0 && index < point.paragraphs.length)), point.id + ' claims map to actual paragraphs');
    check(point.missing.some(item => /实拍|照片/.test(item)) && point.missing.some(item => /许可|授权/.test(item)), point.id + ' future photos and rights are explicitly pending');
    check(!projected.audio, point.id + ' does not fabricate a recording');
  }
  check(!/(reviewer|reviewedAt|publishedAt|mediaConsent|latitude|longitude|currentLocation)/.test(JSON.stringify(response)), 'response adds no false reviewer, publishing state, rights or location');
  check(!JSON.stringify(response).includes('"claims"') && !JSON.stringify(response).includes('"missing"'), 'internal draft notes stay outside visitor response');
  rejectsDraft(value => {value.publishAllowed = true;}, 'cannot enable publishing');
  rejectsDraft(value => {value.status = 'approved';}, 'cannot masquerade as approved');
  rejectsDraft(value => {value.points[1].id = 'tower';}, 'reject duplicate scene');
  rejectsDraft(value => {value.points[1].artScene = 'tower';}, 'reject mismatched art');
  rejectsDraft(value => {value.points[0].sources = [];}, 'reject missing source');
  rejectsDraft(value => {value.points[0].sources[0].url = 'javascript:alert(1)';}, 'reject active source URL');
  rejectsDraft(value => {value.points[0].sources[0].url = 'https://name:secret@example.com/';}, 'reject credential URL');
  rejectsDraft(value => {value.points[0].sources[0].locator = '';}, 'reject missing traceable locator');
  rejectsDraft(value => {value.points[0].claims[0].sourceIds = ['unknown'];}, 'reject missing claim source');
  rejectsDraft(value => {value.points[0].claims[0].paragraphs = [99];}, 'reject impossible claim paragraph');
  rejectsDraft(value => {value.points[0].missing = [];}, 'reject discarded pending material list');
  const old = tower.response(now);
  check(old.walk.resourceId === 'hhl-tower-study' && old.walk.points.length === 1, 'stage-one resource stays single-scene');
  check(old.walk.points[0].reading === towerDraft.paragraphs.join('\n\n'), 'stage-one editorial prose unchanged');
  check(old.walk.fingerprint === crypto.createHash('sha256').update(JSON.stringify(towerDraft)).digest('hex'), 'stage-one fingerprint and local continuation stay compatible');
  const productionHTML = read('explore-journey.html');
  const markers = ['</head>', '<!-- journey-local-adapter -->', '<script defer src="static/guide-cloud.js"></script>',
    '<body class="scenic-journey">', 'aria-label="已审内容阅读"', 'aria-label="按已发布顺序阅读"', '正在核对当前公开版本',
    '正在核对当前公开资料。', '请启用 JavaScript 读取当前公开资料。本页不提供离线旧讲解。', '<p id="reading-copy">'];
  for (const tool of [preview, tower]) for (const marker of markers) for (const replacement of ['', marker + marker]) {
    await assert.rejects(tool.start(0, {html:productionHTML.replace(marker, replacement)}), /本地样章注入点必须唯一/);
    count++;
  }
  for (const filename of ['tools/deploy-cloudbase.ps1', 'tools/validate-cloudbase-build.js', 'explore-journey.html']) {
    const source = read(filename);
    check(!/four-scenes-study\.json|exploration-four-scenes-preview|exploration-editorial-preview|tower-study\.json/.test(source), 'drafts and local server excluded from ' + filename);
  }
  for (const filename of ['static/exploration-journey-live.js', 'static/exploration-journey-content.js', 'static/exploration-journey-study.js', 'static/exploration-journey-study-scenes.js']) {
    const source = read(filename);
    check(!source.includes('four-scenes-study') && !draft.points.some(point => source.includes(point.paragraphs[1])), filename + ' has no editorial fallback prose');
  }
  const server = await preview.start(), single = await tower.start();
  try {
    const htmlResponse = await fetch(server.url + '/four-scenes.html?resourceId=' + resourceId);
    const html = await htmlResponse.text(), policy = htmlResponse.headers.get('content-security-policy');
    const directives = new Map(policy.split(';').map(part => {const [key, ...values] = part.trim().split(/\s+/);return [key, values.join(' ')];}));
    check(htmlResponse.status === 200 && html.includes('四景叙事审阅样章'), 'four-scene review page serves');
    check(html.includes('未审稿，非现场导览') && html.includes('尚未通过人工审稿与现场核对'), 'visible notices outside and inside paper');
    check(html.includes('id="study-preview-theme"') && html.includes('MutationObserver'), 'subtle current-chapter question is local-only');
    check(!html.includes(',#previous,#next{display:none!important}'), 'four-scene previous and next remain available');
    check(html.includes('http://127.0.0.1:4220/tower-study.html?resourceId=hhl-tower-study'), 'links back to original specimen');
    const singleHTML = await (await fetch(single.url + '/tower-study.html?resourceId=hhl-tower-study')).text();
    check(singleHTML.includes(',#previous,#next{display:none!important}'), 'single-scene controls stay hidden');
    check(singleHTML.includes('http://127.0.0.1:4221/four-scenes.html?resourceId=hhl-four-scenes-study'), 'original specimen links to four chapters');
    check(!html.includes('guide-cloud.js') && !html.includes('正在核对当前公开版本'), 'no cloud adapter or misleading initial public state');
    check(directives.get('default-src') === "'self'" && directives.get('connect-src') === "'self'", 'CSP restricts assets and all network calls to local origin');
    for (const key of ['object-src', 'base-uri', 'form-action', 'frame-src', 'frame-ancestors', 'worker-src']) check(directives.get(key) === "'none'", key + ' disabled');
    const inline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    check(inline.length === 1, 'exactly one local adapter script');
    const hash = "'sha256-" + crypto.createHash('sha256').update(inline[0][1]).digest('base64') + "'";
    check(directives.get('script-src') === "'self' " + hash, 'CSP permits only the exact adapter hash, no unsafe-inline scripts');
    check(htmlResponse.headers.get('cache-control') === 'no-store' && htmlResponse.headers.get('referrer-policy') === 'no-referrer', 'private local specimen is not cached or referred');
    const api = await (await fetch(server.url + '/__four-scenes')).json();
    check(content.project(api, resourceId).points.length === 4, 'served payload passes actual visitor projection');
    for (const endpoint of ['/', '/index.html', '/four-scenes.html?resourceId=other']) {
      const redirected = await fetch(server.url + endpoint, {redirect:'manual'});
      check(redirected.status === 302 && redirected.headers.get('location') === '/four-scenes.html?resourceId=' + resourceId, 'canonical own resource ' + endpoint);
    }
    for (const endpoint of ['/__four-scenes', '/four-scenes.html?resourceId=' + resourceId, '/static/exploration-journey-study-scenes.js']) {
      const head = await fetch(server.url + endpoint, {method:'HEAD'});
      check(head.status === 200 && (await head.text()) === '', 'HEAD has no body ' + endpoint);
    }
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      check((await fetch(server.url + '/__four-scenes', {method})).status === 405, method + ' cannot mutate local preview');
    }
    for (const filename of ['/tools/fixtures/four-scenes-study.json', '/tools/lib/exploration-four-scenes-preview.js', '/tools/lib/exploration-editorial-preview.js',
      '/explore-journey.html', '/explore-admin.html', '/admin.html', '/static/guide-cloud.js', '/__tower-study', '/static/../AGENTS.md', '/static/%2e%2e/AGENTS.md', '/.git/config']) {
      check((await fetch(server.url + filename)).status === 404, 'no public access to ' + filename);
    }
    const hostileHost = await new Promise((resolve, reject) => {
      const request = http.get(server.url + '/__four-scenes', {headers:{Host:'untrusted.invalid'}}, response => {response.resume();response.on('end', () => resolve(response.statusCode));});
      request.on('error', reject);
    });
    check(hostileHost === 421, 'loopback server rejects unrelated Host headers');
    for (const asset of [...html.matchAll(/(?:src|href)="(static\/[^"?#]+)"/g)].map(match => match[1])) {
      check((await fetch(server.url + '/' + asset)).status === 200, 'all direct dependencies served ' + asset);
    }
    for (const asset of ['paper-fibres-soft-v1.webp', 'exploration-motion/hhl-full-park-v2.webp', 'longcang-editorial-v1.woff2']) {
      check((await fetch(server.url + '/static/assets/' + asset)).status === 200, 'nested visual dependency served ' + asset);
    }
  } finally {await server.close();await single.close();}
  console.log('PASS four-scene editorial contracts: ' + count + ' checks; draft provenance, art bindings, read-only isolation, CSP and legacy compatibility.');
})().catch(error => {console.error(error);process.exitCode = 1;});
