// TradeZoro — paper-review.html: the full-page Trade review (Owner order 2026-10-14,
// "Paper trading leaderboard + trade review").
//
// Loads the member's own paper account the same way the Charts page does (assets/chart-paper.js
// load(): the Firestore doc students/{uid}/paperTrading/account { state, updatedAt } and the local
// copy localStorage 'stryker_paper_<uid>'; the newer state.savedAt wins) and mounts the shared
// component (assets/paper-review.js). Signed out: the browser's guest copy. The Replay account
// is localStorage 'stryker_paper_replay_<uid|guest>' only, as on the Charts page.
//
// Saving a note / tags: re-read the newest copy first (a Charts tab may have filled a trade
// meanwhile), apply the patch to that copy, then write it back to both places with a fresh
// savedAt and the ':rev' stamp, so an open Charts tab adopts it (its 'storage' listener /
// syncFromLocal) instead of overwriting it. Nothing else in the account is touched.
//
// Depends on: firebase compat + assets/auth.js, assets/paper-review-stats.js,
// assets/paper-review.js, assets/toast.js. No broker, no orders: read + own notes only.
// Demo account. Simulated results, not real trading. Education only. Not financial advice.
(function () {
  'use strict';
  const host = document.getElementById('pr-root');
  if (!host || !window.PaperReview) return;
  let uid = null, paper = null, api = null;

  const lsKey = () => 'stryker_paper_' + (uid || 'guest');
  const revKey = () => lsKey() + ':rev';
  const replayKey = () => 'stryker_paper_replay_' + (uid || 'guest');
  const parse = (s) => { try { return typeof s === 'string' ? JSON.parse(s) : s; } catch (e) { return null; } };
  function docRef() { return firebase.firestore().collection('students').doc(uid).collection('paperTrading').doc('account'); }

  async function loadPaper() {
    let c = null;
    if (uid) {
      try { const snap = await docRef().get(); c = snap && snap.exists ? parse((snap.data() || {}).state) : null; }
      catch (e) { console.warn('TradeZoro review: cloud load', e); }
    }
    let st = null; try { st = parse(localStorage.getItem(lsKey())); } catch (e) {}
    if (c && (!st || (Number(c.savedAt) || 0) >= (Number(st.savedAt) || 0))) st = c;
    return st && typeof st === 'object' ? st : null;
  }

  async function save(kind, tradeId, patch) {
    const PR = window.PaperReview;
    if (kind === 'replay') {
      const st = parse(localStorage.getItem(replayKey()));
      if (!st || !PR.applyPatch(st, tradeId, patch)) throw new Error('That trade is no longer in the Replay account.');
      localStorage.setItem(replayKey(), JSON.stringify(st));
      return;
    }
    const st = await loadPaper();
    if (!st || !PR.applyPatch(st, tradeId, patch)) throw new Error('That trade is no longer in your paper account.');
    st.savedAt = Date.now();
    const json = JSON.stringify(st);
    if (json.length > 400000) throw new Error('Your paper account is full (400,000 characters). Shorten a few notes and try again.');
    try { localStorage.setItem(lsKey(), json); localStorage.setItem(revKey(), 'review:' + st.savedAt + ':' + json.length); } catch (e) {}
    if (uid) await docRef().set({ state: json, updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
    paper = st;
  }

  function getState(kind) {
    if (kind === 'replay') return parse(localStorage.getItem(replayKey()));
    return paper;
  }

  async function start(user) {
    uid = user ? user.uid : null;
    paper = await loadPaper();
    if (api) api.destroy();
    host.textContent = '';
    api = window.PaperReview.mount(host, { compact: false, getState, save,
      leaderboard: window.PaperLeaderboardCard ? () => window.PaperLeaderboardCard({ uid }) : null });
    if (!uid) {
      const p = document.createElement('p');
      p.className = 'pr-note';
      p.textContent = 'You are signed out: this shows the paper account saved in this browser. Sign in to see the account saved to your profile.';
      host.insertBefore(p, host.firstChild.nextSibling);
    }
  }

  // a Charts tab in this browser saved (a trade closed): refresh
  window.addEventListener('storage', (e) => {
    if (!api || !e.key || (e.key !== lsKey() && e.key !== replayKey())) return;
    if (e.key === lsKey()) { const st = parse(e.newValue); if (st) paper = st; }
    api.update();
  });

  let started = false;
  try {
    firebase.auth().onAuthStateChanged((u) => { started = true; start(u); });
  } catch (e) { started = true; start(null); }
  setTimeout(() => { if (!started) { started = true; start(null); } }, 5000);
})();
