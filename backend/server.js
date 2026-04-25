'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const DATA_FILE = path.join(__dirname, 'data.json');
const CONFIG_FILE = path.join(__dirname, 'config.json');
const STATIC_DIR = path.resolve(__dirname, '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.ico':  'image/x-icon',
  '.txt':  'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
};

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath || '/');
  if (rel === '' || rel === '/') rel = '/index.html';
  if (rel.endsWith('/'))         rel = rel + 'index.html';
  // Resolve against STATIC_DIR and ensure we never escape it (no `..` traversal,
  // no symlink shenanigans into the project root).
  const filePath = path.resolve(STATIC_DIR, '.' + rel);
  if (filePath !== STATIC_DIR && !filePath.startsWith(STATIC_DIR + path.sep)) {
    return send(res, 403, { error: 'forbidden' });
  }
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) return send(res, 404, { error: 'not found' });
    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('[config] read failed:', err.message);
    return {};
  }
}

const config = loadConfig();
const PORT = parseInt(process.env.PORT, 10) || config.port || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || config.adminPassword || '';
if (!ADMIN_PASSWORD) {
  console.warn('[warn] no admin password configured (config.json:adminPassword or $ADMIN_PASSWORD) — admin endpoints will reject.');
}

// ---------------------------------------------------------------------------
// storage
// ---------------------------------------------------------------------------

function emptyStore() {
  return { posts: [], categories: [], tags: [], comments: [], nextId: 1 };
}

function loadStore() {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return Object.assign(emptyStore(), parsed);
  } catch (err) {
    if (err.code !== 'ENOENT') console.error('[store] read failed:', err.message);
    return emptyStore();
  }
}

function saveStore(store) {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

let store = loadStore();
function nextId() { return store.nextId++; }

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'untitled';
}

// ---------------------------------------------------------------------------
// auth
// ---------------------------------------------------------------------------

function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.socket.remoteAddress || '';
}

function commentPublicView(c) {
  return { id: c.id, postId: c.postId, name: c.name, body: c.body, createdAt: c.createdAt };
}

function checkAdmin(req) {
  if (!ADMIN_PASSWORD) return false;
  const provided = req.headers['x-admin-password'];
  if (typeof provided !== 'string') return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(ADMIN_PASSWORD);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// http helpers
// ---------------------------------------------------------------------------

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Admin-Password');
}

function send(res, status, body, headers) {
  cors(res);
  const isJson = body && typeof body === 'object';
  const payload = isJson ? JSON.stringify(body) : (body || '');
  res.writeHead(status, Object.assign({
    'Content-Type': isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  }, headers || {}));
  res.end(payload);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > 1_000_000) { req.destroy(); reject(new Error('payload too large')); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch (_) { reject(new Error('invalid json')); }
    });
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// resource ops
// ---------------------------------------------------------------------------

function ensureCategory(idOrSlugOrName) {
  if (idOrSlugOrName == null) return null;
  const v = String(idOrSlugOrName);
  return store.categories.find(c =>
    String(c.id) === v || c.slug === v || c.name.toLowerCase() === v.toLowerCase()
  ) || null;
}

function ensureTag(idOrSlugOrName) {
  if (idOrSlugOrName == null) return null;
  const v = String(idOrSlugOrName);
  return store.tags.find(t =>
    String(t.id) === v || t.slug === v || t.name.toLowerCase() === v.toLowerCase()
  ) || null;
}

function postPublicView(p) {
  const cat = store.categories.find(c => c.id === p.categoryId) || null;
  const tags = (p.tagIds || []).map(id => store.tags.find(t => t.id === id)).filter(Boolean);
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    body: p.body,
    category: cat ? { id: cat.id, slug: cat.slug, name: cat.name } : null,
    tags: tags.map(t => ({ id: t.id, slug: t.slug, name: t.name })),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// router
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const method = req.method.toUpperCase();
  const parts = url.pathname.split('/').filter(Boolean);

  if (method === 'OPTIONS') return send(res, 204, '');

  try {
    // -------- public reads -------------------------------------------------
    if (method === 'GET' && parts[0] === 'api' && parts[1] === 'posts' && parts.length === 2) {
      const cat  = url.searchParams.get('category');
      const tags = url.searchParams.getAll('tag');
      const q    = (url.searchParams.get('q') || '').toLowerCase();
      let list = store.posts.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      if (cat) {
        const c = ensureCategory(cat);
        list = c ? list.filter(p => p.categoryId === c.id) : [];
      }
      if (tags.length) {
        // AND: post must have every selected tag.
        const matched = tags.map(s => ensureTag(s)).filter(Boolean);
        if (matched.length !== tags.length) {
          list = [];
        } else {
          const ids = matched.map(t => t.id);
          list = list.filter(p => ids.every(id => (p.tagIds || []).includes(id)));
        }
      }
      if (q) list = list.filter(p =>
        p.title.toLowerCase().includes(q) || p.body.toLowerCase().includes(q)
      );
      return send(res, 200, list.map(postPublicView));
    }

    if (method === 'GET' && parts[0] === 'api' && parts[1] === 'posts' && parts.length === 3) {
      const key = parts[2];
      const post = store.posts.find(p => String(p.id) === key || p.slug === key);
      if (!post) return send(res, 404, { error: 'not found' });
      return send(res, 200, postPublicView(post));
    }

    // approved comments for a single post
    if (method === 'GET' && parts[0] === 'api' && parts[1] === 'posts' &&
        parts.length === 4 && parts[3] === 'comments') {
      const key = parts[2];
      const post = store.posts.find(p => String(p.id) === key || p.slug === key);
      if (!post) return send(res, 404, { error: 'not found' });
      const list = store.comments
        .filter(c => c.postId === post.id && c.status === 'approved')
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
        .map(commentPublicView);
      return send(res, 200, list);
    }

    // submit a new comment (always lands as pending)
    if (method === 'POST' && parts[0] === 'api' && parts[1] === 'posts' &&
        parts.length === 4 && parts[3] === 'comments') {
      const key = parts[2];
      const post = store.posts.find(p => String(p.id) === key || p.slug === key);
      if (!post) return send(res, 404, { error: 'not found' });
      const body = await readJsonBody(req);
      const name = String(body.name || 'anonymous').trim().slice(0, 80) || 'anonymous';
      const text = String(body.body || '').trim().slice(0, 4000);
      if (!text) return send(res, 400, { error: 'body required' });
      const c = {
        id: nextId(),
        postId: post.id,
        name,
        body: text,
        ip: clientIp(req),
        status: 'pending',
        createdAt: Date.now(),
      };
      store.comments.push(c);
      saveStore(store);
      return send(res, 201, { ok: true, status: 'pending' });
    }

    if (method === 'GET' && parts[0] === 'api' && parts[1] === 'categories' && parts.length === 2) {
      return send(res, 200, store.categories);
    }
    if (method === 'GET' && parts[0] === 'api' && parts[1] === 'tags' && parts.length === 2) {
      return send(res, 200, store.tags);
    }

    // -------- admin writes -------------------------------------------------
    const isAdminRoute = parts[0] === 'api' && parts[1] === 'admin';
    if (isAdminRoute) {
      if (!checkAdmin(req)) return send(res, 401, { error: 'unauthorized' });

      // probe endpoint so the admin UI can validate the password
      if (parts[2] === 'check' && parts.length === 3 && method === 'GET') {
        return send(res, 200, { ok: true });
      }

      // -- comments admin --
      // GET /api/admin/comments?status=pending|approved|all&ip=&postId=
      if (parts[2] === 'comments' && parts.length === 3 && method === 'GET') {
        const status = url.searchParams.get('status') || 'pending';
        const ip = url.searchParams.get('ip');
        const postId = url.searchParams.get('postId');
        let list = store.comments.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        if (status !== 'all') list = list.filter(c => c.status === status);
        if (ip) list = list.filter(c => c.ip === ip);
        if (postId) list = list.filter(c => c.postId === parseInt(postId, 10));
        // Decorate with the post's title/slug for the admin UI's convenience.
        const enriched = list.map(c => {
          const p = store.posts.find(x => x.id === c.postId);
          return Object.assign({}, c, {
            postTitle: p ? p.title : null,
            postSlug:  p ? p.slug  : null,
          });
        });
        return send(res, 200, enriched);
      }

      // POST /api/admin/comments/:id/approve
      if (parts[2] === 'comments' && parts.length === 5 && parts[4] === 'approve' && method === 'POST') {
        const id = parseInt(parts[3], 10);
        const c = store.comments.find(c => c.id === id);
        if (!c) return send(res, 404, { error: 'not found' });
        c.status = 'approved';
        saveStore(store);
        return send(res, 200, c);
      }

      // DELETE /api/admin/comments/:id
      if (parts[2] === 'comments' && parts.length === 4 && method === 'DELETE') {
        const id = parseInt(parts[3], 10);
        const idx = store.comments.findIndex(c => c.id === id);
        if (idx < 0) return send(res, 404, { error: 'not found' });
        store.comments.splice(idx, 1);
        saveStore(store);
        return send(res, 204, '');
      }

      // DELETE /api/admin/comments?ip=X[&status=pending|approved|all]
      // Bulk-removes all comments from a given IP (defaults to pending only).
      if (parts[2] === 'comments' && parts.length === 3 && method === 'DELETE') {
        const ip = url.searchParams.get('ip');
        const status = url.searchParams.get('status') || 'pending';
        if (!ip) return send(res, 400, { error: 'ip required' });
        let removed = 0;
        store.comments = store.comments.filter(c => {
          if (c.ip !== ip) return true;
          if (status !== 'all' && c.status !== status) return true;
          removed++;
          return false;
        });
        saveStore(store);
        return send(res, 200, { removed });
      }

      // categories
      if (parts[2] === 'categories' && parts.length === 3 && method === 'POST') {
        const body = await readJsonBody(req);
        const name = String(body.name || '').trim();
        if (!name) return send(res, 400, { error: 'name required' });
        const slug = slugify(body.slug || name);
        if (store.categories.some(c => c.slug === slug))
          return send(res, 409, { error: 'slug exists' });
        const cat = { id: nextId(), name, slug };
        store.categories.push(cat);
        saveStore(store);
        return send(res, 201, cat);
      }
      if (parts[2] === 'categories' && parts.length === 4 && (method === 'PATCH' || method === 'PUT')) {
        const id = parseInt(parts[3], 10);
        const cat = store.categories.find(c => c.id === id);
        if (!cat) return send(res, 404, { error: 'not found' });
        const body = await readJsonBody(req);
        if (body.name !== undefined) cat.name = String(body.name).trim();
        if (body.slug !== undefined) {
          const ns = slugify(body.slug);
          if (store.categories.some(c => c.slug === ns && c.id !== id))
            return send(res, 409, { error: 'slug exists' });
          cat.slug = ns;
        }
        saveStore(store);
        return send(res, 200, cat);
      }
      if (parts[2] === 'categories' && parts.length === 4 && method === 'DELETE') {
        const id = parseInt(parts[3], 10);
        const idx = store.categories.findIndex(c => c.id === id);
        if (idx < 0) return send(res, 404, { error: 'not found' });
        store.categories.splice(idx, 1);
        for (const p of store.posts) if (p.categoryId === id) p.categoryId = null;
        saveStore(store);
        return send(res, 204, '');
      }

      // tags
      if (parts[2] === 'tags' && parts.length === 3 && method === 'POST') {
        const body = await readJsonBody(req);
        const name = String(body.name || '').trim();
        if (!name) return send(res, 400, { error: 'name required' });
        const slug = slugify(body.slug || name);
        if (store.tags.some(t => t.slug === slug))
          return send(res, 409, { error: 'slug exists' });
        const tag = { id: nextId(), name, slug };
        store.tags.push(tag);
        saveStore(store);
        return send(res, 201, tag);
      }
      if (parts[2] === 'tags' && parts.length === 4 && (method === 'PATCH' || method === 'PUT')) {
        const id = parseInt(parts[3], 10);
        const tag = store.tags.find(t => t.id === id);
        if (!tag) return send(res, 404, { error: 'not found' });
        const body = await readJsonBody(req);
        if (body.name !== undefined) tag.name = String(body.name).trim();
        if (body.slug !== undefined) {
          const ns = slugify(body.slug);
          if (store.tags.some(t => t.slug === ns && t.id !== id))
            return send(res, 409, { error: 'slug exists' });
          tag.slug = ns;
        }
        saveStore(store);
        return send(res, 200, tag);
      }
      if (parts[2] === 'tags' && parts.length === 4 && method === 'DELETE') {
        const id = parseInt(parts[3], 10);
        const idx = store.tags.findIndex(t => t.id === id);
        if (idx < 0) return send(res, 404, { error: 'not found' });
        store.tags.splice(idx, 1);
        for (const p of store.posts) {
          p.tagIds = (p.tagIds || []).filter(t => t !== id);
        }
        saveStore(store);
        return send(res, 204, '');
      }

      // posts
      if (parts[2] === 'posts' && parts.length === 3 && method === 'POST') {
        const body = await readJsonBody(req);
        const title = String(body.title || '').trim();
        const text  = String(body.body  || '').trim();
        if (!title) return send(res, 400, { error: 'title required' });
        const slug = slugify(body.slug || title);
        if (store.posts.some(p => p.slug === slug))
          return send(res, 409, { error: 'slug exists' });
        const cat = body.category != null ? ensureCategory(body.category) : null;
        const tagIds = Array.isArray(body.tags)
          ? body.tags.map(t => ensureTag(t)).filter(Boolean).map(t => t.id)
          : [];
        const now = Date.now();
        const post = {
          id: nextId(),
          slug,
          title,
          body: text,
          categoryId: cat ? cat.id : null,
          tagIds,
          createdAt: now,
          updatedAt: now,
        };
        store.posts.push(post);
        saveStore(store);
        return send(res, 201, postPublicView(post));
      }
      if (parts[2] === 'posts' && parts.length === 4 && (method === 'PUT' || method === 'PATCH')) {
        const id = parseInt(parts[3], 10);
        const post = store.posts.find(p => p.id === id);
        if (!post) return send(res, 404, { error: 'not found' });
        const body = await readJsonBody(req);
        if (body.title  !== undefined) post.title = String(body.title).trim();
        if (body.body   !== undefined) post.body  = String(body.body);
        if (body.slug   !== undefined) {
          const ns = slugify(body.slug);
          if (store.posts.some(p => p.slug === ns && p.id !== id))
            return send(res, 409, { error: 'slug exists' });
          post.slug = ns;
        }
        if (body.category !== undefined) {
          const c = body.category == null ? null : ensureCategory(body.category);
          post.categoryId = c ? c.id : null;
        }
        if (Array.isArray(body.tags)) {
          post.tagIds = body.tags.map(t => ensureTag(t)).filter(Boolean).map(t => t.id);
        }
        post.updatedAt = Date.now();
        saveStore(store);
        return send(res, 200, postPublicView(post));
      }
      if (parts[2] === 'posts' && parts.length === 4 && method === 'DELETE') {
        const id = parseInt(parts[3], 10);
        const idx = store.posts.findIndex(p => p.id === id);
        if (idx < 0) return send(res, 404, { error: 'not found' });
        store.posts.splice(idx, 1);
        saveStore(store);
        return send(res, 204, '');
      }
    }

    // -------- static files (everything else) ------------------------------
    if (parts[0] !== 'api' && (method === 'GET' || method === 'HEAD')) {
      return serveStatic(req, res, url.pathname);
    }

    return send(res, 404, { error: 'not found' });
  } catch (err) {
    console.error('[err]', err);
    return send(res, 500, { error: err.message || 'server error' });
  }
});

server.listen(PORT, () => {
  console.log(`supernovayuli backend listening on http://localhost:${PORT}`);
});
