(function () {
  'use strict';
  const ENV_ID = 'chulink-legacy-d8god1687a5d60743';
  const REGION = 'ap-shanghai';
  const content = document.getElementById('theme-content');
  const status = document.getElementById('theme-status');
  const esc = value => String(value == null ? '' : value)
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  const relationLabel = Object.freeze({
    located_at: '位于', documents: '记录', depicts: '呈现',
    uses_craft: '采用技艺', associated_with_person: '关联人物',
    associated_with_event: '关联事件', mentioned_in: '见于记载',
    changed_over_time: '时代演变', visually_similar_to: '外观相似',
    influenced_or_transmitted_to: '传播与影响'
  });
  const materialLabel = Object.freeze({
    image_ocr: '图片文字校对', image_observation: '画面观察校对',
    audio_transcript: '音频转写校对', video_audio: '视频声音校对',
    video_frames: '视频画面校对'
  });

  function sourceCard(source, adopted = false) {
    const material = source.material;
    return `<div class="source-row"><strong>用户贡献 · ${esc(source.submissionTitle || '社区文化记录')}</strong>
      ${adopted ? '<p class="adopted-mark">管理员已确认：本章正式采用</p>' : ''}
      <p>${esc(source.summary || '已确认的来源记录')}</p>
      <p>贡献者：${esc(source.contributorName || '匿名贡献者')}</p>
      ${material ? `<p>${esc(materialLabel[material.kind] || material.kind)} · 校对第 ${Number(material.reviewVersion) || 0} 版
        ${material.locator ? ' · 位置：' + esc(JSON.stringify(material.locator)) : ''}</p>` : ''}</div>`;
  }
  const yearLabel = value => value == null || !Number.isFinite(Number(value)) ? '年代待补' :
    Number(value) < 0 ? '公元前 ' + Math.abs(Number(value)) + ' 年' : '公元 ' + Number(value) + ' 年';

  function renderMap(nodes) {
    const points = nodes.filter(node => node.location &&
      Number.isFinite(Number(node.location.latitude)) && Number.isFinite(Number(node.location.longitude)));
    if (!points.length) return '<p class="expand-help">这些资源尚无可公开展示的坐标。</p>';
    const lats = points.map(node => Number(node.location.latitude));
    const lngs = points.map(node => Number(node.location.longitude));
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    const x = value => 12 + ((value - minLng) / (maxLng - minLng || 1)) * 76;
    const y = value => 16 + ((maxLat - value) / (maxLat - minLat || 1)) * 68;
    const centerX = points.length === 1 || maxLng === minLng;
    const centerY = points.length === 1 || maxLat === minLat;
    return `<div class="map-box" role="img" aria-label="专题资源地理坐标示意图">
      ${points.map((node, index) => {
        const left = centerX ? 50 : x(Number(node.location.longitude));
        const top = centerY ? 50 : y(Number(node.location.latitude));
        return `<span class="map-point" style="left:${left}%;top:${top}%">${index + 1}</span>
          <span class="map-label" style="left:${left}%;top:${top}%">${esc(node.region.province || node.region.city || node.label)}</span>`;
      }).join('')}</div>
      <p class="expand-help">按已发布资源坐标绘制。点位顺序用于阅读，不表示历史传播路线或游览路线。</p>`;
  }

  function contributionLinks(chapter,theme,nodeById){return [...new Set(chapter.nodeIds.map(id=>nodeById.get(id)?.resourceId).filter(Boolean))].map(id=>'<a class="story-link" data-effect-contribute="theme" href="./index.html?guideResourceId='+encodeURIComponent(id)+'">为「'+esc(theme.nodes.find(n=>n.resourceId===id)?.resourceTitle||'本章地点')+'」补充资料 →</a>').join(' · ');}
  function renderTheme(theme) {
    const nodeById = new Map((theme.nodes || []).map(node => [node.id, node]));
    const sourceById = new Map((theme.sources || []).map(source => [source.id, source]));
    const claimById = new Map((theme.claims || []).map(claim => [claim.id, claim]));
    const regions = [...new Set((theme.nodes || []).map(node => node.region && node.region.province).filter(Boolean))];
    const chapters = (theme.chapters || []).map((chapter, index) => {
      const sources = chapter.sourceLinkIds.map(id => sourceById.get(id)).filter(Boolean);
      const claims = chapter.claimIds.map(id => claimById.get(id)).filter(Boolean);
      return `<article class="chapter" id="theme-chapter-${index + 1}" tabindex="-1">
        <p class="chapter-number"><span>第 ${index + 1} 章</span><span class="chapter-region">${esc([...new Set(chapter.nodeIds.map(id => nodeById.get(id)?.region?.province || '').filter(Boolean))].join('、'))}</span></p>
        <h2>${esc(chapter.title)}</h2>
        <p class="chapter-body">${esc(chapter.body)}</p>
        <div class="claim-list" aria-label="本章已确认事实">${claims.map((claim, claimIndex) => `
          <details class="claim-item"><summary>事实 ${claimIndex + 1} · ${esc(claim.text)}</summary>
            <div class="claim-sources"><p class="expand-help">以下投稿是这条事实的已确认依据。</p>
              ${claim.sourceLinkIds.map(id => sourceById.get(id)).filter(Boolean)
                .map(source => sourceCard(source, (chapter.adoptedSourceLinkIds || []).includes(source.id))).join('')}
              <a class="story-link" href="./index.html?storyResourceId=${encodeURIComponent(claim.resourceId)}">查看完整故事 →</a>
            </div></details>`).join('')}</div>
        <details class="chapter-source"><summary>查看本章来源 · ${sources.length} 份</summary>
          ${sources.map(source => sourceCard(source, (chapter.adoptedSourceLinkIds || []).includes(source.id))).join('')}</details>
        <p class="chapter-contribute">${contributionLinks(chapter,theme,nodeById)}</p>
      </article>`;
    }).join('');
    const timeline = [...theme.nodes].sort((a, b) => {
      const ay = a.timeRange && a.timeRange.startYear;
      const by = b.timeRange && b.timeRange.startYear;
      if (ay == null) return by == null ? a.order - b.order : 1;
      if (by == null) return -1;
      return Number(ay) - Number(by) || a.order - b.order;
    });
    content.innerHTML = `<a class="back-link" href="./themes.html">← 返回主题故事</a>
      <header class="theme-hero"><p class="eyebrow">已审核专题 · 第 ${Number(theme.version) || 1} 版</p>
        <h1>${esc(theme.title)}</h1><p class="intro">${esc(theme.introduction)}</p>
        <div class="theme-meta"><span>${theme.chapters.length} 章故事</span>
          <span>${theme.nodes.length} 个节点</span><span>${esc(regions.join(' · ') || '地区资料待补')}</span></div>
        ${theme.questions && theme.questions.length ? `<p class="theme-questions">继续寻找：${theme.questions.map(esc).join('；')}</p>` : ''}
      </header>
      <nav class="chapter-directory" aria-label="章节目录"><h2>本篇目录</h2>
        <ol>${theme.chapters.map((chapter, index) => `<li><a href="#theme-chapter-${index + 1}"><span>${String(index + 1).padStart(2, '0')}</span>${esc(chapter.title)}</a></li>`).join('')}</ol>
      </nav>
      <div class="story" aria-label="专题故事">${chapters}</div>
      ${theme.closing ? `<p class="closing">${esc(theme.closing)}</p>` : ''}
      <div class="expand" aria-label="展开地图、时间线和链迹">
        <details><summary>地点地图</summary><div class="expand-body">
          <p class="expand-help">跨地区资源位置；原始私有文件不会在这里公开。</p>
          ${renderMap(theme.nodes)}</div></details>
        <details><summary>时间线</summary><div class="expand-body">
          <p class="expand-help">时间来自已确认实体；先后顺序本身不代表因果关系。</p>
          <div class="timeline">${timeline.map(node => `<div class="timeline-item">
            <strong>${esc(yearLabel(node.timeRange && node.timeRange.startYear))} · ${esc(node.label)}</strong>
            <p>${esc(node.resourceTitle)} · ${esc(node.region.province || node.region.city || '地点待补')}</p>
          </div>`).join('')}</div></div></details>
        <details><summary>完整链迹</summary><div class="expand-body">
          <p class="expand-help">节点由管理员选定；下面只展示已确认且来源仍有效的正式关系。</p>
          <ol class="chain-list">${theme.nodes.map(node => `<li><strong>${esc(node.label)}</strong>
            <small>${esc(node.resourceTitle)} · ${esc(node.region.province || node.region.city || '地点待补')}</small></li>`).join('')}</ol>
          <h3 class="relation-heading">正式关系</h3>
          ${theme.relations.length ? theme.relations.map(relation => `<div class="relation-row">
            <strong>${esc(nodeById.get(relation.from)?.label || relation.from)} → ${esc(nodeById.get(relation.to)?.label || relation.to)}
              · ${esc(relationLabel[relation.type] || relation.type)}</strong>
            <p>${esc(relation.why)}</p><small>${relation.sourceLinkIds.length} 份已确认依据</small>
            <details class="chapter-source"><summary>查看关系来源</summary>
              ${relation.sourceLinkIds.map(id => sourceById.get(id)).filter(Boolean).map(source => sourceCard(source)).join('')}</details>
          </div>`).join('') : '<p class="expand-help">当前节点间没有已确认的正式关系。</p>'}</div></details>
      </div>`;
    status.textContent = '';
    window.ContentEffects?.open('theme',{kind:'theme',id:theme.id,version:String(theme.version)});
    document.title = theme.title + ' · 楚韵链迹';
  }

  function renderList(items) {
    content.innerHTML = `<section class="theme-list-heading"><h1>主题故事</h1>
      <p class="intro">沿着地点与年代，读一段有来处的故事。<br>每章都能查看已确认的事实与来源。</p></section>
      ${items.length ? `<div class="theme-list">${items.map(item => `<article class="theme-card">
        <a href="./themes.html?id=${encodeURIComponent(item.id)}"><div class="theme-entry-copy"><p class="eyebrow">已审核专题 · 第 ${Number(item.version) || 1} 版</p>
          <h2>${esc(item.title)}</h2><p class="theme-card-intro">${esc(item.introduction)}</p>
          <p class="theme-card-meta">${Number(item.chapterCount) || 0} 章 · ${esc((item.regions || []).join(' · ') || '地区待补')}</p></div>
          <span class="theme-card-read">阅读故事 →</span></a>
        </article>`).join('')}</div>` : `<section class="theme-empty">
          <img class="theme-empty-art" src="./static/assets/theme-phoenix-book-v1.png" alt="" width="112" height="112">
          <h2>故事正在整理</h2><p>目前没有可以公开阅读的专题。管理员完成来源核对后，会在这里发布。</p>
          <div class="theme-empty-actions"><a href="./index.html">先去发现页看看 →</a></div></section>`}`;
    status.textContent = '';
    document.title = '主题故事 · 楚韵链迹';
  }

  async function callCore(data) {
    if (!window.cloudbase) throw new Error('页面连接暂时不可用');
    const app = window.cloudbase.init({ env: ENV_ID, region: REGION });
    const auth = app.auth({ persistence: 'local' });
    let state = await auth.getLoginState();
    if (!state) {
      await auth.anonymousAuthProvider().signIn();
      state = await auth.getLoginState();
    }
    if (!state || !state.user || !(state.user.uid || state.user.id))
      throw new Error('暂时无法取得访客身份');
    const response = await app.callFunction({ name: 'appCore', data });
    let result = response && response.result !== undefined ? response.result : response;
    if (typeof result === 'string') {
      try { result = JSON.parse(result); } catch (_) {}
    }
    if (!result || result.ok !== true)
      throw new Error(result && result.error && result.error.message || '专题读取失败');
    return result;
  }

  async function start() {
    status.dataset.state = 'loading';
    status.textContent = '正在读取专题…';
    content.innerHTML = '';
    content.setAttribute('aria-busy', 'true');
    try {
      const themeId = new URLSearchParams(location.search).get('id');
      if (themeId) {
        const result = await callCore({ action: 'getStoryTheme', themeId });
        renderTheme(result.theme);
      } else {
        const result = await callCore({ action: 'listStoryThemes' });
        renderList(result.items || []);
      }
    } catch (error) {
      status.dataset.state = 'error';
      status.textContent = error.message || '专题暂时无法读取';
      content.innerHTML = '<section class="theme-empty"><h1>这篇故事暂时无法打开</h1><p>可以重新读取，或返回发现页稍后再来。</p><div class="theme-empty-actions"><button type="button" data-theme-retry>重新读取</button><a href="./index.html">返回发现页</a></div></section>';
    } finally {
      content.setAttribute('aria-busy', 'false');
    }
  }
  const brandImage = document.querySelector('.brand img');
  const showBrandFallback = () => { brandImage.hidden = true; document.querySelector('.brand-fallback').hidden = false; };
  brandImage.addEventListener('error', showBrandFallback);
  if (brandImage.complete && !brandImage.naturalWidth) showBrandFallback();
  window.ContentEffects?.configure(callCore);
  content.addEventListener('toggle',e=>{if(e.target.open&&(e.target.matches('.chapter-source')||e.target.matches('.claim-item')))window.ContentEffects?.emit('theme','source_open');else if(e.target.open&&e.target.closest('.expand'))window.ContentEffects?.emit('theme','explore');},true);
  content.addEventListener('click',e=>{if(e.target.closest('[data-theme-retry]'))start();if(e.target.closest('.story-link'))window.ContentEffects?.emit('theme','explore');});
  start();
})();
