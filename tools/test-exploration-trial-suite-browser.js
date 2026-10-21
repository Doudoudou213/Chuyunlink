'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const {start}=require('./lib/exploration-trial-suite-preview');
let checks=0;
function check(value,label){assert(value,label);checks++;}
const out=path.join(__dirname,'../artifacts/exploration-journey-live/closeout-suite');
(async()=>{
  fs.mkdirSync(out,{recursive:true});
  const suite=await start(),browser=await chromium.launch({channel:'msedge',headless:true});
  const context=await browser.newContext({viewport:{width:390,height:900},reducedMotion:'reduce',acceptDownloads:true});
  const localhostOrigin=suite.url.replace('127.0.0.1','localhost');
  const origins=new Set([new URL(suite.url).origin,new URL(localhostOrigin).origin,...Object.values(suite.links).map(url=>new URL(url).origin)]);
  const errors=[],external=[];
  context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
  context.on('request',request=>{const url=request.url();if(!url.startsWith('blob:')&&!url.startsWith('data:')&&!origins.has(new URL(url).origin))external.push(url);});
  await context.route('**/*',route=>{const url=route.request().url();if(url.startsWith('blob:')||url.startsWith('data:')||origins.has(new URL(url).origin))return route.continue();return route.abort();});
  try{
    const page=await context.newPage();
    const response=await page.goto(localhostOrigin+'/trial-suite.html?check=canonical');
    check(response.status()===200,'localhost entry reaches healthy hub');
    check(page.url()===suite.url+'/trial-suite.html','localhost navigation canonicalizes before child links');
    await page.locator('#open-study[href]').waitFor();
    check((await page.locator('body').textContent()).includes('本地'),'portal explicitly local');
    for(const key of ['study','question','admin','scenario','review']){
      const link=page.locator('#open-'+key);
      check(await link.getAttribute('href')===suite.links[key],'link uses this launcher child '+key);
      const u=new URL(await link.getAttribute('href'));
      check(u.hostname==='127.0.0.1'&&u.protocol==='http:','local-only destination '+key);
      check(await link.getAttribute('target')==='_blank','preserve hub in new tab '+key);
      check((await link.getAttribute('rel')||'').split(/\s+/).includes('noopener'),'new tab has no opener '+key);
    }
    check(new Set(Object.values(suite.links).map(url=>new URL(url).origin)).size===4,'four previews keep separate origins');
    await page.keyboard.press('Tab');
    check(await page.locator('a:focus').count()===1,'keyboard reaches portal link');
    check(await page.locator('a:focus').evaluate(e=>getComputedStyle(e).outlineStyle!=='none'),'portal focus visible');
    for(const [width,height]of [[320,900],[390,900],[768,1000],[1440,1000],[667,320]]){
      await page.setViewportSize({width,height});
      check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'portal no horizontal overflow '+width+'x'+height);
      for(const key of ['study','question','admin','scenario','review'])check((await page.locator('#open-'+key).boundingBox()).height>=44,'44px portal target '+key+' '+width);
      await page.screenshot({path:path.join(out,'suite-'+width+'x'+height+'.png'),fullPage:true});
    }
    await page.setViewportSize({width:390,height:900});
    const open=async key=>{
      const wait=context.waitForEvent('page');await page.locator('#open-'+key).click();const child=await wait;
      await child.waitForLoadState('domcontentloaded');
      check(child.url()===suite.links[key],'clicked actual portal destination '+key);
      check(await child.evaluate(()=>window.opener===null),'child cannot operate portal '+key);
      return child;
    };
    const study=await open('study');
    await study.locator('#content:not([hidden])').waitFor();
    check((await study.locator('body').textContent()).includes('待审'),'research preview stays visibly unreviewed');
    await study.close();
    const question=await open('question');
    await question.locator('#content:not([hidden])').waitFor();
    check((await question.locator('body').textContent()).includes('本地'),'question trial not presented as live scenic guide');
    // Export through the actual visitor controller, then import that exact file.
    await question.locator('#finish').click();
    await question.locator('#finished:not([hidden])').waitFor();
    await question.locator('#trial-feedback > .journey-leaf-trigger').click();
    await question.locator('#journey-leaf-dialog[open][data-leaf="trial-feedback"][aria-busy="false"][data-state="open"]').waitFor();
    await question.locator('input[name="start"][value="alone"]').check();
    await question.locator('input[name="reading"][value="clear"]').check();
    await question.locator('input[name="memory"][value="yes"]').check();
    await question.locator('#trial-obstacle').fill('本地联调：下一景入口清楚。');
    const downloading=question.waitForEvent('download');await question.locator('#trial-export').click();const exported=await downloading;
    const bytes=fs.readFileSync(await exported.path()),report=JSON.parse(bytes.toString('utf8'));
    check(report.kind==='reading-trial-feedback','visitor exports canonical feedback');
    check(report.localTest===true,'visitor trial marks exported report local');
    check(report.answers.obstacle==='本地联调：下一景入口清楚。','explicit opinion survives export');
    const review=await open('review');
    await review.locator('#import').waitFor();
    check(await review.locator('#empty').isVisible(),'review starts with no automatic sample');
    await review.locator('#files').setInputFiles({name:exported.suggestedFilename(),mimeType:'application/json',buffer:bytes});
    await review.waitForFunction(()=>!document.querySelector('#import').disabled);
    check((await review.locator('#totals').textContent()).includes('计入 1 份'),'actual visitor file accepted by review');
    check((await review.locator('#group-kind').textContent()).includes('本地测试'),'review preserves declared local test');
    check((await review.locator('#notes').textContent()).includes('本地联调：下一景入口清楚。'),'review renders explicit original opinion');
    const reportDownload=review.waitForEvent('download');await review.locator('#download-report').click();const human=await reportDownload;
    const reportText=fs.readFileSync(await human.path(),'utf8');
    check(human.suggestedFilename().endsWith('.txt'),'end-to-end produces readable report');
    check(reportText.includes('能否开始')&&reportText.includes('是否读懂'),'human report has readable answer labels');
    check(!reportText.includes('下一景入口清楚'),'human report omits raw opinion');
    await review.close();await question.close();
    const admin=await open('admin');
    await admin.locator('body').waitFor();
    check((await admin.locator('body').textContent()).includes('本地'),'administrator trial retains local notice');
    await admin.close();
    const scenario=await open('scenario');
    check(await scenario.locator('[data-kind="reset"]').count()===1,'maintenance scenario offers existing local reset');
    await scenario.close();
    check(await page.evaluate(()=>localStorage.length===0&&sessionStorage.length===0),'portal itself does not persist or copy feedback');
    check(external.length===0,'suite makes no external requests: '+external.join(','));
    check(errors.length===0,'suite pages have no uncaught browser errors: '+errors.join('; '));
    console.log('trial suite browser: '+checks+' checks passed; screenshots '+out);
  }finally{await context.close();await browser.close();await suite.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
