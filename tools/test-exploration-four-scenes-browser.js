'use strict';
// Isolated local editorial drafts and a fresh headless Edge profile only.
// These checks do not approve historical claims, actual paths or cloud publishing.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {chromium} = require('playwright');
const preview = require('./lib/exploration-four-scenes-preview');
const draft = require('./fixtures/four-scenes-study.json');
const output = path.resolve(__dirname,'../artifacts/exploration-journey-live/four-scenes');
const resourceId = 'hhl-four-scenes-study';
let checks = 0;
function check(value,name) {assert(value,name);checks++;}

(async () => {
  const server = await preview.start();
  let browser;
  const errors = [], requests = [], external = [];
  const url = server.url+'/four-scenes.html?resourceId='+resourceId;
  const htmlResponse = await fetch(url), html = await htmlResponse.text();
  const apiPath = html.match(/fetch\(["'](\/__[\w-]+)["']/)?.[1];
  check(Boolean(apiPath),'preview exposes one inspectable local read endpoint');
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
    await p.goto(url+query);
    await p.locator('#content:not([hidden])').waitFor();
  };
  const opened = async p => p.locator('#journey-leaf-dialog[open][data-state=open][aria-busy=false]').waitFor();
  const open = async p => {await p.locator('#reading > .journey-leaf-trigger').click();await opened(p);};
  const close = async p => {await p.locator('.journey-leaf-close').click();await p.locator('#journey-leaf-dialog').waitFor({state:'hidden'});};
  const detail = p => p.locator('#journey-study .journey-study-controls button');
  const idle = async p => p.waitForFunction(() => {
    const art=document.querySelector('.journey-study-art'),line=document.querySelector('.journey-study-lines');
    return art&&!art.style.willChange&&(!window.gsap||(!gsap.isTweening(art)&&!gsap.isTweening(line)));
  });
  const select = async (p,id) => {await p.locator('[data-stop='+id+']').click();await opened(p);};
  const holdRead = async p => {
    let release,captured,finished;
    const wait=new Promise(resolve=>{release=resolve;}),seen=new Promise(resolve=>{captured=resolve;});
    const done=new Promise(resolve=>{finished=resolve;});
    const handler=async route=>{try{const response=await route.fetch();captured();await wait;await route.fulfill({response});}finally{finished();}};
    await p.route(apiPattern,handler);
    return {captured:seen,release,clear:async()=>{await done;await p.unroute(apiPattern,handler);}};
  };
  const expected = id => draft.points.find(point=>point.id===id);
  const details = {tower:'eaves',copper:'outline',baiyun:'roofline',pond:'waterside'};
  async function verifyScene(p,id,label) {
    const point=expected(id);
    check(await p.locator('#point-title').textContent()===point.title,label+' selects the matching chapter');
    check(await p.locator('#study-preview-theme').textContent()===point.theme,label+' keeps its own editorial question');
    check(await p.locator('#reading-copy').textContent()===point.paragraphs.join('\n\n'),label+' renders only the current editorial prose');
    check(await p.locator('#journey-study').getAttribute('data-scene')===id,label+' binds its own artwork');
    check(await p.locator('#journey-study').getAttribute('data-detail')==='whole',label+' begins at whole view');
    check(await p.locator('.journey-study-art image').count()===1,label+' uses one original painting, not a sticker overlay');
    check(await p.evaluate(scene=>{
      const config=window.ChuJourneyStudyScenes[scene],profile=window.ChuParkGildedProfiles[scene];
      const paths=[...document.querySelectorAll('.journey-study-lines path')];
      return document.querySelector('#journey-study svg').getAttribute('viewBox')===config.viewBox.join(' ')&&
        paths.length===config.contours.length&&paths.every((node,index)=>node.getAttribute('d')===profile.contours[config.contours[index]].points.map((value,i)=>(i?'L':'M')+value.join(' ')).join(' '));
    },id),label+' crop and light paths match the registered original art');
    await detail(p).click();
    await p.waitForFunction(value=>document.querySelector('#journey-study').dataset.detail===value,details[id]);await idle(p);
    check(await detail(p).getAttribute('aria-pressed')==='true',label+' detail has selected state');
    check(await p.locator('.journey-study-art').evaluate(e=>new DOMMatrixReadOnly(getComputedStyle(e).transform).a>1.1),label+' original art moves to detail');
    check(await p.locator('#reading-copy').textContent()===point.paragraphs.join('\n\n'),label+' detail cannot replace content');
    check(await p.locator('[data-recorded=true]').count()===0,label+' looking is not an awarded or recorded visit');
  }
  try {
    browser=await chromium.launch({channel:'msedge',headless:true});fs.mkdirSync(output,{recursive:true});
    const policy=htmlResponse.headers.get('content-security-policy')||'';
    const directives=new Map(policy.split(';').map(part=>{const [key,...values]=part.trim().split(/\s+/);return [key,values];}));
    check(htmlResponse.status===200,'four-scene preview is served');
    check(directives.get('connect-src')?.join(' ')==="'self'",'all data connections remain same-origin');
    check(directives.get('base-uri')?.join(' ')==="'none'"&&directives.get('form-action')?.join(' ')==="'none'",'base changes and form posting are blocked');
    const inline=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    check(inline.length===1,'one local adapter only');
    const hash="'sha256-"+crypto.createHash('sha256').update(inline[0][1]).digest('base64')+"'";
    check(directives.get('script-src')?.join(' ')==="'self' "+hash,'only exact local adapter and self scripts are executable');
    check(!html.includes('guide-cloud.js'),'preview does not install the cloud adapter');
    check(draft.status==='editorial-draft'&&draft.publishAllowed===false,'draft remains explicitly unpublished');
    check((await fetch(server.url+apiPath,{method:'POST'})).status===405,'read endpoint rejects writes');
    for(const route of ['/tools/fixtures/four-scenes-study.json','/tools/lib/exploration-four-scenes-preview.js','/static/guide-cloud.js','/explore-journey.html'])
      check((await fetch(server.url+route)).status===404,'no undeclared route: '+route);
    const result=preview.response();
    check(result.localTest===true&&result.walk.simulated===true&&result.walk.resourceId===resourceId,'separate explicit local-only resource');
    check(result.walk.points.length===4,'four different draft chapters');
    const productionHTML=fs.readFileSync(path.resolve(__dirname,'../explore-journey.html'),'utf8');
    check(!productionHTML.includes(resourceId)&&!productionHTML.includes('four-scenes-study.json'),'no production query-unlock or embedded draft');

    const p=await page();await go(p);
    check(await p.locator('[data-stop]').count()===4,'four visible chapter choices');
    check((await p.locator('.study-preview-notice').textContent()).includes('未审'),'review boundary is visible above the painting');
    check(await p.locator('#journey-stops').getAttribute('aria-label')==='按待审样章顺序阅读','order is labelled reading order, not approved route');
    check(await p.evaluate(()=>typeof window.GuideCloud==='undefined'),'cloud client is not installed');
    check(await p.evaluate(async()=>{try{await ExplorationAdapter.call({action:'publish',resourceId:'hhl-four-scenes-study'});return false;}catch{return true;}}),'adapter refuses unsupported actions');
    await open(p);
    check((await p.locator('.study-draft-note').textContent()).includes('人工'),'unreviewed boundary stays inside the reading leaf');
    for(const [index,point] of draft.points.entries()) {
      await verifyScene(p,point.id,'ordered '+point.id);
      check((await p.locator('#journey-leaf-next').textContent()).includes(index===3?'收卷留念':draft.points[index+1].title),'continue has specific destination '+point.id);
      await p.locator('#journey-leaf-next').click();
      if(index<3) {
        await p.waitForFunction(id=>document.querySelector('#journey-study')?.dataset.scene===id,draft.points[index+1].id);
        await opened(p);
      }
    }
    await p.locator('#finished:not([hidden])').waitFor();
    check(await p.locator('#journey-leaf-dialog').isHidden(),'last page returns to closed souvenir view');
    check((await p.locator('#souvenir-count').textContent()).includes('0 / 4'),'finishing never fabricates observations');
    check(await p.locator('#souvenir-stops li').count()===0,'no unearned scenic points');
    await p.locator('#return').click();await p.locator('#content:not([hidden])').waitFor();
    for(const id of ['copper','tower','pond','baiyun']) {
      await select(p,id);await verifyScene(p,id,'free '+id);await close(p);
      await p.locator('#sources > .journey-leaf-trigger').click();await opened(p);
      const links=await p.locator('#source-list a').evaluateAll(nodes=>nodes.map(node=>node.href));
      check(expected(id).sources.every(source=>links.includes(source.url)),'current chapter sources are traceable '+id);
      check(links.length===expected(id).sources.length,'previous chapter sources cannot leak into '+id);
      check((await p.locator('#source-list').textContent()).includes('未通过人工审稿'),'source list does not impersonate human approval '+id);
      await close(p);
    }
    await p.reload();await p.locator('#content:not([hidden])').waitFor();
    check(await p.locator('#journey-resume').isVisible(),'explicit previous reading position has a continuation affordance');
    check(await p.locator('#point-title').textContent()===expected('baiyun').title,'reload preserves selected chapter');
    check(await p.locator('#journey-leaf-dialog').isHidden(),'reload does not unexpectedly open paper');
    await p.locator('#continue-journey').click();await opened(p);
    check(await p.locator('#journey-study').getAttribute('data-scene')==='baiyun','continue resumes the same chapter, not the next');
    check(await p.locator('#journey-study').getAttribute('data-detail')==='whole','continued paper resets old closeup pose');
    const saved=await p.evaluate(key=>JSON.parse(localStorage.getItem(key)), 'chulink:journey-content:v1:'+resourceId);
    check(Object.values(saved).every(value=>value.observed.length===0&&!('reading' in value)&&!('sources' in value)),'local continuation stores no prose, sources or false observation');
    await p.close();

    for(const viewport of [{width:320,height:900},{width:390,height:900},{width:768,height:900},{width:1440,height:900},{width:667,height:320}]) {
      const q=await page({viewport});await go(q);await q.evaluate(()=>document.fonts.ready);
      await q.screenshot({path:path.join(output,'painting-'+viewport.width+'x'+viewport.height+'.png'),fullPage:true});
      for(const point of draft.points) {
        await select(q,point.id);await detail(q).scrollIntoViewIfNeeded();
        check(await q.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'page fits '+point.id+' '+viewport.width);
        check(await q.locator('#journey-leaf-body').evaluate(e=>e.scrollWidth<=e.clientWidth+1),'paper fits '+point.id+' '+viewport.width);
        check(await detail(q).evaluate(e=>{const box=e.getBoundingClientRect();return box.width>=44&&box.height>=44&&box.left>=0&&box.right<=innerWidth;}),'detail target fits '+point.id+' '+viewport.width);
        await q.screenshot({path:path.join(output,point.id+'-whole-'+viewport.width+'x'+viewport.height+'.png')});
        await detail(q).click();await q.waitForFunction(value=>document.querySelector('#journey-study').dataset.detail===value,details[point.id]);await idle(q);
        await q.screenshot({path:path.join(output,point.id+'-detail-'+viewport.width+'x'+viewport.height+'.png')});
        check(await q.locator('#reading-copy').textContent()===point.paragraphs.join('\n\n'),'responsive page retains exact current draft '+point.id+' '+viewport.width);
        await close(q);
      }
      await q.close();
    }

    const animated=await page({reducedMotion:'no-preference'});await go(animated,'&pointId=copper');await open(animated);
    await detail(animated).click();await animated.waitForFunction(()=>document.querySelector('#journey-study').dataset.detail==='outline');await idle(animated);
    check(await animated.locator('.journey-study-art').evaluate(e=>!e.style.willChange&&!gsap.isTweening(e)),'normal animation settles without permanent compositor hints');
    await detail(animated).click();await animated.waitForFunction(()=>document.querySelector('#journey-study').dataset.detail==='whole');
    await animated.emulateMedia({reducedMotion:'reduce'});await detail(animated).click();
    await animated.waitForFunction(()=>document.querySelector('#journey-study').dataset.detail==='outline');
    check(await animated.locator('.journey-study-art').evaluate(e=>!gsap.isTweening(e)&&!e.style.willChange),'reduced-motion detail settles immediately');
    await animated.close();

    for(const missing of ['exploration-journey-study-scenes.js','gsap-3.15.0.min.js','hhl-full-park-v2.webp']) {
      const q=await page();await q.route('**/'+missing,route=>route.abort());await go(q,'&pointId=pond');await open(q);
      check(await q.locator('#reading-copy').textContent()===expected('pond').paragraphs.join('\n\n'),'missing asset preserves real current draft '+missing);
      check(await q.locator('#journey-leaf-next').isEnabled(),'missing asset preserves finish action '+missing);
      if(missing==='exploration-journey-study-scenes.js')check(await q.locator('#journey-study').isHidden(),'missing scene registry does not guess a closeup');
      else if(missing==='gsap-3.15.0.min.js') {
        await detail(q).click();await q.waitForFunction(()=>document.querySelector('#journey-study').dataset.detail==='waterside');
        check(await q.locator('.journey-study-art').evaluate(e=>new DOMMatrixReadOnly(getComputedStyle(e).transform).a>1.1),'no-GSAP original-art detail has a static fallback');
      } else {
        await q.waitForFunction(()=>document.querySelector('.journey-study-caption')?.textContent.includes('暂未载入'));
        check(await q.locator('.journey-study-controls button').isEnabled()&&(await q.locator('.journey-study-controls button').textContent()).includes('重新加载原画'),'failed original art offers a usable retry instead of a dead detail button');
        check(await q.locator('.journey-study-frame').isHidden(),'failed original art does not show broken imagery');
      }
      await q.close();
    }
    for(const mutation of ['withdraw','version']) {
      const q=await page();await go(q,'&pointId=baiyun');await open(q);
      await q.route(apiPattern,route=>{
        const value=mutation==='withdraw'?{ok:true,available:false,reason:'测试资料撤回'}:preview.response();
        if(mutation==='version'){value.walk.version++;value.walk.fingerprint+='-new';}
        return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(value)});
      });
      await detail(q).click();await q.locator('#retry:not([hidden])').waitFor();
      check(await q.locator('#journey-leaf-dialog').isHidden(),mutation+' closes stale paper immediately');
      check(await q.locator('#journey-study').textContent()==='',mutation+' erases old closeup DOM');
      check(await q.locator('#reading-copy').textContent()==='',mutation+' erases old prose');
      check(await q.locator('#source-list').textContent()==='',mutation+' erases old sources');
      if(mutation==='version') {
        await q.locator('#retry').click();await q.locator('#content:not([hidden])').waitFor();await open(q);
        check(await q.locator('#journey-study').getAttribute('data-detail')==='whole','accepted new version starts at whole view');
      }
      await q.close();
    }
    const late=await page();await go(late,'&pointId=pond');await open(late);
    const held=await holdRead(late);await detail(late).click();await held.captured;await late.keyboard.press('Escape');
    await late.locator('#journey-leaf-dialog').waitFor({state:'hidden'});held.release();await held.clear();await late.waitForTimeout(100);
    check(await late.locator('#journey-leaf-dialog').isHidden(),'late read cannot reopen a dismissed leaf');
    check(await late.locator('#journey-study').getAttribute('data-detail')==='whole','late read cannot apply a stale waterside pose');
    await late.close();
    check(external.length===0,'no external requests: '+external.join('; '));
    check(requests.every(request=>request.method==='GET'),'browser performs read requests only');
    check(errors.length===0,'no uncaught page errors: '+errors.join('; '));
    console.log('PASS four-scene editorial browser: '+checks+' checks; four distinct chapters, original-art detail, continuation, failure isolation, same-origin reads and five viewport screenshots. '+output);
  } finally {if(browser)await browser.close();await server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
