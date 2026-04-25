'use strict';

// Storage abstraction: Vercel KV (when configured) or a local JSON file.
// The whole store is one key ("store") so writes are atomic at the JSON level.

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data.json');
const HAS_KV = !!(process.env.KV_REST_API_URL || process.env.KV_URL);

let kv = null;
if (HAS_KV) {
  try { kv = require('@vercel/kv').kv; }
  catch (e) {
    console.warn('[store] @vercel/kv not installed; install it for production storage');
    kv = null;
  }
}

function emptyStore() {
  return { posts: [], categories: [], tags: [], comments: [], nextId: 1 };
}

async function load() {
  if (kv) {
    try {
      const raw = await kv.get('store');
      if (raw && typeof raw === 'object') return Object.assign(emptyStore(), raw);
    } catch (e) {
      console.error('[store] kv load failed:', e.message);
    }
    return emptyStore();
  }
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    return Object.assign(emptyStore(), JSON.parse(raw));
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('[store] file load failed:', e.message);
    return emptyStore();
  }
}

async function save(store) {
  if (kv) {
    try { await kv.set('store', store); }
    catch (e) { console.error('[store] kv save failed:', e.message); }
    return;
  }
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

module.exports = { load, save, emptyStore, usingKv: !!kv };
