(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.ChuJourneyContent=factory();})(globalThis,function(){
  'use strict';
  const scenes=['tower','copper','baiyun','pond'];
  function safeLink(value){
    try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}
  }
  // The server remains the authority; never fall back to the artwork demo's narrative.
  function project(response,resourceId,now=Date.now()){
    if(!response?.ok||!response.available)throw Error(response?.reason||'这份导览暂未开放，请稍后重新读取。');
    const w=response.walk,m=response.map;
    if(!w||w.resourceId!==resourceId||!w.fingerprint||!Number.isInteger(w.version)||!Array.isArray(w.points)||!w.points.length||w.points.length>12||!Array.isArray(m?.objects))throw Error('资料与当前景点不匹配，请重新读取。');
    if(!(Date.parse(response.validUntil)>now))throw Error('资料已到复核时间，暂不显示旧讲解。');
    const ids=new Set(),artIds=new Set();
    const points=w.points.map(p=>{
      const objects=m.objects.filter(o=>o.pointId===p.id);
      if(!/^[\w-]{1,128}$/.test(p.id)||ids.has(p.id)||objects.length!==1||!p.title||!p.text||!Array.isArray(p.sources)||!p.sources.length)throw Error('观察点与来源不完整，暂不显示。');
      ids.add(p.id);const o=objects[0];
      if(o.artScene&&(!scenes.includes(o.artScene)||artIds.has(o.artScene)))throw Error('画稿与观察点绑定需要核对。');
      if(o.artScene)artIds.add(o.artScene);
      const audio=m.assets?.[o.audioId];
      if(audio&&(!safeLink(audio.url)||audio.type!=='audio'||!(Date.parse(audio.validUntil)>now)))throw Error('音频授权需要重新核对。');
      return {id:p.id,title:p.title,observation:p.text,reading:p.reading||p.text,locator:p.locator||'',
        sources:p.sources.map(s=>({title:s.title||'公开来源',excerpt:s.excerpt||'',credit:s.contributorName||'',url:safeLink(s.url)})),
        artScene:o.artScene||null,audio:audio||null};
    });
    return {resourceId,title:w.title,version:w.version,fingerprint:w.fingerprint,points,
      checkedAt:response.checkedAt,validUntil:response.validUntil,localTest:response.localTest===true||w.simulated===true};
  }
  function record(data,raw,now=Date.now()){
    const ids=data.points.map(p=>p.id);
    if(!raw||raw.fingerprint!==data.fingerprint||!Number.isFinite(raw.updatedAt)||now-raw.updatedAt>7*86400000||raw.updatedAt>now+60000)raw={};
    return {fingerprint:data.fingerprint,selected:ids.includes(raw.selected)?raw.selected:ids[0],
      observed:Array.isArray(raw.observed)?[...new Set(raw.observed.filter(id=>ids.includes(id)))]:[],
      note:typeof raw.note==='string'?raw.note.slice(0,120):'',updatedAt:now};
  }
  return {project,record,safeLink};
});
