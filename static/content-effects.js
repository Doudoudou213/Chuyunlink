(function(){'use strict';
 let call=null,preferenceVersion=0;const slots=new Map();const pendingKey='chu-effect-contribution';const preference='chu-effects-disabled';
 const off=()=>{try{return localStorage.getItem(preference)==='true'||navigator.globalPrivacyControl===true;}catch(_){return true;}};
 const send=async data=>{if(off()||!call)return null;try{return await Promise.race([call(data),new Promise(r=>setTimeout(()=>r(null),1500))]);}catch(_){return null;}};
 const random=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');
 function open(slot,target){if(off()||!call||!target)return;const signature=JSON.stringify(target);if(slots.get(slot)?.signature===signature)return;close(slot);const s={nonce:random(),target,signature,seen:new Set(),preferenceVersion};s.ready=send({action:'beginContentEffect',nonce:s.nonce,target}).then(r=>r?.enabled===true);slots.set(slot,s);}
 function emit(slot,event){const s=slots.get(slot);if(!s||off()||s.seen.has(event))return;s.seen.add(event);s.ready.then(ok=>ok&&s.preferenceVersion===preferenceVersion&&send({action:'recordContentEffect',nonce:s.nonce,event})).catch(()=>{});}
 function observe(slot,target,node){if(!node||off())return;if(typeof IntersectionObserver==='undefined'){const b=node.getBoundingClientRect();if(b.top<innerHeight&&b.bottom>0&&!document.hidden)open(slot,target);return;}const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)&&!document.hidden){open(slot,target);observer.disconnect();}else if(!node.isConnected)observer.disconnect();},{threshold:0.25});observer.observe(node);}
 function close(slot){emit(slot,'close');slots.delete(slot);}
 function contribute(slot){const s=slots.get(slot);if(!s||off())return;emit(slot,'contribute_start');try{sessionStorage.setItem(pendingKey,JSON.stringify({nonce:s.nonce,target:s.target,expires:Date.now()+30*60000}));}catch(_){}}
 function clear(){try{sessionStorage.removeItem(pendingKey);}catch(_){}}
 function fields(){if(off())return {};try{const p=JSON.parse(sessionStorage.getItem(pendingKey)||'null');return p&&p.expires>Date.now()?{effectNonce:p.nonce}:{};}catch(_){return {};}}
 function reset(){preferenceVersion++;slots.clear();clear();}
 function refreshChoice(){
  const choice=document.getElementById('content-effects-choice');if(!choice)return;
  const locked=navigator.globalPrivacyControl===true,allowed=!off();
  choice.disabled=locked;
  if(choice.type==='checkbox'){
   choice.checked=allowed;choice.defaultChecked=allowed;
   const note=document.getElementById('content-effects-description');
   if(note)note.textContent='用于了解内容是否有帮助；不影响投稿审核。此设置适用于当前浏览器。'+(locked?'浏览器已开启全局隐私控制，统计保持关闭。':'');
  }else{choice.textContent=locked?'匿名内容效果统计：已由浏览器关闭':allowed?'匿名内容效果统计：允许':'匿名内容效果统计：已关闭';choice.setAttribute('aria-pressed',String(allowed));}
 }
 function changePreference(allowed){
  if(navigator.globalPrivacyControl!==true){try{localStorage.setItem(preference,String(!allowed));}catch(_){}}
  reset();refreshChoice();
 }
 function mountChoice(){
  if(document.getElementById('content-effects-choice')){refreshChoice();return;}
  const host=document.getElementById('collect-effects-preference');
  if(host){
   const label=document.createElement('label'),choice=document.createElement('input'),copy=document.createElement('span'),title=document.createElement('strong'),note=document.createElement('span');
   label.className='collect-consent-option';choice.id='content-effects-choice';choice.type='checkbox';
   choice.setAttribute('aria-describedby','content-effects-description');title.textContent='允许匿名使用统计';note.id='content-effects-description';
   choice.onchange=()=>changePreference(choice.checked);copy.append(title,note);label.append(choice,copy);host.append(label);
  }else if(!document.getElementById('view-collect')){
   const area=document.createElement('footer'),button=document.createElement('button');button.id='content-effects-choice';button.type='button';
   button.style.cssText='min-height:44px;padding:8px 16px;border:1px solid #d8c6a7;border-radius:6px;background:#fffcf5;color:#574536;margin:16px;';
   button.onclick=()=>changePreference(off());area.append(button);document.body.append(area);
  }
  refreshChoice();
 }
 function configure(fn){call=fn;const version=preferenceVersion;try{const p=JSON.parse(sessionStorage.getItem(pendingKey)||'null');if(p&&p.expires>Date.now()&&!off())send({action:'beginContentEffect',nonce:p.nonce,target:p.target}).then(r=>r?.enabled&&version===preferenceVersion&&send({action:'recordContentEffect',nonce:p.nonce,event:'contribute_start'}));else clear();}catch(_){clear();}mountChoice();}
 window.ContentEffects={configure,open,observe,emit,close,contribute,fields,clear,reset,route(s){return {kind:'route',mode:s.mode,minutes:s.minutes<=60?60:s.minutes<=120?120:s.minutes<=240?240:720,stops:s.stops.length===1?'1':s.stops.length<=4?'2-4':'5-8'};}};
 window.addEventListener('storage',event=>{if(event.key===preference||event.key===null){reset();refreshChoice();}});
 document.addEventListener('click',e=>{const a=e.target.closest('[data-effect-contribute]');if(a)contribute(a.dataset.effectContribute);const link=e.target.closest('[data-effect-explore]');if(link)emit(link.dataset.effectExplore,'explore');});
 window.addEventListener('pagehide',()=>{for(const slot of slots.keys())close(slot);});
})();
