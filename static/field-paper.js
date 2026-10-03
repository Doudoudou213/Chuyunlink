/* Field-page presentation only. The shared coordinator owns control relocation. */
(() => {
  'use strict';

  function initializeFieldPaper() {
    const contexts = Array.from(document.querySelectorAll('.field-paper-topline')).map(topline => {
      const view = topline.closest('.page-view');
      const more = topline.querySelector('[data-field-more]');
      const menu = more && document.getElementById(more.getAttribute('aria-controls'));
      return view && more && menu?.matches('[data-field-menu]') ? { view, more, menu } : null;
    }).filter(Boolean);
    if (!contexts.length) return;

    let pendingDialog = null;
    let openedDialog = null;
    const observedDialogs = new WeakSet();
    const dialogIds = ['welcome-guide-modal', 'cloud-login-modal'];
    const isActive = context => context.view.isConnected && !context.view.hidden && !context.view.classList.contains('hidden');
    const isShown = element => Boolean(element && element.isConnected && !element.closest('.hidden, [hidden], [inert]') && element.getClientRects().length);
    const canFocus = element => isShown(element) && !element.disabled && getComputedStyle(element).visibility !== 'hidden';

    function closeMenu(context, returnFocus = false) {
      const wasOpen = !context.menu.hidden;
      context.menu.hidden = true;
      context.more.setAttribute('aria-expanded', 'false');
      if (wasOpen && returnFocus && isActive(context)) context.more.focus({ preventScroll: true });
    }

    function focusOpenedDialog() {
      if (!pendingDialog) return;
      const { context, id } = pendingDialog;
      if (!isActive(context)) {
        pendingDialog = null;
        return;
      }
      const dialog = document.getElementById(id);
      if (!isShown(dialog)) return;
      pendingDialog = null;
      // An asynchronous account lookup must not steal focus after the visitor moves on.
      const current = document.activeElement;
      if (current !== context.more && current !== document.body && !dialog.contains(current)) return;
      openedDialog = { context, dialog };
      if (dialog.contains(current)) return;
      const fields = Array.from(dialog.querySelectorAll('input:not([type="hidden"]), textarea, select'));
      const actions = Array.from(dialog.querySelectorAll('button, a[href], [tabindex]:not([tabindex="-1"])'));
      (fields.find(canFocus) || actions.find(canFocus))?.focus({ preventScroll: true });
    }

    function synchronizeDialogs() {
      if (openedDialog && !isShown(openedDialog.dialog)) {
        const { context, dialog } = openedDialog;
        openedDialog = null;
        const current = document.activeElement;
        if (isActive(context) && (dialog.contains(current) || current === document.body)) {
          context.more.focus({ preventScroll: true });
        }
      }
      focusOpenedDialog();
    }

    function observeDialogs() {
      dialogIds.forEach(id => {
        const dialog = document.getElementById(id);
        if (!dialog || observedDialogs.has(dialog)) return;
        observedDialogs.add(dialog);
        new MutationObserver(synchronizeDialogs).observe(dialog, {
          attributes: true,
          attributeFilter: ['class', 'hidden', 'style']
        });
      });
      synchronizeDialogs();
    }

    contexts.forEach(context => {
      const { view, more, menu } = context;
      closeMenu(context);
      const openMenu = () => {
        if (!isActive(context)) return;
        pendingDialog = null;
        contexts.forEach(other => { if (other !== context) closeMenu(other); });
        menu.hidden = false;
        more.setAttribute('aria-expanded', 'true');
      };
      more.addEventListener('click', () => {
        if (menu.hidden) openMenu();
        else closeMenu(context);
      });
      more.addEventListener('keydown', event => {
        if (event.key !== 'ArrowDown') return;
        event.preventDefault();
        openMenu();
        Array.from(menu.querySelectorAll('button')).find(canFocus)?.focus();
      });
      menu.addEventListener('click', event => {
        const button = event.target.closest?.('button');
        if (!button || !menu.contains(button) || !isActive(context)) return;
        const id = button.id === 'header-account-entry' ? 'cloud-login-modal'
          : button.getAttribute('onclick') === 'startOnboardingLearning()' ? 'welcome-guide-modal' : null;
        pendingDialog = id ? { context, id } : null;
        closeMenu(context, menu.contains(document.activeElement));
        // Existing handlers have already run; only follow a dialog that really opened.
        observeDialogs();
      });
      new MutationObserver(() => {
        requestLayout();
        if (isActive(context)) return;
        closeMenu(context);
        if (pendingDialog?.context === context) pendingDialog = null;
        if (openedDialog?.context === context) openedDialog = null;
      }).observe(view, { attributes: true, attributeFilter: ['class', 'hidden'] });
    });

    document.addEventListener('click', event => {
      contexts.forEach(context => {
        if (!context.menu.contains(event.target) && !context.more.contains(event.target)) closeMenu(context);
      });
      if (pendingDialog) {
        const { context, id } = pendingDialog;
        const dialog = document.getElementById(id);
        if (!context.menu.contains(event.target) && !context.more.contains(event.target) && !dialog?.contains(event.target)) pendingDialog = null;
      }
    });
    document.addEventListener('focusin', event => {
      contexts.forEach(context => {
        if (!context.menu.contains(event.target) && !context.more.contains(event.target)) closeMenu(context);
      });
      if (pendingDialog) {
        const { context, id } = pendingDialog;
        const dialog = document.getElementById(id);
        if (!context.menu.contains(event.target) && !context.more.contains(event.target) && !dialog?.contains(event.target)) pendingDialog = null;
      }
    });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      const context = contexts.find(candidate => isActive(candidate) && !candidate.menu.hidden);
      if (!context) return;
      event.preventDefault();
      pendingDialog = null;
      closeMenu(context, true);
    });

    // CloudBase normally injects these before this initializer, but can initialize later.
    observeDialogs();
    new MutationObserver(observeDialogs).observe(document.body, { childList: true });

    document.querySelectorAll('.field-paper-wordmark img').forEach(wordmark => {
      const container = wordmark.closest('.field-paper-wordmark');
      const showFallback = () => container.classList.add('is-image-unavailable');
      wordmark.addEventListener('error', showFallback);
      wordmark.addEventListener('load', () => container.classList.remove('is-image-unavailable'));
      if (wordmark.complete && !wordmark.naturalWidth) showFallback();
    });

    if ('IntersectionObserver' in window) {
      const artObserver = new IntersectionObserver(entries => {
        entries.forEach(entry => entry.target.classList.toggle('field-art-paused', !entry.isIntersecting));
      });
      document.querySelectorAll('#view-map .field-map-heading, #view-collect .collect-hero').forEach(hero => artObserver.observe(hero));
    }
    const synchronizeVisibility = () => document.body.classList.toggle('field-document-hidden', document.hidden);
    document.addEventListener('visibilitychange', synchronizeVisibility);
    synchronizeVisibility();

    const navigation = document.getElementById('app-navigation');
    const mapElement = document.getElementById('heritage-map');
    const mapContext = contexts.find(context => context.view.id === 'view-map');
    const mobile = window.matchMedia('(max-width: 767px)');
    let layoutFrame = 0;
    let mapWidth = 0;
    let mapHeight = 0;
    function requestLayout() {
      if (layoutFrame) return;
      layoutFrame = window.requestAnimationFrame(() => {
        layoutFrame = 0;
        if (mobile.matches && contexts.some(isActive) && navigation) {
          const value = `${navigation.getBoundingClientRect().height}px`;
          if (document.body.style.getPropertyValue('--field-mobile-nav-height') !== value) {
            document.body.style.setProperty('--field-mobile-nav-height', value);
          }
        } else {
          document.body.style.removeProperty('--field-mobile-nav-height');
        }
        if (!mapElement || !mapContext || !isActive(mapContext)) {
          mapWidth = 0;
          mapHeight = 0;
          return;
        }
        const { width, height } = mapElement.getBoundingClientRect();
        if (width > 0 && height > 0 && (width !== mapWidth || height !== mapHeight)
          && typeof heritageMap !== 'undefined' && heritageMap && typeof heritageMap.invalidateSize === 'function') {
          mapWidth = width;
          mapHeight = height;
          heritageMap.invalidateSize({ pan: false });
        }
      });
    }
    if ('ResizeObserver' in window) {
      const layoutObserver = new ResizeObserver(requestLayout);
      if (navigation) layoutObserver.observe(navigation);
      if (mapElement) layoutObserver.observe(mapElement);
    }
    window.addEventListener('resize', requestLayout, { passive: true });
    requestLayout();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initializeFieldPaper, { once: true });
  else initializeFieldPaper();
})();
