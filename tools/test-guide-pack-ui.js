'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {fakeDb}=require('./lib/fake-material-db');
const {seed}=require('./test-guide-pack-import');
const {createGuidePackService}=require('../cloudfunctions/adminSubmissions/domains/guide-packs');
const {createCulturalGuideService}=require('../cloudfunctions/appCore/domains/cultural-guide');
const root=path.resolve(__dirname,'..');
(async()=>{
 const db=fakeDb(seed()),admin=createGuidePackService({db}),pub=createCulturalGuideService({db});
 const server=http.createServer((req,res)=>{const p=path.resolve(root,'.'+new URL(req.url,'http://local').pathname);if(!p.startsWith(root+path.sep)||!fs.existsSync(p)||fs.statSync(p).isDirectory())return res.writeHead(404).end();res.setHeader('Content-Type',p.endsWith('.js')?'application/javascript':p.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(fs.readFileSync(p));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://**/*',r=>r.request().url().includes('static.cloudbase.net')?r.fulfill({contentType:'application/javascript',body:'window.cloudbase={init:()=>({auth:()=>({getLoginState:async()=>null})})};'}):r.abort());
  await page.exposeFunction('localPackAdmin',e=>admin.handle(e,'local-admin'));
  await page.goto('http://127.0.0.1:'+server.address().port+'/admin.html');
  await page.evaluate(()=>{callAdmin=window.localPackAdmin;document.getElementById('admin-panel').classList.remove('hidden');document.getElementById('login-panel').style.display='none';});
  await page.getByRole('button',{name:'讲解包导入',exact:true}).click();
  await page.locator('#gp-point').selectOption('yellow-crane-tower');
  await page.locator('#gp-preview').click();await page.locator('#gp-binding').check();await page.locator('#gp-import').click();
  await page.locator('#gp-title').waitFor();assert.equal((await pub.station({resourceId:'yellow-crane-tower'})).items.length,0);
  await page.locator('#gp-publish').click();await page.waitForFunction(()=>document.getElementById('message').textContent.includes('请核对'));
  await page.locator('#gp-title').fill('黄鹤楼 · 从两个年代读起');await page.locator('#gp-save').click();
  await page.waitForFunction(()=>document.getElementById('message').textContent.includes('修改已保存'));
  const out=path.join(require('node:os').tmpdir(),'chulink-guide-pack-qa');fs.mkdirSync(out,{recursive:true});
  for(const width of [390,768,1440]){
    await page.setViewportSize({width,height:1000});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Admin horizontal overflow: '+width);
    await page.locator('#list').screenshot({path:path.join(out,'pack-editor-'+width+'.png')});
  }
  for(const checkbox of await page.locator('[data-gp-source],#gp-review-binding,#gp-review-facts,#gp-review-paraphrase').all())await checkbox.check();
  for(const reason of await page.locator('[data-gp-reason]').all())await reason.fill('本地固定响应检查，仍需真实管理员核对');
  await page.locator('#gp-note').fill('本地模拟人工确认，用来验收操作流程');
  await page.locator('#gp-publish').click();
  await page.waitForFunction(()=>document.getElementById('message').textContent.includes('讲解已发布'));
  const item=(await pub.station({resourceId:'yellow-crane-tower'})).items[0];assert(item);assert.equal(item.title,'黄鹤楼 · 从两个年代读起');
  await page.locator('#gp-point').selectOption('zenghou-archway');await page.locator('#gp-preview').click();
  await page.getByText('仅有背景或对象不明，暂不导入',{exact:true}).waitFor();assert.equal(await page.locator('#gp-import').count(),0);
  // Actual public rendering and private record resolver; all data/services remain local.
  const publicPage=await browser.newPage();publicPage.on('pageerror',e=>errors.push(e.message));await publicPage.route('https://**/*',r=>r.abort());
  await publicPage.goto('http://127.0.0.1:'+server.address().port+'/guide.html');
  await publicPage.exposeFunction('localPackPublic',e=>pub.station(e));
  await publicPage.evaluate(()=>{
    document.body.innerHTML='<main style="max-width:700px;margin:auto;padding:16px"><div data-guide-station="yellow-crane-tower"></div><div id="guide-record"></div><p id="test-message"></p></main>';
    window.testSession={stops:[{resourceId:'yellow-crane-tower',title:'黄鹤楼',state:'arrived'}],depth:'brief',interests:[],activities:[]};
    window.GuideApp={esc:x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),api:window.localPackPublic,getSession:()=>testSession,save:()=>{},checkIdentity:async()=>true,isCloud:()=>false,message:t=>document.getElementById('test-message').textContent=t};
    window.ContentEffects={observe:()=>{},open:()=>{},emit:()=>{}};
  });
  // The real scripts are already loaded by guide.html and use GuideApp at interaction time.
  await publicPage.evaluate(()=>GuideContent.render(testSession));
  await publicPage.getByRole('button',{name:'收藏讲解',exact:true}).click();
  await publicPage.getByText('已收藏 · 黄鹤楼 · 从两个年代读起').waitFor();
  assert.equal(await publicPage.getByRole('link',{name:'阅读完整故事',exact:true}).count(),0);
  await publicPage.getByRole('button',{name:'查看依据',exact:true}).click();
  await publicPage.getByText('讲解依据官方公开资料整理，已由管理员核对；不是官方原文或官方背书。').waitFor();
  for(const width of [390,768,1440]){
    await publicPage.setViewportSize({width,height:950});assert(await publicPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await publicPage.screenshot({path:path.join(out,'pack-public-'+width+'.png'),fullPage:true});
  }
  await page.locator('[data-gp-edit="'+item.id+'"]').click();await page.locator('#gp-note').fill('本地测试来源不可用，需要停止展示');await page.locator('[data-gp-disable]').first().click();
  await page.waitForFunction(()=>document.getElementById('message').textContent.includes('来源已停用'));
  await publicPage.getByRole('button',{name:'查看依据',exact:true}).click(); // collapse
  await publicPage.getByRole('button',{name:'查看依据',exact:true}).click(); // revalidate
  await publicPage.getByText('来源待重新核对',{exact:true}).waitFor();
  await publicPage.evaluate(()=>GuideRecord.render(testSession));await publicPage.getByText('已收藏 · 内容已下架或来源待复核').waitFor();
  assert.deepEqual(errors,[]);
  console.log('Guide pack UI passed: import/edit/review/publish, blocked incomplete point, public citations/bookmarks, revoked source, mobile/tablet/desktop. Local fixtures only. Screenshots: '+out);
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exit(1)});
