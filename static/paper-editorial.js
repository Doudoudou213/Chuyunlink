/* Local seasonal-entry prototype only; no campaign, auth or cloud writes. */
(() => {
  'use strict';
  function initialize() {
    const note = document.getElementById('paper-activity-note');
    if (!note) return;
    // Only the separate local preview server inserts this marker. Production
    // HTML has no marker; a query string alone cannot expose a sample activity.
    const enabled = document.documentElement.dataset.activityPreview === 'true';
    if (!enabled) return;
    const key = 'chulink:activity-note-preview:dismissed:v1';
    let dismissed = false;
    try { dismissed = sessionStorage.getItem(key) === '1'; } catch (_) { /* Restricted storage: session-memory fallback. */ }
    const toggle = note.querySelector('[data-activity-note-toggle]');
    const panel = document.getElementById('paper-activity-panel');
    const dismiss = note.querySelector('[data-activity-note-dismiss]');
    const close = note.querySelector('[data-activity-note-close]');
    const visit = note.querySelector('[data-activity-note-visit]');
    const views = [...document.querySelectorAll('.page-view')];
    const modalSelector = '[id$="-modal"], [role="dialog"][aria-modal="true"]';
    let activeViewId = '';
    const visible = el => el && !el.closest('.hidden, [hidden], [inert]') && el.getClientRects().length;
    function closePanel(focus = false) {
      panel.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
      if (focus && !note.hidden) toggle.focus({ preventScroll: true });
    }
    function sync() {
      const active = views.find(view => !view.classList.contains('hidden'));
      const allowed = active && ['view-discover', 'view-community'].includes(active.id);
      const blocked = [...document.querySelectorAll(modalSelector)].some(visible);
      if (activeViewId !== active?.id) closePanel();
      activeViewId = active?.id || '';
      note.hidden = dismissed || !allowed || blocked;
      if (note.hidden) closePanel();
    }
    toggle.addEventListener('click', () => {
      if (!panel.hidden) return closePanel(true);
      panel.hidden = false;
      toggle.setAttribute('aria-expanded', 'true');
      close.focus({ preventScroll: true });
    });
    close.addEventListener('click', () => closePanel(true));
    dismiss.addEventListener('click', () => {
      dismissed = true;
      try { sessionStorage.setItem(key, '1'); } catch (_) { /* Keep in-memory dismissal. */ }
      sync();
      const active = views.find(view => !view.classList.contains('hidden'));
      const destination = active?.querySelector('button, a[href]');
      if (visible(destination)) destination.focus({ preventScroll: true });
    });
    visit.addEventListener('click', () => {
      closePanel();
      const destination = document.getElementById('nav-community');
      if (destination) { destination.click(); destination.focus({ preventScroll: true }); }
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !note.hidden && !panel.hidden) {
        event.preventDefault();
        closePanel(true);
      }
    });
    document.addEventListener('click', event => { if (!note.contains(event.target)) closePanel(); });
    document.addEventListener('focusin', event => { if (!note.contains(event.target)) closePanel(); });
    views.forEach(view => new MutationObserver(sync).observe(view, { attributes: true, attributeFilter: ['class', 'hidden'] }));
    // Existing cloud dialogs can be mounted lazily; observe their visibility
    // without changing their handlers or performing any data operation.
    new MutationObserver(changes => {
      if (changes.some(change => change.target.matches?.(modalSelector)
        || [...change.addedNodes].some(node => node.nodeType === 1
          && (node.matches(modalSelector) || node.querySelector(modalSelector))))) sync();
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'hidden', 'aria-hidden', 'style'] });
    if (window.lucide?.createIcons) window.lucide.createIcons();
    sync();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
