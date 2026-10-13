(function () {
  'use strict';
  const scene = window.ChuMotionScene;
  const $ = id => document.getElementById(id);
  const root = $('motion-demo'), stage = $('motion-stage'), world = $('motion-map-transform');
  const halo = $('motion-halo');
  const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
  const storageKey = 'chulink:motion-demo:viewed:v1';
  const animations = new Set(), ambient = new Set(), pointers = new Map();
  let selected = 'tower', reduced = motionPreference.matches, drag = null, suppressClickUntil = 0;
  let camera = { x: 0, y: 0, scale: 1 };
  let viewed = new Set();
  try { const saved = JSON.parse(localStorage.getItem(storageKey) || '[]'); if (Array.isArray(saved)) viewed = new Set(saved.filter(id => Object.hasOwn(scene, id))); } catch (_) { /* Storage is optional. */ }

  function announce(message) { $('motion-status').textContent = message; }
  function play(node, keyframes, options, decorative = false) {
    if (reduced || document.hidden || !node || typeof node.animate !== 'function') return null;
    const animation = node.animate(keyframes, options);
    const group = decorative ? ambient : animations;
    group.add(animation);
    animation.onfinish = () => group.delete(animation);
    animation.oncancel = () => group.delete(animation);
    return animation;
  }
  function cancel(group) { for (const animation of [...group]) animation.cancel(); group.clear(); }
  function drift() {
    cancel(ambient);
    play(document.querySelector('.cranes'), [{ transform: 'translate(-5px,4px) rotate(-1deg)' }, { transform: 'translate(8px,-5px) rotate(1deg)' }], { duration: 6800, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out' }, true);
    play(document.querySelector('.pond-shimmer'), [{ opacity: .2, transform: 'scale(.9)' }, { opacity: .85, transform: 'scale(1.1)' }], { duration: 4900, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out' }, true);
    for (const [index, spark] of [...halo.children].entries()) {
      play(spark, [{ opacity: .35 }, { opacity: 1 }, { opacity: .45 }], { duration: 2600 + index * 310, iterations: Infinity, delay: index * 300, easing: 'ease-in-out' }, true);
    }
  }
  function cameraUpdate() {
    const width = stage.clientWidth, height = stage.clientHeight;
    camera.scale = Math.max(.85, Math.min(2.4, camera.scale));
    const limitX = width * (.18 + (camera.scale - .85) * .43);
    const limitY = height * (.12 + (camera.scale - .85) * .32);
    camera.x = Math.max(-limitX, Math.min(limitX, camera.x));
    camera.y = Math.max(-limitY, Math.min(limitY, camera.y));
    world.style.transform = `translate(${camera.x}px,${camera.y}px) scale(${camera.scale})`;
    world.dataset.scale = String(camera.scale);
    world.style.setProperty('--map-hit', (44 / Math.min(1, camera.scale)) + 'px');
  }
  function zoom(amount) { camera.scale = Math.round((camera.scale + amount) * 100) / 100; cameraUpdate(); }
  function reset() { cancel(animations); camera = { x: 0, y: 0, scale: 1 }; cameraUpdate(); announce('已回到整幅画卷。'); }

  function remember() {
    viewed.add(selected);
    try { localStorage.setItem(storageKey, JSON.stringify([...viewed])); } catch (_) { /* No account or network fallback. */ }
  }
  function paintNotebook() {
    const list = $('motion-viewed'); list.replaceChildren();
    for (const id of viewed) { const item = document.createElement('li'); item.textContent = scene[id].title; list.append(item); }
    if (!viewed.size) { const item = document.createElement('li'); item.textContent = '还没有看过的景物'; list.append(item); }
  }
  function setDetail() {
    const point = scene[selected];
    $('detail-title').textContent = point.title;
    $('detail-observation').textContent = point.observation;
    $('detail-story').textContent = point.story;
    $('detail-image').src = point.art;
    $('detail-image').alt = point.title + '手绘形象';
    document.querySelector('.detail-art').dataset.pond = String(selected === 'pond');
  }
  function select(id, animate = true, record = true) {
    if (!Object.hasOwn(scene, id)) return;
    cancel(animations); selected = id; root.dataset.selected = id;
    const point = scene[id];
    for (const button of document.querySelectorAll('[data-point]')) button.setAttribute('aria-pressed', String(button.dataset.point === id));
    for (const art of document.querySelectorAll('[data-art]')) art.classList.toggle('is-selected', art.dataset.art === id);
    halo.style.left = point.x + '%'; halo.style.top = point.y + '%'; halo.style.width = point.halo + '%';
    $('motion-title').textContent = point.title;
    $('motion-kicker').textContent = point.kicker;
    $('motion-description').textContent = point.description;
    $('motion-answer').textContent = ''; $('motion-answer').hidden = true;
    $('motion-question').value = '';
    $('motion-question').placeholder = '想问点什么…';
    setDetail();
    if (record) remember();
    if (animate) {
      play(halo, [
        { transform: 'translate(-50%,-50%) scale(.25)', opacity: 0, filter: 'brightness(2)' },
        { transform: 'translate(-50%,-50%) scale(1.09)', opacity: 1, filter: 'brightness(1.7)', offset: .6 },
        { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, filter: 'brightness(1)' }
      ], { duration: 1050, easing: 'cubic-bezier(.2,.7,.2,1)' });
      const art = document.querySelector('[data-art="' + id + '"]');
      play(art, [{ clipPath: 'circle(8% at 50% 65%)', transform: 'translate(-50%,12px) scale(.95)', opacity: .25 }, { clipPath: 'circle(90% at 50% 65%)', transform: 'translate(-50%,0) scale(1)', opacity: 1 }], { duration: 980, easing: 'cubic-bezier(.16,.8,.24,1)' });
      for (const node of [$('motion-kicker'), $('motion-description')]) play(node, [{ opacity: .2, transform: 'translateY(5px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 340, easing: 'ease-out' });
    }
    announce('已展开' + point.title + '。这只是画卷浏览，不代表实际到访。');
  }
  function opening() {
    cancel(animations);
    for (const [index, art] of [...document.querySelectorAll('[data-art]')].entries()) {
      play(art, [{ clipPath: 'circle(1% at 50% 65%)', opacity: .05, transform: 'translate(-50%,14px)' }, { clipPath: 'circle(95% at 50% 65%)', opacity: 1, transform: 'translate(-50%,0)' }], { duration: 1400, delay: index * 180, easing: 'cubic-bezier(.18,.68,.12,1)', fill: 'backwards' });
    }
    play(halo, [{ transform: 'translate(-50%,-50%) scale(.2)', opacity: 0 }, { transform: 'translate(-50%,-50%) scale(1.07)', opacity: 1, offset: .72 }, { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 }], { duration: 1600, easing: 'ease-out' });
  }
  for (const button of document.querySelectorAll('[data-point]')) button.addEventListener('click', event => {
    if (performance.now() < suppressClickUntil && event.detail !== 0) return;
    select(button.dataset.point);
  });
  stage.addEventListener('click', event => {
    if (event.target.closest('button') || performance.now() < suppressClickUntil) return;
    for (const art of document.querySelectorAll('[data-art]')) {
      const box = art.getBoundingClientRect();
      if (event.clientX > box.left + box.width * .12 && event.clientX < box.right - box.width * .12 && event.clientY > box.top + box.height * .08 && event.clientY < box.bottom - box.height * .06) {
        select(art.dataset.art); return;
      }
    }
    const box = world.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width * 100, y = (event.clientY - box.top) / box.height * 100;
    if (((x - 50) / 26) ** 2 + ((y - 65) / 8) ** 2 < 1) select('pond');
  });
  $('motion-reset').addEventListener('click', reset);
  $('motion-replay').addEventListener('click', () => { reset(); opening(); announce(reduced ? '已按减少动态效果偏好展示静态画卷。' : '画卷已重播，仍可直接选择景物。'); });
  $('motion-zoom-in').addEventListener('click', () => zoom(.2));
  $('motion-zoom-out').addEventListener('click', () => zoom(-.2));

  stage.addEventListener('keydown', event => {
    if (event.target !== stage) return;
    const movements = { ArrowLeft: [32, 0], ArrowRight: [-32, 0], ArrowUp: [0, 32], ArrowDown: [0, -32] };
    if (movements[event.key]) { event.preventDefault(); cancel(animations); camera.x += movements[event.key][0]; camera.y += movements[event.key][1]; cameraUpdate(); }
    else if (event.key === 'Home') { event.preventDefault(); reset(); }
    else if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(.2); }
    else if (event.key === '-') { event.preventDefault(); zoom(-.2); }
  });
  stage.addEventListener('wheel', event => { event.preventDefault(); cancel(animations); zoom(event.deltaY < 0 ? .1 : -.1); }, { passive: false });
  function pointerDistance() { const pair = [...pointers.values()]; return pair.length === 2 ? Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y) : 0; }
  stage.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const distance = pointerDistance();
    drag = { x: event.clientX, y: event.clientY, startX: camera.x, startY: camera.y, scale: camera.scale, distance, moved: false };
    // Capture on the pressed element so taps on the label still dispatch their click.
    event.target.setPointerCapture?.(event.pointerId);
  });
  stage.addEventListener('pointermove', event => {
    if (!pointers.has(event.pointerId) || !drag) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    const distance = pointerDistance();
    if (distance && drag.distance) { camera.scale = drag.scale * distance / Math.max(1, drag.distance); drag.moved = true; }
    else if (Math.hypot(dx, dy) > 6 || drag.moved) { camera.x = drag.startX + dx; camera.y = drag.startY + dy; drag.moved = true; }
    if (drag.moved) { cancel(animations); stage.classList.add('dragging'); cameraUpdate(); }
  });
  function endPointer(event) {
    if (drag?.moved) suppressClickUntil = performance.now() + 400;
    pointers.delete(event.pointerId);
    if (pointers.size === 1) { const remaining = [...pointers.values()][0]; drag = { x: remaining.x, y: remaining.y, startX: camera.x, startY: camera.y, scale: camera.scale, distance: 0, moved: false }; }
    else { drag = null; stage.classList.remove('dragging'); }
  }
  stage.addEventListener('pointerup', endPointer);
  stage.addEventListener('pointercancel', endPointer);
  stage.addEventListener('lostpointercapture', event => { if (pointers.has(event.pointerId)) endPointer(event); });

  for (const [opener, dialog, closer] of [
    ['motion-details', 'motion-dialog', 'motion-close'],
    ['motion-sources', 'motion-sources-dialog', 'motion-sources-close'],
    ['motion-notebook', 'motion-notebook-dialog', 'motion-notebook-close']
  ]) {
    $(opener).addEventListener('click', () => { if (dialog === 'motion-notebook-dialog') paintNotebook(); $(dialog).showModal(); });
    $(closer).addEventListener('click', () => $(dialog).close());
    $(dialog).addEventListener('close', () => $(opener).focus({ preventScroll: true }));
    $(dialog).addEventListener('click', event => { if (event.target !== $(dialog)) return; const box = $(dialog).getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) $(dialog).close(); });
  }
  $('motion-clear-notebook').addEventListener('click', () => {
    viewed.clear(); try { localStorage.removeItem(storageKey); } catch (_) { /* Optional storage. */ }
    paintNotebook(); announce('已清空本机浏览记录。');
  });
  $('motion-question-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!$('motion-question').value.trim()) { $('motion-question').focus(); return; }
    const point = scene[selected];
    $('motion-answer').textContent = '本地样板 · 尚未调用 AI。关于' + point.title + '，可以先这样看：' + point.answer;
    $('motion-answer').hidden = false;
  });
  function visibility() {
    root.dataset.paused = String(document.hidden);
    if (!document.hidden && !reduced && !ambient.size) drift();
    for (const animation of [...animations, ...ambient]) { if (document.hidden) animation.pause(); else if (!reduced) animation.play(); }
  }
  function preference() { reduced = motionPreference.matches; root.dataset.reduced = String(reduced); cancel(animations); drift(); }
  motionPreference.addEventListener('change', preference);
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('resize', cameraUpdate);
  window.addEventListener('pagehide', () => { cancel(animations); cancel(ambient); });
  window.addEventListener('pageshow', event => { if (event.persisted) { drift(); visibility(); } });
  for (const img of document.images) {
    const missing = () => { img.style.visibility = 'hidden'; root.dataset.artwork = 'partial'; announce('部分插画尚未加载，可以继续通过景物名称查看内容。'); };
    img.addEventListener('error', missing);
    img.addEventListener('load', () => { img.style.visibility = ''; });
    if (img.complete && !img.naturalWidth) missing();
  }
  if (window.lucide) window.lucide.createIcons();
  preference(); cameraUpdate(); select('tower', false, false); opening(); visibility();
  root.dataset.phase = 'ready';
}());
