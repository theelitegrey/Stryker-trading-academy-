/**
 * TradeZoro — ONE ACCOUNT, SYNCED EVERYWHERE (Owner 18 Nov 2026: "if someone saves indicator or templates, or edit
 * anything on browser, it should also change on phone. phone shouldn't be a different part").
 *
 * Depends on: firebase compat app/auth/firestore (assets/auth.js initialises the app). Without them, or signed out,
 * it does nothing and every setting stays in this browser exactly as before.
 *
 * How: the ~40 chart/site modules keep reading and writing localStorage as they always did (localStorage stays the
 * cache, so first paint and offline use are unchanged). This file knows which keys are ACCOUNT settings (REGISTRY
 * below) and, for a signed-in member, mirrors them into small Firestore docs
 *     users/{uid}/prefs/{group}   { v: { <id>: "<string value>" | null }, t: { <id>: serverTimestamp }, updatedAt }
 * with a live onSnapshot listener per group, so a change on any device (other browsers, the Android app) lands here
 * within a couple of seconds without a reload.
 *   - Writes: localStorage.setItem / removeItem on a registered key marks it dirty; dirty keys are flushed together
 *     after 1 s (one merge-set per group), and the dirty list survives a reload (offline queue).
 *   - Reads: a remote value that differs from the local one is written to localStorage (bypassing our own hook, so it
 *     is never echoed back), then a 'storage' event + 'stk:acct-pref' event tell the owning module to re-render.
 *   - Last write wins per key (server timestamps). A key with a local edit still waiting to flush ignores remote
 *     values until it has flushed.
 *   - First sign-in on a device (MIGRATION): keys the account lacks are uploaded; where both differ, the newer side
 *     wins when this device knows when it changed the key, otherwise the account wins, except that an EMPTY account
 *     value never wipes a device's non-empty one.
 *   - Write-storm guard: unchanged values are never written; at most 20 flushes a minute, then 10 s back-off.
 *   - Fields listed in `omit` (window positions, sizes that depend on the screen) stay on this device only.
 * window.__tzAcctLocal = [keys] (set by a host before this loads, e.g. the Android app's chart bridge) keeps those
 * keys out of sync on that page: the host syncs them itself.
 * Per-device state (auth flags, caches, feature flags, this tab's workspace, window sizes, broker/OAuth state) is
 * deliberately NOT in the registry. Audit table: stryker-notes/reports/workers/hermes-w-acctsync.md.
 *
 * Runs in Node for tests (module.exports = pure core) and in the browser (window.StrykerAccountSync).
 */
(function (root, factory) {
  var core = factory();
  if (typeof module === 'object' && module.exports) module.exports = core;
  else root.StrykerAccountSync = core.boot(root);
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // [localStorage key ({uid} = the signed-in member), sync id, group, options]
  var REGISTRY = [
    // ---- site-wide (group app). "theme" is also read natively by the Android app.
    ['stryker_theme', 'theme', 'app'],
    ['stryker_dash_mods', 'dashMods', 'app'],
    ['stryker_jcard_opts', 'journalCardOpts', 'app'],
    ['stryker_jcard_name', 'journalCardName', 'app'],
    ['stryker_jc_opts', 'journalCalOpts', 'app'],
    ['stryker_jz_range', 'journalRange', 'app'],
    ['stryker_ms', 'marketStats', 'app'],
    ['stryker_ms_stars', 'marketStatsStars', 'app'],
    ['stryker_screener', 'screener', 'app'],
    ['stryker_gm_tab', 'globalMonitorTab', 'app'],
    ['stryker_gex_basis', 'gexBasis', 'app'],
    ['stryker_video_rate', 'videoRate', 'app'],
    ['stryker_paper_review_ui', 'paperReviewUi', 'app'],
    ['tz_ai_on', 'aiConnected', 'app'],
    // ---- chart settings, templates, indicators, drawing tools (group chart)
    ['stryker_chart_settings_default', 'chartSettingsDefault', 'chart'],
    ['stryker.indstyle.defaults', 'indicatorDefaults', 'chart'],
    ['stryker_ind_recent', 'indicatorRecent', 'chart'],
    ['stk_ind_ver_dismissed', 'indicatorVersionsSeen', 'chart'],
    ['stryker_chart_tpl_default_{uid}', 'templateDefault', 'chart'],
    ['stryker_chart_layout_auto_{uid}', 'layoutAutosave', 'chart'],
    ['stryker_chart_layout_recent_{uid}', 'layoutRecent', 'chart'],
    ['stryker_ctype_favs', 'chartTypeFavs', 'chart'],
    ['stryker_chart_favbar_orient', 'favToolbarOrient', 'chart'],
    ['stk_legend_open_v1', 'legendOpen', 'chart'],
    ['stryker_script_lang', 'scriptLang', 'chart'],
    ['stk_script_ed_wrap', 'scriptWrap', 'chart'],
    ['stk_script_ed_w', 'scriptEditorWidth', 'chart'],          // desktop only: the phone stores it, never uses it
    ['tz_sym_recent', 'symbolRecent', 'chart'],
    ['stryker_wl_open', 'watchlistOpen', 'chart'],             // desktop only (the phone never opens the side panel)
    ['stryker_wl_width', 'watchlistWidth', 'chart'],           // desktop only
    ['stknw_tab', 'newsTab', 'chart'],
    ['stknw_open', 'newsOpen', 'chart'],                       // desktop only
    ['stkin_open', 'symbolInfoOpen', 'chart'],                 // desktop only
    ['stk_heatmap_templates', 'heatmapTemplates', 'chart'],
    ['stk_heatmap_magnifier', 'heatmapMagnifier', 'chart'],
    ['stryker_gex_heat_k', 'gexHeatK', 'chart'],
    ['stryker_gexl_sel_{uid}', 'gexLadderCols', 'chart'],
    ['stkhll.v1', 'hlLadders', 'chart'],
    ['stkbp.v1', 'bookPanel', 'chart', { omit: ['w'] }],
    ['stkdkp.v1', 'darkPool', 'chart'],
    ['stryker_chart_events_prefs', 'chartEvents', 'chart'],
    ['stryker_community_disclaimer_ack_v1', 'communityAck', 'chart'],
    ['stryker_replay_hide', 'replayHide', 'chart'],
    ['stk-drawing-names', 'drawingNames', 'chart'],             // the chart engine keeps drawing names outside the layout doc
    ['tz_nav_sec', 'navSections', 'app'],
    // ---- trading, alerts, hotkeys (group trade). Paper trading only; nothing here touches a broker.
    ['stryker_chart_alert_prefs', 'alertPrefs', 'trade'],      // alert lines + sounds (assets/chart-sounds.js shares it)
    ['stryker_chart_alerts_paused', 'alertsPaused', 'trade'],
    ['stryker_chart_alerts_ind', 'indicatorAlerts', 'trade'],
    ['stryker_paper_hotkeys_{uid}', 'paperHotkeys', 'trade'],  // mirror of the paper account's hotkeys (chart-paper.js)
    ['stryker_op_{uid}', 'orderPanel', 'trade', { omit: ['x', 'y', 'w', 'h', 'min', 'max', 'open', 'mode', 'dw'] }],
    ['stryker_paper_ui', 'paperPanel', 'trade', { omit: ['open', 'h'] }],
    ['stryker_posorders_ui', 'posOrders', 'trade', { omit: ['h'] }]
  ];
  var GROUPS = ['app', 'chart', 'trade'];
  var VALUE_MAX = 60000;          // chars per value (doc stays well under 200 KB)
  var GROUP_MAX = 180000;         // chars per group doc
  var DEBOUNCE_MS = 1000;
  var STORM_N = 20, STORM_WIN = 60000, STORM_BACKOFF = 10000;

  // ------------------------------------------------------------------ pure core (Node-tested)
  function hash(s) {
    if (s == null) return 'n';
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36) + ':' + s.length;
  }
  function isEmpty(s) { return s == null || s === '' || s === '[]' || s === '{}' || s === 'null'; }
  function parseObj(s) { try { var o = JSON.parse(s); return o && typeof o === 'object' && !Array.isArray(o) ? o : null; } catch (e) { return null; } }
  // the synced part of a local value (omitted fields removed)
  function norm(raw, spec) {
    if (raw == null || !spec.omit) return raw;
    var o = parseObj(raw); if (!o) return raw;
    spec.omit.forEach(function (k) { delete o[k]; });
    return JSON.stringify(o);
  }
  // the local value after taking a remote one (omitted fields kept from this device)
  function mergeIn(localRaw, remote, spec) {
    if (remote == null || !spec.omit) return remote;
    var r = parseObj(remote); if (!r) return remote;
    var l = parseObj(localRaw) || {};
    spec.omit.forEach(function (k) { delete r[k]; if (k in l) r[k] = l[k]; });
    return JSON.stringify(r);
  }
  function tsMs(t) { if (!t) return 0; if (typeof t.toMillis === 'function') return t.toMillis(); if (typeof t === 'number') return t; return 0; }
  function makeMap(uid, skip) {
    var m = new Map();
    REGISTRY.forEach(function (r) {
      if (skip && skip.indexOf(r[0]) >= 0) return;   // owned by the host (the Android app syncs its theme natively)
      m.set(r[0].replace('{uid}', uid), { key: r[0].replace('{uid}', uid), id: r[1], group: r[2], omit: (r[3] && r[3].omit) || null }); });
    return m;
  }
  /**
   * First snapshot of a group: what to do with each key.
   *   local: normalised local value (string|null), remote: {has, value, ms}, seen: hash at the last sync (undefined = never),
   *   localMs: when this device last changed it (0 = unknown). Returns 'push' | 'apply' | 'same' | 'none'.
   */
  function reconcile(local, remote, seen, localMs) {
    if (!remote.has) return isEmpty(local) ? 'none' : 'push';
    if (remote.value === local) return 'same';
    var localChanged = seen === undefined ? !isEmpty(local) : hash(local) !== seen;
    var remoteChanged = seen === undefined ? true : hash(remote.value) !== seen;
    if (localChanged && !remoteChanged) return 'push';
    if (!localChanged) return 'apply';
    // both changed (or first sign-in on this device with a different value): newest wins when known
    if (isEmpty(remote.value) && !isEmpty(local)) return 'push';     // never wipe a device's settings with an empty one
    if (localMs && remote.ms && localMs > remote.ms) return 'push';
    return 'apply';
  }
  /** Later snapshots: apply a remote value unless it equals ours or ours is still waiting to flush. */
  function shouldApply(local, remoteValue, dirty) { return !dirty && remoteValue !== local; }

  // ------------------------------------------------------------------ browser
  function boot(win) {
    var api = { ready: false, writes: 0, applied: 0, REGISTRY: REGISTRY };
    if (!win || !win.localStorage || typeof Storage === 'undefined') return api;
    var LS = win.localStorage;
    var P = Storage.prototype, rawSet = P.setItem, rawRemove = P.removeItem, rawGet = P.getItem;
    var uid = null, map = null, unsubs = [], first = {}, remoteSeen = {}, meta = null, timer = 0, flushing = false, flushAgain = false, stamps = [];

    var get = function (k) { try { return rawGet.call(LS, k); } catch (e) { return null; } };
    var metaKey = function () { return 'tz_acct_sync_' + uid; };
    function loadMeta() { var m = null; try { m = JSON.parse(get(metaKey()) || 'null'); } catch (e) {} m = m && typeof m === 'object' ? m : {}; m.h = m.h || {}; m.lt = m.lt || {}; m.dirty = m.dirty || {}; return m; }
    function saveMeta() { try { rawSet.call(LS, metaKey(), JSON.stringify(meta)); } catch (e) {} }

    // ---- hook: module writes to a registered key -> dirty -> debounced flush
    function touched(k) {
      if (!map || !uid) return;
      var spec = map.get(k); if (!spec) return;
      var v = norm(get(k), spec);
      if (meta.h[spec.id] === hash(v) && !meta.dirty[spec.id]) return;   // unchanged (modules often re-save the same value)
      meta.dirty[spec.id] = 1; meta.lt[spec.id] = Date.now(); saveMeta();
      schedule();
    }
    P.setItem = function (k, v) {
      if (this !== LS || !map) return rawSet.call(this, k, v);
      var before = map.has(k) ? get(k) : undefined;
      var r = rawSet.call(this, k, v);
      if (before !== undefined && before !== String(v)) touched(k);
      return r;
    };
    P.removeItem = function (k) {
      if (this !== LS || !map || !map.has(k)) return rawRemove.call(this, k);
      var had = get(k) != null;
      var r = rawRemove.call(this, k);
      if (had) touched(k);
      return r;
    };

    function fs() { try { return win.firebase && win.firebase.apps && win.firebase.apps.length && win.firebase.firestore ? win.firebase.firestore() : null; } catch (e) { return null; } }
    function ref(g) { return fs().collection('users').doc(uid).collection('prefs').doc(g); }
    function schedule(ms) {
      clearTimeout(timer);
      var now = Date.now();
      stamps = stamps.filter(function (t) { return now - t < STORM_WIN; });
      timer = setTimeout(flush, ms != null ? ms : (stamps.length >= STORM_N ? STORM_BACKOFF : DEBOUNCE_MS));
    }
    function flush() {
      if (!uid || !map || !fs()) return;
      if (flushing) { flushAgain = true; return; }
      var who = uid, FV = win.firebase.firestore.FieldValue, byGroup = {};
      map.forEach(function (spec) {
        if (!meta.dirty[spec.id] || !first[spec.group]) return;   // a group is flushed only after its first snapshot (reconciled)
        var v = norm(get(spec.key), spec);
        if (v != null && v.length > VALUE_MAX) { console.warn('TradeZoro sync: ' + spec.id + ' too big to sync, kept in this browser'); delete meta.dirty[spec.id]; return; }
        (byGroup[spec.group] = byGroup[spec.group] || []).push([spec.id, v]);
      });
      var groups = Object.keys(byGroup); if (!groups.length) return;
      flushing = true;
      Promise.all(groups.map(function (g) {
        var body = { v: {}, t: {}, updatedAt: FV.serverTimestamp() }, n = 0;
        byGroup[g].forEach(function (p) { n += (p[1] || '').length; if (n <= GROUP_MAX) { body.v[p[0]] = p[1]; body.t[p[0]] = FV.serverTimestamp(); } });
        stamps.push(Date.now()); api.writes++;
        return ref(g).set(body, { merge: true }).then(function () {
          if (who !== uid) return;
          byGroup[g].forEach(function (p) {
            var spec = null; map.forEach(function (s) { if (s.id === p[0]) spec = s; });
            if (!(p[0] in body.v)) return;
            // only clear dirty when the value did not change again while the write was in flight
            if (spec && norm(get(spec.key), spec) === p[1]) { delete meta.dirty[p[0]]; meta.h[p[0]] = hash(p[1]); }
          });
        }).catch(function (e) { console.warn('TradeZoro sync: save ' + g + ' (kept for later)', e && e.code); });
      })).then(function () {
        saveMeta(); flushing = false;
        if (flushAgain || Object.keys(meta.dirty).length) { flushAgain = false; if (Object.keys(meta.dirty).length) schedule(); }
      });
    }

    function applyRemote(spec, value) {
      var old = get(spec.key), next = mergeIn(old, value, spec);
      try { if (next == null) rawRemove.call(LS, spec.key); else rawSet.call(LS, spec.key, next); } catch (e) { return; }
      meta.h[spec.id] = hash(value); api.applied++;
      try { win.dispatchEvent(new StorageEvent('storage', { key: spec.key, oldValue: old, newValue: next, storageArea: LS, url: win.location.href })); } catch (e) {}
      try { win.dispatchEvent(new CustomEvent('stk:acct-pref', { detail: { key: spec.key, id: spec.id, value: next } })); } catch (e) {}
    }
    function onSnap(g, snap) {
      if (!snap || (snap.metadata && snap.metadata.hasPendingWrites)) return;   // our own write, still local
      var d = snap.exists ? (snap.data() || {}) : {}, v = d.v || {}, t = d.t || {};
      var isFirst = !first[g]; first[g] = true;
      var push = false;
      map.forEach(function (spec) {
        if (spec.group !== g) return;
        var local = norm(get(spec.key), spec), has = Object.prototype.hasOwnProperty.call(v, spec.id);
        var rv = has ? (v[spec.id] == null ? null : String(v[spec.id])) : undefined;
        if (isFirst) {
          var act = reconcile(local, { has: has, value: rv, ms: tsMs(t[spec.id]) }, meta.h[spec.id], meta.lt[spec.id] || 0);
          if (act === 'push') { meta.dirty[spec.id] = 1; push = true; }
          else if (act === 'apply') { delete meta.dirty[spec.id]; applyRemote(spec, rv); }
          else if (act === 'same') { meta.h[spec.id] = hash(local); delete meta.dirty[spec.id]; }
        } else if (has && remoteSeen[spec.id] !== hash(rv) && shouldApply(local, rv, !!meta.dirty[spec.id])) applyRemote(spec, rv);
        if (has) remoteSeen[spec.id] = hash(rv);
      });
      saveMeta();
      if (push) schedule(); else if (isFirst && Object.keys(meta.dirty).length) schedule();
      if (GROUPS.every(function (x) { return first[x]; })) { api.ready = true; try { win.dispatchEvent(new CustomEvent('stk:acct-ready')); } catch (e) {} }
    }
    function stop() { unsubs.forEach(function (f) { try { f(); } catch (e) {} }); unsubs = []; clearTimeout(timer); uid = null; map = null; first = {}; remoteSeen = {}; api.ready = false; }
    function start(u) {
      if (u === uid) return;
      if (uid && Object.keys(meta.dirty).length) flush();
      stop();
      if (!u || !fs()) return;
      uid = u; map = makeMap(u, Array.isArray(win.__tzAcctLocal) ? win.__tzAcctLocal : null); meta = loadMeta();
      GROUPS.forEach(function (g) {
        try { unsubs.push(ref(g).onSnapshot(function (s) { if (uid === u) onSnap(g, s); }, function (e) { console.warn('TradeZoro sync: listen ' + g, e && e.code); })); }
        catch (e) { console.warn('TradeZoro sync: listen ' + g, e); }
      });
    }
    function hook() {
      try {
        if (!win.firebase || !win.firebase.apps || !win.firebase.apps.length) return false;
        win.firebase.auth().onAuthStateChanged(function (user) { start(user ? user.uid : null); });
        return true;
      } catch (e) { return false; }
    }
    if (!hook()) { var n = 0, iv = setInterval(function () { if (hook() || ++n > 60) clearInterval(iv); }, 250); }
    win.addEventListener('online', function () { if (uid && Object.keys(meta.dirty).length) schedule(0); });
    win.addEventListener('pagehide', function () { if (uid && meta && Object.keys(meta.dirty).length) flush(); });
    api.flush = function () { schedule(0); };
    api.status = function () { return { uid: uid, ready: api.ready, writes: api.writes, applied: api.applied, dirty: meta ? Object.keys(meta.dirty) : [] }; };
    return api;
  }

  return { REGISTRY: REGISTRY, GROUPS: GROUPS, hash: hash, isEmpty: isEmpty, norm: norm, mergeIn: mergeIn, reconcile: reconcile, shouldApply: shouldApply, makeMap: makeMap, boot: boot };
});
