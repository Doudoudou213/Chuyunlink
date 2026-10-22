/* A temporary paper overlay, not a second router. No content or identity in history. */
(function () {
  'use strict';
  function create(hooks = {}) {
    const key = '__chuJourneyLeaf', doc = Date.now().toString(36) + Math.random().toString(36).slice(2);
    let active = null, pending = null, serial = 0;
    const state = () => history.state && typeof history.state === 'object' ? {...history.state} : {};
    const marker = () => history.state?.[key];
    const owns = id => marker()?.doc === doc && marker()?.entry === id;
    function retire() {
      if (!marker()) return;
      // Keep only an empty reusable slot, not a live modal descriptor. Otherwise
      // Forward -> open would add another Back stop on every reading session.
      const next = state();next[key] = {v:1, dormant:true};
      try {history.replaceState(next, '', location.href);} catch {/* Reading remains usable without history access. */}
    }
    // A refreshed/forwarded modal never restores unverified text or starts audio.
    retire();
    function shown() {
      if (active && owns(active)) return;
      if (pending) return; // beforeOpen waits for the outstanding traversal.
      const id = ++serial;
      try {
        const next = {...state(), [key]:{v:1, doc, entry:id}};
        if (marker()?.dormant) history.replaceState(next, '', location.href);
        else history.pushState(next, '', location.href);
        active = id;
      }
      catch {active = null;}
    }
    function dismissed() {
      if (!active || !owns(active)) {active = null;return;}
      const entry = active;active = null;
      let resolve;
      const promise = new Promise(done => {resolve = done;});
      pending = {entry, promise, resolve};
      try {history.back();}
      catch {retire();pending = null;resolve(false);}
    }
    function invalidate() {
      // Expiry/withdrawal/hidden-page cleanup must never send a visitor elsewhere.
      active = null;retire();
      const wait = pending;pending = null;wait?.resolve(false);
    }
    addEventListener('popstate', () => {
      if (pending) {
        const wait = pending;pending = null;retire();hooks.onLanded?.();wait.resolve(true);return;
      }
      const wasOpen = active !== null;active = null;
      retire();
      hooks.onLanded?.();
      if (wasOpen) hooks.onBack?.();
      else hooks.onTraverse?.();
    });
    return {shown, dismissed, invalidate, settled:() => pending?.promise || Promise.resolve(true)};
  }
  window.ChuJourneyNavigation = {create};
})();
