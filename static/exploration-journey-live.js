(function(){
  'use strict';
  const $=id=>document.getElementById(id),C=window.ChuJourneyContent,A=window.ChuJourneyAudio;
  const resourceId=new URLSearchParams(location.search).get('resourceId')||'yellow-crane-tower';
  const shell=document.querySelector('.journey-shell'),art=$('journey-art'),stage=$('journey-stage'),canvas=$('journey-light');
  const anchors={tower:[17,41],copper:[36,46],baiyun:[54,48],pond:[48,83]};
  let data=null,record=null,generation=0,lightGeneration=0,renderer=null,ready=false,finished=false,storageOK=true;
  let drag=null,suppressedUntil=0,expiry=null,leaving=false;
  const storageKey='chulink:journey-content:v1:'+resourceId;
  function text(id,value){$(id).textContent=value;}
  function button(label,fn,attrs={}){
    const b=document.createElement('button');b.type='button';b.textContent=label;
    for(const [key,value]of Object.entries(attrs))b.setAttribute(key,String(value));
    b.onclick=fn;return b;
  }
  function stopLight(){lightGeneration++;renderer?.destroy();renderer=null;canvas.hidden=true;}
  function quiet(){A.stop();stopLight();clearTimeout(expiry);}
  function gate(title,copy,retry=true){
    ready=false;quiet();shell.setAttribute('aria-busy','false');
    $('content').hidden=true;$('finished').hidden=true;$('gate').hidden=false;
    text('gate-title',title);text('gate-copy',copy);$('retry').hidden=!retry;
    // Hide and erase old public content, not just its visible container.
    for(const id of ['journey-points','journey-stops','source-list','audio','souvenir-stops'])$(id).replaceChildren();
    for(const id of ['point-title','observation','reading-copy','review-date','souvenir-title','souvenir-note','souvenir-count'])text(id,'');
  }
  function loadSaved(){
    try{const value=JSON.parse(localStorage.getItem(storageKey)||'{}');return value&&typeof value==='object'&&!Array.isArray(value)?value:{};}
    catch{return {};}
  }
  function persist(){
    record.updatedAt=Date.now();
    try{
      const saved=loadSaved();saved[data.fingerprint]=record;
      // Only IDs, progress and the user's note are stored, never source text/audio URLs.
      const recent=Object.values(saved).filter(r=>r&&Date.now()-r.updatedAt<7*86400000).sort((a,b)=>b.updatedAt-a.updatedAt).slice(0,8);
      localStorage.setItem(storageKey,JSON.stringify(Object.fromEntries(recent.map(r=>[r.fingerprint,r]))));
    }catch{storageOK=false;text('status','浏览器不允许保存，仍可阅读；关闭后拾记可能丢失。');}
  }
  async function fetchContent(){
    if(!/^[\w-]{1,128}$/.test(resourceId))throw Error('景点编号无效，请从景点入口重新打开。');
    let timer;
    try{
      const result=await Promise.race([
        ExploreTransport.call({action:'getSiteExploration',resourceId}),
        new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('读取超时，请检查网络后重试。')),12000);})
      ]);
      return C.project(result,resourceId);
    }finally{clearTimeout(timer);}
  }
  function armExpiry(){
    clearTimeout(expiry);
    const until=Math.min(Date.parse(data.validUntil),...data.points.filter(p=>p.audio).map(p=>Date.parse(p.audio.validUntil)));
    expiry=setTimeout(()=>{generation++;gate('资料到了复核时间','暂不展示旧讲解与音频。请重新读取当前公开版本。');},Math.max(0,until-Date.now()+10));
  }
  async function verify(token=generation){
    try{
      const next=await fetchContent();
      if(token!==generation||leaving||document.hidden)throw Error('阅读状态已变化');
      if(!data||next.fingerprint!==data.fingerprint)throw Error('内容已换版，请重新读取。原版拾记留在本机，不会自动计入新版。');
      data=next;armExpiry();return next;
    }catch(error){if(token===generation){generation++;gate('先停一停，核对这一卷',error.message);}throw error;}
  }
  async function load(acceptUpdate=false){
    const token=++generation;
    gate('正在展卷','正在读取可公开的讲解与素材；不使用旧的离线正文。',false);
    shell.setAttribute('aria-busy','true');text('status','');
    try{
      const next=await fetchContent();if(token!==generation||document.hidden||leaving)return;
      if(data&&next.fingerprint!==data.fingerprint&&!acceptUpdate)throw Error('内容已换版，请重新读取。旧版拾记保留，不自动计入新版。');
      const changed=data&&next.fingerprint!==data.fingerprint;data=next;
      record=C.record(data,loadSaved()[data.fingerprint]);ready=true;finished=false;
      shell.dataset.art=String(resourceId==='yellow-crane-tower'||data.localTest);
      text('painting-title',resourceId==='yellow-crane-tower'||data.localTest?'一卷黄鹤楼':data.title);
      text('edition',data.localTest?'本地流程样例 · 非景区审定内容':'公开第 '+data.version+' 版 · 非实时导航');
      shell.setAttribute('aria-busy','false');$('gate').hidden=true;armExpiry();render();
      if(changed)text('status','已读取新版本。旧版拾记仍保留在本机，新版从头记起。');
    }catch(error){if(token===generation)gate('这份导览暂不可用',error.message);}
  }
  function current(){return data.points.find(p=>p.id===record.selected);}
  async function light(point){
    stopLight();const token=lightGeneration,scene=point.artScene,profile=window.ChuParkGildedProfiles?.[scene];
    if(!profile||!window.ChuGildedReveal||shell.dataset.art!=='true')return;
    const world=$('journey-world'),rect=profile.sourceRect,pad=ChuGildedReveal.lightPadding;
    stage.scrollTo({left:Math.max(0,(rect.x+rect.width/2)/1919*world.clientWidth-stage.clientWidth/2),top:Math.max(0,(rect.y+rect.height/2)/820*world.clientHeight-stage.clientHeight/2),behavior:'instant'});
    try{
      await art.decode();if(token!==lightGeneration||!ready||finished||document.hidden)return;
      Object.assign(canvas.style,{left:(rect.x-pad)/1919*100+'%',top:(rect.y-pad)/820*100+'%',width:(rect.width+2*pad)/1919*100+'%',height:(rect.height+2*pad)/820*100+'%'});
      renderer=ChuGildedReveal.create({canvas,image:art,profile,mode:'light-only',quality:'compact'});canvas.hidden=false;renderer.play();
    }catch{if(token===lightGeneration)$('art-error').hidden=false;}
  }
  function render(){
    if(!ready)return;
    const point=current(),index=data.points.indexOf(point);
    $('gate').hidden=true;$('content').hidden=finished;$('finished').hidden=!finished;
    $('journey-points').replaceChildren();$('journey-stops').replaceChildren();
    if(finished){quiet();armExpiry();souvenir();return;}
    text('position','第 '+(index+1)+' 景 / 共 '+data.points.length+' 景');
    text('point-title',point.title);text('observation',point.observation);text('reading-copy',point.reading);
    text('binding-note',point.artScene?'画中高亮仅帮助认图；不推断你的位置或行走方向。':'这一处尚未绑定原画位置，先阅读已公开的文字。');
    $('reading').open=false;$('sources').open=false;$('source-list').replaceChildren();
    for(const source of point.sources){
      const article=document.createElement('article'),title=document.createElement('strong'),copy=document.createElement('p'),credit=document.createElement('p');
      title.textContent=source.title;copy.textContent=source.excerpt;credit.textContent=source.credit;
      article.append(title,copy,credit);
      if(source.url){const link=document.createElement('a');link.href=source.url;link.target='_blank';link.rel='noopener noreferrer';link.textContent='查看公开出处 ↗';article.append(link);}
      $('source-list').append(article);
    }
    const date=value=>new Date(value).toLocaleString('zh-CN',{hour12:false});
    text('review-date','资料核对：'+date(data.checkedAt)+'；复核有效至：'+date(data.validUntil)+'。不是实时开放或客流信息。');
    for(const p of data.points){
      $('journey-stops').append(button(p.title,()=>select(p.id),{'aria-current':p.id===point.id?'step':'false','data-recorded':record.observed.includes(p.id),'data-stop':p.id}));
      if(p.artScene&&anchors[p.artScene]){
        const b=button(p.title,event=>{if(!event.detail||performance.now()>=suppressedUntil)select(p.id);},{'aria-pressed':p.id===point.id,'data-art-point':p.id});
        b.className='journey-point';b.style.left=anchors[p.artScene][0]+'%';b.style.top=anchors[p.artScene][1]+'%';$('journey-points').append(b);
      }
    }
    $('previous').disabled=index===0;text('observe',index===data.points.length-1?'记下这一景，收卷 →':'记下这一景，继续 →');
    const token=generation;A.mount($('audio'),point,()=>verify(token));light(point);
  }
  async function transition(fn){
    if(!ready)return;const token=++generation;A.stop();stopLight();
    try{await verify(token);if(token!==generation)return;fn();persist();render();(finished?$('finished-title'):$('point-title')).focus({preventScroll:true});}
    catch{/* verify has already removed stale content. */}
  }
  function select(id){if(data?.points.some(p=>p.id===id))transition(()=>{record.selected=id;});}
  function souvenir(){
    text('souvenir-title',data.title);
    const points=data.points.filter(p=>record.observed.includes(p.id));
    text('souvenir-count','主动记下 '+points.length+' / '+data.points.length+' 处阅读观察 · 第 '+data.version+' 版');
    $('souvenir-stops').replaceChildren(...points.map(p=>{const li=document.createElement('li');li.textContent=p.title;return li;}));
    text('souvenir-note',record.note);$('note').value=record.note;
  }
  $('retry').onclick=()=>load(true);$('refresh').onclick=()=>load(false);
  $('previous').onclick=()=>select(data.points[Math.max(0,data.points.indexOf(current())-1)].id);
  $('observe').onclick=()=>transition(()=>{
    record.observed=[...new Set([...record.observed,record.selected])];
    const next=data.points[data.points.indexOf(current())+1];if(next)record.selected=next.id;else finished=true;
  });
  $('finish').onclick=()=>transition(()=>{finished=true;});
  $('return').onclick=()=>transition(()=>{finished=false;});
  $('note').oninput=e=>{if(!ready||!finished)return;record.note=e.target.value.slice(0,120);persist();text('souvenir-note',record.note);};
  $('download').onclick=async()=>{
    if(!ready||!finished)return;const token=generation;
    try{
      await verify(token);if(token!==generation)return;
      const titles=data.points.filter(p=>record.observed.includes(p.id)).map(p=>p.title).join('、');
      const blob=new Blob(['\ufeff'+data.title+'\n第 '+data.version+' 版 · 主动阅读：'+titles+'\n\n'+record.note+'\n\n阅读拾记，不是实地到访凭证。'],{type:'text/plain;charset=utf-8'});
      const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='我的阅读拾记.txt';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch{/* gate keeps source withdrawal visible. */}
  };
  $('clear').onclick=()=>{
    if(!confirm('清除此浏览器中这个景点各版本的阅读进度和手记？不会删除下载文件或账号记录。'))return;
    try{localStorage.removeItem(storageKey);}catch{text('status','浏览器未允许清除，记录没有删除；可在浏览器设置中清理此站点数据。');return;}
    record=null;load(true);
  };
  $('sources').addEventListener('toggle',()=>{if($('sources').open&&ready)verify().catch(()=>{});});
  $('reading').addEventListener('toggle',()=>{if($('reading').open&&ready)verify().catch(()=>{});});
  art.onerror=()=>$('art-error').hidden=false;
  stage.onpointerdown=e=>{if(e.pointerType==='touch'||e.button!==0)return;drag={id:e.pointerId,x:e.clientX,y:e.clientY,left:stage.scrollLeft,top:stage.scrollTop,moved:false};};
  stage.onpointermove=e=>{
    if(!drag||e.pointerId!==drag.id)return;const x=e.clientX-drag.x,y=e.clientY-drag.y;
    if(!drag.moved&&Math.hypot(x,y)<5)return;
    drag.moved=true;stage.setPointerCapture(e.pointerId);stage.scrollLeft=drag.left-x;stage.scrollTop=drag.top-y;e.preventDefault();
  };
  for(const name of ['pointerup','pointercancel','lostpointercapture'])stage.addEventListener(name,()=>{if(drag?.moved)suppressedUntil=performance.now()+350;drag=null;});
  stage.onkeydown=e=>{if(e.target!==stage)return;const x={ArrowLeft:-80,ArrowRight:80}[e.key];if(x){e.preventDefault();stage.scrollBy(x,0);}};
  document.addEventListener('visibilitychange',()=>{if(document.hidden){generation++;gate('暂歇，留住这一页','回到页面后会重新核对资料。',false);}else load(false);});
  addEventListener('pagehide',()=>{leaving=true;generation++;quiet();});
  addEventListener('pageshow',e=>{if(e.persisted){leaving=false;load(false);}});
  setInterval(()=>{if(ready&&!document.hidden&&!leaving)verify().catch(()=>{});},30000);
  load();
})();
