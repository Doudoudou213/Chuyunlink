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
    function paint(animated = false) {
      if (!active) return;
      stop();
      const item = active, closer = item.closer;
      if (item.failed) {item.caption.textContent = '原画暂未载入，下面的文字仍可阅读。';return;}
      const pose = {scale:closer ? 1.6 : 1, x:0, y:closer ? 29 : 0, svgOrigin:'455 175'};
      const opacity = closer ? .65 : 0;
      if (root.gsap && animated && !reduce.matches) {
        item.group.style.willChange = 'transform';
        item.motion.push(root.gsap.to(item.group, {...pose,duration:1.1,ease:'power2.inOut',overwrite:true,
          onComplete:() => {if(active === item)item.group.style.removeProperty('will-change');}}));
        item.motion.push(root.gsap.to(item.lines,{opacity,duration:.8,ease:'sine.inOut',overwrite:true}));
      } else if (root.gsap) {
        root.gsap.set(item.group,pose);root.gsap.set(item.lines,{opacity});
      } else {
        const s = pose.scale;
        item.group.setAttribute('transform',`matrix(${s} 0 0 ${s} ${455*(1-s)} ${175*(1-s)+pose.y})`);
        item.lines.style.opacity = String(opacity);
      }
      item.button.textContent = closer ? '回看整景 ↙' : '细看层檐 ↗';
      item.button.setAttribute('aria-pressed',String(closer));
      host.dataset.detail = closer ? 'eaves' : 'whole';
      item.caption.textContent = closer ? '沿着淡金线，留意画中檐角的转折。' : '先看整体，再靠近一处细节。';
    }
    function reset() {
      revision++;
      if (!active) return;
      active.closer = false;active.pending = false;
      active.button.disabled = !active.loaded;
      active.button.removeAttribute('aria-busy');paint();
    }
    function clear() {
      revision++;stop();
      if (active) {active.probe.onload = null;active.probe.onerror = null;}
      active = null;host.replaceChildren();host.hidden = true;
      delete host.dataset.detail;
    }
    function canInteract(item) {
      if (active !== item || !item.loaded || document.hidden || host.closest('[hidden]') || !host.getClientRects().length) return false;
      const dialog = host.closest('dialog');
      return !dialog || (dialog.open && dialog.dataset.state !== 'closing' && dialog.getAttribute('aria-busy') === 'false');
    }
    function mount(point, enabled = false) {
      clear();
      // A reviewed explicit original-art binding is required. Names and point IDs
      // must never be used to guess that a different building is this illustration.
      const profile = root.ChuParkGildedProfiles?.tower;
      if (!enabled || point?.artScene !== 'tower' || !profile || profile.sourceRect?.x !== 360 || profile.sourceRect?.y !== 102 || profile.sourceRect?.width !== 190 || profile.sourceRect?.height !== 236) return;
      if (![3,4,5,8].every(i => Array.isArray(profile.contours?.[i]?.points))) return;
      const heading = document.createElement('p');heading.className = 'journey-study-heading';heading.textContent = '从一处层檐看起';
      const frame = document.createElement('div');frame.className = 'journey-study-frame';
      const svg = document.createElementNS(NS,'svg');svg.setAttribute('viewBox','300 85 310 250');
      svg.setAttribute('role','img');svg.setAttribute('aria-label','当前手绘画卷中主楼的局部，非实景照片或建筑测绘图');
      const group = document.createElementNS(NS,'g');group.classList.add('journey-study-art');
      const image = document.createElementNS(NS,'image');
      image.setAttribute('href',artwork);image.setAttribute('width','1919');image.setAttribute('height','820');
      const lines = document.createElementNS(NS,'g');lines.classList.add('journey-study-lines');lines.setAttribute('transform','translate(360 102)');lines.style.opacity = '0';
      // Exact contours from the current painting, not an invented structural model.
      for (const index of [3,4,5,8]) {
        const path = document.createElementNS(NS,'path');
        path.setAttribute('d',profile.contours[index].points.map((p,i)=>(i?'L':'M')+p.join(' ')).join(' '));
        path.setAttribute('vector-effect','non-scaling-stroke');lines.append(path);
      }
      group.append(image,lines);svg.append(group);frame.append(svg);
      const controls = document.createElement('div');controls.className = 'journey-study-controls';
      const credit = document.createElement('span');credit.textContent = '原画细看 · 非实景';
      const button = document.createElement('button');button.type = 'button';button.disabled = true;
      button.setAttribute('aria-pressed','false');button.setAttribute('aria-label','细看层檐，再次点击回看整景');
      const caption = document.createElement('p');caption.className = 'journey-study-caption';caption.setAttribute('role','status');
      controls.append(credit,button);host.append(heading,frame,controls,caption);host.hidden = false;
      const probe = new Image();
      const item = active = {group,lines,button,caption,probe,closer:false,loaded:false,failed:false,pending:false,motion:[]};
      paint();
      probe.onload = () => {if (active === item) {item.loaded = true;button.disabled = false;}};
      probe.onerror = () => {
        if (active !== item) return;
        revision++;stop();item.loaded = false;item.failed = true;frame.hidden = true;controls.hidden = true;
        caption.textContent = '原画暂未载入，下面的文字仍可阅读。';
      };
      probe.src = artwork;
      button.onclick = async () => {
        if (item.pending || !canInteract(item)) return;
        const ticket = ++revision;item.pending = true;button.disabled = true;button.setAttribute('aria-busy','true');
        try {
          const allowed = await hooks.verify?.();
          if (allowed === false || ticket !== revision || !canInteract(item)) return;
          item.closer = !item.closer;paint(true);
        } catch { /* Existing controller owns source withdrawal and retry UI. */ }
        finally {
          if (active === item && ticket === revision) {item.pending = false;button.disabled = !item.loaded;button.removeAttribute('aria-busy');}
        }
      };
    }
    function pause() {revision++;stop();if(active){active.pending=false;active.button.disabled=!active.loaded;active.button.removeAttribute('aria-busy');}}
    const settle = () => paint(false);
    reduce.addEventListener('change',settle);
    return {mount,reset,pause,clear,destroy(){clear();reduce.removeEventListener('change',settle);}};
  }
  root.ChuJourneyStudy = {create};
})(window);
