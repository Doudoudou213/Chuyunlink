'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright'),{start}=require('./lib/exploration-journey-preview');
let checks=0;function check(v,name){assert(v,name);checks++;}
function wave(){const b=Buffer.alloc(44+16000*2*4);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(b.length-44,40);return b;}
(async()=>{
  const s=await start(),b=await chromium.launch({channel:'msedge',headless:true});
  const out=path.join(__dirname,'../artifacts/exploration-journey-live');fs.mkdirSync(out,{recursive:true});
  const errors=[],actions=[];
  try{
    const p=await b.newPage({viewport:{width:390,height:900}});
    await p.addInitScript(()=>{const NativeAudio=Audio;window.__audios=[];window.Audio=function(){const a=new NativeAudio();window.__audios.push(a);return a;};});
    await p.addInitScript(()=>{const interval=window.setInterval;window.__rechecks=[];window.setInterval=(fn,ms,...args)=>{if(ms===30000&&typeof fn==='function')window.__rechecks.push(()=>fn(...args));return interval(fn,ms,...args);};});
    p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(r.url().endsWith('/__journey'))actions.push(r.postDataJSON().action);});
    const go=async()=>{await p.goto(s.url+'/explore-journey.html?resourceId=r');await p.locator('#content:not([hidden])').waitFor();};
    const open=async(id,page=p)=>{await page.locator('#'+id+' > .journey-leaf-trigger').click();await page.locator('#journey-leaf-dialog[open][aria-busy=false][data-leaf="'+id+'"]').waitFor();await page.waitForFunction(()=>!document.querySelector('#journey-leaf-dialog').getAnimations().some(a=>a.playState==='running'));};
    const close=async(page=p)=>{await page.locator('.journey-leaf-close').click();await page.locator('#journey-leaf-dialog').waitFor({state:'hidden'});};
    const scenario=async kind=>{const q=await b.newPage();await q.goto(s.url+'/preview-control.html');await q.locator('[data-kind='+kind+']').click();await q.waitForFunction(()=>document.querySelector('#result').textContent.includes('已完成'));await q.close();};
    await go();
    check(await p.locator('.journal details').count()===0,'four disclosures replaced on visitor');
    check(await p.locator('.journey-leaf-trigger').count()===4,'four explicit entries');
    check(await p.evaluate(()=>localStorage.getItem('chulink:journey-content:v1:r'))===null,'no auto record on enter');
    await open('reading');
    check(await p.locator('#journey-leaf-title').textContent()==='黄鹤楼','leaf context matches selected scene');
    check(await p.locator('#reading-copy').isVisible(),'verified reading visible');
    check(await p.locator('#audio').evaluate(e=>!!e.closest('dialog')),'one existing audio control moved with reading');
    check(await p.locator('#audio').count()===1,'no duplicate audio');
    check(await p.locator('#journey-leaf-title').evaluate(e=>document.activeElement===e),'heading focus');
    await p.locator('.journey-leaf-return').focus();await p.keyboard.press('Tab');
    check(await p.evaluate(()=>document.querySelector('dialog').contains(document.activeElement)),'tab stays inside');
    await p.locator('#observe').evaluate(e=>e.focus());
    check(await p.evaluate(()=>document.querySelector('dialog').contains(document.activeElement)),'background inert');
    await p.keyboard.press('Escape');await p.locator('dialog').waitFor({state:'hidden'});
    check(await p.locator('#reading > button').evaluate(e=>document.activeElement===e),'escape returns focus');
    check(await p.locator('#audio').evaluate(e=>!e.closest('dialog')),'audio restored on close');
    check(await p.locator('[data-recorded=true]').count()===0,'opening not counted as visit/reading record');
    check(await p.evaluate(()=>localStorage.getItem('chulink:journey-content:v1:r'))===null,'opening has no persistence');
    // Responsive screenshots: actual public fixture text, not invented historical claims.
    for(const width of [320,390,768,1440]){
      await p.setViewportSize({width,height:900});await p.evaluate(()=>scrollTo(0,0));
      await p.screenshot({path:path.join(out,'visitor-leaves-main-'+width+'.png'),fullPage:true});
      await open('reading');
      check(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no page overflow '+width);
      check(await p.locator('#journey-leaf-body').evaluate(e=>e.scrollWidth<=e.clientWidth+1),'no reading overflow '+width);
      check(await p.locator('.journey-leaf-close').evaluate(e=>{const r=e.getBoundingClientRect();return r.width>=44&&r.height>=44&&r.top>=0;}),'close size/reach '+width);
      check(await p.locator('.journey-leaf-return').evaluate(e=>e.getBoundingClientRect().bottom<=innerHeight),'footer reachable '+width);
      await p.screenshot({path:path.join(out,'visitor-leaf-reading-'+width+'.png')});await close();
      // Playwright may scroll the entry before clicking; closing itself must not move that position.
      check(await p.locator('#point-title').textContent()==='黄鹤楼','same point after close '+width);
    }
    // Short landscape and abnormally long copy still keep the close/return controls reachable.
    for(const viewport of [{width:667,height:320},{width:320,height:500}]){
      await p.setViewportSize(viewport);await open('reading');
      await p.locator('#reading-copy').evaluate(e=>{window.__originalReading=e.textContent;e.textContent='这是本地排版检查文字，不是景区讲解。'.repeat(80);});
      check(await p.locator('#journey-leaf-body').evaluate(e=>e.clientHeight>40&&e.scrollHeight>e.clientHeight),'long copy internally scrolls '+viewport.width);
      check(await p.locator('.journey-leaf-return').evaluate(e=>e.getBoundingClientRect().bottom<=innerHeight),'landscape footer reachable '+viewport.width);
      check(await p.locator('.journey-leaf-close').evaluate(e=>e.getBoundingClientRect().top>=0),'landscape close reachable '+viewport.width);
      await p.locator('#reading-copy').evaluate(e=>{e.textContent=window.__originalReading;});await close();
    }
    await p.setViewportSize({width:390,height:900});
    await open('sources');check((await p.locator('#source-list').textContent()).includes('本地画稿'),'sources still truthful');await close();
    await open('journey-help');check((await p.locator('#journey-leaf-body').textContent()).includes('不判断你在哪里'),'navigation limit retained');await close();
    // Content must stay invisible until the request completes; Escape invalidates the pending open.
    let release;const blocked=new Promise(r=>{release=r;});
    await p.route('**/__journey',async route=>{const response=await route.fetch();await blocked;await route.fulfill({response});});
    await p.locator('#reading > button').click();await p.locator('dialog[aria-busy=true]').waitFor();
    check(await p.locator('#reading-copy').isHidden(),'old reading hidden during verification');
    await p.keyboard.press('Escape');await p.locator('dialog').waitFor({state:'hidden'});release();await p.waitForTimeout(250);
    check(await p.locator('dialog').isHidden(),'late response does not reopen');await p.unroute('**/__journey');
    // Source withdrawal BEFORE open removes stale body instead of opening it briefly.
    await scenario('withdraw');await p.locator('#sources > button').click();await p.locator('#retry:not([hidden])').waitFor();
    check(await p.locator('dialog').isHidden(),'withdrawn source never opens');
    check(await p.locator('#source-list').textContent()==='','withdrawn sources erased');
    check(await p.locator('#reading-copy').textContent()==='','withdrawn reading erased');
    check(await p.locator('#gate-title').evaluate(e=>document.activeElement===e),'failure focus on retry explanation');
    await scenario('reset');await go();
    // Expiry while a page is open closes immediately and clears its detached content.
    const core=require('../cloudfunctions/appCore/lib/site-walk-core');
    const root=s.fixture.db.data().site_walks[core.rootId('r')];
    const old=s.fixture.db.data().site_walk_versions[root.publishedVersionId].review;
    await s.fixture.db.collection('site_walk_versions').doc(root.publishedVersionId).update({review:{...old,validUntil:new Date(Date.now()+2200).toISOString()}});
    await open('reading');await p.waitForFunction(()=>document.querySelector('#gate-title').textContent==='资料到了复核时间');
    check(await p.locator('dialog').isHidden(),'expiry closes open leaf');
    check(await p.locator('#reading-copy').textContent()==='','expiry erases moved node');
    await scenario('reset');await go();await open('reading');
    await scenario('withdraw');await p.evaluate(()=>__rechecks.forEach(fn=>fn()));await p.locator('#retry:not([hidden])').waitFor();
    check(await p.locator('dialog').isHidden(),'periodic recheck closes withdrawn open leaf');
    check(await p.locator('#reading-copy').textContent()==='','periodic recheck erases withdrawn body');
    await scenario('reset');await go();await open('reading');
    await p.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
    check(await p.locator('dialog').isHidden(),'background closes leaf');
    check(await p.locator('#reading-copy').textContent()==='','background erases public copy');
    await p.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});await p.locator('#content:not([hidden])').waitFor();
    // Closing a feedback leaf is not consent to persist the form.
    await p.locator('#finish').click();await p.locator('#finished:not([hidden])').waitFor();await open('trial-feedback');
    await p.locator('input[name=start][value=help]').check();await p.locator('#trial-obstacle').fill('本地未保存建议');await close();
    check(!(await p.evaluate(()=>localStorage.getItem('chulink:journey-content:v1:r'))).includes('本地未保存建议'),'close does not save feedback');
    await open('trial-feedback');check(await p.locator('#trial-obstacle').inputValue()==='本地未保存建议','unsaved input kept while page lives');
    check(await p.locator('input[name=start][value=help]').isChecked(),'radio retained');await close();
    // Same manually-started audio is paused, never cloned or silently restarted by opening/closing a leaf.
    await scenario('reset');
    const f=s.fixture,draft=(await f.call({action:'getSiteWalkDraft',resourceId:'r'})).publishedDraft;
    const asset={pointId:'tower',guideVersionId:draft.points[0].guideVersionId,type:'audio',url:'https://example.com/leaf-test.wav',
      attribution:'本地无声测试音频，不是真人讲解',rightsKind:'own',rightsNote:'仅本地固定授权测试，不作为上线素材',
      publicUseConfirmed:true,rightsConfirmed:true,sourceIds:['l'],validUntil:new Date(Date.now()+3600000).toISOString(),duration:4,cues:[{at:0,detailId:'observation'}]};
    const registered=await f.call({action:'saveExplorationAsset',resourceId:'r',requestId:'leaf-audio-test',asset});
    draft.exploration.objects[0].audioId=registered.assetId;await f.publish(draft);
    await p.route('https://example.com/leaf-test.wav',r=>r.fulfill({contentType:'audio/wav',headers:{'Access-Control-Allow-Origin':'*'},body:wave()}));
    await go();await p.locator('#audio button').click();await p.waitForFunction(()=>__audios.some(a=>!a.paused&&a.currentTime>.1));
    const playhead=await p.evaluate(()=>__audios.at(-1).currentTime);await open('reading');
    check(await p.evaluate(()=>__audios.every(a=>a.paused)),'opening pauses audio');
    check(await p.evaluate(t=>__audios.length===1&&__audios[0].currentTime>=t,playhead),'original player/time kept');
    await p.locator('#audio button').click();await p.waitForFunction(()=>__audios.some(a=>!a.paused));await close();
    check(await p.evaluate(()=>__audios.every(a=>a.paused)),'closing pauses manually played narration');
    await open('reading');check(await p.evaluate(()=>__audios.every(a=>a.paused)),'reopening never autoplays');await close();
    // A pre-open play validation which completes late must not cause playback behind the paper.
    await go();let releaseAudio;const audioBlocked=new Promise(r=>{releaseAudio=r;});
    await p.route('**/__journey',async route=>{const response=await route.fetch();await audioBlocked;await route.fulfill({response});});
    await p.locator('#audio button').click();await p.locator('#reading > button').click();await p.locator('dialog[aria-busy=true]').waitFor();
    releaseAudio();await p.locator('dialog[aria-busy=false]').waitFor();await p.waitForTimeout(200);
    check(await p.evaluate(()=>__audios.every(a=>a.paused&&!a.getAttribute('src'))),'late play canceled by open');
    await close();await p.unroute('**/__journey');await scenario('reset');
    check(actions.every(a=>a==='getSiteExploration'),'UI uses only existing public reads');
    const q=await b.newPage({viewport:{width:320,height:700},reducedMotion:'reduce'});q.on('pageerror',e=>errors.push(e.message));
    await q.route('**/paper-fibres-soft-v1.webp',r=>r.abort());await q.goto(s.url+'/explore-journey.html?resourceId=r');await q.locator('#content:not([hidden])').waitFor();
    await open('reading',q);check(await q.locator('dialog').evaluate(e=>getComputedStyle(e).animationName)==='none','reduced motion');
    check(await q.locator('#reading-copy').isVisible(),'missing texture keeps copy');await q.keyboard.press('Escape');check(await q.locator('dialog').isHidden(),'reduced close immediate');await q.close();
    const r=await b.newPage();await r.route('**/exploration-journey-leaves.js',route=>route.abort());await r.goto(s.url+'/explore-journey.html?resourceId=r');await r.locator('#content:not([hidden])').waitFor();
    await r.locator('#reading summary').click();check(await r.locator('#reading-copy').isVisible(),'script failure keeps native fallback');await r.close();
    check(errors.length===0,JSON.stringify(errors));
    console.log('PASS visitor paper leaves: '+checks+' checks; disclosure/state/focus/verification/expiry/privacy/responsive/fallback.');
  }finally{await b.close();await s.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
