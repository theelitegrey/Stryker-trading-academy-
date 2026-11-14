// TradeZoro — venue logos: a small mark of the exchange / broker beside its text tag (VEST, BINANCE, CME ...)
// in the symbol search list, the chart's symbol button, the indicator-dialog symbol field, watchlist rows and
// the Book panel's source chips. Marks are local 32 px PNGs in assets/venue-logos/ (shown at 14 px on an 18 px
// white tile so each one reads on dark and light), loaded lazily; no venue file = a neutral letter chip.
// Data vendors are NOT venues and never get a logo. Education only. Not financial advice.
const DIR = '/assets/venue-logos/';
// lower-case venue / exchange code -> file stem. CME Group (CME, CBOT, NYMEX, COMEX) and NYSE (NYSE, AMEX, ARCA)
// have no genuine mark file, so they get the letter chip like FX, IDX, XETR, BSE ... Never a wrong picture.
const FILE = {
  nasdaq: 'nasdaq', cboe: 'cboe', nse: 'nse',
  binance: 'binance', binanceus: 'binance', coinbase: 'coinbase', hyperliquid: 'hyperliquid', bybit: 'bybit', okx: 'okx',
  bitget: 'bitget', kraken: 'kraken', vest: 'vest',
  alpaca: 'alpaca', oanda: 'oanda', ironbeam: 'ironbeam', tastytrade: 'tastytrade', dhan: 'dhan', ctrader: 'ctrader',
  mt5: 'mt5', ninja: 'ninjatrader', ninjatrader: 'ninjatrader', tradovate: 'tradovate', ibkr: 'ibkr', rithmic: 'rithmic'
};
const SIZE = 18;

// "binance:BTCUSDT" / "CBOT_MINI:YM1!" / "stocks:NASDAQ:AAPL" / a row's venue + ticker -> file stem or ''
export function venueFile(venue, ticker, byoId) {
  let v = String(venue || '').toLowerCase();
  const t = String(ticker || '');
  if (v === 'stocks' || v === '') { const m = /^(?:stocks:)?([A-Za-z_]+):/.exec(t); if (m) v = m[1].toLowerCase(); }
  else if (v === 'byo') v = byoId || '';   // only the header knows which own source serves the symbol
  return FILE[v] || '';
}
let byoLabel = null;   // byo-core labelFor: which connected own source (Alpaca, tastytrade ...) serves a symbol
import('./byo-core.js?v=985').then((m) => { byoLabel = m.labelFor; }).catch(() => {});
export function venueLabel(venue, ticker) {   // letter for the fallback chip
  const v = String(venue || '').trim();
  const m = /^(?:stocks:)?([A-Za-z_]+):/.exec(String(ticker || ''));
  return ((v && v.toLowerCase() !== 'stocks' ? v : m ? m[1] : v) || '?').charAt(0).toUpperCase();
}

export function chip(file, letter) {
  const s = document.createElement('span');
  s.className = 'vlogo' + (file ? '' : ' vlogo-m');
  s.setAttribute('aria-hidden', 'true');
  if (file) {
    const i = new Image(); i.alt = ''; i.width = 14; i.height = 14; i.decoding = 'async'; i.loading = 'lazy';
    i.onerror = () => { s.classList.add('vlogo-m'); s.textContent = letter || '?'; };
    i.src = DIR + file + '.png';
    s.appendChild(i);
  } else s.textContent = letter || '?';
  return s;
}

function css() {
  if (document.getElementById('stk-vlogo-style')) return;
  const st = document.createElement('style'); st.id = 'stk-vlogo-style';
  st.textContent =
    '.vlogo{flex:none;display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;width:' + SIZE + 'px;height:' + SIZE + 'px;border-radius:5px;background:#fff;box-shadow:0 0 0 1px rgba(128,128,128,.35);vertical-align:middle;overflow:hidden;}' +
    '.vlogo img{width:14px;height:14px;display:block;}' +
    '.vlogo-m{background:var(--vela-surface-elev,#2a2e39);color:var(--vela-fg-muted,#9aa0aa);font:700 10px/1 system-ui,sans-serif;box-shadow:0 0 0 1px var(--vela-border,rgba(128,128,128,.35));}' +
    '.vela-sp-badge.has-vlogo{display:inline-flex;align-items:center;gap:6px;padding-left:3px;}' +
    '.vela-widget-symbol.has-vlogo{display:inline-flex;align-items:center;gap:6px;}' +
    '.stk-symin-btn .vlogo{margin-right:-2px;}.stkw-sym-v{margin-left:6px;}' +
    '.stkbp-ex .vlogo{width:16px;height:16px;border-radius:4px;}.stkbp-ex .vlogo img{width:12px;height:12px;}';
  document.head.appendChild(st);
}

function decorateRow(row) {
  const badge = row.querySelector('.vela-sp-badge');
  if (!badge || badge.classList.contains('has-vlogo')) return;
  const venue = row.dataset.venue || badge.textContent, tk = row.dataset.ticker;
  badge.classList.add('has-vlogo');
  badge.insertBefore(chip(venueFile(venue, tk), venueLabel(venue, tk)), badge.firstChild);
}
function decorateNode(n) {
  if (n.nodeType !== 1) return;
  if (n.classList.contains('vela-sp-row')) decorateRow(n);
  else if (n.firstElementChild && n.querySelectorAll) n.querySelectorAll('.vela-sp-row').forEach(decorateRow);
}

export function mountVenueLogos(ws) {
  if (typeof document === 'undefined' || window.__stkVenueLogos) return;
  window.__stkVenueLogos = true;
  css();
  new MutationObserver((muts) => { for (const m of muts) m.addedNodes.forEach(decorateNode); }).observe(document.body, { childList: true, subtree: true });
  document.querySelectorAll('.vela-sp-row').forEach(decorateRow);

  const activeSym = () => { try { return ws.active.symbol || ''; } catch (e) { return ''; } };
  // chart header symbol button: the mark sits before the text; re-applied when Vela rewrites the button
  const paintHeader = () => {
    document.querySelectorAll('.vela-widget-symbol').forEach((b) => {
      const sym = activeSym(), pre = /^([^:]+):/.exec(sym);
      let own = ''; try { own = pre && /^byo$/i.test(pre[1]) && byoLabel ? (byoLabel(sym) || {}).id || '' : ''; } catch (e) {}
      const f = venueFile(pre ? pre[1] : '', sym.replace(/^[^:]+:/, ''), own);
      const have = b.querySelector(':scope > .vlogo');
      if (have && have.dataset.k === (f || sym)) return;
      if (have) have.remove();
      if (!pre) return;
      const c = chip(f, venueLabel(pre[1], sym)); c.dataset.k = f || sym;
      b.classList.add('has-vlogo'); b.insertBefore(c, b.firstChild);
    });
  };
  paintHeader();
  try { ws.on('state:changed', paintHeader); } catch (e) {}
  const hdr = document.querySelector('.vela-widget-symbol');
  if (hdr) new MutationObserver(paintHeader).observe(hdr, { childList: true });
  // watchlist rows, the indicator-dialog symbol field and the Book panel's source chips
  const extra = () => {
    document.querySelectorAll('.stkw-row:not([data-vl])').forEach((r) => {
      r.dataset.vl = '1';
      const sym = r.dataset.sym || '', p = /^([^:]+):(.*)$/.exec(sym), s = r.querySelector('.stkw-sym');
      if (!s || !p) return;
      const v = p[1].toLowerCase();
      let f = '';
      if (v === 'futures') f = 'cme'; else f = venueFile(v, p[2]);
      if (v === 'fx' || v === 'idx') return;
      const c = chip(f, venueLabel(p[1], p[2])); c.classList.add('stkw-sym-v'); s.after(c);
    });
    document.querySelectorAll('.stk-symin-btn:not([data-vl])').forEach((b) => {
      const sy = b.dataset.symbol || ''; if (!sy) return;
      const m = /^([^:]+):/.exec(sy); if (!m) return;
      b.dataset.vl = '1'; b.insertBefore(chip(venueFile(m[1], sy.slice(m[1].length + 1)), venueLabel(m[1], sy)), b.firstChild);
    });
    document.querySelectorAll('.stkbp-ex:not([data-vl])').forEach((e) => {
      e.dataset.vl = '1';
      const n = e.textContent.replace(/\s*· none$/, '').trim().toLowerCase().replace(/\s+/g, '');
      e.insertBefore(chip(FILE[n] || '', n.charAt(0).toUpperCase()), e.querySelector('.stkbp-dot') ? e.querySelector('.stkbp-dot').nextSibling : e.firstChild);
    });
  };
  let q = 0;
  new MutationObserver(() => { if (!q) q = requestAnimationFrame(() => { q = 0; extra(); }); }).observe(document.body, { childList: true, subtree: true });
  extra();
}
