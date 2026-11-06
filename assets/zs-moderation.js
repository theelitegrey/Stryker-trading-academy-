// TradeZoro — Admin: Zscript library reports + takedowns (moderation-admin.html, "Script Library" panel).
// Depends on: assets/auth.js, assets/progress.js (`db`), assets/admin-guard.js (the page is admin-only; the rules also check).
// Reads zsReports (status 'open'), groups them by script, and lets an admin: take the script down (status 'removed' + a note
// the author sees; it stops loading on every chart except the author's), restore it, or dismiss the reports.
// Taken-down scripts stay in a second list so they can be restored. Paid buyers keep their purchase record (buyers/{uid}).
(function () {
  var box = document.getElementById('zs-mod-list'); if (!box) return;
  var cnt = document.getElementById('zs-mod-count');
  var E = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var R = { copied: 'Copied', results: 'Result claims', malicious: 'Harmful', broken: 'Broken', abuse: 'Abusive', other: 'Other' };
  var ts = function () { return firebase.firestore.FieldValue.serverTimestamp(); };

  function load() {
    box.innerHTML = '<div data-skel="lines" data-n="3"></div>';
    Promise.all([
      db.collection('zsReports').where('status', '==', 'open').limit(300).get(),
      db.collection('zsScripts').where('status', '==', 'removed').limit(100).get()
    ]).then(function (r) {
      var by = {};
      r[0].docs.forEach(function (d) { var o = d.data(); o.id = d.id; (by[o.sid] = by[o.sid] || []).push(o); });
      var sids = Object.keys(by);
      return Promise.all(sids.map(function (sid) { return db.collection('zsScripts').doc(sid).get(); })).then(function (snaps) {
        var open = snaps.map(function (s, i) { return { sid: sids[i], doc: s.exists ? s.data() : null, reports: by[sids[i]] }; })
          .sort(function (a, b) { return b.reports.length - a.reports.length; });
        render(open, r[1].docs.map(function (d) { return { sid: d.id, doc: d.data() }; }));
      });
    }).catch(function () { box.innerHTML = '<p class="zm-empty">Could not load script reports.</p>'; });
  }

  function row(x, removed) {
    var d = x.doc || {};
    var head = '<div class="cell-user"><div><span class="cell-name"><a href="/script-library?s=' + E(x.sid) + '" target="_blank" rel="noopener">' + E(d.name || '(deleted script)') + '</a></span>' +
      '<span class="cell-sub">by ' + E(d.authorName || '?') + ' · v' + E(d.version || '?') + ' · ' + (d.sale && d.sale.mode === 'paid' ? 'Paid' : 'Free') + ' · ' + E(d.access || '') + ' · status ' + E(d.status || 'gone') + '</span></div></div>';
    var reps = removed ? (d.modNote ? '<p class="zm-note">Note to author: ' + E(d.modNote) + '</p>' : '') :
      '<ul class="zm-reps">' + x.reports.map(function (p) { return '<li><b>' + E(R[p.reason] || p.reason) + '</b>' + (p.note ? ': ' + E(p.note) : '') + '</li>'; }).join('') + '</ul>';
    var acts = '<div class="zm-acts">' + (removed
      ? '<button class="btn btn-sm btn-primary" data-a="restore">Restore</button>'
      : (x.doc && d.status !== 'removed' ? '<button class="btn btn-sm btn-primary" data-a="down">Take down</button>' : '') + '<button class="btn btn-sm btn-ghost" data-a="dismiss">Dismiss ' + x.reports.length + ' report' + (x.reports.length === 1 ? '' : 's') + '</button>') + '</div>';
    return '<div class="record-card" data-sid="' + E(x.sid) + '">' + head + reps + acts + '</div>';
  }

  function render(open, removed) {
    if (cnt) cnt.textContent = open.length + ' reported · ' + removed.length + ' taken down';
    box.innerHTML = (open.length ? open.map(function (x) { return row(x, false); }).join('') : '<p class="zm-empty">No open script reports.</p>') +
      (removed.length ? '<h3 class="zm-h">Taken down</h3>' + removed.map(function (x) { return row(x, true); }).join('') : '');
    box.onclick = function (e) {
      var b = e.target.closest('button[data-a]'); if (!b) return;
      var sid = b.closest('[data-sid]').dataset.sid, a = b.dataset.a, x = open.filter(function (o) { return o.sid === sid; })[0];
      var ref = db.collection('zsScripts').doc(sid), job;
      if (a === 'down') {
        var note = prompt('Reason shown to the author (required, max 500 characters):', '');
        if (!note || !note.trim()) return;
        var bt = db.batch();
        bt.update(ref, { status: 'removed', modNote: note.trim().slice(0, 500) });
        x.reports.forEach(function (p) { bt.update(db.collection('zsReports').doc(p.id), { status: 'actioned', closedAt: ts() }); });
        job = bt.commit();
      } else if (a === 'restore') {
        job = ref.update({ status: 'live', modNote: '' });
      } else {
        var bt2 = db.batch();
        x.reports.forEach(function (p) { bt2.update(db.collection('zsReports').doc(p.id), { status: 'dismissed', closedAt: ts() }); });
        job = bt2.commit();
      }
      b.disabled = true;
      job.then(function () { if (typeof showToast === 'function') showToast('success', 'Done.'); load(); })
        .catch(function () { b.disabled = false; if (typeof showToast === 'function') showToast('error', 'Could not save.'); });
    };
  }

  if (typeof auth !== 'undefined' && auth) { var un = auth.onAuthStateChanged(function (u) { un(); if (u) load(); }); }
})();
