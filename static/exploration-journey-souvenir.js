(function(root,factory){
  'use strict';
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.ChuJourneySouvenir=api;
})(globalThis,function(root){
  'use strict';
  // This is an explicit, local composition of the existing illustration and the
  // reader's own text. It is not a record of a visit, a reward or a shared file.
  const colors=Object.freeze({paper:'#eee1c7',light:'#f3e6ca',ink:'#302b22',muted:'#74634d',night:'#202b23',rust:'#864730'});
  const assets=Object.freeze({art:'static/assets/exploration-motion/hhl-full-park-v2.webp',paper:'static/assets/paper-fibres-soft-v1.webp'});
  const id=value=>typeof value==='string'&&/^[\w-]{1,128}$/.test(value);
  const text=(value,max)=>typeof value==='string'&&value.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
  function project(raw){
    if(!raw||!text(raw.title,160)||!raw.title.trim()||!Number.isInteger(raw.version)||raw.version<1||
      !Array.isArray(raw.points)||!raw.points.length||raw.points.length>12||!text(raw.note||'',120))throw Error('阅读记录还未准备好，请重新读取后再保存。');
    const ids=new Set();
    const points=raw.points.map(point=>{
      if(!point||!id(point.id)||ids.has(point.id)||!text(point.title,120)||!point.title.trim())throw Error('景物记录不完整，请重新读取后再保存。');
      ids.add(point.id);return {id:point.id,title:point.title};
    });
    const observed=Array.isArray(raw.observed)?[...new Set(raw.observed.filter(value=>ids.has(value)))]:[];
    const seen=new Set(),details=[];
    if(raw.details!=null&&!Array.isArray(raw.details))throw Error('观察记录需要重新核对。');
    for(const detail of raw.details||[]){
      if(!detail||!ids.has(detail.pointId)||!text(detail.label,80)||!detail.label.trim())continue;
      const key=detail.pointId+'\n'+detail.label;
      if(!seen.has(key)){seen.add(key);details.push({pointId:detail.pointId,label:detail.label});}
      if(details.length>24)throw Error('观察记录过长，可先保存游记文字。');
    }
    return {title:raw.title,version:raw.version,localTest:raw.localTest===true,points,observed,note:raw.note||'',details};
  }
  function graphemes(value){
    return typeof Intl?.Segmenter==='function'?[...new Intl.Segmenter('zh',{granularity:'grapheme'}).segment(value)].map(part=>part.segment):Array.from(value);
  }
  // Keep every grapheme, including emoji, and explicit line breaks. Dynamic
  // notes never become HTML, a URL, a font name or a filesystem filename.
  function wrap(value,measure,width){
    if(typeof value!=='string'||!Number.isFinite(width)||width<=0)throw Error('无效的文字布局');
    const result=[];
    for(const paragraph of value.replace(/\r\n?/g,'\n').split('\n')){
      let line='';
      for(const part of graphemes(paragraph)){
        if(line&&measure(line+part)>width){result.push(line);line='';}
        line+=part;
      }
      result.push(line);
    }
    return result;
  }
  function create(options){
    const {button,status,verify,getData,canInteract=()=>true}=options||{};
    if(!button||typeof verify!=='function'||typeof getData!=='function'||!root.document)return null;
    const document=root.document,originalLabel=button.textContent;
    let revision=0,busy=false,destroyed=false;
    const cancellations=new Set(),urls=new Map();
    function announce(message){if(typeof status==='function')status(message);else if(status)status.textContent=message;}
    function available(token){return !destroyed&&token===revision&&canInteract()&&!document.hidden;}
    function restore(){busy=false;button.disabled=false;button.removeAttribute('aria-busy');button.textContent=originalLabel;}
    function cancel(){for(const close of [...cancellations])close();cancellations.clear();}
    function revoke(){for(const [url,timer] of urls){root.clearTimeout(timer);root.URL.revokeObjectURL(url);}urls.clear();}
    function reset(){revision++;cancel();revoke();restore();announce('');}
    function assertCurrent(token,snapshot){
      if(!available(token))throw Error('cancelled');
      if(snapshot&&JSON.stringify(project(getData()))!==snapshot)throw Error('内容已变化，请再次点击保存图片。');
    }
    async function check(token,snapshot){
      assertCurrent(token,snapshot);
      if(await verify()!==true)throw Error('资料暂不可用，未生成图片。请重新读取。');
      assertCurrent(token,snapshot);
    }
    function wait(task,timeout,message){
      return new Promise((resolve,reject)=>{
        let done=false,timer;
        const end=(error,value)=>{if(done)return;done=true;root.clearTimeout(timer);cancellations.delete(close);error?reject(error):resolve(value);};
        const close=()=>end(Error('cancelled'));
        cancellations.add(close);timer=root.setTimeout(()=>end(Error(message)),timeout);
        Promise.resolve(task).then(value=>end(null,value),error=>end(error));
      });
    }
    function loadImage(path){
      return new Promise((resolve,reject)=>{
        let done=false,timer;const image=new root.Image();
        const end=(error)=>{
          if(done)return;done=true;root.clearTimeout(timer);cancellations.delete(close);image.onload=null;image.onerror=null;
          if(error){image.removeAttribute('src');reject(error);}else resolve(image);
        };
        const close=()=>end(Error('cancelled'));
        cancellations.add(close);timer=root.setTimeout(()=>end(Error('画稿加载较慢，请重试或保存游记文字。')),10000);
        image.onload=()=>end(image.naturalWidth&&image.naturalHeight?null:Error('画稿不可用，请改用游记文字。'));
        image.onerror=()=>end(Error('画稿未能载入，请重试或保存游记文字。'));
        // Fixed same-origin assets only; payloads cannot supply a remote image.
        image.src=new URL(path,root.location.href).href;
      });
    }
    function compose(data,art,paper,brush){
      const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
      if(!ctx)throw Error('浏览器暂不支持生成图片，请保存游记文字。');
      const width=960,margin=60,inner=width-margin*2,body='"Songti SC","SimSun",serif',utility='system-ui,"Microsoft YaHei",sans-serif';
      const blocks=[];let y=582;
      function block(value,size,lineHeight,color,gap=20,font=body){
        ctx.font=size+'px '+font;
        const lines=wrap(value,s=>ctx.measureText(s).width,inner);
        blocks.push({lines,size,lineHeight,color,font,y});y+=lines.length*lineHeight+gap;
      }
      block(data.title,34,49,colors.ink,26);
      block('第 '+data.version+' 版 · 阅读留念',22,34,colors.muted,26,utility);
      block('我记下的景物',24,36,colors.rust,8,utility);
      const titles=data.points.filter(point=>data.observed.includes(point.id)).map(point=>point.title);
      block(titles.length?titles.join(' · '):'尚未主动记下景物',30,46,colors.ink,28);
      if(data.details.length){
        block('留意过的细节',24,36,colors.rust,8,utility);
        for(const detail of data.details){
          const point=data.points.find(point=>point.id===detail.pointId);
          block(point.title+' · '+detail.label,27,42,colors.ink,10);
        }
        y+=18;
      }
      if(data.note){block('写给这一卷',24,36,colors.rust,8,utility);block(data.note,30,48,colors.ink,30);}
      const footerY=y+20,height=Math.max(1120,footerY+150);
      if(height>4096)throw Error('这份拾记内容较长，请先保存游记文字。');
      canvas.width=width;canvas.height=height;
      ctx.fillStyle=colors.light;ctx.fillRect(0,0,width,height);
      if(paper){ctx.save();ctx.globalAlpha=.22;ctx.fillStyle=ctx.createPattern(paper,'repeat');ctx.fillRect(0,0,width,height);ctx.restore();}
      ctx.fillStyle=colors.muted;ctx.font='24px '+utility;ctx.fillText('楚韵链迹 / 一卷随行',margin,52);
      ctx.fillStyle=colors.ink;ctx.font='52px '+(brush?'ChuJourneyDisplay,':'')+body;ctx.fillText('阅读拾记',margin,126);
      ctx.textAlign='right';ctx.font='22px '+utility;ctx.fillStyle=colors.rust;
      if(data.localTest)ctx.fillText('待审样章 · 非现场导览',width-margin,120);
      ctx.textAlign='left';
      const artTop=166,artHeight=inner*art.naturalHeight/art.naturalWidth;
      ctx.drawImage(art,margin,artTop,inner,artHeight);
      const fade=ctx.createLinearGradient(0,artTop+artHeight-90,0,artTop+artHeight);
      fade.addColorStop(0,'#f3e6ca00');fade.addColorStop(1,colors.light);
      ctx.fillStyle=fade;ctx.fillRect(margin,artTop+artHeight-90,inner,90);
      for(const item of blocks){ctx.font=item.size+'px '+item.font;ctx.fillStyle=item.color;item.lines.forEach((line,index)=>ctx.fillText(line,margin,item.y+index*item.lineHeight));}
      const bottom=height-106;
      ctx.fillStyle=colors.muted;ctx.font='20px '+utility;
      ctx.fillText('艺术画稿 · 阅读留念，非到访凭证',margin,bottom);
      ctx.fillText('画稿：楚韵链迹 · AI 辅助创作',margin,bottom+34);
      ctx.fillText('仅在本机生成，未上传',margin,bottom+68);
      return canvas;
    }
    async function exportImage(){
      if(busy||destroyed||!canInteract()||document.hidden)return false;
      const token=++revision;busy=true;button.disabled=true;button.setAttribute('aria-busy','true');button.textContent='正在制笺…';announce('正在生成图片，内容只在本机处理。');
      try{
        await check(token);
        const data=project(getData()),snapshot=JSON.stringify(data);
        const fonts=document.fonts?.load?wait(document.fonts.load('52px ChuJourneyDisplay','阅读拾记'),2500,'font timeout').then(faces=>faces.length>0).catch(()=>false):Promise.resolve(false);
        const [art,paper,brush]=await Promise.all([loadImage(assets.art),loadImage(assets.paper).catch(()=>null),fonts]);
        await check(token,snapshot);
        const canvas=compose(data,art,paper,brush);
        const blob=await wait(new Promise((resolve,reject)=>{
          if(typeof canvas.toBlob!=='function'){reject(Error('浏览器暂不支持保存图片，请保存游记文字。'));return;}
          canvas.toBlob(value=>value&&value.size&&value.type==='image/png'?resolve(value):reject(Error('图片生成失败，请重试或保存游记文字。')),'image/png');
        }),10000,'图片生成较慢，请重试或保存游记文字。');
        // Even a late encoding result cannot bypass source/version revalidation.
        await check(token,snapshot);
        const url=root.URL.createObjectURL(blob),link=document.createElement('a');
        urls.set(url,root.setTimeout(()=>{root.URL.revokeObjectURL(url);urls.delete(url);},1000));
        link.href=url;link.download='我的画卷拾记.png';document.body.append(link);link.click();link.remove();
        announce('已生成图片并发起下载；未上传。');return true;
      }catch(error){
        if(available(token))announce(error?.message&&error.message!=='cancelled'?error.message:'已取消生成；没有下载图片。');
        return false;
      }finally{if(token===revision){cancel();restore();}}
    }
    const click=()=>{void exportImage();};button.addEventListener('click',click);
    function hide(){if(document.hidden)reset();}
    document.addEventListener('visibilitychange',hide);root.addEventListener('pagehide',reset);
    function destroy(){reset();destroyed=true;button.removeEventListener('click',click);document.removeEventListener('visibilitychange',hide);root.removeEventListener('pagehide',reset);}
    return {reset,destroy,exportImage};
  }
  return Object.freeze({project,wrap,create});
});
