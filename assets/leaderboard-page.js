// TradeZoro — leaderboard.html: the opt-in Paper trading leaderboard page (2026-10-14).
// Mounts window.PaperLeaderboard into #plb-root once auth has settled (guests still see the
// board: the leaderboards/* docs are public read). Demo account only.
(function () {
  'use strict';
  let api = null;
  function start(user) {
    const host = document.getElementById('plb-root');
    if (!host || !window.PaperLeaderboard) return;
    const uid = user ? user.uid : null;
    if (api) { api.setUid(uid); return; }
    host.textContent = '';
    api = window.PaperLeaderboard.mount(host, { uid });
  }
  function boot() {
    if (!(window.firebase && firebase.auth)) { setTimeout(boot, 150); return; }
    firebase.auth().onAuthStateChanged((u) => start(u));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
