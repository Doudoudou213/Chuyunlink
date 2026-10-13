(function (global) {
  'use strict';

  // These contours were traced against hhl-tower-v1 (1024 × 1536). They describe
  // the painting's roof edges, not surveyed architecture or geographic data.
  const W = 1024;
  const H = 1536;
  const DURATION = 6.4;
  const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
  const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
  const contours = [
    { start: .12, duration: .85, points: [[509,34],[506,60],[501,76],[512,86],[529,109],[526,128],[517,138],[533,157],[529,175],[514,185],[542,194]] },
    { start: .4, duration: 1.2, points: [[354,234],[349,253],[362,273],[385,273],[430,245],[473,211],[538,209],[582,249],[618,275],[641,263],[646,239]] },
    { start: .64, duration: 1.55, points: [[253,258],[250,286],[272,317],[315,337],[382,348],[485,351],[584,350],[657,337],[704,311],[723,277],[723,257]] },
    { start: .92, duration: 1.1, points: [[722,291],[733,323],[754,344],[784,351],[811,340],[830,314],[835,292]] },
    { start: 1.12, duration: 1.4, points: [[176,349],[171,380],[189,408],[232,433],[300,449],[405,454],[517,455],[593,445],[646,420],[676,384]] },
    { start: 1.35, duration: 1.2, points: [[643,382],[684,408],[720,416],[744,403],[754,385],[759,423],[790,451],[832,463],[872,447],[891,422],[892,401]] },
    { start: 1.62, duration: 1.35, points: [[223,536],[218,560],[242,590],[302,613],[392,624],[514,627],[604,620],[627,596],[634,580]] },
    { start: 1.85, duration: 1.28, points: [[146,526],[141,555],[163,587],[202,610],[232,616],[272,638],[388,645],[544,646],[645,640],[733,623],[773,594],[783,545]] },
    { start: 2.02, duration: 1.1, points: [[784,565],[794,606],[823,636],[856,642],[886,624],[905,592],[907,551]] },
    { start: 2.24, duration: 1.55, points: [[213,722],[209,748],[234,780],[299,801],[400,812],[526,814],[610,804],[641,773],[651,749]] },
    { start: 2.4, duration: 1.45, points: [[141,711],[135,741],[157,775],[199,799],[232,805],[282,827],[441,835],[587,833],[705,819],[765,790],[785,741]] },
    { start: 2.65, duration: 1.1, points: [[786,761],[802,803],[835,827],[868,826],[899,802],[916,769],[916,737]] },
    { start: 2.82, duration: 1.5, points: [[209,918],[204,946],[231,980],[303,1001],[408,1010],[539,1012],[615,999],[643,968],[650,940]] },
    { start: 3.04, duration: 1.65, points: [[127,897],[121,932],[143,969],[186,994],[223,1002],[281,1020],[448,1027],[588,1023],[719,1008],[781,979],[798,932]] },
    { start: 3.2, duration: 1.2, points: [[798,944],[809,979],[835,1001],[862,1002],[882,982],[883,944],[891,971],[911,989],[933,979],[951,951],[956,932]] },
    { start: 3.36, duration: .9, points: [[300,483],[302,552],[390,559],[392,494]] },
    { start: 3.48, duration: .85, points: [[682,494],[681,568],[583,575],[583,500]] },
    { start: 3.55, duration: 1.1, points: [[265,855],[268,938],[393,954],[393,859]] },
    { start: 3.7, duration: 1, points: [[727,851],[728,954],[582,962],[583,858]] },
    { start: 3.85, duration: 1.1, points: [[205,1073],[204,1199],[274,1207],[274,1072]] },
    { start: 4, duration: 1.05, points: [[784,1071],[785,1200],[859,1187],[859,1079]] },
    { start: 4.15, duration: 1.15, points: [[70,1194],[191,1214],[309,1263],[335,1306],[529,1328],[646,1335],[814,1343],[968,1299]] },
    { start: 4.32, duration: 1.1, points: [[330,1270],[261,1390],[207,1413],[442,1440],[491,1320],[527,1252]] }
  ];

  // Catmull–Rom interpolation keeps each measured corner while following the
  // painted, gently bent roof edges. Arc lengths give a steady moving brush tip.
  function prepareContour(contour) {
    const samples = [];
    const points = contour.points;
    let length = 0;
    for (let index = 0; index < points.length - 1; index += 1) {
      const p0 = points[Math.max(0, index - 1)];
      const p1 = points[index];
      const p2 = points[index + 1];
      const p3 = points[Math.min(points.length - 1, index + 2)];
      for (let step = 0; step < 14; step += 1) {
        const t = step / 14; const t2 = t * t; const t3 = t2 * t;
        const x = .5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2*p0[0] - 5*p1[0] + 4*p2[0] - p3[0])*t2 + (-p0[0] + 3*p1[0] - 3*p2[0] + p3[0])*t3);
        const y = .5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2*p0[1] - 5*p1[1] + 4*p2[1] - p3[1])*t2 + (-p0[1] + 3*p1[1] - 3*p2[1] + p3[1])*t3);
        const previous = samples[samples.length - 1];
        if (previous) length += Math.hypot(x - previous.x, y - previous.y);
        samples.push({ x, y, length });
      }
    }
    const last = points[points.length - 1];
    const previous = samples[samples.length - 1];
    length += Math.hypot(last[0] - previous.x, last[1] - previous.y);
    samples.push({ x: last[0], y: last[1], length });
    return { ...contour, samples, length };
  }
  const towerPaths = contours.map(prepareContour);

  function makeCanvas(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    return canvas;
  }

  function create(options) {
    const { canvas, image, onComplete } = options || {};
    if (!canvas || !image || typeof canvas.getContext !== 'function') {
      throw new TypeError('A canvas and decoded landmark image are required.');
    }
    const requestedProfile = typeof options.profile === 'string'
      ? global.ChuGildedProfiles && global.ChuGildedProfiles[options.profile]
      : options.profile;
    if (options.profile && !requestedProfile) throw new TypeError('Unknown landmark motion profile.');
    const profile = requestedProfile || {};
    const sourceWidth = Number(profile.width) || W;
    const sourceHeight = Number(profile.height) || H;
    const duration = Number(profile.duration) || DURATION;
    if (!(sourceWidth > 0 && sourceHeight > 0 && duration > 0)) throw new TypeError('Invalid landmark motion dimensions.');
    const profileId = profile.id || 'tower';
    const paths = profile.contours ? profile.contours.map(prepareContour) : towerPaths;
    const paintProfile = profile.paint || { kind: 'tower' };
    const baseOpacity = clamp(Number(profile.baseOpacity) || 0);
    const brushScale = clamp(Number(profile.brushScale) || 1,.02,5);
    const width = Math.round(clamp(Number(options.width) || (options.quality === 'compact' ? 384 : sourceWidth), Math.min(192,sourceWidth), sourceWidth));
    const height = Math.round(width * sourceHeight / sourceWidth);
    canvas.width = width; canvas.height = height;
    canvas.dataset.profile = profileId;
    const context = canvas.getContext('2d', { alpha: true });
    // Decode/crop only once, at the correct aspect ratio. Every frame is drawn
    // at this same registration; no landmark is enlarged or shifted to appear.
    const source = makeCanvas(width, height);
    const sourceContext = source.getContext('2d', { alpha: true });
    function drawOriginal(target) {
      if (profile.sourceRect) {
        const rect = profile.sourceRect;
        target.drawImage(image,rect.x,rect.y,rect.width,rect.height,0,0,width,height);
      } else target.drawImage(image,0,0,width,height);
    }
    drawOriginal(sourceContext);
    const underpainting = baseOpacity ? makeCanvas(width,height) : null;
    if (underpainting) {
      const underContext = underpainting.getContext('2d', { alpha: true });
      underContext.globalAlpha = baseOpacity;
      underContext.filter = 'grayscale(1) sepia(.3) brightness(.82)';
      underContext.drawImage(source,0,0);
    }
    const paint = makeCanvas(width, height);
    const paintContext = paint.getContext('2d', { alpha: true });
    const maskWidth = options.quality === 'compact' ? 160 : 320;
    const maskHeight = Math.round(maskWidth * sourceHeight / sourceWidth);
    const mask = makeCanvas(maskWidth, maskHeight);
    const maskContext = mask.getContext('2d', { alpha: true });
    const maskData = maskContext.createImageData(maskWidth, maskHeight);
    const arrivals = new Float32Array(maskWidth * maskHeight);
    const grains = new Float32Array(arrivals.length);
    const clipping = Array.isArray(profile.clipPoints) && profile.clipPoints.length > 2 ? makeCanvas(maskWidth,maskHeight) : null;
    const clock = { time: 0 };
    let timeline = null;
    let destroyed = false;
    let userPaused = false;
    let visibilityPaused = document.hidden;
    let completed = false;
    let started = false;
    let lastRendered = -Infinity;
    let phase = 'idle';
    const media = global.matchMedia ? global.matchMedia('(prefers-reduced-motion: reduce)') : null;
    let reduced = Boolean(options.reducedMotion || (media && media.matches));

    // An opaque pond is cut around its actual shoreline and bank silhouette,
    // with an inward feather. It can sit on the ground painting without a
    // rectangular tile, including while the desaturated underpainting is shown.
    if (clipping) {
      const clipContext = clipping.getContext('2d', { alpha: true });
      const clipData = clipContext.createImageData(maskWidth,maskHeight);
      const polygon = profile.clipPoints;
      const feather = Math.max(1,Number(paintProfile.feather) || 28);
      for (let y = 0; y < maskHeight; y += 1) {
        const py = (y+.5) / maskHeight * sourceHeight;
        for (let x = 0; x < maskWidth; x += 1) {
          const px = (x+.5) / maskWidth * sourceWidth;
          let inside = false; let distance = Infinity;
          for (let i = 0, j = polygon.length-1; i < polygon.length; j = i++) {
            const a = polygon[j]; const b = polygon[i];
            if ((a[1] > py) !== (b[1] > py) && px < (b[0]-a[0])*(py-a[1])/(b[1]-a[1])+a[0]) inside = !inside;
            const dx = b[0]-a[0]; const dy = b[1]-a[1];
            const t = clamp(((px-a[0])*dx+(py-a[1])*dy)/Math.max(.001,dx*dx+dy*dy));
            distance = Math.min(distance,Math.hypot(px-a[0]-t*dx,py-a[1]-t*dy));
          }
          const offset = (y*maskWidth+x)*4;
          clipData.data[offset] = 255; clipData.data[offset+1] = 255; clipData.data[offset+2] = 255;
          clipData.data[offset+3] = inside ? Math.round(smooth(distance/feather)*255) : 0;
        }
      }
      clipContext.putImageData(clipData,0,0);
    }

    // Each floor has its own alternating brush direction. A deterministic
    // multi-frequency boundary lets pigment arrive in uneven fine washes; it
    // does not enlarge the building or reveal a rectangular/circular image tile.
    for (let y = 0; y < maskHeight; y += 1) {
      const py = y / maskHeight * sourceHeight;
      const band = py < 352 ? 0 : py < 488 ? 1 : py < 675 ? 2 : py < 857 ? 3 : py < 1061 ? 4 : 5;
      const starts = [.95,1.6,2.15,2.72,3.28,3.88];
      for (let x = 0; x < maskWidth; x += 1) {
        const px = x / maskWidth;
        const direction = band % 2 ? 1 - px : px;
        const broad = Math.sin(x * .097 + Math.sin(y*.12)*1.4) * .12 + Math.cos(y*.08 + x*.046)*.11;
        const fibre = Math.sin(x*.79+y*.23)*Math.cos(y*.67-x*.15)*.042;
        const index = y*maskWidth + x;
        let arrival = starts[band] + direction * .91;
        if (paintProfile.kind === 'bands' && Array.isArray(paintProfile.bands) && paintProfile.bands.length) {
          const row = paintProfile.bands.find(item => py <= item.to) || paintProfile.bands[paintProfile.bands.length-1];
          const sweep = row.direction === 'reverse' ? 1-px : px;
          arrival = (Number(row.start)||0) + sweep * (Number(row.duration)||.91);
        } else if (paintProfile.kind === 'vertical') {
          arrival = (Number(paintProfile.start)||.8) + py/sourceHeight * (Number(paintProfile.duration)||3.6) + direction*.3;
        } else if (paintProfile.kind === 'water') {
          const origin = paintProfile.origin || [sourceWidth*.38,sourceHeight*.45];
          const dx = (px*sourceWidth-origin[0])/sourceWidth;
          const dy = (py-origin[1])/sourceHeight;
          const waterTravel = Math.min(1,Math.hypot(dx,dy)*1.08);
          arrival = (Number(paintProfile.start)||.8) + waterTravel * (Number(paintProfile.duration)||3.6) + Math.sin(py*.032)*.12;
        }
        arrivals[index] = arrival + broad + fibre;
        grains[index] = .81 + .19 * (.5 + .5 * Math.sin(x*9.37+y*17.41));
        maskData.data[index*4] = 255;
        maskData.data[index*4+1] = 255;
        maskData.data[index*4+2] = 255;
      }
    }

    function publishState() {
      canvas.dataset.phase = phase;
      canvas.dataset.progress = String(Math.round(clamp(clock.time / duration) * 1000) / 1000);
      canvas.dataset.paused = String(userPaused || visibilityPaused);
    }

    function drawSegment(path, from, to, color, lineWidth, opacity) {
      if (opacity <= .001 || to <= from) return null;
      const startLength = from * path.length;
      const endLength = to * path.length;
      let drawing = false;
      let head = path.samples[0];
      context.beginPath();
      for (let index = 1; index < path.samples.length; index += 1) {
        const point = path.samples[index];
        const previous = path.samples[index - 1];
        if (point.length < startLength) continue;
        if (!drawing) {
          const mix = clamp((startLength - previous.length) / Math.max(.001, point.length - previous.length));
          context.moveTo(previous.x+(point.x-previous.x)*mix, previous.y+(point.y-previous.y)*mix);
          drawing = true;
        }
        if (point.length > endLength) {
          const mix = clamp((endLength - previous.length) / Math.max(.001, point.length - previous.length));
          head = { x: previous.x+(point.x-previous.x)*mix, y: previous.y+(point.y-previous.y)*mix };
          context.lineTo(head.x, head.y); break;
        }
        head = point; context.lineTo(point.x, point.y);
      }
      context.globalAlpha = opacity;
      context.strokeStyle = color; context.lineWidth = lineWidth * brushScale; context.stroke();
      return head;
    }

    function render(force = false) {
      if (destroyed) return;
      const time = clock.time;
      if (!force && Math.abs(time - lastRendered) < 1/32 && time < duration) return;
      lastRendered = time;
      const normalizedTime = time / duration * DURATION;
      phase = time >= duration ? 'settled' : normalizedTime < .35 ? 'linework' : normalizedTime < 1.25 ? 'gold' : normalizedTime < 5.45 ? 'wash' : 'settling';
      context.setTransform(1,0,0,1,0,0);
      context.globalAlpha = 1;
      context.globalCompositeOperation = 'source-over';
      context.clearRect(0,0,width,height);
      if (time >= duration || reduced) {
        drawOriginal(context);
        applyClip();
        publishState(); return;
      }

      // The source image stays pixel registered for the whole sequence. Only
      // pigment opacity changes; source alpha also removes all background tiles.
      const finalWet = smooth((normalizedTime - 4.95) / .92);
      for (let index = 0; index < arrivals.length; index += 1) {
        const age = time - arrivals[index];
        const underwash = smooth(age / .56) * .24;
        const pigment = smooth((age-.17) / .84) * .76 * grains[index];
        const dry = smooth((age-.58) / .66) * .16;
        maskData.data[index*4+3] = Math.round(255 * Math.max(finalWet, clamp(underwash + pigment + dry)));
      }
      maskContext.putImageData(maskData,0,0);
      paintContext.clearRect(0,0,width,height);
      paintContext.globalCompositeOperation = 'source-over';
      paintContext.drawImage(source,0,0);
      paintContext.globalCompositeOperation = 'destination-in';
      paintContext.drawImage(mask,0,0,width,height);
      paintContext.globalCompositeOperation = 'source-over';
      if (underpainting) context.drawImage(underpainting,0,0);
      context.drawImage(paint,0,0);

      context.setTransform(width/sourceWidth,0,0,height/sourceHeight,0,0);
      context.lineCap = 'round'; context.lineJoin = 'round';
      const settle = 1 - smooth((normalizedTime - 4.85) / 1.5);
      for (const path of paths) {
        drawSegment(path,0,1,'#c69a50',1.45,.18 * (1-smooth(normalizedTime/5.9)));
        const progress = clamp((time-path.start)/path.duration);
        if (!progress) continue;
        drawSegment(path,0,progress,'#e5af54',2.2,.5 * settle);
        if (progress >= 1) continue;
        // A soft narrow trail and a small bright nib follow the eaves. No
        // shadowBlur per frame: the glow uses a bounded radial gradient.
        drawSegment(path,Math.max(0,progress-.16),progress,'#d8902e',10,.14);
        const head = drawSegment(path,Math.max(0,progress-.065),progress,'#fff0b5',3.4,.96);
        if (!head) continue;
        const glowRadius = 24 * brushScale;
        const glow = context.createRadialGradient(head.x,head.y,0,head.x,head.y,glowRadius);
        glow.addColorStop(0,'rgba(255,246,206,.87)');
        glow.addColorStop(.17,'rgba(255,210,120,.6)');
        glow.addColorStop(.6,'rgba(227,150,41,.15)');
        glow.addColorStop(1,'rgba(227,150,41,0)');
        context.globalAlpha = .9; context.fillStyle = glow;
        context.fillRect(head.x-glowRadius,head.y-glowRadius,glowRadius*2,glowRadius*2);
        context.globalAlpha = .9; context.fillStyle = '#fff2c1';
        context.beginPath(); context.arc(head.x,head.y,2*brushScale,0,Math.PI*2); context.fill();
      }
      context.globalAlpha = 1;
      context.setTransform(1,0,0,1,0,0);
      applyClip();
      publishState();
    }

    function applyClip() {
      if (!clipping) return;
      context.globalCompositeOperation = 'destination-in';
      context.drawImage(clipping,0,0,width,height);
      context.globalCompositeOperation = 'source-over';
    }

    function complete() {
      if (destroyed || completed) return;
      completed = true; clock.time = duration; render(true);
      if (typeof onComplete === 'function') onComplete();
    }

    function finish() {
      if (destroyed) return;
      if (timeline) timeline.pause();
      complete();
    }

    function play() {
      if (destroyed) return;
      if (timeline) { timeline.kill(); timeline = null; }
      clock.time = 0; completed = false; started = true; userPaused = false;
      visibilityPaused = document.hidden;
      lastRendered = -Infinity; render(true);
      if (reduced || !global.gsap || typeof global.gsap.timeline !== 'function') { finish(); return; }
      timeline = global.gsap.timeline({ paused: true, onUpdate: () => render(), onComplete: complete });
      timeline.addLabel('linework',0).addLabel('gildedEaves',duration*.35/DURATION).addLabel('pigment',duration*1.25/DURATION).addLabel('settle',duration*5.45/DURATION);
      timeline.to(clock,{time:duration,duration,ease:'none'},0);
      if (!visibilityPaused) timeline.play(0);
      publishState();
    }

    function pause() { if (destroyed) return; userPaused = true; if (timeline) timeline.pause(); publishState(); }
    function resume() {
      if (destroyed) return;
      userPaused = false;
      if (timeline && !visibilityPaused && !completed) timeline.resume();
      publishState();
    }
    function seek(seconds) {
      if (destroyed) return;
      const target = clamp(Number(seconds)||0,0,duration);
      if (timeline) timeline.pause().time(target, true);
      clock.time = target; completed = target >= duration; userPaused = true;
      render(true);
    }
    function onVisibility() {
      visibilityPaused = document.hidden;
      if (timeline) {
        if (visibilityPaused) timeline.pause();
        else if (!userPaused && !completed) timeline.resume();
      }
      publishState();
    }
    function onMotionPreference(event) {
      reduced = Boolean(options.reducedMotion || event.matches);
      if (reduced && started) finish();
    }
    document.addEventListener('visibilitychange',onVisibility);
    if (media && media.addEventListener) media.addEventListener('change',onMotionPreference);
    render(true);

    return Object.freeze({
      play, pause, resume, finish, seek,
      getState: () => ({phase,progress:clamp(clock.time/duration),paused:userPaused||visibilityPaused,complete:completed,duration,reducedMotion:reduced,destroyed,width,height,profile:profileId}),
      destroy() {
        if (destroyed) return;
        destroyed = true; phase = 'destroyed';
        if (timeline) { timeline.kill(); timeline = null; }
        document.removeEventListener('visibilitychange',onVisibility);
        if (media && media.removeEventListener) media.removeEventListener('change',onMotionPreference);
        paint.width = 0; paint.height = 0; mask.width = 0; mask.height = 0;
        source.width = 0; source.height = 0;
        if (underpainting) { underpainting.width = 0; underpainting.height = 0; }
        if (clipping) { clipping.width = 0; clipping.height = 0; }
        canvas.dataset.phase = 'destroyed';
      }
    });
  }

  global.ChuGildedReveal = Object.freeze({ create, duration:DURATION, assetSize:Object.freeze({width:W,height:H}) });
})(window);
