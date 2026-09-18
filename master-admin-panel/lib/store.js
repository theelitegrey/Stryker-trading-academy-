'use strict';
// Tiny JSON-file document store. One file per collection, atomic writes,
// debounced flush. Good enough for a single-admin panel; swap for a DB later.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class Store {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.cache = new Map();
    this.dirty = new Set();
    this.timer = null;
  }
  file(name) { return path.join(this.dir, `${name}.json`); }
  get(name, fallback) {
    if (this.cache.has(name)) return this.cache.get(name);
    let val = fallback;
    try { val = JSON.parse(fs.readFileSync(this.file(name), 'utf8')); } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      val = typeof fallback === 'function' ? fallback() : (fallback ?? null);
    }
    this.cache.set(name, val);
    return val;
  }
  set(name, val) {
    this.cache.set(name, val);
    this.dirty.add(name);
    this.schedule();
    return val;
  }
  touch(name) { this.dirty.add(name); this.schedule(); }
  schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), 250);
  }
  flush() {
    clearTimeout(this.timer); this.timer = null;
    for (const name of this.dirty) {
      const target = this.file(name);
      const tmp = `${target}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.cache.get(name), null, 2));
      fs.renameSync(tmp, target);
    }
    this.dirty.clear();
  }
  // Collection helpers -------------------------------------------------
  list(name) { return this.get(name, () => []); }
  find(name, id) { return this.list(name).find(x => x.id === id) || null; }
  insert(name, doc) {
    const list = this.list(name);
    const now = new Date().toISOString();
    const item = { id: doc.id || Store.id(), createdAt: now, updatedAt: now, ...doc };
    list.push(item);
    this.set(name, list);
    return item;
  }
  update(name, id, patch) {
    const list = this.list(name);
    const i = list.findIndex(x => x.id === id);
    if (i < 0) return null;
    list[i] = { ...list[i], ...patch, id, updatedAt: new Date().toISOString() };
    this.set(name, list);
    return list[i];
  }
  remove(name, id) {
    const list = this.list(name);
    const next = list.filter(x => x.id !== id);
    if (next.length === list.length) return false;
    this.set(name, next);
    return true;
  }
  static id() { return crypto.randomBytes(8).toString('hex'); }
}

module.exports = { Store };
