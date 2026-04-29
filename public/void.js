(function () {
  'use strict';

  const AUDIO_SRC = 'https://mynoise.net/NoiseMachines/intergalacticSoundscapeGenerator.php?l=45454545454545454545&a=1&am=s&title=Black%20Hole&c=1';
  const path = location.pathname;
  const onVoidPage = path === '/void' || path === '/void.html' || path.endsWith('/void.html');

  // ---------- non-void pages: intercept the [stare into the void] link -----
  if (!onVoidPage) {
    document.addEventListener('click', (e) => {
      if (e.defaultPrevented) return;
      if (e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const btn = e.target.closest && e.target.closest('[data-void-link]');
      if (!btn) return;
      e.preventDefault();
      // Open the audio popup synchronously while we still have the user's
      // click as the activation source — otherwise the browser blocks it.
      try {
        window.open(
          AUDIO_SRC,
          'voidaudio',
          'popup=yes,width=440,height=320,left=20,top=20,' +
          'menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=no'
        );
      } catch (_) {}
      const from = encodeURIComponent(location.pathname + location.search);
      sessionStorage.setItem('void-fade', '1');
      document.body.classList.add('fading-out');
      setTimeout(() => {
        location.href = '/void.html?from=' + from;
      }, 480);
    }, true);
    return;
  }

  // ---------- /void.html ---------------------------------------------------

  const hint = document.createElement('div');
  hint.className = 'void-hint';
  hint.textContent = '. . . press [esc] to return . . .';
  document.body.appendChild(hint);

  const counter = document.createElement('div');
  counter.className = 'void-counter';
  document.body.appendChild(counter);

  const startedAt = Date.now();
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
    counter.textContent = `you've been staring at the void for ${fmt(Date.now() - startedAt)}`;
  }
  updateCounter();
  const tickId = setInterval(updateCounter, 1000);
  window.voidElapsedMs = () => Date.now() - startedAt;

  // ----- simple-mode oO overlay -----
  let simpleEl = null, simpleTimer = 0;
  if (document.body.classList.contains('simple')) {
    simpleEl = document.createElement('pre');
    simpleEl.id = 'void-simple-text';
    simpleEl.style.cssText =
      'position:fixed;left:0;top:0;right:0;bottom:0;margin:0;padding:1em;' +
      'background:#000;color:#0f0;font-family:monospace;font-size:14px;' +
      'line-height:1.2;white-space:pre-wrap;word-break:break-all;' +
      'overflow:hidden;z-index:2147483646;';
    document.body.appendChild(simpleEl);
    const regen = () => {
      const cw = 8.5, lh = 17;
      const cols = Math.max(20, Math.floor((window.innerWidth  - 32) / cw));
      const rows = Math.max(10, Math.floor((window.innerHeight - 32) / lh));
      const total = cols * rows;
      let s = '';
      for (let i = 0; i < total; i++) s += Math.random() < 0.5 ? 'o' : 'O';
      simpleEl.textContent = s;
    };
    regen();
    simpleTimer = setInterval(regen, 250);
  }

  function closeAudioPopup() {
    try {
      const popup = window.open('', 'voidaudio');
      if (popup) popup.close();
    } catch (_) {}
  }
  let exiting = false;
  function exit() {
    if (exiting) return;
    exiting = true;
    closeAudioPopup();
    clearInterval(tickId);
    if (simpleTimer) { clearInterval(simpleTimer); simpleTimer = 0; }
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

  window.addEventListener('beforeunload', closeAudioPopup);
  window.addEventListener('pagehide',     closeAudioPopup);
  window.addEventListener('unload',       closeAudioPopup);
})();
