(function () {
  'use strict';

  // --- session-persistent seed + time origin --------------------------------
  let seed = parseInt(sessionStorage.getItem('bg.seed'), 10);
  if (!Number.isFinite(seed)) {
    seed = (Math.random() * 0xffffffff) >>> 0;
    sessionStorage.setItem('bg.seed', String(seed));
  }
  let t0 = parseInt(sessionStorage.getItem('bg.t0'), 10);
  if (!Number.isFinite(t0)) {
    t0 = Date.now();
    sessionStorage.setItem('bg.t0', String(t0));
  }

  function mulberry32(a) {
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rand = mulberry32(seed);

  // --- Perlin noise (seeded) -------------------------------------------------
  const perm = new Uint8Array(512);
  (function buildPerm() {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = (rand() * (i + 1)) | 0;
      const tmp = p[i]; p[i] = p[j]; p[j] = tmp;
    }
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  })();
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a, b, t) => a + t * (b - a);
  function grad(hash, x, y, z) {
    const h = hash & 15;
    const u = h < 8 ? x : y;
    const v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
  }
  function noise(x, y, z) {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, Z = Math.floor(z) & 255;
    x -= Math.floor(x); y -= Math.floor(y); z -= Math.floor(z);
    const u = fade(x), v = fade(y), w = fade(z);
    const A  = perm[X] + Y,     AA = perm[A] + Z,     AB = perm[A + 1] + Z;
    const B  = perm[X + 1] + Y, BA = perm[B] + Z,     BB = perm[B + 1] + Z;
    return lerp(
      lerp(lerp(grad(perm[AA],     x,     y,     z),
                grad(perm[BA],     x - 1, y,     z), u),
           lerp(grad(perm[AB],     x,     y - 1, z),
                grad(perm[BB],     x - 1, y - 1, z), u), v),
      lerp(lerp(grad(perm[AA + 1], x,     y,     z - 1),
                grad(perm[BA + 1], x - 1, y,     z - 1), u),
           lerp(grad(perm[AB + 1], x,     y - 1, z - 1),
                grad(perm[BB + 1], x - 1, y - 1, z - 1), u), v),
      w
    );
  }

  // --- canvas / renderer ----------------------------------------------------
  const BRAILLE_BASE = 0x2800;
  const DOTS = [
    [0,0,0x01],[0,1,0x02],[0,2,0x04],[0,3,0x40],
    [1,0,0x08],[1,1,0x10],[1,2,0x20],[1,3,0x80],
  ];

  const canvas = document.getElementById('bg');
  if (!canvas) return;
  const ctx = canvas.getContext('2d', { alpha: true });

  const FONT_SIZE = 14;
  const CELL_H = 16;
  const FONT = `${FONT_SIZE}px Consolas, "DejaVu Sans Mono", "Lucida Console", monospace`;

  let cellW = 8;
  let cols = 0, rows = 0;
  let dpr = 1;
  let viewW = 0, viewH = 0;
  let maskRects = [];
  let maskDirty = true;

  const SEED32 = seed >>> 0;

  // --- parallax star layers --------------------------------------------------
  // Stars live at continuous document positions and are generated per tile so
  // we can scroll/pan infinitely. Each layer has its own depth (parallax
  // amount), density, brightness, and visual style.
  const TILE = 256;
  const LAYERS = [
    { depth: 0.0125, count: 14, alpha: 0.50, draw: 'small' },
    { depth: 0.0375, count: 4,  alpha: 0.80, draw: 'med'   },
    { depth: 0.0900, count: 1,  alpha: 1.00, draw: 'big'   },
  ];
  const tileCache = new Map();
  const TILE_CACHE_MAX = 600;

  function getTileStars(tx, ty, li) {
    const k = tx + ',' + ty + ',' + li;
    let s = tileCache.get(k);
    if (s) return s;
    const layer = LAYERS[li];
    const r = mulberry32(
      (SEED32
        ^ Math.imul(tx | 0, 0x9E3779B1)
        ^ Math.imul(ty | 0, 0x85EBCA77)
        ^ Math.imul(li | 0, 0xC2B2AE3D)) >>> 0
    );
    const arr = [];
    for (let i = 0; i < layer.count; i++) {
      arr.push({
        x: tx * TILE + r() * TILE,
        y: ty * TILE + r() * TILE,
        sub: (r() * 8) | 0,
      });
    }
    if (tileCache.size >= TILE_CACHE_MAX) {
      const firstKey = tileCache.keys().next().value;
      tileCache.delete(firstKey);
    }
    tileCache.set(k, arr);
    return arr;
  }

  // --- transient effects: shooting stars + airplanes ------------------------
  const shootingStars = [];
  const airplanes = [];
  const voidEvents = [];
  let lastFrameT = 0;

  // Three sets of 9 hallucinations each. Set 0 = no modifier, set 1 = shift,
  // set 2 = ctrl/meta. Pressing 1-9 picks one within a set.
  const KIND_SETS = [
    ['eye','ring','swirl','tendril','eyes','spiral','polygon','rain','face'],
    ['starburst','crack','helix','flower','wormhole','textfall','orbit','ribbon','constellation'],
    ['galaxy','lightning','bird','vortex','heart','mouth','gridwave','tunnel','echo'],
  ];
  const KIND_LIFE = {
    eye:4, ring:2.6, swirl:4.5, tendril:4, eyes:5, spiral:6, polygon:5, rain:5, face:5,
    starburst:3.5, crack:4, helix:5, flower:5, wormhole:5, textfall:5, orbit:6, ribbon:5, constellation:5,
    galaxy:7, lightning:1.6, bird:5, vortex:6, heart:6, mouth:5, gridwave:5, tunnel:6, echo:5,
  };

  function spawnVoidEvent(set, type) {
    if (voidEvents.length >= 6) voidEvents.shift();
    const kind = (KIND_SETS[set] || KIND_SETS[0])[type] || 'eye';
    const x = window.innerWidth  * (0.15 + Math.random() * 0.7);
    const y = window.innerHeight * (0.18 + Math.random() * 0.65);
    voidEvents.push({
      kind,
      x, y,
      life: 0,
      maxLife: KIND_LIFE[kind] || 5,
      id: (Math.random() * 0xffffffff) >>> 0,
      angle: Math.random() * Math.PI * 2,
      sides: 5 + Math.floor(Math.random() * 4),
    });
  }


  // --- camera (mouse-driven parallax) ---------------------------------------
  let camX = 0, camY = 0;
  let tCamX = 0, tCamY = 0;
  const CAM_RANGE = 60;
  window.addEventListener('mousemove', (e) => {
    const w = window.innerWidth, h = window.innerHeight;
    tCamX = (e.clientX / w - 0.5) * 2 * CAM_RANGE;
    tCamY = (e.clientY / h - 0.5) * 2 * CAM_RANGE;
  });

  function measure() {
    dpr = window.devicePixelRatio || 1;
    viewW = window.innerWidth;
    viewH = window.innerHeight;
    canvas.width  = Math.ceil(viewW * dpr);
    canvas.height = Math.ceil(viewH * dpr);
    canvas.style.width  = viewW + 'px';
    canvas.style.height = viewH + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = FONT;
    ctx.textBaseline = 'top';
    cellW = ctx.measureText('⣿').width;
    cols = Math.ceil(viewW / cellW) + 2;
    rows = Math.ceil(viewH / CELL_H) + 2;
    maskDirty = true;
  }

  function collectMaskRects() {
    const rects = [];
    const sx = window.scrollX, sy = window.scrollY;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const p = node.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        if (p.closest('#bg, .ascii-border, .boot, .void-hint, .void-counter')) return NodeFilter.FILTER_REJECT;
        const cs = getComputedStyle(p);
        if (cs.visibility === 'hidden' || cs.display === 'none') return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const range = document.createRange();
    let n;
    while ((n = walker.nextNode())) {
      range.selectNodeContents(n);
      const list = range.getClientRects();
      for (let i = 0; i < list.length; i++) {
        const r = list[i];
        if (r.width > 0 && r.height > 0) {
          rects.push({
            left:   r.left   + sx,
            right:  r.right  + sx,
            top:    r.top    + sy,
            bottom: r.bottom + sy,
          });
        }
      }
    }
    return rects;
  }

  function frame() {
    if (maskDirty) { maskRects = collectMaskRects(); maskDirty = false; }
    const elapsed = (Date.now() - t0) * 0.00012;
    // Bg should not move when scrolling vertically — pin sy to 0 for the
    // noise/star math; keep the real value separately for foreground masking.
    const sx = window.scrollX, sy = 0;
    const realSy = window.scrollY;

    // Smooth the camera toward the mouse target.
    camX += (tCamX - camX) * 0.08;
    camY += (tCamY - camY) * 0.08;

    // Document-anchored cell coords for the top-left of the viewport.
    const docCx0 = Math.floor(sx / cellW);
    const docCy0 = Math.floor(sy / CELL_H);
    // Sub-cell offset in CSS px so glyphs align with where they'd be in doc-space.
    const offX = (docCx0 * cellW)  - sx;
    const offY = (docCy0 * CELL_H) - sy;

    ctx.clearRect(0, 0, viewW, viewH);
    ctx.font = FONT;
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgb(106, 255, 160)';

    const cloudScale = 0.013;
    const cloudT = elapsed * 0.12;
    const cloudThreshold = 0.10;
    // Clouds are the deepest layer — parallax tuned to sit just behind the
    // farthest star layer.
    const cloudCamXDot = camX * 0.04;
    const cloudCamYDot = camY * 0.04;

    // Lens distortion. Negative K curves the field inward (pincushion / "the
    // edges curl toward the viewer") instead of outward like a fisheye.
    const halfW = viewW * 0.5;
    const halfH = viewH * 0.5;
    const LENS_K = -0.16;
    const dotPxX = cellW * 0.5;     // CSS px per dot column
    const dotPxY = CELL_H * 0.25;   // CSS px per dot row

    // 1D X-warp: a slow Perlin curve sampled along Y (and time) shifts each
    // dot row horizontally, giving the void a heat-haze / current shimmer.
    const warpScale = 0.02;
    const warpT = elapsed * 0.55;
    const warpAmp = 28;
    // Sample the warp on the camera-shifted (cloud-field) Y so the X-warp
    // travels with the clouds rather than staying glued to the screen.
    const warp = new Float64Array(rows * 4);
    for (let cy = 0; cy < rows; cy++) {
      const docCyHere = docCy0 + cy;
      for (let i = 0; i < 4; i++) {
        const dy = docCyHere * 4 + i + cloudCamYDot;
        warp[cy * 4 + i] = noise(0, dy * warpScale, warpT) * warpAmp;
      }
    }

    // --- dot grid: clouds + stars composited into one boolean field --------
    const dotCols = cols * 2;
    const dotRows = rows * 4;
    const grid = new Uint8Array(dotCols * dotRows);

    // Pass 1: clouds. 4-octave fBM in both modes; only the framerate differs.
    for (let dy = 0; dy < dotRows; dy++) {
      const cy = dy >> 2;
      const i  = dy & 3;
      const rowWarp = warp[cy * 4 + i];
      const pyScreen = offY + dy * dotPxY + dotPxY * 0.5;
      const nyR = (pyScreen - halfH) / halfH;
      for (let dx = 0; dx < dotCols; dx++) {
        const pxScreen = offX + dx * dotPxX + dotPxX * 0.5;
        const nxR = (pxScreen - halfW) / halfW;
        const f = 1 + LENS_K * (nxR * nxR + nyR * nyR);
        const pxV = halfW + (pxScreen - halfW) * f;
        const pyV = halfH + (pyScreen - halfH) * f;
        const docDotX = (pxV - offX) / dotPxX + docCx0 * 2 + rowWarp + cloudCamXDot;
        const docDotY = (pyV - offY) / dotPxY + docCy0 * 4 + cloudCamYDot;
        let amp = 1, freq = 1, sum = 0, norm = 0;
        for (let o = 0; o < 4; o++) {
          sum  += amp * noise(docDotX * cloudScale * freq, docDotY * cloudScale * freq, cloudT);
          norm += amp;
          amp  *= 0.5;
          freq *= 2;
        }
        if (sum / norm > cloudThreshold) grid[dy * dotCols + dx] = 1;
      }
    }

    // Pass 2: stars. Each layer has its own parallax shift; stars stamp dots
    // into the same grid so the final image is a single ASCII layer.
    function setDot(gx, gy) {
      if (gx < 0 || gx >= dotCols || gy < 0 || gy >= dotRows) return;
      grid[gy * dotCols + gx] = 1;
    }
    function setDotXor(gx, gy) {
      if (gx < 0 || gx >= dotCols || gy < 0 || gy >= dotRows) return;
      grid[gy * dotCols + gx] ^= 1;
    }
    function stampDotAtScreen(px, py) {
      const nxR = (px - halfW) / halfW;
      const nyR = (py - halfH) / halfH;
      const f = 1 + LENS_K * (nxR * nxR + nyR * nyR);
      const lpx = halfW + (px - halfW) / f;
      const lpy = halfH + (py - halfH) / f;
      const localX = lpx - offX;
      const localY = lpy - offY;
      setDot(Math.floor(localX / dotPxX), Math.floor(localY / dotPxY));
    }
    // Effect-dot: XOR with the underlying grid so it remains visible whether
    // it lands on dark void or bright cloud (cloud dots become silhouettes).
    function stampDotXorAtScreen(px, py) {
      const nxR = (px - halfW) / halfW;
      const nyR = (py - halfH) / halfH;
      const f = 1 + LENS_K * (nxR * nxR + nyR * nyR);
      const lpx = halfW + (px - halfW) / f;
      const lpy = halfH + (py - halfH) / f;
      const localX = lpx - offX;
      const localY = lpy - offY;
      setDotXor(Math.floor(localX / dotPxX), Math.floor(localY / dotPxY));
    }
    function stampLine(x0, y0, x1, y1) {
      const ddx = x1 - x0, ddy = y1 - y0;
      const len = Math.hypot(ddx, ddy);
      const steps = Math.max(2, Math.ceil(len / (dotPxX * 0.5)));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        stampDotAtScreen(x0 + ddx * t, y0 + ddy * t);
      }
    }
    function stampStar(screenX, screenY, kind) {
      // Match the cloud lens. Clouds inverse-sample noise (output P samples
      // at P·f), so a feature visually at radius R came from R·f in noise
      // space. To put a star at the same visual radius, divide its position
      // by f instead of multiplying.
      const nxR = (screenX - halfW) / halfW;
      const nyR = (screenY - halfH) / halfH;
      const f = 1 + LENS_K * (nxR * nxR + nyR * nyR);
      screenX = halfW + (screenX - halfW) / f;
      screenY = halfH + (screenY - halfH) / f;
      const localX = screenX - offX;
      const localY = screenY - offY;
      if (localX < -cellW * 2 || localX > viewW + cellW * 2) return;
      if (localY < -CELL_H * 2 || localY > viewH + CELL_H * 2) return;
      const cellCx = Math.floor(localX / cellW);
      const cellCy = Math.floor(localY / CELL_H);
      const baseDX = cellCx * 2;
      const baseDY = cellCy * 4;
      if (kind === 'small') {
        const subDX = ((localX - cellCx * cellW) / cellW * 2) | 0;
        const subDY = ((localY - cellCy * CELL_H) / CELL_H * 4) | 0;
        setDot(baseDX + (subDX & 1), baseDY + Math.max(0, Math.min(3, subDY)));
      } else if (kind === 'med') {
        // inner 2×2 dots
        setDot(baseDX,     baseDY + 1); setDot(baseDX,     baseDY + 2);
        setDot(baseDX + 1, baseDY + 1); setDot(baseDX + 1, baseDY + 2);
      } else {
        // big: full cell + small halo dots in cardinal neighbors
        for (let i = 0; i < 8; i++) {
          const d = DOTS[i];
          setDot(baseDX + d[0], baseDY + d[1]);
        }
        setDot(baseDX - 1, baseDY + 1);
        setDot(baseDX + 2, baseDY + 2);
        setDot(baseDX,     baseDY - 1);
        setDot(baseDX + 1, baseDY + 4);
      }
    }

    for (let li = 0; li < LAYERS.length; li++) {
      const layer = LAYERS[li];
      const offLX = -camX * layer.depth;
      const offLY = -camY * layer.depth;
      const docL = sx - offLX;
      const docT = sy - offLY;
      const docR = sx + viewW - offLX;
      const docB = sy + viewH - offLY;
      const txMin = Math.floor(docL / TILE);
      const txMax = Math.floor(docR / TILE);
      const tyMin = Math.floor(docT / TILE);
      const tyMax = Math.floor(docB / TILE);
      for (let ty = tyMin; ty <= tyMax; ty++) {
        for (let tx = txMin; tx <= txMax; tx++) {
          const stars = getTileStars(tx, ty, li);
          for (let si = 0; si < stars.length; si++) {
            const s = stars[si];
            stampStar(s.x - sx + offLX, s.y - sy + offLY, layer.draw);
          }
        }
      }
    }

    // Pass 2.5: shooting stars (rays) + airplanes (blinking dots with trails).
    const now = performance.now();
    const dt = lastFrameT ? Math.min(0.05, (now - lastFrameT) / 1000) : 0;
    lastFrameT = now;

    // Effects sit just behind clouds in parallax depth (slightly less motion).
    const EFFECT_DEPTH = 0.025;
    const effectOffX = -camX * EFFECT_DEPTH;
    const effectOffY = -camY * EFFECT_DEPTH;
    // Additive: airplanes / shooting stars stamp like normal stars/clouds.
    function stampEffectDot(px, py) {
      stampDotAtScreen(px + effectOffX, py + effectOffY);
    }
    // XOR: hallucinations cut through clouds so they're always visible.
    // Probabilistic fade: each call drops out with chance (1 - currentFadeP).
    let currentFadeP = 1;
    function stampHallucinationDot(px, py) {
      if (currentFadeP < 1 && Math.random() > currentFadeP) return;
      stampDotXorAtScreen(px + effectOffX, py + effectOffY);
    }
    function hashStep(id, k) {
      let h = (Math.imul(id | 0, 374761393) + Math.imul(k | 0, 668265263)) | 0;
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      h = h ^ (h >>> 16);
      return (h >>> 0) / 4294967296;
    }
    // Stamp a streak with density that tapers smoothly toward both ends and
    // is gated by an envelope (so it builds up and dies off in time too).
    function stampStreak(id, x0, y0, x1, y1, envelope) {
      const ddx = x1 - x0, ddy = y1 - y0;
      const len = Math.hypot(ddx, ddy);
      if (len < 0.5) return;
      const steps = Math.max(2, Math.ceil(len / (dotPxX * 0.5)));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;                       // 0 = tail, 1 = head
        // Density along the streak: low at both ends, peak around the head.
        const profile = Math.sin(t * Math.PI) * 0.6 + Math.pow(t, 2) * 0.4;
        const p = profile * envelope;
        if (hashStep(id, s) > p) continue;
        stampEffectDot(x0 + ddx * t, y0 + ddy * t);
      }
    }

    if (shootingStars.length < 4 && Math.random() < 0.012) {
      const interior = Math.random() < 0.4;
      const angle = (0.10 + Math.random() * 0.32) * Math.PI;
      const speed = interior
        ? 350 + Math.random() * 400
        : 1100 + Math.random() * 900;
      let x, y;
      if (interior) {
        // Spawn well inside the viewport, away from any edge.
        x = viewW * 0.20 + Math.random() * viewW * 0.60;
        y = viewH * 0.15 + Math.random() * viewH * 0.55;
      } else if (Math.random() < 0.65) {
        x = Math.random() * viewW; y = -40;
      } else {
        x = -40; y = Math.random() * viewH * 0.55;
      }
      shootingStars.push({
        id: (Math.random() * 0xffffffff) >>> 0,
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0,
        maxLife: interior ? (0.6 + Math.random() * 0.5) : (0.8 + Math.random() * 0.6),
        tail: interior ? (35 + Math.random() * 45) : (75 + Math.random() * 70),
      });
    }
    if (airplanes.length < 3 && Math.random() < 0.0009) {
      const goRight = Math.random() < 0.5;
      airplanes.push({
        x: goRight ? -20 : viewW + 20,
        y: viewH * 0.05 + Math.random() * viewH * 0.7,
        vx: (goRight ? 1 : -1) * (35 + Math.random() * 35),
        vy: (Math.random() - 0.5) * 6,
        blinkPhase: Math.random() * Math.PI * 2,
        trail: [],
        life: 0,
      });
    }

    // shooting stars: streak from (current pos) backward along velocity
    for (let i = shootingStars.length - 1; i >= 0; i--) {
      const s = shootingStars[i];
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.life += dt;
      if (s.life > s.maxLife ||
          s.x > viewW + 120 || s.y > viewH + 120 ||
          s.x < -120 || s.y < -120) {
        shootingStars.splice(i, 1);
        continue;
      }
      // Smooth time envelope for density (eased in/out, peaks mid-life).
      const lifeT = s.life / s.maxLife;            // 0..1
      const envelope = Math.sin(lifeT * Math.PI);  // 0..1..0
      const speed = Math.hypot(s.vx, s.vy) || 1;
      const ux = s.vx / speed, uy = s.vy / speed;
      stampStreak(s.id, s.x - ux * s.tail, s.y - uy * s.tail, s.x, s.y, envelope);
    }

    // airplanes: blinking dot with a thin sparse fading trail
    const TRAIL_MAX = 1.4;
    for (let i = airplanes.length - 1; i >= 0; i--) {
      const a = airplanes[i];
      a.x += a.vx * dt;
      a.y += a.vy * dt;
      a.life += dt;
      a.trail.push({ x: a.x, y: a.y, age: 0 });
      for (let j = 0; j < a.trail.length; j++) a.trail[j].age += dt;
      while (a.trail.length > 0 && a.trail[0].age > TRAIL_MAX) a.trail.shift();
      if (a.x < -60 || a.x > viewW + 60) { airplanes.splice(i, 1); continue; }

      // sparse, deterministic fade — older points appear at coarser stride
      for (let j = 0; j < a.trail.length; j++) {
        const p = a.trail[j];
        const ageNorm = p.age / TRAIL_MAX;
        const stride = 2 + Math.floor(ageNorm * 6);
        if (j % stride === 0) stampEffectDot(p.x, p.y);
      }
      // Blinking nav-light at the head: a 4x4-dot filled disk that flicks on
      // briefly each cycle, like a plane's strobe.
      const phase = ((a.life + a.blinkPhase) % 1.3) / 1.3;
      if (phase < 0.18) {
        const r = 2;
        const r2 = 2.6;
        for (let oy = -r; oy <= r; oy++) {
          for (let ox = -r; ox <= r; ox++) {
            if (ox * ox + oy * oy > r2) continue;
            stampEffectDot(a.x + ox * dotPxX, a.y + oy * dotPxY);
          }
        }
      }
    }

    // Pass 2.6: void-stare hallucinations. Frequency ramps with elapsed void
    // time; pressing 1-9 spawns specific kinds; +/- shifts the displayed time.
    const inVoidNow = document.body.classList.contains('void');
    const voidElapsedSec = (inVoidNow && window.voidElapsedMs) ? window.voidElapsedMs() / 1000 : 0;
    if (inVoidNow) {
      // Spawn ramp: nothing for the first 3 minutes, very rare ramping up to
      // ~5% intensity over the first hour, then climbing to full only by the
      // 6-hour mark. Manual triggers (1-9) ignore this gate.
      const sec = voidElapsedSec;
      let ramp;
      if (sec < 180)        ramp = 0;
      else if (sec < 3600)  ramp = ((sec - 180) / (3600 - 180)) * 0.05;
      else if (sec < 21600) ramp = 0.05 + ((sec - 3600) / (21600 - 3600)) * 0.95;
      else                  ramp = 1;
      if (voidEvents.length < 5 && Math.random() < 0.005 * ramp) {
        spawnVoidEvent(Math.floor(Math.random() * 3), Math.floor(Math.random() * 9));
      }
    }

    function drawEye(ev, t, env) {
      const open = t < 0.25 ? t / 0.25 : t > 0.75 ? (1 - t) / 0.25 : 1;
      const w = 60, h = 18 * open;
      for (let a = -1; a <= 1; a += 0.04) {
        const px = ev.x + a * w;
        const py = h * Math.sqrt(Math.max(0, 1 - a * a));
        stampHallucinationDot(px, ev.y - py);
        stampHallucinationDot(px, ev.y + py);
      }
      if (open > 0.6) {
        const pr = 5;
        for (let oy = -pr; oy <= pr; oy++)
          for (let ox = -pr; ox <= pr; ox++)
            if (ox * ox + oy * oy <= pr * pr)
              stampHallucinationDot(ev.x + ox * dotPxX, ev.y + oy * dotPxY);
      }
    }
    function drawRing(ev, t, env) {
      const r = 15 + t * 220;
      const steps = Math.max(24, Math.floor(r * 0.6));
      for (let i = 0; i < steps; i++) {
        if (hashStep(ev.id, i) > env) continue;
        const a = (i / steps) * Math.PI * 2;
        stampHallucinationDot(ev.x + Math.cos(a) * r, ev.y + Math.sin(a) * r);
      }
    }
    function drawSwirl(ev, t, env) {
      const rotate = ev.life * 1.6;
      const maxR = 100 * env;
      for (let a = 0; a < Math.PI * 8; a += 0.07) {
        const r = a * 5;
        if (r > maxR) break;
        stampHallucinationDot(ev.x + Math.cos(a + rotate) * r, ev.y + Math.sin(a + rotate) * r);
      }
    }
    function drawTendril(ev, t, env) {
      const length = 200 * env;
      const segs = 70;
      const cx = Math.cos(ev.angle), cy = Math.sin(ev.angle);
      const nx = -cy, ny = cx;
      for (let i = 0; i < segs; i++) {
        const dist = (i / segs) * length;
        const wob = Math.sin(i * 0.35 - ev.life * 5) * 14;
        stampHallucinationDot(ev.x + cx * dist + nx * wob, ev.y + cy * dist + ny * wob);
      }
    }
    function drawEyes(ev, t, env) {
      const blinkOpen = Math.sin(ev.life * 4) > 0;
      for (let i = 0; i < 8; i++) {
        const ang = (i / 8) * Math.PI * 2 + ev.life * 0.25;
        const dist = 55 + Math.sin(ev.life * 1.5 + i) * 10;
        const ex = ev.x + Math.cos(ang) * dist;
        const ey = ev.y + Math.sin(ang) * dist;
        if (blinkOpen) {
          stampHallucinationDot(ex - dotPxX * 2, ey);
          stampHallucinationDot(ex + dotPxX * 2, ey);
          stampHallucinationDot(ex, ey);
          stampHallucinationDot(ex, ey - dotPxY);
        } else {
          stampHallucinationDot(ex - dotPxX * 2, ey);
          stampHallucinationDot(ex - dotPxX, ey);
          stampHallucinationDot(ex, ey);
          stampHallucinationDot(ex + dotPxX, ey);
          stampHallucinationDot(ex + dotPxX * 2, ey);
        }
      }
    }
    function drawSpiral(ev, t, env) {
      const rotate = ev.life * 1.5;
      const maxR = 130 * env;
      for (let a = 0; a < Math.PI * 14; a += 0.05) {
        const r = Math.exp(a * 0.13) - 1;
        if (r > maxR) break;
        stampHallucinationDot(ev.x + Math.cos(a + rotate) * r, ev.y + Math.sin(a + rotate) * r);
      }
    }
    function drawPolygon(ev, t, env) {
      const r = 70 * env;
      const rotate = ev.life * 0.7;
      for (let i = 0; i < ev.sides; i++) {
        const a1 = (i / ev.sides) * Math.PI * 2 + rotate;
        const a2 = ((i + 1) / ev.sides) * Math.PI * 2 + rotate;
        const x1 = ev.x + Math.cos(a1) * r, y1 = ev.y + Math.sin(a1) * r;
        const x2 = ev.x + Math.cos(a2) * r, y2 = ev.y + Math.sin(a2) * r;
        const segs = 36;
        for (let j = 0; j <= segs; j++) {
          const tt = j / segs;
          stampHallucinationDot(x1 + (x2 - x1) * tt, y1 + (y2 - y1) * tt);
        }
      }
    }
    function drawRain(ev, t, env) {
      const w = 90, h = 220;
      const count = Math.floor(70 * env);
      for (let i = 0; i < count; i++) {
        const r1 = hashStep(ev.id, i);
        const r2 = hashStep(ev.id, i + 8191);
        const px = ev.x + (r2 - 0.5) * w;
        const py = ev.y - h * 0.5 + ((r1 * h - ev.life * 90) % h + h) % h;
        stampHallucinationDot(px, py);
      }
    }
    function drawFace(ev, t, env) {
      // outline
      for (let a = -1; a <= 1; a += 0.035) {
        const px = ev.x + a * 60;
        const py = 80 * Math.sqrt(Math.max(0, 1 - a * a));
        stampHallucinationDot(px, ev.y - py);
        stampHallucinationDot(px, ev.y + py);
      }
      if (env > 0.25) {
        // eyes
        for (const ex of [ev.x - 22, ev.x + 22]) {
          stampHallucinationDot(ex - dotPxX, ev.y - 18);
          stampHallucinationDot(ex,            ev.y - 18);
          stampHallucinationDot(ex + dotPxX,   ev.y - 18);
          stampHallucinationDot(ex,            ev.y - 18 - dotPxY);
        }
        // mouth curve
        for (let a = -1; a <= 1; a += 0.08) {
          const px = ev.x + a * 28;
          const py = ev.y + 28 + Math.sin((a + 1) * Math.PI * 0.5) * 8 * env;
          stampHallucinationDot(px, py);
        }
      }
    }

    // ----- Set 2 (shift+1..9) -------------------------------------------
    function drawStarburst(ev, t, env) {
      const rays = 14;
      const len = 60 + env * 90;
      for (let i = 0; i < rays; i++) {
        const a = (i / rays) * Math.PI * 2 + ev.life * 0.3;
        const segs = Math.max(8, Math.floor(len / dotPxX));
        for (let j = 1; j < segs; j++) {
          const r = (j / segs) * len;
          stampHallucinationDot(ev.x + Math.cos(a) * r, ev.y + Math.sin(a) * r);
        }
      }
    }
    function drawCrack(ev, t, env) {
      const branches = 6;
      const len = 130 * env;
      const segs = 50;
      for (let b = 0; b < branches; b++) {
        let angle = (b / branches) * Math.PI * 2;
        for (let i = 1; i < segs; i++) {
          const dist = (i / segs) * len;
          angle += (hashStep(ev.id, b * 200 + i) - 0.5) * 0.45;
          stampHallucinationDot(ev.x + Math.cos(angle) * dist, ev.y + Math.sin(angle) * dist);
        }
      }
    }
    function drawHelix(ev, t, env) {
      const len = 220, segs = 90;
      const radius = 30 * env;
      const phase = ev.life * 3;
      for (let i = 0; i < segs; i++) {
        const tt = i / segs;
        const x = ev.x + (tt - 0.5) * len;
        stampHallucinationDot(x, ev.y + Math.sin(tt * Math.PI * 4 + phase)         * radius);
        stampHallucinationDot(x, ev.y + Math.sin(tt * Math.PI * 4 + phase + Math.PI) * radius);
      }
    }
    function drawFlower(ev, t, env) {
      const petals = 6;
      const r = 50 * env;
      for (let p = 0; p < petals; p++) {
        const baseA = (p / petals) * Math.PI * 2 + ev.life * 0.4;
        const ca = Math.cos(baseA), sa = Math.sin(baseA);
        for (let theta = 0; theta < Math.PI * 2; theta += 0.12) {
          const ex = Math.cos(theta) * 26 * env;
          const ey = Math.sin(theta) * 12 * env;
          const cx = r * 0.55 * ca, cy = r * 0.55 * sa;
          stampHallucinationDot(ev.x + ex * ca - ey * sa + cx,
                                ev.y + ex * sa + ey * ca + cy);
        }
      }
    }
    function drawWormhole(ev, t, env) {
      const rings = 6;
      for (let i = 0; i < rings; i++) {
        let r = ((i / rings) + 1 - t) * 100;
        r = (r % 100 + 100) % 100;
        if (r < 4) continue;
        const steps = Math.max(16, Math.floor(r * 0.7));
        for (let j = 0; j < steps; j++) {
          const a = (j / steps) * Math.PI * 2;
          stampHallucinationDot(ev.x + Math.cos(a) * r, ev.y + Math.sin(a) * r);
        }
      }
    }
    function drawTextfall(ev, t, env) {
      const cols = 5, h = 200;
      for (let c = 0; c < cols; c++) {
        const cx = ev.x + (c - (cols - 1) * 0.5) * 14;
        const speed = 70 + c * 18;
        for (let i = 0; i < 28; i++) {
          const r = hashStep(ev.id, c * 64 + i);
          const py = ev.y - h * 0.5 + ((r * h - ev.life * speed) % h + h) % h;
          stampHallucinationDot(cx, py);
          stampHallucinationDot(cx + dotPxX, py);
        }
      }
    }
    function drawOrbit(ev, t, env) {
      const orbits = 7;
      stampHallucinationDot(ev.x, ev.y);
      stampHallucinationDot(ev.x + dotPxX, ev.y);
      stampHallucinationDot(ev.x, ev.y + dotPxY);
      for (let i = 0; i < orbits; i++) {
        const r = 25 + i * 12;
        const a = ev.life * (0.5 + i * 0.18) + i * 0.7;
        stampHallucinationDot(ev.x + Math.cos(a) * r, ev.y + Math.sin(a) * r);
        for (let j = 1; j < 5; j++) {
          if (hashStep(ev.id, i * 17 + j) > 0.55) {
            const a2 = a - j * 0.06;
            stampHallucinationDot(ev.x + Math.cos(a2) * r, ev.y + Math.sin(a2) * r);
          }
        }
      }
    }
    function drawRibbon(ev, t, env) {
      const len = 240, segs = 90;
      for (let i = 0; i < segs; i++) {
        const tt = i / segs;
        const x = ev.x + (tt - 0.5) * len;
        const wave = Math.sin(tt * Math.PI * 3 + ev.life * 2) * 22;
        const thickness = Math.sin(tt * Math.PI) * 6 * env;
        for (let k = -thickness; k <= thickness; k += dotPxY) {
          stampHallucinationDot(x, ev.y + wave + k);
        }
      }
    }
    function drawConstellation(ev, t, env) {
      const n = 7;
      const points = [];
      for (let i = 0; i < n; i++) {
        const a = hashStep(ev.id, i) * Math.PI * 2;
        const r = 35 + hashStep(ev.id, i + 100) * 60;
        points.push({ x: ev.x + Math.cos(a) * r, y: ev.y + Math.sin(a) * r });
      }
      for (let i = 0; i < n; i++) {
        const p1 = points[i], p2 = points[(i + 1) % n];
        const segs = 32;
        for (let j = 0; j < segs; j++) {
          const tt = j / segs;
          stampHallucinationDot(p1.x + (p2.x - p1.x) * tt, p1.y + (p2.y - p1.y) * tt);
        }
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++)
            stampHallucinationDot(p1.x + dx * dotPxX, p1.y + dy * dotPxY);
      }
    }

    // ----- Set 3 (ctrl+1..9) --------------------------------------------
    function drawGalaxy(ev, t, env) {
      const arms = 2;
      for (let arm = 0; arm < arms; arm++) {
        for (let a = 0; a < Math.PI * 6; a += 0.06) {
          const r = a * 8;
          if (r > 130 * env) break;
          const ang = a + (arm * Math.PI / arms) + ev.life * 0.25;
          stampHallucinationDot(ev.x + Math.cos(ang) * r, ev.y + Math.sin(ang) * r);
        }
      }
      for (let oy = -3; oy <= 3; oy++)
        for (let ox = -3; ox <= 3; ox++)
          if (ox * ox + oy * oy <= 9)
            stampHallucinationDot(ev.x + ox * dotPxX, ev.y + oy * dotPxY);
    }
    function drawLightning(ev, t, env) {
      let x = ev.x, y = ev.y - 100;
      const segs = 28;
      for (let i = 1; i <= segs; i++) {
        const ty = ev.y - 100 + (200 / segs) * i;
        const tx = ev.x + (hashStep(ev.id, i) - 0.5) * 70;
        const sub = 8;
        for (let j = 0; j < sub; j++) {
          const f = j / sub;
          stampHallucinationDot(x + (tx - x) * f, y + (ty - y) * f);
        }
        x = tx; y = ty;
      }
    }
    function drawBird(ev, t, env) {
      const flap = Math.sin(ev.life * 9);
      const span = 8;
      for (let i = -2; i <= 2; i++) stampHallucinationDot(ev.x + i * dotPxX, ev.y);
      for (let s = -1; s <= 1; s += 2) {
        for (let i = 1; i <= span; i++) {
          const px = ev.x + s * i * dotPxX * 2;
          const py = ev.y + Math.sin(i * 0.25) * flap * 9 - i;
          stampHallucinationDot(px, py);
        }
      }
    }
    function drawVortex(ev, t, env) {
      for (let i = 0; i < 6; i++) {
        const r = 22 + i * 16;
        const phase = ev.life * (1.6 - i * 0.18);
        const steps = Math.floor(r * 0.55);
        for (let j = 0; j < steps; j++) {
          const a = (j / steps) * Math.PI * 2 + phase;
          const k = 1 + Math.sin(a * 3 + ev.life * 2) * 0.22;
          stampHallucinationDot(ev.x + Math.cos(a) * r * k, ev.y + Math.sin(a) * r * k);
        }
      }
    }
    function drawHeart(ev, t, env) {
      const beat = 1 + Math.sin(ev.life * 5) * 0.12;
      const scale = 3.5 * env * beat;
      for (let theta = 0; theta < Math.PI * 2; theta += 0.04) {
        const px = 16 * Math.pow(Math.sin(theta), 3);
        const py = -(13 * Math.cos(theta) - 5 * Math.cos(2 * theta) - 2 * Math.cos(3 * theta) - Math.cos(4 * theta));
        stampHallucinationDot(ev.x + px * scale, ev.y + py * scale);
      }
    }
    function drawMouth(ev, t, env) {
      const open = (Math.sin(ev.life * 2.4) * 0.5 + 0.5) * 28 * env;
      const w = 80;
      for (let theta = 0; theta < Math.PI * 2; theta += 0.05) {
        stampHallucinationDot(
          ev.x + Math.cos(theta) * w * 0.5,
          ev.y + Math.sin(theta) * (open + 4)
        );
      }
      if (open > 7) {
        for (let i = -3; i <= 3; i++) {
          const tx = ev.x + i * 11;
          for (let j = 0; j < 5; j++) {
            stampHallucinationDot(tx, ev.y - open + j * dotPxY);
            stampHallucinationDot(tx, ev.y + open - j * dotPxY);
          }
        }
      }
    }
    function drawGridwave(ev, t, env) {
      const reach = 110;
      for (let i = -2; i <= 2; i++) {
        for (let dx = -reach; dx <= reach; dx += dotPxX) {
          stampHallucinationDot(ev.x + dx, ev.y + i * 26 + Math.sin(dx * 0.05 + ev.life * 3) * 8);
        }
        for (let dy = -reach; dy <= reach; dy += dotPxY) {
          stampHallucinationDot(ev.x + i * 26 + Math.sin(dy * 0.05 + ev.life * 3) * 8, ev.y + dy);
        }
      }
    }
    function drawTunnel(ev, t, env) {
      const rings = 8;
      for (let i = 0; i < rings; i++) {
        const r = 18 + (((i / rings) + ev.life * 0.32) % 1) * 150;
        const steps = Math.max(20, Math.floor(r * 0.55));
        for (let j = 0; j < steps; j++) {
          const a = (j / steps) * Math.PI * 2;
          stampHallucinationDot(ev.x + Math.cos(a) * r, ev.y + Math.sin(a) * r);
        }
      }
    }
    function drawEcho(ev, t, env) {
      const cycle = 1.0;
      for (let i = 0; i < 4; i++) {
        const lt = ev.life - i * cycle / 4;
        if (lt < 0) continue;
        const phase = (lt % cycle) / cycle;
        const r = phase * 110;
        const fade = 1 - phase;
        const steps = Math.max(16, Math.floor(r));
        for (let j = 0; j < steps; j++) {
          if (hashStep(ev.id, i * 1009 + j) > fade) continue;
          const a = (j / steps) * Math.PI * 2;
          stampHallucinationDot(ev.x + Math.cos(a) * r, ev.y + Math.sin(a) * r);
        }
      }
    }

    const FADE_DUR = 1.4;
    for (let i = voidEvents.length - 1; i >= 0; i--) {
      const ev = voidEvents[i];
      ev.life += dt;
      if (ev.life > ev.maxLife) { voidEvents.splice(i, 1); continue; }
      const t = ev.life / ev.maxLife;
      const env = Math.sin(t * Math.PI);
      const fadeIn  = Math.min(1, ev.life / FADE_DUR);
      const fadeOut = Math.min(1, (ev.maxLife - ev.life) / FADE_DUR);
      currentFadeP = Math.max(0, Math.min(fadeIn, fadeOut));
      switch (ev.kind) {
        case 'eye':     drawEye(ev, t, env); break;
        case 'ring':    drawRing(ev, t, env); break;
        case 'swirl':   drawSwirl(ev, t, env); break;
        case 'tendril': drawTendril(ev, t, env); break;
        case 'eyes':    drawEyes(ev, t, env); break;
        case 'spiral':  drawSpiral(ev, t, env); break;
        case 'polygon': drawPolygon(ev, t, env); break;
        case 'rain':    drawRain(ev, t, env); break;
        case 'face':    drawFace(ev, t, env); break;
        case 'starburst':     drawStarburst(ev, t, env); break;
        case 'crack':         drawCrack(ev, t, env); break;
        case 'helix':         drawHelix(ev, t, env); break;
        case 'flower':        drawFlower(ev, t, env); break;
        case 'wormhole':      drawWormhole(ev, t, env); break;
        case 'textfall':      drawTextfall(ev, t, env); break;
        case 'orbit':         drawOrbit(ev, t, env); break;
        case 'ribbon':        drawRibbon(ev, t, env); break;
        case 'constellation': drawConstellation(ev, t, env); break;
        case 'galaxy':    drawGalaxy(ev, t, env); break;
        case 'lightning': drawLightning(ev, t, env); break;
        case 'bird':      drawBird(ev, t, env); break;
        case 'vortex':    drawVortex(ev, t, env); break;
        case 'heart':     drawHeart(ev, t, env); break;
        case 'mouth':     drawMouth(ev, t, env); break;
        case 'gridwave': drawGridwave(ev, t, env); break;
        case 'tunnel':    drawTunnel(ev, t, env); break;
        case 'echo':      drawEcho(ev, t, env); break;
      }
      currentFadeP = 1;
    }

    // Pass 3: draw the dot grid. Simple mode renders solid pixels (one
    // fillRect per dot); otherwise we collapse into braille glyphs.
    ctx.fillStyle = 'rgb(106, 255, 160)';
    const simple = document.body.classList.contains('simple');
    if (simple) {
      ctx.shadowBlur = 0;
      ctx.shadowColor = 'transparent';
      // Pre-compute integer x/y edges for every dot column/row so adjacent
      // pixel rects share an exact edge and never leave 1px hairline gaps.
      const xEdges = new Int32Array(dotCols + 1);
      const yEdges = new Int32Array(dotRows + 1);
      for (let i = 0; i <= dotCols; i++) xEdges[i] = Math.round(offX + i * dotPxX);
      for (let j = 0; j <= dotRows; j++) yEdges[j] = Math.round(offY + j * dotPxY);
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
      for (let cy = 0; cy < rows; cy++) {
        const baseDY = cy * 4;
        const py = offY + cy * CELL_H;
        for (let cx = 0; cx < cols; cx++) {
          const baseDX = cx * 2;
          let bits = 0;
          for (let i = 0; i < 8; i++) {
            const d = DOTS[i];
            if (grid[(baseDY + d[1]) * dotCols + (baseDX + d[0])]) bits |= d[2];
          }
          if (bits === 0) continue;
          ctx.fillText(String.fromCharCode(BRAILLE_BASE | bits), offX + cx * cellW, py);
        }
      }
    }

    // --- mask: clear pixels where real foreground text sits ----------------
    const inVoid = document.body.classList.contains('void');
    let activeRects = maskRects;
    if (inVoid) {
      activeRects = [];
      document.querySelectorAll('.void-hint, .void-counter').forEach(e => {
        const r = e.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          activeRects.push({
            left:   r.left   + sx,
            right:  r.right  + sx,
            top:    r.top    + sy,
            bottom: r.bottom + sy,
          });
        }
      });
    }
    for (let i = 0; i < activeRects.length; i++) {
      const r = activeRects[i];
      const x = r.left   - sx;
      const y = r.top    - realSy;
      const w = r.right  - r.left;
      const h = r.bottom - r.top;
      if (x + w < 0 || y + h < 0 || x > viewW || y > viewH) continue;
      ctx.clearRect(x, y, w, h);
    }
  }

  let rafId = 0;
  let lastDrawT = 0;
  function loop(now) {
    rafId = requestAnimationFrame(loop);
    // Simple mode hides the canvas entirely — skip all rendering work.
    if (document.body.classList.contains('simple')) return;
    // In void: full rAF. Otherwise throttle to ~12fps.
    const inVoid = document.body.classList.contains('void');
    const minDelta = inVoid ? 0 : 83;
    if (now - lastDrawT < minDelta) return;
    lastDrawT = now;
    frame();
  }

  function start() {
    measure();
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => measure());
    }
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);
  }

  window.addEventListener('load', start);
  window.addEventListener('resize', measure);

  if (window.MutationObserver) {
    new MutationObserver((muts) => {
      for (const m of muts) {
        const t = m.target;
        if (t === canvas) continue;
        if (t.nodeType === 1 && t.closest && t.closest('#bg')) continue;
        if (t.parentNode && t.parentNode.closest && t.parentNode.closest('#bg')) continue;
        maskDirty = true;
        return;
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }
})();
