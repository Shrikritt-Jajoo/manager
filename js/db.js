'use strict';
const DB_NAME    = 'chronoflow';
const DB_VERSION = 1;
const STORES     = ['tasks','subtasks','slots','scheduleBlocks','focusSessions','goals'];

let _db = null;

const DB = {
  open() {
    if (_db) return Promise.resolve(_db);
    return new Promise((res, rej) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        STORES.forEach(s => {
          if (!db.objectStoreNames.contains(s))
            db.createObjectStore(s, { keyPath: 'id' });
        });
        if (!db.objectStoreNames.contains('meta'))
          db.createObjectStore('meta', { keyPath: 'key' });
      };
      req.onsuccess = e => { _db = e.target.result; res(_db); };
      req.onerror   = e => rej(e.target.error);
    });
  },

  async _tx(stores, mode, fn) {
    const db = await this.open();
    const list = Array.isArray(stores) ? stores : [stores];
    return new Promise((res, rej) => {
      const tx  = db.transaction(list, mode);
      tx.onerror = () => rej(tx.error);
      res(fn(tx));
    });
  },

  async getAll(store) {
    return this._tx(store, 'readonly', tx =>
      new Promise((res, rej) => {
        const req = tx.objectStore(store).getAll();
        req.onsuccess = () => res(req.result);
        req.onerror   = () => rej(req.error);
      })
    );
  },

  async get(store, id) {
    return this._tx(store, 'readonly', tx =>
      new Promise((res, rej) => {
        const req = tx.objectStore(store).get(id);
        req.onsuccess = () => res(req.result);
        req.onerror   = () => rej(req.error);
      })
    );
  },

  async put(store, item) {
    return this._tx(store, 'readwrite', tx =>
      new Promise((res, rej) => {
        const req = tx.objectStore(store).put(item);
        req.onsuccess = () => res(item);
        req.onerror   = () => rej(req.error);
      })
    );
  },

  async delete(store, id) {
    return this._tx(store, 'readwrite', tx =>
      new Promise((res, rej) => {
        const req = tx.objectStore(store).delete(id);
        req.onsuccess = () => res();
        req.onerror   = () => rej(req.error);
      })
    );
  },

  async clear(store) {
    return this._tx(store, 'readwrite', tx =>
      new Promise((res, rej) => {
        const req = tx.objectStore(store).clear();
        req.onsuccess = () => res();
        req.onerror   = () => rej(req.error);
      })
    );
  },

  async getMeta(key) {
    const row = await this.get('meta', key);
    return row ? row.value : undefined;
  },

  async setMeta(key, value) {
    return this.put('meta', { key, value });
  }
};
