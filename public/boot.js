(function () {
  'use strict';

  const ART = String.raw`
        .       *          .            ·        *               .         ✦
   ·        ✦          .         *               ·        .              *
              .                *           ✦                  .       ·
 ▄▄▄▄▄▄▄                         ▄▄▄    ▄▄▄                   ▄▄▄   ▄▄▄       ▄▄
█████▀▀▀                         ████▄  ███                   ███   ███       ██ ▀▀
 ▀████▄  ██ ██ ████▄ ▄█▀█▄ ████▄ ███▀██▄███ ▄███▄ ██ ██  ▀▀█▄ ▀███▄███▀ ██ ██ ██ ██
   ▀████ ██ ██ ██ ██ ██▄█▀ ██ ▀▀ ███  ▀████ ██ ██ ██▄██ ▄█▀██   ▀███▀   ██ ██ ██ ██
███████▀ ▀██▀█ ████▀ ▀█▄▄▄ ██    ███    ███ ▀███▀  ▀█▀  ▀█▄██    ███    ▀██▀█ ██ ██▄
               ██                                                       ·
   *           ▀▀          .             ✦                  ·                 *
        .              ·          .          *           ✦         .
 ✦              *         .              ·                  *          .
`;

  const LINES = [
    '[ OK ] BIOS .................. v0.0.1 alpha',
    '[ OK ] mounting /dev/star0 ... ok',
    '[ OK ] checking signal ....... 50/60Hz nominal',
    '[ OK ] loading kernel modules. ascii.ko, crt.ko, vibes.ko',
    '[ OK ] starting blog daemon .. pid 1138',
    '[ OK ] fetching posts ........ 5 entries',
    '[ OK ] grounding boots ....... ok',
    '[ OK ] welcome, reader.',
    '',
    'launching supernovayuli/blog ...',
  ];

  const boot = document.getElementById('boot');
  const artEl = document.getElementById('boot-art');
  const logEl = document.getElementById('boot-log');
  if (!boot) return;

  // If user has already seen the boot this session, skip.
  if (sessionStorage.getItem('booted') === '1') {
    boot.remove();
    return;
  }

  let cancelled = false;

  function finish() {
    if (cancelled) return;
    cancelled = true;
    sessionStorage.setItem('booted', '1');
    boot.classList.add('boot-out');
    setTimeout(() => boot.remove(), 500);
  }

  // Animate art typing in (chunks for speed), then log lines one at a time.
  async function run() {
    artEl.textContent = '';
    const chunkSize = 12;
    for (let i = 0; i < ART.length; i += chunkSize) {
      if (cancelled) return;
      artEl.textContent += ART.slice(i, i + chunkSize);
      await sleep(8);
    }
    await sleep(180);

    for (const line of LINES) {
      if (cancelled) return;
      logEl.textContent += line + '\n';
      await sleep(line === '' ? 120 : 220);
    }
    await sleep(450);
    finish();
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  document.addEventListener('keydown', (e) => {
    // Don't let Ctrl+Q skip — that's the replay shortcut.
    if (e.ctrlKey && (e.key === 'q' || e.key === 'Q')) return;
    finish();
  }, { once: true });
  boot.addEventListener('click', finish, { once: true });

  run();
})();

// Ctrl+Q: replay the boot animation.
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && (e.key === 'q' || e.key === 'Q')) {
    e.preventDefault();
    sessionStorage.removeItem('booted');
    location.reload();
  }
});

