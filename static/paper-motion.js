/* Paper stays still; illustration, captions and content arrive in that order.
 * Navigation/business logic remains synchronous and never waits for this layer.
 */
(function () {
  'use strict';

  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  let context = null;
  let frame = 0;
  let activeView = null;
  let ready = document.readyState !== 'loading';

  // Only small, known presentation layers participate. Never animate the page
  // root, shared navigation, dialogs, Leaflet tiles or CSS-owned art transforms.
  const layers = {
    discover: {
      art: '.paper-home-art',
      copy: '.paper-home-intro',
      body: '.discover-quick-actions'
    },
    map: { art: '.field-map-ink' },
    collect: {
      art: '.collect-hero-image',
      copy: '.collect-hero-copy'
      // The existing scroll unroll owns the form/sheet animation.
    },
    community: {
      art: '.community-cover-figure',
      copy: '.community-hero-meta, .community-hero-title, .community-hero-description',
      body: '#community-route-card'
    },
    profile: {
      art: '.paper-home-art',
      copy: '.profile-identity',
      body: '.profile-atlas-banner'
    }
  };

  function stop() {
    if (frame) window.cancelAnimationFrame(frame);
    frame = 0;
    const previous = context;
    context = null;
    activeView = null;
    // Revert, rather than clearProps, preserves any pre-existing inline styles
    // and resets GSAP's transform cache on rapid tab changes.
    if (previous) previous.revert();
  }

  function change(event) {
    stop();
    const detail = event.detail || {};
    const spec = layers[detail.tabId];
    const view = document.getElementById('view-' + detail.tabId);
    const gsap = window.gsap;
    if (!ready || !spec || !view || view.classList.contains('hidden') ||
        detail.previousViewId === view.id || document.hidden || media.matches ||
        !gsap || typeof gsap.context !== 'function') return;

    try {
      activeView = view;
      context = gsap.context(function () {}, view);
      context.add(function () {
        const timeline = gsap.timeline({
          paused: true,
          defaults: { ease: 'power2.out' },
          onComplete: stop
        });
        const select = (selector) => selector ? Array.from(view.querySelectorAll(selector)) : [];
        const art = select(spec.art);
        const copy = select(spec.copy);
        const body = select(spec.body);
        // Approved slow sample: 1.44 s total. Art opacity only deliberately
        // leaves breathing/parallax transforms and Leaflet sizing untouched.
        if (art.length) timeline.fromTo(art, { opacity: 0 },
          { opacity: 1, duration: 1.44 }, 0);
        if (copy.length) timeline.fromTo(copy, { opacity: 0, y: 5 },
          { opacity: 1, y: 0, duration: 0.9 }, 0.21);
        if (body.length) timeline.fromTo(body, { opacity: 0 },
          { opacity: 1, duration: 1.02 }, 0.36);
        // Original controls are moved by existing MutationObservers before
        // this frame. The animation does not replace or clone any controls.
        frame = window.requestAnimationFrame(function () {
          frame = 0;
          if (activeView !== view || view.classList.contains('hidden')) return stop();
          try { timeline.play(); } catch (error) { stop(); }
        });
      });
    } catch (error) {
      // Missing/failed animation must never leave the functional page hidden.
      stop();
    }
  }

  window.addEventListener('chu:view-changing', stop);
  window.addEventListener('chu:view-changed', change);
  window.addEventListener('pagehide', stop);
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stop();
  });
  document.addEventListener('focusin', function (event) {
    // Keyboard users can start working without waiting for a fading control.
    if (activeView && activeView.contains(event.target)) stop();
  });
  if (media.addEventListener) media.addEventListener('change', stop);
  else if (media.addListener) media.addListener(stop);
  if (!ready) document.addEventListener('DOMContentLoaded', function () { ready = true; }, { once: true });
})();
