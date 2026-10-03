/* Presentation-only home layer. Move existing controls rather than replacing their handlers. */
(() => {
  'use strict';
  function initializePaperHome() {
    const home = document.getElementById('view-discover');
    const profile = document.getElementById('view-profile');
    const collect = document.getElementById('view-collect');
    const map = document.getElementById('view-map');
    const community = document.getElementById('view-community');
    const hero = document.getElementById('paper-home-hero');
    const header = document.getElementById('platform-header');
    const menu = document.getElementById('paper-home-menu');
    const more = document.getElementById('paper-home-more');
    if (!home || !hero || !header || !menu || !more) return;

    const account = document.getElementById('header-account-entry');
    const help = header.querySelector('button[onclick="startOnboardingLearning()"]');
    const location = document.getElementById('current-gps')?.closest('button');
    const notifications = document.getElementById('header-notification-entry');
    const navigation = document.getElementById('app-navigation');
    const desktop = window.matchMedia('(min-width: 768px)');
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const controls = [
      [account, menu, true],
      [help, menu, true],
      [location, document.getElementById('paper-home-location'), false],
      [notifications, document.getElementById('paper-home-notifications'), false],
      [navigation, document.getElementById('paper-home-navigation'), false]
    ].filter(([element, target]) => element && target).map(([element, target, needsLabel]) => {
      const anchor = document.createComment('paper-home original control position');
      element.before(anchor);
      let label = null;
      if (needsLabel) {
        label = document.createElement('span');
        label.className = 'paper-home-control-label';
        label.setAttribute('aria-hidden', 'true');
        label.textContent = element === account ? '我的账号' : '使用帮助';
        element.appendChild(label);
      }
      return { element, target, anchor, label };
    });
    let active = false;
    let frame = 0;
    let visible = true;
    let pendingDialog = null;

    function focusOpenedDialog() {
      if (!pendingDialog || pendingDialog.classList.contains('hidden')) return;
      const dialog = pendingDialog;
      pendingDialog = null;
      if (active && document.activeElement === more) {
        dialog.querySelector('input:not([type="hidden"]), button, [href]')?.focus();
        const closeObserver = new MutationObserver(() => {
          if (!dialog.classList.contains('hidden')) return;
          closeObserver.disconnect();
          if (active && (dialog.contains(document.activeElement) || document.activeElement === document.body)) more.focus({ preventScroll: true });
        });
        closeObserver.observe(dialog, { attributes: true, attributeFilter: ['class'] });
      }
    }
    ['welcome-guide-modal', 'cloud-login-modal'].forEach(id => {
      const dialog = document.getElementById(id);
      if (dialog) new MutationObserver(focusOpenedDialog).observe(dialog, { attributes: true, attributeFilter: ['class'] });
    });

    function closeMenu(restoreFocus = false) {
      const wasOpen = !menu.hidden;
      menu.hidden = true;
      more.setAttribute('aria-expanded', 'false');
      if (wasOpen && restoreFocus) more.focus({ preventScroll: true });
    }
    more.addEventListener('click', () => {
      if (!menu.hidden) return closeMenu();
      menu.hidden = false;
      more.setAttribute('aria-expanded', 'true');
    });
    document.addEventListener('click', event => {
      if (!menu.contains(event.target) && !more.contains(event.target)) closeMenu();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !menu.hidden) {
        event.preventDefault();
        closeMenu(true);
      }
    });
    more.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        menu.hidden = false;
        more.setAttribute('aria-expanded', 'true');
        menu.querySelector('button')?.focus();
      }
    });
    menu.addEventListener('click', event => {
      const button = event.target.closest('button');
      if (!button) return;
      pendingDialog = document.getElementById(button === help ? 'welcome-guide-modal' : 'cloud-login-modal');
      closeMenu(menu.contains(document.activeElement));
      focusOpenedDialog();
    });
    document.addEventListener('focusin', event => {
      if (!menu.contains(event.target) && !more.contains(event.target)) closeMenu();
    });
    function updateDrift() {
      frame = 0;
      if (!active || !visible || reducedMotion.matches) {
        hero.style.setProperty('--paper-drift', '0px');
        return;
      }
      const displacement = Math.min(36, Math.max(0, -hero.getBoundingClientRect().top) * 0.12);
      hero.style.setProperty('--paper-drift', `${displacement.toFixed(1)}px`);
    }
    function requestDrift() {
      if (!frame && active && visible) frame = window.requestAnimationFrame(updateDrift);
    }
    function synchronizeHome() {
      active = !home.classList.contains('hidden');
      const profileActive = Boolean(profile && !profile.classList.contains('hidden'));
      const collectActive = Boolean(collect && !collect.classList.contains('hidden'));
      const mapActive = Boolean(map && !map.classList.contains('hidden'));
      const communityActive = Boolean(community && !community.classList.contains('hidden'));
      const fieldPage = collectActive ? 'collect' : mapActive ? 'map' : communityActive ? 'community' : null;
      if (!active) pendingDialog = null;
      document.body.classList.toggle('discover-paper-active', active);
      document.body.classList.toggle('profile-paper-active', profileActive);
      document.body.classList.toggle('field-paper-active', Boolean(fieldPage));
      document.body.classList.toggle('collect-paper-active', collectActive);
      document.body.classList.toggle('map-paper-active', mapActive);
      document.body.classList.toggle('community-paper-active', communityActive);
      closeMenu();
      controls.forEach(({ element, target, anchor, label }) => {
        const useHome = active && (element !== navigation || desktop.matches);
        const profileTarget = profileActive && (element === help
          ? document.querySelector('#profile-utility-menu .profile-utility-grid')
          : element === navigation && desktop.matches ? document.getElementById('paper-profile-navigation') : null);
        const fieldSlot = element === account || element === help ? 'menu'
          : element === notifications ? 'notifications'
          : element === navigation && desktop.matches ? 'navigation' : null;
        const fieldTarget = fieldPage && fieldSlot ? document.getElementById(`field-${fieldPage}-${fieldSlot}`) : null;
        const destination = useHome ? target : profileTarget || fieldTarget;
        if (destination && element.parentElement !== destination) destination.appendChild(element);
        if (!destination && element.parentNode !== anchor.parentNode) anchor.after(element);
        if (label) label.hidden = !destination;
      });
      updateDrift();
    }
    new MutationObserver(synchronizeHome).observe(home, { attributes: true, attributeFilter: ['class'] });
    if (profile) new MutationObserver(synchronizeHome).observe(profile, { attributes: true, attributeFilter: ['class'] });
    [collect, map, community].filter(Boolean).forEach(view => new MutationObserver(synchronizeHome).observe(view, { attributes: true, attributeFilter: ['class'] }));
    desktop.addEventListener('change', synchronizeHome);
    reducedMotion.addEventListener('change', updateDrift);
    window.addEventListener('scroll', requestDrift, { passive: true });
    document.getElementById('app-viewport')?.addEventListener('scroll', requestDrift, { passive: true });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(entries => {
        visible = entries[0].isIntersecting;
        hero.classList.toggle('paper-is-out-of-view', !visible);
        if (visible) requestDrift();
      }).observe(hero);
    }
    const wordmark = hero.querySelector('.paper-home-wordmark img');
    wordmark?.addEventListener('error', () => wordmark.parentElement.classList.add('is-image-unavailable'));
    if (wordmark?.complete && !wordmark.naturalWidth) wordmark.parentElement.classList.add('is-image-unavailable');

    function synchronizeBoard() {
      ['share', 'needs'].forEach(board => {
        const selected = !document.getElementById(`discover-${board}-section`)?.classList.contains('hidden');
        const button = document.getElementById(`discover-board-${board}`);
        if (button) {
          button.dataset.paperSelected = String(selected);
          button.setAttribute('aria-pressed', String(selected));
        }
      });
    }
    ['share', 'needs'].forEach(board => {
      const section = document.getElementById(`discover-${board}-section`);
      if (section) new MutationObserver(synchronizeBoard).observe(section, { attributes: true, attributeFilter: ['class'] });
    });
    synchronizeBoard();
    synchronizeHome();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializePaperHome, { once: true });
  else initializePaperHome();
})();
