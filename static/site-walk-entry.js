(function(){'use strict';
const host=document.getElementById('guide-stops');if(!host)return;
const seen=new WeakSet();
function check(){for(const box of host.querySelectorAll('[data-guide-station]')){if(seen.has(box))continue;seen.add(box);const id=box.dataset.guideStation;window.GuideCloud?.call({action:'getSiteWalk',resourceId:id}).then(r=>{if(!box.isConnected||!r?.available||box.querySelector('[data-site-walk]'))return;const a=document.createElement('a');a.dataset.siteWalk='';a.href='./onsite.html?resourceId='+encodeURIComponent(id);a.textContent='景点里，慢慢看 ›';a.className='qa-entry';box.append(a);}).catch(()=>{});}}
new MutationObserver(check).observe(host,{childList:true,subtree:true});check();
})();
