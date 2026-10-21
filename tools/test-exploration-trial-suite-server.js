'use strict';
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {start}=require('./lib/exploration-trial-suite-preview');
let checks=0;
function check(value,label){assert(value,label);checks++;}
function request(base,target='/',options={}){
  const u=new URL(base);
  return new Promise((resolve,reject)=>{
    const req=http.request({hostname:'127.0.0.1',port:u.port,path:target,method:options.method||'GET',headers:options.headers||{},timeout:10000},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks).toString('utf8')}));
    });req.on('error',reject);req.on('timeout',()=>req.destroy(Error('本机检查超时')));req.end();
  });
}
async function closed(url){await assert.rejects(request(url),error=>['ECONNREFUSED','ECONNRESET'].includes(error.code));checks++;}
async function disposableService(){
  const server=http.createServer((req,res)=>res.end('local lifecycle fixture'));
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {url:'http://127.0.0.1:'+server.address().port,close:()=>new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()))};
}
(async()=>{
  for(const port of [-1,65536,NaN,'4224',0.5]){await assert.rejects(start(port),/端口/);checks++;}
  const suite=await start();
  try{
    for(const route of ['/','/trial-suite.html','/suite.css','/suite.js','/paper.webp','/brush.woff2']){
      const get=await request(suite.url,route);check(get.status===200,'exact allowed resource '+route);
      check(get.headers['cache-control']==='no-store','no storage header '+route);
      const head=await request(suite.url,route,{method:'HEAD'});check(head.status===200&&head.body==='','HEAD body omitted '+route);
    }
    const page=await request(suite.url,'/trial-suite.html?preview=local');
    const csp=page.headers['content-security-policy'];
    check(csp.includes("connect-src 'none'")&&csp.includes("default-src 'none'"),'no hub network service');
    check(csp.includes("frame-ancestors 'none'")&&csp.includes('sha256-'),'framing blocked, inert manifest bound');
    check(!csp.includes('unsafe-inline')&&!csp.includes('unsafe-eval'),'no unsafe scripts');
    check(page.headers['referrer-policy']==='origin','child receives only hub origin');
    const manifest=JSON.parse(page.body.match(/<script id="suite-links" type="application\/json">([^<]+)<\/script>/)[1]);
    check(JSON.stringify(manifest)===JSON.stringify(suite.links),'HTML contains only known local links');
    check(Object.keys(suite.links).length===5,'four flows plus maintenance control');
    for(const [key,url]of Object.entries(suite.links)){
      const u=new URL(url);check(u.hostname==='127.0.0.1'&&u.protocol==='http:','loopback child '+key);
      check((await request(u.origin,u.pathname+u.search)).status===200,'child page ready '+key);
    }
    const origins=new Set(Object.values(suite.links).map(url=>new URL(url).origin));
    check(origins.size===4,'four owned isolated services');
    const nav={'Sec-Fetch-Site':'same-site','Sec-Fetch-Mode':'navigate','Sec-Fetch-Dest':'document',Referer:suite.url+'/'};
    const review=new URL(suite.links.review);
    check((await request(review.origin,review.pathname,{headers:nav})).status===200,'trusted hub can navigate to review');
    check((await request(review.origin,review.pathname,{headers:{...nav,Referer:'http://127.0.0.1:65534/'}})).status===403,'unknown local origin cannot navigate to review');
    for(const method of ['POST','PUT','DELETE','OPTIONS'])check((await request(suite.url,'/',{method})).status===405,'hub method blocked '+method);
    for(const target of ['/package.json','/.env','/review-data.js','/tools/fixtures/four-scenes-study.json','/../package.json','/%2e%2e/package.json','//suite.js','/suite.js/','/suite\\.js']){
      check([400,404].includes((await request(suite.url,target)).status),'only explicit hub resources '+target);
    }
    check((await request(suite.url,'/',{headers:{Host:'evil.example'}})).status===421,'unknown Host denied');
    for(const target of ['/','/trial-suite.html','/trial-suite.html?next=https://evil.example']){
      for(const method of ['GET','HEAD']){
        const r=await request(suite.url,target,{method,headers:{Host:'localhost:'+new URL(suite.url).port}});
        check(r.status===302&&r.headers.location===suite.url+'/trial-suite.html'&&!r.body,'localhost document canonicalizes without query reflection');
      }
    }
    for(const target of ['//evil.example','/../trial-suite.html','/trial-suite.html/'])
      check((await request(suite.url,target,{headers:{Host:'localhost:'+new URL(suite.url).port}})).status===400,'localhost redirect cannot reflect an arbitrary path');
    check((await request(suite.url,'/',{headers:{Origin:'https://evil.example'}})).status===403,'foreign Origin denied');
    for(const site of ['cross-site','same-site'])check((await request(suite.url,'/',{headers:{'Sec-Fetch-Site':site}})).status===403,'foreign fetch metadata denied '+site);
    const build=fs.readFileSync(path.join(__dirname,'validate-cloudbase-build.js'),'utf8');
    const deploy=fs.readFileSync(path.join(__dirname,'deploy-cloudbase.ps1'),'utf8');
    check(!build.includes('trial-suite')&&!deploy.includes('trial-suite'),'suite not in formal build/deploy manifest');
  }finally{await suite.close();}
  await suite.close();checks++;
  for(const origin of new Set([suite.url,...Object.values(suite.links).map(url=>new URL(url).origin)]))await closed(origin);
  // Injection is Node-only and tests lifecycle, not browser-selected modules or URLs.
  let failedHub,closedChildren=0;
  const fake=origin=>{failedHub=origin;return {url:'http://127.0.0.1:65533',close:async()=>{closedChildren++;}};};
  await assert.rejects(start(0,{factories:{study:fake,question:fake,maintenance:async()=>{throw Error('expected startup failure');},review:fake}}),/expected startup failure/);checks++;
  check(closedChildren===2,'already-started children closed on later failure');await closed(failedHub);
  const actualStarted=[];
  const actualFactory=async origin=>{failedHub=origin;const child=await disposableService();actualStarted.push(child.url);return child;};
  await assert.rejects(start(0,{factories:{study:actualFactory,question:actualFactory,maintenance:async()=>{throw Error('real fixture failure');},review:actualFactory}}),/real fixture failure/);checks++;
  for(const origin of [...actualStarted,failedHub])await closed(origin);
  const occupied=await disposableService();let reusedChild=false;
  try{
    const mustNotStart=()=>{reusedChild=true;return fake(occupied.url);};
    await assert.rejects(start(Number(new URL(occupied.url).port),{factories:{study:mustNotStart,question:mustNotStart,maintenance:mustNotStart,review:mustNotStart}}),error=>error.code==='EADDRINUSE');checks++;
    check(!reusedChild,'occupied port fails before any children start');
    check((await request(occupied.url)).status===200,'existing service neither reused nor stopped');
  }finally{await occupied.close();}
  await closed(occupied.url);
  closedChildren=0;
  await assert.rejects(start(0,{factories:{study:origin=>({...fake(origin),url:'https://remote.example'}),question:fake,maintenance:fake,review:fake}}),/本机子服务/);checks++;
  check(closedChildren===1,'invalid returned child still closed');await closed(failedHub);
  const controller=new AbortController();let startedResolve,release;
  const started=new Promise(resolve=>{startedResolve=resolve;});
  const pending=start(0,{signal:controller.signal,factories:{study:async origin=>{failedHub=origin;startedResolve();await new Promise(resolve=>{release=resolve;});return fake(origin);},question:fake,maintenance:fake,review:fake}});
  await started;check((await request(failedHub)).status===503,'hub does not publish incomplete links');
  const before=closedChildren;controller.abort();release();await assert.rejects(pending,/取消/);checks++;
  check(closedChildren===before+1,'late child closed after startup cancellation');await closed(failedHub);
  const liveController=new AbortController();const live=await start(0,{signal:liveController.signal});liveController.abort();await live.close();await closed(live.url);
  console.log('Trial suite server: '+checks+' checks passed; local children only, no cloud or production mutations.');
})().catch(error=>{console.error(error);process.exitCode=1;});
