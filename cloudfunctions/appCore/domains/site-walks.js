'use strict';
const {read}=require('../lib/guide-evidence');
const {createCulturalGuideService}=require('./cultural-guide');
const {hash}=require('../lib/guide-question-evidence');
// Route order and access are field-reviewed data, never inferred from coordinates or a model.
function createSiteWalkService({db,clock=Date.now}){
 async function get(e){
  if(typeof e.resourceId!=='string'||! /^[\w-]{1,128}$/.test(e.resourceId))throw Error('请选择地点');
  const r=await read(db,'resources',e.resourceId),empty={ok:true,available:false,reason:'本站内部导览尚待现场核实，可继续阅读已有介绍。'};
  if(!r||r.status!=='published'||r.disabledAt||r.withdrawnAt||r.needsSourceReview||r.sourceUnavailable||['closed','unavailable'].includes(r.visitInfo?.status))return empty;
  const w=r.siteWalk,at=clock();
  if(!w||w.status!=='published'||w.simulated||w.review?.onsiteConfirmed!==true||!w.review?.reviewedBy||!Number.isSafeInteger(w.version)||w.version<1||!Array.isArray(w.points)||w.points.length<1||w.points.length>12)return empty;
  const checked=Date.parse(w.review.checkedAt),until=Date.parse(w.review.validUntil);
  if(!Number.isFinite(checked)||!Number.isFinite(until)||checked>at||until<=at||until-checked>7*86400000)return empty;
  const guides=(await createCulturalGuideService({db}).station({resourceId:e.resourceId})).items,points=[];
  for(const p of w.points){
   const f=guides.find(x=>x.versionId===p.guideVersionId),o=f?.observations?.[p.observationIndex];
   if(!/^[\w-]{1,80}$/.test(p.id||'')||points.some(x=>x.id===p.id)||!Number.isInteger(p.observationIndex)||!o||!o.locator||o.locator==='具体位置尚未确认'||p.accessConfirmed!==true)return empty;
   // Photos must be explicitly cleared for public display and field identification.
   let photo=null;if(p.photo?.publicApproved===true&&p.photo?.onsiteConfirmed===true){try{const u=new URL(p.photo.url);if(u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash)photo={url:u.href,alt:String(p.photo.alt||'现场参照照片').slice(0,160),credit:String(p.photo.credit||'').slice(0,160)};}catch{}}
   points.push({id:p.id,title:String(p.title||f.title).slice(0,100),text:o.text,locator:o.locator,direction:String(p.direction||'').slice(0,200),photo,sources:f.sources,guideVersionId:f.versionId});
  }
  const result={id:String(w.id||e.resourceId).slice(0,100),resourceId:e.resourceId,title:String(r.title||'景点导览').slice(0,100),version:w.version,simulated:false,points};
  return {ok:true,available:true,walk:{...result,fingerprint:hash(result)},checkedAt:w.review.checkedAt,validUntil:w.review.validUntil};
 }
 return {get};
}
module.exports={createSiteWalkService};
