'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),os=require('node:os'),assert=require('node:assert/strict'),{chromium}=require('playwright');
(async()=>{
 const root=path.resolve(__dirname,'..'),catalog=['a','b','c'].map((id,i)=>({id,type:'landmark',title:['甲馆','乙楼','丙园'][i],status:'published',region:{city:'测试城'},location:{latitude:30+i*.002,longitude:114}}));
 const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+new URL(req.url,'http://local').pathname);if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return res.writeHead(404).end();res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(fs.readFileSync(file));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage(),errors=[],actions=[];page.on('pageerror',e=>errors.push(e.message));let offline=false,closed=false;
  await page.route('https://**/*',r=>r.abort());
  await page.exposeFunction('localGuide',async e=>{actions.push(e);if(e.action==='beginContentEffect')return {ok:true,enabled:false};if(e.action==='getResources')return {ok:true,items:catalog.map(r=>({...r,visitInfo:{status:closed?'closed':'unknown'}}))};if(e.action==='planRoute'){if(offline)throw Error('fixed offline');return {ok:true,provider:'amap-web-service',duration:600,distance:600,walkingDistance:600,simulated:true};}if(e.action==='getGuideStation'||e.action==='getGuideRoute')return {ok:true,items:[]};throw Error('Unexpected API: '+e.action);});
  await page.route('**/static/guide-cloud.js',r=>r.fulfill({contentType:'application/javascript',body:'window.GuideCloud={identity:async()=>null,call:window.localGuide};'}));
  const base='http://127.0.0.1:'+server.address().port;
  await page.goto(base+'/guide.html');await page.locator('#guide-city option').waitFor({state:'attached'});await page.locator('#guide-duration').selectOption('240');
  await page.locator('[data-act=recommend]').click();await page.locator('[data-chat-apply]').waitFor();
  assert.equal(await page.evaluate(()=>!!GuideApp.getSession()),false);
  assert.match(await page.locator('#guide-proposal').innerText(),/待核实/);
  await page.locator('[data-chat-apply]').click();await page.waitForFunction(()=>GuideApp.getSession()?.stops.length===2);
  assert.equal(await page.evaluate(()=>GuideApp.getSession().stops[0].state),'pending');
  assert.match(await page.getByRole('link',{name:'去这一站 · 高德导航'}).getAttribute('href'),/^https:\/\/uri.amap.com\/navigation/);
  async function say(text){if(!await page.locator('#guide-dialog').evaluate(e=>e.open))await page.locator('#guide-dialog > summary').click();await page.locator('#guide-chat-input').fill(text);await page.locator('#guide-chat-form button').click();}
  await say('不要跳过这一站');await page.waitForFunction(()=>!document.querySelector('[data-chat-apply]'));assert.equal(await page.evaluate(()=>GuideApp.getSession().stops[0].state),'pending');
  await say('少走一点');await page.locator('[data-chat-apply]').waitFor();assert.equal(await page.evaluate(()=>GuideApp.getSession().stops.length),2);
  await page.locator('#guide-route-details > summary').click();await page.locator('[data-act=lock]').first().click();assert.equal(await page.locator('[data-chat-apply]').count(),0);
  await say('少走一点');await page.locator('[data-chat-apply]').waitFor();await page.locator('[data-chat-apply]').click();await page.waitForFunction(()=>GuideApp.getSession().stops.length===1);
  await say('跳过这一站');await page.getByText('这一站是必去点，请先在调整站点里解除必去。',{exact:true}).waitFor();
  await page.locator('[data-act=arrive]').click();await page.locator('[data-act=complete]').click();
  await say('提前结束');await page.locator('[data-chat-apply]').click();await page.getByRole('heading',{name:'这一程，留在这里'}).waitFor();
  assert.equal(await page.evaluate(()=>GuideApp.getSession().stops[0].state),'visited');
  const old=await page.evaluate(()=>GuideApp.getSession().id);
  await page.locator('[data-act=new-plan]').click();await page.locator('#guide-duration').selectOption('240');
  offline=true;await page.locator('[data-act=recommend]').click();await page.locator('[data-chat-apply]').waitFor();assert.match(await page.locator('#guide-proposal').innerText(),/待核实/);
  closed=true;await page.locator('[data-chat-apply]').click();await page.getByText('站点当前不适合参观，请移除后再保存',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>!!GuideApp.getSession()),false);
  closed=false;offline=false;
  await page.locator('#guide-controls details > summary').click();await page.locator('[data-act=local-history]').click();await page.locator('[data-local-load]').first().click();
  assert.equal(await page.evaluate(()=>GuideApp.getSession().id),old);assert.equal(await page.evaluate(()=>GuideApp.getSession().status),'ended');
  await page.reload();await page.getByRole('heading',{name:'这一程，留在这里'}).waitFor();
  const out=path.join(os.tmpdir(),'chulink-guide-conversation-qa');fs.mkdirSync(out,{recursive:true});
  await page.locator('[data-act=new-plan]').click();await page.locator('#guide-duration').selectOption('240');await page.locator('[data-act=recommend]').click();await page.locator('[data-chat-apply]').waitFor();
  for(const width of [390,768,1440]){await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(out,'conversation-'+width+'.png'),fullPage:true});}
  assert.deepEqual(errors,[]);assert(actions.every(e=>['getResources','planRoute','getGuideStation','getGuideRoute','beginContentEffect'].includes(e.action)));
  assert(actions.every(e=>!('prompt' in e)&&!('messages' in e)));
  console.log('Guide conversation UI passed: no-basket start, preview/apply, real mutation, stale/locked protections, explicit arrival/end, local history, closed source and network failure, no model API, 3 viewports. '+out);
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
