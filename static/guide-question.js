(function(){
'use strict';
const controller=GuideQuestionState.create(GuideQuestionTransport);
let dialog,returnFocus,timer;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function url(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:'';}catch{return '';}}
function install(){if(dialog)return;dialog=document.createElement('dialog');dialog.className='qa-dialog';dialog.setAttribute('aria-labelledby','qa-title');dialog.innerHTML='<div class="qa-shell"><header class="qa-head"><div><p class="qa-kicker">随行文化向导</p><h2 id="qa-title" class="qa-title"></h2></div><button type="button" class="qa-close" aria-label="关闭向导">×</button></header><div class="qa-body" role="log" aria-live="polite"></div><p class="qa-status" role="status"></p><form class="qa-form"><textarea class="qa-input" rows="1" maxlength="400" aria-label="问问这里的故事" placeholder="问问这里的故事……"></textarea><button type="submit" class="qa-send" aria-label="发送问题">↑</button></form></div>';document.body.append(dialog);
 dialog.querySelector('.qa-close').onclick=()=>controller.close();dialog.addEventListener('cancel',e=>{e.preventDefault();controller.close();});
 dialog.querySelector('form').onsubmit=e=>{e.preventDefault();const input=dialog.querySelector('textarea'),text=input.value;if(text.trim()){input.value='';controller.send(text);}};
 dialog.querySelector('textarea').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();dialog.querySelector('form').requestSubmit();}});
 dialog.addEventListener('click',async e=>{
  const example=e.target.closest('[data-qa-example]');if(example)controller.send(example.textContent);
  if(e.target.closest('[data-qa-retry]'))controller.retry();
  const summary=e.target.closest('.qa-sources summary');if(summary&&!summary.parentElement.open){e.preventDefault();const index=summary.closest('[data-qa-turn]').dataset.qaTurn;const current=await controller.revalidate();if(current){const node=dialog.querySelector('[data-qa-turn="'+index+'"] details');if(node)node.open=true;}}
 });
}
function render(state){
 if(!state.open){clearInterval(timer);if(dialog?.open){dialog.close();returnFocus?.focus();}return;}
 install();if(!dialog.open){returnFocus=document.activeElement;dialog.showModal();clearInterval(timer);timer=setInterval(()=>{if(!document.hidden&&!controller.snapshot().busy)controller.revalidate();},30000);}
 dialog.querySelector('.qa-title').textContent=state.title;
 const body=dialog.querySelector('.qa-body');
 body.innerHTML=(!state.turns.length?'<div class="qa-welcome"><p>你想了解这里的什么？</p><p class="qa-caption">可以问历史、建筑，也可以聊聊眼前的发现。</p><div class="qa-examples"><button data-qa-example type="button">这里有什么值得了解？</button><button data-qa-example type="button">有哪些历史记载？</button></div></div>':'')+state.turns.map((t,i)=>'<article class="qa-turn '+(t.role==='user'?'is-user':'')+'" data-qa-turn="'+i+'"><p>'+esc(t.text)+'</p>'+(t.aiGenerated?'<small class="qa-caption">AI 依据已审核资料整理</small>':'')+(t.sources?.length?'<details class="qa-sources"><summary>依据 · '+t.sources.length+' 份资料 ›</summary>'+t.sources.map(s=>'<div class="qa-source"><strong>'+esc(s.title)+'</strong><blockquote>'+esc(s.excerpt)+'</blockquote>'+(s.contributorName?'<span>'+esc(s.contributorName)+'</span>':'')+(url(s.url)?' · <a href="'+esc(url(s.url))+'" target="_blank" rel="noopener noreferrer">查看原文</a>':'')+'</div>').join('')+'</details>':'')+'</article>').join('');
 const status=dialog.querySelector('.qa-status');status.textContent=state.busy?'正在查找并核对相关资料……':state.error;
 if(state.error){const retry=document.createElement('button');retry.type='button';retry.className='qa-retry';retry.dataset.qaRetry='';retry.textContent='重试';status.append(retry);}
 dialog.querySelector('.qa-send').disabled=state.busy;dialog.querySelector('textarea').disabled=state.busy;body.querySelectorAll('[data-qa-example]').forEach(b=>b.disabled=state.busy);
 body.scrollTop=body.scrollHeight;
}
controller.subscribe(render);
window.GuideQuestion={open:(resourceId,title)=>controller.open(String(resourceId||''),title),async ask(resourceId,title,question){await controller.open(String(resourceId||''),title);if(controller.snapshot().resourceId===resourceId)return controller.send(question);},close:()=>controller.close()};
document.addEventListener('click',e=>{const entry=e.target.closest('[data-qa-resource]');if(entry){e.preventDefault();GuideQuestion.open(entry.dataset.qaResource,entry.dataset.qaTitle);}});
document.addEventListener('visibilitychange',()=>{if(document.hidden)controller.close();});
window.addEventListener('pagehide',()=>controller.close());
// Optional guide-page integration stays here; future visual work can replace this hook.
const stationHost=document.getElementById('guide-stops');
function stationEntries(){for(const box of document.querySelectorAll('[data-guide-station]')){if(box.querySelector('.qa-entry'))continue;const station=window.GuideApp?.getSession()?.stops.find(s=>s.resourceId===box.dataset.guideStation);if(!station)continue;const b=document.createElement('button');b.type='button';b.className='qa-entry';b.dataset.qaResource=station.resourceId;b.dataset.qaTitle=station.title;b.textContent='✦ 问问这里的故事';box.prepend(b);}}
if(stationHost){new MutationObserver(stationEntries).observe(stationHost,{childList:true,subtree:true});stationEntries();}
})();
