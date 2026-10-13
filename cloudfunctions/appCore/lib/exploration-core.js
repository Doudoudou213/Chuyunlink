'use strict';
// Shared by the public reader and administrator. Coordinates are drawing coordinates, never GPS.
const {read}=require('./guide-evidence');
const crypto=require('node:crypto');
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fail=s=>{throw Object.assign(Error(s),{code:'EXPLORATION_INPUT'});};
const id=v=>{if(typeof v!=='string'||! /^[\w-]{1,128}$/.test(v))fail('地图编号无效');return v;};
function normalize(raw,points){
 if(raw==null)return null;
 if(raw.schemaVersion!==1||raw.coordinateType!=='schematic')fail('请选择示意图格式，不可把图上坐标当作定位');
 if(!Array.isArray(raw.objects)||!raw.objects.length||raw.objects.length>12)fail('地图需要 1～12 个景物');
 const ids=new Set(),bindings=new Set();
 const objects=raw.objects.map(o=>{id(o.id);id(o.pointId);if(ids.has(o.id)||bindings.has(o.pointId)||!points.some(p=>p.id===o.pointId))fail('景物重复或未绑定观察点');ids.add(o.id);bindings.add(o.pointId);if(!['tower','gate','stone'].includes(o.symbol)||![o.x,o.y].every(n=>Number.isFinite(n)&&n>=100&&n<=900))fail('景物样式或图上位置无效');return {id:o.id,pointId:o.pointId,symbol:o.symbol,x:Math.round(o.x),y:Math.round(o.y)};});
 const edges=raw.edges||[];if(!Array.isArray(edges)||edges.length>12)fail('路径数量超出范围');const seen=new Set();
 return {schemaVersion:1,coordinateType:'schematic',objects,edges:edges.map(e=>{id(e.from);id(e.to);const key=[e.from,e.to].sort().join(':');if(!ids.has(e.from)||!ids.has(e.to)||e.from===e.to||seen.has(key)||typeof e.accessNote!=='string'||e.accessNote.trim().length<4||e.accessNote.length>500)fail('路径需连接两个观察点并填写通行核实依据');seen.add(key);return {from:e.from,to:e.to,accessNote:e.accessNote.trim()};})};
}
function project(value,points){const m=normalize(value,points);if(!m)return null;return {...m,edges:m.edges.map(({from,to})=>({from,to})),objects:m.objects.map(o=>{const p=points.find(p=>p.id===o.pointId);return {...o,label:p.title,details:[{id:'observation',label:'看细节',text:p.text},{id:'location',label:'认位置',text:p.locator}]};})};}
async function get(db,resourceId,now=Date.now()){
 const C=require('./site-walk-core'),live=await C.publicWalk(db,resourceId,now);
 const empty={ok:true,available:false,reason:'探索地图尚未核实，先阅读已有介绍。'};
 if(!live?.available)return live||empty;
 const root=await read(db,'site_walks',C.rootId(resourceId)),v=await read(db,'site_walk_versions',root.publishedVersionId);
 // Re-read the root to catch a publication change during the source projection.
 if(v?.version!==live.walk.version||!v?.exploration)return empty;
 const map=project(v.exploration,live.walk.points);return {...live,map,walk:{...live.walk,fingerprint:hash([live.walk.fingerprint,map])}};
}
module.exports={normalize,project,get,hash};
