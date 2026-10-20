(function () {
  'use strict';
  // Display preferences and retrying the one existing illustration only.
  // No source content, identities, media URLs or visit records are stored here.
  const $ = id => document.getElementById(id);
  const key = 'chulink:journey-reading-size:v1', size = $('reading-size');
  let large = false;
  try {large = localStorage.getItem(key) === 'large';} catch { /* Session-only controls still work. */ }
  function paintSize() {
    document.body.dataset.readingSize = large ? 'large' : 'standard';
    size.setAttribute('aria-pressed',String(large));
    size.textContent = large ? '恢复字号' : '大字阅读';
    size.setAttribute('aria-label',large ? '恢复标准字号' : '使用大字阅读');
  }
  if (size) {
    paintSize();size.hidden = false;
    size.addEventListener('click',() => {
      large = !large;paintSize();
      try {localStorage.setItem(key,large ? 'large' : 'standard');$('reading-size-status').textContent = '';}
      catch {$('reading-size-status').textContent = '字号仅本次有效';}
    });
  }
  const art = $('journey-art'), error = $('art-error'), retry = $('art-retry'), copy = $('art-error-copy');
  if (!art || !error || !retry || !copy) return;
  retry.hidden = false;
  const original = art.getAttribute('src');
  let attempt = 0, pending = false, retryHadFocus = false, timer, probe = null;
  const good = () => art.complete && art.naturalWidth > 0;
  function cancel() {
    attempt++;clearTimeout(timer);
    if (probe) {probe.onload = null;probe.onerror = null;probe = null;}
    pending = false;retryHadFocus = false;retry.disabled = false;retry.removeAttribute('aria-busy');retry.textContent = '重新加载画稿';
  }
  function fail(slow = false) {
    cancel();error.hidden = false;
    copy.textContent = slow ? '画稿加载较慢，可以重试；文字仍可阅读。' : '画稿暂未加载，文字阅读仍可使用。';
  }
  function restored(notify = false) {
    // Disabling a pending button can move focus to body in Chromium. Restore
    // only that abandoned focus, never steal it from another control or leaf.
    const focused = !document.hidden && !document.querySelector('dialog[open]') &&
      (document.activeElement === retry || (retryHadFocus && document.activeElement === document.body));
    cancel();error.hidden = true;
    if (focused) $('journey-stage').focus({preventScroll:true});
    if (notify) art.dispatchEvent(new Event('journey:art-restored'));
  }
  retry.addEventListener('click',() => {
    if (pending) return;
    cancel();pending = true;retryHadFocus = document.activeElement === retry;const ticket = attempt;
    retry.disabled = true;retry.setAttribute('aria-busy','true');retry.textContent = '正在加载';
    copy.textContent = '正在重新加载画稿，文字阅读不受影响。';
    const request = probe = new Image();
    timer = setTimeout(() => {if (ticket === attempt) fail(true);},10000);
    request.onerror = () => {if (ticket === attempt) fail();};
    request.onload = async () => {
      if (ticket !== attempt) return;
      art.src = original;
      try {
        await art.decode();
        if (ticket === attempt && good()) restored(true);
      } catch {if (ticket === attempt) fail();}
    };
    request.src = original;
  });
  art.addEventListener('error',() => {if (!pending) fail();});
  art.addEventListener('load',() => {if (!pending && good()) restored(!error.hidden);});
  function inspect() {
    if (good()) restored();
    else if (art.complete) fail();
    else timer = setTimeout(() => {if (!good()) fail(true);},10000);
  }
  addEventListener('pagehide',cancel);
  addEventListener('pageshow',event => {if (event.persisted) inspect();});
  inspect();
})();
