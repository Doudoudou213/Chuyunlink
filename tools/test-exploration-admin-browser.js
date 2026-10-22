'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright'),{start}=require('./lib/site-walk-workspace-preview');
(async()=>{
  const s=await start(),b=await chromium.launch({channel:'msedge',headless:true});
  try{
    const p=await b.newPage({viewport:{width:1100,height:900}}),errors=[];
    p.on('pageerror',e=>errors.push(e.message));
    const open=async id=>{await p.locator('#'+id+' > .paper-entry-trigger').click();await p.locator('#ja-paper-dialog[open]').waitFor();};
    const close=async()=>{await p.locator('#ja-paper-dialog .paper-close').click();await p.locator('#ja-paper-dialog').waitFor({state:'hidden'});};
    await p.goto(s.url+'/explore-admin.html');await p.locator('#wa-load').click();
    await open('ja-edit');await p.locator('#wa-add').click();
    await p.locator('[data-field=accessNote]').fill('本地固定核对，不代表现场');await close();
    await open('ja-map');await p.locator('[data-coord=x]').fill('630');await p.locator('[data-coord=y]').fill('410');await close();
    await p.locator('#wa-save').click();await p.waitForFunction(()=>document.querySelector('#wa-message').textContent.includes('草稿已保存'));
    await p.locator('#wa-preview').click();await p.locator('#wa-review:not([hidden])').waitFor();
    const inputTime=d=>new Date(d-Date.now()+Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);
    await p.locator('#wa-checked').fill(inputTime(Date.now()-60000));await p.locator('#wa-until').fill(inputTime(Date.now()+3600000));
    await p.locator('#wa-note').fill('本地固定核实，不作现场结果');await p.locator('#wa-confirm').check();await p.locator('#wa-publish').click();
    await p.waitForFunction(()=>document.querySelector('#wa-message').textContent.includes('新版本已发布'));
    const result=await require('../cloudfunctions/appCore/lib/exploration-core').get(s.db,'r');
    assert(result.available);assert.equal(result.map.objects[0].x,630);assert.equal(result.map.objects[0].y,410);
    await p.reload();await p.locator('#wa-load').click();await open('ja-map');
    await p.locator('[data-coord=x]').waitFor();assert.equal(await p.locator('[data-coord=x]').inputValue(),'630');
    for(const width of [390,768,1440]){
      await p.setViewportSize({width,height:900});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await p.screenshot({path:path.join(__dirname,'../artifacts/exploration/admin-'+width+'.png'),fullPage:true});
    }
    await p.getByRole('button',{name:'复用画卷布局',exact:true}).click();
    const dl=p.waitForEvent('download');await p.locator('#me-export').click();const download=await dl;
    assert.equal(download.suggestedFilename(),'exploration-layout.json');
    p.once('dialog',d=>d.accept());
    await p.locator('#me-import').setInputFiles({name:'layout.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({schema:'exploration-layout-v1',slots:[{symbol:'gate',x:350,y:400}]}))});
    await p.waitForFunction(()=>document.querySelector('#me-package-message').textContent.includes('布局已作为草稿'));
    assert.equal(await p.locator('[data-coord=x]').inputValue(),'350');assert.deepEqual(errors,[]);
    console.log('PASS exploration admin browser: paper dialogs/place/save/preview/review/publish/reload/layout reuse');
  }finally{await b.close();await s.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
