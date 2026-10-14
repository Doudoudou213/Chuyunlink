'use strict';
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {start}=require('./preview-integrated-ui');
(async()=>{
 const output=process.argv[2];if(!output||!path.isAbsolute(output))throw Error('Absolute screenshot directory required');
 fs.mkdirSync(output,{recursive:true});
 const server=await start(0),url='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  assert.equal((await fetch(url+'/.git/config')).status,404);
  assert.equal((await fetch(url+'/cloudbaserc.json')).status,404);
  assert.equal((await fetch(url+'/',{method:'POST'})).status,405);
  for(const width of [390,768,1440]){
   const page=await browser.newPage({viewport:{width,height:960},reducedMotion:'reduce'}), errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   // Keep verification offline, including optional remote illustrative photos and tiles.
   await page.route('**/*',r=>r.request().url().startsWith(url+'/')?r.continue():r.abort());
   await page.goto(url+'/?view=profile',{waitUntil:'load'});
   await page.locator('#chu-startup').waitFor({state:'detached'});
   for(const view of ['discover','map','collect','community','profile']){
    await page.evaluate(v=>switchTab(v),view);
    await page.locator('#view-'+view+':not(.hidden)').waitFor();
    await page.waitForTimeout(1600);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),view+' overflow '+width);
    await page.screenshot({path:path.join(output,view+'-'+width+'.png')});
   }
   assert.equal(await page.locator('#paper-profile-badges [data-badge-id]').count(),3);
   await page.locator('#paper-profile-badges [data-badge-id]').first().click();
   await page.locator('#paper-badge-dialog[open]').waitFor();
   await page.screenshot({path:path.join(output,'badge-dialog-'+width+'.png')});
   assert.deepEqual(errors,[]);
   await page.close();
  }
  console.log('PASS integrated isolated preview: five views and badge dialog at 390/768/1440, no page errors, source/config denied, POST denied. Remote photos/tiles deliberately blocked in screenshots.');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
