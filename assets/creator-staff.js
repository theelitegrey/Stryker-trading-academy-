// Staff moderation for communities (creator-admin.html): list, suspend/unsuspend, reports, creators' payout status.
// Depends on: creator.js (CH), creator-pay.js (CP), admin-guard.js (guardAdminPage), progress.js (db), firebase functions.
// The rules (isAdmin) and the creatorPay function (admin check) are the real gates. Suspend goes through creatorPay so
// live subscriptions stop renewing (members keep access to the end of what they paid); direct write is the fallback.
(function () {
  var root = document.getElementById('ad-root'), tab = 'cm', cms = [], reps = [], pay = null;
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
        var direct = function () { return db.collection('communities').doc(id).update(p).then(function () { return {}; }); };
        b.disabled = true;
        (window.CP ? CP.call('suspend', { cid: id, suspend: sus, reason: why || '' }).catch(direct) : direct()).then(function (r) {
          c.status = p.status; draw();
          CH.toast('success', sus ? 'Suspended' + (r && r.renewalsStopped ? '. ' + r.renewalsStopped + ' subscription(s) will not renew; members keep access to the end of their period.' : '') : 'Unsuspended');
        }).catch(function () { b.disabled = false; CH.toast('error', 'Not allowed.'); });
      }; });
    } else if (tab === 'pay') {
      if (!pay) { root.innerHTML = '<div class="cx-empty">Loading payout status…</div>'; loadPay(); return; }
      if (pay.error) { root.innerHTML = '<div class="cx-empty">' + E(pay.error) + '</div>'; return; }
      var lab = { incomplete: 'Not finished', pending: 'Stripe is checking', active: 'Active', restricted: 'Needs details', disabled: 'Off' };
      var cname = function (cid) { var c = cms.filter(function (x) { return x.id === cid; })[0]; return c ? c.name : (cid || ''); };
      root.innerHTML = '<p class="cx-muted" style="margin:0 0 12px">Stripe mode: <b>' + E(pay.mode) + '</b>. Status comes from Stripe (account.updated events and each creator\'s own refresh).</p>' +
        (pay.creators.length ? '<div class="cx-tablewrap"><table class="cx-table"><thead><tr><th>Creator</th><th>Community</th><th>Country</th><th>Status</th><th>Charges</th><th>Payouts</th><th>Stripe says</th></tr></thead><tbody>' + pay.creators.map(function (x) {
          var say = (x.errors || []).map(function (e) { return e.reason; }).concat(x.disabledReason ? [String(x.disabledReason).replace(/[._]/g, ' ')] : []).join('; ') || ((x.currentlyDue || []).length ? (x.currentlyDue.length + ' item(s) due') : '');
          return '<tr><td style="font-family:var(--font-mono);font-size:12px">' + E(x.uid) + '<div class="cx-muted" style="font-size:12px">' + E(x.acct) + '</div></td><td>' + (x.cid ? '<a href="/c/' + E(x.cid) + '" style="color:var(--gold-bright)">' + E(cname(x.cid)) + '</a>' : '') + '</td><td>' + E(x.country || '') + '</td>' +
            '<td>' + E(lab[x.status] || x.status) + '</td><td>' + (x.chargesEnabled ? 'Yes' : 'No') + '</td><td>' + (x.payoutsEnabled ? 'Yes' : 'No') + '</td><td style="max-width:280px;overflow-wrap:anywhere">' + E(say) + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '<div class="cx-empty">No creator has started payout setup yet.</div>');
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
  function loadPay() {
    if (!window.CP) { pay = { error: 'Payments script not loaded.' }; return draw(); }
    CP.call('adminList').then(function (r) { pay = r; draw(); }).catch(function (e) { pay = { error: 'Could not load payout status: ' + CP.errText(e) }; draw(); });
  }
  guardAdminPage(function () {
    Promise.all([db.collection('communities').get(), db.collection('creatorReports').get()]).then(function (r) {
      cms = r[0].docs.map(function (d) { var o = d.data(); o.id = d.id; return o; }).sort(function (a, b) { return (b.createdAt ? b.createdAt.toMillis() : 0) - (a.createdAt ? a.createdAt.toMillis() : 0); });
      reps = r[1].docs.map(function (d) { var o = d.data(); o.id = d.id; return o; }).sort(function (a, b) { return (b.createdAt ? b.createdAt.toMillis() : 0) - (a.createdAt ? a.createdAt.toMillis() : 0); });
      draw();
    }).catch(function () { root.innerHTML = '<div class="cx-empty">Could not load.</div>'; });
  });
})();
