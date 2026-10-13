/* Local painted-atlas interaction; no location, model or business API. */
(function (global) {
  'use strict';
  function init({ onDetail } = {}) {
    const layout = global.ChuParkLayout;
    const $ = id => document.getElementById(id);
    if (!layout || !$('motion-park-stage')) return null;
    const stage = $('motion-park-stage'), world = $('motion-park-world');
    const key = 'chulink:motion-demo:park-viewed:v2';
    const known = new Map(layout.points.map(point => [point.id, point]));
    let viewed = new Set(), selected = known.get('tower'), drag = null, suppressedUntil = 0;
    try { const saved = JSON.parse(localStorage.getItem(key) || '[]'); if (Array.isArray(saved)) viewed = new Set(saved.filter(id => known.has(id))); } catch (_) { /* Optional private browser record. */ }
    const buttons = new Map();
    const art = $('park-art');
    const sizeArt = () => { if (art.naturalWidth && art.naturalHeight) world.style.aspectRatio = art.naturalWidth + ' / ' + art.naturalHeight; };
    art.addEventListener('load', sizeArt); sizeArt();
    // Only these four illustrations have been visually matched. Other points
    // locate source material in an approximate district, not the painted prop.
    const anchors = {tower:[23,25], copper:[34,36], baiyun:[51,37], pond:[40,65], bell:[38,24], 'poetry-corridor':[41,77]};
    function select(id, record = true) {
      const point = known.get(id); if (!point) return;
      selected = point;
      if (record) { viewed.add(id); try { localStorage.setItem(key, JSON.stringify([...viewed])); } catch (_) { /* Never upload fallback data. */ } }
      for (const [pointId, button] of buttons) { button.setAttribute('aria-pressed', String(pointId === id)); button.dataset.viewed = String(viewed.has(pointId)); }
      $('park-point-title').textContent = point.title;
      $('park-point-copy').textContent = point.description + (point.sceneId ? '' : ' 这里先标出资料的大致位置，景物造型还在补绘，请勿据画中的建筑辨认现场。');
      $('park-point-region').textContent = layout.districts.find(region => region.id === point.district)?.title || '画卷中的景物';
      $('park-progress').textContent = '画中拾景 ' + viewed.size + ' / ' + layout.points.length;
      $('park-open-detail').hidden = !point.sceneId;
      // Keep source URLs from the checked, local manifest; never accept user text as HTML or links.
      const source = point.sourceIds.map(id => layout.sources[id]).find(source => source.kind !== 'secondary-map-reference');
      $('park-point-source').href = source.url;
      $('park-point-source').textContent = '查看资料依据';
      world.dataset.selected = id;
    }
    $('park-points').replaceChildren();
    for (const point of layout.points) {
      const button = document.createElement('button'), title = document.createElement('span');
      button.type = 'button'; button.className = 'park-point'; button.dataset.parkPoint = point.id;
      button.dataset.illustrated = String(Boolean(point.sceneId));
      const anchor = anchors[point.id] || [point.x, point.y];
      button.style.left = anchor[0] + '%'; button.style.top = anchor[1] + '%';
      button.setAttribute('aria-label', '在画卷中了解' + point.title);
      title.textContent = point.title; button.append(title);
      button.addEventListener('click', event => { if (event.detail && performance.now() < suppressedUntil) return; select(point.id); });
      $('park-points').append(button); buttons.set(point.id, button);
    }
    $('park-open-detail').addEventListener('click', () => { if (selected?.sceneId && onDetail) onDetail(selected.sceneId); });
    // Touch keeps native scrolling and inertia. Mouse/pen drag offers the same affordance.
    stage.addEventListener('pointerdown', event => {
      if (event.pointerType === 'touch' || event.button !== 0) return;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: stage.scrollLeft, top: stage.scrollTop, moved: false };
    });
    stage.addEventListener('pointermove', event => {
      if (!drag || drag.id !== event.pointerId) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (Math.hypot(dx,dy) < 5 && !drag.moved) return;
      if (!drag.moved) { drag.moved = true; stage.classList.add('dragging'); stage.setPointerCapture(event.pointerId); }
      stage.scrollLeft = drag.left - dx; stage.scrollTop = drag.top - dy;
      event.preventDefault();
    });
    function end() { if (drag?.moved) suppressedUntil = performance.now() + 350; drag = null; stage.classList.remove('dragging'); }
    stage.addEventListener('pointerup', end); stage.addEventListener('pointercancel', end); stage.addEventListener('lostpointercapture', end);
    stage.addEventListener('keydown', event => {
      if (event.target !== stage) return;
      const move = {ArrowLeft:[-70,0],ArrowRight:[70,0],ArrowUp:[0,-70],ArrowDown:[0,70]};
      if (move[event.key]) { event.preventDefault(); stage.scrollBy(...move[event.key]); }
      if (event.key === 'Home') { event.preventDefault(); stage.scrollTo(0,0); }
    });
    select('tower', false);
    return Object.freeze({
      open() {
        select(selected.id, false);
        // Initial framing holds the western tower; the scrollable world remains full size.
        const anchor = anchors[selected.id] || [selected.x, selected.y];
        stage.scrollLeft = Math.max(0, anchor[0] / 100 * world.clientWidth - stage.clientWidth * .5);
        stage.scrollTop = Math.max(0, anchor[1] / 100 * world.clientHeight - stage.clientHeight * .45);
      },
      clear() { viewed.clear(); try { localStorage.removeItem(key); } catch (_) {} select(selected.id, false); }
    });
  }
  global.ChuParkDemo = Object.freeze({init});
})(window);
