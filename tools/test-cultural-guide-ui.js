'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),{chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
(async()=>{
 const catalog=['a','b'].map((id,i)=>({id,title:i?'测试乙馆':'测试甲馆',status:'published',region:{city:'测试城'},location:{latitude:30+i*.01,longitude:114+i*.01}}));
 const server=http.createServer((req,res)=>{const p=path.resolve(root,'.'+new URL(req.url,'http://local').pathname);if(!p.startsWith(root+path.sep)||!fs.existsSync(p))return res.writeHead(404).end();res.setHeader('Content-Type',p.endsWith('.js')?'application/javascript':p.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(fs.readFileSync(p));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://**/*',r=>r.abort());
  await page.route('**/static/guide-cloud.js',r=>r.fulfill({contentType:'application/javascript',body:'window.GuideCloud={identity:async()=>null,call:async e=>e.action==="getResources"?{ok:true,items:'+JSON.stringify(catalog)+'}:e.action==="getGuideAudio"?{ok:true,available:false,reason:"语音服务尚未接入"}:e.action==="getGuideStation"?{ok:true,items:[{id:"f",versionId:"v1",storyId:"story",resourceId:e.resourceId,title:"已审核的测试讲解",text:"请对照已确认的材料观察",interests:[],observations:[{text:"观察石刻",locator:"具体位置尚未确认"}],claims:[],sources:[]}]}:e.action==="getGuideRoute"?{ok:true,options:[{id:"theme",title:"本地测试专题"}],theme:{id:"theme",title:"本地测试专题",introduction:"对照观察两站已经确认的材料"},transitions:[{from:"a",to:"b",text:"同主题比较，不代表传承",relations:[]}]}:{ok:true,provider:"amap-web-service",duration:600,distance:600,simulated:true}};'}));
  await page.addInitScript(seed=>{if(!sessionStorage.seeded){localStorage.clear();localStorage.setItem('chulink-guide-seed',JSON.stringify(seed));sessionStorage.seeded='yes';}},{catalog,plan:{stops:[{resourceId:'a',stayMinutes:30},{resourceId:'b',stayMinutes:30}],minutes:120}});
  await page.goto('http://127.0.0.1:'+server.address().port+'/guide.html');
  await page.getByRole('button',{name:'帮我安排',exact:true}).waitFor();
  await page.waitForFunction(()=>GuideApp.getCatalog().length===2);
  assert.equal(await page.locator('#visit-origin,#visit-destination').count(),0);
  assert.equal(await page.locator('#guide-controls select:visible').count(),3);
  assert.equal(await page.locator('#guide-record').isVisible(),false);
  assert.equal(await page.locator('[data-guide-station]').isVisible(),false);
  const out=path.join(require('node:os').tmpdir(),'chulink-guide-simple-qa');fs.mkdirSync(out,{recursive:true});
  for(const width of [390,768,1440]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:path.join(out,'plan-'+width+'.png'),fullPage:true});}
  await page.getByRole('button',{name:'帮我安排',exact:true}).click();
  await page.waitForFunction(()=>document.getElementById('guide-message').textContent.includes('真实交通时间仍待核实'));
  assert.equal(await page.locator('#guide-controls select:visible').count(),0);
  assert.match(await page.locator('#guide-route').innerText(),/不含前往第一站/);
  await page.getByText('观察石刻',{exact:false}).first().waitFor();
  await page.locator('#guide-theme-panel > summary').click();await page.getByText('对照观察两站已经确认的材料').waitFor();await page.locator('#guide-theme summary').click();await page.getByText('同主题比较，不代表传承').waitFor();
  await page.locator('#guide-theme-panel > summary').click();
  for(const width of [390,768,1440]){await page.setViewportSize({width,height:1000});await page.screenshot({path:path.join(out,'journey-'+width+'.png'),fullPage:true});}
  await page.locator('[data-guide-station] summary').click();await page.getByRole('button',{name:'检查语音可用性'}).click();await page.waitForFunction(()=>document.getElementById('guide-message').textContent.includes('语音服务尚未接入'));
  await page.getByRole('button',{name:'标记已读',exact:true}).click();await page.locator('#guide-record-panel > summary').click();await page.getByText('已标记阅读 · 已审核的测试讲解').waitFor();
  await page.getByRole('button',{name:'收藏故事',exact:true}).click();await page.getByRole('button',{name:'取消收藏',exact:true}).click();
  await page.locator('#guide-preferences > summary').click();await page.locator('#guide-preferences .guide-extra > summary').click();await page.locator('#visit-depth').selectOption('quiet');await page.getByRole('button',{name:'更新安排',exact:true}).click();await page.getByText('需要时展开本站讲解').waitFor();
  await page.locator('#guide-route-details > summary').click();
  await page.locator('[data-act="lock"]').first().click();await page.locator('[data-act="skip"]').click();assert.match(await page.locator('#guide-message').innerText(),/解除必去/);
  await page.locator('[data-act="arrive"]').click();await page.locator('[data-act="complete"]').click();
  assert.match(await page.locator('#guide-stops').innerText(),/测试乙馆/);
  await page.reload();await page.waitForFunction(()=>document.getElementById('guide-route').textContent.includes('已确认完成参观'));
  assert.equal(await page.evaluate(()=>GuideApp.getSession().stops[0].state),'visited');
  await page.locator('#guide-account > summary').click();await page.getByRole('button',{name:'结束本次游览',exact:true}).click();await page.getByRole('heading',{name:'这一程，留在这里'}).waitFor();
  assert.match(await page.locator('#guide-record').innerText(),/已完成 1 站/);
  assert.match(await page.locator('#guide-record a').last().getAttribute('href'),/guideResourceId=b/);
  for(const width of [390,768,1440]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:path.join(out,'record-'+width+'.png'),fullPage:true});}
  assert.deepEqual(errors,[]);
  console.log('Guide UI passed: three choices, no coordinates, progressive details, simulated route not verified, lock/arrival/advance/restore/end, 390/768/1440; '+out);
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exit(1)});
