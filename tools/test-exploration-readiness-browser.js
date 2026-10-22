'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright'),{start}=require('./lib/exploration-journey-preview');let checks=0;
function check(v,msg){assert(v,msg);checks++;}
(async()=>{
  const server=await start(),browser=await chromium.launch({channel:'msedge',headless:true});
  const out=path.join(__dirname,'../artifacts/exploration-journey-live');fs.mkdirSync(out,{recursive:true});
  const actions=[],errors=[],external=[];
  try{
    const p=await browser.newPage({viewport:{width:390,height:900}});
    p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(!r.url().startsWith(server.url))external.push(r.url());if(r.url().endsWith('/__admin'))actions.push(r.postDataJSON().action);});
    const open=async id=>{await p.locator('#'+id+' > .paper-entry-trigger').click();await p.locator('#ja-paper-dialog[data-page="'+id+'"][open]').waitFor();};
    const close=async()=>{await p.locator('#ja-paper-dialog .paper-close').click();await p.locator('#ja-paper-dialog').waitFor({state:'hidden'});};
    const ready=async()=>{await p.locator('#er-check').click();await p.locator('#er-all > .paper-entry').first().waitFor({state:'attached'});};
    await p.goto(server.url+'/explore-admin.html');await p.locator('#wa-load').click();await p.locator('#wa-editor:not([hidden])').waitFor();
    check(await p.locator('#er-export').isHidden(),'export unavailable before check');
    for(const id of ['ja-edit','ja-map','ja-assets','er-more'])check(await p.locator('#'+id+' > .paper-entry-content').isHidden(),'content off canvas by default '+id);
    await ready();
    check(await p.locator('#er-all > .paper-entry').count()===4,'four point folios');
    check(await p.locator('#er-results > .paper-entry').count()===0,'complete points not repeated in default queue');
    check((await p.locator('#er-status').textContent()).includes('不代表审核通过'),'no readiness approval');
    for(const width of [320,390,768,1440]){
      await p.setViewportSize({width,height:900});
      check(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'simple view no overflow '+width);
      await p.evaluate(()=>scrollTo(0,0));await p.screenshot({path:path.join(out,'paper-admin-'+width+'.png'),fullPage:true});
    }
    await open('er-more');await p.locator('#er-all .paper-entry-trigger').first().click();
    check((await p.locator('#ja-paper-dialog').textContent()).includes('不用无声文件'),'missing audio explained');
    await p.locator('.paper-back').click();
    for(const width of [320,390,768,1440]){
      await p.setViewportSize({width,height:900});
      check(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no overflow '+width);
      check(await p.locator('#er-export').evaluate(e=>e.getBoundingClientRect().height>=44),'44px button '+width);
      await p.screenshot({path:path.join(out,'paper-readiness-'+width+'.png')});
    }
    const dl=p.waitForEvent('download');await p.locator('#er-export').click();const d=await dl,packet=fs.readFileSync(await d.path(),'utf8');
    check(d.suggestedFilename()==='导览现场资料采集单.txt','actual field packet');
    check(packet.includes('现场照片编号')&&packet.includes('核对人'),'useful field blanks');
    check(!packet.includes('local-reviewer'),'reviewer not exported');
    check(actions.every(a=>['whoami','getSiteWalkWorkspace','getSiteWalkDraft','getExplorationAssets'].includes(a)),'check/export make no write requests');
    await close();
    // Editor changes invalidate rather than quietly reporting the previously saved values.
    await open('ja-edit');await p.locator('#wa-title').fill('尚未保存的修改');
    check(await p.locator('#er-export').isHidden(),'unsaved change invalidates');await close();
    await p.locator('#er-check').click();check((await p.locator('#er-status').textContent()).includes('先保存'),'dirty check blocked');
    await p.locator('#wa-load').click();await ready();
    // Jump replaces the current folio, never layers dialogs or fills an approval.
    await open('er-more');await p.locator('#er-all .paper-entry-trigger').first().click();
    await p.locator('#ja-paper-dialog a[href="#asset-editor"]').first().click();
    check(await p.locator('#asset-editor').evaluate(e=>document.activeElement===e),'jump focuses existing editor');
    check(await p.locator('#ja-paper-dialog').getAttribute('data-page')==='ja-assets','jump opens destination leaf');
    check(!await p.locator('#wa-confirm').isChecked(),'review remains unchecked');await close();
    // Metadata failure discards old report and export; no old content fallback.
    await p.route('**/__admin',route=>route.request().postDataJSON().action==='getExplorationAssets'?route.abort():route.continue());
    await p.locator('#er-check').click();await p.waitForFunction(()=>document.querySelector('#er-status').textContent.includes('未完成检查'));
    check(await p.locator('#er-all .paper-entry').count()===0,'failure clears report');check(await p.locator('#er-export').isHidden(),'failure blocks export');await p.unroute('**/__admin');
    // Delay stays in flight while the user opens and edits a folio.
    let release;const barrier=new Promise(r=>{release=r;});
    await p.route('**/__admin',async route=>{if(route.request().postDataJSON().action==='getExplorationAssets'){const response=await route.fetch();await barrier;await route.fulfill({response});}else await route.continue();});
    await p.locator('#er-check').click();await open('ja-edit');await p.locator('#wa-title').fill('读取途中修改');release();
    await p.waitForFunction(()=>!document.querySelector('#er-check').disabled);
    check(await p.locator('#er-all .paper-entry').count()===0,'late result ignored');await p.unroute('**/__admin');await close();
    await p.locator('#wa-load').click();
    await server.fixture.db.collection('submissions').doc('s').update({aiConsentRevokedAt:'local-test'});
    await ready();
    check((await p.locator('#er-status').textContent()).includes('4 项'),'withdrawn guide gaps');
    await p.locator('#er-results .paper-entry-trigger').first().click();
    check((await p.locator('#ja-paper-dialog').textContent()).includes('未匹配当前可用材料'),'not old source fallback');await close();
    const q=await browser.newPage();await q.route('**/__admin',route=>route.request().postDataJSON().action==='whoami'?route.fulfill({json:{ok:true,isAdmin:false}}):route.continue());
    await q.goto(server.url+'/explore-admin.html');await q.waitForFunction(()=>document.querySelector('#wa-message').textContent.includes('管理员账号'));
    check(await q.locator('#wa-app').isHidden(),'unauthorized panel hidden');await q.close();
    check(errors.length===0,JSON.stringify(errors));check(external.length===0,'local only');
    console.log('PASS readiness browser: '+checks+' checks; saved state, no writes, exports, source gaps, modal jumps, invalidation, errors, four widths.');
  }finally{await browser.close();await server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
