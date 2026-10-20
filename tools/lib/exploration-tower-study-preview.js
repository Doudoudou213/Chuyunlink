'use strict';
// Read-only local editorial specimen. No database, publish call, credentials or
// simulated human reviewer. Never include this tool or its draft in deployment.
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), crypto = require('node:crypto');
const root = path.resolve(__dirname,'../..');
const draft = require('../fixtures/tower-study.json');
const resourceId = 'hhl-tower-study';
const html = fs.readFileSync(path.join(root,'explore-journey.html'),'utf8');
const assets = new Set([...html.matchAll(/(?:src|href)="(static\/[^"?#]+)"/g)].map(m => '/' + m[1]));
assets.delete('/static/guide-cloud.js');
for (const name of ['paper-fibres-soft-v1.webp','exploration-motion/hhl-full-park-v2.webp','longcang-editorial-v1.woff2']) assets.add('/static/assets/' + name);
const adapterCode = 'window.ExplorationAdapter={call:async function(e){if(e.action!=="getSiteExploration"||e.resourceId!=="'+resourceId+'")throw Error("只读样章不支持业务操作");const r=await fetch("/__tower-study",{cache:"no-store"});if(!r.ok)throw Error("样章暂不可读");return r.json();}};';
const csp = ["default-src 'self'", "connect-src 'self'",
  "script-src 'self' 'sha256-"+crypto.createHash('sha256').update(adapterCode).digest('base64')+"'",
  "style-src 'self' 'unsafe-inline'", "img-src 'self' data:", "font-src 'self'", "media-src 'self'",
  "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-src 'none'", "frame-ancestors 'none'", "worker-src 'none'"
].join('; ');
function prepareHTML(template) {
  const notice = '<aside class="study-preview-notice">主楼讲解审阅样章 · 未审稿，非现场导览<br><span>仅使用现有画稿；网页核读于2026-10-19，不代表景区认可。录音与现场核对待补。</span><a href="http://127.0.0.1:4218/explore-journey.html?resourceId=r">四景流程预览 ↗</a></aside>';
  const style = '<style>.study-preview-notice{max-width:1440px;margin:auto;padding:12px 28px;color:var(--gold);font:12px/1.8 system-ui,sans-serif}.study-preview-notice span{color:var(--paper);opacity:.85}.study-preview-notice a{color:inherit;display:inline-flex;align-items:center;min-height:44px;margin-left:16px}.journey-leaf-content .study-draft-note{font:11px/1.8 system-ui,sans-serif;color:var(--rust);margin:0 0 14px}#explore-tools,#explore-tools+p,#previous,#next{display:none!important}</style>';
  const replacements = [
    ['</head>',style+'</head>'],
    ['<!-- journey-local-adapter -->','<script>'+adapterCode+'</script>'],
    ['<script defer src="static/guide-cloud.js"></script>',''],
    ['<body class="scenic-journey">','<body class="scenic-journey">'+notice],
    ['aria-label="已审内容阅读"','aria-label="待审样章阅读"'],
    ['aria-label="按已发布顺序阅读"','aria-label="按待审样章顺序阅读"'],
    ['正在核对当前公开版本','正在读取本地待审样章'],
    ['正在核对当前公开资料。','正在读取本地待审研究稿，不代表人工审核。'],
    ['请启用 JavaScript 读取当前公开资料。本页不提供离线旧讲解。','请启用 JavaScript 阅读本地待审样章。本页不是正式导览。'],
    ['<p id="reading-copy">','<p class="study-draft-note">讲解研究稿 · 尚未通过人工审稿与现场核对</p><p id="reading-copy">']
  ];
  // Validate every boundary before changing anything or opening a listening socket.
  // Template drift must never silently remove either the local adapter or notices.
  for (const [needle] of replacements) {
    if (typeof template !== 'string' || template.split(needle).length !== 2) throw Error('本地样章注入点必须唯一：'+needle);
  }
  for (const [needle,value] of replacements) template = template.replace(needle,value);
  return template;
}
function response(now = Date.now()) {
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify(draft)).digest('hex');
  return {ok:true,available:true,localTest:true,checkedAt:new Date(now).toISOString(),validUntil:new Date(now+3600000).toISOString(),
    walk:{resourceId,version:1,fingerprint,simulated:true,title:'黄鹤楼主楼 · '+draft.title+'（待审样章）',points:[{
      id:'tower',title:'黄鹤楼主楼',text:draft.observation,reading:draft.paragraphs.join('\n\n'),locator:'只看艺术画稿；尚无现场观察站位',
      sources:draft.sources.map(s=>({title:s.title,excerpt:s.summary+' 核读位置：'+s.locator+'。',contributorName:'2026-10-19 网页资料整理；未通过人工审稿或景区审定',url:s.url}))
    }]},map:{objects:[{id:'object_tower',pointId:'tower',artScene:'tower'}],assets:{}}};
}
async function start(port = 0, options = {}) {
  if (draft.status !== 'editorial-draft' || draft.publishAllowed !== false) throw Error('本地样章必须保持待审且禁止发布');
  const preparedHTML = prepareHTML(options.html === undefined ? html : options.html);
  const server = http.createServer((req,res) => {
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',csp);
    const u = new URL(req.url,'http://local');
    if (!['GET','HEAD'].includes(req.method)) return res.writeHead(405).end();
    if (u.pathname === '/__tower-study') {res.setHeader('Content-Type','application/json;charset=utf-8');return res.end(JSON.stringify(response()));}
    if (u.pathname === '/' || u.pathname === '/index.html') return res.writeHead(302,{Location:'/tower-study.html?resourceId='+resourceId}).end();
    if (u.pathname === '/tower-study.html') {
      if(u.searchParams.get('resourceId') !== resourceId) return res.writeHead(302,{Location:'/tower-study.html?resourceId='+resourceId}).end();
      res.setHeader('Content-Type','text/html;charset=utf-8');
      return res.end(preparedHTML);
    }
    if (!assets.has(u.pathname)) return res.writeHead(404).end();
    try {
      const file = path.join(root,u.pathname),content = fs.readFileSync(file);
      const type = {'.css':'text/css;charset=utf-8','.js':'text/javascript;charset=utf-8','.webp':'image/webp','.woff2':'font/woff2'};
      res.setHeader('Content-Type',type[path.extname(file)]||'application/octet-stream');res.end(content);
    } catch {res.writeHead(404).end();}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  return {url:'http://127.0.0.1:'+server.address().port,close:()=>new Promise(resolve=>server.close(resolve))};
}
module.exports = {response,start};
if(require.main === module) start(Number(process.argv[2])||4220).then(s=>console.log(s.url+'/tower-study.html?resourceId='+resourceId)).catch(error=>{console.error(error);process.exitCode=1;});
