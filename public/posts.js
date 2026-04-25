(function () {
  'use strict';

  const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ESC_MAP[c]); }

  function fmtDate(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function getQuerySlug() {
    const params = new URLSearchParams(location.search);
    return params.get('slug') || params.get('post') || '';
  }

  function pageKind() {
    // Vercel cleanUrls strips .html, so accept both /template and
    // /template.html (and likewise for index).
    let p = location.pathname.replace(/\/+$/, '').toLowerCase();
    if (p === '') return 'home';
    if (p === '/index' || p.endsWith('/index.html')) return 'home';
    if (p === '/template' || p.endsWith('/template.html')) return 'post';
    return 'other';
  }

  function getActiveTags() {
    return new URLSearchParams(location.search).getAll('tag');
  }
  function tagChip(t) {
    const active = getActiveTags().includes(t.slug);
    return `<button type="button" class="tag-chip${active ? ' active' : ''}" data-slug="${esc(t.slug)}" data-name="${esc(t.name)}">[${esc(t.name)}]</button>`;
  }
  function catChip(c) {
    return `<a href="index.html?category=${encodeURIComponent(c.slug)}" class="tag-chip">[${esc(c.name)}]</a>`;
  }

  // Toggle a tag chip on/off. Clicking the active tag clears it; clicking
  // another switches the filter.
  // Read more / read less for long comments.
  document.addEventListener('click', (e) => {
    const t = e.target.closest && e.target.closest('.comment-toggle');
    if (!t) return;
    const wrap = t.closest('.comment-body-wrap');
    if (!wrap) return;
    const body = wrap.querySelector('.comment-body');
    if (!body) return;
    const nowCollapsed = body.classList.toggle('collapsed');
    t.textContent = nowCollapsed ? '[ read more ]' : '[ read less ]';
    // Resize the ASCII frame around the comments section to match the new height.
    if (typeof window.renderAscii === 'function') window.renderAscii();
  });

  document.addEventListener('click', (e) => {
    const btn = e.target.closest && e.target.closest('button.tag-chip[data-slug]');
    if (!btn) return;
    e.preventDefault();
    const slug = btn.getAttribute('data-slug');
    const params = new URLSearchParams(location.search);
    const current = params.getAll('tag');
    const next = current.includes(slug)
      ? current.filter(s => s !== slug)
      : current.concat([slug]);
    params.delete('tag');
    for (const s of next) params.append('tag', s);
    const qs = params.toString();
    const path = location.pathname;
    const isHome = path === '/' || path.endsWith('/index.html');
    const target = '/index.html' + (qs ? '?' + qs : '');
    if (isHome) {
      history.pushState({}, '', target);
      renderHome();
    } else {
      location.href = target;
    }
  });

  async function renderTagList() {
    const el = document.getElementById('tag-list');
    if (!el) return;
    try {
      const tags = await fetch('/api/tags').then(r => r.ok ? r.json() : []);
      if (!tags.length) { el.textContent = 'none yet.'; return; }
      el.innerHTML = tags.map(tagChip).join(' ');
    } catch (_) { el.textContent = ''; }
  }

  async function renderHome() {
    renderTagList();
    const list = document.querySelector('.posts');
    if (!list) return;
    const params = new URLSearchParams(location.search);
    const tags = params.getAll('tag');
    const cat  = params.get('category') || '';
    const q    = params.get('q') || '';

    // filter banner
    const main = list.closest('main.frame');
    let banner = main ? main.querySelector('.filter-banner') : null;
    if (tags.length || cat || q) {
      if (!banner) {
        banner = document.createElement('div');
        banner.className = 'filter-banner meta';
        main.insertBefore(banner, list);
      }
      const parts = [];
      if (tags.length) {
        const labels = tags.map(t => '<span class="hl">[' + esc(t) + ']</span>').join(' ');
        parts.push((tags.length === 1 ? 'tag ' : 'tags ') + labels);
      }
      if (cat) parts.push('category <span class="hl">[' + esc(cat) + ']</span>');
      if (q)   parts.push('search <span class="hl">"' + esc(q) + '"</span>');
      banner.innerHTML = 'filtering by ' + parts.join(' and ');
    } else if (banner) {
      banner.remove();
    }

    list.innerHTML = '<li class="meta">loading transmissions...</li>';
    const url = new URL('/api/posts', location.origin);
    for (const t of tags) url.searchParams.append('tag', t);
    if (cat) url.searchParams.set('category', cat);
    if (q)   url.searchParams.set('q', q);
    let posts;
    try {
      posts = await fetch(url).then(r => r.ok ? r.json() : []);
    } catch (_) { posts = []; }
    if (!posts.length) {
      list.innerHTML = '<li class="meta">no posts match.</li>';
      if (typeof window.renderAscii === 'function') window.renderAscii();
      return;
    }
    list.innerHTML = posts.map(p => `
      <li>
        <a href="template.html?slug=${encodeURIComponent(p.slug)}" class="post-title">${esc(p.title)}</a>
        <div class="meta">yuli &middot; ${fmtDate(p.createdAt)}${
          p.category ? ' &middot; ' + catChip(p.category) : ''
        }${
          p.tags && p.tags.length ? ' &middot; ' + p.tags.map(tagChip).join(' ') : ''
        }</div>
        <p class="excerpt">${esc((p.body || '').slice(0, 140))}${(p.body || '').length > 140 ? '...' : ''}</p>
      </li>
    `).join('');
    if (typeof window.renderAscii === 'function') window.renderAscii();
  }

  async function renderPost() {
    const slug = getQuerySlug();
    const article = document.querySelector('article.frame');
    if (!article) return;
    const titleEl = article.querySelector('.post-title');
    const metaEl  = article.querySelector('.meta');
    const bodyEl  = article.querySelector('.body');
    if (!slug) {
      if (titleEl) titleEl.textContent = 'no post selected';
      if (metaEl)  metaEl.textContent = '';
      if (bodyEl)  bodyEl.innerHTML = '<p>missing slug.</p>';
      return;
    }
    if (titleEl) titleEl.textContent = 'loading...';
    if (metaEl)  metaEl.textContent = '';
    if (bodyEl)  bodyEl.innerHTML = '';
    let post;
    try {
      const res = await fetch('/api/posts/' + encodeURIComponent(slug));
      if (!res.ok) throw new Error(String(res.status));
      post = await res.json();
    } catch (_) {
      if (titleEl) titleEl.textContent = 'not found';
      if (bodyEl)  bodyEl.innerHTML = '<p>this transmission does not exist.</p>';
      return;
    }
    document.title = post.title + " :: supernovayuli's blog";
    if (titleEl) titleEl.textContent = post.title;
    if (metaEl) {
      const tagStr = (post.tags || []).map(tagChip).join(' ');
      metaEl.innerHTML = `by <span class="author">yuli</span> &middot; ${fmtDate(post.createdAt)}${
        post.category ? ' &middot; ' + catChip(post.category) : ''
      }${tagStr ? ' &middot; ' + tagStr : ''}`;
    }
    if (bodyEl) {
      const paragraphs = (post.body || '').split(/\n\s*\n/).map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`);
      bodyEl.innerHTML = paragraphs.join('') + '<p class="sig">-- yuli</p>';
    }
    await renderComments(slug);
    wireCommentForm(slug);
    if (typeof window.renderAscii === 'function') window.renderAscii();
  }

  async function renderComments(slug) {
    const section = document.querySelector('section[data-title^="comments"]');
    if (!section) return;
    const ul = section.querySelector('.replies');
    if (!ul) return;
    let comments = [];
    try {
      comments = await fetch('/api/posts/' + encodeURIComponent(slug) + '/comments')
        .then(r => r.ok ? r.json() : []);
    } catch (_) {}
    section.dataset.title = `comments (${comments.length})`;
    if (!comments.length) {
      ul.innerHTML = '<li class="meta">no comments yet.</li>';
      return;
    }
    // Always render the wrapper with a clamp + button. After paint, measure
    // each: if the content fits within the line-clamp, drop the wrapper so
    // short comments stay clean.
    ul.innerHTML = comments.map(c => {
      const text = esc(c.body || '').replace(/\n/g, '<br>');
      return `
        <li>
          <div class="meta">${esc(c.name)} &middot; ${fmtDate(c.createdAt)}</div>
          <div class="comment-body-wrap">
            <p class="comment-body collapsed">${text}</p>
            <button type="button" class="comment-toggle" hidden>[ read more ]</button>
          </div>
        </li>`;
    }).join('');

    // Measure on next frame so layout is settled.
    requestAnimationFrame(() => {
      ul.querySelectorAll('.comment-body-wrap').forEach(wrap => {
        const body = wrap.querySelector('.comment-body');
        const btn  = wrap.querySelector('.comment-toggle');
        if (!body || !btn) return;
        if (body.scrollHeight - body.clientHeight > 2) {
          btn.hidden = false;
        } else {
          body.classList.remove('collapsed');
        }
      });
      // Re-render the ASCII frame borders now that comment heights are final.
      if (typeof window.renderAscii === 'function') window.renderAscii();
    });
  }

  function wireCommentForm(slug) {
    const form = document.querySelector('form.compose');
    if (!form || form.dataset.wired === '1') return;
    form.dataset.wired = '1';
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const nameInput = form.querySelector('input[type=text]');
      const ta = form.querySelector('textarea');
      const name = nameInput ? nameInput.value.trim() : '';
      const body = ta ? ta.value.trim() : '';
      const msg = ensureMsgEl(form);
      if (!body) { msg.textContent = 'say something first.'; msg.className = 'compose-msg err'; return; }
      msg.textContent = 'sending...';
      msg.className = 'compose-msg';
      try {
        const r = await fetch('/api/posts/' + encodeURIComponent(slug) + '/comments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, body }),
        });
        if (r.ok) {
          if (ta) ta.value = '';
          msg.innerHTML = 'thanks! your comment has been received and will appear here once yuli approves it.';
          msg.className = 'compose-msg ok';
        } else {
          const err = await r.json().catch(() => ({}));
          msg.textContent = 'error: ' + (err.error || r.status);
          msg.className = 'compose-msg err';
        }
      } catch (_) {
        msg.textContent = 'network error.';
        msg.className = 'compose-msg err';
      }
    });
  }
  function ensureMsgEl(form) {
    let m = form.querySelector('.compose-msg');
    if (!m) {
      m = document.createElement('div');
      m.className = 'compose-msg';
      form.appendChild(m);
    }
    return m;
  }

  function init() {
    const kind = pageKind();
    if (kind === 'home') renderHome();
    else if (kind === 'post') renderPost();
  }

  window.addEventListener('load', init);
  window.addEventListener('pageswap', init);
})();
