'use strict';
// Local fake database and an isolated headless Edge only; no cloud writes or browser profile.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const {chromium} = require('playwright');
const {start} = require('./lib/exploration-journey-preview');
let checks = 0;
function check(value, name) {assert(value, name);checks++;}

(async () => {
  const server = await start(), browser = await chromium.launch({channel:'msedge',headless:true});
  const out = path.join(__dirname,'../artifacts/exploration-journey-live/study');fs.mkdirSync(out,{recursive:true});
  const errors = [], actions = [];
  const page = async options => {
    const p = await browser.newPage({viewport:{width:390,height:900},...options});
    p.on('pageerror',error => errors.push(error.message));
    p.on('request',request => {if(request.url().endsWith('/__journey'))actions.push(request.postDataJSON().action);});
    await p.addInitScript(() => {
      const interval = window.setInterval;window.__rechecks = [];
      window.setInterval = (fn,ms,...args) => {if(ms===30000 && typeof fn==='function')window.__rechecks.push(()=>fn(...args));return interval(fn,ms,...args);};
    });
    return p;
  };
  const go = async p => {await p.goto(server.url+'/explore-journey.html?resourceId=r');await p.locator('#content:not([hidden])').waitFor();};
  const open = async p => {
    await p.locator('#reading > .journey-leaf-trigger').click();
    await p.locator('#journey-leaf-dialog[open][data-leaf=reading][data-state=open][aria-busy=false]').waitFor();
  };
  const close = async p => {await p.locator('.journey-leaf-close').click();await p.locator('#journey-leaf-dialog').waitFor({state:'hidden'});};
  const studyButton = p => p.locator('#journey-study button');
  const idle = async p => p.waitForFunction(() => {
    const group=document.querySelector('.journey-study-art');
    return group && !group.style.willChange && (!window.gsap || (!gsap.isTweening(group) && !gsap.isTweening(document.querySelector('.journey-study-lines'))));
  });
  const scenario = async kind => {
    const p = await browser.newPage();await p.goto(server.url+'/preview-control.html');
    await p.locator('[data-kind='+kind+']').click();await p.waitForFunction(()=>document.querySelector('#result').textContent.includes('已完成'));await p.close();
  };
  const holdRead = async p => {
    let release, captured, finished;
    const wait = new Promise(resolve=>{release=resolve;}), seen = new Promise(resolve=>{captured=resolve;});
    const done = new Promise(resolve=>{finished=resolve;});
    const handler = async route => {try{const response=await route.fetch();captured();await wait;await route.fulfill({response});}finally{finished();}};
    await p.route('**/__journey',handler);
    return {captured:seen,release,clear:async()=>{await done;await p.unroute('**/__journey',handler);}};
  };
  try {
    const p = await page();await go(p);
    const expected = await p.locator('#reading-copy').textContent();
    check(expected.includes('本地流程演示'),'fixture remains explicitly non-historical');
    check(await p.locator('#journey-study').isHidden(),'study mounted behind closed reading leaf');
    check(await p.locator('#journey-study').getAttribute('data-detail')==='whole','initial study is whole original image');
    const held = await holdRead(p);
    await p.locator('#reading > .journey-leaf-trigger').click();await held.captured;
    check(await p.locator('#journey-study').isHidden(),'pending verification never reveals study');
    held.release();await held.clear();await p.locator('#journey-leaf-dialog[aria-busy=false][data-state=open]').waitFor();
    await studyButton(p).waitFor({state:'visible'});
    await p.waitForFunction(()=>!document.querySelector('#journey-study button').disabled);
    check(await p.locator('#journey-study svg image').count()===1,'one original-image crop, no sticker image');
    check((await p.locator('#journey-study svg image').getAttribute('href')).endsWith('hhl-full-park-v2.webp'),'study uses current original artwork');
    check(await p.locator('.journey-study-lines path').count()===4,'registered painting contours only');
    check((await p.locator('#journey-study').textContent()).includes('非实景'),'artwork interpretation is labelled');
    check(await p.locator('#reading-copy').textContent()===expected,'backend text unchanged by study mount');
    check(await p.evaluate(()=>localStorage.getItem('chulink:journey-content:v1:r'))===null,'opening study records nothing');
    const repeated = await holdRead(p);
    await studyButton(p).evaluate(button=>{button.click();button.click();});await repeated.captured;
    check(await studyButton(p).isDisabled(),'duplicate click disabled during public recheck');
    check(await studyButton(p).getAttribute('aria-busy')==='true','pending detail has an accessible busy state');
    repeated.release();await repeated.clear();await p.waitForFunction(()=>document.querySelector('#journey-study').dataset.detail==='eaves');await idle(p);
    check(await studyButton(p).getAttribute('aria-pressed')==='true','detail button exposes selected state');
    check(await p.locator('.journey-study-art').evaluate(e=>new DOMMatrixReadOnly(getComputedStyle(e).transform).a>1.4),'original image enlarges for detail');
    check(await p.locator('.journey-study-lines').evaluate(e=>+getComputedStyle(e).opacity>.5),'registered roof contours become visible');
    check(await p.locator('#reading-copy').textContent()===expected,'detail never overwrites verified reading');
    check(await p.locator('[data-recorded=true]').count()===0,'detail is not a recorded visit');
    check(await p.evaluate(()=>localStorage.getItem('chulink:journey-content:v1:r'))===null,'detail interaction does not persist progress');
    await studyButton(p).click();await p.waitForFunction(()=>document.querySelector('#journey-study').dataset.detail==='whole');await idle(p);
    check(await p.locator('.journey-study-art').evaluate(e=>Math.abs(new DOMMatrixReadOnly(getComputedStyle(e).transform).a-1)<.01),'detail returns to exact original scale');
    await studyButton(p).click();await p.waitForFunction(()=>document.querySelector('#journey-study').dataset.detail==='eaves');
    await p.locator('.journey-leaf-close').evaluate(e=>e.click());
    check(await p.locator('.journey-study-art').evaluate(e=>!e.style.willChange&&!gsap.isTweening(e)),'paper closing stops detail animation immediately');
    await p.locator('dialog').waitFor({state:'hidden'});await open(p);
    check(await p.locator('#journey-study').getAttribute('data-detail')==='whole','reopening resets previous detail pose');
    await studyButton(p).focus();await p.keyboard.press('Enter');
    await p.waitForFunction(()=>document.querySelector('#journey-study').dataset.detail==='eaves');await idle(p);
    check(await studyButton(p).getAttribute('aria-pressed')==='true','keyboard operates detail');
    await p.locator('#journey-leaf-next').click();
    await p.waitForFunction(()=>document.querySelector('#journey-leaf-dialog').dataset.state==='open'&&document.querySelector('#journey-leaf-title').textContent==='古铜顶');
    check(await p.locator('#journey-study').isVisible(),'next copper scene has its own original-art study');
    check(await p.locator('#journey-study').getAttribute('data-scene')==='copper','next scene replaces tower binding with copper');
    check(await p.locator('#journey-study').getAttribute('data-detail')==='whole','next scene resets tower detail pose');
    check(await p.locator('#journey-study svg').getAttribute('viewBox')==='580 188 160 160','copper window uses its own original-art crop');
    check(await p.locator('.journey-study-lines path').count()===3,'copper has only its own registered contours');
    check(!(await p.locator('#journey-study').textContent()).includes('层檐'),'old tower caption never remains in copper study');
    // This older fake database deliberately gives each point the same generic
    // non-historical copy. Compare the copper response, not a false text difference.
    check(await p.evaluate(async()=>{
      const response=await ExploreTransport.call({action:'getSiteExploration',resourceId:'r'});
      const point=response.walk.points.find(item=>item.id==='copper');
      return document.querySelector('#reading-copy').textContent===(point.reading||point.text);
    }),'next scene uses its matching public copper response');
    check(await p.evaluate(()=>[...document.querySelectorAll('.journey-study-lines path')].every((node,i)=>node.getAttribute('d')===ChuParkGildedProfiles.copper.contours[ChuJourneyStudyScenes.copper.contours[i]].points.map((p,j)=>(j?'L':'M')+p.join(' ')).join(' '))),'copper paths exactly match its registered source profile');
    await close(p);
    for(const scene of ['baiyun','pond']) {
      await p.locator('[data-stop='+scene+']').click();await p.locator('#journey-leaf-dialog[data-state=open][aria-busy=false]').waitFor();
      check(await p.locator('#journey-study').isVisible(),scene+' has an explicit original-art study');
      check(await p.locator('#journey-study').getAttribute('data-scene')===scene,scene+' replaces previous scene binding');
      check(await p.evaluate(id=>document.querySelector('#journey-study svg').getAttribute('viewBox')===ChuJourneyStudyScenes[id].viewBox.join(' '),scene),scene+' uses its own crop');
      check(await p.evaluate(id=>[...document.querySelectorAll('.journey-study-lines path')].every((node,i)=>node.getAttribute('d')===ChuParkGildedProfiles[id].contours[ChuJourneyStudyScenes[id].contours[i]].points.map((p,j)=>(j?'L':'M')+p.join(' ')).join(' ')),scene),scene+' has only its own registered contours');
      check(!(await p.locator('#journey-study').textContent()).includes('从一处层檐看起'),scene+' has no old tower caption');await close(p);
    }
    await p.close();

    const sizes = [{width:320,height:900},{width:390,height:900},{width:768,height:900},{width:1440,height:900},{width:667,height:320}];
    for(const viewport of sizes) {
      const q=await page({viewport});await go(q);await open(q);await studyButton(q).scrollIntoViewIfNeeded();
      check(await q.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no page overflow '+viewport.width+'x'+viewport.height);
      check(await q.locator('#journey-leaf-body').evaluate(e=>e.scrollWidth<=e.clientWidth+1),'no paper overflow '+viewport.width+'x'+viewport.height);
      check(await studyButton(q).evaluate(e=>{const r=e.getBoundingClientRect();return r.width>=44&&r.height>=44&&r.left>=0&&r.right<=innerWidth;}),'44px detail target '+viewport.width+'x'+viewport.height);
      await q.screenshot({path:path.join(out,'study-whole-'+viewport.width+'x'+viewport.height+'.png')});
      await studyButton(q).click();await q.waitForFunction(()=>document.querySelector('#journey-study').dataset.detail==='eaves');await idle(q);
      await q.screenshot({path:path.join(out,'study-eaves-'+viewport.width+'x'+viewport.height+'.png')});
      check(await q.locator('#reading-copy').textContent()===expected,'responsive study keeps backend text '+viewport.width+'x'+viewport.height);
      await q.close();
    }

    const reduced=await page({reducedMotion:'reduce'});await go(reduced);await open(reduced);await studyButton(reduced).click();
    await reduced.waitForFunction(()=>document.querySelector('#journey-study').dataset.detail==='eaves');
    check(await reduced.locator('.journey-study-art').evaluate(e=>!gsap.isTweening(e)&&!e.style.willChange),'reduced-motion detail is instant');
    await studyButton(reduced).click();await reduced.waitForFunction(()=>document.querySelector('#journey-study').dataset.detail==='whole');
    await reduced.emulateMedia({reducedMotion:'no-preference'});await studyButton(reduced).click();
    await reduced.waitForFunction(()=>document.querySelector('#journey-study').dataset.detail==='eaves');
    await reduced.emulateMedia({reducedMotion:'reduce'});
    check(await reduced.locator('.journey-study-art').evaluate(e=>!gsap.isTweening(e)&&!e.style.willChange),'motion preference change settles active detail');await reduced.close();

    for(const missing of ['exploration-journey-study.js','exploration-journey-study-scenes.js','gsap-3.15.0.min.js','hhl-full-park-v2.webp']) {
      const q=await page();await q.route('**/'+missing,route=>route.abort());await go(q);await open(q);
      check(await q.locator('#reading-copy').isVisible(),'missing '+missing+' preserves reading');
      check(await q.locator('#journey-leaf-next').isEnabled(),'missing '+missing+' preserves next');
      if(missing==='exploration-journey-study.js'||missing==='exploration-journey-study-scenes.js')check(await q.locator('#journey-study').isHidden(),'missing study script/config stays empty: '+missing);
      else if(missing==='gsap-3.15.0.min.js'){
        await studyButton(q).click();await q.waitForFunction(()=>document.querySelector('#journey-study').dataset.detail==='eaves');
        check(await q.locator('.journey-study-art').evaluate(e=>new DOMMatrixReadOnly(getComputedStyle(e).transform).a>1.4),'no GSAP has static detail fallback');
      }else{
        await q.waitForFunction(()=>document.querySelector('.journey-study-caption').textContent.includes('暂未载入'));
        check(await q.locator('.journey-study-frame').isHidden(),'failed original image hides broken image');
        check(await q.locator('.journey-study-controls button').isEnabled()&&(await q.locator('.journey-study-controls button').textContent()).includes('重新加载原画'),'failed original image offers one explicit recovery control');
      }
      await q.close();
    }

    // The original HTML details fallback remains useful if the paper enhancement fails.
    const native=await page();await native.route('**/exploration-journey-leaves.js',route=>route.abort());await go(native);
    await native.locator('#reading summary').click();await native.locator('#reading-copy').waitFor();
    await studyButton(native).click();await native.waitForFunction(()=>document.querySelector('#journey-study').dataset.detail==='eaves');
    check(await studyButton(native).getAttribute('aria-pressed')==='true','native verified reading supports study');
    await native.locator('#reading summary').click();
    check(await native.locator('#journey-study').isHidden(),'native close hides study');
    check(await native.locator('#journey-study').getAttribute('data-detail')==='whole','native close resets detail');await native.close();

    for(const kind of ['withdraw','pause','reorder','offline']) {
      await scenario('reset');const q=await page();await go(q);await open(q);await scenario(kind);
      await studyButton(q).click();await q.locator('#retry:not([hidden])').waitFor();
      check(await q.locator('#journey-leaf-dialog').isHidden(),kind+' blocks detail');
      check(await q.locator('#journey-study').textContent()==='',''+kind+' clears study DOM');
      check(await q.locator('#reading-copy').textContent()==='',kind+' clears stale reading');await q.close();
    }
    await scenario('reset');
    const late=await page();await go(late);await open(late);const pending=await holdRead(late);
    await studyButton(late).click();await pending.captured;await late.keyboard.press('Escape');
    await late.locator('dialog').waitFor({state:'hidden'});pending.release();await pending.clear();await late.waitForTimeout(150);
    check(await late.locator('#journey-study').getAttribute('data-detail')==='whole','late verification after close never applies detail');
    check(await late.locator('#journey-leaf-dialog').isHidden(),'late verification never reopens paper');await late.close();

    const binding=await page();await go(binding);await open(binding);
    const fixture=server.fixture,draft=(await fixture.call({action:'getSiteWalkDraft',resourceId:'r'})).publishedDraft;
    delete draft.exploration.objects.find(object=>object.artScene==='tower').artScene;await fixture.publish(draft);
    await studyButton(binding).click();await binding.locator('#retry:not([hidden])').waitFor();
    check(await binding.locator('#journey-study').textContent()==='','binding change invalidates old detail');
    await binding.locator('#retry').click();await binding.locator('#content:not([hidden])').waitFor();await open(binding);
    check(await binding.locator('#journey-study').isHidden(),'same title without explicit binding has no study');
    check(await binding.locator('#reading-copy').isVisible(),'unbound point retains public reading');await binding.close();await scenario('reset');

    const background=await page();await go(background);await open(background);await studyButton(background).click();
    await background.waitForFunction(()=>document.querySelector('#journey-study').dataset.detail==='eaves');
    await background.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
    check(await background.locator('#journey-study').textContent()==='','background clears study');
    check(await background.locator('dialog').isHidden(),'background closes paper');await background.close();

    // The editorial specimen is intentionally a separate local-only read server,
    // never a public fixture that could be mistaken for an approved guide.
    const specimenTool=require('./lib/exploration-tower-study-preview');
    const productionHTML=fs.readFileSync(path.join(__dirname,'../explore-journey.html'),'utf8');
    for (const marker of ['<!-- journey-local-adapter -->','</head>','<body class="scenic-journey">','<p id="reading-copy">',
      '<script defer src="static/guide-cloud.js"></script>','aria-label="已审内容阅读"','aria-label="按已发布顺序阅读"',
      '正在核对当前公开版本','正在核对当前公开资料。']) {
      for (const replacement of ['',marker+marker]) {
        await assert.rejects(specimenTool.start(0,{html:productionHTML.replace(marker,replacement)}),/本地样章注入点必须唯一/,
          'missing/duplicate specimen boundary must fail before listening: '+marker);
        checks++;
      }
    }
    const specimenDraft=require('./fixtures/tower-study.json'),specimen=await specimenTool.start();
    try {
      const result=specimenTool.response();
      check(specimenDraft.status==='editorial-draft'&&specimenDraft.publishAllowed===false,'specimen is explicitly unpublished');
      check(result.localTest===true&&result.walk.simulated===true,'specimen uses the local/simulated contract');
      check(result.walk.resourceId==='hhl-tower-study'&&result.walk.points.length===1,'specimen has its own single-scene resource');
      check(result.walk.points[0].reading===specimenDraft.paragraphs.join('\n\n'),'specimen content is its transparent review draft');
      check((await fetch(specimen.url+'/__tower-study',{method:'POST'})).status===405,'specimen rejects POST');
      for(const route of ['/tools/fixtures/tower-study.json','/tools/lib/exploration-tower-study-preview.js','/explore-journey.html','/static/guide-cloud.js'])
        check((await fetch(specimen.url+route)).status===404,'specimen has no public route '+route);
      const specimenPage=await fetch(specimen.url+'/tower-study.html?resourceId=hhl-tower-study');
      const specimenHTML=await specimenPage.text(),policy=specimenPage.headers.get('content-security-policy')||'';
      const directives=new Map(policy.split(';').map(part=>{const [key,...values]=part.trim().split(/\s+/);return [key,values];}));
      check(directives.get('connect-src')?.join(' ')==="'self'",'specimen CSP restricts connections to local origin');
      check(directives.get('default-src')?.join(' ')==="'self'",'specimen CSP defaults to local assets');
      check(directives.get('base-uri')?.join(' ')==="'none'"&&directives.get('form-action')?.join(' ')==="'none'",'specimen CSP disallows base changes and form submissions');
      check(directives.get('object-src')?.join(' ')==="'none'"&&directives.get('frame-ancestors')?.join(' ')==="'none'",'specimen CSP disallows plugins and embedding');
      const inlineScripts=[...specimenHTML.matchAll(/<script>([\s\S]*?)<\/script>/g)];
      check(inlineScripts.length===1,'specimen has exactly one inline local adapter');
      const adapterHash="'sha256-"+crypto.createHash('sha256').update(inlineScripts[0][1]).digest('base64')+"'";
      check(directives.get('script-src')?.join(' ')==="'self' "+adapterHash,'specimen permits only self scripts and the exact local adapter hash');
      check(!specimenHTML.includes('guide-cloud.js'),'specimen HTML removes cloud adapter script');
      check(specimenHTML.includes('aria-label="待审样章阅读"')&&specimenHTML.includes('aria-label="按待审样章顺序阅读"'),'specimen reading and navigation ARIA explicitly say draft');
      check(!specimenHTML.includes('正在核对当前公开版本')&&!specimenHTML.includes('正在核对当前公开资料。'),'initial specimen status does not claim a public version');
      check(specimenHTML.includes('本页不是正式导览'),'specimen noscript fallback remains explicitly unreviewed');
      check(!productionHTML.includes('tower-study')&&!productionHTML.includes(specimenDraft.title),'production HTML has no draft or query-unlock hook');
      for(const name of ['deploy-cloudbase.ps1','validate-cloudbase-build.js']) {
        const manifest=fs.readFileSync(path.join(__dirname,name),'utf8');
        check(!manifest.includes('fixtures/tower-study.json')&&!manifest.includes('exploration-tower-study-preview.js'),'draft/server excluded from '+name+' explicit resource list');
      }
      const sample=await page(),sampleRequests=[],fontResponses=[];
      sample.on('request',request=>sampleRequests.push(request.url()));
      sample.on('response',response=>{if(/\.woff2(?:\?|$)/.test(response.url()))fontResponses.push({url:response.url(),status:response.status()});});
      await sample.goto(specimen.url+'/tower-study.html?resourceId=hhl-tower-study');await sample.locator('#content:not([hidden])').waitFor();
      check((await sample.locator('.study-preview-notice').textContent()).includes('未审稿'),'specimen displays unreviewed banner');
      check(await sample.evaluate(()=>typeof window.GuideCloud==='undefined'&&typeof window.ExplorationAdapter?.call==='function'),'CSP permits local adapter without installing cloud adapter');
      check(await sample.locator('#journey-stops').getAttribute('aria-label')==='按待审样章顺序阅读','rendered specimen navigation does not claim published order');
      await open(sample);await sample.evaluate(()=>document.fonts.ready);
      check((await sample.locator('#reading-copy').textContent()).includes('1985'),'specimen renders the editorial chronology');
      check(await sample.locator('#reading-copy').textContent()===specimenDraft.paragraphs.join('\n\n'),'specimen rendering does not replace draft text');
      check(await sample.locator('#journey-study').isVisible(),'specimen binds original tower detail');
      check(fontResponses.length>0&&fontResponses.every(response=>response.status===200),'specimen font assets load without 404');
      await sample.screenshot({path:path.join(out,'editorial-specimen-390.png')});
      await sample.setViewportSize({width:1440,height:900});await sample.screenshot({path:path.join(out,'editorial-specimen-1440.png')});
      await close(sample);await sample.locator('#sources > .journey-leaf-trigger').click();
      await sample.locator('#journey-leaf-dialog[data-leaf=sources][data-state=open][aria-busy=false]').waitFor();
      const links=await sample.locator('#source-list a').evaluateAll(elements=>elements.map(element=>element.href));
      check(specimenDraft.sources.every(source=>links.includes(source.url)),'specimen exposes all official research links');
      check((await sample.locator('#source-list').textContent()).includes('未通过人工审稿'),'specimen does not pretend editorial sources are reviewed');
      check(sampleRequests.every(url=>url.startsWith(specimen.url+'/')||url.startsWith('data:')),'specimen makes no cloud/external requests');
      await sample.close();
    } finally {await specimen.close();}
    check(actions.every(action=>action==='getSiteExploration'),'study uses public read only, never a mutation');
    check(errors.length===0,'no browser exceptions: '+errors.join('; '));
    console.log('PASS journey original-art study: '+checks+' checks; binding, verification, cancellation, readonly, reduced-motion, fallbacks and responsive screenshots. '+out);
  } finally {await browser.close();await server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
