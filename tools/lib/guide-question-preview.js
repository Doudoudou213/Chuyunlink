'use strict';
// Local-only fixture: no CloudBase SDK, credentials, network provider or production writes.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {fixture,review,seed}=require('../test-guide-pack-import');
const {fakeDb}=require('./fake-material-db');
const {createGuideQuestionService}=require('../../cloudfunctions/appCore/domains/guide-questions');
const {config}=require('../test-guide-questions');
const root=path.resolve(__dirname,'../..');
async function start(port=0){
 const db=fakeDb(seed()),ids=['yellow-crane-tower','hubei-museum','chibi-ancient-battlefield'];
 for(const id of ids){const f=await fixture(db,id);await f.service.handle(review(f.draft),'local-test-review');}
 let calls=0;
 const service=createGuideQuestionService({db,config:{...config,pilotIds:ids,budgetCny:100,dailyRequests:1000,userDailyRequests:100},client:{async run(kind,payload){calls++;return {output:kind==='answer'?{outcome:'answer',sentences:[{text:payload.evidence[0].text,pieceIds:[payload.evidence[0].id]}]}:{answersQuestion:true,checks:payload.answer.map((s,index)=>({index,supported:true}))},usage:{prompt_tokens:100,completion_tokens:50}};}}});
 const title=id=>db.data().resources[id].title;
 const html='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>文化问答 · 本地模拟</title><link rel="stylesheet" href="/static/guide-question.css"><style>body{background:#f4eddf;color:#392e27;font-family:system-ui;margin:0;padding:clamp(20px,6vw,80px)}main{max-width:900px;margin:auto}article{padding:24px;border-bottom:1px solid #d9cbb5}h1{font-family:KaiTi,serif}aside{padding:16px;background:#e8ddc8;font-size:14px;line-height:1.8}</style><main><h1>问问这里的故事</h1><aside>本地模拟 · 不连接生产 · 不调用真实模型<br>以下使用已有资料包，在测试数据库中模拟审核发布。回答固定选取一条资料，只用于体验界面与来源检查，不代表真实智能回答。</aside>'+ids.map(id=>'<article><h2>'+title(id)+'</h2><button class="qa-entry" data-qa-resource="'+id+'" data-qa-title="'+title(id)+'">✦ 问问这里的故事</button></article>').join('')+'</main><script>window.ChuGuideQuestionIdentity=async()=>"local-preview";window.ChuGuideQuestionApi=async function(e){return (await fetch("/__qa",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(e)})).json();};</script><script src="/static/guide-question-state.js"></script><script src="/static/guide-question-transport.js"></script><script src="/static/guide-question.js"></script></html>';
 const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(req.method==='GET'&&pathname==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(html);}
  if(req.method==='GET'&&/^\/static\/guide-question(?:-state|-transport)?\.(?:js|css)$/.test(pathname)){const file=path.join(root,pathname);if(fs.existsSync(file)){res.setHeader('Content-Type',pathname.endsWith('.js')?'application/javascript':'text/css');return res.end(fs.readFileSync(file));}}
  if(req.method==='POST'&&pathname==='/__qa'){
   if(req.headers.origin&&req.headers.origin!=='http://127.0.0.1:'+server.address().port)return res.writeHead(403).end();
   try{let body='';for await(const chunk of req){body+=chunk;if(body.length>8192)throw Error('请求过长');}const e=JSON.parse(body);let result;if(e.action==='getGuideQuestionContext')result=await service.context(e);else if(e.action==='askGuideQuestion')result=await service.ask(e,'local-preview');else throw Error('不支持的本地操作');res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({...result,simulated:true}));}catch(e){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({ok:false,error:{message:e.code?'本地检查：'+e.message:'本地请求失败'}}));}
  }
  res.writeHead(404).end();
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
 return {server,db,service,ids,getCalls:()=>calls,url:'http://127.0.0.1:'+server.address().port,close:()=>new Promise(r=>server.close(r))};
}
module.exports={start};
