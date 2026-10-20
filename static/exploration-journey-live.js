(function(){
  'use strict';
  const $=id=>document.getElementById(id),C=window.ChuJourneyContent,A=window.ChuJourneyAudio;
  const resourceId=new URLSearchParams(location.search).get('resourceId')||'yellow-crane-tower';
  const shell=document.querySelector('.journey-shell'),art=$('journey-art'),stage=$('journey-stage'),canvas=$('journey-light');
  const anchors={tower:[17,41],copper:[36,46],baiyun:[54,48],pond:[48,83]};
  let data=null,record=null,generation=0,lightGeneration=0,renderer=null,ready=false,finished=false,storageOK=true;
  let drag=null,suppressedUntil=0,expiry=null,leaving=false;
  let entryPoint=new URLSearchParams(location.search).get('pointId'),feedbackBusy=false,fallbackRequest=0;
  let continuation=0,continuingClose=false,resumeAvailable=false;
  let verificationSequence=0,acceptedVerification=0;
  const storageKey='chulink:journey-content:v1:'+resourceId;
  const study=window.ChuJourneyStudy?.create($('journey-study'),{async verify(){
    if(!ready||finished||document.hidden||leaving)return false;
    const token=generation,selected=record.selected;
    await verify(token);
    return token===generation&&ready&&!finished&&!document.hidden&&!leaving&&record.selected===selected;
  }});
  const inquiry=window.ChuJourneyInquiry?.create($('journey-inquiry'),{
    revision:()=>data?.inquiryRevision,
    async verify(){
      if(!ready||finished||document.hidden||leaving)return null;
      const token=generation,selected=record.selected;
      await verify(token);
      return token===generation&&ready&&!finished&&!document.hidden&&!leaving&&record.selected===selected?data.inquiries?.[selected]||null:null;
    },
    onEnter(){study?.pause();A.pause?.();}
  });
  const navigation=window.ChuJourneyNavigation?.create({
    onLanded(){if(ready&&!document.hidden&&!leaving&&(new URLSearchParams(location.search).get('resourceId')||'yellow-crane-tower')===resourceId)rememberPosition();},
    onBack(){continuation++;A.pause?.();leaves?.close();},
    onTraverse(){continuation++;}
  });
  const leaves=window.ChuJourneyLeaves?.create({
    async beforeOpen(){
      const intent=continuation,token=generation;
      const settled=await navigation?.settled();
      return settled!==false&&intent===continuation&&token===generation&&ready&&!document.hidden&&!leaving;
    },
    async verify(id){
      if(!ready||document.hidden||leaving||(id==='trial-feedback')!==finished)return false;
      const token=generation,selected=record.selected,wasFinished=finished;
      await verify(token);
      return token===generation&&ready&&!document.hidden&&!leaving&&record.selected===selected&&finished===wasFinished;
    },
    scene(){return ready&&shell.dataset.art==='true'?current()?.artScene:null;},
    origin(){return ready&&!finished?[...$('journey-points').children].find(el=>el.dataset.artPoint===record.selected):null;},
    next(){const next=data?.points[data.points.indexOf(current())+1];return {last:!next,title:next?.title};},
    onContinue:continueReading,
    onShown(){navigation?.shown();},
    onDismissed(){if(!continuingClose)continuation++;if(document.hidden||leaving)navigation?.invalidate();else navigation?.dismissed();},
    onOpen(){hideResume();inquiry?.reset();study?.reset();A.pause?.();renderer?.pause();},
    onClosing({navigation:forNext}={}){if(!forNext)continuation++;inquiry?.cancel();study?.pause();A.pause?.();},
    onClose(){inquiry?.reset();study?.reset();A.pause?.();if(ready&&!finished&&!document.hidden&&!leaving)renderer?.resume();}
  });
  function text(id,value){$(id).textContent=value;}
  function button(label,fn,attrs={}){
    const b=document.createElement('button');b.type='button';b.textContent=label;
    for(const [key,value]of Object.entries(attrs))b.setAttribute(key,String(value));
    b.onclick=fn;return b;
  }
  function stopLight(){lightGeneration++;renderer?.destroy();renderer=null;canvas.hidden=true;}
  function quiet(){A.stop();stopLight();clearTimeout(expiry);}
  function gate(title,copy,retry=true){
    continuation++;navigation?.invalidate();
    const wasReading=leaves?.isOpen();
    leaves?.dismiss({restoreFocus:false});
    fallbackRequest++;
    if(!leaves)for(const detail of document.querySelectorAll('.journal details')){detail.open=false;detail.querySelector('summary')?.removeAttribute('aria-busy');}
    ready=false;quiet();shell.setAttribute('aria-busy','false');
    study?.clear();inquiry?.clear();
    $('content').hidden=true;$('finished').hidden=true;$('gate').hidden=false;
    hideResume();text('resume-label','');
    text('gate-title',title);text('gate-copy',copy);$('retry').hidden=!retry;
    $('explore-tools').hidden=true;$('explore-tools').removeAttribute('href');
    // Hide and erase old public content, not just its visible container.
    for(const id of ['journey-points','journey-stops','source-list','audio','souvenir-stops'])$(id).replaceChildren();
    for(const id of ['point-title','observation','reading-copy','review-date','souvenir-title','souvenir-note','souvenir-count'])text(id,'');
    if(wasReading)$('gate-title').focus({preventScroll:true});
  }
  function loadSaved(){
    try{const value=JSON.parse(localStorage.getItem(storageKey)||'{}');return value&&typeof value==='object'&&!Array.isArray(value)?value:{};}
    catch{return {};}
  }
  function persist(){
    record.updatedAt=Date.now();
    try{
      const saved=loadSaved();saved[data.fingerprint]=record;
      // Only IDs, progress, private note and explicitly saved feedback; never source text/audio URLs.
      const recent=Object.values(saved).filter(r=>r&&Date.now()-r.updatedAt<7*86400000).sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,8);
      localStorage.setItem(storageKey,JSON.stringify(Object.fromEntries(recent.map(r=>[r.fingerprint,r]))));
      storageOK=true;return true;
    }catch{storageOK=false;text('status','浏览器不允许保存，仍可阅读；关闭后拾记可能丢失。');return false;}
  }
  async function fetchContent(){
    if(!/^[\w-]{1,128}$/.test(resourceId))throw Error('景点编号无效，请从景点入口重新打开。');
    let timer;
    try{
      const result=await Promise.race([
        ExploreTransport.call({action:'getSiteExploration',resourceId}),
        new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('读取超时，请检查网络后重试。')),12000);})
      ]);
      const next=C.project(result,resourceId);
      next.inquiries=window.ChuJourneyInquiryData?.project(result,next)||null;
      next.inquiryRevision=window.ChuJourneyInquiryData?.revision(result,next)||null;
      return next;
    }finally{clearTimeout(timer);}
  }
  function armExpiry(){
    clearTimeout(expiry);
    const until=Math.min(Date.parse(data.validUntil),...data.points.filter(p=>p.audio).map(p=>Date.parse(p.audio.validUntil)));
    expiry=setTimeout(()=>{generation++;gate('资料到了复核时间','暂不展示旧讲解与音频。请重新读取当前公开版本。');},Math.max(0,until-Date.now()+10));
  }
  async function verify(token=generation){
    const request=++verificationSequence;
    try{
      const next=await fetchContent();
      if(token!==generation||leaving||document.hidden)throw Error('阅读状态已变化');
      // Concurrent reads may finish out of order. An earlier response must not
      // roll back an already accepted capability or its independent revision.
      if(request<acceptedVerification)return data;
      if(!data||next.fingerprint!==data.fingerprint)throw Error('内容已换版，请重新读取。原版拾记留在本机，不会自动计入新版。');
      acceptedVerification=request;data=next;armExpiry();inquiry?.reconcile(data.inquiries?.[record?.selected]);return next;
    }catch(error){
      if(token===generation&&!leaving&&!document.hidden&&request<acceptedVerification)return data;
      if(token===generation){generation++;gate('先停一停，核对这一卷',error.message);}throw error;
    }
  }
  async function load(acceptUpdate=false){
    const token=++generation;
    gate('正在展卷','正在读取可公开的讲解与素材；不使用旧的离线正文。',false);
    shell.setAttribute('aria-busy','true');text('status','');
    try{
      const next=await fetchContent();if(token!==generation||document.hidden||leaving)return;
      if(data&&next.fingerprint!==data.fingerprint&&!acceptUpdate)throw Error('内容已换版，请重新读取。旧版拾记保留，不自动计入新版。');
      const changed=data&&next.fingerprint!==data.fingerprint;data=next;
      // Recover this tab's explicit reading choices even when browser storage is
      // unavailable. Never carry a record into another content fingerprint.
      const saved=[record,loadSaved()[data.fingerprint]].filter(value=>C.canResume(data,value))
        .sort((a,b)=>b.updatedAt-a.updatedAt)[0],position=history.state?.__chuJourneyPosition;
      record=C.record(data,saved);ready=true;finished=false;resumeAvailable=C.canResume(data,saved);
      // A real incoming deep link wins. A reload of our own old-version address does not.
      const staleAddress=position?.resourceId===resourceId&&position.point===entryPoint&&position.fingerprint!==data.fingerprint;
      if(entryPoint&&!staleAddress&&data.points.some(p=>p.id===entryPoint)){
        record.selected=entryPoint;resumeAvailable=resumeAvailable&&saved.selected===entryPoint;
      }
      entryPoint=null;
      shell.dataset.art=String(resourceId==='yellow-crane-tower'||data.localTest);
      text('painting-title',resourceId==='yellow-crane-tower'||data.localTest?'一卷黄鹤楼':data.title);
      text('edition',data.localTest?'本地流程样例 · 非景区审定内容':'公开第 '+data.version+' 版 · 非实时导航');
      shell.setAttribute('aria-busy','false');$('gate').hidden=true;armExpiry();render();
      if(changed)text('status','已读取新版本。旧版拾记仍保留在本机，新版从头记起。');
    }catch(error){if(token===generation)gate('这份导览暂不可用',error.message);}
  }
  function current(){return data.points.find(p=>p.id===record.selected);}
  function hideResume(){resumeAvailable=false;$('journey-resume').hidden=true;}
  function rememberPosition(){
    // A selected point is a public reading address, never a visit or a content cache.
    // Replace, do not push: Back should close a leaf, not replay every selected stop.
    try{
      const url=new URL(location.href);url.searchParams.set('pointId',record.selected);
      history.replaceState({...history.state,__chuJourneyPosition:{resourceId,fingerprint:data.fingerprint,point:record.selected}},'',url);
    }catch{/* History restrictions must not block the reading flow. */}
  }
  async function light(point){
    stopLight();const token=lightGeneration,scene=point.artScene,profile=window.ChuParkGildedProfiles?.[scene];
    if(!profile||!window.ChuGildedReveal||shell.dataset.art!=='true')return;
    const world=$('journey-world'),rect=profile.sourceRect,pad=ChuGildedReveal.lightPadding;
    stage.scrollTo({left:Math.max(0,(rect.x+rect.width/2)/1919*world.clientWidth-stage.clientWidth/2),top:Math.max(0,(rect.y+rect.height/2)/820*world.clientHeight-stage.clientHeight/2),behavior:'instant'});
    try{
      await art.decode();if(token!==lightGeneration||!ready||finished||document.hidden)return;
      Object.assign(canvas.style,{left:(rect.x-pad)/1919*100+'%',top:(rect.y-pad)/820*100+'%',width:(rect.width+2*pad)/1919*100+'%',height:(rect.height+2*pad)/820*100+'%'});
      renderer=ChuGildedReveal.create({canvas,image:art,profile,mode:'light-only',quality:'compact'});canvas.hidden=false;renderer.play();if(leaves?.isOpen())renderer.pause();
    }catch{if(token===lightGeneration&&!art.naturalWidth)$('art-error').hidden=false;}
  }
  function render(){
    if(!ready)return;
    leaves?.dismiss({restoreFocus:false});
    const point=current(),index=data.points.indexOf(point);
    $('explore-tools').href='./explore.html?resourceId='+encodeURIComponent(resourceId)+'&pointId='+encodeURIComponent(point.id);$('explore-tools').hidden=false;
    $('gate').hidden=true;$('content').hidden=finished;$('finished').hidden=!finished;
    $('journey-resume').hidden=!resumeAvailable||finished;
    text('resume-label',resumeAvailable?'上次读到 · '+point.title:'');
    $('journey-points').replaceChildren();$('journey-stops').replaceChildren();
    if(finished){study?.clear();inquiry?.clear();quiet();armExpiry();souvenir();return;}
    text('position','第 '+(index+1)+' 景 / 共 '+data.points.length+' 景');
    text('point-title',point.title);text('observation',point.observation);text('reading-copy',point.reading);
    study?.mount(point,shell.dataset.art==='true');
    inquiry?.mount(data.inquiries?.[point.id]);
    text('binding-note',point.artScene?'':'这一处尚未绑定原画位置，先阅读已公开的文字。');
    $('reading').open=false;$('sources').open=false;$('source-list').replaceChildren();
    for(const source of point.sources){
      const article=document.createElement('article'),title=document.createElement('strong'),copy=document.createElement('p'),credit=document.createElement('p');
      title.textContent=source.title;copy.textContent=source.excerpt;credit.textContent=source.credit;
      article.append(title,copy,credit);
      if(source.url){const link=document.createElement('a');link.href=source.url;link.target='_blank';link.rel='noopener noreferrer';link.textContent='查看公开出处 ↗';article.append(link);}
      $('source-list').append(article);
    }
    const date=value=>new Date(value).toLocaleString('zh-CN',{hour12:false});
    text('review-date',data.localTest?'本地演示有效至：'+date(data.validUntil)+'。此期限仅控制预览，不代表正式审核、现场核对或资料授权。':'资料核对：'+date(data.checkedAt)+'；复核有效至：'+date(data.validUntil)+'。不是实时开放或客流信息。');
    for(const p of data.points){
      $('journey-stops').append(button(p.title,()=>select(p.id,'list'),{'aria-current':p.id===point.id?'step':'false','data-recorded':record.observed.includes(p.id),'data-stop':p.id}));
      if(p.artScene&&anchors[p.artScene]){
        const b=button(p.title,event=>{if(!event.detail||performance.now()>=suppressedUntil)select(p.id,'map');},{'aria-pressed':p.id===point.id,'data-art-point':p.id});
        b.className='journey-point';b.style.left=anchors[p.artScene][0]+'%';b.style.top=anchors[p.artScene][1]+'%';$('journey-points').append(b);
      }
    }
    $('previous').disabled=index===0;$('next').disabled=index===data.points.length-1;
    const recorded=record.observed.includes(point.id);
    text('observe',recorded?'已记下这一景':'记下这一景');$('observe').setAttribute('aria-pressed',String(recorded));
    const token=generation;A.mount($('audio'),point,()=>verify(token));light(point);
  }
  async function transition(fn){
    if(!ready)return;continuation++;hideResume();leaves?.dismiss({restoreFocus:false});const intent=continuation,token=++generation;A.stop();stopLight();
    try{
      const settled=await navigation?.settled();
      if(settled===false||token!==generation||intent!==continuation)return;
      await verify(token);if(token!==generation||intent!==continuation)return;
      fn();rememberPosition();text('status','');persist();render();(finished?$('finished-title'):$('point-title')).focus({preventScroll:true});return token;
    }
    catch{/* verify has already removed stale content. */}
  }
  async function continueReading(){
    if(!ready||finished||!leaves?.isOpen())return;
    const intent=++continuation,token=generation,selected=record.selected;
    const valid=()=>intent===continuation&&token===generation&&ready&&!finished&&!document.hidden&&!leaving&&record.selected===selected;
    // Keep the current close control available while the next public version is checked.
    try{await verify(token);}catch{return;}
    if(!valid())return;
    let closed=false;
    continuingClose=true;
    try{closed=await leaves.closeForNavigation();if(closed&&(await navigation?.settled())===false)closed=false;}
    finally{continuingClose=false;}
    if(!closed||!valid())return;
    const next=data.points[data.points.indexOf(current())+1];
    generation++;hideResume();A.stop();stopLight();
    if(next)record.selected=next.id;else finished=true;
    rememberPosition();text('status','');persist();render();
    (finished?$('finished-title'):$('point-title')).focus({preventScroll:true});
    if(next)await leaves.open('reading',{originElement:$('reading').querySelector('button')});
  }
  async function select(id,from){
    if(!data?.points.some(p=>p.id===id))return;
    const token=await transition(()=>{record.selected=id;});
    if(!from||token!==generation||!ready||finished)return;
    const container=from==='map'?$('journey-points'):$('journey-stops');
    const originElement=[...container.children].find(el=>(el.dataset.artPoint||el.dataset.stop)===id);
    if(leaves)await leaves.open('reading',{originElement});
    else await openFallback('reading');
  }
  async function openFallback(id){
    const detail=$(id),summary=detail.querySelector('summary');
    if(!ready||!summary||detail.closest('[hidden]'))return;
    const token=generation,request=++fallbackRequest;
    for(const item of document.querySelectorAll('.journal summary[aria-busy]'))item.removeAttribute('aria-busy');
    summary.setAttribute('aria-busy','true');A.pause?.();
    try{
      await verify(token);
      if(request===fallbackRequest&&token===generation&&ready&&!document.hidden&&!leaving&&!detail.closest('[hidden]'))detail.open=true;
    }catch{/* Verification owns the unavailable state, including this no-dialog path. */}
    finally{if(request===fallbackRequest)summary.removeAttribute('aria-busy');}
  }
  function souvenir(){
    text('souvenir-title',data.title);
    const points=data.points.filter(p=>record.observed.includes(p.id));
    text('souvenir-count','主动记下 '+points.length+' / '+data.points.length+' 处阅读观察 · 第 '+data.version+' 版');
    $('souvenir-stops').replaceChildren(...points.map(p=>{const li=document.createElement('li');li.textContent=p.title;return li;}));
    text('souvenir-note',record.note);$('note').value=record.note;
    restoreFeedback();
  }
  function restoreFeedback(){
    const value=C.feedback(record?.feedback);$('trial-form').reset();
    for(const input of $('trial-form').querySelectorAll('input[type=radio]'))input.checked=value[input.name]===input.value;
    $('trial-obstacle').value=value.obstacle;text('trial-status','');
  }
  function saveFile(value,type,name){
    const url=URL.createObjectURL(new Blob([value],{type})),link=document.createElement('a');
    link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function saveFeedback(exportFile=false){
    if(!ready||!finished||feedbackBusy)return;
    const answers=C.feedback(Object.fromEntries(new FormData($('trial-form')))),token=generation;
    feedbackBusy=true;const buttons=[...$('trial-form').querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);
    try{
      const report=C.trialReport(data,{...record,feedback:answers});
      await verify(token);if(token!==generation)return;
      record.feedback=answers;const saved=persist();
      if(exportFile)saveFile(JSON.stringify(report,null,2),'application/json;charset=utf-8','画卷试用反馈.json');
      text('trial-status',exportFile?(saved?'已导出反馈，并保存到本机。未发送给任何人。':'已导出反馈；浏览器未允许本机保存。未上传。'):(saved?'已保存到本机，尚未发送给我们。':'未能保存到本机，可改用导出文件保留。'));
    }catch(error){if(token===generation)text('trial-status',error.message);}
    finally{feedbackBusy=false;buttons.forEach(b=>b.disabled=false);}
  }
  $('trial-form').onsubmit=e=>{e.preventDefault();saveFeedback();};
  $('trial-export').onclick=()=>saveFeedback(true);
  $('trial-clear').onclick=()=>{
    if(!ready||!finished||feedbackBusy)return;
    if(!confirm('清空此版本保存在本机的体验反馈？私人游记和已下载文件不受影响。'))return;
    const before=record.feedback;record.feedback=C.feedback(null);
    if(!persist()){record.feedback=before;text('trial-status','浏览器未允许清除，已保存的反馈没有删除。');return;}
    restoreFeedback();text('trial-status','已清空本机反馈。已下载的文件需自行删除。');
  };
  $('retry').onclick=()=>load(true);$('refresh').onclick=()=>load(false);
  $('continue-journey').onclick=()=>{
    if(!ready||finished)return;hideResume();
    if(leaves)leaves.open('reading',{originElement:$('reading').querySelector('button')});else openFallback('reading');
  };
  $('previous').onclick=()=>select(data.points[Math.max(0,data.points.indexOf(current())-1)].id);
  $('next').onclick=()=>{if(!ready)return;const next=data.points[data.points.indexOf(current())+1];if(next)select(next.id);};
  $('observe').onclick=()=>transition(()=>{
    record.observed=[...new Set([...record.observed,record.selected])];
  });
  $('finish').onclick=()=>transition(()=>{finished=true;});
  $('return').onclick=()=>transition(()=>{finished=false;});
  $('note').oninput=e=>{if(!ready||!finished)return;record.note=e.target.value.slice(0,120);persist();text('souvenir-note',record.note);};
  $('download').onclick=async()=>{
    if(!ready||!finished)return;const token=generation;
    try{
      await verify(token);if(token!==generation)return;
      const titles=data.points.filter(p=>record.observed.includes(p.id)).map(p=>p.title).join('、');
      saveFile('\ufeff'+data.title+'\n第 '+data.version+' 版 · 主动阅读：'+titles+'\n\n'+record.note+'\n\n阅读拾记，不是实地到访凭证。','text/plain;charset=utf-8','我的阅读拾记.txt');
    }catch{/* gate keeps source withdrawal visible. */}
  };
  $('clear').onclick=()=>{
    if(!confirm('清除此浏览器中这个景点各版本的阅读进度、手记和体验反馈？不会删除下载文件或账号记录。'))return;
    try{localStorage.removeItem(storageKey);}catch{text('status','浏览器未允许清除，记录没有删除；可在浏览器设置中清理此站点数据。');return;}
    record=null;load(true);
  };
  if(!leaves){
    for(const id of ['reading','sources','journey-help','trial-feedback']){
      const detail=$(id),summary=detail.querySelector('summary');
      summary.addEventListener('click',event=>{
        event.preventDefault();
        if(detail.open||summary.getAttribute('aria-busy')==='true'){
          fallbackRequest++;detail.open=false;summary.removeAttribute('aria-busy');inquiry?.reset();study?.reset();A.pause?.();
        }else openFallback(id);
      });
    }
  }
  art.addEventListener('error',()=>$('art-error').hidden=false);
  art.addEventListener('journey:art-restored',()=>{
    if(!ready||finished||document.hidden||leaving)return;
    light(current());
    if($('journey-study').dataset.artState==='failed')study?.mount(current(),shell.dataset.art==='true');
  });
  stage.onpointerdown=e=>{if(e.pointerType==='touch'||e.button!==0)return;drag={id:e.pointerId,x:e.clientX,y:e.clientY,left:stage.scrollLeft,top:stage.scrollTop,moved:false};};
  stage.onpointermove=e=>{
    if(!drag||e.pointerId!==drag.id)return;const x=e.clientX-drag.x,y=e.clientY-drag.y;
    if(!drag.moved&&Math.hypot(x,y)<5)return;
    drag.moved=true;stage.setPointerCapture(e.pointerId);stage.scrollLeft=drag.left-x;stage.scrollTop=drag.top-y;e.preventDefault();
  };
  for(const name of ['pointerup','pointercancel','lostpointercapture'])stage.addEventListener(name,()=>{if(drag?.moved)suppressedUntil=performance.now()+350;drag=null;});
  stage.onkeydown=e=>{if(e.target!==stage)return;const x={ArrowLeft:-80,ArrowRight:80}[e.key];if(x){e.preventDefault();stage.scrollBy(x,0);}};
  document.addEventListener('visibilitychange',()=>{if(document.hidden){generation++;gate('暂歇，留住这一页','回到页面后会重新核对资料。',false);}else load(false);});
  addEventListener('pagehide',()=>{leaving=true;generation++;continuation++;navigation?.invalidate();leaves?.dismiss({restoreFocus:false});quiet();});
  addEventListener('pageshow',e=>{if(e.persisted){leaving=false;load(false);}});
  setInterval(()=>{if(ready&&!document.hidden&&!leaving)verify().catch(()=>{});},30000);
  load();
})();
