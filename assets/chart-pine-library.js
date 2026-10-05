// Stryker Trading Academy — Charts: Community Pine scripts (publish, browse, report, admin
// hide). Plain script, loaded by charts.html after chart-pine-scripts.js
// and chart-pine-guard.js. Uses window.STRYKER_PINE (assets/chart-pine.js) to put a
// script on the chart; never runs Pine itself.
//
// DATA: pineLibrary/{id} (id = 24 random chars). Rules: functions-src/firestore.rules,
// "Charts: published Pine scripts" block (released 2026-10-05, ruleset 0ff10a1e).
//   { ownerUid, authorName, name, description, tags[], visibility 'public',
//     openSource, source, version, createdAt, updatedAt, addCount, reportCount, status }
//   versions/{v}  last 5 older sources (author only)
//   adds/{uid}    one marker per member who added it (addCount +1 once)
//   reports/{uid} one report per member { reason, at }; the 3rd report hides it
//   boosts/{uid}  one boost per member { at, day } (not the author); boostCount +/-1
// Build 415 (indicator window): optional counters boostCount, boostRing, addRing and the
// admin-only Editors' pick flag picked / pickedAt. A "ring" is 8 day slots
// { s<day%8>: { d: <UTC day number>, n: <count> } } so "last 7 days" (Trending) needs no
// query; the rules check every slot write (+1 on today's slot, or a fresh {d: today, n: 1}).
// Owner 2026-10-05: Private or Public only (no invite links). Private = not published:
// the script stays in My scripts (students/{uid}/pineScripts) only.
//
// SAFETY: other members' scripts are checked by StrykerPineGuard before they are
// offered, and chart-pine.js runs them on the Web Worker engine only (shared:true).
//
// Exposes window.StrykerPineLibrary.

(function () {
  'use strict';
  var TAGS = ['scalping', 'trend', 'momentum', 'volume', 'levels', 'oscillator', 'volatility', 'session'];
  var REASONS = [['broken', 'Broken / doesn\'t work'], ['harmful', 'Harmful or misleading'], ['copied', 'Copied without permission'], ['spam', 'Spam']];
  var DESC_MAX = 280;
  var KEEP_VERSIONS = 5;

  function fb() { return (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) ? firebase : null; }
  function user() { var f = fb(); try { return f && f.auth().currentUser; } catch (e) { return null; } }
  function db() { return fb().firestore(); }
  function col() { return db().collection('pineLibrary'); }
  function ts() { return firebase.firestore.FieldValue.serverTimestamp(); }
  function ms(v) { return v && v.toMillis ? v.toMillis() : 0; }
  function err(m) { var e = new Error(m); e.userMessage = m; return e; }
  function newId() {
    var a = new Uint8Array(24), c = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', s = '';
    crypto.getRandomValues(a);
    for (var i = 0; i < a.length; i++) s += c[a[i] % 62];
    return s;
  }
  function toast(m) { try { if (window.STRYKER_PINE && window.STRYKER_PINE.toast) window.STRYKER_PINE.toast(m); } catch (e) {} }
  function fromDoc(d) {
    var x = d.data() || {};
    return { id: d.id, ownerUid: x.ownerUid, authorName: x.authorName || 'Member', name: x.name || 'Untitled',
      description: x.description || '', tags: Array.isArray(x.tags) ? x.tags : [], visibility: x.visibility,
      openSource: x.openSource !== false, source: x.source || '', version: x.version || 1,
      createdAt: ms(x.createdAt), updatedAt: ms(x.updatedAt), addCount: x.addCount || 0,
      reportCount: x.reportCount || 0, status: x.status || 'ok',
      boostCount: x.boostCount || 0, boostRing: x.boostRing || {}, addRing: x.addRing || {},
      picked: x.picked === true, pickedAt: ms(x.pickedAt) };
  }
  function today() { return Math.floor(Date.now() / 86400000); }
  // Field updates that put +1 on today's ring slot (d = UTC day number).
  function ringInc(field, ring, d) {
    var k = 's' + (d % 8), slot = (ring || {})[k], o = {};
    if (slot && slot.d === d) o[field + '.' + k + '.n'] = firebase.firestore.FieldValue.increment(1);
    else o[field + '.' + k] = { d: d, n: 1 };
    return o;
  }
  // Retry a write once with the neighbouring UTC day (client clock vs server time at midnight).
  async function withDay(fn) {
    var d = today(), tries = [d, d + 1, d - 1], last;
    for (var i = 0; i < tries.length; i++) {
      try { return await fn(tries[i]); } catch (e) { last = e; if (!e || e.code !== 'permission-denied') throw e; }
    }
    throw last;
  }

  var adminP = null;
  function isAdmin() {
    var u = user();
    if (!u) return Promise.resolve(false);
    if (!adminP) adminP = db().collection('admins').doc(u.uid).get().then(function (d) { return d.exists; }).catch(function () { return false; });
    return adminP;
  }
  // The rules accept the member's public profile name, or 'Member'.
  function authorName() {
    var u = user();
    return db().collection('profiles').doc(u.uid).get().then(function (d) {
      var n = d.exists ? String((d.data() || {}).displayName || '') : '';
      return n && n.length <= 60 ? n : 'Member';
    }).catch(function () { return 'Member'; });
  }

  // ---------------- data ----------------
  function get(id) {
    if (!/^[A-Za-z0-9]{20,40}$/.test(String(id || ''))) return Promise.resolve(null);
    return col().doc(id).get().then(function (d) { return d.exists ? fromDoc(d) : null; })
      .catch(function (e) { if (e && e.code === 'permission-denied') return null; throw e; });
  }
  function listPublic() {
    return col().where('visibility', '==', 'public').where('status', '==', 'ok').limit(200).get()
      .then(function (s) { var a = []; s.forEach(function (d) { a.push(fromDoc(d)); }); return a; });
  }
  function listMine() {
    var u = user();
    return col().where('ownerUid', '==', u.uid).get()
      .then(function (s) { var a = []; s.forEach(function (d) { a.push(fromDoc(d)); }); return a.sort(function (x, y) { return y.updatedAt - x.updatedAt; }); });
  }
  function listHidden() {
    return col().where('status', '==', 'hidden').limit(200).get()
      .then(function (s) { var a = []; s.forEach(function (d) { a.push(fromDoc(d)); }); return a; });
  }
  function clean(f) {
    var name = String(f.name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    if (!name) throw err('Give the script a name.');
    var src = String(f.source || '');
    if (!src.trim()) throw err('The script is empty.');
    if (src.length > 65536) throw err('The script is longer than 64 KB.');
    var g = window.StrykerPineGuard ? window.StrykerPineGuard.check(src) : { ok: false, msg: 'Safety check unavailable.' };
    if (!g.ok) throw err('Can\'t publish: ' + (g.line ? 'line ' + g.line + ': ' : '') + g.msg);
    var tags = (f.tags || []).filter(function (t) { return TAGS.indexOf(t) >= 0; }).slice(0, 5);
    return { name: name, description: String(f.description || '').trim().slice(0, DESC_MAX), tags: tags,
      visibility: 'public', openSource: !!f.openSource, source: src };
  }
  async function publish(f) {
    var u = user();
    if (!u) throw err('Sign in to publish.');
    var c = clean(f);
    var id = newId(), now = ts();
    await col().doc(id).set(Object.assign({ ownerUid: u.uid, authorName: await authorName() }, c,
      { version: 1, createdAt: now, updatedAt: now, addCount: 0, reportCount: 0, status: 'ok' }));
    return id;
  }
  // Edit: a changed source is a new version; the old source goes to versions/ (last 5 kept).
  async function update(id, f) {
    var u = user();
    if (!u) throw err('Sign in first.');
    var old = await get(id);
    if (!old || old.ownerUid !== u.uid) throw err('This script is not yours.');
    var c = clean(f);
    var bumped = c.source !== old.source;
    var b = db().batch(), ref = col().doc(id);
    b.update(ref, Object.assign({ authorName: await authorName() }, c, { version: bumped ? old.version + 1 : old.version, updatedAt: ts() }));
    if (bumped) b.set(ref.collection('versions').doc('v' + old.version), { version: old.version, source: old.source, savedAt: ts() });
    await b.commit();
    if (bumped) {
      try {
        var vs = await ref.collection('versions').get(), arr = [];
        vs.forEach(function (d) { arr.push({ ref: d.ref, v: (d.data() || {}).version || 0 }); });
        arr.sort(function (x, y) { return y.v - x.v; }).slice(KEEP_VERSIONS).forEach(function (x) { x.ref.delete().catch(function () {}); });
      } catch (e) {}
    }
    return bumped ? old.version + 1 : old.version;
  }
  async function unpublish(id) {
    var ref = col().doc(id);
    try { var vs = await ref.collection('versions').get(); await Promise.all(vs.docs.map(function (d) { return d.ref.delete(); })); } catch (e) {}
    await ref.delete();
  }
  async function versions(id) {
    var s = await col().doc(id).collection('versions').get(), a = [];
    s.forEach(function (d) { var x = d.data() || {}; a.push({ version: x.version, source: x.source, savedAt: ms(x.savedAt) }); });
    return a.sort(function (x, y) { return y.version - x.version; });
  }
  // First add by a member counts once (adds/{uid} marker + addCount +1 in one batch).
  async function countAdd(s) {
    var u = user();
    if (!u || s.ownerUid === u.uid || s.status !== 'ok') return;
    var ref = col().doc(s.id), mk = ref.collection('adds').doc(u.uid);
    try {
      if ((await mk.get()).exists) return;
      var cur = await get(s.id);
      if (!cur) return;
      await withDay(function (d) {
        var b = db().batch();
        b.update(ref, Object.assign({ addCount: cur.addCount + 1 }, ringInc('addRing', cur.addRing, d)));
        b.set(mk, { at: ts() });
        return b.commit();
      });
    } catch (e) { console.warn('Stryker: add count', e); }
  }
  // Boosts: one per member per script, never the author's own. Returns { on, count, ring }.
  function myBoost(id) {
    var u = user();
    if (!u) return Promise.resolve(false);
    return col().doc(id).collection('boosts').doc(u.uid).get().then(function (d) { return d.exists; }).catch(function () { return false; });
  }
  async function boost(s, on) {
    var u = user();
    if (!u) throw err('Sign in to boost scripts.');
    if (s.ownerUid === u.uid) throw err('You can\'t boost your own script.');
    var ref = col().doc(s.id), mk = ref.collection('boosts').doc(u.uid);
    var had = (await mk.get()).exists;
    var cur = await get(s.id);
    if (!cur || cur.status !== 'ok') throw err('This script is no longer published.');
    if (had === on) return { on: on, count: cur.boostCount, ring: cur.boostRing };
    if (on) {
      await withDay(function (d) {
        var b = db().batch();
        b.update(ref, Object.assign({ boostCount: firebase.firestore.FieldValue.increment(1) }, ringInc('boostRing', cur.boostRing, d)));
        b.set(mk, { at: ts(), day: d });
        return b.commit();
      });
    } else {
      // Taking a boost back also takes it off the day slot it was counted in (if still there).
      var md = ((await mk.get()).data() || {}).day, o = { boostCount: firebase.firestore.FieldValue.increment(-1) };
      var k = 's' + (md % 8), slot = cur.boostRing[k];
      if (typeof md === 'number' && slot && slot.d === md && slot.n > 0) o['boostRing.' + k + '.n'] = firebase.firestore.FieldValue.increment(-1);
      var b = db().batch();
      b.update(ref, o);
      b.delete(mk);
      await b.commit();
    }
    var after = await get(s.id);
    return { on: on, count: after ? after.boostCount : cur.boostCount + (on ? 1 : -1), ring: after ? after.boostRing : cur.boostRing };
  }
  function setPicked(id, on) {
    return col().doc(id).update({ picked: !!on, pickedAt: ts() });
  }
  async function report(s, reason) {
    var u = user();
    if (!u) throw err('Sign in to report.');
    if (s.ownerUid === u.uid) throw err('You can\'t report your own script.');
    var ref = col().doc(s.id), mk = ref.collection('reports').doc(u.uid);
    if ((await mk.get().catch(function () { return { exists: false }; })).exists) throw err('You already reported this script.');
    var cur = await get(s.id);
    if (!cur) throw err('This script is no longer published.');
    var n = cur.reportCount + 1;
    var b = db().batch();
    b.update(ref, { reportCount: n, status: n >= 3 ? 'hidden' : cur.status });
    b.set(mk, { reason: reason, at: ts() });
    await b.commit();
    return n;
  }
  function setStatus(id, status, resetReports) {
    var o = { status: status };
    if (resetReports) o.reportCount = 0;
    return col().doc(id).update(o);
  }

  // ---------------- UI helpers ----------------
  function h(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'text') n.textContent = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (c) { if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  var openSheet = null;
  function sheet(title, body, foot) {
    closeSheet();
    var card = h('div', { class: 'stkc-dcard', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, [
      h('div', { class: 'stkc-dhead' }, [h('h3', { text: title }), h('button', { type: 'button', class: 'stkc-dclose', 'aria-label': 'Close', text: '\u00d7', onclick: closeSheet })]),
      h('div', { class: 'stkc-dbody stkc-scroll' }, [body]),
      foot ? h('div', { class: 'stkc-dfooter' }, foot) : null
    ]);
    var ov = h('div', { class: 'stkc-dialog', onclick: function (e) { if (e.target === ov) closeSheet(); } }, [card]);
    ov.addEventListener('keydown', function (e) { e.stopPropagation(); if (e.key === 'Escape') closeSheet(); });
    document.body.appendChild(ov);
    openSheet = ov;
    setTimeout(function () { var f = card.querySelector('input,textarea,button.stkc-ctab'); if (f && window.innerWidth > 700) f.focus(); }, 0);
    return card;
  }
  function closeSheet() { if (openSheet) { openSheet.remove(); openSheet = null; } }
  function msgBox() { return h('p', { class: 'stkc-form-msg', role: 'status', hidden: true }); }
  function say(box, text, bad) { box.hidden = !text; box.textContent = text || ''; box.classList.toggle('bad', !!bad); }
  function rel(t) {
    if (!t) return '';
    var d = Math.round((Date.now() - t) / 86400000);
    return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 30 ? d + ' days ago' : new Date(t).toLocaleDateString();
  }

  // ---------------- Publish / edit sheet ----------------
  // opts: { name, source } for a new listing from My scripts, or { item } to edit one.
  async function openPublish(opts) {
    if (!user()) { toast('Sign in to publish scripts.'); return; }
    var item = opts.item || null;
    var src = item ? item.source : opts.source;
    var mine = [];
    if (!item) { try { mine = await listMine(); } catch (e) {} }
    var nameIn = h('input', { type: 'text', class: 'stkc-in', maxlength: '60', value: item ? item.name : (opts.name || '') });
    var descIn = h('textarea', { class: 'stkc-in stkc-ta stkc-scroll', maxlength: String(DESC_MAX), rows: '3', placeholder: 'What it draws and how to read it.' });
    descIn.value = item ? item.description : '';
    var count = h('span', { class: 'stkc-note', text: descIn.value.length + '/' + DESC_MAX });
    descIn.addEventListener('input', function () { count.textContent = descIn.value.length + '/' + DESC_MAX; });
    var tagBoxes = TAGS.map(function (t) {
      var c = h('input', { type: 'checkbox', value: t });
      c.checked = !!(item && item.tags.indexOf(t) >= 0);
      return h('label', { class: 'stkc-tag-check' }, [c, ' ' + t]);
    });
    var target = null;
    if (!item && mine.length) {
      target = h('select', { class: 'stkc-in' }, [h('option', { value: '', text: 'Publish as a new script' })].concat(mine.map(function (m) {
        return h('option', { value: m.id, text: 'Update "' + m.name + '" (v' + m.version + ' \u2192 new version)' });
      })));
      var same = mine.filter(function (m) { return m.name === opts.name; })[0];
      if (same) target.value = same.id;
    }
    var pubR = h('input', { type: 'radio', name: 'stkc-vis', value: 'public' });
    var privR = h('input', { type: 'radio', name: 'stkc-vis', value: 'private' });
    pubR.checked = true;
    var openC = h('input', { type: 'radio', name: 'stkc-code', value: 'open' });
    var hideC = h('input', { type: 'radio', name: 'stkc-code', value: 'hide' });
    openC.checked = !item || item.openSource; hideC.checked = !openC.checked;
    var rights = h('input', { type: 'checkbox' });
    var box = msgBox();
    var body = h('div', { class: 'stkc-form' }, [
      target ? h('div', { class: 'stkc-fgroup' }, [h('label', { text: 'Listing' }), target]) : null,
      h('div', { class: 'stkc-fgroup' }, [h('label', { text: 'Name' }), nameIn]),
      h('div', { class: 'stkc-fgroup' }, [h('label', { text: 'Short description' }), descIn, count]),
      h('div', { class: 'stkc-fgroup' }, [h('label', { text: 'Tags (optional, up to 5)' }), h('div', { class: 'stkc-tags' }, tagBoxes)]),
      h('div', { class: 'stkc-fgroup' }, [h('label', { text: 'Who can use it' }), h('div', { class: 'stkc-radio-group' }, [
        h('label', { class: 'stkc-radio-check' }, [pubR, h('span', {}, [h('strong', { text: 'Public:' }), ' listed in Community scripts for every signed-in member.'])]),
        h('label', { class: 'stkc-radio-check' }, [privR, h('span', {}, [h('strong', { text: 'Private:' }), ' only you. ' + (item ? 'Unpublishes it; your copy stays in My scripts.' : 'It stays in My scripts, nothing is shared.')])])
      ])]),
      h('div', { class: 'stkc-fgroup' }, [h('label', { text: 'Code' }), h('div', { class: 'stkc-radio-group' }, [
        h('label', { class: 'stkc-radio-check' }, [openC, h('span', {}, [h('strong', { text: 'Open source:' }), ' others can see the code and save a copy.'])]),
        h('label', { class: 'stkc-radio-check' }, [hideC, h('span', {}, [h('strong', { text: 'Code hidden in the editor:' }), ' others can add it to their chart but the editor won\'t show the source. The code still reaches their browser, so a technical user can read it.'])])
      ])]),
      h('label', { class: 'stkc-checkbox' }, [rights, h('span', { text: 'I wrote this script or have the right to share it.' })]),
      h('p', { class: 'stkc-note', text: 'Shared scripts must not promise profits or results. Education only. Not financial advice.' }),
      box
    ]);
    var go = h('button', { type: 'button', class: 'stkc-sbtn', text: item ? 'Save changes' : 'Publish' });
    var card = sheet(item ? 'Edit published script' : 'Publish script', body, [h('button', { type: 'button', class: 'stkc-btn', text: 'Cancel', onclick: closeSheet }), go]);
    go.addEventListener('click', async function () {
      if (privR.checked) {
        if (!item) { closeSheet(); toast('Kept private in My scripts'); return; }
        if (!window.confirm('Make "' + item.name + '" private? It leaves Community; members who added it keep their copy, marked "No longer published".')) return;
        go.disabled = true;
        try { await unpublish(item.id); closeSheet(); toast('Now private: unpublished'); } catch (e) { say(box, 'Could not unpublish.', true); go.disabled = false; }
        return;
      }
      if (!rights.checked) { say(box, 'Tick "I wrote this script or have the right to share it" first.', true); return; }
      var f = { name: nameIn.value, description: descIn.value, source: src, visibility: 'public',
        openSource: openC.checked, tags: tagBoxes.map(function (l) { return l.firstChild; }).filter(function (c) { return c.checked; }).map(function (c) { return c.value; }) };
      go.disabled = true; say(box, 'Publishing\u2026');
      try {
        var id = item ? item.id : (target && target.value) || null, ver;
        if (id) ver = await update(id, f); else { id = await publish(f); ver = 1; }
        showDone(id, f, ver);
      } catch (e) {
        console.warn('Stryker: publish', e);
        say(box, (e && e.userMessage) || 'Could not publish. Try again.', true);
        go.disabled = false;
      }
    });
  }
  function showDone(id, f, ver) {
    sheet('Published', h('div', { class: 'stkc-form' }, [
      h('p', { text: '"' + f.name + '" v' + ver + ' is listed in Community scripts.' }),
      h('p', { class: 'stkc-note', text: 'Edit it, make it private again, or unpublish any time from Community scripts \u2192 Published by me.' })
    ]), [h('button', { type: 'button', class: 'stkc-btn', text: 'See it', onclick: function () { openCommunity('mine'); } }),
         h('button', { type: 'button', class: 'stkc-sbtn', text: 'Done', onclick: closeSheet })]);
  }

  // ---------------- Community sheet ----------------
  function card(s, ctx) {
    var me = user(), mineFlag = me && s.ownerUid === me.uid;
    var badges = h('div', { class: 'stkc-cbadges' }, [
      h('span', { class: 'stkc-badge ' + (s.openSource ? 'is-open' : 'is-hidden'), text: s.openSource ? 'Open source' : 'Code hidden' }),
      h('span', { class: 'stkc-badge', text: 'v' + s.version }),
      s.picked ? h('span', { class: 'stkc-badge is-open', text: 'Editors\u2019 pick' }) : null,
      s.status === 'hidden' ? h('span', { class: 'stkc-badge is-warn', text: 'Hidden' + (s.reportCount ? ' (' + s.reportCount + ' reports)' : '') }) : null
    ].concat(s.tags.map(function (t) { return h('span', { class: 'stkc-badge is-tag', text: t }); })));
    var acts = h('div', { class: 'stkc-cacts' });
    var box = msgBox();
    function btn(label, fn, cls) { var b = h('button', { type: 'button', class: cls || 'stkc-btn', text: label }); b.addEventListener('click', function () { fn(b); }); acts.appendChild(b); return b; }
    btn('Add to chart', async function (b) {
      b.disabled = true; say(box, 'Adding\u2026');
      var r = await addToChart(s);
      b.disabled = false;
      if (r.ok) { say(box, ''); closeSheet(); } else say(box, r.msg, true);
    }, 'stkc-sbtn');
    if (s.openSource || mineFlag) {
      btn('View code', function () { closeSheet(); window.STRYKER_PINE && window.STRYKER_PINE.open(); window.STRYKER_PINE && window.STRYKER_PINE.load(s.name, s.source, null); });
      if (!mineFlag) btn('Save to My scripts', async function (b) {
        b.disabled = true;
        try { await window.StrykerPineScripts.save(s.name, s.source, null); say(box, 'Saved to My scripts.'); }
        catch (e) { say(box, (e && e.userMessage) || 'Could not save.', true); }
        b.disabled = false;
      });
    }
    if (mineFlag) {
      btn('Edit', function () { openPublish({ item: s }); });
      btn('Unpublish', async function (b) {
        if (!window.confirm('Unpublish "' + s.name + '"? Members who added it keep their copy, marked "No longer published".')) return;
        b.disabled = true;
        try { await unpublish(s.id); toast('Unpublished'); ctx && ctx.refresh(); } catch (e) { say(box, 'Could not unpublish.', true); b.disabled = false; }
      }, 'stkc-btn stkc-del');
    } else if (me) {
      btn('Report', function () { openReport(s, box); });
    }
    if (ctx && ctx.admin && s.status === 'ok') {
      btn(s.picked ? 'Remove Editors\u2019 pick (admin)' : 'Editors\u2019 pick (admin)', async function (b) {
        b.disabled = true;
        try { await setPicked(s.id, !s.picked); s.picked = !s.picked; b.textContent = s.picked ? 'Remove Editors\u2019 pick (admin)' : 'Editors\u2019 pick (admin)'; toast(s.picked ? 'Marked as an Editors\u2019 pick' : 'Removed from Editors\u2019 picks'); }
        catch (e) { say(box, 'Failed.', true); }
        b.disabled = false;
      });
    }
    if (ctx && ctx.admin) {
      if (s.status === 'hidden') btn('Restore (admin)', async function (b) { b.disabled = true; try { await setStatus(s.id, 'ok', true); ctx.refresh(); } catch (e) { say(box, 'Failed.', true); b.disabled = false; } });
      else if (!mineFlag) btn('Hide (admin)', async function (b) { b.disabled = true; try { await setStatus(s.id, 'hidden'); ctx.refresh(); } catch (e) { say(box, 'Failed.', true); b.disabled = false; } });
    }
    var bst = boostButton(s, box);
    return h('li', { class: 'stkc-ccard' }, [
      h('div', { class: 'stkc-chead stkc-chead-row' }, [h('div', { class: 'stkc-chead' }, [h('b', { text: s.name }), h('span', { class: 'stkc-note', text: 'by ' + s.authorName + ' \u00b7 ' + s.addCount + ' added \u00b7 updated ' + rel(s.updatedAt) })]), bst]),
      s.description ? h('p', { class: 'stkc-cdesc', text: s.description }) : null,
      badges, acts, box
    ]);
  }
  function fmtCount(n) {
    n = Number(n) || 0;
    if (n < 1000) return String(n);
    if (n < 1e6) { var k = n / 1000; return (k < 100 ? k.toFixed(1).replace(/\.0$/, '') : Math.round(k)) + 'K'; }
    var m = n / 1e6; return (m < 100 ? m.toFixed(1).replace(/\.0$/, '') : Math.round(m)) + 'M';
  }
  // Rocket button with the count, TradingView-style. The author sees the count only.
  function boostButton(s, box) {
    var u = user(), own = u && s.ownerUid === u.uid;
    var num = h('span', { class: 'stkiw-bn', text: fmtCount(s.boostCount) });
    var b = h('button', { type: 'button', class: 'stkiw-boost stkc-cboost', 'aria-pressed': 'false', title: own ? 'Boosts (you can\u2019t boost your own script)' : 'Boost' },
      [h('span', { class: 'stkiw-rk', 'aria-hidden': 'true', text: '\uD83D\uDE80' }), num, h('span', { class: 'stkiw-bl', text: ' Boost' })]);
    var on = false;
    function paint() { b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); num.textContent = fmtCount(s.boostCount); b.setAttribute('aria-label', fmtCount(s.boostCount) + ' boosts' + (own ? '' : on ? ', boosted' : ', boost ' + s.name)); }
    paint();
    if (own || !u || s.status !== 'ok') { b.disabled = true; b.classList.add('is-own'); return b; }
    myBoost(s.id).then(function (x) { on = x; paint(); });
    b.addEventListener('click', async function () {
      b.disabled = true;
      try { var r = await boost(s, !on); on = r.on; s.boostCount = r.count; s.boostRing = r.ring; }
      catch (e) { say(box, (e && e.userMessage) || 'Could not save the boost.', true); }
      b.disabled = false; paint();
    });
    return b;
  }
  function openReport(s, outBox) {
    var radios = REASONS.map(function (r, i) {
      var x = h('input', { type: 'radio', name: 'stkc-rr', value: r[0] }); x.checked = i === 0;
      return h('label', { class: 'stkc-radio-check' }, [x, h('span', { text: r[1] })]);
    });
    var box = msgBox();
    var send = h('button', { type: 'button', class: 'stkc-sbtn', text: 'Send report' });
    var prev = openSheet;
    if (prev) prev.style.display = 'none';
    openSheet = null;
    var restore = function () { closeSheet(); if (prev) { prev.style.display = ''; openSheet = prev; } };
    var c = sheet('Report "' + s.name + '"', h('div', { class: 'stkc-form' }, [h('div', { class: 'stkc-radio-group' }, radios),
      h('p', { class: 'stkc-note', text: 'Three reports hide a script from Community until an admin checks it.' }), box]),
      [h('button', { type: 'button', class: 'stkc-btn', text: 'Cancel', onclick: restore }), send]);
    c.querySelector('.stkc-dclose').onclick = restore;
    send.addEventListener('click', async function () {
      var v = c.querySelector('input[name="stkc-rr"]:checked').value;
      send.disabled = true;
      try { await report(s, v); restore(); say(outBox, 'Thanks. Your report was sent.'); }
      catch (e) { say(box, (e && e.userMessage) || 'Could not send the report.', true); send.disabled = false; }
    });
  }
  async function addToChart(s) {
    var P = window.STRYKER_PINE;
    if (!P || !P.addShared) return { ok: false, msg: 'The chart is still loading. Try again in a moment.' };
    var g = window.StrykerPineGuard.check(s.source);
    if (!g.ok) return { ok: false, msg: 'This script failed the safety check, so it won\'t run' + (g.line ? ' (line ' + g.line + ')' : '') + ': ' + g.msg };
    var r = await P.addShared(s);
    if (r.ok) countAdd(s);
    return r;
  }

  async function openCommunity(tab, query) {
    if (!user()) {
      sheet('Community scripts', h('p', { text: 'Sign in to browse and share Pine scripts with other members.' }), [h('a', { class: 'stkc-sbtn', href: 'login.html?next=' + encodeURIComponent(location.pathname), text: 'Sign in' })]);
      return;
    }
    var admin = await isAdmin();
    var q = h('input', { type: 'search', class: 'stkc-in', placeholder: 'Search name or tag', 'aria-label': 'Search community scripts' });
    var sort = h('select', { class: 'stkc-in', 'aria-label': 'Sort' }, [h('option', { value: 'pop', text: 'Popular' }), h('option', { value: 'new', text: 'Newest' })]);
    var tabs = [['all', 'Community'], ['mine', 'Published by me']].concat(admin ? [['hidden', 'Hidden (admin)']] : []);
    var cur = tab || 'all';
    var tabRow = h('div', { class: 'stkc-ctabs', role: 'tablist' });
    var list = h('ul', { class: 'stkc-clist' });
    var note = h('p', { class: 'stkc-note' });
    var data = [];
    var ctx = { admin: admin, refresh: function () { load(); } };
    tabs.forEach(function (t) {
      var b = h('button', { type: 'button', class: 'stkc-ctab', role: 'tab', text: t[1], onclick: function () { cur = t[0]; paintTabs(); load(); } });
      b.dataset.k = t[0]; tabRow.appendChild(b);
    });
    function paintTabs() { tabRow.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-selected', b.dataset.k === cur ? 'true' : 'false'); }); }
    function render() {
      var s = q.value.trim().toLowerCase();
      var a = data.filter(function (x) { return !s || x.name.toLowerCase().indexOf(s) >= 0 || x.tags.some(function (t) { return t.indexOf(s) >= 0; }) || x.authorName.toLowerCase().indexOf(s) >= 0; });
      a.sort(sort.value === 'new' ? function (x, y) { return y.createdAt - x.createdAt; } : function (x, y) { return (y.addCount - x.addCount) || (y.updatedAt - x.updatedAt); });
      list.innerHTML = '';
      a.forEach(function (x) { list.appendChild(card(x, ctx)); });
      note.textContent = a.length ? '' : (data.length ? 'No scripts match.' : (cur === 'mine' ? 'You haven\'t published any scripts. Use the share icon next to a script in My scripts.' : cur === 'hidden' ? 'Nothing hidden.' : 'No community scripts yet. Be the first: publish one from My scripts.'));
      note.hidden = !note.textContent;
    }
    async function load() {
      note.hidden = false; note.textContent = 'Loading\u2026'; list.innerHTML = '';
      try { data = await (cur === 'mine' ? listMine() : cur === 'hidden' ? listHidden() : listPublic()); }
      catch (e) { console.warn('Stryker: community list', e); data = []; note.textContent = 'Could not load scripts. Check your connection.'; return; }
      render();
    }
    if (query) q.value = String(query);
    q.addEventListener('input', render);
    q.addEventListener('keydown', function (e) { e.stopPropagation(); });
    sort.addEventListener('change', render);
    paintTabs();
    sheet('Community scripts', h('div', { class: 'stkc-form' }, [tabRow, h('div', { class: 'stkc-saverow' }, [q, sort]), note, list,
      h('p', { class: 'stkc-note', text: 'Scripts are written by members, not by Stryker. They run on your chart in your browser, in a sandbox. Education only. Not financial advice.' })]), null).classList.add('is-wide');
    load();
  }

  window.StrykerPineLibrary = { TAGS: TAGS, get: get, listPublic: listPublic, listMine: listMine, publish: publish, update: update,
    unpublish: unpublish, versions: versions, report: report, setStatus: setStatus, isAdmin: isAdmin,
    myBoost: myBoost, boost: boost, setPicked: setPicked, addItem: addToChart, fmtCount: fmtCount,
    openPublish: openPublish, openCommunity: openCommunity, close: closeSheet };
})();
