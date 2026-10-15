'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright'),{start}=require('./lib/exploration-journey-preview');
let checks=0;function check(value,name){assert(value,name);checks++;}
(async()=>{
  const s=await start(),browser=await chromium.launch({channel:'msedge',headless:true});
  const out=path.join(__dirname,'../artifacts/exploration-journey-live');fs.mkdirSync(out,{recursive:true});
  try{
    const p=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],writes=[];
    p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(r.url().endsWith('/__admin')&&!/^(get|whoami|preview)/.test(r.postDataJSON().action))writes.push(r.postDataJSON().action);});
    const open=async id=>{await p.locator('#'+id+' > .paper-entry-trigger').click();await p.locator('#ja-paper-dialog[data-page="'+id+'"][open]').waitFor();};
    const close=async()=>{await p.locator('.paper-close').click();await p.locator('#ja-paper-dialog').waitFor({state:'hidden'});};
    const go=async()=>{await p.goto(s.url+'/explore-admin.html');await p.locator('#wa-load').click();await p.locator('#wa-editor:not([hidden])').waitFor();};
    await go();
    check(await p.locator('#wa-editor details').count()===0,'static disclosures enhanced');
    await open('ja-edit');
    check(await p.locator('#ja-paper-title').evaluate(e=>e===document.activeElement),'title receives focus');
    await p.locator('#wa-title').fill('纸页里留下的修改');
    await p.keyboard.press('Escape');await p.locator('#ja-paper-dialog').waitFor({state:'hidden'});
    check(await p.locator('#ja-edit > button').evaluate(e=>e===document.activeElement),'escape returns focus');
    await open('ja-edit');check(await p.locator('#wa-title').inputValue()==='纸页里留下的修改','close retains same input');
    check(writes.length===0,'opening/closing/editing never auto-save');
    // Native modal contains keyboard focus and blocks background controls.
    await p.locator('.paper-return').focus();await p.keyboard.press('Tab');
    check(await p.evaluate(()=>document.querySelector('#ja-paper-dialog').contains(document.activeElement)),'tab wraps inside modal');
    await p.locator('#wa-load').evaluate(e=>e.focus());
    check(await p.evaluate(()=>document.querySelector('#ja-paper-dialog').contains(document.activeElement)),'background focus remains inert');
    for(const width of [320,390,768,1440]){
      await p.setViewportSize({width,height:900});await p.waitForTimeout(480);
      check(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'viewport no overflow '+width);
      check(await p.locator('.paper-scroll').evaluate(e=>e.scrollWidth<=e.clientWidth+1),'form no horizontal scroll '+width);
      check(await p.locator('.paper-close').evaluate(e=>{const r=e.getBoundingClientRect();return r.width>=44&&r.height>=44&&r.top>=0;}),'close reachable 44px '+width);
      check(await p.locator('.paper-return').evaluate(e=>e.getBoundingClientRect().bottom<=innerHeight),'footer reachable '+width);
      await p.screenshot({path:path.join(out,'paper-leaf-edit-'+width+'.png')});
    }
    await p.mouse.click(3,3);await p.locator('#ja-paper-dialog').waitFor({state:'hidden'});
    check(await p.evaluate(()=>!document.documentElement.classList.contains('paper-open')),'backdrop unlocks body');
    await open('ja-assets');await p.locator('#ea-attribution').fill('本地纸页输入测试');
    await open('ja-captions');await p.locator('#ea-caption-add').click();
    await p.locator('[data-caption-row] textarea').fill('这段文字只用于本地流程演示。');
    await p.locator('.paper-back').click();
    check(await p.locator('#ja-paper-dialog').getAttribute('data-page')==='ja-assets','nested back to parent');
    check(await p.locator('#ea-attribution').inputValue()==='本地纸页输入测试','parent form retained');
    check(await p.locator('#ja-captions > button').evaluate(e=>document.activeElement===e),'back focus on nested entry');
    await open('ja-captions');check(await p.locator('[data-caption-row] textarea').inputValue()==='这段文字只用于本地流程演示。','child form retained');
    check(await p.locator('dialog[open]').count()===1,'only one modal layer');
    await close();
    // Global errors remain visible when underlying business reports into #wa-message.
    await open('ja-edit');await p.locator('#wa-message').evaluate(e=>{e.textContent='本地测试：版本变化，请重新打开';});
    await p.getByRole('status').filter({hasText:'本地测试：版本变化，请重新打开'}).last().waitFor();
    check(await p.locator('.paper-message').isVisible(),'global error visible in modal');await close();
    // Stale dynamically generated pages close instead of retaining an invalid report.
    await p.locator('#wa-load').click();await p.locator('#er-check').click();
    await p.locator('#er-all > .paper-entry').first().waitFor({state:'attached'});
    await open('er-more');await p.locator('#er-all .paper-entry-trigger').first().click();
    await p.evaluate(()=>window.SiteWalkReadiness.invalidate());
    await p.locator('#ja-paper-dialog').waitFor({state:'hidden'});
    check(await p.locator('#er-all').textContent()==='','invalidated report not kept by modal');
    check(await p.locator('dialog .paper-entry-content').count()===0,'invalidated content removed from dialog');
    // Shared publisher creates new source disclosures; enhancement keeps them readable.
    await p.locator('#wa-load').click();await p.locator('#wa-save').click();
    await p.waitForFunction(()=>document.querySelector('#wa-message').textContent.includes('草稿已保存'));
    await p.locator('#wa-preview').click();await p.locator('#wa-review:not([hidden])').waitFor();
    await p.locator('#wa-preview-content .paper-entry-trigger').first().click();
    check((await p.locator('.paper-scroll').textContent()).includes('画稿'),'dynamic sources readable');
    await p.locator('#wa-review').evaluate(e=>{e.hidden=true;});await p.locator('#ja-paper-dialog').waitFor({state:'hidden'});
    check(await p.locator('dialog .paper-entry-content').count()===0,'hidden preview discards source leaf');
    check(!await p.locator('#wa-confirm').isChecked(),'modal never confirms review');
    // A registered asset has data-point too: saving must only collect real point forms.
    await open('ja-assets');await p.locator('#ea-url').fill('https://example.com/paper-test.webp');
    await p.locator('#ea-attribution').fill('本地测试署名');await p.locator('#ea-note').fill('固定本地许可，不代表真实素材授权');
    await p.locator('#ea-until').fill(new Date(Date.now()+3600000-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16));
    await p.locator('#ea-confirm').check();await p.locator('#ea-save').click();
    await p.waitForFunction(()=>document.querySelector('#ea-message').textContent.includes('素材已绑定草稿'));
    await p.locator('#ea-items [data-bind]').first().waitFor();await close();await p.locator('#wa-save').click();
    await p.waitForFunction(()=>document.querySelector('#wa-message').textContent.includes('草稿已保存'),null,{timeout:5000});
    check((await s.fixture.call({action:'getSiteWalkDraft',resourceId:'r'})).root.draft.exploration.objects[0].imageId,'registered asset binding survives save');
    // Reduced motion + blocked texture stay functional.
    const q=await browser.newPage({viewport:{width:320,height:700},reducedMotion:'reduce'});
    await q.route('**/paper-fibres-soft-v1.webp',r=>r.abort());await q.goto(s.url+'/explore-admin.html');await q.locator('#wa-load').click();
    await q.locator('#ja-edit > button').click();
    check(await q.locator('#ja-paper-dialog').evaluate(e=>getComputedStyle(e).animationName)==='none','reduced motion honored');
    await q.locator('#wa-title').fill('纹理失败仍可编辑');await q.keyboard.press('Escape');
    check(await q.locator('#ja-paper-dialog').isHidden(),'reduced close immediate');await q.close();
    // Component failure falls back to native disclosure, not inaccessible hidden forms.
    const r=await browser.newPage();await r.route('**/exploration-admin-paper.js',route=>route.abort());
    await r.goto(s.url+'/explore-admin.html');await r.locator('#wa-load').click();await r.locator('#ja-edit > summary').click();
    check(await r.locator('#wa-title').isVisible(),'progressive fallback usable');await r.close();
    check(errors.length===0,JSON.stringify(errors));
    console.log('PASS paper admin: '+checks+' checks; modal/focus/back/state/invalidations/asset-save/responsive/reduced motion/fallback.');
  }finally{await browser.close();await s.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
