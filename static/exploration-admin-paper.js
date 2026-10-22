/* Presentation only: one book leaf, original form nodes, no data or publishing API. */
(function () {
  'use strict';
  const editor = document.getElementById('wa-editor');
  if (!editor || typeof HTMLDialogElement === 'undefined' || !HTMLDialogElement.prototype.showModal) return;
  let serial = 0, stack = [], timer, outsideDown = false;
  const entries = new WeakMap();
  const dialog = document.createElement('dialog');
  dialog.id = 'ja-paper-dialog';
  dialog.className = 'paper-dialog';
  dialog.setAttribute('aria-labelledby', 'ja-paper-title');
  dialog.innerHTML = '<div class="paper-leaf"><header class="paper-header"><div class="paper-heading"><span class="paper-imprint">楚韵链迹 · 导览手札</span><h2 id="ja-paper-title" tabindex="-1"></h2></div><button type="button" class="paper-close" aria-label="关闭纸页">×</button></header><div class="paper-tools"><button type="button" class="paper-back" hidden>‹ 返回上一页</button><span class="paper-context"></span></div><p class="paper-message" role="status" aria-live="polite" hidden></p><div class="paper-scroll"></div><footer class="paper-footer"><span>关闭不自动保存，修改暂留当前页面。</span><button type="button" class="paper-return">回到工作台 ↗</button></footer></div>';
  editor.append(dialog);
  const body = dialog.querySelector('.paper-scroll');
  const title = dialog.querySelector('h2');
  const back = dialog.querySelector('.paper-back');
  const context = dialog.querySelector('.paper-context');
  const message = dialog.querySelector('.paper-message');
  const current = () => stack.at(-1);

  function enhance() {
    for (const details of editor.querySelectorAll('details')) {
      const summary = details.querySelector(':scope > summary');
      if (!summary) continue;
      const source = document.createElement('section');
      for (const attr of details.attributes) if (attr.name !== 'open') source.setAttribute(attr.name, attr.value);
      source.id ||= 'ja-leaf-' + (++serial);
      source.classList.add('paper-entry');
      const trigger = document.createElement('button');
      trigger.type = 'button';
      trigger.className = 'paper-entry-trigger';
      trigger.setAttribute('aria-haspopup', 'dialog');
      trigger.setAttribute('aria-controls', dialog.id);
      const label = document.createElement('span');
      label.className = 'paper-entry-label';
      label.append(...summary.childNodes);
      const arrow = document.createElement('span');
      arrow.className = 'paper-entry-arrow';
      arrow.setAttribute('aria-hidden', 'true');
      arrow.textContent = '↗';
      trigger.append(label, arrow);
      const content = document.createElement('div');
      content.className = 'paper-entry-content';
      content.hidden = true;
      summary.remove();
      content.append(...details.childNodes);
      source.append(trigger, content);
      const name = [...label.childNodes].filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent).join('').trim() || label.textContent.trim();
      const item = {source, trigger, content, name, hint: label.querySelector('span')?.textContent || '', scroll: 0};
      entries.set(source, item);
      trigger.addEventListener('click', () => open(item));
      details.replaceWith(source);
    }
  }
  function restore(item) {
    if (!item) return;
    item.scroll = body.scrollTop;
    item.content.hidden = true;
    item.source.append(item.content);
  }
  function valid(item) {
    // A reload/invalidation may remove the source while its form lives in the dialog.
    return item?.source.isConnected && !editor.hidden && !document.getElementById('wa-app').hidden
      && !item.source.closest('#wa-review[hidden]');
  }
  function paint(focusTarget) {
    const item = current();
    body.replaceChildren(item.content);
    item.content.hidden = false;
    title.textContent = item.name;
    context.textContent = item.hint || (stack.length > 1 ? stack.at(-2).name : '按需打开，一次专注一件事');
    back.hidden = stack.length < 2;
    dialog.dataset.page = item.source.id;
    syncMessage();
    if (!dialog.open) dialog.showModal();
    document.documentElement.classList.add('paper-open');
    body.scrollTop = item.scroll;
    (focusTarget || title).focus({preventScroll: true});
    if (focusTarget) focusTarget.scrollIntoView({block: 'nearest'});
  }
  function open(item) {
    if (!valid(item)) return;
    clearTimeout(timer);
    dialog.classList.remove('is-closing');
    const previous = current();
    if (previous === item) return;
    const nested = previous?.content.contains(item.source);
    restore(previous);
    if (!nested) stack = [];
    stack.push(item);
    paint();
  }
  function finish() {
    clearTimeout(timer);
    const returnTo = stack[0]?.trigger;
    restore(current());
    stack = [];
    if (dialog.open) dialog.close();
    delete dialog.dataset.page;
    dialog.classList.remove('is-closing');
    document.documentElement.classList.remove('paper-open');
    const target = returnTo?.isConnected && returnTo.getClientRects().length ? returnTo : document.getElementById('wa-load');
    target?.focus({preventScroll: true});
  }
  function close() {
    if (!dialog.open || dialog.classList.contains('is-closing')) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return finish();
    dialog.classList.add('is-closing');
    timer = setTimeout(finish, 160);
  }
  function syncMessage() {
    const id = current()?.source.id;
    const source = document.getElementById(id === 'er-more' ? 'er-status' : 'wa-message');
    const text = source?.textContent.trim() || '';
    // Hide the persistent local-test identity notice, but keep errors visible over the backdrop.
    const value = text.startsWith('本地模拟工作区') ? '' : text;
    if (message.textContent !== value) message.textContent = value;
    if (message.hidden !== !value) message.hidden = !value;
  }
  back.addEventListener('click', () => {
    const child = current();
    restore(child);
    stack.pop();
    if (!valid(current())) return finish();
    paint(child.trigger);
  });
  dialog.querySelector('.paper-close').addEventListener('click', close);
  dialog.querySelector('.paper-return').addEventListener('click', close);
  dialog.addEventListener('cancel', event => {event.preventDefault(); close();});
  dialog.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const items = [...dialog.querySelectorAll('button,a[href],input,select,textarea,[tabindex="0"]')]
      .filter(el => !el.disabled && el.getClientRects().length);
    const first = items[0], last = items.at(-1);
    if (!first) {event.preventDefault();title.focus();return;}
    if (event.shiftKey && (document.activeElement === first || document.activeElement === title)) {event.preventDefault();last.focus();}
    else if (!event.shiftKey && document.activeElement === last) {event.preventDefault();first.focus();}
  });
  // Native close() callers also restore nodes and body scrolling.
  dialog.addEventListener('close', () => {if (!dialog.open && stack.length) finish();});
  const outside = e => {const r = dialog.getBoundingClientRect();return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;};
  dialog.addEventListener('pointerdown', e => {outsideDown = e.target === dialog && outside(e);});
  dialog.addEventListener('click', e => {if (outsideDown && e.target === dialog && outside(e)) close();outsideDown = false;});
  const observer = new MutationObserver(() => {
    enhance();
    if (stack.length && stack.some(item => !valid(item))) finish();
    if (stack.length) syncMessage();
    // The shared request runner disables every button; closing must remain available.
    for (const button of dialog.querySelectorAll('.paper-close,.paper-back,.paper-return')) if (button.disabled) button.disabled = false;
  });
  enhance();
  observer.observe(document.getElementById('wa-app'), {childList: true, subtree: true, attributes: true, attributeFilter: ['hidden']});
  observer.observe(document.getElementById('wa-message'), {childList: true, characterData: true, subtree: true});
  observer.observe(dialog, {attributes: true, subtree: true, attributeFilter: ['disabled']});
  window.JourneyAdminPaper = {
    openTarget(target) {
      enhance();
      const source = target.closest('.paper-entry');
      const item = entries.get(source);
      if (!item) return false;
      open(item);
      target.tabIndex = -1;
      target.focus({preventScroll: true});
      target.scrollIntoView({block: 'start'});
      return true;
    }
  };
})();
