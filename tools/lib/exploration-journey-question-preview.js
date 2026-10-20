'use strict';
// Isolated QA contract preview. Every database and provider response below is
// local test data. Never reads service credentials or creates a provider client.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), crypto = require('node:crypto');
const {fixture: journeyFixture} = require('./exploration-journey-preview');
const E = require('../../cloudfunctions/appCore/lib/exploration-core');
const {createExplorationQuestionService} = require('../../cloudfunctions/appCore/domains/exploration-questions');
const {configFromEnv} = require('../../cloudfunctions/appCore/lib/guide-question-client');
const root = path.resolve(__dirname, '../..');
const endpoint = '/__question-local', resourceId = 'r', maximumBody = 16384;
const localFixtures = new WeakSet();
const actions = new Set(['getSiteExploration', 'getSiteExplorationQuestionContext', 'askSiteExploration']);
const scriptJSON = value => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const fail = (status, code, message) => {throw Object.assign(Error(message), {status, code});};

async function fixture() {
  const f = await journeyFixture();
  // This is a newly constructed in-memory submission, not an existing user's
  // consent. The fixture explicitly exercises the service's versioned gate.
  await f.db.collection('submissions').doc('s').update({
    aiAnalysisConsent:true, aiConsentVersion:'ai-analysis-consent-v1',
    aiConsentScope:'approved_public_submission_text'
  });
  const calls = {answer:0, verify:0};
  const usage = {prompt_tokens:100, completion_tokens:30, total_tokens:130};
  const client = {
    async run(kind, payload) {
      if (!['answer', 'verify'].includes(kind)) throw Error('未知本地固定响应类型');
      calls[kind]++;
      if (kind === 'answer') {
        // A small, explicit sample set; unknown questions are NOT answered by
        // copying an arbitrary paragraph or by connecting to a real model.
        const examples = new Set([
          '画稿里有什么？', '画稿里有什么?',
          '这一处先看哪里？', '这一处先看哪里?'
        ]);
        const piece = examples.has(payload.question) && payload.evidence.find(item => item.id.startsWith('observation_'));
        return {output:piece ? {outcome:'answer', sentences:[{text:piece.text, pieceIds:[piece.id]}]} :
          {outcome:'insufficient', sentences:[]}, usage};
      }
      // Even the local verifier checks exact provided evidence, rather than
      // affirming arbitrary text. The real service performs its normal checks.
      const checks = payload.answer.map((sentence, index) => ({
        index, supported:sentence.pieceIds.length > 0 && sentence.pieceIds.every(id =>
          payload.evidence.some(piece => piece.id === id && piece.text === sentence.text))
      }));
      return {output:{answersQuestion:checks.length > 0 && checks.every(check => check.supported), checks}, usage};
    }
  };
  // 'real' exercises the existing two-pass/budget contract against fakeDb.
  // Empty-environment defaults + an injected fixed client make this incapable
  // of constructing the actual provider transport or using machine secrets.
  const config = {...configFromEnv({}), mode:'real', model:'local-fixed-response',
    apiKey:'local-fixed-no-provider', pilotIds:[resourceId], budgetId:'local-question-preview',
    budgetCny:100, inputPrice:1, outputPrice:1, dailyRequests:1000, userDailyRequests:1000};
  Object.assign(f, {client, config, calls});
  f.questions = createExplorationQuestionService({db:f.db, config, client});
  localFixtures.add(f);
  return f;
}

function validateEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event) || !actions.has(event.action))
    fail(400, 'LOCAL_ACTION', '此本机样例不支持该操作');
  if (event.resourceId !== resourceId) fail(400, 'LOCAL_RESOURCE', '请重新打开本机测试景点');
  const allowed = ['action', 'resourceId', ...(event.action === 'getSiteExploration' ? [] : ['objectId']),
    ...(event.action === 'askSiteExploration' ? ['question', 'requestId', 'history'] : [])];
  if (Object.keys(event).some(key => !allowed.includes(key))) fail(400, 'LOCAL_INPUT', '本机请求包含不支持的字段');
  return event;
}

async function body(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || ''))
    fail(415, 'LOCAL_TYPE', '本机请求必须使用 JSON');
  const declared = req.headers['content-length'];
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maximumBody)) {
    req.resume();fail(413, 'LOCAL_SIZE', '本机请求过长');
  }
  let size = 0, chunks = [], tooLarge = false;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maximumBody) {tooLarge = true;chunks = [];}
    else if (!tooLarge) chunks.push(chunk);
  }
  if (tooLarge) fail(413, 'LOCAL_SIZE', '本机请求过长');
  try {return JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  catch {fail(400, 'LOCAL_JSON', '本机请求格式不正确');}
}

async function start(port = 4222, settings = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('本机预览端口不合法');
  const f = settings.fixture === undefined ? await fixture() : settings.fixture;
  if (!localFixtures.has(f)) throw Error('只能使用此预览创建的本机假数据库');
  const token = crypto.randomBytes(24).toString('hex');
  const adapterCode = `(function(){"use strict";if(location.protocol!=="http:"||!["127.0.0.1","localhost"].includes(location.hostname))throw Error("仅允许本机预览");const token=${scriptJSON(token)},actions=${scriptJSON([...actions])};window.ExplorationAdapter={identity:async function(){return "local-reader";},call:async function(e){if(!e||!actions.includes(e.action)||e.resourceId!=="r")throw Error("此本机样例不支持该操作");const r=await fetch("${endpoint}",{method:"POST",cache:"no-store",headers:{"Content-Type":"application/json","x-preview-token":token},body:JSON.stringify(e)});const v=await r.json();if(!r.ok||v.ok!==true){const error=Error(v.error?.message||"本机读取失败");error.code=v.error?.code||"LOCAL_UNAVAILABLE";throw error;}return v;}};})();`;
  const csp = ["default-src 'self'", "connect-src 'self'",
    "script-src 'self' 'sha256-" + crypto.createHash('sha256').update(adapterCode).digest('base64') + "'",
    "style-src 'self' 'unsafe-inline'", "img-src 'self' data:", "font-src 'self'",
    "media-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'none'",
    "frame-src 'none'", "frame-ancestors 'none'", "worker-src 'none'"
  ].join('; ');
  let html = settings.html === undefined ? fs.readFileSync(path.join(root, 'explore-journey.html'), 'utf8') : settings.html;
  const replacements = [
    ['<!-- journey-local-adapter -->', '<script>' + adapterCode + '</script>'],
    ['<script defer src="static/guide-cloud.js"></script>', ''],
    ['</head>', '<style>.question-preview-notice{max-width:1440px;margin:auto;padding:12px 28px;color:var(--gold);font:12px/1.8 system-ui,sans-serif}.question-preview-notice span{color:var(--paper);opacity:.85}#explore-tools,#explore-tools+p{display:none!important}</style></head>'],
    ['<body class="scenic-journey">', '<body class="scenic-journey"><aside class="question-preview-notice">本机固定响应样例 · 不连接模型、不产生费用、不上传问题<br><span>画稿、审核和来源均为流程测试材料，不代表景区审定；请勿输入个人隐私。仅“画稿里有什么？”和“这一处先看哪里？”演示有依据回答，其余问题保留材料不足提示。</span></aside>'],
    ['aria-label="已审内容阅读"', 'aria-label="本机测试材料阅读"'],
    ['aria-label="按已发布顺序阅读"', 'aria-label="按本机测试顺序阅读"'],
    ['正在核对当前公开版本', '正在核对本机测试版本'],
    ['正在核对当前公开资料。', '正在核对本机测试材料，不连接线上。']
  ];
  for (const [needle] of replacements)
    if (typeof html !== 'string' || html.split(needle).length !== 2) throw Error('本机问答注入点必须唯一：' + needle);
  for (const [needle, replacement] of replacements) html = html.replace(needle, replacement);
  // Only exact visitor dependencies are served. There is no directory/static
  // prefix fallback and no administrative, cloud, source or configuration path.
  const assets = new Set([...html.matchAll(/(?:src|href)="(static\/[^"?#]+)"/g)].map(match => '/' + match[1]));
  assets.delete('/static/guide-cloud.js');
  for (const name of ['paper-fibres-soft-v1.webp', 'longcang-editorial-v1.woff2', 'exploration-motion/hhl-full-park-v2.webp'])
    assets.add('/static/assets/' + name);
  const type = {'.css':'text/css;charset=utf-8', '.js':'text/javascript;charset=utf-8', '.webp':'image/webp', '.woff2':'font/woff2'};
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');res.setHeader('Content-Security-Policy', csp);
    const portValue = server.address().port, hosts = ['127.0.0.1:' + portValue, 'localhost:' + portValue];
    const send = (status, contentType, content) => {res.writeHead(status, {'Content-Type':contentType});res.end(req.method === 'HEAD' ? undefined : content);};
    try {
      if (!hosts.includes(req.headers.host)) return res.writeHead(421).end();
      const rawPath = decodeURIComponent(String(req.url || '').split('?')[0]);
      if (!rawPath.startsWith('/') || rawPath.includes('\\') || rawPath.includes('\0') || rawPath.split('/').some(part => part === '.' || part === '..'))
        return res.writeHead(400).end();
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname === endpoint) {
        if (req.method !== 'POST') return res.writeHead(405, {Allow:'POST'}).end();
        if (req.headers['x-preview-token'] !== token) {req.resume();fail(403, 'LOCAL_TOKEN', '本机测试请求无效');}
        if (req.headers.origin && !hosts.map(host => 'http://' + host).includes(req.headers.origin)) {
          req.resume();fail(403, 'LOCAL_ORIGIN', '仅接受本机页面请求');
        }
        const event = validateEvent(await body(req));
        let result;
        if (event.action === 'getSiteExploration') result = {
          ...await E.get(f.db, resourceId), localTest:true,
          journeyQuestions:{schemaVersion:1, mode:'local-fixed', resourceId}
        };
        else if (event.action === 'getSiteExplorationQuestionContext') result = {...await f.questions.context(event), simulated:true};
        else result = {...await f.questions.ask(event, 'local-reader'), simulated:true};
        return send(200, 'application/json;charset=utf-8', JSON.stringify(result));
      }
      if (!['GET', 'HEAD'].includes(req.method)) return res.writeHead(405, {Allow:'GET, HEAD'}).end();
      if (url.pathname === '/' || url.pathname === '/index.html')
        return res.writeHead(302, {Location:'/explore-journey.html?resourceId=r'}).end();
      if (url.pathname === '/explore-journey.html') {
        if (url.searchParams.get('resourceId') !== resourceId)
          return res.writeHead(302, {Location:'/explore-journey.html?resourceId=r'}).end();
        return send(200, 'text/html;charset=utf-8', html);
      }
      if (!assets.has(url.pathname)) return res.writeHead(404).end();
      let file;
      try {file = fs.realpathSync(path.join(root, url.pathname));} catch {return res.writeHead(404).end();}
      const relative = path.relative(root, file);
      if (relative.startsWith('..') || path.isAbsolute(relative)) return res.writeHead(404).end();
      return send(200, type[path.extname(file)] || 'application/octet-stream', fs.readFileSync(file));
    } catch (error) {
      if (res.headersSent) return res.end();
      const known = ['QA_SOURCE', 'QA_INPUT', 'QA_LIMIT', 'QA_BUSY', 'QA_DUPLICATE', 'QA_REQUEST_CHANGED',
        'UNAUTHENTICATED', 'STABLE_ACCOUNT_REQUIRED', 'WALK_INPUT', 'WALK_SOURCE'];
      const publicError = error.code?.startsWith('LOCAL_') || known.includes(error.code);
      return send(error.status || 400, 'application/json;charset=utf-8', JSON.stringify({
        ok:false, error:{code:publicError ? error.code : 'LOCAL_UNAVAILABLE',
          message:publicError ? error.message : '本机样例暂不可用，请重新读取'}
      }));
    }
  });
  server.requestTimeout = 10000;server.headersTimeout = 10000;
  await new Promise((resolve, reject) => {server.once('error', reject);server.listen(port, '127.0.0.1', resolve);});
  return {url:'http://127.0.0.1:' + server.address().port, fixture:f,
    close:() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))};
}
module.exports = {fixture, start};
if (require.main === module) start(process.argv[2] === undefined ? 4222 : Number(process.argv[2]))
  .then(server => console.log(server.url + '/explore-journey.html?resourceId=r'))
  .catch(error => {console.error(error.message);process.exitCode = 1;});
