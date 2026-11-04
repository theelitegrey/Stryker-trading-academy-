// TradeZoro — JournalX "Broker sync (beta)" sheet (ES module, admin only, loaded on demand by assets/finatic-journal.js).
// READ ONLY: lists accounts and fills through /connect/finatic/data (server allow-list); no order buttons, no order code path.
// Flow: start session -> broker portal in a new tab (the member logs in there) -> Continue -> pick account + dates -> preview -> import.
// Depends on the journal page globals: auth, db, firebase, JOURNAL_UID, JOURNAL_TRADES, journalCollectionRef, reloadJournalData, showToast.
import { CSS } from './rithmic-journal-ui.js?v=863';
import { tripsFromBroker, tripToTrade, tripId, ordersToFetch, planImport } from './finatic-fills.js?v=863';

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const toast = (t, m) => { try { window.showToast(t, m); } catch (e) {} };
const money = (v) => { const c = (typeof JOURNAL_SETTINGS !== 'undefined' && JOURNAL_SETTINGS && JOURNAL_SETTINGS.currency) || 'USD'; try { return journalFormatCurrency(v, c); } catch (e) { return '$' + Number(v).toFixed(2); } };
const px = (v) => (Math.round(v * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });
const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const when = (ms) => { const d = new Date(ms); return ymd(d).slice(5) + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const X_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
const EXTRA_CSS = `.fjs-tag{ display:inline-block; margin-left:8px; padding:2px 8px; border-radius:999px; font:600 11px/16px var(--rz-font); background:rgba(245,197,66,.16); color:var(--rz-amber); vertical-align:middle; }
.fjs-sample{ margin:0 0 12px; font:600 12px/16px var(--rz-font); color:var(--rz-amber); letter-spacing:.04em; text-transform:uppercase; }`;

async function call(url, body, sample) {
  const t = await auth.currentUser.getIdToken();
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + t }, body: JSON.stringify(body || {}), cache: 'no-store' });
  let j = null; try { j = await r.json(); } catch (e) {}
  if (!r.ok) { const e = new Error((j && j.error) || 'Request failed'); e.status = r.status; e.needsConnect = !!(j && j.needsConnect); throw e; }
  return j || {};
}

export function openBrokerSync({ uid } = {}) {
  if (!document.getElementById('rjs-css')) { const s = document.createElement('style'); s.id = 'rjs-css'; s.textContent = CSS; document.head.appendChild(s); }
  if (!document.getElementById('fjs-css')) { const s = document.createElement('style'); s.id = 'fjs-css'; s.textContent = EXTRA_CSS; document.head.appendChild(s); }
  const LS = 'stryker_broker_sync_user_' + uid;
  const lsGet = () => { try { return localStorage.getItem(LS) || ''; } catch (e) { return ''; } };
  const lsSet = (v) => { try { v ? localStorage.setItem(LS, v) : localStorage.removeItem(LS); } catch (e) {} };

  const back = document.createElement('div'); back.className = 'rjs-back'; back.id = 'fjs-back';
  const sheet = document.createElement('div'); sheet.className = 'rjs'; sheet.id = 'fjs'; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-modal', 'true'); sheet.setAttribute('aria-label', 'Broker sync (beta)');
  back.appendChild(sheet); document.body.appendChild(back);
  const prevFocus = document.activeElement;
  const S = { step: 'start', userId: lsGet(), sessionId: '', accounts: [], account: null, from: ymd(new Date(Date.now() - 30 * 864e5)), to: ymd(new Date()), trips: [], open: [], need: [], pv: {}, raw: [], plan: null, sample: !!window.STRYKER_BROKER_SAMPLE };
  window.STRYKER_BROKER_SYNC = { get step() { return S.step; } };
  function close() { back.remove(); document.removeEventListener('keydown', onKey, true); delete window.STRYKER_BROKER_SYNC; try { prevFocus && prevFocus.focus(); } catch (e) {} }
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  const head = (title) => '<div class="rjs-grab"></div><div class="rjs-head"><h2>' + esc(title) + '<span class="fjs-tag">Admin beta</span></h2><button type="button" class="rjs-x" id="fjs-x" aria-label="Close">' + X_ICON + '</button></div>' + (S.sample ? '<p class="fjs-sample">Sample data</p>' : '');
  const err = (m) => (m ? '<div class="rjs-err" role="alert">' + esc(m) + '</div>' : '');
  const wireX = () => { const x = sheet.querySelector('#fjs-x'); if (x) x.addEventListener('click', close); };
  const q = (s) => sheet.querySelector(s);
  const busy = (btn, label) => { btn.disabled = true; btn.innerHTML = '<span class="rjs-spin"></span>' + esc(label); };
  const userBody = () => (S.userId ? { userId: S.userId } : { sessionId: S.sessionId });
  const data = async (op, extra) => { const r = await call('/connect/finatic/data', Object.assign({ op }, userBody(), extra)); if (r.userId && r.userId !== S.userId) { S.userId = r.userId; lsSet(r.userId); } return r.data; };

  // ---- not set up
  function drawNotSetUp() {
    sheet.innerHTML = head('Broker sync') + '<p class="rjs-lead">Not set up yet. The broker connection key has not been added to the site, so nothing can connect. Admin note: add FINATIC_API_KEY to the Pages secrets (see the handback notes), then redeploy.</p><button type="button" class="rjs-ghost" id="fjs-close">Close</button>';
    wireX(); q('#fjs-close').addEventListener('click', close);
  }
  // ---- start: connect a broker
  function drawStart(error) {
    sheet.innerHTML = head('Broker sync') + err(error) +
      '<p class="rjs-lead">Pull your fills from a connected broker (for example Tradovate, NinjaTrader, Rithmic) into the journal. Data only: we read accounts and fills and never place or change an order.</p>' +
      '<button type="button" class="rjs-go" id="fjs-connect">Connect a broker</button>' +
      (S.userId ? '<button type="button" class="rjs-ghost" id="fjs-have">I already connected</button>' : '') +
      '<p class="rjs-fine">You sign in at your broker in a new tab. Your broker password is never typed into TradeZoro.</p>';
    wireX();
    q('#fjs-connect').addEventListener('click', async (e) => {
      const btn = e.currentTarget; busy(btn, 'Opening');
      const win = window.open('', '_blank');           // opened on the tap so pop-up blockers allow it
      try {
        const r = await call('/connect/finatic/session', { mode: 'dark' });
        S.sessionId = r.sessionId || '';
        if (win && r.portalUrl) { win.opener = null; win.location.href = r.portalUrl; } else if (r.portalUrl) { location.href = r.portalUrl; return; }
        S.step = 'wait'; draw();
      } catch (e2) { if (win) win.close(); drawStart(e2.status === 503 ? '' : (e2.message || 'Could not start.')); if (e2.status === 503) drawNotSetUp(); }
    });
    const have = q('#fjs-have'); if (have) have.addEventListener('click', loadAccounts);
  }
  function drawWait(error) {
    sheet.innerHTML = head('Finish connecting') + err(error) +
      '<p class="rjs-lead">Choose your broker in the new tab and sign in. When it says you are connected, come back here and tap Continue.</p>' +
      '<button type="button" class="rjs-go" id="fjs-cont">Continue</button><button type="button" class="rjs-ghost" id="fjs-again">Open the broker tab again</button>';
    wireX(); q('#fjs-cont').addEventListener('click', loadAccounts); q('#fjs-again').addEventListener('click', () => { S.step = 'start'; draw(); });
  }
  async function loadAccounts() {
    const b = q('#fjs-cont') || q('#fjs-have'); if (b) busy(b, 'Loading accounts');
    try {
      const a = await data('accounts');
      S.accounts = (Array.isArray(a) ? a : []).map((x) => ({ id: x.accountId || x.id, name: x.accountName || x.name || x.nickname || x.brokerAccountId || x.accountId, broker: x.brokerName || x.brokerId || x.institutionName || '', cur: x.currency || '' })).filter((x) => x.id);
      if (!S.accounts.length) { S.step = 'wait'; return drawWait('No connected accounts yet. Finish connecting in the broker tab, then tap Continue.'); }
      S.account = S.accounts[0]; S.step = 'pick'; draw();
    } catch (e) { if (e.needsConnect) { S.userId = ''; lsSet(''); S.step = 'start'; return drawStart(S.sessionId ? 'Not connected yet. Finish in the broker tab first.' : ''); } if (e.status === 503) return drawNotSetUp(); S.step = S.step === 'start' ? 'start' : 'wait'; (S.step === 'start' ? drawStart : drawWait)(e.message); }
  }
  // ---- pick account + dates
  function drawPick(error) {
    sheet.innerHTML = head('Choose what to sync') + err(error) +
      '<p class="rjs-sub">Account</p><div class="rjs-rows" role="radiogroup" aria-label="Account">' + S.accounts.map((a) =>
        '<button type="button" class="rjs-row" role="radio" aria-checked="' + (a.id === S.account.id) + '" data-acct="' + esc(a.id) + '"><i></i><span><b>' + esc(a.name) + '</b><small>' + esc(a.broker) + (a.cur ? ' · ' + esc(a.cur) : '') + '</small></span></button>').join('') + '</div>' +
      '<div class="rjs-two"><label class="rjs-f"><span>From</span><input class="rjs-in" type="date" id="fjs-from" value="' + esc(S.from) + '"></label><label class="rjs-f"><span>To</span><input class="rjs-in" type="date" id="fjs-to" value="' + esc(S.to) + '"></label></div>' +
      '<button type="button" class="rjs-go" id="fjs-load">Load trades</button><button type="button" class="rjs-ghost" id="fjs-off">Disconnect</button>';
    wireX();
    sheet.querySelectorAll('[data-acct]').forEach((b) => b.addEventListener('click', () => { S.account = S.accounts.find((a) => a.id === b.dataset.acct); S.from = q('#fjs-from').value; S.to = q('#fjs-to').value; drawPick(); }));
    q('#fjs-load').addEventListener('click', loadTrades);
    q('#fjs-off').addEventListener('click', disconnect);
  }
  async function loadTrades() {
    S.from = q('#fjs-from').value; S.to = q('#fjs-to').value;
    const f = Date.parse(S.from + 'T00:00:00'), t = Date.parse(S.to + 'T23:59:59');
    if (!isFinite(f) || !isFinite(t) || f > t) return drawPick('Pick a valid date range.');
    busy(q('#fjs-load'), 'Reading fills');
    try {
      let orders = [];
      for (let off = 0; off < 5000; off += 1000) { const page = await data('orders', { accountId: S.account.id, limit: 1000, offset: off }); const arr = Array.isArray(page) ? page : []; orders = orders.concat(arr); if (arr.length < 1000) break; }
      const ids = ordersToFetch(orders, f - 864e5, t + 864e5);
      let raw = [];
      for (let i = 0; i < ids.length; i += 25) raw = raw.concat(await data('fills', { accountId: S.account.id, orderIds: ids.slice(i, i + 25) }));
      S.raw = raw.filter((x) => { const m = Date.parse(x.executedAt); return isFinite(m) && m >= f - 864e5 && m <= t + 864e5; });   // a day of slack so a trade opened before the range still closes
      rebuild(); S.step = 'preview'; draw();
    } catch (e) { if (e.needsConnect) { S.userId = ''; lsSet(''); S.step = 'start'; return drawStart('Connection lost. Connect again.'); } drawPick(e.message || 'Could not read fills.'); }
  }
  function rebuild() {
    const r = tripsFromBroker(S.raw, S.account.id, S.pv);
    const f = Date.parse(S.from + 'T00:00:00'), t = Date.parse(S.to + 'T23:59:59');
    S.trips = r.trips.filter((x) => x.closedAt >= f && x.closedAt <= t); S.open = r.open; S.need = r.needsPointValue;
  }
  // ---- preview + import
  const existingKeys = () => new Set((typeof JOURNAL_TRADES !== 'undefined' ? JOURNAL_TRADES : []).map((t) => t.syncKey).filter(Boolean));
  function drawPreview() {
    const priced = S.trips.filter((t) => t.netPnl != null);
    const plan = planImport(priced, { existingKeys: existingKeys() }); S.plan = plan;
    const total = priced.reduce((a, t) => a + t.netPnl, 0), wins = priced.filter((t) => t.netPnl > 0).length;
    const cls = (v) => (v > 0 ? 'rjs-up' : v < 0 ? 'rjs-down' : '');
    const rows = priced.map((t) => '<tr><td>' + when(t.openedAt) + '</td><td><b>' + esc(t.symbol) + '</b></td><td>' + (t.direction === 'short' ? 'Short' : 'Long') + '</td><td class="r">' + t.quantity + '</td><td class="r">' + px(t.avgEntry) + '</td><td class="r">' + px(t.avgExit) + '</td><td class="r">' + (t.fees == null ? '—' : money(t.fees)) + '</td><td class="r ' + cls(t.netPnl) + '">' + money(t.netPnl) + '</td><td>' + (plan.dupes.includes(t) ? 'Already in journal' : 'New') + '</td></tr>').join('');
    const cards = priced.map((t) => '<div class="rjs-card"><div class="t"><span>' + esc(t.symbol) + ' · ' + (t.direction === 'short' ? 'Short' : 'Long') + ' ' + t.quantity + '</span><span class="' + cls(t.netPnl) + '">' + money(t.netPnl) + '</span></div><div class="m"><span>In ' + px(t.avgEntry) + ' → out ' + px(t.avgExit) + '</span><span>' + when(t.openedAt) + (plan.dupes.includes(t) ? ' · already in journal' : '') + '</span></div></div>').join('');
    sheet.innerHTML = head('Review trades') +
      (S.need.length ? '<div class="rjs-cap"><b>Point value needed.</b> No dollar value per point on file for ' + S.need.map(esc).join(', ') + '. Enter it once to price those trades.' + S.need.map((r) => '<div class="rjs-pv"><span style="min-width:56px"><b>' + esc(r) + '</b></span><input class="rjs-in" inputmode="decimal" data-pv="' + esc(r) + '" placeholder="$ per point" aria-label="Dollars per point for ' + esc(r) + '"><button type="button" class="rjs-ghost" style="width:auto;margin:0" data-setpv="' + esc(r) + '">Use</button></div>').join('') + '</div>' : '') +
      (priced.length ? '<div class="rjs-sum"><div><b>' + priced.length + '</b><span>Trades</span></div><div><b class="' + cls(total) + '">' + money(total) + '</b><span>Net P&amp;L</span></div><div><b>' + Math.round(wins / priced.length * 100) + '%</b><span>Winners</span></div></div>' +
        '<div class="rjs-tablewrap"><table class="rjs-table"><thead><tr><th>Opened</th><th>Symbol</th><th>Side</th><th class="r">Qty</th><th class="r">Entry</th><th class="r">Exit</th><th class="r">Fees</th><th class="r">Net P&amp;L</th><th>Status</th></tr></thead><tbody>' + rows + '</tbody></table></div><div class="rjs-cards">' + cards + '</div>'
        : '<p class="rjs-lead">No closed trades found for ' + esc(S.account.name) + ' between ' + esc(S.from) + ' and ' + esc(S.to) + '.</p>') +
      (S.open.length ? '<p class="rjs-hint">Still open, not imported: ' + S.open.map((o) => esc(o.symbol) + ' ' + o.side + ' ' + o.qty).join(', ') + '.</p>' : '') +
      (plan.dupes.length ? '<p class="rjs-hint">' + plan.dupes.length + ' already in your journal. They will not be added again.</p>' : '') +
      '<p class="rjs-hint">Gross P&amp;L = points × the contract’s dollar value per point. Fees are included where the broker sent them. Education only. Not financial advice.</p><div style="height:16px"></div>' +
      '<button type="button" class="rjs-go" id="fjs-import"' + (plan.take.length ? '' : ' disabled') + '>' + (plan.take.length ? 'Import ' + plan.take.length + ' trade' + (plan.take.length === 1 ? '' : 's') : 'Nothing new to import') + '</button>' +
      '<button type="button" class="rjs-ghost" id="fjs-again2">Sync again</button><button type="button" class="rjs-ghost" id="fjs-back2">Back</button>';
    wireX();
    sheet.querySelectorAll('[data-setpv]').forEach((b) => b.addEventListener('click', () => { const r = b.dataset.setpv, v = Number(String(q('[data-pv="' + r + '"]').value).replace(/[$,\s]/g, '')); if (!(v > 0)) return toast('error', 'Enter a dollar value per point greater than 0.'); S.pv[r] = v; rebuild(); drawPreview(); }));
    q('#fjs-back2').addEventListener('click', () => { S.step = 'pick'; draw(); });
    q('#fjs-again2').addEventListener('click', async (e) => { busy(e.currentTarget, 'Syncing'); S.step = 'pick'; draw(); await loadTrades(); });
    const imp = q('#fjs-import'); if (imp) imp.addEventListener('click', () => runImport(plan.take));
  }
  async function runImport(trips) {
    const btn = q('#fjs-import'); busy(btn, 'Importing');
    try {
      const col = journalCollectionRef(JOURNAL_UID);
      const snaps = await Promise.all(trips.map((t) => col.doc(tripId(t)).get()));   // never overwrite a trade that exists (notes may have been added)
      const todo = trips.filter((t, i) => !snaps[i].exists);
      for (let i = 0; i < todo.length; i += 350) {
        const batch = db.batch();
        todo.slice(i, i + 350).forEach((t) => batch.set(col.doc(tripId(t)), Object.assign(tripToTrade(t, { label: S.account.name }), { createdAt: firebase.firestore.FieldValue.serverTimestamp(), updatedAt: firebase.firestore.FieldValue.serverTimestamp() })));
        await batch.commit();
      }
      if (todo.length) { const upd = { journalEntryCount: firebase.firestore.FieldValue.increment(todo.length) }; if (todo.some((t) => t.netPnl > 0)) upd.hasWinningTrade = true; await db.collection('students').doc(JOURNAL_UID).set(upd, { merge: true }).catch(() => {}); }
      S.added = todo.length; toast('success', 'Imported ' + todo.length + ' trade' + (todo.length === 1 ? '' : 's') + '.');
      try { await reloadJournalData(); } catch (e) {}
      S.step = 'done'; draw();
    } catch (e) { console.error('TradeZoro: broker sync import failed', e); btn.disabled = false; btn.textContent = 'Import ' + trips.length + ' trades'; toast('error', 'Import failed: ' + (e && e.message || e)); }
  }
  async function disconnect() {
    busy(q('#fjs-off'), 'Disconnecting');
    try {
      const gs = await data('grants');
      for (const g of (Array.isArray(gs) ? gs : [])) if (g && g.id && !g.revokedAt) await call('/connect/finatic/data', Object.assign({ op: 'revoke', grantId: g.id }, userBody()));
      S.userId = ''; lsSet(''); S.accounts = []; S.step = 'start'; toast('success', 'Disconnected.'); draw();
    } catch (e) { drawPick(e.message || 'Could not disconnect.'); }
  }
  function drawDone() {
    sheet.innerHTML = head('Done') + '<div class="rjs-done"><b>' + (S.added || 0) + ' trade' + (S.added === 1 ? '' : 's') + ' added</b><p>Tagged “Broker sync”. Syncing the same days again adds nothing twice.</p></div><button type="button" class="rjs-go" id="fjs-fin">Done</button>';
    wireX(); q('#fjs-fin').addEventListener('click', close);
  }
  function draw() { sheet.classList.toggle('rjs-wide', S.step === 'preview'); if (S.step === 'start') drawStart(); else if (S.step === 'wait') drawWait(); else if (S.step === 'pick') drawPick(); else if (S.step === 'preview') drawPreview(); else drawDone(); sheet.scrollTop = 0; }

  // Probe first: "Not set up yet" when the server key is missing.
  fetch('/connect/finatic/session?probe=1', { cache: 'no-store' }).then((r) => r.json().catch(() => ({}))).then((j) => { if (!(j && j.configured)) return drawNotSetUp(); draw(); if (S.userId) loadAccounts(); }).catch(() => drawNotSetUp());
  sheet.innerHTML = head('Broker sync') + '<p class="rjs-lead">Checking…</p>'; wireX();
}
