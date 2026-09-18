/* Uses the existing admin session, navigation and component styles. */
'use strict';
(() => {
  const labels = { entity: '文化实体', relation: '关联建议', gap: '待补资料' };
  const relationLabels = { located_at: '位于', documents: '记录', depicts: '描绘', uses_craft: '使用技艺',
    associated_with_person: '与人物相关', associated_with_event: '与事件相关', mentioned_in: '见于文献',
    changed_over_time: '随时间变化', visually_similar_to: '外观相似', influenced_or_transmitted_to: '影响或传承' };
  const entityLabels = { detail_or_motif: '纹样与细节', heritage_object: '文物器物', building_or_site: '建筑与遗址',
    person_or_group: '人物与群体', event: '历史事件', text_or_archive: '文献档案', craft_or_practice: '技艺', time_period: '时代', place: '地点' };
  const riskLabels = { medium: '建议核对', high: '需单独判断', insufficient: '证据不足', blocked: '暂不可采用' };
  const button = 'min-h-[44px] rounded-lg border border-stone-200 bg-white px-4 py-2 text-xs font-bold text-stone-600 focus-visible:outline focus-visible:outline-2';
  const primary = 'min-h-[44px] rounded-lg bg-[#123c3a] px-4 py-2 text-xs font-bold text-[#d9ad52] disabled:opacity-40 focus-visible:outline focus-visible:outline-2';
  const field = 'mt-1 min-h-[44px] w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm';
  let offset = 0, status = 'pending_review', workspace, busy = false, generation = 0;
  const esc = value => escapeHtml(value);
  const options = (pairs, selected) => pairs.map(([value, label]) => `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(label)}</option>`).join('');
  function gapForm(c) {
    const draft = c.gapDraft || {};
    const stories = (workspace.stories || []).filter(s => s.resourceId === c.resourceId);
    if (!stories.length) return '<p class="mt-3 text-xs text-stone-500">该资源还没有已发布故事，请先在故事草稿中发布，再创建征集。</p>';
    const storyId = draft.storyId || stories[0].id;
    const story = stories.find(s => s.id === storyId);
    return `<details data-gap-form class="mt-3" open><summary class="min-h-[44px] cursor-pointer text-sm font-bold">征集草稿</summary>
      <div class="grid gap-3 sm:grid-cols-2">
      <label class="text-xs">对应故事<select data-gap="storyId" class="${field}">${options(stories.map(s => [s.id,s.title]), storyId)}</select></label>
      <label class="text-xs">对应章节<select data-gap="chapterIndex" class="${field}">${options([['','整个故事'], ...(story?.chapters || []).map(c => [String(c.index),c.title])], draft.chapterIndex == null ? '' : String(draft.chapterIndex))}</select></label>
      <label class="text-xs sm:col-span-2">征集标题<input data-gap="title" maxlength="48" class="${field}" value="${esc(draft.title || c.payload.request)}"></label>
      <label class="text-xs sm:col-span-2">需要什么资料<textarea data-gap="description" maxlength="360" class="${field}" rows="3">${esc(draft.description || `${c.payload.request}。${c.payload.reason || ''}`)}</textarea></label>
      <label class="text-xs">资料类型<select data-gap="requestedAssetType" class="${field}">${options([['any','不限'],['image','图片'],['audio','录音'],['video','视频']], draft.requestedAssetType || 'any')}</select></label>
      <label class="text-xs">采用后的额外积分<input data-gap="rewardPoints" type="number" min="0" max="500" step="1" class="${field}" value="${esc(draft.rewardPoints || 0)}"></label></div>
      <p class="mt-3 text-xs text-stone-500">保存后仅后台可见。确认发布后，用户可在对应故事下补充资料；积分仍需采用后人工确认。</p>
      <div class="mt-3 flex flex-wrap gap-2"><button data-gap-save class="${button}" ${!c.eligible ? 'disabled' : ''}>保存草稿</button><button data-gap-publish class="${primary}" ${!c.eligible || !draft.draftVersion ? 'disabled' : ''}>确认发布征集</button></div>
      </details>`;
  }
  async function saveGap(el, publish) {
    if (busy) return;
    busy = true;
    const token = generation;
    const c = workspace.candidates.find(c => c.id === el.dataset.candidate);
    const buttons = [...el.querySelectorAll('button:not(:disabled)')];
    buttons.forEach(b => { b.disabled = true; });
    try {
      const result = await callAdmin({ action: publish ? 'publishAgentGapDraft' : 'saveAgentGapDraft', candidateId: c.id,
        draftVersion: c.gapDraft?.draftVersion,
        ...Object.fromEntries([...el.querySelectorAll('[data-gap]')].map(e => [e.dataset.gap,e.value])) });
      if (token !== generation) return;
      c.gapDraft = result.task;
      el.querySelector('[data-result]').textContent = publish ? '征集已发布，可在对应故事下查看。' : '草稿已保存，核对后可确认发布。';
      if (publish) { el.dataset.done = 'true'; el.querySelectorAll('input,textarea,select,button').forEach(e => { e.disabled = true; }); }
    } catch (e) { if (token === generation) el.querySelector('[data-result]').textContent = e.message; }
    finally {
      busy = false;
      if (token === generation && !el.dataset.done) {
        buttons.forEach(b => { b.disabled = false; });
        el.querySelector('[data-gap-publish]').disabled = !c.eligible || !c.gapDraft?.draftVersion;
      }
    }
  }
  function card(c) {
    const p = c.payload;
    const pending = c.status === 'pending_review';
    const blocked = !c.eligible || ['gap'].includes(c.candidateType) || ['insufficient', 'blocked'].includes(c.risk);
    const resources = options(workspace.resources.map(r => [r.id, r.title]), c.resourceId);
    const sameEntities = workspace.entities.filter(e => e.entityType === p.entityType && e.resourceId === c.resourceId);
    const merge = options([['', '按名称查重或新建'], ...sameEntities.map(e => [e.id, `合并到：${e.name}`])], '');
    return `<article data-candidate="${esc(c.id)}" class="min-w-0 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
      <div class="flex flex-wrap items-center justify-between gap-3"><label class="flex min-h-[44px] items-center gap-2 text-xs text-stone-500">
      ${pending ? `<input type="checkbox" data-select aria-label="选择${esc(p.name || c.sourceName || '建议')}" ${c.risk === 'high' || blocked ? 'disabled' : ''}>` : ''}${esc(labels[c.candidateType])}</label>
      <span class="text-xs ${c.risk === 'high' ? 'text-red-700' : 'text-stone-500'}">${esc(pending ? riskLabels[c.risk] : c.status === 'approved' ? '已确认' : '已驳回')}</span></div>
      <h3 class="break-words text-base font-bold">${esc(p.name || (c.candidateType === 'relation' ? `${c.sourceName || '待确认实体'} → ${c.resourceTitle}` : p.request))}</h3>
      <p class="mt-2 break-words text-sm text-stone-600">${esc(p.summary || p.reason)}</p>
      ${c.candidateType === 'relation' ? `<p class="mt-2 text-xs text-stone-500">${esc(relationLabels[p.relationType])} · ${c.sourceReady ? '起点实体已确认' : '先确认对应实体，再确认关系'}</p>` : ''}
      <details class="mt-3 rounded-lg bg-stone-50 p-3"><summary class="min-h-[44px] cursor-pointer text-sm font-bold">核对投稿与依据</summary>
        <p class="break-words text-sm font-bold">${esc(c.submissionTitle || '来源投稿')}</p><p class="mt-2 whitespace-pre-wrap break-words text-sm text-stone-600">${esc(c.submissionText)}</p>
        ${c.evidence.map(e => `<div class="mt-3 border-t border-stone-200 pt-3"><p class="text-xs font-bold">${esc(e.title || '关联来源')} · ${e.valid ? '有效' : '已失效'}</p><p class="mt-1 break-words text-sm">${esc(e.summary)}</p><p class="mt-2 whitespace-pre-wrap break-words text-sm text-stone-600">${esc(e.originalText || '')}</p></div>`).join('')}
      </details>
      ${pending ? `<details class="mt-3 ${c.candidateType === 'gap' ? 'hidden' : ''}" ${c.candidateType === 'entity' && !c.resourceId ? 'open' : ''}><summary class="min-h-[44px] cursor-pointer text-xs font-bold text-stone-600">${c.candidateType === 'entity' && !c.resourceId ? '请先选择所属资源' : '修改建议与合并'}</summary>
      ${c.candidateType === 'entity' ? `<div class="grid gap-3 sm:grid-cols-2"><label class="text-xs">名称<input data-field="name" class="${field}" value="${esc(p.name)}"></label>
      <label class="text-xs">资源<select data-field="resourceId" class="${field}"><option value="">请选择资源</option>${resources}</select></label>
      <label class="text-xs">类型<select data-field="entityType" class="${field}">${options(Object.entries(entityLabels), p.entityType)}</select></label>
      <label class="text-xs">重复实体<select data-field="mergeEntityId" class="${field}">${merge}</select></label>
      <label class="text-xs sm:col-span-2">实体说明<textarea data-field="summary" class="${field}" rows="2">${esc(p.summary)}</textarea></label></div>` : c.candidateType === 'relation' ? `<label class="block text-xs">关系类型<select data-field="relationType" class="${field}">${options(Object.entries(relationLabels), p.relationType)}</select></label>
      <label class="mt-3 block text-xs">为什么有关<textarea data-field="why" class="${field}" rows="2">${esc(p.reason)}</textarea></label>` : '<p class="text-xs text-stone-500">资料不足，保留到后续征集任务。</p>'}</details>
      <label class="mt-3 block text-xs text-stone-600">审核说明（驳回或高风险确认时必填）<textarea data-note class="${field}" rows="2" maxlength="500"></textarea></label>
      ${c.candidateType === 'relation' ? '<label class="mt-2 flex min-h-[44px] items-center gap-2 text-xs"><input data-risk-ack type="checkbox">已逐条核对来源和历史判断</label>' : ''}
      ${!c.eligible ? '<p class="mt-2 text-xs text-red-700">任务未完成或投稿授权已变化，请刷新核对。</p>' : ''}
      ${c.candidateType === 'gap' ? gapForm(c) : ''}
      <div class="mt-3 flex flex-wrap gap-2">${c.candidateType !== 'gap' ? `<button data-approve class="${primary}" ${blocked ? 'disabled' : ''}>确认建议</button>` : ''}<button data-reject class="${button}">驳回建议</button></div>` : ''}
      <p data-result role="status" class="mt-2 break-words text-xs text-stone-600"></p></article>`;
  }
  function requestFor(element, decision) {
    return { candidateId: element.dataset.candidate, decision,
      edits: Object.fromEntries([...element.querySelectorAll('[data-field]')].map(el => [el.dataset.field, el.value.trim()])),
      note: element.querySelector('[data-note]').value.trim(), highRiskAcknowledged: Boolean(element.querySelector('[data-risk-ack]:checked')) };
  }
  async function review(elements, decision) {
    if (busy || !elements.length) return;
    busy = true;
    const token = generation;
    const enabledButtons = [...list.querySelectorAll('button:not(:disabled)')];
    list.querySelectorAll('button').forEach(b => { b.disabled = true; });
    try {
      const result = await callAdmin({ action: 'reviewAgentCandidates', items: elements.map(el => requestFor(el, decision)) });
      if (token !== generation) return;
      for (const r of result.results) {
        const el = elements.find(el => el.dataset.candidate === r.candidateId);
        el.querySelector('[data-result]').textContent = r.ok ? '处理完成，刷新后查看最新列表。' : r.message;
        if (r.ok) { el.dataset.done = 'true'; el.querySelectorAll('input, textarea, select, button').forEach(e => { e.disabled = true; }); }
      }
      message.textContent = `已处理 ${result.results.filter(r => r.ok).length} 条；未通过的原因显示在对应建议下方。`;
    } catch (error) { if (token === generation) message.textContent = error.message; }
    finally {
      busy = false;
      if (token === generation) {
        enabledButtons.forEach(b => { b.disabled = false; });
        list.querySelectorAll('[data-candidate]').forEach(el => {
          const c = workspace.candidates.find(c => c.id === el.dataset.candidate);
          if (el.dataset.done) el.querySelectorAll('button').forEach(b => { b.disabled = true; });
          else if (!c.eligible || c.candidateType === 'gap' || ['insufficient','blocked'].includes(c.risk)) el.querySelector('[data-approve]')?.setAttribute('disabled', '');
        });
      }
    }
  }
  async function load() {
    const token = ++generation;
    setActiveView('agent-review', '研究建议');
    viewCount.textContent = '';
    list.innerHTML = '<p class="text-sm text-stone-500">正在整理建议和来源…</p>';
    try {
      const result = await callAdmin({ action: 'getAgentReviewWorkspace', offset, status });
      if (token !== generation) return;
      workspace = result;
      viewCount.textContent = `本页 ${workspace.candidates.length} 条`;
      list.innerHTML = `<section class="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm"><div class="flex flex-wrap items-center gap-3">
      <label class="text-xs">查看 <select data-status class="${field}">${options([['pending_review','待核对'],['approved','已确认'],['rejected','已驳回']], status)}</select></label>
      <button data-refresh class="${button}">刷新建议</button>${status === 'pending_review' ? `<button data-batch-approve class="${primary}">确认选中项</button><button data-batch-reject class="${button}">驳回选中项</button>` : ''}</div>
      <p class="mt-3 text-xs text-stone-500">先核对实体，再确认关联。高风险判断需逐条处理；每次最多选择 20 条。</p></section>
      ${workspace.candidates.map(card).join('') || '<div class="rounded-2xl border border-stone-200 bg-white p-6 text-sm text-stone-500">当前没有建议。已授权投稿完成研究分析后，会出现在这里。</div>'}
      <div class="flex gap-3"><button data-prev class="${button}" ${offset === 0 ? 'disabled' : ''}>上一页</button><button data-next class="${button}" ${workspace.nextOffset === null ? 'disabled' : ''}>下一页</button></div>`;
      list.querySelector('[data-status]').onchange = e => { status = e.target.value; offset = 0; load(); };
      list.querySelector('[data-refresh]').onclick = load;
      list.querySelector('[data-prev]').onclick = () => { offset = Math.max(0, offset - 30); load(); };
      list.querySelector('[data-next]').onclick = () => { offset = workspace.nextOffset; load(); };
      list.querySelectorAll('[data-candidate]').forEach(el => {
        el.querySelector('[data-gap-save]')?.addEventListener('click', () => saveGap(el, false));
        el.querySelector('[data-gap-publish]')?.addEventListener('click', () => saveGap(el, true));
        el.querySelector('[data-gap="storyId"]')?.addEventListener('change', e => {
          const story = (workspace.stories || []).find(s => s.id === e.target.value);
          el.querySelector('[data-gap="chapterIndex"]').innerHTML = options([['','整个故事'], ...(story?.chapters || []).map(c => [String(c.index),c.title])], '');
        });
        const refreshMergeOptions = () => {
          const select = el.querySelector('[data-field="mergeEntityId"]');
          if (!select) return;
          const resource = el.querySelector('[data-field="resourceId"]').value;
          const type = el.querySelector('[data-field="entityType"]').value;
          select.innerHTML = options([['', '按名称查重或新建'], ...workspace.entities.filter(e => e.resourceId === resource && e.entityType === type).map(e => [e.id, `合并到：${e.name}`])], '');
        };
        el.querySelector('[data-field="resourceId"]')?.addEventListener('change', refreshMergeOptions);
        el.querySelector('[data-field="entityType"]')?.addEventListener('change', refreshMergeOptions);
      });
      for (const decision of ['approve','reject']) {
        list.querySelector(`[data-batch-${decision}]`)?.addEventListener('click', () => review([...list.querySelectorAll('[data-select]:checked')].map(e => e.closest('[data-candidate]')), decision));
        list.querySelectorAll(`[data-${decision}]`).forEach(b => b.onclick = () => review([b.closest('[data-candidate]')], decision));
      }
    } catch (e) { if (token === generation) list.innerHTML = `<p role="alert" class="text-sm text-red-700">${esc(e.message)}</p>`; }
  }
  document.getElementById('admin-navigation').addEventListener('click', e => {
    if (e.target.closest('[data-admin-view]')?.dataset.adminView !== 'agent-review') generation++;
  });
  document.getElementById('agent-review-refresh').addEventListener('click', () => { offset = 0; load(); });
})();
