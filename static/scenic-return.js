(function () {
  'use strict';
  const KEY = 'chulink:scenic-return:v1', TTL = 60 * 60 * 1000;
  const views = ['discover', 'map', 'profile', 'guide'];
  const directory = new URL('./', location.href).pathname;
  const validId = value => typeof value === 'string' && /^[\w-]{1,128}$/.test(value);
  function clean(raw) {
    if (!raw || !views.includes(raw.view)) return null;
    const value = { view: raw.view, scroll: Number.isFinite(raw.scroll) ? Math.max(0, Math.min(1000000, raw.scroll)) : 0 };
    if (Number.isFinite(raw.windowScroll)) value.windowScroll = Math.max(0, Math.min(1000000, raw.windowScroll));
    if (validId(raw.stationId)) value.stationId = raw.stationId;
    if (typeof raw.stationPanelOpen === 'boolean') value.stationPanelOpen = raw.stationPanelOpen;
    if (validId(raw.landmarkId)) value.landmarkId = raw.landmarkId;
    if (Array.isArray(raw.center) && raw.center.length === 2 && raw.center.every(Number.isFinite) && Math.abs(raw.center[0]) <= 90 && Math.abs(raw.center[1]) <= 180) value.center = [...raw.center];
    if (Number.isFinite(raw.zoom) && raw.zoom >= 1 && raw.zoom <= 22) value.zoom = raw.zoom;
    return value;
  }
  function save(raw) {
    const context = clean(raw); if (!context) return null;
    try {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      const token = [...bytes].map(n => n.toString(16).padStart(2, '0')).join('');
      // A single, short-lived viewport snapshot, not location history or identity.
      sessionStorage.setItem(KEY, JSON.stringify({ token, at: Date.now(), directory, context }));
      return token;
    } catch { return null; }
  }
  function read(token) {
    if (typeof token !== 'string' || !/^[a-f0-9]{32}$/.test(token)) return null;
    try {
      const raw = JSON.parse(sessionStorage.getItem(KEY));
      if (raw?.token !== token || raw.directory !== directory || !Number.isFinite(raw.at) || raw.at > Date.now() + 60000 || Date.now() - raw.at > TTL) return null;
      return clean(raw.context);
    } catch { return null; }
  }
  function href(token) {
    const context = read(token);
    const url = new URL(context?.view === 'guide' ? './guide.html' : './index.html', location.href);
    if (context?.view !== 'guide') url.searchParams.set('view', context?.view || 'map');
    if (context) url.searchParams.set('scenicReturn', token);
    return url.pathname + url.search;
  }
  function bind(selector = '.masthead > a') {
    const anchor = document.querySelector(selector); if (!anchor) return;
    const token = new URLSearchParams(location.search).get('returnToken');
    const context = read(token);
    const labels = { map: '返回地图', discover: '返回发现', profile: '返回我的', guide: '返回随行向导' };
    anchor.href = href(token);
    anchor.textContent = '← ' + (labels[context?.view] || labels.map);
    anchor.setAttribute('aria-label', labels[context?.view] || labels.map);
    anchor.classList.add('scenic-return-link');
  }
  async function restore(restoreContext) {
    const url = new URL(location.href), token = url.searchParams.get('scenicReturn');
    if (!token) return false;
    const context = read(token); let restored = false;
    if (context && typeof restoreContext === 'function') {
      try { await restoreContext(context); restored = true; } catch { /* Keep the original snapshot available for a retry. */ }
    }
    if (restored || !context) {
      url.searchParams.delete('scenicReturn');
      history.replaceState(history.state, '', url.pathname + url.search + url.hash);
      if (restored) { try { sessionStorage.removeItem(KEY); } catch {} }
    }
    return restored;
  }
  window.ChuScenicReturn = { save, read, href, bind, restore, clean };
  if (location.pathname.endsWith('/explore-journey.html')) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => bind(), { once: true });
    else bind();
  }
})();
