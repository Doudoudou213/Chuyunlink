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
    dialog.innerHTML = '<div class="journey-leaf-sheet"><div class="journey-leaf-motif" aria-hidden="true"></div><div class="journey-leaf-light" aria-hidden="true"></div><div class="journey-leaf-shade" aria-hidden="true"></div><header class="journey-leaf-header"><div class="journey-leaf-heading"><span class="journey-leaf-kicker"></span><h2 id="journey-leaf-title" tabindex="-1"></h2><p class="journey-leaf-context"></p></div><div class="journey-leaf-tools"><nav class="journey-leaf-tabs" aria-label="阅读内容" hidden><button type="button" id="journey-leaf-tab-reading" aria-pressed="false">读景</button><button type="button" id="journey-leaf-tab-sources" aria-pressed="false">出处</button></nav><button type="button" class="journey-leaf-close" aria-label="合上纸页">×</button></div></header><p class="journey-leaf-loading" role="status">正在核对资料，稍候取阅……</p><div id="journey-leaf-body" class="journey-leaf-body" hidden></div><p class="journey-leaf-status fine" role="status" hidden></p><footer class="journey-leaf-footer"><span>楚韵链迹 · 一景一笺</span><button type="button" class="journey-leaf-return">合页，回到画卷 ↗</button><button type="button" id="journey-leaf-next" hidden disabled><span class="journey-leaf-next-label"></span></button></footer></div>';
    journal.append(dialog);
    const veil = document.createElement('div');veil.className = 'journey-leaf-veil';veil.setAttribute('aria-hidden','true');document.body.append(veil);
    const body = dialog.querySelector('#journey-leaf-body'),title = dialog.querySelector('h2');
    const loading = dialog.querySelector('.journey-leaf-loading'),context = dialog.querySelector('.journey-leaf-context');
    const status = dialog.querySelector('.journey-leaf-status'),motif = dialog.querySelector('.journey-leaf-motif');
    const nextButton = dialog.querySelector('#journey-leaf-next'),nextLabel = nextButton.querySelector('span');
    const tabs = dialog.querySelector('.journey-leaf-tabs');
    const tabButtons = new Map(['reading','sources'].map(id => [id,dialog.querySelector('#journey-leaf-tab-'+id)]));
    const readingTools = document.querySelector('#journey-reading-main > .journey-reading-tools');
    let readingToolsHome = null;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)');
    const motion = window.ChuLeafMotion?.create({dialog,sheet:dialog.querySelector('.journey-leaf-sheet'),motif,parts:[...dialog.querySelectorAll('.journey-leaf-header,.journey-leaf-body,.journey-leaf-footer')],light:dialog.querySelector('.journey-leaf-light'),shade:dialog.querySelector('.journey-leaf-shade'),veil});
    let active = null, request = 0, outsideDown = false, audioSlot = null, opener = null;
    let navigationClose = null, continueBusy = false, shown = false, openAttempt = 0, presented = false;
    // Scroll positions belong to this verified open paper only. They are not
    // persisted and cannot leak across scenes, versions or a closed session.
    const scrollPositions = new Map();
    dialog.dataset.state = 'closed';
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
    function origin() {
      const el = hooks.origin?.() || opener,r = el?.getBoundingClientRect();
      if (!r || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return null;
      const frame = el.closest('#journey-stage')?.getBoundingClientRect();
      if (frame && (r.right < frame.left || r.left > frame.right || r.bottom < frame.top || r.top > frame.bottom)) return null;
      return {x:r.left+r.width/2,y:r.top+r.height/2};
    }
    function settle() {
      motion?.settle();veil.style.opacity = '1';
      if (dialog.open) {dialog.dataset.state = 'open';updateTabs(active?.id,dialog.getAttribute('aria-busy') !== 'false');}
    }
    function setMotif(id) {
      // Only a verified, explicitly bound original-art scene can decorate the page.
      motif.replaceChildren();dialog.removeAttribute('data-scene');
      if (id !== 'reading' && id !== 'sources') return;
      const scene = hooks.scene?.(),profile = window.ChuParkGildedProfiles?.[scene];
      if (!profile) return;
      dialog.dataset.scene = scene;
      const r = profile.sourceRect,photo = document.createElement('div');photo.className = 'journey-leaf-motif-photo';
      photo.style.backgroundSize = (1919/r.width*100)+'% '+(820/r.height*100)+'%';
      photo.style.backgroundPosition = (r.x/(1919-r.width)*100)+'% '+(r.y/(820-r.height)*100)+'%';
      motif.append(photo);
    }
    function restore() {
      // Return the one preference control before detaching a page. Its listener,
      // live status and selected size survive moves; help never inherits it.
      if (readingToolsHome) {
        readingToolsHome.replaceWith(readingTools);readingToolsHome = null;
        readingTools.classList.remove('journey-leaf-reading-tools');
      }
      if (audioSlot) {audioSlot.replaceWith(document.getElementById('audio'));audioSlot = null;}
      if (active) {active.content.hidden = true;active.source.append(active.content);}
      body.replaceChildren();body.hidden = true;
    }
    function mountReadingTools(id) {
      if (!tabButtons.has(id) || !readingTools || readingToolsHome || readingTools.querySelector('#reading-size')?.hidden !== false) return;
      readingToolsHome = document.createComment('journey-reading-tools-home');
      readingTools.replaceWith(readingToolsHome);
      readingTools.classList.add('journey-leaf-reading-tools');
      dialog.querySelector('.journey-leaf-tools').insertBefore(readingTools,dialog.querySelector('.journey-leaf-close'));
    }
    function cancelNavigation() {
      const pending = navigationClose;navigationClose = null;
      pending?.resolve(false);
    }
    function resetContinue() {
      continueBusy = false;nextButton.hidden = true;nextButton.disabled = true;
      nextLabel.textContent = '';nextButton.removeAttribute('aria-label');nextButton.removeAttribute('title');
    }
    function updateTabs(id, busy = false) {
      tabs.hidden = !tabButtons.has(id);
      for (const [page,button] of tabButtons) {
        button.setAttribute('aria-pressed',String(page === id));
        button.disabled = busy || dialog.dataset.state !== 'open' || !visible(pages.get(page));
      }
    }
    function updateContinue() {
      resetContinue();
      if (active?.id !== 'reading' || dialog.getAttribute('aria-busy') !== 'false' || typeof hooks.onContinue !== 'function') return;
      const next = hooks.next?.();
      if (!next || (!next.last && (typeof next.title !== 'string' || !next.title.trim()))) return;
      const label = next.last ? '收卷留念' : '下一景 · ' + next.title.trim() + ' →';
      nextLabel.textContent = label;nextButton.setAttribute('aria-label',label);nextButton.title = label;
      nextButton.hidden = false;nextButton.disabled = false;
    }
    function dismiss({restoreFocus = true} = {}) {
      openAttempt++;
      cancelNavigation();
      request++;motion?.reset();veil.style.opacity = '';
      const trigger = opener || active?.trigger,wasShown = shown;shown = false;
      // Native dialog.close() can restore its previous focus independently of our
      // explicit return. Navigation hands focus to the new scene instead.
      if (!restoreFocus && dialog.contains(document.activeElement)) document.activeElement.blur?.();
      restore();active = null;
      if (dialog.open) dialog.close();
      dialog.dataset.state = 'closed';dialog.removeAttribute('data-leaf');dialog.removeAttribute('data-scene');dialog.setAttribute('aria-busy','false');
      title.textContent = '';context.textContent = '';status.textContent = '';motif.replaceChildren();opener = null;
      document.documentElement.classList.remove('journey-leaf-open');
      document.documentElement.style.removeProperty('--journey-scroll-gap');
      resetContinue();updateTabs(null);scrollPositions.clear();
      hooks.onClose?.();
      if (wasShown) hooks.onDismissed?.();
      if (restoreFocus && trigger?.getClientRects().length) trigger.focus({preventScroll:true});
    }
    function beginClose({navigation = false} = {}) {
      if (!dialog.open || dialog.dataset.state === 'closing') return;
      const token = ++request; // Closing during a pending read cannot reopen the leaf later.
      dialog.dataset.state = 'closing';
      nextButton.disabled = true;
      updateTabs(active?.id,true);
      hooks.onClosing?.({navigation});
      if (token !== request || !dialog.open) return;
      const complete = () => {
        if (token !== request) return;
        const pending = navigation ? navigationClose : null;
        navigationClose = null;
        dismiss({restoreFocus:!navigation});
        pending?.resolve(true);
      };
      if (!motion || reduce.matches) return complete();
      motion.leave({origin:origin(),compact:navigation,onComplete:complete});
    }
    function close() {
      openAttempt++;
      if (navigationClose && dialog.dataset.state === 'closing') {
        // A second intent to close (Escape, close button or backdrop) cancels
        // onward navigation, but lets the already-running paper return finish.
        cancelNavigation();nextButton.disabled = true;
        hooks.onClosing?.({navigation:false});
        return;
      }
      beginClose();
    }
    function closeForNavigation() {
      openAttempt++;
      if (navigationClose) return navigationClose.promise;
      if (!dialog.open || dialog.dataset.state === 'closing' || dialog.getAttribute('aria-busy') !== 'false' || document.hidden) return Promise.resolve(false);
      let resolve;
      const promise = new Promise(done => {resolve = done;});
      navigationClose = {promise,resolve};
      beginClose({navigation:true});
      return promise;
    }
    async function open(id,{originElement,internal = false} = {}) {
      const item = pages.get(id);
      if (!visible(item)) return;
      // The paper has one modal/history entry. Its two reading views never open
      // a nested dialog, and cannot race a pending verification or continuation.
      const switching = internal && dialog.open && tabButtons.has(active?.id) && tabButtons.has(id);
      if (internal && (!switching || id === active.id || continueBusy || dialog.dataset.state !== 'open' || dialog.getAttribute('aria-busy') !== 'false')) return;
      const attempt = ++openAttempt;
      // A pending history return must finish before a new modal mutates the DOM.
      // Keep the legacy synchronous opening path when the hook is not installed.
      if (typeof hooks.beforeOpen === 'function') {
        let allowed;
        try {allowed = await hooks.beforeOpen();} catch {return;}
        if (attempt !== openAttempt || allowed === false || !visible(item)) return;
      }
      cancelNavigation();resetContinue();
      const token = ++request,fresh = !dialog.open;
      if (switching) scrollPositions.set(active.id,body.scrollTop);
      else scrollPositions.clear();
      restore();active = item;
      if (!switching) opener = originElement || item.trigger;
      setMotif(null);updateTabs(id,true);
      title.textContent = '正在取阅';context.textContent = '';
      dialog.querySelector('.journey-leaf-kicker').textContent = '一卷随行 / ' + item.heading;
      dialog.dataset.leaf = id;dialog.setAttribute('aria-busy','true');loading.hidden = false;status.hidden = true;
      dialog.querySelector('.journey-leaf-return').textContent = id === 'trial-feedback' ? '合页，回到拾记 ↗' : id === 'reading' ? '回到画卷' : '合页，回到画卷 ↗';
      const start = origin();
      if (fresh) document.documentElement.style.setProperty('--journey-scroll-gap',Math.max(0,innerWidth-document.documentElement.clientWidth)+'px');
      if (!dialog.open) {dialog.showModal();shown = true;hooks.onShown?.(id);}
      document.documentElement.classList.add('journey-leaf-open');dialog.dataset.state = 'opening';title.focus({preventScroll:true});hooks.onOpen?.();
      if (!motion || reduce.matches) {settle();presented = true;}
      else motion.enter({origin:start,fresh,compact:presented,onComplete:() => {if (token === request) {settle();presented = true;}}});
      try {
        const allowed = await hooks.verify(id);
        if (token !== request) return;
        if (!allowed || !visible(item)) {dismiss({restoreFocus:false});return;}
        const pointTitle = document.getElementById('point-title').textContent;
        setMotif(id);
        title.textContent = id === 'reading' ? pointTitle : item.heading;
        context.textContent = id === 'trial-feedback' ? '只留建议，不上传身份与行踪' : id === 'journey-help' ? '看一处景，读一段有出处的讲解' : (id === 'reading' ? '' : pointTitle + ' · ') + document.getElementById('position').textContent;
        item.content.hidden = false;body.append(item.content);body.hidden = false;
        // Reading and source text share the existing size preference, but only
        // after this paper passes verification. Pending/closed pages keep it home.
        mountReadingTools(id);
        // Keep manual narration controls available on the reading leaf, without a second audio player.
        if (id === 'reading') {
          const audio = document.getElementById('audio');audioSlot = document.createComment('journey-audio-home');
          audio.replaceWith(audioSlot);body.append(audio);
        }
        loading.hidden = true;dialog.setAttribute('aria-busy','false');syncStatus();updateContinue();updateTabs(id);
        body.scrollTop = switching ? scrollPositions.get(id) || 0 : 0;
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
    for (const [id,button] of tabButtons) button.onclick = () => open(id,{internal:true});
    nextButton.onclick = async () => {
      if (continueBusy || nextButton.hidden || nextButton.disabled || !dialog.open || dialog.dataset.state === 'closing' || dialog.getAttribute('aria-busy') !== 'false' || document.hidden) return;
      const token = request;continueBusy = true;nextButton.disabled = true;
      try {await hooks.onContinue?.();}
      catch {
        if (token === request && dialog.open) {status.textContent = '暂时无法继续，请稍后再试。';status.hidden = false;}
      } finally {
        if (token === request && dialog.open && dialog.dataset.state !== 'closing') {continueBusy = false;nextButton.disabled = false;}
      }
    };
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
    function adaptMotion() {if (dialog.open) {if (dialog.dataset.state === 'closing') dismiss();else settle();}}
    addEventListener('resize',adaptMotion);reduce.addEventListener('change',adaptMotion);
    document.addEventListener('visibilitychange',() => {if (document.hidden && dialog.open) dismiss({restoreFocus:false});});
    return {open,close,closeForNavigation,dismiss,isOpen:() => dialog.open};
  }
  window.ChuJourneyLeaves = {create};
})();
