/* One real, clickable five-button row travels over the paper. No cloned controls.
 * discover-paper owns destinations; this layer only bridges their screen positions.
 */
(() => {
  'use strict';
  const desktop = window.matchMedia('(min-width: 768px)');
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  let pending = null;
  let flight = null;
  let ready = document.readyState !== 'loading';
  const properties = ['display', 'box-sizing', 'align-items', 'justify-content',
    'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis', 'gap',
    'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'color'];

  function rectangle(element) {
    const { left, top, width, height } = element.getBoundingClientRect();
    return { left, top, width, height };
  }
  function visible(rect) {
    return rect && rect.width > 0 && rect.height > 0 &&
      rect.top < window.innerHeight && rect.top + rect.height > 0;
  }
  function set(element, property, value) {
    element.style.setProperty(property, String(value), 'important');
  }
  function remember(element) {
    const values = new Map();
    return {
      element,
      set(property, value) {
        if (!values.has(property)) values.set(property, [
          element.style.getPropertyValue(property), element.style.getPropertyPriority(property)
        ]);
        set(element, property, value);
      },
      restore() {
        values.forEach(([value, priority], property) => {
          if (value) element.style.setProperty(property, value, priority);
          else element.style.removeProperty(property);
        });
      }
    };
  }
  function keepFocus(element) {
    if (element && document.activeElement !== element && element.isConnected) {
      element.focus({ preventScroll: true });
    }
  }
  function settle() {
    const current = flight;
    flight = null;
    if (!current) return;
    const focus = current.nav.contains(document.activeElement) ? document.activeElement : null;
    if (current.tween) current.tween.kill();
    // Restore only properties owned by us; unrelated inline changes survive.
    current.styles.forEach(record => record.restore());
    if (current.spacer.parentNode) current.spacer.replaceWith(current.nav);
    else current.destination.appendChild(current.nav);
    current.host.remove();
    keepFocus(focus);
  }
  function cancel() {
    pending = null;
    settle();
  }
  function beforeChange(event) {
    const nav = document.getElementById('app-navigation');
    const previousView = document.querySelector('.page-view:not(.hidden)');
    if (flight && previousView?.id === 'view-' + event.detail?.tabId) return;
    // Capture the IN-FLIGHT rectangle before restoring flow. A second click
    // starts here, not at either endpoint of the previous journey.
    const from = nav && rectangle(nav);
    const focus = nav && nav.contains(document.activeElement) ? document.activeElement : null;
    settle();
    pending = ready && desktop.matches && !reduced.matches && !document.hidden && visible(from)
      ? { from, focus, previousView } : null;
  }
  function directPlace(nav, destination, anchor) {
    if (destination) {
      if (nav.parentNode !== destination) destination.appendChild(nav);
    } else if (nav.parentNode !== anchor.parentNode) anchor.after(nav);
  }
  function launch(nav, source, destination) {
    const target = rectangle(nav);
    if (!visible(target) || Math.abs(target.top - source.from.top) +
        Math.abs(target.left - source.from.left) + Math.abs(target.width - source.from.width) < 2) return;

    const computed = getComputedStyle(nav);
    const spacer = document.createElement('div');
    spacer.className = 'paper-nav-placeholder';
    spacer.setAttribute('aria-hidden', 'true');
    // Keep each destination's exact footprint, including its margins and flex
    // order, so the map and content never resize as the row leaves/lands.
    ['margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'order',
      'align-self', 'flex-grow', 'flex-shrink', 'flex-basis'].forEach(property => {
      spacer.style.setProperty(property, computed.getPropertyValue(property));
    });
    spacer.style.width = target.width + 'px';
    spacer.style.height = target.height + 'px';

    const host = document.createElement('div');
    host.className = 'paper-nav-flight';
    const film = document.createElement('div');
    film.className = 'paper-nav-film';
    film.setAttribute('aria-hidden', 'true');
    host.appendChild(film);
    const styles = [nav, ...nav.querySelectorAll('.nav-item, .nav-icon, .nav-label')].map(element => {
      const record = remember(element);
      const style = getComputedStyle(element);
      // Take plain strings before moving: computed styles are live objects.
      const snapshot = properties.map(property => [property, style.getPropertyValue(property)]);
      snapshot.forEach(([property, value]) => record.set(property, value));
      return record;
    });
    flight = { nav, host, spacer, destination, styles, focus: source.focus, tween: null };
    nav.before(spacer);
    document.body.appendChild(host);
    host.appendChild(nav);
    const own = styles[0];
    Object.entries({ position: 'relative', top: 'auto', left: 'auto',
      right: 'auto', bottom: 'auto', width: '100%', height: '100%',
      'margin-top': '0', 'margin-right': '0', 'margin-bottom': '0', 'margin-left': '0',
      'z-index': '1', 'background-color': 'transparent', 'background-image': 'none',
      'border-top-width': '0', 'border-right-width': '0', 'border-bottom-width': '0',
      'border-left-width': '0', 'box-shadow': 'none',
      transform: 'none', 'pointer-events': 'auto' }).forEach(([key, value]) => own.set(key, value));
    const current = flight;
    const state = { progress: 0 };
    function draw() {
      if (flight !== current) return;
      const end = rectangle(spacer);
      const p = state.progress;
      const blend = key => source.from[key] + (end[key] - source.from[key]) * p;
      host.style.left = blend('left') + 'px';
      host.style.top = blend('top') + 'px';
      host.style.width = blend('width') + 'px';
      host.style.height = blend('height') + 'px';
      // Blur the soft film, never the labels or icons. A gentle lens swells in
      // transit and disappears on arrival; no elastic overshoot or text scale.
      const swell = Math.sin(Math.PI * p);
      film.style.opacity = String(swell * 0.9);
      film.style.transform = `scale(${1 + swell * 0.018}, ${1 + swell * 0.22})`;
      film.style.filter = `blur(${1.5 + swell * 3}px)`;
    }
    draw();
    keepFocus(source.focus);
    current.tween = window.gsap.to(state, {
      progress: 1, duration: 0.82, ease: 'power2.inOut',
      onUpdate: draw, onComplete: settle
    });
  }

  // Called by the existing placement owner, including its repeated observers.
  // It must not pull a travelling row out of the overlay on every notification.
  function place(nav, destination, anchor) {
    const parent = destination || anchor.parentNode;
    if (flight && desktop.matches && !reduced.matches && flight.destination === parent) return;
    if (flight) settle();
    const source = pending;
    pending = null;
    const focus = source?.focus || (nav.contains(document.activeElement) ? document.activeElement : null);
    directPlace(nav, destination, anchor);
    try {
      if (source && desktop.matches && !reduced.matches && !document.hidden &&
          source.previousView?.classList.contains('hidden') &&
          window.gsap && typeof window.gsap.to === 'function') launch(nav, source, parent);
    } catch (error) {
      // Animation is optional; fail open with the same live buttons in flow.
      settle();
    }
    keepFocus(focus);
  }
  window.ChuNavMotion = { place };
  window.addEventListener('chu:view-changing', beforeChange);
  window.addEventListener('pagehide', cancel);
  window.addEventListener('resize', cancel);
  // User scrolling should regain a normally anchored bar immediately. Avoid
  // scroll events: switchTab's own synchronous scroll-to-top is not an abort.
  window.addEventListener('wheel', cancel, { passive: true });
  window.addEventListener('touchmove', cancel, { passive: true });
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancel(); });
  document.addEventListener('keydown', event => {
    if (['Tab', 'Escape', 'PageDown', 'PageUp', 'Home', 'End'].includes(event.key)) cancel();
  });
  document.addEventListener('focusin', event => {
    if (flight && !flight.nav.contains(event.target)) cancel();
  });
  [desktop, reduced].forEach(media => {
    if (media.addEventListener) media.addEventListener('change', cancel);
    else if (media.addListener) media.addListener(cancel);
  });
  if (!ready) document.addEventListener('DOMContentLoaded', () => { ready = true; }, { once: true });
})();
