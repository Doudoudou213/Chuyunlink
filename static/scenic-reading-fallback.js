(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.ChuScenicReadingFallback=factory();
})(globalThis,function(){
  'use strict';
  const id=value=>typeof value==='string'&&/^[\w-]{1,128}$/.test(value);
  const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
  function publicLink(value){
    if(!value)return null;
    try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.hash&&!u.search?u.href:null;}catch{return null;}
  }
  // Publication and consent are verified by getGuideStation on every read.
  // This is NOT a new publication path and cannot turn a preview into a guide.
  function project(raw,resourceId){
    if(!id(resourceId)||raw?.ok!==true||raw.resourceId!==resourceId||raw.simulated===true||raw.localTest===true||!Array.isArray(raw.items)||raw.items.length>3)throw Error('unavailable');
    const seen=new Set();
    return raw.items.map(f=>{
      if(!f||!id(f.id)||!id(f.versionId)||f.resourceId!==resourceId||seen.has(f.id)||f.simulated===true||f.localTest===true||f.needsSourceReview||f.status&&f.status!=='published'||!text(f.title,200)||!text(f.text,16000)||!Array.isArray(f.sources)||!f.sources.length||f.sources.length>24)throw Error('unavailable');
      seen.add(f.id);
      const sourceIds=new Set();
      const sources=f.sources.map(s=>{
        if(!s||!id(s.id)||sourceIds.has(s.id)||!text(s.title,200)||!text(s.excerpt,16000)||s.sourceUnavailable||s.withdrawnAt||s.status&&s.status!=='confirmed')throw Error('unavailable');
        sourceIds.add(s.id);
        return {id:s.id,title:s.title,excerpt:s.excerpt,credit:typeof s.contributorName==='string'?s.contributorName.slice(0,200):'',url:publicLink(s.url)};
      });
      return {id:f.id,versionId:f.versionId,title:f.title,text:f.text,sources,visitNotice:typeof f.visitNotice==='string'?f.visitNotice.slice(0,500):'',official:f.evidenceKind==='official_pack'};
    });
  }
  function create(host,options){
    if(!host||typeof options?.call!=='function'||!id(options.resourceId))return null;
    const doc=host.ownerDocument,win=doc.defaultView;
    let generation=0,active=false,timer=null,items=[],selected='',sourceOpen=false;
    const pending=new Set();
    const el=(tag,className,value)=>{const n=doc.createElement(tag);if(className)n.className=className;if(value!==undefined)n.textContent=value;return n;};
    host.classList.add('scenic-reading-fallback');host.hidden=true;
    function stopTimer(){if(timer)win.clearTimeout(timer);timer=null;}
    function wipe(){host.replaceChildren();host.hidden=true;}
    function cancelPending(){for(const cancel of pending)cancel();pending.clear();}
    function clear(){generation++;active=false;stopTimer();cancelPending();items=[];selected='';sourceOpen=false;wipe();}
    function status(message,retry=false){
      host.replaceChildren();host.hidden=false;
      const p=el('p','scenic-reading-status',message);p.setAttribute('role','status');host.append(p);
      if(retry){const b=el('button','scenic-reading-retry','重新读取');b.type='button';b.onclick=()=>show();host.append(b);}
    }
    function paint(focus){
      const f=items.find(x=>x.id===selected)||items[0];
      if(!f){status('这里的介绍正在整理，可以先返回地图看看。');return;}
      selected=f.id;host.replaceChildren();host.hidden=false;
      const article=el('article','scenic-reading-paper');
      article.append(el('p','scenic-reading-eyebrow','纸上读景'),el('h2','scenic-reading-heading','先读一段'),el('h3','scenic-reading-title',f.title));
      const copy=el('div','scenic-reading-copy',f.text);copy.tabIndex=-1;article.append(copy);
      if(f.visitNotice)article.append(el('p','scenic-reading-notice',f.visitNotice));
      const foot=el('div','scenic-reading-tools');
      const source=el('button','scenic-reading-source',sourceOpen?'收起出处':'查看出处');source.type='button';source.setAttribute('aria-expanded',String(sourceOpen));
      source.onclick=()=>refresh({source:!sourceOpen,focus:'source'});foot.append(source);
      if(items.length>1){
        const paging=el('div','scenic-reading-paging'),i=items.findIndex(x=>x.id===f.id);
        const prev=el('button','','← 上一篇'),next=el('button','','再读一篇 →');prev.type=next.type='button';prev.disabled=i===0;next.disabled=i===items.length-1;
        prev.onclick=()=>refresh({select:items[i-1].id,focus:'copy'});next.onclick=()=>refresh({select:items[i+1].id,focus:'copy'});
        paging.append(prev,el('span','',String(i+1)+' / '+items.length),next);foot.append(paging);
      }
      article.append(foot);
      if(sourceOpen){
        const sources=el('section','scenic-reading-sources');sources.setAttribute('aria-label','本篇出处');
        if(f.official)sources.append(el('p','scenic-reading-notice','依据官方公开资料整理，并非官方原文或官方背书。'));
        for(const s of f.sources){const entry=el('div','scenic-reading-source-item');entry.append(el('strong','',s.title),el('p','',s.excerpt));if(s.credit)entry.append(el('small','',s.credit));if(s.url){const a=el('a','','阅读原出处 ↗');a.href=s.url;a.target='_blank';a.rel='noopener noreferrer';entry.append(a);}sources.append(entry);}
        article.append(sources);
      }
      article.append(el('p','scenic-reading-boundary','纸上阅读，不提供现场行走指引。'));
      host.append(article);
      if(focus==='source')source.focus({preventScroll:true});
      if(focus==='copy')copy.focus({preventScroll:true});
    }
    async function refresh(intent={}){
      if(!active||doc.hidden)return false;
      stopTimer();const token=++generation;cancelPending();const oldSelection=selected;
      let cancel,requestTimer;
      // Do not leave expired/unverified text visible while the next read runs.
      status('正在重新核对这段介绍……');
      try{
        const raw=await Promise.race([Promise.resolve().then(()=>{
          if(token!==generation||!active||doc.hidden)throw Error('cancelled');
          return options.call({action:'getGuideStation',resourceId:options.resourceId});
        }),new Promise((_,reject)=>{cancel=()=>reject(Error('cancelled'));pending.add(cancel);requestTimer=win.setTimeout(()=>reject(Error('timeout')),12000);})]);
        if(token!==generation||!active||doc.hidden)return false;
        items=project(raw,options.resourceId);
        selected=items.some(f=>f.id===(intent.select||oldSelection))?(intent.select||oldSelection):(items[0]?.id||'');
        sourceOpen=selected===oldSelection?(intent.source??sourceOpen):false;
        paint(intent.focus);
        if(items.length)timer=win.setTimeout(()=>refresh(),60000);
        return items.length>0;
      }catch(_){
        if(token===generation&&active&&!doc.hidden){items=[];selected='';sourceOpen=false;status('暂时无法核对介绍，请稍后重新读取。',true);}
        return false;
      }finally{if(requestTimer)win.clearTimeout(requestTimer);pending.delete(cancel);}
    }
    function show(){active=true;return refresh();}
    function visibility(){if(!active)return;if(doc.hidden){generation++;stopTimer();cancelPending();items=[];sourceOpen=false;wipe();}else show();}
    doc.addEventListener('visibilitychange',visibility);win.addEventListener('pagehide',clear);
    return {show,clear,destroy(){clear();doc.removeEventListener('visibilitychange',visibility);win.removeEventListener('pagehide',clear);}};
  }
  return {create,project,publicLink};
});
