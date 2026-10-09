'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {chromium}=require('playwright');
const {start}=require('./lib/guide-question-preview');
(async()=>{
 const preview=await start();let browser;
 try{
  browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://**/*',r=>r.abort());await page.goto(preview.url);
  await page.locator('[data-qa-resource]').first().click();await page.waitForFunction(()=>!document.querySelector('.qa-send').disabled);
  assert.equal(await page.locator('[data-qa-example]').count(),2);
  await page.locator('[data-qa-example]').first().click();await page.locator('.qa-turn:not(.is-user)').waitFor();
  assert.equal(preview.getCalls(),2);assert.equal(await page.locator('[data-qa-example]').count(),0);
  await page.getByText('AI 依据已审核资料整理',{exact:true}).waitFor();
  await page.locator('.qa-sources summary').click();assert(await page.locator('.qa-sources').evaluate(e=>e.open));
  assert.match(await page.locator('.qa-sources a').first().getAttribute('href'),/^https:/);
  const out=path.join(os.tmpdir(),'chulink-question-ui');fs.mkdirSync(out,{recursive:true});
  for(const width of [390,768,1440]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert(await page.locator('.qa-dialog').evaluate(e=>e.scrollWidth<=e.clientWidth));await page.screenshot({path:path.join(out,'question-'+width+'.png'),fullPage:true});}
  await page.keyboard.press('Escape');assert.equal(await page.locator('.qa-dialog').evaluate(e=>e.open),false);
  // A second place never inherits the previous transcript.
  await page.locator('[data-qa-resource]').nth(1).click();await page.waitForFunction(()=>!document.querySelector('.qa-send').disabled);assert.equal(await page.locator('.qa-turn').count(),0);
  // Transport errors are readable and retried using the original nonce.
  await page.evaluate(()=>{window.savedApi=ChuGuideQuestionApi;window.sent=[];window.failOnce=true;window.ChuGuideQuestionApi=async e=>{if(e.action==='askGuideQuestion'){sent.push(e.requestId);if(failOnce){failOnce=false;throw Error('本地模拟断网');}}return savedApi(e);};});
  await page.locator('.qa-input').fill('有什么记载？');await page.locator('.qa-send').click();await page.locator('[data-qa-retry]').waitFor();await page.locator('[data-qa-retry]').click();await page.locator('.qa-turn:not(.is-user)').waitFor();assert.equal(await page.evaluate(()=>sent[0]===sent[1]),true);
  // Source invalidation removes existing transcript before source expansion.
  await preview.db.collection('resources').doc(preview.ids[1]).update({status:'draft'});
  await page.locator('.qa-sources summary').click();await page.waitForFunction(()=>document.querySelectorAll('.qa-turn').length===0);
  await page.locator('.qa-close').click();await page.locator('[data-qa-resource]').first().click();await page.waitForFunction(()=>!document.querySelector('.qa-send').disabled);
  // Late responses after switching places cannot leak into the new panel.
  await page.evaluate(()=>{window.ChuGuideQuestionApi=async e=>{if(e.action==='askGuideQuestion')return new Promise(r=>window.releaseAnswer=()=>r({ok:true,text:'不应出现的迟到回答',aiGenerated:false}));return savedApi(e);};});
  await page.locator('.qa-input').fill('另一个问题');await page.locator('.qa-send').click();await page.waitForFunction(()=>!!window.releaseAnswer);await page.locator('.qa-close').click();await page.locator('[data-qa-resource]').nth(2).click();await page.waitForFunction(()=>!document.querySelector('.qa-send').disabled);await page.evaluate(()=>releaseAnswer());await page.waitForTimeout(100);assert.equal(await page.getByText('不应出现的迟到回答').count(),0);
  assert.deepEqual(errors,[]);console.log('Question UI passed: real local business/fake provider, sources, retry nonce, withdrawal, place isolation, late response, keyboard, 390/768/1440. '+out);
 }finally{await browser?.close();await preview.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
