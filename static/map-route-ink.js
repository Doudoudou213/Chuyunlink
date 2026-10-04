/* The actual Leaflet path is the animation mask. No fitted/synthetic route. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ChuRouteInk = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const validPoint = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)
    && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180;

  function routeSegments(result, project) {
    if (!result || result.provider !== 'amap-web-service' || result.simulated === true) {
      throw Error('道路数据来源未核实，保留游览顺序图');
    }
    // Preserve leg boundaries: never invent a bridge between disconnected legs.
    const paths = Array.isArray(result.legs) && result.legs.length
      ? result.legs.map(leg => leg.polyline) : [result.polyline];
    if (!paths.length || paths.some(path => !Array.isArray(path) || path.length < 2 || !path.every(validPoint))) {
      throw Error('道路坐标不完整，保留游览顺序图');
    }
    const segments = paths.map(path => path.map(p => project(p)));
    if (segments.some(path => !path.every(validPoint))) throw Error('地图坐标转换失败');
    // Legacy server may replace absent geometry with a two-point straight line.
    // Transit flattening also loses transfer/rail segment boundaries. Do not
    // portray either as an animated, continuous road; retain a dashed overview.
    const animatable = result.mode !== 'transit' && paths.every(path => path.length > 2);
    return { segments, animatable };
  }

  function frameAt(lengths, progress) {
    const total = lengths.reduce((sum, n) => sum + n, 0);
    let remaining = total * Math.max(0, Math.min(1, progress));
    return lengths.map(length => {
      const visible = Math.max(0, Math.min(length, remaining));
      remaining -= length;
      return { visible, offset: length - visible };
    });
  }

  function draw({ map, group, segments, L, animate = true }) {
    const paper = '#f8f4eb', red = '#a7493d', gold = '#b38c45';
    const lines = segments.map(coords => {
      L.polyline(coords, { color: paper, weight: 8, opacity: .85,
        smoothFactor: 0, noClip: true, interactive: false }).addTo(group);
      return L.polyline(coords, { color: red, weight: 4, opacity: .94,
        lineCap: 'round', lineJoin: 'round', smoothFactor: 0, noClip: true,
        interactive: false, className: 'chu-route-ink-path' }).addTo(group);
    });
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    let raf = 0, disposed = false, progress = 0, started = null, running = false;
    let paths = [], lengths = [], tip = null, control = null, playButton = null;
    function removeTip() { tip?.remove(); tip = null; }
    function paint(value) {
      progress = Math.max(0, Math.min(1, value));
      const frames = frameAt(lengths, progress);
      frames.forEach((part, i) => {
        paths[i].style.strokeDasharray = lengths[i] + ' ' + lengths[i];
        paths[i].style.strokeDashoffset = String(part.offset);
      });
      const active = frames.findIndex((part, i) => part.visible > 0 && part.visible < lengths[i]);
      if (active >= 0 && progress < 1) {
        if (!tip) {
          tip = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          tip.setAttribute('r', '4'); tip.setAttribute('fill', gold);
          tip.setAttribute('stroke', paper); tip.setAttribute('stroke-width', '2');
          tip.setAttribute('pointer-events', 'none'); tip.setAttribute('aria-hidden', 'true');
        }
        // Use the SVG's own length/point methods, in the SAME coordinate system.
        paths[active].parentNode.appendChild(tip);
        const p = paths[active].getPointAtLength(frames[active].visible);
        tip.setAttribute('cx', String(p.x)); tip.setAttribute('cy', String(p.y));
      } else removeTip();
    }
    function updateControls() {
      if (playButton) playButton.setAttribute('data-playing', String(running));
    }
    function pause() {
      cancelAnimationFrame(raf); raf = 0; running = false; started = null; updateControls();
    }
    function finish() {
      pause(); progress = 1;
      paths.forEach(path => { path.style.removeProperty('stroke-dasharray'); path.style.removeProperty('stroke-dashoffset'); });
      removeTip(); updateControls();
    }
    function tick(now) {
      if (disposed || !running) return;
      if (started === null) started = now - progress * 8000;
      paint((now - started) / 8000);
      if (progress >= 1) finish(); else raf = requestAnimationFrame(tick);
    }
    function play() {
      if (disposed || !animate || media.matches || document.hidden) { finish(); return; }
      pause();
      paths = lines.map(line => line.getElement()).filter(Boolean);
      if (paths.length !== lines.length || paths.some(p => !p.getTotalLength)) { finish(); return; }
      lengths = paths.map(p => p.getTotalLength());
      if (!lengths.every(n => Number.isFinite(n) && n > 0)) { finish(); return; }
      if (progress >= 1) progress = 0;
      paint(progress); running = true; updateControls();
      raf = requestAnimationFrame(tick);
    }
    function onHidden() { if (document.hidden) finish(); }
    function onView(event) { if (event.detail?.tabId !== 'map') finish(); }
    function onPreference() { if (media.matches) finish(); }
    function destroy() {
      if (disposed) return;
      finish(); disposed = true;
      map.off('movestart zoomstart resize', finish);
      map.off('unload', destroy);
      lines.forEach(line => line.off('remove', destroy));
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('chu:view-changing', onView);
      media.removeEventListener?.('change', onPreference);
      control?.remove();
    }
    if (animate) {
      control = L.control({ position: 'bottomright' });
      control.onAdd = () => {
        const box = L.DomUtil.create('div', 'chu-route-replay-control');
        playButton = document.createElement('button'); playButton.type = 'button';
        playButton.setAttribute('aria-label', '重播路线描线');
        playButton.setAttribute('title', '重播路线描线');
        playButton.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m11 6-6 6 6 6M19 6l-6 6 6 6"/></svg>';
        playButton.onclick = () => { finish(); play(); }; box.appendChild(playButton);
        L.DomEvent.disableClickPropagation(box); L.DomEvent.disableScrollPropagation(box);
        return box;
      };
      control.addTo(map);
    }
    map.on('movestart zoomstart resize', finish); map.on('unload', destroy);
    lines.forEach(line => line.on('remove', destroy));
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('chu:view-changing', onView); media.addEventListener?.('change', onPreference);
    raf = requestAnimationFrame(play);
    return { destroy, finish, play, pause, lines, getProgress: () => progress };
  }
  return { routeSegments, frameAt, draw };
});
