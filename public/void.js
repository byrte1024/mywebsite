(function () {
  'use strict';

  // Use event delegation so the button works after soft-nav swaps.

  // Hint element shown while in the void.
  const hint = document.createElement('div');
  hint.className = 'void-hint';
  hint.textContent = '. . . press [esc] to return . . .';
  document.body.appendChild(hint);

  // Counter element shown while in the void.
  const counter = document.createElement('div');
  counter.className = 'void-counter';
  counter.textContent = "you've been staring at the void for 0s";
  document.body.appendChild(counter);

  let active = false;
  let startedAt = 0;
  let tickId = 0;
  let timeOffset = 0;

  function getElapsed() {
    return active ? Math.max(0, Date.now() - startedAt + timeOffset) : 0;
  }
  window.voidElapsedMs = getElapsed;

  function fmt(ms) {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h) return `${h}h ${m}m ${sec}s`;
    if (m) return `${m}m ${sec}s`;
    return `${sec}s`;
  }
  function updateCounter() {
    counter.textContent = `you've been staring at the void for ${fmt(getElapsed())}`;
  }

  function onKey(e) {
    if (e.key === 'Escape') exit();
  }

  function setVoidedParam(on) {
    try {
      const url = new URL(location.href);
      if (on) url.searchParams.set('voided', 'true');
      else    url.searchParams.delete('voided');
      history.replaceState(history.state, '', url.toString());
    } catch (_) {}
  }

  const AUDIO_SRC = 'https://mynoise.net/NoiseMachines/intergalacticSoundscapeGenerator.php?l=45454545454545454545&a=1&am=s&title=Black%20Hole&c=1';
  let audioWin = null;

  // ---- simple-mode void: a screen of randomly-cased o/O ------------------
  let simpleEl = null;
  let simpleTimer = 0;
  function showSimpleVoid() {
    if (!simpleEl) {
      simpleEl = document.createElement('pre');
      simpleEl.id = 'void-simple-text';
      simpleEl.style.cssText =
        'position:fixed;left:0;top:0;right:0;bottom:0;margin:0;padding:1em;' +
        'background:#000;color:#0f0;font-family:monospace;font-size:14px;' +
        'line-height:1.2;white-space:pre-wrap;word-break:break-all;' +
        'overflow:hidden;z-index:2147483646;';
      document.body.appendChild(simpleEl);
    }
    simpleEl.style.display = 'block';
    function regen() {
      const cw = 8.5, lh = 17;
      const cols = Math.max(20, Math.floor((window.innerWidth  - 32) / cw));
      const rows = Math.max(10, Math.floor((window.innerHeight - 32) / lh));
      const total = cols * rows;
      let s = '';
      for (let i = 0; i < total; i++) s += Math.random() < 0.5 ? 'o' : 'O';
      simpleEl.textContent = s;
    }
    regen();
    simpleTimer = setInterval(regen, 250);
  }
  function hideSimpleVoid() {
    if (simpleEl) simpleEl.style.display = 'none';
    if (simpleTimer) { clearInterval(simpleTimer); simpleTimer = 0; }
  }

  function enter(e) {
    if (active) return;
    if (e && e.stopPropagation) e.stopPropagation();
    active = true;
    startedAt = Date.now();
    timeOffset = 0;
    updateCounter();
    tickId = setInterval(updateCounter, 1000);
    document.body.classList.add('void');
    setVoidedParam(true);
    if (document.body.classList.contains('simple')) showSimpleVoid();

    // mynoise refuses to be iframed (X-Frame-Options: sameorigin), so open it
    // in a small popup window. The user will need to click play inside it
    // once because browsers block cross-origin audio autoplay.
    try {
      audioWin = window.open(
        AUDIO_SRC,
        'voidaudio',
        'popup=yes,width=440,height=320,left=20,top=20,' +
        'menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=no'
      );
    } catch (_) { audioWin = null; }

    setTimeout(() => {
      window.addEventListener('keydown', onKey);
    }, 0);
  }

  function exit() {
    if (!active) return;
    active = false;
    document.body.classList.remove('void');
    setVoidedParam(false);
    window.removeEventListener('keydown', onKey);
    clearInterval(tickId);
    hideSimpleVoid();
    if (audioWin && !audioWin.closed) {
      try { audioWin.close(); } catch (_) {}
    }
    audioWin = null;
  }

  document.addEventListener('click', (e) => {
    const t = e.target.closest && e.target.closest('.void-btn');
    if (t) enter(e);
  });

  // If the parent tab/window is closing or reloading, take the audio popup
  // with it so it isn't orphaned. beforeunload fires synchronously before
  // close, which is the only reliable hook on a hard tab-close.
  function closePopup() {
    if (audioWin && !audioWin.closed) {
      try { audioWin.close(); } catch (_) {}
    }
    audioWin = null;
  }
  window.addEventListener('beforeunload', closePopup);
  window.addEventListener('pagehide',     closePopup);
  window.addEventListener('unload',       closePopup);

  // Auto-enter the void if the URL is shared with ?voided=true.
  function autoEnterIfRequested() {
    if (active) return;
    const params = new URLSearchParams(location.search);
    if (params.get('voided') === 'true') enter(null);
  }
  if (new URLSearchParams(location.search).get('voided') === 'true') {
    // Defer slightly so the page is fully wired before showing the overlay.
    setTimeout(autoEnterIfRequested, 50);
  }

  // After soft-nav swaps the page, re-stamp the URL so the param survives.
  window.addEventListener('pageswap', () => {
    if (active) setVoidedParam(true);
  });
})();
