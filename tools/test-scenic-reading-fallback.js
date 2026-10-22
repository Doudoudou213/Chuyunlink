'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const D=require('../static/scenic-reading-fallback');
const fixture=()=>({ok:true,resourceId:'r',items:[{id:'f1',versionId:'f1_v1',resourceId:'r',title:'本地测试 · 一段介绍',text:'这是隔离测试文字。\n\n第二段仍来自同一份测试资料。',sources:[{id:'s1',title:'测试来源',excerpt:'只用于本地自动化验证。',contributorName:'测试署名',url:'https://example.org/source'}]}]});
let checks=0;function check(value,label){assert(value,label);checks++;}
async function main(){
  check(D.project(fixture(),'r').length===1,'accept current public contract');
  for(const mutate of [r=>r.ok=false,r=>r.resourceId='other',r=>r.localTest=true,r=>r.items[0].simulated=true,r=>r.items[0].status='draft',r=>r.items[0].versionId='',r=>r.items[0].resourceId='other',r=>r.items[0].needsSourceReview=true,r=>r.items[0].sources=[],r=>r.items[0].sources[0].sourceUnavailable=true,r=>r.items.push({...r.items[0]})]){const r=fixture();mutate(r);assert.throws(()=>D.project(r,'r'));checks++;}
  for(const url of ['javascript:alert(1)','http://example.org','https://user:pass@example.org','https://example.org/?token=private'])check(D.publicLink(url)===null,'private/unsafe URL absent');
  const {chromium}=require('playwright');let browser;const output=path.resolve(__dirname,'../artifacts/scenic-reading-fallback');fs.mkdirSync(output,{recursive:true});
  try{
    browser=await chromium.launch({channel:'msedge',headless:true});
    const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',r=>r.abort());await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:16px;background:#332b22"><div id="host"></div></body></html>');
    await page.addStyleTag({path:path.resolve(__dirname,'../static/scenic-reading-fallback.css')});await page.addScriptTag({path:path.resolve(__dirname,'../static/scenic-reading-fallback.js')});
    await page.evaluate(value=>{window.payload=value;window.calls=[];window.ui=ChuScenicReadingFallback.create(document.getElementById('host'),{resourceId:'r',call:async e=>{calls.push(e);if(window.fail)throw Error('private-tech-diagnostic');return structuredClone(payload);}});},fixture());
    await page.evaluate(()=>ui.show());check(await page.locator('.scenic-reading-copy').textContent()===fixture().items[0].text,'original full text');
    await page.locator('.scenic-reading-source').click();check(await page.locator('.scenic-reading-sources').isVisible(),'source expands after fresh request');
    check(await page.evaluate(()=>calls.length)===2,'fresh read on source');
    check(await page.locator('.scenic-reading-sources a').getAttribute('rel')==='noopener noreferrer','safe external link');
    for(const viewport of [{width:320,height:740},{width:390,height:844},{width:768,height:1024},{width:1440,height:900}]){await page.setViewportSize(viewport);check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow '+viewport.width);check(await page.locator('.scenic-reading-source').evaluate(el=>el.getBoundingClientRect().height>=44),'44px control '+viewport.width);await page.screenshot({path:path.join(output,'fallback-'+viewport.width+'.png'),fullPage:true});}
    await page.evaluate(()=>{payload.items.push({...structuredClone(payload.items[0]),id:'f2',versionId:'f2_v1',title:'第二篇',text:'另一段测试资料。'});});await page.evaluate(()=>ui.show());await page.getByRole('button',{name:'再读一篇 →'}).click();check(await page.locator('.scenic-reading-copy').textContent()==='另一段测试资料。','next loads current second item');
    await page.evaluate(()=>{payload.items=[];});await page.locator('.scenic-reading-source').click();check(await page.locator('.scenic-reading-copy').count()===0,'revocation clears text');
    check((await page.locator('#host').textContent()).includes('正在整理'),'empty has direction');
    await page.evaluate(()=>{window.fail=true;});await page.evaluate(()=>ui.show());check(!(await page.locator('#host').textContent()).includes('private-tech'),'no technical errors exposed');
    await page.evaluate(()=>ui.clear());check(await page.locator('#host').isHidden(),'clear hides');
    await page.evaluate(value=>{window.fail=false;window.payload=value;window.__hidden=false;Object.defineProperty(document,'hidden',{configurable:true,get(){return window.__hidden;}});},fixture());
    await page.evaluate(()=>ui.show());await page.evaluate(()=>{window.__hidden=true;document.dispatchEvent(new Event('visibilitychange'));});check(await page.locator('#host').isHidden(),'background discards old text');
    const beforeVisible=await page.evaluate(()=>calls.length);await page.evaluate(()=>{window.__hidden=false;document.dispatchEvent(new Event('visibilitychange'));});await page.locator('.scenic-reading-copy').waitFor();check(await page.evaluate(()=>calls.length)===beforeVisible+1,'foreground revalidates');
    await page.evaluate(value=>{window.late=null;window.ui.destroy();window.ui=ChuScenicReadingFallback.create(document.getElementById('host'),{resourceId:'r',call:()=>new Promise(resolve=>window.late=()=>resolve(value))});window.pending=ui.show();},fixture());
    await page.waitForFunction(()=>!!window.late);await page.evaluate(()=>ui.clear());check(await page.evaluate(()=>pending)===false,'clear settles pending read before network response');await page.evaluate(()=>late());check(await page.locator('#host').isHidden(),'clear rejects late response');
    check(await page.evaluate(()=>calls.every(e=>e.action==='getGuideStation'&&e.resourceId==='r')),'only read-only allowlisted API');check(errors.length===0,'no browser errors');
    await page.close();
  }finally{if(browser)await browser.close();}
  console.log('PASS scenic reading fallback: '+checks+' contract/browser checks; local fixtures only, 320/390/768/1440 screenshots.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
