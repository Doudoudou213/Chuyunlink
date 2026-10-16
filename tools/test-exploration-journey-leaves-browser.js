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
    const open=async(id,page=p)=>{if(!await page.locator('#journey-leaf-dialog[open][data-leaf="'+id+'"]').count())await page.locator('#'+id+' > .journey-leaf-trigger').click();await page.locator('#journey-leaf-dialog[open][aria-busy=false][data-leaf="'+id+'"][data-state=open]').waitFor();};
    const close=async(page=p)=>{await page.locator('.journey-leaf-close').click();await page.locator('#journey-leaf-dialog').waitFor({state:'hidden'});};
    const cleanPaperMotion=async(page=p)=>page.evaluate(()=>[...document.querySelectorAll('#journey-leaf-dialog,.journey-leaf-sheet,.journey-leaf-motif,.journey-leaf-header,.journey-leaf-body,.journey-leaf-footer,.journey-leaf-light,.journey-leaf-shade,.journey-leaf-veil')].every(e=>!e.style.transform&&!e.style.willChange));
    const scenario=async kind=>{const q=await b.newPage();await q.goto(s.url+'/preview-control.html');await q.locator('[data-kind='+kind+']').click();await q.waitForFunction(()=>document.querySelector('#result').textContent.includes('已完成'));await q.close();};
    await go();
    check(await p.locator('.journal details').count()===0,'four disclosures replaced on visitor');
    check(await p.locator('.journey-leaf-trigger').count()===4,'four explicit entries');
    check(await p.locator('#journey-leaf-dialog').isHidden(),'initial visit leaves the artwork unobstructed');
    check(await p.evaluate(()=>localStorage.getItem('chulink:journey-content:v1:r'))===null,'no auto record on enter');
    await open('reading');
    check(await p.locator('#journey-leaf-title').textContent()==='黄鹤楼','leaf context matches selected scene');
    check(await p.locator('#reading-copy').isVisible(),'verified reading visible');
    check(await p.locator('#audio').evaluate(e=>!!e.closest('dialog')),'one existing audio control moved with reading');
    check(await p.locator('#audio').count()===1,'no duplicate audio');
    check(await p.locator('#journey-leaf-title').evaluate(e=>document.activeElement===e),'heading focus');
    await p.locator('#journey-leaf-next').focus();await p.keyboard.press('Tab');
    check(await p.evaluate(()=>document.querySelector('dialog').contains(document.activeElement)),'tab stays inside');
    await p.locator('#observe').evaluate(e=>e.focus());
    check(await p.evaluate(()=>document.querySelector('dialog').contains(document.activeElement)),'background inert');
    await p.keyboard.press('Escape');await p.locator('dialog').waitFor({state:'hidden'});
    check(await p.locator('#reading > button').evaluate(e=>document.activeElement===e),'escape returns focus');
    check(await p.locator('#audio').evaluate(e=>!e.closest('dialog')),'audio restored on close');
    check(await p.locator('[data-recorded=true]').count()===0,'opening not counted as visit/reading record');
    check(await p.evaluate(()=>localStorage.getItem('chulink:journey-content:v1:r'))===null,'opening has no persistence');
    // Choosing either the original artwork or its accessible list opens only the
    // selected, reverified scene. It never records an arrival or reading credit.
    for(const source of ['art','list']){
      const selector=source==='art'?'[data-art-point=copper]':'[data-stop=tower]';
      const expected=source==='art'?'古铜顶':'黄鹤楼';
      await p.locator(selector).click();await open('reading');
      check(await p.locator('#journey-leaf-title').textContent()===expected,source+' selection opens matching reading');
      check(await p.locator('#journey-leaf-dialog').getAttribute('data-scene')===(source==='art'?'copper':'tower'),source+' reading motif follows explicit artwork binding');
      check(await p.locator('[data-recorded=true]').count()===0,source+' selection does not create a recorded visit');
      await close();
      check(await p.locator(selector).evaluate(e=>document.activeElement===e),source+' close returns focus to current rendered trigger');
    }
    // The reusable choreography must remain interruptible after real verification
    // and moving the original reading/audio nodes, not only in the static demo.
    await p.locator('#reading > button').evaluate(e=>e.click());
    await p.locator('#journey-leaf-dialog[open][data-state=opening][aria-busy=false]').waitFor();
    await p.waitForTimeout(130);
    const interruption=await p.evaluate(()=>{
      const dialog=document.querySelector('#journey-leaf-dialog'),sheet=document.querySelector('.journey-leaf-sheet'),veil=document.querySelector('.journey-leaf-veil');
      const pose=()=>{const r=dialog.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,opacity:+getComputedStyle(dialog).opacity,veil:+getComputedStyle(veil).opacity,sheet:getComputedStyle(sheet).transform,state:dialog.dataset.state};};
      const before=pose();document.querySelector('.journey-leaf-close').click();return {before,after:pose()};
    });
    check(interruption.before.state==='opening'&&interruption.after.state==='closing','verified reading can close before arrival finishes');
    check(['x','y','width','height'].every(k=>Math.abs(interruption.before[k]-interruption.after[k])<1),'interrupted visitor paper does not teleport');
    check(Math.abs(interruption.before.opacity-interruption.after.opacity)<.01&&Math.abs(interruption.before.veil-interruption.after.veil)<.01&&interruption.before.sheet===interruption.after.sheet,'interrupted visitor fold and brightness are continuous');
    await p.locator('#journey-leaf-dialog').waitFor({state:'hidden'});
    check(await cleanPaperMotion(),'interrupted visitor paper clears transient layers');
    check(await p.locator('#audio').evaluate(e=>!e.closest('dialog')),'interrupted close restores original audio controls');
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
    await s.fixture.db.collection('site_walk_versions').doc(root.publishedVersionId).update({review:{...old,validUntil:new Date(Date.now()+4500).toISOString()}});
    await open('reading');await p.waitForFunction(()=>document.querySelector('#gate-title').textContent==='资料到了复核时间');
    check(await p.locator('dialog').isHidden(),'expiry closes open leaf');
    check(await p.locator('#reading-copy').textContent()==='','expiry erases moved node');
    check(await cleanPaperMotion(),'expiry cancels paper animation without a lingering overlay');
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
    await p.locator('#audio button').click();await p.waitForFunction(()=>__audios.some(a=>!a.paused));
    const closingAudio=await p.locator('.journey-leaf-close').evaluate(e=>{e.click();return {paused:__audios.every(a=>a.paused),state:document.querySelector('#journey-leaf-dialog').dataset.state};});
    check(closingAudio.paused&&closingAudio.state==='closing','starting close pauses narration synchronously before the return animation');
    await p.locator('#journey-leaf-dialog').waitFor({state:'hidden'});
    check(await p.evaluate(()=>__audios.every(a=>a.paused)),'closing pauses manually played narration');
    await open('reading');check(await p.evaluate(()=>__audios.every(a=>a.paused)),'reopening never autoplays');await close();
    // A pre-open play validation which completes late must not cause playback behind the paper.
    await go();let releaseAudio;const audioBlocked=new Promise(r=>{releaseAudio=r;});
    await p.route('**/__journey',async route=>{const response=await route.fetch();await audioBlocked;await route.fulfill({response});});
    await p.locator('#audio button').click();await p.locator('#reading > button').click();await p.locator('dialog[aria-busy=true]').waitFor();
    releaseAudio();await p.locator('dialog[aria-busy=false]').waitFor();await p.waitForTimeout(200);
    check(await p.evaluate(()=>__audios.every(a=>a.paused&&!a.getAttribute('src'))),'late play canceled by open');
    await close();await p.unroute('**/__journey');
    // A validated play response may arrive during the 700ms return. Closing must
    // cancel that intent immediately, not wait until the paper has disappeared.
    await go();await open('reading');
    let releaseClosingAudio,capturedClosingAudio;
    const closingAudioBlocked=new Promise(resolve=>{releaseClosingAudio=resolve;}),closingAudioCaptured=new Promise(resolve=>{capturedClosingAudio=resolve;});
    await p.route('**/__journey',async route=>{const response=await route.fetch();capturedClosingAudio();await closingAudioBlocked;await route.fulfill({response});});
    await p.locator('#audio button').click();await closingAudioCaptured;
    const pendingClose=await p.locator('.journey-leaf-close').evaluate(e=>{e.click();return {state:document.querySelector('#journey-leaf-dialog').dataset.state,paused:__audios.every(a=>a.paused&&!a.getAttribute('src'))};});
    check(pendingClose.state==='closing'&&pendingClose.paused,'close invalidates pending play while the paper is still visible');
    releaseClosingAudio();await p.waitForTimeout(180);
    check(await p.evaluate(()=>__audios.every(a=>a.paused&&!a.getAttribute('src'))),'late validation never starts audio during return animation');
    await p.locator('#journey-leaf-dialog').waitFor({state:'hidden'});
    check(await p.evaluate(()=>__audios.every(a=>a.paused&&!a.getAttribute('src'))),'late play remains canceled after return completes');
    await p.unroute('**/__journey');await scenario('reset');
    check(actions.every(a=>a==='getSiteExploration'),'UI uses only existing public reads');
    const q=await b.newPage({viewport:{width:320,height:700},reducedMotion:'reduce'});q.on('pageerror',e=>errors.push(e.message));
    await q.route('**/paper-fibres-soft-v1.webp',r=>r.abort());await q.goto(s.url+'/explore-journey.html?resourceId=r');await q.locator('#content:not([hidden])').waitFor();
    await open('reading',q);check(await q.locator('dialog').evaluate(e=>getComputedStyle(e).animationName)==='none','reduced motion');
    check(await cleanPaperMotion(q),'reduced reading has no transient transform layers');
    check(await q.locator('#reading-copy').isVisible(),'missing texture keeps copy');await q.keyboard.press('Escape');check(await q.locator('dialog').isHidden(),'reduced close immediate');await q.close();
    for(const missing of ['exploration-leaf-motion.js','gsap-3.15.0.min.js']){
      const fallback=await b.newPage();fallback.on('pageerror',e=>errors.push(e.message));
      await fallback.route('**/'+missing,route=>route.abort());await fallback.goto(s.url+'/explore-journey.html?resourceId=r');await fallback.locator('#content:not([hidden])').waitFor();
      await open('reading',fallback);check(await fallback.locator('#reading-copy').isVisible(),'missing '+missing+' retains verified reading');
      check(await cleanPaperMotion(fallback),'missing '+missing+' has clean static paper');await close(fallback);
      check(await fallback.evaluate(()=>!document.documentElement.classList.contains('journey-leaf-open')),'missing '+missing+' releases page scroll');await fallback.close();
    }
    const r=await b.newPage();r.on('pageerror',e=>errors.push(e.message));await r.route('**/exploration-journey-leaves.js',route=>route.abort());await r.goto(s.url+'/explore-journey.html?resourceId=r');await r.locator('#content:not([hidden])').waitFor();
    await r.locator('#reading summary').click();await r.locator('#reading-copy').waitFor();check(await r.locator('#reading-copy').isVisible(),'script failure keeps native fallback');
    await r.locator('#reading summary').click();
    let releaseFallback,capturedFallback;
    const fallbackBlocked=new Promise(resolve=>{releaseFallback=resolve;}),fallbackCaptured=new Promise(resolve=>{capturedFallback=resolve;});
    await r.route('**/__journey',async route=>{const response=await route.fetch();capturedFallback();await fallbackBlocked;await route.fulfill({response});});
    await r.locator('#reading summary').focus();await r.keyboard.press('Enter');await fallbackCaptured;
    check(await r.locator('#reading').evaluate(e=>!e.open),'native disclosure stays closed while rechecking');
    check(await r.locator('#reading-copy').isHidden(),'native fallback does not flash cached reading during validation');
    releaseFallback();await r.locator('#reading-copy').waitFor();check(await r.locator('#reading-copy').isVisible(),'native fallback opens only after a valid response');
    await r.unroute('**/__journey');await r.locator('#reading summary').click();
    await scenario('withdraw');await r.locator('#reading summary').click();await r.locator('#retry:not([hidden])').waitFor();
    check(await r.locator('#reading-copy').isHidden(),'native fallback never reveals withdrawn reading');
    check(await r.locator('#reading-copy').textContent()===''&&await r.locator('#source-list').textContent()==='','native fallback erases withdrawn content and sources');
    await r.close();await scenario('reset');
    check(errors.length===0,JSON.stringify(errors));
    console.log('PASS visitor paper leaves: '+checks+' checks; disclosure/state/focus/verification/expiry/privacy/responsive/fallback.');
  }finally{await b.close();await s.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
