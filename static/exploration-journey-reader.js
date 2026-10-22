/* A quiet paragraph reader. The verified original remains the only text source. */
(function (root) {
  'use strict';
  function create(copy, hooks = {}) {
    if (!copy) return null;
    const top = document.createElement('div'), bottom = document.createElement('div');
    top.className = 'journey-reader-top';bottom.className = 'journey-reader-bottom';
    top.innerHTML = '<span id="journey-reader-position" role="status"></span><button type="button" id="journey-reader-mode" aria-pressed="false" aria-controls="reading-copy">连贯阅读</button>';
    bottom.innerHTML = '<div class="journey-reader-paging"><button type="button" id="journey-reader-previous" aria-label="读上一段">←</button><button type="button" id="journey-reader-next">再读一段 →</button></div><button type="button" id="journey-reader-keep" aria-pressed="false">记下这一景</button>';
    copy.before(top);copy.after(bottom);copy.tabIndex = -1;
    const position = top.querySelector('span'), mode = top.querySelector('button');
    const previous = bottom.querySelector('#journey-reader-previous'), next = bottom.querySelector('#journey-reader-next'), keep = bottom.querySelector('#journey-reader-keep');
    const reduce = matchMedia('(prefers-reduced-motion: reduce)');
    let revision = 0, parts = [], index = 0, whole = false, busy = false, motion = null;
    function usable() {
      const dialog = copy.closest('dialog');
      return !document.hidden && copy.getClientRects().length && !copy.closest('[hidden]') &&
        (!dialog || (dialog.open && dialog.dataset.state === 'open' && dialog.getAttribute('aria-busy') === 'false'));
    }
    function cancel() {
      revision++;busy = false;motion?.kill();motion = null;
      copy.style.removeProperty('transform');copy.style.removeProperty('opacity');
      for (const button of [mode,previous,next,keep]) button.removeAttribute('aria-busy');
    }
    function paint() {
      for (let i = 0; i < parts.length; i++) parts[i].hidden = !whole && i !== index;
      top.hidden = !parts.length;bottom.hidden = !parts.length;
      mode.hidden = parts.length < 2;mode.setAttribute('aria-pressed',String(whole));
      mode.textContent = whole ? '分段阅读' : '连贯阅读';
      position.textContent = whole ? '全文 · '+parts.length+' 段' : '第 '+(index+1)+' / '+parts.length+' 段';
      previous.disabled = index === 0;next.disabled = index === parts.length-1;
      bottom.querySelector('.journey-reader-paging').hidden = whole || parts.length < 2;
      next.textContent = index === parts.length-1 ? '已到末段' : '再读一段 →';
      refresh();
    }
    function refresh() {
      const recorded = hooks.recorded?.() === true;
      keep.setAttribute('aria-pressed',String(recorded));keep.textContent = recorded ? '已记下这一景' : '记下这一景';
    }
    function clear() {cancel();parts = [];index = 0;whole = false;copy.replaceChildren();paint();}
    function mount(text) {
      clear();if (typeof text !== 'string' || !text.trim()) return;
      // Only paragraph boundaries already supplied by the current content are
      // used. No summarisation, sentence slicing, added facts or source cache.
      const tokens = text.split(/(\n\s*\n)/);
      for (const token of tokens) {
        if (!token.trim()) {copy.append(document.createTextNode(token));continue;}
        const span = document.createElement('span');span.className = 'journey-reader-paragraph';
        span.textContent = token;span.dataset.paragraph = String(parts.length);copy.append(span);parts.push(span);
      }
      paint();
    }
    async function act(button, change, animate = false) {
      if (busy || !usable()) return;
      busy = true;const ticket = ++revision;button.setAttribute('aria-busy','true');
      try {
        if (await hooks.verify?.() !== true || ticket !== revision || !usable()) return;
        change();paint();
        if (animate) {
          copy.focus({preventScroll:true});copy.scrollIntoView({block:'nearest',behavior:'instant'});
          if (!reduce.matches && root.gsap) motion = root.gsap.fromTo(copy,{y:7,opacity:.55},{y:0,opacity:1,duration:.38,ease:'power2.out',clearProps:'transform,opacity'});
        }
      } catch { /* The outer content gate owns expiry and retry. */ }
      finally {if (ticket === revision) {busy = false;button.removeAttribute('aria-busy');}}
    }
    mode.addEventListener('click',() => act(mode,() => {whole = !whole;}));
    previous.addEventListener('click',() => act(previous,() => {index = Math.max(0,index-1);},true));
    next.addEventListener('click',() => act(next,() => {index = Math.min(parts.length-1,index+1);},true));
    keep.addEventListener('click',() => act(keep,() => {hooks.onKeep?.();}));
    reduce.addEventListener('change',cancel);
    return {mount,clear,cancel,refresh};
  }
  root.ChuJourneyReader = {create};
})(window);
