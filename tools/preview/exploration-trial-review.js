(function(){
  'use strict';
  const D=window.ChuTrialReviewData,$=id=>document.getElementById(id);
  const labels={start:{alone:'自己开始',help:'需要提示',lost:'没找到入口',unanswered:'未回答'},reading:{clear:'清楚易懂',mixed:'部分费解',hard:'不易理解',unanswered:'未回答'},memory:{yes:'记住了',unsure:'不确定',no:'还没有',unanswered:'未回答'}};
  let entries=[],groups=[],selected='',sequence=0,demo=false,busy=false,epoch=0,pendingRead=null;
  function el(tag,text,className){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e;}
  function status(text){$('status').textContent=text;}
  function setBusy(value){busy=value;$('cancel').hidden=!value;for(const id of ['sample','import','export','clear','files','groups'])$(id).disabled=value;for(const checkbox of $('records').querySelectorAll('input'))checkbox.disabled=value;}
  function readFile(file){return new Promise((resolve,reject)=>{
    const reader=new FileReader();let done=false,timer;
    const finish=(error,text)=>{if(done)return;done=true;clearTimeout(timer);reader.onload=reader.onerror=reader.onabort=null;if(pendingRead===cancel)pendingRead=null;error?reject(error):resolve(text);};
    const cancel=()=>{try{reader.abort();}finally{finish(Error('读取已取消'));}};
    pendingRead=cancel;reader.onload=()=>finish(null,reader.result);reader.onerror=reader.onabort=()=>finish(Error('读取未完成'));
    timer=setTimeout(cancel,8000);
    try{reader.readAsText(file,'UTF-8');}catch(error){finish(error);}
  });}
  function render(){
    groups=D.group(entries.map(({id,report,excluded})=>({id,report,excluded})));if(!groups.some(g=>g.key===selected))selected=groups[0]?.key||'';
    $('workspace').hidden=!groups.length;$('empty').hidden=!!groups.length;$('sample-notice').hidden=!demo;
    $('groups').replaceChildren(...groups.map((g,i)=>{const option=el('option',`${i+1} · ${g.resourceId} / 第${g.version}版`);option.value=g.key;option.selected=g.key===selected;return option;}));
    const group=groups.find(g=>g.key===selected);if(!group)return;
    $('group-kind').textContent=group.localTest?'导出声明：本地测试':'导出声明：非本地测试 · 来源未核实';
    $('identity').textContent=group.resourceId+' · 第 '+group.version+' 版';
    $('basis').textContent='内容指纹：'+group.fingerprint;
    $('totals').textContent=`计入 ${group.includedReports} 份 · 暂不计入 ${group.excludedReports} 份`;
    $('answers').replaceChildren(...[['start','能否开始'],['reading','是否读懂'],['memory','有无记住']].map(([key,title])=>{
      const section=el('section',undefined,'answer'),dl=el('dl');section.append(el('h3',title));
      for(const [value,label]of Object.entries(labels[key])){const row=el('div');row.append(el('dt',label),el('dd',String(group.counts[key][value])));dl.append(row);}section.append(dl);return section;
    }));
    const byId=new Map(entries.map(e=>[e.id,e]));
    const priority=id=>{const a=byId.get(id).report.answers;return(a.start==='lost'?3:a.start==='help'?1:0)+(a.reading==='hard'?3:a.reading==='mixed'?1:0);};
    const notes=group.obstacles.slice().sort((a,b)=>priority(b.entryId)-priority(a.entryId));
    $('notes-count').textContent=notes.length+' 条原话';
    $('notes').replaceChildren(...(notes.length?notes.map(n=>{
      const entry=byId.get(n.entryId),article=el('article',undefined,'opinion'),a=entry.report.answers;
      article.append(el('p','记录 '+entry.number+' · '+[labels.start[a.start]||'开始未答',labels.reading[a.reading]||'理解未答'].join(' / '),priority(n.entryId)?'marker':''),el('blockquote',n.text));return article;
    }):[el('p',group.includedReports?'这版没有填写文字意见，可以先核对上方的选择。':'本版记录均暂不计入；勾选下方记录即可恢复。','no-notes')]));
    $('duplicates').textContent=group.possibleDuplicateReports?group.possibleDuplicateReports+' 份内容相同，待人工核对':'暂无内容相同的记录';
    $('records').replaceChildren(...group.entries.map(item=>{
      const entry=byId.get(item.id),label=el('label',undefined,'record'+(item.excluded?' is-excluded':'')),input=el('input');input.type='checkbox';input.checked=!item.excluded;input.dataset.entry=item.id;input.setAttribute('aria-label','计入记录 '+entry.number);
      const text=el('span','记录 '+entry.number+' · '+(item.excluded?'暂不计入':'已计入'));text.append(el('small',item.possibleDuplicate?'与记录 '+item.duplicateOf.map(id=>byId.get(id).number).join('、')+' 内容相同':'本机读入；不代表独立游客'));
      input.addEventListener('change',()=>{entry.excluded=!input.checked;render();$('records').querySelector('[data-entry="'+entry.id+'"]').focus();status('已更新计数；原记录保留，可重新勾选。');});label.append(input,text);return label;
    }));
  }
  function add(report){sequence++;entries.push({id:'record-'+sequence,number:sequence,report,excluded:false});}
  $('import').onclick=()=>{if(!busy)$('files').click();};
  $('files').onchange=async()=>{
    if(busy)return;const files=Array.from($('files').files||[]);$('files').value='';if(!files.length)return;
    $('errors').replaceChildren();$('errors').hidden=true;
    const base=demo?0:entries.length;
    if(base+files.length>100){status('本页最多读入 100 份；请减少所选文件，或先导出摘要再清空。');return;}
    if(files.reduce((sum,file)=>sum+file.size,0)>5*1024*1024){status('本次文件合计超过 5 MB，请减少文件后再试。');return;}
    const token=++epoch;setBusy(true);status('正在本机读取，不会上传……');
    const accepted=[],errors=[];
    try{
      for(let i=0;i<files.length;i++){
        const file=files[i];
        if(file.size>D.MAX_BYTES){errors.push('所选第 '+(i+1)+' 个文件超过 64 KB，未读入。');continue;}
        try{const text=await readFile(file);if(token!==epoch)return;accepted.push(D.parse(text));}catch{if(token!==epoch)return;errors.push('所选第 '+(i+1)+' 个文件格式不符、读取失败或超时，未读入。请使用游客端原始反馈 JSON。');}
      }
      if(accepted.length){if(demo){entries=[];sequence=0;selected='';demo=false;}accepted.forEach(add);render();}
      $('errors').replaceChildren(...errors.map(text=>el('li',text)));$('errors').hidden=!errors.length;
      status(`本次读入 ${accepted.length} 份，未读入 ${errors.length} 份。`+(accepted.length?'仅保存在当前页面。':'原有记录未变。'));
    }finally{if(token===epoch){setBusy(false);$('import').focus();}}
  };
  $('cancel').onclick=()=>{if(!busy)return;epoch++;pendingRead?.();setBusy(false);status('本次读取已取消，本批文件未计入；原有记录未变。');$('import').focus();};
  $('groups').onchange=()=>{selected=$('groups').value;render();$('basis').hidden=true;$('basis-toggle').setAttribute('aria-expanded','false');status('已切换版本；不与其他版本混算。');};
  $('basis-toggle').onclick=()=>{const open=$('basis').hidden;$('basis').hidden=!open;$('basis-toggle').setAttribute('aria-expanded',String(open));};
  function reset(){entries=[];groups=[];selected='';sequence=0;demo=false;$('errors').replaceChildren();$('errors').hidden=true;$('basis').hidden=true;$('basis-toggle').setAttribute('aria-expanded','false');render();}
  $('clear').onclick=()=>{if(busy||!confirm('清空当前页面的记录？尚未导出的计数将不再保留，原 JSON 文件不会被删除。'))return;reset();status('本页记录已清空，原文件未改动。');$('import').focus();};
  $('sample').onclick=()=>{
    if(busy)return;if(entries.length&&!confirm('示例将替换当前页的记录。请先导出需要的摘要；原 JSON 文件不会被改动。继续吗？'))return;
    reset();demo=true;
    const sample=(fp,answers)=>({schemaVersion:1,kind:'reading-trial-feedback',localTest:true,resourceId:'hhl-review-example',version:1,fingerprint:fp.repeat(64),reading:{recorded:2,total:4},answers:{start:'alone',reading:'clear',memory:'yes',obstacle:'',...answers},scope:D.SCOPE});
    const a=sample('a',{start:'help',reading:'mixed',obstacle:'【示例】看完第一景后，希望能更快找到下一景。'});
    [a,a,sample('a',{obstacle:'【示例】出处很清楚，想在读完后再回看一遍。'}),sample('b',{reading:'',memory:'unsure',obstacle:'【示例】这份是另一内容版本，不应混在一起汇总。'})].forEach(r=>add(D.parse(JSON.stringify(r))));
    render();status('已载入 4 份演示记录、2 个内容版本；仅用于体验本页。');
  };
  $('export').onclick=()=>{
    if(busy||!entries.length)return;
    const summary={...D.summary(groups),exampleOnly:demo};
    const url=URL.createObjectURL(new Blob([JSON.stringify(summary,null,2)],{type:'application/json;charset=utf-8'}));
    const link=el('a');link.href=url;link.download=demo?'画卷复盘计数-仅示例.json':'画卷复盘计数.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    status('计数摘要已交给浏览器下载；不含原始意见，记录仍保留在本页。');
  };
  if(!D){status('本地复盘模块未加载，请刷新或重新启动预览。');setBusy(true);$('cancel').hidden=true;return;}
  render();
})();
