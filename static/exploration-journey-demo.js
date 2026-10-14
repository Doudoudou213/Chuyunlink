(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const model = window.ChuJourneyState, scene = window.ChuMotionScene;
  const anchors = { tower:[17,41], copper:[36,46], baiyun:[54,48], pond:[48,83] };
  const shell = document.querySelector('.journey-shell');
  const art = $('journey-art'), stage = $('journey-stage'), canvas = $('journey-light');
  let state = null, renderer = null, requestId = 0, storageOK = true, leaving = false;
  let drag = null, suppressedUntil = 0, invalidSaved = false;
  try {
    const saved = localStorage.getItem(model.KEY);
    try { state = model.restore(JSON.parse(saved || 'null')); invalidSaved = Boolean(saved && !state); }
    catch (_) { invalidSaved = true; }
  } catch (_) { storageOK = false; }
  function message(text) { $('journey-status').textContent = text; }
  function save() {
    try { if (state) localStorage.setItem(model.KEY, JSON.stringify(state)); else localStorage.removeItem(model.KEY); }
    catch (_) { storageOK = false; }
    if (!storageOK) message('浏览器不允许保存，本次仍可体验；关闭页面后进度可能丢失。');
  }
  function stopLight() { requestId++; renderer?.destroy(); renderer = null; canvas.hidden = true; }
  function center(id) {
    const rect = window.ChuParkGildedProfiles?.[id]?.sourceRect;
    const world = $('journey-world');
    if (!rect) return;
    const x = (rect.x+rect.width/2)/1919 * world.clientWidth;
    const y = (rect.y+rect.height/2)/820 * world.clientHeight;
    stage.scrollTo({ left: Math.max(0,x-stage.clientWidth/2), top: Math.max(0,y-stage.clientHeight/2), behavior: 'instant' });
  }
  async function illuminate(id) {
    stopLight(); const request = requestId;
    const profile = window.ChuParkGildedProfiles?.[id];
    if (!profile || !window.ChuGildedReveal) return;
    try {
      await art.decode();
      if (leaving || request !== requestId || state?.phase !== 'active') return;
      const rect = profile.sourceRect, pad = window.ChuGildedReveal.lightPadding;
      Object.assign(canvas.style, { left:(rect.x-pad)/1919*100+'%', top:(rect.y-pad)/820*100+'%', width:(rect.width+pad*2)/1919*100+'%', height:(rect.height+pad*2)/820*100+'%' });
      renderer = window.ChuGildedReveal.create({ canvas, image:art, profile, mode:'light-only', quality:'compact' });
      canvas.hidden = false; renderer.play();
    } catch (_) { if (request === requestId) { canvas.hidden = true; $('art-error').hidden = false; } }
  }
  function button(text, handler, attributes = {}) {
    const node = document.createElement('button'); node.type = 'button'; node.textContent = text;
    for (const [key,value] of Object.entries(attributes)) node.setAttribute(key,value);
    node.addEventListener('click',handler); return node;
  }
  function act(action, payload) { if (!state) return; state = model.transition(state,action,payload); save(); render(true); }
  function drawPoints() {
    const stops = state ? model.routes[state.route].stops : model.routes.first.stops;
    $('journey-points').replaceChildren();
    for (const id of stops) {
      const active = state?.phase === 'active';
      const point = button(scene[id].title, event => { if (!event.detail || performance.now() >= suppressedUntil) act('select',id); }, { 'aria-label':'在画中阅读'+scene[id].title, 'aria-pressed':String(active && stops[state.index] === id), 'data-journey-point':id });
      point.className = 'journey-point'; point.disabled = !active;
      point.style.left = anchors[id][0]+'%'; point.style.top = anchors[id][1]+'%';
      $('journey-points').append(point);
    }
  }
  function updateSouvenir() {
    const route = model.routes[state.route];
    $('souvenir-route').textContent = route.title;
    $('souvenir-count').textContent = state.observed.length ? '这一卷，主动记下了 '+state.observed.length+' / '+route.stops.length+' 处画中观察。' : '这一卷还没有记下景物，可以继续补看。';
    $('souvenir-stops').replaceChildren();
    for (const id of route.stops.filter(id => state.observed.includes(id))) {
      const item = document.createElement('li'); item.textContent = scene[id].title; $('souvenir-stops').append(item);
    }
    $('souvenir-note').textContent = state.note;
  }
  function render(focus) {
    const phase = state?.phase || 'welcome'; shell.dataset.phase = phase;
    for (const key of ['welcome','active','paused','finished']) $(key+'-panel').hidden = key !== phase;
    $('journey-reset').hidden = !state; drawPoints();
    if (phase !== 'active') stopLight();
    if (phase === 'active') {
      const route = model.routes[state.route], id = route.stops[state.index], place = scene[id];
      $('journey-position').textContent = route.title+' / 第 '+(state.index+1)+' 景，共 '+route.stops.length+' 景';
      $('journey-title').textContent = place.title;
      $('journey-observation').textContent = place.observation;
      $('journey-story').textContent = place.story;
      $('reading-details').open = false;
      $('journey-stops').replaceChildren();
      for (const stop of route.stops) $('journey-stops').append(button(scene[stop].title, () => act('select',stop), {
        'aria-current':stop === id ? 'step' : 'false', 'data-recorded':String(state.observed.includes(stop)), 'data-stop':stop
      }));
      $('journey-previous').disabled = state.index === 0;
      $('journey-observe').textContent = state.index === route.stops.length-1 ? '记下这一景，收卷 →' : '记下这一景，继续 →';
      center(id); illuminate(id);
    } else if (phase === 'paused') {
      $('paused-copy').textContent = '上次看到「'+scene[model.routes[state.route].stops[state.index]].title+'」。已记下 '+state.observed.length+' 处画中观察。';
    } else if (phase === 'finished') {
      updateSouvenir(); $('journey-note').value = state.note;
    } else center('tower');
    if (!storageOK) message('浏览器不允许保存，本次仍可体验；关闭页面后进度可能丢失。');
    if (focus) $(phase === 'active' ? 'journey-title' : phase+'-title').focus({ preventScroll:true });
  }
  $('journey-start').addEventListener('click', () => {
    message('');
    state = model.create(document.querySelector('[name=journey-route]:checked').value); save(); render(true);
  });
  for (const [id,action] of [['journey-pause','pause'],['journey-resume','resume'],['journey-previous','previous'],['journey-observe','observe'],['journey-finish','finish'],['journey-review','review']]) $(id).addEventListener('click', () => act(action));
  $('journey-reset').addEventListener('click', () => {
    if (!window.confirm('清除这台浏览器里的本次体验进度和手记，重新选卷？已经下载的游记不会删除。')) return;
    state = null; save(); message('已清除本机体验记录。'); render(true);
  });
  $('journey-note').addEventListener('input', event => {
    if (!state || state.phase !== 'finished') return;
    state = model.transition(state,'note',event.target.value); save(); updateSouvenir();
  });
  $('journey-save').addEventListener('click', () => {
    if (!state || state.phase !== 'finished') return;
    const route = model.routes[state.route];
    const text = ['我的黄鹤楼一卷',route.title,'画中观察：'+route.stops.filter(id => state.observed.includes(id)).map(id => scene[id].title).join('、'),state.note,'本地读画体验纪念，非实地到访或任务凭证。'].join('\n\n');
    const url = URL.createObjectURL(new Blob(['\ufeff'+text],{type:'text/plain;charset=utf-8'}));
    const link = document.createElement('a'); link.href = url; link.download = '我的黄鹤楼一卷.txt';
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url),1000);
    message('游记文字已交给浏览器下载；可用“打印这一卷”保存画卷PDF。');
  });
  $('journey-print').addEventListener('click', () => window.print());
  art.addEventListener('error', () => { $('art-error').hidden = false; });
  if (art.complete && !art.naturalWidth) $('art-error').hidden = false;
  stage.addEventListener('pointerdown', event => {
    if (event.pointerType === 'touch' || event.button !== 0) return;
    drag = { id:event.pointerId, x:event.clientX, y:event.clientY, left:stage.scrollLeft, top:stage.scrollTop, moved:false };
  });
  stage.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX-drag.x, dy = event.clientY-drag.y;
    if (!drag.moved && Math.hypot(dx,dy)<5) return;
    if (!drag.moved) { drag.moved = true; stage.setPointerCapture(event.pointerId); stage.classList.add('dragging'); }
    stage.scrollLeft = drag.left-dx; stage.scrollTop = drag.top-dy; event.preventDefault();
  });
  function endDrag() { if (drag?.moved) suppressedUntil = performance.now()+350; drag = null; stage.classList.remove('dragging'); }
  for (const name of ['pointerup','pointercancel','lostpointercapture']) stage.addEventListener(name,endDrag);
  stage.addEventListener('keydown', event => {
    if (event.target !== stage) return;
    const moves = {ArrowLeft:[-80,0],ArrowRight:[80,0],ArrowUp:[0,-80],ArrowDown:[0,80]};
    if (moves[event.key]) { event.preventDefault(); stage.scrollBy(...moves[event.key]); }
  });
  window.addEventListener('pagehide', () => { leaving = true; stopLight(); });
  window.addEventListener('pageshow', event => { if (event.persisted) { leaving = false; render(false); } });
  render(false);
  if (invalidSaved) message('旧的体验记录已过期或无法读取，请重新选卷；不会影响其他页面的记录。');
})();
