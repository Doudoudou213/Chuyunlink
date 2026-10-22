(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory(require('./exploration-journey-question-data'));
  else root.ChuJourneyQuestionState=factory(root.ChuJourneyQuestionData);
})(globalThis,function(D){
  'use strict';
  function create(api){
    let epoch=0,scope=null,owner='',memo=null,refreshSequence=0,acceptedRefresh=0;
    let state={opened:false,busy:false,context:null,result:null,status:'',retryable:false,newRequestRequired:false};
    const listeners=new Set(),snapshot=()=>({...state});
    const emit=()=>listeners.forEach(fn=>fn(snapshot()));
    const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
    const valid=token=>token===epoch&&state.opened;
    async function bounded(promise,ms=12000){
      let timer;
      try{return await Promise.race([promise,new Promise((_,reject)=>{
        timer=setTimeout(()=>reject(Error('连接超时，请检查网络后手动重试。')),ms);
      })]);}finally{clearTimeout(timer);}
    }
    function close(){
      epoch++;scope=null;owner='';state={opened:false,busy:false,context:null,result:null,status:'',retryable:false,newRequestRequired:false};emit();
      // A single failed request ticket stays in tab memory for idempotent retry.
      // No question/answer history is written to browser storage.
    }
    async function identity(token){
      const who=await bounded(api.identity());
      if(!valid(token))return false;
      if(!who||who==='guest')throw Error('请先登录账号，再回来提问。');
      if(owner&&who!==owner){
        memo=null;state.context=null;state.result=null;
        throw Error('账号已变化，请返回原文后重新打开问景。');
      }
      owner=who;return true;
    }
    async function refresh(token){
      const sequence=++refreshSequence;
      const current=await bounded(api.verify());
      if(!valid(token))return null;
      if(!current||!same(current,scope))throw Error('景物或资料已变化，请返回原文重新打开。');
      if(!await identity(token))return null;
      const raw=await bounded(api.call({action:'getSiteExplorationQuestionContext',resourceId:scope.resourceId,objectId:scope.objectId}));
      if(!valid(token)||!await identity(token))return null;
      if(sequence<acceptedRefresh)return state.context;
      const context=D.context(raw,scope);
      acceptedRefresh=sequence;
      const previous=state.context;
      if(previous&&(previous.fingerprint!==context.fingerprint||previous.ready!==context.ready||!same(previous.sources,context.sources))){
        state.result=null;memo=null;state.retryable=false;state.newRequestRequired=false;state.status='资料已更新，请重新提问。';
      }
      state.context=context;return context;
    }
    async function open(next){
      close();scope=next;state.opened=true;state.busy=true;state.status='正在核对本景资料……';
      const token=epoch;emit();
      try{
        const context=await refresh(token);if(!context||!valid(token))return;
        state.status=context.ready?'':context.reason==='insufficient'?'本景资料还不足，请先阅读原文与出处。':'即时问答暂未开放，原文仍可阅读。';
      }catch(error){if(valid(token)){state.context=null;state.result=null;state.status=error.message||'资料暂不可用，请重新核对。';}}
      finally{if(valid(token)){state.busy=false;emit();}}
    }
    async function send(value){
      if(!state.opened||state.busy)return;
      const question=typeof value==='string'?value.trim():'';
      if(!question||question.length>400){state.status='请写下一个400字以内的问题。';emit();return;}
      const token=++epoch,shownContext=state.context;
      state.busy=true;state.result=null;state.retryable=false;state.newRequestRequired=false;state.status='正在核对资料……';emit();
      let sent=false;
      try{
        const context=await refresh(token);if(!context||!valid(token))return;
        if(!context.ready){state.status=context.reason==='insufficient'?'本景资料不足，暂不猜测。':'即时问答暂未开放，原文仍可阅读。';return;}
        if(!shownContext||shownContext.fingerprint!==context.fingerprint||!same(shownContext.sources,context.sources)){
          state.status='资料已更新，请确认问题后再提问。';return;
        }
        const key=JSON.stringify([owner,scope,context.fingerprint,question]);
        if(memo?.key!==key)memo={key,request:{action:'askSiteExploration',resourceId:scope.resourceId,objectId:scope.objectId,question,requestId:api.uuid(),history:[]}};
        state.status=scope.localTest?'正在运行本地固定响应……':'正在查阅这一景的资料……';emit();sent=true;
        const raw=await bounded(api.call(memo.request),60000);
        if(!valid(token)||!await identity(token))return;
        const current=await refresh(token);if(!current||!valid(token))return;
        if(!current.ready||current.fingerprint!==context.fingerprint||!same(current.sources,context.sources)){
          state.status='资料刚刚变化，旧回答已收起，请重新提问。';memo=null;return;
        }
        state.result=D.answer(raw,current,scope);state.status=state.result.outcome==='answer'?'':state.result.text;
        memo=null;
      }catch(error){
        if(valid(token)){
          state.result=null;state.status=error.message||'暂时连接不上，请手动重试。';
          const duplicate=error.code==='QA_DUPLICATE'||/^(这次问题已处理或正在处理，请稍后重新提问|问题已提交，请稍后重新提问)$/.test(state.status);
          if(duplicate){
            // An old ticket may outlive the short answer cache. Do not loop on
            // it or automatically create a second potentially charged request.
            memo=null;state.newRequestRequired=true;
            state.status='这次提问已提交，暂时无法取回答复。可稍后再问；点击“重新提问”会发起一次新请求。';
          }
          const terminal=['QA_DISPLAY_CONTRACT','QA_INPUT','QA_LIMIT','QA_SOURCE','QA_REQUEST_CHANGED','STABLE_ACCOUNT_REQUIRED','UNAUTHENTICATED'].includes(error.code)||
            /账号|登录|变化|匹配|来源|回答格式|答复格式|额度|400字/.test(state.status);
          state.retryable=!duplicate&&!terminal&&sent&&!!memo&&!!state.context?.ready;
        }
      }finally{if(valid(token)){state.busy=false;emit();}}
    }
    async function revalidate(){
      if(!state.opened||state.busy)return;
      const token=epoch;
      try{await refresh(token);}
      catch(error){if(valid(token)){state.result=null;state.context=null;state.retryable=false;memo=null;state.status=error.message||'暂时无法核对，回答已收起。';}}
      if(valid(token))emit();
    }
    function edit(){
      if(state.busy){epoch++;state.busy=false;}
      state.result=null;state.status='';state.retryable=false;state.newRequestRequired=false;emit();
    }
    return {open,send,revalidate,close,edit,snapshot,subscribe(fn){listeners.add(fn);fn(snapshot());return()=>listeners.delete(fn);}};
  }
  return {create};
});
