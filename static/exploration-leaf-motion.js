/* Visual-only paper choreography. No routing, visitor state, storage or network access. */
(function(){
  'use strict';
  window.ChuLeafMotion={create({dialog,sheet,motif,parts,light,shade,veil}){
    const G=window.gsap;
    let timeline=null;
    const surfaces=[dialog,sheet,motif,...parts,light,shade];
    const value=(target,key,fallback=0)=>Number(G.getProperty(target,key))||fallback;
    function stop(){timeline?.kill();timeline=null;}
    function clear(){
      if(G)G.set(surfaces,{clearProps:'transform,opacity,visibility,willChange'});
      else surfaces.forEach(e=>['transform','opacity','visibility','will-change'].forEach(k=>e.style.removeProperty(k)));
    }
    function settle(){stop();clear();veil.style.opacity='1';veil.style.willChange='';}
    function reset(){stop();clear();veil.style.opacity='';veil.style.willChange='';}
    // All geometry is read once. Each frame only writes transforms from this fixed curve.
    function curve(start,end,bow){
      const cx=(start.x+end.x)/2,cy=Math.min(start.y,end.y)-bow;
      return t=>({x:(1-t)*(1-t)*start.x+2*(1-t)*t*cx+t*t*end.x,
        y:(1-t)*(1-t)*start.y+2*(1-t)*t*cy+t*t*end.y});
    }
    function baseCenter(){
      const r=dialog.getBoundingClientRect();
      return {x:r.left+r.width/2-value(dialog,'x'),y:r.top+r.height/2-value(dialog,'y')};
    }
    function travel(start,end,duration,bow,ease){
      const state={t:0},at=curve(start,end,bow);
      timeline.to(state,{t:1,duration,ease,onUpdate(){const p=at(state.t);G.set(dialog,{x:p.x,y:p.y});}},0);
    }
    function enter({origin,fresh,compact=false,onComplete}){
      stop();
      if(!G||matchMedia('(prefers-reduced-motion: reduce)').matches){settle();onComplete?.();return;}
      try{
        // One atmospheric first pull, then quiet, shorter entrances. In-paper
        // read/source changes keep the sheet still: only its contents turn.
        if(!fresh || compact){
          clear();
          if(fresh){G.set(dialog,{y:16,scale:.975,opacity:0});G.set(sheet,{rotationX:2,transformPerspective:1200});}
          else G.set(parts,{y:4,opacity:.35});
          G.set(fresh ? [dialog,sheet] : parts,{willChange:'transform,opacity'});
          timeline=G.timeline({onComplete(){settle();onComplete?.();}});
          if(fresh){
            timeline.to(dialog,{y:0,scale:1,opacity:1,duration:.48,ease:'power2.out'},0)
              .to(sheet,{rotationX:0,duration:.48,ease:'sine.out'},0)
              .to(veil,{opacity:1,duration:.32,ease:'sine.out'},0);
          }else timeline.to(parts,{y:0,opacity:1,duration:.22,ease:'sine.out'},0);
          return;
        }
        const base=baseCenter(),dx=origin?origin.x-base.x:0,dy=origin?origin.y-base.y:32,side=dx<0?-1:1;
        if(fresh){
          G.set(dialog,{x:dx,y:dy,scale:origin ? .12 : .96,rotation:side*5,opacity:0});
          G.set(sheet,{rotationX:7,rotationY:-side*9,transformPerspective:1200});
          G.set(parts,{y:7,opacity:0});G.set(motif,{x:8});
          G.set(light,{xPercent:-55,opacity:0});G.set(shade,{opacity:.16});
        }
        const start={x:value(dialog,'x'),y:value(dialog,'y')};
        G.set([dialog,sheet],{willChange:'transform'});G.set(veil,{willChange:'opacity'});
        timeline=G.timeline({onComplete(){settle();veil.style.willChange='';onComplete?.();}});
        travel(start,{x:0,y:0},1.22,origin?34:4,'power2.out');
        timeline.to(dialog,{scale:1,rotation:0,duration:1.22,ease:'power3.out'},0)
          .to(dialog,{opacity:1,duration:.28,ease:'sine.out'},0)
          .to(veil,{opacity:1,duration:.6,ease:'sine.out'},0)
          .to(sheet,{rotationX:0,rotationY:0,duration:1.05,ease:'power2.out'},.12)
          .to(parts,{y:0,opacity:1,duration:.48,stagger:.045,ease:'sine.out'},fresh ? .38 : 0)
          .to(motif,{x:0,duration:.85,ease:'sine.out'},.25)
          .to(shade,{opacity:0,duration:.9,ease:'sine.out'},.14)
          .to(light,{opacity:.24,duration:.24,ease:'sine.out'},.16)
          .to(light,{xPercent:45,duration:1.05,ease:'sine.inOut'},.16)
          .to(light,{opacity:0,duration:.55,ease:'sine.inOut'},.65);
      }catch{settle();onComplete?.();}
    }
    function leave({origin,compact=false,onComplete}){
      // Killing the timeline preserves the current pose, including a half-open sheet.
      stop();
      if(!G||matchMedia('(prefers-reduced-motion: reduce)').matches){reset();onComplete?.();return;}
      try{
        const base=baseCenter(),start={x:value(dialog,'x'),y:value(dialog,'y')};
        const end=origin?{x:origin.x-base.x,y:origin.y-base.y}:{x:0,y:26};
        const side=end.x<0?-1:1,duration=compact ? .38 : .38+.32*Math.min(1,value(dialog,'scaleX',1));
        G.set([dialog,sheet],{willChange:'transform'});G.set(veil,{willChange:'opacity'});
        timeline=G.timeline({onComplete(){reset();onComplete?.();}});
        travel(start,end,duration,origin?24:3,'power2.inOut');
        timeline.to(dialog,{scale:origin ? .07 : .96,rotation:side*4,duration,ease:'power2.inOut'},0)
          .to(dialog,{opacity:0,duration:duration*.4,ease:'sine.in'},duration*.6)
          .to(veil,{opacity:0,duration,ease:'sine.inOut'},0)
          .to(sheet,{rotationX:5,rotationY:side*10,duration,ease:'sine.inOut'},0)
          .to(light,{opacity:0,duration:.15},0)
          .to(shade,{opacity:.14,duration,ease:'sine.in'},0);
      }catch{reset();onComplete?.();}
    }
    return {enter,leave,settle,reset};
  }};
})();
