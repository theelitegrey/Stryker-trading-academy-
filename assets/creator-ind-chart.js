// TradeZoro Charts: "From your communities" (Creator Hub phase B). Plain script, loaded by charts.html.
// Lists every community indicator the signed-in member can use, plus locked ones from communities he is in.
// Exposes window.StrykerCommunityInd = { list() -> Promise<items>, add(item), openFromUrl() }.
// item = { cid, iid, name, desc, cname, logo, usable, why, version, tags }
// Reads: members (collection group, uid == me), communities/{cid}, communities/{cid}/indicators (live), and
// access grants for my verified email (collection group 'access'). Running one goes through STRYKER_PINE.addSealed,
// which asks /api/creator/ind: that server check is what really decides, on every load.
(function () {
  'use strict';
  function fb() { return (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) ? firebase : null; }
  function user() { var f = fb(); try { return f && f.auth().currentUser; } catch (e) { return null; } }
  function ms(v) { return v && v.toMillis ? v.toMillis() : (v ? new Date(v).getTime() : 0); }
  function activeMem(m) { return m && m.status === 'active' && (!m.expiresAt || ms(m.expiresAt) > Date.now()); }
  var cache = null, at = 0;

  async function list(force) {
    var u = user(); if (!u) return [];
    if (cache && !force && Date.now() - at < 60000) return cache;
    var db = fb().firestore();
    var mems = await db.collectionGroup('members').where('uid', '==', u.uid).get().catch(function () { return { docs: [] }; });
    var byC = {};
    mems.docs.forEach(function (d) { var cid = d.ref.parent.parent.id; byC[cid] = { mem: d.data() }; });
    var email = (u.email || '').toLowerCase();
    var grants = [];
    if (email && u.emailVerified) {
      var g = await db.collectionGroup('access').where('email', '==', email).get().catch(function () { return { docs: [] }; });
      g.docs.forEach(function (d) {
        var x = d.data(); var iid = d.ref.parent.parent.id, cid = d.ref.parent.parent.parent.parent.id;
        if (x.status === 'active' && (!x.expiresAt || ms(x.expiresAt) > Date.now())) { grants.push(cid + '/' + iid); if (!byC[cid]) byC[cid] = { mem: null }; }
      });
    }
    var out = [];
    await Promise.all(Object.keys(byC).map(async function (cid) {
      var c = await db.collection('communities').doc(cid).get().catch(function () { return null; });
      if (!c || !c.exists) return;
      var cm = c.data(); if (cm.status !== 'active') return;
      var mem = byC[cid].mem, own = cm.ownerUid === u.uid;
      var inds = [];
      if (mem || own) {
        var s = await db.collection('communities').doc(cid).collection('indicators').where('status', '==', 'live').get().catch(function () { return { docs: [] }; });
        inds = s.docs;
      } else {
        // only a solo grant here: read those indicators one by one
        inds = (await Promise.all(grants.filter(function (k) { return k.indexOf(cid + '/') === 0; }).map(function (k) {
          return db.collection('communities').doc(cid).collection('indicators').doc(k.split('/')[1]).get().catch(function () { return null; });
        }))).filter(function (d) { return d && d.exists && d.data().status === 'live'; });
      }
      inds.forEach(function (d) {
        var x = d.data();
        var viaPlan = mem && activeMem(mem) && (x.planIds || []).indexOf(mem.planId) >= 0;
        var viaGrant = grants.indexOf(cid + '/' + d.id) >= 0;
        out.push({ cid: cid, iid: d.id, name: x.name, desc: x.desc || '', tags: x.tags || [], cname: cm.name, logo: cm.logoUrl || '', accent: cm.accent,
          version: x.version, usable: !!(own || viaPlan || viaGrant), why: own ? 'yours' : viaPlan ? 'plan' : viaGrant ? 'grant' : 'locked' });
      });
    }));
    out.sort(function (a, b) { return (b.usable - a.usable) || a.cname.localeCompare(b.cname) || a.name.localeCompare(b.name); });
    cache = out; at = Date.now();
    return out;
  }

  async function add(it) {
    if (!it.usable) { location.href = '/c/' + encodeURIComponent(it.cid) + '?tab=indicators'; return { ok: true }; }
    if (!window.STRYKER_PINE || !window.STRYKER_PINE.addSealed) return { ok: false, msg: 'The chart is still loading. Try again in a moment.' };
    var r = await window.STRYKER_PINE.addSealed({ cid: it.cid, iid: it.iid, name: it.name, logo: it.logo });
    if (!r.ok && r.code === 'noaccess') cache = null;
    return r;
  }

  // /charts?cind=<cid>/<iid> (the community page's "Open on ZoroCharts"): add it once the chart and sign-in are ready.
  function openFromUrl() {
    var m = /[?&]cind=([a-z0-9-]{3,30})(?:\/|%2F)([A-Za-z0-9]{12,24})/.exec(location.search);
    if (!m) return;
    var tries = 0;
    (function wait() {
      var f = fb(), u = user();
      var ready = window.STRYKER_PINE && window.STRYKER_PINE.addSealed && f;
      if ((!ready || !u) && tries++ < 60) return setTimeout(wait, 500);
      if (!u) { if (window.STRYKER_PINE && window.STRYKER_PINE.toast) window.STRYKER_PINE.toast('Sign in to open this community indicator.', 'error'); return; }
      try { history.replaceState(null, '', location.pathname + location.search.replace(/([?&])cind=[^&]*&?/, '$1').replace(/[?&]$/, '') + location.hash); } catch (e) {}
      f.firestore().collection('communities').doc(m[1]).collection('indicators').doc(m[2]).get().then(function (d) {
        var name = d.exists ? d.data().name : 'Community indicator';
        return window.STRYKER_PINE.addSealed({ cid: m[1], iid: m[2], name: name });
      }).catch(function () { return window.STRYKER_PINE.addSealed({ cid: m[1], iid: m[2], name: 'Community indicator' }); })
        .then(function (r) { if (r && !r.ok && window.STRYKER_PINE.toast) window.STRYKER_PINE.toast(r.msg, 'error'); });
    })();
  }

  window.StrykerCommunityInd = { list: list, add: add, openFromUrl: openFromUrl };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', openFromUrl); else openFromUrl();
})();
