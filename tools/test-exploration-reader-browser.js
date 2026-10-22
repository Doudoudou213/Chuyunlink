'use strict';
// Isolated local editorial fixtures only. No login state, production connection,
// history content cache, automatic reading marks, or real visitor evidence.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const preview = require('./lib/exploration-four-scenes-preview');
const draft = require('./fixtures/four-scenes-study.json');
const output = path.resolve(__dirname,'../artifacts/exploration-journey-live/reader');
const viewports = [{width:320,height:740},{width:390,height:844},{width:768,height:1024},{width:1440,height:900},{width:667,height:320}];
let checks = 0;
function check(value,label) {assert(value,label);checks++;}

(async () => {
  const server = await preview.start();
  let browser;
  const errors = [], external = [], writes = [];
  const base = server.url+'/four-scenes.html?resourceId=hhl-four-scenes-study';
  const html = await (await fetch(base)).text();
  const endpoint = html.match(/fetch\(["'](\/__[\w-]+)["']/)?.[1];
  check(Boolean(endpoint),'local read endpoint is available');
  const endpointPattern = '**'+endpoint;
  const original = id => draft.points.find(point=>point.id===id).paragraphs.join('\n\n');
  const ready = (page,kind='reading') => page.locator('#journey-leaf-dialog[open][data-state=open][aria-busy=false][data-leaf='+kind+']').waitFor();
  const open = async page => {await page.locator('#reading > .journey-leaf-trigger').click();await ready(page);};
  const close = async page => {await page.locator('.journey-leaf-close').click();await page.locator('#journey-leaf-dialog').waitFor({state:'hidden'});};
  const store = page => page.evaluate(()=>localStorage.getItem('chulink:journey-content:v1:hhl-four-scenes-study'));
  const records = async page => Object.values(JSON.parse(await store(page)||'{}'));
  const visible = page => page.locator('#reading-copy .journey-reader-paragraph:not([hidden])');
  async function page(viewport={width:390,height:844},settings={}) {
    const result = await browser.newPage({viewport,reducedMotion:settings.motion||'reduce'});
    result.on('pageerror',error=>errors.push(error.message));
    result.on('request',request=>{if(!['GET','HEAD'].includes(request.method()))writes.push(request.url());});
    await result.route('**/*',route=>{
      const url=route.request().url();
      if(!url.startsWith(server.url+'/')&&!url.startsWith('data:')){external.push(url);return route.abort();}
      if(settings.missing&&url.endsWith('/static/exploration-journey-reader.js'))return route.abort();
      return route.continue();
    });
    if(settings.native)await result.addInitScript(()=>{HTMLDialogElement.prototype.showModal=undefined;});
    if(settings.noStorage)await result.addInitScript(()=>Object.defineProperty(window,'localStorage',{get(){throw Error('isolated blocked-storage test');}}));
    if(settings.canvas)await result.addInitScript(()=>{
      window.__exportLines=[];
      const fill=CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText=function(value,...args){
        if(this.canvas.width===960)window.__exportLines.push(String(value));
        return fill.call(this,value,...args);
      };
    });
    if(settings.noArt)await result.route(endpointPattern,async route=>{
      const response=await route.fetch(),value=await response.json();
      // Local fixture for a non-Yellow-Crane public reading record. It has no
      // illustration binding or simulated-art capability and is never uploaded.
      value.localTest=false;value.walk.simulated=false;value.walk.title='无插图资料 · 只读测试';
      for(const object of value.map.objects)delete object.artScene;
      await route.fulfill({response,json:value});
    });
    await result.goto(base,{waitUntil:'domcontentloaded'});
    await result.locator('#content:not([hidden])').waitFor();
    await result.evaluate(()=>document.fonts.ready);
    return result;
  }
  async function expectParagraph(page,index,label) {
    await page.waitForFunction(value=>document.querySelector('#reading-copy .journey-reader-paragraph:not([hidden])')?.dataset.paragraph===String(value),index);
    check(await visible(page).count()===1,label+' displays one complete paragraph');
    check(await page.locator('#journey-reader-position').textContent()==='第 '+(index+1)+' / 3 段',label+' announces actual paragraph position');
  }
  async function target(page,selector,label) {
    await page.locator(selector).scrollIntoViewIfNeeded();
    const box=await page.locator(selector).boundingBox();
    check(Boolean(box)&&box.width>=44&&box.height>=44,label+' retains a 44px target');
    check(box.x>=-.5&&box.x+box.width<=page.viewportSize().width+.5,label+' fits the viewport width');
  }
  async function exact(page,id,label) {
    check(await page.locator('#reading-copy').textContent()===original(id),label+' preserves exact original prose and paragraph separators');
  }
  async function genericWithoutArt(){
    const p=await page({width:390,height:844},{noArt:true});
    check(await p.locator('.journey-shell').getAttribute('data-art')==='false','unbound generic record does not acquire Yellow-Crane artwork capability');
    await open(p);await exact(p,'tower','generic record');
    check(await p.locator('#journey-study').isHidden(),'generic record has no mismatched original-art study');
    await p.locator('#journey-reader-keep').click();
    await p.waitForFunction(()=>document.getElementById('journey-reader-keep').getAttribute('aria-pressed')==='true');
    await close(p);await p.locator('#finish').click();await p.locator('#finished:not([hidden])').waitFor();
    check(await p.locator('#download-image').isHidden(),'generic souvenir has no mismatched PNG entry');
    const downloads=[];p.on('download',download=>downloads.push(download));
    await p.locator('#download-image').evaluate(button=>button.click());await p.waitForTimeout(120);
    check(downloads.length===0,'programmatic click cannot bypass absent illustration capability');
    check(await p.locator('#souvenir-export-status').textContent()==='','blocked PNG does not enter generation state');
    check(await p.locator('#download').isVisible()&&await p.locator('#download').isEnabled(),'original text download remains available without artwork');
    const downloaded=p.waitForEvent('download');await p.locator('#download').click();const textFile=await downloaded;
    check(textFile.suggestedFilename()==='我的阅读拾记.txt','generic record downloads the original safe TXT file');
    const file=path.join(output,'generic-reading.txt');await textFile.saveAs(file);const content=fs.readFileSync(file,'utf8');
    check(content.includes('无插图资料 · 只读测试')&&content.includes(draft.points[0].title),'TXT preserves the actual generic content title and explicit reading record');
    check(content.includes('不是实地到访凭证'),'generic TXT preserves the non-visit boundary');
    check(downloads.length===1,'generic flow downloaded exactly one text file and no PNG');await p.close();
  }
  async function finishLayout(){
    for(const viewport of [...viewports,{width:880,height:900}]){
      const p=await page(viewport),label='finish '+viewport.width+'x'+viewport.height;
      await p.locator('#finish').click();await p.locator('#finished:not([hidden])').waitFor();
      check(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),label+' has no document horizontal overflow');
      for(const selector of ['#finished','.souvenir-actions']){
        check(await p.locator(selector).evaluate(node=>node.scrollWidth<=node.clientWidth+1),label+' '+selector+' does not clip actions horizontally');
      }
      for(const selector of ['#download-image','#download','#return']){
        await target(p,selector,label+' '+selector);
        const lines=await p.locator(selector).evaluate(node=>{
          const range=document.createRange();range.selectNodeContents(node);
          const boxes=[...range.getClientRects()].filter(rect=>rect.width>0&&rect.height>0);
          return new Set(boxes.map(rect=>Math.round(rect.top))).size;
        });
        check(lines===1,label+' '+selector+' label stays on one line rather than breaking Chinese words');
      }
      const boxes=await p.locator('.souvenir-actions > button').evaluateAll(nodes=>nodes.map(node=>{
        const rect=node.getBoundingClientRect();return {left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom};
      }));
      check(boxes.every((box,index)=>boxes.slice(index+1).every(other=>
        Math.min(box.right,other.right)-Math.max(box.left,other.left)<=.5||Math.min(box.bottom,other.bottom)-Math.max(box.top,other.top)<=.5)),
      label+' wrapped action rows do not overlap');
      await p.locator('.souvenir-actions').screenshot({path:path.join(output,'finished-actions-'+viewport.width+'x'+viewport.height+'.png')});
      await p.close();
    }
  }
  try {
    browser = await chromium.launch({channel:'msedge',headless:true});
    fs.mkdirSync(output,{recursive:true});
    if(process.argv.includes('--generic-only')){
      await genericWithoutArt();
      check(external.length===0&&writes.length===0&&errors.length===0,'focused generic check has no external requests, writes or script errors');
      console.log('PASS unbound generic reader: '+checks+' checks; PNG hidden and guarded, original TXT retained.');return;
    }
    if(process.argv.includes('--finish-layout-only')){
      await finishLayout();
      check(external.length===0&&writes.length===0&&errors.length===0,'focused finish layout has no external requests, writes or script errors');
      console.log('PASS souvenir action layout: '+checks+' checks; six sizes including 880px, single-line labels, 44px targets, no overflow or overlap.');return;
    }
    for(const viewport of viewports) {
      const p=await page(viewport),label=viewport.width+'x'+viewport.height;
      await open(p);await expectParagraph(p,0,label);await exact(p,'tower',label);
      check(await p.locator('#journey-reader-previous').isDisabled(),label+' first paragraph has no misleading previous action');
      check(await p.locator('#journey-reader-mode').getAttribute('aria-pressed')==='false',label+' initial mode is segmented');
      check(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),label+' page has no horizontal overflow');
      check(await p.locator('#journey-leaf-body').evaluate(node=>node.scrollWidth<=node.clientWidth+1),label+' reading body fits');
      const before=await store(p),history=await p.evaluate(()=>window.history.length);
      await p.screenshot({path:path.join(output,'segment-'+label+'.png')});
      await target(p,'#journey-reader-next',label+' next paragraph');await p.locator('#journey-reader-next').click();
      await expectParagraph(p,1,label);await exact(p,'tower',label);
      await p.locator('#journey-leaf-tab-sources').click();await ready(p,'sources');
      check(await p.locator('#reading-copy').isHidden(),label+' source view hides the reading page');
      check((await p.locator('#source-list').textContent()).includes(draft.points[0].sources[0].title),label+' retains original source entry');
      await p.locator('#journey-leaf-tab-reading').click();await ready(p);
      await expectParagraph(p,1,label+' after sources');
      await p.locator('#journey-inquiry-entry').click();
      await p.locator('#journey-inquiry-panel:not([hidden])').waitFor();
      check(await p.locator('#reading-copy').isHidden(),label+' question-led index uses the same paper');
      await p.locator('#journey-inquiry-back').click();await expectParagraph(p,1,label+' after inquiry');
      await p.locator('#journey-reader-next').click();await expectParagraph(p,2,label);
      check(await p.locator('#journey-reader-next').isDisabled(),label+' last paragraph does not silently advance scenes');
      check(await visible(p).textContent()===draft.points[0].paragraphs[2],label+' final paragraph qualifiers remain intact');
      await target(p,'#journey-reader-mode',label+' mode');await p.locator('#journey-reader-mode').click();
      await p.waitForFunction(()=>document.getElementById('journey-reader-mode').getAttribute('aria-pressed')==='true');
      check(await visible(p).count()===3,label+' full mode reveals every paragraph');
      check(await p.locator('.journey-reader-paging').isHidden(),label+' full mode removes redundant paragraph arrows');
      await exact(p,'tower',label+' full mode');
      await p.locator('#reading-size').click();
      check(await p.locator('#reading-copy').evaluate(node=>parseFloat(getComputedStyle(node).fontSize)>=21),label+' original large-text control affects prose');
      check(await store(p)===before,label+' reading, questions and paragraph changes create no observation record');
      check(await p.evaluate(()=>window.history.length)===history,label+' paragraph and source modes add no history steps');
      await target(p,'#journey-reader-keep',label+' explicit keep');
      await p.screenshot({path:path.join(output,'full-'+label+'.png')});
      await p.locator('#journey-reader-keep').click();
      await p.waitForFunction(()=>document.getElementById('journey-reader-keep').getAttribute('aria-pressed')==='true');
      const saved=await records(p);
      check(saved.length===1&&JSON.stringify(saved[0].observed)===JSON.stringify(['tower']),label+' explicit keep records only the selected scene');
      check(!JSON.stringify(saved).includes(draft.points[0].paragraphs[0]),label+' record does not cache source prose');
      await p.locator('#journey-reader-keep').click();
      check((await records(p))[0].observed.length===1,label+' repeated keep does not duplicate observations');
      await p.locator('#journey-reader-mode').click();await expectParagraph(p,2,label+' after full mode');
      await p.locator('#journey-reader-previous').click();await expectParagraph(p,1,label+' previous');
      await close(p);await open(p);await expectParagraph(p,1,label+' reopening current scene');
      await p.locator('#journey-leaf-next').click();await ready(p);
      await p.waitForFunction(()=>document.getElementById('journey-leaf-title').textContent==='古铜顶');
      await expectParagraph(p,0,label+' next scene');await exact(p,'copper',label+' next scene');
      check(await p.locator('#journey-reader-keep').getAttribute('aria-pressed')==='false',label+' new scene is not automatically recorded');
      check(JSON.stringify((await records(p))[0].observed)===JSON.stringify(['tower']),label+' continuation preserves explicit-only records');
      await p.close();
    }

    // Every current chapter uses its own full paragraphs, not a title-based summary.
    const all=await page();
    for(const point of draft.points) {
      await all.locator('[data-stop="'+point.id+'"]').click();await ready(all);
      await exact(all,point.id,point.id);
      for(let i=0;i<point.paragraphs.length;i++) {
        await expectParagraph(all,i,point.id);
        check(await visible(all).textContent()===point.paragraphs[i],point.id+' uses exact paragraph '+i);
        if(i<point.paragraphs.length-1)await all.locator('#journey-reader-next').click();
      }
      await close(all);
    }
    check((await records(all)).every(record=>record.observed.length===0),'browsing all four scenes does not manufacture completed reading');
    await all.close();

    // Pending actions may not mutate a closed or different chapter.
    for(const action of ['journey-reader-next','journey-reader-mode','journey-reader-keep']) {
      const p=await page();await open(p);const before=await store(p);
      let release,captured;
      const blocked=new Promise(resolve=>{release=resolve;}),seen=new Promise(resolve=>{captured=resolve;});
      await p.route(endpointPattern,async route=>{const response=await route.fetch();captured();await blocked;await route.fulfill({response});});
      await p.locator('#'+action).click();await seen;
      check(await p.locator('#'+action).getAttribute('aria-busy')==='true',action+' signals pending verification');
      await close(p);release();await p.waitForTimeout(120);await p.unroute(endpointPattern);
      check(await p.locator('#journey-leaf-dialog').isHidden(),action+' late response does not reopen paper');
      check(await store(p)===before,action+' cancelled intent cannot record anything');
      await open(p);await expectParagraph(p,0,action+' cancelled');
      check(await p.locator('#journey-reader-mode').getAttribute('aria-pressed')==='false',action+' cancelled mode change stays discarded');
      await p.close();
    }

    for(const kind of ['withdraw','expiry','revision']) {
      const p=await page();await open(p);await p.locator('#journey-reader-next').click();await expectParagraph(p,1,kind);
      await p.route(endpointPattern,async route=>{
        const response=await route.fetch(),value=await response.json();
        if(kind==='withdraw'){value.available=false;value.reason='本地模拟撤回';}
        if(kind==='expiry')value.validUntil='2000-01-01T00:00:00.000Z';
        if(kind==='revision')value.walk.fingerprint+='-reader-test';
        await route.fulfill({response,json:value});
      });
      await p.locator('#journey-reader-mode').click();await p.locator('#gate:not([hidden])').waitFor();
      check(await p.locator('#reading-copy').textContent()==='',kind+' erases every detached paragraph');
      check(await p.locator('.journey-reader-top').isHidden()&&await p.locator('.journey-reader-bottom').isHidden(),kind+' leaves no stale reader controls');
      check(await p.locator('#journey-leaf-dialog').isHidden(),kind+' closes paper');
      await p.close();
    }

    const fallback=await page({width:390,height:844},{native:true});
    await fallback.locator('#reading > summary').click();await fallback.locator('#reading[open]').waitFor();
    await expectParagraph(fallback,0,'native details');await fallback.locator('#journey-reader-next').click();
    await expectParagraph(fallback,1,'native details');await exact(fallback,'tower','native details');
    await fallback.close();
    for(const action of ['journey-reader-next','journey-reader-keep']){
      const p=await page({width:390,height:844},{native:true});
      await p.locator('#reading > summary').click();await p.locator('#reading[open]').waitFor();
      const before=await store(p);let release,captured,held=false;
      const blocked=new Promise(resolve=>{release=resolve;}),seen=new Promise(resolve=>{captured=resolve;});
      await p.route(endpointPattern,async route=>{
        if(held)return route.continue();held=true;
        const response=await route.fetch();captured();await blocked;await route.fulfill({response});
      });
      await p.locator('#'+action).click();await seen;
      await p.locator('#reading > summary').click();await p.locator('#reading:not([open])').waitFor();
      await p.locator('#reading > summary').click();await p.locator('#reading[open]').waitFor();
      release();await p.waitForTimeout(180);
      await expectParagraph(p,0,'native reopened '+action);
      check(await store(p)===before,'native close/reopen cancels old '+action+' intent');await p.close();
    }
    const absent=await page({width:390,height:844},{missing:true});await open(absent);
    await exact(absent,'tower','missing reader module');
    check(await absent.locator('#reading-copy').isVisible(),'missing enhancement leaves the complete original text readable');
    check(await absent.locator('#journey-reader-mode').count()===0,'missing reader leaves no broken control');await absent.close();
    const memory=await page({width:390,height:844},{noStorage:true});await open(memory);
    await memory.locator('#journey-reader-keep').click();
    await memory.waitForFunction(()=>document.getElementById('journey-reader-keep').getAttribute('aria-pressed')==='true');
    check((await memory.locator('#status').textContent()).includes('不允许保存'),'storage failure is visible without blocking session reading');
    await memory.locator('#journey-reader-next').click();await expectParagraph(memory,1,'storage unavailable');await memory.close();

    const normal=await page({width:390,height:844},{motion:'no-preference'});await open(normal);
    await normal.locator('#journey-reader-next').click();await expectParagraph(normal,1,'normal motion');
    await normal.emulateMedia({reducedMotion:'reduce'});
    check(await normal.locator('#reading-copy').evaluate(node=>getComputedStyle(node).transform==='none'&&getComputedStyle(node).opacity==='1'),'reducing motion settles the paragraph without hiding text');
    await normal.locator('#journey-reader-previous').focus();await normal.keyboard.press('Enter');await expectParagraph(normal,0,'keyboard');
    check(await normal.locator('#reading-copy').evaluate(node=>document.activeElement===node),'keyboard paragraph change transfers focus to the revealed prose');await normal.close();

    // Exercise the real live wiring, not the exporter module in isolation:
    // original reader -> selected original-art detail -> local souvenir -> PNG.
    const integrated=await page({width:390,height:844},{canvas:true});await open(integrated);
    await integrated.locator('#journey-reader-keep').click();
    await integrated.waitForFunction(()=>document.getElementById('journey-reader-keep').getAttribute('aria-pressed')==='true');
    await integrated.locator('#journey-study[data-art-state=ready]').waitFor();
    await integrated.locator('.journey-study-controls > button').click();
    await integrated.locator('[data-look=eaves-rhythm]').click();
    await integrated.waitForFunction(()=>document.querySelector('[data-look=eaves-rhythm]').getAttribute('aria-pressed')==='true');
    check((await records(integrated))[0].details.length===0,'looking closer and choosing a detail do not save it automatically');
    await integrated.locator('.journey-study-keep > button').click();
    await integrated.waitForFunction(()=>document.querySelector('.journey-study-keep > button').textContent==='已留在游记');
    let actual=(await records(integrated))[0];
    check(JSON.stringify(actual.details)===JSON.stringify([{pointId:'tower',sceneId:'tower',detailKey:'eaves-rhythm'}]),'actual reader and study retain only the explicitly selected finite detail ID');
    check(JSON.stringify(actual.observed)===JSON.stringify(['tower']),'keeping a detail does not duplicate its already-recorded scene');
    await integrated.evaluate(()=>{
      document.getElementById('journey-study').dataset.artState='failed';
      document.getElementById('journey-art').dispatchEvent(new Event('journey:art-restored'));
    });
    await integrated.locator('#journey-study[data-art-state=ready]').waitFor();
    await integrated.locator('.journey-study-controls > button').click();
    await integrated.locator('[data-look=eaves-rhythm]').click();
    await integrated.waitForFunction(()=>document.querySelector('[data-look=eaves-rhythm]').getAttribute('aria-pressed')==='true');
    check(await integrated.locator('.journey-study-keep > button').isDisabled(),'art recovery preserves already-kept detail acknowledgement');
    await integrated.locator('#journey-leaf-next').click();await ready(integrated);
    await integrated.waitForFunction(()=>document.getElementById('journey-leaf-title').textContent==='古铜顶');
    await integrated.locator('#journey-study[data-art-state=ready]').waitFor();
    await integrated.locator('.journey-study-controls > button').click();
    await integrated.locator('[data-look=outline-width]').click();
    await integrated.waitForFunction(()=>document.querySelector('[data-look=outline-width]').getAttribute('aria-pressed')==='true');
    await close(integrated);await integrated.locator('#finish').click();await integrated.locator('#finished:not([hidden])').waitFor();
    check((await integrated.locator('#souvenir-count').textContent()).startsWith('主动记下 1 / 4'),'finish reports explicit reading, not four visits or browsing completion');
    check(await integrated.locator('#souvenir-details').textContent()===draft.points[0].title+' · 层层相叠','finish resolves labels from the finite current catalog');
    const note='试读手记：只记下主动观察。<script>不是代码</script> 🏯';
    await integrated.locator('#note').fill(note);const recordBeforePNG=await store(integrated);
    const downloadEvent=integrated.waitForEvent('download');await integrated.locator('#download-image').click();
    const downloaded=await downloadEvent;check(downloaded.suggestedFilename()==='我的画卷拾记.png','integrated PNG has a fixed safe filename');
    const file=path.join(output,'integrated-souvenir.png');await downloaded.saveAs(file);
    const png=fs.readFileSync(file);
    check(png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'integrated download is a real PNG');
    check(png.readUInt32BE(16)===960&&png.readUInt32BE(20)>=1120,'integrated graphic uses the complete portrait canvas');
    const drawn=await integrated.evaluate(()=>window.__exportLines.join(''));
    check(drawn.includes(note),'private note, markup-like text and emoji are rendered literally, without truncation');
    check(drawn.includes('层层相叠')&&!drawn.includes('宽窄变化'),'graphical souvenir includes only explicitly kept details');
    check(drawn.includes('待审样章 · 非现场导览')&&drawn.includes('非到访凭证')&&drawn.includes('AI 辅助创作')&&drawn.includes('未上传'),'actual live snapshot carries draft, artwork and privacy boundaries');
    check(await store(integrated)===recordBeforePNG,'graphical download does not add observation, visit, reward or feedback records');
    await integrated.screenshot({path:path.join(output,'integrated-finished-390x844.png')});await integrated.close();
    await genericWithoutArt();
    await finishLayout();

    // Late encoding must not outlive the real live controller's current scene,
    // source identity or edited note, even if visible text/version is unchanged.
    for(const reason of ['return','fingerprint','withdraw','note']){
      const p=await page();await p.locator('#finish').click();await p.locator('#finished:not([hidden])').waitFor();
      await p.evaluate(()=>{
        const encode=HTMLCanvasElement.prototype.toBlob;
        HTMLCanvasElement.prototype.toBlob=function(callback,...args){
          window.__releaseExport=()=>encode.call(this,callback,...args);
        };
      });
      const downloads=[];p.on('download',value=>downloads.push(value));
      await p.locator('#download-image').click();await p.waitForFunction(()=>typeof window.__releaseExport==='function');
      if(reason==='return'){
        await p.locator('#return').click();await p.locator('#content:not([hidden])').waitFor();
      }else if(reason==='note')await p.locator('#note').fill('制笺中修改的私人手记');
      else await p.route(endpointPattern,async route=>{
        const response=await route.fetch(),value=await response.json();
        if(reason==='withdraw'){value.available=false;value.reason='本地导出期间模拟撤回';}
        else value.walk.fingerprint+='-same-visible-content-new-identity';
        await route.fulfill({response,json:value});
      });
      await p.evaluate(()=>window.__releaseExport());
      if(reason==='fingerprint'||reason==='withdraw'){
        await p.locator('#gate:not([hidden])').waitFor();
        check(await p.locator('#souvenir-details').textContent()===''&&await p.locator('#souvenir-title').textContent()==='','late '+reason+' erases stale souvenir content');
      }else if(reason==='note')await p.waitForFunction(()=>document.getElementById('souvenir-export-status').textContent.includes('内容已变化'));
      await p.waitForTimeout(180);
      check(downloads.length===0,'late '+reason+' cannot download a stale graphic');
      check(await p.locator('#download-image').isEnabled(),'late '+reason+' releases export busy state');
      await p.close();
    }

    check(external.length===0,'no external requests: '+external.join('\n'));
    check(writes.length===0,'reading checks perform no POST/production writes');
    check(errors.length===0,'no page errors: '+errors.join('\n'));
    console.log('PASS journey reader: '+checks+' checks; exact paragraphs, full reading, source/history restoration, explicit records, late cancellation, five sizes and local-only fallbacks.');
  } finally {await browser?.close();await server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
