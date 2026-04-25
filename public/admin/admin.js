(function () {
  'use strict';

  const KEY = 'supernova.adminpw';
  let pw = sessionStorage.getItem(KEY) || '';

  const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ESC_MAP[c]);
  const fmtDate = ms => {
    if (!ms) return '';
    const d = new Date(ms), p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };

  function api(method, path, body) {
    return fetch(path, {
      method,
      headers: Object.assign(
        { 'Content-Type': 'application/json' },
        pw ? { 'X-Admin-Password': pw } : {}
      ),
      body: body == null ? undefined : JSON.stringify(body),
    });
  }

  async function probe() {
    if (!pw) return false;
    try {
      const r = await api('GET', '/api/admin/check');
      return r.ok;
    } catch (_) { return false; }
  }

  function showAdmin(on) {
    document.getElementById('login-section').hidden     = on;
    document.getElementById('new-post-section').hidden  = !on;
    document.getElementById('post-list-section').hidden = !on;
    document.getElementById('comments-section').hidden  = !on;
    document.getElementById('meta-section').hidden      = !on;
    document.getElementById('logout-btn').hidden        = !on;
    document.getElementById('who').textContent          = on ? 'yuli' : 'guest';
    if (typeof window.renderAscii === 'function') window.renderAscii();
  }

  async function refreshLists() {
    // posts
    try {
      const posts = await fetch('/api/posts').then(r => r.json());
      const ul = document.getElementById('post-list');
      ul.innerHTML = posts.map(p => `
        <li class="post-row" data-id="${p.id}">
          <div>
            <a href="../template.html?slug=${encodeURIComponent(p.slug)}" class="post-title">${esc(p.title)}</a>
            <div class="meta">${fmtDate(p.createdAt)} &middot; /${esc(p.slug)}/${
              p.category ? ' &middot; [' + esc(p.category.name) + ']' : ''
            }${
              p.tags && p.tags.length ? ' &middot; ' + p.tags.map(t => '[' + esc(t.name) + ']').join(' ') : ''
            }</div>
          </div>
          <div class="actions">
            <button type="button" data-act="delete" class="danger">[ delete ]</button>
          </div>
        </li>
      `).join('') || '<li class="meta">no posts yet.</li>';
    } catch (e) {}

    // categories (with inline rename)
    try {
      const cats = await fetch('/api/categories').then(r => r.json());
      document.getElementById('cat-list').innerHTML = cats.map(c => `
        <li class="post-row" data-id="${c.id}" data-kind="cat">
          <span>
            <input type="text" data-field="name" value="${esc(c.name)}" />
            <span class="meta">(${esc(c.slug)})</span>
          </span>
          <div class="actions">
            <button type="button" data-act="rename-cat">[ rename ]</button>
            <button type="button" data-act="delete-cat" class="danger">[ delete ]</button>
          </div>
        </li>
      `).join('') || '<li class="meta">none.</li>';
    } catch (e) {}

    // tags (with inline rename + chip bank for the new-post form)
    try {
      const tags = await fetch('/api/tags').then(r => r.json());
      document.getElementById('tag-list').innerHTML = tags.map(t => `
        <li class="post-row" data-id="${t.id}" data-kind="tag">
          <span>
            <input type="text" data-field="name" value="${esc(t.name)}" />
            <span class="meta">(${esc(t.slug)})</span>
          </span>
          <div class="actions">
            <button type="button" data-act="rename-tag">[ rename ]</button>
            <button type="button" data-act="delete-tag" class="danger">[ delete ]</button>
          </div>
        </li>
      `).join('') || '<li class="meta">none.</li>';

      const bank = document.getElementById('tag-bank');
      if (bank) {
        bank.innerHTML = tags.length
          ? tags.map(t => `<button type="button" class="tag-chip" data-act="pick-tag" data-name="${esc(t.name)}">[${esc(t.name)}]</button>`).join(' ')
          : '<span class="meta">no tags yet.</span>';
      }
    } catch (e) {}

    await refreshComments();

    if (typeof window.renderAscii === 'function') window.renderAscii();
  }

  async function refreshComments() {
    const ul = document.getElementById('comments-list');
    if (!ul) return;
    const status = (document.getElementById('comments-status') || {}).value || 'pending';
    let list = [];
    try {
      const r = await api('GET', '/api/admin/comments?status=' + encodeURIComponent(status));
      if (r.ok) list = await r.json();
    } catch (_) {}
    if (!list.length) {
      ul.innerHTML = `<li class="meta">no ${esc(status)} comments.</li>`;
      return;
    }
    ul.innerHTML = list.map(c => `
      <li class="post-row" data-id="${c.id}" data-ip="${esc(c.ip || '')}">
        <div>
          <div>${esc(c.name)} <span class="meta">on</span>
            <a href="../template.html?slug=${encodeURIComponent(c.postSlug || '')}" class="post-title">${esc(c.postTitle || '(unknown post)')}</a>
          </div>
          <div class="meta">${fmtDate(c.createdAt)} &middot; ${esc(c.status)} &middot; ip ${esc(c.ip || 'unknown')}</div>
          <div class="comment-body">${esc(c.body).replace(/\n/g, '<br>')}</div>
        </div>
        <div class="actions">
          ${c.status === 'pending' ? '<button type="button" data-act="approve">[ approve ]</button>' : ''}
          <button type="button" data-act="delete-comment" class="danger">[ delete ]</button>
          <button type="button" data-act="purge-ip" class="danger">[ purge pending from ip ]</button>
        </div>
      </li>
    `).join('');
    if (typeof window.renderAscii === 'function') window.renderAscii();
  }

  // ---- login ---------------------------------------------------------------
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    pw = document.getElementById('pw').value;
    const msg = document.getElementById('login-msg');
    msg.textContent = '...';
    msg.className = '';
    if (await probe()) {
      sessionStorage.setItem(KEY, pw);
      msg.textContent = 'ok.';
      msg.className = 'ok';
      showAdmin(true);
      await refreshLists();
    } else {
      pw = '';
      sessionStorage.removeItem(KEY);
      msg.textContent = 'denied.';
      msg.className = 'err';
    }
  });

  document.getElementById('logout-btn').addEventListener('click', () => {
    pw = '';
    sessionStorage.removeItem(KEY);
    document.getElementById('pw').value = '';
    showAdmin(false);
  });

  // ---- new post ------------------------------------------------------------
  document.getElementById('post-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('post-msg');
    msg.textContent = '...';
    msg.className = '';
    const tagsRaw = document.getElementById('post-tags').value.trim();
    const tags = tagsRaw ? tagsRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
    const body = {
      title:    document.getElementById('post-title').value.trim(),
      slug:     document.getElementById('post-slug').value.trim() || undefined,
      category: document.getElementById('post-category').value.trim() || null,
      tags,
      body:     document.getElementById('post-body').value,
    };
    const r = await api('POST', '/api/admin/posts', body);
    if (r.ok) {
      msg.textContent = 'published.';
      msg.className = 'ok';
      e.target.reset();
      await refreshLists();
    } else {
      const err = await r.json().catch(() => ({}));
      msg.textContent = 'error: ' + (err.error || r.status);
      msg.className = 'err';
    }
  });

  // ---- cat/tag forms -------------------------------------------------------
  document.getElementById('cat-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('cat-name').value.trim();
    if (!name) return;
    const r = await api('POST', '/api/admin/categories', { name });
    if (r.ok) { e.target.reset(); refreshLists(); }
  });
  document.getElementById('tag-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('tag-name').value.trim();
    if (!name) return;
    const r = await api('POST', '/api/admin/tags', { name });
    if (r.ok) { e.target.reset(); refreshLists(); }
  });

  // ---- delegated delete actions --------------------------------------------
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest && e.target.closest('button[data-act]');
    if (!btn) return;
    const act = btn.getAttribute('data-act');

    // pick-tag has no row — handle it before bailing on missing row.
    if (act === 'pick-tag') {
      const inp = document.getElementById('post-tags');
      if (!inp) return;
      const name = btn.getAttribute('data-name') || '';
      const cur = inp.value.split(',').map(s => s.trim()).filter(Boolean);
      if (!cur.some(s => s.toLowerCase() === name.toLowerCase())) {
        cur.push(name);
        inp.value = cur.join(', ');
      }
      inp.focus();
      return;
    }

    const row = btn.closest('[data-id]');
    if (!row) return;
    const id = row.getAttribute('data-id');
    if (act === 'delete') {
      if (!confirm('delete this post?')) return;
      await api('DELETE', '/api/admin/posts/' + id);
      refreshLists();
    } else if (act === 'delete-cat') {
      if (!confirm('delete this category?')) return;
      await api('DELETE', '/api/admin/categories/' + id);
      refreshLists();
    } else if (act === 'delete-tag') {
      if (!confirm('delete this tag?')) return;
      await api('DELETE', '/api/admin/tags/' + id);
      refreshLists();
    } else if (act === 'rename-cat') {
      const input = row.querySelector('input[data-field=name]');
      const name = input ? input.value.trim() : '';
      if (!name) return;
      await api('PATCH', '/api/admin/categories/' + id, { name });
      refreshLists();
    } else if (act === 'rename-tag') {
      const input = row.querySelector('input[data-field=name]');
      const name = input ? input.value.trim() : '';
      if (!name) return;
      await api('PATCH', '/api/admin/tags/' + id, { name });
      refreshLists();
    } else if (act === 'approve') {
      await api('POST', '/api/admin/comments/' + id + '/approve');
      refreshComments();
    } else if (act === 'delete-comment') {
      if (!confirm('delete this comment?')) return;
      await api('DELETE', '/api/admin/comments/' + id);
      refreshComments();
    } else if (act === 'purge-ip') {
      const ip = row.getAttribute('data-ip') || '';
      if (!ip) return;
      if (!confirm('delete ALL pending comments from ' + ip + '?')) return;
      await api('DELETE', '/api/admin/comments?status=pending&ip=' + encodeURIComponent(ip));
      refreshComments();
    }
  });

  // refresh + status switcher for comments toolbar
  document.addEventListener('change', (e) => {
    if (e.target && e.target.id === 'comments-status') refreshComments();
  });
  document.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'comments-refresh') refreshComments();
  });

  // ---- init ---------------------------------------------------------------
  (async function init() {
    if (await probe()) {
      showAdmin(true);
      await refreshLists();
    } else {
      pw = '';
      sessionStorage.removeItem(KEY);
      showAdmin(false);
    }
  })();
})();
