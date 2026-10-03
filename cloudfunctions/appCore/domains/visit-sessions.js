'use strict';
const E=require('../lib/visit-engine');const first=r=>Array.isArray(r?.data)?r.data[0]:r?.data;const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
function createVisitSessionService({db,routePlanner}){
 const safe=s=>{if(!s)return null;const {userId,_id,...publicValue}=s;return publicValue;};
 async function catalog(){const r=await db.collection('resources').where({status:'published'}).limit(100).get();return (r.data||[]).map(x=>({...x,id:x._id||x.id}));}
 async function owned(tx,uid,key){const s=first(await tx.collection('visit_sessions').doc(E.id(key)).get());if(!s||s.userId!==uid)fail('VISIT_NOT_FOUND','找不到你的游览记录');return s;}
 async function handle(uid,e){await db.createCollection('visit_sessions').catch(err=>{if(!/exist/i.test(String(err.code)+String(err.message)))throw err;});
 if(e.action==='listVisitSessions'){const r=await db.collection('visit_sessions').where({userId:uid}).limit(30).get();return {ok:true,items:(r.data||[]).map(safe)};}
 if(e.action==='getVisitSession')return {ok:true,session:safe(await owned(db,uid,e.sessionId))};
 if(e.action==='checkVisitRoute'){const s=await owned(db,uid,e.sessionId);const plan=E.normalize(s,await catalog(),s);const route=await require('../lib/visit-route').calculate(plan,data=>routePlanner(uid,data),undefined,uid);return db.runTransaction(async tx=>{const current=await owned(tx,uid,e.sessionId);if(current.revision!==s.revision)fail('VISIT_CONFLICT','行程已修改，请重新核算');await tx.collection('visit_sessions').doc(s.id).update({route});return {ok:true,route,assessment:E.assess(plan,route)};});}
 const resources=e.action==='saveVisitSession'?await catalog():[];
 return db.runTransaction(async tx=>{const key=E.id(e.sessionId);const ref=tx.collection('visit_sessions').doc(key);const existing=first(await ref.get());if(existing&&existing.userId!==uid)fail('VISIT_NOT_FOUND','找不到你的游览记录');if(existing&&existing.revision!==Number(e.revision))fail('VISIT_CONFLICT','另一设备已修改，请先重新读取');let s;
 if(e.action==='saveVisitSession'){const plan=E.normalize(e.plan||{},resources,existing);s={...existing,...plan,id:key,userId:uid,status:existing?.status||'planned',events:existing?.events||[],route:existing&&E.routeKey(existing)===E.routeKey(plan)?existing.route:null,createdAt:existing?.createdAt||new Date().toISOString()};}
 else {if(!existing)fail('VISIT_NOT_FOUND','找不到你的游览记录');s=E.transition(existing,e.eventType,e.resourceId);if(s===existing)return {ok:true,session:safe(existing)};}
 s.revision=(existing?.revision||0)+1;s.updatedAt=new Date().toISOString();await ref.set(s);return {ok:true,session:safe(s)};});}
 return {handle};
}
module.exports={createVisitSessionService};
