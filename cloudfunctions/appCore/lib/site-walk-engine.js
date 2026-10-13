(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./visit-engine'));else root.SiteWalkEngine=factory(root.VisitEngine);})(typeof globalThis!=='undefined'?globalThis:this,function(E){
'use strict';
function validate(w){if(!w||typeof w.fingerprint!=='string'||!w.fingerprint||!Array.isArray(w.points)||!w.points.length||w.points.length>12||new Set(w.points.map(p=>p.id)).size!==w.points.length)throw Error('导览资料不完整');return w;}
function create(w,id,at=new Date().toISOString()){validate(w);return {id,resourceId:w.resourceId,walkId:w.id,version:w.version,fingerprint:w.fingerprint,simulated:w.simulated===true,status:'planned',createdAt:at,events:[],stops:w.points.map(p=>({resourceId:p.id,state:'pending',locked:false}))};}
function compatible(s,w){return !!s&&s.resourceId===w.resourceId&&s.walkId===w.id&&s.fingerprint===w.fingerprint&&s.simulated===(w.simulated===true)&&s.stops.length===w.points.length&&s.stops.every((p,i)=>p.resourceId===w.points[i].id&&['pending','arrived','visited','skipped'].includes(p.state));}
function current(s){return s.status==='ended'?null:s.stops.find(p=>p.state==='arrived')||s.stops.find(p=>p.state==='pending')||null;}
function act(s,w,type,at=new Date().toISOString()){validate(w);if(!compatible(s,w))throw Error('导览资料已更新，请保留旧记录并重新开始');const p=current(s);if(type!=='end'&&!p)throw Error('没有待游览的观察点');let next=E.transition(s,type,p?.resourceId||'',at);if(type==='complete'||type==='skip'){if(!current(next))next=E.transition(next,'end','',at);}return next;}
// Save only a user's decisions and ids. Never persist excerpts, photos or model output.
function snapshot(s){return {id:s.id,resourceId:s.resourceId,walkId:s.walkId,version:s.version,fingerprint:s.fingerprint,simulated:s.simulated===true,status:s.status,createdAt:s.createdAt,startedAt:s.startedAt,endedAt:s.endedAt,stops:s.stops.map(p=>({resourceId:p.resourceId,state:p.state,locked:false})),events:(s.events||[]).map(e=>({type:e.type,resourceId:e.resourceId,at:e.at})).slice(-100)};}
function summary(s){const count=state=>s.stops.filter(p=>p.state===state).length;return {visited:count('visited'),arrived:count('arrived'),skipped:count('skipped'),planned:count('pending'),simulated:s.simulated===true};}
return {create,compatible,current,act,snapshot,summary};
});
