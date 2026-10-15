(function(){
  'use strict';const host=document.getElementById('er-panel');if(!host)return;
  const $=id=>document.getElementById('er-'+id);let api,resource,report=null,epoch=0,busy=false,dirty=false;
  function reset(message='点击“检查已保存资料”，查看这份导览还缺什么。',edited=false){
    epoch++;report=null;dirty=edited;$('results').replaceChildren();$('all').replaceChildren();$('status').textContent=message;$('export').hidden=true;
  }
  const append=(parent,tag,text)=>{const el=document.createElement(tag);el.textContent=text;parent.append(el);return el;};
  function render(value){
    $('results').replaceChildren();
    $('all').replaceChildren();
    append($('all'),'p',value.basis+' · 修订 '+value.revision+' · '+new Date(value.checkedAt).toLocaleString('zh-CN'));
    const reminders=append($('all'),'ul','');for(const note of value.global)append(reminders,'li',note);
    for(const note of value.global.filter(n=>/^(尚未|公开导览已暂停|当前发布记录已到|画卷中)/.test(n)))append($('results'),'p',note);
    for(const point of value.points){
      const gaps=point.checks.filter(c=>c.state==='needs').length;
      if(gaps)renderPoint($('results'),point,point.checks.filter(c=>c.state==='needs'),true);
      renderPoint($('all'),point,point.checks,false);
    }
    $('status').textContent=value.needs?'有 '+value.needs+' 项需补齐或复核。':'暂无必补缺项；不代表审核通过。';
    $('export').hidden=false;
  }
  function renderPoint(parent,point,checks,open){
      const details=append(parent,'details','');details.open=open;
      append(details,'summary',point.order+' · '+point.title+(open?' · '+checks.length+' 项需处理':''));
      const list=append(details,'dl','');
      for(const check of checks){
        const row=append(list,'div','');row.dataset.state=check.state;
        append(row,'dt',check.label+' · '+({recorded:'有记录，待人工核对',needs:'需补齐或复核',optional:'可后补'}[check.state]));
        append(row,'dd',check.note);
        const link=append(row,'a','前往处理 →');link.href='#'+check.target;
        link.onclick=e=>{e.preventDefault();const target=document.getElementById(check.target);if(target){if(window.JourneyAdminPaper?.openTarget(target))return;for(let el=target.parentElement;el;el=el.parentElement)if(el.tagName==='DETAILS')el.open=true;target.tabIndex=-1;target.scrollIntoView({block:'start'});target.focus({preventScroll:true});}};
      }
  }
  async function read(){
    if(!api||busy)return null;
    if(dirty){$('status').textContent='页面有未保存的修改，请先保存或重新打开导览，再检查。';return null;}
    const id=resource(),token=++epoch;let timeout;busy=true;report=null;$('export').hidden=true;$('results').replaceChildren();$('all').replaceChildren();$('status').textContent='正在读取已保存的观察材料与登记素材……';$('check').disabled=true;
    try{
      const [snapshot,assets]=await Promise.race([
        Promise.all([api.call({action:'getSiteWalkDraft',resourceId:id}),api.call({action:'getExplorationAssets',resourceId:id})]),
        new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('读取超时，请重试。')),12000);})
      ]);
      if(token!==epoch||id!==resource())return null;
      report=ChuExplorationReadiness.project(snapshot,assets,id);render(report);return report;
    }catch(error){if(token===epoch){reset('未完成检查：'+error.message);}}
    finally{clearTimeout(timeout);busy=false;$('check').disabled=false;}
    return null;
  }
  $('check').onclick=read;
  $('export').onclick=async()=>{
    // Re-read before export, rather than handing an old report to the field team.
    if(!report)return;const value=await read();if(!value)return;
    const url=URL.createObjectURL(new Blob([ChuExplorationReadiness.packet(value)],{type:'text/plain;charset=utf-8'})),a=document.createElement('a');
    a.href=url;a.download='导览现场资料采集单.txt';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    $('status').textContent='已导出现场采集单。没有发布内容，也没有上传采集记录。';
  };
  window.SiteWalkReadiness={connect(a,r){api=a;resource=r;},reset(){reset();},invalidate(){reset('页面内容已变化，请先保存或重新打开，再检查。',true);}};
})();
