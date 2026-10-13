(function(){'use strict';
const jobs=new Map(),reduced=matchMedia('(prefers-reduced-motion: reduce)');
function cancel(key){const job=jobs.get(key);if(job){cancelAnimationFrame(job.frame);jobs.delete(key);}}
function tween(key,duration,draw,done){cancel(key);if(reduced.matches||document.hidden){draw(1);done?.();return;}const job={frame:0},start=performance.now();jobs.set(key,job);function tick(now){if(jobs.get(key)!==job)return;const t=Math.min(1,(now-start)/duration),v=1-Math.pow(1-t,4);draw(v);if(t<1)job.frame=requestAnimationFrame(tick);else{jobs.delete(key);done?.();}}job.frame=requestAnimationFrame(tick);}
function enter(el){if(!el)return;el.getAnimations().forEach(a=>a.cancel());if(!reduced.matches&&!document.hidden)el.animate([{opacity:.2,transform:'translateY(14px)'},{opacity:1,transform:'translateY(0)'}],{duration:420,easing:'cubic-bezier(.2,.7,.2,1)'});}
function detail(el){el.querySelectorAll('[data-layer]').forEach((n,i)=>{n.getAnimations().forEach(a=>a.cancel());if(!reduced.matches)n.animate([{opacity:0,transform:'translateY('+(25+i*8)+'px) scale(.94)'},{opacity:1,transform:'translateY(0) scale(1)'}],{duration:800,delay:i*75,fill:'backwards',easing:'cubic-bezier(.16,1,.3,1)'});});const ring=el.querySelector('.ex-detail-ring');if(ring&&!reduced.matches)ring.animate([{opacity:0,transform:'scale(.55)'},{opacity:1,offset:.45},{opacity:.2,transform:'scale(1.35)'}],{duration:1200,easing:'ease-out'});}
function stop(){for(const k of jobs.keys())cancel(k);document.getAnimations().forEach(a=>a.finish());}
reduced.addEventListener('change',stop);document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
window.ExploreMotion={tween,cancel,enter,detail,stop,reduced};
})();
