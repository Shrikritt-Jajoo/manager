'use strict';
// =========================================================
// manager db.js  v2
// Dual persistence: JSON file via server (preferred)
//                   IndexedDB fallback (standalone / file://)
// Phase 0 upgrade: added settings, gmailConfig, aiConfig,
//                  registeredAiJobs stores; migrates old meta
// =========================================================

// ---- Config ------------------------------------------------------------
const DB_NAME    = 'chronoflow';
const DB_VERSION = 2;

// All stores that use keyPath:'id'
const ID_STORES  = ['tasks','subtasks','slots','scheduleBlocks',
                    'focusSessions','goals','registeredAiJobs'];

// Singleton stores that use keyPath:'key'
const KP_KEY_STORES = new Set(['settings','gmailConfig','aiConfig']);

// Combined list for IDB creation
const STORES = [...ID_STORES, ...KP_KEY_STORES];

// ---- Server detection --------------------------------------------------
const ChronoFlow = {
  serverMode: false,
  _ready: null,

  async detect() {
    if (this._ready) return this._ready;
    this._ready = fetch('/api/ping', { method: 'GET', cache: 'no-store' })
      .then(r => r.ok)
      .catch(() => false)
      .then(ok => { this.serverMode = ok; return ok; });
    return this._ready;
  }
};

// ---- Write debounce cache (server mode only) ---------------------------
const _writeCache  = {};
const _writeTimers = {};
const WRITE_DEBOUNCE_MS = 100;

function _scheduleWrite(store, value) {
  _writeCache[store] = value;
  clearTimeout(_writeTimers[store]);
  _writeTimers[store] = setTimeout(() => _flushWrite(store), WRITE_DEBOUNCE_MS);
}

async function _flushWrite(store) {
  const value = _writeCache[store];
  if (value === undefined) return;
  delete _writeCache[store];
  try {
    await fetch(`/api/data?store=${encodeURIComponent(store)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value)
    });
  } catch (e) {
    console.warn(`[manager] Write failed for store "${store}":`, e);
  }
}

async function flushAllWrites() {
  const pending = Object.keys(_writeTimers);
  for (const store of pending) {
    clearTimeout(_writeTimers[store]);
    delete _writeTimers[store];
    await _flushWrite(store);
  }
}

// ---- In-memory JSON store (server mode) --------------------------------
const _memStore = {};

async function _serverGetAll(store) {
  if (_memStore[store]) return _memStore[store];
  try {
    const r    = await fetch(`/api/data?store=${encodeURIComponent(store)}`, { cache: 'no-store' });
    const data = await r.json();
    _memStore[store] = Array.isArray(data) ? data : (data ? [data] : []);
  } catch { _memStore[store] = []; }
  return _memStore[store];
}

async function _serverGet(store, key) {
  const all = await _serverGetAll(store);
  const kp  = KP_KEY_STORES.has(store) ? 'key' : 'id';
  return all.find(i => i[kp] === key) || undefined;
}

async function _serverPut(store, item) {
  const all = await _serverGetAll(store);
  const kp  = KP_KEY_STORES.has(store) ? 'key' : 'id';
  const idx = all.findIndex(i => i[kp] === item[kp]);
  if (idx >= 0) all[idx] = item; else all.push(item);
  _memStore[store] = all;
  _scheduleWrite(store, all);
  return item;
}

async function _serverDelete(store, key) {
  const all = await _serverGetAll(store);
  const kp  = KP_KEY_STORES.has(store) ? 'key' : 'id';
  _memStore[store] = all.filter(i => i[kp] !== key);
  _scheduleWrite(store, _memStore[store]);
}

async function _serverClear(store) {
  _memStore[store] = [];
  _scheduleWrite(store, []);
}

// ---- IndexedDB wrapper (fallback mode) ---------------------------------
const _idb = {
  _db: null,

  async open() {
    if (this._db) return this._db;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = e => {
        const db  = e.target.result;
        const tx  = e.target.transaction; // the version-change transaction

        // 1. Create new stores that don't exist yet
        for (const store of ID_STORES) {
          if (!db.objectStoreNames.contains(store))
            db.createObjectStore(store, { keyPath: 'id' });
        }
        for (const store of KP_KEY_STORES) {
          if (!db.objectStoreNames.contains(store))
            db.createObjectStore(store, { keyPath: 'key' });
        }

        // 2. One-time migration: copy old meta rows into their proper stores
        //    Runs only when upgrading from v1 (meta store exists)
        if (db.objectStoreNames.contains('meta') && e.oldVersion < 2) {
          const metaOS = tx.objectStore('meta');

          // Migrate settings
          metaOS.get('settings').onsuccess = ev => {
            const val = ev.target.result && ev.target.result.value;
            if (val && typeof val === 'object') {
              tx.objectStore('settings').put(
                Object.assign({ key: 'main' }, val)
              );
            }
          };

          // Migrate gmailToken -> gmailConfig
          metaOS.get('gmailToken').onsuccess = ev => {
            const val = ev.target.result && ev.target.result.value;
            if (val) {
              tx.objectStore('gmailConfig').put({
                key: 'main',
                clientId:    '',
                accessToken: val.access_token || '',
                expiresAt:   val.expires_at   || 0
              });
            }
          };
        }
      };

      req.onsuccess = e => { this._db = e.target.result; resolve(this._db); };
      req.onerror   = e => reject(e.target.error);
    });
  },

  async put(store, value) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(value);
      tx.oncomplete = () => resolve(value);
      tx.onerror    = () => reject(tx.error);
    });
  },

  async get(store, key) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  },

  async getAll(store) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror   = () => reject(req.error);
    });
  },

  async delete(store, key) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror    = () => reject(tx.error);
    });
  },

  async clear(store) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).clear();
      tx.oncomplete = () => resolve();
      tx.onerror    = () => reject(tx.error);
    });
  }
};

// ---- Unified DB facade -------------------------------------------------
// All state.js code uses DB.get / DB.put / DB.getAll / DB.delete / DB.clear.
// Implementation is swapped transparently based on server detection.
const DB = {
  async put(store, value) {
    return ChronoFlow.serverMode
      ? _serverPut(store, value)
      : _idb.put(store, value);
  },

  async get(store, key) {
    return ChronoFlow.serverMode
      ? _serverGet(store, key)
      : _idb.get(store, key);
  },

  async getAll(store) {
    return ChronoFlow.serverMode
      ? _serverGetAll(store)
      : _idb.getAll(store);
  },

  async delete(store, key) {
    return ChronoFlow.serverMode
      ? _serverDelete(store, key)
      : _idb.delete(store, key);
  },

  async clear(store) {
    return ChronoFlow.serverMode
      ? _serverClear(store)
      : _idb.clear(store);
  },

  // ---- Legacy helpers preserved for shell.js / Onboarding compat -------
  async getMeta(key) {
    // In v2, settings live in the 'settings' store (key:'main').
    // All other meta keys are kept in the legacy meta store if it exists,
    // otherwise we fall back gracefully.
    if (key === 'settings') {
      const row = await this.get('settings', 'main');
      return row || undefined;
    }
    // For remaining legacy meta keys, try IDB meta store directly
    if (!ChronoFlow.serverMode) {
      try {
        const db = await _idb.open();
        if (db.objectStoreNames.contains('meta')) {
          return new Promise(resolve => {
            const tx  = db.transaction('meta', 'readonly');
            const req = tx.objectStore('meta').get(key);
            req.onsuccess = () => resolve(req.result ? req.result.value : undefined);
            req.onerror   = () => resolve(undefined);
          });
        }
      } catch { /* ignore */ }
    }
    return undefined;
  },

  async setMeta(key, value) {
    if (key === 'settings') {
      const row = typeof value === 'object'
        ? Object.assign({ key: 'main' }, value)
        : { key: 'main', value };
      return this.put('settings', row);
    }
    // For non-settings meta, write to legacy meta store (IDB only)
    if (!ChronoFlow.serverMode) {
      try {
        const db = await _idb.open();
        if (db.objectStoreNames.contains('meta')) {
          return new Promise((resolve, reject) => {
            const tx = db.transaction('meta', 'readwrite');
            tx.objectStore('meta').put({ key, value });
            tx.oncomplete = () => resolve();
            tx.onerror    = () => reject(tx.error);
          });
        }
      } catch { /* ignore */ }
    }
  }
};

// ---- Version snapshot helpers (server mode only) -----------------------
// No-op silently when serverMode is false — safe to call anywhere.

async function takeSnapshot(name) {
  if (!ChronoFlow.serverMode) return null;
  await flushAllWrites();
  const safeName = name.replace(/[^a-zA-Z0-9_\-\.]/g, '_').slice(0, 64);
  try {
    const r = await fetch(
      `/api/versions/snapshot?name=${encodeURIComponent(safeName)}`,
      { method: 'POST' }
    );
    return r.ok ? safeName : null;
  } catch { return null; }
}

async function deleteSnapshot(name) {
  if (!ChronoFlow.serverMode) return;
  try {
    await fetch(`/api/versions?name=${encodeURIComponent(name)}`, { method: 'DELETE' });
  } catch {}
}

async function listVersions() {
  if (!ChronoFlow.serverMode) return [];
  try {
    const r = await fetch('/api/versions', { cache: 'no-store' });
    return r.ok ? r.json() : [];
  } catch { return []; }
}

async function restoreVersion(name) {
  if (!ChronoFlow.serverMode) return false;
  try {
    const r = await fetch(
      `/api/versions/restore?name=${encodeURIComponent(name)}`,
      { method: 'POST' }
    );
    if (r.ok) { window.location.reload(); return true; }
    return false;
  } catch { return false; }
}
