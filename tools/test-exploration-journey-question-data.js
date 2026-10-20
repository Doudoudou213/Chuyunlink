'use strict';
// Pure local contract checks: no browser, storage, account or paid model calls.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const D=require('../static/exploration-journey-question-data');
let count=0;
const check=(condition,label)=>{assert(condition,label);count++;};
const equal=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);count++;};
const bad=(fn,label)=>{assert.throws(fn,/问答资料需要重新核对/,label);count++;};
const clone=value=>structuredClone(value);
const walkFingerprint='a'.repeat(64),qaFingerprint='b'.repeat(64);
const data={resourceId:'yellow-crane-tower',fingerprint:walkFingerprint,localTest:false,points:[{id:'tower'},{id:'pond'}]};
const raw={ok:true,available:true,walk:{resourceId:data.resourceId,fingerprint:walkFingerprint,simulated:false,
  points:[{id:'tower'},{id:'pond'}]},map:{objects:[{id:'object_tower',pointId:'tower'},{id:'object_pond',pointId:'pond'}]}};
const scope=D.binding(raw,data).tower;
const sourceA={id:'official_0123456789abcdef0123456789abcdef',title:'测试公开资料甲',excerpt:'测试用公开资料片段甲。',
  url:'https://example.com/public/source-a?id=1',contributorName:'公开来源署名'};
const sourceB={id:'evidence_link_2',title:'测试公开资料乙',excerpt:'测试用公开资料片段乙。'};
const rawContext={ok:true,resourceId:data.resourceId,objectId:'object_tower',title:'主楼',fingerprint:qaFingerprint,
  ready:true,reason:'ready',introduction:'这段服务摘要不会代替问答。',sources:[sourceA,sourceB]};
const current=D.context(rawContext,scope);
const rawAnswer={ok:true,resourceId:data.resourceId,objectId:'object_tower',title:'主楼',fingerprint:qaFingerprint,
  outcome:'answer',text:'依据甲观察这一处。\n依据乙核对这一处。',aiGenerated:true,
  sentences:[{text:'依据甲观察这一处。',sourceIds:[sourceA.id]},{text:'依据乙核对这一处。',sourceIds:[sourceB.id]}],
  sources:[sourceA,sourceB],version:['visitor-qa-v1','test-prompt','test-provider','test-model'],cached:false};

equal(Object.keys(D).sort(),['answer','binding','context'],'only three display-contract functions are public');
equal(scope,{resourceId:data.resourceId,pointId:'tower',objectId:'object_tower',walkFingerprint,localTest:false},
  'scope comes from explicit object id rather than point id');
check(Object.isFrozen(scope)&&Object.isFrozen(D.binding(raw,data)),'bindings are immutable');
const sensitive=clone(raw);sensitive.map.objects[0].ownerId='private-user';sensitive.map.privateFileId='cloud://private';
check(!JSON.stringify(D.binding(sensitive,data)).includes('private'),'bindings do not retain unneeded raw fields or identities');
for(const [label,mutate] of [
  ['unavailable',v=>{v.available=false;}],
  ['wrong resource',v=>{v.walk.resourceId='other';}],
  ['wrong walk fingerprint',v=>{v.walk.fingerprint='c'.repeat(64);}],
  ['missing object id',v=>{delete v.map.objects[0].id;}],
  ['unsafe object id',v=>{v.map.objects[0].id='bad/id';}],
  ['duplicate object id',v=>{v.map.objects[1].id=v.map.objects[0].id;}],
  ['duplicate point mapping',v=>{v.map.objects[1].pointId='tower';}],
  ['unknown object point',v=>{v.map.objects[0].pointId='absent';}],
  ['missing mapping',v=>{v.map.objects.pop();}],
  ['extra mapping',v=>{v.map.objects.push({id:'extra',pointId:'other'});}],
  ['duplicate raw point',v=>{v.walk.points[1].id='tower';}],
  ['simulated real walk',v=>{v.walk.simulated=true;}],
  ['mistyped simulation flag',v=>{v.walk.simulated='false';}],
  ['unexpected local flag',v=>{v.localTest=true;}],
  ['local capability on real walk',v=>{v.journeyQuestions={schemaVersion:1,mode:'local-fixed',resourceId:data.resourceId};}]
]){
  const value=clone(raw);mutate(value);equal(D.binding(value,data),null,'binding rejects '+label);
}
for(const invalid of [null,undefined,[],{},'walk'])equal(D.binding(invalid,data),null,'invalid raw binding fails closed');
const localData={...data,localTest:true},localRaw=clone(raw);localRaw.localTest=true;localRaw.walk.simulated=true;
equal(D.binding(localRaw,localData),null,'old local workflows without explicit capability cannot enable questions');
localRaw.journeyQuestions={schemaVersion:1,mode:'local-fixed',resourceId:data.resourceId};
const localScope=D.binding(localRaw,localData).tower;
check(localScope.localTest,'explicit local-fixed capability enables a marked local scope');
for(const change of [{schemaVersion:2},{mode:'real'},{resourceId:'other'},{extra:true}]){
  const value=clone(localRaw);Object.assign(value.journeyQuestions,change);
  equal(D.binding(value,localData),null,'local capability must match exact contract '+JSON.stringify(change));
}
const localMissing=clone(localRaw);delete localMissing.localTest;
equal(D.binding(localMissing,localData),null,'capability alone cannot turn a response into a local test');
const duplicateData=clone(data);duplicateData.points[1].id='tower';
equal(D.binding(raw,duplicateData),null,'ambiguous projected points are rejected too');

equal(current.sources,[{id:sourceA.id,title:sourceA.title,excerpt:sourceA.excerpt,url:sourceA.url,credit:sourceA.contributorName},
  {id:sourceB.id,title:sourceB.title,excerpt:sourceB.excerpt,url:'',credit:''}],'context preserves source ids, public fields and optional link absence');
check(!('introduction' in current)&&!('ok' in current),'presentation context excludes unneeded service prose and flags');
check(Object.isFrozen(current)&&Object.isFrozen(current.sources)&&Object.isFrozen(current.sources[0]),'context and sources are immutable');
check(current.fingerprint!==scope.walkFingerprint,'QA evidence fingerprint remains distinct from walk version fingerprint');
assert.throws(()=>{current.sources[0].title='mutated';},TypeError);count++;
for(const [label,mutate] of [
  ['wrong resource',v=>{v.resourceId='other';}],
  ['point id used as object id',v=>{v.objectId='tower';}],
  ['failed response',v=>{v.ok=false;}],
  ['missing fingerprint',v=>{delete v.fingerprint;}],
  ['short fingerprint',v=>{v.fingerprint='abc';}],
  ['non-hex fingerprint',v=>{v.fingerprint='z'.repeat(64);}],
  ['ready is a string',v=>{v.ready='true';}],
  ['mismatched reason',v=>{v.reason='off';}],
  ['unknown reason',v=>{v.reason='published';}],
  ['ready without evidence',v=>{v.sources=[];}],
  ['duplicate source id',v=>{v.sources.push(clone(v.sources[0]));}],
  ['missing source id',v=>{delete v.sources[0].id;}],
  ['missing source title',v=>{delete v.sources[0].title;}],
  ['private field on source',v=>{v.sources[0].uid='private-user';}],
  ['private field on context',v=>{v.uid='private-user';}],
  ['conflicting attribution',v=>{v.sources[0].credit='Different';}],
  ['oversized title',v=>{v.title='长'.repeat(201);}],
  ['oversized excerpt',v=>{v.sources[0].excerpt='长'.repeat(8001);}],
  ['oversized aggregate',v=>{v.sources=Array.from({length:8},(_,i)=>({...sourceA,id:'source_'+i,excerpt:'字'.repeat(6000)}));}],
  ['control character',v=>{v.sources[0].title='标题\u0000';}],
  ['simulation on real scope',v=>{v.simulated=true;}],
  ['false simulation field on real scope',v=>{v.simulated=false;}]
]){
  const value=clone(rawContext);mutate(value);bad(()=>D.context(value,scope),'context rejects '+label);
}
for(const url of [
  'http://example.com/source','javascript:alert(1)','data:text/html,hello','cloud://private/file',
  'https://user:password@example.com/source','https://example.com/source?token=private',
  'https://example.com/source?api_key=private','https://example.com/source?X-Amz-Signature=private',
  'https://example.com/source?q-sign-algorithm=sha1','https://example.com/source#token=private',
  'https://example.com/source?redirect=%23access_token%3Dprivate','https://example.com/source?fileID=private',
  'https://localhost/source','https://127.0.0.1/source','https://10.0.0.1/source','https://192.168.1.2/source',
  'https://172.20.0.1/source','https://[::1]/source','https://[::ffff:127.0.0.1]/source',
  ' https://example.com/source','https://example.com/source\n'
]){
  const value=clone(rawContext);value.sources[0].url=url;
  bad(()=>D.context(value,scope),'private/unsafe source URL is refused');
}
const noUrl=clone(rawContext);noUrl.sources[0].url=null;
equal(D.context(noUrl,scope).sources[0].url,'','explicit absent URL becomes non-link text');
const credited=clone(rawContext);credited.sources[0].credit=credited.sources[0].contributorName;
equal(D.context(credited,scope).sources[0].credit,sourceA.contributorName,'matching credit aliases are accepted');
for(const reason of ['off','insufficient']){
  const value={...clone(rawContext),ready:false,reason,sources:[]};
  equal(D.context(value,scope).reason,reason,'non-ready context is a safe explicit state');
}
const localContext=D.context({...clone(rawContext),simulated:true},localScope);
check(localContext.localTest,'local context remains explicitly simulated');
bad(()=>D.context(rawContext,localScope),'local context must affirm simulation');
for(const invalid of [null,undefined,[],{},'context'])bad(()=>D.context(invalid,scope),'unknown context structure is rejected');
bad(()=>D.context(rawContext,{...scope,uid:'private-user'}),'scope cannot retain an identity');

const result=D.answer(rawAnswer,current,scope);
equal(result.text,rawAnswer.text,'validated answer preserves exact server sentence text');
equal(result.sources,current.sources,'validated answer exposes only matched public evidence');
check(result.aiGenerated&&!result.localTest,'answer stays clearly machine-generated and non-simulated');
check(!('version' in result)&&!('cached' in result)&&!('title' in result),'answer drops unused service metadata');
check(Object.isFrozen(result)&&Object.isFrozen(result.sentences)&&Object.isFrozen(result.sentences[0].sourceIds),'answer is deeply immutable');
const reversed=clone(rawAnswer);reversed.sources.reverse();
equal(D.answer(reversed,current,scope).sources,current.sources,'evidence order uses the verified context rather than arbitrary response order');
const onlyA=clone(rawAnswer);onlyA.sentences=[onlyA.sentences[0]];onlyA.text=onlyA.sentences[0].text;onlyA.sources=[onlyA.sources[0]];
equal(D.answer(onlyA,current,scope).sources,[current.sources[0]],'unused context sources are not carried into an answer');
for(const [label,mutate] of [
  ['wrong resource',v=>{v.resourceId='other';}],
  ['wrong object',v=>{v.objectId='object_pond';}],
  ['point substituted for object',v=>{v.objectId='tower';}],
  ['walk fingerprint substituted for evidence',v=>{v.fingerprint=walkFingerprint;}],
  ['new evidence fingerprint',v=>{v.fingerprint='c'.repeat(64);}],
  ['failed envelope',v=>{v.ok=false;}],
  ['unknown outcome',v=>{v.outcome='success';}],
  ['unmarked generated text',v=>{v.aiGenerated=false;}],
  ['missing sentences',v=>{v.sentences=[];}],
  ['too many sentences',v=>{v.sentences=Array.from({length:7},()=>clone(v.sentences[0]));}],
  ['unjoined text',v=>{v.text='不匹配的拼接正文';}],
  ['missing citation',v=>{v.sentences[0].sourceIds=[];}],
  ['unknown citation',v=>{v.sentences[0].sourceIds=['not-in-context'];}],
  ['duplicate citation',v=>{v.sentences[0].sourceIds.push(v.sentences[0].sourceIds[0]);}],
  ['extra sentence field',v=>{v.sentences[0].pieceIds=['internal-claim'];}],
  ['duplicate returned source',v=>{v.sources.push(clone(v.sources[0]));}],
  ['missing returned source',v=>{v.sources.pop();}],
  ['replaced source title',v=>{v.sources[0].title='另一个标题';}],
  ['replaced source excerpt',v=>{v.sources[0].excerpt='另一个片段';}],
  ['replaced source URL',v=>{v.sources[0].url='https://example.com/other';}],
  ['replaced attribution',v=>{v.sources[0].contributorName='另一个署名';}],
  ['private source URL',v=>{v.sources[0].url+='&token=private';}],
  ['identity in answer',v=>{v.uid='private-user';}],
  ['extra source identity',v=>{v.sources[0].ownerId='private-user';}],
  ['overlong sentence',v=>{v.sentences[0].text='字'.repeat(501);v.text=v.sentences.map(s=>s.text).join('\n');}],
  ['overlong joined sentences',v=>{v.sentences.forEach(s=>{s.text='字'.repeat(251);});v.text=v.sentences.map(s=>s.text).join('\n');}],
  ['simulation on real answer',v=>{v.simulated=true;}],
  ['mistyped cache flag',v=>{v.cached='yes';}],
  ['object-valued provider metadata',v=>{v.version=[{key:'private'}];}]
]){
  const value=clone(rawAnswer);mutate(value);bad(()=>D.answer(value,current,scope),'answer rejects '+label);
}
const unused=clone(onlyA);unused.sources.push(sourceB);
bad(()=>D.answer(unused,current,scope),'answer cannot attach a source not cited by any sentence');
const forgedContext={...current,objectId:'object_pond'};
bad(()=>D.answer(rawAnswer,forgedContext,scope),'a caller cannot reuse another object context');
const offContext=D.context({...clone(rawContext),ready:false,reason:'off'},scope);
bad(()=>D.answer(rawAnswer,offContext,scope),'an off context cannot display generated prose');
const localAnswer=D.answer({...clone(rawAnswer),simulated:true},localContext,localScope);
check(localAnswer.localTest&&localAnswer.aiGenerated,'local fixed response is separately marked as local');
bad(()=>D.answer(rawAnswer,localContext,localScope),'local answer must affirm simulation');

for(const outcome of ['off','insufficient','practical','limited','unavailable','source']){
  const value={...clone(rawAnswer),outcome,text:'伪造正文，不能显示',aiGenerated:true};
  const clean=D.answer(value,current,scope);
  check(clean.text&&!clean.text.includes('伪造'),'error outcome uses a fixed user message '+outcome);
  equal(clean.sentences,[],'error outcome strips pseudo sentences '+outcome);
  equal(clean.sources,[],'error outcome strips pseudo evidence '+outcome);
  equal(clean.aiGenerated,false,'error outcome does not impersonate an answer '+outcome);
}
const literal=clone(onlyA);literal.sentences[0].text='<img src=x onerror=alert(1)> 仅作为文字';
literal.text=literal.sentences[0].text;
equal(D.answer(literal,current,scope).text,literal.text,'untrusted prose is returned as literal text, never evaluated or interpreted as HTML');
const before=JSON.stringify({rawContext,rawAnswer,raw,data});
D.binding(raw,data);D.context(rawContext,scope);D.answer(rawAnswer,current,scope);
equal(JSON.stringify({rawContext,rawAnswer,raw,data}),before,'validation does not mutate transport responses');
const cyclic=clone(rawContext);cyclic.sources.push(cyclic);
bad(()=>D.context(cyclic,scope),'cyclic/abnormal values produce a safe user-facing error');
for(const invalid of [null,undefined,[],{},'answer'])bad(()=>D.answer(invalid,current,scope),'unknown answer structure is rejected');

const browser={URL};browser.globalThis=browser;
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../static/exploration-journey-question-data.js'),'utf8'),browser);
check(typeof browser.ChuJourneyQuestionData?.binding==='function'&&typeof browser.ChuJourneyQuestionData?.context==='function'&&
  typeof browser.ChuJourneyQuestionData?.answer==='function','UMD exposes the same three browser methods without a DOM');
check(!('localStorage' in browser)&&!('document' in browser),'pure browser module does not need storage, DOM or an account');
console.log('PASS journey question data: '+count+' checks; explicit object scope, local capability, public evidence, exact response grounding, safe error states and immutable UMD contracts.');
