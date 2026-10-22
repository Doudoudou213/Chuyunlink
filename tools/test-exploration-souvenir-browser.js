'use strict';
// Isolated localhost fixture; no cloud account, personal browser state or upload.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),output=path.join(root,'artifacts/exploration-journey-live/souvenir');
const payload={title:'黄鹤楼 · 一楼四景（待审样章）',version:1,localTest:true,points:[{id:'tower',title:'黄鹤楼主楼'},{id:'copper',title:'古铜顶'},{id:'baiyun',title:'白云阁'},{id:'pond',title:'鹅池'}],observed:['tower','pond'],note:'檐角向上，水色向远。\n把眼前所见，留进共同图鉴。🪶',details:[{pointId:'tower',label:'层檐曲线'},{pointId:'pond',label:'水岸转折'}]};
const html='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/fixture.css"><title>本机图文拾记检查</title><button id="download-image">保存图片</button><p id="status" role="status"></p><script src="/static/exploration-journey-souvenir.js"></script><script src="/fixture.js"></script></html>';
const fixture='window.payload='+JSON.stringify(payload)+';window.allowed=true;window.mode="normal";window.checks=0;window.drawn=[];const oldFill=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(text,...rest){window.drawn.push(text);return oldFill.call(this,text,...rest);};window.exporter=ChuJourneySouvenir.create({button:document.getElementById("download-image"),status:document.getElementById("status"),canInteract:()=>window.allowed,getData:()=>window.payload,verify:async()=>{window.checks++;return window.mode!=="deny-"+window.checks;}});';
const styles='@font-face{font-family:ChuJourneyDisplay;src:url(/static/assets/longcang-journey-v1.woff2)}body{padding:24px;background:#eee1c7;color:#302b22;font:16px/1.7 system-ui}button{min-height:44px;padding:12px 22px;background:#864730;color:#f3e6ca;border:0;border-radius:3px;font:inherit}button:focus-visible{outline:2px solid #302b22;outline-offset:4px}';
const paths=new Set(['/static/exploration-journey-souvenir.js','/static/assets/exploration-motion/hhl-full-park-v2.webp','/static/assets/paper-fibres-soft-v1.webp','/static/assets/longcang-journey-v1.woff2']);
const server=http.createServer((req,res)=>{
  const name=new URL(req.url,'http://localhost').pathname;
  res.setHeader('Cache-Control','no-store');
  if(name==='/'){res.setHeader('Content-Type','text/html;charset=utf-8');res.end(html);return;}
  if(name==='/fixture.js'){res.setHeader('Content-Type','application/javascript;charset=utf-8');res.end(fixture);return;}
  if(name==='/fixture.css'){res.setHeader('Content-Type','text/css;charset=utf-8');res.end(styles);return;}
  if(!paths.has(name)){res.statusCode=404;res.end();return;}
  res.setHeader('Content-Type',name.endsWith('.js')?'application/javascript;charset=utf-8':name.endsWith('.woff2')?'font/woff2':'image/webp');res.end(fs.readFileSync(path.join(root,name.slice(1))));
});
let checks=0;const check=(value,label)=>{assert(value,label);checks++;};
const errors=[],external=[];let browser;
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
  fs.mkdirSync(output,{recursive:true});
  try{
    browser=await chromium.launch({channel:'msedge',headless:true});
    async function page(width=390){
      const p=await browser.newPage({viewport:{width,height:844},acceptDownloads:true});
      p.on('pageerror',error=>errors.push(error.message));p.on('request',req=>{if(!req.url().startsWith(base+'/')&&!req.url().startsWith('blob:'))external.push(req.url());});
      await p.goto(base);await p.evaluate(()=>{localStorage.setItem('private-sentinel','untouched');});return p;
    }
    const p=await page();let downloads=0;p.on('download',()=>downloads++);
    const waiting=p.waitForEvent('download');await p.locator('#download-image').click();const download=await waiting;
    const png=path.join(output,'paper-souvenir.png');await download.saveAs(png);
    const bytes=fs.readFileSync(png);check(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'real PNG signature');
    check(bytes.readUInt32BE(16)===960&&bytes.readUInt32BE(20)>=1120&&bytes.readUInt32BE(20)<=4096,'bounded mobile-friendly canvas dimensions');
    check(download.suggestedFilename()==='我的画卷拾记.png','private note not present in filename');
    await p.locator('#download-image:not([disabled])').waitFor();
    const result=await p.evaluate(()=>({checks,drawn,stored:localStorage.getItem('private-sentinel'),note:payload.note}));
    check(result.checks===3,'revalidate before snapshot, after assets and after encoding');
    check(result.drawn.includes('待审样章 · 非现场导览')&&result.drawn.includes('艺术画稿 · 阅读留念，非到访凭证'),'draft/art boundary visible in PNG');
    check(result.drawn.join('').includes(payload.note.replace(/\n/g,'')),'private note preserved through canvas wrapping');
    check(result.drawn.includes('画稿：楚韵链迹 · AI 辅助创作'),'artwork credit visible');
    check(result.stored==='untouched'&&result.note===payload.note,'export does not mutate storage or note');
    check((await p.locator('#status').textContent()).includes('未上传'),'truthful local export status');
    check(downloads===1,'one click one image');await p.close();

    for(const index of [1,2,3]){
      const q=await page();let n=0;q.on('download',()=>n++);await q.evaluate(i=>{mode='deny-'+i;},index);
      check(await q.evaluate(()=>exporter.exportImage())===false,'source failure '+index+' blocks export');
      check(n===0,'source failure '+index+' no download');check(!(await q.locator('#download-image').isDisabled()),'source failure '+index+' restores button');await q.close();
    }
    const uncertain=await page();let uncertainDownloads=0;uncertain.on('download',()=>uncertainDownloads++);
    await uncertain.evaluate(()=>{exporter.destroy();exporter=ChuJourneySouvenir.create({button:document.getElementById('download-image'),status:document.getElementById('status'),getData:()=>payload,verify:async()=>undefined});});
    check(await uncertain.evaluate(()=>exporter.exportImage())===false,'undefined verification cannot authorize export');check(uncertainDownloads===0,'uncertain source no download');await uncertain.close();
    const changed=await page();let changeDownloads=0;changed.on('download',()=>changeDownloads++);
    await changed.evaluate(()=>{const original=Image.prototype.__lookupSetter__('src');Object.defineProperty(Image.prototype,'src',{set(value){if(value.includes('hhl-full-park'))payload.note='等待时编辑的新手记';original.call(this,value);},get(){return this.getAttribute('src');},configurable:true});});
    check(await changed.evaluate(()=>exporter.exportImage())===false,'changed note cancels stale snapshot');
    check(changeDownloads===0&&(await changed.locator('#status').textContent()).includes('内容已变化'),'changed note never downloads stale note');await changed.close();

    for(const method of ['reset','destroy']){
      const q=await page();let n=0;q.on('download',()=>n++);
      await q.evaluate(()=>{window.encodeCallbacks=[];HTMLCanvasElement.prototype.toBlob=function(callback){window.encodeCallbacks.push(callback);};window.pending=exporter.exportImage();});
      await q.waitForFunction(()=>window.encodeCallbacks.length===1);
      await q.evaluate(value=>{exporter[value]();window.encodeCallbacks[0](new Blob(['late'],{type:'image/png'}));},method);
      check(await q.evaluate(()=>pending)===false,method+' cancels late encoding');check(n===0,method+' no late download');
      check((await q.locator('#download-image').textContent())==='保存图片'&&!(await q.locator('#download-image').isDisabled()),method+' restores button');await q.close();
    }
    const hidden=await page();let hiddenDownloads=0;hidden.on('download',()=>hiddenDownloads++);
    await hidden.evaluate(()=>{allowed=false;});check(await hidden.evaluate(()=>exporter.exportImage())===false,'non-finish view cannot export');check(hiddenDownloads===0,'no export while not interactable');await hidden.close();

    for(const failure of ['image','canvas','blob']){
      const q=await page();let n=0;q.on('download',()=>n++);
      if(failure==='image')await q.route('**/hhl-full-park-v2.webp',route=>route.abort());
      if(failure==='canvas')await q.evaluate(()=>{HTMLCanvasElement.prototype.getContext=()=>null;});
      if(failure==='blob')await q.evaluate(()=>{HTMLCanvasElement.prototype.toBlob=callback=>callback(null);});
      check(await q.evaluate(()=>exporter.exportImage())===false,failure+' returns recoverable failure');
      check(n===0&&(await q.locator('#status').textContent()).includes('游记文字'),failure+' no blank download and text fallback');await q.close();
    }
    const fallback=await page();await fallback.route('**/*.woff2',route=>route.abort());await fallback.route('**/paper-fibres-soft-v1.webp',route=>route.abort());
    const fallbackWait=fallback.waitForEvent('download');await fallback.locator('#download-image').click();const fallbackDownload=await fallbackWait;await fallbackDownload.saveAs(path.join(output,'fallback-souvenir.png'));
    check(fs.readFileSync(path.join(output,'fallback-souvenir.png')).length>1000,'missing font/texture keeps readable image fallback');await fallback.close();
    const rapid=await page(1440);let rapidDownloads=0;rapid.on('download',()=>rapidDownloads++);const rapidWait=rapid.waitForEvent('download');
    check(await rapid.evaluate(async()=>{const first=exporter.exportImage(),second=exporter.exportImage();return await first&&await second===false;}),'duplicate export ignored');
    await rapidWait;
    check(rapidDownloads===1,'rapid clicks create one file');await rapid.close();
    check(errors.length===0,'no unhandled browser errors '+errors.join(';'));check(external.length===0,'no external requests '+external.join(';'));
    console.log('Souvenir browser: '+checks+' checks passed; '+png);
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
