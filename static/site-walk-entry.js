(function(){'use strict';
const host=document.getElementById('guide-stops');if(!host)return;const known=new WeakMap();
function add(box,value){if(!box.isConnected||box.querySelector('[data-site-walk]'))return;const a=document.createElement('a');a.dataset.siteWalk='';a.href='./'+(value.atlas?'explore.html':'onsite.html')+'?resourceId='+encodeURIComponent(box.dataset.guideStation);a.textContent=value.atlas?'展开探索画卷 ›':'景点里，慢慢看 ›';a.className='qa-entry';box.append(a);}
function check(){for(const box of host.querySelectorAll('[data-guide-station]')){if(known.has(box)){const v=known.get(box);if(v?.available)add(box,v);continue;}known.set(box,null);window.GuideCloud?.call({action:'getSiteWalk',resourceId:box.dataset.guideStation}).then(async r=>{if(!r?.available)return;let atlas=false;try{atlas=(await GuideCloud.call({action:'getSiteExploration',resourceId:box.dataset.guideStation}))?.available===true;}catch{}const v={available:true,atlas};known.set(box,v);add(box,v);}).catch(()=>{});}}
new MutationObserver(check).observe(host,{childList:true,subtree:true});check();
})();
