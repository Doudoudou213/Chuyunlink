'use strict';
// Local record migration only; no account, reward or publication state.
const assert=require('node:assert/strict');
const C=require('../static/exploration-journey-content');
const now=Date.now();
const data={resourceId:'local-four-scenes',fingerprint:'same-reading-version',version:1,localTest:true,
  points:[{id:'tower',title:'黄鹤楼主楼',artScene:'tower'},{id:'copper',title:'古铜顶',artScene:'copper'},{id:'no-art',title:'未配准点位',artScene:null}]};
let checks=0;
const check=(value,label)=>{assert(value,label);checks++;};
const old={fingerprint:data.fingerprint,updatedAt:now-500,selected:'copper',observed:['tower'],note:'只留在本机的手记',feedback:{start:'alone',reading:'clear',memory:'yes',obstacle:''}};
const migrated=C.record(data,old,now);
check(migrated.selected==='copper','old selected scene survives additive record migration');
check(JSON.stringify(migrated.observed)==='["tower"]','old explicit observations survive');
check(migrated.note===old.note,'old private note survives');
check(migrated.feedback.reading==='clear','old feedback survives');
check(Array.isArray(migrated.details)&&migrated.details.length===0,'old records receive an empty optional detail list');
const safe={pointId:'tower',sceneId:'tower',detailKey:'eaves'};
const dirty={...old,details:[safe,{...safe,label:'untrusted label',url:'https://private.invalid'},{pointId:'missing',sceneId:'tower',detailKey:'eaves'},
  {pointId:'tower',sceneId:'copper',detailKey:'outline'},{pointId:'no-art',sceneId:null,detailKey:'detail'},
  null,'bad',[],{pointId:'tower',sceneId:'tower',detailKey:'<img>'},{pointId:'tower',sceneId:'tower',detailKey:'x'.repeat(41)},
  {pointId:'copper',sceneId:'copper',detailKey:'outline',uid:'never-export',reading:'not-a-cache',label:'untrusted'}]};
const clean=C.record(data,dirty,now);
check(clean.details.length===2,'malformed, mismatched, unbound and repeated details are removed');
check(JSON.stringify(clean.details[0])===JSON.stringify(safe),'stored detail contains only finite IDs, not supplied text');
check(JSON.stringify(clean.details[1])===JSON.stringify({pointId:'copper',sceneId:'copper',detailKey:'outline'}),'arbitrary payload fields are removed');
check(JSON.stringify(clean.observed)==='["tower"]','detail migration does not invent another explicit scene observation');
for(const value of [{...dirty,fingerprint:'other'},{...dirty,updatedAt:now-8*86400000},{...dirty,updatedAt:now+120000},{...dirty,updatedAt:'yesterday'}]){
  const result=C.record(data,value,now);
  check(result.details.length===0,'expired, changed or future records do not migrate details');
  check(result.observed.length===0&&result.note==='','invalid record context cannot transfer observations or notes');
}
for(const value of [null,{},'not-array',42])check(C.details(data,value).length===0,'invalid optional list falls back to empty');
const report=C.trialReport(data,dirty);
check(!Object.hasOwn(report,'details')&&!Object.hasOwn(report,'note'),'trial report does not expose private detail selections or note');
check(!JSON.stringify(report).includes('never-export')&&!JSON.stringify(report).includes('untrusted'),'private extra fields never enter feedback');
check(report.reading.recorded===1,'feedback retains explicit-only reading count');
check(C.canResume(data,old,now),'old valid record still resumes');
check(!C.canResume({...data,fingerprint:'new'},old,now),'changed content cannot resume another version');
console.log('PASS reader record migration: '+checks+' checks; old notes preserved, detail IDs sanitized, feedback stays private and version-bound.');
