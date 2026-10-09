'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const {fixture}=require('./test-guide-question-evidence');
const {config,output,verification,event,usage}=require('./test-guide-questions');
const {createGuideQuestionService}=require('../cloudfunctions/appCore/domains/guide-questions');
const {loadEvidence}=require('../cloudfunctions/appCore/lib/guide-question-evidence');
const {checkAnswer,checkVerification}=require('../cloudfunctions/appCore/lib/guide-question-contract');
const {configFromEnv,createClient}=require('../cloudfunctions/appCore/lib/guide-question-client');
const {summarize}=require('./summarize-guide-question-run');
const rows=db=>Object.values(db.data().guide_question_usage||{}).filter(r=>r.signature);
const good={async run(kind){return {output:kind==='answer'?output:verification,usage};}};
async function main(){
 const c=await loadEvidence(await fixture(),'r');let cases=0;
 for(const raw of [null,[],{...output,tool:'publish'}, {...output,sentences:[]},{outcome:'insufficient',sentences:output.sentences},...[
  {text:'<script>bad</script>',pieceIds:['c']},{text:'官网 https://example.com',pieceIds:['c']},{text:'13812345678',pieceIds:['c']},
  {text:'发送至 a@example.com',pieceIds:['c']},{text:'私有 cloud://file',pieceIds:['c']},{text:'没有依据',pieceIds:['missing']},
  {text:'重复',pieceIds:['c','c']},{text:'超'.repeat(501),pieceIds:['c']},{text:'黄鹤楼建于公元223年。',pieceIds:['c']}
 ].map(s=>({...output,sentences:[s]}))]){assert.throws(()=>checkAnswer(raw,c));cases++;}
 for(const raw of [{answersQuestion:false,checks:[]},{answersQuestion:true,checks:[{index:0,supported:false}]},{answersQuestion:true,checks:[{index:0,supported:true,reason:'extra'}]},{answersQuestion:true,checks:[]},{answersQuestion:true,checks:[{index:0,supported:'true'}]}]){assert.throws(()=>checkVerification(raw,output));cases++;}
 for(const env of [{GUIDE_QA_PROVIDER:'unknown'},{GUIDE_QA_BUDGET_CNY:'NaN'},{GUIDE_QA_INPUT_CNY_PER_M:'-1'},{GUIDE_QA_DAILY_REQUESTS:'2000'}]){assert.throws(()=>configFromEnv(env));cases++;}
 for(const malformed of ['```json\n{}\n```','not json']){await assert.rejects(createClient(config,async()=>({choices:[{finish_reason:'stop',message:{content:malformed}}]})).run('answer',{}));cases++;}
 for(const stage of ['answer','verify']){
  const db=await fixture(),service=createGuideQuestionService({db,config,client:{async run(kind){if(kind===stage)throw Error('provider secret');return good.run(kind);}}});
  const result=await service.ask(event(),'user');assert.equal(result.outcome,'unavailable');assert(!JSON.stringify(result).includes('secret'));assert.equal(rows(db)[0].calls,stage==='answer'?1:2);assert.equal(rows(db)[0].usageKnown,false);assert.equal(rows(db)[0].estimatedMicros,null);cases++;
 }
 // Independent instances must share the cumulative cap, across accounts.
 const db=await fixture();let calls=0;const shared={async run(kind){calls++;return good.run(kind);}};
 const results=await Promise.allSettled(['a','b','c','d'].map(uid=>createGuideQuestionService({db,config:{...config,budgetCny:0.26},client:shared}).ask(event(),uid)));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,2);assert.equal(calls,4);assert(results.filter(r=>r.status==='rejected').every(r=>r.reason.code==='QA_LIMIT'));cases++;
 // Same request id cannot be changed to a different question; no new provider call.
 const svc=createGuideQuestionService({db:await fixture(),config,client:good});await svc.ask(event(),'user');await assert.rejects(svc.ask(event(undefined,'篡改后的新问题'),'user'),{code:'QA_REQUEST_CHANGED'});cases++;
 // Cache expires; model version changes never reuse the previous model's output.
 let time=Date.now(),n=0;const cacheDb=await fixture(),client={async run(kind){n++;return good.run(kind);}};
 const cached=createGuideQuestionService({db:cacheDb,config,client,clock:()=>time});await cached.ask(event(),'one');await cached.ask(event('request_cache0002'),'one');assert.equal(n,2);time+=120001;await cached.ask(event('request_cache0003'),'one');assert.equal(n,4);
 await createGuideQuestionService({db:cacheDb,config:{...config,model:'other-model'},client,clock:()=>time}).ask(event('request_cache0004'),'one');assert.equal(n,6);cases++;
 // Invalid source after verifier prevents answer, including cached projections.
 const revoke=await fixture(),sourceSvc=createGuideQuestionService({db:revoke,config,client:{async run(kind){if(kind==='verify')await revoke.collection('submissions').doc('s').update({status:'rejected'});return good.run(kind);}}});assert.equal((await sourceSvc.ask(event(),'user')).outcome,'source');cases++;
 // UI state races, identity isolation, and unreadable sources (no DOM needed).
 const sandbox={window:{},crypto:require('node:crypto')};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../static/guide-question-state.js'),'utf8'),sandbox);
 let owner='a',rejectOld;const state=sandbox.window.GuideQuestionState.create({identity:async()=>owner,call:async e=>{if(e.resourceId==='old')return new Promise((_,r)=>rejectOld=r);return {ok:true,title:e.resourceId,fingerprint:e.resourceId,ready:false,introduction:'已有介绍',sources:[]};}});
 const old=state.open('old');await new Promise(r=>setImmediate(r));await state.open('new');rejectOld(Error('过期失败'));await old;assert.equal(state.snapshot().resourceId,'new');assert.equal(state.snapshot().error,'');await state.send('介绍');assert.equal(state.snapshot().turns.length,2);owner='b';await state.revalidate();assert.equal(state.snapshot().turns.length,0);cases++;
 const summary=summarize(rows(db));assert.equal(summary[0].answerDeliveryRate,null);assert(!JSON.stringify(summary).includes('signature'));assert(!JSON.stringify(summary).includes('token'));cases++;
 console.log('Question boundaries passed: '+cases+' adversarial/config/concurrency/cache/privacy/state cases; fixed responses only.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
