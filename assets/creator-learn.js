// Creator Hub courses: learner side (window.CHL), mounted by creator-c.js in the Courses tab of /c/<slug>.
//   CHL.mount(el, { cid, cm, plans, mem, me, isOwner, member, signIn() , qs })
// What the page shows is decided here for the UI, but the real gate is Firestore: lesson content (courses/.../content/body) is only
// readable when the rules say so (plan, drip, order, preview). A locked lesson shows the structure (titles, types, lock, date) only.
// Depends on: creator.js (CH), creator-player.js (CHP), sanitize.js + purify (stkHtml), firebase auth/firestore.
(function (g) {
  'use strict';
  var E = function (s) { return CH.esc(s); };
  var ICON = {
    video: '<path d="M5 4.5v15l13-7.5z"/>', text: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h7"/>',
    pdf: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 14h2.5a1.5 1.5 0 0 0 0-3H9v6"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>', check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    clip: '<path d="M20 11.5l-8 8a5 5 0 0 1-7-7l8.5-8.5a3.5 3.5 0 0 1 5 5L10 17.5a2 2 0 0 1-3-3l7.5-7.5"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>'
  };
  var svg = function (n, s) { return '<svg width="' + (s || 20) + '" height="' + (s || 20) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON[n] + '</svg>'; };
  var C, root, courses = null, cur = null, mods = [], lessons = [], prog = null, myAccess = null, open = null, player = null, saveT = null, pending = false;
  var DAY = 86400000;

  function crs(id) { return db.collection('communities').doc(C.cid).collection('courses').doc(id || cur.id); }
  function arr(s) { return s.docs.map(function (d) { var o = d.data(); o.id = d.id; return o; }); }
  function ms(t) { return t ? (t.toMillis ? t.toMillis() : +new Date(t)) : 0; }
  function stop() { if (player) { try { player.destroy(); } catch (e) {} player = null; } }

  // ---------------------------------------------------------------- access (mirrors the rules; the rules decide for real)
  function how(course) {
    if (C.isOwner) return 'owner';
    var a = myAccess && myAccess[course.id];
    if (C.member && C.mem) {
      var p = C.mem.planId;
      if (course.access.mode === 'all' || course.access.planIds.indexOf(p) >= 0) return 'plan';
      // a module can open the course for a plan on its own; handled per module below
    }
    if (a && a.status === 'active' && (!a.expiresAt || ms(a.expiresAt) > Date.now())) return 'solo';
    return '';
  }
  function modAllows(m, course) {
    if (C.isOwner) return true;
    var a = myAccess && myAccess[course.id];
    if (a && a.status === 'active' && (!a.expiresAt || ms(a.expiresAt) > Date.now())) return true;
    if (!(C.member && C.mem)) return false;
    var p = C.mem.planId;
    return m.planIds.length ? m.planIds.indexOf(p) >= 0 : (course.access.mode === 'all' || course.access.planIds.indexOf(p) >= 0);
  }
  // Same base the rules use: the day he joined when his PLAN opens the lesson, else the day the course was given to him alone.
  function viaPlan(m, course) {
    if (!(C.member && C.mem)) return false;
    var p = C.mem.planId;
    return m.planIds.length ? m.planIds.indexOf(p) >= 0 : (course.access.mode === 'all' || course.access.planIds.indexOf(p) >= 0);
  }
  function baseTime(course, m) {
    if (viaPlan(m, course)) return ms(C.mem.joinedAt);
    var a = myAccess && myAccess[course.id];
    return a ? ms(a.createdAt) : 0;
  }
  function releaseAt(dr, base) { if (!dr || dr.mode === 'none') return 0; if (dr.mode === 'date') return ms(dr.at); return base + dr.days * DAY; }
  // -> { ok, why: ''|'plan'|'date'|'order', at }
  function lessonState(l, m) {
    if (C.isOwner) return { ok: true, why: '' };
    if (l.preview) return { ok: true, why: '', preview: true };
    if (!modAllows(m, cur)) return { ok: false, why: 'plan' };
    var base = baseTime(cur, m), at = Math.max(releaseAt(m.drip, base), releaseAt(l.drip, base));
    if (at > Date.now()) return { ok: false, why: 'date', at: at };
    if (cur.sequential && l.prev && !(prog && prog.done && prog.done[l.prev] > 0)) return { ok: false, why: 'order' };
    return { ok: true, why: '' };
  }
  function why(s) { return s.why === 'plan' ? 'Not in your plan' : s.why === 'date' ? 'Available on ' + CH.date(new Date(s.at)) : s.why === 'order' ? 'Finish the previous lesson first' : ''; }

  // ---------------------------------------------------------------- progress
  function done(lid) { return !!(prog && prog.done && prog.done[lid] > 0); }
  function saveProg() {
    if (!C.me || !cur || !(C.member || myAccess && myAccess[cur.id])) return Promise.resolve();
    var d = { uid: C.me.uid, done: prog.done, pos: prog.pos, last: prog.last || '', updatedAt: CH.ts() };
    if (prog.quiz && Object.keys(prog.quiz).length) d.quiz = prog.quiz;
    return crs().collection('progress').doc(C.me.uid).set(d).catch(function () {});
  }
  function saveSoon() { clearTimeout(saveT); saveT = setTimeout(saveProg, 1200); }
  function counts(ls) { var n = ls.length, d = ls.filter(function (l) { return done(l.id); }).length; return { n: n, d: d, pct: n ? Math.round(d / n * 100) : 0 }; }
  function bar(c) { return '<div class="cx-pbar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + c.pct + '"><div style="width:' + c.pct + '%"></div></div>'; }
  function pubMods() { return mods.filter(function (m) { return m.status === 'published' || C.isOwner; }).sort(function (a, b) { return a.order - b.order; }); }
  function modLs(mid) { return lessons.filter(function (l) { return l.moduleId === mid && (l.status === 'published' || C.isOwner); }).sort(function (a, b) { return a.order - b.order; }); }
  function flat() { var o = []; pubMods().forEach(function (m) { modLs(m.id).forEach(function (l) { o.push({ l: l, m: m }); }); }); return o; }

  // ---------------------------------------------------------------- mount / list
  // The rules only allow a list of published docs for non-owners, so the query itself must say so.
  function pubOnly(q) { return C.isOwner ? q : q.where('status', '==', 'published'); }
  function mount(el, c) {
    C = c; root = el; stop();
    var qs = c.qs || new URLSearchParams(location.search);
    el.innerHTML = '<div class="cx-empty">Loading courses…</div>';
    var base = db.collection('communities').doc(C.cid).collection('courses');
    base.where('status', '==', 'published').get().then(function (s) {
      courses = arr(s).sort(function (a, b) { return a.order - b.order; });
      if (C.isOwner) return base.get().then(function (all) { courses = arr(all).sort(function (a, b) { return a.order - b.order; }); });
    }).then(function () {
      var em = C.me && C.me.emailVerified && (C.me.email || '').toLowerCase(); myAccess = {};
      return Promise.all(courses.map(function (co) {
        var ps = [];
        if (em) ps.push(crs(co.id).collection('access').doc(em).get().then(function (d) { if (d.exists) myAccess[co.id] = d.data(); }).catch(function () {}));
        if (C.me) ps.push(crs(co.id).collection('progress').doc(C.me.uid).get().then(function (d) { co._prog = d.exists ? d.data() : null; }).catch(function () {}));
        ps.push(pubOnly(crs(co.id).collection('lessons')).get().then(function (s2) { co._n = s2.docs.filter(function (d) { return d.data().status === 'published'; }).length; }).catch(function () { co._n = 0; }));
        return Promise.all(ps);
      }));
    }).then(function () {
      var want = (qs.get('course') || '').replace(/[^A-Za-z0-9]/g, '');
      if (want && courses.some(function (x) { return x.id === want; })) return openCourse(want, (qs.get('lesson') || '').replace(/[^A-Za-z0-9]/g, ''));
      if (courses.length === 1 && !C.isOwner) return openCourse(courses[0].id);
      list();
    }).catch(function () { el.innerHTML = '<div class="cx-empty">Could not load courses. Check your connection and try again.</div>'; });
  }

  function list() {
    cur = null; stop();
    if (!courses.length) { root.innerHTML = '<div class="cx-empty"><h3>Courses</h3>No courses published yet.' + (C.isOwner ? ' Build one in the Creator Hub.' : '') + '</div>'; return; }
    root.innerHTML = '<div class="cx-cgrid">' + courses.map(function (co) {
      var h = how(co), p = co._prog && co._prog.done ? Object.keys(co._prog.done).filter(function (k) { return co._prog.done[k] > 0; }).length : 0, pct = co._n ? Math.min(100, Math.round(p / co._n * 100)) : 0;
      var tag = C.isOwner ? 'Yours' : h ? 'You have access' : co.solo.mode === 'paid' ? 'Paid' : co.solo.mode === 'free' ? 'Free' : 'Locked';
      return '<button type="button" class="cx-cc cx-box" data-c="' + E(co.id) + '"><span class="cx-cc-h"><b>' + E(co.title) + '</b>' + (co.status !== 'published' ? '<span class="cx-chip">Draft</span>' : '<span class="cx-chip' + (h || C.isOwner ? ' on' : '') + '">' + E(tag) + '</span>') + '</span>' +
        (co.desc ? '<span class="cx-muted cx-cc-d">' + E(co.desc) + '</span>' : '') + '<span class="cx-muted">' + co._n + ' lesson' + (co._n === 1 ? '' : 's') + '</span>' +
        (h && C.me && !C.isOwner ? bar({ pct: pct }) + '<span class="cx-muted">' + pct + '% done</span>' : '') + '</button>';
    }).join('') + '</div>';
    root.querySelectorAll('.cx-cc').forEach(function (b) { b.onclick = function () { openCourse(b.dataset.c); }; });
  }

  // ---------------------------------------------------------------- course page
  function openCourse(id, lid) {
    stop(); root.innerHTML = '<div class="cx-empty">Loading…</div>';
    var c = crs(id), co = courses.filter(function (x) { return x.id === id; })[0];
    return Promise.all([pubOnly(c.collection('modules')).get(), pubOnly(c.collection('lessons')).get(), C.me ? c.collection('progress').doc(C.me.uid).get().catch(function () { return null; }) : null]).then(function (r) {
      cur = co; mods = arr(r[0]); lessons = arr(r[1]);
      var pd = r[2] && r[2].exists ? r[2].data() : null;
      prog = pd ? { done: pd.done || {}, pos: pd.pos || {}, last: pd.last || '', quiz: pd.quiz || {} } : { done: {}, pos: {}, last: '', quiz: {} };
      if (lid) { var hit = flat().filter(function (x) { return x.l.id === lid; })[0]; if (hit) return lesson(hit.l, hit.m, true); }
      page();
    }).catch(function () { root.innerHTML = '<div class="cx-empty">Could not load this course.</div>'; });
  }

  function page() {
    stop(); open = null;
    var items = flat(), all = counts(items.map(function (x) { return x.l; })), h0 = how(cur);
    var resume = null;
    if (prog.last) resume = items.filter(function (x) { return x.l.id === prog.last; })[0];
    var next = items.filter(function (x) { return !done(x.l.id) && lessonState(x.l, x.m).ok; })[0];
    var go = (resume && !done(resume.l.id) && lessonState(resume.l, resume.m).ok) ? resume : next;
    var h = '<button type="button" class="cx-back" id="cl-back">' + (courses.length > 1 || C.isOwner ? '&larr; All courses' : '') + '</button>' +
      '<div class="cx-box cx-chead"><div class="cx-spread"><h2 style="margin:0;overflow-wrap:anywhere">' + E(cur.title) + '</h2>' + (cur.status !== 'published' ? '<span class="cx-chip">Draft</span>' : '') + '</div>' +
      (cur.desc ? '<p class="cx-muted" style="margin:8px 0 0">' + E(cur.desc) + '</p>' : '') +
      (h0 && !C.isOwner ? '<div class="cx-pbl">' + bar(all) + '<span class="cx-muted">' + all.d + ' of ' + all.n + ' lessons · ' + all.pct + '%</span></div>' : '') +
      '<div class="cx-actions">' + (go ? '<button type="button" class="btn btn-primary" id="cl-go">' + (prog.last || all.d ? 'Resume: ' : 'Start: ') + E(go.l.title) + '</button>' : '') + accessBtn(h0) + '</div><div class="cx-bad" id="cl-msg" role="alert"></div></div>';
    h += '<div class="cx-curr">' + pubMods().map(function (m) {
      var ls = modLs(m.id), c = counts(ls), allowed = modAllows(m, cur) || C.isOwner;
      return '<section class="cx-box cx-cmod"><div class="cx-cmod-h"><div style="min-width:0"><b>' + E(m.title) + '</b><span class="cx-muted"> · ' + ls.length + ' lesson' + (ls.length === 1 ? '' : 's') + '</span></div>' +
        (h0 && allowed && !C.isOwner ? '<span class="cx-muted">' + c.pct + '%</span>' : (!allowed ? '<span class="cx-lockc">' + svg('lock', 16) + '<span>Locked</span></span>' : '')) + '</div>' +
        (h0 && allowed && !C.isOwner ? bar(c) : '') +
        '<div class="cx-lrows">' + ls.map(function (l) {
          var s = lessonState(l, m), d = done(l.id);
          return '<button type="button" class="cx-ll' + (s.ok ? '' : ' lock') + (d ? ' done' : '') + '" data-l="' + E(l.id) + '" aria-label="' + E(l.title) + (s.ok ? '' : ', locked. ' + why(s)) + '">' +
            '<span class="cx-ltype">' + svg(l.type) + '</span><span class="cx-lt"><span class="cx-ltt">' + E(l.title) + '</span><span class="cx-muted">' + (s.ok ? (l.mins ? l.mins + ' min' : l.type) + (l.preview && !C.isOwner && !h0 ? ' · Free preview' : '') + (l.hasQuiz ? ' · Quiz' : '') : E(why(s))) + '</span></span>' +
            '<span class="cx-lst">' + (d ? '<span class="cx-tick">' + svg('check', 18) + '</span>' : s.ok ? '' : '<span class="cx-lockc">' + svg('lock', 18) + '</span>') + '</span></button>';
        }).join('') + '</div></section>';
    }).join('') + '</div>' + (items.length ? '' : '<div class="cx-empty">No lessons yet.</div>');
    h += '<div class="cx-box cx-rep"><button class="btn btn-ghost cx-sm" type="button" id="cl-report">Report this course</button><div id="cl-rep" hidden></div></div>';
    root.innerHTML = h;
    var bk = $('cl-back'); if (!bk.textContent) bk.hidden = true; bk.onclick = function () { list(); };
    var gb = $('cl-go'); if (gb) gb.onclick = function () { lesson(go.l, go.m); };
    var ab = $('cl-acc'); if (ab) ab.onclick = accessAction;
    root.querySelectorAll('.cx-ll').forEach(function (b) { b.onclick = function () {
      var it = items.filter(function (x) { return x.l.id === b.dataset.l; })[0], s = lessonState(it.l, it.m);
      if (!s.ok) return lockedNote(it, s);
      lesson(it.l, it.m);
    }; });
    $('cl-report').onclick = report;
  }
  function $(id) { return document.getElementById(id); }
  function accessBtn(h0) {
    if (h0 || C.isOwner) return '';
    var s = cur.solo;
    if (s.mode === 'free') return '<button type="button" class="btn btn-ghost" id="cl-acc">Get this course free</button>';
    if (s.mode === 'paid') return CH.cfg.PAYMENTS ? '' : '<button type="button" class="btn btn-ghost" id="cl-acc" disabled>Paid checkout opens soon · ' + E(CH.money({ price: { amount: s.price.amount, currency: s.price.currency, interval: 'lifetime' } })) + '</button>';
    return '<button type="button" class="btn btn-ghost" id="cl-acc">' + (cur.access.planIds.length ? 'See the plans that include it' : 'By invite only') + '</button>';
  }
  function accessAction() {
    var s = cur.solo;
    if (s.mode === 'free') {
      if (!C.me) return C.signIn();
      if (!C.me.emailVerified) { $('cl-msg').textContent = 'Verify your email first (check your inbox), then try again.'; return; }
      var em = C.me.email.toLowerCase();
      crs().collection('access').doc(em).set({ email: em, source: 'free', status: 'active', expiresAt: null, createdBy: C.me.uid, createdAt: CH.ts() })
        .then(function () { CH.toast('success', 'The course is yours'); mount(root, C); }).catch(function () { $('cl-msg').textContent = 'Could not get access. You may already have it, or you cannot join this community.'; });
    } else { var side = document.getElementById('cm-side'); if (side) side.scrollIntoView({ behavior: 'smooth' }); }
  }
  function lockedNote(it, s) {
    var m = $('cl-msg'); if (!m) return;
    m.textContent = '"' + it.l.title + '": ' + (s.why === 'plan' ? (C.member ? 'your plan does not include this lesson.' : 'join this community to unlock it. Free previews are open to everyone.') : s.why === 'date' ? 'opens on ' + CH.date(new Date(s.at)) + '.' : 'finish the previous lesson first.');
    m.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  function report() {
    if (!C.me) return C.signIn(); var box = $('cl-rep'); box.hidden = false;
    box.innerHTML = '<div class="cx-f" style="margin-top:10px"><select id="cl-rr" class="cx-in-s" style="width:100%" aria-label="Reason"><option value="scam">Scam or fraud</option><option value="results">Fake or misleading results</option><option value="copied">Copied or leaked material</option><option value="abuse">Abuse or harassment</option><option value="illegal">Illegal content</option><option value="other">Something else</option></select><textarea id="cl-rn" maxlength="500" placeholder="Details (optional)" class="cx-in" style="min-height:70px"></textarea><button class="btn btn-primary" id="cl-rs" type="button">Send report</button><div id="cl-rm" role="status"></div></div>';
    $('cl-rs').onclick = function () {
      var d = { targetType: 'course', cid: C.cid, targetId: cur.id, reporterUid: C.me.uid, reason: $('cl-rr').value, status: 'open', createdAt: CH.ts() }, n = $('cl-rn').value.trim(); if (n) d.note = n;
      db.collection('creatorReports').doc('course_' + C.cid + '_' + C.me.uid).set(d).then(function () { box.innerHTML = '<p class="cx-ok">Thanks. We will look at it.</p>'; }).catch(function () { $('cl-rm').textContent = 'Could not send. You may have already reported a course here.'; });
    };
  }

  // ---------------------------------------------------------------- lesson view
  function lesson(l, m, direct) {
    stop(); open = l;
    var items = flat(), idx = items.map(function (x) { return x.l.id; }).indexOf(l.id), prev = items[idx - 1], next = items[idx + 1];
    prog.last = l.id; if (C.me && !C.isOwner && how(cur)) saveSoon();
    root.innerHTML = '<div class="cx-lv"><button type="button" class="cx-back" id="lv-back">&larr; ' + E(cur.title) + '</button><div class="cx-spread" style="margin-top:6px"><h2 style="margin:0;overflow-wrap:anywhere">' + E(l.title) + '</h2></div>' +
      '<div class="cx-muted" style="margin-bottom:12px">' + E(m.title) + (l.mins ? ' · ' + l.mins + ' min' : '') + '</div><div id="lv-main"><div class="cx-empty">Loading…</div></div><div id="lv-after"></div></div>';
    $('lv-back').onclick = page;
    var bref = crs().collection('lessons').doc(l.id).collection('content').doc('body');
    bref.get().then(function (d) {
      if (!d.exists) { $('lv-main').innerHTML = '<div class="cx-empty">This lesson has no content yet.</div>'; return; }
      render(l, m, d.data(), items, idx, prev, next);
    }).catch(function (e) {
      var s = lessonState(l, m);
      $('lv-main').innerHTML = '<div class="cx-empty cx-locked">' + svg('lock', 28) + '<h3>' + E(s.ok ? 'This lesson is not available' : why(s)) + '</h3>' + (s.ok ? (e && e.code === 'permission-denied' ? 'You do not have access to this lesson. If your plan just changed, reload the page.' : 'Could not load it. Check your connection and try again.') : (s.why === 'plan' ? 'Join the community or pick a plan that includes this course.' : s.why === 'date' ? 'It opens automatically on that date.' : 'Complete the lesson before it to open this one.')) + '</div>';
    });
  }

  function render(l, m, b, items, idx, prev, next) {
    var main = $('lv-main'), user = { email: C.me ? C.me.email : 'preview', displayName: C.me ? C.me.displayName : '' }, start = (prog.pos && prog.pos[l.id]) || 0, tracks = false;
    if (b.type === 'video') {
      player = CHP.mountVideo(main, { url: b.video.url, title: l.title, user: user, start: start > 5 ? start - 3 : 0,
        onProgress: function (pct, sec) { if (!C.me) return; prog.pos[l.id] = Math.floor(sec); saveSoon(); },
        onEnded: function () { if (C.me && !done(l.id) && !(b.quiz)) markDone(l, true); else if (b.quiz && !done(l.id)) CH.toast('success', 'Nice. Take the quiz below to finish this lesson.'); } });
      tracks = player && player.tracks;
    } else if (b.type === 'text') {
      main.innerHTML = '<article class="cx-text reader-body" id="lv-text">' + stkHtml(b.html || '') + '<p class="cx-wm-line">' + E(CHP.wmLabel(user)) + ' · TradeZoro member copy</p></article>';
    } else if (b.type === 'pdf') {
      main.innerHTML = '<div id="lv-pdf"></div>';
      var pv = CHP.pdf($('lv-pdf'), function () { return fetchFile(l.id, 'main'); }, user, { onLast: function () { if (C.me && !done(l.id) && !b.quiz) markDone(l, true); } });
      player = pv;
    } else if (b.type === 'link') {
      main.innerHTML = '<div class="cx-box"><p style="margin-top:0">This lesson is a link to another site.</p><a class="btn btn-primary" href="' + E(b.link.url) + '" target="_blank" rel="noopener noreferrer nofollow">Open the link</a><p class="cx-muted" style="margin-bottom:0">' + E(b.link.url.replace(/^https:\/\//, '').slice(0, 80)) + '</p></div>';
    }
    var h = '';
    if (b.attachments && b.attachments.length) {
      h += '<div class="cx-box"><h3>Attachments</h3><div class="cx-atts">' + b.attachments.map(function (a, i) {
        var view = a.ct === 'application/pdf' || /^image\//.test(a.ct);
        return '<div class="cx-att"><span class="cx-ltype">' + svg('clip') + '</span><div class="cx-lt"><span class="cx-ltt">' + E(a.name) + '</span><span class="cx-muted">' + (a.size / 1048576).toFixed(1) + ' MB</span></div>' +
          (view ? '<button type="button" class="btn btn-ghost cx-sm at-v" data-i="' + i + '">View</button>' : '') + (a.download || !view ? '<button type="button" class="btn btn-ghost cx-sm at-d" data-i="' + i + '">Download</button>' : '') + '</div>';
      }).join('') + '</div></div>';
    }
    h += '<div id="lv-quiz"></div>';
    h += '<div class="cx-box"><div class="cx-spread"><div><b id="lv-st">' + (done(l.id) ? 'Completed' : 'Not completed yet') + '</b>' + (tracks ? '<div class="cx-muted">Completes by itself near the end of the video.</div>' : '') + '</div>' +
      (C.me && !C.isOwner && (C.member || how(cur)) ? '<button type="button" class="btn ' + (done(l.id) ? 'btn-ghost' : 'btn-primary') + '" id="lv-done"' + (b.quiz && !done(l.id) ? ' disabled title="Pass the quiz to finish"' : '') + '>' + (done(l.id) ? 'Mark as not done' : 'Mark complete') + '</button>' : '') + '</div></div>';
    if (C.me && !C.isOwner && (C.member || how(cur))) h += '<div class="cx-box"><label for="lv-note" style="font-weight:600;font-size:14px">My notes <span class="cx-muted" style="font-weight:400">(private, only you see them)</span></label><textarea id="lv-note" class="cx-in" maxlength="4000" style="min-height:96px;margin-top:8px" placeholder="Write a note for this lesson"></textarea><div class="cx-muted" id="lv-ns" role="status"></div></div>';
    h += '<div class="cx-pn"><button type="button" class="btn btn-ghost" id="lv-prev"' + (prev ? '' : ' disabled') + '>&larr; Previous</button><button type="button" class="btn btn-primary" id="lv-next"' + (next ? '' : ' disabled') + '>Next &rarr;</button></div>';
    $('lv-after').innerHTML = h;
    $('lv-prev').onclick = function () { if (prev) gotoLesson(prev); };
    $('lv-next').onclick = function () { if (next) gotoLesson(next); };
    var dn = $('lv-done'); if (dn) dn.onclick = function () { markDone(l, !done(l.id)); };
    $('lv-after').querySelectorAll('.at-v').forEach(function (bt) { bt.onclick = function () { viewAtt(l, +bt.dataset.i, b.attachments[+bt.dataset.i], user); }; });
    $('lv-after').querySelectorAll('.at-d').forEach(function (bt) { bt.onclick = function () { downloadAtt(l, +bt.dataset.i, b.attachments[+bt.dataset.i], bt); }; });
    if (b.quiz) quiz(l, b.quiz);
    var nt = $('lv-note'); if (nt) {
      var nref = crs().collection('notes').doc(C.me.uid + '_' + l.id);
      nref.get().then(function (d) { if (d.exists) nt.value = d.data().text || ''; }).catch(function () {});
      var t = null; function sv() { clearTimeout(t); $('lv-ns').textContent = 'Saving…'; t = setTimeout(function () {
        var v = nt.value.trim(), p = v ? nref.set({ uid: C.me.uid, text: v, updatedAt: CH.ts() }) : nref.delete();
        p.then(function () { $('lv-ns').textContent = 'Saved'; }).catch(function () { $('lv-ns').textContent = 'Could not save the note.'; }); }, 900); }
      nt.addEventListener('input', sv);
    }
  }
  function gotoLesson(it) {
    var s = lessonState(it.l, it.m); if (!s.ok) { page(); return setTimeout(function () { lockedNote(it, s); }, 50); }
    lesson(it.l, it.m);
  }

  function markDone(l, on) {
    if (!C.me) return C.signIn();
    if (on) prog.done[l.id] = 1; else delete prog.done[l.id];
    var st = $('lv-st'); if (st) st.textContent = on ? 'Completed' : 'Not completed yet';
    var b = $('lv-done'); if (b) { b.textContent = on ? 'Mark as not done' : 'Mark complete'; b.className = 'btn ' + (on ? 'btn-ghost' : 'btn-primary'); }
    clearTimeout(saveT); saveProg().then(function () { if (on) CH.toast('success', 'Lesson complete'); });
  }

  // ---------------------------------------------------------------- files (always through the API, never a Storage URL)
  function fetchFile(lid, i) {
    return C.me ? C.me.getIdToken().then(function (t) { return req(lid, i, t); }) : req(lid, i, '');
  }
  function req(lid, i, tok) {
    return fetch('/api/creator/file?cid=' + encodeURIComponent(C.cid) + '&crid=' + encodeURIComponent(cur.id) + '&lid=' + encodeURIComponent(lid) + '&i=' + i, tok ? { headers: { authorization: 'Bearer ' + tok } } : {})
      .then(function (r) { if (!r.ok) throw new Error('file'); return r.arrayBuffer().then(function (b) { return { buf: b, ct: r.headers.get('content-type') || '' }; }); })
      .then(function (x) { return x.buf; });
  }
  function viewAtt(l, i, a, user) {
    var bg = document.createElement('div'); bg.className = 'cx-sheet-bg'; bg.innerHTML = '<div class="cx-sheet cx-wide" role="dialog" aria-modal="true" aria-label="' + E(a.name) + '"><div class="cx-grab" aria-hidden="true"></div><div class="cx-sheet-h"><h2>' + E(a.name) + '</h2><button type="button" class="cx-x" aria-label="Close">' + svg('x') + '</button></div><div class="cx-sheet-b stkc-scroll" id="av-b"></div></div>';
    document.body.appendChild(bg); document.body.classList.add('cx-noscroll'); var pv = null, url = null;
    function close() { document.removeEventListener('keydown', key); if (pv) pv.destroy(); if (url) URL.revokeObjectURL(url); bg.remove(); document.body.classList.remove('cx-noscroll'); }
    function key(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', key); bg.querySelector('.cx-x').onclick = close; bg.addEventListener('mousedown', function (e) { if (e.target === bg) close(); });
    var box = bg.querySelector('#av-b');
    if (a.ct === 'application/pdf') pv = CHP.pdf(box, function () { return fetchFile(l.id, i); }, user, {});
    else {
      box.innerHTML = '<div class="cx-empty">Loading…</div>';
      fetchFile(l.id, i).then(function (buf) { url = URL.createObjectURL(new Blob([buf], { type: a.ct })); box.innerHTML = '<div class="cx-imgwrap"><img src="' + url + '" alt="' + E(a.name) + '"></div>'; CHP.watermark(box.firstChild, user); })
        .catch(function () { box.innerHTML = '<div class="cx-empty">Could not open this file.</div>'; });
    }
  }
  function downloadAtt(l, i, a, btn) {
    btn.disabled = true;
    fetchFile(l.id, i).then(function (buf) {
      var url = URL.createObjectURL(new Blob([buf], { type: a.ct })), el = document.createElement('a'); el.href = url; el.download = a.name; document.body.appendChild(el); el.click(); el.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    }).catch(function () { CH.toast('error', 'Could not download this file.'); }).then(function () { btn.disabled = false; });
  }

  // ---------------------------------------------------------------- quiz
  function quiz(l, q) {
    var box = $('lv-quiz'), best = prog.quiz && prog.quiz[l.id] ? prog.quiz[l.id] : null;
    function ask() {
      box.innerHTML = '<div class="cx-box"><div class="cx-spread"><h3 style="margin:0">Quiz</h3><span class="cx-muted">Pass mark ' + q.pass + '%' + (best ? ' · best ' + best.best + '%' : '') + '</span></div><form id="qz" class="cx-f" style="margin-top:12px" novalidate>' +
        q.questions.map(function (x, i) {
          return '<fieldset class="cx-qf"><legend>' + (i + 1) + '. ' + E(x.q) + '</legend>' + x.opts.map(function (o, k) { return '<label class="cx-ropt"><input type="radio" name="q' + i + '" value="' + k + '"><span>' + E(o) + '</span></label>'; }).join('') + '</fieldset>';
        }).join('') + '<div id="qz-m" role="alert" class="cx-bad"></div><div class="cx-actions"><button class="btn btn-primary" type="submit"' + (C.me && !C.isOwner ? '' : '') + '>Check answers</button></div></form></div>';
      $('qz').onsubmit = function (e) {
        e.preventDefault(); var right = 0, miss = [];
        q.questions.forEach(function (x, i) { var s = box.querySelector('input[name="q' + i + '"]:checked'); if (s && +s.value === x.ok) right++; else miss.push(i + 1); });
        var answered = box.querySelectorAll('input:checked').length; if (answered < q.questions.length) return $('qz-m').textContent = 'Answer every question first.';
        var pct = Math.round(right / q.questions.length * 100), pass = pct >= q.pass;
        if (C.me && !C.isOwner) { prog.quiz = prog.quiz || {}; var old = prog.quiz[l.id]; prog.quiz[l.id] = { best: Math.max(pct, old ? old.best : 0), passed: pass || !!(old && old.passed), tries: (old ? old.tries : 0) + 1 }; best = prog.quiz[l.id]; }
        box.innerHTML = '<div class="cx-box"><h3 style="margin-top:0">' + (pass ? 'Passed' : 'Not yet') + ': ' + pct + '%</h3><p class="cx-muted">' + right + ' of ' + q.questions.length + ' right. Pass mark ' + q.pass + '%.' + (miss.length ? ' Check question' + (miss.length > 1 ? 's' : '') + ' ' + miss.join(', ') + '.' : '') + '</p><div class="cx-actions"><button class="btn ' + (pass ? 'btn-ghost' : 'btn-primary') + '" id="qz-again" type="button">Try again</button></div></div>';
        $('qz-again').onclick = ask;
        if (pass && C.me && !C.isOwner) { var d = $('lv-done'); if (d) d.disabled = false; if (!done(l.id)) markDone(l, true); else saveSoon(); } else if (C.me && !C.isOwner) saveSoon();
      };
    }
    ask();
  }

  g.CHL = { mount: mount, _state: lessonState };
})(window);
