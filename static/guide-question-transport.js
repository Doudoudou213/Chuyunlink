(function(){
'use strict';
window.GuideQuestionTransport={
 async identity(){if(window.ChuGuideQuestionIdentity)return window.ChuGuideQuestionIdentity();const u=await window.GuideCloud?.identity();return String(u?.uid||u?.id||'guest');},
 async call(payload){
  if(!['getGuideQuestionContext','askGuideQuestion'].includes(payload.action))throw Error('不支持的向导请求');
  const call=window.ChuGuideQuestionApi || (window.GuideCloud&&((e)=>GuideCloud.call(e)));
  if(!call)throw Error('向导正在连接，请稍后再试');
  let timer;
  try {const result=await Promise.race([call(payload),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('等待较久，请稍后重试；不会自动重复请求')),45000);})]);if(!result?.ok)throw Error(result?.error?.message||'向导暂时无法回答');return result;} finally{clearTimeout(timer);}
 }
};
})();
