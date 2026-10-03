(function () {
  let draft = null, search = null, epoch = 0;
  const esc = x => escapeHtml(String(x ?? ''));
  const host = () => document.getElementById('guide-official-panel');
  function draw(note = '') {
    const panel = host(); if (!panel) return;
    if(draft?.status==='published'){panel.innerHTML='<h4>官网依据</h4><p>核对官网原文是否有变化；发现变化后停止使用旧依据。</p><button type="button" id="go-refresh">重新核对官网</button><p class="muted">'+esc(note)+'</p>';return;}
    const first = new Set();
    panel.innerHTML = '<h4>为讲解寻找官网依据</h4><p>自动在已登记的政府、文旅、博物馆及文保机构官网资料中匹配原文。只检索已保存的草稿；候选仍需核对是否支持这段话。</p><button type="button" id="go-search">寻找官网原文</button><p class="muted">' + esc(note) + '</p>' + (search ?
      '<p>' + (search.simulated ? '本地模拟候选，不能正式发布。' : '已查 ' + search.searchedPages + ' 篇目录文章。') + '找到 ' + search.items.length + ' 段候选；未找到不等于内容错误。</p>' +
      search.items.map(item => { const selected = !first.has(item.claimId); first.add(item.claimId); return '<div class="guide-source"><label><input type="checkbox" data-go-choice="' + esc(item.id) + '" ' + (selected ? 'checked' : '') + '>用于这项事实：' + esc(item.claimText) + '</label><blockquote>' + esc(item.quote) + '</blockquote><p><a href="' + esc(item.url) + '" target="_blank" rel="noopener noreferrer">' + esc(item.publisher + ' · ' + item.title) + '</a> · 提取段落 ' + item.paragraph + '</p><small>获取于 ' + esc(item.retrievedAt.slice(0,10)) + '；补充官网资料，与用户原始投稿分别保留。</small></div>'; }).join('') +
      (search.failures.length ? '<p>部分官网暂时无法读取，未用摘要冒充原文。</p>' : '') +
      (search.items.length ? '<label><input type="checkbox" id="go-reviewed">已核对选中原文支持对应讲解，且允许公开这些节选（随整稿审核一并确认）</label>' : '') : '');
  }
  window.GuideOfficial = {
    mount(value) {
      const token = ++epoch; draft = value; search = null;
      if (!draft || !['draft','published'].includes(draft.status)) return;
      const panel = document.createElement('section'); panel.id = 'guide-official-panel'; panel.className = 'guide-safety';
      document.getElementById('guide-editor').after(panel); draw();
      if(draft.status==='published')return;
      callAdmin({action:'getGuideOfficialSources',fragmentId:draft.id,revision:draft.revision}).then(r => {if(token!==epoch)return; search=r.search; draw(r.note + (r.enabled ? '' : ' 当前环境检索开关未开启。'));}).catch(()=>{if(token===epoch)draw('尚未读取到检索记录；原有审核功能仍可使用。');});
    },
    review() {
      if (!search) return undefined;
      return {searchId:search.id,selectedIds:[...document.querySelectorAll('[data-go-choice]:checked')].map(n=>n.dataset.goChoice),supportReviewed:document.getElementById('go-reviewed')?.checked===true,publicExcerptAllowed:document.getElementById('go-reviewed')?.checked===true};
    }
  };
  document.addEventListener('click',async e=>{const button=e.target.closest('#go-search');if(!button||!draft)return;button.disabled=true;const token=epoch;
    try {const r=await callAdmin({action:'searchGuideOfficialSources',fragmentId:draft.id,revision:draft.revision});if(token!==epoch)return;search=r.search;draw(r.cached?'复用同一草稿的近期原文记录；无需重复请求。':'原文候选已准备好，请在发布时一并核对。');}
    catch(err){if(token===epoch)draw(err.message||'官网检索暂时不可用');}
    finally{if(button.isConnected)button.disabled=false;}
  });
  document.addEventListener('click',async e=>{const button=e.target.closest('#go-refresh');if(!button||!draft)return;button.disabled=true;const token=epoch;try{const r=await callAdmin({action:'refreshGuideOfficialSources',fragmentId:draft.id,revision:draft.revision});if(token===epoch)draw(r.message);}catch(err){if(token===epoch)draw(err.message||'暂时无法核对官网');}finally{if(button.isConnected)button.disabled=false;}});
})();
