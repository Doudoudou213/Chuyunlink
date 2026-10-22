'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../static/explore-transport.js'),'utf8');
const sdkURL='https://static.cloudbase.net/cloudbase-js-sdk/2.28.6/cloudbase.full.js';
let checks=0;
function check(value,message){assert(value,message);checks++;}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function harness(options={}){
  let clock=0,nextTimer=0;
  const timers=new Map(),scripts=[],calls=[],identities=[...(options.identities||[])];
  const window={};
  if(options.sdk)window.cloudbase={};
  if(options.adapter)window.ExplorationAdapter=options.adapter;
  const context={
    window,URLSearchParams,location:{search:options.search||''},
    setTimeout(fn,delay){const id=++nextTimer;timers.set(id,{fn,at:clock+delay});return id;},
    clearTimeout(id){timers.delete(id);},
    document:{
      createElement(tag){
        assert.equal(tag,'script');
        return {removed:false,remove(){this.removed=true;}};
      },
      head:{append(script){
        scripts.push(script);
        if(options.appendError)throw Error('append blocked');
      }}
    },
    GuideCloud:{
      async identity(){return identities.length?identities.shift():null;},
      async call(data){
        calls.push(data);
        if(options.callError)throw options.callError;
        return options.result||{ok:true};
      }
    }
  };
  vm.runInNewContext(source,context,{filename:'explore-transport.js'});
  return {
    window,scripts,calls,timers,api:window.ExploreTransport,
    async tick(ms){
      clock+=ms;
      for(const [id,timer] of [...timers])if(timer.at<=clock){timers.delete(id);timer.fn();}
      await flush();
    },
    loaded(index=0){window.cloudbase={};scripts[index].onload();},
    pendingCount(){return scripts.filter(script=>!script.removed).length;}
  };
}
function observe(promise){
  const state={status:'pending'};
  state.done=promise.then(value=>{state.status='fulfilled';state.value=value;},
    error=>{state.status='rejected';state.error=error;});
  return state;
}
(async()=>{
  {
    const inputs=[],adapter={identity:async()=> 'local-preview',call:async data=>{inputs.push(data);return {local:true};}};
    const h=harness({adapter}),payload={action:'getSiteExploration',resourceId:'test'};
    check(await h.api.identity()==='local-preview','local adapter identity stays first');
    check((await h.api.call(payload)).local,'local adapter call stays first');
    check(inputs[0]===payload,'adapter receives original payload');
    check(h.scripts.length===0&&h.timers.size===0,'adapter does not load SDK or create timers');
  }
  {
    const result={ok:true,value:7},h=harness({sdk:true,result,identities:[{uid:'test-user'}]});
    const payload={action:'unchanged'};
    check(await h.api.call(payload)===result,'existing SDK returns original business result');
    check(h.calls[0]===payload,'business payload is not rewritten');
    check(await h.api.identity()==='test-user','existing identity unchanged');
    check(h.scripts.length===0&&h.timers.size===0,'existing SDK is not loaded again');
  }
  {
    const h=harness({identities:[{uid:'test-user'}]});
    const a=observe(h.api.call({action:'one'})),b=observe(h.api.call({action:'two'})),c=observe(h.api.identity());
    check(h.scripts.length===1,'concurrent callers share one SDK attempt');
    check(h.scripts[0].src===sdkURL,'SDK version and URL remain unchanged');
    check(h.timers.size===1,'one bounded timer per attempt');
    await h.tick(7999);
    check(a.status==='pending'&&b.status==='pending'&&c.status==='pending','does not time out before eight seconds');
    h.loaded();await flush();
    check(a.status==='fulfilled'&&b.status==='fulfilled'&&c.status==='fulfilled','shared SDK success releases every caller');
    check(c.value==='test-user'&&h.calls.length===2,'identity and calls retain separate behavior');
    check(h.timers.size===0&&h.scripts[0].onload===null&&h.scripts[0].onerror===null,'success clears load listeners and timer');
    await h.tick(1);
    check(a.status==='fulfilled','old deadline cannot reject successful load');
    await h.api.call({action:'three'});
    check(h.scripts.length===1,'successful connection reused');
  }
  {
    const h=harness(),first=observe(h.api.call({action:'first'})),peer=observe(h.api.call({action:'peer'}));
    const oldLoad=h.scripts[0].onload,oldError=h.scripts[0].onerror;
    await h.tick(8000);
    check(first.status==='rejected'&&peer.status==='rejected','timeout rejects all callers');
    check(first.error.message.includes('超时'),'timeout explains retryable connection failure');
    check(h.scripts[0].removed&&h.scripts[0].onload===null&&h.scripts[0].onerror===null,'timeout removes only owned failed script and listeners');
    check(h.timers.size===0&&h.calls.length===0,'timeout leaves no timer or business call');
    const retry=observe(h.api.call({action:'retry'}));
    check(h.scripts.length===2&&h.pendingCount()===1,'retry starts a fresh single attempt');
    oldError();oldLoad();await flush();
    const joined=observe(h.api.call({action:'joined'}));
    check(h.scripts.length===2&&retry.status==='pending'&&joined.status==='pending','late old callbacks neither settle nor clear new attempt');
    h.loaded(1);await flush();
    check(retry.status==='fulfilled'&&joined.status==='fulfilled','retry succeeds after pending SDK timeout');
    check(h.calls.length===2,'failed calls are not silently replayed');
    check(h.timers.size===0,'retry success clears its timer');
  }
  {
    const h=harness(),first=observe(h.api.call({action:'first'}));
    h.scripts[0].onerror();await flush();
    check(first.status==='rejected'&&first.error.message.includes('网络'),'load error is actionable');
    check(h.scripts[0].removed&&h.timers.size===0,'load error cleans script and timer');
    const retry=observe(h.api.call({action:'retry'}));
    check(h.scripts.length===2,'network error releases cached connection');
    h.loaded(1);await flush();
    check(retry.status==='fulfilled','retry after network error succeeds');
  }
  {
    const h=harness(),first=observe(h.api.call({action:'first'}));
    h.scripts[0].onload();await flush();
    check(first.status==='rejected'&&first.error.message.includes('组件'),'loaded script without SDK global fails clearly');
    check(h.scripts[0].removed&&h.timers.size===0,'missing global cleans failed load');
    const retry=observe(h.api.call({action:'retry'}));
    h.loaded(1);await flush();
    check(retry.status==='fulfilled','missing global does not lock future attempts');
  }
  {
    const h=harness({appendError:true}),first=observe(h.api.call({action:'first'}));
    await flush();
    check(first.status==='rejected'&&first.error.message==='append blocked','synchronous DOM failure propagates');
    check(h.scripts[0].removed&&h.timers.size===0,'synchronous failure cleans own resources');
    const retry=observe(h.api.call({action:'retry'}));await flush();
    check(retry.status==='rejected'&&h.scripts.length===2,'synchronous failure releases connection');
  }
  {
    const h=harness({sdk:true,identities:[null,{uid:'anonymous-test'}],search:'?resourceId=example-point'});
    check(await h.api.identity()==='anonymous-test','identity initializes through existing GuideCloud path');
    check(h.calls[0].action==='getSiteWalk'&&h.calls[0].resourceId==='example-point','identity bootstrap action and resource unchanged');
    const guest=harness({sdk:true});
    check(await guest.api.identity()==='guest','guest fallback unchanged');
    check(guest.calls[0].resourceId==='yellow-crane-tower','default resource unchanged');
  }
  {
    const error=Error('business denied'),h=harness({sdk:true,callError:error});
    await assert.rejects(h.api.call({action:'denied'}),e=>e===error);checks++;
    check(h.scripts.length===0&&h.timers.size===0,'business failure does not trigger SDK reload');
  }
  {
    const h=harness(),first=observe(h.api.call({action:'pending'}));
    h.window.ExplorationAdapter={identity:async()=> 'preview',call:async()=>({preview:true})};
    check((await h.api.call({action:'preview'})).preview,'later adapter remains preferred over pending SDK');
    check(await h.api.identity()==='preview','later adapter identity remains preferred');
    await h.tick(8000);
    check(first.status==='rejected','old pending request still settles independently');
    check((await h.api.call({action:'preview'})).preview&&h.scripts.length===1,'timeout cannot remove later adapter');
  }
  console.log('PASS explore transport: '+checks+' checks; SDK timeout/retry/cleanup/concurrency, adapter priority and unchanged business/identity contracts. No network or cloud calls.');
})().catch(error=>{console.error(error);process.exitCode=1;});
