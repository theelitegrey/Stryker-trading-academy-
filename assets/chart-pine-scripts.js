// Stryker Trading Academy — Charts "My scripts" store for Pine Script (charts.html)
// Depends on: firebase compat SDKs (app/auth/firestore) + assets/auth.js
// (initialises the app). Works without them: falls back to localStorage.
//
// A saved script is { name, source }. Signed-in members: Firestore
//   students/{uid}/pineScripts/{id}
//   { name: string 1-60, source: string <= 65536 chars, createdAt, updatedAt: server timestamps }
// Rules (firestore.rules, pineScripts block): owner only, fields and sizes validated.
// The 50-script cap is enforced here (rules can't count documents).
// Signed-out visitors, or a Firestore read/write that fails, use localStorage key
// stryker_pine_scripts_<uid|guest> instead.
//
// Also holds the three built-in EXAMPLE scripts (written for Stryker, read-only).
// This file is our own code; it never loads the Pine engine (see assets/chart-pine.js).
//
// Exposes window.StrykerPineScripts.

(function () {
  'use strict';
  var NAME_MAX = 60;
  var SOURCE_MAX = 65536;
  var MAX_COUNT = 50;

  var EXAMPLES = [
    { id: 'example:ema-cross', name: 'EMA 9/21 cross', source: [
      '//@version=5',
      'indicator("EMA 9/21 cross", overlay=true)',
      '// Two exponential moving averages and a marker where they cross.',
      'fastLen = input.int(9, "Fast EMA", minval=1)',
      'slowLen = input.int(21, "Slow EMA", minval=1)',
      'fast = ta.ema(close, fastLen)',
      'slow = ta.ema(close, slowLen)',
      'plot(fast, "Fast EMA", color=color.teal, linewidth=2)',
      'plot(slow, "Slow EMA", color=color.orange, linewidth=2)',
      'plotshape(ta.crossover(fast, slow), "Cross up", style=shape.triangleup, location=location.belowbar, color=color.teal, size=size.small)',
      'plotshape(ta.crossunder(fast, slow), "Cross down", style=shape.triangledown, location=location.abovebar, color=color.orange, size=size.small)'
    ].join('\n') },
    { id: 'example:session-vwap', name: 'Session VWAP', source: [
      '//@version=5',
      'indicator("Session VWAP", overlay=true)',
      '// Volume-weighted average price, restarted at the first bar of each day.',
      'src = input.source(hlc3, "Source")',
      'newDay = ta.change(time("D")) != 0',
      'var float sumPV = 0.0',
      'var float sumV = 0.0',
      'if newDay',
      '    sumPV := 0.0',
      '    sumV := 0.0',
      'sumPV += src * volume',
      'sumV += volume',
      'plot(sumV > 0 ? sumPV / sumV : na, "VWAP", color=color.yellow, linewidth=2)'
    ].join('\n') },
    { id: 'example:pdhl', name: 'Previous day high/low', source: [
      '//@version=5',
      'indicator("Previous day high/low", overlay=true)',
      '// Tracks each day\'s high and low, then draws the previous day\'s levels.',
      'newDay = ta.change(time("D")) != 0',
      'var float dayHigh = na',
      'var float dayLow = na',
      'var float prevHigh = na',
      'var float prevLow = na',
      'if newDay',
      '    prevHigh := dayHigh',
      '    prevLow := dayLow',
      '    dayHigh := high',
      '    dayLow := low',
      'else',
      '    dayHigh := na(dayHigh) ? high : math.max(dayHigh, high)',
      '    dayLow := na(dayLow) ? low : math.min(dayLow, low)',
      'plot(prevHigh, "Prev day high", color=color.green, style=plot.style_stepline, linewidth=2)',
      'plot(prevLow, "Prev day low", color=color.red, style=plot.style_stepline, linewidth=2)'
    ].join('\n') }
  ];

  function fb() { return (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) ? firebase : null; }

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
  // Cloud saving ON since build 403: the validated rules block for
  // students/{uid}/pineScripts was released 2026-10-05 (ruleset 3b35b1ab).
  var CLOUD = true;
  function useCloud() { return CLOUD && signedIn(); }
  function who() { var u = user(); return u ? u.uid : 'guest'; }
  function col() { return fb().firestore().collection('students').doc(user().uid).collection('pineScripts'); }

  function err(msg) { var e = new Error(msg); e.userMessage = msg; return e; }
  function cleanName(n) {
    n = String(n || '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
    if (!n) throw err('Give the script a name.');
    return n;
  }
  function cleanSource(s) {
    s = String(s || '');
    if (!s.trim()) throw err('The script is empty.');
    if (s.length > SOURCE_MAX) throw err('This script is too long to save (' + Math.round(s.length / 1024) + ' KB, limit 64 KB).');
    return s;
  }

  function lsKey() { return 'stryker_pine_scripts_' + who(); }
  function lsAll() { try { var a = JSON.parse(localStorage.getItem(lsKey()) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function lsPut(a) {
    try { localStorage.setItem(lsKey(), JSON.stringify(a)); }
    catch (e) { throw err('Your browser storage is full, so the script was not saved.'); }
  }
  function isLocalId(id) { return lsAll().some(function (t) { return t.id === id; }); }
  function sortItems(a) { return a.sort(function (x, y) { return (y.updatedAt || 0) - (x.updatedAt || 0); }); }
  function tsMs(v) { return v && v.toMillis ? v.toMillis() : (typeof v === 'number' ? v : 0); }

  async function list() {
    await authReady;
    if (!useCloud()) return { items: sortItems(lsAll()), where: 'local' };
    try {
      var snap = await col().get();
      var items = [];
      snap.forEach(function (doc) {
        var x = doc.data() || {};
        items.push({ id: doc.id, name: x.name || 'Untitled', source: x.source || '', createdAt: tsMs(x.createdAt), updatedAt: tsMs(x.updatedAt) });
      });
      var local = lsAll();
      return { items: sortItems(items.concat(local)), where: 'cloud' };
    } catch (e) {
      console.warn('Stryker: Pine scripts read failed, using this browser', e);
      return { items: sortItems(lsAll()), where: 'local', note: "Couldn't reach your account; showing scripts saved in this browser." };
    }
  }

  // id given = overwrite that script; no id = new script. Returns the id.
  async function save(name, source, id) {
    await authReady;
    name = cleanName(name);
    source = cleanSource(source);
    var ts;
    if (id && !isLocalId(id) && useCloud()) {
      ts = firebase.firestore.FieldValue.serverTimestamp();
      await col().doc(id).update({ name: name, source: source, updatedAt: ts });
      return id;
    }
    if (id && isLocalId(id)) {
      var a0 = lsAll();
      a0.forEach(function (t) { if (t.id === id) { t.name = name; t.source = source; t.updatedAt = Date.now(); } });
      lsPut(a0);
      return id;
    }
    if (useCloud()) {
      var r = await list();
      if (r.where === 'cloud') {
        if (r.items.length >= MAX_COUNT) throw err('You have ' + MAX_COUNT + ' scripts. Delete one to save another.');
        ts = firebase.firestore.FieldValue.serverTimestamp();
        try {
          var ref = await col().add({ name: name, source: source, createdAt: ts, updatedAt: ts });
          return ref.id;
        } catch (e) {
          console.warn('Stryker: Pine script cloud save failed, saving in this browser', e);
        }
      }
    }
    var a = lsAll();
    if (a.length >= MAX_COUNT) throw err('You have ' + MAX_COUNT + ' scripts. Delete one to save another.');
    var nid = 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    var now = Date.now();
    a.push({ id: nid, name: name, source: source, createdAt: now, updatedAt: now });
    lsPut(a);
    return nid;
  }

  async function rename(id, name) {
    await authReady;
    name = cleanName(name);
    if (useCloud() && !isLocalId(id)) {
      await col().doc(id).update({ name: name, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
      return;
    }
    var a = lsAll();
    a.forEach(function (t) { if (t.id === id) { t.name = name; t.updatedAt = Date.now(); } });
    lsPut(a);
  }

  async function remove(id) {
    await authReady;
    if (useCloud() && !isLocalId(id)) await col().doc(id).delete();
    else lsPut(lsAll().filter(function (t) { return t.id !== id; }));
  }

  window.StrykerPineScripts = {
    NAME_MAX: NAME_MAX, SOURCE_MAX: SOURCE_MAX, MAX_COUNT: MAX_COUNT, EXAMPLES: EXAMPLES,
    list: list, save: save, rename: rename, remove: remove, signedIn: signedIn, cloud: function () { return CLOUD; }, ready: authReady
  };
})();
