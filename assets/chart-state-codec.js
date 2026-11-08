// TradeZoro — Charts: saved-state codec + on-device backup (charts.html). Classic script.
// Used by assets/chart-layouts.js, assets/chart-layouts-lib.js and assets/chart-templates.js.
//
// LAYOUT-PERF (Owner 2026-11-08 "no limits to what can be on layout"): a saved chart state is
// a JSON string. When it is over PLAIN_MAX (the old 200 KB cap, so older app versions can
// still read everything they could before), it is stored gzip-compressed instead:
//   'tz1:' + base64(gzip(json))
// decode() reads both forms. Firestore rules cap the stored string at STORE_MAX (900 000 chars,
// doc limit 1 MiB with the 60 KB thumb). Chart JSON compresses ~5-10x, so that is several MB of
// layout. A save that still fails keeps a copy on this device (IndexedDB 'tz-chart-backup').
//
// Exposes window.StrykerStateCodec { encode, decode, PLAIN_MAX, STORE_MAX, backup, backups, kb }.
(function () {
  'use strict';
  var PREFIX = 'tz1:';
  var PLAIN_MAX = 200000;
  var STORE_MAX = 900000;
  var hasCS = typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

  function bytesToB64(u8) {
    var s = '', CH = 0x8000;
    for (var i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
    return btoa(s);
  }
  function b64ToBytes(b64) {
    var s = atob(b64), u8 = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
    return u8;
  }
  function pipe(u8, stream) {
    return new Response(new Blob([u8]).stream().pipeThrough(stream)).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }
  function kb(n) { return Math.round(n / 1024) + ' KB'; }
  function sizeErr(n) {
    var e = new Error('big');
    e.big = true; e.size = n;
    e.userMessage = 'This layout is very large (' + kb(n) + ') and could not be saved to your account. A copy is kept on this device.';
    return e;
  }

  // state object or JSON string -> stored string. Rejects (err.big) only past STORE_MAX.
  function encode(state) {
    var json = typeof state === 'string' ? state : JSON.stringify(state);
    if (json.length <= PLAIN_MAX) return Promise.resolve(json);
    if (!hasCS) return json.length <= STORE_MAX ? Promise.resolve(json) : Promise.reject(sizeErr(json.length));
    return pipe(new TextEncoder().encode(json), new CompressionStream('gzip')).then(function (gz) {
      var out = PREFIX + bytesToB64(gz);
      if (out.length > STORE_MAX) throw sizeErr(out.length);
      return out;
    });
  }
  // stored string -> state object (null when unreadable). Old plain JSON reads as before.
  function decode(stored) {
    if (stored && typeof stored === 'object') return Promise.resolve(stored);
    if (typeof stored !== 'string' || !stored) return Promise.resolve(null);
    if (stored.slice(0, PREFIX.length) !== PREFIX) { try { return Promise.resolve(JSON.parse(stored)); } catch (e) { return Promise.resolve(null); } }
    if (!hasCS) return Promise.resolve(null);
    return Promise.resolve().then(function () { return pipe(b64ToBytes(stored.slice(PREFIX.length)), new DecompressionStream('gzip')); })
      .then(function (u8) { return JSON.parse(new TextDecoder().decode(u8)); })
      .catch(function () { return null; });
  }

  // ---- on-device backup (IndexedDB): the member's work is never lost to a failed save ----
  function idb() {
    return new Promise(function (res, rej) {
      if (typeof indexedDB === 'undefined') { rej(new Error('no idb')); return; }
      var r = indexedDB.open('tz-chart-backup', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('s'); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  // key e.g. 'layout:<uid>:<id>'; value { name, state (JSON string), at }
  function backup(key, name, state) {
    var v = { name: String(name || ''), state: typeof state === 'string' ? state : JSON.stringify(state), at: Date.now() };
    return idb().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction('s', 'readwrite'); tx.objectStore('s').put(v, key);
        tx.oncomplete = function () { res(true); }; tx.onerror = function () { rej(tx.error); };
      });
    }).catch(function (e) { console.warn('TradeZoro: on-device backup failed', e); return false; });
  }
  function backups() {
    return idb().then(function (db) {
      return new Promise(function (res) {
        var out = [], tx = db.transaction('s'), c = tx.objectStore('s').openCursor();
        c.onsuccess = function () { var x = c.result; if (!x) { res(out); return; } out.push({ key: x.key, name: x.value.name, at: x.value.at, size: x.value.state.length }); x.continue(); };
        c.onerror = function () { res(out); };
      });
    }).catch(function () { return []; });
  }

  window.StrykerStateCodec = { encode: encode, decode: decode, backup: backup, backups: backups, kb: kb, PREFIX: PREFIX, PLAIN_MAX: PLAIN_MAX, STORE_MAX: STORE_MAX };
})();
