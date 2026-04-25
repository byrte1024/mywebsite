(function () {
  'use strict';

  function getCookie(name) {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : '';
  }
  function setCookie(name, value, days) {
    const exp = new Date(Date.now() + days * 86400000).toUTCString();
    document.cookie = name + '=' + encodeURIComponent(value) + '; expires=' + exp + '; path=/; SameSite=Lax';
  }

  function isOn() { return getCookie('simplemode') === '1'; }

  function apply() {
    const on = isOn();
    document.body.classList.toggle('simple', on);
    document.querySelectorAll('.simple-mode-btn').forEach(b => b.classList.toggle('active', on));
  }

  // Apply ASAP so other scripts (boot, bg, ascii) see the class on first run.
  if (document.body) apply();
  else document.addEventListener('DOMContentLoaded', apply, { once: true });

  document.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('.simple-mode-btn');
    if (!btn) return;
    setCookie('simplemode', isOn() ? '0' : '1', 365);
    location.reload();
  });
})();
