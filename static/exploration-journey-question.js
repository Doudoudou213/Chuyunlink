(function(root){
  'use strict';
  function create(host,hooks={}){
    const main=document.getElementById('journey-reading-main'),audio=document.getElementById('audio');
    if(!host||!main||!root.ChuJourneyQuestionData||!root.ChuJourneyQuestionState)return null;
    host.innerHTML='<button type="button" id="journey-question-entry" aria-expanded="false" aria-controls="journey-question-panel"><span>问这一景</span><span aria-hidden="true">自己写下问题 ↗</span></button>'+
      '<section id="journey-question-panel" hidden><button type="button" id="journey-question-back">← 回到原文</button>'+
      '<h3 id="journey-question-heading" tabindex="-1">自己问一句</h3><p id="journey-question-notice" class="journey-question-note"></p>'+
      '<form id="journey-question-form"><label for="journey-question-input">关于眼前这一景，你想知道什么？</label>'+
      '<textarea id="journey-question-input" maxlength="400" rows="3" placeholder="写下你的问题…" aria-describedby="journey-question-privacy journey-question-count"></textarea>'+
      '<div class="journey-question-form-foot"><span id="journey-question-count">0 / 400</span><button type="submit" id="journey-question-send" disabled>提问 ↗</button></div>'+
      '<p id="journey-question-privacy" class="journey-question-note"></p></form>'+
      '<p id="journey-question-status" role="status" aria-live="polite"></p>'+
      '<div class="journey-question-recovery"><button type="button" id="journey-question-retry" hidden>重试这次提问</button><button type="button" id="journey-question-refresh" hidden>重新核对</button><a id="journey-question-login" href="./index.html?view=profile" hidden>前往登录 ↗</a></div>'+
      '<article id="journey-question-answer" tabindex="-1" aria-label="本景回答" hidden></article>'+
      '<ol id="journey-question-sources" aria-label="回答依据" hidden></ol></section>';
    const $=id=>host.querySelector('#journey-question-'+id);
    const entry=$('entry'),panel=$('panel'),input=$('input'),status=$('status'),answer=$('answer'),sources=$('sources');
    let scope=null,shown=false,scroll=null,audioHidden=false,painted=null;
    const machine=root.ChuJourneyQuestionState.create({
      verify:hooks.verify,async identity(){
        if(root.ExplorationAdapter)return root.ExploreTransport.identity();
        // Reading supports anonymous visitors; questions deliberately do not.
        // Keep that distinction local to this feature and the server guard.
        const user=await root.GuideCloud?.identity();
        return user&&user.isAnonymous!==true&&!String(user.loginType||'').toUpperCase().includes('ANONYMOUS')
          ?String(user.uid||user.id||'guest'):'guest';
      },
      call:e=>root.ExploreTransport.call(e),uuid:()=>crypto.randomUUID()
    });
    const usable=()=>!document.hidden&&!host.hidden&&!!host.getClientRects().length&&
      (!host.closest('dialog')||(host.closest('dialog').open&&host.closest('dialog').dataset.state==='open'));
    function clearAnswer(){answer.replaceChildren();sources.replaceChildren();answer.hidden=true;sources.hidden=true;painted=null;}
    function reset({restore=false}={}){
      machine.close();clearAnswer();input.value='';$('count').textContent='0 / 400';status.textContent='';
      main.hidden=false;panel.hidden=true;entry.hidden=false;entry.setAttribute('aria-expanded','false');
      if(shown&&audio)audio.hidden=audioHidden;
      shown=false;
      if(restore&&!host.hidden&&entry.getClientRects().length){
        entry.focus({preventScroll:true});
        if(scroll?.element?.isConnected)scroll.element.scrollTop=scroll.top;
        else if(scroll)window.scrollTo({top:scroll.top,behavior:'instant'});
      }
      scroll=null;
    }
    function clear(){reset();scope=null;host.hidden=true;}
    function mount(next){clear();if(next){scope=next;host.hidden=false;}}
    function reconcile(next){
      if(JSON.stringify(scope)===JSON.stringify(next||null))return;
      const focused=host.contains(document.activeElement),dialog=host.closest('dialog');
      clear();
      if(focused)(dialog?.querySelector('h2')||document.querySelector('#reading > summary'))?.focus({preventScroll:true});
    }
    function enter(){
      if(!scope||!usable()||shown)return;
      const body=host.closest('#journey-leaf-body');scroll={element:body,top:body?body.scrollTop:window.scrollY};
      shown=true;audioHidden=audio?.hidden||false;main.hidden=true;if(audio)audio.hidden=true;
      hooks.onEnter?.();entry.hidden=true;entry.setAttribute('aria-expanded','true');panel.hidden=false;
      $('notice').textContent=scope.localTest?'本地固定响应 · 不调用真实 AI':'只依据这一景已审核、已授权的资料';
      $('privacy').textContent=scope.localTest?'仅本机演示，不上传。试问：画稿里有什么？':'点击提问会发送本景信息与问题，可能由 AI 整理。请勿填写个人信息；本页不保存问答历史。';
      if(body)body.scrollTop=0;
      $('heading').focus({preventScroll:Boolean(body)});machine.open(scope);
    }
    machine.subscribe(state=>{
      if(!state.opened){clearAnswer();return;}
      $('send').disabled=state.busy||!state.context?.ready;
      $('form').setAttribute('aria-busy',String(state.busy));
      input.readOnly=state.busy;
      $('send').textContent=state.busy?'核对中…':state.newRequestRequired?'重新提问 ↗':'提问 ↗';
      $('retry').hidden=!state.retryable||state.busy;
      $('refresh').hidden=state.busy||Boolean(state.context?.ready);
      $('login').hidden=!/登录|账号|匿名/.test(state.status);
      status.textContent=state.status;
      if(!state.result||state.result.outcome!=='answer'){clearAnswer();return;}
      if(painted===state.result)return;
      clearAnswer();painted=state.result;
      const note=document.createElement('small');
      note.className='journey-question-note';note.textContent=state.result.localTest?'以下为本地固定响应，不代表真实模型效果':'AI 依据资料整理 · 请结合出处阅读';
      answer.append(note);
      for(const sentence of state.result.sentences){const p=document.createElement('p');p.textContent=sentence.text;answer.append(p);}
      for(const source of state.result.sources){
        const li=document.createElement('li'),title=document.createElement(source.url?'a':'strong'),excerpt=document.createElement('p'),credit=document.createElement('p');
        title.textContent=source.title+(source.url?' ↗':'');
        if(source.url){title.href=source.url;title.target='_blank';title.rel='noopener noreferrer';}
        excerpt.textContent=source.excerpt;credit.textContent=source.credit;credit.className='journey-question-note';
        li.append(title,excerpt,credit);sources.append(li);
      }
      answer.hidden=false;sources.hidden=false;
      if(shown&&usable()){answer.focus({preventScroll:true});answer.scrollIntoView({block:'nearest',behavior:'instant'});}
    });
    entry.addEventListener('click',enter);
    $('back').addEventListener('click',()=>reset({restore:true}));
    $('form').addEventListener('submit',e=>{e.preventDefault();if(shown&&usable())machine.send(input.value);});
    input.addEventListener('input',()=>{
      $('count').textContent=input.value.length+' / 400';
      // Editing never sends a request or exposes an answer for the new text.
      machine.edit();
    });
    $('retry').addEventListener('click',()=>{if(shown&&usable())machine.send(input.value);});
    $('refresh').addEventListener('click',()=>{if(shown&&usable())machine.open(scope);});
    return {mount,clear,reset,reconcile,cancel:()=>machine.close(),revalidate:()=>shown?machine.revalidate():undefined};
  }
  root.ChuJourneyQuestion={create};
})(window);
