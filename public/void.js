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

  const AUDIO_SRC = 'https://mynoise.net/NoiseMachines/intergalacticSoundscapeGenerator.php?l=45454545454545454545&a=1&am=s&title=Black%20Hole&c=1';
  let audioWin = null;

  function enter(e) {
    if (active) return;
    e.stopPropagation();
    active = true;
    startedAt = Date.now();
    timeOffset = 0;
    updateCounter();
    tickId = setInterval(updateCounter, 1000);
    document.body.classList.add('void');

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
    window.removeEventListener('keydown', onKey);
    clearInterval(tickId);
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
})();
