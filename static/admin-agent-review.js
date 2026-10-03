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
  const reasonOptions = [['accepted_as_is','原样可用'],['wording_adjusted','文字已调整'],['type_corrected','类型已纠正'],
    ['duplicate_merged','合并重复项'],['source_insufficient','来源不足'],['unsupported_claim','判断缺少依据'],
    ['wrong_target','关联对象不对'],['missing_context','缺少上下文'],['other','其他']];
  const button = 'min-h-[44px] rounded-lg border border-stone-200 bg-white px-4 py-2 text-xs font-bold text-stone-600 focus-visible:outline focus-visible:outline-2';
  const primary = 'min-h-[44px] rounded-lg bg-[#123c3a] px-4 py-2 text-xs font-bold text-[#d9ad52] disabled:opacity-40 focus-visible:outline focus-visible:outline-2';
  const field = 'mt-1 min-h-[44px] w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm';
  let offset = 0, status = 'pending_review', workspace, evaluation, evaluationSetId = '', busy = false, generation = 0;
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
    const matches = Array.isArray(c.duplicateMatches) ? c.duplicateMatches : [];
    const suggestedIds = new Set(matches.filter(match => match.resourceId === c.resourceId).map(match => match.entityId));
    const orderedEntities = [...sameEntities].sort((left, right) => Number(suggestedIds.has(right.id)) - Number(suggestedIds.has(left.id))
      || String(left.name).localeCompare(String(right.name)));
    const merge = options([['', '保留为新实体'], ...orderedEntities.map(e => [e.id,
      `${suggestedIds.has(e.id) ? '建议核对' : '可选'}：${e.name}`])], '');
    const matchNotice = c.candidateType === 'entity' && matches.length ? `<aside class="mt-3 rounded-xl border border-[#b68a4a]/30 bg-[#fffaf1] p-3">
      <p class="text-xs font-bold text-[#7d2b23]">确定性查重建议</p>
      <p class="mt-1 text-[10px] leading-5 text-stone-500">系统不会自动合并。请核对类型、地区和具体对象后，再在下方手动选择。</p>
      <ul class="mt-2 space-y-1">${matches.map(match => `<li class="text-[10px] leading-5 text-stone-600"><strong>${esc(match.level === 'strong' ? '高度可能重复' : '需要人工判断')}：${esc(match.name)}</strong> · ${esc((match.reasons || []).join('、'))}${match.resourceId !== c.resourceId ? ' · 其他资源，仅供对照' : ''}</li>`).join('')}</ul>
    </aside>` : '';
    return `<article data-candidate="${esc(c.id)}" class="min-w-0 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm">
      <div class="flex flex-wrap items-center justify-between gap-3"><label class="flex min-h-[44px] items-center gap-2 text-xs text-stone-500">
      ${pending ? `<input type="checkbox" data-select aria-label="选择${esc(p.name || c.sourceName || '建议')}" ${c.risk === 'high' || blocked ? 'disabled' : ''}>` : ''}${esc(labels[c.candidateType])}</label>
      <span class="text-xs ${c.risk === 'high' ? 'text-red-700' : 'text-stone-500'}">${esc(pending ? riskLabels[c.risk] : c.status === 'approved' ? '已确认' : '已驳回')}</span></div>
      <h3 class="break-words text-base font-bold">${esc(p.name || (c.candidateType === 'relation' ? `${c.sourceName || '待确认实体'} → ${c.resourceTitle}` : p.request))}</h3>
      <p class="mt-2 break-words text-sm text-stone-600">${esc(p.summary || p.reason)}</p>
      ${matchNotice}
      ${c.candidateType === 'relation' ? `<p class="mt-2 text-xs text-stone-500">${esc(relationLabels[p.relationType])} · ${c.sourceReady ? '起点实体已确认' : '先确认对应实体，再确认关系'}</p>` : ''}
      <details class="mt-3 rounded-lg bg-stone-50 p-3"><summary class="min-h-[44px] cursor-pointer text-sm font-bold">核对投稿与依据</summary>
        <p class="break-words text-sm font-bold">${esc(c.submissionTitle || '来源投稿')}</p><p class="mt-2 whitespace-pre-wrap break-words text-sm text-stone-600">${esc(c.submissionText)}</p>
        ${c.evidence.map(e => `<div class="mt-3 border-t border-stone-200 pt-3"><p class="text-xs font-bold">${esc(e.title || '关联来源')} · ${e.valid ? '有效' : '已失效'}</p><p class="mt-1 break-words text-sm">${esc(e.summary)}</p>${e.materialReference ? `<p class="mt-1 text-xs">材料校对版本 ${Number(e.materialReference.reviewVersion)} · ${esc(e.materialReference.kind)} · ${esc(JSON.stringify(e.materialReference.locator))}</p>` : ''}<p class="mt-2 whitespace-pre-wrap break-words text-sm text-stone-600">${esc(e.originalText || '')}</p></div>`).join('')}
      </details>
      ${pending ? `<details class="mt-3 ${c.candidateType === 'gap' ? 'hidden' : ''}" ${c.candidateType === 'entity' && !c.resourceId ? 'open' : ''}><summary class="min-h-[44px] cursor-pointer text-xs font-bold text-stone-600">${c.candidateType === 'entity' && !c.resourceId ? '请先选择所属资源' : '修改建议与合并'}</summary>
      ${c.candidateType === 'entity' ? `<div class="grid gap-3 sm:grid-cols-2"><label class="text-xs">名称<input data-field="name" class="${field}" value="${esc(p.name)}"></label>
      <label class="text-xs">资源<select data-field="resourceId" class="${field}"><option value="">请选择资源</option>${resources}</select></label>
      <label class="text-xs">类型<select data-field="entityType" class="${field}">${options(Object.entries(entityLabels), p.entityType)}</select></label>
      <label class="text-xs">重复实体<select data-field="mergeEntityId" class="${field}">${merge}</select><span class="mt-1 block text-[10px] leading-4 text-stone-400">默认保留为新实体；只有人工选择后才会合并。</span></label>
      <label class="text-xs sm:col-span-2">实体说明<textarea data-field="summary" class="${field}" rows="2">${esc(p.summary)}</textarea></label></div>` : c.candidateType === 'relation' ? `<label class="block text-xs">关系类型<select data-field="relationType" class="${field}">${options(Object.entries(relationLabels), p.relationType)}</select></label>
      <label class="mt-3 block text-xs">为什么有关<textarea data-field="why" class="${field}" rows="2">${esc(p.reason)}</textarea></label>` : '<p class="text-xs text-stone-500">资料不足，保留到后续征集任务。</p>'}</details>
      <label class="mt-3 block text-xs text-stone-600">反馈原因<select data-reason-category class="${field}">${options(reasonOptions, 'accepted_as_is')}</select></label>
      <label class="mt-3 block text-xs text-stone-600">审核说明（驳回或高风险确认时必填）<textarea data-note class="${field}" rows="2" maxlength="500"></textarea></label>
      ${c.candidateType === 'relation' ? '<label class="mt-2 flex min-h-[44px] items-center gap-2 text-xs"><input data-risk-ack type="checkbox">已逐条核对来源和历史判断</label>' : ''}
      ${!c.eligible ? '<p class="mt-2 text-xs text-red-700">任务未完成或投稿授权已变化，请刷新核对。</p>' : ''}
      ${c.candidateType === 'gap' ? gapForm(c) : ''}
      <div class="mt-3 flex flex-wrap gap-2">${c.candidateType !== 'gap' ? `<button data-approve class="${primary}" ${blocked ? 'disabled' : ''}>确认建议</button>` : ''}<button data-reject class="${button}">驳回建议</button></div>` : `<div class="mt-3 flex flex-wrap gap-2">${evaluation && !evaluation.selectedReviewIds.includes(c.id) ? `<button data-add-eval="debug" class="${button}">加入调试集</button><button data-add-eval="fixed" class="${primary}">加入固定验收集</button>` : '<span class="text-xs text-stone-500">已加入当前评测集</span>'}</div>`}
      <p data-result role="status" class="mt-2 break-words text-xs text-stone-600"></p></article>`;
  }
  function requestFor(element, decision) {
    return { candidateId: element.dataset.candidate, decision,
      edits: Object.fromEntries([...element.querySelectorAll('[data-field]')].map(el => [el.dataset.field, el.value.trim()])),
      note: element.querySelector('[data-note]').value.trim(), reasonCategory: element.querySelector('[data-reason-category]').value,
      highRiskAcknowledged: Boolean(element.querySelector('[data-risk-ack]:checked')) };
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
  const rateText = value => ({ correct: '正确', partial: '部分正确', incorrect: '错误' }[value] || '未判断');
  const splitText = value => value === 'fixed' ? '固定验收集' : '调试集';
  function evaluationPanel() {
    if (!evaluation || !evaluation.selectedSet) return '';
    const m = evaluation.metrics;
    const metric = (label, value) => `<div class="rounded-xl bg-stone-50 p-3"><p class="text-xs text-stone-500">${label}</p><p class="mt-1 text-lg font-bold text-[#123c3a]">${value}%</p></div>`;
    const comparisons = evaluation.comparisons.map(row => `<tr class="border-t border-stone-100"><td class="px-2 py-2">${esc(row.model)}</td><td class="px-2 py-2">${esc(row.promptVersion)}</td><td class="px-2 py-2">${esc(row.codeVersion)}</td><td class="px-2 py-2">${row.metrics.total}</td><td class="px-2 py-2">${row.metrics.directApprovalRate}%</td><td class="px-2 py-2">${row.metrics.modificationRate}%</td><td class="px-2 py-2">${row.metrics.rejectionRate}%</td><td class="px-2 py-2">${row.metrics.sourceValidityRate}%</td><td class="px-2 py-2">${row.metrics.relationTypeConsistencyRate}%</td></tr>`).join('');
    const samples = evaluation.samples.map(sample => `<div data-evaluation-sample="${esc(sample.id)}" class="mt-3 rounded-xl border border-stone-200 p-3">
      <div class="flex flex-wrap items-center justify-between gap-2"><p class="text-xs font-bold">${esc(labels[sample.candidateType] || '智能体建议')} · ${splitText(sample.split)}</p><span class="text-xs ${sample.active ? 'text-stone-500' : 'text-red-700'}">${sample.active ? '来源有效' : esc(sample.disabledReason || '已停用')}</span></div>
      <p class="mt-1 break-words text-xs text-stone-500">${esc(sample.model || '未知模型')} · ${esc(sample.promptVersion || '未知提示词')} · ${esc(sample.codeVersion || '旧版本')}</p>
      <div class="mt-2 grid gap-2 sm:grid-cols-[180px_1fr_auto]"><select data-human-rating class="${field}" ${sample.active ? '' : 'disabled'}>${options([['','人工判断'],['correct','正确'],['partial','部分正确'],['incorrect','错误']], sample.humanRating)}</select><input data-rating-note maxlength="500" class="${field}" placeholder="可填写判断说明" value="${esc(sample.ratingNote)}" ${sample.active ? '' : 'disabled'}><button data-save-rating class="${button}" ${sample.active ? '' : 'disabled'}>保存判断</button></div>
      <p data-eval-result class="mt-2 text-xs text-stone-500">当前：${rateText(sample.humanRating)}</p></div>`).join('');
    return `<section class="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm"><div class="flex flex-wrap items-end gap-3">
      <label class="text-xs">评测集版本<select data-evaluation-set class="${field}">${options(evaluation.sets.map(item => [item.id, `${item.title}（${item.version}）`]), evaluation.selectedSet.id)}</select></label>
      <label class="text-xs">新版本号<input data-new-version class="${field}" placeholder="例如 feedback-v2"></label><button data-create-set class="${button}">新建版本</button></div>
      <div class="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">${metric('直接通过率',m.directApprovalRate)}${metric('修改率',m.modificationRate)}${metric('驳回率',m.rejectionRate)}${metric('来源有效率',m.sourceValidityRate)}${metric('关系类型一致率',m.relationTypeConsistencyRate)}</div>
      <p class="mt-3 text-xs text-stone-500">共 ${m.total} 条，当前有效 ${m.activeTotal} 条。固定验收集只会由管理员手动加入。</p>
      ${comparisons ? `<details class="mt-3"><summary class="min-h-[44px] cursor-pointer text-xs font-bold">按模型、提示词和代码版本比较</summary><div class="overflow-x-auto"><table class="w-full text-left text-xs"><thead><tr><th class="px-2 py-2">模型</th><th class="px-2 py-2">提示词</th><th class="px-2 py-2">代码</th><th class="px-2 py-2">样本</th><th class="px-2 py-2">直接通过</th><th class="px-2 py-2">修改</th><th class="px-2 py-2">驳回</th><th class="px-2 py-2">来源有效</th><th class="px-2 py-2">关系类型一致</th></tr></thead><tbody>${comparisons}</tbody></table></div></details>` : ''}
      <details class="mt-3"><summary class="min-h-[44px] cursor-pointer text-xs font-bold">样本人工判断（${evaluation.samples.length}）</summary>${samples || '<p class="text-xs text-stone-500">当前版本还没有样本。请从已确认或已驳回建议中手动挑选。</p>'}</details></section>`;
  }
  async function selectEvaluationSample(candidateId, split) {
    if (busy) return;
    busy = true;
    try {
      await callAdmin({ action: 'selectAgentEvaluationSample', setId: evaluation.selectedSet.id, reviewId: candidateId, split });
      message.textContent = `已加入${splitText(split)}。`;
      await load();
    } catch (error) { message.textContent = error.message; }
    finally { busy = false; }
  }
  function bindEvaluationActions() {
    list.querySelector('[data-evaluation-set]')?.addEventListener('change', event => { evaluationSetId = event.target.value; load(); });
    list.querySelector('[data-create-set]')?.addEventListener('click', async () => {
      const version = list.querySelector('[data-new-version]').value.trim();
      if (!version || busy) return;
      busy = true;
      try {
        const result = await callAdmin({ action: 'createAgentEvaluationSet', version });
        evaluationSetId = result.set.id;
        message.textContent = '新评测版本已创建。';
        await load();
      } catch (error) { message.textContent = error.message; }
      finally { busy = false; }
    });
    list.querySelectorAll('[data-evaluation-sample]').forEach(element => {
      element.querySelector('[data-save-rating]')?.addEventListener('click', async () => {
        const rating = element.querySelector('[data-human-rating]').value;
        if (!rating || busy) return;
        busy = true;
        try {
          await callAdmin({ action: 'rateAgentEvaluationSample', evaluationId: element.dataset.evaluationSample,
            rating, ratingNote: element.querySelector('[data-rating-note]').value.trim() });
          element.querySelector('[data-eval-result]').textContent = `当前：${rateText(rating)}`;
          message.textContent = '人工判断已保存。';
        } catch (error) { message.textContent = error.message; }
        finally { busy = false; }
      });
    });
  }
  async function load() {
    const token = ++generation;
    setActiveView('agent-review', '研究建议');
    viewCount.textContent = '';
    list.innerHTML = '<p class="text-sm text-stone-500">正在整理建议和来源…</p>';
    try {
      const [result, evaluationResult] = await Promise.all([
        callAdmin({ action: 'getAgentReviewWorkspace', offset, status }),
        callAdmin({ action: 'getAgentEvaluationWorkspace', setId: evaluationSetId })
      ]);
      if (token !== generation) return;
      workspace = result;
      evaluation = evaluationResult;
      evaluationSetId = evaluation.selectedSet?.id || '';
      viewCount.textContent = `本页 ${workspace.candidates.length} 条`;
      list.innerHTML = `${evaluationPanel()}<section class="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm"><div class="flex flex-wrap items-center gap-3">
      <label class="text-xs">查看 <select data-status class="${field}">${options([['pending_review','待核对'],['approved','已确认'],['rejected','已驳回']], status)}</select></label>
      <button data-refresh class="${button}">刷新建议</button>${status === 'pending_review' ? `<button data-batch-approve class="${primary}">确认选中项</button><button data-batch-reject class="${button}">驳回选中项</button>` : ''}</div>
      <p class="mt-3 text-xs text-stone-500">先核对实体，再确认关联。高风险判断需逐条处理；每次最多选择 20 条。</p></section>
      ${workspace.candidates.map(card).join('') || '<div class="rounded-2xl border border-stone-200 bg-white p-6 text-sm text-stone-500">当前没有建议。已授权投稿完成研究分析后，会出现在这里。</div>'}
      <div class="flex gap-3"><button data-prev class="${button}" ${offset === 0 ? 'disabled' : ''}>上一页</button><button data-next class="${button}" ${workspace.nextOffset === null ? 'disabled' : ''}>下一页</button></div>`;
      list.querySelector('[data-status]').onchange = e => { status = e.target.value; offset = 0; load(); };
      list.querySelector('[data-refresh]').onclick = load;
      list.querySelector('[data-prev]').onclick = () => { offset = Math.max(0, offset - 30); load(); };
      list.querySelector('[data-next]').onclick = () => { offset = workspace.nextOffset; load(); };
      bindEvaluationActions();
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
          const suggested = new Set((c.duplicateMatches || []).filter(match => match.resourceId === resource
            && match.entityType === type).map(match => match.entityId));
          const choices = workspace.entities.filter(e => e.resourceId === resource && e.entityType === type)
            .sort((left, right) => Number(suggested.has(right.id)) - Number(suggested.has(left.id))
              || String(left.name).localeCompare(String(right.name)));
          select.innerHTML = options([['', '保留为新实体'], ...choices.map(e => [e.id,
            `${suggested.has(e.id) ? '建议核对' : '可选'}：${e.name}`])], '');
        };
        el.querySelector('[data-field="resourceId"]')?.addEventListener('change', refreshMergeOptions);
        el.querySelector('[data-field="entityType"]')?.addEventListener('change', refreshMergeOptions);
        el.querySelectorAll('[data-add-eval]').forEach(button => button.addEventListener('click', () => selectEvaluationSample(el.dataset.candidate, button.dataset.addEval)));
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
