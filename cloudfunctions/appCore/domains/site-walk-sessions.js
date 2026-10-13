'use strict';
const C=require('../lib/site-walk-core'),E=require('../lib/site-walk-engine');
const actions=['createSiteWalkSession','listSiteWalkSessions','getSiteWalkSession','siteWalkSessionEvent','deleteSiteWalkSession'];
function createSiteWalkSessionService({db,clock=Date.now}) {
 const safe=s=>({...E.snapshot(s),revision:s.revision,cloud:true});
 async function owned(tx,uid,key){const s=await C.read(tx,'visit_sessions',C.id(key));if(!s||s.kind!=='site_walk'||s.userId!==uid)C.fail('WALK_NOT_FOUND','找不到你的景点记录');return s;}
 async function current(tx,resourceId){const r=await require('./site-walks').createSiteWalkService({db:tx,clock}).get({resourceId});if(!r.available||r.walk.simulated)C.fail('WALK_SOURCE','当前导览待复核，已保存的到访记录仍保留');return r.walk;}
 async function handle(uid,e){
  if(!uid)C.fail('UNAUTHENTICATED','请先登录');
  if(!actions.includes(e.action))C.fail('WALK_ACTION','未知记录操作');
  await db.createCollection('visit_sessions').catch(e=>{if(!/exist/i.test(String(e.code)+e.message))throw e;});
  if(e.action==='listSiteWalkSessions'){
   const offset=Math.max(0,Math.min(10000,Number(e.offset)||0));
   const rows=(await db.collection('visit_sessions').where({userId:uid,kind:'site_walk',...(e.resourceId?{resourceId:C.id(e.resourceId)}:{})}).skip(offset).limit(21).get()).data||[];
   return {ok:true,items:rows.slice(0,20).map(safe),nextOffset:rows.length>20?offset+20:null};
  }
  if(e.action==='getSiteWalkSession')return {ok:true,session:safe(await owned(db,uid,e.sessionId))};
  const key=C.id(e.sessionId),requestId=C.id(e.requestId),signature=C.hash(e);
  return db.runTransaction(async tx=>{
   const old=await C.read(tx,'visit_sessions',key);
   if(!old&&e.action==='deleteSiteWalkSession')return {ok:true,deleted:true};
   if(old&&(old.userId!==uid||old.kind!=='site_walk'))C.fail('WALK_NOT_FOUND','找不到你的景点记录');
   const prior=old?.requests?.find(r=>r.id===requestId);
   if(prior){if(prior.signature!==signature)C.fail('WALK_REQUEST','重复操作内容不同，请重新读取');return {ok:true,session:safe(old)};}
   if((old?.revision||0)!==Number(e.revision||0))C.fail('WALK_CONFLICT','另一设备已更新，请重新读取后继续');
   const at=new Date(clock()).toISOString();let next;
   if(e.action==='createSiteWalkSession'){
    if(old)C.fail('WALK_EXISTS','本次记录已存在，请读取后继续');
    const walk=await current(tx,C.id(e.resourceId));if(e.fingerprint!==walk.fingerprint)C.fail('WALK_CONFLICT','导览已更新，请重新读取');
    next={...E.create(walk,key,at),kind:'site_walk',userId:uid};
   }else{
    if(!old)C.fail('WALK_NOT_FOUND','找不到你的景点记录');
    if(e.action==='deleteSiteWalkSession'){await tx.collection('visit_sessions').doc(key).remove();return {ok:true,deleted:true};}
    if(e.eventType==='undo'){
     const point=old.stops.find(p=>p.resourceId===e.pointId);if(!point)C.fail('WALK_INPUT','观察点不属于本次记录');
     next={...old,stops:old.stops.map(p=>p===point?{...p,state:'pending'}:p),events:[...old.events,{type:'undo',resourceId:e.pointId,at}].slice(-100)};
    }else if(e.eventType==='end'){
     next=old.status==='ended'?old:{...old,status:'ended',endedAt:at,events:[...old.events,{type:'end',resourceId:'',at}].slice(-100)};
    }else{
     const walk=await current(tx,old.resourceId);
     if(!E.compatible(old,walk))C.fail('WALK_CONFLICT','导览已换版，旧记录保留，请重新开始');
     if(e.eventType==='explorationConfirm'){
      const atlas=await require('../lib/exploration-core').get(tx,old.resourceId,clock());
      if(!atlas.available||!atlas.map.objects.some(o=>o.pointId===e.pointId)||old.status==='ended')C.fail('WALK_INPUT','请在当前探索画卷中确认观察点');
      next={...old,status:'active',startedAt:old.startedAt||at,stops:old.stops.map(p=>p.resourceId===e.pointId?{...p,state:'visited'}:p),events:[...old.events,{type:'manual_visit',resourceId:e.pointId,at}].slice(-100)};
      if(next.stops.every(p=>['visited','skipped'].includes(p.state))){next.status='ended';next.endedAt=at;}
     }else{
     if(E.current(old)?.resourceId!==e.pointId)C.fail('WALK_INPUT','请只操作当前观察点');
     if(!['arrive','complete','skip'].includes(e.eventType))C.fail('WALK_INPUT','不支持的操作');
     next=E.act(old,walk,e.eventType,at);
     }
    }
   }
   next.revision=(old?.revision||0)+1;next.updatedAt=at;next.requests=[...(old?.requests||[]),{id:requestId,signature}].slice(-30);
   delete next._id;await tx.collection('visit_sessions').doc(key).set(next);return {ok:true,session:safe(next)};
  });
 }
 return {handle};
}
module.exports={actions,createSiteWalkSessionService};
