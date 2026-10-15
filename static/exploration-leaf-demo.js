/* A standalone, data-free visual study; not connected to visitor progress or publication. */
(function(){
  'use strict';
  const $=id=>document.getElementById(id),dialog=$('scene-leaf'),canvas=$('leaf-canvas'),world=$('leaf-world');
  const reduce=matchMedia('(prefers-reduced-motion: reduce)');
  const scenes={
    tower:{title:'黄鹤楼',subtitle:'层檐入画',copy:['沿着层层屋檐，让目光停一停。再循石阶向下，看楼影怎样融进草木。']},
    copper:{title:'古铜顶',subtitle:'古铜留影',copy:['先看圆润的轮廓，再看铜色与草木的映衬。画中这一件小物，也值得单独留一页。']},
    baiyun:{title:'白云阁',subtitle:'树影藏阁',copy:['从树冠间，寻找那一点露出的檐角。屋顶与立柱，把留白慢慢分出层次。']},
    pond:{title:'鹅池',subtitle:'水纹成笺',copy:['由一圈岸线，到几笔水纹，再到水边小亭。留一点空白，给目光，也给片刻停留。']}
  };
  let active=null,opener=null,request=0,outsideDown=false,drag=null,suppressClickUntil=0;
  const supported=typeof HTMLDialogElement!=='undefined'&&typeof dialog.showModal==='function';
  const motion=window.ChuLeafMotion?.create({dialog,sheet:dialog.querySelector('.leaf-plane'),motif:$('leaf-motif'),parts:[...dialog.querySelectorAll('.leaf-head,.leaf-body,.leaf-foot,#leaf-demo-note')],light:dialog.querySelector('.leaf-light'),shade:dialog.querySelector('.leaf-shade'),veil:$('leaf-veil')});
  function settle(){motion?.settle();$('leaf-veil').style.opacity='1';if(dialog.open)dialog.dataset.state='open';}
  function motif(id){
    const host=$('leaf-motif');host.replaceChildren();host.dataset.motif=id;
    const profile=window.ChuParkGildedProfiles?.[id];if(!profile)return;
    const r=profile.sourceRect,photo=document.createElement('div');photo.className='motif-photo';
    photo.style.backgroundSize=(1919/r.width*100)+'% '+(820/r.height*100)+'%';
    photo.style.backgroundPosition=(r.x/(1919-r.width)*100)+'% '+(r.y/(820-r.height)*100)+'%';host.append(photo);
    const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox',`0 0 ${r.width} ${r.height}`);svg.setAttribute('preserveAspectRatio','none');svg.setAttribute('aria-hidden','true');
    for(const line of profile.contours){const p=document.createElementNS(ns,'path');p.setAttribute('d',line.points.map(([x,y],i)=>(i?'L':'M')+x+' '+y).join(' '));p.setAttribute('stroke-width',id==='pond'?1.4:.85);svg.append(p);}host.append(svg);
  }
  function fill(id){
    const scene=scenes[id];dialog.dataset.scene=id;$('leaf-title').textContent=scene.title;$('leaf-subtitle').textContent=scene.subtitle;
    $('leaf-pagination').textContent='〇'+(Object.keys(scenes).indexOf(id)+1)+' / 四景';
    $('leaf-copy').replaceChildren(...scene.copy.map(t=>{const p=document.createElement('p');p.textContent=t;return p;}));
    motif(id);dialog.querySelector('.leaf-body').scrollTop=0;
    document.querySelectorAll('[data-scene]').forEach(e=>{if(e.tagName==='BUTTON')e.classList.toggle('is-selected',e.dataset.scene===id);});
  }
  function point(id){return world.querySelector('[data-scene="'+id+'"]');}
  function centerOf(e){const r=e.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};}
  function origin(){const p=point(active),r=p?.getBoundingClientRect(),c=canvas.getBoundingClientRect();if(!r||r.right<c.left||r.left>c.right||r.bottom<0||r.top>innerHeight)return null;return centerOf(p);}
  function finishClose(focus=true){request++;motion?.reset();$('leaf-veil').style.opacity='';if(dialog.open)dialog.close();dialog.dataset.state='closed';document.documentElement.classList.remove('leaf-is-open');document.documentElement.style.removeProperty('--leaf-scroll-gap');if(focus&&opener?.isConnected)opener.focus({preventScroll:true});}
  function close(){
    if(!dialog.open||dialog.dataset.state==='closing')return;
    const token=++request;dialog.dataset.state='closing';
    if(!motion||reduce.matches)return finishClose();
    motion.leave({origin:origin(),onComplete:()=>{if(token===request)finishClose();}});
  }
  function open(id,trigger){
    if(!scenes[id])return;
    if(!supported){$('demo-status').classList.remove('sr-only');$('demo-status').textContent='此浏览器暂不支持纸页预览，请使用新版浏览器。';return;}
    const token=++request,fresh=!dialog.open;active=id;opener=trigger;fill(id);
    const marker=point(id),mark=marker.getBoundingClientRect(),frame=canvas.getBoundingClientRect();
    // An index selection first reveals its artwork anchor; never animate from an offscreen point.
    if(mark.left<frame.left+30||mark.right>frame.right-30){canvas.scrollLeft+=mark.left+mark.width/2-frame.left-frame.width/2;}
    const start=origin();
    if(fresh)document.documentElement.style.setProperty('--leaf-scroll-gap',Math.max(0,innerWidth-document.documentElement.clientWidth)+'px');
    if(!dialog.open)dialog.showModal();document.documentElement.classList.add('leaf-is-open');dialog.dataset.state='opening';
    $('leaf-title').focus({preventScroll:true});
    if(!motion||reduce.matches){settle();return;}
    motion.enter({origin:start,fresh,onComplete:()=>{if(token===request)settle();}});
  }
  document.querySelectorAll('button[data-scene]').forEach(b=>b.addEventListener('click',()=>{if(performance.now()<suppressClickUntil)return;open(b.dataset.scene,b);}));
  $('leaf-close').onclick=close;$('leaf-return').onclick=close;
  dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
  dialog.addEventListener('close',()=>{if(!dialog.open&&dialog.dataset.state!=='closed')finishClose(false);});
  const outside=e=>{const r=dialog.getBoundingClientRect();return e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom;};
  dialog.addEventListener('pointerdown',e=>{outsideDown=e.target===dialog&&outside(e);});
  dialog.addEventListener('click',e=>{if(outsideDown&&e.target===dialog&&outside(e))close();outsideDown=false;});
  dialog.addEventListener('keydown',e=>{
    if(e.key!=='Tab')return;const items=[...dialog.querySelectorAll('button,[tabindex="0"]')].filter(e=>e.getClientRects().length),first=items[0],last=items.at(-1);
    if(e.shiftKey&&(document.activeElement===first||document.activeElement===$('leaf-title'))){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
  });
  canvas.addEventListener('pointerdown',e=>{if(e.pointerType==='touch'||e.button!==0)return;drag={x:e.clientX,y:e.clientY,left:canvas.scrollLeft,moved:false};});
  canvas.addEventListener('pointermove',e=>{if(!drag)return;if(Math.abs(e.clientX-drag.x)>5){drag.moved=true;canvas.classList.add('dragging');canvas.scrollLeft=drag.left-(e.clientX-drag.x);}});
  function endDrag(){if(drag?.moved)suppressClickUntil=performance.now()+250;drag=null;canvas.classList.remove('dragging');}
  addEventListener('pointerup',endDrag);canvas.addEventListener('pointercancel',endDrag);canvas.addEventListener('pointerleave',endDrag);
  canvas.addEventListener('keydown',e=>{if(e.target!==canvas)return;const x={ArrowLeft:-90,ArrowRight:90}[e.key];if(x){e.preventDefault();canvas.scrollLeft+=x;}});
  $('leaf-art').addEventListener('error',()=>{$('art-failure').hidden=false;});
  if($('leaf-art').complete&&!$('leaf-art').naturalWidth)$('art-failure').hidden=false;
  addEventListener('resize',()=>{if(dialog.open){if(dialog.dataset.state==='closing')finishClose();else settle();}});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)finishClose(false);});
  addEventListener('pagehide',()=>finishClose(false));
  reduce.addEventListener('change',()=>{if(dialog.open){if(dialog.dataset.state==='closing')finishClose();else settle();}});
})();
