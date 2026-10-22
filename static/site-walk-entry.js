(function(){'use strict';
const host=document.getElementById('guide-stops');if(!host)return;
let known=new WeakMap(),pageGeneration=0,restoring=null,suspended=false;
function add(box,value){
 if(!box.isConnected||box.querySelector('[data-site-walk]'))return;
 const a=document.createElement('a');a.dataset.siteWalk='';
 a.href='./'+(value.atlas?'explore-journey.html':'onsite.html')+'?resourceId='+encodeURIComponent(box.dataset.guideStation);
 a.textContent=value.atlas?'展开探索画卷 ›':'景点里，慢慢看 ›';a.className='qa-entry';
 if(value.atlas)a.addEventListener('click',event=>{
  if(event.ctrlKey||event.metaKey||event.altKey||event.shiftKey)return;
  const token=window.ChuScenicReturn?.save({view:'guide',scroll:window.scrollY,stationId:box.dataset.guideStation,stationPanelOpen:document.getElementById('guide-station-panel')?.open===true});
  if(token){
   const url=new URL(a.href);url.searchParams.set('returnToken',token);a.href=url.href;
   // Back must restore the same short-lived snapshot; never put user data in history.
   history.replaceState({...history.state,scenicGuideReturn:token},'',location.href);
  }
 });
 box.append(a);
}
function check(){
 if(suspended||document.hidden)return Promise.resolve();
 const generation=pageGeneration;
 return Promise.all([...host.querySelectorAll('[data-guide-station]')].map(async box=>{
  if(!known.has(box))known.set(box,(async()=>{
   const r=await window.GuideCloud?.call({action:'getSiteWalk',resourceId:box.dataset.guideStation});
   if(!r?.available||generation!==pageGeneration)return null;
   let atlas=false;try{atlas=(await GuideCloud.call({action:'getSiteExploration',resourceId:box.dataset.guideStation}))?.available===true;}catch{}
   return {available:true,atlas};
  })().catch(()=>null));
  const value=await known.get(box);
  if(generation===pageGeneration&&value?.available)add(box,value);
 }));
}
new MutationObserver(check).observe(host,{childList:true,subtree:true});check();
const frame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
// Selection is presentation only. Use the existing view action, never arrive/event.
async function restore(fromHistory=false){
 if(restoring)return restoring;
 const service=window.ChuScenicReturn;if(!service)return;
 const url=new URL(location.href),historyToken=history.state?.scenicGuideReturn;
 if(!url.searchParams.has('scenicReturn')&&fromHistory&&service.read(historyToken)?.view==='guide'){
  url.searchParams.set('scenicReturn',historyToken);history.replaceState(history.state,'',url);
 }
 if(!url.searchParams.has('scenicReturn'))return;
 const generation=pageGeneration;
 const current=()=>{if(generation!==pageGeneration)throw Error('Page left');};
 restoring=service.restore(async context=>{
  await window.GuideApp?.ready;current();
  if(context.view!=='guide')return;
  const session=window.GuideApp?.getSession(),index=session?.stops?.findIndex(s=>s.resourceId===context.stationId);
  if(!Number.isInteger(index)||index<0)return;
  const button=document.querySelector('#guide-route [data-act="view"][data-index="'+index+'"]');
  if(!button)return;
  if(host.hidden||button.getAttribute('aria-current')!=='step'){
   await new Promise((resolve,reject)=>{
    const selected=()=>!host.hidden&&host.querySelector('[data-guide-station="'+context.stationId+'"]');
    const observer=new MutationObserver(()=>{if(selected()){observer.disconnect();clearTimeout(timer);resolve();}});
    const timer=setTimeout(()=>{observer.disconnect();reject(Error('Station unavailable'));},3000);
    observer.observe(host,{childList:true,subtree:true});button.click();
   });
  }
  current();
  const panel=document.getElementById('guide-station-panel');
  if(panel&&typeof context.stationPanelOpen==='boolean')panel.open=context.stationPanelOpen;
  // Allow the native toggle handler to run, then await the final source recheck.
  await frame();current();
  await window.GuideContent?.render(session);current();
  await check();current();
  await document.fonts?.ready;await frame();current();
  window.scrollTo({top:context.scroll,behavior:'instant'});
 }).then(restored=>{
  if(generation===pageGeneration&&!new URL(location.href).searchParams.has('scenicReturn')&&history.state?.scenicGuideReturn){
   const state={...history.state};delete state.scenicGuideReturn;history.replaceState(state,'',location.href);
  }
  return restored;
 }).finally(()=>{if(generation===pageGeneration)restoring=null;});
 return restoring;
}
restore(performance.getEntriesByType('navigation')[0]?.type==='back_forward');
window.addEventListener('pageshow',event=>{suspended=false;if(event.persisted){check();restore(true);}});
window.addEventListener('pagehide',()=>{suspended=true;pageGeneration++;restoring=null;known=new WeakMap();});
})();
