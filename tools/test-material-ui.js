'use strict';
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),output=process.argv[2];
if(!output||!path.isAbsolute(output))throw Error('Pass an absolute screenshot output directory outside the repository');
const fixture={ok:true,realOcrReady:false,provider:'mock',mode:'mock_only',items:[
 {submissionId:'image',title:'碑刻与纹样（虚构样例）',description:'用于本地检查，未读取真实投稿。',assetType:'image',fileUrl:'',analyses:[
  {id:'ocr',submissionId:'image',status:'needs_review',simulated:true,kind:'image_ocr',reviewVersion:0,blocks:[{id:'fragment_0',kind:'image_ocr',text:'[模拟] 碑刻记载了修缮经过。',locator:{type:'image_region',blockIndex:0}}]},
  {id:'visual',submissionId:'image',status:'needs_review',simulated:true,kind:'image_observation',reviewVersion:0,blocks:[{id:'fragment_0',kind:'image_observation',text:'[模拟] 可见双翼轮廓。',uncertainty:'无法确认年代',locator:{type:'image_region',boundingBox:{x:0,y:0,width:1,height:1}}}]}]},
 {submissionId:'audio',title:'修缮口述（虚构样例）',assetType:'audio',fileUrl:'data:audio/wav;base64,UklGRg==',analyses:[{id:'audio1',submissionId:'audio',status:'needs_review',simulated:true,kind:'audio_transcript',reviewVersion:0,blocks:[{id:'fragment_0',kind:'audio_transcript',text:'[模拟] 讲述者介绍修缮活动。',locator:{type:'audio_time',startSeconds:0,endSeconds:5}}]}]},
 {submissionId:'video',title:'现场视频（虚构样例）',assetType:'video',fileUrl:'',analyses:[]}
],synthetic:{}};
async function main(){
fs.mkdirSync(output,{recursive:true});
const server=http.createServer((req,res)=>{const name=new URL(req.url,'http://local').pathname;
 if(!['/admin.html','/index.html'].includes(name)&&!name.startsWith('/static/')){res.writeHead(404).end();return;}
 const file=path.resolve(root,'.'+name);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404).end();return;}
 res.setHeader('Content-Type',name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':'text/html; charset=utf-8');res.end(fs.readFileSync(file));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
try{
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://static.cloudbase.net/**',r=>r.fulfill({contentType:'application/javascript',body:'window.cloudbase={init:()=>({auth:()=>({getLoginState:async()=>null})})};'}));
 await page.route('https://**/*',r=>{const u=new URL(r.request().url());if(u.hostname==='static.cloudbase.net')return r.fulfill({contentType:'application/javascript',body:'window.cloudbase={init:()=>({auth:()=>({getLoginState:async()=>null})})};'});if(u.hostname==='cdn.tailwindcss.com'||u.hostname==='fonts.googleapis.com'||u.hostname==='fonts.gstatic.com')return r.continue();return r.abort();});
 await page.goto('http://127.0.0.1:'+server.address().port+'/admin.html');
 await page.waitForFunction(()=>typeof renderMaterialWorkspace==='function');
 await page.evaluate(data=>{window.materialCalls=[];callMaterialWorker=async request=>{materialCalls.push(request);return request.action==='getWorkspace'?data:{ok:true};};loginPanel.style.display='none';adminPanel.classList.remove('hidden');setActiveView('material-analysis','材料校对');renderMaterialWorkspace(data);},fixture);
 assert.equal(await page.locator('.admin-material-original audio').count(),1);
 for(const width of [390,768,1440]){
  await page.setViewportSize({width,height:1000});await page.evaluate(()=>document.querySelectorAll('#list details').forEach(d=>d.open=true));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'overflow '+width);
  await page.screenshot({path:path.join(output,'materials-'+width+'.png'),fullPage:true});
 }
 const card=page.locator('[data-material-fragments="audio1"]');await card.locator('textarea').fill('校对后的口述片段');await card.locator('[data-time-start]').fill('1');await card.locator('[data-fragment-usable]').check();await card.locator('[data-review-fragments="approved"]').click();
 await page.waitForFunction(()=>materialCalls.some(x=>x.action==='reviewMaterialEvidence'));
 const payload=await page.evaluate(()=>materialCalls.find(x=>x.action==='reviewMaterialEvidence'));assert.equal(payload.fragments[0].startSeconds,'1');assert.equal(payload.fragments[0].usable,true);assert.equal(payload.fragments[0].publicExcerpt,false);
 await page.evaluate(()=>document.querySelectorAll('details').forEach(d=>d.open=true));await page.locator('[data-material-process="video_frames"]').click();await page.waitForFunction(()=>materialCalls.some(x=>x.kind==='video_frames'));
 assert.deepEqual(errors,[]);
 const user=await browser.newPage();await user.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1:')?r.continue():r.abort());
 await user.goto('http://127.0.0.1:'+server.address().port+'/index.html');
 for(const id of ['collect-material-consent','collect-material-research-consent','collect-material-excerpt-consent'])assert.equal(await user.locator('#'+id).isChecked(),false);
 console.log('Material UI: 390/768/1440, OCR vs observations, audio correction, timecodes, video action, default-off consent and no administrator script errors passed.');
}finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
}main().catch(e=>{console.error(e);process.exitCode=1;});
