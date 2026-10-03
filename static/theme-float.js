/* Browser-local presentation preference. The story destination remains a native link. */
(() => {
  'use strict';
  function initialize() {
    const entry = document.getElementById('theme-story-float');
    const home = document.getElementById('view-discover');
    if (!entry || !home || entry.dataset.ready) return;
    entry.dataset.ready = 'true';
    const key = 'chulink:theme-story-float:dismissed:v1';
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const blockedSelector = '[id$="-modal"], [id$="-drawer"], [role="dialog"], dialog[open], #external-service-guide, #chu-startup, #paper-home-menu, #paper-activity-panel';
    let dismissed = false, entered = false, frame = 0;
    try { dismissed = localStorage.getItem(key) === '1'; } catch (_) { /* Keep the in-memory preference when storage is unavailable. */ }
    const visible = element => {
      if (!element || element.closest('.hidden, [hidden], [inert], [aria-hidden="true"]') || !element.getClientRects().length) return false;
      const style = getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse';
    };
    const typing = () => document.activeElement?.matches('textarea, select, input:not([type="button"]):not([type="submit"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]), [contenteditable]:not([contenteditable="false"])');
    function synchronize() {
      frame = 0;
      const viewport = window.visualViewport;
      const keyboard = viewport && window.innerHeight - viewport.height > 150;
      const blocked = [...document.querySelectorAll(blockedSelector)].some(visible);
      const hidden = dismissed || !visible(home) || document.hidden || blocked || typing() || keyboard;
      if (entry.hidden !== Boolean(hidden)) entry.hidden = Boolean(hidden);
      if (hidden) { entry.classList.remove('theme-story-arriving'); return; }
      const nav = document.getElementById('app-navigation');
      const box = visible(nav) ? nav.getBoundingClientRect() : null;
      const aboveBottomNav = box && box.top > window.innerHeight / 2 && box.bottom >= window.innerHeight - 4;
      const bottom = aboveBottomNav ? Math.ceil(window.innerHeight - box.top + 12) : window.innerWidth >= 768 ? 28 : 90;
      const offset = `${bottom}px`;
      if (entry.style.getPropertyValue('--theme-float-bottom') !== offset) entry.style.setProperty('--theme-float-bottom', offset);
      const action = document.getElementById('discover-hotspot-action');
      if (visible(action)) {
        const target = action.getBoundingClientRect(), float = entry.getBoundingClientRect();
        if (float.left < target.right && float.right > target.left && float.top < target.bottom && float.bottom > target.top) {
          const lift = Math.ceil(float.bottom - target.top + 8);
          if (lift <= 96 && float.top - lift >= 8) entry.style.setProperty('--theme-float-bottom', `${bottom + lift}px`);
          else { entry.hidden = true; entry.classList.remove('theme-story-arriving'); return; }
        }
      }
      if (!entered) {
        entered = true;
        if (!reduced.matches) entry.classList.add('theme-story-arriving');
      }
    }
    function schedule() { if (!frame) frame = requestAnimationFrame(synchronize); }
    entry.querySelector('.theme-story-art')?.addEventListener('animationend', () => entry.classList.remove('theme-story-arriving'));
    document.getElementById('theme-story-dismiss')?.addEventListener('click', () => {
      dismissed = true;
      try { localStorage.setItem(key, '1'); } catch (_) { /* Dismissal still lasts for this document. */ }
      synchronize();
      document.getElementById('paper-home-more')?.focus({ preventScroll: true });
    });
    window.addEventListener('storage', event => { if (event.key === key && event.newValue === '1') { dismissed = true; schedule(); } });
    window.addEventListener('chu:view-changed', schedule);
    window.addEventListener('resize', schedule, { passive: true });
    window.addEventListener('scroll', schedule, { passive: true });
    document.getElementById('app-viewport')?.addEventListener('scroll', schedule, { passive: true });
    window.visualViewport?.addEventListener('resize', schedule, { passive: true });
    document.addEventListener('focusin', schedule);
    document.addEventListener('focusout', schedule);
    document.addEventListener('visibilitychange', schedule);
    reduced.addEventListener('change', () => { if (reduced.matches) entry.classList.remove('theme-story-arriving'); });
    new MutationObserver(changes => {
      if (changes.some(change => change.target === home || change.target === document.body
        || change.target.matches?.(blockedSelector)
        || [...change.addedNodes, ...change.removedNodes].some(node => node.nodeType === 1
          && (node.matches(blockedSelector) || node.id === 'app-navigation' || node.querySelector(blockedSelector))))) schedule();
    // Startup is mounted beside body, so its removal must also release the entry.
    }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden', 'aria-hidden', 'style', 'open'] });
    const nav = document.getElementById('app-navigation');
    if (nav && 'ResizeObserver' in window) new ResizeObserver(schedule).observe(nav);
    synchronize();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
