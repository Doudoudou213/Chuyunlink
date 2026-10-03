/* Profile presentation only: retain original CloudBase nodes, IDs, and handlers. */
(() => {
  'use strict';
  function initializePaperProfile() {
    const profile = document.getElementById('view-profile');
    const hero = document.getElementById('paper-profile-hero');
    const card = document.getElementById('cloud-profile-card');
    const badges = document.getElementById('paper-profile-badges');
    if (!profile || !hero || !card || !badges) return;
    profile.prepend(hero);
    card.after(badges);
    const atlas = card.querySelector('.profile-atlas-banner');
    if (atlas) badges.after(atlas);
    // The legacy atlas button actually opens the badge section, not the user's works.
    const atlasBadgeLink = atlas?.querySelector('[data-profile-feature="profile-badges-section"]');
    if (atlasBadgeLink?.firstChild?.nodeType === Node.TEXT_NODE) atlasBadgeLink.firstChild.textContent = '徽章图样 ';
    const badgeDetail = document.getElementById('profile-badges-section');
    const rewards = document.getElementById('profile-coupons-section');
    if (badgeDetail) badges.after(badgeDetail);
    if (atlas && rewards) atlas.after(rewards);

    const trigger = document.getElementById('cloud-profile-settings');
    const menu = document.getElementById('profile-utility-menu');
    const slot = document.getElementById('paper-profile-settings-slot');
    if (trigger && menu && slot) {
      slot.append(trigger, menu);
      const closeMenu = (returnFocus = false) => {
        if (menu.classList.contains('hidden')) return;
        menu.classList.add('hidden');
        trigger.setAttribute('aria-expanded', 'false');
        trigger.classList.remove('is-open');
        if (returnFocus) trigger.focus({ preventScroll: true });
      };
      trigger.addEventListener('keydown', event => {
        if (event.key !== 'ArrowDown') return;
        event.preventDefault();
        if (menu.classList.contains('hidden')) trigger.click();
        menu.querySelector('button')?.focus();
      });
      document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && !menu.classList.contains('hidden')) {
          event.preventDefault();
          closeMenu(true);
        }
      });
      document.addEventListener('click', event => {
        if (!slot.contains(event.target)) closeMenu();
      });
      document.addEventListener('focusin', event => {
        if (!slot.contains(event.target)) closeMenu();
      });
      // Observe real opening, including account checks that resolve after the click frame.
      let pendingDialogs = [];
      let returnTarget = trigger;
      const dialogIds = ['cloud-profile-edit-modal', 'cloud-login-modal', 'cloud-feedback-modal', 'cloud-notification-modal', 'welcome-guide-modal'];
      const focusOpenedDialog = () => {
        const dialog = pendingDialogs.map(id => document.getElementById(id)).find(el => el && !el.classList.contains('hidden'));
        if (!dialog) return;
        pendingDialogs = [];
        const opener = returnTarget;
        const firstField = dialog.querySelector('input:not([type="hidden"]), textarea');
        (firstField || dialog.querySelector('button'))?.focus();
        const closeObserver = new MutationObserver(() => {
          if (!dialog.classList.contains('hidden')) return;
          closeObserver.disconnect();
          if (!profile.classList.contains('hidden') && (dialog.contains(document.activeElement) || document.activeElement === document.body)) opener.focus({ preventScroll: true });
        });
        closeObserver.observe(dialog, { attributes: true, attributeFilter: ['class'] });
      };
      dialogIds.forEach(id => {
        const dialog = document.getElementById(id);
        if (dialog) new MutationObserver(focusOpenedDialog).observe(dialog, { attributes: true, attributeFilter: ['class'] });
      });
      menu.addEventListener('click', event => {
        const button = event.target.closest('button');
        if (!button) return;
        returnTarget = trigger;
        pendingDialogs = button.id === 'cloud-profile-upload' ? [] : dialogIds;
        closeMenu(true);
        focusOpenedDialog();
      });
      document.getElementById('cloud-profile-edit-inline')?.addEventListener('click', event => {
        returnTarget = event.currentTarget;
        pendingDialogs = ['cloud-profile-edit-modal', 'cloud-login-modal'];
        focusOpenedDialog();
      });
      new MutationObserver(() => {
        if (profile.classList.contains('hidden')) {
          pendingDialogs = [];
          closeMenu();
        }
      }).observe(profile, { attributes: true, attributeFilter: ['class'] });
    }

    // Mirror original feature disclosure state without replacing its click handlers.
    ['profile-badges-section', 'profile-coupons-section'].forEach(id => {
      const panel = document.getElementById(id);
      if (!panel) return;
      const sync = () => profile.querySelectorAll(`[data-profile-feature="${id}"]`).forEach(button => {
        button.setAttribute('aria-controls', id);
        button.setAttribute('aria-expanded', String(!panel.classList.contains('hidden')));
      });
      new MutationObserver(sync).observe(panel, { attributes: true, attributeFilter: ['class'] });
      sync();
    });
    const wordmark = hero.querySelector('.paper-home-wordmark img');
    const imageFallback = () => wordmark?.parentElement.classList.add('is-image-unavailable');
    wordmark?.addEventListener('error', imageFallback);
    if (wordmark?.complete && !wordmark.naturalWidth) imageFallback();
    if ('IntersectionObserver' in window) new IntersectionObserver(entries => {
      hero.classList.toggle('paper-is-out-of-view', !entries[0].isIntersecting);
    }).observe(hero);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializePaperProfile, { once: true });
  else initializePaperProfile();
})();
