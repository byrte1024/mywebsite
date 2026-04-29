(function () {
  'use strict';

  function isInternal(a) {
    if (!a || a.target === '_blank') return false;
    if (a.hasAttribute('data-no-nav')) return false;
    const href = a.getAttribute('href');
    if (!href) return false;
    if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return false;
    if (/^https?:\/\//i.test(href)) {
      try { return new URL(href).origin === location.origin; }
      catch (_) { return false; }
    }
    return true;
  }

  async function navigate(url, push) {
    let res;
    try { res = await fetch(url, { credentials: 'same-origin' }); }
    catch (_) { location.href = url; return; }
    if (!res.ok) { location.href = url; return; }
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const newPage = doc.querySelector('.page');
    const oldPage = document.querySelector('.page');
    if (!newPage || !oldPage) { location.href = url; return; }

    oldPage.replaceWith(newPage);
    document.title = doc.title || document.title;
    if (push) history.pushState({ supernova: true }, '', url);
    window.scrollTo(0, 0);

    // Re-draw ASCII frame borders for the swapped-in content.
    if (typeof window.renderAscii === 'function') window.renderAscii();
    // Let other modules (posts.js, admin.js) re-init for the new page.
    window.dispatchEvent(new CustomEvent('pageswap', { detail: { url } }));
  }

  document.addEventListener('click', (e) => {
    if (e.defaultPrevented) return;
    if (e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a || !isInternal(a)) return;
    e.preventDefault();
    navigate(a.getAttribute('href'), true);
  });

  window.addEventListener('popstate', () => {
    navigate(location.pathname + location.search, false);
  });
})();
