'use strict';
const {toolClick}=require('./lib/journey-browser-ui');
// A fresh, local-only browser. Network failures below are synthetic, not a claim
// about field reception, real-device accessibility or approved scenic guidance.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const preview = require('./lib/exploration-four-scenes-preview');
const draft = require('./fixtures/four-scenes-study.json');
const output = path.resolve(__dirname,'../artifacts/exploration-journey-live/comfort');
const resourceId = 'hhl-four-scenes-study';
const preferenceKey = 'chulink:journey-reading-size:v1';
const artworkPath = '/static/assets/exploration-motion/hhl-full-park-v2.webp';
let checks = 0;
function check(value,name) {assert(value,name);checks++;}

(async () => {
  const server = await preview.start();
  let browser;
  const errors = [], requests = [], external = [];
  const url = server.url+'/four-scenes.html?resourceId='+resourceId;
  const html = await (await fetch(url)).text();
  const apiPath = html.match(/fetch\(["'](\/__[\w-]+)["']/)?.[1];
  check(Boolean(apiPath),'local read endpoint is inspectable');
  const apiPattern = '**'+apiPath;
  const page = async (options = {}) => {
    const p = await browser.newPage({viewport:{width:390,height:900},reducedMotion:'reduce',...options});
    p.on('pageerror',error => errors.push(error.message));
    p.on('request',request => requests.push({url:request.url(),method:request.method()}));
    await p.route('**/*',route => {
      const value=route.request().url();
      if(!value.startsWith(server.url+'/')&&!value.startsWith('data:')) {external.push(value);return route.abort();}
      return route.continue();
    });
    return p;
  };
  const go = async (p,query='') => {
    // A hanging artwork request must not prevent testing the readable document.
    await p.goto(url+query,{waitUntil:'domcontentloaded'});
    await p.locator('#content:not([hidden])').waitFor();
  };
  const opened = async p => p.locator('#journey-leaf-dialog[open][data-state=open][aria-busy=false]').waitFor();
  const open = async p => {await p.locator('#reading > .journey-leaf-trigger').click();await opened(p);};
  const close = async p => {await p.locator('.journey-leaf-close').click();await p.locator('#journey-leaf-dialog').waitFor({state:'hidden'});};
  const select = async (p,id) => {await p.locator('[data-stop='+id+']').click();await opened(p);};
  const size = p => p.locator('#reading-size');
  const font = locator => locator.evaluate(node=>parseFloat(getComputedStyle(node).fontSize));
  const expected = id => draft.points.find(point=>point.id===id);
  const reads = p => requests.filter(request=>request.url.startsWith(server.url+apiPath)).length;
  const noStorage = async p => p.addInitScript(() => {
    for(const name of ['getItem','setItem','removeItem'])Object.defineProperty(Storage.prototype,name,{
      configurable:true,value(){throw new DOMException('Test storage disabled','SecurityError');}
    });
  });
  const chooseLarge = async p => {
    await size(p).waitFor({state:'visible'});
    if(await size(p).getAttribute('aria-pressed')!=='true')await size(p).click();
    await p.waitForFunction(()=>document.body.dataset.readingSize==='large');
  };
  async function noOverflow(p,label) {
    check(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),label+' document does not overflow');
    check(await p.locator('#journey-leaf-body').evaluate(node=>node.scrollWidth<=node.clientWidth+1),label+' paper does not overflow');
    for(const selector of ['#reading-size','.journey-leaf-close','#journey-leaf-next','.journey-leaf-return']) {
      const node=p.locator(selector);await node.scrollIntoViewIfNeeded();
      check(await node.evaluate(element=>{const box=element.getBoundingClientRect();return box.width>=44&&box.height>=44&&box.left>=0&&box.right<=innerWidth;}),label+' 44px visible target '+selector);
    }
  }
  try {
    browser=await chromium.launch({channel:'msedge',headless:true});fs.mkdirSync(output,{recursive:true});
    const p=await page();await go(p,'&pointId=pond');await open(p);
    const originalText=await p.locator('#reading-copy').textContent();
    const originalSources=await p.locator('#source-list').textContent();
    const standardObservation=await font(p.locator('#observation'));
    check(await font(p.locator('#reading-copy'))===18,'standard mobile reading uses the refined 18px text baseline');
    check(await size(p).getAttribute('type')==='button','font switch cannot submit a form');
    check(await size(p).getAttribute('aria-pressed')==='false','font switch exposes its original state');
    const keysBefore=await p.evaluate(()=>Object.keys(localStorage));
    await chooseLarge(p);
    check(await size(p).getAttribute('aria-pressed')==='true','font switch announces enlarged state');
    check(await font(p.locator('#reading-copy'))===21,'large mobile reading is 21px');
    check(await font(p.locator('#observation'))>standardObservation,'observation scales with the reading preference');
    check(await p.locator('#reading-copy').textContent()===originalText,'larger font does not rewrite the current chapter');
    check(await p.locator('#source-list').textContent()===originalSources,'larger font does not rewrite sources');
    check(await p.locator('[data-recorded=true]').count()===0,'changing size does not record an observation');
    check(await p.evaluate(key=>localStorage.getItem(key),preferenceKey)==='large','only the size value is persisted');
    check(await p.evaluate(({before,key})=>Object.keys(localStorage).filter(value=>!before.includes(value)).every(value=>value===key),{before:keysBefore,key:preferenceKey}),'font switch adds no content or tracking storage');
    await size(p).focus();await p.keyboard.press('Space');
    check(await size(p).getAttribute('aria-pressed')==='false','Space reverses the accessible toggle');
    check(await p.evaluate(()=>document.body.dataset.readingSize)==='standard','standard size is recoverable');
    await p.keyboard.press('Enter');
    check(await size(p).getAttribute('aria-pressed')==='true','Enter re-enlarges without navigation');
    await close(p);
    await p.locator('#sources > .journey-leaf-trigger').click();await opened(p);
    const largeSource=await font(p.locator('#source-list article p').first());
    await close(p);await open(p);await size(p).click();await close(p);
    await p.locator('#sources > .journey-leaf-trigger').click();await opened(p);
    check(largeSource>await font(p.locator('#source-list article p').first()),'source explanation also has a larger readable size');
    await close(p);await open(p);await chooseLarge(p);await close(p);
    await p.reload({waitUntil:'domcontentloaded'});await p.locator('#content:not([hidden])').waitFor();await open(p);
    check(await size(p).getAttribute('aria-pressed')==='true','size preference survives a real page refresh');
    check(await p.evaluate(()=>document.body.dataset.readingSize)==='large','refresh applies the saved preference');
    await close(p);await select(p,'copper');
    check(await font(p.locator('#reading-copy'))===21,'next selected chapter inherits preferred size');
    check(await p.locator('#reading-copy').textContent()===expected('copper').paragraphs.join('\n\n'),'selecting a chapter keeps its exact editorial prose');
    await p.close();

    for(const viewport of [{width:320,height:900},{width:390,height:900},{width:768,height:900},{width:1440,height:900},{width:667,height:320}]) {
      const q=await page({viewport});await go(q,'&pointId=pond');await open(q);await chooseLarge(q);
      await q.evaluate(()=>document.fonts.ready);
      check(await font(q.locator('#reading-copy'))===(viewport.width<=600?21:22),'large size matches breakpoint '+viewport.width);
      await noOverflow(q,viewport.width+'x'+viewport.height);
      await size(q).scrollIntoViewIfNeeded();
      await q.screenshot({path:path.join(output,'large-reading-top-'+viewport.width+'x'+viewport.height+'.png')});
      await q.locator('#reading-copy').scrollIntoViewIfNeeded();
      await q.screenshot({path:path.join(output,'large-reading-prose-'+viewport.width+'x'+viewport.height+'.png')});
      await q.keyboard.press('Escape');await q.locator('#journey-leaf-dialog').waitFor({state:'hidden'});
      check(await q.evaluate(()=>!document.activeElement.closest('dialog')),'Escape restores external focus '+viewport.width);
      await q.locator('#sources > .journey-leaf-trigger').click();await opened(q);
      await q.screenshot({path:path.join(output,'large-sources-'+viewport.width+'x'+viewport.height+'.png')});
      check(await q.locator('#journey-leaf-body').evaluate(node=>node.scrollWidth<=node.clientWidth+1),'larger sources wrap '+viewport.width);
      await close(q);await toolClick(q,'#journey-help > .journey-leaf-trigger');await opened(q);
      check(await q.locator('#journey-leaf-dialog').getAttribute('data-leaf')==='journey-help','help is tested in its actual moved paper '+viewport.width);
      check(await font(q.locator('#journey-leaf-body .journey-leaf-content p').first())===18,'real help paper inherits 18px large text '+viewport.width);
      check(await q.locator('#journey-leaf-body').evaluate(node=>node.scrollWidth<=node.clientWidth+1),'large help paper wraps '+viewport.width);
      await q.screenshot({path:path.join(output,'large-help-'+viewport.width+'x'+viewport.height+'.png')});
      await q.close();
    }

    // Simulate another tab writing the same fingerprint, without creating a
    // second active browser or issuing any remote write. New valid saved work
    // should win, while expired/far-future data must not replace valid memory.
    const shared=await page();await go(shared);await select(shared,'pond');await close(shared);
    await shared.locator('#finish').click();await shared.locator('#finished:not([hidden])').waitFor();
    await shared.locator('#note').fill('当前标签的测试拾记');
    await shared.locator('#return').click();await shared.locator('#content:not([hidden])').waitFor();
    const sharedKey='chulink:journey-content:v1:'+resourceId;
    const fingerprint=preview.response().walk.fingerprint;
    async function writeOtherTab(selected,note,offset) {
      await shared.evaluate(({key,fingerprint,selected,note,offset})=>{
        const saved=JSON.parse(localStorage.getItem(key)||'{}');
        saved[fingerprint]={...saved[fingerprint],fingerprint,selected,note,updatedAt:Date.now()+offset};
        localStorage.setItem(key,JSON.stringify(saved));
      },{key:sharedKey,fingerprint,selected,note,offset});
    }
    async function checkSharedRecord(label) {
      await toolClick(shared,'#refresh');await shared.locator('#content:not([hidden])').waitFor();
      check(await shared.locator('#point-title').textContent()===expected('copper').title,label+' keeps the newest valid selected chapter');
      await shared.locator('#finish').click();await shared.locator('#finished:not([hidden])').waitFor();
      check(await shared.locator('#note').inputValue()==='另一个标签新保存的测试拾记',label+' keeps the newest valid private note');
      await shared.locator('#return').click();await shared.locator('#content:not([hidden])').waitFor();
    }
    await writeOtherTab('copper','另一个标签新保存的测试拾记',1000);
    await checkSharedRecord('newer same-fingerprint storage');
    await writeOtherTab('baiyun','已过期的测试拾记',-8*86400000);
    await checkSharedRecord('expired stored record');
    await writeOtherTab('tower','未来时间的测试拾记',120000);
    await checkSharedRecord('far-future stored record');
    await shared.close();

    const memory=await page();await noStorage(memory);await go(memory);await select(memory,'pond');await chooseLarge(memory);await close(memory);
    await toolClick(memory,'#observe');await memory.locator('[data-stop=pond][data-recorded=true]').waitFor();
    check(await memory.locator('[data-recorded=true]').count()===1,'explicit observation works without storage');
    await memory.locator('#finish').click();await memory.locator('#finished:not([hidden])').waitFor();
    await memory.locator('#note').fill('本机测试拾记，不含个人资料');
    await memory.locator('#return').click();await memory.locator('#content:not([hidden])').waitFor();
    await toolClick(memory,'#refresh');await memory.locator('#content:not([hidden])').waitFor();
    check(await memory.locator('#point-title').textContent()===expected('pond').title,'same-version refresh preserves in-memory position when storage is blocked');
    check(await memory.locator('[data-recorded=true]').count()===1,'same-version refresh preserves explicit in-memory observation');
    await open(memory);
    check(await size(memory).getAttribute('aria-pressed')==='true','blocked storage does not stop current-session text sizing');await close(memory);
    const failRead=route=>route.abort();
    await memory.route(apiPattern,failRead);await toolClick(memory,'#refresh');await memory.locator('#retry:not([hidden])').waitFor();
    check(await memory.locator('#reading-copy').textContent()==='','failed authority check does not retain readable stale prose');
    await memory.unroute(apiPattern,failRead);await memory.locator('#retry').click();await memory.locator('#content:not([hidden])').waitFor();
    check(await memory.locator('#point-title').textContent()===expected('pond').title,'same-version retry returns to the same in-memory chapter');
    check(await memory.locator('[data-recorded=true]').count()===1,'same-version retry does not erase or invent observations');
    await memory.locator('#finish').click();await memory.locator('#finished:not([hidden])').waitFor();
    check(await memory.locator('#note').inputValue()==='本机测试拾记，不含个人资料','same-version recovery retains unsaved-to-storage private note in memory');
    await memory.locator('#return').click();await memory.locator('#content:not([hidden])').waitFor();
    await memory.route(apiPattern,route=>{
      const value=preview.response();value.walk.version++;value.walk.fingerprint+='-comfort-new';
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(value)});
    });
    await toolClick(memory,'#refresh');await memory.locator('#retry:not([hidden])').waitFor();await memory.locator('#retry').click();await memory.locator('#content:not([hidden])').waitFor();
    check(await memory.locator('#point-title').textContent()===expected('tower').title,'new version does not inherit stale chapter position');
    check(await memory.locator('[data-recorded=true]').count()===0,'new version does not inherit old observations');
    await memory.locator('#finish').click();await memory.locator('#finished:not([hidden])').waitFor();
    check(await memory.locator('#note').inputValue()==='','new version does not copy a previous version private note');
    await memory.close();

    const failedArt=await page();let artBlocked=true;
    await failedArt.route('**'+artworkPath,route=>artBlocked?route.abort():route.continue());
    await go(failedArt,'&pointId=baiyun');
    await failedArt.locator('#art-error:not([hidden])').waitFor();
    check(await failedArt.locator('#art-retry').isEnabled(),'failed painting offers an explicit retry');
    check((await failedArt.locator('#art-error-copy').textContent()).length>0,'failed painting has a readable status');
    const mainSource=await failedArt.locator('#journey-art').getAttribute('src');
    const artTitle=await failedArt.locator('#point-title').textContent();
    await open(failedArt);
    await failedArt.waitForFunction(()=>document.querySelector('#journey-study button')?.textContent.includes('重新加载原画'));
    check(await failedArt.locator('#journey-study button').isEnabled(),'paper original-art failure has one usable retry');
    check(await failedArt.locator('#reading-copy').textContent()===expected('baiyun').paragraphs.join('\n\n'),'failed illustration preserves available current prose');
    const beforeReads=reads(failedArt);artBlocked=false;
    await failedArt.locator('#journey-study button').click();
    await failedArt.locator('.journey-study-frame').waitFor({state:'visible'});
    await failedArt.waitForFunction(()=>!document.querySelector('#journey-study button').disabled&&!document.querySelector('#journey-study button').textContent.includes('重新加载'));
    check(reads(failedArt)>beforeReads,'paper retry rechecks authority before showing original art');
    check(await failedArt.locator('#journey-study').getAttribute('data-detail')==='whole','recovered paper starts at whole-art pose');
    check(await failedArt.locator('.journey-study-art image').getAttribute('href')===mainSource,'paper recovery uses the same original artwork URL');
    check(await failedArt.locator('[data-recorded=true]').count()===0,'paper image retry is not an observation');
    await close(failedArt);
    check(await failedArt.locator('#journey-art').evaluate(node=>!node.naturalWidth),'main image is still unavailable before explicit retry');
    await failedArt.locator('#art-retry').click();
    await failedArt.locator('#art-error').waitFor({state:'hidden'});
    check(await failedArt.locator('#journey-art').evaluate(node=>node.complete&&node.naturalWidth>0),'main painting recovers after retry');
    check(await failedArt.locator('#journey-art').getAttribute('src')===mainSource,'main painting does not replace or cache-bust its original image URL');
    check(await failedArt.locator('#journey-art').isVisible(),'decoded original painting becomes visible after recovery');
    check(await failedArt.locator('#point-title').textContent()===artTitle,'image retry leaves the selected chapter untouched');
    check(await failedArt.locator('#reading-copy').textContent()===expected('baiyun').paragraphs.join('\n\n'),'image retry does not reload or clear the chapter prose');
    check(await failedArt.locator('[data-recorded=true]').count()===0,'main image retry records no observation');
    check(await failedArt.evaluate(()=>document.activeElement.id)==='journey-stage','successful main retry moves keyboard focus to the painting');
    await failedArt.close();

    // A second fresh context has never loaded the image successfully. This
    // distinguishes a real retry from simply accepting the paper's decoded cache.
    const mainOnly=await page();let mainBlocked=true,mainImageRequests=0;
    await mainOnly.route('**'+artworkPath,route=>{
      mainImageRequests++;
      return mainBlocked?route.abort():route.continue();
    });
    await go(mainOnly,'&pointId=copper');await mainOnly.locator('#art-error:not([hidden])').waitFor();
    check(await mainOnly.locator('#journey-art').evaluate(node=>!node.naturalWidth),'fresh-context original image starts unavailable');
    check(await mainOnly.locator('#journey-leaf-dialog').isHidden(),'main-only retry does not depend on opening paper');
    const failedRequestCount=mainImageRequests;
    mainBlocked=false;await mainOnly.locator('#art-retry').click();
    await mainOnly.locator('#art-error').waitFor({state:'hidden'});
    check(mainImageRequests>failedRequestCount,'fresh-context retry requests the original image without a preloaded paper');
    check(await mainOnly.locator('#journey-art').evaluate(node=>node.complete&&node.naturalWidth>0),'fresh-context retry decodes the original image');
    check(await mainOnly.locator('#journey-art').getAttribute('src')===mainSource,'fresh-context retry retains exactly the original URL');
    check(await mainOnly.locator('#point-title').textContent()===expected('copper').title,'fresh-context retry keeps the selected chapter');
    check(await mainOnly.locator('[data-recorded=true]').count()===0,'fresh-context image recovery never records a visit');
    await mainOnly.close();

    for(const scenario of ['paper-closed','main-to-paper']) {
      const lateImage=await page();let mode='fail',release,captured;
      const wait=new Promise(resolve=>{release=resolve;});
      const seen=new Promise(resolve=>{captured=resolve;});
      await lateImage.route('**'+artworkPath,async route=>{
        if(mode==='fail')return route.abort();
        captured();await wait;
        try {await route.continue();} catch {/* Cleanup may have already closed the page. */}
      });
      try {
        await go(lateImage,'&pointId=pond');await lateImage.locator('#art-error:not([hidden])').waitFor();
        if(scenario==='paper-closed') {
          await open(lateImage);
          await lateImage.waitForFunction(()=>document.querySelector('#journey-study button')?.textContent.includes('重新加载原画'));
          mode='hold';await lateImage.locator('#journey-study button').click();await seen;
          await close(lateImage);
          const focusBefore=await lateImage.evaluate(()=>document.activeElement.outerHTML);
          release();await lateImage.waitForFunction(()=>document.querySelector('#journey-study')?.dataset.artState==='ready');
          check(await lateImage.locator('#journey-leaf-dialog').isHidden(),'late paper image cannot reopen a dismissed paper');
          check(await lateImage.evaluate(()=>document.activeElement.outerHTML)===focusBefore,'late paper image cannot steal restored focus');
          check(await lateImage.locator('#journey-study').getAttribute('data-detail')==='whole','late image does not restore an old closeup');
        } else {
          mode='hold';await lateImage.locator('#art-retry').click();await seen;
          await open(lateImage);
          check(await lateImage.evaluate(()=>!!document.activeElement.closest('#journey-leaf-dialog')),'user has moved focus into paper while the main image retries');
          release();await lateImage.locator('#art-error').waitFor({state:'hidden'});
          check(await lateImage.locator('#journey-leaf-dialog').isVisible(),'late main image preserves the user-opened paper');
          check(await lateImage.evaluate(()=>!!document.activeElement.closest('#journey-leaf-dialog')),'late main image does not take focus away from paper');
          check(await lateImage.locator('#reading-copy').textContent()===expected('pond').paragraphs.join('\n\n'),'late main image does not replace current prose');
        }
        check(await lateImage.locator('[data-recorded=true]').count()===0,'late image never records an observation '+scenario);
      } finally {release();await lateImage.close();}
    }

    // Hold only the picture: readable local draft data must arrive independently.
    const slow=await page();let release;
    const stalled=new Promise(resolve=>{release=resolve;});
    await slow.route('**'+artworkPath,async route=>{await stalled;try{await route.continue();}catch{/* Page may already have closed. */}});
    try {
      await go(slow,'&pointId=copper');await slow.locator('#art-error:not([hidden])').waitFor({timeout:14000});
      check(await slow.locator('#art-retry').isEnabled(),'ten-second artwork timeout exposes recovery rather than an endless wait');
      check(await slow.locator('#reading-copy').textContent()===expected('copper').paragraphs.join('\n\n'),'stalled picture does not prevent current prose from loading');
    } finally {release();await slow.close();}

    const fallback=await page();
    await fallback.route('**/exploration-journey-leaves.js',route=>route.abort());
    await go(fallback,'&pointId=pond');await fallback.locator('#reading > summary').click();
    await fallback.waitForFunction(()=>document.querySelector('#reading').open);
    await chooseLarge(fallback);
    check(await font(fallback.locator('#reading-copy'))===21,'native details fallback supports large reading');
    check(await fallback.locator('#reading-copy').textContent()===expected('pond').paragraphs.join('\n\n'),'native details fallback retains exact current text');
    check(await fallback.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'native details fallback fits mobile');
    await fallback.close();
    const absent=await page();
    await absent.route('**/exploration-journey-comfort.js',route=>route.abort());
    await go(absent,'&pointId=tower');await open(absent);
    check(await absent.locator('#reading-copy').textContent()===expected('tower').paragraphs.join('\n\n'),'missing comfort script does not block reading');
    check(await size(absent).isHidden()||await size(absent).isDisabled(),'missing comfort script does not leave a dead size button');
    check(await absent.locator('#journey-leaf-next').isEnabled(),'missing comfort script preserves continuation');
    await absent.close();

    check(external.length===0,'no external requests: '+external.join('; '));
    check(requests.every(request=>request.method==='GET'),'browser uses read requests only');
    check(errors.length===0,'no uncaught page errors: '+errors.join('; '));
    console.log('PASS journey reading comfort browser: '+checks+' checks; reversible reading size, blocked-storage continuation, exact-art recovery, fallback, keyboard and five viewport screenshots. '+output);
  } finally {if(browser)await browser.close();await server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
