'use strict';
const assert=require('node:assert/strict'),R=require('../static/exploration-readiness');
const {fixture}=require('./lib/exploration-journey-preview');let checks=0;
const check=(value,message)=>{assert(value,message);checks++;};
(async()=>{
  const f=await fixture(),snapshot=await f.call({action:'getSiteWalkDraft',resourceId:'r'});
  const empty={ok:true,items:[]},initial=R.project(snapshot,empty,'r');
  check(initial.points.length===4,'four saved points');check(initial.basis==='最新发布版本','published basis');
  check(initial.needs===0,'filled fixture metadata only');check(initial.global.some(x=>x.includes('不以本清单判断')),'no availability promise');
  check(initial.points[0].checks.find(c=>c.key==='audio').state==='optional','audio optional');
  check(initial.points[0].checks.find(c=>c.key==='captions').state==='optional','captions optional');
  const draft=structuredClone(snapshot.publishedDraft);draft.points[0].accessNote='';
  let s={...snapshot,root:{...snapshot.root,draft}},p=()=>R.project(s,empty,'r');
  check(p().basis==='已保存草稿','draft basis');check(p().needs===1,'access gap');
  s.options=[];check(p().points.every(p=>p.checks[0].state==='needs'),'unavailable guide not accepted');
  s={...snapshot,root:{...snapshot.root,paused:true}};check(p().global.some(x=>x.includes('已暂停')),'paused');
  s={...snapshot,versions:snapshot.versions.map(v=>({...v,validUntil:'2000-01-01'}))};check(p().global.some(x=>x.includes('复核时间')),'expired publication');
  s={ok:true,root:null,options:[],versions:[]};check(p().global[0].includes('尚无'),'empty draft');check(p().needs===1,'empty draft needs preparation');
  assert.throws(()=>R.project({...snapshot,root:{resourceId:'other'}},empty,'r'));checks++;
  assert.throws(()=>R.project(snapshot,{ok:false},'r'));checks++;
  const d=structuredClone(snapshot.publishedDraft),point=d.points[0],object=d.exploration.objects[0];object.imageId='photo';object.audioId='voice';
  s={...snapshot,root:{...snapshot.root,draft:d}};
  check(p().points[0].checks.find(c=>c.key==='image').state==='needs','missing list item unknown not deleted');
  const asset={id:'photo',resourceId:'r',pointId:point.id,guideVersionId:point.guideVersionId,type:'image',status:'approved',publicUseConfirmed:true,rightsConfirmed:true,
    reviewedBy:'private-reviewer',attribution:'local author',rightsNote:'private-permission-detail',rightsKind:'licensed',validUntil:new Date(Date.now()+600000).toISOString(),
    sourceIds:snapshot.options.find(o=>o.guideVersionId===point.guideVersionId).sources.map(x=>x.id),url:'https://private.example.com/private-file'};
  const assets={ok:true,items:[asset,{...asset,id:'voice',type:'audio',duration:10,captions:[{start:0,end:1,text:'本地测试'}]}]};
  let value=R.project(s,assets,'r');check(value.points[0].checks.find(c=>c.key==='image').state==='recorded','registered metadata');
  check(value.points[0].checks.find(c=>c.key==='captions').state==='recorded','caption presence only');
  for(const edit of [{status:'revoked'},{revokedAt:'now'},{validUntil:'2000-01-01'},{pointId:'other'},{guideVersionId:'other'},{type:'audio'},{resourceId:'other'},{rightsConfirmed:false},{publicUseConfirmed:false},{reviewedBy:''},{sourceIds:['unknown']},{rightsKind:'unlicensed'}]){
    const changed=R.project(s,{ok:true,items:[{...asset,...edit}]},'r');check(changed.points[0].checks.find(c=>c.key==='image').state==='needs',JSON.stringify(edit));
  }
  d.exploration.objects[1].artScene='tower';check(R.project(s,assets,'r').points[0].checks.find(c=>c.key==='art').state==='needs','duplicate artwork');
  d.exploration.objects[1].artScene='copper';delete object.artScene;check(R.project(s,assets,'r').points[0].checks.find(c=>c.key==='art').state==='optional','unbound allows text');
  d.exploration.edges=[{from:'one',to:'two',accessNote:''}];check(R.project(s,assets,'r').global.some(x=>x.includes('路径未填写')),'edge gap');
  const packet=R.packet(value);
  for(const privateField of ['private-reviewer','private-permission-detail','private-file','private.example.com'])check(!packet.includes(privateField),'export excludes '+privateField);
  check(packet.includes('站立观察')&&packet.includes('台阶')&&packet.includes('授权凭据'),'field questions');
  check(packet.includes('不是审核通过'),'not approval');
  console.log('PASS readiness: '+checks+' checks; saved state, metadata expiry/binding, source gaps, optional media, redacted field packet.');
})().catch(e=>{console.error(e);process.exitCode=1;});
