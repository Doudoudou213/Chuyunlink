/* Small paper gallery. No earning, persistence, rewards, or CloudBase writes. */
(() => {
  'use strict';
  function initialize() {
    const api = window.ChuBadgeCatalog;
    const grid = document.getElementById('paper-badge-catalog');
    const preview = document.querySelector('#paper-profile-badges .paper-profile-badge-row');
    const dialog = document.getElementById('paper-badge-dialog');
    const profile = document.getElementById('view-profile');
    if (!api || !grid || !preview || !dialog || !profile || grid.dataset.ready) return;
    grid.dataset.ready = 'true';
    // Preview buttons must work while the full gallery's parent is collapsed.
    document.body.append(dialog);
    let opener = null;
    let request = null;
    let scrollLock = null;
    const byId = id => document.getElementById(id);
    function image(badge, small = false) {
      const img = document.createElement('img');
      img.src = badge.image;
      img.alt = '';
      img.width = 512;
      img.height = 512;
      img.style.setProperty('--badge-art-scale', badge.artScale);
      img.decoding = 'async';
      img.loading = small ? 'eager' : 'lazy';
      img.addEventListener('error', () => {
        img.hidden = true;
        img.parentElement.classList.add('badge-art-unavailable');
        const notice = document.createElement('span');
        notice.className = 'badge-image-fallback';
        notice.textContent = '图样暂未载入';
        img.after(notice);
      }, { once: true });
      return img;
    }
    function button(badge, small = false) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = small ? 'paper-badge-preview-item' : 'paper-badge-item';
      item.dataset.badgeId = badge.id;
      item.setAttribute('aria-label', badge.name + '，查看图样与获取条件');
      item.setAttribute('aria-haspopup', 'dialog');
      item.setAttribute('aria-controls', 'paper-badge-dialog');
      const title = document.createElement('span');
      title.className = 'paper-badge-name';
      title.textContent = badge.name;
      item.append(image(badge, small), title);
      if (!small) {
        const group = document.createElement('span');
        group.className = 'paper-badge-group';
        group.textContent = badge.group;
        item.append(group);
      }
      item.addEventListener('click', () => open(badge, item));
      return item;
    }
    function release() {
      request?.abort();
      request = null;
      if (scrollLock) {
        document.documentElement.style.overflow = scrollLock.html;
        document.body.style.overflow = scrollLock.body;
        scrollLock = null;
      }
      if (opener?.isConnected && !profile.classList.contains('hidden')) opener.focus({ preventScroll: true });
      opener = null;
    }
    async function open(badge, target) {
      request?.abort();
      request = new AbortController();
      const currentRequest = request;
      opener = target;
      byId('paper-badge-dialog-title').textContent = badge.name;
      byId('paper-badge-dialog-theme').textContent = badge.theme;
      byId('paper-badge-dialog-story').textContent = badge.story;
      byId('paper-badge-dialog-note').textContent = badge.note;
      const artwork = image(badge, true);
      artwork.alt = badge.alt;
      byId('paper-badge-dialog-art').replaceChildren(artwork);
      byId('paper-badge-dialog-art').classList.remove('badge-art-unavailable');
      byId('paper-badge-dialog-rules').replaceChildren(...badge.requirements.map(requirement => {
        const li = document.createElement('li');
        li.textContent = requirement.label;
        return li;
      }));
      const status = byId('paper-badge-dialog-status');
      status.textContent = '图样预览 · 获取功能尚未开放';
      if (!dialog.open) {
        dialog.showModal();
        scrollLock = { html: document.documentElement.style.overflow, body: document.body.style.overflow };
        document.documentElement.style.overflow = 'hidden';
        document.body.style.overflow = 'hidden';
      }
      dialog.scrollTop = 0;
      byId('paper-badge-dialog-close').focus({ preventScroll: true });
      try {
        const result = await api.checkEligibility(badge.id, { signal: currentRequest.signal });
        if (request !== currentRequest || currentRequest.signal.aborted || !dialog.open) return;
        // This release intentionally does not display eligibility/earned states,
        // even if a later adapter is replaced before the complete award flow ships.
        status.dataset.eligibility = result.status;
      } catch (error) {
        if (error.name !== 'AbortError' && request === currentRequest && dialog.open) {
          status.dataset.eligibility = 'unavailable';
          status.textContent = '图样预览 · 暂无法查询获取状态';
        }
      }
    }
    preview.replaceChildren(...api.catalog.slice(0, 3).map(badge => button(badge, true)));
    grid.replaceChildren(...api.catalog.map(badge => button(badge)));
    byId('paper-badge-dialog-close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', release);
    // Do not dismiss while selecting rules inside the sheet.
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    });
    new MutationObserver(() => {
      if (profile.classList.contains('hidden') && dialog.open) dialog.close();
    }).observe(profile, { attributes: true, attributeFilter: ['class'] });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
