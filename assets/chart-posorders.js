// "Positions & Orders" dock (Owner 17 Nov 2026). A pill in the chart's bottom bar (just before the latency pill / Trade) opens a dock ABOVE
// the bar that shrinks the chart (a flex sibling of the chart area, never an overlay; phones: bottom sheet). Tabs: Positions | Open orders |
// Order history | Trade history | Balances. Data: the account the member picked. Paper (everyone): window.__stkPaper.account state.
// Live (admins only, a broker account picked): chart-live.js dock() = read-only copy of the poll data (+ one read of transactions).
// Actions reuse the existing paper closePos / cancelOrder / flattenAll and live flatten / cancel (their own confirms). No new order routes.
// Lazy-loaded by assets/chart-paper.js mountPaper(). Test: tools/tests/chart-posorders-browser.js.
const KEY = 'stryker_posorders_ui', H0 = 220, HMIN = 120, PHONE = 700, ICON = 600;
const TABS = [['pos', 'Positions'], ['ord', 'Open orders'], ['oh', 'Order history'], ['th', 'Trade history'], ['bal', 'Balances']];
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const money = (n, sign) => (Number.isFinite(n) ? (n < 0 ? '−' : sign && n > 0 ? '+' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—');
const cls = (n) => (n > 0 ? 'up' : n < 0 ? 'down' : '');
const show = (s) => String(s || '').replace(/^[^:]+:/, '');
const phone = () => window.innerWidth <= PHONE;

let P = null, btn = null, dock = null, ui = { open: false, tab: 'pos', h: H0 }, sig = '', liveTx = null;
try { Object.assign(ui, JSON.parse(localStorage.getItem(KEY) || '{}'), { open: false }); } catch (e) {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ tab: ui.tab, h: ui.h })); } catch (e) {} };
const bar = () => { const b = document.querySelector('#vela-chart .vela-widget-bottombar'); return b && getComputedStyle(b).display !== 'none' ? b : null; };
const tzOf = () => { try { return window.STRYKER_VELA.getState().timezone || 'Etc/UTC'; } catch (e) { return 'Etc/UTC'; } };
const when = (t) => {
  const d = new Date(t); if (!t || isNaN(d)) return '—';
  try { return new Intl.DateTimeFormat('en-GB', { timeZone: tzOf(), month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(d); } catch (e) { return d.toISOString().slice(0, 16).replace('T', ' '); }
};

// ---- data: one shape for both sources -------------------------------------------------------------------------------------------
// { live, pos:[{sym,side,qty,avg,last,pnl,close}], ord:[{sym,side,type,qty,price,status,cancel}], oh:[{t,sym,side,qty,price,note}],
//   th:[{t,sym,side,qty,price,pnl}], bal:[[label,text,n?]], cancelAll, nPos, nOrd }
function paperData() {
  const a = P.account; if (!a) return null;
  const st = a.state, px = (s, p) => { try { const d = a.spec(s).decimals; return Number.isFinite(p) ? p.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—'; } catch (e) { return String(p); } };
  const day = new Date(); day.setHours(0, 0, 0, 0);
  const s = a.summary(day.getTime()), side = (x) => (x === 'buy' ? 'Long' : 'Short');
  return {
    live: false,
    pos: Object.keys(st.positions).map((k) => { const p = st.positions[k], pnl = a.openPnl(p); return { sym: show(k), side: side(p.side), buy: p.side === 'buy', qty: p.qty, avg: px(k, p.avg), last: px(k, a.last[k]), pnl, close: () => P.closePos(k) }; }),
    ord: st.orders.slice().sort((x, y) => y.placedAt - x.placedAt).map((o) => ({ sym: show(o.symbol), side: o.side === 'buy' ? 'Buy' : 'Sell', buy: o.side === 'buy', type: o.type === 'limit' ? 'Limit' : 'Stop', qty: o.qty, price: px(o.symbol, o.price), status: 'Working', cancel: () => P.cancelOrder(o.id) })),
    oh: st.history.slice().reverse().slice(0, 100).map((x) => ({ t: x.at, sym: show(x.symbol) || '—', side: x.side ? (x.side === 'buy' ? 'Buy' : 'Sell') : '—', buy: x.side === 'buy', qty: x.qty != null ? x.qty : '—', price: x.price ? px(x.symbol, x.price) : '—', note: { fill: 'Filled', cancel: 'Cancelled', reject: 'Rejected', reset: 'Account reset' }[x.kind] || x.kind })),
    th: st.trades.slice().reverse().slice(0, 100).map((x) => ({ t: x.exitAt, sym: show(x.symbol), side: side(x.side), buy: x.side === 'buy', qty: x.qty, price: px(x.symbol, x.exit), pnl: x.pnl })),
    bal: [['Balance', money(s.balance)], ['Equity', money(s.equity)], ['Open P&L', money(s.unrealized, true), s.unrealized], ['Realized P&L', money(s.realized, true), s.realized], ['Day P&L', money(s.dayPnl, true), s.dayPnl]],
    cancelAll: () => { if (st.orders.length && window.confirm('Cancel every working paper order?')) st.orders.slice().forEach((o) => P.cancelOrder(o.id)); },
    nPos: Object.keys(st.positions).length, nOrd: st.orders.length
  };
}
const liveData = () => { const L = P.live; return L && L.dock ? L.dock() : null; };
const data = () => { try { return (P.live ? liveData() : null) || (P.live ? null : paperData()); } catch (e) { return null; } };

// ---- view -----------------------------------------------------------------------------------------------------------------------
const tbl = (head, rows, empty) => rows.length
  ? '<div class="stkpo-tw"><table class="stkpo-t"><thead><tr>' + head.map((h, i) => '<th' + (/Qty|Avg|Last|P&amp;L|Price/.test(esc(h)) ? ' class="n"' : '') + '>' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>'
  : '<p class="stkpo-empty">' + esc(empty) + '</p>';
const X = (i, label) => '<td class="x"><button type="button" class="stkpo-x" data-x="' + i + '" aria-label="' + esc(label) + '" title="' + esc(label) + '"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></td>';
function body(d) {
  const t = ui.tab;
  if (t === 'pos') return tbl(['Symbol', 'Side', 'Qty', 'Avg price', 'Last', 'Open P&L', ''], d.pos.map((p, i) => '<tr><td class="s">' + esc(p.sym) + '</td><td class="' + (p.buy ? 'up' : 'down') + '">' + p.side + '</td><td class="n">' + esc(p.qty) + '</td><td class="n">' + esc(p.avg) + '</td><td class="n">' + esc(p.last) + '</td><td class="n ' + cls(p.pnl) + '">' + (p.pnl == null ? '—' : money(p.pnl, true)) + '</td>' + (p.close ? X(i, 'Close ' + p.sym) : '<td></td>') + '</tr>'), 'No open positions');
  if (t === 'ord') return (d.ord.length && d.cancelAll ? '<div class="stkpo-tools"><button type="button" class="stkpo-b" data-all="1">Cancel all</button></div>' : '') +
    tbl(['Symbol', 'Side', 'Type', 'Qty', 'Price', 'Status', ''], d.ord.map((o, i) => '<tr><td class="s">' + esc(o.sym) + '</td><td class="' + (o.buy ? 'up' : 'down') + '">' + o.side + '</td><td>' + esc(o.type) + '</td><td class="n">' + esc(o.qty) + '</td><td class="n">' + esc(o.price) + '</td><td>' + esc(o.status) + '</td>' + (o.cancel ? X(i, 'Cancel ' + o.sym + ' order') : '<td></td>') + '</tr>'), 'No open orders');
  if (t === 'oh') return tbl(['Time', 'Symbol', 'Side', 'Qty', 'Price', 'Status'], d.oh.map((o) => '<tr><td>' + esc(when(o.t)) + '</td><td class="s">' + esc(o.sym) + '</td><td class="' + (o.buy ? 'up' : o.side === '—' ? '' : 'down') + '">' + o.side + '</td><td class="n">' + esc(o.qty) + '</td><td class="n">' + esc(o.price) + '</td><td>' + esc(o.note) + '</td></tr>'), 'No order history yet');
  if (t === 'th') return d.th === 'loading' ? '<p class="stkpo-empty">Loading…</p>' : tbl(['Time', 'Symbol', 'Side', 'Qty', 'Price', 'P&L'], d.th.map((o) => '<tr><td>' + esc(when(o.t)) + '</td><td class="s">' + esc(o.sym) + '</td><td class="' + (o.buy ? 'up' : o.side === '—' ? '' : 'down') + '">' + o.side + '</td><td class="n">' + esc(o.qty) + '</td><td class="n">' + esc(o.price) + '</td><td class="n ' + cls(o.pnl) + '">' + (o.pnl == null ? '—' : money(o.pnl, true)) + '</td></tr>'), 'No trades yet');
  return d.bal.length ? '<div class="stkpo-bal">' + d.bal.map(([k, v, n]) => '<div><em>' + esc(k) + '</em><b class="' + cls(n) + '">' + esc(v) + '</b></div>').join('') + '</div>' : '<p class="stkpo-empty">No balance to show</p>';
}
let cur = null;
function render(force) {
  placeBtn();
  const d = data(), on = !!(P.enabled || P.live), nP = d ? d.nPos : 0, nO = d ? d.nOrd : 0, n = nP + nO;
  btn.hidden = !on; if (!on && ui.open) toggle(false);
  const bd = btn.querySelector('.stkpo-n'); bd.textContent = n ? String(n) : ''; bd.hidden = !n;
  btn.setAttribute('aria-label', 'Positions & Orders' + (n ? ', ' + n + ' open' : '')); btn.title = 'Positions & Orders';
  if (!ui.open || !d) return;
  cur = d;
  for (const b of dock.querySelectorAll('[role=tab]')) { const o = b.dataset.t === ui.tab; b.classList.toggle('on', o); b.setAttribute('aria-selected', String(o)); b.tabIndex = o ? 0 : -1; }
  dock.querySelector('[data-c=pos]').textContent = nP || ''; dock.querySelector('[data-c=ord]').textContent = nO || '';
  if (ui.tab === 'th' && d.live && d.th == null) d.th = 'loading';
  const s = JSON.stringify([ui.tab, d.live, d.pos, d.ord, d.oh, d.th, d.bal, tzOf()].map((x) => x === 'loading' ? x : x));
  if (!force && s === sig) return; sig = s;
  const v = dock.querySelector('.stkpo-view'), top = v.scrollTop;
  v.innerHTML = body(d); v.scrollTop = top;
}
function placeBtn() {
  if (!btn) return;
  const b = bar(), lat = b && b.querySelector('.stklat-chip'), tw = document.getElementById('stkpt-tw');
  const anchor = b ? (lat && lat.parentNode === b ? lat : tw && tw.parentNode === b ? tw : null) : (tw || null);
  if (anchor) { if (btn.nextElementSibling !== anchor || btn.parentNode !== anchor.parentNode) anchor.parentNode.insertBefore(btn, anchor); }
  else if (b && btn.parentNode !== b) b.appendChild(btn);
  placeDock();
}
function placeDock() {
  if (!dock) return;
  const ws = document.querySelector('#vela-chart .vela-workspace'), b = bar();
  dock.classList.toggle('sheet', phone() || !b);
  if (!phone() && b && ws && (dock.parentNode !== ws || dock.nextElementSibling !== b)) ws.insertBefore(dock, b);
  else if ((phone() || !b) && dock.parentNode !== document.body) document.body.appendChild(dock);
  const mx = Math.max(HMIN, Math.round((ws ? ws.clientHeight : window.innerHeight) * 0.6));
  dock.style.setProperty('--stkpo-h', Math.min(mx, Math.max(HMIN, ui.h)) + 'px');
}
const fit = () => setTimeout(() => window.dispatchEvent(new Event('resize')), 0);
function toggle(on) {
  ui.open = on == null ? !ui.open : !!on;
  dock.hidden = !ui.open; btn.setAttribute('aria-expanded', String(ui.open)); btn.classList.toggle('on', ui.open);
  document.documentElement.classList.toggle('stkpo-sheet-open', ui.open && dock.classList.contains('sheet'));
  placeBtn(); sig = ''; render(true); fit();
  if (ui.open) { const t = dock.querySelector('[role=tab].on'); if (t && document.activeElement === btn) t.focus({ preventScroll: true }); }
}
function build() {
  btn = document.createElement('button'); btn.type = 'button'; btn.id = 'stkpo-btn'; btn.className = 'stkpo-btn'; btn.hidden = true;
  btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-controls', 'stkpo-dock');
  btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 14h18"/><path d="M7 17h10" stroke-width="2.4"/></svg><span class="stkpo-l">Positions &amp; Orders</span><span class="stkpo-n" hidden></span>';
  btn.onclick = () => toggle();
  dock = document.createElement('div'); dock.id = 'stkpo-dock'; dock.className = 'stkpo'; dock.hidden = true; dock.setAttribute('role', 'region'); dock.setAttribute('aria-label', 'Positions & Orders');
  dock.innerHTML = '<div class="stkpo-grip" role="separator" aria-orientation="horizontal" aria-label="Resize Positions & Orders" tabindex="0" title="Drag to resize"></div>' +
    '<div class="stkpo-head"><div class="stkpo-tabs" role="tablist" aria-label="Positions & Orders">' + TABS.map(([k, t]) => '<button type="button" role="tab" data-t="' + k + '">' + t + (k === 'pos' || k === 'ord' ? ' <i data-c="' + k + '"></i>' : '') + '</button>').join('') + '</div>' +
    '<button type="button" class="stkpo-close" aria-label="Close Positions & Orders" title="Close (Esc)"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>' +
    '<div class="stkpo-view" role="tabpanel"></div>';
  dock.querySelector('.stkpo-close').onclick = () => toggle(false);
  dock.addEventListener('keydown', (e) => e.stopPropagation());
  dock.addEventListener('pointerdown', (e) => e.stopPropagation());
  dock.querySelector('.stkpo-tabs').addEventListener('click', (e) => { const b = e.target.closest('[role=tab]'); if (!b) return; ui.tab = b.dataset.t; save(); if (ui.tab === 'th' && P.live && P.live.dockTrades) P.live.dockTrades(); render(true); });
  dock.querySelector('.stkpo-tabs').addEventListener('keydown', (e) => { const i = TABS.findIndex((t) => t[0] === ui.tab), j = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : -1; if (j < 0 || j >= TABS.length) return; ui.tab = TABS[j][0]; save(); render(true); dock.querySelector('[role=tab].on').focus(); });
  dock.querySelector('.stkpo-view').addEventListener('click', (e) => {
    const x = e.target.closest('[data-x]'), all = e.target.closest('[data-all]');
    if (x && cur) { const r = (ui.tab === 'pos' ? cur.pos : cur.ord)[+x.dataset.x]; if (r) (r.close || r.cancel)(); setTimeout(() => render(true), 60); }
    if (all && cur && cur.cancelAll) { cur.cancelAll(); setTimeout(() => render(true), 60); }
  });
  const grip = dock.querySelector('.stkpo-grip');
  grip.addEventListener('pointerdown', (e) => {
    if (phone() || dock.classList.contains('sheet') || (e.button != null && e.button !== 0)) return;
    e.preventDefault(); const y0 = e.clientY, h0 = dock.getBoundingClientRect().height; try { grip.setPointerCapture(e.pointerId); } catch (e2) {}
    const mv = (ev) => { ui.h = Math.round(h0 + (y0 - ev.clientY)); placeDock(); }, up = () => { grip.removeEventListener('pointermove', mv); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up); ui.h = Math.round(dock.getBoundingClientRect().height); save(); fit(); };
    grip.addEventListener('pointermove', mv); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
  });
  grip.addEventListener('keydown', (e) => { const d = e.key === 'ArrowUp' ? 24 : e.key === 'ArrowDown' ? -24 : 0; if (d) { e.preventDefault(); ui.h += d; placeDock(); save(); fit(); } });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ui.open && !e.defaultPrevented && ![...document.querySelectorAll('.stklv-cf, [role=dialog], .vela-dialog-positioner')].some((d) => d.offsetWidth > 0 && d.offsetHeight > 0)) { toggle(false); btn.focus(); } }, true);
  window.addEventListener('resize', () => { placeBtn(); if (ui.open) document.documentElement.classList.toggle('stkpo-sheet-open', dock.classList.contains('sheet')); });
}

const CSS = `
.stkpo-btn{ flex:none; display:inline-flex; align-items:center; gap:6px; height:24px; margin:0 4px 0 6px; padding:0 8px; border:0; border-radius:4px; background:transparent; color:var(--vela-fg-muted, var(--ink-2)); font:600 12px/16px -apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, Ubuntu, sans-serif; cursor:pointer; white-space:nowrap; box-sizing:border-box; }
.stkpo-btn[hidden]{ display:none; }
.stkpo-btn:hover,.stkpo-btn.on{ background:var(--vela-hover, var(--bg-2)); color:var(--vela-fg-bright, var(--ink-0)); }
.stkpo-btn:focus-visible,.stkpo-close:focus-visible,.stkpo-x:focus-visible,.stkpo-b:focus-visible,.stkpo-tabs [role=tab]:focus-visible,.stkpo-grip:focus-visible{ outline:2px solid var(--gold); outline-offset:1px; }
.stkpo-btn svg{ flex:none; }
.stkpo-n{ display:inline-flex; align-items:center; justify-content:center; min-width:16px; height:16px; padding:0 4px; box-sizing:border-box; border-radius:8px; background:var(--gold); color:#0b0b0d; font:700 10px/1 -apple-system, BlinkMacSystemFont, Roboto, sans-serif; font-variant-numeric:tabular-nums; }
.stkpo-n[hidden]{ display:none; }
/* icon-only where the one-row bar is tight: 1280-1365 (the Equity summary is still shown) and below 1000 */
@media (min-width:1280px) and (max-width:1365px), (max-width:999px){ .stkpo-btn{ padding:0 8px; } .stkpo-l{ position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); } .stkpo-btn{ position:relative; } .stkpo-n{ position:absolute; top:-4px; right:-4px; } }
@media (max-width:${ICON}px){ .stkpo-btn{ width:32px; height:32px; padding:0; justify-content:center; position:relative; } .stkpo-l{ position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); } .stkpo-n{ position:absolute; top:0; right:-2px; } }
.stkpo{ flex:none; position:relative; z-index:35; display:flex; flex-direction:column; height:var(--stkpo-h, ${H0}px); min-height:0; box-sizing:border-box; background:var(--bg-0); color:var(--ink-1); border-top:1px solid var(--line); font:13px/1.4 var(--font-body, Archivo, system-ui, sans-serif); }
.stkpo[hidden]{ display:none; }
.stkpo-grip{ position:absolute; left:0; right:0; top:-4px; height:8px; cursor:ns-resize; z-index:2; touch-action:none; }
.stkpo-grip::after{ content:""; position:absolute; left:50%; top:3px; width:36px; height:3px; margin-left:-18px; border-radius:2px; background:var(--ink-3); opacity:0; transition:opacity .15s; }
.stkpo-grip:hover::after,.stkpo-grip:focus-visible::after{ opacity:.8; }
.stkpo-head{ flex:none; display:flex; align-items:center; gap:8px; padding:4px 8px 4px 12px; border-bottom:1px solid var(--line-soft); min-width:0; }
.stkpo-tabs{ flex:1 1 auto; min-width:0; display:flex; align-items:center; gap:4px; overflow-x:auto; }
.stkpo-tabs [role=tab]{ flex:none; height:32px; padding:0 12px; border:0; border-radius:8px; background:none; color:var(--ink-2); font:600 13px/16px var(--font-body, sans-serif); cursor:pointer; white-space:nowrap; }
.stkpo-tabs [role=tab]:hover{ background:var(--bg-2); color:var(--ink-0); }
.stkpo-tabs [role=tab].on{ color:var(--ink-0); background:var(--bg-2); box-shadow:inset 0 -2px 0 var(--gold); }
.stkpo-tabs i{ font-style:normal; color:var(--ink-3); margin-left:2px; font-variant-numeric:tabular-nums; }
.stkpo-close{ flex:none; display:inline-flex; align-items:center; justify-content:center; width:32px; height:32px; border:0; border-radius:8px; background:none; color:var(--ink-2); cursor:pointer; }
.stkpo-close:hover{ background:var(--bg-2); color:var(--ink-0); }
.stkpo-view{ flex:1 1 auto; min-height:0; overflow:auto; padding:0 12px 8px; }
.stkpo-tw{ overflow-x:auto; }
.stkpo-t{ width:100%; border-collapse:collapse; font-size:12px; white-space:nowrap; font-variant-numeric:tabular-nums; }
.stkpo-t th{ position:sticky; top:0; z-index:1; background:var(--bg-0); text-align:left; font:600 11px/16px var(--font-body, sans-serif); color:var(--ink-3); padding:8px 8px; border-bottom:1px solid var(--line-soft); }
.stkpo-t td{ height:32px; padding:0 8px; border-bottom:1px solid var(--line-soft); color:var(--ink-1); }
.stkpo-t .n{ text-align:right; } .stkpo-t td.s{ color:var(--ink-0); font-weight:600; } .stkpo-t td.x{ width:1%; text-align:right; }
.stkpo .up{ color:#089981; } .stkpo .down{ color:#f23645; }
.stkpo-x{ display:inline-flex; align-items:center; justify-content:center; width:24px; height:24px; border:0; border-radius:6px; background:none; color:var(--ink-2); cursor:pointer; }
.stkpo-x:hover{ background:var(--bg-2); color:#f23645; }
.stkpo-tools{ display:flex; justify-content:flex-end; padding:8px 0 0; }
.stkpo-b{ height:28px; padding:0 12px; border:1px solid var(--line); border-radius:8px; background:none; color:var(--ink-1); font:600 12px/1 var(--font-body, sans-serif); cursor:pointer; }
.stkpo-b:hover{ background:var(--bg-2); color:var(--ink-0); }
.stkpo-empty{ margin:16px 4px; color:var(--ink-3); }
.stkpo-bal{ display:grid; grid-template-columns:repeat(auto-fill, minmax(160px, 1fr)); gap:8px; padding-top:12px; }
.stkpo-bal div{ display:flex; flex-direction:column; gap:4px; padding:12px; border:1px solid var(--line-soft); border-radius:12px; background:var(--bg-1); }
.stkpo-bal em{ font-style:normal; font-size:11px; color:var(--ink-3); } .stkpo-bal b{ font:600 15px/20px var(--font-body, sans-serif); font-variant-numeric:tabular-nums; color:var(--ink-0); }
.stkpo-bal b.up{ color:#089981; } .stkpo-bal b.down{ color:#f23645; }
.stkpo.sheet{ position:fixed; left:0; right:0; bottom:0; z-index:90; height:min(60vh, 460px); border:1px solid var(--line); border-bottom:0; border-radius:16px 16px 0 0; box-shadow:0 -12px 32px rgba(0,0,0,.35); padding-bottom:env(safe-area-inset-bottom); }
.stkpo.sheet .stkpo-grip{ display:none; }
.stkpo.sheet .stkpo-tabs [role=tab]{ height:40px; } .stkpo.sheet .stkpo-close{ width:40px; height:40px; } .stkpo.sheet .stkpo-x{ width:40px; height:40px; }
:root[data-theme="light"] .stkpo .up,:root[data-theme="light"] .stkpo .down{ filter:none; }
@media (prefers-reduced-motion:reduce){ .stkpo-grip::after{ transition:none; } }
`;

export function mountPosOrders(paperApi) {
  if (P) return; P = paperApi;
  if (!document.getElementById('stkpo-css')) { const s = document.createElement('style'); s.id = 'stkpo-css'; s.textContent = CSS; document.head.appendChild(s); }
  build(); placeBtn(); render(true);
  setInterval(() => { try { render(); } catch (e) { console.warn('TradeZoro: positions dock', e); } }, 500);
  window.__stkPosOrders = { toggle, get open() { return ui.open; }, get tab() { return ui.tab; } };
}
