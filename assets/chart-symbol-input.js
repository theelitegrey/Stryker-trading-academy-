// TradeZoro — Charts: symbol search for Pine `input.symbol` fields (charts.html) — ES module
// Depends on: assets/vela-chart.js (calls mountSymbolInputPicker(ws, { SymbolPicker, toast,
// COMMODITY_ROOTS }) once the workspace exists; SymbolPicker is the class from Vela's widget
// build, the SAME search the header symbol button opens); Vela 0.6.17 public chart API
// chart.setSymbolPicker(); the indicator settings dialog (Vela's IndicatorInputsDialog, reached
// through chart.renderer.inputsUI.inputsDialog; vendor files are NOT edited).
//
// WHY (Owner 2026-10-12): every input.symbol in Settings → Inputs (e.g. SMT Divergence Pro
// "Symbol 1/2/3") was a plain text box. "make it so that it opens up the selection for symbol
// search and i can select from that".
//
// WHAT IT DOES, for every indicator with input.symbol (built-ins, community, member scripts):
//   - the field is a button: muted exchange prefix + bold contract ("CBOT_MINI:" "YM1!") and a
//     search icon. Only the prefix ever ellipsizes, so the contract is always readable; the
//     tooltip carries the full ticker and the description.
//   - click / tap / Enter opens the chart's symbol search (same list, tabs, keyboard nav; a
//     separate instance, because the workspace's own one closes every chart dialog on open).
//     The list only offers rows our feeds can load for request.security (see loadable()).
//   - picking a row writes the ticker in TradingView form (CME_MINI:ES1!, CBOT_MINI:YM1!,
//     COMEX:GC1!, NYMEX:CL1!, BINANCE:BTCUSDT, FX:EURUSD) and commits it like a manual edit,
//     so the indicator re-runs.
//   - the pencil button swaps in a text box to type a ticker by hand; what is typed is
//     normalised the same way when we recognise it, otherwise kept as typed.
//   - Escape inside the search closes only the search, not the settings dialog behind it.
//
// HOW request.security LOADS A SYMBOL: the Pine glue hands the engine the ticker without its
// exchange prefix ("CBOT_MINI:YM1!" loads "YM1!") and Vela resolves the bare ticker against
// the providers in registration order. So a row is loadable only when its bare ticker resolves
// back to that same provider (e.g. a Coinbase "BTC-USD" row is fine, a duplicate ticker owned
// by an earlier provider is not offered).

const STYLE_ID = 'stk-symin-style';
// Futures: TradingView exchange codes. Mirrors INSIGHTSENTRY_CODES in
// functions/api/chart/_bars.js, plus the roots that table does not carry.
const FUT_TV = {
  NQ: 'CME_MINI', MNQ: 'CME_MINI', ES: 'CME_MINI', MES: 'CME_MINI', RTY: 'CME_MINI', M2K: 'CME_MINI',
  YM: 'CBOT_MINI', MYM: 'CBOT_MINI',
  GC: 'COMEX', MGC: 'COMEX_MINI', SI: 'COMEX', SIL: 'COMEX_MINI', HG: 'COMEX', MHG: 'COMEX_MINI',
  CL: 'NYMEX', MCL: 'NYMEX', NG: 'NYMEX',
  ZN: 'CBOT', ZB: 'CBOT', '6E': 'CME'
};
const PROVIDER_TV = { binance: 'BINANCE', coinbase: 'COINBASE', hyperliquid: 'HYPERLIQUID', fx: 'FX' };

const SVG = (d) => '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
const ICON_SEARCH = SVG('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>');
const ICON_PEN = SVG('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/>');
const ICON_OK = SVG('<path d="M5 12l5 5 9-10"/>');

const CSS = `
.stk-symin{display:flex;align-items:center;gap:4px;width:100%;min-width:0;}
.stk-symin-btn{flex:1 1 auto;min-width:0;height:34px;box-sizing:border-box;display:flex;align-items:center;gap:6px;
  padding:0 8px;background:transparent;border:1px solid var(--vela-border-strong);border-radius:6px;cursor:pointer;
  color:var(--vela-fg-bright);font:inherit;font-size:14px;text-align:left;}
.stk-symin-btn:hover{border-color:var(--vela-fg-muted);}
.stk-symin-btn:focus-visible{outline:2px solid #03c988;outline-offset:1px;}
.stk-symin-txt{flex:1 1 auto;min-width:0;display:flex;align-items:baseline;white-space:nowrap;}
.stk-symin-pre{min-width:0;overflow:hidden;text-overflow:ellipsis;color:var(--vela-fg-muted);font-size:12px;}
.stk-symin-tk{flex:none;font-weight:700;}
.stk-symin-ico{flex:none;display:inline-flex;color:var(--vela-fg-muted);}
.stk-symin-edit{flex:none;width:30px;height:34px;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;
  padding:0;background:transparent;border:1px solid transparent;border-radius:6px;cursor:pointer;color:var(--vela-fg-muted);}
.stk-symin-edit:hover{color:var(--vela-fg-bright);background:var(--vela-hover);}
.stk-symin-in{flex:1 1 auto;min-width:0;height:34px;box-sizing:border-box;padding:0 8px;background:transparent;
  border:1px solid var(--vela-border-strong);border-radius:6px;color:var(--vela-fg-bright);font:inherit;font-size:14px;
  text-transform:uppercase;outline:none;}
.stk-symin-in:focus{border-color:#03c988;}
/* Symbol rows get room: the dialog's 100 px control column would clip the contract. */
.vela-ind-dialog .stk-symin-host{min-width:220px;}
/* Tab row of this search instance: one line, never break a label mid-word. */
.stk-symin-tabs{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;}
.stk-symin-tabs::-webkit-scrollbar{display:none;}
.stk-symin-tabs .vela-sp-tab{flex:none;white-space:nowrap;}
@media (max-width:700px){
  .vela-ind-dialog .stk-symin-host{min-width:150px;}
  .stk-symin-btn,.stk-symin-in,.stk-symin-edit{height:40px;}
  .stk-symin-edit{width:40px;}
}
`;

// "CBOT_MINI:YM1!" -> { pre: 'CBOT_MINI', tk: 'YM1!' }
function splitTicker(s){
  const v = String(s || '').trim();
  const i = v.lastIndexOf(':');
  return i > 0 ? { pre: v.slice(0, i), tk: v.slice(i + 1) } : { pre: '', tk: v };
}

// A feed descriptor -> the ticker string the engine expects (TradingView form).
export function engineSymbolOf(d){
  if (!d || !d.ticker) return '';
  const p = String(d.provider || '').toLowerCase();
  const t = String(d.ticker);
  if (p === 'futures') {
    const root = t.toUpperCase().replace(/1!$/, '');
    return (FUT_TV[root] || String(d.prefix || 'CME').toUpperCase()) + ':' + root + '1!';
  }
  return (PROVIDER_TV[p] || String(d.prefix || p).toUpperCase()) + ':' + t;
}

export function mountSymbolInputPicker(ws, o){
  const SymbolPicker = o && o.SymbolPicker;
  const toast = (o && o.toast) || (() => {});
  const COMMODITY_ROOTS = (o && o.COMMODITY_ROOTS) || [];
  if (!ws || !SymbolPicker) return null;
  if (!document.getElementById(STYLE_ID)) {
    const st = document.createElement('style'); st.id = STYLE_ID; st.textContent = CSS; document.head.appendChild(st);
  }
  const feed = ws.feed;
  const allSymbols = () => { try { return feed.symbols() || []; } catch (e) { return []; } };

  // ---- which rows request.security can load (bare ticker resolves to the row's provider) ----
  let okCache = null, okN = -1;
  function loadable(d){
    if (!d || !d.ticker) return false;
    const all = allSymbols();
    if (!okCache || okN !== all.length) { okCache = new WeakMap(); okN = all.length; }
    if (okCache.has(d)) return okCache.get(d);
    let ok = false;
    try {
      const r = feed.resolveSymbol(String(d.ticker));
      ok = !!r && String(r.provider).toLowerCase() === String(d.provider || '').toLowerCase();
    } catch (e) {}
    okCache.set(d, ok);
    return ok;
  }

  // ---- anything typed / stored -> descriptor (or null) ----
  function describe(raw){
    const { pre, tk } = splitTicker(raw);
    if (!tk) return null;
    const T = tk.toUpperCase();
    const all = allSymbols();
    const fut = /^[A-Z0-9]+1!$/.test(T) ? T : (FUT_TV[T] ? T + '1!' : '');
    const P = pre.toUpperCase();
    // Futures root or continuous contract: "YM", "YM1!", "CBOT:YM1!", "futures:YM1!".
    if (fut && (!P || P === 'FUTURES' || /^(CME|CBOT|COMEX|NYMEX)(_MINI)?$/.test(P))) {
      const d = all.find((x) => String(x.provider).toLowerCase() === 'futures' && String(x.ticker).toUpperCase() === fut);
      if (d) return d;
    }
    const want = P.toLowerCase();
    const prov = Object.keys(PROVIDER_TV).find((k) => PROVIDER_TV[k] === P) || want;
    let d = all.find((x) => String(x.provider).toLowerCase() === prov && String(x.ticker).toUpperCase() === T);
    if (!d && !P) {
      try { const r = feed.resolveSymbol(T); if (r) d = all.find((x) => String(x.provider).toLowerCase() === String(r.provider).toLowerCase() && String(x.ticker).toUpperCase() === String(r.ticker).toUpperCase()); } catch (e) {}
      if (!d && !/(USDT|USDC|USD|-)/.test(T)) return describe('BINANCE:' + T + 'USDT');
    }
    return d || null;
  }
  // Normalise a typed value: a symbol we know becomes its engine form; anything else stays.
  function normalize(raw){
    const v = String(raw || '').trim();
    if (!v) return '';
    const d = describe(v);
    return d ? engineSymbolOf(d) : v.toUpperCase();
  }

  // ---- the search (one instance for every chart cell) ----
  let picker = null, onPick = null;
  function ensurePicker(){
    if (picker) return picker;
    picker = new SymbolPicker({
      host: ws.root || document.getElementById('vela-chart'),
      iconFor: (d) => { try { return feed.symbolIconOf(d); } catch (err) { return undefined; } },
      onSelect: (raw) => {
        const cb = onPick; onPick = null;
        const d = describe(raw);
        if (!d || !loadable(d)) { toast('That symbol cannot be loaded here.', 'error'); return; }
        if (cb) cb(engineSymbolOf(d));
      },
      onOpenChange: (open) => {
        if (open) document.addEventListener('keydown', escGuard, true);
        else { document.removeEventListener('keydown', escGuard, true); onPick = null; }
      }
    });
    picker.setSource(() => allSymbols());
    // Tag this instance (the workspace's header search is a second .vela-sp-input in the DOM).
    try { picker.input.classList.add('stk-symin-search'); picker.list.classList.add('stk-symin-list'); picker.tabs.classList.add('stk-symin-tabs'); } catch (e) {}
    // Same "Commodities" tab trick as the header search (assets/vela-chart.js), plus the
    // loadable filter. pool() is the picker's own seam; the raw pool stays untouched.
    if (typeof picker.pool === 'function') {
      const basePool = picker.pool.bind(picker);
      const isCmd = (d) => d && String(d.type || '').toLowerCase() === 'futures' && COMMODITY_ROOTS.includes(String(d.ticker || '').toUpperCase().replace(/1!$/, ''));
      let lastIn = null, lastOut = null;
      picker.pool = () => {
        const pool = basePool();
        if (pool !== lastIn) { lastIn = pool; lastOut = pool.filter(loadable); }
        return picker.activeTab === 'Commodities' ? lastOut.map((d) => (isCmd(d) ? Object.assign({}, d, { type: 'commodity' }) : d)) : lastOut;
      };
    }
    return picker;
  }
  // Escape closes only the search; the settings dialog listens on document (bubble) too.
  function escGuard(e){
    if (e.key !== 'Escape' || !picker) return;
    e.stopPropagation(); e.preventDefault();
    picker.close();
  }
  // Seed the search with the current contract ("YM" for CBOT_MINI:YM1!) so it lands on it.
  function openSearch(current, cb){
    const p = ensurePicker();
    onPick = cb;
    const tk = splitTicker(current).tk.toUpperCase().replace(/1!$/, '');
    p.open(tk && tk.length <= 12 ? tk : '');
  }

  // ---- the control that replaces Vela's input.symbol field ----
  function buildControl(id, current, emit){
    let value = String(current || '');
    const wrap = document.createElement('div');
    wrap.className = 'stk-symin';
    const btn = document.createElement('button');
    btn.type = 'button'; btn.id = id; btn.className = 'stk-symin-btn';
    btn.setAttribute('aria-haspopup', 'dialog');
    const txt = document.createElement('span'); txt.className = 'stk-symin-txt';
    const pre = document.createElement('span'); pre.className = 'stk-symin-pre';
    const tk = document.createElement('span'); tk.className = 'stk-symin-tk';
    txt.append(pre, tk);
    const ico = document.createElement('span'); ico.className = 'stk-symin-ico'; ico.innerHTML = ICON_SEARCH;
    btn.append(txt, ico);
    const edit = document.createElement('button');
    edit.type = 'button'; edit.className = 'stk-symin-edit'; edit.innerHTML = ICON_PEN;
    edit.title = 'Type a symbol'; edit.setAttribute('aria-label', 'Type a symbol');
    wrap.append(btn, edit);

    const paint = () => {
      const s = splitTicker(value);
      pre.textContent = s.pre ? s.pre + ':' : '';
      tk.textContent = s.tk || 'Select symbol';
      const d = value ? describe(value) : null;
      const tip = value ? value + (d && d.description ? ' \u00b7 ' + d.description : '') : 'Select symbol';
      btn.title = tip;
      btn.dataset.symbol = value;
      btn.setAttribute('aria-label', 'Symbol: ' + tip + '. Open symbol search');
    };
    const set = (v) => { if (!v || v === value) return; value = v; paint(); emit(v); };
    paint();
    // Mark the dialog cell so the column gets room (see CSS).
    requestAnimationFrame(() => { const host = wrap.parentElement; if (host) host.classList.add('stk-symin-host'); });

    btn.addEventListener('click', (e) => { e.preventDefault(); openSearch(value, set); });

    let typing = null;
    const endTyping = (commit) => {
      if (!typing) return;
      const inp = typing; typing = null;
      if (commit) {
        const raw = inp.value.trim();
        if (raw) {
          const v = normalize(raw);
          const d = describe(v);
          if (!d || !loadable(d)) toast('"' + raw + '" is not on our data feeds, so it may not load.', 'error');
          set(v);
        }
      }
      inp.replaceWith(btn);
      edit.innerHTML = ICON_PEN; edit.title = 'Type a symbol'; edit.setAttribute('aria-label', 'Type a symbol');
      btn.focus();
    };
    edit.addEventListener('mousedown', (e) => { if (typing) e.preventDefault(); });   // keep the blur from firing first
    edit.addEventListener('click', (e) => {
      e.preventDefault();
      if (typing) { endTyping(true); return; }
      const inp = document.createElement('input');
      inp.type = 'text'; inp.className = 'stk-symin-in'; inp.value = value; inp.spellcheck = false;
      inp.setAttribute('autocapitalize', 'characters'); inp.setAttribute('aria-label', 'Symbol, e.g. CBOT_MINI:YM1!');
      inp.placeholder = 'e.g. CBOT_MINI:YM1!';
      inp.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); endTyping(true); }
        else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); endTyping(false); }
      });
      inp.addEventListener('blur', () => setTimeout(() => endTyping(true), 0));
      typing = inp;
      btn.replaceWith(inp);
      edit.innerHTML = ICON_OK; edit.title = 'Done'; edit.setAttribute('aria-label', 'Done');
      inp.focus(); inp.select();
    });
    return wrap;
  }

  // ---- wire every chart cell (and cells added later) ----
  // ws.context().cells[i].chart.renderer is a facade; the native renderer (owner of
  // inputsUI) sits one level below it on Vela 0.6.17. Try both so either shape works.
  const nativeOf = (chart) => {
    const r = chart && chart.renderer;
    if (r && r.inputsUI) return r;
    if (r && r.renderer && r.renderer.inputsUI) return r.renderer;
    return null;
  };
  let patched = false;
  function patchDialog(chart){
    if (patched) return true;
    let dlg = null;
    try { const n = nativeOf(chart); dlg = n && n.inputsUI.inputsDialog; } catch (e) {}
    if (!dlg) return false;
    const proto = Object.getPrototypeOf(dlg);
    if (!proto || typeof proto.buildSymbol !== 'function') return false;
    const orig = proto.buildSymbol;
    proto.buildSymbol = function (id, current, emit){
      try { return buildControl(id, current, emit); }
      catch (e) { console.warn('TradeZoro: symbol input', e); return orig.call(this, id, current, emit); }
    };
    patched = true;
    return true;
  }
  const pick = (current, cb) => openSearch(current, (v) => cb(v));
  function applyAll(){
    let cells = [];
    try { cells = ws.context().cells || []; } catch (e) {}
    cells.forEach((c) => {
      const chart = c && c.chart;
      if (!chart) return;
      const r = chart.renderer;
      if (r && !r.__stkSymIn) {
        try {
          if (typeof chart.setSymbolPicker === 'function') chart.setSymbolPicker(pick);
          else if (typeof r.setSymbolPicker === 'function') r.setSymbolPicker(pick);
          r.__stkSymIn = true;
        } catch (e) { console.warn('TradeZoro: symbol inputs wiring', e); }
      }
      patchDialog(chart);
    });
  }
  applyAll();
  try { ws.on('layout:changed', () => setTimeout(applyAll, 0)); } catch (e) {}
  try { ws.on('state:changed', () => applyAll()); } catch (e) {}

  const api = { open: openSearch, normalize, describe, engineSymbolOf, loadable, get picker(){ return picker; }, get patched(){ return patched; } };
  window.STRYKER_SYMBOL_INPUT = api;
  return api;
}
