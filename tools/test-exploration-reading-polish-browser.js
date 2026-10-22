'use strict';
// Fresh Edge, localhost-only editorial data. The 200% checks below double text
// in the test document; they are not a claim about system zoom or real devices.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const preview = require('./lib/exploration-four-scenes-preview');
const draft = require('./fixtures/four-scenes-study.json');
const output = path.resolve(__dirname,'../artifacts/exploration-journey-live/reading-polish');
const viewports = [{width:320,height:740},{width:390,height:844},{width:768,height:1024},{width:1440,height:900},{width:667,height:320}];
let checks = 0;
const check = (value,label) => {assert(value,label);checks++;};

(async () => {
  const server = await preview.start();
  let browser;
  const errors = [],external = [],requests = [];
  const base = server.url+'/four-scenes.html?resourceId=hhl-four-scenes-study';
  const html = await (await fetch(base)).text();
  const apiPath = html.match(/fetch\(["'](\/__[\w-]+)["']/)?.[1];
  check(Boolean(apiPath),'local read endpoint is known');
  const settled = (page,kind='reading') => page.locator('#journey-leaf-dialog[open][data-state=open][aria-busy=false][data-leaf='+kind+']').waitFor();
  const open = async page => {await page.locator('#reading > .journey-leaf-trigger').click();await settled(page);};
  const close = async page => {await page.locator('.journey-leaf-close').click();await page.locator('#journey-leaf-dialog').waitFor({state:'hidden'});};
  async function page(viewport,motion='reduce') {
    const result = await browser.newPage({viewport,reducedMotion:motion});
    result.on('pageerror',error=>errors.push(error.message));
    result.on('request',request=>requests.push({url:request.url(),method:request.method()}));
    await result.route('**/*',route=>{
      const url=route.request().url();
      if(!url.startsWith(server.url+'/')&&!url.startsWith('data:')){external.push(url);return route.abort();}
      return route.continue();
    });
    await result.goto(base,{waitUntil:'domcontentloaded'});
    await result.locator('#content:not([hidden])').waitFor();
    await result.evaluate(()=>document.fonts.ready);
    return result;
  }
  async function fits(page,selector,label,{target=false}={}) {
    const metrics = await page.locator(selector).evaluate(node=>{
      const r=node.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height,viewWidth:innerWidth,viewHeight:innerHeight};
    });
    check(metrics.x>=-.5&&metrics.right<=metrics.viewWidth+.5&&metrics.y>=-.5&&metrics.bottom<=metrics.viewHeight+.5,label+' stays in viewport '+JSON.stringify(metrics));
    if(target)check(metrics.width>=44&&metrics.height>=44,label+' has a 44px target');
  }
  async function paperLayout(page,label) {
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),label+' document fits horizontally');
    check(await page.locator('#journey-leaf-body').evaluate(node=>node.scrollWidth<=node.clientWidth+1&&node.clientHeight>=80),label+' reading body fits and remains usable');
    for(const selector of ['.journey-leaf-close','#journey-leaf-tab-reading','#journey-leaf-tab-sources','#reading-size','.journey-leaf-return']) {
      await fits(page,selector,label+' '+selector,{target:true});
    }
  }
  async function resultVisible(page,selector,label) {
    // Native scroll restoration happens after popstate. Wait past the landing
    // frame, so an immediately-correct scroll cannot hide a stable-state jump.
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await page.waitForTimeout(100);
    await fits(page,selector,label);
    check(await page.locator(selector).evaluate(node=>document.activeElement===node),label+' owns keyboard focus');
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),label+' document has no horizontal overflow');
    const location=await page.locator(selector).evaluate(node=>{
      const top=node.getBoundingClientRect().top,documentTop=top+scrollY,maxScroll=Math.max(0,document.documentElement.scrollHeight-innerHeight);
      return {top,limit:Math.max(60,documentTop-maxScroll+2),scrollY,maxScroll};
    });
    check(location.top>=-.5&&location.top<=location.limit,label+' stable result aligns near top or actual document bottom clamp '+JSON.stringify(location));
  }
  try {
    browser = await chromium.launch({channel:'msedge',headless:true});
    fs.mkdirSync(output,{recursive:true});
    for(const viewport of viewports) {
      const p=await page(viewport),label=viewport.width+'x'+viewport.height;
      await open(p);await paperLayout(p,label+' reading');
      check(await p.locator('#reading-size').evaluate(node=>Boolean(node.closest('.journey-leaf-header'))),label+' size control belongs to stable paper header');
      const history=await p.evaluate(()=>window.history.length);
      await p.locator('#journey-leaf-tab-sources').click();await settled(p,'sources');
      const original=await p.locator('#source-list').textContent();
      check(original.includes(draft.points[0].sources[0].title)&&original.includes('未通过人工审稿'),label+' source title and unreviewed disclosure remain');
      const sourceFont=await p.locator('#source-list p').first().evaluate(node=>parseFloat(getComputedStyle(node).fontSize));
      await p.locator('#reading-size').click();
      check(await p.locator('#source-list p').first().evaluate(node=>parseFloat(getComputedStyle(node).fontSize))>sourceFont,label+' source text responds to large type without returning to reading');
      check(await p.locator('#source-list').textContent()===original,label+' enlarging source text does not alter evidence');
      check(await p.locator('#source-list a').first().evaluate(node=>node.target==='_blank'&&node.rel.includes('noopener')&&node.rel.includes('noreferrer')),label+' public citation keeps safe external link');
      await paperLayout(p,label+' sources');
      await p.locator('#source-list a').first().scrollIntoViewIfNeeded();
      await fits(p,'#source-list a',label+' citation action',{target:true});
      await p.screenshot({path:path.join(output,'sources-large-'+label+'.png')});
      await p.locator('#journey-leaf-tab-reading').click();await settled(p);
      check(await p.evaluate(()=>window.history.length)===history,label+' source and font tools do not grow history');
      check(await p.locator('#reading-size').getAttribute('aria-pressed')==='true',label+' font preference survives content switching');
      await close(p);
      check(await p.locator('#reading > .journey-leaf-trigger').evaluate(node=>document.activeElement===node),label+' source close restores original opener');

      // A long title and 200% text are deliberately synthetic layout stress only.
      await open(p);
      await p.evaluate(()=>{
        document.querySelector('#journey-leaf-title').textContent='黄鹤楼主楼·从旧时江楼到今日层檐的建筑故事与自然风物';
        const sizes=[...document.querySelectorAll('#journey-leaf-dialog *')].filter(node=>node.textContent.trim()).map(node=>[node,parseFloat(getComputedStyle(node).fontSize)*2]);
        for(const [node,size] of sizes)node.style.fontSize=size+'px';
      });
      await paperLayout(p,label+' 200% text and long title');
      await fits(p,'#journey-leaf-next',label+' enlarged next',{target:true});
      check(await p.locator('.journey-leaf-heading').evaluate(node=>node.scrollWidth<=node.clientWidth+1),label+' long heading wraps rather than overflowing sideways');
      await p.locator('#journey-leaf-body').evaluate(node=>{node.scrollTop=node.scrollHeight;});
      check(await p.locator('#journey-leaf-body').evaluate(node=>node.scrollTop+node.clientHeight>=node.scrollHeight-2),label+' enlarged long content remains fully scrollable');
      await p.screenshot({path:path.join(output,'text-200-'+label+'.png')});
      await close(p);await p.close();
    }

    // The end of a paper must land at the result, not an arbitrary old map offset.
    for(const motion of ['reduce','no-preference'])for(const viewport of viewports) {
      const p=await page(viewport,motion),label=viewport.width+'x'+viewport.height+'-'+motion;
      await p.locator('[data-stop=pond]').click();await settled(p);
      const beforeHistory=await p.evaluate(()=>window.history.length);
      await p.locator('#journey-leaf-next').click();await p.locator('#finished:not([hidden])').waitFor();
      await resultVisible(p,'#finished-title',label+' last scene completion');
      check(await p.locator('#journey-leaf-dialog').isHidden(),label+' paper closes before souvenir');
      check((await p.locator('#souvenir-count').textContent()).includes('0 / 4'),label+' finish invents no reading credits');
      check(await p.evaluate(()=>window.history.length)<=beforeHistory,label+' closing final leaf adds no history entry');
      check(await p.locator('#souvenir-title').textContent()==='黄鹤楼 · 一楼四景（待审样章）',label+' souvenir retains draft status');
      await p.screenshot({path:path.join(output,'finish-'+label+'.png')});
      for(const selector of ['#download','#return']) {
        await p.locator(selector).scrollIntoViewIfNeeded();await fits(p,selector,label+' '+selector,{target:true});
      }
      await p.locator('#return').click();await p.locator('#content:not([hidden])').waitFor();
      await resultVisible(p,'#point-title',label+' return to current scene');
      check(await p.locator('[data-stop=pond]').getAttribute('aria-current')==='step',label+' returning retains selected last scene');
      await p.close();
    }

    for(const viewport of [viewports[0],viewports[4]]) {
      const p=await page(viewport),label=viewport.width+'x'+viewport.height;
      await p.locator('#finish').click();await p.locator('#finished:not([hidden])').waitFor();
      await resultVisible(p,'#finished-title',label+' early manual finish');
      check((await p.locator('#souvenir-count').textContent()).includes('0 / 4'),label+' early finish does not fabricate progress');
      await p.close();

      const stale=await page(viewport);await open(stale);
      await stale.route('**'+apiPath,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,available:false,reason:'本地测试资料撤回'})}));
      await stale.locator('#journey-leaf-tab-sources').click();await stale.locator('#retry:not([hidden])').waitFor();
      await resultVisible(stale,'#gate-title',label+' withdrawal result');
      check(await stale.locator('#journey-leaf-dialog').isHidden(),label+' withdrawn leaf closes');
      check(await stale.locator('#reading-copy').textContent()===''&&await stale.locator('#source-list').textContent()==='',label+' withdrawn content is cleared');
      await stale.screenshot({path:path.join(output,'withdrawn-'+label+'.png')});await stale.close();
    }
    check(external.length===0,'no third-party connections: '+JSON.stringify(external));
    check(requests.filter(request=>request.url.startsWith(server.url+apiPath)).every(request=>request.method==='GET'),'all editorial API operations remain read-only');
    check(errors.length===0,'no browser errors: '+JSON.stringify(errors));
    console.log('PASS reading polish: '+checks+' checks; source sizing, long-title/text-only zoom stress, ending/return focus, 44px controls and withdrawal. '+output);
  } finally {if(browser)await browser.close();await server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
