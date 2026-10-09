'use strict';
const assert=require('node:assert/strict');
const {fixture}=require('./test-guide-question-evidence');
const {createGuideQuestionService}=require('../cloudfunctions/appCore/domains/guide-questions');
const {configFromEnv,createClient,buildRequest}=require('../cloudfunctions/appCore/lib/guide-question-client');
const {checkAnswer,checkVerification}=require('../cloudfunctions/appCore/lib/guide-question-contract');
const config={...configFromEnv({}),mode:'real',provider:'doubao',model:'local-fixed-response',apiKey:'not-a-real-key',pilotIds:['r'],budgetCny:1,inputPrice:1,outputPrice:1};
const output={outcome:'answer',sentences:[{text:'材料记录了可见的石刻。',pieceIds:['c']}]};
const verification={answersQuestion:true,checks:[{index:0,supported:true}]};
const usage={prompt_tokens:100,completion_tokens:30,total_tokens:130};
const event=(id='request_0000000001',question='这里记录了什么？')=>({resourceId:'r',question,requestId:id,history:[]});
async function main(){
 const db=await fixture();let calls=0;
 const client={async run(kind,payload){calls++;assert(!JSON.stringify(payload).includes('private-user'));return {output:kind==='answer'?output:verification,usage};}};
 const service=createGuideQuestionService({db,config,client});
 assert.equal((await service.context({resourceId:'r'})).ready,true);
 let result=await service.ask(event(),'user');assert.equal(result.outcome,'answer');assert.equal(calls,2);assert.equal(result.sources.length,1);
 assert.equal((await service.ask(event(),'user')).cached,true);assert.equal(calls,2);
 assert(!JSON.stringify(db.data().guide_question_usage).includes('这里记录了什么'));
 await db.collection('submissions').doc('s').update({aiConsentRevokedAt:'now'});
 assert.equal((await service.ask(event(),'user')).outcome,'insufficient');assert.equal(calls,2);
 for(const mode of ['off','missing-pilot','zero-budget']){const d=await fixture();const c={...config,...(mode==='off'?{mode:'off'}:mode==='missing-pilot'?{pilotIds:[]}:{budgetCny:0})};const s=createGuideQuestionService({db:d,config:c,client:{run(){throw Error('Must not call');}}});assert.notEqual((await s.ask(event(),'user')).outcome,'answer');}
 const practical=createGuideQuestionService({db:await fixture(),config,client});assert.equal((await practical.ask(event('request_practical01','今天几点开放，门票多少？'),'user')).outcome,'practical');
 for(const stage of ['answer','verify']){const d=await fixture();const s=createGuideQuestionService({db:d,config,client:{async run(kind){if(kind===stage)await d.collection('submissions').doc('s').update({aiConsentRevokedAt:'now'});return {output:kind==='answer'?output:verification,usage};}}});assert.equal((await s.ask(event(),'user')).outcome,'source');}
 const unknown=createGuideQuestionService({db:await fixture(),config,client:{async run(){return {output:{...output,sentences:[{text:'这里建于1985年。',pieceIds:['fake']} ]}};}}});assert.equal((await unknown.ask(event(),'user')).outcome,'insufficient');
 const denied=createGuideQuestionService({db:await fixture(),config,client:{async run(kind){return {output:kind==='answer'?output:{answersQuestion:false,checks:[]},usage};}}});assert.equal((await denied.ask(event(),'user')).outcome,'insufficient');
 const timeout=createGuideQuestionService({db:await fixture(),config,client:{async run(){throw Error('secret provider message');}}});assert.equal((await timeout.ask(event(),'user')).outcome,'unavailable');
 let unlock;const gate=new Promise(r=>unlock=r),parallelDb=await fixture();const slow=createGuideQuestionService({db:parallelDb,config,client:{async run(kind){await gate;return {output:kind==='answer'?output:verification,usage};}}});const first=slow.ask(event(),'user');await new Promise(r=>setImmediate(r));await assert.rejects(slow.ask(event(),'user'),{code:'QA_DUPLICATE'});await assert.rejects(slow.ask(event('request_0000000002'),'user'),{code:'QA_BUSY'});unlock();await first;
 const noFunds=createGuideQuestionService({db:await fixture(),config:{...config,budgetCny:0.0001},client});await assert.rejects(noFunds.ask(event(),'user'),{code:'QA_LIMIT'});
 assert.throws(()=>checkVerification({answersQuestion:true,checks:[{index:1,supported:true}]},output));
 const adapter=createClient(config,async(body)=>{assert.equal(body.stream,false);assert.equal(body.thinking.type,'disabled');return {choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}],usage};});assert.deepEqual((await adapter.run('answer',{})).output,output);
 const truncated=createClient(config,async()=>({choices:[{finish_reason:'length',message:{content:JSON.stringify(output)}}]}));await assert.rejects(truncated.run('answer',{}),{code:'QA_OUTPUT'});
 assert.equal(buildRequest('answer',{}, {...config,provider:'zhipu'}).response_format.type,'json_object');
 console.log('Visitor questions passed: two-pass answer, reference contract, cache revocation, off/pilot/budget gates, privacy, pre/post call revocation, verifier refusal, network fallback, duplicate and parallel admission, provider adapters. No network calls.');
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});module.exports={config,output,verification,event,usage};
