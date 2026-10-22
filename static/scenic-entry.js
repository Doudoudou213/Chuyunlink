(function () {
  'use strict';
  const resourceId = 'yellow-crane-tower', key = 'chulink:journey-content:v1:' + resourceId;
  let options = {}, data = null, landmark = null, pending = null, epoch = 0, expiry = null, configured = false;
  let profileObserver = null, restoring = null, navigationIntent = 0;
  const mounts = {};
  function element(tag, className, text) {
    const el = document.createElement(tag); if (className) el.className = className; if (text) el.textContent = text; return el;
  }
  function currentRecord() {
    if (!data || data.localTest || !(Date.parse(data.validUntil) > Date.now())) return null;
    try {
      const saved = JSON.parse(localStorage.getItem(key));
      const raw = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved[data.fingerprint] : null;
      return raw?.localTest !== true && window.ChuJourneyContent.canResume(data, raw) ? raw : null;
    } catch { return null; }
  }
  function target(pointId) {
    const url = new URL('./explore-journey.html', location.href); url.searchParams.set('resourceId', resourceId);
    if (data?.points.some(p => p.id === pointId)) url.searchParams.set('pointId', pointId);
    return url;
  }
  function status(message, notify = false) {
    let el = document.getElementById('scenic-entry-status');
    if (!el) { el = element('p', 'scenic-entry-status'); el.id = 'scenic-entry-status'; el.setAttribute('role', 'status'); document.body.append(el); }
    el.textContent = message;
    if (notify) { try { options.notify?.(message); } catch {} }
  }
  async function enter(event, view, resume) {
    // New-tab navigation still gets the destination's server verification. It
    // does not consume or duplicate a source page's viewport context.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button > 0) return;
    event.preventDefault(); const link = event.currentTarget;
    if (link.getAttribute('aria-busy') === 'true') return;
    const intent = ++navigationIntent;
    link.setAttribute('aria-busy', 'true'); status('正在核对画卷…');
    try {
      await refresh(true);
      if (intent !== navigationIntent || document.hidden) return;
      if (!data || (view === 'map' && !isTower(landmark))) { status('这份画卷暂未开放，原有介绍仍可阅读。', true); return; }
      let context = { view, scroll: 0 };
      try {
        const current = options.capture?.();
        if (current?.view && current.view !== view) { status(''); return; }
        context = { ...current, view };
      } catch {}
      const raw = resume ? currentRecord() : null;
      const url = target(raw?.selected);
      const token = window.ChuScenicReturn?.save(context);
      if (token) url.searchParams.set('returnToken', token);
      location.assign(url.pathname + url.search);
    } finally { link.removeAttribute('aria-busy'); }
  }
  function anchor(view, title, caption, resume) {
    const a = element('a', 'scenic-entry scenic-entry--' + view); a.dataset.scenicEntry = view;
    a.href = target().pathname + target().search;
    if (view === 'discover') a.setAttribute('aria-label', '展开黄鹤楼画卷');
    if (view === 'discover') {
      const art = element('img', 'scenic-entry-art'); art.src = './static/assets/community-landmark-yellow-crane-v2.webp'; art.alt = ''; art.loading = 'lazy'; art.width = 112; art.height = 112; a.append(art);
    }
    const copy = element('span', 'scenic-entry-copy');
    if (view === 'discover') copy.append(element('span', 'scenic-entry-kicker', '纸上慢游'));
    copy.append(element('strong', 'scenic-entry-title', title));
    const desc = element('span', 'scenic-entry-caption', caption); copy.append(desc);
    a.append(copy, element('span', 'scenic-entry-arrow', '↗')); a.lastElementChild.setAttribute('aria-hidden', 'true');
    a.addEventListener('click', event => enter(event, view, resume));
    return a;
  }
  function isTower(item) { return item?.id === resourceId || item?.resourceId === resourceId; }
  function mount() {
    const discover = document.querySelector('#view-discover .discover-quick-actions');
    if (discover && !mounts.discover?.isConnected) {
      mounts.discover = anchor('discover', '一卷黄鹤楼', '看画中景，读景中事', false);
      discover.parentElement.insertAdjacentElement('afterend', mounts.discover);
    }
    const drawer = document.querySelector('#landmark-drawer .landmark-ticket-quiet-actions');
    if (drawer && !mounts.map?.isConnected) {
      mounts.map = anchor('map', '展开黄鹤楼画卷', '纸上慢读，不改变当前行程', false); drawer.prepend(mounts.map);
    }
    const profile = document.querySelector('#cloud-profile-card');
    if (profile && !mounts.profile?.isConnected) {
      mounts.profile = anchor('profile', '继续上次阅读', '仅在本机保留', true); profile.insertAdjacentElement('afterend', mounts.profile);
    }
    render();
  }
  function render() {
    const available = !!data && Date.parse(data.validUntil) > Date.now();
    if (mounts.discover) mounts.discover.hidden = !available;
    if (mounts.map) mounts.map.hidden = !available || !isTower(landmark);
    const raw = currentRecord();
    if (mounts.profile) {
      mounts.profile.hidden = !raw;
      const caption = mounts.profile.querySelector('.scenic-entry-caption');
      const value = raw ? '黄鹤楼 · ' + data.points.find(p => p.id === raw.selected).title + ' · 本机续读' : '仅在本机保留';
      if (caption.textContent !== value) caption.textContent = value;
      const url = target(raw?.selected); mounts.profile.href = url.pathname + url.search;
    }
  }
  async function refresh(force = false) {
    if (pending && !force) return pending;
    const token = ++epoch; clearTimeout(expiry);
    pending = (async () => {
      let timeout;
      try {
        const response = await Promise.race([
          Promise.resolve().then(() => options.call?.({ action: 'getSiteExploration', resourceId })),
          new Promise((_, reject) => { timeout = setTimeout(() => reject(Error('Connection timed out')), 12000); })
        ]);
        const result = window.ChuJourneyContent.project(response, resourceId);
        if (result.localTest) throw Error('Local samples are not public entries.');
        if (token !== epoch) return;
        data = result;
        expiry = setTimeout(() => { data = null; render(); }, Math.min(2147483647, Math.max(1, Date.parse(data.validUntil) - Date.now())));
      } catch { if (token === epoch) data = null; }
      finally { clearTimeout(timeout); if (token === epoch) { pending = null; mount(); } }
    })();
    return pending;
  }
  function configure(next = {}) {
    options = { ...options, ...next }; configured = true; mount();
    const profile = document.getElementById('view-profile');
    if (profile && !profileObserver) {
      profileObserver = new MutationObserver(() => { if (!mounts.profile?.isConnected) mount(); });
      profileObserver.observe(profile, { childList: true, subtree: true });
    }
    if (!restoring) restoring = window.ChuScenicReturn?.restore(options.restore);
    return refresh(true);
  }
  window.ChuScenicEntry = { configure, refresh, onLandmark(item) { landmark = item; render(); } };
  window.addEventListener('storage', event => { if (event.key === key || event.key === null) render(); });
  window.addEventListener('pageshow', () => { if (configured) refresh(); });
  function invalidate() { epoch++; navigationIntent++; pending = null; data = null; clearTimeout(expiry); render(); }
  window.addEventListener('pagehide', invalidate);
  document.addEventListener('visibilitychange', () => { if (document.hidden) invalidate(); else if (configured) refresh(); });
})();
