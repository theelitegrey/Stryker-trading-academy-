/**
 * TradeZoro — PAPER TRADING LEADERBOARD (client, classic script: window.PaperLeaderboard)
 *
 * Owner order 2026-10-14: "Paper trading leaderboard + trade review", step B. Opt-in, privacy
 * first, demo money only.
 *
 *  - window.PaperLeaderboardCard({ uid }) -> the opt-in card the Trade review shows under its
 *    header (Charts panel tab + /paper-review). OFF by default. The member types a display name
 *    (2-24 letters, digits, space . _ ' -; no email) and joins; "Leave" sets optIn false and the
 *    next run (<= 15 min) removes the row. The member writes ONLY
 *    students/{uid}/paperTrading/public { optIn, displayName, updatedAt } (rules-validated);
 *    it never writes a rank or a score.
 *  - window.PaperLeaderboard.mount(el, { uid }) -> the /leaderboard page: this week / this month
 *    / all time, top 50 + "your rank", trades, win rate, max drawdown, a leverage flag. Reads
 *    leaderboards/paper-<period> (public read, written only by the scheduled function
 *    functions-src/paperLeaderboard.js). "Your row" is found by sha256(uid) first 16 hex chars,
 *    the same one-way key the function writes; the uid itself is never published.
 *
 * Every view carries: "Demo account. Simulated results, not real trading. Education only. Not
 * financial advice." Leaderboard numbers are never for marketing (results need the Owner's
 * signature).
 *
 * Depends on: firebase compat (auth + firestore), assets/paper-review-stats.js (rules, constants),
 * assets/toast.js (optional).
 */
(function () {
  'use strict';
  const S = window.PaperReviewStats || {};
  const DISCLAIMER = S.DISCLAIMER || 'Demo account. Simulated results, not real trading. Education only. Not financial advice.';
  const MIN_TRADES = S.MIN_TRADES || 10;
  const NAME_RE = /^[A-Za-z0-9 ._'-]{2,24}$/;            // same as the rules (functions-src/firestore.rules)
  const PERIODS = [['week', 'This week'], ['month', 'This month'], ['all', 'All time']];

  function h(tag, attrs, kids) {
    const el = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'text') el.textContent = v;
      else if (k === 'class') el.className = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    (kids || []).forEach((c) => { if (c == null) return; el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }
  function toast(msg, type) { try { if (typeof window.showToast === 'function') window.showToast(type || 'info', msg); } catch (e) {} }   // assets/toast.js: showToast(type, message)
  function db() { return window.firebase && firebase.firestore ? firebase.firestore() : null; }
  function profileRef(uid) { return db().collection('students').doc(uid).collection('paperTrading').doc('public'); }
  function boardRef(period) { return db().collection('leaderboards').doc('paper-' + period); }
  const cleanName = (n) => String(n || '').replace(/\s+/g, ' ').trim();
  const validName = (n) => NAME_RE.test(cleanName(n));

  async function keyOf(uid) {
    if (!uid || !(window.crypto && crypto.subtle)) return null;
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(uid)));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
  }
  const pct = (v, plus) => (v == null || !isFinite(v)) ? '—' : ((plus && v > 0 ? '+' : '') + Number(v).toFixed(2) + '%');
  const wr = (v) => (v == null || !isFinite(v)) ? '—' : Math.round(v) + '%';

  // ------------------------------------------------------------------ opt-in card
  function Card(opts) {
    const uid = opts && opts.uid;
    const box = h('section', { class: 'plb-card', 'aria-label': 'Paper leaderboard' });
    if (!uid) {
      box.appendChild(h('p', { class: 'plb-card-t', text: 'Paper leaderboard' }));
      box.appendChild(h('p', { class: 'plb-card-s', text: 'Sign in to join the opt-in paper leaderboard.' }));
      return box;
    }
    let prof = null, busy = false, editing = false;
    function paint() {
      box.textContent = '';
      const on = !!(prof && prof.optIn);
      box.appendChild(h('div', { class: 'plb-card-h' }, [
        h('p', { class: 'plb-card-t' }, ['Paper leaderboard ', h('span', { class: 'plb-pill' + (on ? ' on' : ''), text: on ? 'Joined' : 'Off' })]),
        h('a', { class: 'plb-link', href: 'leaderboard', text: 'View leaderboard →' })
      ]));
      if (on && !editing) {
        box.appendChild(h('p', { class: 'plb-card-s' }, ['Shown as ', h('b', { text: prof.displayName }), '. Ranked by % return on your current demo run; ' + MIN_TRADES + ' closed trades in a period to rank. Updates every 15 minutes.']));
        box.appendChild(h('div', { class: 'plb-row' }, [
          h('button', { type: 'button', class: 'pr-btn', disabled: busy, onclick: () => { editing = true; paint(); }, text: 'Change name' }),
          h('button', { type: 'button', class: 'pr-btn plb-leave', disabled: busy, onclick: leave, text: 'Leave leaderboard' })
        ]));
        return;
      }
      box.appendChild(h('p', { class: 'plb-card-s', text: 'Off by default. Join with a display name only (no email; no real name unless you type it). Only your % return, trade count, win rate and max drawdown are shown. Leave any time and your row is removed.' }));
      const inp = h('input', { type: 'text', class: 'plb-in', maxlength: '24', placeholder: 'Display name', 'aria-label': 'Display name', value: (prof && prof.displayName) || '', autocomplete: 'off', spellcheck: 'false' });
      const err = h('p', { class: 'plb-err', role: 'alert' });
      const go = async () => {
        const n = cleanName(inp.value);
        if (!validName(n)) { err.textContent = '2-24 characters: letters, digits, spaces and . _ \' - only.'; inp.focus(); return; }
        err.textContent = '';
        await join(n);
      };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
      box.appendChild(h('div', { class: 'plb-row' }, [inp,
        h('button', { type: 'button', class: 'pr-btn pr-btn-pri', disabled: busy, onclick: go, text: on ? 'Save name' : 'Join leaderboard' }),
        editing ? h('button', { type: 'button', class: 'pr-btn', onclick: () => { editing = false; paint(); }, text: 'Cancel' }) : null]));
      box.appendChild(err);
    }
    async function write(data) {
      busy = true; paint();
      try {
        await profileRef(uid).set(Object.assign({}, data, { updatedAt: firebase.firestore.FieldValue.serverTimestamp() }));
        prof = { optIn: data.optIn, displayName: data.displayName };
        return true;
      } catch (e) { toast('Could not save. Try again.', 'error'); return false; }
      finally { busy = false; editing = false; paint(); }
    }
    async function join(name) { if (await write({ optIn: true, displayName: name })) toast('You joined the paper leaderboard as ' + name + '.', 'success'); }
    async function leave() {
      if (await write({ optIn: false, displayName: (prof && prof.displayName) || 'Member' })) toast('You left the leaderboard. Your row is removed at the next update.', 'success');
    }
    paint();
    try { profileRef(uid).get().then((d) => { prof = d && d.exists ? d.data() : null; paint(); }).catch(() => {}); } catch (e) {}
    return box;
  }

  // ------------------------------------------------------------------ the board
  function mount(el, opts) {
    const ui = { period: 'week', uid: (opts && opts.uid) || null, key: null, docs: {}, err: null };
    function when(ts) {
      const d = ts && ts.toDate ? ts.toDate() : null;
      return d ? d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : null;
    }
    function rowEl(r, me) {
      return h('tr', { class: me ? 'plb-me' : null }, [
        h('td', { class: 'plb-rk', text: String(r.rank) }),
        h('td', { class: 'plb-nm' }, [h('span', { text: r.name }), me ? h('span', { class: 'plb-you', text: 'You' }) : null,
          r.flagged ? h('span', { class: 'plb-flag', title: 'Very large position for the demo balance (over ' + (S.LEV_FLAG || 20) + 'x). Shown, but flagged.', text: 'High leverage' }) : null]),
        h('td', { class: 'num ' + (r.returnPct > 0 ? 'pos' : r.returnPct < 0 ? 'neg' : ''), text: pct(r.returnPct, true) }),
        h('td', { class: 'num', text: String(r.trades) }),
        h('td', { class: 'num', text: wr(r.winRate) }),
        h('td', { class: 'num neg', text: r.maxDDPct ? '-' + Number(Math.abs(r.maxDDPct)).toFixed(2) + '%' : '0.00%' })
      ]);
    }
    function render() {
      el.textContent = '';
      el.appendChild(h('div', { class: 'pr-head' }, [
        h('h1', { class: 'pr-title', text: 'Paper leaderboard' }),
        h('div', { class: 'pr-kind', role: 'tablist', 'aria-label': 'Period' }, PERIODS.map(([k, l]) =>
          h('button', { type: 'button', role: 'tab', 'aria-selected': String(ui.period === k), class: ui.period === k ? 'on' : null, 'data-period': k, onclick: () => { ui.period = k; render(); load(); }, text: l })))
      ]));
      el.appendChild(h('p', { class: 'pr-disc', role: 'note', text: DISCLAIMER }));
      el.appendChild(h('p', { class: 'plb-rules', text: 'Opt-in only. Ranked by % return on the starting demo balance of each member\'s current run (a reset starts a new run). ' + MIN_TRADES + ' closed trades in the period to rank. Bar-replay trades and trades held under 5 seconds never count. Updated every 15 minutes.' }));
      const doc = ui.docs[ui.period];
      if (ui.err) { el.appendChild(h('p', { class: 'pr-empty', text: ui.err })); return; }
      if (doc === undefined) { el.appendChild(h('p', { class: 'pr-empty', text: 'Loading…' })); return; }
      const rows = (doc && Array.isArray(doc.rows)) ? doc.rows : [];
      const mine = ui.key && doc && doc.ranks ? doc.ranks[ui.key] : null;
      // your rank
      const you = h('div', { class: 'plb-yours' });
      if (!ui.uid) you.appendChild(h('span', { text: 'Sign in and join from Trade review to get a rank.' }));
      else if (mine && mine.rank) {
        const r = rows.find((x) => x.key === ui.key);
        you.appendChild(h('span', {}, ['Your rank: ', h('b', { text: '#' + mine.rank }), ' of ' + (doc.ranked || rows.length) + (r ? '' : ' (outside the top 50)')]));
      } else if (mine && mine.need != null) you.appendChild(h('span', { text: 'Not ranked yet: ' + mine.trades + ' of ' + MIN_TRADES + ' closed trades this period (' + mine.need + ' to go).' }));
      else you.appendChild(h('span', {}, ['Not on the board. ', h('a', { href: 'paper-review', text: 'Join from Trade review' }), ' (updates within 15 minutes).']));
      el.appendChild(you);
      if (!rows.length) {
        el.appendChild(h('p', { class: 'pr-empty', text: doc ? 'Nobody is ranked for this period yet.' : 'The leaderboard has not been built yet. It updates every 15 minutes.' }));
      } else {
        const wrap = h('div', { class: 'pr-tw plb-tw' });
        wrap.appendChild(h('table', { class: 'pr-t plb-t' }, [
          h('thead', {}, [h('tr', {}, [h('th', { text: '#' }), h('th', { text: 'Member' }), h('th', { class: 'num', text: 'Return' }), h('th', { class: 'num', text: 'Trades' }), h('th', { class: 'num', text: 'Win rate' }), h('th', { class: 'num', text: 'Max DD' })])]),
          h('tbody', {}, rows.slice(0, 50).map((r) => rowEl(r, r.key === ui.key)))
        ]));
        el.appendChild(wrap);
      }
      const at = doc && when(doc.generatedAt);
      if (at) el.appendChild(h('p', { class: 'plb-at', text: 'Updated ' + at + '.' }));
    }
    async function load() {
      const p = ui.period;
      if (ui.docs[p] !== undefined) return;
      try {
        const d = await boardRef(p).get();
        ui.docs[p] = d.exists ? d.data() : null;
      } catch (e) { ui.err = 'Could not load the leaderboard. Try again later.'; }
      if (ui.period === p) render();
    }
    render();
    keyOf(ui.uid).then((k) => { ui.key = k; render(); });
    load();
    return { setUid(u) { ui.uid = u; ui.docs = {}; ui.err = null; keyOf(u).then((k) => { ui.key = k; render(); load(); }); } };
  }

  window.PaperLeaderboardCard = Card;
  window.PaperLeaderboard = { mount, Card, keyOf, validName, cleanName, NAME_RE };
})();
