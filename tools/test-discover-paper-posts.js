'use strict';
const {chromium}=require('playwright');
const {start}=require('./preview-integrated-ui');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const out=process.argv[2];assert(out&&path.isAbsolute(out));fs.mkdirSync(out,{recursive:true});
 const server=await start(0),origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{for(const width of [390,768,1440]){
  const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'});
  await page.route('**/*',r=>r.request().url().startsWith(origin)?r.continue():r.abort());
  await page.goto(origin+'/?view=discover&sample=paper-posts');
  const cards=page.locator('#discover-share-feed > article');await cards.first().waitFor();
  await cards.first().getByText('纹样采集笔记（本地示例）',{exact:true}).waitFor();
  await page.locator('#chu-startup').waitFor({state:'detached'});
  await page.waitForTimeout(700);
  const state=await page.evaluate(()=>{
   const a=document.querySelector('#discover-share-feed > article'),image=a.querySelector('img');
   return {paper:getComputedStyle(a.querySelector(':scope > .p-3')).backgroundImage,
    imageBackground:getComputedStyle(image).backgroundImage,loaded:image.complete&&image.naturalWidth>0,
    audioPaper:getComputedStyle(a.nextElementSibling).backgroundImage,
    width:document.documentElement.scrollWidth,viewport:innerWidth};
  });
  assert(state.paper.includes('paper-fibres-soft-v1'));assert(state.audioPaper.includes('paper-fibres-soft-v1'),JSON.stringify(state));
  assert.equal(state.imageBackground,'none');assert(state.loaded);assert(state.width<=state.viewport+2);
  await cards.first().scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,'posts-'+width+'.png')});
  await page.close();
 }console.log('PASS paper posts: photo and audio, text-only texture, loaded unchanged media, 390/768/1440. Local examples only.');}
 finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
