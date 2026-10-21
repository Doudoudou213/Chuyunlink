(function (root) {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const artwork = 'static/assets/exploration-motion/hhl-full-park-v2.webp';
  function create(host, hooks = {}) {
    if (!host) return null;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)');
    let revision = 0, active = null;
    function stop() {
      if (!active) return;
      active.motion.forEach(tween => tween.kill());active.motion = [];
      active.group.style.removeProperty('will-change');
    }
    function syncControls(item) {
      const unavailable = item.pending || (!item.loaded && !item.failed);
      item.button.disabled = unavailable;
      for (const button of item.lookButtons) button.disabled = item.pending || !item.loaded;
      item.keep.disabled = item.pending || !item.loaded || !item.looks[item.look] || item.recorded.has(item.looks[item.look]?.key);
      item.choices.hidden = !item.closer || !item.loaded || !item.looks.length;
      item.keepRow.hidden = !item.closer || !item.loaded || !item.looks.length || typeof hooks.onObservation !== 'function';
      const recorded = item.recorded.has(item.looks[item.look]?.key);
      item.keep.textContent = recorded ? '已留在游记' : '记下这处细节';
      item.keep.setAttribute('aria-label', (recorded ? '已留在游记：' : '记下原画细节：') + (item.looks[item.look]?.label || item.scene.action));
      for (const [index,button] of item.lookButtons.entries()) button.setAttribute('aria-pressed',String(index===item.look));
    }
    function paint(animated = false) {
      if (!active) return;
      stop();
      const item = active, closer = item.closer, scene = item.scene;
      syncControls(item);
      if (item.failed) {
        item.caption.textContent = '原画暂未载入，下面的文字仍可阅读。';
        item.button.textContent = '重新加载原画';
        item.button.setAttribute('aria-label','重新加载'+scene.label+'原画');
        item.button.setAttribute('aria-pressed','false');
        return;
      }
      const look = item.looks[item.look], focus = closer && look ? look : scene;
      const pose = {scale:closer ? focus.scale : 1, x:closer ? focus.shift[0] : 0, y:closer ? focus.shift[1] : 0, svgOrigin:focus.origin.join(' ')};
      const opacity = closer ? .65 : 0;
      [...item.lines.children].forEach((line,index) => {line.style.opacity = !closer || !look || look.contours.includes(scene.contours[index]) ? '1' : '.16';});
      if (root.gsap && animated && !reduce.matches) {
        item.group.style.willChange = 'transform';
        item.motion.push(root.gsap.to(item.group, {...pose,duration:1.1,ease:'power2.inOut',overwrite:true,
          onComplete:() => {if(active === item)item.group.style.removeProperty('will-change');}}));
        item.motion.push(root.gsap.to(item.lines,{opacity,duration:.8,ease:'sine.inOut',overwrite:true}));
      } else if (root.gsap) {
        root.gsap.set(item.group,pose);root.gsap.set(item.lines,{opacity});
      } else {
        const s = pose.scale;
        item.group.setAttribute('transform',`matrix(${s} 0 0 ${s} ${focus.origin[0]*(1-s)+pose.x} ${focus.origin[1]*(1-s)+pose.y})`);
        item.lines.style.opacity = String(opacity);
      }
      item.button.textContent = closer ? '回看整景 ↙' : scene.action+' ↗';
      item.button.setAttribute('aria-pressed',String(closer));
      item.button.setAttribute('aria-label',closer ? '回看'+scene.label+'整景' : scene.action+'，'+scene.label+'原画局部');
      host.dataset.detail = closer ? (look?.key || scene.detail) : 'whole';
      item.caption.textContent = closer ? (look?.caption || scene.closer) : scene.whole;
    }
    function reset() {
      revision++;
      if (!active) return;
      active.closer = false;active.look = 0;active.pending = false;
      active.button.disabled = !active.loaded && !active.failed;
      active.button.removeAttribute('aria-busy');paint();
    }
    function clear() {
      revision++;stop();
      if (active) {clearTimeout(active.timer);active.probe.onload = null;active.probe.onerror = null;}
      active = null;host.replaceChildren();host.hidden = true;
      delete host.dataset.detail;delete host.dataset.scene;delete host.dataset.artState;
    }
    function canInteract(item) {
      if (active !== item || (!item.loaded && !item.failed) || document.hidden || host.closest('[hidden]') || !host.getClientRects().length) return false;
      const dialog = host.closest('dialog');
      return !dialog || (dialog.open && dialog.dataset.state !== 'closing' && dialog.getAttribute('aria-busy') === 'false');
    }
    function setRecorded(details = []) {
      if (!active) return;
      active.recorded = new Set((Array.isArray(details) ? details : []).filter(item =>
        item?.pointId === active.pointId && item?.sceneId === active.id && active.looks.some(look => look.key === item.detailKey)).map(item => item.detailKey));
      syncControls(active);
    }
    async function verified(item, action) {
      if (item.pending || !canInteract(item)) return;
      const ticket = ++revision;
      item.pending = true;syncControls(item);item.button.setAttribute('aria-busy','true');
      try {
        const allowed = await hooks.verify?.();
        if (allowed !== true || ticket !== revision || !canInteract(item)) return;
        await action(() => ticket === revision && canInteract(item));
      } catch { /* Existing controller owns source withdrawal and retry UI. */ }
      finally {
        if (active === item && ticket === revision) {
          item.pending = false;syncControls(item);
          if (item.loaded || item.failed) item.button.removeAttribute('aria-busy');
        }
      }
    }
    function mount(point, enabled = false, recordedDetails = []) {
      clear();
      // A reviewed explicit original-art binding is required. Names and point IDs
      // must never be used to guess that a different building is this illustration.
      const id = point?.artScene, scene = root.ChuJourneyStudyScenes?.[id], profile = root.ChuParkGildedProfiles?.[id];
      if (!enabled || !scene || !profile || !['x','y','width','height'].every((key,i)=>profile.sourceRect?.[key]===scene.rect[i])) return;
      if (!scene.contours.every(i => Array.isArray(profile.contours?.[i]?.points))) return;
      // A look is a registered crop/contour selection, never a new statement
      // about the physical building. Invalid configuration disables this layer.
      const looks = Array.isArray(scene.looks) && scene.looks.length === 2 && scene.looks.every(look =>
        /^[a-z][a-z0-9-]{0,39}$/.test(look.key) && typeof look.label === 'string' && typeof look.caption === 'string' &&
        Number.isFinite(look.scale) && look.scale >= 1 && look.scale <= 2.5 &&
        Array.isArray(look.origin) && look.origin.length === 2 && look.origin.every(Number.isFinite) &&
        Array.isArray(look.shift) && look.shift.length === 2 && look.shift.every(Number.isFinite) &&
        Array.isArray(look.contours) && look.contours.length && look.contours.every(index => scene.contours.includes(index))) &&
        new Set(scene.looks.map(look=>look.key)).size === 2 ? scene.looks : [];
      const heading = document.createElement('p');heading.className = 'journey-study-heading';heading.textContent = scene.heading;
      const frame = document.createElement('div');frame.className = 'journey-study-frame';
      const svg = document.createElementNS(NS,'svg');svg.setAttribute('viewBox',scene.viewBox.join(' '));
      svg.setAttribute('role','img');svg.setAttribute('aria-label','当前手绘画卷中'+scene.label+'的局部，非实景照片或建筑测绘图');
      const group = document.createElementNS(NS,'g');group.classList.add('journey-study-art');
      const image = document.createElementNS(NS,'image');
      image.setAttribute('href',artwork);image.setAttribute('width','1919');image.setAttribute('height','820');
      const lines = document.createElementNS(NS,'g');lines.classList.add('journey-study-lines');lines.setAttribute('transform',`translate(${scene.rect[0]} ${scene.rect[1]})`);lines.style.opacity = '0';
      // Exact contours from the current painting, not an invented structural model.
      for (const index of scene.contours) {
        const path = document.createElementNS(NS,'path');
        path.setAttribute('d',profile.contours[index].points.map((p,i)=>(i?'L':'M')+p.join(' ')).join(' '));
        path.setAttribute('vector-effect','non-scaling-stroke');lines.append(path);
      }
      group.append(image,lines);svg.append(group);frame.append(svg);
      const controls = document.createElement('div');controls.className = 'journey-study-controls';
      const credit = document.createElement('span');credit.textContent = '原画细看 · 非实景';
      const button = document.createElement('button');button.type = 'button';button.disabled = true;
      button.setAttribute('aria-pressed','false');
      const caption = document.createElement('p');caption.className = 'journey-study-caption';caption.setAttribute('role','status');
      const choices = document.createElement('div');choices.className = 'journey-study-looks';choices.hidden = true;
      choices.setAttribute('role','group');choices.setAttribute('aria-label','选择原画观察细节');
      const lookButtons = looks.map(look => {
        const option = document.createElement('button');option.type = 'button';option.textContent = look.label;
        option.dataset.look = look.key;option.setAttribute('aria-pressed','false');choices.append(option);return option;
      });
      const keepRow = document.createElement('div');keepRow.className = 'journey-study-keep';keepRow.hidden = true;
      const keep = document.createElement('button');keep.type = 'button';keep.textContent = '记下这处细节';
      const boundary = document.createElement('span');boundary.textContent = '原画观察，不记作到访';
      keepRow.append(keep,boundary);
      controls.append(credit,button);host.append(heading,frame,controls,choices,caption,keepRow);host.hidden = false;
      host.dataset.scene = id;
      const item = active = {id,pointId:point.id,scene,group,lines,button,caption,looks,choices,lookButtons,look:0,keepRow,keep,recorded:new Set(),probe:new Image(),timer:null,closer:false,loaded:false,failed:false,pending:false,motion:[]};
      setRecorded(recordedDetails);
      paint();
      function loadArt() {
        clearTimeout(item.timer);item.probe.onload = null;item.probe.onerror = null;
        const probe = item.probe = new Image();
        item.loaded = false;item.failed = false;item.closer = false;item.look = 0;
        button.disabled = true;button.setAttribute('aria-busy','true');
        host.dataset.artState = 'loading';
        let settled = false;
        const valid = () => !settled && active === item && item.probe === probe;
        function failed() {
          if (!valid()) return;
          settled = true;
          clearTimeout(item.timer);probe.onload = null;probe.onerror = null;
          stop();item.loaded = false;item.failed = true;frame.hidden = true;
          host.dataset.artState = 'failed';button.disabled = false;button.removeAttribute('aria-busy');paint();
        }
        probe.onload = () => {
          if (!valid()) return;
          settled = true;
          clearTimeout(item.timer);probe.onload = null;probe.onerror = null;
          item.loaded = true;item.failed = false;frame.hidden = false;
          // Reassign the same authorized illustration, allowing a failed SVG
          // image fetch to recover as well. Never introduce another image URL.
          image.setAttribute('href',artwork);
          host.dataset.artState = 'ready';button.disabled = false;button.removeAttribute('aria-busy');paint();
        };
        probe.onerror = failed;item.timer = setTimeout(failed,10000);probe.src = artwork;
      }
      loadArt();
      button.onclick = () => verified(item, () => {
        if (item.failed) loadArt();
        else {item.closer = !item.closer;item.look = 0;paint(true);}
      });
      lookButtons.forEach((option,index) => {option.onclick = () => {
        if (!item.closer || item.look === index || !item.loaded) return;
        return verified(item, () => {item.look = index;paint(true);});
      };});
      keep.onclick = () => {
        const look = item.looks[item.look];
        if (!item.closer || !item.loaded || !look || item.recorded.has(look.key) || typeof hooks.onObservation !== 'function') return;
        return verified(item, async current => {
          const saved = await hooks.onObservation({pointId:item.pointId,sceneId:item.id,detailKey:look.key});
          if (!current()) return;
          if (saved === true) {
            item.recorded.add(look.key);item.caption.textContent = '已记下「'+look.label+'」，收卷时可以一起带走。';
          } else item.caption.textContent = '暂时没有记下，可以稍后再试。';
          syncControls(item);
        });
      };
    }
    function pause() {revision++;stop();if(active){active.pending=false;syncControls(active);active.button.removeAttribute('aria-busy');}}
    const settle = () => paint(false);
    reduce.addEventListener('change',settle);
    return {mount,setRecorded,reset,pause,clear,destroy(){clear();reduce.removeEventListener('change',settle);}};
  }
  root.ChuJourneyStudy = {create};
})(window);
