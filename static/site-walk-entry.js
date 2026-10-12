(function(){'use strict';
const host=document.getElementById('guide-stops');if(!host)return;
const known=new WeakMap();
function add(box){if(!box.isConnected||box.querySelector('[data-site-walk]'))return;const a=document.createElement('a');a.dataset.siteWalk='';a.href='./onsite.html?resourceId='+encodeURIComponent(box.dataset.guideStation);a.textContent='景点里，慢慢看 ›';a.className='qa-entry';box.append(a);}
function check(){for(const box of host.querySelectorAll('[data-guide-station]')){if(known.has(box)){if(known.get(box))add(box);continue;}known.set(box,false);window.GuideCloud?.call({action:'getSiteWalk',resourceId:box.dataset.guideStation}).then(r=>{known.set(box,r?.available===true);if(r?.available)add(box);}).catch(()=>{});}}
new MutationObserver(check).observe(host,{childList:true,subtree:true});check();
})();
