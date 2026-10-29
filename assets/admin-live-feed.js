// TradeZoro — Admin: per-member "Live chart data" (Owner 2026-10-26: "Add option to allow live data feed for the
// chart to users. I can select which users get live feed").
// Depends on: assets/auth.js (auth), assets/progress.js (db), assets/admin-guard.js (guardAdminPage),
// assets/toast.js (showToast), assets/activity-log.js (logActivity, optional), assets/sanitize.js (stkEsc).
//
// The flag is students/{uid}.liveFeed (bool) with liveFeedBy (admin uid) and liveFeedAt (server time) next to it.
// Only an admin can write those keys (functions-src/firestore.rules privilegedKeys). The chart server
// (functions/api/chart/_rt.js, workers/book-recorder/src/rt-auth.js) gives real-time CME futures to admins, the demo
// account and liveFeed === true members; everyone else stays 10 min delayed. Switching off bites within ~1 min.
//
// 1. window.strykerSetLiveFeed(uid, on, name) -> Promise: the one write, used by the Users page switch
//    (assets/students-admin.js) and the dashboard panel below.
// 2. Dashboard panel (dashboard-admin.html #live-feed-panel): "Live data: N users", each live member with a switch
//    to turn them off, and a search box to find any member by name or email and switch them on (confirm first).
//    Bounded reads: where('liveFeed','==',true) for the list; the search reads the student list once, on first use.
(function () {
  function setLiveFeed(uid, on, name) {
    const me = auth.currentUser;
    return db.collection('students').doc(uid).set({
      liveFeed: !!on,
      liveFeedGrandfathered: false,   // an admin's own switch is unconditional (clears the early-Pro "kept" flag)
      liveFeedBy: me ? me.uid : null,
      liveFeedAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true }).then(() => {
      if (typeof logActivity === 'function') logActivity(on ? 'student.livefeed_on' : 'student.livefeed_off',
        (on ? 'Gave live chart data to ' : 'Removed live chart data from ') + (name || uid), { targetUid: uid, targetName: name || '' });
    });
  }
  window.strykerSetLiveFeed = setLiveFeed;

  const esc = (v) => (typeof stkEsc === 'function' ? stkEsc(v) : String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const nameOf = (s) => s.displayName || s.name || (s.email ? s.email.split('@')[0] : 'Unnamed');
  const toast = (k, m) => { if (typeof showToast === 'function') showToast(k, m); };

  function rowHtml(s) {
    const on = s.liveFeed === true;
    return '<div class="live-feed-item" data-uid="' + esc(s.uid) + '">' +
      '<div class="live-feed-who"><span class="cell-name">' + esc(nameOf(s)) + '</span><span class="cell-sub">' + esc(s.email || '—') + '</span></div>' +
      '<span class="live-feed-saved" aria-live="polite"></span>' +
      '<label class="live-feed-switch" title="Live chart data"><input type="checkbox" role="switch" aria-label="Live chart data for ' + esc(nameOf(s)) + '"' + (on ? ' checked' : '') + '>' +
        '<span class="live-feed-track" aria-hidden="true"></span><span class="live-feed-label">Live chart data</span></label>' +
    '</div>';
  }

  function wire(root, rows, after) {
    root.querySelectorAll('.live-feed-item').forEach((el) => {
      const s = rows.find((x) => x.uid === el.getAttribute('data-uid'));
      const box = el.querySelector('input');
      const saved = el.querySelector('.live-feed-saved');
      box.addEventListener('change', () => {
        const want = box.checked;
        if (want && !confirm('Give ' + nameOf(s) + ' live chart data?')) { box.checked = false; return; }
        box.disabled = true; saved.className = 'live-feed-saved'; saved.textContent = 'Saving…';
        setLiveFeed(s.uid, want, nameOf(s)).then(() => {
          s.liveFeed = want; box.disabled = false;
          saved.className = 'live-feed-saved is-ok'; saved.textContent = '✓ Saved';
          setTimeout(() => { if (saved.textContent === '✓ Saved') saved.textContent = ''; }, 2500);
          if (after) after(s, want);
        }).catch((err) => {
          box.checked = !want; box.disabled = false;
          saved.className = 'live-feed-saved is-err'; saved.textContent = 'Not saved';
          toast('error', 'Could not change live chart data: ' + (err.message || err));
        });
      });
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    const panel = document.getElementById('live-feed-panel');
    if (!panel || typeof guardAdminPage !== 'function') return;
    const listEl = panel.querySelector('#live-feed-list');
    const countEl = panel.querySelector('#live-feed-count');
    const input = panel.querySelector('#live-feed-search');
    const resEl = panel.querySelector('#live-feed-results');
    let live = [], all = null, allP = null;

    function paintLive() {
      countEl.textContent = 'Live data: ' + live.length + ' user' + (live.length === 1 ? '' : 's');
      if (!live.length) { listEl.innerHTML = '<p class="live-feed-empty">Nobody has live chart data yet (admins always do). Find a member below to switch it on.</p>'; return; }
      listEl.innerHTML = live.map(rowHtml).join('');
      wire(listEl, live, (s, on) => { if (!on) setTimeout(() => { live = live.filter((x) => x.uid !== s.uid); paintLive(); }, 900); });
    }
    function loadLive() {
      return db.collection('students').where('liveFeed', '==', true).get().then((snap) => {
        live = []; snap.forEach((d) => live.push(Object.assign({ uid: d.id }, d.data())));
        live.sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
        paintLive();
      }).catch((err) => { listEl.innerHTML = '<p class="live-feed-empty">Could not load: ' + esc(err.message || err) + '</p>'; });
    }
    function search() {
      const q = (input.value || '').trim().toLowerCase();
      if (q.length < 2) { resEl.innerHTML = ''; return; }
      if (!all) {
        resEl.innerHTML = '<p class="live-feed-empty">Loading members…</p>';
        if (!allP) allP = db.collection('students').get().then((snap) => { all = []; snap.forEach((d) => all.push(Object.assign({ uid: d.id }, d.data()))); }).catch((err) => { allP = null; resEl.innerHTML = '<p class="live-feed-empty">Could not load members: ' + esc(err.message || err) + '</p>'; });
        allP.then(() => { if (all) search(); });
        return;
      }
      const hits = all.filter((s) => (nameOf(s) + ' ' + (s.email || '')).toLowerCase().includes(q)).slice(0, 8);
      resEl.innerHTML = hits.length ? hits.map(rowHtml).join('') : '<p class="live-feed-empty">No member matches “' + esc(q) + '”.</p>';
      wire(resEl, hits, (s, on) => {
        const i = live.findIndex((x) => x.uid === s.uid);
        if (on && i < 0) live.push(s); if (!on && i >= 0) live.splice(i, 1);
        live.sort((a, b) => nameOf(a).localeCompare(nameOf(b))); paintLive();
      });
    }
    let tm = null;
    input.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(search, 200); });
    guardAdminPage(() => { loadLive(); });
  });
})();
