'use strict';
const assert=require('node:assert/strict');
const S=require('../static/exploration-journey-question-state');
let count=0;
const check=(value,label)=>{assert(value,label);count++;};
const scope={resourceId:'r',pointId:'pond',objectId:'object_pond',walkFingerprint:'a'.repeat(64),localTest:true};
const source={id:'link_1',title:'本机测试材料',excerpt:'画稿显示水面。',url:'https://example.org/source',contributorName:'测试作者'};
const context=()=>({ok:true,resourceId:'r',objectId:'object_pond',title:'鹅池',fingerprint:'b'.repeat(64),ready:true,reason:'ready',introduction:'测试材料',sources:[source],simulated:true});
const answer=()=>({ok:true,outcome:'answer',resourceId:'r',objectId:'object_pond',title:'鹅池',fingerprint:'b'.repeat(64),text:'画稿显示水面。',sentences:[{text:'画稿显示水面。',sourceIds:['link_1']}],sources:[source],aiGenerated:true,simulated:true});
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function fixture(){
  const calls=[];let owner='test-reader',current=scope,ctx=context(),response=answer(),handler=null,serial=0;
  const state=S.create({identity:async()=>owner,verify:async()=>current,uuid:()=>`local_request_${++serial}`,
    call:async e=>{calls.push(structuredClone(e));if(handler)return handler(e);return structuredClone(e.action==='getSiteExplorationQuestionContext'?ctx:response);}});
  return {state,calls,setOwner:x=>owner=x,setScope:x=>current=x,setContext:x=>ctx=x,setAnswer:x=>response=x,setHandler:x=>handler=x};
}
(async()=>{
  const f=fixture(),s=f.state;
  await s.open(scope);
  check(s.snapshot().context.ready&&!s.snapshot().busy,'open validates current context');
  check(f.calls.every(x=>x.action==='getSiteExplorationQuestionContext'),'opening never sends a question');
  await s.send('画稿里有什么？');
  check(s.snapshot().result?.outcome==='answer','answer succeeds after latest context verification');
  const sent=f.calls.find(e=>e.action==='askSiteExploration');
  check(sent.objectId==='object_pond'&&sent.objectId!==scope.pointId,'request uses actual map object identity');
  check(sent.history.length===0,'no conversation history is sent');
  check(s.snapshot().context.fingerprint!==scope.walkFingerprint,'question evidence fingerprint remains separate from reading version');
  s.edit();await s.revalidate();
  check(!s.snapshot().result,'editing clears result; periodic checks do not restore an unrelated answer');
  for(const value of ['', ' '.repeat(2), '字'.repeat(401)]){
    const before=f.calls.length;await s.send(value);
    check(f.calls.length===before,'invalid input causes no request');
  }
  s.close();check(!s.snapshot().opened&&!s.snapshot().context&&!s.snapshot().result,'close clears visible state');

  const off=fixture();off.setContext({...context(),ready:false,reason:'off'});await off.state.open(scope);await off.state.send('画稿里有什么？');
  check(!off.calls.some(e=>e.action==='askSiteExploration'),'off context causes zero answer requests');
  const guest=fixture();guest.setOwner('guest');await guest.state.open(scope);
  check(guest.calls.length===0&&/登录/.test(guest.state.snapshot().status),'guest is directed to login before question flow');
  const switched=fixture();await switched.state.open(scope);switched.setOwner('another');await switched.state.send('画稿里有什么？');
  check(!switched.calls.some(e=>e.action==='askSiteExploration')&&/账号/.test(switched.state.snapshot().status),'account change invalidates before paid-capable request');

  const retry=fixture();await retry.state.open(scope);let attempt=0;
  retry.setHandler(async e=>{if(e.action==='getSiteExplorationQuestionContext')return context();if(++attempt===1)throw Error('网络暂不可用');return answer();});
  await retry.state.send('画稿里有什么？');
  check(retry.state.snapshot().retryable&&!retry.state.snapshot().result,'ambiguous network failure offers manual retry only');
  check(attempt===1,'no automatic retry on failed ask');
  await retry.state.send('画稿里有什么？');
  const attempts=retry.calls.filter(e=>e.action==='askSiteExploration');
  check(attempts[0].requestId===attempts[1].requestId,'manual retry preserves request identity');
  check(retry.state.snapshot().result?.outcome==='answer','manual retry may finish the request');

  for(const withCode of [true,false]){
    const old=fixture();await old.state.open(scope);let attempts=0;
    old.setHandler(async e=>{
      if(e.action==='getSiteExplorationQuestionContext')return context();
      if(++attempts===1)throw Object.assign(Error('这次问题已处理或正在处理，请稍后重新提问'),withCode?{code:'QA_DUPLICATE'}:{});
      return answer();
    });
    await old.state.send('画稿里有什么？');
    check(!old.state.snapshot().retryable&&old.state.snapshot().newRequestRequired,'expired answer ticket offers an explicit new request, never an endless retry');
    check(attempts===1&&/新请求/.test(old.state.snapshot().status),'a duplicate request is not automatically replaced and its consequence is stated');
    await old.state.send('画稿里有什么？');
    const requests=old.calls.filter(e=>e.action==='askSiteExploration');
    check(requests[0].requestId!==requests[1].requestId&&old.state.snapshot().result?.outcome==='answer','only the next explicit submission creates a fresh request ticket');
  }

  for(const kind of ['close','edit','scope','owner','source','unsupported']){
    const x=fixture();await x.state.open(scope);const pending=deferred(),seen=deferred();
    x.setHandler(async e=>{if(e.action==='askSiteExploration'){seen.resolve();return pending.promise;}return context();});
    const work=x.state.send('画稿里有什么？');await seen.promise;
    if(kind==='close')x.state.close();
    if(kind==='edit')x.state.edit();
    if(kind==='scope')x.setScope({...scope,objectId:'object_tower'});
    if(kind==='owner')x.setOwner('changed-reader');
    if(kind==='source')x.setHandler(async e=>e.action==='getSiteExplorationQuestionContext'?{...context(),fingerprint:'c'.repeat(64)}:answer());
    pending.resolve(kind==='unsupported'?{...answer(),sentences:[{text:'画稿显示水面。',sourceIds:['missing']}]}:answer());
    await work;check(!x.state.snapshot().result,kind+' cannot expose a stale or unsupported answer');
  }
  const concurrent=fixture();await concurrent.state.open(scope);const wait=deferred(),seen=deferred();
  concurrent.setHandler(async e=>{if(e.action==='getSiteExplorationQuestionContext')return context();seen.resolve();return wait.promise;});
  const first=concurrent.state.send('画稿里有什么？');await seen.promise;await concurrent.state.send('画稿里有什么？');
  check(concurrent.calls.filter(e=>e.action==='askSiteExploration').length===1,'double submit creates one question request');
  wait.resolve(answer());await first;

  const recheck=fixture();await recheck.state.open(scope);await recheck.state.send('画稿里有什么？');
  recheck.setContext({...context(),fingerprint:'d'.repeat(64)});await recheck.state.revalidate();
  check(!recheck.state.snapshot().result&&/更新/.test(recheck.state.snapshot().status),'question-only evidence changes clear previous answer');
  recheck.setHandler(async()=>{throw Error('无法核对来源');});await recheck.state.revalidate();
  check(!recheck.state.snapshot().context&&!recheck.state.snapshot().result,'failed periodic verification erases old evidence and answer');
  console.log('PASS journey question state: '+count+' checks; local identity/source guards, explicit requests, cancel and idempotent retry.');
})().catch(error=>{console.error(error);process.exitCode=1;});
