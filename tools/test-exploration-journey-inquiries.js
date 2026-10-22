'use strict';
// Pure projection and localhost fixture checks. No browser, database or model.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm'),http=require('node:http');
const C=require('../static/exploration-journey-content'),Q=require('../static/exploration-journey-inquiry-data');
const preview=require('./lib/exploration-four-scenes-preview'),tower=require('./lib/exploration-tower-study-preview');
const {createEditorialPreview,validateInquiries}=require('./lib/exploration-editorial-preview');
const draft=require('./fixtures/four-scenes-study.json'),metadata=require('./fixtures/four-scenes-inquiries.json');
const root=path.join(__dirname,'..'),resourceId='hhl-four-scenes-study',now=Date.parse('2026-10-20T08:00:00Z');
const raw=preview.response(now),data=C.project(raw,resourceId,now),copy=value=>structuredClone(value);
let count=0;
function check(value,label){assert(value,label);count++;}
function equal(actual,expected,label){assert.deepEqual(actual,expected,label);count++;}
function invalidGlobal(change,label){const next=copy(raw);change(next);equal(Q.project(next,data),null,label);}
function invalidScene(change,label,scene='tower'){
  const next=copy(raw);change(next);const result=Q.project(next,data);
  check(result&&!result[scene]&&Object.keys(result).length===3,label);
}
function invalidMetadata(change,label){const next=copy(metadata);change(next);assert.throws(()=>validateInquiries(next,draft),/待审问景/);count++;}
function create(inquiries){
  return createEditorialPreview({draft,inquiries,resourceId,pagePath:'/four-scenes.html',endpoint:'/__four-scenes',
    noticeTitle:'本机测试',walkTitle:draft.title,link:{url:'http://127.0.0.1:4220/tower-study.html?resourceId=hhl-tower-study',title:'单景'}});
}
(async()=>{
  validateInquiries(metadata,draft);
  const projected=Q.project(raw,data),serialized=JSON.stringify(raw);
  equal(Object.keys(projected),['tower','copper','baiyun','pond'],'four independent scenes');
  equal(raw.walk.fingerprint,crypto.createHash('sha256').update(JSON.stringify(draft)).digest('hex'),'old reading fingerprint remains compatible');
  check(/^[a-f0-9]{64}$/.test(raw.editorialInquiries.revision),'questions have separate content revision');
  equal(raw.editorialInquiries.fingerprint,raw.walk.fingerprint,'capability binds exact current draft');
  check(raw.editorialInquiries.mode==='editorial-excerpts'&&raw.editorialInquiries.publishAllowed===false,'explicit local excerpts, not publication');
  check(!own(tower.response(now),'editorialInquiries'),'stage-one preview has no question capability');
  check(!own(create(null).response(now),'editorialInquiries'),'capability is absent by default');
  for(const point of metadata.points){
    const original=draft.points.find(scene=>scene.id===point.pointId),answers=projected[point.pointId];
    equal(answers.length,2,point.pointId+' has two concise questions');
    for(const [index,question] of point.questions.entries()){
      const answer=answers[index],sourceIndexes=[...new Set(question.paragraphs.flatMap(paragraph=>paragraph.sourceIndexes))];
      equal(answer.id,question.id,question.id+' keeps stable local identifier');
      equal(answer.label,question.label,question.id+' keeps authored question');
      equal(answer.paragraphs,question.paragraphs.map(paragraph=>original.paragraphs[paragraph.index]),question.id+' returns existing paragraphs verbatim');
      equal(answer.sources,sourceIndexes.map(index=>data.points.find(scene=>scene.id===point.pointId).sources[index]),question.id+' selects only its own declared sources');
      check(Object.isFrozen(answer)&&Object.isFrozen(answer.paragraphs)&&Object.isFrozen(answer.sources),question.id+' projection cannot be mutated in place');
    }
  }
  equal(projected.baiyun[0].sources.length,1,'museum question does not include unrelated painting source');
  check(projected.baiyun[0].sources[0].url.includes('ylj.wuhan.gov.cn')&&projected.baiyun[1].sources[0].url.includes('cnr.cn'),'same-scene citation mapping is specific');
  equal(JSON.stringify(raw),serialized,'projection never mutates the response');
  check(!/\b(answer|text|reading|history|question|prompt|model)\b/.test(JSON.stringify(metadata).replace(/questions/g,'')),'metadata stores no answer text, user query or model field');
  const revised=copy(metadata);revised.points[0].questions[0].label='主楼与黄鹤楼历史是同一个年代吗？';
  const next=create(revised).response(now),nextData=C.project(next,resourceId,now);
  equal(next.walk.fingerprint,raw.walk.fingerprint,'question edit does not discard reading progress');
  check(next.editorialInquiries.revision!==raw.editorialInquiries.revision,'question edit changes only inquiry revision');
  check(Q.revision(next,nextData)!==Q.revision(raw,data),'UI comparison invalidates old displayed answer after question edit');
  const staleRevision=copy(next);staleRevision.editorialInquiries.revision=raw.editorialInquiries.revision;
  check(Q.revision(staleRevision,nextData)!==Q.revision(raw,data),'projection signature catches stale claimed revision too');
  equal(Q.revision({},data),null,'no revision when capability is absent');
  for(const [label,change] of [
    ['no capability',r=>{delete r.editorialInquiries;}],
    ['not explicitly local',r=>{delete r.localTest;}],
    ['truthy local string',r=>{r.localTest='true';}],
    ['real walkthrough',r=>{r.walk.simulated=false;}],
    ['unavailable response',r=>{r.available=false;}],
    ['failed response',r=>{r.ok=false;}],
    ['unsupported schema',r=>{r.editorialInquiries.schemaVersion=2;}],
    ['generated mode',r=>{r.editorialInquiries.mode='ai-answer';}],
    ['publication enabled',r=>{r.editorialInquiries.publishAllowed=true;}],
    ['resource mismatch',r=>{r.editorialInquiries.resourceId='other';}],
    ['raw resource mismatch',r=>{r.walk.resourceId='other';}],
    ['fingerprint mismatch',r=>{r.editorialInquiries.fingerprint='older';}],
    ['raw fingerprint mismatch',r=>{r.walk.fingerprint='older';}],
    ['missing revision',r=>{delete r.editorialInquiries.revision;}],
    ['malformed revision',r=>{r.editorialInquiries.revision='not-a-digest';}],
    ['coerced revision',r=>{r.editorialInquiries.revision=[r.editorialInquiries.revision];}],
    ['no points',r=>{r.editorialInquiries.points=[];}],
    ['duplicate points',r=>{r.editorialInquiries.points[1].pointId='tower';}],
    ['duplicate raw point',r=>{r.walk.points[1].id='tower';}],
    ['too many points',r=>{r.editorialInquiries.points.push({pointId:'extra',questions:[]});}],
    ['unexpected executable metadata',r=>{r.editorialInquiries.endpoint='https://example.com/ask';}]
  ])invalidGlobal(change,label+' fails closed globally');
  equal(Q.project(raw,{...data,localTest:false}),null,'projected data must also be explicitly local');
  equal(Q.project(raw,{...data,fingerprint:'old'}),null,'projected data must be current');
  equal(Q.project(raw,{...data,points:[...data.points,data.points[0]]}),null,'ambiguous projected point list is closed');
  for(const [label,change] of [
    ['wrong target point',r=>{r.editorialInquiries.points[0].pointId='unknown';}],
    ['one question only',r=>{r.editorialInquiries.points[0].questions.pop();}],
    ['third question',r=>{r.editorialInquiries.points[0].questions.push(copy(r.editorialInquiries.points[0].questions[0]));}],
    ['duplicate question ID',r=>{r.editorialInquiries.points[0].questions[1].id=r.editorialInquiries.points[0].questions[0].id;}],
    ['duplicate label',r=>{r.editorialInquiries.points[0].questions[1].label=r.editorialInquiries.points[0].questions[0].label;}],
    ['long label',r=>{r.editorialInquiries.points[0].questions[0].label='问'.repeat(81);}],
    ['active HTML label',r=>{r.editorialInquiries.points[0].questions[0].label='<img src=x>'; }],
    ['control in label',r=>{r.editorialInquiries.points[0].questions[0].label='问\u0000';}],
    ['newline in label',r=>{r.editorialInquiries.points[0].questions[0].label='问\n一句';}],
    ['unknown answer field',r=>{r.editorialInquiries.points[0].questions[0].answer='新编答案';}],
    ['missing paragraph',r=>{r.editorialInquiries.points[0].questions[0].paragraphs=[];}],
    ['too many paragraphs',r=>{r.editorialInquiries.points[0].questions[0].paragraphs=[0,1,2].map(index=>({index,sourceIndexes:[0]}));}],
    ['negative paragraph index',r=>{r.editorialInquiries.points[0].questions[0].paragraphs[0].index=-1;}],
    ['fractional paragraph index',r=>{r.editorialInquiries.points[0].questions[0].paragraphs[0].index=.5;}],
    ['string paragraph index',r=>{r.editorialInquiries.points[0].questions[0].paragraphs[0].index='1';}],
    ['out-of-range paragraph',r=>{r.editorialInquiries.points[0].questions[0].paragraphs[0].index=99;}],
    ['duplicate paragraph',r=>{r.editorialInquiries.points[0].questions[0].paragraphs.push(copy(r.editorialInquiries.points[0].questions[0].paragraphs[0]));}],
    ['empty citations',r=>{r.editorialInquiries.points[0].questions[0].paragraphs[0].sourceIndexes=[];}],
    ['negative citation',r=>{r.editorialInquiries.points[0].questions[0].paragraphs[0].sourceIndexes=[-1];}],
    ['fractional citation',r=>{r.editorialInquiries.points[0].questions[0].paragraphs[0].sourceIndexes=[.5];}],
    ['string citation',r=>{r.editorialInquiries.points[0].questions[0].paragraphs[0].sourceIndexes=['0'];}],
    ['out-of-range citation',r=>{r.editorialInquiries.points[0].questions[0].paragraphs[0].sourceIndexes=[1];}],
    ['duplicate citation',r=>{r.editorialInquiries.points[0].questions[0].paragraphs[0].sourceIndexes=[0,0];}],
    ['cross-scene reference field',r=>{r.editorialInquiries.points[0].questions[0].paragraphs[0].pointId='pond';}],
    ['raw reading changed',r=>{r.walk.points[0].reading='未经投影的新段落';}],
    ['missing raw source',r=>{r.walk.points[0].sources=[];}],
    ['raw citation changed',r=>{r.walk.points[0].sources[0].title='another';}],
    ['active source URL',r=>{r.walk.points[0].sources[0].url='javascript:alert(1)';}],
    ['plain HTTP source',r=>{r.walk.points[0].sources[0].url='http://example.com';}],
    ['credential URL',r=>{r.walk.points[0].sources[0].url='https://name:secret@example.com';}],
    ['URL whitespace',r=>{r.walk.points[0].sources[0].url=' https://example.com';}],
    ['URL backslash',r=>{r.walk.points[0].sources[0].url='https:\\\\example.com';}]
  ])invalidScene(change,label+' hides the whole scene');
  const duplicateAcross=copy(raw);duplicateAcross.editorialInquiries.points[1].questions[0].id='tower-origin';
  equal(Object.keys(Q.project(duplicateAcross,data)),['baiyun','pond'],'duplicate question IDs invalidate both implicated scenes');
  const emptyAll=copy(raw);emptyAll.editorialInquiries.points.forEach(point=>{point.questions=[];});
  equal(Q.project(emptyAll,data),null,'no valid scene means no capability');
  for(const value of [null,undefined,3,'text',[],{},true])equal(Q.project(value,data),null,'malformed response never throws');
  const badClone=copy(raw);badClone.editorialInquiries.points[0].questions[0].label='a'.repeat(20000);
  equal(Q.project(badClone,data),null,'oversized metadata fails closed globally');
  for(const [label,change] of [
    ['published metadata',m=>{m.publishAllowed=true;}],
    ['unbound metadata field',m=>{m.answer='not allowed';}],
    ['missing scene',m=>{m.points.pop();}],
    ['duplicate scene',m=>{m.points[1].pointId='tower';}],
    ['unknown scene',m=>{m.points[0].pointId='other';}],
    ['wrong scene source association',m=>{m.points[2].questions[0].paragraphs[0].sourceIndexes=[1];}],
    ['extra unrelated source',m=>{m.points[2].questions[0].paragraphs[0].sourceIndexes=[0,1];}],
    ['editorial paragraph without claim',m=>{m.points[0].questions[0].paragraphs[0].index=0;}],
    ['cross-scene key',m=>{m.points[0].questions[0].paragraphs[0].pointId='pond';}],
    ['invented answer text',m=>{m.points[0].questions[0].text='new answer';}],
    ['repeated question ID',m=>{m.points[1].questions[0].id=m.points[0].questions[0].id;}],
    ['third question',m=>{m.points[0].questions.push(copy(m.points[0].questions[0]));}],
    ['empty citation set',m=>{m.points[0].questions[0].paragraphs[0].sourceIndexes=[];}],
    ['invalid citation index',m=>{m.points[0].questions[0].paragraphs[0].sourceIndexes=[99];}]
  ])invalidMetadata(change,label+' rejected before server starts');
  const source=fs.readFileSync(path.join(root,'static/exploration-journey-inquiry-data.js'),'utf8'),context={URL};
  vm.runInNewContext(source,context);
  equal(JSON.stringify(context.ChuJourneyInquiryData.project(copy(raw),copy(data))),JSON.stringify(projected),'browser UMD and Node projection agree without DOM');
  check(!/(?:fetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|ExploreTransport|GuideCloud|askSiteExploration)/.test(source),'pure module has no network, storage or model dependency');
  const server=await preview.start();
  try{
    const page=await fetch(server.url+'/four-scenes.html?resourceId='+resourceId);
    const html=await page.text(),headers=page.headers.get('content-security-policy');
    check(headers.includes("connect-src 'self'")&&headers.includes("worker-src 'none'"),'preview remains same-origin without workers');
    check(html.includes('e.action!=="getSiteExploration"')&&!html.includes('static/guide-cloud.js'),'adapter still exposes only read action and no cloud boot');
    const payload=await (await fetch(server.url+'/__four-scenes')).json();
    equal(payload.editorialInquiries,raw.editorialInquiries,'existing read response carries exact optional capability');
    equal((await fetch(server.url+'/__four-scenes',{method:'POST'})).status,405,'preview rejects writes');
    equal((await fetch(server.url+'/__four-scenes-inquiries')).status,404,'no new question endpoint');
    equal((await fetch(server.url+'/tools/fixtures/four-scenes-inquiries.json')).status,404,'internal fixture is not served');
    const badHost=await new Promise((resolve,reject)=>{
      http.get(server.url+'/__four-scenes',{headers:{host:'untrusted.example'}},response=>{response.resume();resolve(response.statusCode);}).on('error',reject);
    });
    equal(badHost,421,'Host validation remains enforced');
  }finally{await server.close();}
  console.log('Exploration journey inquiries: '+count+' checks passed (local excerpts only).');
})().catch(error=>{console.error(error);process.exitCode=1;});
function own(value,key){return Object.prototype.hasOwnProperty.call(value,key);}
