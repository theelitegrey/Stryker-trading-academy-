// TradeZoro — ZoroCharts: Rithmic order entry panel. ADMIN-ONLY, Rithmic Test / Rithmic Paper Trading ONLY (CoS 2026-11-09).
// Imported ONLY by assets/rithmic-config.js mountRithmicTradingIfAdmin() after admins/{uid} exists; members never download it.
// All order logic + every safety guard lives in assets/rithmic-trade-core.js (node-tested). This file is the panel, the
// confirm sheet, chart lines (layer from assets/rithmic-trade-layer.js) and the DOM ladder hook (assets/chart-book-panel.js).
// Separate login from the Charts data connection: its own order + PnL + ticker plants on a paper/test system.
// "PAPER / TEST" badge on the toolbar button, panel, confirm sheet and chart while trading is on.
// Settings (this browser): max contracts per order (1..5, default 1), Chart trading (DOM click + drag lines, default OFF).
// Education only. Not financial advice.
import { TradeSession, listSystemsT, liveTradingAllowed, ALLOW_PAPER_ON_PRODUCTION_HOSTS, rootOfSymbol, INSTRUMENTS, LIMITS, clampMaxQty, roundTick, PAPER_SYSTEMS, TEST_GATEWAY } from './rithmic-trade-core.js?v=929';
import { RT_LAYER } from './rithmic-trade-layer.js?v=929';

const PREF = 'stk.rtrade.prefs';
const S = { ws: null, opts: null, sess: null, acct: '', panel: null, sheet: null, pill: null, btn: null, msg: '', busy: false, systems: [], gw: '', live: false,
  prefs: { maxQty: 1, chart: false }, t: { side: 'buy', type: 'limit', qty: 1, price: '', trigger: '', tp: '', sl: '', contract: '' } };
try { Object.assign(S.prefs, JSON.parse(localStorage.getItem(PREF) || '{}')); } catch (e) {}
S.prefs.maxQty = clampMaxQty(S.prefs.maxQty); S.prefs.chart = S.prefs.chart === true;
const savePrefs = () => { try { localStorage.setItem(PREF, JSON.stringify(S.prefs)); } catch (e) {} };
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toast = (m, k) => { try { (S.opts && S.opts.toast) ? S.opts.toast(m, k) : window.showToast && window.showToast(k || 'success', m); } catch (e) {} };
const usd = (v, sign) => (v == null || !isFinite(v) ? '—' : (v < 0 ? '-$' : sign && v > 0 ? '+$' : '$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const pxs = (v) => (v == null || !isFinite(v) ? '—' : (+v).toLocaleString('en-US', { maximumFractionDigits: 4 }));
const IC_X = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
const BADGE = '<span class="stkrt-badge">Paper / Test</span>';
const DISCLAIMER = 'Paper and test accounts only. Education only. Not financial advice.';

// gateways the admin may pick: Rithmic Test, Rithmic Paper Trading (production host), local mock (localhost dev only)
function gateways() {
  const o = S.opts, out = [{ id: 'test', label: 'Rithmic Test', uri: TEST_GATEWAY }];
  if (o.prodPaperGateway && ALLOW_PAPER_ON_PRODUCTION_HOSTS) out.push({ id: 'paper', label: 'Rithmic Paper Trading', uri: o.prodPaperGateway });
  if (o.devGateway) out.unshift({ id: 'dev', label: 'Local mock', uri: o.devGateway });
  return out;
}

export function mountRithmicTrade(ws, opts) {
  if (S.ws) return;
  S.ws = ws; S.opts = opts || {};
  if (!document.getElementById('stkrt-css')) { const st = document.createElement('style'); st.id = 'stkrt-css'; st.textContent = CSS; document.head.appendChild(st); }
  const bar = S.opts.bar || document.querySelector('#stkc-bar .stkc-bar-r');
  if (bar && !document.getElementById('stkrt-btn')) {
    const b = S.btn = document.createElement('button');
    b.type = 'button'; b.id = 'stkrt-btn'; b.className = 'stkc-btn'; b.title = 'Rithmic trading (admin, paper / test only)'; b.setAttribute('aria-label', 'Rithmic paper trading'); b.setAttribute('aria-expanded', 'false');
    b.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 17l5-5 4 4 7-7"/><path d="M15 9h5v5"/></svg><span class="stkc-btn-l">Paper</span>';
    b.onclick = () => (S.panel && !S.panel.hidden ? closePanel() : openPanel());
    bar.insertBefore(b, bar.firstChild);
  }
  // live = both switches; the core still refuses every non-paper target, so this only changes wording.
  liveTradingAllowed({ constFlag: S.opts.liveConst, readServerFlag: async () => { const d = window.db || firebase.firestore(); const s = await d.collection('config').doc('rithmicTrading').get(); return s.exists && s.data().live; } })
    .then((v) => { S.live = v; });
  window.__stkRithmicTrade = { domClick };   // DOM ladder hook (chart-book-panel.js); only exists for admins
  if (window.__stkChartTestFree && /^(127\.0\.0\.1|localhost)$/.test(location.hostname)) window.__stkRtTest = { S, openPanel, render, pushLines, inject(lines) { const c = cells()[0], R = inner(c), inst = layerInst(R); chips(c, inst, lines); R.setNativeData(RT_LAYER, { lines }); return inst; }, get sess() { return S.sess; } };
  setInterval(() => { pushLines(); renderLive(); }, 1000);
}

function openPanel() {
  if (!S.panel) buildPanel();
  S.panel.hidden = false; S.btn && S.btn.setAttribute('aria-expanded', 'true');
  render();
  if (!S.sess && !S.systems.length) loadSystems();
}
function closePanel() { if (S.panel) S.panel.hidden = true; S.btn && S.btn.setAttribute('aria-expanded', 'false'); }
function buildPanel() {
  const p = S.panel = document.createElement('aside');
  p.id = 'stkrt'; p.className = 'stkrt'; p.hidden = true; p.setAttribute('aria-label', 'Rithmic paper trading');
  p.innerHTML = '<div class="stkrt-grab" aria-hidden="true"></div><div class="stkrt-hd"><div class="stkrt-ttl"><h2>Rithmic trading</h2>' + BADGE + '</div><button type="button" class="stkrt-ib" data-a="close" aria-label="Close">' + IC_X + '</button></div><div class="stkrt-body"></div><p class="stkrt-foot">' + DISCLAIMER + '</p>';
  document.body.appendChild(p);
  p.addEventListener('click', onClick);
  p.addEventListener('input', onInput);
  p.addEventListener('change', onInput);
  for (const ev of ['keydown', 'keyup']) p.addEventListener(ev, (e) => { e.stopPropagation(); if (ev === 'keydown' && e.key === 'Enter' && e.target.id === 'stkrt-pass') connect(); });
}

// ---- connect -------------------------------------------------------------------------------------------------------------
async function loadSystems() {
  const g = gateways().find((x) => x.uri === S.gw) || gateways()[0]; S.gw = g.uri; S.systems = []; S.msg = ''; render();
  try { S.systems = (await listSystemsT(WebSocket, g.uri)).filter((s) => PAPER_SYSTEMS.includes(s)); if (!S.systems.length) S.msg = 'This gateway lists no paper or test system.'; }
  catch (e) { S.msg = e.message; }
  render();
}
async function connect() {
  if (S.busy) return;
  const P = S.panel, user = P.querySelector('#stkrt-user').value.trim(), passEl = P.querySelector('#stkrt-pass'), sys = P.querySelector('#stkrt-sys').value;
  const pass = passEl.value; passEl.value = '';
  S.busy = true; S.msg = ''; render();
  // one trading tab at a time (two tabs = two sets of limits, and Rithmic may log one out)
  if (!(await tabLock())) { S.busy = false; S.msg = 'Trading is already open in another tab. Close it there first.'; render(); return; }
  const sess = new TradeSession({ gateway: S.gw, appName: S.opts.appName, appVersion: S.gw === TEST_GATEWAY ? S.opts.testAppVersion : S.opts.appVersion, templateVersion: S.opts.templateVersion,
    allowMock: !!S.opts.devGateway && S.gw === S.opts.devGateway, maxQty: S.prefs.maxQty, onEvent: onSessEvent });
  try {
    await sess.connect({ user, password: pass, systemName: sys });
    S.sess = sess; S.acct = sess.accounts[0].id;
    toast('Connected to ' + sys + ' (paper / test).');
    watchActive();
  } catch (e) { S.msg = e.message; try { await sess.close(true); } catch (x) {} if (lockRelease) lockRelease(); }
  S.busy = false; render(); pill();
}
let lockRelease = null;
function tabLock() {
  if (lockRelease) return Promise.resolve(true);
  if (!navigator.locks) return Promise.resolve(true);
  return new Promise((ok) => navigator.locks.request('stkrt-lock', { ifAvailable: true }, (l) => {
    if (!l) { ok(false); return; }
    ok(true); return new Promise((r) => { lockRelease = () => { lockRelease = null; r(); }; });
  }));
}
async function disconnect() {
  const s = S.sess; S.sess = null; if (s) await s.close(); if (lockRelease) lockRelease(); render(); pill(); pushLines(true);
}
function onSessEvent(ev) {
  if (ev.type === 'state') { pill(); render(); if (S.sess && S.sess.state === 'disconnected') toast('Rithmic trading disconnected: orders are locked.', 'error'); }
  else if (ev.type === 'quote') return;
  else { if (!S.panel || S.panel.hidden) return; clearTimeout(onSessEvent.t); onSessEvent.t = setTimeout(render, 60); }
}

// ---- chart symbol -> instrument ------------------------------------------------------------------------------------------
function activeSymbol() { try { return S.ws.active.symbol || S.ws.chart.market.symbol; } catch (e) { return ''; } }
const activeRoot = () => rootOfSymbol(String(activeSymbol()).replace(/^futures:/i, ''));
const contractFor = (root) => (S.sess && S.sess.contracts.get(root)) || (S.t.contract && new RegExp('^' + root + '[FGHJKMNQUVXZ]\\d{1,2}$').test(S.t.contract.toUpperCase()) ? S.t.contract.toUpperCase() : '');
async function watchActive() {
  const s = S.sess, root = activeRoot(); if (!s || !root) return;
  await s.resolveContract(root);
  const c = contractFor(root); if (c) { try { await s.watch(c, INSTRUMENTS[root].ex); } catch (e) {} }
  render();
}

// ---- actions -------------------------------------------------------------------------------------------------------------
function onInput(e) {
  const f = e.target.dataset.f; if (!f) return;
  if (f === 'maxQty') { S.prefs.maxQty = clampMaxQty(e.target.value); savePrefs(); if (S.sess) S.sess.maxQty = S.prefs.maxQty; if (e.type === 'change') render(); return; }
  if (f === 'chart') { S.prefs.chart = e.target.checked; savePrefs(); pushLines(true); return; }
  if (f === 'acct') { S.acct = e.target.value; render(); return; }
  if (f === 'gw') { S.gw = e.target.value; loadSystems(); return; }
  S.t[f] = e.target.value;
  if (f === 'contract' && e.type === 'change') watchActive();
}
function onClick(e) {
  const b = e.target.closest('[data-a]'); if (!b) return;
  const a = b.dataset.a, v = b.dataset.v;
  if (a === 'close') return closePanel();
  if (a === 'connect') return connect();
  if (a === 'disconnect') return disconnect();
  if (a === 'reconnect') return reconnect();
  if (a === 'set') { S.t[b.dataset.k] = v; S.msg = ''; return render(); }
  if (a === 'qty') { S.t.qty = Math.max(1, Math.min(S.prefs.maxQty, (+S.t.qty || 1) + (+v))); return render(); }
  if (a === 'review') return review();
  if (a === 'cancel') return act(() => S.sess.cancel(v), 'Cancel sent');
  if (a === 'move') { const inp = S.panel.querySelector('[data-mv="' + v + '"]'); return modify(v, Number(inp && inp.value)); }
  if (a === 'flatten') return flatten();
  if (a === 'cancelall') return act(() => S.sess.cancelAll(S.acct), 'Cancel all sent');
}
async function act(fn, ok) { S.msg = ''; try { await fn(); toast(ok); } catch (e) { S.msg = e.message; } render(); }
async function reconnect() { S.msg = 'Log in again to unlock trading. Rithmic keeps working orders while you are away.'; const s = S.sess; S.sess = null; if (s) await s.close(true); render(); }

function ticketFromForm(over) {
  const root = activeRoot(); if (!root) throw new Error('Open a futures chart (for example MES1!) to trade it.');
  const t = Object.assign({}, S.t, over || {});
  return S.sess.prepare({ account: S.acct, root, contract: contractFor(root), side: t.side, type: t.type, qty: Number(t.qty),
    price: t.type === 'limit' ? Number(t.price) : null, trigger: t.type === 'stop' ? Number(t.trigger) : null, tpTicks: t.tp ? Number(t.tp) : 0, slTicks: t.sl ? Number(t.sl) : 0 });
}
async function review(over) {
  S.msg = '';
  let tk; try { tk = ticketFromForm(over); } catch (e) { S.msg = e.message; render(); return; }
  const rows = [['Account', tk.account], ['Contract', tk.symbol], ['Side', tk.side === 'buy' ? 'Buy' : 'Sell'], ['Type', ({ market: 'Market', limit: 'Limit', stop: 'Stop (market)' })[tk.type]], ['Quantity', tk.qty + ' contract' + (tk.qty > 1 ? 's' : '')]];
  if (tk.price != null) rows.push(['Limit price', pxs(tk.price)]);
  if (tk.trigger != null) rows.push(['Stop price', pxs(tk.trigger)]);
  if (tk.tpTicks) rows.push(['Take profit', tk.tpTicks + ' ticks']);
  if (tk.slTicks) rows.push(['Stop loss', tk.slTicks + ' ticks']);
  rows.push(['System', S.sess.target.system]);
  if (!(await confirmSheet((tk.side === 'buy' ? 'Buy ' : 'Sell ') + tk.symbol, rows, tk.side))) return;
  try { await S.sess.submit(tk); toast('Order sent to ' + S.sess.target.system); } catch (e) { S.msg = e.message; toast(e.message, 'error'); }
  render();
}
async function modify(basket, price) {
  S.msg = '';
  let tk; try { tk = S.sess.prepareModify(basket, { price, trigger: price }); } catch (e) { S.msg = e.message; render(); pushLines(true); return; }
  if (!(await confirmSheet('Move order', [['Order', tk.basket], ['Contract', tk.symbol], ['From', pxs(tk.from)], ['To', pxs(tk.to)], ['System', S.sess.target.system]], tk.order.side))) { pushLines(true); return; }
  try { await S.sess.submitModify(tk); toast('Modify sent'); } catch (e) { S.msg = e.message; toast(e.message, 'error'); }
  render(); pushLines(true);
}
async function flatten() {
  const n = S.sess.working(S.acct).length, ps = [...S.sess.positions.values()].filter((p) => p.account === S.acct && p.net);
  if (!(await confirmSheet('Flatten & cancel all', [['Account', S.acct], ['Working orders', String(n)], ['Positions', ps.map((p) => (p.net > 0 ? 'Long ' : 'Short ') + Math.abs(p.net) + ' ' + p.symbol).join(', ') || 'none'], ['Action', 'Cancel every order, then exit every position at market']], 'sell', 'Flatten'))) return;
  try { await S.sess.flatten(S.acct); toast('Flatten sent'); } catch (e) { S.msg = e.message; toast(e.message, 'error'); }
  render();
}
// DOM ladder click (chart-book-panel.js): bid cell = buy limit, ask cell = sell limit at that price. Only with Chart trading on.
// Returns true when handled (the paper-trading simulator then does nothing).
function domClick(cell, price, bestBid, bestAsk, sym) {
  if (!S.prefs.chart || !S.sess || (cell !== 'bid' && cell !== 'ask')) return false;
  if (rootOfSymbol(String(sym || '').replace(/^futures:/i, '')) !== activeRoot()) return false;
  const root = activeRoot();
  review({ side: cell === 'bid' ? 'buy' : 'sell', type: 'limit', price: roundTick(price, INSTRUMENTS[root].tick), tp: '', sl: '' });
  return true;
}

// ---- confirm sheet (every order, modify and flatten) ---------------------------------------------------------------------
function confirmSheet(title, rows, side, okLabel) {
  return new Promise((done) => {
    if (!S.sheet) { S.sheet = document.createElement('div'); S.sheet.id = 'stkrt-cf'; S.sheet.className = 'stkrt-scrim'; document.body.appendChild(S.sheet); }
    const sh = S.sheet;
    sh.innerHTML = '<div class="stkrt-dlg" role="dialog" aria-modal="true" aria-labelledby="stkrt-cf-t"><div class="stkrt-grab" aria-hidden="true"></div><div class="stkrt-hd"><div class="stkrt-ttl"><h2 id="stkrt-cf-t">' + esc(title) + '</h2>' + BADGE + '</div><button type="button" class="stkrt-ib" data-x aria-label="Cancel">' + IC_X + '</button></div>' +
      '<dl class="stkrt-kv">' + rows.map((r) => '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>').join('') + '</dl>' +
      '<p class="stkrt-note">Sent to a Rithmic paper / test account. No real money.</p>' +
      '<div class="stkrt-acts"><button type="button" class="stkrt-btn" data-x>Cancel</button><button type="button" class="stkrt-btn stkrt-go ' + (side === 'sell' ? 'sell' : 'buy') + '" data-ok>' + esc(okLabel || 'Confirm') + '</button></div></div>';
    sh.hidden = false;
    let used = false;
    const end = (v) => { if (used) return; used = true; sh.hidden = true; document.removeEventListener('keydown', key, true); done(v); };
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); end(false); } };
    document.addEventListener('keydown', key, true);
    sh.onclick = (e) => { if (e.target === sh || e.target.closest('[data-x]')) end(false); else if (e.target.closest('[data-ok]')) end(true); };
    sh.querySelector('[data-ok]').focus();
  });
}

// ---- render --------------------------------------------------------------------------------------------------------------
const seg = (k, opts) => '<div class="stkrt-seg" role="group">' + opts.map(([v, l]) => '<button type="button" data-a="set" data-k="' + k + '" data-v="' + v + '" aria-pressed="' + (S.t[k] === v) + '">' + l + '</button>').join('') + '</div>';
const fld = (label, f, ph, id) => '<div class="stkrt-f"><label for="stkrt-' + (id || f) + '">' + label + '</label><input id="stkrt-' + (id || f) + '" data-f="' + f + '" inputmode="decimal" autocomplete="off" placeholder="' + esc(ph) + '" value="' + esc(S.t[f]) + '"></div>';
function render() {
  const P = S.panel; if (!P || P.hidden) return;
  const body = P.querySelector('.stkrt-body'), y = body.scrollTop, f = document.activeElement, fid = f && P.contains(f) && f.id;
  const msg = S.msg ? '<p class="stkrt-msg" role="alert">' + esc(S.msg) + '</p>' : '';
  const s = S.sess;
  if (!s) {
    const gws = gateways();
    body.innerHTML = '<p class="stkrt-lead">Log in to a Rithmic paper or test account</p><p class="stkrt-note">Separate from the chart data connection. Only Rithmic Test and Rithmic Paper Trading can trade here. Live accounts are refused.</p>' +
      '<div class="stkrt-f"><label for="stkrt-gw">Gateway</label><select id="stkrt-gw" data-f="gw">' + gws.map((g) => '<option value="' + esc(g.uri) + '"' + (g.uri === S.gw ? ' selected' : '') + '>' + esc(g.label) + '</option>').join('') + '</select></div>' +
      '<div class="stkrt-f"><label for="stkrt-sys">System</label><select id="stkrt-sys">' + (S.systems.length ? S.systems.map((x) => '<option>' + esc(x) + '</option>').join('') : '<option value="">Loading…</option>') + '</select></div>' +
      '<div class="stkrt-f"><label for="stkrt-user">Username</label><input id="stkrt-user" autocomplete="off" autocapitalize="off" spellcheck="false"></div>' +
      '<div class="stkrt-f"><label for="stkrt-pass">Password</label><input id="stkrt-pass" type="password" autocomplete="off"></div>' + msg +
      '<button type="button" class="stkrt-btn stkrt-pri" data-a="connect"' + (S.busy || !S.systems.length ? ' disabled' : '') + '>' + (S.busy ? 'Connecting…' : 'Connect') + '</button>' +
      '<p class="stkrt-note">The password goes straight from this browser to Rithmic and is not kept.</p>' + settingsHtml();
    return keep(body, y, fid);
  }
  if (s.state !== 'ready') {
    body.innerHTML = whoHtml() + '<p class="stkrt-lead">' + (s.state === 'disconnected' ? 'Disconnected. Trading is locked.' : 'Syncing orders and positions…') + '</p>' +
      (s.message ? '<p class="stkrt-note">' + esc(s.message) + '</p>' : '') + msg + (s.state === 'disconnected' ? '<button type="button" class="stkrt-btn stkrt-pri" data-a="reconnect">Log in again</button>' : '') + logHtml();
    return keep(body, y, fid);
  }
  const root = activeRoot(), t = S.t, c = root ? contractFor(root) : '', q = c && s.quote(c), fresh = c && s.fresh(c);
  if (+t.qty > S.prefs.maxQty) t.qty = S.prefs.maxQty;
  const ticket = !root ? '<p class="stkrt-note">Open a futures chart (MES1!, MNQ1!, ES1!, NQ1! …) to trade it here.</p>' :
    '<div class="stkrt-tk"><div class="stkrt-tkh"><b>' + esc(c || root) + '</b><span data-live="q">' + quoteText(q, fresh) + '</span></div>' +
    (s.contracts.get(root) ? '' : fld('Contract (Rithmic did not confirm the front month)', 'contract', root + 'Z6')) +
    '<div class="stkrt-sides" role="group"><button type="button" class="buy" data-a="set" data-k="side" data-v="buy" aria-pressed="' + (t.side === 'buy') + '">Buy</button><button type="button" class="sell" data-a="set" data-k="side" data-v="sell" aria-pressed="' + (t.side === 'sell') + '">Sell</button></div>' +
    seg('type', [['market', 'Market'], ['limit', 'Limit'], ['stop', 'Stop']]) +
    (t.type === 'limit' ? fld('Limit price', 'price', q && q.bid != null ? pxs(q.bid) : '') : t.type === 'stop' ? fld('Stop price', 'trigger', '') : '') +
    '<div class="stkrt-f"><span class="stkrt-lbl">Quantity (max ' + S.prefs.maxQty + ')</span><div class="stkrt-step"><button type="button" class="stkrt-btn" data-a="qty" data-v="-1" aria-label="Fewer">−</button><output aria-live="polite">' + (+t.qty || 1) + '</output><button type="button" class="stkrt-btn" data-a="qty" data-v="1" aria-label="More">+</button></div></div>' +
    '<div class="stkrt-f"><span class="stkrt-lbl">Bracket (optional)</span><div class="stkrt-row2"><div class="stkrt-f"><label for="stkrt-tp">Take profit (ticks)</label><input id="stkrt-tp" data-f="tp" inputmode="numeric" autocomplete="off" placeholder="e.g. 20" value="' + esc(t.tp) + '"></div><div class="stkrt-f"><label for="stkrt-sl">Stop loss (ticks)</label><input id="stkrt-sl" data-f="sl" inputmode="numeric" autocomplete="off" placeholder="e.g. 20" value="' + esc(t.sl) + '"></div></div></div>' +
    msg + '<button type="button" class="stkrt-btn stkrt-go ' + t.side + '" data-a="review"' + (fresh ? '' : ' disabled') + '>' + (fresh ? 'Review ' + t.side : 'Waiting for fresh prices') + '</button></div>';
  body.innerHTML = whoHtml() + acctHtml() + killHtml() + ticket + posHtml() + ordHtml() + fillsHtml() + settingsHtml() + logHtml();
  keep(body, y, fid);
}
function keep(body, y, fid) { body.scrollTop = y; if (fid) { const n = body.querySelector('#' + fid); if (n) { n.focus(); try { const l = n.value.length; n.setSelectionRange(l, l); } catch (e) {} } } }
const quoteText = (q, fresh) => (!q || !q.at ? 'No prices yet' : (fresh ? '' : 'Stale · ') + 'Bid ' + pxs(q.bid) + ' · Ask ' + pxs(q.ask));
function whoHtml() {
  const s = S.sess;
  return '<div class="stkrt-who"><span class="stkrt-dot' + (s.state === 'ready' ? ' on' : '') + '" aria-hidden="true"></span><span>' + esc(s.target.system) + '</span>' +
    (s.accounts.length > 1 ? '<select data-f="acct" aria-label="Account">' + s.accounts.map((a) => '<option value="' + esc(a.id) + '"' + (a.id === S.acct ? ' selected' : '') + '>' + esc(a.name + ' · ' + a.id) + '</option>').join('') + '</select>' : '<code>' + esc(S.acct) + '</code>') +
    '<button type="button" class="stkrt-txt" data-a="disconnect">Log out</button></div>';
}
function acctHtml() {
  const a = S.sess.acctPnl.get(S.acct) || {};
  return '<div class="stkrt-stats"><div><span>Balance</span><b data-live="bal">' + usd(a.balance) + '</b></div><div><span>Open P&amp;L</span><b data-live="opnl" class="' + (a.openPnl < 0 ? 'dn' : a.openPnl > 0 ? 'up' : '') + '">' + usd(a.openPnl, true) + '</b></div><div><span>Day P&amp;L</span><b data-live="dpnl">' + usd(a.dayPnl, true) + '</b></div></div>';
}
const killHtml = () => (S.sess.hasExposure(S.acct) ? '<button type="button" class="stkrt-btn stkrt-kill" data-a="flatten">Flatten &amp; cancel all</button>' : '');
function posHtml() {
  const ps = [...S.sess.positions.values()].filter((p) => p.account === S.acct && p.net);
  return '<h3 class="stkrt-h">Position</h3>' + (ps.length ? ps.map((p) => '<div class="stkrt-item"><div class="stkrt-l"><b class="' + (p.net > 0 ? 'up' : 'dn') + '">' + (p.net > 0 ? 'Long ' : 'Short ') + Math.abs(p.net) + ' ' + esc(p.symbol) + '</b><span>Avg ' + pxs(p.avg) + '</span></div><b class="' + (p.openPnl < 0 ? 'dn' : 'up') + '">' + usd(p.openPnl, true) + '</b></div>').join('') : '<p class="stkrt-empty">Flat.</p>');
}
function ordHtml() {
  const os = S.sess.working(S.acct);
  return '<div class="stkrt-hrow"><h3 class="stkrt-h">Working orders</h3>' + (os.length > 1 ? '<button type="button" class="stkrt-txt" data-a="cancelall">Cancel all</button>' : '') + '</div>' +
    (os.length ? os.map((o) => '<div class="stkrt-item"><div class="stkrt-l"><b class="' + (o.side === 'buy' ? 'up' : 'dn') + '">' + (o.side === 'buy' ? 'Buy ' : 'Sell ') + (o.qty || '') + ' ' + esc(o.symbol) + ' · ' + esc(o.role === 'tp' ? 'take profit' : o.role === 'sl' ? 'stop loss' : o.type) + '</b><span>' + (o.kind === 'unknown' ? 'Status unknown · ' : '') + esc(o.status) + ' · ' + esc(o.basket) + '</span></div>' +
      '<div class="stkrt-btns">' + (o.type !== 'market' ? '<input data-mv="' + esc(o.basket) + '" inputmode="decimal" aria-label="New price" value="' + esc(o.type === 'limit' ? o.price : o.trigger) + '"><button type="button" class="stkrt-btn stkrt-sm" data-a="move" data-v="' + esc(o.basket) + '">Move</button>' : '') +
      '<button type="button" class="stkrt-btn stkrt-sm" data-a="cancel" data-v="' + esc(o.basket) + '">Cancel</button></div></div>').join('') : '<p class="stkrt-empty">No working orders.</p>');
}
function fillsHtml() {
  const fs = S.sess.fills.filter((x) => x.account === S.acct).slice(0, 6);
  return '<h3 class="stkrt-h">Fills</h3>' + (fs.length ? fs.map((x) => '<div class="stkrt-item"><div class="stkrt-l"><b>' + (x.side === 'buy' ? 'Bought ' : 'Sold ') + x.qty + ' ' + esc(x.symbol) + ' @ ' + pxs(x.price) + '</b><span>' + new Date(x.at).toLocaleTimeString() + '</span></div></div>').join('') : '<p class="stkrt-empty">No fills yet.</p>');
}
function settingsHtml() {
  return '<details class="stkrt-det"><summary>Settings</summary><div class="stkrt-f"><label for="stkrt-max">Max contracts per order (1 to ' + LIMITS.hardMaxQty + ')</label><input id="stkrt-max" data-f="maxQty" type="number" min="1" max="' + LIMITS.hardMaxQty + '" step="1" value="' + S.prefs.maxQty + '"></div>' +
    '<label class="stkrt-chk"><input type="checkbox" data-f="chart"' + (S.prefs.chart ? ' checked' : '') + '> Chart trading (click the DOM ladder, drag order lines)</label></details>';
}
function logHtml() {
  const L = S.sess ? S.sess.log.slice(0, 40) : [];
  return '<details class="stkrt-det"><summary>Order log (' + L.length + ')</summary><ol class="stkrt-log">' + L.map((e) => '<li><time>' + esc(e.t.slice(11, 19)) + '</time> ' + esc(e.action) + (e.account ? ' · ' + esc(e.account) : '') + ' · <b>' + esc(e.result) + '</b>' + (e.detail ? ' · ' + esc(e.detail) : '') + '</li>').join('') + '</ol></details>';
}
function renderLive() {
  const P = S.panel; if (!P || P.hidden || !S.sess || S.sess.state !== 'ready') return;
  const root = activeRoot(), c = root && contractFor(root), q = c && S.sess.quote(c), fresh = c && S.sess.fresh(c);
  const el = P.querySelector('[data-live="q"]'); if (el) el.textContent = quoteText(q, fresh);
  const go = P.querySelector('[data-a="review"]');
  if (go && go.disabled === !!fresh) render();
  const a = S.sess.acctPnl.get(S.acct) || {}, set = (k, v) => { const n = P.querySelector('[data-live="' + k + '"]'); if (n && n.textContent !== v) n.textContent = v; };
  set('bal', usd(a.balance)); set('opnl', usd(a.openPnl, true)); set('dpnl', usd(a.dayPnl, true));
}
// chart pill: always visible while a trading session exists
function pill() {
  const on = !!S.sess;
  if (S.btn) S.btn.classList.toggle('stkrt-on', on);
  if (!on) { if (S.pill) S.pill.hidden = true; return; }
  if (!S.pill) { S.pill = document.createElement('div'); S.pill.id = 'stkrt-pill'; S.pill.className = 'stkrt-pill'; S.pill.setAttribute('role', 'status'); document.body.appendChild(S.pill); S.pill.onclick = openPanel; }
  S.pill.hidden = false;
  S.pill.innerHTML = '<i class="' + (S.sess.state === 'ready' ? 'on' : '') + '"></i>Paper / Test · ' + esc(S.sess.target.system) + (S.sess.state === 'ready' ? '' : ' · locked');
}

// ---- chart lines (position avg, working orders, TP/SL). Drag to modify only with Chart trading on. -------------------------
const COL = { long: '#03c988', short: '#f23645', ord: '#00adb5', tp: '#03c988', sl: '#f23645' };
function linesFor(sym) {
  const s = S.sess; if (!s || !S.acct) return [];
  const root = rootOfSymbol(String(sym || '').replace(/^futures:/i, '')); if (!root) return [];
  const out = [];
  for (const p of s.positions.values()) if (p.account === S.acct && p.net && rootOfSymbol(p.symbol) === root && p.avg)
    out.push({ id: 'pos', price: p.avg, color: p.net > 0 ? COL.long : COL.short, solid: true, a: (p.net > 0 ? 'LONG ' : 'SHORT ') + Math.abs(p.net), b: usd(p.openPnl, true), drag: false });
  for (const o of s.working(S.acct)) {
    if (rootOfSymbol(o.symbol) !== root || o.type === 'market') continue;
    const px = o.type === 'limit' ? o.price : o.trigger; if (!(px > 0)) continue;
    const k = o.role || 'ord';
    out.push({ id: 'o' + o.basket, basket: o.basket, price: px, color: COL[k], a: k === 'tp' ? 'TP' : k === 'sl' ? 'SL' : (o.side === 'buy' ? 'BUY ' : 'SELL ') + (o.type === 'stop' ? 'STP ' : 'LMT ') + (o.qty || ''), b: pxs(px), drag: true });
  }
  return out;
}
const cells = () => { try { return (S.ws.context().cells || []).map((c) => S.ws.cell(c.id)).filter(Boolean); } catch (e) { return []; } };
const inner = (cell) => { try { return cell.chart.renderer.renderer; } catch (e) { return null; } };
const layerInst = (R) => { try { const l = R.extLayers.find((x) => x.def.id === RT_LAYER); return l && l.instance; } catch (e) { return null; } };
const drag = { on: false }, sigs = new WeakMap();
function pushLines(force) {
  for (const cell of cells()) {
    const R = inner(cell); if (!R || !R.setNativeData) continue;
    const inst = layerInst(R); if (!inst) continue;
    const lines = linesFor(cell.symbol);
    if (drag.on && drag.cell === cell) for (const l of lines) if (l.id === drag.id) { l.price = drag.price; l.b = pxs(drag.price); }
    chips(cell, inst, lines);
    const sig = JSON.stringify(lines.map((l) => [l.id, l.price, l.color, l.b]));
    if (!force && sigs.get(R) === sig) continue;
    sigs.set(R, sig);
    try { R.setNativeData(RT_LAYER, { lines }); } catch (e) {}
  }
}
function chips(cell, inst, lines) {
  const ov = inst.overlay; if (!ov) return;
  const have = new Map([...ov.querySelectorAll('[data-rt]')].map((c) => [c.dataset.rt, c]));
  for (const l of lines) {
    let chip = have.get(l.id);
    if (!chip) {
      chip = document.createElement('div'); chip.className = 'stkrt-chip'; chip.dataset.rt = l.id;
      chip.innerHTML = '<span class="a"></span><span class="b"></span>' + (l.basket ? '<button type="button" class="x" aria-label="Cancel order">×</button>' : '');
      const x = chip.querySelector('.x');
      if (x) { x.addEventListener('pointerdown', (e) => e.stopPropagation()); x.addEventListener('click', (e) => { e.stopPropagation(); if (S.sess) act(() => S.sess.cancel(chip.dataset.rt.slice(1)), 'Cancel sent'); }); }
      chip.addEventListener('pointerdown', (e) => onChipDown(e, cell, inst, chip));
      ov.appendChild(chip);
    }
    have.delete(l.id);
    chip.style.setProperty('--c', l.color);
    chip.classList.toggle('drag', !!(l.drag && S.prefs.chart));
    chip.title = l.drag ? (S.prefs.chart ? 'Drag to move · × to cancel (paper / test)' : 'Turn on Chart trading to drag') : 'Average price';
    const A = chip.querySelector('.a'), B = chip.querySelector('.b');
    if (A.textContent !== l.a) A.textContent = l.a;
    if (B.textContent !== l.b) B.textContent = l.b;
  }
  for (const [, c] of have) c.remove();
}
function onChipDown(e, cell, inst, chip) {
  if (!S.prefs.chart || !S.sess || (e.button != null && e.button !== 0)) return;
  const id = chip.dataset.rt, l = linesFor(cell.symbol).find((x) => x.id === id); if (!l || !l.drag) return;
  const a = inst.args; if (!a) return;
  e.preventDefault(); e.stopPropagation();
  const root = rootOfSymbol(String(cell.symbol).replace(/^futures:/i, '')), tick = INSTRUMENTS[root].tick;
  const R = inner(cell), rect = ((R && R.input && R.input.el) || inst.overlay).getBoundingClientRect();
  Object.assign(drag, { on: true, cell, id, price: l.price, moved: false, y0: e.clientY });
  try { chip.setPointerCapture(e.pointerId); } catch (x) {}
  const move = (ev) => {
    if (!drag.moved && Math.abs(ev.clientY - drag.y0) < 3) return;
    drag.moved = true;
    const A = inst.args || a;
    drag.price = roundTick(A.coords.yToPrice(ev.clientY - rect.top, A.scale, A.bounds), tick);
    pushLines();
  };
  const up = () => {
    chip.removeEventListener('pointermove', move); chip.removeEventListener('pointerup', up); chip.removeEventListener('pointercancel', up);
    const d = Object.assign({}, drag); drag.on = false;
    if (!d.moved) { pushLines(true); return; }
    modify(l.basket, d.price);
  };
  chip.addEventListener('pointermove', move); chip.addEventListener('pointerup', up); chip.addEventListener('pointercancel', up);
}

const CSS = `
.stkrt{ --rt-up:#03c988; --rt-dn:#f23645; position:fixed; z-index:8020; top:72px; right:16px; bottom:16px; width:360px; display:flex; flex-direction:column; background:var(--bg-1, #0b0b0d); color:var(--ink-0);
  border:1px solid var(--line-soft, rgba(255,255,255,.08)); border-radius:16px; box-shadow:0 16px 48px rgba(0,0,0,.45);
  font:400 14px/20px -apple-system,BlinkMacSystemFont,"SF Pro Text",Roboto,"Segoe UI",system-ui,sans-serif; font-variant-numeric:tabular-nums; }
:root[data-theme="light"] .stkrt, :root[data-theme="light"] .stkrt-dlg{ --rt-up:#047857; --rt-dn:#c81e2e; background:#fff; box-shadow:0 16px 48px rgba(0,0,0,.18); }
.stkrt[hidden], .stkrt-scrim[hidden], .stkrt-pill[hidden]{ display:none; }
.stkrt-grab{ display:none; }
.stkrt-hd{ flex:none; display:flex; align-items:center; gap:8px; min-height:56px; padding:4px 4px 4px 16px; border-bottom:1px solid var(--line-soft); }
.stkrt-ttl{ flex:1; min-width:0; display:flex; align-items:center; gap:8px; }
.stkrt-hd h2{ margin:0; font-size:17px; line-height:22px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.stkrt-badge{ flex:none; font-size:11px; line-height:13px; font-weight:600; padding:4px 8px; border-radius:999px; color:#8a5300; background:rgba(247,166,0,.16); white-space:nowrap; }
:root:not([data-theme="light"]) .stkrt-badge{ color:#f7a600; }
.stkrt-ib{ flex:none; display:inline-flex; align-items:center; justify-content:center; width:44px; height:44px; border:0; border-radius:50%; background:transparent; color:var(--ink-1, var(--ink-0)); cursor:pointer; }
.stkrt-ib:hover{ background:var(--bg-2); }
.stkrt-body{ flex:1; min-height:0; overflow:auto; overscroll-behavior:contain; padding:16px; display:flex; flex-direction:column; gap:16px; }
.stkrt-body > *{ margin:0; }
.stkrt-foot{ flex:none; margin:0; padding:8px 16px; border-top:1px solid var(--line-soft); font-size:12px; line-height:16px; color:var(--ink-2); }
.stkrt-lead{ font-size:15px; line-height:22px; font-weight:600; }
.stkrt-note, .stkrt-empty{ font-size:13px; line-height:18px; color:var(--ink-2); }
.stkrt-msg{ padding:8px 12px; border-radius:12px; background:rgba(242,54,69,.12); color:var(--ink-0); font-size:13px; line-height:18px; }
.stkrt-btn{ display:inline-flex; align-items:center; justify-content:center; min-height:44px; padding:0 16px; border-radius:12px; border:1px solid var(--line); background:transparent; color:var(--ink-0); font:600 15px/20px inherit; font-family:inherit; cursor:pointer; }
.stkrt-btn:disabled{ opacity:.5; cursor:default; }
.stkrt-pri{ min-height:48px; background:#03c988; border-color:#03c988; color:#04140d; } .stkrt-pri:hover:not(:disabled){ background:#4fe3ac; }
.stkrt-go{ width:100%; min-height:48px; border:0; color:#fff; } .stkrt-go.buy{ background:#03c988; color:#04140d; } .stkrt-go.sell{ background:#f23645; }
.stkrt-kill{ width:100%; min-height:48px; border-color:#f23645; color:#f23645; } .stkrt-kill:hover{ background:rgba(242,54,69,.1); }
:root[data-theme="light"] .stkrt-kill{ border-color:#c81e2e; color:#c81e2e; }
.stkrt-sm{ min-height:32px; padding:0 12px; font-size:13px; border-radius:8px; }
.stkrt-txt{ border:0; background:none; color:var(--teal, #00adb5); font:500 13px/18px inherit; font-family:inherit; cursor:pointer; padding:12px 4px; min-height:44px; }
:root[data-theme="light"] .stkrt-txt{ color:#00787e; }
.stkrt-btn:focus-visible, .stkrt-ib:focus-visible, .stkrt-txt:focus-visible, .stkrt-seg button:focus-visible, .stkrt-sides button:focus-visible, .stkrt input:focus-visible, .stkrt select:focus-visible, .stkrt summary:focus-visible, .stkrt-dlg .stkrt-btn:focus-visible{ outline:2px solid #03c988; outline-offset:2px; }
.stkrt-who{ display:flex; flex-wrap:wrap; align-items:center; gap:8px; font-size:13px; } .stkrt-who > span:nth-child(2){ flex:1; min-width:0; } .stkrt-who code, .stkrt-who select{ order:3; flex:1 0 100%; min-width:0; }
.stkrt-who code{ font:400 13px/18px ui-monospace,SFMono-Regular,Menlo,monospace; color:var(--ink-1, var(--ink-0)); }
.stkrt-dot{ flex:none; width:8px; height:8px; border-radius:50%; background:var(--ink-3, #666); } .stkrt-dot.on{ background:#03c988; }
.stkrt-stats{ display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; }
.stkrt-stats div{ display:flex; flex-direction:column; gap:2px; padding:8px; border:1px solid var(--line-soft); border-radius:12px; min-width:0; }
.stkrt-stats span{ font-size:11px; line-height:13px; color:var(--ink-2); } .stkrt-stats b{ font-size:13px; line-height:20px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.stkrt-tk{ display:flex; flex-direction:column; gap:12px; padding:16px; border:1px solid var(--line-soft); border-radius:16px; }
.stkrt-tkh{ display:flex; justify-content:space-between; align-items:baseline; gap:8px; font-size:15px; line-height:22px; } .stkrt-tkh span{ font-size:12px; color:var(--ink-2); text-align:right; }
.stkrt-sides{ display:grid; grid-template-columns:1fr 1fr; gap:8px; }
.stkrt-sides button{ min-height:44px; border-radius:12px; border:1px solid var(--line); background:transparent; color:var(--ink-1, var(--ink-0)); font:600 15px/20px inherit; font-family:inherit; cursor:pointer; }
.stkrt-sides .buy[aria-pressed="true"]{ background:#03c988; border-color:#03c988; color:#04140d; } .stkrt-sides .sell[aria-pressed="true"]{ background:#f23645; border-color:#f23645; color:#fff; }
.stkrt-seg{ display:flex; padding:2px; border-radius:8px; background:var(--bg-2); }
.stkrt-seg button{ flex:1; min-width:0; min-height:36px; padding:0 8px; border:0; border-radius:6px; background:none; color:var(--ink-2); font:500 13px/18px inherit; font-family:inherit; cursor:pointer; }
.stkrt-seg button[aria-pressed="true"]{ background:var(--bg-0); color:var(--ink-0); box-shadow:0 0 0 1px var(--line-soft); }
.stkrt-f{ display:flex; flex-direction:column; gap:8px; }
.stkrt-f label, .stkrt-lbl{ font-size:13px; line-height:18px; font-weight:500; color:var(--ink-1, var(--ink-0)); }
.stkrt-row2{ display:grid; grid-template-columns:1fr 1fr; gap:8px; }
.stkrt-step{ display:grid; grid-template-columns:44px 1fr 44px; gap:8px; align-items:center; } .stkrt-step .stkrt-btn{ padding:0; font-size:20px; } .stkrt-step output{ text-align:center; font-size:17px; font-weight:600; }
.stkrt input:not([type=checkbox]), .stkrt select{ width:100%; min-width:0; height:44px; padding:0 12px; border-radius:8px; border:1px solid var(--line); background:var(--bg-0); color:var(--ink-0); font:400 16px/22px inherit; font-family:inherit; font-variant-numeric:tabular-nums; box-sizing:border-box; }
.stkrt-chk{ display:flex; align-items:center; gap:8px; min-height:44px; font-size:14px; cursor:pointer; } .stkrt-chk input{ width:20px; height:20px; margin:0; accent-color:#03c988; }
.stkrt-h{ margin:0; font-size:13px; line-height:18px; font-weight:600; }
.stkrt-hrow{ display:flex; align-items:center; justify-content:space-between; margin:0 0 -16px; }
.stkrt-item{ display:grid; grid-template-columns:minmax(0,1fr) auto; gap:8px; align-items:center; padding:8px 0; border-bottom:1px solid var(--line-soft); margin-top:-8px; }
.stkrt-l{ display:flex; flex-direction:column; gap:2px; min-width:0; } .stkrt-l b{ font-size:14px; line-height:20px; font-weight:600; } .stkrt-l span{ font-size:12px; line-height:16px; color:var(--ink-2); overflow-wrap:anywhere; }
.stkrt .up{ color:var(--rt-up); } .stkrt .dn{ color:var(--rt-dn); }
.stkrt-btns{ grid-column:1/-1; display:flex; gap:8px; } .stkrt-btns input{ height:32px !important; flex:1; font-size:14px !important; }
.stkrt-det summary{ cursor:pointer; min-height:44px; display:flex; align-items:center; font-size:13px; font-weight:600; }
.stkrt-det[open]{ display:flex; flex-direction:column; gap:12px; }
.stkrt-log{ margin:0; padding:0; list-style:none; display:flex; flex-direction:column; gap:4px; font-size:12px; line-height:16px; color:var(--ink-1, var(--ink-0)); max-height:240px; overflow:auto; overflow-wrap:anywhere; }
.stkrt-log time{ color:var(--ink-2); }
.stkrt-scrim{ position:fixed; inset:0; z-index:9100; background:rgba(0,0,0,.55); display:flex; align-items:center; justify-content:center; padding:16px; }
.stkrt-dlg{ width:min(400px,100%); max-height:calc(100dvh - 32px); overflow:auto; background:var(--bg-1, #0b0b0d); color:var(--ink-0); border:1px solid var(--line-soft); border-radius:16px;
  font:400 14px/20px -apple-system,BlinkMacSystemFont,"SF Pro Text",Roboto,"Segoe UI",system-ui,sans-serif; font-variant-numeric:tabular-nums; }
.stkrt-kv{ display:grid; grid-template-columns:auto minmax(0,1fr); gap:8px 16px; margin:0; padding:16px; }
.stkrt-kv dt{ color:var(--ink-2); font-size:13px; } .stkrt-kv dd{ margin:0; text-align:right; font-weight:500; overflow-wrap:anywhere; }
.stkrt-dlg .stkrt-note{ margin:0; padding:0 16px; }
.stkrt-acts{ display:grid; grid-template-columns:1fr 1fr; gap:8px; padding:16px; } .stkrt-acts .stkrt-btn{ min-height:48px; }
.stkrt-pill{ position:fixed; z-index:8010; left:56px; bottom:calc(var(--stkc-dock, 0px) + 100px); display:flex; align-items:center; gap:8px; height:32px; padding:0 12px; border-radius:999px;
  background:var(--bg-1, #0b0b0d); border:1px solid rgba(247,166,0,.5); color:#f7a600; font:600 12px/16px -apple-system,BlinkMacSystemFont,Roboto,sans-serif; cursor:pointer; white-space:nowrap; box-shadow:0 4px 16px rgba(0,0,0,.3); }
:root[data-theme="light"] .stkrt-pill{ background:#fff; color:#8a5300; box-shadow:0 4px 16px rgba(0,0,0,.12); }
.stkrt-pill i{ width:8px; height:8px; border-radius:50%; background:var(--ink-3, #888); } .stkrt-pill i.on{ background:#03c988; }
#stkrt-btn.stkrt-on{ color:#f7a600; border-color:rgba(247,166,0,.5); }
.stkrt-chip{ position:absolute; top:0; left:12px; height:22px; display:flex; align-items:stretch; pointer-events:auto; user-select:none; touch-action:none; border:1px solid var(--c); border-radius:4px; overflow:hidden;
  background:#131316; color:rgba(255,255,255,.92); font:600 11px/20px -apple-system,BlinkMacSystemFont,Roboto,sans-serif; font-variant-numeric:tabular-nums; will-change:transform; }
.stkrt-chip.drag{ cursor:ns-resize; }
:root[data-theme="light"] .stkrt-chip{ background:#fff; color:#1d1d1f; }
.stkrt-chip .a{ background:var(--c); color:#fff; padding:0 8px; white-space:nowrap; } .stkrt-chip .b{ padding:0 8px; white-space:nowrap; font-weight:500; }
.stkrt-chip .x{ border:0; border-left:1px solid var(--c); background:none; color:inherit; width:24px; padding:0; cursor:pointer; font-size:14px; } .stkrt-chip .x:hover{ background:var(--c); color:#fff; }
.stkrt-body, .stkrt-dlg, .stkrt-log{ scrollbar-width:thin; scrollbar-color:rgba(255,255,255,.18) transparent; }
:root[data-theme="light"] .stkrt-body, :root[data-theme="light"] .stkrt-dlg, :root[data-theme="light"] .stkrt-log{ scrollbar-color:rgba(0,0,0,.2) transparent; }
.stkrt-body::-webkit-scrollbar, .stkrt-dlg::-webkit-scrollbar, .stkrt-log::-webkit-scrollbar{ width:8px; } .stkrt-body::-webkit-scrollbar-button, .stkrt-dlg::-webkit-scrollbar-button, .stkrt-log::-webkit-scrollbar-button{ display:none; }
.stkrt-body::-webkit-scrollbar-thumb, .stkrt-dlg::-webkit-scrollbar-thumb, .stkrt-log::-webkit-scrollbar-thumb{ background:rgba(127,127,127,.35); border-radius:999px; border:2px solid transparent; background-clip:padding-box; }
@media (prefers-reduced-motion:no-preference){ .stkrt-btn, .stkrt-seg button, .stkrt-sides button{ transition:background-color .15s cubic-bezier(.2,0,0,1), color .15s cubic-bezier(.2,0,0,1); } }
@media (max-width:700px){
  .stkrt{ top:auto; left:0; right:0; bottom:var(--stkc-dock, 0px); width:auto; height:min(85dvh, 760px); border-radius:24px 24px 0 0; border-bottom:0; }
  .stkrt-grab{ display:block; flex:none; width:36px; height:4px; border-radius:2px; margin:8px auto 0; background:var(--line, rgba(255,255,255,.2)); }
  .stkrt-hd .stkrt-ib{ background:var(--bg-2); width:36px; height:36px; margin:4px 8px; }
  .stkrt-scrim{ align-items:flex-end; padding:0; }
  .stkrt-pill{ left:16px; }
  .stkrt-dlg{ width:100%; border-radius:24px 24px 0 0; padding-bottom:env(safe-area-inset-bottom); } .stkrt-dlg .stkrt-grab{ display:block; }
  .stkrt-foot{ padding-bottom:calc(8px + env(safe-area-inset-bottom)); }
}
`;
