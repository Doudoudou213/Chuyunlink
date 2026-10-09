(function(root){
'use strict';
// Presentation-independent state. Public API is open/send/revalidate/close/subscribe.
function create(api){
 let state={open:false,resourceId:'',title:'',turns:[],busy:false,error:'',context:null},epoch=0,owner='',retry=null;
 const subscribers=new Set();
 const emit=()=>subscribers.forEach(fn=>fn({...state,turns:[...state.turns]}));
 const reset=()=>{epoch++;retry=null;state.turns=[];state.context=null;state.error='';state.busy=false;};
 async function ownerUnchanged(token=epoch){const current=await api.identity();if(token!==epoch||!state.open)return false;if(current!==owner){owner=current;reset();state.error='账号已变化，请重新打开向导';emit();throw Error(state.error);}return true;}
 async function refresh(){const token=epoch,id=state.resourceId;if(!await ownerUnchanged(token))return null;const c=await api.call({action:'getGuideQuestionContext',resourceId:id});if(token!==epoch||!state.open)return null;const changed=!state.context||state.context.fingerprint!==c.fingerprint||state.context.ready!==c.ready;if(state.context&&state.context.fingerprint!==c.fingerprint){state.turns=[];retry=null;state.error='资料已更新，旧回答已收起。';}state.context=c;state.title=c.title;if(changed)emit();return c;}
 async function open(resourceId,title){reset();state={...state,open:true,resourceId,title:title||'文化向导'};const token=epoch;state.busy=true;emit();try{const current=await api.identity();if(token!==epoch)return;owner=current;await refresh();}catch(e){if(token===epoch)state.error=e.message||'资料暂时读取不到';}finally{if(token===epoch){state.busy=false;emit();}}}
 async function send(question,{again=false}={}){
  question=String(question||'').trim();if(!question||question.length>400||state.busy||!state.open)return;
  const token=epoch;state.busy=true;state.error='';emit();
  try{
   const context=await refresh();if(!context||token!==epoch)return;
   const history=state.turns.filter(t=>t.role==='user').map(t=>t.text).slice(-3);
   if(!again)state.turns.push({role:'user',text:question});
   const request=again&&retry?retry:{action:'askGuideQuestion',resourceId:state.resourceId,question,history,requestId:crypto.randomUUID()};retry=request;
   let result;
   if(!context.ready)result={text:context.introduction?context.introduction+'\n\n即时问答暂未开启，以上为已审核资料。':'目前这个地点的资料还不足，暂时不能回答。',sources:context.sources||[],aiGenerated:false};
   else result=await api.call(request);
   if(!await ownerUnchanged(token)||token!==epoch||!state.open)return;
   const current=await refresh();if(!current||token!==epoch)return;
   if(current.fingerprint!==context.fingerprint)throw Error('资料刚刚变化，请重新提问');
   state.turns.push({role:'assistant',...result});state.turns=state.turns.slice(-12);retry=null;
  }catch(e){if(token===epoch)state.error=e.message||'暂时连接不上，请稍后重试';}
  finally{if(token===epoch){state.busy=false;emit();}}
 }
 return {open,send,async revalidate(){const token=epoch;try{return await refresh();}catch(e){if(token===epoch){reset();state.error=e.message||'暂时无法核对来源，旧回答已收起';emit();}return null;}},retry(){if(retry)return send(retry.question,{again:true});return open(state.resourceId,state.title);},close(){reset();state.open=false;emit();},subscribe(fn){subscribers.add(fn);fn(state);return()=>subscribers.delete(fn);},snapshot(){return {...state,turns:[...state.turns]};}};
}
 root.GuideQuestionState={create};
})(window);
