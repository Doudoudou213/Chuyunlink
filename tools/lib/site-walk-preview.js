'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'../..');
const walk={id:'yellow-crane-demo',resourceId:'yellow-crane-tower',title:'黄鹤楼 · 交互样板',version:1,fingerprint:'onsite-local-example-v1',simulated:true,points:[
 {id:'recognize',title:'先认清正在看的对象',text:'正式导览会在这里放一张核实过的照片，帮助你认出当前观察点。这个样板先体验到达确认，不指定真实地点。'},
 {id:'observe',title:'停下来，看看细节',text:'正式导览会用一句有来源的提示，告诉你这处有哪些值得留意的细节。这里没有编造黄鹤楼的构件、展品或方位。'},
 {id:'remember',title:'留下一点自己的发现',text:'看完后，你可以留下照片或文字。正式投稿仍需审核；本地样板只保存体验步骤，不提交真实资料。'}
].map(p=>({...p,locator:'示例观察点 · 尚未对应真实现场位置',direction:'',photo:null,sources:[{id:'demo',title:'交互流程示例',excerpt:'用于体验逐站阅读、手动确认和私人记录，不是历史资料或真实景区路线。'}]}))};
async function start(port=0){let available=true;const server=http.createServer((req,res)=>{const p=new URL(req.url,'http://local').pathname;res.setHeader('Cache-Control','no-store');
 if(req.method==='GET'&&p==='/__sitewalk'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({ok:true,available,walk:available?walk:undefined}));}
 if(req.method==='GET'&&(p==='/'||p==='/onsite.html')){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(fs.readFileSync(path.join(root,'onsite.html'),'utf8').replace('<!-- onsite-local-adapter -->','<script>window.SiteWalkAdapter={simulated:true,identity:async()=>"local-demo",get:async()=>{const r=await fetch("/__sitewalk");if(!r.ok)throw Error("本地连接失败");return r.json();}};</script>').replace('href="./guide.html"','href="/"'));}
 if(req.method==='GET'&&['/static/site-walk.css','/static/site-walk.js','/static/site-walk-engine.js','/static/visit-engine.js','/static/guide-cloud.js'].includes(p)){res.setHeader('Content-Type',p.endsWith('.css')?'text/css':'application/javascript');return res.end(fs.readFileSync(path.join(root,p)));}
 res.writeHead(404).end();});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});return {url:'http://127.0.0.1:'+server.address().port,withdraw:()=>{available=false;},restore:()=>{available=true;},changeVersion:()=>{walk.version++;walk.fingerprint+='-updated';},close:()=>new Promise(r=>server.close(r))};}
module.exports={start};
