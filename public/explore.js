(function () {
  'use strict';

  const AUDIO_SRC = 'https://mynoise.net/NoiseMachines/oceanNoiseGenerator.php?l=00530075380000000000&a=1&am=s&title=Unreal%20Ocean&c=1';
  const path = location.pathname;
  const onExplorePage = path === '/explore' ||
                        path === '/explore.html' ||
                        path.endsWith('/explore.html');

  // ---------- non-explore pages: intercept the [explore system] link ------
  if (!onExplorePage) {
    document.addEventListener('click', (e) => {
      if (e.defaultPrevented) return;
      if (e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const btn = e.target.closest && e.target.closest('[data-explore-link]');
      if (!btn) return;
      e.preventDefault();
      // Open the ocean-noise popup synchronously inside the click gesture so
      // the browser doesn't block it.
      try {
        window.open(
          AUDIO_SRC,
          'exploreaudio',
          'popup=yes,width=440,height=320,left=20,top=20,' +
          'menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=no'
        );
      } catch (_) {}
      const from = encodeURIComponent(location.pathname + location.search);
      sessionStorage.setItem('void-fade', '1');
      document.body.classList.add('fading-out');
      setTimeout(() => {
        location.href = '/explore.html?from=' + from;
      }, 480);
    }, true);
    return;
  }

  // ---------- /explore.html -----------------------------------------------

  // Make sure the canvas is visible even in simple mode.
  const canvas = document.getElementById('bg');
  if (!canvas) return;
  canvas.style.setProperty('display', 'block', 'important');
  const ctx = canvas.getContext('2d', { alpha: true });

  // --- hint + esc -----------------------------------------------------------
  const hint = document.createElement('div');
  hint.className = 'void-hint';
  hint.textContent = '. . . press [esc] to return . . .';
  document.body.appendChild(hint);

  function closeAudioPopup() {
    try {
      const popup = window.open('', 'exploreaudio');
      if (popup) popup.close();
    } catch (_) {}
  }
  let exiting = false;
  function exit() {
    if (exiting) return;
    exiting = true;
    closeAudioPopup();
    const params = new URLSearchParams(location.search);
    const from = params.get('from');
    const dest = (from && from[0] === '/') ? from : '/';
    sessionStorage.setItem('void-fade', '1');
    document.body.classList.add('fading-out');
    setTimeout(() => { location.href = dest; }, 480);
  }
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') exit();
  });

  // Take the popup down with the tab if the user closes/reloads it.
  window.addEventListener('beforeunload', closeAudioPopup);
  window.addEventListener('pagehide',     closeAudioPopup);
  window.addEventListener('unload',       closeAudioPopup);

  // --- canvas / grid metrics ------------------------------------------------
  const FONT_FAMILY = 'Consolas, "DejaVu Sans Mono", "Lucida Console", monospace';
  const BRAILLE_BASE = 0x2800;
  const DOTS = [
    [0,0,0x01],[0,1,0x02],[0,2,0x04],[0,3,0x40],
    [1,0,0x08],[1,1,0x10],[1,2,0x20],[1,3,0x80],
  ];
  const LENS_K = -0.16;

  // Fixed dot/braille grid size — independent of the viewport. The cell
  // dimensions stretch to fit so we always render the same number of glyphs.
  const COLS = 240;
  const ROWS = 135;          // 16:9
  const dotCols = COLS * 2;
  const dotRows = ROWS * 4;

  let dpr = 1, viewW = 0, viewH = 0, halfW = 0, halfH = 0;
  let cellW = 8, cellH = 16, dotPxX = 4, dotPxY = 4;
  let fontSize = 14;
  let font = '14px ' + FONT_FAMILY;

  // Virtual coordinate system: physics + worm always pretend the window is
  // 1920 wide; height stretches/compresses to the viewport's aspect ratio.
  const VIRT_W = 1920;
  let VIRT_H = 1080;
  function v2sx(vx) { return vx / VIRT_W * viewW; }
  function v2sy(vy) { return vy / VIRT_H * viewH; }
  function s2vx(sx) { return sx / viewW  * VIRT_W; }
  function s2vy(sy) { return sy / viewH  * VIRT_H; }

  function measure() {
    dpr = window.devicePixelRatio || 1;
    viewW = window.innerWidth;
    viewH = window.innerHeight;
    canvas.width  = Math.ceil(viewW * dpr);
    canvas.height = Math.ceil(viewH * dpr);
    canvas.style.width  = viewW + 'px';
    canvas.style.height = viewH + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Cells stretch to make COLS×ROWS exactly fill the viewport.
    cellW = viewW / COLS;
    cellH = viewH / ROWS;
    dotPxX = cellW * 0.5;
    dotPxY = cellH * 0.25;
    halfW = viewW * 0.5;
    halfH = viewH * 0.5;
    VIRT_H = Math.max(200, Math.round(VIRT_W * viewH / viewW));
    // Pick a font size whose '⣿' glyph width matches our target cell width.
    ctx.font = '14px ' + FONT_FAMILY;
    ctx.textBaseline = 'top';
    const baseW = ctx.measureText('⣿').width || 8;
    fontSize = 14 * cellW / baseW;
    font = fontSize.toFixed(2) + 'px ' + FONT_FAMILY;
    ctx.font = font;
  }

  // ---- liquid surface sim --------------------------------------------------
  const SIM_W = 480;
  const SIM_H = Math.round(SIM_W * 9 / 16);  // 270
  let waveA = new Float32Array(SIM_W * SIM_H);
  let waveB = new Float32Array(SIM_W * SIM_H);
  // Cells marked here behave as fixed barriers: incoming waves reflect off
  // them. Rebuilt every frame from worm vertebrae positions.
  const solidMask = new Uint8Array(SIM_W * SIM_H);

  // Active bounding box. We only update / render the rectangle that has
  // any wave activity (plus a 1-cell margin so wavefronts can propagate).
  // Empty when actMaxX < actMinX.
  let actMinX = SIM_W, actMaxX = -1;
  let actMinY = SIM_H, actMaxY = -1;
  function bumpActive(x, y) {
    if (x < actMinX) actMinX = x;
    if (x > actMaxX) actMaxX = x;
    if (y < actMinY) actMinY = y;
    if (y > actMaxY) actMaxY = y;
  }

  function rebuildSolidMask() {
    solidMask.fill(0);
    if (!worm) return;
    const sxScale = SIM_W / VIRT_W;
    const syScale = SIM_H / VIRT_H;
    for (let i = 0; i < worm.verts.length; i++) {
      const v = worm.verts[i];
      const cx = v.x * sxScale;
      const cy = v.y * syScale;
      const r = Math.max(2, 5 - Math.floor(i * 0.06));
      const r2 = r * r + r;
      for (let oy = -r; oy <= r; oy++) {
        for (let ox = -r; ox <= r; ox++) {
          if (ox * ox + oy * oy > r2) continue;
          const tx = Math.round(cx + ox);
          const ty = Math.round(cy + oy);
          if (tx <= 0 || tx >= SIM_W - 1 || ty <= 0 || ty >= SIM_H - 1) continue;
          solidMask[ty * SIM_W + tx] = 1;
          // Make sure waves around the worm get processed every step so
          // reflection works correctly even in otherwise quiet water.
          bumpActive(tx, ty);
        }
      }
    }
  }

  function simStep() {
    if (actMaxX < actMinX) return;

    // Expand active region by 1 every step so wave fronts can spread.
    const x0 = Math.max(1, actMinX - 1);
    const x1 = Math.min(SIM_W - 2, actMaxX + 1);
    const y0 = Math.max(1, actMinY - 1);
    const y1 = Math.min(SIM_H - 2, actMaxY + 1);

    const damp = 0.992;
    const W = SIM_W;
    const A = waveA, B = waveB, M = solidMask;
    const THR = 0.0035;

    let nMinX = SIM_W, nMaxX = -1, nMinY = SIM_H, nMaxY = -1;

    for (let y = y0; y <= y1; y++) {
      const row = y * W;
      let yLive = false;
      for (let x = x0; x <= x1; x++) {
        const i = row + x;
        if (M[i]) { B[i] = 0; continue; }
        const avg = (A[i - 1] + A[i + 1] + A[i - W] + A[i + W]) * 0.5;
        const next = (avg - B[i]) * damp;
        B[i] = next;
        if (next > THR || next < -THR) {
          if (x < nMinX) nMinX = x;
          if (x > nMaxX) nMaxX = x;
          yLive = true;
        }
      }
      if (yLive) {
        if (y < nMinY) nMinY = y;
        if (y > nMaxY) nMaxY = y;
      }
    }

    // Transmissive (Mur-style) boundary at the actual edge cell — copies the
    // inward neighbour so waves "leave" the field instead of bouncing.
    // We use last frame's interior value (waveA) so it lags by one step,
    // which is the standard 1st-order Mur ABC.
    if (actMinX <= 0) {
      for (let y = y0; y <= y1; y++) B[y * W]              = A[y * W + 1];
    }
    if (actMaxX >= SIM_W - 1) {
      for (let y = y0; y <= y1; y++) B[y * W + SIM_W - 1]  = A[y * W + SIM_W - 2];
    }
    if (actMinY <= 0) {
      for (let x = x0; x <= x1; x++) B[x]                  = A[W + x];
    }
    if (actMaxY >= SIM_H - 1) {
      for (let x = x0; x <= x1; x++) B[(SIM_H - 1) * W + x] = A[(SIM_H - 2) * W + x];
    }

    // Damping layer near the edges as a fallback; a few cells deep, this
    // soaks up any energy the Mur boundary doesn't quite catch.
    const DAMP_LAYER = 14;
    if (actMinX < DAMP_LAYER) {
      const xEnd = Math.min(DAMP_LAYER - 1, x1);
      for (let y = y0; y <= y1; y++) {
        const r = y * W;
        for (let x = Math.max(0, x0); x <= xEnd; x++) {
          B[r + x] *= 0.40 + 0.60 * (x / DAMP_LAYER);
        }
      }
    }
    if (actMaxX > SIM_W - 1 - DAMP_LAYER) {
      const xStart = Math.max(SIM_W - DAMP_LAYER, x0);
      for (let y = y0; y <= y1; y++) {
        const r = y * W;
        for (let x = xStart; x <= x1; x++) {
          B[r + x] *= 0.40 + 0.60 * ((SIM_W - 1 - x) / DAMP_LAYER);
        }
      }
    }
    if (actMinY < DAMP_LAYER) {
      const yEnd = Math.min(DAMP_LAYER - 1, y1);
      for (let y = Math.max(0, y0); y <= yEnd; y++) {
        const r = y * W, fy = 0.40 + 0.60 * (y / DAMP_LAYER);
        for (let x = x0; x <= x1; x++) B[r + x] *= fy;
      }
    }
    if (actMaxY > SIM_H - 1 - DAMP_LAYER) {
      const yStart = Math.max(SIM_H - DAMP_LAYER, y0);
      for (let y = yStart; y <= y1; y++) {
        const r = y * W, fy = 0.40 + 0.60 * ((SIM_H - 1 - y) / DAMP_LAYER);
        for (let x = x0; x <= x1; x++) B[r + x] *= fy;
      }
    }

    const tmp = waveA; waveA = waveB; waveB = tmp;

    actMinX = nMinX;
    actMaxX = nMaxX;
    actMinY = nMinY;
    actMaxY = nMaxY;
  }
  // Primitive ripple simulator: each impulse emits an expanding circle that
  // fades out and dithers thinner with age. No grid; just a list of rings.
  const ripples = [];
  let nextRippleId = 1;
  const RIPPLE_LIFE  = 1.5;       // seconds
  const RIPPLE_SPEED = 130;       // VIRT units / sec — radius growth
  function impulseAtVirt(vx, vy, strength, opts) {
    if (ripples.length > 1500) ripples.shift();
    ripples.push({
      id: nextRippleId++,
      x: vx,
      y: vy,
      born: (Date.now() - t0) / 1000,
      strength: strength,
      speed: (opts && opts.speed) || RIPPLE_SPEED,
      life:  (opts && opts.life)  || RIPPLE_LIFE,
    });
  }
  // Cheap deterministic [0,1) hash.
  function rHash(a, b) {
    let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h = h ^ (h >>> 16);
    return (h >>> 0) / 4294967296;
  }

  // (Click-to-ripple interaction removed — explore is observation only.)

  // --- ambient edge waves ---------------------------------------------------
  // Every few seconds, a small ripple appears just inside one of the four
  // screen edges and rolls inward — like ambient sea swell.
  let nextEdgeWaveAt = 1.5 + Math.random() * 3;
  function maybeSpawnEdgeWave(elapsed) {
    if (elapsed < nextEdgeWaveAt) return;
    const inset = 30;
    const side = Math.floor(Math.random() * 4);
    let x, y;
    switch (side) {
      case 0: x = Math.random() * VIRT_W; y = inset;            break;  // top
      case 1: x = VIRT_W - inset;        y = Math.random() * VIRT_H; break;  // right
      case 2: x = Math.random() * VIRT_W; y = VIRT_H - inset;   break;  // bottom
      case 3: x = inset;                 y = Math.random() * VIRT_H; break;  // left
    }
    impulseAtVirt(x, y, 0.8 + Math.random() * 1.4);
    nextEdgeWaveAt = elapsed + 1.5 + Math.random() * 4.5;
  }

  // --- boats ----------------------------------------------------------------
  const boats = [];
  let nextBoatAt = 8 + Math.random() * 12;   // first spawn 8–20s in
  function spawnBoat(elapsed) {
    // Pick a random off-screen point on one of the 4 sides, and another on a
    // different side. The boat travels in a straight line between them.
    const m = 100;
    function pointOnSide(side) {
      switch (side) {
        case 0: return { x: Math.random() * VIRT_W, y: -m };           // top
        case 1: return { x: VIRT_W + m, y: Math.random() * VIRT_H };   // right
        case 2: return { x: Math.random() * VIRT_W, y: VIRT_H + m };   // bottom
        case 3: return { x: -m, y: Math.random() * VIRT_H };           // left
      }
    }
    const startSide = Math.floor(Math.random() * 4);
    let endSide;
    do { endSide = Math.floor(Math.random() * 4); } while (endSide === startSide);
    const a = pointOnSide(startSide);
    const b = pointOnSide(endSide);
    const dx = b.x - a.x, dy = b.y - a.y;
    const dist = Math.hypot(dx, dy) || 1;
    const speed = 55 + Math.random() * 130;     // 55–185 VIRT/sec
    boats.push({
      x: a.x, y: a.y,
      vx: (dx / dist) * speed,
      vy: (dy / dist) * speed,
      age: 0,
    });
    // Spawn rate driven by slow Perlin-ish noise on time. n in [0,1].
    // n=1 → boat every 0.25s (peak); n=0 → boat every 120s (lull).
    // Heavily skewed toward the slow end so peaks are special.
    const n = smooth(elapsed * 0.035, 731);
    const intensity = Math.pow(n, 3);          // 0..1, biased low
    const interval = 120 * Math.pow(0.25 / 120, intensity); // log-lerp
    nextBoatAt = elapsed + interval;
  }
  function updateBoats(dt, elapsed) {
    if (elapsed >= nextBoatAt && boats.length < 3) spawnBoat(elapsed);
    for (let i = boats.length - 1; i >= 0; i--) {
      const b = boats[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.age += dt;
      // Off-screen cleanup.
      if (b.x < -200 || b.x > VIRT_W + 200 || b.y < -200 || b.y > VIRT_H + 200) {
        if (worm && worm.targetBoat === b) {
          worm.targetBoat = null;
          worm.state = 'idle';
          worm.idleSince = elapsed;
          worm.stateUntil = elapsed + 25 + Math.random() * 70;
        }
        boats.splice(i, 1);
        continue;
      }
      // Subtle wake behind the boat — throttled and weak.
      b._wakeCounter = (b._wakeCounter || 0) + 1;
      if (b._wakeCounter % 8 === 0) {
        impulseAtVirt(b.x, b.y, 0.18, { speed: 50, life: 1.0 });
      }
    }
  }
  function drownBoat(b) {
    // Huge concentric burst.
    impulseAtVirt(b.x,        b.y,        28);
    impulseAtVirt(b.x + 14,   b.y,        16);
    impulseAtVirt(b.x - 14,   b.y,        16);
    impulseAtVirt(b.x,        b.y + 14,   16);
    impulseAtVirt(b.x,        b.y - 14,   16);
    const idx = boats.indexOf(b);
    if (idx >= 0) boats.splice(idx, 1);
  }

  // --- worm state -----------------------------------------------------------
  const VERTS = 40;
  const SEG_LEN = 16;          // distance between vertebrae
  const t0 = Date.now();
  let worm = null;

  function pickTarget() {
    const margin = 200;
    return {
      x: margin + Math.random() * (VIRT_W - margin * 2),
      y: margin + Math.random() * (VIRT_H - margin * 2),
    };
  }

  function initWorm() {
    const cx = VIRT_W * 0.5, cy = VIRT_H * 0.5;
    worm = {
      head: { x: cx, y: cy, dirX: 1, dirY: 0 },
      verts: [],
      state: 'idle',
      stateUntil: 2 + Math.random() * 4,
      target: null,
      speed: 0,
    };
    for (let i = 0; i < VERTS; i++) {
      worm.verts.push({
        x: cx - i * SEG_LEN, y: cy,
        prevX: cx - i * SEG_LEN, prevY: cy,
        idleTime: 6,                  // start fully faded
      });
    }
  }

  // Per-vertebra tremor uses independent noise streams.
  const shakeSamples = new Float32Array(512);
  for (let i = 0; i < shakeSamples.length; i++) shakeSamples[i] = Math.random();
  function smooth(t, salt) {
    const idx = Math.floor(t);
    const f = t - idx;
    const a = shakeSamples[(idx + salt) & 511];
    const b = shakeSamples[(idx + salt + 1) & 511];
    const u = f * f * (3 - 2 * f);
    return a * (1 - u) + b * u;
  }
  function shakeOf(i, time) {
    return {
      x: (smooth(time * 7 + i * 0.31, i * 13 +  17) - 0.5) * 2.0,
      y: (smooth(time * 7 + i * 0.31, i * 19 + 113) - 0.5) * 2.0,
    };
  }

  function updateWorm(dt) {
    if (!worm) initWorm();
    const elapsed = (Date.now() - t0) / 1000;

    // ---- behavior state machine ------------------------------------------
    if (elapsed > worm.stateUntil) {
      if (worm.state === 'idle') {
        worm.state = 'moving';
        worm.idleSince = null;
        // Small chance to chase a passing boat instead of an empty point.
        if (boats.length > 0 && Math.random() < 0.25) {
          worm.targetBoat = boats[Math.floor(Math.random() * boats.length)];
          worm.target = { x: worm.targetBoat.x, y: worm.targetBoat.y };
          worm.speed = 140 + Math.random() * 160;     // chase speed
        } else {
          worm.targetBoat = null;
          worm.target = pickTarget();
          worm.speed = 25 + Math.random() * 260;
        }
        worm.stateUntil = elapsed + 6 + Math.random() * 10;
      } else {
        worm.state = 'idle';
        worm.idleSince = elapsed;
        worm.stateUntil = elapsed + 30 + Math.random() * 120;
      }
    }

    if (worm.state === 'moving' && worm.target) {
      // If we're chasing a boat, keep retargeting onto its current position.
      if (worm.targetBoat) {
        if (boats.indexOf(worm.targetBoat) < 0) {
          worm.targetBoat = null;
          worm.state = 'idle';
          worm.idleSince = elapsed;
          worm.stateUntil = elapsed + 25 + Math.random() * 70;
        } else {
          worm.target.x = worm.targetBoat.x;
          worm.target.y = worm.targetBoat.y;
        }
      }
      const dx = worm.target.x - worm.head.x;
      const dy = worm.target.y - worm.head.y;
      const dist = Math.hypot(dx, dy);
      const arriveDist = worm.targetBoat ? 60 : 24;
      if (dist < arriveDist) {
        if (worm.targetBoat) {
          drownBoat(worm.targetBoat);
          worm.targetBoat = null;
        }
        worm.state = 'idle';
        worm.idleSince = elapsed;
        worm.stateUntil = elapsed + 30 + Math.random() * 120;
      } else {
        // Smoothly steer head direction toward target with a touch of wiggle
        const goalAng = Math.atan2(dy, dx);
        const wiggle = (smooth(elapsed * 0.9, 200) - 0.5) * 0.6;
        const ang = goalAng + wiggle;
        worm.head.dirX = Math.cos(ang);
        worm.head.dirY = Math.sin(ang);
        worm.head.x += worm.head.dirX * worm.speed * dt;
        worm.head.y += worm.head.dirY * worm.speed * dt;
      }
    } else {
      // Idle: drift very slightly so the worm breathes, but mostly stays put.
      const drift = 6;
      const angD = (smooth(elapsed * 0.5, 313) - 0.5) * Math.PI * 2;
      worm.head.x += Math.cos(angD) * drift * dt;
      worm.head.y += Math.sin(angD) * drift * dt;
      worm.head.dirX = Math.cos(angD);
      worm.head.dirY = Math.sin(angD);
    }

    // Soft bound (in VIRT space)
    const margin = 160;
    if (worm.head.x < margin)            worm.head.x += (margin - worm.head.x) * 0.12;
    if (worm.head.x > VIRT_W - margin)   worm.head.x -= (worm.head.x - (VIRT_W - margin)) * 0.12;
    if (worm.head.y < margin)            worm.head.y += (margin - worm.head.y) * 0.12;
    if (worm.head.y > VIRT_H - margin)   worm.head.y -= (worm.head.y - (VIRT_H - margin)) * 0.12;

    // ---- chain follow ----------------------------------------------------
    // Snapshot last positions so we can inject ripples based on movement.
    for (let i = 0; i < VERTS; i++) {
      worm.verts[i].prevX = worm.verts[i].x;
      worm.verts[i].prevY = worm.verts[i].y;
    }
    worm.verts[0].x = worm.head.x;
    worm.verts[0].y = worm.head.y;
    for (let i = 1; i < VERTS; i++) {
      const px = worm.verts[i - 1].x;
      const py = worm.verts[i - 1].y;
      const dx = worm.verts[i].x - px;
      const dy = worm.verts[i].y - py;
      const dist = Math.hypot(dx, dy) || 1;
      const sc = SEG_LEN / dist;
      worm.verts[i].x = px + dx * sc;
      worm.verts[i].y = py + dy * sc;
    }

    // Per-vertebra idle accumulator: each part tracks its own movement.
    // Idle increases linearly when still; when moving, it *decreases*
    // (rather than snapping to 0) so a vertebra that just woke up dithers
    // back in over ~1.5 s instead of popping into existence.
    for (let i = 0; i < VERTS; i++) {
      const v = worm.verts[i];
      const moved = Math.hypot(v.x - v.prevX, v.y - v.prevY);
      const cur = v.idleTime || 0;
      v.idleTime = moved > 0.5
        ? Math.max(0, cur - dt * 3.5)
        : cur + dt;
    }

    // Ripple injection: only the moving parts disturb the surface — head
    // and the feet at the tip of each leg. The spine itself doesn't push
    // water; it just slides along.
    const LEG_REACH = 24;          // VIRT units, matches render leg length
    const LEG_BEND_AMP = 0.5;      // matches render bend
    const wakeBoost = 0.4 + (worm.speed / 200);

    // Head + feet wakes are state-aware: full emission only while moving.
    // When idle, emissions become very rare and very subtle.
    worm._wakeCounter = (worm._wakeCounter || 0) + 1;
    const isMoving = worm.state === 'moving';
    const hp = worm.head;
    if (hp.prevWX === undefined) { hp.prevWX = hp.x; hp.prevWY = hp.y; }

    const headInterval = isMoving ? 15 : 120;     // far less often when idle
    if (worm._wakeCounter % headInterval === 0) {
      const headMv = Math.hypot(hp.x - hp.prevWX, hp.y - hp.prevWY);
      if (headMv > 0.4) {
        const k = isMoving ? 0.025 : 0.006;
        impulseAtVirt(hp.x, hp.y, headMv * k * wakeBoost,
                      isMoving ? undefined : { speed: 40, life: 0.8 });
      }
      hp.prevWX = hp.x;
      hp.prevWY = hp.y;
    }

    const feetInterval = isMoving ? 30 : 180;     // ~once every 3s when idle
    if (worm._wakeCounter % feetInterval === 0) {
      for (let i = 0; i < VERTS - 3; i += 12) {
        const v = worm.verts[i];
        const a = worm.verts[Math.max(0, i - 1)];
        const b = worm.verts[Math.min(VERTS - 1, i + 1)];
        let tx = b.x - a.x, ty = b.y - a.y;
        const tlen = Math.hypot(tx, ty) || 1;
        tx /= tlen; ty /= tlen;
        const nx = -ty, ny = tx;
        if (!v.feetPrev) v.feetPrev = [{ x: v.x, y: v.y }, { x: v.x, y: v.y }];
        for (let s = 0; s < 2; s++) {
          const side  = s === 0 ? -1 : 1;
          const phase = i * 0.45 + elapsed * 1.6 + (s === 0 ? Math.PI : 0);
          const bend  = Math.sin(phase) * LEG_BEND_AMP;
          const fx = v.x + side * nx * LEG_REACH + tx * bend * LEG_REACH * 0.45;
          const fy = v.y + side * ny * LEG_REACH + ty * bend * LEG_REACH * 0.45;
          const moved = Math.hypot(fx - v.feetPrev[s].x, fy - v.feetPrev[s].y);
          if (moved > 0.4) {
            const k = isMoving ? 0.012 : 0.004;
            impulseAtVirt(fx, fy, moved * k * wakeBoost,
                          { speed: isMoving ? 55 : 30,
                            life:  isMoving ? 1.1 : 0.7 });
          }
          v.feetPrev[s].x = fx;
          v.feetPrev[s].y = fy;
        }
      }
    }
  }

  // --- render ---------------------------------------------------------------
  function frame(now) {
    rafId = requestAnimationFrame(frame);
    // Cap render to 60fps even on high-refresh displays so we don't burn
    // cycles double-rendering identical wave fields.
    const RENDER_INTERVAL = 1000 / 60;
    if (lastT && now - lastT < RENDER_INTERVAL - 0.5) return;
    const dt = lastT ? Math.min(0.05, (now - lastT) / 1000) : 0;
    lastT = now;
    const elapsedNow = (Date.now() - t0) / 1000;
    updateWorm(dt);
    updateBoats(dt, elapsedNow);
    maybeSpawnEdgeWave(elapsedNow);
    // Surface sim disabled; rebuildSolidMask + simStep skipped. Will be
    // reattached when the new sim arrives.

    const grid = new Uint8Array(dotCols * dotRows);

    // Ripple render disabled while the simulator is removed.
    if (false && actMaxX >= actMinX) {
      const ZERO_BAND = 0.04;
      const MIN_AMP   = 0.06;
      const ratX = SIM_W / dotCols;
      const ratY = SIM_H / dotRows;
      // Map active sim region → dot grid region (with a small margin).
      const dx0 = Math.max(0, Math.floor((actMinX - 1) / ratX));
      const dx1 = Math.min(dotCols - 1, Math.ceil((actMaxX + 1) / ratX));
      const dy0 = Math.max(0, Math.floor((actMinY - 1) / ratY));
      const dy1 = Math.min(dotRows - 1, Math.ceil((actMaxY + 1) / ratY));
      const A = waveA;
      for (let dy = dy0; dy <= dy1; dy++) {
        const fy = dy * ratY;
        const iy = Math.min(SIM_H - 2, Math.max(0, Math.floor(fy)));
        const fyr = fy - iy;
        const row0 = iy * SIM_W;
        const row1 = (iy + 1) * SIM_W;
        for (let dx = dx0; dx <= dx1; dx++) {
          const fx = dx * ratX;
          const ix = Math.min(SIM_W - 2, Math.max(0, Math.floor(fx)));
          const fxr = fx - ix;
          const v00 = A[row0 + ix];
          const v10 = A[row0 + ix + 1];
          const v01 = A[row1 + ix];
          const v11 = A[row1 + ix + 1];
          const mn = Math.min(v00, v10, v01, v11);
          const mx = Math.max(v00, v10, v01, v11);
          if (mx - mn < MIN_AMP) continue;
          const interp =
            v00 * (1 - fxr) * (1 - fyr) +
            v10 *      fxr  * (1 - fyr) +
            v01 * (1 - fxr) *      fyr  +
            v11 *      fxr  *      fyr;
          if (interp > -ZERO_BAND && interp < ZERO_BAND) {
            grid[dy * dotCols + dx] = 1;
          }
        }
      }
    }

    function setDot(gx, gy) {
      if (gx < 0 || gx >= dotCols || gy < 0 || gy >= dotRows) return;
      grid[gy * dotCols + gx] = 1;
    }
    function stampDotAtScreen(px, py) {
      const nxR = (px - halfW) / halfW;
      const nyR = (py - halfH) / halfH;
      const f = 1 + LENS_K * (nxR * nxR + nyR * nyR);
      const lpx = halfW + (px - halfW) / f;
      const lpy = halfH + (py - halfH) / f;
      setDot(Math.floor(lpx / dotPxX), Math.floor(lpy / dotPxY));
    }
    // Worm visibility is set per-vertebra in the render loop based on each
    // vertebra's individual idleTime — see worm body pass below.
    let wormVis = 1;
    function wormStamp(x, y) {
      if (wormVis <= 0) return;
      if (wormVis < 1) {
        const ix = x | 0, iy = y | 0;
        let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263)) | 0;
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        h = h ^ (h >>> 16);
        if (((h >>> 0) / 4294967296) > wormVis) return;
      }
      stampDotAtScreen(x, y);
    }

    // Slightly-rounded square vertebra: full square minus the 4 sharpest
    // corners. Looks more "armored" than a circle and reads as a segment.
    function stampSquare(cx, cy, r) {
      for (let oy = -r; oy <= r; oy++) {
        for (let ox = -r; ox <= r; ox++) {
          if (Math.abs(ox) === r && Math.abs(oy) === r) continue;
          wormStamp(cx + ox * dotPxX, cy + oy * dotPxY);
        }
      }
    }

    // ----- boats render -----
    for (let bi = 0; bi < boats.length; bi++) {
      const b = boats[bi];
      const bsp = Math.hypot(b.vx, b.vy) || 1;
      const tx = b.vx / bsp, ty = b.vy / bsp;          // travel direction
      const nx = -ty, ny = tx;                          // perpendicular
      const cx = v2sx(b.x), cy = v2sy(b.y);
      // Hull: 6 segments along travel × 3 across.
      for (let f = -2; f <= 3; f++) {
        for (let p = -1; p <= 1; p++) {
          stampDotAtScreen(
            cx + tx * f * dotPxX * 1.4 + nx * p * dotPxY * 1.4,
            cy + ty * f * dotPxX * 1.4 + ny * p * dotPxY * 1.4
          );
        }
      }
      // Mast/sail: 4 dots along the perpendicular (one side).
      for (let m = 1; m <= 4; m++) {
        stampDotAtScreen(
          cx + nx * m * dotPxY * 1.4 + tx * dotPxX * 0.5,
          cy + ny * m * dotPxY * 1.4 + ty * dotPxX * 0.5
        );
      }
    }

    const elapsed = (Date.now() - t0) / 1000;

    for (let i = 0; i < VERTS; i++) {
      const v = worm.verts[i];
      // Per-part visibility based on this vertebra's own idle clock.
      // Floors at 2 % so a fully-faded segment still leaves a faint trace.
      wormVis = 0.02 + 0.98 * Math.max(0, 1 - (v.idleTime || 0) / 5);
      const sh = shakeOf(i, elapsed);
      // Translate VIRT → viewport for stamping.
      const vx = v2sx(v.x + sh.x);
      const vy = v2sy(v.y + sh.y);

      // Tangent at this vertebra (use neighbour spine direction in viewport).
      const a = worm.verts[Math.max(0, i - 1)];
      const b = worm.verts[Math.min(VERTS - 1, i + 1)];
      let tx = v2sx(b.x) - v2sx(a.x);
      let ty = v2sy(b.y) - v2sy(a.y);
      const tlen = Math.hypot(tx, ty) || 1;
      tx /= tlen; ty /= tlen;
      const nx = -ty, ny = tx;             // perpendicular

      // Body: a small rounded square. Head bigger than tail.
      const r = Math.max(1, Math.round(2 - i * (1.0 / VERTS)));
      stampSquare(vx, vy, r);

      // Two legs sticking out perpendicular, with a per-leg wiggle phase.
      // Skip the very last few segments so the tail doesn't have feet.
      if (i < VERTS - 3) {
        for (let side = -1; side <= 1; side += 2) {
          const phase = i * 0.45 + elapsed * 1.6 + (side > 0 ? 0 : Math.PI);
          const bend = Math.sin(phase) * 0.5;          // -0.5..0.5
          const segs = 5;                              // dots per leg
          for (let k = 1; k <= segs; k++) {
            const fwd = k * (cellW * 0.55);            // outward distance
            // perpendicular base + slight forward sway = curved leg
            const lx = vx + side * nx * fwd + tx * bend * fwd * 0.45;
            const ly = vy + side * ny * fwd + ty * bend * fwd * 0.45;
            wormStamp(lx, ly);
          }
          // a small foot dot at the end
          const fwd = (segs + 0.5) * (cellW * 0.55);
          const fx = vx + side * nx * fwd + tx * bend * fwd * 0.45;
          const fy = vy + side * ny * fwd + ty * bend * fwd * 0.45;
          wormStamp(fx + dotPxX,  fy);
          wormStamp(fx - dotPxX,  fy);
          wormStamp(fx,           fy + dotPxY);
        }
      }
    }

    // ----- ripples (each impulse emits a train of expanding rings) -----
    {
      const RINGS = 4;                 // number of concentric rings per ripple
      const RING_GAP = 0.45;           // seconds between rings
      for (let i = ripples.length - 1; i >= 0; i--) {
        const rp = ripples[i];
        const age = elapsedNow - rp.born;
        const life  = rp.life  || RIPPLE_LIFE;
        const speed = rp.speed || RIPPLE_SPEED;
        if (age - (RINGS - 1) * RING_GAP > life) {
          ripples.splice(i, 1);
          continue;
        }
        for (let k = 0; k < RINGS; k++) {
          const ringAge = age - k * RING_GAP;
          if (ringAge <= 0 || ringAge > life) continue;
          const radius = ringAge * speed;
          if (radius < 1.5) continue;
          const fade = Math.pow(1 - ringAge / life, 0.5);
          const density = fade * Math.min(1, rp.strength * 0.6);
          const segs = Math.max(24, Math.floor(2 * Math.PI * radius / dotPxX));
          // Slight thickness — stamp at ±1 of the target radius for body.
          for (let off = -1; off <= 1; off++) {
            const rr = radius + off * 1.5;
            if (rr < 1) continue;
            for (let s = 0; s < segs; s++) {
              if (rHash(rp.id, s + k * 9001 + (off + 1) * 33) > density) continue;
              const a = (s / segs) * Math.PI * 2;
              stampDotAtScreen(v2sx(rp.x + Math.cos(a) * rr),
                               v2sy(rp.y + Math.sin(a) * rr));
            }
          }
        }
      }
    }

    // ----- watereffects layer (XOR, 8×8 Bayer-dithered cells) -----
    // Each 8×8 block samples the water field once and dithers via an 8×8
    // Bayer matrix (64 thresholds). Density is capped low so even the
    // densest cell is roughly a 0x0x checker — never solid.
    {
      const BAYER8 = [
         0, 32,  8, 40,  2, 34, 10, 42,
        48, 16, 56, 24, 50, 18, 58, 26,
        12, 44,  4, 36, 14, 46,  6, 38,
        60, 28, 52, 20, 62, 30, 54, 22,
         3, 35, 11, 43,  1, 33,  9, 41,
        51, 19, 59, 27, 49, 17, 57, 25,
        15, 47,  7, 39, 13, 45,  5, 37,
        63, 31, 55, 23, 61, 29, 53, 21,
      ];
      const wt = elapsedNow;
      const STEP = 8;
      const THR = 0.7;
      const MAX_DENSITY = 0.25;          // peak cell ≈ 25% lit
      for (let dy = 0; dy < dotRows; dy += STEP) {
        for (let dx = 0; dx < dotCols; dx += STEP) {
          const v =
            Math.sin(dx * 0.04            + wt * 0.20) +
            Math.sin(dy * 0.05            - wt * 0.17) +
            Math.sin((dx + dy) * 0.025    + wt * 0.13) +
            Math.sin((dx - dy) * 0.030    - wt * 0.23);
          const absV = v < 0 ? -v : v;
          if (absV >= THR) continue;
          const density = (1 - absV / THR) * MAX_DENSITY;
          const limit = density * 64;
          for (let oy = 0; oy < STEP; oy++) {
            const yy = dy + oy;
            if (yy >= dotRows) break;
            const row = yy * dotCols;
            for (let ox = 0; ox < STEP; ox++) {
              const xx = dx + ox;
              if (xx >= dotCols) break;
              if (BAYER8[oy * 8 + ox] < limit) grid[row + xx] ^= 1;
            }
          }
        }
      }
    }

    ctx.clearRect(0, 0, viewW, viewH);
    ctx.fillStyle = 'rgb(106, 255, 160)';
    ctx.font = font;
    ctx.textBaseline = 'top';

    const simple = document.body.classList.contains('simple');
    if (simple) {
      ctx.shadowBlur = 0;
      ctx.shadowColor = 'transparent';
      const xEdges = new Int32Array(dotCols + 1);
      const yEdges = new Int32Array(dotRows + 1);
      for (let i = 0; i <= dotCols; i++) xEdges[i] = Math.round(i * dotPxX);
      for (let j = 0; j <= dotRows; j++) yEdges[j] = Math.round(j * dotPxY);
      for (let dy = 0; dy < dotRows; dy++) {
        const y = yEdges[dy];
        const h = yEdges[dy + 1] - y;
        if (h <= 0) continue;
        for (let dx = 0; dx < dotCols; dx++) {
          if (!grid[dy * dotCols + dx]) continue;
          const x = xEdges[dx];
          const w = xEdges[dx + 1] - x;
          if (w > 0) ctx.fillRect(x, y, w, h);
        }
      }
    } else {
      for (let cy = 0; cy < ROWS; cy++) {
        const baseDY = cy * 4;
        const py = cy * cellH;
        for (let cx = 0; cx < COLS; cx++) {
          const baseDX = cx * 2;
          let bits = 0;
          for (let i = 0; i < 8; i++) {
            const d = DOTS[i];
            if (grid[(baseDY + d[1]) * dotCols + (baseDX + d[0])]) bits |= d[2];
          }
          if (bits === 0) continue;
          ctx.fillText(String.fromCharCode(BRAILLE_BASE | bits), cx * cellW, py);
        }
      }
    }
  }

  let rafId = 0;
  let lastT = 0;
  let lastSimT = 0;
  let avgSimMs = 0;
  function start() {
    measure();
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => measure());
    }
    rafId = requestAnimationFrame(frame);
  }

  window.addEventListener('load', start);
  window.addEventListener('resize', measure);
})();
