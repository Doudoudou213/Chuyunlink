'use strict';
const {hash,fail,input,loadEvidence,staticReply} = require('../lib/guide-question-evidence');
const {read} = require('../lib/guide-evidence');
const {configFromEnv,createClient,PROMPT_VERSION} = require('../lib/guide-question-client');
const {checkAnswer,checkVerification} = require('../lib/guide-question-contract');
const caches = new WeakMap();
const now = () => Date.now();
const SCHEMA_VERSION='visitor-qa-v1';
const COLLECTION='guide_question_usage';
function createGuideQuestionService({db,config=configFromEnv(),client=createClient(config),clock=now,evidenceLoader=loadEvidence}) {
 if(!caches.has(db))caches.set(db,new Map());
 const cache=caches.get(db);
 const permitted=id=>config.mode==='real'&&config.pilotIds.includes(id)&&config.model&&config.apiKey;
 async function context(event){const c=await evidenceLoader(db,event.resourceId),ready=Boolean(permitted(c.resourceId)&&c.pieces.length&&config.budgetCny>0&&config.inputPrice>0&&config.outputPrice>0&&config.dailyRequests>0&&config.userDailyRequests>0);return {ok:true,resourceId:c.resourceId,title:c.title,fingerprint:c.fingerprint,ready,reason:ready?'ready':!c.pieces.length?'insufficient':'off',introduction:c.pieces.slice(0,3).map(p=>p.text).join(''),sources:c.sources};}
 async function ask(event,uid) {
  if(!uid)fail('UNAUTHENTICATED','请登录后提问');
  const e=input(event);let c=await evidenceLoader(db,e.resourceId);
  if(!c.pieces.length)return staticReply('insufficient',c);
  if(/门票|票价|预约|开放时间|几点开|几点关|今天.*(?:开|关)|现在.*(?:开|关)|往[左右]|怎么走|导航|实时|公交|地铁/.test(e.question))return staticReply('practical',c);
  if(!permitted(e.resourceId))return staticReply('off',c);
  const user=hash(['visitor',uid]), requestKey=hash([user,e.requestId]), version=[SCHEMA_VERSION,PROMPT_VERSION,config.provider,config.model];
  const signature=hash([e.resourceId,e.question,e.history,c.fingerprint,version]);
  const cacheKey=hash([user,signature]);
  for(const [key,value] of cache)if(value.until<=clock())cache.delete(key);
  if(cache.has(cacheKey)){const result=cache.get(cacheKey);return {...result.answer,cached:true};}
  if(!/^[\w-]{1,64}$/.test(config.budgetId))fail('QA_CONFIG','问答配置暂不可用');
  // Worst-case token reservation for BOTH generation and independent verification. Unknown usage keeps the full reservation.
  const reserve=Math.ceil(2*(64000*config.inputPrice+1000*config.outputPrice));
  if(!(reserve>0)||!(config.inputPrice>0)||!(config.outputPrice>0)||!(config.budgetCny>0))return staticReply('limited',c);
  const at=clock(),day=new Date(at).toISOString().slice(0,10),actorId='user_'+hash([user,day]),budgetId='budget_'+config.budgetId,dailyId='day_'+hash([config.budgetId,day]);
  const token=hash([requestKey,signature,at]);
  await db.runTransaction(async tx=>{
   const prior=await read(tx,COLLECTION,requestKey);
   if(prior){if(prior.signature!==signature)fail('QA_REQUEST_CHANGED','问题已变化，请重新发送');fail('QA_DUPLICATE','这次问题已处理或正在处理，请稍后重新提问');}
   const budget=await read(tx,COLLECTION,budgetId)||{},daily=await read(tx,COLLECTION,dailyId)||{},actor=await read(tx,COLLECTION,actorId)||{};
   if(actor.lockUntil>at)fail('QA_BUSY','上一条问题还在处理中');
   if((budget.reservedMicros||0)+reserve>Math.floor(config.budgetCny*1e6)||(daily.requests||0)>=config.dailyRequests||(actor.requests||0)>=config.userDailyRequests)fail('QA_LIMIT','今天的问答额度暂时用完了');
   await tx.collection(COLLECTION).doc(budgetId).set({...budget,reservedMicros:(budget.reservedMicros||0)+reserve});
   await tx.collection(COLLECTION).doc(dailyId).set({...daily,requests:(daily.requests||0)+1,expiresAt:at+86400000*7});
   await tx.collection(COLLECTION).doc(actorId).set({requests:(actor.requests||0)+1,lockUntil:at+60000,token,expiresAt:at+86400000*2});
   await tx.collection(COLLECTION).doc(requestKey).set({signature,status:'processing',token,startedAt:at,expiresAt:at+86400000*7,version});
  });
  async function fresh(){const latest=await evidenceLoader(db,e.resourceId);if(latest.fingerprint!==c.fingerprint)fail('QA_SOURCE','来源已变化');if(clock()-at>55000)fail('QA_TIMEOUT','问答已超时');return latest;}
  let outcome='failed',usage=[],answer,calls=0;
  try {
   await fresh();
   const payload={resource:c.title,question:e.question,previousQuestions:e.history,evidence:c.pieces,sources:c.sources.map(({id,excerpt})=>({id,excerpt}))};
   calls++;const draft=await client.run('answer',payload);usage.push(draft.usage);
   const checked=checkAnswer(draft.output,c);
   if(checked.outcome==='insufficient'){await fresh();outcome='insufficient';return staticReply('insufficient',c);}
   await fresh();
   calls++;const verified=await client.run('verify',{...payload,answer:checked.sentences});usage.push(verified.usage);
   checkVerification(verified.output,checked);c=await fresh();
   const used=new Set(checked.sentences.flatMap(s=>s.pieceIds).flatMap(id=>c.pieces.find(p=>p.id===id).sourceIds));
   answer={ok:true,outcome:'answer',resourceId:c.resourceId,title:c.title,fingerprint:c.fingerprint,text:checked.sentences.map(s=>s.text).join('\n'),sentences:checked.sentences.map(s=>({text:s.text,sourceIds:[...new Set(s.pieceIds.flatMap(id=>c.pieces.find(p=>p.id===id).sourceIds))]})),sources:c.sources.filter(s=>used.has(s.id)),aiGenerated:true,version};
   outcome='answered';
  }catch(err){outcome=err.code==='QA_SOURCE'?'source_changed':err.code==='QA_OUTPUT'?'unsupported':'unavailable';return staticReply(err.code==='QA_SOURCE'?'source':err.code==='QA_OUTPUT'?'insufficient':'unavailable',c);}
  finally{
   // No raw question, answer, identity or location in persistent diagnostics.
   await db.runTransaction(async tx=>{
    const row=await read(tx,COLLECTION,requestKey),actor=await read(tx,COLLECTION,actorId);
    if(row?.token!==token)fail('QA_REQUEST_CHANGED','请求状态已变化');
    const known=usage.length===calls&&calls>0&&usage.every(u=>u&&Number.isSafeInteger(u.prompt_tokens)&&u.prompt_tokens>=0&&u.prompt_tokens<=64000&&Number.isSafeInteger(u.completion_tokens)&&u.completion_tokens>=0&&u.completion_tokens<=1000);
    await tx.collection(COLLECTION).doc(requestKey).update({status:outcome,elapsedMs:clock()-at,calls,usageKnown:known,estimatedMicros:known?Math.ceil(usage.reduce((n,u)=>n+u.prompt_tokens*config.inputPrice+u.completion_tokens*config.outputPrice,0)):null,reservedMicros:reserve});
    if(actor?.token===token)await tx.collection(COLLECTION).doc(actorId).update({lockUntil:0});
   });
  }
  await fresh();
  if(cache.size>=100)cache.delete(cache.keys().next().value);
  cache.set(cacheKey,{until:clock()+120000,answer});return answer;
 }
 return {context,ask};
}
module.exports={createGuideQuestionService,SCHEMA_VERSION};
