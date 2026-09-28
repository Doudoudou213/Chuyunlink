'use strict';
const assert=require('node:assert/strict');
const {fakeDb}=require('./lib/fake-material-db');
const {fixture,selection}=require('./test-guide-generation');
const {config}=require('./test-guide-generation-jobs');
const {prepareGuideInput}=require('../cloudfunctions/storyWorker/lib/guide-generation-evidence');
const {validateGuideResult}=require('../cloudfunctions/storyWorker/lib/guide-contract');
const {createGuideGenerationService}=require('../cloudfunctions/storyWorker/lib/guide-generation');
const {createGuideClient}=require('../cloudfunctions/storyWorker/lib/guide-client');
async function main(){
 const db=fakeDb(fixture());const input=await prepareGuideInput(db,{...selection,interest:'建筑'});
 assert.equal(input.contentPlan.effectiveInterest,'通用');
 const other=await prepareGuideInput(db,{...selection,interest:'碑刻'});assert.deepEqual(other.contentPlan.preferredClaimIds,['c']);
 const raw={outcome:'insufficient',title:'',sentences:[],observations:[],gaps:['现有资料不足以组织有依据的现场讲解']};
 let calls=0;const client=createGuideClient({config,transport:async(url,opt,body)=>{calls++;const request=JSON.parse(body);assert(request.messages[0].content.includes('不为凑一分钟'));assert(request.messages[0].content.includes('讲解者没有现场经历'));return {choices:[{message:{content:JSON.stringify(raw)}}],usage:{prompt_tokens:20,completion_tokens:10,total_tokens:30}};}});
 const gen=createGuideGenerationService({db,config,client});let r=await gen.generate(selection,'admin');
 assert.equal(r.outcome,'insufficient');assert(!r.fragmentId);assert.equal(Object.keys(db.data().guide_fragments||{}).length,0);
 r=await gen.generate(selection,'admin');assert.equal(r.cached,true);assert.equal(calls,1);
 const report=await gen.report();assert.equal(report.items[0].status,'insufficient');assert.equal(report.items[0].canRetry,false);assert.deepEqual(report.items[0].gaps,raw.gaps);
 assert.throws(()=>validateGuideResult({...raw,sentences:[{text:'夹带事实',claimIds:['c']}]},input));
 assert.throws(()=>validateGuideResult({outcome:'draft',title:'材料记录',sentences:[{text:'材料记录石刻。',claimIds:['c']}],observations:[],gaps:[]},input),{code:'GUIDE_OUTPUT_INVALID'});
 await db.collection('submissions').doc('s').update({aiAnalysisConsent:false});
 await assert.rejects(gen.generate(selection,'admin'));assert.equal(calls,1);
 const stopped=fakeDb(fixture());const during=createGuideGenerationService({db:stopped,config,client:{generate:async(i,h)=>{await h.beforeAttempt();await stopped.collection('submissions').doc('s').update({aiAnalysisConsent:false});return {output:raw};}}});
 await assert.rejects(during.generate(selection,'admin'));assert.equal(Object.values(stopped.data().ai_jobs)[0].status,'failed');
 console.log('Guide content quality passed: supported interest selection, generic fallback, explicit insufficient result/cache, no padding, strict minimum, single call and live consent.');
}
if(require.main===module)main().catch(e=>{console.error(e);process.exit(1)});
