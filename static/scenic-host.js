/* Small adapter to the existing five-view application; no duplicated map state. */
(() => {
  'use strict';
  function capture() {
    const view = document.querySelector('.page-view:not(.hidden)')?.id.replace('view-', '') || 'discover';
    const center = typeof heritageMap !== 'undefined' && heritageMap?.getCenter();
    return {
      view, scroll: document.getElementById('app-viewport')?.scrollTop || 0, windowScroll: window.scrollY || 0,
      landmarkId: view === 'map' && typeof activeLandmark !== 'undefined' ? activeLandmark?.id : undefined,
      center: center ? [center.lat, center.lng] : undefined,
      zoom: center ? heritageMap.getZoom() : undefined
    };
  }
  function settledMapLayout(map) {
    // The map is first created while hidden. Its initial max-bounds pan and
    // the existing 120/240ms layout callbacks must finish before restoring.
    // This is a single bounded hand-off, never a persistent camera lock.
    return new Promise(resolve => {
      const container = map.getContainer(), started = performance.now();
      let frame, deadline, lastSize = '', changedAt = started, done = false;
      function finish(ready) {
        if (done) return;
        done = true; cancelAnimationFrame(frame); clearTimeout(deadline);
        document.removeEventListener('pointerdown', cancel, true);
        document.removeEventListener('wheel', cancel, true);
        document.removeEventListener('keydown', cancel, true);
        window.removeEventListener('chu:view-changing', cancel);
        window.removeEventListener('pagehide', cancel);
        resolve(ready);
      }
      const cancel = () => finish(false);
      function checkLayout() {
        if (document.querySelector('.page-view:not(.hidden)')?.id !== 'view-map') return finish(false);
        const now = performance.now(), size = container.getBoundingClientRect();
        const signature = size.width + ':' + size.height;
        if (signature !== lastSize) { lastSize = signature; changedAt = now; }
        if (size.width > 0 && size.height > 0 && now - started >= 320 && now - changedAt >= 100) return finish(true);
        frame = requestAnimationFrame(checkLayout);
      }
      document.addEventListener('pointerdown', cancel, true);
      document.addEventListener('wheel', cancel, { capture: true, passive: true });
      document.addEventListener('keydown', cancel, true);
      window.addEventListener('chu:view-changing', cancel);
      window.addEventListener('pagehide', cancel);
      deadline = setTimeout(() => finish(false), 1200);
      frame = requestAnimationFrame(checkLayout);
    });
  }
  async function restore(context) {
    if (!['discover', 'map', 'profile'].includes(context.view)) return;
    switchTab(context.view);
    // Let the established view/layout handlers settle before restoring the map.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (context.view === 'map') {
      const item = heritageLandmarks.find(value => value.id === context.landmarkId);
      if (item) focusLandmark(item);
      if (typeof heritageMap !== 'undefined' && heritageMap && context.center) {
        if (!await settledMapLayout(heritageMap)) return;
        heritageMap.stop();
        heritageMap.invalidateSize({ pan: false });
        heritageMap.setView(context.center, context.zoom, { animate: false, reset: true });
      }
    }
    const viewport = document.getElementById('app-viewport');
    if (viewport) viewport.scrollTop = context.scroll || 0;
    window.scrollTo({ top: context.windowScroll || 0, behavior: 'instant' });
    // The itinerary is already persisted by the existing planner. Do not replace it.
  }
  function start() {
    window.ChuScenicEntry?.configure({ call: data => window.ChuScenicApi(data), capture, restore,
      notify: message => typeof showToast === 'function' && showToast(message, 'book-open') });
    if (typeof activeLandmark !== 'undefined') window.ChuScenicEntry?.onLandmark(activeLandmark);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
