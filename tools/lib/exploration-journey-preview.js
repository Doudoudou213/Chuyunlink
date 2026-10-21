'use strict';
// Local fake database only. Uses actual review/public projection modules, never cloud credentials.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'../..');
const E=require('../../cloudfunctions/appCore/lib/exploration-core');
async function fixture(){
  const {seed}=require('../test-guide-evidence'),{fakeDb}=require('./fake-material-db');
  const value=seed(),fact='画稿展示了楼阁、水面和植物。';
  value.resources.r.title='黄鹤楼读画 · 本地流程样例';
  value.story_chains.story.chapters[0].body=fact;value.story_claims.c.claimText=fact;
  value.story_evidence_links.l.evidenceSummary=fact;value.submissions.s.title='本地画稿观察测试材料';
  const db=fakeDb(value);
  const guides=require('../../cloudfunctions/adminSubmissions/domains/guide-fragments').createGuideFragmentService({db});
  const a=require('../../cloudfunctions/adminSubmissions/domains/site-walks').createSiteWalkAdminService({db});
  const call=e=>a.handle(e,'local-reviewer');
  for(const [scene,title,observation]of [
    ['tower','黄鹤楼','先留意画稿中层层展开的屋檐，沿着轮廓慢慢看。'],
    ['copper','古铜顶','先看画稿中这件旧物的整体轮廓，再看它与周围楼阁的比例。'],
    ['baiyun','白云阁','留意画稿中这一处楼阁的层檐，以及植物之间的留白。'],
    ['pond','鹅池','沿着画稿的水面看一圈，留意水边的植物与楼阁。']
  ]){
    const saved=await guides.handle({action:'saveGuideFragment',draft:{resourceId:'r',storyId:'story',storyVersion:1,claimIds:['c'],
      title:title+' · 画稿观察',text:'这段文字只用于本地流程演示。'+fact+'请对照画中的轮廓阅读，不作为历史解说或现场指引。',
      observations:[{text:observation,locator:'本地画稿示意位置，不用于实地行走',locationEvidence:'l'}]}},'local-reviewer');
    await guides.handle({action:'publishGuideFragment',fragmentId:saved.draft.id,revision:saved.draft.revision,humanReviewed:true,reviewNote:'固定本地测试审核，不代表真实核对',
      groundingResolution:{fingerprint:saved.draft.grounding.fingerprint,reasons:Object.fromEntries(saved.draft.grounding.issues.map(i=>[i.id,'仅在假数据库中模拟人工核对，不是正式资料的审核依据']))}},'local-reviewer');
  }
  const options=(await call({action:'getSiteWalkDraft',resourceId:'r'})).options;
  const scenes=['tower','copper','baiyun','pond'],titles=['黄鹤楼','古铜顶','白云阁','鹅池'];
  const points=scenes.map((scene,i)=>({id:scene,...options.find(o=>o.title.startsWith(titles[i])),title:titles[i],accessNote:'本地固定核对，不代表现场通行'}));
  const draft={title:'黄鹤楼 · 一卷慢读',points,exploration:{schemaVersion:1,coordinateType:'schematic',
    objects:points.map((p,i)=>({id:'object_'+p.id,pointId:p.id,symbol:'tower',x:200+i*180,y:400,artScene:scenes[i]})),edges:[]}};
  async function publish(next){
    const state=await call({action:'getSiteWalkDraft',resourceId:'r'});
    await call({action:'saveSiteWalkDraft',resourceId:'r',revision:state.root?.revision||0,requestId:crypto.randomUUID(),draft:next});
    const p=await call({action:'previewSiteWalk',resourceId:'r'});
    return call({action:'publishSiteWalk',resourceId:'r',revision:p.revision,requestId:crypto.randomUUID(),previewFingerprint:p.previewFingerprint,
      review:{onsiteConfirmed:true,note:'固定本地测试核对，非真实景区路线',checkedAt:new Date(Date.now()-1000).toISOString(),validUntil:new Date(Date.now()+3600000).toISOString()}});
  }
  await publish(draft);
  return {db,call,draft,publish};
}
async function start(port=0){
  let f=await fixture(),offline=false;
  const extra=new Set(['explore-journey.html','explore-admin.html','static/exploration-journey-live.css','static/exploration-journey-live.js','static/exploration-journey-audio.js','static/exploration-journey-content.js',
    'static/exploration-readiness.js','static/exploration-readiness-admin.js','static/exploration-readiness.css','static/exploration-admin-simple.css',
    'static/exploration-admin-paper.js','static/exploration-admin-paper.css','static/assets/paper-fibres-soft-v1.webp',
    'static/exploration-journey-leaves.js','static/exploration-journey-leaves.css',
    'static/exploration-leaf-motion.js','static/exploration-journey-theme.css','static/exploration-journey-navigation.js','static/assets/longcang-journey-v1.woff2',
    'static/exploration-journey-study.js','static/exploration-journey-study.css',
    'static/exploration-journey-study-scenes.js',
    'static/exploration-journey-comfort.js','static/exploration-journey-comfort.css',
    'static/exploration-journey-inquiry.js','static/exploration-journey-inquiry-data.js','static/exploration-journey-inquiry.css',
    'static/exploration-journey-question.js','static/exploration-journey-question-state.js','static/exploration-journey-question-data.js','static/exploration-journey-question.css',
    'explore.html','static/explore.css','static/explore-app.js','static/explore-state.js','static/explore-map.js','static/explore-motion.js','static/explore-media.js','static/explore-records.js',
    'static/guide-cloud.js','static/explore-transport.js','static/explore-assets-admin.js','static/explore-admin.js','static/site-walk-admin.js','static/site-walk-admin.css']);
  const token=crypto.randomBytes(24).toString('hex');
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    const u=new URL(req.url,'http://local'),name=u.pathname;
    try{
      if(req.method==='POST'&&['/__journey','/__admin','/__scenario'].includes(name)){
        if(req.headers['x-preview-token']!==token)throw Error('本地测试请求无效');
        let body='';for await(const chunk of req){body+=chunk;if(body.length>40000)throw Error('请求过长');}
        const e=JSON.parse(body);let result;
        if(name==='/__journey'){
          if(offline)throw Error('本地网络失败演示：请稍后重试');
          if(e.action==='getSiteExploration')result={...await E.get(f.db,e.resourceId),localTest:true};
          else if(e.action==='getSiteWalk')result=await require('../../cloudfunctions/appCore/lib/site-walk-core').publicWalk(f.db,e.resourceId,Date.now());
          else if(e.action==='askSiteExploration')result=await require('../../cloudfunctions/appCore/domains/exploration-questions').createExplorationQuestionService({db:f.db,config:{mode:'off'}}).ask(e,'local-reader');
          else if(['createSiteWalkSession','getSiteWalkSession','listSiteWalkSessions','siteWalkSessionEvent','deleteSiteWalkSession'].includes(e.action))result=await require('../../cloudfunctions/appCore/domains/site-walk-sessions').createSiteWalkSessionService({db:f.db}).handle('local-reader',e);
          else throw Error('此本地样例不支持该操作');
        }else if(name==='/__admin')result=e.action==='whoami'?{ok:true,isAdmin:true}:await f.call(e);
        else{
          if(e.kind==='reset'){f=await fixture();offline=false;}
          else if(e.kind==='offline')offline=true;
          else if(e.kind==='withdraw')await f.db.collection('submissions').doc('s').update({aiConsentRevokedAt:'local-test'});
          else if(e.kind==='pause'){const d=await f.call({action:'getSiteWalkDraft',resourceId:'r'});await f.call({action:'pauseSiteWalk',resourceId:'r',revision:d.root.revision,requestId:crypto.randomUUID(),reason:'本地演示：观察点临时停用'});}
          else if(e.kind==='reorder'){const d=(await f.call({action:'getSiteWalkDraft',resourceId:'r'})).publishedDraft;d.points.reverse();await f.publish(d);}
          else throw Error('未知本地情形');
          result={ok:true};
        }
        res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(result));
      }
      if(!['GET','HEAD'].includes(req.method)){res.writeHead(405).end();return;}
      if((name==='/'||name==='/explore-journey.html')&&!u.searchParams.has('resourceId')){
        res.writeHead(302,{Location:'/explore-journey.html?resourceId=r'}).end();return;
      }
      if(name==='/preview-control.html'){
        res.setHeader('Content-Type','text/html;charset=utf-8');
        return res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>本地流程演示</title><link rel="stylesheet" href="static/site-walk-admin.css"><main class="wa-page"><h1>本地流程演示</h1><p>只修改这个预览进程的内存数据，不连接生产。可在另一个标签打开画卷后，试试暂停、换版或来源撤回。</p><p><a href="/explore-journey.html?resourceId=r" target="_blank">打开画卷</a> · <a href="/explore-admin.html" target="_blank">打开现有管理后台</a></p>'+[['pause','暂停导览'],['withdraw','撤回来源'],['reorder','倒序并发布测试新版本'],['offline','模拟网络失败'],['reset','重置本地样例']].map(([id,label])=>'<button data-kind="'+id+'">'+label+'</button>').join('')+'<p id="result" role="status"></p><script>document.querySelectorAll("button").forEach(b=>b.onclick=async()=>{b.disabled=true;try{const r=await fetch("/__scenario",{method:"POST",headers:{"x-preview-token":"'+token+'"},body:JSON.stringify({kind:b.dataset.kind})});const v=await r.json();document.querySelector("#result").textContent=v.ok?"已完成；回到画卷检查内容更新。":v.error.message;}finally{b.disabled=false;}});</script></main></html>');
      }
      if(['/index.html','/guide.html','/onsite.html','/trial-start.html'].includes(name)){
        res.setHeader('Content-Type','text/html;charset=utf-8');
        return res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>画卷本地试用</title><link rel="stylesheet" href="static/site-walk-admin.css"><main class="wa-page"><h1>从一卷画开始</h1><p>这是隔离的本地试用，不连接线上账户。原首页、随行向导与完整游览记录不在本服务中模拟；正式发布文件中的入口不变。</p><p><a href="explore-journey.html?resourceId=r">纸上慢读：讲解、阅读拾记与选填反馈 →</a></p><p><a href="explore.html?resourceId=r">原探索工具：问答、照片对照与测试账号手记 →</a></p><p><a href="preview-control.html">维护测试：暂停、换版、断网与重置 →</a></p><p>测试用参考：能否独立开始？能否切换景物并找到出处？能否记住一个细节并留下手记？试用反馈在收卷后填写，可主动导出，不会上传。</p></main></html>');
      }
      const file=name==='/'?'/explore-journey.html':name;
      if(!extra.has(file.slice(1))&&!require('./exploration-motion-demo-preview').allowedPath(file)){res.writeHead(404).end();return;}
      let content=fs.readFileSync(path.join(root,file));
      if(file.endsWith('.html')){
        content=content.toString().replace('</head>','<style>.preview-strip{max-width:1440px;margin:auto;padding:8px 24px;color:var(--gold,var(--ex-muted,#74634d));font:12px/1.7 system-ui,sans-serif}.preview-strip a{display:inline-flex;align-items:center;min-height:44px;margin-right:16px;color:inherit}</style></head>');
        const call='async function localCall(url,data){const r=await fetch(url,{method:"POST",headers:{"x-preview-token":"'+token+'"},body:JSON.stringify(data)});const v=await r.json();if(!v.ok)throw Error(v.error?.message||"本地读取失败");return v;}';
        const adapter=file==='/explore-admin.html'?'window.SiteWalkAdminAdapter={call:data=>localCall("/__admin",data)};':'window.ExplorationAdapter={identity:async()=>"local-reader",call:data=>localCall("/__journey",{...data,resourceId:"r"})};';
        // Local URL retains r so real public projection validates matching resource IDs.
        content=content.toString().replace(/<!-- (?:journey-local-adapter|site-walk-admin-adapter|exploration-local-adapter) -->/,'<script>'+call+adapter+'</script>').replace(/<body([^>]*)>/,'<body$1><aside class="preview-strip">本地假数据库 · 审核与素材均为测试样例，不代表景区认可<br><a href="/trial-start.html">试用说明</a><a href="/preview-control.html" target="_blank">测试暂停 / 换版 / 断网</a><a href="/explore-admin.html" target="_blank">管理这份本地导览</a></aside>');
      }
      const type={'.html':'text/html;charset=utf-8','.js':'text/javascript;charset=utf-8','.css':'text/css;charset=utf-8','.webp':'image/webp','.woff2':'font/woff2','.png':'image/png'};
      res.setHeader('Content-Type',type[path.extname(file)]||'application/octet-stream');res.end(content);
    }catch(error){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:false,error:{message:error.message}}));}
  });
  await new Promise((ok,no)=>{server.once('error',no);server.listen(port,'127.0.0.1',ok);});
  return {url:'http://127.0.0.1:'+server.address().port,get fixture(){return f;},close:()=>new Promise(r=>server.close(r))};
}
module.exports={fixture,start};
if(require.main===module)start(Number(process.argv[2])||4218).then(s=>console.log(s.url+'/explore-journey.html?resourceId=r')).catch(e=>{console.error(e);process.exitCode=1;});
