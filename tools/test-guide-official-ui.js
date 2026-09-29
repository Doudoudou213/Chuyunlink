'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),os=require('node:os'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {prepared}=require('./test-guide-official-sources');
const {createCulturalGuideService}=require('../cloudfunctions/appCore/domains/cultural-guide');
async function main(){
 const x=await prepared(),core=createCulturalGuideService({db:x.db});
 const root=path.resolve(__dirname,'..'),out=path.join(os.tmpdir(),'chulink-official-source-qa');fs.mkdirSync(out,{recursive:true});
 const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+new URL(req.url,'http://local').pathname);if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return res.writeHead(404).end();res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(fs.readFileSync(file));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://**/*',r=>r.request().url().includes('static.cloudbase.net')?r.fulfill({contentType:'application/javascript',body:'window.cloudbase={init:()=>({auth:()=>({getLoginState:async()=>null})})};'}):r.abort());
  await page.exposeFunction('localOfficialAdmin',e=>['getGuideOfficialSources','searchGuideOfficialSources'].includes(e.action)?x.service.handle(e,'fixture-admin'):x.admin.handle(e,'fixture-admin'));
  const base='http://127.0.0.1:'+server.address().port;
  await page.goto(base+'/admin.html');await page.evaluate(()=>{callAdmin=window.localOfficialAdmin;document.getElementById('admin-panel').classList.remove('hidden');document.getElementById('login-panel').style.display='none';});
  await page.getByRole('button',{name:'随行讲解',exact:true}).click();await page.locator('[data-guide-edit]').click();await page.locator('#go-search').click();await page.locator('[data-go-choice]').waitFor();
  await page.locator('#gf-reviewed').check();await page.locator('#gf-rating').selectOption('correct');await page.locator('#gf-review-note').fill('本地固定网页的审核流程验证，未核实真实历史');await page.locator('#gf-publish').click();
  await page.waitForFunction(()=>document.getElementById('message').textContent.includes('节选允许公开'));
  assert.equal(Object.keys(x.db.data().guide_fragment_versions).length,0);
  for(const width of [390,768,1440]){await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.locator('#guide-official-panel').screenshot({path:path.join(out,'admin-'+width+'.png')});}
  await page.locator('#go-reviewed').check();await page.locator('#gf-publish').click();await page.waitForFunction(()=>document.getElementById('message').textContent.includes('已发布'));
  const catalog=[{id:'r',status:'published',title:'黄鹤楼',region:{city:'武汉'},location:{latitude:30,longitude:114}}];
  await page.exposeFunction('localOfficialCore',async e=>{if(e.action==='getResources')return {ok:true,items:catalog};if(e.action==='getGuideStation')return core.station(e);if(e.action==='getGuideRoute')return {ok:true,items:[]};return {ok:true};});
  await page.route('**/static/guide-cloud.js',r=>r.fulfill({contentType:'application/javascript',body:'window.GuideCloud={identity:async()=>null,call:window.localOfficialCore};'}));
  await page.addInitScript(c=>{localStorage.clear();localStorage.setItem('chulink-guide-seed',JSON.stringify({catalog:c,plan:{stops:[{resourceId:'r',stayMinutes:30}],minutes:120}}));},catalog);
  await page.goto(base+'/guide.html');await page.locator('[data-act=view]').first().click();await page.locator('#guide-station-panel > summary').click();await page.locator('.guide-origin-dot.is-verified').waitFor();
  await page.getByRole('button',{name:'查看依据',exact:true}).click();await page.locator('.guide-origin-detail:not([hidden])').waitFor();
  assert.match(await page.locator('.guide-origin-detail').innerText(),/对应第1句/);
  assert.match(await page.locator('.guide-origin-detail').innerText(),/固定响应/);
  assert.equal(await page.locator('.guide-origin-detail a').getAttribute('rel'),'noopener noreferrer');
  for(const width of [390,768,1440]){await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.locator('[data-guide-station]').screenshot({path:path.join(out,'reader-'+width+'.png')});}
  await page.getByRole('button',{name:'查看依据',exact:true}).focus();await page.keyboard.press('Enter');assert.equal(await page.getByRole('button',{name:'查看依据',exact:true}).getAttribute('aria-expanded'),'false');
  const searchId=Object.keys(x.db.data().guide_official_searches)[0];await x.db.collection('guide_official_searches').doc(searchId).update({validUntil:1});await page.evaluate(()=>GuideApp.render());await page.locator('.guide-origin-dot.is-unmatched').waitFor();await page.getByRole('button',{name:'查看依据',exact:true}).click();assert.match(await page.locator('.guide-origin-detail').innerText(),/待更新/);assert.equal(await page.locator('.guide-origin-detail blockquote').count(),0);
  await x.db.collection('guide_official_searches').doc(searchId).update({status:'unavailable'});await page.getByRole('button',{name:'查看依据',exact:true}).click();await page.getByRole('button',{name:'查看依据',exact:true}).click();await page.getByText('来源待重新核对',{exact:true}).waitFor();assert.equal(await page.locator('.guide-origin-dot').count(),0);
  assert.deepEqual(errors,[]);console.log('Official source UI passed: real local domains/fixed pages, existing review approval, green/amber, keyboard, fresh reads, expiry, withdrawal and 390/768/1440 screenshots at '+out);
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e);process.exit(1)});
