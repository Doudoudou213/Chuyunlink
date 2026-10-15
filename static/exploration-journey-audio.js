(function(){
  'use strict';
  let cleanup=()=>{};
  function stop(){cleanup();cleanup=()=>{};}
  function mount(host,point,validate){
    stop();host.replaceChildren();
    const hint=document.createElement('p');host.append(hint);
    const asset=point.audio;
    if(!asset){hint.textContent='这一景暂未配音，可以展开阅读讲解。';return;}
    let alive=true,pending=false,started=false;
    const a=new Audio();a.preload='none';a.crossOrigin='anonymous';
    const row=document.createElement('div'),play=document.createElement('button'),seek=document.createElement('input');
    const caption=document.createElement('p'),credit=document.createElement('p');
    row.className='audio-row';play.type='button';play.textContent='听这段讲解';
    seek.type='range';seek.min=0;seek.max=asset.duration;seek.step=.25;seek.value=0;seek.disabled=true;seek.setAttribute('aria-label','讲解播放进度');
    caption.className='audio-caption';caption.hidden=true;
    credit.textContent=asset.attribution;hint.textContent=asset.captions?.length?'由你开始播放 · 字幕摘自本版已审讲解':'由你开始播放 · 随音频展示对应观察文字，非逐字字幕';
    row.append(play,seek);host.prepend(row);host.append(caption,credit);
    const update=()=>{
      if(!alive)return;
      seek.value=a.currentTime;
      const cue=[...(asset.cues||[])].reverse().find(c=>c.at<=a.currentTime);
      const line=asset.captions?.find(c=>c.start<=a.currentTime&&a.currentTime<c.end);
      caption.textContent=asset.captions?.length?(line?.text||''):(cue?.detailId==='location'?point.locator:point.observation);caption.hidden=!caption.textContent;
    };
    cleanup=()=>{alive=false;a.pause();a.removeAttribute('src');a.load();play.disabled=true;seek.disabled=true;caption.textContent='';};
    a.addEventListener('timeupdate',update);
    a.addEventListener('loadedmetadata',()=>{
      if(!alive)return;
      if(!Number.isFinite(a.duration)||Math.abs(a.duration-asset.duration)>Math.max(2,asset.duration*.05)){
        stop();hint.textContent='音频时长与登记版本不符，先阅读文字。';
      }else seek.disabled=false;
    });
    a.addEventListener('ended',()=>{if(alive)play.textContent='再听一遍';});
    a.addEventListener('error',()=>{if(!alive)return;a.pause();started=false;seek.disabled=true;play.textContent='重试播放';hint.textContent='音频加载失败，文字仍可阅读。';});
    play.onclick=async()=>{
      if(!alive||pending)return;
      if(!a.paused){a.pause();play.textContent='继续听';return;}
      pending=true;play.disabled=true;
      try{
        await validate();if(!alive)return;
        if(!started){a.src=asset.url;started=true;}
        await a.play();if(alive){play.textContent='暂停';update();}
      }catch(error){if(alive){a.pause();play.textContent='重试播放';hint.textContent='音频暂时无法播放，请重试或先阅读文字。';}}
      finally{pending=false;if(alive)play.disabled=false;}
    };
    seek.oninput=async()=>{
      if(!alive||pending)return;const value=Number(seek.value);a.pause();play.textContent='继续听';pending=true;play.disabled=true;
      try{await validate();if(alive){a.currentTime=value;update();}}
      catch(error){if(alive){stop();hint.textContent=error.message;}}
      finally{pending=false;if(alive)play.disabled=false;}
    };
  }
  window.ChuJourneyAudio={mount,stop};
})();
