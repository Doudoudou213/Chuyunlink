'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const {fixture}=require('./lib/exploration-journey-preview');
const E=require('../cloudfunctions/appCore/lib/exploration-core'),C=require('../static/exploration-journey-content');
let count=0;function check(fn){fn();count++;}
(async()=>{
  const f=await fixture(),r=await E.get(f.db,'r'),data=C.project(r,'r');
  check(()=>assert.equal(data.points.length,4));
  check(()=>assert.deepEqual(data.points.map(p=>p.artScene),['tower','copper','baiyun','pond']));
  check(()=>assert.match(data.points[0].reading,/流程演示/));
  check(()=>assert(!JSON.stringify(r).includes('private-user')));
  check(()=>assert(!JSON.stringify(r).includes('local-reviewer')));
  check(()=>assert.throws(()=>C.project(r,'other'),/不匹配/));
  check(()=>assert.throws(()=>C.project({...r,validUntil:new Date(0).toISOString()},'r'),/复核/));
  check(()=>assert.throws(()=>C.project({...r,available:false},'r'),/暂未开放/));
  check(()=>assert.equal(C.safeLink('javascript:alert(1)'),null));
  check(()=>assert.equal(C.safeLink('https://user:pw@example.com/a'),null));
  check(()=>assert.equal(C.safeLink('https://example.com/a'),'https://example.com/a'));
  for(const edit of [x=>x.map.objects[0].artScene='other',x=>x.map.objects[1].artScene='tower',x=>x.walk.points[0].sources=[]]){
    const x=structuredClone(r);edit(x);check(()=>assert.throws(()=>C.project(x,'r')));
  }
  check(()=>assert.throws(()=>E.normalize({...f.draft.exploration,objects:f.draft.exploration.objects.map(o=>({...o,artScene:'tower'}))},f.draft.points),/重复/));
  check(()=>assert(!JSON.stringify(E.exportLayout(f.draft.exploration,f.draft.points)).includes('artScene')));
  const fresh=C.record(data,null),old={...fresh,observed:['tower','tower','bad'],note:'字'.repeat(200)};
  check(()=>assert.deepEqual(C.record(data,old).observed,['tower']));
  check(()=>assert.equal(C.record(data,old).note.length,120));
  check(()=>assert.deepEqual(C.record({...data,fingerprint:'new'},old).observed,[]));
  check(()=>assert.equal(C.record(data,{...old,updatedAt:0}).note,''));
  const d=(await f.call({action:'getSiteWalkDraft',resourceId:'r'})).publishedDraft;d.points.reverse();await f.publish(d);
  const next=C.project(await E.get(f.db,'r'),'r');
  check(()=>assert.equal(next.points[0].id,'pond'));
  check(()=>assert.notEqual(next.fingerprint,data.fingerprint));
  const root=(await f.call({action:'getSiteWalkDraft',resourceId:'r'})).root;
  await f.call({action:'pauseSiteWalk',resourceId:'r',revision:root.revision,requestId:'test-pause',reason:'本地测试点位停用'});
  const paused=await f.call({action:'getSiteWalkDraft',resourceId:'r'});
  check(()=>assert.equal(paused.root.paused,true));
  const pausedPublic=await E.get(f.db,'r');check(()=>assert.equal(pausedPublic.available,false));
  check(()=>assert.equal(Object.keys(f.db.data().site_walk_versions).length,2));
  check(()=>assert.throws(()=>C.project({ok:true,available:false,reason:'暂停核对'},'r'),/暂停/));
  const g=await fixture();await g.db.collection('submissions').doc('s').update({aiConsentRevokedAt:'local'});
  check(()=>assert.equal(fs.readFileSync('cloudfunctions/appCore/lib/exploration-core.js','utf8'),fs.readFileSync('cloudfunctions/adminSubmissions/lib/exploration-core.js','utf8')));
  check(()=>assert.equal(fs.readFileSync('cloudfunctions/appCore/lib/site-walk-core.js','utf8'),fs.readFileSync('cloudfunctions/adminSubmissions/lib/site-walk-core.js','utf8')));
  const stopped=await E.get(g.db,'r');check(()=>assert.equal(stopped.available,false));
  const assets=require('../cloudfunctions/appCore/lib/exploration-assets');
  check(()=>assert.equal(assets.captions([{start:0,end:2,text:'已审原句'}],'这是已审原句',4).length,1));
  for(const lines of [{},[{start:0,end:6,text:'已审原句'}],[{start:0,end:2,text:'未审内容'}],[{start:0,end:2,text:'已审原句'},{start:1,end:3,text:'已审原句'}]]){
    check(()=>assert.throws(()=>assets.captions(lines,'这是已审原句',4),/字幕/));
  }
  check(()=>assert.equal(fs.readFileSync('cloudfunctions/appCore/lib/exploration-assets.js','utf8'),fs.readFileSync('cloudfunctions/adminSubmissions/lib/exploration-assets.js','utf8')));
  console.log('PASS journey content: '+count+' checks (real local review/read modules, artwork binding, order, versions, pause, source withdrawal, storage and shared code)');
})().catch(e=>{console.error(e);process.exitCode=1;});
