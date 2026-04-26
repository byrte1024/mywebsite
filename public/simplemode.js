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

  // Strip every existing stylesheet, then drop in our small old-school sheet.
  // Keeps the swap going so any later-injected styles get killed too.
  function swapToSimpleCSS() {
    function kill(el) {
      if (!el || el.dataset.simple === '1') return;
      try { el.disabled = true; } catch (_) {}
      if (el.sheet) { try { el.sheet.disabled = true; } catch (_) {} }
      if (el.parentNode) el.parentNode.removeChild(el);
    }
    document.querySelectorAll('link[rel="stylesheet"], style').forEach(kill);
    if (!document.querySelector('link[data-simple="1"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = '/simple.css';
      link.dataset.simple = '1';
      (document.head || document.documentElement).appendChild(link);
    }
    new MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if (n.tagName === 'STYLE') kill(n);
        else if (n.tagName === 'LINK' && (n.rel || '').toLowerCase() === 'stylesheet') kill(n);
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  function apply() {
    const on = isOn();
    document.body.classList.toggle('simple', on);
    document.querySelectorAll('.simple-mode-btn').forEach(b => b.classList.toggle('active', on));
    if (on) {
      swapToSimpleCSS();
      const bg   = document.getElementById('bg');   if (bg)   bg.style.display = 'none';
      const boot = document.getElementById('boot'); if (boot) boot.style.display = 'none';
    }
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
