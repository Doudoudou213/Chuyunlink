'use strict';
// All data are the local reviewed fixture. No real account, location or cloud writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright'),{start}=require('./lib/exploration-journey-preview');
let checks=0;function check(value,name){assert(value,name);checks++;}
const storageKey='chulink:journey-content:v1:r';
(async()=>{
  const server=await start(),browser=await chromium.launch({channel:'msedge',headless:true});
  const out=path.join(__dirname,'../artifacts/exploration-journey-live/continuation');fs.mkdirSync(out,{recursive:true});
  const errors=[],actions=[],external=[];
  async function page(options={}){
    const p=await browser.newPage({viewport:{width:390,height:900},...options});
    p.on('pageerror',e=>errors.push(e.message));
    p.on('request',r=>{if(!r.url().startsWith(server.url+'/')&&!r.url().startsWith('data:'))external.push(r.url());if(r.url().endsWith('/__journey'))actions.push(r.postDataJSON().action);});
    return p;
  }
  const go=async(p,query='')=>{await p.goto(server.url+'/explore-journey.html?resourceId=r'+query);await p.locator('#content:not([hidden])').waitFor();};
  const settled=async(p,title)=>{if(title)await p.waitForFunction(title=>document.querySelector('#journey-leaf-title').textContent===title,title);await p.locator('#journey-leaf-dialog[open][data-leaf=reading][data-state=open][aria-busy=false]').waitFor();};
  const open=async p=>{await p.locator('#reading > .journey-leaf-trigger').click();await settled(p);};
  const close=async p=>{await p.locator('.journey-leaf-close').click();await p.locator('#journey-leaf-dialog').waitFor({state:'hidden'});};
  const scenario=async kind=>{const q=await browser.newPage();await q.goto(server.url+'/preview-control.html');await q.locator('[data-kind='+kind+']').click();await q.waitForFunction(()=>document.querySelector('#result').textContent.includes('已完成'));await q.close();};
  async function holdNext(p){
    let release,capture,used=false;
    const held=new Promise(resolve=>{release=resolve;}),captured=new Promise(resolve=>{capture=resolve;});
    const handler=async route=>{if(used){await route.continue();return;}used=true;const response=await route.fetch();capture();await held;await route.fulfill({response});};
    await p.route('**/__journey',handler);
    return {captured,release,clear:()=>p.unroute('**/__journey',handler)};
  }
  try{
    const p=await page();await go(p);
    check(await p.locator('#journey-leaf-dialog').isHidden(),'initial entry does not force reading open');
    check(await p.locator('#journey-resume').isHidden(),'fresh reader has no invented resume progress');
    const initialHistory=await p.evaluate(()=>history.length);
    await open(p);
    check(await p.locator('#journey-leaf-next').isVisible(),'reading leaf has a direct next action');
    check((await p.locator('#journey-leaf-next').textContent()).includes('古铜顶'),'next action names its actual destination');
    const held=await holdNext(p),beforeNextReads=actions.length;
    await p.locator('#journey-leaf-next').evaluate(e=>{e.click();e.click();});await held.captured;
    check(await p.locator('#journey-leaf-next').isDisabled(),'pending continuation cannot be activated twice');
    check(actions.length===beforeNextReads+1,'double activation starts only one public recheck');
    held.release();await settled(p,'古铜顶');await held.clear();
    check(await p.locator('[data-recorded=true]').count()===0,'continuing never marks a visit or reading credit');
    check(await p.evaluate(()=>new URL(location.href).searchParams.get('pointId'))==='copper','continuation synchronizes current point into URL');
    check(await p.evaluate(n=>history.length<=n+1,initialHistory),'one modal history slot is reused for continuation');
    for(const title of ['白云阁','鹅池']){await p.locator('#journey-leaf-next').click();await settled(p,title);}
    check((await p.locator('#journey-leaf-next').textContent()).includes('收卷'),'last paper explicitly offers closing the scroll');
    await p.locator('#journey-leaf-next').click();await p.locator('#finished:not([hidden])').waitFor();
    check(await p.locator('#journey-leaf-dialog').isHidden(),'last continuation closes the paper before souvenir');
    check((await p.locator('#souvenir-count').textContent()).includes('0 / 4'),'finishing does not manufacture recorded observations');
    check(await p.locator('#souvenir-stops li').count()===0,'unrecorded scenes stay absent from personal souvenir');
    await p.close();

    // Cancel a pending verified transition. A response captured before cancellation
    // must not navigate or reopen the paper after the reader changes their mind.
    for(const method of ['close','back','background']){
      const q=await page();await go(q);await open(q);const hold=await holdNext(q);
      await q.locator('#journey-leaf-next').click();await hold.captured;
      if(method==='close')await close(q);
      else if(method==='back'){await q.evaluate(()=>history.back());await q.locator('#journey-leaf-dialog').waitFor({state:'hidden'});}
      else{await q.evaluate(()=>{const back=history.back.bind(history);window.__backgroundBacks=0;history.back=()=>{window.__backgroundBacks++;back();};Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});await q.locator('#journey-leaf-dialog').waitFor({state:'hidden'});}
      hold.release();await q.waitForTimeout(350);await hold.clear();
      if(method==='background'){check(await q.evaluate(()=>window.__backgroundBacks===0),'background cleanup never traverses browser history');await q.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});await q.locator('#content:not([hidden])').waitFor();}
      check(await q.locator('#point-title').textContent()==='黄鹤楼',method+' cancels pending next before advancing');
      check(await q.locator('#journey-leaf-dialog').isHidden(),method+' prevents delayed response reopening paper');
      check(new URL(q.url()).pathname==='/explore-journey.html',method+' keeps reader on the current visitor page');
      check(await q.locator('[data-recorded=true]').count()===0,method+' cancellation does not record a scene');
      await q.close();
    }
    const interrupted=await page();await go(interrupted);await open(interrupted);
    await interrupted.locator('#journey-leaf-next').click();await interrupted.locator('#journey-leaf-dialog[data-state=closing]').waitFor();
    await interrupted.setViewportSize({width:768,height:800});await interrupted.locator('#journey-leaf-dialog').waitFor({state:'hidden'});await interrupted.waitForTimeout(250);
    check(await interrupted.locator('#point-title').textContent()==='黄鹤楼','resize during return cancels continuation rather than committing it');
    check(await interrupted.locator('#journey-leaf-dialog').isHidden(),'canceled return does not reopen a later paper');await interrupted.close();
    for(const cancel of ['escape','close']){
      const q=await page();await go(q);await open(q);await q.locator('#journey-leaf-next').click();await q.locator('#journey-leaf-dialog[data-state=closing]').waitFor();
      if(cancel==='escape')await q.keyboard.press('Escape');else await q.locator('.journey-leaf-close').evaluate(e=>e.click());
      await q.locator('#journey-leaf-dialog').waitFor({state:'hidden'});await q.waitForTimeout(250);
      check(await q.locator('#point-title').textContent()==='黄鹤楼',cancel+' during paper return cancels the planned next scene');
      check(await q.locator('#journey-leaf-dialog').isHidden(),cancel+' during paper return cannot reopen a paper');await q.close();
    }
    const delayedBack=await page();await go(delayedBack);await open(delayedBack);
    await delayedBack.evaluate(()=>{const back=history.back.bind(history);history.back=()=>setTimeout(back,400);});await close(delayedBack);
    await delayedBack.locator('#next').click();await delayedBack.waitForTimeout(80);
    check(await delayedBack.locator('#point-title').textContent()==='黄鹤楼','main next waits for the preceding delayed modal history traversal');
    await delayedBack.waitForFunction(()=>document.querySelector('#point-title').textContent==='古铜顶');
    check(await delayedBack.evaluate(()=>new URL(location.href).searchParams.get('pointId'))==='copper','post-close next writes current URL after delayed history settles');
    check(await delayedBack.locator('#journey-leaf-dialog').isHidden(),'ordinary next after delayed close does not force paper open');await delayedBack.close();

    // Availability remains server-controlled at each continuation boundary.
    for(const kind of ['withdraw','pause','reorder','offline']){
      await scenario('reset');const q=await page();await go(q);await open(q);await scenario(kind);
      await q.locator('#journey-leaf-next').click();await q.locator('#retry:not([hidden])').waitFor();
      check(await q.locator('#journey-leaf-dialog').isHidden(),kind+' blocks the next paper');
      check(await q.locator('#reading-copy').textContent()==='',kind+' clears old public copy');
      check(await q.locator('#content').isHidden(),kind+' hides unverified scene controls');await q.close();
    }
    await scenario('reset');
    const late=await page();await go(late);await open(late);const oldResponse=await holdNext(late);
    await late.locator('#journey-leaf-next').click();await oldResponse.captured;await scenario('withdraw');oldResponse.release();await late.locator('#retry:not([hidden])').waitFor();await oldResponse.clear();
    check(await late.locator('#journey-leaf-dialog').isHidden(),'a formerly valid next response cannot expose a withdrawn next scene');
    check(await late.locator('#reading-copy').textContent()==='','late valid response is rechecked before displaying new prose');
    check(await late.locator('[data-recorded=true]').count()===0,'late source failure never records a scene');await late.close();await scenario('reset');

    // Back consumes a modal entry, not the visit. Forward cannot resurrect cached
    // prose; a new explicit reading action must repeat public verification.
    const h=await page();await h.goto(server.url+'/trial-start.html');await go(h);
    const historyBase=await h.evaluate(()=>history.length);
    for(let cycle=0;cycle<3;cycle++){
      await open(h);await h.evaluate(()=>history.back());await h.locator('#journey-leaf-dialog').waitFor({state:'hidden'});
      check(new URL(h.url()).pathname==='/explore-journey.html','Back first closes paper, cycle '+cycle);
      check(await h.locator('#reading-copy').isHidden(),'Back hides detached reading, cycle '+cycle);
      await h.evaluate(()=>history.forward());await h.waitForTimeout(150);
      check(await h.locator('#journey-leaf-dialog').isHidden(),'Forward does not resurrect a cached paper, cycle '+cycle);
      const before=actions.length;await open(h);
      check(actions.length>before,'reading after Forward revalidates public content, cycle '+cycle);
      await close(h);await h.waitForTimeout(100);
      check(await h.evaluate(n=>history.length<=n+1,historyBase),'repeated open/back/forward does not accumulate history, cycle '+cycle);
    }
    // Forward's dormant slot may select a different scene before being reused.
    // Returning from that leaf must synchronize the older base entry as well.
    await h.evaluate(()=>history.forward());await h.waitForTimeout(150);await h.locator('#next').click();await h.waitForFunction(()=>document.querySelector('#point-title').textContent==='古铜顶');
    await open(h);await close(h);await h.waitForTimeout(100);
    check(await h.locator('#point-title').textContent()==='古铜顶','closing a reused dormant slot preserves the newly selected scene');
    check(await h.evaluate(()=>new URL(location.href).searchParams.get('pointId'))==='copper','returning to an older base entry updates its stale point address');
    check(await h.evaluate(n=>history.length<=n+1,historyBase),'dormant-slot scene changes still reuse one modal entry');
    await h.reload();await h.locator('#content:not([hidden])').waitFor();
    check(await h.locator('#point-title').textContent()==='古铜顶','refresh after reused-slot close never restores the old URL scene');
    check(await h.locator('#journey-resume').isVisible(),'refreshed reused-slot scene offers its current local position');
    check(await h.locator('#journey-leaf-dialog').isHidden(),'refresh of a reused history slot does not reopen cached prose');
    await open(h);await h.evaluate(()=>history.back());await h.locator('#journey-leaf-dialog').waitFor({state:'hidden'});
    await scenario('withdraw');await h.evaluate(()=>history.forward());await h.waitForTimeout(100);
    check(await h.locator('#journey-leaf-dialog').isHidden(),'Forward after withdrawal never shows old text');
    await h.locator('#reading > .journey-leaf-trigger').click();await h.locator('#retry:not([hidden])').waitFor();
    check(await h.locator('#reading-copy').textContent()==='','manual read after Forward observes source withdrawal');await h.close();await scenario('reset');

    const resume=await page();await go(resume,'&pointId=copper');
    check(await resume.locator('#point-title').textContent()==='古铜顶','explicit deep link selects its requested point');
    await resume.locator('#next').click();await resume.waitForFunction(()=>document.querySelector('#point-title').textContent==='白云阁');
    check(await resume.evaluate(()=>new URL(location.href).searchParams.get('pointId'))==='baiyun','next updates a consumed deep link');
    await resume.reload();await resume.locator('#content:not([hidden])').waitFor();
    check(await resume.locator('#point-title').textContent()==='白云阁','refresh never jumps back to stale deep-link point');
    check(await resume.locator('#journey-leaf-dialog').isHidden(),'saved position is restored without automatically opening a paper');
    check(await resume.locator('#journey-resume').isVisible(),'same-version saved position offers continue');
    check((await resume.locator('#resume-label').textContent()).includes('白云阁'),'resume names the restored position');
    const beforeResume=actions.length;await resume.locator('#continue-journey').click();await settled(resume,'白云阁');
    check(actions.length>beforeResume,'continue revalidates before displaying saved scene');
    check(await resume.locator('[data-recorded=true]').count()===0,'resume is not an implicit observation');await close(resume);
    await go(resume);check(await resume.locator('#point-title').textContent()==='白云阁','generic re-entry restores same-version local position');
    check(await resume.locator('#journey-resume').isVisible(),'generic re-entry still offers explicit continue');
    for(const width of [390,1440]){
      await resume.setViewportSize({width,height:900});await resume.locator('#journey-resume').scrollIntoViewIfNeeded();
      check(await resume.locator('#continue-journey').evaluate(e=>{const r=e.getBoundingClientRect();return r.width>=44&&r.height>=44;}),'saved-position continue touch target '+width);
      check(await resume.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'saved-position banner has no horizontal overflow '+width);
      await resume.screenshot({path:path.join(out,'resume-state-'+width+'.png'),fullPage:true});
    }
    const cleanSaved=await resume.evaluate(key=>JSON.parse(localStorage.getItem(key)),storageKey);
    check(!JSON.stringify(cleanSaved).includes('这段文字')&&!JSON.stringify(cleanSaved).includes('http'),'saved continuation contains no source text or media URLs');
    await resume.evaluate(key=>{const values=JSON.parse(localStorage.getItem(key));for(const value of Object.values(values))value.updatedAt=Date.now()-8*86400000;localStorage.setItem(key,JSON.stringify(values));},storageKey);
    await go(resume);check(await resume.locator('#point-title').textContent()==='黄鹤楼','expired local position does not restore');
    check(await resume.locator('#journey-resume').isHidden(),'expired position has no resume affordance');
    await resume.locator('#next').click();await resume.waitForFunction(()=>document.querySelector('#point-title').textContent==='古铜顶');
    await scenario('reorder');await go(resume);
    check(await resume.locator('#point-title').textContent()==='鹅池','new edition starts at its own published first point');
    check(await resume.locator('#journey-resume').isHidden(),'old edition resume is not inherited by new edition');
    check(await resume.evaluate(key=>Object.values(JSON.parse(localStorage.getItem(key))).some(record=>record.selected==='copper'),storageKey),'old edition private progress is preserved rather than discarded');
    await resume.close();await scenario('reset');

    // Resume availability is checked at activation, not trusted from its banner.
    const staleResume=await page();await go(staleResume);await staleResume.locator('#next').click();await staleResume.waitForFunction(()=>document.querySelector('#point-title').textContent==='古铜顶');await go(staleResume);
    await scenario('withdraw');await staleResume.locator('#continue-journey').click();await staleResume.locator('#retry:not([hidden])').waitFor();
    check(await staleResume.locator('#journey-leaf-dialog').isHidden(),'withdrawn saved position cannot be resumed');
    check(await staleResume.locator('#reading-copy').textContent()==='','failed resume does not restore cached public content');await staleResume.close();await scenario('reset');

    const responsive=await page();await go(responsive);
    for(const {width,height} of [{width:320,height:900},{width:390,height:900},{width:768,height:900},{width:1440,height:900},{width:667,height:320}]){
      await responsive.setViewportSize({width,height});await open(responsive);
      check(await responsive.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'continuation paper no horizontal overflow '+width);
      check(await responsive.locator('#journey-leaf-next').evaluate(e=>{const r=e.getBoundingClientRect();return r.width>=44&&r.height>=44&&r.bottom<=innerHeight;}),'next target remains reachable '+width);
      check(await responsive.locator('.journey-leaf-return').evaluate(e=>{const r=e.getBoundingClientRect();return r.width>=44&&r.height>=44&&r.bottom<=innerHeight;}),'return remains reachable '+width);
      await responsive.locator('#journey-leaf-next').focus();await responsive.keyboard.press('Tab');
      check(await responsive.locator('#journey-leaf-dialog').evaluate(dialog=>{
        const first=[...dialog.querySelectorAll('button,a[href],input,textarea,[tabindex="0"]')].find(node=>!node.disabled&&node.getClientRects().length);
        return Boolean(first)&&first===document.activeElement;
      }),'last continuation control traps focus at the first enabled visible control '+width);
      await responsive.screenshot({path:path.join(out,'continuation-paper-'+width+'.png')});await close(responsive);
    }
    await responsive.close();
    const longDraft=structuredClone(server.fixture.draft),longTitle='古铜顶与黄鹤楼层檐之间的画稿观察和草木留白细节';longDraft.points[1].title=longTitle;await server.fixture.publish(longDraft);
    const long=await page();await go(long);
    for(const viewport of [{width:320,height:900},{width:667,height:320}]){
      await long.setViewportSize(viewport);await open(long);
      check((await long.locator('#journey-leaf-next').getAttribute('aria-label'))==='下一景 · '+longTitle+' →','long destination remains complete for assistive technology '+viewport.width);
      check((await long.locator('#journey-leaf-next').getAttribute('title'))==='下一景 · '+longTitle+' →','long destination retains full hover label '+viewport.width);
      check(await long.locator('#journey-leaf-next').evaluate(e=>{const r=e.getBoundingClientRect();return e.scrollWidth<=e.clientWidth&&r.width>=44&&r.height>=44&&r.bottom<=innerHeight&&r.right<=innerWidth;}),'long destination fits reachable paper footer '+viewport.width);
      await long.screenshot({path:path.join(out,'continuation-long-title-'+viewport.width+'.png')});await close(long);
    }
    await long.close();await scenario('reset');

    const reduced=await page({reducedMotion:'reduce'});await go(reduced);await open(reduced);await reduced.locator('#journey-leaf-next').click();await settled(reduced,'古铜顶');
    check(await reduced.locator('#journey-leaf-dialog').evaluate(e=>getComputedStyle(e).transform==='none'),'reduced continuation settles without transform');
    check(await reduced.locator('[data-recorded=true]').count()===0,'reduced continuation preserves explicit recording');await reduced.close();
    for(const missing of ['exploration-leaf-motion.js','gsap-3.15.0.min.js']){
      const noMotion=await page();await noMotion.route('**/'+missing,route=>route.abort());await go(noMotion);await open(noMotion);await noMotion.locator('#journey-leaf-next').click();await settled(noMotion,'古铜顶');
      check(await noMotion.locator('#reading-copy').isVisible(),'missing '+missing+' still continues reading');await noMotion.close();
    }
    const noLeaf=await page();await noLeaf.route('**/exploration-journey-leaves.js',route=>route.abort());await go(noLeaf);await noLeaf.locator('#next').click();await noLeaf.waitForFunction(()=>document.querySelector('#point-title').textContent==='古铜顶');await go(noLeaf);
    await noLeaf.locator('#continue-journey').click();await noLeaf.locator('#reading-copy').waitFor();
    check(await noLeaf.locator('#reading').evaluate(e=>e.open),'native disclosure fallback can continue saved reading');
    check(await noLeaf.locator('[data-recorded=true]').count()===0,'native continuation does not award a record');await noLeaf.close();
    const noStorage=await page();await noStorage.addInitScript(()=>Object.defineProperty(window,'localStorage',{get(){throw Error('blocked');}}));await go(noStorage);await open(noStorage);await noStorage.locator('#journey-leaf-next').click();await settled(noStorage,'古铜顶');await close(noStorage);await go(noStorage);
    check(await noStorage.locator('#journey-resume').isHidden(),'blocked storage never promises saved continuation');
    check(await noStorage.locator('#point-title').textContent()==='黄鹤楼','no-storage generic re-entry uses fresh first point');await noStorage.close();

    check(actions.every(action=>action==='getSiteExploration'),'continuation uses only existing public reads');
    check(external.length===0,'no external services requested');
    check(errors.length===0,'no uncaught errors: '+JSON.stringify(errors));
    console.log('PASS journey continuation: '+checks+' checks; direct next/cancel/version/resume/history/responsive/reduced/fallback. '+out);
  }finally{await browser.close();await server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
