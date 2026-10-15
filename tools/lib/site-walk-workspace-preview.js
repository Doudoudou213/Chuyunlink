'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'../..');
async function start(port=0){
 const fixture=await require('../test-site-walk-admin').setup();
 const sessions=require('../../cloudfunctions/appCore/domains/site-walk-sessions').createSiteWalkSessionService({db:fixture.db});
 const allowed=['exploration-admin-paper.js','exploration-admin-paper.css','assets/paper-fibres-soft-v1.webp','exploration-admin-simple.css','exploration-readiness.css','exploration-readiness.js','exploration-readiness-admin.js','explore-assets-admin.js','explore-admin.js','site-walk-admin.css','site-walk-admin.js','site-walk.css','site-walk.js','site-walk-engine.js','visit-engine.js','guide-cloud.js','assets/longcang-editorial-v1.woff2'];
 const server=http.createServer(async(req,res)=>{res.setHeader('Cache-Control','no-store');const p=new URL(req.url,'http://local').pathname;
  try {
   if(req.method==='POST'&&['/__admin','/__session'].includes(p)){
    let body='';for await(const b of req){body+=b;if(body.length>40000)throw Error('请求过长');}const e=JSON.parse(body);
    const result=p==='/__admin'?(e.action==='whoami'?{ok:true,isAdmin:true}:await fixture.call(e)):await sessions.handle('local-preview-user',e);
    res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(result));
   }
   if(p==='/__walk'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(await fixture.publicService.get({resourceId:'r'})));}
   if(p==='/'||p==='/site-walk-admin.html'||p==='/explore-admin.html'||p==='/onsite.html'){
    const name=p==='/onsite.html'?'onsite.html':p==='/explore-admin.html'?'explore-admin.html':'site-walk-admin.html';let html=fs.readFileSync(path.join(root,name),'utf8');
    const call='async function call(url,data){const r=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});const v=await r.json();if(!v.ok)throw Error(v.error.message);return v;}';
    const adapter=name==='onsite.html'?'<script>'+call+'window.SiteWalkAdapter={simulated:true,identity:async()=>"local-preview-user",get:async()=> (await fetch("/__walk")).json(),call:data=>call("/__session",data)};</script>':'<script>'+call+'window.SiteWalkAdminAdapter={call:data=>call("/__admin",data)};</script>';
    html=html.replace(/<!-- (?:site-walk-admin-adapter|onsite-local-adapter) -->/,adapter).replace(/<body([^>]*)>/,'<body$1><p style="text-align:center">本地流程模拟 · 不是真实现场路线 · 不连接生产</p>');res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(html);
   }
   if(p.startsWith('/static/')&&allowed.includes(p.slice(8))){res.setHeader('Content-Type',p.endsWith('.css')?'text/css':p.endsWith('.woff2')?'font/woff2':p.endsWith('.webp')?'image/webp':'application/javascript');return res.end(fs.readFileSync(path.join(root,p)));}
   res.writeHead(404).end();
  }catch(e){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:false,error:{message:e.message}}));}
 });await new Promise((ok,no)=>{server.once('error',no);server.listen(port,'127.0.0.1',ok);});
 return {...fixture,url:'http://127.0.0.1:'+server.address().port,close:()=>new Promise(r=>server.close(r))};
}
module.exports={start};
