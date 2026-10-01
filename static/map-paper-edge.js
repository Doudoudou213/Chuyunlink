/* Presentation boundary only: fill online base-map gaps without changing the
   map's navigation bounds, coordinates, routes, markers or offline tile rules. */
(() => {
  'use strict';

  function initializeMapPaperEdge() {
    const view = document.getElementById('view-map');
    const container = document.getElementById('heritage-map');
    if (!view || !container) return;

    let map = null;
    let tilePane = null;
    let frame = 0;
    let readinessObserver = null;
    const extendedLayers = new WeakSet();
    const isVisible = () => !document.hidden && !view.hidden && !view.classList.contains('hidden');

    function configuredOnlineTileUrl() {
      // The existing lexical configuration also includes default values. Do not
      // assume every map provider can be extended beyond a supplied tile range.
      const config = typeof heritageMapConfig !== 'undefined' ? heritageMapConfig : window.CHULINK_MAP_CONFIG;
      const value = config?.tileUrl;
      if (typeof value !== 'string') return null;
      try {
        const url = new URL(value, location.href);
        return url.protocol === 'https:' && /^webrd\d{2}\.is\.autonavi\.com$/i.test(url.hostname)
          && url.pathname === '/appmaptile'
          && ['x', 'y', 'z'].every(axis => url.searchParams.get(axis) === `{${axis}}`)
          ? value : null;
      } catch (_) {
        return null;
      }
    }

    function extendOnlineBaseLayer(layer) {
      const configuredUrl = configuredOnlineTileUrl();
      if (!configuredUrl || typeof L === 'undefined' || !L.TileLayer || !(layer instanceof L.TileLayer)
        || layer._url !== configuredUrl || extendedLayers.has(layer)) return;
      extendedLayers.add(layer);
      if (layer.options.bounds) {
        // `bounds` on a TileLayer prevents tile requests, even when a large
        // viewport legitimately sees beyond the navigable region. The Map's
        // separate maxBounds is deliberately retained, with no setView call.
        layer.options.bounds = undefined;
        layer.redraw();
      }
      container.classList.add('map-paper-edge-ready');
    }

    function synchronizeEdge() {
      frame = 0;
      if (!map || !tilePane || !isVisible()) return;
      const size = map.getSize();
      const mapPane = map.getPane('mapPane');
      const offset = mapPane && L.DomUtil.getPosition(mapPane);
      if (!offset || size.x <= 0 || size.y <= 0) return;
      // Tile-pane decorations inherit the map pane's pan transform. Counter it
      // so the paper margin stays at the viewport edge, not on a geographic point.
      tilePane.style.setProperty('--map-paper-edge-x', `${-offset.x}px`);
      tilePane.style.setProperty('--map-paper-edge-y', `${-offset.y}px`);
      tilePane.style.setProperty('--map-paper-edge-width', `${size.x}px`);
      tilePane.style.setProperty('--map-paper-edge-height', `${size.y}px`);
    }

    function requestEdge() {
      if (frame || !isVisible()) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        if (!map) attachWhenReady();
        synchronizeEdge();
      });
    }

    function onLayerAdded(event) {
      extendOnlineBaseLayer(event.layer);
      requestEdge();
    }

    function attachWhenReady() {
      if (map || typeof heritageMap === 'undefined' || !heritageMap || typeof L === 'undefined') return;
      const candidate = heritageMap;
      if (typeof candidate.getContainer !== 'function' || candidate.getContainer() !== container
        || typeof candidate.eachLayer !== 'function' || !candidate.getPane('tilePane')) return;
      map = candidate;
      tilePane = map.getPane('tilePane');
      readinessObserver?.disconnect();
      map.eachLayer(extendOnlineBaseLayer);
      map.on('move zoom resize viewreset', requestEdge);
      map.on('layeradd', onLayerAdded);
      map.on('unload', cleanup);
      requestEdge();
    }

    function cleanup() {
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
      readinessObserver?.disconnect();
      viewObserver.disconnect();
      document.removeEventListener('visibilitychange', requestEdge);
      if (map) {
        map.off('move zoom resize viewreset', requestEdge);
        map.off('layeradd', onLayerAdded);
        map.off('unload', cleanup);
      }
      container.classList.remove('map-paper-edge-ready');
      map = null;
      tilePane = null;
    }

    // No polling and no replacement of the existing initialization function.
    // The one readiness observer stops as soon as the real map is available.
    const viewObserver = new MutationObserver(requestEdge);
    viewObserver.observe(view, { attributes: true, attributeFilter: ['class', 'hidden'] });
    readinessObserver = new MutationObserver(requestEdge);
    readinessObserver.observe(container, { childList: true, subtree: true });
    document.addEventListener('visibilitychange', requestEdge);
    attachWhenReady();
    requestEdge();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializeMapPaperEdge, { once: true });
  else initializeMapPaperEdge();
})();
