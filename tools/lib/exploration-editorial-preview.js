'use strict';
// Shared, localhost-only review shell. Drafts never enter the published-content
// service, deployment manifests, cloud adapter, or a simulated human review flow.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const scenes = ['tower', 'copper', 'baiyun', 'pond'];
const isoDay = /^\d{4}-\d{2}-\d{2}$/;
const string = value => typeof value === 'string' && value.trim().length > 0;
const escapeHTML = value => String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const scriptJSON = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
function validateDraft(draft) {
  if (draft?.schemaVersion !== 1 || draft.status !== 'editorial-draft' || draft.publishAllowed !== false) throw Error('本地样章必须保持待审且禁止发布');
  if (!string(draft.id) || !string(draft.title) || !isoDay.test(draft.webReadDate) || !Array.isArray(draft.points) || !draft.points.length || draft.points.length > 4) throw Error('待审样章结构不完整');
  const ids = new Set(), bindings = new Set();
  for (const point of draft.points) {
    if (!scenes.includes(point.id) || point.artScene !== point.id || ids.has(point.id) || bindings.has(point.artScene) ||
      !string(point.title) || !string(point.observation) || !Array.isArray(point.paragraphs) || !point.paragraphs.length || !point.paragraphs.every(string) ||
      !Array.isArray(point.sources) || !point.sources.length) throw Error('待审景物、正文或原画绑定不完整');
    ids.add(point.id);bindings.add(point.artScene);
    const sourceIds = new Set();
    for (const source of point.sources) {
      let url;try {url = new URL(source.url);} catch {throw Error('待审来源必须为有效公开网址');}
      if (!string(source.id) || sourceIds.has(source.id) || !string(source.title) || !string(source.summary) || !string(source.locator) ||
        !isoDay.test(source.publishedDate) || url.protocol !== 'https:' || url.username || url.password) throw Error('待审来源必须为有效公开网址与可追溯段落');
      sourceIds.add(source.id);
    }
    if (!Array.isArray(point.claims) || !point.claims.length || !Array.isArray(point.missing) || !point.missing.length) throw Error('待审景物需要事实对照与待补材料');
    for (const claim of point.claims) {
      if (!string(claim.id) || !string(claim.summary) || !Array.isArray(claim.sourceIds) || !claim.sourceIds.length || !claim.sourceIds.every(id => sourceIds.has(id)) ||
        !Array.isArray(claim.paragraphs) || !claim.paragraphs.length || !claim.paragraphs.every(index => Number.isInteger(index) && index >= 0 && index < point.paragraphs.length)) throw Error('待审事实引用或段落索引不完整');
    }
  }
  return draft;
}
function createEditorialPreview(options) {
  const {draft, resourceId, pagePath, endpoint, noticeTitle, walkTitle, link, single = false, themes = false, fingerprintSource = draft} = options;
  if (!/^[a-z0-9-]+$/.test(resourceId) || !/^\/[a-z0-9-]+\.html$/.test(pagePath) || !/^\/__[a-z0-9-]+$/.test(endpoint) ||
    !/^http:\/\/127\.0\.0\.1:\d{4,5}\/[a-z0-9-]+\.html\?resourceId=[a-z0-9-]+$/.test(link?.url || '')) throw Error('本地样章配置不合法');
  validateDraft(draft);
  const html = fs.readFileSync(path.join(root, 'explore-journey.html'), 'utf8');
  const assets = new Set([...html.matchAll(/(?:src|href)="(static\/[^"?#]+)"/g)].map(match => '/' + match[1]));
  assets.delete('/static/guide-cloud.js');
  for (const name of ['paper-fibres-soft-v1.webp', 'exploration-motion/hhl-full-park-v2.webp', 'longcang-editorial-v1.woff2']) assets.add('/static/assets/' + name);
  const themeMap = Object.fromEntries(draft.points.map(point => [point.id, point.theme || '']));
  const themeCode = themes ? `document.addEventListener("DOMContentLoaded",function(){const themes=${scriptJSON(themeMap)},node=document.getElementById("study-preview-theme"),stops=document.getElementById("journey-stops"),content=document.getElementById("content");function update(){const selected=stops.querySelector('[aria-current="step"]'),value=!content.hidden&&selected?themes[selected.dataset.stop]||"":"";node.textContent=value;node.hidden=!value;}const observer=new MutationObserver(update);observer.observe(stops,{childList:true,subtree:true,attributes:true,attributeFilter:["aria-current"]});observer.observe(content,{attributes:true,attributeFilter:["hidden"]});update();});` : '';
  const adapterCode = `window.ExplorationAdapter={call:async function(e){if(e.action!=="getSiteExploration"||e.resourceId!==${scriptJSON(resourceId)})throw Error("只读样章不支持业务操作");const r=await fetch(${scriptJSON(endpoint)},{cache:"no-store"});if(!r.ok)throw Error("样章暂不可读");return r.json();}};` + themeCode;
  const csp = ["default-src 'self'", "connect-src 'self'",
    "script-src 'self' 'sha256-" + crypto.createHash('sha256').update(adapterCode).digest('base64') + "'",
    "style-src 'self' 'unsafe-inline'", "img-src 'self' data:", "font-src 'self'", "media-src 'self'",
    "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-src 'none'", "frame-ancestors 'none'", "worker-src 'none'"
  ].join('; ');
  function prepareHTML(template) {
    const notice = '<aside class="study-preview-notice">' + escapeHTML(noticeTitle) + ' · 未审稿，非现场导览<br><span>仅使用现有画稿；网页核读于' + escapeHTML(draft.webReadDate) + '，不代表景区认可。录音与现场核对待补。</span><a href="' + escapeHTML(link.url) + '">' + escapeHTML(link.title) + ' ↗</a></aside>';
    const style = '<style>.study-preview-notice{max-width:1440px;margin:auto;padding:12px 28px;color:var(--gold);font:12px/1.8 system-ui,sans-serif}.study-preview-notice span{color:var(--paper);opacity:.85}.study-preview-notice a{color:inherit;display:inline-flex;align-items:center;min-height:44px;margin-left:16px}.journey-leaf-content .study-draft-note{font:11px/1.8 system-ui,sans-serif;color:var(--rust);margin:0 0 14px}.journey-leaf-content .study-preview-theme{font:600 18px/1.6 var(--reading);color:var(--muted);margin:0 0 14px}#explore-tools,#explore-tools+p' + (single ? ',#previous,#next' : '') + '{display:none!important}</style>';
    const replacements = [
      ['</head>', style + '</head>'],
      ['<!-- journey-local-adapter -->', '<script>' + adapterCode + '</script>'],
      ['<script defer src="static/guide-cloud.js"></script>', ''],
      ['<body class="scenic-journey">', '<body class="scenic-journey">' + notice],
      ['aria-label="已审内容阅读"', 'aria-label="待审样章阅读"'],
      ['aria-label="按已发布顺序阅读"', 'aria-label="按待审样章顺序阅读"'],
      ['正在核对当前公开版本', '正在读取本地待审样章'],
      ['正在核对当前公开资料。', '正在读取本地待审研究稿，不代表人工审核。'],
      ['请启用 JavaScript 读取当前公开资料。本页不提供离线旧讲解。', '请启用 JavaScript 阅读本地待审样章。本页不是正式导览。'],
      ['<p id="reading-copy">', '<p class="study-draft-note">讲解研究稿 · 尚未通过人工审稿与现场核对</p>' + (themes ? '<p id="study-preview-theme" class="study-preview-theme" hidden></p>' : '') + '<p id="reading-copy">']
    ];
    // Fail closed before opening a socket: never silently lose the local adapter,
    // cloud removal, or draft notices when the visitor template changes.
    for (const [needle] of replacements) {
      if (typeof template !== 'string' || template.split(needle).length !== 2) throw Error('本地样章注入点必须唯一：' + needle);
    }
    for (const [needle, value] of replacements) template = template.replace(needle, value);
    return template;
  }
  function response(now = Date.now()) {
    validateDraft(draft);
    const fingerprint = crypto.createHash('sha256').update(JSON.stringify(fingerprintSource)).digest('hex');
    return {ok:true, available:true, localTest:true, checkedAt:new Date(now).toISOString(), validUntil:new Date(now + 3600000).toISOString(),
      walk:{resourceId, version:1, fingerprint, simulated:true, title:walkTitle, points:draft.points.map(point => ({
        id:point.id, title:point.title, text:point.observation, reading:point.paragraphs.join('\n\n'),
        locator:'只看艺术画稿；尚无现场观察站位',
        sources:point.sources.map(source => ({title:source.title, excerpt:source.summary + ' 核读位置：' + source.locator + '。',
          contributorName:draft.webReadDate + ' 网页资料整理；未通过人工审稿或景区审定', url:source.url}))
      }))},
      map:{objects:draft.points.map(point => ({id:'object_' + point.id, pointId:point.id, artScene:point.artScene})), assets:{}}};
  }
  async function start(port = 0, settings = {}) {
    validateDraft(draft);
    const preparedHTML = prepareHTML(settings.html === undefined ? html : settings.html);
    const server = http.createServer((req, res) => {
      res.setHeader('Cache-Control', 'no-store');res.setHeader('X-Content-Type-Options', 'nosniff');res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('Content-Security-Policy', csp);
      if (!['GET', 'HEAD'].includes(req.method)) return res.writeHead(405, {Allow:'GET, HEAD'}).end();
      // Binding to loopback is not enough against an untrusted Host header.
      const portValue = server.address().port;
      if (!['127.0.0.1:' + portValue, 'localhost:' + portValue].includes(req.headers.host)) return res.writeHead(421).end();
      let url;try {url = new URL(req.url, 'http://127.0.0.1');} catch {return res.writeHead(400).end();}
      const send = (type, content) => {res.setHeader('Content-Type', type);res.end(req.method === 'HEAD' ? undefined : content);};
      if (url.pathname === endpoint) return send('application/json;charset=utf-8', JSON.stringify(response()));
      if (url.pathname === '/' || url.pathname === '/index.html') return res.writeHead(302, {Location:pagePath + '?resourceId=' + resourceId}).end();
      if (url.pathname === pagePath) {
        if (url.searchParams.get('resourceId') !== resourceId) return res.writeHead(302, {Location:pagePath + '?resourceId=' + resourceId}).end();
        return send('text/html;charset=utf-8', preparedHTML);
      }
      if (!assets.has(url.pathname)) return res.writeHead(404).end();
      try {
        const file = fs.realpathSync(path.join(root, url.pathname));
        const relative = path.relative(root, file);
        if (relative.startsWith('..') || path.isAbsolute(relative)) return res.writeHead(404).end();
        const content = fs.readFileSync(file);
        const type = {'.css':'text/css;charset=utf-8', '.js':'text/javascript;charset=utf-8', '.webp':'image/webp', '.woff2':'font/woff2'};
        return send(type[path.extname(file)] || 'application/octet-stream', content);
      } catch {res.writeHead(404).end();}
    });
    await new Promise((resolve, reject) => {server.once('error', reject);server.listen(port, '127.0.0.1', resolve);});
    return {url:'http://127.0.0.1:' + server.address().port, close:() => new Promise(resolve => server.close(resolve))};
  }
  return {response, start};
}
module.exports = {createEditorialPreview, validateDraft};
