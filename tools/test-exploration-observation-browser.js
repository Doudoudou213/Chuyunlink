'use strict';
// Isolated Edge and local fake public data only. No real account, cloud write or telemetry.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const {start} = require('./lib/exploration-journey-preview');
const scenes = require('../static/exploration-journey-study-scenes');
const output = path.join(__dirname,'../artifacts/exploration-journey-live/observation');
let checks = 0;
const check = (value,label) => {assert(value,label);checks++;};
(async()=>{
  const server=await start();let browser;
  const errors=[],external=[],actions=[];
  const open=async page=>{await page.locator('#reading > .journey-leaf-trigger').click();await ready(page);};
  const ready=page=>page.locator('#journey-leaf-dialog[open][data-leaf=reading][data-state=open][aria-busy=false]').waitFor();
  const close=async page=>{await page.locator('.journey-leaf-close').click();await page.locator('#journey-leaf-dialog').waitFor({state:'hidden'});};
  const zoom=page=>page.locator('#journey-study .journey-study-controls button');
  const keep=page=>page.locator('#journey-study .journey-study-keep button');
  const record=page=>page.evaluate(()=>Object.values(JSON.parse(localStorage.getItem('chulink:journey-content:v1:r')||'{}'))[0]||null);
  const detail=async(page,key)=>{await page.waitForFunction(key=>document.querySelector('#journey-study').dataset.detail===key,key);};
  async function make(options={}) {
    const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'reduce',...options});
    page.on('pageerror',error=>errors.push(error.message));
    page.on('request',request=>{if(request.url().endsWith('/__journey'))actions.push(request.postDataJSON()?.action);});
    await page.route('**/*',route=>{
      const url=route.request().url();
      if(!url.startsWith(server.url+'/')&&!url.startsWith('data:')){external.push(url);return route.abort();}
      return route.continue();
    });
    await page.goto(server.url+'/explore-journey.html?resourceId=r');
    await page.locator('#content:not([hidden])').waitFor();return page;
  }
  async function held(page) {
    let release,seen,done;
    const wait=new Promise(resolve=>{release=resolve;}),captured=new Promise(resolve=>{seen=resolve;}),finished=new Promise(resolve=>{done=resolve;});
    const handler=async route=>{try{const response=await route.fetch();seen();await wait;await route.fulfill({response});}finally{done();}};
    await page.route('**/__journey',handler);
    return {captured,release,clear:async()=>{await finished;await page.unroute('**/__journey',handler);}};
  }
  try {
    browser=await chromium.launch({channel:'msedge',headless:true});fs.mkdirSync(output,{recursive:true});
    const p=await make();await open(p);
    check(await p.locator('.journey-study-looks').isHidden(),'no extra choices before opting into detail');
    check(await p.locator('.journey-study-keep').isHidden(),'no extra keep control before detail');
    check((await record(p))?.observed?.length!==1,'opening does not mark a scene');
    const expectedReading=await p.locator('#reading-copy').textContent();
    for(const [id,scene] of Object.entries(scenes)) {
      if(id!=='tower') {await close(p);await p.locator('[data-stop='+id+']').click();await ready(p);}
      const original=await p.locator('#reading-copy').textContent();
      await zoom(p).click();await detail(p,scene.looks[0].key);
      check(await p.locator('.journey-study-looks button').count()===2,id+' has only two detail choices');
      check(await p.locator('.journey-study-looks button[aria-pressed=true]').textContent()===scene.looks[0].label,id+' starts at first registered view');
      const before=await p.locator('.journey-study-art').getAttribute('transform');
      await p.locator('[data-look="'+scene.looks[1].key+'"]').click();await detail(p,scene.looks[1].key);
      const after=await p.locator('.journey-study-art').getAttribute('transform');
      check(before!==after,id+' second view changes original-art framing');
      check(await p.locator('#journey-study svg image').count()===1,id+' never pastes a second image on the scene');
      check((await record(p))?.details?.every(value=>value.pointId!==id)!==false,id+' zoom/choice does not save a detail');
      check(await p.locator('#reading-copy').textContent()===original,id+' viewing does not rewrite source text');
      await keep(p).click();await p.waitForFunction(()=>document.querySelector('.journey-study-keep button').textContent==='已留在游记');
      const saved=await record(p);
      check(saved.observed.includes(id),id+' explicit keep counts as a reading observation, not a visit');
      check(saved.details.filter(value=>value.pointId===id).length===1,id+' explicit keep stores once');
      check(saved.details.find(value=>value.pointId===id).detailKey===scene.looks[1].key,id+' stores stable selected key');
      check(Object.keys(saved.details.find(value=>value.pointId===id)).sort().join(',')==='detailKey,pointId,sceneId',id+' record stores IDs only, no prose/source/media');
      check(await keep(p).isDisabled(),id+' already-kept detail cannot duplicate');
      await zoom(p).click();await detail(p,'whole');
      await zoom(p).click();await detail(p,scene.looks[0].key);
      check(await keep(p).isEnabled(),id+' another detail remains optional');
      await p.locator('[data-look="'+scene.looks[1].key+'"]').click();await detail(p,scene.looks[1].key);
      check(await keep(p).isDisabled(),id+' returning to kept detail remembers selection');
    }
    await p.locator('#journey-leaf-next').click();await p.locator('#finished:not([hidden])').waitFor();
    check((await p.locator('#souvenir-details').textContent()).includes(scenes.pond.looks[1].label),'souvenir contains chosen detail labels');
    check((await p.locator('#souvenir-details li').count())===4,'four explicit selections reach souvenir');
    await p.close();

    for(const viewport of [{width:320,height:740},{width:390,height:844},{width:768,height:1024},{width:1440,height:900},{width:667,height:320}]) {
      const q=await make({viewport});await open(q);await zoom(q).click();await detail(q,'eaves');
      for(const selector of ['.journey-study-looks button','.journey-study-keep button']) for(const button of await q.locator(selector).all()) {
        await button.scrollIntoViewIfNeeded();
        check(await button.evaluate(node=>{const r=node.getBoundingClientRect();return r.width>=44&&r.height>=44&&r.left>=0&&r.right<=innerWidth;}),viewport.width+'x'+viewport.height+' detail target fits and is at least 44px');
      }
      check(await q.locator('#journey-leaf-body').evaluate(node=>node.scrollWidth<=node.clientWidth+1),'paper no horizontal overflow '+viewport.width);
      check(await q.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'page no horizontal overflow '+viewport.width);
      await q.locator('.journey-study-looks button').last().focus();await q.keyboard.press('Enter');await detail(q,'eaves-rhythm');
      check(await q.locator('.journey-study-looks button').last().getAttribute('aria-pressed')==='true','keyboard selects second view '+viewport.width);
      await q.screenshot({path:path.join(output,'details-'+viewport.width+'x'+viewport.height+'.png')});await q.close();
    }

    const late=await make();await open(late);await zoom(late).click();await detail(late,'eaves');
    const pending=await held(late);await keep(late).click();await pending.captured;
    check(await keep(late).isDisabled(),'keep disabled during verification');
    await late.keyboard.press('Escape');await late.locator('dialog').waitFor({state:'hidden'});pending.release();await pending.clear();
    await late.waitForTimeout(100);
    check(!(await record(late))?.details?.length,'closing during verification saves nothing');
    check(await late.locator('#journey-study').getAttribute('data-detail')==='whole','late response does not reopen or rezoom');await late.close();

    const reduced=await make();await open(reduced);await zoom(reduced).click();await detail(reduced,'eaves');
    await reduced.locator('[data-look=eaves-rhythm]').click();await detail(reduced,'eaves-rhythm');
    check(await reduced.locator('.journey-study-art').evaluate(node=>!gsap.isTweening(node)&&!node.style.willChange),'reduced-motion second view has no active tween');await reduced.close();
    // Module-level gates use a separate temporary host inside the actual paper.
    // These deterministic callbacks test an absent/denied grant and save errors;
    // they do not impersonate a backend approval or write a reading record.
    const gates=await make();await open(gates);
    await gates.evaluate(()=>{
      const host=document.createElement('section');host.id='observation-gate-test';host.className='journey-study';
      document.querySelector('#journey-leaf-body').append(host);
      window.__observationAllowed=undefined;window.__observationSaved=false;window.__observationKeeps=0;
      window.__observationModule=ChuJourneyStudy.create(host,{
        verify:()=>window.__observationAllowed,
        onObservation:()=>{window.__observationKeeps++;return window.__observationSaved;}
      });
      window.__observationModule.mount({id:'tower',artScene:'tower'},true,[]);
    });
    const gateToggle=gates.locator('#observation-gate-test .journey-study-controls button');
    await gates.waitForFunction(()=>!document.querySelector('#observation-gate-test .journey-study-controls button').disabled);
    for(const grant of [undefined,false,'true',1]) {
      await gates.evaluate(value=>{window.__observationAllowed=value;},grant);
      await gateToggle.click();await gates.waitForFunction(()=>!document.querySelector('#observation-gate-test .journey-study-controls button').disabled);
      check(await gates.locator('#observation-gate-test').getAttribute('data-detail')==='whole','non-boolean-true verification cannot reveal new detail: '+String(grant));
    }
    await gates.evaluate(()=>{window.__observationAllowed=true;});await gateToggle.click();
    await gates.waitForFunction(()=>document.querySelector('#observation-gate-test').dataset.detail==='eaves');
    const gateKeep=gates.locator('#observation-gate-test .journey-study-keep button');
    await gateKeep.click();
    await gates.waitForFunction(()=>document.querySelector('#observation-gate-test .journey-study-caption').textContent.includes('稍后再试'));
    check(await gateKeep.isEnabled(),'failed save does not falsely acknowledge or block retry');
    check(await gates.evaluate(()=>window.__observationKeeps===1),'explicit failed save calls once');
    await gates.evaluate(()=>{window.__observationSaved=true;});await gateKeep.click();
    await gates.waitForFunction(()=>document.querySelector('#observation-gate-test .journey-study-keep button').textContent==='已留在游记');
    check(await gateKeep.isDisabled(),'only explicit successful callback acknowledges a selection');
    await gates.evaluate(()=>{
      window.__observationModule.setRecorded([{pointId:'copper',sceneId:'tower',detailKey:'eaves'},{pointId:'tower',sceneId:'copper',detailKey:'eaves'},{pointId:'tower',sceneId:'tower',detailKey:'unknown'}]);
    });
    check(await gateKeep.isEnabled(),'cross-point, cross-scene and unknown detail records cannot mark this scene');
    await gates.evaluate(()=>{window.__observationModule.destroy();document.querySelector('#observation-gate-test').remove();});await gates.close();
    check(external.length===0,'no external service or asset requests');
    check(actions.every(action=>action==='getSiteExploration'),'observation only rechecks public content');
    check(errors.length===0,'no browser exceptions: '+errors.join(';'));
    console.log('PASS original-art observation browser: '+checks+' checks; '+output);
  } finally {await browser?.close();await server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
