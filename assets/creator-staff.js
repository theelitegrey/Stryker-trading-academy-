// Staff moderation for communities (creator-admin.html): list, suspend/unsuspend, reports.
// Depends on: creator.js (CH), admin-guard.js (guardAdminPage), progress.js (db). The rules (isAdmin) are the real gate.
(function () {
  var root = document.getElementById('ad-root'), tab = 'cm', cms = [], reps = [];
  var E = CH.esc;
  document.querySelector('.cx-tabs').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return; tab = b.dataset.t;
    document.querySelectorAll('.cx-tabs button').forEach(function (x) { x.classList.toggle('on', x === b); }); draw();
  });
  function draw() {
    if (tab === 'cm') {
      root.innerHTML = cms.length ? '<div class="cx-tablewrap"><table class="cx-table"><thead><tr><th>Community</th><th>Owner</th><th>Members</th><th>Visibility</th><th>Status</th><th></th></tr></thead><tbody>' + cms.map(function (c) {
        var open = reps.filter(function (r) { return r.cid === c.id && r.status === 'open'; }).length;
        return '<tr data-c="' + E(c.id) + '"><td><a href="/c/' + E(c.id) + '" style="color:var(--gold-bright)">' + E(c.name) + '</a>' + (open ? ' <span class="cx-chip">' + open + ' open report' + (open > 1 ? 's' : '') + '</span>' : '') + '</td><td>' + E(c.ownerName) + '</td><td>' + (c.memberCount || 0) + '</td><td>' + E(c.visibility) + '</td><td>' + (c.status === 'suspended' ? '<span class="cx-bad">Suspended</span>' : 'Active') + '</td>' +
          '<td><button class="btn btn-ghost ad-tog" type="button">' + (c.status === 'suspended' ? 'Unsuspend' : 'Suspend') + '</button></td></tr>';
      }).join('') + '</tbody></table></div>' : '<div class="cx-empty">No communities yet.</div>';
      root.querySelectorAll('.ad-tog').forEach(function (b) { b.onclick = function () {
        var id = b.closest('tr').dataset.c, c = cms.filter(function (x) { return x.id === id; })[0], sus = c.status !== 'suspended', why = '';
        if (sus) { why = prompt('Reason for suspending (shown to the owner):'); if (why === null) return; }
        var p = sus ? { status: 'suspended', suspendedReason: why.slice(0, 300), suspendedAt: CH.ts(), updatedAt: CH.ts() } : { status: 'active', updatedAt: CH.ts() };
        db.collection('communities').doc(id).update(p).then(function () { c.status = p.status; draw(); CH.toast('success', sus ? 'Suspended' : 'Unsuspended'); }).catch(function () { CH.toast('error', 'Not allowed.'); });
      }; });
    } else {
      root.innerHTML = reps.length ? '<div class="cx-tablewrap"><table class="cx-table"><thead><tr><th>Date</th><th>Community</th><th>Reason</th><th>Note</th><th>Status</th><th></th></tr></thead><tbody>' + reps.map(function (r) {
        return '<tr data-r="' + E(r.id) + '"><td>' + E(CH.date(r.createdAt)) + '</td><td><a href="/c/' + E(r.cid) + '" style="color:var(--gold-bright)">' + E(r.cid) + '</a></td><td>' + E(r.reason) + '</td><td style="max-width:260px;overflow-wrap:anywhere">' + E(r.note || '') + '</td><td>' + E(r.status) + '</td><td>' + (r.status === 'open' ? '<button class="btn btn-ghost rp-done" type="button">Mark handled</button>' : '') + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '<div class="cx-empty">No reports.</div>';
      root.querySelectorAll('.rp-done').forEach(function (b) { b.onclick = function () {
        var id = b.closest('tr').dataset.r, r = reps.filter(function (x) { return x.id === id; })[0];
        var d = {}; Object.keys(r).forEach(function (k) { if (k !== 'id') d[k] = r[k]; }); d.status = 'handled';
        db.collection('creatorReports').doc(id).update({ status: 'handled' }).then(function () { r.status = 'handled'; draw(); }).catch(function () { CH.toast('error', 'Not allowed.'); });
      }; });
    }
  }
  guardAdminPage(function () {
    Promise.all([db.collection('communities').get(), db.collection('creatorReports').get()]).then(function (r) {
      cms = r[0].docs.map(function (d) { var o = d.data(); o.id = d.id; return o; }).sort(function (a, b) { return (b.createdAt ? b.createdAt.toMillis() : 0) - (a.createdAt ? a.createdAt.toMillis() : 0); });
      reps = r[1].docs.map(function (d) { var o = d.data(); o.id = d.id; return o; }).sort(function (a, b) { return (b.createdAt ? b.createdAt.toMillis() : 0) - (a.createdAt ? a.createdAt.toMillis() : 0); });
      draw();
    }).catch(function () { root.innerHTML = '<div class="cx-empty">Could not load.</div>'; });
  });
})();
