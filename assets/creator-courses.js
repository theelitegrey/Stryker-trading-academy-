// Creator Hub -> Courses tab (creator.html). Plain script; creator-hub.js calls CHCourses.view(el, ctx).
// ctx = { cid, cm, plans, members, reload() }. Owner only (the rules say so too).
// Data (communities/{cid}/courses/{crid}/...): modules, lessons (metadata only), lessons/{lid}/content/body (the content),
// progress/{uid}, notes, access/{email}; files/{fid} registry + stats/storage total. Rules: functions-src/firestore.rules "courses".
// Files go to Storage (communities/{cid}/files/{fid}) with a secret download token that is SEALED to the server key
// (creator-seal.js): members never see a Storage URL; /api/creator/file opens the token after Firestore says they may read the lesson.
(function () {
  'use strict';
  var E = function (s) { return CH.esc(s); };
  var $ = function (id) { return document.getElementById(id); };
  var MB = 1024 * 1024, MAX_FILE = 25 * MB - 1, CAP = 1024 * MB, MAX_ATT = 8;
  var TYPES = { 'application/pdf': 1, 'image/png': 1, 'image/jpeg': 1, 'image/webp': 1, 'application/zip': 1, 'text/plain': 1, 'text/csv': 1,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 1, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 1 };
  var ICON = {
    video: '<path d="M5 4.5v15l13-7.5z"/>',
    text: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h7"/>',
    pdf: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 14h2.5a1.5 1.5 0 0 0 0-3H9v6"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    grip: '<circle cx="9" cy="6" r="1.2"/><circle cx="15" cy="6" r="1.2"/><circle cx="9" cy="12" r="1.2"/><circle cx="15" cy="12" r="1.2"/><circle cx="9" cy="18" r="1.2"/><circle cx="15" cy="18" r="1.2"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>'
  };
  var svg = function (n, s) { return '<svg width="' + (s || 20) + '" height="' + (s || 20) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON[n] + '</svg>'; };
  var ctx, root, courses = [], cur = null, mods = [], lessons = [], grants = [], progs = [], sub = 'lessons', mods2 = null;

  function rid(n) { var a = new Uint8Array(n || 16), c = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', s = ''; crypto.getRandomValues(a); for (var i = 0; i < a.length; i++) s += c[a[i] % 62]; return s; }
  function cref() { return db.collection('communities').doc(ctx.cid); }
  function crs(id) { return cref().collection('courses').doc(id || cur.id); }
  function fail(e) { CH.toast('error', e && e.code === 'permission-denied' ? 'Not allowed. Check the values and try again.' : (e && e.message) || 'Something went wrong. Try again.'); }
  function arr(s) { return s.docs.map(function (d) { var o = d.data(); o.id = d.id; return o; }); }
  function planName(id) { var p = ctx.plans.filter(function (x) { return x.id === id; })[0]; return p ? p.name : '(deleted plan)'; }
  function mod() { if (!mods2) mods2 = import('/assets/creator-seal.js?v=742'); return mods2; }
  function planChecks(sel, name) {
    return ctx.plans.map(function (p) { return '<label><input type="checkbox" name="' + name + '" value="' + E(p.id) + '"' + ((sel || []).indexOf(p.id) >= 0 ? ' checked' : '') + '> ' + E(p.name) + ' <span class="cx-muted">' + E(CH.money(p)) + '</span></label>'; }).join('');
  }
  function checked(scope, name) { return [].slice.call(scope.querySelectorAll('input[name="' + name + '"]:checked')).map(function (i) { return i.value; }); }

  // ---------------------------------------------------------------- sheet (bottom sheet on phones, dialog on desktop)
  function sheet(title, html) {
    var bg = document.createElement('div'); bg.className = 'cx-sheet-bg';
    bg.innerHTML = '<div class="cx-sheet" role="dialog" aria-modal="true" aria-label="' + E(title) + '"><div class="cx-grab" aria-hidden="true"></div><div class="cx-sheet-h"><h2>' + E(title) + '</h2><button type="button" class="cx-x" aria-label="Close">' + svg('x') + '</button></div><div class="cx-sheet-b stkc-scroll">' + html + '</div></div>';
    document.body.appendChild(bg); document.body.classList.add('cx-noscroll');
    var prev = document.activeElement;
    function close() { document.removeEventListener('keydown', key); bg.remove(); document.body.classList.remove('cx-noscroll'); if (prev && prev.focus) try { prev.focus(); } catch (e) {} }
    function key(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', key);
    bg.querySelector('.cx-x').onclick = close;
    bg.addEventListener('mousedown', function (e) { if (e.target === bg) close(); });
    var f = bg.querySelector('input,textarea,select'); if (f) setTimeout(function () { try { f.focus(); } catch (e) {} }, 60);
    return { el: bg, body: bg.querySelector('.cx-sheet-b'), close: close };
  }

  // ---------------------------------------------------------------- sortable (pointer events: mouse, touch, pen; arrow keys on the grip)
  function sortable(container, itemSel, onDrop) {
    var item = null, sy = 0;
    function items() { return [].slice.call(container.children).filter(function (c) { return c.matches(itemSel); }); }
    function ids() { return items().map(function (c) { return c.dataset.id; }); }
    container.addEventListener('pointerdown', function (e) {
      var h = e.target.closest('.cx-grip'); if (!h || h.closest(itemSel).parentNode !== container) return;
      e.preventDefault(); item = h.closest(itemSel); item.classList.add('drag'); try { h.setPointerCapture(e.pointerId); } catch (x) {}
      var before = ids().join();
      function mv(ev) {
        var y = ev.clientY, sib = items().filter(function (s) { return s !== item; }), target = null;
        for (var i = 0; i < sib.length; i++) { var r = sib[i].getBoundingClientRect(); if (y < r.top + r.height / 2) { target = sib[i]; break; } }
        if (target !== item.nextElementSibling) container.insertBefore(item, target);
        if (ev.clientY < 70) window.scrollBy(0, -14); else if (ev.clientY > window.innerHeight - 70) window.scrollBy(0, 14);
      }
      function up() { h.removeEventListener('pointermove', mv); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up); item.classList.remove('drag'); item = null; if (ids().join() !== before) onDrop(ids()); }
      h.addEventListener('pointermove', mv); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
    });
    container.addEventListener('keydown', function (e) {
      var h = e.target.closest('.cx-grip'); if (!h || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      var it = h.closest(itemSel); if (!it || it.parentNode !== container) return; e.preventDefault();
      var sibs = items(), i = sibs.indexOf(it), j = e.key === 'ArrowUp' ? i - 1 : i + 1; if (j < 0 || j >= sibs.length) return;
      container.insertBefore(it, e.key === 'ArrowUp' ? sibs[j] : sibs[j].nextElementSibling); h.focus(); onDrop(ids());
    });
  }

  // ---------------------------------------------------------------- load
  function view(el, c, keep) {
    ctx = c; root = el; if (!keep) { cur = null; sub = 'lessons'; }
    if (cur) return openCourse(cur.id);
    el.innerHTML = '<div class="cx-empty">Loading courses…</div>';
    return cref().collection('courses').get().then(function (s) {
      courses = arr(s).sort(function (a, b) { return (a.order - b.order) || ((a.createdAt ? a.createdAt.toMillis() : 0) - (b.createdAt ? b.createdAt.toMillis() : 0)); });
      list();
    }).catch(function () { el.innerHTML = '<div class="cx-empty">Could not load courses. Check your connection and try again.</div>'; });
  }

  function list() {
    var h = '<div class="cx-spread" style="margin-bottom:12px"><h2 style="margin:0">Courses</h2><button class="btn btn-primary" id="co-new" type="button">New course</button></div>' +
      '<div class="cx-note">Build a course from video links, text, PDFs and links. Videos stay on YouTube, Vimeo, Loom, Bunny or Cloudflare Stream; you paste the link. Files are limited to 25 MB each and 1 GB per community. ' +
      (ctx.cm.features && ctx.cm.features.courses ? '' : '<b>Courses are switched off for members.</b> Turn on <b>Courses</b> under Settings &rarr; Features members see.') + '</div>';
    h += courses.length ? '<div class="cx-clist">' + courses.map(function (c) {
      return '<button type="button" class="cx-crow" data-c="' + E(c.id) + '"><span class="cx-crow-t"><b>' + E(c.title) + '</b><span class="cx-muted">' + E(accessLine(c)) + '</span></span><span class="cx-chip' + (c.status === 'published' ? ' on' : '') + '">' + (c.status === 'published' ? 'Published' : 'Draft') + '</span></button>';
    }).join('') + '</div>' : '<div class="cx-empty">No courses yet. Start with a title; add modules and lessons next.</div>';
    root.innerHTML = h;
    $('co-new').onclick = newCourse;
    root.querySelectorAll('.cx-crow').forEach(function (b) { b.onclick = function () { sub = 'lessons'; openCourse(b.dataset.c); }; });
  }
  function accessLine(c) {
    var a = c.access.mode === 'all' ? 'All members' : (c.access.planIds.length ? c.access.planIds.map(planName).join(', ') : 'No plan selected');
    var s = c.solo.mode === 'free' ? ' · free alone' : c.solo.mode === 'paid' ? ' · ' + CH.money({ price: { amount: c.solo.price.amount, currency: c.solo.price.currency, interval: 'lifetime' } }) + ' alone' : c.solo.mode === 'invite' ? ' · by invite alone' : '';
    return a + s;
  }

  function newCourse() {
    var paid = ctx.plans.filter(function (p) { return p.price && p.price.interval !== 'free'; }), pre = (paid.length ? paid : ctx.plans).map(function (p) { return p.id; });
    var s = sheet('New course', '<form class="cx-f" id="nc-f" novalidate>' +
      '<div><label for="nc-t">Title</label><input id="nc-t" type="text" maxlength="80"></div>' +
      '<div><label for="nc-d">Description</label><textarea id="nc-d" maxlength="2000" style="min-height:90px"></textarea></div>' +
      '<div><label>Who can open it</label><div class="cx-pick">' + (ctx.plans.length ? planChecks(pre, 'nc-pl') : '<span class="cx-muted">Add a plan first (Plans tab), or offer the course on its own later.</span>') + '</div><div class="hint">You can change this later, and restrict single modules to other plans.</div></div>' +
      '<label class="cx-check"><input type="checkbox" id="nc-rules"><span>I agree to the <a href="/creator-rules" target="_blank" rel="noopener">Creator Rules</a></span></label>' +
      '<div id="nc-err" class="cx-bad" role="alert"></div><div class="cx-actions"><button class="btn btn-primary" type="submit">Create course</button></div></form>');
    ['nc-t', 'nc-d'].forEach(function (i) { $(i).addEventListener('input', function () { CH.warnIf(this); }); });
    $('nc-f').onsubmit = function (e) {
      e.preventDefault(); var err = $('nc-err'); err.textContent = '';
      var t = $('nc-t').value.trim(), d = $('nc-d').value.trim();
      if (t.length < 2) return err.textContent = 'Give the course a title.';
      if (CH.RISKY.test(t + ' ' + d)) return err.textContent = 'Remove wording like "guaranteed", "100%" or "risk-free". It breaks the Creator Rules.';
      if (!$('nc-rules').checked) return err.textContent = 'Please agree to the Creator Rules.';
      var id = rid(16), doc = { ownerUid: ctx.cm.ownerUid, title: t, desc: d, coverUrl: '', status: 'draft', access: { mode: 'plans', planIds: checked(s.body, 'nc-pl') },
        solo: { mode: 'off', price: { amount: 0, currency: 'USD' } }, sequential: false, order: courses.length, rulesVersion: CH.cfg.RULES_VERSION, createdAt: CH.ts(), updatedAt: CH.ts() };
      crs(id).set(doc).then(function () { s.close(); CH.toast('success', 'Course created'); sub = 'lessons'; return openCourse(id); }).catch(function () { err.textContent = 'Could not create the course. Check the values.'; });
    };
  }

  function openCourse(id) {
    root.innerHTML = '<div class="cx-empty">Loading…</div>';
    var c = crs(id);
    return Promise.all([c.get(), c.collection('modules').get(), c.collection('lessons').get(), c.collection('access').get().catch(function () { return { docs: [] }; })]).then(function (r) {
      if (!r[0].exists) { cur = null; return view(root, ctx); }
      cur = r[0].data(); cur.id = id;
      mods = arr(r[1]).sort(function (a, b) { return a.order - b.order; });
      lessons = arr(r[2]).sort(function (a, b) { return a.order - b.order; });
      grants = arr(r[3]);
      draw();
    }).catch(function () { root.innerHTML = '<div class="cx-empty">Could not load this course.</div>'; });
  }
  function reopen() { return openCourse(cur.id); }

  function draw() {
    var SUB = [['lessons', 'Lessons'], ['access', 'Access'], ['learners', 'Learners']];
    root.innerHTML = '<div class="cx-spread" style="margin-bottom:12px"><div style="min-width:0"><button type="button" class="cx-back" id="co-back">&larr; All courses</button><h2 style="margin:4px 0 0;overflow-wrap:anywhere">' + E(cur.title) + '</h2></div>' +
      '<div class="cx-row"><span class="cx-chip' + (cur.status === 'published' ? ' on' : '') + '">' + (cur.status === 'published' ? 'Published' : 'Draft') + '</span><a class="btn btn-ghost" href="/c/' + E(ctx.cid) + '?tab=courses&course=' + E(cur.id) + '">View as member</a></div></div>' +
      '<div class="cx-seg" role="tablist" id="co-sub">' + SUB.map(function (t) { return '<button type="button" role="tab" data-s="' + t[0] + '" class="' + (sub === t[0] ? 'on' : '') + '" aria-selected="' + (sub === t[0]) + '">' + t[1] + '</button>'; }).join('') + '</div><div id="co-body"></div>';
    $('co-back').onclick = function () { cur = null; view(root, ctx); };
    $('co-sub').onclick = function (e) { var b = e.target.closest('button'); if (b) { sub = b.dataset.s; draw(); } };
    ({ lessons: lessonsView, access: accessView, learners: learnersView })[sub]($('co-body'));
  }

  // ---------------------------------------------------------------- lessons tab
  function modLessons(mid) { return lessons.filter(function (l) { return l.moduleId === mid; }).sort(function (a, b) { return a.order - b.order; }); }
  function dripText(d) { return !d || d.mode === 'none' ? '' : d.mode === 'days' ? 'Day ' + d.days + ' after joining' : 'On ' + CH.date(d.at); }
  function lessonsView(el) {
    var h = '<div class="cx-spread" style="margin-bottom:10px"><p class="cx-muted" style="margin:0">Drag the handle to reorder, or focus it and use the arrow keys.</p><button class="btn btn-ghost" id="co-addmod" type="button">Add module</button></div>';
    if (!mods.length) h += '<div class="cx-empty">No modules yet. A module is a folder of lessons. Add one to begin.</div>';
    h += '<div id="co-mods">' + mods.map(function (m) {
      var ls = modLessons(m.id);
      return '<section class="cx-mod cx-box" data-id="' + E(m.id) + '"><div class="cx-mod-h"><button type="button" class="cx-grip" aria-label="Move module ' + E(m.title) + '">' + svg('grip') + '</button>' +
        '<div class="cx-mod-t"><b>' + E(m.title) + '</b><span class="cx-muted">' + ls.length + ' lesson' + (ls.length === 1 ? '' : 's') + (m.planIds.length ? ' · ' + E(m.planIds.map(planName).join(', ')) : '') + (dripText(m.drip) ? ' · ' + E(dripText(m.drip)) : '') + '</span></div>' +
        (m.status === 'draft' ? '<span class="cx-chip">Draft</span>' : '') + '<button type="button" class="btn btn-ghost cx-sm mo-ed" data-m="' + E(m.id) + '">Edit</button></div>' +
        '<div class="cx-lessons" data-m="' + E(m.id) + '">' + ls.map(lessonRow).join('') + '</div>' +
        '<button type="button" class="btn btn-ghost cx-sm mo-add" data-m="' + E(m.id) + '">Add lesson</button></section>';
    }).join('') + '</div>';
    el.innerHTML = h;
    $('co-addmod').onclick = function () { modForm(null); };
    el.querySelectorAll('.mo-ed').forEach(function (b) { b.onclick = function () { modForm(mods.filter(function (m) { return m.id === b.dataset.m; })[0]); }; });
    el.querySelectorAll('.mo-add').forEach(function (b) { b.onclick = function () { lessonForm(null, b.dataset.m); }; });
    el.querySelectorAll('.le-ed').forEach(function (b) { b.onclick = function () { lessonForm(lessons.filter(function (l) { return l.id === b.dataset.l; })[0]); }; });
    sortable($('co-mods'), '.cx-mod', function (ids) {
      var b = db.batch(); ids.forEach(function (id, i) { var m = mods.filter(function (x) { return x.id === id; })[0]; if (m.order !== i) { m.order = i; b.update(crs().collection('modules').doc(id), { order: i, updatedAt: CH.ts() }); } });
      mods.sort(function (a, b2) { return a.order - b2.order; });
      b.commit().then(function () { return resequence(); }).catch(fail);
    });
    el.querySelectorAll('.cx-lessons').forEach(function (box) {
      sortable(box, '.cx-lrow', function (ids) {
        var b = db.batch(); ids.forEach(function (id, i) { var l = lessons.filter(function (x) { return x.id === id; })[0]; if (l.order !== i) { l.order = i; b.update(crs().collection('lessons').doc(id), { order: i, updatedAt: CH.ts() }); } });
        b.commit().then(function () { return resequence(); }).catch(fail);
      });
    });
  }
  function lessonRow(l) {
    return '<div class="cx-lrow" data-id="' + E(l.id) + '"><button type="button" class="cx-grip" aria-label="Move lesson ' + E(l.title) + '">' + svg('grip') + '</button><span class="cx-ltype" title="' + E(l.type) + '">' + svg(l.type) + '</span>' +
      '<div class="cx-lt"><span class="cx-ltt">' + E(l.title) + '</span><span class="cx-muted">' + (l.mins ? l.mins + ' min' : l.type) + (dripText(l.drip) ? ' · ' + E(dripText(l.drip)) : '') + '</span></div>' +
      (l.preview ? '<span class="cx-chip on">Preview</span>' : '') + (l.status === 'draft' ? '<span class="cx-chip">Draft</span>' : '') + '<button type="button" class="btn btn-ghost cx-sm le-ed" data-l="' + E(l.id) + '">Edit</button></div>';
  }
  // "previous lesson" chain for in-order courses: the previous PUBLISHED lesson of a PUBLISHED module, in module order then lesson order.
  function resequence() {
    var seq = [], b = db.batch(), n = 0;
    mods.slice().sort(function (a, c) { return a.order - c.order; }).forEach(function (m) { if (m.status === 'published') modLessons(m.id).forEach(function (l) { if (l.status === 'published') seq.push(l); }); });
    var last = '';
    seq.forEach(function (l) { if (l.prev !== last) { l.prev = last; b.update(crs().collection('lessons').doc(l.id), { prev: last, updatedAt: CH.ts() }); n++; } last = l.id; });
    lessons.forEach(function (l) { if (seq.indexOf(l) < 0 && l.prev) { l.prev = ''; b.update(crs().collection('lessons').doc(l.id), { prev: '', updatedAt: CH.ts() }); n++; } });
    return (n ? b.commit() : Promise.resolve()).then(function () { draw(); }).catch(fail);
  }

  function dripFields(p, d) {
    d = d || { mode: 'none', days: 0, at: null };
    return '<div><label>Release</label><div class="cx-row"><select id="' + p + '-dm" style="flex:1 1 200px"><option value="none">Available right away</option><option value="days">After joining (days)</option><option value="date">On a fixed date</option></select>' +
      '<input id="' + p + '-dd" type="number" min="0" max="3650" step="1" value="' + (d.days || 0) + '" style="flex:1 1 90px" aria-label="Days after joining"><input id="' + p + '-dt" type="date" value="' + (d.at ? new Date(d.at.toDate ? d.at.toDate() : d.at).toISOString().slice(0, 10) : '') + '" style="flex:1 1 150px" aria-label="Release date"></div></div>';
  }
  function dripInit(p, d) {
    var m = $(p + '-dm'); m.value = d ? d.mode : 'none';
    function sync() { $(p + '-dd').hidden = m.value !== 'days'; $(p + '-dt').hidden = m.value !== 'date'; }
    m.onchange = sync; sync();
  }
  function dripRead(p) {
    var m = $(p + '-dm').value, day = +$(p + '-dd').value, dt = $(p + '-dt').value;
    if (m === 'days') { if (!(day >= 0 && day <= 3650 && day % 1 === 0)) return null; return { mode: 'days', days: day, at: null }; }
    if (m === 'date') { if (!dt) return null; return { mode: 'date', days: 0, at: CH.stamp(new Date(dt + 'T00:00:00')) }; }
    return { mode: 'none', days: 0, at: null };
  }

  function modForm(m) {
    var s = sheet(m ? 'Edit module' : 'New module', '<form class="cx-f" id="mf" novalidate><div><label for="mf-t">Title</label><input id="mf-t" type="text" maxlength="80" value="' + E(m ? m.title : '') + '"></div>' +
      '<div><label for="mf-s">Status</label><select id="mf-s"><option value="published">Published</option><option value="draft">Draft (hidden from members)</option></select></div>' +
      '<div><label>Only for these plans (optional)</label><div class="cx-pick">' + planChecks(m ? m.planIds : [], 'mf-pl') + '</div><div class="hint">Leave all unticked to follow the course access. Tick plans to sell this module to those plans only; it then replaces the course plan list for this module.</div></div>' +
      dripFields('mf', m ? m.drip : null) + '<div id="mf-err" class="cx-bad" role="alert"></div><div class="cx-actions">' + (m ? '<button class="btn btn-ghost" type="button" id="mf-del">Delete module</button>' : '') + '<button class="btn btn-primary" type="submit">Save module</button></div></form>');
    $('mf-s').value = m ? m.status : 'published'; dripInit('mf', m ? m.drip : null);
    $('mf-t').addEventListener('input', function () { CH.warnIf(this); });
    $('mf').onsubmit = function (e) {
      e.preventDefault(); var err = $('mf-err'); err.textContent = '';
      var t = $('mf-t').value.trim(), dr = dripRead('mf');
      if (!t) return err.textContent = 'Give the module a title.';
      if (!dr) return err.textContent = 'Check the release settings.';
      var id = m ? m.id : rid(16), doc = { title: t, order: m ? m.order : mods.length, status: $('mf-s').value, planIds: checked(s.body, 'mf-pl'), drip: dr, updatedAt: CH.ts() };
      crs().collection('modules').doc(id).set(doc).then(function () { s.close(); return reopen(); }).then(resequenceSoon).catch(function () { err.textContent = 'Could not save the module.'; });
    };
    var del = $('mf-del'); if (del) del.onclick = function () {
      var n = modLessons(m.id).length;
      if (!confirm('Delete module "' + m.title + '"' + (n ? ' and its ' + n + ' lesson' + (n === 1 ? '' : 's') : '') + '? This cannot be undone.')) return;
      del.disabled = true;
      modLessons(m.id).reduce(function (p, l) { return p.then(function () { return delLesson(l); }); }, Promise.resolve())
        .then(function () { return crs().collection('modules').doc(m.id).delete(); }).then(function () { s.close(); return reopen(); }).then(resequenceSoon).catch(fail);
    };
  }
  function resequenceSoon() { return resequence(); }

  // ---------------------------------------------------------------- files
  function sniff(file) {
    return file.slice(0, 5).arrayBuffer().then(function (b) {
      var u = new Uint8Array(b), t = file.type;
      if (t === 'application/pdf') return String.fromCharCode.apply(null, u) === '%PDF-';
      if (t === 'image/png') return u[0] === 0x89 && u[1] === 0x50;
      if (t === 'image/jpeg') return u[0] === 0xff && u[1] === 0xd8;
      if (t === 'application/zip' || /openxml/.test(t)) return u[0] === 0x50 && u[1] === 0x4b;
      return true;
    });
  }
  function uploadFile(file, lid, download) {
    if (!TYPES[file.type]) return Promise.reject(new Error('That file type is not allowed. Use PDF, PNG, JPG, WebP, ZIP, TXT, CSV, DOCX or XLSX.'));
    if (file.size < 1 || file.size > MAX_FILE) return Promise.reject(new Error('Files must be under 25 MB.'));
    var fid = rid(20), sref = cref().collection('stats').doc('storage'), freg = cref().collection('files').doc(fid), bytes;
    return sniff(file).then(function (ok) {
      if (!ok) throw new Error('That file does not look like a real ' + file.type.split('/')[1] + '.');
      return sref.get();
    }).then(function (sd) {
      bytes = sd.exists ? sd.data().bytes : 0;
      if (bytes + file.size > CAP) throw new Error('This community is at its 1 GB storage limit. Remove old files first.');
      var b = db.batch();
      b.set(freg, { ownerUid: ctx.cm.ownerUid, crid: cur.id, lid: lid, name: file.name.slice(0, 120), size: file.size, ct: file.type, createdAt: CH.ts() });
      if (sd.exists) b.update(sref, { bytes: CH.inc(file.size), lastFid: fid, updatedAt: CH.ts() }); else b.set(sref, { bytes: file.size, lastFid: fid, updatedAt: CH.ts() });
      return b.commit();
    }).then(function () {
      return firebase.storage().ref('communities/' + ctx.cid + '/files/' + fid).put(file, { contentType: file.type })
        .then(function (snap) { return snap.ref.getDownloadURL(); })
        .then(function (url) { var m = /[?&]token=([A-Za-z0-9-]{20,80})/.exec(url); if (!m) throw new Error('no token'); return m[1]; })
        .catch(function (e) { return unregister({ fid: fid, size: file.size }, true).then(function () { throw new Error('The upload failed. Check your connection and try again.'); }); });
    }).then(function (tok) { return mod().then(function (S) { return S.seal(CH.cfg.SEAL_PUB, tok); }); }).then(function (sealed) {
      return { fid: fid, name: file.name.slice(0, 120), size: file.size, ct: file.type, download: !!download, sealed: sealed };
    });
  }
  function unregister(f, skipStorage) {
    var b = db.batch();
    b.delete(cref().collection('files').doc(f.fid));
    b.update(cref().collection('stats').doc('storage'), { bytes: CH.inc(-f.size), lastFid: f.fid, updatedAt: CH.ts() });
    return b.commit().then(function () { if (!skipStorage) return firebase.storage().ref('communities/' + ctx.cid + '/files/' + f.fid).delete().catch(function () {}); });
  }
  function delLesson(l) {
    var bref = crs().collection('lessons').doc(l.id).collection('content').doc('body');
    return bref.get().then(function (d) {
      var files = []; if (d.exists) { var x = d.data(); if (x.file) files.push(x.file); (x.attachments || []).forEach(function (a) { files.push(a); }); }
      return files.reduce(function (p, f) { return p.then(function () { return unregister(f).catch(function () {}); }); }, Promise.resolve()).then(function () { return d.exists ? bref.delete() : null; });
    }).then(function () { return crs().collection('lessons').doc(l.id).delete(); });
  }

  // ---------------------------------------------------------------- lesson sheet
  var RTE_BTN = [['bold', '<b>B</b>', 'Bold'], ['italic', '<i>I</i>', 'Italic'], ['underline', '<u>U</u>', 'Underline'], ['|'], ['formatBlock:h3', 'H', 'Heading'], ['formatBlock:p', '&para;', 'Paragraph'], ['formatBlock:blockquote', '&ldquo;', 'Quote'], ['|'],
    ['insertUnorderedList', '&bull; List', 'Bullet list'], ['insertOrderedList', '1. List', 'Numbered list'], ['|'], ['link', 'Link', 'Insert link'], ['unlink', 'Unlink', 'Remove link'], ['image', 'Image', 'Insert image'], ['removeFormat', 'Clear', 'Clear formatting']];
  function rteHtml() {
    return '<div class="rte-toolbar cx-rte-tb" id="lf-tb">' + RTE_BTN.map(function (b) { return b[0] === '|' ? '<span class="rte-sep"></span>' : '<button type="button" class="rte-btn" data-c="' + b[0] + '" title="' + b[2] + '" aria-label="' + b[2] + '">' + b[1] + '</button>'; }).join('') +
      '<input type="file" id="lf-img" accept="image/png,image/jpeg,image/webp" hidden></div><div class="rte-editable cx-rte" id="lf-html" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Lesson text"></div>';
  }
  function shrinkImage(file) {
    return new Promise(function (res, rej) {
      var u = URL.createObjectURL(file), im = new Image();
      im.onload = function () {
        var r = Math.min(1, 900 / im.width), c = document.createElement('canvas'); c.width = Math.round(im.width * r); c.height = Math.round(im.height * r);
        var x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(u); res(c.toDataURL('image/jpeg', 0.8));
      };
      im.onerror = function () { URL.revokeObjectURL(u); rej(new Error('That image could not be read.')); }; im.src = u;
    });
  }
  function rteInit() {
    var ed = $('lf-html');
    $('lf-tb').addEventListener('mousedown', function (e) { if (e.target.closest('.rte-btn')) e.preventDefault(); });
    $('lf-tb').addEventListener('click', function (e) {
      var b = e.target.closest('.rte-btn'); if (!b) return; var c = b.dataset.c; ed.focus();
      if (c === 'link') { var u = prompt('Link address (https://…)', 'https://'); if (u && /^https:\/\//.test(u)) document.execCommand('createLink', false, u); else if (u) CH.toast('error', 'Links must start with https://'); }
      else if (c === 'image') $('lf-img').click();
      else if (c.indexOf('formatBlock:') === 0) document.execCommand('formatBlock', false, c.split(':')[1]);
      else document.execCommand(c, false, null);
    });
    $('lf-img').onchange = function (e) {
      var f = e.target.files[0]; e.target.value = ''; if (!f) return;
      if (!/^image\/(png|jpeg|webp)$/.test(f.type)) return CH.toast('error', 'Use a PNG, JPG or WebP image.');
      shrinkImage(f).then(function (d) { ed.focus(); document.execCommand('insertHTML', false, '<img src="' + d + '" alt="">'); }).catch(fail);
    };
    ed.addEventListener('paste', function (e) { e.preventDefault(); var t = (e.clipboardData || window.clipboardData).getData('text/plain'); document.execCommand('insertText', false, t); });
    ed.addEventListener('input', function () { CH.warnIf({ value: ed.textContent, parentNode: ed.parentNode, insertAdjacentElement: function (w, el) { ed.insertAdjacentElement(w, el); } }); });
  }

  function quizHtml(q) {
    q = q || { pass: 70, questions: [] };
    return '<div class="cx-quiz"><div class="cx-row"><label class="cx-check"><input type="checkbox" id="lf-qon"' + (q.questions.length ? ' checked' : '') + '><span>Add a quiz to this lesson</span></label></div><div id="lf-qbox" ' + (q.questions.length ? '' : 'hidden') + '>' +
      '<div style="margin:10px 0"><label for="lf-qpass">Pass mark (%)</label><input id="lf-qpass" type="number" min="1" max="100" step="1" value="' + q.pass + '" style="max-width:120px"><div class="hint">Learners can retry as often as they like. The quiz is a simple self-check; answers are not secret.</div></div><div id="lf-qs"></div>' +
      '<button type="button" class="btn btn-ghost cx-sm" id="lf-qadd">Add question</button></div></div>';
  }
  function qBlock(q, i) {
    q = q || { q: '', opts: ['', ''], ok: 0 };
    return '<div class="cx-qb" data-i="' + i + '"><div class="cx-spread"><b>Question ' + (i + 1) + '</b><button type="button" class="cx-x qd" aria-label="Remove question">' + svg('x') + '</button></div>' +
      '<input class="qq" type="text" maxlength="200" placeholder="Question" value="' + E(q.q) + '" aria-label="Question ' + (i + 1) + '">' +
      q.opts.map(function (o, k) { return '<div class="cx-qopt"><input type="radio" name="qok' + i + '" value="' + k + '"' + (q.ok === k ? ' checked' : '') + ' aria-label="Correct answer ' + (k + 1) + '"><input class="qo" type="text" maxlength="120" placeholder="Answer ' + (k + 1) + '" value="' + E(o) + '" aria-label="Answer ' + (k + 1) + '"></div>'; }).join('') +
      '<div class="hint">Tick the correct answer. ' + (q.opts.length < 5 ? '<button type="button" class="cx-linkbtn qa">Add answer</button>' : '') + '</div></div>';
  }
  function quizInit(q) {
    var box = $('lf-qs'), on = $('lf-qon');
    function paint(list) { box.innerHTML = list.map(function (x, i) { return qBlock(x, i); }).join(''); }
    function read() {
      return [].slice.call(box.querySelectorAll('.cx-qb')).map(function (b, i) {
        var sel = b.querySelector('input[type=radio]:checked');
        return { q: b.querySelector('.qq').value, opts: [].slice.call(b.querySelectorAll('.qo')).map(function (o) { return o.value; }), ok: sel ? +sel.value : 0 };
      });
    }
    paint(q && q.questions.length ? q.questions : []);
    on.onchange = function () { $('lf-qbox').hidden = !on.checked; if (on.checked && !box.children.length) paint([null]); };
    $('lf-qadd').onclick = function () { var l = read(); if (l.length >= 10) return CH.toast('error', 'Up to 10 questions.'); l.push(null); paint(l.map(function (x) { return x || undefined; })); };
    box.onclick = function (e) {
      var b = e.target.closest('.cx-qb'); if (!b) return; var l = read(), i = +b.dataset.i;
      if (e.target.closest('.qd')) { l.splice(i, 1); paint(l); }
      else if (e.target.closest('.qa')) { l[i].opts.push(''); paint(l); }
    };
    return function () { // -> quiz object, null (off) or false (invalid)
      if (!on.checked) return null;
      var list = read(), pass = +$('lf-qpass').value;
      if (!list.length || !(pass >= 1 && pass <= 100 && pass % 1 === 0)) return false;
      for (var i = 0; i < list.length; i++) {
        var x = list[i]; x.q = x.q.trim(); x.opts = x.opts.map(function (o) { return o.trim(); });
        if (!x.q || x.opts.length < 2 || x.opts.some(function (o) { return !o; })) return false;
      }
      return { pass: pass, questions: list };
    };
  }

  function lessonForm(l, mid) {
    var isNew = !l;
    if (isNew && !mods.length) return CH.toast('error', 'Add a module first.');
    l = l || { id: rid(16), moduleId: mid || mods[0].id, title: '', type: 'video', order: modLessons(mid || mods[0].id).length, status: 'published', preview: false, drip: { mode: 'none', days: 0, at: null }, prev: '', mins: 0, thumb: '', hasQuiz: false };
    var s = sheet(isNew ? 'New lesson' : 'Edit lesson', '<div class="cx-empty">Loading…</div>'), body = null, removed = [];
    var bref = crs().collection('lessons').doc(l.id).collection('content').doc('body');
    (isNew ? Promise.resolve(null) : bref.get().then(function (d) { return d.exists ? d.data() : null; })).then(function (b) { body = b; paint(); }).catch(function () { s.body.innerHTML = '<div class="cx-empty">Could not load this lesson.</div>'; });

    function paint() {
      var b = body || { type: l.type, attachments: [] }, atts = (b.attachments || []).slice(), main = b.file || null, newMain = null, newAtts = [];
      s.body.innerHTML = '<form class="cx-f" id="lf" novalidate>' +
        '<div><label for="lf-t">Title</label><input id="lf-t" type="text" maxlength="100" value="' + E(l.title) + '"></div>' +
        '<div><label id="lf-tl">Type</label><div class="cx-seg" role="radiogroup" aria-labelledby="lf-tl" id="lf-type">' + [['video', 'Video'], ['text', 'Text'], ['pdf', 'PDF'], ['link', 'Link']].map(function (t) { return '<button type="button" role="radio" data-t="' + t[0] + '" class="' + (l.type === t[0] ? 'on' : '') + '" aria-checked="' + (l.type === t[0]) + '"' + (!isNew && l.type !== t[0] ? ' disabled' : '') + '>' + t[1] + '</button>'; }).join('') + '</div>' + (isNew ? '' : '<div class="hint">The type is fixed after the lesson is created.</div>') + '</div>' +
        '<div id="lf-v"><label for="lf-vu">Video link</label><input id="lf-vu" type="url" inputmode="url" placeholder="https://www.youtube.com/watch?v=…" value="' + E(b.video ? b.video.url : '') + '"><div class="hint">YouTube (unlisted works), Vimeo, Loom, Bunny or Cloudflare Stream. ' + (isNew ? '' : 'You can replace the link at any time; learners keep their progress.') + '</div><div id="lf-vp" class="cx-vprev"></div></div>' +
        '<div id="lf-x" hidden><label for="lf-xu">Web address</label><input id="lf-xu" type="url" inputmode="url" placeholder="https://" value="' + E(b.link ? b.link.url : '') + '"></div>' +
        '<div id="lf-p" hidden><label for="lf-pf">PDF file</label><input id="lf-pf" type="file" accept="application/pdf"><div class="hint" id="lf-pn">' + (main ? E(main.name) + ' · ' + (main.size / MB).toFixed(1) + ' MB. Choose another file to replace it.' : 'Up to 25 MB. Members read it in a viewer with their email shown on every page; there is no public file link.') + '</div></div>' +
        '<div id="lf-h" hidden><label>Text</label>' + rteHtml() + '<div class="hint" id="lf-hh">Images are shrunk and stored inside the lesson. A line with the reader\'s email is added under the text.</div></div>' +
        '<div><label>Attachments (optional)</label><div id="lf-at" class="cx-atts"></div><input id="lf-af" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.zip,.txt,.csv,.docx,.xlsx" hidden><button type="button" class="btn btn-ghost cx-sm" id="lf-aadd">Add file</button><div class="hint">Up to 8 files, 25 MB each. PDFs open in the watermarked viewer. Tick "Allow download" only if you are happy for members to keep the file.</div></div>' +
        '<div><label>Quiz</label>' + quizHtml(b.quiz) + '</div>' +
        '<div class="cx-row"><div style="flex:1 1 200px"><label for="lf-m">Module</label><select id="lf-m">' + mods.map(function (m) { return '<option value="' + E(m.id) + '">' + E(m.title) + '</option>'; }).join('') + '</select></div>' +
        '<div style="flex:1 1 140px"><label for="lf-mins">Length (minutes)</label><input id="lf-mins" type="number" min="0" max="600" step="1" value="' + (l.mins || 0) + '"></div></div>' +
        dripFields('lf', l.drip) +
        '<div class="cx-row"><label class="cx-check" style="flex:1 1 200px"><input type="checkbox" id="lf-pv"' + (l.preview ? ' checked' : '') + '><span>Free preview: anyone who can see the course can open it</span></label>' +
        '<div style="flex:1 1 160px"><label for="lf-s">Status</label><select id="lf-s"><option value="published">Published</option><option value="draft">Draft (hidden)</option></select></div></div>' +
        '<div class="hint">By publishing you agree to the <a href="/creator-rules" target="_blank" rel="noopener">Creator Rules</a>. No guaranteed or risk-free wording.</div>' +
        '<div id="lf-err" class="cx-bad" role="alert"></div><div class="cx-actions">' + (isNew ? '' : '<button class="btn btn-ghost" type="button" id="lf-del">Delete lesson</button>') + '<button class="btn btn-primary" type="submit" id="lf-save">Save lesson</button></div></form>';
      $('lf-m').value = l.moduleId; $('lf-s').value = l.status; dripInit('lf', l.drip);
      if (b.html) $('lf-html').innerHTML = stkHtml(b.html);
      rteInit(); var qget = quizInit(b.quiz);
      var type = l.type;
      function showType() {
        $('lf-v').hidden = type !== 'video'; $('lf-x').hidden = type !== 'link'; $('lf-p').hidden = type !== 'pdf'; $('lf-h').hidden = type !== 'text';
        $('lf-type').querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x.dataset.t === type); x.setAttribute('aria-checked', x.dataset.t === type); });
      }
      showType();
      $('lf-type').onclick = function (e) { var x = e.target.closest('button'); if (x && !x.disabled) { type = x.dataset.t; showType(); } };
      ['lf-t'].forEach(function (i) { $(i).addEventListener('input', function () { CH.warnIf(this); }); });

      // video link: preview + auto title/thumb
      var vmeta = { thumb: l.thumb || '', mins: 0 };
      function vprev() {
        var u = $('lf-vu').value.trim(), p = $('lf-vp'); p.innerHTML = '';
        if (!u) return;
        var v = CHP.parseVideo(u);
        if (!v) { p.innerHTML = '<span class="cx-bad">That link is not from YouTube, Vimeo, Loom, Bunny or Cloudflare Stream.</span>'; return; }
        p.innerHTML = '<span class="cx-muted">' + E(v.provider) + ' video found…</span>';
        CHP.oembed(u).then(function (m) {
          if ($('lf-vu').value.trim() !== u) return;
          vmeta.thumb = (m && m.thumb) || ''; if (m && m.mins && !+$('lf-mins').value) $('lf-mins').value = Math.min(600, m.mins);
          if (m && m.title && !$('lf-t').value.trim()) $('lf-t').value = m.title;
          p.innerHTML = (vmeta.thumb ? '<img src="' + E(vmeta.thumb) + '" alt="" loading="lazy">' : '') + '<span class="cx-muted">' + E(v.provider) + (m && m.title ? ' · ' + E(m.title) : '') + '</span>';
        });
      }
      $('lf-vu').addEventListener('change', vprev); $('lf-vu').addEventListener('paste', function () { setTimeout(vprev, 50); });
      if (b.video) vprev();

      function atts_() {
        var all = atts.concat(newAtts);
        $('lf-at').innerHTML = all.length ? all.map(function (a, i) {
          return '<div class="cx-att"><span class="cx-ltype">' + svg('pdf') + '</span><div class="cx-lt"><span class="cx-ltt">' + E(a.name) + '</span><span class="cx-muted">' + (a.size / MB).toFixed(1) + ' MB</span></div>' +
            (a.ct === 'application/pdf' || /^image\//.test(a.ct) ? '<label class="cx-check cx-sm"><input type="checkbox" class="at-dl" data-i="' + i + '"' + (a.download ? ' checked' : '') + '><span>Allow download</span></label>' : '<span class="cx-muted">Download</span>') +
            '<button type="button" class="cx-x at-rm" data-i="' + i + '" aria-label="Remove ' + E(a.name) + '">' + svg('x') + '</button></div>';
        }).join('') : '<div class="cx-muted">None</div>';
        $('lf-at').querySelectorAll('.at-dl').forEach(function (c) { c.onchange = function () { all[+c.dataset.i].download = c.checked; }; });
        $('lf-at').querySelectorAll('.at-rm').forEach(function (x) { x.onclick = function () {
          var i = +x.dataset.i; if (i < atts.length) { removed.push(atts[i]); atts.splice(i, 1); } else { removed.push(newAtts[i - atts.length]); newAtts.splice(i - atts.length, 1); } atts_(); }; });
      }
      atts_();
      $('lf-aadd').onclick = function () { if (atts.length + newAtts.length >= MAX_ATT) return CH.toast('error', 'Up to 8 files.'); $('lf-af').click(); };
      $('lf-af').onchange = function (e) {
        var f = e.target.files[0]; e.target.value = ''; if (!f) return;
        var btn = $('lf-aadd'); btn.disabled = true; btn.textContent = 'Uploading…';
        uploadFile(f, l.id, f.type !== 'application/pdf' && !/^image\//.test(f.type)).then(function (a) { newAtts.push(a); atts_(); }).catch(fail).then(function () { btn.disabled = false; btn.textContent = 'Add file'; });
      };
      $('lf-pf').onchange = function (e) {
        var f = e.target.files[0]; if (!f) return; var pn = $('lf-pn');
        if (f.type !== 'application/pdf') { e.target.value = ''; return CH.toast('error', 'Choose a PDF file.'); }
        pn.textContent = 'Uploading ' + f.name + '…'; $('lf-save').disabled = true;
        uploadFile(f, l.id, false).then(function (a) { if (newMain) removed.push(newMain); newMain = a; pn.textContent = a.name + ' · ' + (a.size / MB).toFixed(1) + ' MB uploaded. Save the lesson to use it.'; })
          .catch(function (x) { pn.textContent = ''; fail(x); }).then(function () { $('lf-save').disabled = false; });
      };

      if ($('lf-del')) $('lf-del').onclick = function () {
        if (!confirm('Delete "' + l.title + '"? Its files and content are removed. This cannot be undone.')) return;
        $('lf-del').disabled = true;
        delLesson(l).then(function () { s.close(); return reopen(); }).then(resequenceSoon).catch(fail);
      };

      $('lf').onsubmit = function (e) {
        e.preventDefault(); var err = $('lf-err'); err.textContent = '';
        var t = $('lf-t').value.trim(), dr = dripRead('lf'), mins = +$('lf-mins').value, quiz = qget();
        if (!t) return err.textContent = 'Give the lesson a title.';
        if (!dr) return err.textContent = 'Check the release settings.';
        if (!(mins >= 0 && mins <= 600 && mins % 1 === 0)) return err.textContent = 'Length is 0 to 600 minutes.';
        if (quiz === false) return err.textContent = 'Check the quiz: every question needs text, 2 to 5 answers and one ticked correct answer; pass mark 1 to 100.';
        var content = { type: type, attachments: atts.concat(newAtts), updatedAt: CH.ts() }, thumb = '';
        if (type === 'video') {
          var u = $('lf-vu').value.trim(), v = CHP.parseVideo(u); if (!v) return err.textContent = 'Paste a YouTube, Vimeo, Loom, Bunny or Cloudflare Stream link.';
          content.video = { url: u, provider: v.provider }; thumb = vmeta.thumb || v.thumb || '';
        } else if (type === 'link') {
          var x = $('lf-xu').value.trim(); if (!/^https:\/\/\S{4,480}$/.test(x)) return err.textContent = 'The address must start with https://';
          content.link = { url: x };
        } else if (type === 'pdf') {
          var f = newMain || main; if (!f) return err.textContent = 'Choose a PDF file.'; content.file = f;
        } else {
          var hh = stkHtml($('lf-html').innerHTML).trim(); if (!$('lf-html').textContent.trim() && hh.indexOf('<img') < 0) return err.textContent = 'Write some text first.';
          if (hh.length > 380000) return err.textContent = 'This lesson is too large. Remove some images or split it into two lessons.';
          if (CH.RISKY.test($('lf-html').textContent)) return err.textContent = 'Remove wording like "guaranteed", "100%" or "risk-free". It breaks the Creator Rules.';
          content.html = hh;
        }
        if (quiz) content.quiz = quiz;
        if (CH.RISKY.test(t)) return err.textContent = 'Remove wording like "guaranteed" or "risk-free" from the title.';
        var moved = $('lf-m').value !== l.moduleId;
        var doc = { moduleId: $('lf-m').value, title: t, type: type, order: moved ? modLessons($('lf-m').value).length : l.order, status: $('lf-s').value, preview: $('lf-pv').checked, drip: dr, prev: l.prev || '', mins: mins,
          thumb: thumb, hasQuiz: !!quiz, updatedAt: CH.ts() };
        $('lf-save').disabled = true;
        var lref = crs().collection('lessons').doc(l.id);
        lref.set(doc).then(function () { return bref.set(content); }).then(function () {
          var gone = removed.slice(); if (type === 'pdf' && main && newMain) gone.push(main);
          return gone.reduce(function (p, f) { return p.then(function () { return unregister(f).catch(function () {}); }); }, Promise.resolve());
        }).then(function () { s.close(); CH.toast('success', 'Lesson saved'); return reopen(); }).then(resequenceSoon).catch(function (x) { $('lf-save').disabled = false; err.textContent = 'Could not save the lesson. ' + (x && x.code === 'permission-denied' ? 'Check the values.' : 'Try again.'); });
      };
    }
  }

  // ---------------------------------------------------------------- access tab
  function accessView(el) {
    var a = cur.access, so = cur.solo, dt = function (t) { return t ? t.toDate().toISOString().slice(0, 10) : ''; };
    el.innerHTML = '<form class="cx-f cx-box" id="ac-f" novalidate><h2>Who can open this course</h2>' +
      '<div><label for="ac-m">Whole course</label><select id="ac-m"><option value="plans">Only these plans</option><option value="all">Every active member</option></select></div>' +
      '<div id="ac-pl"><div class="cx-pick">' + (ctx.plans.length ? planChecks(a.planIds, 'ac-pl') : '<span class="cx-muted">No plans yet. Add plans in the Plans tab.</span>') + '</div><div class="hint">A module can have its own plan list (Edit module). Free preview lessons are open to everyone who can see the course.</div></div>' +
      '<div><label for="ac-sm">Sell this course on its own</label><select id="ac-sm"><option value="off">Not sold on its own</option><option value="free">Free for anyone who joins by one tap</option><option value="invite">By invite only (I add people by email)</option><option value="paid">Paid (price saved; checkout opens soon)</option></select></div>' +
      '<div class="cx-row" id="ac-price"><div style="flex:1 1 120px"><label for="ac-pa">Price</label><input id="ac-pa" type="number" min="1" max="100000" step="1" value="' + (so.price.amount || '') + '"></div><div style="flex:1 1 100px"><label for="ac-pc">Currency</label><select id="ac-pc"><option>USD</option><option>INR</option></select></div></div>' +
      '<div class="hint" id="ac-ph">' + (CH.cfg.PAYMENTS ? '' : 'Paid checkout opens soon. The price is saved and shown; nobody can buy yet. You can still add people by email below.') + '</div>' +
      '<div><label class="cx-check"><input type="checkbox" id="ac-seq"' + (cur.sequential ? ' checked' : '') + '><span>In order: learners must finish each lesson before the next one opens</span></label></div>' +
      '<h2 style="margin-top:6px">Details</h2><div><label for="ac-t">Title</label><input id="ac-t" type="text" maxlength="80" value="' + E(cur.title) + '"></div><div><label for="ac-d">Description</label><textarea id="ac-d" maxlength="2000" style="min-height:90px">' + E(cur.desc) + '</textarea></div>' +
      '<div><label for="ac-s">Status</label><select id="ac-s"><option value="draft">Draft (hidden from members)</option><option value="published">Published</option></select></div>' +
      '<label class="cx-check"><input type="checkbox" id="ac-rules"><span>I agree to the <a href="/creator-rules" target="_blank" rel="noopener">Creator Rules</a> (needed to publish)</span></label>' +
      '<div id="ac-err" class="cx-bad" role="alert"></div><div class="cx-actions"><button class="btn btn-ghost" type="button" id="ac-del">Delete course</button><button class="btn btn-primary" type="submit">Save</button></div></form>' +
      '<div class="cx-box" style="margin-top:14px"><h2>Give this course to one person</h2><p class="cx-muted">They get the whole course, whatever their plan, when they sign in with that email (verified). Nothing is emailed from here.</p>' +
      '<form class="cx-row" id="gr-f"><input class="cx-in" id="gr-e" type="email" placeholder="name@example.com" style="flex:1 1 220px" aria-label="Email"><input type="date" id="gr-x" aria-label="Access ends (optional)" style="flex:0 1 160px"><button class="btn btn-primary" type="submit">Add</button></form>' +
      '<div id="gr-l" style="margin-top:12px"></div></div>';
    $('ac-m').value = a.mode; $('ac-sm').value = so.mode; $('ac-pc').value = so.price.currency; $('ac-s').value = cur.status;
    function sync() { $('ac-pl').hidden = $('ac-m').value === 'all'; $('ac-price').hidden = $('ac-ph').hidden = $('ac-sm').value !== 'paid'; }
    $('ac-m').onchange = $('ac-sm').onchange = sync; sync();
    ['ac-t', 'ac-d'].forEach(function (i) { $(i).addEventListener('input', function () { CH.warnIf(this); }); });
    $('ac-f').onsubmit = function (e) {
      e.preventDefault(); var err = $('ac-err'); err.textContent = '';
      var t = $('ac-t').value.trim(), d = $('ac-d').value.trim(), sm = $('ac-sm').value, amt = +$('ac-pa').value, st = $('ac-s').value;
      if (t.length < 2) return err.textContent = 'Give the course a title.';
      if (sm === 'paid' && !(amt >= 1 && amt <= 100000)) return err.textContent = 'Enter a price between 1 and 100000.';
      if (CH.RISKY.test(t + ' ' + d)) return err.textContent = 'Remove wording like "guaranteed", "100%" or "risk-free". It breaks the Creator Rules.';
      if (st === 'published' && cur.status !== 'published' && !$('ac-rules').checked) return err.textContent = 'Please agree to the Creator Rules to publish.';
      var doc = { ownerUid: cur.ownerUid, title: t, desc: d, coverUrl: cur.coverUrl || '', status: st, access: { mode: $('ac-m').value, planIds: $('ac-m').value === 'all' ? [] : checked(el, 'ac-pl') },
        solo: { mode: sm, price: { amount: sm === 'paid' ? amt : 0, currency: $('ac-pc').value } }, sequential: $('ac-seq').checked, order: cur.order, rulesVersion: CH.cfg.RULES_VERSION, createdAt: cur.createdAt, updatedAt: CH.ts() };
      crs().set(doc).then(function () { CH.toast('success', 'Saved'); return reopen(); }).catch(function () { err.textContent = 'Could not save. Check the values.'; });
    };
    $('ac-del').onclick = function () {
      if (!confirm('Delete the course "' + cur.title + '" with all modules, lessons and files? This cannot be undone.')) return;
      $('ac-del').disabled = true;
      var c = crs(), delSub = function (name) { return c.collection(name).get().then(function (s) { return Promise.all(s.docs.map(function (d) { return d.ref.delete(); })); }); };
      lessons.reduce(function (p, l) { return p.then(function () { return delLesson(l); }); }, Promise.resolve())
        .then(function () { return Promise.all([delSub('modules'), delSub('progress'), delSub('access')]); }).then(function () { return c.delete(); })
        .then(function () { CH.toast('success', 'Course deleted'); cur = null; return view(root, ctx); }).catch(fail);
    };
    function glist() {
      $('gr-l').innerHTML = grants.length ? '<div class="cx-tablewrap stkc-scroll"><table class="cx-table" style="min-width:420px"><tbody>' + grants.map(function (g) {
        return '<tr data-e="' + E(g.id) + '"><td>' + E(g.email) + '</td><td>' + (g.status === 'revoked' ? '<span class="cx-chip">Revoked</span>' : g.expiresAt ? 'until ' + E(CH.date(g.expiresAt)) : 'No end') + '</td><td>' + (g.status === 'revoked' ? '' : '<button class="btn btn-ghost cx-sm gr-rv" type="button">Revoke</button>') + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '<div class="cx-muted">Nobody yet.</div>';
      $('gr-l').querySelectorAll('.gr-rv').forEach(function (b) { b.onclick = function () { crs().collection('access').doc(b.closest('tr').dataset.e).update({ status: 'revoked' }).then(reopen).catch(fail); }; });
    }
    glist();
    $('gr-f').onsubmit = function (e) {
      e.preventDefault(); var em = $('gr-e').value.trim().toLowerCase(), x = $('gr-x').value;
      if (!/^[^\s@\/]+@[^\s@\/]+\.[^\s@\/]{2,}$/.test(em)) return CH.toast('error', 'Enter a valid email.');
      crs().collection('access').doc(em).set({ email: em, source: 'manual', status: 'active', expiresAt: x ? CH.stamp(new Date(x + 'T23:59:59')) : null, createdBy: ctx.cm.ownerUid, createdAt: CH.ts() })
        .then(function () { CH.toast('success', 'Added'); return reopen(); }).catch(function () { CH.toast('error', 'Could not add. That email may already have access (revoke it first to change it).'); });
    };
  }

  // ---------------------------------------------------------------- learners / analytics
  // learners = people who opened a lesson (a progress document). Completion % per lesson = finished / learners.
  // Drop-off lesson = the published lesson (after the first) where the share of learners who finished it falls the most versus the lesson before it.
  function analytics(L, P) {
    var n = P.length, rows = L.map(function (l) {
      var done = P.filter(function (p) { return p.done && p.done[l.id] > 0; }).length;
      return { l: l, done: done, pct: n ? Math.round(done / n * 100) : 0 };
    }), drop = null;
    for (var i = 1; i < rows.length; i++) { var d = rows[i - 1].pct - rows[i].pct; if (d > 0 && (!drop || d > drop.d)) drop = { d: d, row: rows[i] }; }
    var all = L.length ? P.filter(function (p) { return L.every(function (l) { return p.done && p.done[l.id] > 0; }); }).length : 0;
    return { learners: n, rows: rows, drop: drop, finished: all, finishedPct: n ? Math.round(all / n * 100) : 0 };
  }
  function learnersView(el) {
    el.innerHTML = '<div class="cx-empty">Loading…</div>';
    crs().collection('progress').get().then(function (s) {
      progs = arr(s);
      var seq = []; mods.slice().sort(function (a, b) { return a.order - b.order; }).forEach(function (m) { modLessons(m.id).forEach(function (l) { if (l.status === 'published') seq.push(l); }); });
      var A = analytics(seq, progs), active = ctx.members.filter(function (m) { return m.role !== 'owner' && CH.isActive(m) && (cur.access.mode === 'all' || cur.access.planIds.indexOf(m.planId) >= 0); }).length;
      var h = '<div class="cx-stats"><div class="cx-box cx-stat"><b>' + A.learners + '</b>Learners started</div><div class="cx-box cx-stat"><b>' + A.finishedPct + '%</b>Finished the course</div><div class="cx-box cx-stat"><b>' + active + '</b>Members with access</div></div>';
      if (!seq.length) h += '<div class="cx-empty">Publish some lessons to see how learners do.</div>';
      else {
        h += A.drop ? '<div class="cx-note"><b>Biggest drop-off:</b> "' + E(A.drop.row.l.title) + '". ' + A.drop.d + ' points fewer learners finish it than the lesson before.</div>' : (A.learners ? '<div class="cx-note">No drop-off yet: each lesson is finished by as many learners as the one before.</div>' : '<div class="cx-note">No learners have started yet.</div>');
        h += '<div class="cx-box"><h2>Completion by lesson</h2>' + A.rows.map(function (r, i) {
          return '<div class="cx-bar' + (A.drop && A.drop.row === r ? ' hot' : '') + '"><div class="cx-bar-t"><span>' + (i + 1) + '. ' + E(r.l.title) + '</span><b>' + r.pct + '%</b></div><div class="cx-bar-k"><div style="width:' + r.pct + '%"></div></div><div class="cx-muted">' + r.done + ' of ' + A.learners + ' finished</div></div>';
        }).join('') + '</div>';
      }
      el.innerHTML = h;
    }).catch(function () { el.innerHTML = '<div class="cx-empty">Could not load learner data.</div>'; });
  }

  window.CHCourses = { view: view, _analytics: analytics };
})();
