'use strict';
// Local editorial fixture + a fresh browser only. These are layout/interaction
// checks, not historical approval, field usability or real-device performance.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const preview = require('./lib/exploration-four-scenes-preview');
const draft = require('./fixtures/four-scenes-study.json');
const {showJourneyTools,toolClick} = require('./lib/journey-browser-ui');
const output = path.resolve(__dirname,'../artifacts/exploration-journey-live/reading-design');
let checks = 0;
const check = (value,label) => {assert(value,label);checks++;};
const viewports = [{width:320,height:740},{width:390,height:844},{width:768,height:1024},{width:1440,height:900},{width:667,height:320}];

(async () => {
  const server = await preview.start();
  let browser;
  const errors = [],external = [],requests = [];
  const base = server.url+'/four-scenes.html?resourceId=hhl-four-scenes-study';
  const html = await (await fetch(base)).text();
  const apiPath = html.match(/fetch\(["'](\/__[\w-]+)["']/)?.[1];
  check(Boolean(apiPath),'local review read endpoint is inspectable');
  const opened = async (page,kind='reading') => page.locator('#journey-leaf-dialog[open][data-state=open][aria-busy=false][data-leaf='+kind+']').waitFor();
  const open = async page => {await page.locator('#reading > .journey-leaf-trigger').click();await opened(page);};
  const close = async page => {await page.locator('.journey-leaf-close').click();await page.locator('#journey-leaf-dialog').waitFor({state:'hidden'});};
  async function page(viewport=viewports[1],motion='reduce') {
    const result=await browser.newPage({viewport,reducedMotion:motion});
    result.on('pageerror',error=>errors.push(error.message));
    result.on('request',request=>requests.push({url:request.url(),method:request.method()}));
    await result.route('**/*',route=>{
      const url=route.request().url();
      if(!url.startsWith(server.url+'/')&&!url.startsWith('data:')){external.push(url);return route.abort();}
      return route.continue();
    });
    return result;
  }
  const go = async (page,extra='') => {
    await page.goto(base+extra,{waitUntil:'domcontentloaded'});
    await page.locator('#content:not([hidden])').waitFor();
    await page.evaluate(()=>document.fonts.ready);
    check(await page.evaluate(async()=>{
      const faces=await document.fonts.load('28px ChuJourneyDisplay','黄鹤楼主楼古铜顶白云阁鹅池读这一景');
      return faces.length>0&&faces.every(face=>face.status==='loaded');
    }),'the scoped Chinese display font actually loads, not just a declared fallback');
  };
  async function inViewport(locator,label) {
    check(await locator.evaluate(node=>{
      const r=node.getBoundingClientRect();return r.width>=44&&r.height>=44&&r.left>=-.5&&r.right<=innerWidth+.5&&r.top>=-.5&&r.bottom<=innerHeight+.5;
    }),label+' is a reachable 44px target');
  }
  async function layout(page,label,{prose=true}={}) {
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),label+' document fits');
    check(await page.locator('#journey-leaf-body').evaluate(node=>node.scrollWidth<=node.clientWidth+1),label+' paper has no horizontal overflow');
    await inViewport(page.locator('.journey-leaf-close'),label+' close');
    await inViewport(page.locator('.journey-leaf-return'),label+' return');
    await inViewport(page.locator('#journey-leaf-next'),label+' continue');
    await inViewport(page.locator('#journey-leaf-tab-reading'),label+' reading switch');
    await inViewport(page.locator('#journey-leaf-tab-sources'),label+' sources switch');
    if(prose) {
      const metrics = await page.locator('#reading-copy').evaluate(node=>{
        const body=document.querySelector('#journey-leaf-body').getBoundingClientRect();
        // Paragraph controls preserve original newlines as direct text nodes.
        // Measure actual visible prose, not the blank separator between spans.
        const walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT,{
          acceptNode:child=>child.textContent.trim()&&!child.parentElement.closest('[hidden]')?NodeFilter.FILTER_ACCEPT:NodeFilter.FILTER_SKIP
        });
        const text=walker.nextNode();
        const range=document.createRange();range.selectNodeContents(text||node);
        const rows=[...range.getClientRects()].filter(r=>r.width>0&&r.height>0);
        const tops=new Set();const lines=rows.filter(r=>{const key=Math.round(r.top);if(tops.has(key))return false;tops.add(key);return true;});
        return {font:parseFloat(getComputedStyle(node).fontSize),line:parseFloat(getComputedStyle(node).lineHeight),bodyTop:body.top,bodyBottom:body.bottom,
          first:lines.slice(0,2).map(r=>({top:r.top,bottom:r.bottom})),scrollTop:document.querySelector('#journey-leaf-body').scrollTop};
      });
      check(metrics.font>=18,label+' prose remains at least 18px');
      check(metrics.line/metrics.font>=1.6,label+' prose has comfortable leading');
      check(metrics.first.length>=2&&metrics.first.every(r=>r.top>=metrics.bodyTop-.5&&r.bottom<=metrics.bodyBottom+.5),label+' first two prose lines visible on opening: '+JSON.stringify(metrics));
      check(metrics.scrollTop===0,label+' opens at beginning');
    }
  }
  try {
    browser=await chromium.launch({channel:'msedge',headless:true});fs.mkdirSync(output,{recursive:true});
    for(const viewport of viewports) {
      const p=await page(viewport),label=viewport.width+'x'+viewport.height;
      await go(p);
      check(!await p.locator('#journey-tools').evaluate(node=>node.open),label+' tools initially collapsed');
      check(await p.locator('#refresh').isHidden()&&await p.locator('#clear').isHidden(),label+' maintenance actions do not crowd first screen');
      check((await p.locator('.study-preview-notice').textContent()).includes('未审'),label+' unreviewed sample disclosure retained');
      check(await p.locator('[data-stop]').count()===4,label+' four original scenes remain selectable');
      if(viewport.width===390||viewport.width===1440)await inViewport(p.locator('#reading > .journey-leaf-trigger'),label+' main reading action');
      await p.screenshot({path:path.join(output,'overview-'+label+'.png'),fullPage:true});
      await open(p);await layout(p,label+' tower');
      check(await p.locator('#journey-study').getAttribute('data-scene')==='tower',label+' registered original tower art');
      check(await p.locator('#reading-copy').textContent()===draft.points[0].paragraphs.join('\n\n'),label+' no shortened or invented prose');
      await p.screenshot({path:path.join(output,'reading-'+label+'.png')});
      await p.locator('#journey-leaf-body').evaluate(node=>{node.scrollTop=180;});
      const scroll=await p.locator('#journey-leaf-body').evaluate(node=>node.scrollTop),history=await p.evaluate(()=>window.history.length);
      await p.locator('#journey-leaf-tab-sources').click();await opened(p,'sources');
      check(await p.locator('dialog[open]').count()===1,label+' source switch uses one dialog');
      check(await p.evaluate(()=>window.history.length)===history,label+' source switch does not add browser history');
      check((await p.locator('#source-list').textContent()).includes('未通过人工审稿'),label+' sources never impersonate review');
      await p.screenshot({path:path.join(output,'sources-'+label+'.png')});
      await p.locator('#journey-leaf-tab-reading').click();await opened(p);
      check(Math.abs(await p.locator('#journey-leaf-body').evaluate(node=>node.scrollTop)-scroll)<=2,label+' return from sources preserves reading position');
      await p.locator('#reading-size').scrollIntoViewIfNeeded();await p.locator('#reading-size').click();
      check(await p.locator('#reading-copy').evaluate(node=>parseFloat(getComputedStyle(node).fontSize)>=21),label+' large font preserved');
      await layout(p,label+' large',{prose:false});
      await p.screenshot({path:path.join(output,'large-'+label+'.png')});
      await close(p);
      check(await p.locator('#reading > .journey-leaf-trigger').evaluate(node=>document.activeElement===node),label+' close returns to opening control after tab switches');
      await showJourneyTools(p);
      for(const selector of ['#refresh','#observe','#journey-help > .journey-leaf-trigger','#clear']) {
        await p.locator(selector).scrollIntoViewIfNeeded();await inViewport(p.locator(selector),label+' tool '+selector);
      }
      await toolClick(p,'#journey-help > .journey-leaf-trigger');await opened(p,'journey-help');
      check((await p.locator('#journey-leaf-body').textContent()).includes('不记录位置'),label+' privacy explanation remains reachable');
      await close(p);await p.close();
    }
    const p=await page();await go(p);await open(p);
    for(const [index,point] of draft.points.entries()) {
      check(await p.locator('#journey-study').getAttribute('data-scene')===point.id,'reading sequence retains '+point.id+' binding');
      check(await p.locator('#reading-copy').textContent()===point.paragraphs.join('\n\n'),'reading sequence keeps exact '+point.id+' copy');
      await layout(p,'sequence '+point.id);
      await p.screenshot({path:path.join(output,'scene-'+point.id+'-390x844.png')});
      await p.locator('#journey-leaf-next').click();
      if(index<draft.points.length-1) {
        await p.waitForFunction(id=>document.querySelector('#journey-study')?.dataset.scene===id,draft.points[index+1].id);
        await opened(p);
      }
    }
    await p.locator('#finished:not([hidden])').waitFor();
    check((await p.locator('#souvenir-count').textContent()).includes('0 / 4'),'reading/next never creates earned visits');
    await p.close();

    // Reduced motion and missing illustration preserve reading, not a blank leaf.
    const failed=await page();await failed.route('**/hhl-full-park-v2.webp',route=>route.abort());await go(failed);await open(failed);
    await failed.locator('#journey-study[data-art-state=failed]').waitFor();
    check(await failed.locator('#reading-copy').textContent()===draft.points[0].paragraphs.join('\n\n'),'failed painting retains exact current content');
    check(await failed.locator('#journey-leaf-dialog').evaluate(node=>!node.style.transform&&!node.style.willChange),'reduced-motion leaf has no lingering transform');
    await layout(failed,'failed illustration');await failed.screenshot({path:path.join(output,'missing-art-390x844.png')});await failed.close();

    const missingFont=await page();await missingFont.route('**/longcang-journey-v1.woff2',route=>route.abort());
    await missingFont.goto(base,{waitUntil:'domcontentloaded'});await missingFont.locator('#content:not([hidden])').waitFor();await open(missingFont);
    check(await missingFont.locator('#journey-leaf-title').textContent()===draft.points[0].title,'missing display font retains the complete readable scene title');
    await layout(missingFont,'missing display font');
    await missingFont.screenshot({path:path.join(output,'missing-font-390x844.png')});await missingFont.close();

    // A failed recheck must close the paper and erase old text; polish is not a cache bypass.
    const stale=await page();await go(stale);await open(stale);
    await stale.route('**'+apiPath,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,available:false,reason:'本地测试资料撤回'})}));
    await stale.locator('#journey-leaf-tab-sources').click();await stale.locator('#retry:not([hidden])').waitFor();
    check(await stale.locator('#journey-leaf-dialog').isHidden(),'withdrawal while switching closes leaf');
    check(await stale.locator('#reading-copy').textContent()===''&&await stale.locator('#source-list').textContent()==='','withdrawal erases detached prose and sources');
    await stale.screenshot({path:path.join(output,'withdrawn-390x844.png'),fullPage:true});await stale.close();

    // Long copy does not cover the close or next action, nor introduce another scroller.
    const long=await page({width:667,height:320});await go(long);await open(long);
    await long.locator('#reading-copy').evaluate(node=>{node.textContent='仅供本地版面测试，不是景区事实。'.repeat(200);});
    check(await long.locator('#journey-leaf-body').evaluate(node=>node.scrollHeight>node.clientHeight),'long prose uses the one reading scroll area');
    await layout(long,'long landscape',{prose:false});await long.screenshot({path:path.join(output,'long-landscape.png')});await long.close();
    check(external.length===0,'no third-party connections: '+JSON.stringify(external));
    check(requests.filter(request=>request.url.startsWith(server.url+apiPath)).every(request=>request.method==='GET'),'only local read-only content access');
    check(errors.length===0,'no browser errors: '+JSON.stringify(errors));
    console.log('PASS reading design: '+checks+' checks; five viewports, initial prose, restrained tools, single-leaf tabs, fonts, sources, four-scene continuity, failure states. '+output);
  } finally {if(browser)await browser.close();await server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
