(function () {
  'use strict';

  // Box-drawing character sets, picked by detail level (cell size).
  // Coarse cells -> simpler ASCII. Fine cells -> unicode lines.
  const STYLES = {
    fine:   { tl:'┌', tr:'┐', bl:'└', br:'┘', h:'─', v:'│', t:'┬', b:'┴' },
    mid:    { tl:'+', tr:'+', bl:'+', br:'+', h:'-', v:'|', t:'+', b:'+' },
    coarse: { tl:'#', tr:'#', bl:'#', br:'#', h:'=', v:'#', t:'#', b:'#' },
  };

  // Measure the size of a single monospace character cell at the current scale.
  // We create a hidden span, fill it with a known number of chars, and read its
  // bounding box. Re-run whenever the page scale (zoom) changes.
  function measureCell() {
    const probe = document.createElement('span');
    probe.style.position = 'absolute';
    probe.style.visibility = 'hidden';
    probe.style.whiteSpace = 'pre';
    probe.style.font = getComputedStyle(document.body).font;
    probe.style.lineHeight = getComputedStyle(document.body).lineHeight;
    probe.textContent = 'M'.repeat(100) + '\n' + 'M'.repeat(100);
    document.body.appendChild(probe);
    const rect = probe.getBoundingClientRect();
    document.body.removeChild(probe);
    return {
      w: rect.width / 100,
      h: rect.height / 2,
    };
  }

  function pickStyle(cellW) {
    // The browser zoom level changes how big a CSS px renders, but cellW in CSS px
    // stays roughly constant. Instead we key the style on devicePixelRatio, which
    // browsers update with zoom, so the ASCII coarsens as you zoom out.
    const dpr = window.devicePixelRatio || 1;
    if (dpr >= 1.25) return STYLES.fine;
    if (dpr >= 0.75) return STYLES.mid;
    return STYLES.coarse;
  }

  function drawFrame(el, cell, style) {
    const rect = el.getBoundingClientRect();
    const cols = Math.max(4, Math.round(rect.width  / cell.w));
    const rows = Math.max(3, Math.round(rect.height / cell.h));

    const title = el.dataset.title || '';
    // Build top row: ┌── title ──────────┐
    let top = style.tl;
    const innerCols = cols - 2;
    if (title && title.length + 4 <= innerCols) {
      const label = ' ' + title + ' ';
      const left  = 2;
      const right = innerCols - label.length - left;
      top += style.h.repeat(left) + label + style.h.repeat(right);
    } else {
      top += style.h.repeat(innerCols);
    }
    top += style.tr;

    const mid = style.v + ' '.repeat(cols - 2) + style.v;
    const bot = style.bl + style.h.repeat(cols - 2) + style.br;

    const lines = [top];
    for (let i = 0; i < rows - 2; i++) lines.push(mid);
    lines.push(bot);

    const text = lines.join('\n');

    let border = el.querySelector(':scope > .ascii-border');
    if (!border) {
      border = document.createElement('pre');
      border.className = 'ascii-border';
      el.insertBefore(border, el.firstChild);
    }
    border.textContent = text;
  }

  function render() {
    const cell = measureCell();
    const style = pickStyle(cell.w);
    // Sync CSS padding to whole character cells so content never overlaps the border.
    document.documentElement.style.setProperty('--cell-w', cell.w + 'px');
    document.documentElement.style.setProperty('--cell-h', cell.h + 'px');
    document.querySelectorAll('.frame').forEach(el => drawFrame(el, cell, style));
    const readout = document.getElementById('scale-readout');
    if (readout) {
      const dpr = (window.devicePixelRatio || 1).toFixed(2);
      readout.textContent = `scale: ${dpr} | cell: ${cell.w.toFixed(1)}x${cell.h.toFixed(1)}px`;
    }
  }

  let raf = 0;
  function schedule() {
    if (raf) cancelAnimationFrame(raf);
    raf = requestAnimationFrame(render);
  }

  window.renderAscii = render;
  window.addEventListener('load', render);
  window.addEventListener('resize', schedule);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', schedule);
    window.visualViewport.addEventListener('scroll', schedule);
  }
  // devicePixelRatio changes (zoom) — listen via matchMedia.
  function watchDpr() {
    const mq = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    mq.addEventListener('change', () => { schedule(); watchDpr(); }, { once: true });
  }
  watchDpr();
})();
