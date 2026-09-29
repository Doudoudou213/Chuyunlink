(function(){
'use strict';
let proposal=null,busy=false,epoch=0,stamp='',turns=[];
const box=()=>document.getElementById('guide-assistant');
const esc=x=>GuideApp.esc(x);
const signature=()=>{const s=GuideApp.getSession();return s?JSON.stringify([s.id,s.revision,s.status,s.minutes,s.intensity,s.interests,VisitEngine.routeKey(s),s.stops.map(x=>[x.resourceId,x.state,x.locked,x.stayMinutes])]):'empty';};
function reply(text,role='assistant'){turns.push({text,role});turns=turns.slice(-4);draw();}
function draw(){
 const host=box();if(!host)return;const open=host.querySelector('details')?.open;
 const s=GuideApp.getSession();
 host.innerHTML='<details id="guide-dialog" '+(open?'open':'')+'><summary>和向导聊聊</summary><p class="muted">基础对话模式 · 大模型尚未启用。可以帮你改行程、打开已审核讲解。</p><div role="log" aria-live="polite">'+turns.map(t=>'<p class="guide-reply '+(t.role==='user'?'is-user':'')+'">'+esc(t.text)+'</p>').join('')+'</div><form id="guide-chat-form"><label for="guide-chat-input">告诉我你的打算</label><div class="guide-row"><input id="guide-chat-input" maxlength="300" placeholder="'+(s?'例如：只剩一小时了':'例如：武汉，两小时，看建筑')+'" autocomplete="off" '+(busy?'disabled':'')+'><button class="primary" '+(busy?'disabled':'')+'>发送</button></div></form><div class="guide-row guide-quick">'+(s&&s.status!=='ended'?['少走一点','只剩一小时','跳过这一站','讲讲这里','提前结束'].map(t=>'<button type="button" data-chat="'+esc(t)+'" '+(busy?'disabled':'')+'>'+esc(t)+'</button>').join(''):'')+'</div><div id="guide-proposal">'+(proposal?'<div class="guide-card"><strong>'+esc(proposal.title)+'</strong><p>'+esc(proposal.description)+'</p><div class="guide-row"><button class="primary" data-chat-apply '+(busy?'disabled':'')+'>按这个安排</button><button data-chat-cancel '+(busy?'disabled':'')+'>先不改</button></div></div>':'')+'</div></details>';
}
function show(){const d=box()?.querySelector('details');if(d)d.open=true;}
async function propose(intent){
 if(busy)return;
 const s=GuideApp.getSession(),before=signature(),token=++epoch;
 proposal=null;busy=true;draw();show();
 try{
  if(!await GuideApp.checkIdentity())return;
  let p;
  if(intent.type==='recommend'){
   if(s&&s.status!=='ended')throw Error('已有行程正在进行。你可以说“少走一点”或调整剩余时间。');
   const catalog=await GuideApp.refreshCatalog();
   const result=VisitPlanner.recommend(catalog,intent);let route=null;
   try{route=await GuideApp.calculatePlan(result.plan);}catch(_){}
   const a=VisitEngine.assess(result.plan,route);
   p={kind:'new',plan:result.plan,title:result.plan.stops.map(x=>x.title).join(' → '),description:(a.totalMinutes===null?'交通待核实':('站间交通与停留预计 '+a.totalMinutes+' 分钟'))+'；首站出发，不含前往首站的时间。'+(a.issues.some(x=>/超出|超过/.test(x))?'目前超出时间或体力要求，建议减少站点。':'')+'参观条件请在出发前确认。'};
  }else if(intent.type==='less'||intent.type==='time'){
   if(!s)throw Error('先告诉我城市，例如“武汉，两小时”。');
   const catalog=await GuideApp.refreshCatalog();
   // Re-read the catalogue before every map request; normalize protects history.
   const result=await VisitPlanner.adjust(s,intent,p=>GuideApp.calculatePlan(VisitEngine.normalize(p,catalog,s)));
   p={kind:'edit',plan:result.plan,title:intent.type==='less'?'少安排一站':'调整剩余时间',description:(result.removed.length?'减少：'+result.removed.join('、')+'。':'站点保持不变。')+result.notice};
  }else if(intent.type==='skip'||intent.type==='end'){
   if(!s||s.status==='ended')throw Error('当前没有进行中的行程。');
   const target=s.stops.find(x=>x.state==='arrived')||s.stops.find(x=>x.state==='pending');
   if(intent.type==='skip'&&(!target||target.locked))throw Error(target?.locked?'这一站是必去点，请先在调整站点里解除必去。':'已没有需要跳过的站点。');
   p={kind:'event',event:intent.type,resourceId:target?.resourceId,title:intent.type==='end'?'现在结束这一程？':'跳过「'+target.title+'」？',description:'保留已经确认到访的记录；不会把未去的地方记为到访。'};
  }else if(intent.type==='explain'){
   if(!s)throw Error('先安排一程，再打开本站讲解。');
   await GuideApp.openCurrent();
   reply('已打开本站讲解和来源。有待核实的内容会保留提示。');return;
  }else{reply(s?'可以说“少走一点”“只剩一小时”“跳过这一站”，也可以点下方选项。历史问题请展开本站的故事与来源。':'告诉我城市和时间，例如“武汉，两小时”。也可以直接选择上面的城市。');return;}
  if(token!==epoch||before!==signature())throw Error('行程刚刚变化，请重新说一次需求。');
  proposal={...p,signature:before};reply('先看看这个安排，确认后才会修改。');
 }catch(e){reply(e.message);}finally{busy=false;draw();show();}
}
async function apply(){
 if(!proposal||busy)return;const p=proposal;let applied=false;busy=true;draw();
 try{
  if(!await GuideApp.checkIdentity())return;
  if(signature()!==p.signature)throw Error('行程已变化，请重新生成建议。');
  if(p.kind==='new')await GuideApp.startPlan(p.plan,()=>signature()===p.signature);
  if(p.kind==='edit')await GuideApp.applyPlan(p.plan,()=>signature()===p.signature);
  if(p.kind==='event')await GuideApp.event(p.event,p.resourceId);
  proposal=null;applied=true;reply('已更新。到访仍由你自己确认。');
 }catch(e){proposal=null;reply(e.message);}finally{busy=false;draw();if(applied){const d=box()?.querySelector('details');if(d)d.open=false;}else show();}
}
window.GuideConversation={
 render(){const current=signature();if(stamp!==current){stamp=current;proposal=null;draw();}else if(!box()?.children.length)draw();},
 recommend(preferences){if(busy)return;reply(preferences.city+'，'+preferences.minutes+' 分钟，帮我安排。','user');return propose({type:'recommend',...preferences});},
 invalidate(){epoch++;proposal=null;turns=[];if(box())box().textContent='';},
 reset(){epoch++;proposal=null;turns=[];draw();}
};
document.addEventListener('submit',e=>{if(e.target.id!=='guide-chat-form')return;e.preventDefault();if(busy)return;const input=document.getElementById('guide-chat-input').value;reply(input,'user');propose(VisitPlanner.parse(input,GuideApp.getCatalog(),GuideApp.getSession()));});
document.addEventListener('click',e=>{const button=e.target.closest('[data-chat],[data-chat-apply],[data-chat-cancel]');if(!button||busy)return;if(button.hasAttribute('data-chat-apply'))apply();else if(button.hasAttribute('data-chat-cancel')){proposal=null;reply('保留原来的安排。');}else {reply(button.dataset.chat,'user');propose(VisitPlanner.parse(button.dataset.chat,GuideApp.getCatalog(),GuideApp.getSession()));}});
document.addEventListener('visibilitychange',()=>{if(document.hidden){epoch++;proposal=null;}});
})();
