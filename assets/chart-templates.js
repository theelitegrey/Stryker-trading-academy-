// Stryker Trading Academy — Charts saved templates store (charts.html)
// Depends on: firebase compat SDKs (app/auth/firestore) + assets/auth.js
// (initialises the app). Works without them: falls back to localStorage.
//
// A template is a Vela workspace state document (VelaWorkspace.getState())
// with a name. Signed-in members: Firestore students/{uid}/chartTemplates/{id}
//   { name: string 1-60, state: JSON string <= 200 KB, isDefault: bool,
//     createdAt, updatedAt: server timestamps }
// Rules (firestore.rules, chartTemplates block): only the owner reads/writes,
// fields and sizes validated. The 20-template cap is enforced here.
// Signed-out visitors, or a Firestore read/write that fails (offline), use
// localStorage key stryker_chart_templates_<uid|guest> instead.
// A STARTER template (built in, read-only, ids "starter:...") can also be the
// default; that choice lives in localStorage stryker_chart_tpl_default_<uid|guest>.
//
// Exposes window.StrykerChartTemplates.

(function () {
  'use strict';
  var NAME_MAX = 60;
  var STATE_MAX = 200000;   // bytes of the JSON string (Firestore doc cap is 1 MB)
  var MAX_COUNT = 20;

  function fb() { return (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) ? firebase : null; }

  // Wait (bounded) for the first auth state so a signed-in member isn't
  // treated as a guest during page boot.
  var authReady = new Promise(function (resolve) {
    var tries = 0;
    (function poll() {
      var f = fb();
      if (f && f.auth) {
        var done = false;
        var off = f.auth().onAuthStateChanged(function () { if (!done) { done = true; try { off(); } catch (e) {} resolve(); } });
        setTimeout(function () { if (!done) { done = true; resolve(); } }, 6000);
        return;
      }
      if (++tries > 40) { resolve(); return; }
      setTimeout(poll, 150);
    })();
  });

  function user() { var f = fb(); try { return f && f.auth().currentUser; } catch (e) { return null; } }
  function signedIn() { return !!user(); }
  function who() { var u = user(); return u ? u.uid : 'guest'; }
  function col() { return fb().firestore().collection('students').doc(user().uid).collection('chartTemplates'); }

  function err(msg) { var e = new Error(msg); e.userMessage = msg; return e; }
  function cleanName(n) {
    n = String(n || '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
    if (!n) throw err('Give the template a name.');
    return n;
  }
  function packState(state) {
    var s = typeof state === 'string' ? state : JSON.stringify(state);
    var bytes = new Blob([s]).size;
    if (bytes > STATE_MAX) throw err('This layout is too big to save (' + Math.round(bytes / 1024) + ' KB, limit ' + Math.round(STATE_MAX / 1024) + ' KB). Remove some drawings and try again.');
    return s;
  }

  // ---- localStorage backend ----
  function lsKey() { return 'stryker_chart_templates_' + who(); }
  function lsDefKey() { return 'stryker_chart_tpl_default_' + who(); }
  function lsAll() { try { var a = JSON.parse(localStorage.getItem(lsKey()) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function lsPut(a) {
    try { localStorage.setItem(lsKey(), JSON.stringify(a)); }
    catch (e) { throw err('Your browser storage is full, so the template was not saved.'); }
  }
  function lsDefault() { try { return localStorage.getItem(lsDefKey()) || null; } catch (e) { return null; } }
  function lsSetDefault(id) { try { if (id) localStorage.setItem(lsDefKey(), id); else localStorage.removeItem(lsDefKey()); } catch (e) {} }

  function sortItems(a) { return a.sort(function (x, y) { return (y.updatedAt || 0) - (x.updatedAt || 0); }); }
  function tsMs(v) { return v && v.toMillis ? v.toMillis() : (typeof v === 'number' ? v : 0); }

  var lastRemote = null;   // cache of the last Firestore list (for apply/rename)

  async function list() {
    await authReady;
    if (!signedIn()) {
      var local = lsAll();
      var d = lsDefault();
      local.forEach(function (t) { if (t.id === d) t.isDefault = true; });
      return { items: sortItems(local), defaultId: d, where: 'local' };
    }
    try {
      var snap = await col().get();
      var items = [];
      var def = null;
      snap.forEach(function (doc) {
        var x = doc.data() || {};
        items.push({ id: doc.id, name: x.name || 'Untitled', state: x.state, isDefault: !!x.isDefault, createdAt: tsMs(x.createdAt), updatedAt: tsMs(x.updatedAt) });
        if (x.isDefault) def = doc.id;
      });
      lastRemote = items;
      return { items: sortItems(items), defaultId: def || lsDefault(), where: 'cloud' };
    } catch (e) {
      console.warn('Stryker: chart templates read failed, using this browser', e);
      var l2 = lsAll();
      return { items: sortItems(l2), defaultId: lsDefault(), where: 'local', note: "Couldn't reach your account; showing templates saved in this browser." };
    }
  }

  async function save(name, state) {
    await authReady;
    name = cleanName(name);
    var s = packState(state);
    if (signedIn()) {
      var r = await list();
      if (r.where === 'cloud') {
        if (r.items.length >= MAX_COUNT) throw err('You have ' + MAX_COUNT + ' templates. Delete one to save another.');
        var ts = firebase.firestore.FieldValue.serverTimestamp();
        try {
          var ref = await col().add({ name: name, state: s, isDefault: false, createdAt: ts, updatedAt: ts });
          return ref.id;
        } catch (e) {
          console.warn('Stryker: chart template cloud save failed, saving in this browser', e);
        }
      }
    }
    var a = lsAll();
    if (a.length >= MAX_COUNT) throw err('You have ' + MAX_COUNT + ' templates. Delete one to save another.');
    var id = 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    var now = Date.now();
    a.push({ id: id, name: name, state: s, createdAt: now, updatedAt: now });
    lsPut(a);
    return id;
  }

  function isLocalId(id) { return lsAll().some(function (t) { return t.id === id; }); }

  async function rename(id, name) {
    await authReady;
    name = cleanName(name);
    if (signedIn() && !isLocalId(id)) {
      await col().doc(id).update({ name: name, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
      return;
    }
    var a = lsAll();
    a.forEach(function (t) { if (t.id === id) { t.name = name; t.updatedAt = Date.now(); } });
    lsPut(a);
  }

  async function remove(id) {
    await authReady;
    if (signedIn() && !isLocalId(id)) {
      await col().doc(id).delete();
    } else {
      lsPut(lsAll().filter(function (t) { return t.id !== id; }));
    }
    if (lsDefault() === id) lsSetDefault(null);
  }

  // id = a saved template id, a "starter:..." id, or null to clear.
  async function setDefault(id) {
    await authReady;
    if (signedIn()) {
      var r = await list();
      if (r.where === 'cloud') {
        var batch = firebase.firestore().batch();
        var n = 0;
        var ts = firebase.firestore.FieldValue.serverTimestamp();
        r.items.forEach(function (t) {
          var want = t.id === id;
          if (t.isDefault !== want) { batch.update(col().doc(t.id), { isDefault: want, updatedAt: ts }); n++; }
        });
        if (n) await batch.commit();
        var cloudHas = r.items.some(function (t) { return t.id === id; });
        lsSetDefault(cloudHas ? null : id);
        return;
      }
    }
    lsSetDefault(id);
  }

  window.StrykerChartTemplates = {
    NAME_MAX: NAME_MAX, STATE_MAX: STATE_MAX, MAX_COUNT: MAX_COUNT,
    list: list, save: save, rename: rename, remove: remove, setDefault: setDefault,
    signedIn: signedIn, ready: authReady
  };
})();
