'use strict';
// Starts only the existing isolated previews. No production configuration,
// credentials, uploaded files or browser state are read by this coordinator.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..');
const files=new Map([
  ['/suite.css',['tools/preview/exploration-trial-suite.css','text/css;charset=utf-8']],
  ['/suite.js',['tools/preview/exploration-trial-suite.js','text/javascript;charset=utf-8']],
  ['/paper.webp',['static/assets/paper-fibres-soft-v1.webp','image/webp']],
  ['/brush.woff2',['static/assets/longcang-editorial-v1.woff2','font/woff2']]
]);
function defaultFactories(){return {
  study:()=>require('./exploration-four-scenes-preview').start(0),
  question:()=>require('./exploration-journey-question-preview').start(0),
  maintenance:()=>require('./exploration-journey-preview').start(0),
  review:origin=>require('./exploration-trial-review-preview').start(0,{trustedNavigationOrigins:[origin]})
};}
function localService(service){
  let u;try{u=new URL(service?.url);}catch{throw Error('本机子服务未正确启动');}
  if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||!/^\d+$/.test(u.port)||u.username||u.password||service.url!==u.origin||typeof service.close!=='function')throw Error('本机子服务未正确启动');
  return service;
}
async function start(port=0,{factories=defaultFactories(),signal}={}){
  if(!Number.isInteger(port)||port<0||port>65535)throw Error('本机预览端口不合法');
  if(['study','question','maintenance','review'].some(key=>typeof factories?.[key]!=='function'))throw Error('本机子服务不完整');
  const owned=[],services={},realRoot=fs.realpathSync(root);let html=null,csp="default-src 'none'",closing=null,stopped=false;
  const server=http.createServer((req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    // A trusted child receives only this origin, never the full source page URL.
    res.setHeader('Referrer-Policy','origin');res.setHeader('Cross-Origin-Resource-Policy','same-origin');
    res.setHeader('Content-Security-Policy',csp);res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');
    const finish=(status,type,body)=>{req.resume();if(type)res.setHeader('Content-Type',type);res.writeHead(status);res.end(req.method==='HEAD'?undefined:body);};
    const actualPort=server.address()?.port,hosts=['127.0.0.1:'+actualPort,'localhost:'+actualPort];
    if(!hosts.includes(req.headers.host))return finish(421);
    if(req.headers.origin&&req.headers.origin!=='http://'+req.headers.host)return finish(403);
    if(req.headers['sec-fetch-site']&&!['same-origin','none'].includes(req.headers['sec-fetch-site']))return finish(403);
    if(!['GET','HEAD'].includes(req.method)){res.setHeader('Allow','GET, HEAD');return finish(405);}
    const target=String(req.url||'').split('?')[0];
    if(!/^\/[a-z0-9.\-]*$/.test(target)||['/.','/..'].includes(target))return finish(400);
    if(stopped||!html)return finish(503,'text/plain;charset=utf-8','本机服务正在准备，请稍后刷新。');
    // Keep one browser origin for the narrowly trusted child navigation. The
    // redirect is fixed, never copied from a request query or redirect parameter.
    if(req.headers.host==='localhost:'+actualPort&&(target==='/'||target==='/trial-suite.html')){
      res.setHeader('Location','http://127.0.0.1:'+actualPort+'/trial-suite.html');return finish(302);
    }
    if(target==='/'||target==='/trial-suite.html')return finish(200,'text/html;charset=utf-8',html);
    const entry=files.get(target);if(!entry)return finish(404);
    try{
      const file=fs.realpathSync(path.join(realRoot,entry[0])),relative=path.relative(realRoot,file);
      if(relative.startsWith('..')||path.isAbsolute(relative))return finish(404);
      return finish(200,entry[1],fs.readFileSync(file));
    }catch{return finish(404);}
  });
  server.requestTimeout=10000;server.headersTimeout=10000;
  const close=()=>{
    if(closing)return closing;stopped=true;html=null;signal?.removeEventListener('abort',onAbort);signal?.removeEventListener('abort',onReadyAbort);
    closing=(async()=>{
      const results=await Promise.allSettled(owned.map(service=>Promise.resolve().then(()=>service.close())));
      if(server.listening)await new Promise((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeIdleConnections?.();});
      if(results.some(result=>result.status==='rejected'))throw Error('部分本机服务未完成关闭，请检查启动窗口。');
    })();return closing;
  };
  const onAbort=()=>{stopped=true;};
  const onReadyAbort=()=>{close().catch(()=>{});};
  signal?.addEventListener('abort',onAbort,{once:true});
  try{
    if(signal?.aborted)throw Error('本机启动已取消');
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
    const url='http://127.0.0.1:'+server.address().port;
    for(const key of ['study','question','maintenance','review']){
      if(stopped||signal?.aborted)throw Error('本机启动已取消');
      const service=await factories[key](url);if(service&&typeof service.close==='function')owned.push(service);
      services[key]=localService(service);
      if(stopped||signal?.aborted)throw Error('本机启动已取消');
    }
    const links={study:services.study.url+'/four-scenes.html?resourceId=hhl-four-scenes-study',
      question:services.question.url+'/explore-journey.html?resourceId=r',admin:services.maintenance.url+'/explore-admin.html',
      scenario:services.maintenance.url+'/preview-control.html',review:services.review.url+'/trial-review.html'};
    const json=JSON.stringify(links).replace(/[<>&\u2028\u2029]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
    const source=fs.readFileSync(path.join(realRoot,'tools/preview/exploration-trial-suite.html'),'utf8');
    if(source.split('<!-- suite-links -->').length!==2)throw Error('本机入口注入点不正确');
    html=source.replace('<!-- suite-links -->','<script id="suite-links" type="application/json">'+json+'</script>');
    const hash=crypto.createHash('sha256').update(json).digest('base64');
    csp=["default-src 'none'","script-src 'self' 'sha256-"+hash+"'","style-src 'self'","img-src 'self'","font-src 'self'",
      "connect-src 'none'","object-src 'none'","base-uri 'none'","form-action 'none'","frame-src 'none'","frame-ancestors 'none'","worker-src 'none'","media-src 'none'"].join('; ');
    signal?.removeEventListener('abort',onAbort);
    signal?.addEventListener('abort',onReadyAbort,{once:true});
    return {url,links:Object.freeze(links),close};
  }catch(error){await close();throw error;}
}
module.exports={start};
if(require.main===module){
  const controller=new AbortController();let suite,closing=false;
  const stop=async()=>{if(closing)return;closing=true;controller.abort();try{await suite?.close();}catch(error){console.error(error.message);process.exitCode=1;}};
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  start(process.argv[2]===undefined?4224:Number(process.argv[2]),{signal:controller.signal}).then(value=>{
    suite=value;if(controller.signal.aborted)return stop();console.log(value.url+'/trial-suite.html');
  }).catch(error=>{if(!controller.signal.aborted){console.error(error.message);process.exitCode=1;}});
}
