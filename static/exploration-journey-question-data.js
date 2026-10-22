(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.ChuJourneyQuestionData=factory();
})(globalThis,function(){
  'use strict';
  // Public display contracts only. Never infer object IDs, retain identities,
  // persist answers or turn editorial previews into an enabled QA capability.
  const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
  const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value)&&
    (Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
  const keys=(value,allowed)=>object(value)&&Object.keys(value).every(key=>allowed.includes(key));
  const identifier=value=>typeof value==='string'&&/^[\w-]{1,128}$/.test(value);
  const fingerprint=value=>typeof value==='string'&&/^[a-f0-9]{64}$/i.test(value);
  const fail=()=>{throw Object.assign(Error('问答资料需要重新核对，请重新打开这一景。'),{code:'QA_DISPLAY_CONTRACT'});};
  function text(value,max,empty=false){
    if(typeof value!=='string'||value.length>max||(!empty&&!value.trim())||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))fail();
    return value;
  }
  function bounded(value){
    try {if(JSON.stringify(value).length>40000)fail();}catch{fail();}
  }
  function freeze(value){
    if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}
    return value;
  }
  function checkScope(scope){
    if(!keys(scope,['resourceId','pointId','objectId','walkFingerprint','localTest'])||
      !identifier(scope.resourceId)||!identifier(scope.pointId)||!identifier(scope.objectId)||
      typeof scope.localTest!=='boolean')fail();
    text(scope.walkFingerprint,128);return scope;
  }
  function sameScope(raw,scope){
    if(raw.ok!==true||raw.resourceId!==scope.resourceId||raw.objectId!==scope.objectId||!fingerprint(raw.fingerprint))fail();
    if(scope.localTest ? raw.simulated!==true : own(raw,'simulated'))fail();
  }
  function publicUrl(value){
    if(value===undefined||value===null||value==='')return '';
    text(value,2048);
    let url;
    try {url=new URL(value);}catch{fail();}
    if(url.protocol!=='https:'||url.username||url.password||value!==value.trim()||/[\r\n\t\\]/.test(value))fail();
    const host=url.hostname.toLowerCase().replace(/\.$/,'');
    if(!host||host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host.endsWith('.internal')||
      host.startsWith('['))fail();
    if(/^\d+\.\d+\.\d+\.\d+$/.test(host)){
      const [a,b]=host.split('.').map(Number);
      if(a===0||a===10||a===127||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&b===168||a>=224)fail();
    }
    for(const key of url.searchParams.keys()){
      const normalized=key.toLowerCase().replace(/[^a-z0-9]/g,'');
      if(/token|secret|password|passwd|credential|signature|authorization|session|fileid|openid/.test(normalized)||
        /^(?:key|apikey|accesskey|awsaccesskeyid|auth|sig|sign|uid)$/.test(normalized)||
        /^(?:xamz|xcos|qsign|qkeytime|qheaderlist|qurllist)/.test(normalized))fail();
    }
    // Fragments are part of the returned URL too; signed/private payloads are
    // not made public merely by placing them after # or percent-encoding them.
    let decoded=url.href;
    for(let index=0;index<3;index++){
      if(/cloud:\/\/|(?:[?&#]|\/)(?:token|access[_-]?token|api[_-]?key|secret|signature|sig|auth|authorization|password|fileid|credential|session(?:[_-]?id)?)\s*[=:]/i.test(decoded))fail();
      try{const next=decodeURIComponent(decoded);if(next===decoded)break;decoded=next;}catch{fail();}
    }
    return url.href;
  }
  function source(raw){
    if(!keys(raw,['id','title','excerpt','url','contributorName','credit'])||!identifier(raw.id))fail();
    if(own(raw,'credit')&&own(raw,'contributorName')&&raw.credit!==raw.contributorName)fail();
    return {id:raw.id,title:text(raw.title,200),excerpt:text(raw.excerpt,8000,true),
      url:publicUrl(raw.url),credit:text(raw.credit??raw.contributorName??'',240,true)};
  }
  function sources(raw){
    if(!Array.isArray(raw)||raw.length>64)fail();
    const seen=new Set();
    return raw.map(value=>{const clean=source(value);if(seen.has(clean.id))fail();seen.add(clean.id);return clean;});
  }
  function binding(raw,data){
    try {
      if(!object(raw)||raw.ok!==true||raw.available!==true||!object(raw.walk)||!object(raw.map)||!object(data)||
        !identifier(data.resourceId)||typeof data.localTest!=='boolean'||raw.walk.resourceId!==data.resourceId||
        raw.walk.fingerprint!==data.fingerprint||!Array.isArray(data.points)||!data.points.length||data.points.length>12||
        !Array.isArray(raw.walk.points)||raw.walk.points.length!==data.points.length||!Array.isArray(raw.map.objects)||
        raw.map.objects.length!==data.points.length)return null;
      text(data.fingerprint,128);
      if(own(raw,'localTest')&&typeof raw.localTest!=='boolean'||own(raw.walk,'simulated')&&typeof raw.walk.simulated!=='boolean')return null;
      if(data.localTest){
        const cap=raw.journeyQuestions;
        if(raw.localTest!==true||!keys(cap,['schemaVersion','mode','resourceId'])||
          cap.schemaVersion!==1||cap.mode!=='local-fixed'||cap.resourceId!==data.resourceId)return null;
      }else if(raw.localTest===true||raw.walk.simulated===true||own(raw,'journeyQuestions'))return null;
      const pointIds=data.points.map(point=>point?.id),rawIds=raw.walk.points.map(point=>point?.id);
      if(pointIds.some(id=>!identifier(id))||new Set(pointIds).size!==pointIds.length||
        new Set(rawIds).size!==rawIds.length||rawIds.some(id=>!pointIds.includes(id)))return null;
      const ids=new Set(),mapped=new Set(),result=Object.create(null);
      for(const item of raw.map.objects){
        if(!object(item)||!identifier(item.id)||!identifier(item.pointId)||!pointIds.includes(item.pointId)||
          ids.has(item.id)||mapped.has(item.pointId))return null;
        ids.add(item.id);mapped.add(item.pointId);
        result[item.pointId]={resourceId:data.resourceId,pointId:item.pointId,objectId:item.id,
          walkFingerprint:data.fingerprint,localTest:data.localTest};
      }
      return freeze(result);
    }catch{return null;}
  }
  function context(raw,scope){
    checkScope(scope);bounded(raw);
    if(!keys(raw,['ok','resourceId','objectId','title','fingerprint','ready','reason','introduction','sources','simulated']))fail();
    sameScope(raw,scope);
    if(typeof raw.ready!=='boolean'||!['ready','off','insufficient'].includes(raw.reason)||
      raw.ready!==(raw.reason==='ready'))fail();
    if(own(raw,'introduction'))text(raw.introduction,8000,true);
    const clean=sources(raw.sources);
    if(raw.ready&&!clean.length)fail();
    return freeze({resourceId:scope.resourceId,objectId:scope.objectId,fingerprint:raw.fingerprint,
      title:text(raw.title,200),ready:raw.ready,reason:raw.reason,sources:clean,localTest:scope.localTest});
  }
  const messages={
    off:'即时问答暂未开启，你可以先阅读这一景。',
    insufficient:'现有资料还不足以回答这个问题，暂不猜测。',
    practical:'开放、票务和具体行走方向，请以景区最新公告与现场指引为准。',
    limited:'本次问答额度暂时用完了，已有介绍仍可阅读。',
    unavailable:'问答暂时连接不上，已有介绍仍可阅读。',
    source:'相关来源已变化，请重新打开这一景后再问。'
  };
  function answer(raw,current,scope){
    checkScope(scope);bounded(raw);bounded(current);
    if(!keys(current,['resourceId','objectId','fingerprint','title','ready','reason','sources','localTest'])||
      current.resourceId!==scope.resourceId||current.objectId!==scope.objectId||current.localTest!==scope.localTest||
      !fingerprint(current.fingerprint)||typeof current.ready!=='boolean'||
      !['ready','off','insufficient'].includes(current.reason)||current.ready!==(current.reason==='ready'))fail();
    text(current.title,200);const evidence=sources(current.sources);
    if(current.ready&&!evidence.length)fail();
    if(!keys(raw,['ok','resourceId','objectId','title','fingerprint','outcome','text','sentences','sources',
      'aiGenerated','simulated','version','cached']))fail();
    sameScope(raw,scope);
    if(raw.fingerprint!==current.fingerprint||!['answer',...Object.keys(messages)].includes(raw.outcome)||
      typeof raw.aiGenerated!=='boolean'||!Array.isArray(raw.sentences)||raw.sentences.length>6||
      !Array.isArray(raw.sources)||raw.sources.length>64)fail();
    text(raw.text,4000,true);
    if(own(raw,'title'))text(raw.title,200);
    if(own(raw,'cached')&&typeof raw.cached!=='boolean')fail();
    if(own(raw,'version')&&(!Array.isArray(raw.version)||raw.version.length>6||
      raw.version.some(value=>typeof value!=='string'||value.length>160)))fail();
    const base={resourceId:scope.resourceId,objectId:scope.objectId,fingerprint:current.fingerprint,
      outcome:raw.outcome,localTest:scope.localTest};
    // Never echo server-supplied prose or citations for a non-answer outcome.
    if(raw.outcome!=='answer')return freeze({...base,text:messages[raw.outcome],sentences:[],sources:[],aiGenerated:false});
    if(!current.ready||raw.aiGenerated!==true||!raw.sentences.length)fail();
    const known=new Map(evidence.map(item=>[item.id,item])),used=new Set();
    const sentences=raw.sentences.map(item=>{
      if(!keys(item,['text','sourceIds'])||!Array.isArray(item.sourceIds)||!item.sourceIds.length||
        item.sourceIds.length>64||new Set(item.sourceIds).size!==item.sourceIds.length||
        item.sourceIds.some(id=>!identifier(id)||!known.has(id)))fail();
      item.sourceIds.forEach(id=>used.add(id));
      return {text:text(item.text,500),sourceIds:[...item.sourceIds]};
    });
    if(sentences.reduce((sum,item)=>sum+item.text.length,0)>500||raw.text!==sentences.map(item=>item.text).join('\n'))fail();
    const returned=sources(raw.sources);
    if(returned.length!==used.size||returned.some(item=>!used.has(item.id)||
      ['title','excerpt','url','credit'].some(key=>item[key]!==known.get(item.id)[key])))fail();
    return freeze({...base,text:raw.text,sentences,sources:evidence.filter(item=>used.has(item.id)),aiGenerated:true});
  }
  return {binding,context,answer};
});
