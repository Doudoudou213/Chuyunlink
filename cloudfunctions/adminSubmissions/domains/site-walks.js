'use strict';
const C=require('../lib/site-walk-core');
const actions=['getSiteWalkWorkspace','getSiteWalkDraft','saveSiteWalkDraft','previewSiteWalk','publishSiteWalk','pauseSiteWalk'];
function createSiteWalkAdminService({db,clock=Date.now}) {
 async function prepare(){for(const name of ['site_walks','site_walk_versions','site_walk_logs']) await db.createCollection(name).catch(e=>{if(!/exist/i.test(String(e.code)+e.message))throw e;});}
 async function catalog(resourceId){
  const rows=(await db.collection('guide_fragments').where({resourceId}).limit(100).get()).data||[],items=[];
  for(const r of rows) if(r.publishedVersionId) try {const g=await C.guide(db,r.publishedVersionId,resourceId); for(const o of g.observations.filter(x=>x.located)) items.push({guideVersionId:r.publishedVersionId,observationKey:o.key,title:g.f.title,text:o.text,locator:o.locator,sources:g.sources});}catch(e){if(!['WALK_SOURCE','GUIDE_SOURCE_INVALID'].includes(e.code))throw e;}
  return items;
 }
 async function handle(e,reviewer){
  if(!reviewer)C.fail('UNAUTHENTICATED','请登录管理员账号');
  if(!actions.includes(e.action))C.fail('WALK_ACTION','未知导览操作');
  await prepare();
  if(e.action==='getSiteWalkWorkspace'){
   const offset=Math.max(0,Math.min(10000,Number(e.offset)||0));
   const rows=(await db.collection('resources').where({status:'published'}).skip(offset).limit(31).get()).data||[],items=[];
   for(const r of rows.slice(0,30)){const resourceId=r._id||r.id,root=await C.read(db,'site_walks',C.rootId(resourceId)),live=root?await C.publicWalk(db,resourceId,clock()):null;items.push({resourceId,title:r.title,revision:root?.revision||0,publishedVersion:root?.publishedVersion||0,hasDraft:!!root?.draft,available:!!live?.available,paused:!!root?.paused,reason:live?.reason||'尚未建立内部导览'});}
   return {ok:true,items,nextOffset:rows.length>30?offset+30:null};
  }
  const resourceId=C.id(e.resourceId),key=C.rootId(resourceId);
  if(e.action==='getSiteWalkDraft'){const root=await C.read(db,'site_walks',key),versions=(await db.collection('site_walk_versions').where({resourceId}).limit(100).get()).data||[];const published=root?.publishedVersionId?await C.read(db,'site_walk_versions',root.publishedVersionId):null;return {ok:true,root,publishedDraft:published?{title:published.title,points:published.points}:null,options:await catalog(resourceId),versions:versions.map(v=>({version:v.version,versionId:v.versionId,publishedAt:v.publishedAt,validUntil:v.review.validUntil}))};}
  if(e.action==='previewSiteWalk'){const root=await C.read(db,'site_walks',key);if(!root?.draft)C.fail('WALK_STATE','请先保存草稿');const result=await C.resolve(db,resourceId,root.draft);return {ok:true,revision:root.revision,previewFingerprint:C.hash([root.revision,root.draft,result.sourceFingerprint]),preview:result};}
  C.id(e.requestId);
  const logId=C.hash([reviewer,e.requestId]),signature=C.hash(e);
  return db.runTransaction(async tx=>{
   const prior=await C.read(tx,'site_walk_logs',logId);
   if(prior){if(prior.signature!==signature)C.fail('WALK_REQUEST','重复请求内容不同，请重新操作');return prior.result;}
   const ref=tx.collection('site_walks').doc(key),old=await C.read(tx,'site_walks',key);
   if((old?.revision||0)!==Number(e.revision))C.fail('WALK_CONFLICT','另一窗口已修改，请重新读取后编辑');
   let next={...old,id:key,resourceId,revision:(old?.revision||0)+1,updatedAt:new Date(clock()).toISOString()},result;
   if(e.action==='saveSiteWalkDraft'){
    const value=C.draft(e.draft||{});await C.resolve(tx,resourceId,value);next.draft=value;result={ok:true,revision:next.revision};
   } else if(e.action==='publishSiteWalk'){
    if(!old?.draft)C.fail('WALK_STATE','请先保存草稿');
    const resolved=await C.resolve(tx,resourceId,old.draft);
    if(e.previewFingerprint!==C.hash([old.revision,old.draft,resolved.sourceFingerprint]))C.fail('WALK_CONFLICT','草稿或来源已变化，请重新预览');
    if(old.draft.points.some(p=>p.accessNote.length<4))C.fail('WALK_REVIEW','请填写每处观察点及到达这一处的通行核实依据');
    const review=C.review(e.review,reviewer,clock()),version=(old.publishedVersion||0)+1,versionId=key+'_v'+version;
    await tx.collection('site_walk_versions').doc(versionId).set({...old.draft,resourceId,version,versionId,review,sourceFingerprint:resolved.sourceFingerprint,publishedAt:next.updatedAt,simulated:false});
    Object.assign(next,{draft:null,publishedVersionId:versionId,publishedVersion:version,paused:false,pauseReason:''});result={ok:true,revision:next.revision,versionId,version};
   } else {
    if(!old?.publishedVersionId)C.fail('WALK_STATE','尚无已发布导览');
    if(C.text(e.reason,500).length<4)C.fail('WALK_REVIEW','请填写暂停原因');
    if(e.pointId){const v=await C.read(tx,'site_walk_versions',old.publishedVersionId);if(!v.points.some(p=>p.id===e.pointId))C.fail('WALK_INPUT','观察点不存在');}
    // A blocked point or leg cannot be silently bypassed: pause the whole route until reviewed.
    Object.assign(next,{paused:true,pauseReason:C.text(e.reason,500),pausedPointId:e.pointId||''});result={ok:true,revision:next.revision};
   }
   delete next._id;await ref.set(next);await tx.collection('site_walk_logs').doc(logId).set({action:e.action,resourceId,revision:next.revision,reviewer,signature,result,createdAt:next.updatedAt});return result;
  });
 }
 return {handle};
}
module.exports={actions,createSiteWalkAdminService};
