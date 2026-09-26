(function () {
  'use strict';
  const button = document.getElementById('story-themes-refresh');
  const content = document.getElementById('list');
  if (!button || !content) return;
  const esc = value => escapeHtml(value == null ? '' : value);
  const ui = 'min-h-11 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-xs text-stone-800 focus:border-[#9e2f24] focus:outline-none';
  const primary = 'min-h-11 rounded-lg bg-[#241a17] px-4 py-2 text-xs font-bold text-[#e3bd69]';
  const secondary = 'min-h-11 rounded-lg border border-[#d8c6a7] bg-white px-4 py-2 text-xs font-bold text-[#604d38]';
  let workspace = null;
  let draft = null;
  let themeId = '';
  let revision = 0;
  let proposal = null;
  let adoptionWorkspace = null;
  let search = '';
  let savedState = '';
  const empty = () => ({ title: '', introduction: '', closing: '', questions: [],
    nodes: [], relationIds: [], chapters: [] });
  const selected = (items, key) => (items || []).filter(item => item[key]).map(item => item[key]);
  const checked = (values, value) => values.includes(value) ? 'checked' : '';
  const notice = (copy, error = false) => {
    message.className = 'mt-2 text-xs ' + (error ? 'text-red-700' : 'text-emerald-700');
    message.textContent = copy;
  };
  const catalog = () => workspace && workspace.catalog || { resources: [], entities: [],
    relations: [], stories: [], claims: [], links: [] };
  const nodeLabel = node => {
    const entity = catalog().entities.find(item => item.id === node.entityId);
    const resource = catalog().resources.find(item => item.id === node.resourceId);
    return (entity ? entity.name : node.entityId) + ' · ' + (resource ? resource.title : node.resourceId);
  };
  const rowLabel = label => '<span class="mb-1 block text-[11px] font-bold text-stone-700">' + esc(label) + '</span>';
  const picked = selector => [...content.querySelectorAll(selector)].filter(input => input.checked).map(input => input.value);
  const stateKey = value => JSON.stringify({
    title: value.title || '', introduction: value.introduction || '', closing: value.closing || '',
    questions: value.questions || [],
    nodes: (value.nodes || []).map(node => ({
      entityId: node.entityId, resourceId: node.resourceId, storyId: node.storyId || '',
      sourceLinkIds: node.sourceLinkIds || [], group: node.group || '', note: node.note || ''
    })),
    relationIds: value.relationIds || [],
    chapters: (value.chapters || []).map(chapter => ({
      id: chapter.id || '', title: chapter.title || '', body: chapter.body || '', nodeIds: chapter.nodeIds || [],
      sourceLinkIds: chapter.sourceLinkIds || [], claimIds: chapter.claimIds || []
    }))
  });

  function readEditor() {
    if (!draft) return;
    const root = content.querySelector('[data-theme-editor]');
    if (!root) return;
    draft.title = root.querySelector('[data-theme-title]').value.trim();
    draft.introduction = root.querySelector('[data-theme-introduction]').value.trim();
    draft.closing = root.querySelector('[data-theme-closing]').value.trim();
    draft.questions = root.querySelector('[data-theme-questions]').value.split('\n').map(s => s.trim()).filter(Boolean);
    draft.nodes = [...root.querySelectorAll('[data-theme-node]')].map(card => ({
      entityId: card.dataset.entityId, resourceId: card.dataset.resourceId,
      storyId: card.querySelector('[data-node-story]').value,
      sourceLinkIds: [...card.querySelectorAll('[data-node-link]')].filter(input => input.checked).map(input => input.value),
      group: card.querySelector('[data-node-group]').value.trim(),
      note: card.querySelector('[data-node-note]').value.trim()
    }));
    draft.relationIds = picked('[data-theme-relation]');
    draft.chapters = [...root.querySelectorAll('[data-theme-chapter]')].map(card => ({
      id: card.dataset.chapterId || '',
      title: card.querySelector('[data-chapter-title]').value.trim(),
      body: card.querySelector('[data-chapter-body]').value.trim(),
      nodeIds: [...card.querySelectorAll('[data-chapter-node]')].filter(input => input.checked).map(input => input.value),
      sourceLinkIds: [...card.querySelectorAll('[data-chapter-link]')].filter(input => input.checked).map(input => input.value),
      claimIds: [...card.querySelectorAll('[data-chapter-claim]')].filter(input => input.checked).map(input => input.value)
    }));
  }

  function renderNode(node, index) {
    const links = catalog().links.filter(item => item.resourceId === node.resourceId);
    const stories = catalog().stories.filter(item => item.resourceId === node.resourceId);
    return `<div data-theme-node data-entity-id="${esc(node.entityId)}" data-resource-id="${esc(node.resourceId)}"
      class="rounded-xl border border-[#e2d3b8] bg-[#fffdf9] p-4">
      <div class="flex flex-wrap items-center justify-between gap-2"><h4 class="text-sm font-bold text-[#332a21]">${index + 1}. ${esc(nodeLabel(node))}</h4>
        <div class="flex gap-2"><button type="button" data-theme-node-up="${index}" class="${secondary}" aria-label="上移此节点">↑</button>
        <button type="button" data-theme-node-down="${index}" class="${secondary}" aria-label="下移此节点">↓</button>
        <button type="button" data-theme-node-remove="${index}" class="${secondary}">移除</button></div></div>
      <div class="mt-3 grid gap-3 md:grid-cols-2">
        <label>${rowLabel('分组（可选）')}<input data-node-group class="${ui}" maxlength="50" value="${esc(node.group || '')}"></label>
        <label>${rowLabel('关联已有故事（可选）')}<select data-node-story class="${ui}"><option value="">不关联</option>
          ${stories.map(item => `<option value="${esc(item.id)}" ${item.id === node.storyId ? 'selected' : ''}>${esc(item.title)} · 第 ${Number(item.version) || 1} 版</option>`).join('')}</select></label>
      </div><label class="mt-3 block">${rowLabel('编辑说明（不是历史事实确认）')}<input data-node-note class="${ui}" maxlength="300" value="${esc(node.note || '')}"></label>
      <fieldset class="mt-3"><legend class="text-[11px] font-bold text-stone-700">节点依据 · 至少选择一份</legend>
        <div class="mt-2 grid gap-2 sm:grid-cols-2">${links.map(item => `<label class="flex min-h-11 items-center gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2 text-[11px]"><input data-node-link type="checkbox" value="${esc(item.id)}" ${checked(node.sourceLinkIds || [], item.id)}><span>${esc(item.summary || item.id)} · ${esc(item.kind)}</span></label>`).join('') || '<p class="text-xs text-amber-700">当前资源没有可公开引用的有效来源。</p>'}</div>
      </fieldset></div>`;
  }

  function renderChapter(chapter, index) {
    const nodeIds = chapter.nodeIds || [];
    const resourceIds = new Set(draft.nodes.filter(node => nodeIds.includes(node.entityId)).map(node => node.resourceId));
    const links = catalog().links.filter(item => resourceIds.has(item.resourceId));
    const claims = catalog().claims.filter(item => resourceIds.has(item.resourceId));
    return `<div data-theme-chapter data-chapter-id="${esc(chapter.id || '')}" class="rounded-xl border border-[#e2d3b8] bg-[#fffdf9] p-4">
      <div class="flex items-center justify-between gap-2"><h4 class="text-sm font-bold text-[#332a21]">第 ${index + 1} 章</h4>
        <div class="flex gap-2"><button type="button" data-theme-chapter-up="${index}" class="${secondary}" aria-label="上移章节">↑</button>
        <button type="button" data-theme-chapter-down="${index}" class="${secondary}" aria-label="下移章节">↓</button>
        <button type="button" data-theme-chapter-remove="${index}" class="${secondary}">移除</button></div></div>
      <label class="mt-3 block">${rowLabel('章节标题')}<input data-chapter-title class="${ui}" maxlength="100" value="${esc(chapter.title)}"></label>
      <fieldset class="mt-3"><legend class="text-[11px] font-bold text-stone-700">本章讲述哪些节点</legend>
        <div class="mt-2 flex flex-wrap gap-2">${draft.nodes.map(node => `<label class="flex min-h-11 items-center gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2 text-[11px]"><input data-chapter-node type="checkbox" value="${esc(node.entityId)}" ${checked(nodeIds, node.entityId)}><span>${esc(nodeLabel(node))}</span></label>`).join('')}</div>
        <p class="mt-1 text-[10px] text-stone-500">更改章节节点后，点击“更新可选依据”。</p></fieldset>
      <button type="button" data-theme-chapter-refresh="${index}" class="${secondary} mt-2">更新可选依据</button>
      <label class="mt-3 block">${rowLabel('章节故事正文')}<textarea data-chapter-body class="${ui} min-h-32" maxlength="2500">${esc(chapter.body)}</textarea></label>
      <fieldset class="mt-3"><legend class="text-[11px] font-bold text-stone-700">本章有效来源</legend>
        <div class="mt-2 grid gap-2 sm:grid-cols-2">${links.map(item => `<label class="flex min-h-11 items-center gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2 text-[11px]"><input data-chapter-link type="checkbox" value="${esc(item.id)}" ${checked(chapter.sourceLinkIds || [], item.id)}><span>${esc(item.summary || item.id)}</span></label>`).join('') || '<p class="text-xs text-amber-700">先选择本章节点。</p>'}</div></fieldset>
      <fieldset class="mt-3"><legend class="text-[11px] font-bold text-stone-700">本章已确认事实 · 发布至少一条</legend>
        <div class="mt-2 grid gap-2">${claims.map(item => `<label class="flex min-h-11 items-center gap-2 rounded-lg border border-stone-200 bg-white px-3 py-2 text-[11px]"><input data-chapter-claim type="checkbox" value="${esc(item.id)}" ${checked(chapter.claimIds || [], item.id)}><span>${esc(item.claimText)}</span></label>`).join('') || '<p class="text-xs text-amber-700">本章资源暂无已确认事实。</p>'}</div>
        <p class="mt-1 text-[10px] text-stone-500">被选中的事实原句须出现在正文中，且其来源也须勾选。</p></fieldset></div>`;
  }

  function render() {
    if (!workspace) return;
    const c = catalog();
    const options = c.entities.filter(item => {
      const resource = c.resources.find(row => row.id === item.resourceId);
      const needle = search.toLowerCase();
      return !needle || [item.name, ...(item.aliases || []), resource && resource.title,
        item.region && item.region.province].some(value => String(value || '').toLowerCase().includes(needle));
    }).filter(item => !draft.nodes.some(node => node.entityId === item.id && node.resourceId === item.resourceId));
    const nodeIds = new Set(draft.nodes.map(node => node.entityId));
    const relations = c.relations.filter(item => nodeIds.has(item.fromEntityId) && nodeIds.has(item.toEntityId));
    list.innerHTML = `<div data-theme-workspace class="space-y-5">
      <section class="rounded-2xl border border-[#e2d3b8] bg-white p-4 shadow-sm">
        <div class="flex flex-wrap items-end justify-between gap-3"><div><p class="text-[10px] font-bold tracking-[0.12em] text-[#9e2f24]">专题编辑</p>
          <h3 class="mt-1 text-lg font-bold text-[#332a21]">跨资源主题宏链</h3><p class="mt-1 text-xs leading-6 text-stone-600">选已确认资源与实体，逐章写故事。地图、时间线和链迹由已核对内容展开。</p></div>
          <button type="button" data-theme-new class="${secondary}">新建主题</button></div>
        <div class="mt-4 flex flex-wrap gap-2">${workspace.themes.map(item => `<button type="button" data-theme-open="${esc(item.id)}" class="${item.id === themeId ? primary : secondary}">${esc(item.title)} · ${item.publishedVersion ? '已发布第 ' + item.publishedVersion + ' 版' : '草稿'}</button>`).join('') || '<p class="text-xs text-stone-500">还没有专题。</p>'}</div>
      </section>
      <div data-theme-editor class="space-y-5">
        <section class="rounded-2xl border border-[#e2d3b8] bg-white p-4 shadow-sm">
          <div class="flex flex-wrap items-center justify-between gap-2"><h3 class="text-base font-bold text-[#332a21]">${themeId ? '编辑专题' : '创建专题'}</h3>
          <span class="text-xs text-stone-500">${themeId ? '草稿修订 ' + revision : '尚未保存'} · ${draft.nodes.length} 个节点</span></div>
          <div class="mt-4 grid gap-3"><label>${rowLabel('专题名称')}<input data-theme-title class="${ui}" maxlength="100" value="${esc(draft.title)}"></label>
          <label>${rowLabel('导语')}<textarea data-theme-introduction class="${ui} min-h-24" maxlength="800">${esc(draft.introduction)}</textarea></label>
          <label>${rowLabel('关键问题 · 每行一个')}<textarea data-theme-questions class="${ui} min-h-20" maxlength="1600">${esc((draft.questions || []).join('\n'))}</textarea></label>
          <label>${rowLabel('结语（可选）')}<textarea data-theme-closing class="${ui} min-h-20" maxlength="800">${esc(draft.closing)}</textarea></label></div>
        </section>
        <section class="rounded-2xl border border-[#e2d3b8] bg-white p-4 shadow-sm">
          <h3 class="text-base font-bold text-[#332a21]">1 · 选择资源与实体</h3>
          <p class="mt-1 text-xs text-stone-600">可按资源名、实体名、别名或省份筛选。跨地区节点遵守同一审核规则。</p>
          <input data-theme-search class="${ui} mt-3" placeholder="搜索资源、实体、别名、地区" value="${esc(search)}">
          <div class="mt-3 flex flex-wrap gap-2"><select data-theme-add-select class="${ui} max-w-lg"><option value="">选择已确认实体</option>
            ${options.slice(0, 80).map(item => `<option value="${esc(item.id)}">${esc(item.name)} · ${esc(c.resources.find(row => row.id === item.resourceId)?.title || item.resourceId)} · ${esc(item.region?.province || '地区待补')}</option>`).join('')}</select>
            <button type="button" data-theme-add-node class="${secondary}">加入节点</button></div>
          <div class="mt-4 grid gap-3">${draft.nodes.map(renderNode).join('') || '<p class="text-xs text-stone-500">尚未选择节点。</p>'}</div>
        </section>
        <section class="rounded-2xl border border-[#e2d3b8] bg-white p-4 shadow-sm">
          <h3 class="text-base font-bold text-[#332a21]">2 · 正式关系与建议</h3>
          <p class="mt-1 text-xs leading-6 text-stone-600">这里只能选已有人工确认的关系。没有关系时，可以按地点或年代并列讲述，不能写成历史传播。</p>
          <div class="mt-3 grid gap-2">${relations.map(item => `<label class="flex min-h-11 items-center gap-2 rounded-lg border border-stone-200 p-3 text-xs"><input data-theme-relation type="checkbox" value="${esc(item.id)}" ${checked(draft.relationIds || [], item.id)}><span>${esc(item.relationType)} · ${esc(item.why)} · ${item.evidenceLinkIds.length} 份依据</span></label>`).join('') || '<p class="text-xs text-amber-700">当前节点之间没有正式关系，可先保存并补充证据。</p>'}</div>
          <div class="mt-4 flex flex-wrap gap-2"><button type="button" data-theme-suggest class="${secondary}" ${themeId ? '' : 'disabled'}>查看排序与缺口建议</button>
          <button type="button" data-theme-ai-suggest class="${secondary}" ${themeId ? '' : 'disabled'}>生成 AI 专题提纲</button></div>
          ${proposal ? `<div data-theme-proposal class="mt-4 rounded-xl border border-[#d8c6a7] bg-[#fffaf1] p-4 text-xs leading-6">
            <p class="font-bold text-[#9e2f24]">编辑建议 · 尚未确认</p>
            <p>建议顺序：${proposal.deterministic.suggestedOrder.map(item => esc(c.entities.find(e => e.id === item.entityId)?.name || item.entityId)).join(' → ')}</p>
            <p>资料缺口：${proposal.deterministic.gaps.map(item => esc(item.request)).join('；') || '暂无明显缺口'}</p>
            <button type="button" data-theme-apply-order class="${secondary} mt-2">采用建议顺序</button>
            ${proposal.ai ? `<p class="mt-3 font-bold">AI 提纲：${esc(proposal.ai.title || '待命名')}</p>
              <p>${proposal.ai.chapters.map(item => esc(item.title)).join(' → ')}</p>
              <p>AI 建议补充：${proposal.ai.gaps.map(item => esc(item.request)).join('；') || '暂无'}</p>
              <button type="button" data-theme-apply-ai class="${secondary} mt-2">采用 AI 章节框架</button>` : ''}</div>` : ''}
        </section>
        <section class="rounded-2xl border border-[#e2d3b8] bg-white p-4 shadow-sm">
          <div class="flex flex-wrap items-center justify-between gap-3"><div><h3 class="text-base font-bold text-[#332a21]">3 · 专题故事</h3>
            <p class="mt-1 text-xs text-stone-600">编辑正文，选择章节节点、来源和已确认事实；每章可独立调整顺序。</p></div>
            <button type="button" data-theme-add-chapter class="${secondary}">添加章节</button></div>
          <div class="mt-4 grid gap-3">${draft.chapters.map(renderChapter).join('') || '<p class="text-xs text-stone-500">尚未添加章节。</p>'}</div>
        </section>
        <section class="rounded-2xl border border-[#e2d3b8] bg-white p-4 shadow-sm">
          <h3 class="text-base font-bold text-[#332a21]">4 · 保存与发布</h3>
          <p class="mt-1 text-xs leading-6 text-stone-600">保存只更新草稿。发布会重新检查全部来源、正式关系与事实，保留旧版本。</p>
          <div class="mt-3 flex flex-wrap gap-2"><button type="button" data-theme-save class="${primary}">保存草稿</button>
          ${themeId ? `<button type="button" data-theme-publish class="${secondary}">审核并发布新版本</button>
            <button type="button" data-theme-archive class="${secondary}">归档专题</button>` : ''}</div>
          ${themeId ? `<label class="mt-3 flex items-center gap-2 text-xs"><input data-theme-reviewed type="checkbox"> 我已逐章核对重要判断与来源</label>
            <label class="mt-3 block">${rowLabel('审核说明 · 至少 8 字')}<textarea data-theme-review-note class="${ui} min-h-20" maxlength="300"></textarea></label>` : ''}
        </section>
        ${adoptionWorkspace ? `<section class="rounded-2xl border border-[#e2d3b8] bg-white p-4 shadow-sm">
          <h3 class="text-base font-bold text-[#332a21]">已发布专题 · 正式采用</h3>
          <p class="mt-1 text-xs leading-6 text-stone-600">第 ${Number(adoptionWorkspace.version)} 版。普通引用不会计入采用；确认后会通知投稿者，不自动发积分。</p>
          ${!adoptionWorkspace.available ? '<p class="mt-2 text-xs text-amber-700">专题来源待复核，暂不能确认采用。</p>' : ''}
          <div class="mt-3 grid gap-3">${adoptionWorkspace.chapters.map(chapter => `<div class="rounded-xl border border-stone-200 p-3">
            <h4 class="text-xs font-bold text-stone-800">第 ${chapter.number} 章 · ${esc(chapter.title)}</h4>
            <div class="mt-2 grid gap-2">${chapter.sources.map(source => `<div data-theme-adoption-source data-chapter-id="${esc(chapter.id)}" data-source-link-id="${esc(source.sourceLinkId)}" class="rounded-lg border border-stone-100 bg-[#fffaf1] p-3 text-xs">
              <p class="font-bold text-stone-800">${esc(source.title)}</p><p class="mt-1 text-stone-500">${esc(source.summary)}</p>
              ${source.adopted ? '<p class="mt-2 font-bold text-emerald-700">已正式采用</p>' : `<div class="mt-2 flex flex-wrap items-start gap-2">
                <button type="button" data-theme-adopt class="${secondary}" ${adoptionWorkspace.available ? '' : 'disabled'}>正式采用</button>
                <details class="min-w-40 text-stone-600"><summary class="flex min-h-11 cursor-pointer items-center text-[11px]">贡献类型与缺口（可选）</summary>
                  <div class="mt-1 grid gap-2"><select data-adoption-type class="${ui}"><option value="source_support">资料佐证</option><option value="oral_history">口述记录</option><option value="visual_record">影像记录</option><option value="document_transcription">文献转录</option></select>
                  <label class="flex min-h-11 items-center gap-2"><input data-adoption-gap type="checkbox"> 解决资料缺口</label>
                  <input data-adoption-gap-note class="${ui}" maxlength="180" placeholder="勾选缺口时说明是哪项"></div></details>
              </div>`}</div>`).join('') || '<p class="text-xs text-stone-500">本章暂无可用投稿来源。</p>'}</div></div>`).join('')}</div>
        </section>` : ''}
      </div></div>`;
  }

  async function load(openId) {
    setActiveView('story-themes', '主题专题');
    list.innerHTML = '<div class="rounded-2xl border border-stone-200 bg-white p-5 text-sm text-stone-500">正在读取专题资料…</div>';
    try {
      workspace = await callAdmin({ action: 'getStoryThemeWorkspace' });
      const pickedTheme = workspace.themes.find(item => item.id === openId);
      if (pickedTheme) {
        themeId = pickedTheme.id; revision = pickedTheme.revision; proposal = pickedTheme.proposal;
        draft = { ...pickedTheme, nodes: structuredClone(pickedTheme.nodes),
          relationIds: [...pickedTheme.relationIds], chapters: structuredClone(pickedTheme.chapters) };
        adoptionWorkspace = pickedTheme.publishedVersion ? await callAdmin({
          action: 'getStoryThemeContributionWorkspace', themeId }) : null;
      } else { themeId = ''; revision = 0; proposal = null; adoptionWorkspace = null; draft = empty(); }
      savedState = stateKey(draft);
      viewCount.textContent = workspace.themes.length + ' 个专题';
      render();
    } catch (error) { notice(error.message || '专题资料读取失败', true); }
  }

  const move = (items, index, delta) => {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    [items[index], items[target]] = [items[target], items[index]];
  };
  button.addEventListener('click', () => load(themeId));
  content.addEventListener('click', async event => {
    if (adminPanel.dataset.view !== 'story-themes') return;
    const target = event.target.closest('button');
    if (!target || !content.contains(target)) return;
    try {
      if (target.hasAttribute('data-theme-open')) return load(target.dataset.themeOpen);
      if (target.hasAttribute('data-theme-new')) return load('');
      if (target.hasAttribute('data-theme-adopt')) {
        const row = target.closest('[data-theme-adoption-source]');
        const resolvesGap = row.querySelector('[data-adoption-gap]').checked;
        const gapNote = row.querySelector('[data-adoption-gap-note]').value.trim();
        const contributionType = row.querySelector('[data-adoption-type]').value;
        if (resolvesGap && gapNote.length < 4) return notice('请写明解决了哪项资料缺口。', true);
        target.disabled = true;
        try {
          await callAdmin({ action: 'adoptStoryThemeContribution', themeId,
            themeVersion: adoptionWorkspace.version, chapterId: row.dataset.chapterId,
            sourceLinkId: row.dataset.sourceLinkId, contributionType, resolvesGap, gapNote });
          await load(themeId); notice('已记录正式采用，并通知投稿者。');
        } catch (error) { target.disabled = false; throw error; }
        return;
      }
      readEditor();
      if (target.hasAttribute('data-theme-add-node')) {
        const value = content.querySelector('[data-theme-add-select]').value;
        const item = catalog().entities.find(row => row.id === value);
        if (!item) return notice('请先选择一个已确认实体', true);
        draft.nodes.push({ entityId: item.id, resourceId: item.resourceId,
          sourceLinkIds: [], storyId: '', group: '', note: '' });
        proposal = null; return render();
      }
      if (target.hasAttribute('data-theme-add-chapter')) {
        draft.chapters.push({ id: 'chapter_' + crypto.randomUUID().replaceAll('-', ''),
          title: '', body: '', nodeIds: [], sourceLinkIds: [], claimIds: [] });
        return render();
      }
      for (const [kind, key] of [['node', 'nodes'], ['chapter', 'chapters']]) {
        for (const action of ['up', 'down', 'remove', 'refresh']) {
          const attr = 'data-theme-' + kind + '-' + action;
          if (!target.hasAttribute(attr)) continue;
          const index = Number(target.getAttribute(attr));
          if (action === 'remove') draft[key].splice(index, 1);
          else if (action === 'up' || action === 'down') move(draft[key], index, action === 'up' ? -1 : 1);
          if (kind === 'node') proposal = null;
          return render();
        }
      }
      if (target.hasAttribute('data-theme-apply-order') && proposal) {
        const order = proposal.deterministic.suggestedOrder.map(item => item.entityId);
        draft.nodes.sort((a, b) => order.indexOf(a.entityId) - order.indexOf(b.entityId));
        proposal = null; return render();
      }
      if (target.hasAttribute('data-theme-apply-ai') && proposal?.ai) {
        draft.chapters = proposal.ai.chapters.map(item => ({
          id: 'chapter_' + crypto.randomUUID().replaceAll('-', ''),
          title: item.title, body: '', nodeIds: item.nodeIds,
          sourceLinkIds: item.sourceLinkIds, claimIds: []
        }));
        proposal = null; return render();
      }
      if (target.hasAttribute('data-theme-save')) {
        const result = await callAdmin({ action: 'saveStoryTheme', themeId, expectedRevision: revision, ...draft });
        await load(result.themeId); notice('专题草稿已保存。'); return;
      }
      if (target.hasAttribute('data-theme-suggest') || target.hasAttribute('data-theme-ai-suggest')) {
        if (!themeId) return notice('先保存专题草稿，再获取建议。', true);
        if (stateKey(draft) !== savedState) return notice('请先保存当前修改，再获取建议。', true);
        const result = await callAdmin({ action: 'suggestStoryTheme', themeId, expectedRevision: revision,
          useAi: target.hasAttribute('data-theme-ai-suggest') });
        proposal = result.proposal; render(); notice('建议已生成，可逐项采用。'); return;
      }
      if (target.hasAttribute('data-theme-publish')) {
        if (stateKey(draft) !== savedState) return notice('请先保存当前修改，再审核发布。', true);
        const reviewNote = content.querySelector('[data-theme-review-note]').value.trim();
        const humanReviewed = content.querySelector('[data-theme-reviewed]').checked;
        const result = await callAdmin({ action: 'publishStoryTheme', themeId,
          expectedRevision: revision, humanReviewed, reviewNote });
        await load(result.themeId); notice('专题第 ' + result.version + ' 版已发布。'); return;
      }
      if (target.hasAttribute('data-theme-archive')) {
        const reason = window.prompt('请填写归档原因（至少 4 字）');
        if (reason == null) return;
        await callAdmin({ action: 'archiveStoryTheme', themeId, reason });
        await load(''); notice('专题已归档。');
      }
    } catch (error) { notice((error.code ? error.code + '：' : '') + (error.message || '操作失败'), true); }
  });
  content.addEventListener('input', event => {
    if (adminPanel.dataset.view !== 'story-themes' || !event.target.matches('[data-theme-search]')) return;
    search = event.target.value.trim();
    const selector = content.querySelector('[data-theme-add-select]');
    const options = catalog().entities.filter(item => {
      const resource = catalog().resources.find(row => row.id === item.resourceId);
      return [item.name, ...(item.aliases || []), resource && resource.title, item.region?.province]
        .some(value => String(value || '').toLowerCase().includes(search.toLowerCase()));
    }).filter(item => !draft.nodes.some(node => node.entityId === item.id && node.resourceId === item.resourceId));
    selector.innerHTML = '<option value="">选择已确认实体</option>' + options.slice(0, 80)
      .map(item => '<option value="' + esc(item.id) + '">' + esc(item.name) + ' · ' +
        esc(catalog().resources.find(row => row.id === item.resourceId)?.title || item.resourceId) + '</option>').join('');
  });
})();
