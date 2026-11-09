// TradeZoro — JournalX "Broker sync (beta)" sheet (ES module, admin only, loaded on demand by assets/finatic-journal.js).
// READ ONLY: lists accounts and fills through /connect/finatic/data (server allow-list); no order buttons, no order code path.
// Flow: start session -> broker portal in a new tab (the member logs in there) -> Continue -> pick account + dates -> preview -> import.
// Depends on the journal page globals: auth, db, firebase, JOURNAL_UID, JOURNAL_TRADES, journalCollectionRef, reloadJournalData, showToast.
import { CSS } from './rithmic-journal-ui.js?v=931';
import { tripsFromBroker, tripToTrade, tripId, ordersToFetch, planImport } from './finatic-fills.js?v=931';

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const toast = (t, m) => { try { window.showToast(t, m); } catch (e) {} };
const money = (v) => { const c = (typeof JOURNAL_SETTINGS !== 'undefined' && JOURNAL_SETTINGS && JOURNAL_SETTINGS.currency) || 'USD'; try { return journalFormatCurrency(v, c); } catch (e) { return '$' + Number(v).toFixed(2); } };
const px = (v) => (Math.round(v * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });
const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const when = (ms) => { const d = new Date(ms); return ymd(d).slice(5) + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const X_ICON = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
const EXTRA_CSS = `.fjs-tag{ display:inline-block; margin-left:8px; padding:2px 8px; border-radius:999px; font:600 11px/16px var(--rz-font); background:rgba(245,197,66,.16); color:var(--rz-amber); vertical-align:middle; }
.fjs-badge{ display:inline-block; padding:4px 12px; border-radius:999px; font:700 13px/18px var(--rz-font); letter-spacing:.08em; }
.fjs-badge.sb{ background:rgba(245,197,66,.18); color:var(--rz-amber); border:1px solid rgba(245,197,66,.5); } .fjs-badge.lv{ background:rgba(255,107,107,.18); color:var(--rz-red); border:1px solid rgba(255,107,107,.6); }
.fjs-seg2{ display:grid; grid-template-columns:1fr 1fr; gap:4px; padding:4px; margin:0 0 16px; border-radius:12px; background:var(--rz-field); border:1px solid var(--rz-line); }
.fjs-seg2 button{ height:44px; border:0; border-radius:8px; background:transparent; color:var(--rz-ink-2); font:600 15px/20px var(--rz-font); cursor:pointer; }
.fjs-seg2 button[aria-checked="true"].buy{ background:var(--bull,#03c988); color:#050506; } .fjs-seg2 button[aria-checked="true"].sell{ background:var(--bear,#ff6b6b); color:#050506; }
.fjs-ord{ display:flex; align-items:center; justify-content:space-between; gap:8px; padding:10px 12px; border:1px solid var(--rz-line); border-radius:12px; margin:0 0 8px; font:400 13px/18px var(--rz-font); } .fjs-ord button{ height:40px; padding:0 14px; border:1px solid var(--rz-line); border-radius:10px; background:transparent; color:var(--rz-ink); font:600 13px/18px var(--rz-font); cursor:pointer; }
.fjs-confirm{ margin:0 0 16px; padding:14px; border:1px solid var(--rz-amber); border-radius:12px; font:600 16px/22px var(--rz-font); }
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
  const S = { step: 'start', userId: lsGet(), sessionId: '', accounts: [], account: null, from: ymd(new Date(Date.now() - 30 * 864e5)), to: ymd(new Date()), trips: [], open: [], need: [], pv: {}, raw: [], plan: null, sample: !!window.STRYKER_BROKER_SAMPLE, ord: { side: 'buy', type: 'market', qty: 1, symbol: '', limit: '', stop: '', tif: 'day' }, envMode: '', ordersOn: false, openOrders: [], recent: [] };
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
      S.accounts = (Array.isArray(a) ? a : []).map((x) => ({ id: x.accountId || x.id, name: x.accountName || x.name || x.nickname || x.brokerAccountId || x.accountId, broker: x.brokerName || x.brokerId || x.institutionName || '', cur: x.currencyCode || x.currency || '' })).filter((x) => x.id);
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
      '<button type="button" class="rjs-go" id="fjs-load">Load trades</button><button type="button" class="rjs-ghost" id="fjs-ordbtn">Order test (admin)</button><button type="button" class="rjs-ghost" id="fjs-off">Disconnect</button>';
    wireX();
    sheet.querySelectorAll('[data-acct]').forEach((b) => b.addEventListener('click', () => { S.account = S.accounts.find((a) => a.id === b.dataset.acct); S.from = q('#fjs-from').value; S.to = q('#fjs-to').value; drawPick(); }));
    q('#fjs-load').addEventListener('click', loadTrades);
    q('#fjs-off').addEventListener('click', disconnect);
    q('#fjs-ordbtn').addEventListener('click', () => { S.step = 'order'; draw(); });
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

  // ---- ORDER TEST (admin only; sandbox by default). The server enforces admin, env, qty cap, rate limit and audit; this is only the form.
  const orderCall = (b) => call('/connect/finatic/order', Object.assign({ userId: S.userId, accountId: S.account.id }, b));
  const badge = () => (S.envMode === 'live' ? '<span class="fjs-badge lv">LIVE</span>' : S.envMode === 'sandbox' ? '<span class="fjs-badge sb">SANDBOX</span>' : '');
  async function refreshOrders() {
    try {
      const o = await data('orders', { accountId: S.account.id, limit: 100 }); const arr = Array.isArray(o) ? o : [];
      S.openOrders = arr.filter((x) => /SUBMIT|PEND|OPEN|WORK|ACCEPT|NEW/i.test(x.status || '') && !/FILL|CANCEL|REJECT/i.test(x.status || '')).slice(0, 10);
      const filled = arr.filter((x) => /FILL/i.test(x.status || '')).slice(0, 5).map((x) => x.orderId);
      S.recent = filled.length ? (await data('fills', { accountId: S.account.id, orderIds: filled })).slice(0, 8) : [];
    } catch (e) { S.openOrders = []; S.recent = []; }
  }
  const sym = (o) => { const l = (o.legs || [])[0] || {}; return l.brokerProvidedSymbol || l.securityId || (l.instrument && l.instrument.displaySymbol) || ''; };
  function drawOrder(error, confirm) {
    const O = S.ord, off = !S.ordersOn;
    sheet.innerHTML = head('Order test (admin)') + '<p style="margin:0 0 12px">' + badge() + '</p>' + err(error) +
      (off ? '<div class="rjs-err" role="alert">' + (S.envMode === 'live' ? 'Live orders are off.' : 'Orders are not available.') + '</div>' : '') +
      '<p class="rjs-lead">Testing only. Orders go to a ' + (S.envMode === 'live' ? 'LIVE' : 'sandbox') + ' account, max 2 contracts, and every attempt is logged.</p>' +
      '<p class="rjs-sub">Account</p><div class="rjs-rows" role="radiogroup" aria-label="Account">' + S.accounts.map((a) => '<button type="button" class="rjs-row" role="radio" aria-checked="' + (a.id === S.account.id) + '" data-acct="' + esc(a.id) + '"><i></i><span><b>' + esc(a.name) + '</b><small>' + esc(a.broker) + '</small></span></button>').join('') + '</div>' +
      '<div class="fjs-seg2" role="radiogroup" aria-label="Side"><button type="button" class="buy" role="radio" aria-checked="' + (O.side === 'buy') + '" data-side="buy">Buy</button><button type="button" class="sell" role="radio" aria-checked="' + (O.side === 'sell') + '" data-side="sell">Sell</button></div>' +
      '<div class="rjs-two"><label class="rjs-f"><span>Symbol</span><input class="rjs-in" id="fo-sym" value="' + esc(O.symbol) + '" placeholder="MESZ6" autocapitalize="characters" autocomplete="off"></label><label class="rjs-f"><span>Quantity (max 2)</span><input class="rjs-in" id="fo-qty" inputmode="numeric" value="' + esc(O.qty) + '"></label></div>' +
      '<div class="rjs-two"><label class="rjs-f"><span>Type</span><select class="rjs-in" id="fo-type"><option value="market"' + (O.type === 'market' ? ' selected' : '') + '>Market</option><option value="limit"' + (O.type === 'limit' ? ' selected' : '') + '>Limit</option><option value="stop"' + (O.type === 'stop' ? ' selected' : '') + '>Stop</option></select></label>' +
      '<label class="rjs-f"><span>Time in force</span><select class="rjs-in" id="fo-tif"><option value="day"' + (O.tif === 'day' ? ' selected' : '') + '>Day</option><option value="gtc"' + (O.tif === 'gtc' ? ' selected' : '') + '>GTC</option></select></label></div>' +
      (O.type === 'limit' ? '<label class="rjs-f"><span>Limit price</span><input class="rjs-in" id="fo-lim" inputmode="decimal" value="' + esc(O.limit) + '"></label>' : '') + (O.type === 'stop' ? '<label class="rjs-f"><span>Stop price</span><input class="rjs-in" id="fo-stp" inputmode="decimal" value="' + esc(O.stop) + '"></label>' : '') +
      (confirm ? '<div class="fjs-confirm" id="fo-conf">Place ' + O.side.toUpperCase() + ' ' + esc(O.qty) + ' ' + esc(O.symbol.toUpperCase()) + ' ' + esc(O.type) + (O.type === 'limit' ? ' @ ' + esc(O.limit) : O.type === 'stop' ? ' @ ' + esc(O.stop) : '') + ' on ' + esc(S.account.name) + '?</div><button type="button" class="rjs-go" id="fo-yes">Yes, place order</button><button type="button" class="rjs-ghost" id="fo-no">Back</button>'
        : '<button type="button" class="rjs-go" id="fo-place"' + (off ? ' disabled' : '') + '>Review order</button>') +
      '<p class="rjs-sub" style="margin-top:20px">Open orders</p>' + (S.openOrders.length ? S.openOrders.map((o) => '<div class="fjs-ord"><span><b>' + esc(sym(o)) + '</b> ' + esc(o.status) + '<br><small>' + esc(String(o.orderId).slice(0, 8)) + '</small></span><button type="button" data-cancel="' + esc(o.orderId) + '">Cancel</button></div>').join('') : '<p class="rjs-hint">None.</p>') +
      '<p class="rjs-sub" style="margin-top:16px">Recent fills</p>' + (S.recent.length ? S.recent.map((f) => '<div class="fjs-ord"><span><b>' + esc(f.side) + ' ' + esc(f.quantity) + ' ' + esc((f.instrument && f.instrument.displaySymbol) || f.securityId || '') + '</b> @ ' + esc(f.price) + '</span></div>').join('') : '<p class="rjs-hint">None.</p>') +
      '<button type="button" class="rjs-ghost" id="fo-refresh">Refresh</button><button type="button" class="rjs-ghost" id="fo-back">Back</button>';
    wireX();
    const rd = () => { const g = (id) => { const e = q(id); return e ? e.value : ''; }; O.symbol = g('#fo-sym'); O.qty = g('#fo-qty'); O.type = g('#fo-type') || O.type; O.tif = g('#fo-tif') || O.tif; if (q('#fo-lim')) O.limit = g('#fo-lim'); if (q('#fo-stp')) O.stop = g('#fo-stp'); };
    sheet.querySelectorAll('[data-acct]').forEach((b) => b.addEventListener('click', async () => { rd(); S.account = S.accounts.find((a) => a.id === b.dataset.acct); await refreshOrders(); drawOrder(); }));
    sheet.querySelectorAll('[data-side]').forEach((b) => b.addEventListener('click', () => { rd(); O.side = b.dataset.side; drawOrder(); }));
    q('#fo-type').addEventListener('change', () => { rd(); drawOrder(); });
    q('#fo-back').addEventListener('click', () => { S.step = 'pick'; draw(); });
    q('#fo-refresh').addEventListener('click', async (e) => { rd(); busy(e.currentTarget, 'Refreshing'); await refreshOrders(); drawOrder(); });
    sheet.querySelectorAll('[data-cancel]').forEach((b) => b.addEventListener('click', async () => { busy(b, '...'); try { await orderCall({ op: 'cancel', orderId: b.dataset.cancel }); toast('success', 'Cancel sent.'); await refreshOrders(); drawOrder(); } catch (e) { drawOrder(e.message); } }));
    const pl = q('#fo-place'); if (pl) pl.addEventListener('click', () => { rd(); const n = Number(O.qty); if (!/^[A-Za-z0-9._-]{1,20}$/.test(O.symbol)) return drawOrder('Enter a symbol.'); if (!Number.isInteger(n) || n < 1 || n > 2) return drawOrder('Quantity must be 1 or 2.'); if (O.type === 'limit' && !(Number(O.limit) > 0)) return drawOrder('Enter a limit price.'); if (O.type === 'stop' && !(Number(O.stop) > 0)) return drawOrder('Enter a stop price.'); drawOrder('', true); });
    const no = q('#fo-no'); if (no) no.addEventListener('click', () => drawOrder());
    const yes = q('#fo-yes'); if (yes) yes.addEventListener('click', async () => {
      busy(yes, 'Placing');
      try { const r = await orderCall({ op: 'place', symbol: O.symbol, side: O.side, qty: Number(O.qty), type: O.type, limitPrice: O.type === 'limit' ? O.limit : undefined, stopPrice: O.type === 'stop' ? O.stop : undefined, timeInForce: O.tif }); toast('success', 'Order accepted (' + (r.status || 'ok') + ').'); await refreshOrders(); drawOrder(); }
      catch (e) { drawOrder(e.message || 'Order failed.'); }
    });
  }
  async function openOrderStep() {
    sheet.innerHTML = head('Order test (admin)') + '<p class="rjs-lead">Checking…</p>'; wireX();
    try { const r = await orderCall({ op: 'env' }); S.envMode = r.env; S.ordersOn = !!r.enabled; } catch (e) { S.envMode = ''; S.ordersOn = false; }
    await refreshOrders(); drawOrder();
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
  function draw() { sheet.classList.toggle('rjs-wide', S.step === 'preview'); if (S.step === 'start') drawStart(); else if (S.step === 'wait') drawWait(); else if (S.step === 'pick') drawPick(); else if (S.step === 'preview') drawPreview(); else if (S.step === 'order') openOrderStep(); else drawDone(); sheet.scrollTop = 0; }

  // Probe first: "Not set up yet" when the server key is missing.
  fetch('/connect/finatic/session?probe=1', { cache: 'no-store' }).then((r) => r.json().catch(() => ({}))).then((j) => { if (!(j && j.configured)) return drawNotSetUp(); draw(); if (S.userId) loadAccounts(); }).catch(() => drawNotSetUp());
  sheet.innerHTML = head('Broker sync') + '<p class="rjs-lead">Checking…</p>'; wireX();
}
