/* Visitor reading leaves. Original DOM nodes only; verification belongs to the journey controller. */
(function () {
  'use strict';
  function create(hooks) {
    if (typeof HTMLDialogElement === 'undefined' || !HTMLDialogElement.prototype.showModal) return null;
    const pages = new Map(), journal = document.querySelector('.journal');
    const spec = [
      ['journey-help', '读卷说明', '入卷须知', '先看景，再读一页'],
      ['reading', '读这一景', '景物札记', '讲解'],
      ['sources', '查阅出处', '出处与核对', '资料'],
      ['trial-feedback', '留一条体验建议', '留一笔回音', '选填 · 只存本机']
    ];
    const dialog = document.createElement('dialog');
    dialog.id = 'journey-leaf-dialog';dialog.className = 'journey-leaf-dialog';
    dialog.setAttribute('aria-labelledby', 'journey-leaf-title');
    dialog.innerHTML = '<div class="journey-leaf-sheet"><header class="journey-leaf-header"><div><span class="journey-leaf-kicker"></span><h2 id="journey-leaf-title" tabindex="-1"></h2><p class="journey-leaf-context"></p></div><button type="button" class="journey-leaf-close" aria-label="合上纸页">×</button></header><p class="journey-leaf-loading" role="status">正在核对资料，稍候取阅……</p><div id="journey-leaf-body" class="journey-leaf-body" hidden></div><p class="journey-leaf-status fine" role="status" hidden></p><footer class="journey-leaf-footer"><span>楚韵链迹 · 一卷随行</span><button type="button" class="journey-leaf-return">合页，回到画卷 ↗</button></footer></div>';
    journal.append(dialog);
    const body = dialog.querySelector('#journey-leaf-body'),title = dialog.querySelector('h2');
    const loading = dialog.querySelector('.journey-leaf-loading'),context = dialog.querySelector('.journey-leaf-context');
    const status = dialog.querySelector('.journey-leaf-status');
    let active = null, request = 0, closing, outsideDown = false, audioSlot = null;
    for (const [id,label,heading,hint] of spec) {
      const original = document.getElementById(id),summary = original.querySelector('summary');
      const source = document.createElement('section');
      source.id = id;source.className = original.className + ' journey-leaf-entry';
      const trigger = document.createElement('button');
      trigger.type = 'button';trigger.className = 'journey-leaf-trigger';
      trigger.setAttribute('aria-haspopup', 'dialog');trigger.setAttribute('aria-controls', dialog.id);
      const name = document.createElement('span');name.textContent = label;
      const tail = document.createElement('span');tail.textContent = hint + ' ↗';tail.className = 'journey-leaf-entry-hint';tail.setAttribute('aria-hidden','true');
      trigger.append(name,tail);
      const content = document.createElement('div');
      content.className = 'journey-leaf-content';content.hidden = true;
      summary.remove();content.append(...original.childNodes);source.append(trigger,content);original.replaceWith(source);
      pages.set(id,{id,source,trigger,content,heading});
      trigger.addEventListener('click', () => open(id));
    }
    function visible(item) {return item?.source.isConnected && !item.source.closest('[hidden]');}
    function restore() {
      if (audioSlot) {audioSlot.replaceWith(document.getElementById('audio'));audioSlot = null;}
      if (active) {active.content.hidden = true;active.source.append(active.content);}
      body.replaceChildren();body.hidden = true;
    }
    function dismiss({restoreFocus = true} = {}) {
      request++;clearTimeout(closing);
      const trigger = active?.trigger;
      restore();active = null;
      if (dialog.open) dialog.close();
      dialog.classList.remove('is-closing');dialog.removeAttribute('data-leaf');dialog.setAttribute('aria-busy','false');
      document.documentElement.classList.remove('journey-leaf-open');
      hooks.onClose?.();
      if (restoreFocus && trigger?.getClientRects().length) trigger.focus({preventScroll:true});
    }
    function close() {
      if (!dialog.open || dialog.classList.contains('is-closing')) return;
      request++; // Closing during a pending read cannot reopen the leaf later.
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) return dismiss();
      dialog.classList.add('is-closing');closing = setTimeout(() => dismiss(),180);
    }
    async function open(id) {
      const item = pages.get(id);
      if (!visible(item)) return;
      const token = ++request;
      clearTimeout(closing);dialog.classList.remove('is-closing');restore();active = item;
      title.textContent = '正在取阅';context.textContent = '';
      dialog.querySelector('.journey-leaf-kicker').textContent = '一卷随行 / ' + item.heading;
      dialog.dataset.leaf = id;dialog.setAttribute('aria-busy','true');loading.hidden = false;status.hidden = true;
      dialog.querySelector('.journey-leaf-return').textContent = id === 'trial-feedback' ? '合页，回到拾记 ↗' : '合页，回到画卷 ↗';
      if (!dialog.open) dialog.showModal();
      document.documentElement.classList.add('journey-leaf-open');title.focus({preventScroll:true});hooks.onOpen?.();
      try {
        const allowed = await hooks.verify(id);
        if (token !== request) return;
        if (!allowed || !visible(item)) {dismiss({restoreFocus:false});return;}
        const pointTitle = document.getElementById('point-title').textContent;
        title.textContent = id === 'reading' ? pointTitle : item.heading;
        context.textContent = id === 'trial-feedback' ? '只留建议，不上传身份与行踪' : id === 'journey-help' ? '看一处景，读一段有出处的讲解' : (id === 'reading' ? '' : pointTitle + ' · ') + document.getElementById('position').textContent;
        item.content.hidden = false;body.append(item.content);body.hidden = false;body.scrollTop = 0;
        // Keep manual narration controls available on the reading leaf, without a second audio player.
        if (id === 'reading') {
          const audio = document.getElementById('audio');audioSlot = document.createComment('journey-audio-home');
          audio.replaceWith(audioSlot);body.append(audio);
        }
        loading.hidden = true;dialog.setAttribute('aria-busy','false');syncStatus();
      } catch {
        if (token === request) dismiss({restoreFocus:false});
        // Controller verification owns the unavailable/retry message, never a stale modal fallback.
      }
    }
    function syncStatus() {
      const value = document.getElementById('status').textContent;
      if (status.textContent !== value) status.textContent = value;
      if (status.hidden !== !value) status.hidden = !value;
    }
    dialog.querySelector('.journey-leaf-close').onclick = close;
    dialog.querySelector('.journey-leaf-return').onclick = close;
    dialog.addEventListener('cancel',e => {e.preventDefault();close();});
    dialog.addEventListener('close',() => {if (!dialog.open && active) dismiss();});
    dialog.addEventListener('keydown',e => {
      if (e.key !== 'Tab') return;
      const focusable = [...dialog.querySelectorAll('button,a[href],input,textarea,[tabindex="0"]')].filter(el => !el.disabled && el.getClientRects().length);
      const first = focusable[0],last = focusable.at(-1);
      if (e.shiftKey && (document.activeElement === first || document.activeElement === title)) {e.preventDefault();last?.focus();}
      else if (!e.shiftKey && document.activeElement === last) {e.preventDefault();first?.focus();}
    });
    const outside = e => {const r = dialog.getBoundingClientRect();return e.clientX<r.left || e.clientX>r.right || e.clientY<r.top || e.clientY>r.bottom;};
    dialog.addEventListener('pointerdown',e => {outsideDown = e.target === dialog && outside(e);});
    dialog.addEventListener('click',e => {if (outsideDown && e.target === dialog && outside(e)) close();outsideDown = false;});
    const observer = new MutationObserver(() => {
      if (active && !visible(active)) dismiss({restoreFocus:false});
      else if (active && dialog.getAttribute('aria-busy') === 'false') syncStatus();
    });
    for (const id of ['content','finished']) observer.observe(document.getElementById(id),{attributes:true,attributeFilter:['hidden']});
    observer.observe(document.getElementById('status'),{childList:true,characterData:true,subtree:true});
    return {dismiss,isOpen:() => dialog.open};
  }
  window.ChuJourneyLeaves = {create};
})();
