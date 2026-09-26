(function(){'use strict';
 let call=null;const slots=new Map();const pendingKey='chu-effect-contribution';const preference='chu-effects-disabled';
 const off=()=>{try{return localStorage.getItem(preference)==='true'||navigator.globalPrivacyControl===true;}catch(_){return true;}};
 const send=async data=>{if(off()||!call)return null;try{return await Promise.race([call(data),new Promise(r=>setTimeout(()=>r(null),1500))]);}catch(_){return null;}};
 const random=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');
 function open(slot,target){if(off()||!call||!target)return;const signature=JSON.stringify(target);if(slots.get(slot)?.signature===signature)return;close(slot);const s={nonce:random(),target,signature,seen:new Set()};s.ready=send({action:'beginContentEffect',nonce:s.nonce,target}).then(r=>r?.enabled===true);slots.set(slot,s);}
 function emit(slot,event){const s=slots.get(slot);if(!s||off()||s.seen.has(event))return;s.seen.add(event);s.ready.then(ok=>ok&&send({action:'recordContentEffect',nonce:s.nonce,event})).catch(()=>{});}
 function observe(slot,target,node){if(!node||off())return;if(typeof IntersectionObserver==='undefined'){const b=node.getBoundingClientRect();if(b.top<innerHeight&&b.bottom>0&&!document.hidden)open(slot,target);return;}const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)&&!document.hidden){open(slot,target);observer.disconnect();}else if(!node.isConnected)observer.disconnect();},{threshold:0.25});observer.observe(node);}
 function close(slot){emit(slot,'close');slots.delete(slot);}
 function contribute(slot){const s=slots.get(slot);if(!s||off())return;emit(slot,'contribute_start');try{sessionStorage.setItem(pendingKey,JSON.stringify({nonce:s.nonce,target:s.target,expires:Date.now()+30*60000}));}catch(_){}}
 function clear(){try{sessionStorage.removeItem(pendingKey);}catch(_){}}
 function fields(){if(off())return {};try{const p=JSON.parse(sessionStorage.getItem(pendingKey)||'null');return p&&p.expires>Date.now()?{effectNonce:p.nonce}:{};}catch(_){return {};}}
 function configure(fn){call=fn;try{const p=JSON.parse(sessionStorage.getItem(pendingKey)||'null');if(p&&p.expires>Date.now()&&!off())send({action:'beginContentEffect',nonce:p.nonce,target:p.target}).then(r=>r?.enabled&&send({action:'recordContentEffect',nonce:p.nonce,event:'contribute_start'}));else clear();}catch(_){clear();}
 if(!document.getElementById('content-effects-choice')){const area=document.createElement('footer'),button=document.createElement('button');button.id='content-effects-choice';button.type='button';button.style.cssText='min-height:44px;padding:8px 16px;border:1px solid #d8c6a7;border-radius:6px;background:#fffcf5;color:#574536;margin:16px;';const label=()=>{button.textContent=off()?'匿名内容效果统计：已关闭':'匿名内容效果统计：允许';button.setAttribute('aria-pressed',String(!off()));};button.onclick=()=>{try{localStorage.setItem(preference,String(!off()));}catch(_){}slots.clear();clear();label();};label();area.append(button);document.body.append(area);}}
 window.ContentEffects={configure,open,observe,emit,close,contribute,fields,clear,reset(){slots.clear();clear();},route(s){return {kind:'route',mode:s.mode,minutes:s.minutes<=60?60:s.minutes<=120?120:s.minutes<=240?240:720,stops:s.stops.length===1?'1':s.stops.length<=4?'2-4':'5-8'};}};
 document.addEventListener('click',e=>{const a=e.target.closest('[data-effect-contribute]');if(a)contribute(a.dataset.effectContribute);});
 window.addEventListener('pagehide',()=>{for(const slot of slots.keys())close(slot);});
})();
