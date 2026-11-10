// TradeZoro — Hyperliquid ladders (ES module). Owner order 2026-11-07: Liquidations / Stop losses / Take profits next to the chart,
// price-aligned with its axis, regrouped to a row size that follows the zoom (or a picker), optional faint bands on the chart.
// Free for everyone, like Wallet Intel. It rides on chart-wallet-intel.js: that layer fetches /hl-clusters and calls
// window.__stkLadders.sync() on every redraw (same canvas, same price scale), so rows follow every pan and zoom.
// HONESTY: tracked wallets only. The footer says how many wallets and about what share of open interest; nothing is the whole market.
// Desktop: a panel beside the chart, three columns whose rows sit at the chart's own price positions. Phone: a bottom sheet with tabs.
// Aggregated mode is not offered: the data holds one market per coin. Education only. Not financial advice.
import { LADDERS, MULTS, splitLevels, rebucket, pickSize, columnStats, strength, pctOf, fmtPct, rowCluster } from './hl-ladders-core.js?v=948';

const KEY = 'stkhll.v1';
const COL = { liq: '245,197,66', sl: '242,54,69', tp: '3,201,136' };   // amber / red / mint (data colours, rgb)
const NAME = { liq: 'Liquidations', sl: 'Stop losses', tp: 'Take profits' };
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const IC_X = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const IC_LAD = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h8M4 12h14M4 18h6"/></svg>';
let W = null;   // wallet-intel exports (loaded lazily: same module the page already holds)

const load = () => { try { return Object.assign({ open: false, mult: 'auto', bands: false, tab: 'liq' }, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) { return { open: false, mult: 'auto', bands: false, tab: 'liq' }; } };

export function mountLadders(ws, host) {
  if (!host || document.getElementById('stkhll')) return null;
  import('./chart-wallet-intel.js?v=948').then((m) => { W = m; });
  const S = load(), save = () => { try { localStorage.setItem(KEY, JSON.stringify({ open: S.open, mult: S.mult, bands: S.bands, tab: S.tab })); } catch (e) {} };
  const isPhone = () => window.innerWidth <= 700;
  const el = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };
  const panel = el('aside', 'stkhll'); panel.id = 'stkhll'; panel.hidden = true; panel.setAttribute('aria-label', 'Liquidation, stop loss and take profit ladders');
  panel.innerHTML = '<div class="stkhll-grab" aria-hidden="true"></div><div class="stkhll-hd"><div class="stkhll-ttl"><span class="stkhll-title">Ladders</span><span class="stkhll-sub"></span></div>' +
    '<button type="button" class="stkhll-ib stkhll-x" aria-label="Close ladders">' + IC_X + '</button></div>' +
    '<div class="stkhll-ctl"><label class="stkhll-pick"><span>Row size</span><select aria-label="Row size"></select></label>' +
    '<label class="stkhll-sw"><input type="checkbox"><span>Bands on chart</span></label></div>' +
    '<div class="stkhll-tabs" role="tablist"></div><div class="stkhll-heads"></div>' +
    '<div class="stkhll-body" aria-live="polite"></div>' +
    '<p class="stkhll-foot"><span class="stkhll-cov"></span> Tracked wallets only, not the whole market. Education only. Not financial advice.</p>';
  host.appendChild(panel);
  const $ = (s) => panel.querySelector(s), body = $('.stkhll-body'), heads = $('.stkhll-heads'), tabs = $('.stkhll-tabs'), sel = $('select'), chk = $('input');
  let cur = null, fab = null, raf = 0, lastSig = '', levelsFor = null, levels = [];
  const wi = () => window.__stkWalletIntel;

  // ---- numbers --------------------------------------------------------------------------------------------------------------
  function geometry() {
    if (!cur || !cur.d || !cur.d.cl || !cur.d.cl.step) return null;
    const { a, d } = cur, co = a.coords, top = a.bounds.top, H = a.bounds.height;
    let p0, p1;
    try { p0 = co.yToPrice(top, a.scale, a.bounds); p1 = co.yToPrice(top + H, a.scale, a.bounds); } catch (e) { return null; }
    if (!isNum(p0) || !isNum(p1)) return null;
    const hi = Math.max(p0, p1), lo = Math.min(p0, p1);
    if (levelsFor !== d.cl) { levelsFor = d.cl; levels = splitLevels(d.cl); }
    const maxRows = isPhone() ? 40 : Math.max(4, Math.floor(H / 22));
    const size = pickSize(d.cl.step, lo, hi, maxRows, S.mult === 'auto' ? 'auto' : +S.mult);
    const cols = {};
    for (const [k] of LADDERS) { const rows = rebucket(levels, k, size); cols[k] = Object.assign({ rows }, columnStats(rows, lo, hi)); }
    return { a, d, co, top, H, lo, hi, size, cols, cl: d.cl };
  }
  const yOf = (G, p) => G.co.priceToY(p, G.a.scale, G.a.bounds);

  // ---- bands on the chart (called from the Wallet Intel layer while it draws; g is clipped to the plot) ----------------------
  function bands(G, g) {
    if (!S.bands || !g) return;
    const Wd = G.co.width, day = document.documentElement.getAttribute('data-theme') === 'light';
    for (const [k] of LADDERS) {
      for (const r of G.cols[k].view) {
        const y0 = yOf(G, r.hi), y1 = yOf(G, r.lo); if (!isNum(y0) || !isNum(y1)) continue;
        const s = strength(r.ntl, G.cols[k].max), c = k === 'liq' ? (r.long >= r.short ? COL.sl : COL.tp) : COL[k];
        g.fillStyle = 'rgba(' + (k === 'liq' ? COL.liq : c) + ',' + ((day ? 0.07 : 0.05) + s * (day ? 0.14 : 0.16)).toFixed(3) + ')';
        g.fillRect(0, y0, Wd, Math.max(1, y1 - y0 - 1));
      }
    }
  }

  // ---- panel ----------------------------------------------------------------------------------------------------------------
  function fill(select, step) {
    const want = MULTS.map((m) => String(m)).join(',') + '|' + step;
    if (select.dataset.k === want) return;
    select.dataset.k = want; select.textContent = '';
    const o = el('option', '', 'Auto (follows zoom)'); o.value = 'auto'; select.appendChild(o);
    for (const m of MULTS) { const q = el('option', '', W.fmtPx(+(step * m).toFixed(8)) + ' per row'); q.value = String(m); select.appendChild(q); }
    select.value = String(S.mult);
  }
  function openRow(r) { if (wi() && cur && cur.d) wi().openCluster(cur.d.coin, rowCluster(r)); }
  function rowEl(r, k, G, cls, style) {
    const b = el('button', 'stkhll-row' + (cls || '')); b.type = 'button';
    const st = strength(r.ntl, G.cols[k].max), big = G.cols[k].big.has(r.lo);
    const rng = W.fmtPx(r.lo) + '–' + W.fmtPx(r.hi);
    b.setAttribute('aria-label', NAME[k] + ' ' + rng + ': ' + W.usd(r.ntl) + ', ' + fmtPct(pctOf(r.ntl, G.cols[k].total)) + ' of total. Show wallets.');
    b.title = rng;
    if (big) b.classList.add('is-big');
    if (style) Object.assign(b.style, style);
    const bar = el('i', 'stkhll-bar'); bar.style.width = Math.max(4, st * 100).toFixed(1) + '%';
    bar.style.background = 'rgba(' + (k === 'liq' ? COL.liq : COL[k]) + ',' + (0.18 + st * 0.62).toFixed(2) + ')';
    b.appendChild(bar);
    b.appendChild(el('span', 'stkhll-v', W.usd(r.ntl)));
    b.appendChild(el('span', 'stkhll-p', fmtPct(pctOf(r.ntl, G.cols[k].total))));
    b.addEventListener('click', () => openRow(r));
    return b;
  }
  function render() {
    raf = 0;
    const G = geometry();
    if (!W || !G) { if (open()) { heads.textContent = ''; body.textContent = ''; body.appendChild(el('p', 'stkhll-note', G ? '' : 'Waiting for wallet data…')); } return; }
    fill(sel, G.cl.step); if (sel.value !== String(S.mult)) sel.value = String(S.mult);
    chk.checked = !!S.bands;
    $('.stkhll-sub').textContent = G.d.coin + ' · rows of ' + W.fmtPx(G.size) + ' · ' + W.agoText(G.cl.t);
    $('.stkhll-cov').textContent = (W.coverageText(G.cl.coverage) ? 'Coverage: ' + W.coverageText(G.cl.coverage) + '.' : '');
    const phone = isPhone();
    // column heads: name, total, share of the total that is in view
    heads.textContent = ''; heads.className = 'stkhll-heads' + (phone ? ' is-one' : '');
    for (const [k] of LADDERS) {
      if (phone && k !== S.tab) continue;
      const c = G.cols[k], h = el('div', 'stkhll-h');
      h.appendChild(el('b', '', NAME[k])); h.appendChild(el('span', 'stkhll-ht', W.usd(c.total)));
      h.appendChild(el('span', 'stkhll-hp', c.total > 0 ? fmtPct(c.pctView) + ' in view' : 'none tracked'));
      heads.appendChild(h);
    }
    tabs.textContent = '';
    for (const [k] of LADDERS) { const t = el('button', '', NAME[k]); t.type = 'button'; t.setAttribute('role', 'tab'); t.setAttribute('aria-selected', String(S.tab === k)); t.addEventListener('click', () => { S.tab = k; save(); lastSig = ''; schedule(); }); tabs.appendChild(t); }
    body.textContent = '';
    if (phone) {
      body.className = 'stkhll-body is-list';
      const c = G.cols[S.tab], rows = c.rows.filter((r) => r.hi > G.lo && r.lo < G.hi);
      if (!rows.length) body.appendChild(el('p', 'stkhll-note', c.total > 0 ? 'Nothing tracked inside this price range. Zoom out to see the rest.' : 'No tracked ' + NAME[S.tab].toLowerCase() + ' for ' + G.d.coin + ' yet.'));
      for (const r of rows) {
        const row = rowEl(r, S.tab, G, ' is-line'); row.insertBefore(el('span', 'stkhll-px', W.fmtPx(r.lo)), row.firstChild.nextSibling); body.appendChild(row);
      }
      return;
    }
    // desktop: rows sit at the chart's own y positions. The body spans exactly the chart's plot area.
    body.className = 'stkhll-body is-aligned';
    const cv = cur.parent.querySelector('canvas[data-stk-wi]') || cur.parent, cr = cv.getBoundingClientRect(), pr = panel.getBoundingClientRect();
    const t0 = cr.top - pr.top + G.top, hd = heads.offsetTop + heads.offsetHeight;
    body.style.setProperty('--off', (t0 - hd) + 'px'); body.style.setProperty('--h', G.H + 'px');
    const cw = (body.clientWidth - 16) / 3;
    LADDERS.forEach(([k], i) => {
      const lane = el('div', 'stkhll-lane'); lane.style.left = (4 + i * (cw + 4)) + 'px'; lane.style.width = (cw - 4) + 'px';
      for (const r of G.cols[k].view) {
        const y0 = yOf(G, r.hi), y1 = yOf(G, r.lo); if (!isNum(y0) || !isNum(y1)) continue;
        lane.appendChild(rowEl(r, k, G, '', { top: y0.toFixed(1) + 'px', height: Math.max(8, y1 - y0 - 1).toFixed(1) + 'px' }));
      }
      body.appendChild(lane);
    });
  }
  function schedule() { if (!raf && open()) raf = requestAnimationFrame(render); }
  const open = () => !panel.hidden;
  function closeOthers() {
    const h = host.classList;
    if (h.contains('stkw-open')) { const b = document.querySelector('.stkw .stkw-close'); if (b) b.click(); }
    if (h.contains('stknw-open') && window.__stkNews) window.__stkNews.close();
    if (window.__stkDarkPool && window.__stkDarkPool.isOpen) window.__stkDarkPool.close();
    if (window.__stkSymInfo && window.__stkSymInfo.isOpen) window.__stkSymInfo.close();
    const bp = document.getElementById('stkbp'); if (bp && !bp.hidden) { const x = bp.querySelector('.stkbp-x'); if (x) x.click(); }
  }
  function setOpen(v) {
    v = !!v; if (v === open()) return;
    if (v) closeOthers();
    panel.hidden = !v; S.open = v; save();
    host.classList.toggle('stkhll-open', v); document.documentElement.classList.toggle('stkhll-sheet', v && isPhone());
    if (fab) fab.setAttribute('aria-pressed', String(v));
    if (!v && wi() && wi().isOpen && wi().view && wi().view.kind === 'cluster') { /* keep the wallet list: it still stands alone */ }
    requestAnimationFrame(() => { try { window.dispatchEvent(new Event('resize')); } catch (e) {} lastSig = ''; schedule(); });
  }
  sel.addEventListener('change', () => { S.mult = sel.value; save(); lastSig = ''; if (window.__stkRedrawWi) window.__stkRedrawWi(); schedule(); });
  chk.addEventListener('change', () => { S.bands = chk.checked; save(); if (window.__stkRedrawWi) window.__stkRedrawWi(); });
  $('.stkhll-x').addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open() && !(wi() && wi().isOpen)) setOpen(false); });
  window.addEventListener('resize', () => { document.documentElement.classList.toggle('stkhll-sheet', open() && isPhone()); lastSig = ''; schedule(); }, { passive: true });

  // ---- the hook the Wallet Intel layer calls on every redraw ---------------------------------------------------------------
  function ensureFab(parent) {
    if (fab && fab.parentElement === parent) return;
    if (fab) fab.remove();
    fab = el('button', 'stkhll-fab'); fab.type = 'button'; fab.innerHTML = IC_LAD + '<span>Ladders</span>'; fab.setAttribute('aria-label', 'Open liquidation, stop loss and take profit ladders'); fab.setAttribute('aria-pressed', String(open()));
    fab.addEventListener('click', () => setOpen(!open()));
    parent.appendChild(fab);
  }
  window.__stkLadders = {
    sync(parent, a, d, g) {
      if (!parent || !d || !d.cl) { cur = null; if (fab) fab.hidden = true; if (open()) { heads.textContent = ''; body.textContent = ''; body.appendChild(el('p', 'stkhll-note', 'Add Wallet Intel on a Hyperliquid perp chart to see the ladders.')); } return; }
      cur = { parent, a, d }; ensureFab(parent); fab.hidden = false;
      if (!W) return;
      const G = S.bands || open() ? geometry() : null;
      if (G) {
        bands(G, g);
        const sig = [G.lo.toFixed(4), G.hi.toFixed(4), G.top, G.H, G.size, G.cl.t, S.tab, S.mult, innerWidth].join('|');
        if (sig !== lastSig) { lastSig = sig; schedule(); }
      }
    },
    open: () => setOpen(true), close: () => setOpen(false), get isOpen() { return open(); }, get state() { return S; }, geometry
  };
  if (S.open) setTimeout(() => setOpen(true), 0);
  return window.__stkLadders;
}

export const CSS = `
.stkhll-fab{ position:absolute; top:44px; right:72px; z-index:7; display:inline-flex; align-items:center; gap:6px; min-height:32px; padding:0 12px; border-radius:999px; border:1px solid var(--line-soft, rgba(255,255,255,.08)); background:var(--bg-1, #0b0b0d); color:var(--ink-1, rgba(255,255,255,.92)); font:500 12px/16px -apple-system,BlinkMacSystemFont,"SF Pro Text",Roboto,"Segoe UI",system-ui,sans-serif; cursor:pointer; }
.stkhll-fab[hidden]{ display:none; }
.stkhll-fab:hover{ background:var(--bg-2); }
.stkhll-fab[aria-pressed="true"]{ border-color:#03c988; color:#03c988; }
.stkhll-fab:focus-visible, .stkhll-row:focus-visible, .stkhll-tabs button:focus-visible, .stkhll-ib:focus-visible{ outline:2px solid #03c988; outline-offset:2px; }
.stkchart-panel.stkw-host.stkhll-open #vela-chart{ right:calc(var(--stkw-rail) + var(--stkhll-w, 372px)); }
.stkhll{ --h-up:#03c988; --h-dn:#f23645; position:absolute; top:0; bottom:0; right:var(--stkw-rail, 44px); width:var(--stkhll-w, 372px); z-index:30; display:flex; flex-direction:column; min-width:0; background:var(--bg-0); border-left:1px solid var(--line-soft);
  font:400 13px/18px -apple-system,BlinkMacSystemFont,"SF Pro Text",Roboto,"Segoe UI",system-ui,sans-serif; color:var(--ink-0); font-variant-numeric:tabular-nums; }
.stkhll[hidden]{ display:none; }
.stkhll-grab{ display:none; }
.stkhll-hd{ flex:none; display:flex; align-items:center; min-height:48px; padding:0 4px 0 12px; border-bottom:1px solid var(--line-soft); }
.stkhll-ttl{ flex:1; min-width:0; display:flex; flex-direction:column; }
.stkhll-title{ font-size:15px; line-height:20px; font-weight:600; }
.stkhll-sub{ font-size:12px; line-height:16px; color:var(--ink-2); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.stkhll-ib{ flex:none; display:inline-flex; align-items:center; justify-content:center; width:44px; height:44px; padding:0; border:0; border-radius:50%; background:transparent; color:var(--ink-1, var(--ink-0)); cursor:pointer; }
.stkhll-ib:hover{ background:var(--bg-2); }
.stkhll-ctl{ flex:none; display:flex; align-items:center; justify-content:space-between; gap:8px; padding:4px 12px; border-bottom:1px solid var(--line-soft); }
.stkhll-pick{ display:flex; align-items:center; gap:8px; font-size:12px; color:var(--ink-2); min-width:0; }
.stkhll-pick select{ min-height:32px; max-width:150px; padding:0 8px; border-radius:8px; border:1px solid var(--line-soft); background:var(--bg-1, transparent); color:var(--ink-0); font:inherit; font-size:12px; }
.stkhll-sw{ display:flex; align-items:center; gap:8px; min-height:32px; font-size:12px; color:var(--ink-1, var(--ink-0)); cursor:pointer; white-space:nowrap; }
.stkhll-sw input{ width:16px; height:16px; accent-color:#03c988; margin:0; }
.stkhll-tabs{ display:none; }
.stkhll-heads{ flex:none; display:grid; grid-template-columns:repeat(3, 1fr); gap:4px; padding:8px 8px 8px; border-bottom:1px solid var(--line-soft); }
.stkhll-h{ display:flex; flex-direction:column; min-width:0; }
.stkhll-h b{ font-size:12px; line-height:16px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.stkhll-ht{ font-size:15px; line-height:20px; font-weight:600; }
.stkhll-hp{ font-size:11px; line-height:13px; color:var(--ink-2); white-space:nowrap; }
.stkhll-body{ position:relative; flex:1; min-height:0; overflow:hidden; }
.stkhll-body.is-aligned{ flex:none; height:var(--h, 0px); margin-top:var(--off, 0px); }
.stkhll-lane{ position:absolute; top:0; bottom:0; }
.stkhll-row{ position:absolute; left:0; right:0; display:flex; align-items:center; justify-content:space-between; gap:4px; padding:0 6px; border:0; border-radius:4px; background:none; color:var(--ink-0); font:500 11px/13px inherit; font-family:inherit; cursor:pointer; overflow:hidden; text-align:left; }
.stkhll-row:hover{ box-shadow:inset 0 0 0 1px var(--ink-2); }
.stkhll-row.is-big{ font-weight:700; box-shadow:inset 0 0 0 1px var(--ink-1, var(--ink-0)); }
.stkhll-bar{ position:absolute; left:0; top:0; bottom:0; border-radius:4px; pointer-events:none; }
.stkhll-v, .stkhll-p, .stkhll-px{ position:relative; white-space:nowrap; }
.stkhll-p{ color:var(--ink-1, var(--ink-0)); opacity:.75; font-weight:400; }
.stkhll-note{ margin:0; padding:16px 12px; color:var(--ink-2); font-size:13px; line-height:18px; }
.stkhll-hd, .stkhll-ctl, .stkhll-heads{ position:relative; z-index:2; background:var(--bg-0); }
.stkhll{ overflow:hidden; }
.stkhll-foot{ position:absolute; left:0; right:0; bottom:0; z-index:2; background:var(--bg-0); margin:0; padding:8px 12px; border-top:1px solid var(--line-soft); font-size:11px; line-height:13px; color:var(--ink-2); }
.stkhll-cov{ color:var(--ink-1, var(--ink-0)); }
:root[data-theme="light"] .stkhll{ --h-up:#047857; --h-dn:#c81e2e; }
@media (max-width:700px){
  .stkhll-fab{ top:40px; right:60px; min-height:36px; }
  .stkchart-panel.stkw-host.stkhll-open #vela-chart{ right:0; }
  .stkhll{ position:fixed; left:0; right:0; top:auto; bottom:var(--stkc-dock, 0px); width:auto; height:min(62vh, 520px); z-index:8005; border-left:0; border-top:1px solid var(--line-soft); border-radius:20px 20px 0 0; box-shadow:0 -8px 24px rgba(0,0,0,.35); font-size:14px; }
  .stkhll-grab{ display:block; flex:none; width:36px; height:4px; border-radius:2px; margin:8px auto 0; background:var(--line, rgba(255,255,255,.2)); }
  .stkhll-hd{ padding:0 8px 0 16px; } .stkhll-x{ background:var(--bg-2); }
  .stkhll-ctl{ padding:4px 16px; }
  .stkhll-pick select{ min-height:44px; } .stkhll-sw{ min-height:44px; }
  .stkhll-tabs{ display:flex; flex:none; margin:8px 16px 0; padding:2px; border-radius:8px; background:var(--bg-2); }
  .stkhll-tabs button{ flex:1; min-width:0; min-height:36px; padding:0 4px; border:0; border-radius:6px; background:none; color:var(--ink-2); font:500 13px/16px inherit; font-family:inherit; cursor:pointer; white-space:nowrap; }
  .stkhll-tabs button[aria-selected="true"]{ background:var(--bg-0); color:var(--ink-0); box-shadow:0 0 0 1px var(--line-soft); }
  .stkhll-heads.is-one{ grid-template-columns:1fr; padding:8px 16px; flex-direction:row; }
  .stkhll-heads.is-one .stkhll-h{ flex-direction:row; align-items:baseline; gap:8px; }
  .stkhll-body.is-list{ overflow:auto; overscroll-behavior:contain; padding:0 8px; }
  .stkhll-row.is-line{ position:relative; display:flex; width:100%; min-height:44px; height:auto; margin:2px 0; padding:0 12px; font-size:14px; line-height:18px; }
  .stkhll-px{ flex:1; font-weight:400; color:var(--ink-1, var(--ink-0)); }
  .stkhll-foot{ position:relative; padding:8px 16px calc(8px + env(safe-area-inset-bottom)); }
}
`;
if (typeof document !== 'undefined' && !document.getElementById('stk-hll-css')) { const st = document.createElement('style'); st.id = 'stk-hll-css'; st.textContent = CSS; document.head.appendChild(st); }
