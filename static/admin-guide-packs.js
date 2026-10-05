(function () {
  const anchor = document.getElementById('story-themes-refresh');
  if (!anchor) return;
  const nav = document.createElement('button');
  nav.type = 'button'; nav.className = anchor.className; nav.textContent = '讲解包导入'; nav.dataset.adminView = 'guide-pack'; anchor.after(nav);
  const box = document.getElementById('list');
  const esc = value => escapeHtml(String(value ?? ''));
  let catalog, preview, draft, draftRead = 0, previewRead = 0, current = () => false;
  const call = data => callAdmin(data);
  const status = s => ({draft:'待审核',published:'已发布',archived:'已停止公开'}[s] || s);
  const msg = text => { if (current()) message.textContent = text; };
  async function open() {
    const active = setActiveView('guide-pack', '讲解包导入'); current = active; preview = null; draft = null; draftRead++; previewRead++;
    box.innerHTML = '<section class="guide-card" role="status">正在读取讲解包…</section>';
    viewCount.textContent = '';
    try { const data = await call({action:'getGuidePackCatalog'}); if (!active()) return; catalog = data; render(); }
    catch (e) { if (active()) { box.textContent = '讲解包暂时无法读取，请重试。'; msg(e.message); } }
  }
  function selection() { return catalog.records.find(r => r.id === document.getElementById('gp-point')?.value); }
  function render() {
    box.innerHTML = '<div class="guide-card"><h3>把讲解配置到点位</h3><p>先预览点位与资料，再导入待审稿。核对后发布，游客才能阅读。不会调用模型或创建用户投稿。</p>' +
      '<label>讲解包点位<select id="gp-point">' + catalog.records.map(r => '<option value="'+esc(r.id)+'">'+esc(r.title+' · '+r.statusMeaning)+'</option>').join('') + '</select></label>' +
      '<label>对应的网站点位<select id="gp-resource"><option value="">请选择已发布的实体点位</option>' + catalog.resources.map(r=>'<option value="'+esc(r.id)+'">'+esc(r.title)+'</option>').join('') + '</select></label>' +
      '<p class="muted">没有对应点位时，先在资源管理中建立正确资源。这里不会把背景资料或名称不明的地点直接导入。</p>' +
      '<button type="button" id="gp-preview">预览匹配与讲解</button><div id="gp-preview-box" aria-live="polite"></div></div>' +
      '<div class="guide-card"><h3>已导入的讲解</h3><div id="gp-drafts">' + (catalog.fragments.length ? catalog.fragments.map(f=>'<button type="button" data-gp-edit="'+esc(f.id)+'">'+esc(f.title)+' · '+esc(status(f.status))+'</button>').join('') : '<p>还没有导入。先选择一个点位预览。</p>') + '</div></div><section id="gp-editor"></section>';
    const first = selection(); document.getElementById('gp-resource').value = first?.resourceId || '';
  }
  function showPreview() {
    const p = preview;
    document.getElementById('gp-preview-box').innerHTML = '<h4>'+esc(p.record.title)+'</h4><p>'+esc(p.record.scope)+'</p><p>'+esc(p.reason || ('将关联到：'+p.resource.title))+'</p>' +
      p.record.narrations.map(d=>'<details><summary>'+esc(d.interest)+'版讲解</summary><p>'+esc(d.sentences.map(s=>s.text).join(''))+'</p></details>').join('')+
      '<p>'+esc(p.record.gaps.join('；'))+'</p><p>'+p.sources.map(s=>'<a href="'+esc(s.url)+'" target="_blank" rel="noopener noreferrer">'+esc(s.publisher+' · '+s.title)+'</a>').join('<br>')+'</p>'+
      (p.canImport?'<label><input id="gp-binding" type="checkbox"> 我确认资料与所选点位是同一个对象</label><button type="button" id="gp-import">导入待审核草稿</button>':'');
  }
  function editData() {
    return {title:document.getElementById('gp-title').value.trim(),interests:document.getElementById('gp-interests').value.split(/[,，]/).map(x=>x.trim()).filter(Boolean),
      sentences:draft.sentences.map((s,i)=>({text:box.querySelector('[data-gp-sentence="'+i+'"]').value.trim(),claimIds:[...box.querySelectorAll('[data-gp-ref="'+i+'"]:checked')].map(n=>n.value)}))};
  }
  function unchanged() {
    const data = editData();
    return data.title === draft.title && JSON.stringify(data.sentences)===JSON.stringify(draft.sentences) && JSON.stringify(data.interests)===JSON.stringify(draft.interests);
  }
  function showDraft() {
    const d=draft, claims=d.reviewEvidence.claims;
    document.getElementById('gp-editor').innerHTML = '<div class="guide-card"><h3>'+esc(d.title)+' · '+esc(status(d.status))+'</h3>' +
      '<p>先改稿并保存，再核对发布。仅展示整理稿与原网页链接；不把整理内容标成官网原文。</p>'+(d.visitNotice?'<p>'+esc(d.visitNotice)+'</p>':'')+
      '<label>讲解标题<input id="gp-title" maxlength="100" value="'+esc(d.title)+'"></label>'+
      '<label>兴趣标签（通用版留空）<input id="gp-interests" value="'+esc(d.interests.join('，'))+'"></label>'+
      d.sentences.map((s,i)=>'<fieldset><legend>第 '+(i+1)+' 句</legend><textarea aria-label="第 '+(i+1)+' 句讲解" data-gp-sentence="'+i+'" maxlength="200" rows="3">'+esc(s.text)+'</textarea><details><summary>核对这一句的事实依据</summary>'+
        claims.map(c=>'<label><input type="checkbox" data-gp-ref="'+i+'" value="'+esc(c.id)+'" '+(s.claimIds.includes(c.id)?'checked':'')+'>'+esc(c.text)+'</label>').join('')+'</details></fieldset>').join('')+
      '<button type="button" id="gp-save">保存修改</button><h4>核对来源</h4><p>请打开每个原网页，确认仍可用、支持这些事实。核对有效期为7天，过期后讲解自动隐藏，可重新核对发布。</p>'+
      d.reviewEvidence.sources.map(s=>'<fieldset><legend>'+esc(s.publisher)+'</legend><a href="'+esc(s.url)+'" target="_blank" rel="noopener noreferrer">'+esc(s.title)+'</a><p>'+esc(s.origin?'官方转载，原来源：'+s.origin:'官方机构页面')+'</p><p>核对位置：'+esc(s.section)+'</p><p>资料摘要（不是原文）：'+esc(s.excerpt)+'</p><p>状态：'+esc(s.status==='confirmed'?'已核对':s.status==='disabled'?'已停用，重新发布将重新确认':'待核对')+'</p><label><input type="checkbox" data-gp-source="'+esc(s.id)+'"> 我已核对该原网页及对应事实</label><button type="button" data-gp-disable="'+esc(s.id)+'" data-version="'+s.version+'">停用此来源及其关联讲解</button></fieldset>').join('')+
      (d.grounding.issues.length?'<h4>需要留意的句子</h4>'+d.grounding.issues.map(i=>'<div class="guide-issue"><p>'+esc(i.message)+'</p><blockquote>'+esc(i.text)+'</blockquote>'+(i.severity==='warning'?'<label>核对后保留的理由<textarea data-gp-reason="'+esc(i.id)+'" maxlength="500"></textarea></label>':'<p>必须修改后才能发布。</p>')+'</div>').join(''):'')+
      '<label><input id="gp-review-binding" type="checkbox"> 点位对应正确</label><label><input id="gp-review-facts" type="checkbox"> 已逐项核对事实与讲解，没有添加无来源内容</label><label><input id="gp-review-paraphrase" type="checkbox"> 可公开这份自行整理的讲解，不含未获准转载的原文或图片</label>'+
      '<label>核对说明（至少8字；停用来源时填写原因）<textarea id="gp-note" maxlength="500"></textarea></label>'+
      '<button type="button" id="gp-publish">核对并发布讲解</button><button type="button" id="gp-archive">停止公开这份讲解</button><p class="muted">历史版本保留；不自动生成用户贡献、积分或语音。</p></div>';
  }
  async function loadDraft(id) { const active=current, token=++draftRead; const r=await call({action:'getGuidePackDraft',fragmentId:id});if(!active() || token!==draftRead)return;draft=r.draft;showDraft(); }
  nav.onclick=open;
  box.addEventListener('change', e=>{
    if(!current())return;
    if(['gp-point','gp-resource'].includes(e.target.id)) {
      if(e.target.id==='gp-point')document.getElementById('gp-resource').value=selection()?.resourceId || '';
      preview=null; previewRead++; document.getElementById('gp-preview-box').innerHTML='';
    }
  });
  box.addEventListener('click', async e=>{
    const b=e.target.closest('button');if(!b || !current() || !b.id.startsWith('gp-') && !b.dataset.gpEdit && !b.dataset.gpDisable)return;
    b.disabled=true;const active=current;
    try {
      if(b.id==='gp-preview') {
        const record=selection(),resourceId=document.getElementById('gp-resource').value;
        const token=++previewRead;const result=await call({action:'previewGuidePack',recordId:record.id,resourceId:resourceId || record.id});if(active() && token===previewRead){preview=result;showPreview();}
      } else if(b.id==='gp-import') {
        const r=await call({action:'importGuidePack',recordId:preview.record.id,resourceId:preview.resource.id,fingerprint:preview.fingerprint,bindingConfirmed:document.getElementById('gp-binding').checked});
        if(!active())return;await open();await loadDraft(r.fragmentIds[0]);msg(r.alreadyImported?'已打开原有草稿，没有覆盖修改':'已导入待审稿，尚未公开');
      } else if(b.dataset.gpEdit) await loadDraft(b.dataset.gpEdit);
      else if(b.id==='gp-save') {
        await call({action:'saveGuidePackDraft',fragmentId:draft.id,revision:draft.revision,draft:editData()});if(!active())return;await loadDraft(draft.id);msg('修改已保存，请重新核对后发布');
      } else if(b.id==='gp-publish') {
        if(!unchanged())throw Error('有未保存修改，请先保存，再核对发布');
        await call({action:'publishGuidePackDraft',fragmentId:draft.id,revision:draft.revision,evidenceFingerprint:draft.sourceFingerprint,
          bindingConfirmed:document.getElementById('gp-review-binding').checked,factsConfirmed:document.getElementById('gp-review-facts').checked,paraphraseConfirmed:document.getElementById('gp-review-paraphrase').checked,
          reviewedSourceIds:[...box.querySelectorAll('[data-gp-source]:checked')].map(n=>n.dataset.gpSource),reviewNote:document.getElementById('gp-note').value,
          groundingResolution:{fingerprint:draft.grounding.fingerprint,reasons:Object.fromEntries([...box.querySelectorAll('[data-gp-reason]')].map(n=>[n.dataset.gpReason,n.value]))}});
        if(!active())return;await open();msg('讲解已发布，游客端会按点位和兴趣读取');
      } else if(b.id==='gp-archive') {
        await call({action:'archiveGuidePackDraft',fragmentId:draft.id,revision:draft.revision});if(!active())return;await open();msg('已停止公开，历史版本仍保留');
      } else if(b.dataset.gpDisable) {
        await call({action:'disableGuidePackSource',fragmentId:draft.id,revision:draft.revision,sourceId:b.dataset.gpDisable,sourceVersion:Number(b.dataset.version),reviewNote:document.getElementById('gp-note').value});
        if(!active())return;await loadDraft(draft.id);msg('来源已停用，依赖它的已发布讲解将停止展示');
      }
    } catch(e) { if(active())msg(e.message || '操作失败，请重试'); }
    finally { b.disabled=false; }
  });
})();
