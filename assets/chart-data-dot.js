// Stryker Trading Academy — Charts data-status dot (ES module)
// Depends on: the Vela workspace built in assets/vela-chart.js (window.STRYKER_VELA) and its
// statusline DOM (.vela-cell[data-cell-id] .vela-statusline .vela-sl-symbol; the dot lives inside it); optional Rithmic
// module from assets/rithmic-config.js (rith.client: state + on()); assets/chart-futures-provider.js
// (FuturesProvider, used only to read the newest 1-minute bar for the lag measurement).
// Styles: .stkc-dd* in assets/style.css.
//
// Owner order 2026-10-05: "Add small yellow/green dot like tradingview to indicator live data
// or delayed data". One ~8 px dot right after the symbol name in every chart cell's legend:
//   green  #089981  real-time: crypto (Binance / Coinbase / Hyperliquid public streams), and
//                   futures while the member's own Rithmic connection is up (flag-gated).
//   amber  #F5A623  delayed: futures from our Yahoo-based /api/chart/bars. The lag is MEASURED
//                   (now minus the close of the newest 1-minute bar), never hard-coded.
//   grey   #787B86  futures outside CME Globex hours (Sun 18:00 to Fri 17:00 New York, daily
//                   17:00-18:00 break; no exchange-holiday calendar), with the next open in IST.
// Hover (desktop) or tap (phone) shows a short plain tooltip. The word "delayed" is allowed
// here (Owner asked for it); the GEX wording ban is GEX-only.

const H = 3600;
const LAG_TTL_MS = 60000;        // re-measure each futures root at most once a minute
const TICK_MS = 30000;           // re-check open/closed and lag
const CRYPTO = /^(binance|coinbase|hyperliquid):/i;
const FUT = /^futures:/i;

let nyFmt = null;
function nyParts(ms) {
  if (!nyFmt) nyFmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', weekday: 'short', hour: 'numeric', minute: 'numeric' });
  const o = {};
  nyFmt.formatToParts(new Date(ms)).forEach((p) => { o[p.type] = p.value; });
  return { dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(o.weekday), min: (+o.hour % 24) * 60 + (+o.minute) };
}
// CME Globex (mirrors globexOpen in functions/api/chart/_bars.js).
export function globexOpen(ms) {
  const { dow, min } = nyParts(ms);
  if (dow === 6) return false;
  if (dow === 0) return min >= 18 * 60;
  if (dow === 5) return min < 17 * 60;
  return !(min >= 17 * 60 && min < 18 * 60);
}
// Next open, epoch ms. Every Globex open is at 18:00 New York, so 15-minute steps land on it.
export function nextOpen(ms) {
  let t = Math.ceil(ms / 900000) * 900000;
  for (let i = 0; i < 400; i++, t += 900000) if (globexOpen(t)) return t;
  return null;
}
let istFmt = null;
function istLabel(ms) {
  if (!istFmt) istFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' });
  const same = day.format(new Date(ms)) === day.format(new Date(Date.now()));
  const parts = {};
  istFmt.formatToParts(new Date(ms)).forEach((p) => { parts[p.type] = p.value; });
  return (same ? 'today' : parts.weekday) + ' ' + parts.hour + ':' + parts.minute;
}

export function installDataDot(ws, opts = {}) {
  const rith = opts.rith || null;
  const Futures = opts.FuturesProvider;
  const probe = Futures ? new Futures() : null;
  const lag = new Map();           // root -> { at, min }  (min null = could not measure)
  const pending = new Set();

  const tip = document.createElement('div');
  tip.className = 'stkc-dd-tip';
  tip.setAttribute('role', 'tooltip');
  tip.id = 'stkc-dd-tip';
  tip.hidden = true;
  document.body.appendChild(tip);
  let tipFor = null;

  const rootOf = (sym) => String(sym || '').replace(/^[a-z]+:/i, '').replace(/1!$/, '').toUpperCase();
  const rithLive = () => { try { return !!(rith && rith.client && rith.client.state === 'connected'); } catch (e) { return false; } };

  function measure(root) {
    if (!probe || pending.has(root)) return;
    const hit = lag.get(root);
    if (hit && Date.now() - hit.at < LAG_TTL_MS) return;
    pending.add(root);
    probe.getBars(root + '1!', '1', { limit: 1 }).then((bars) => {
      const b = bars && bars[bars.length - 1];
      let min = null;
      if (b && b.time) {
        const behind = (Date.now() - (b.time + 60000)) / 60000;  // newest bar's close vs now
        if (behind > -1 && behind <= 30) min = Math.max(1, Math.round(behind));
      }
      lag.set(root, { at: Date.now(), min });
    }).catch(() => { lag.set(root, { at: Date.now(), min: null }); })
      .finally(() => { pending.delete(root); schedule(); });
  }

  function statusOf(sym) {
    sym = String(sym || '');
    if (CRYPTO.test(sym)) return { s: 'rt', text: 'Real-time data' };
    if (!FUT.test(sym) && !/^[A-Z0-9]+1!$/i.test(sym)) return null;
    const now = Date.now();
    if (!globexOpen(now)) {
      const n = nextOpen(now);
      return { s: 'closed', text: 'Market closed' + (n ? ' · opens ' + istLabel(n) + ' IST' : '') };
    }
    if (rithLive()) return { s: 'rt', text: 'Real-time data' };
    const root = rootOf(sym);
    measure(root);
    const m = lag.get(root);
    return { s: 'delayed', text: 'Delayed data' + (m && m.min ? ' · about ' + m.min + ' min' : '') };
  }

  function showTip(dot) {
    tipFor = dot;
    tip.textContent = dot.dataset.tip || '';
    tip.hidden = false;
    const r = dot.getBoundingClientRect();
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let left = Math.round(r.left + r.width / 2 - w / 2);
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    let top = Math.round(r.bottom + 8);
    if (top + h > window.innerHeight - 8) top = Math.round(r.top - h - 8);
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }
  function hideTip() { tip.hidden = true; tipFor = null; }

  function makeDot() {
    const d = document.createElement('button');
    d.type = 'button';
    d.className = 'stkc-dd';
    d.setAttribute('aria-describedby', 'stkc-dd-tip');
    d.addEventListener('mouseenter', () => showTip(d));
    d.addEventListener('mouseleave', () => { if (tipFor === d && !d.dataset.pinned) hideTip(); });
    d.addEventListener('focus', () => showTip(d));
    d.addEventListener('blur', () => { delete d.dataset.pinned; if (tipFor === d) hideTip(); });
    // Tap (phone) toggles a pinned popover. Keep the tap away from Vela's own statusline handlers.
    ['pointerdown', 'mousedown', 'touchstart'].forEach((ev) => d.addEventListener(ev, (e) => e.stopPropagation(), { passive: true }));
    d.addEventListener('click', (e) => {
      e.stopPropagation();
      if (tipFor === d && d.dataset.pinned) { delete d.dataset.pinned; hideTip(); return; }
      d.dataset.pinned = '1';
      showTip(d);
    });
    return d;
  }

  function sync() {
    let cells = [];
    try { cells = ws.context().cells; } catch (e) { return; }
    const bySym = {};
    cells.forEach((c) => { bySym[c.id] = c.symbol; });
    document.querySelectorAll('#vela-chart .vela-cell[data-cell-id]').forEach((cell) => {
      const sl = cell.querySelector('.vela-statusline');
      const symEl = sl && sl.querySelector('.vela-sl-symbol');
      let dot = sl && sl.querySelector('.stkc-dd');
      const st = symEl ? statusOf(bySym[cell.getAttribute('data-cell-id')]) : null;
      if (!st) { if (dot) dot.remove(); return; }
      if (!dot) dot = makeDot();
      // Inside the ticker span (Vela's setSymbol rewrites its text, the observer re-adds the dot),
      // so Vela's own layout (mobile grid, multi-chart fit) measures the dot with the ticker.
      if (dot.parentNode !== symEl || symEl.lastChild !== dot) symEl.appendChild(dot);
      if (dot.dataset.s !== st.s) dot.dataset.s = st.s;
      if (dot.dataset.tip !== st.text) {
        dot.dataset.tip = st.text;
        dot.setAttribute('aria-label', st.text);
        if (tipFor === dot) showTip(dot);
      }
    });
    if (tipFor && !tipFor.isConnected) hideTip();
  }

  let raf = 0;
  function schedule() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; sync(); }); }

  const host = document.getElementById('vela-chart');
  // Vela rebuilds statusline pieces on symbol / layout changes: re-attach on any DOM change.
  if (host) new MutationObserver(schedule).observe(host, { childList: true, subtree: true });
  ['state:changed', 'layout:changed', 'cell:active'].forEach((ev) => { try { ws.on(ev, schedule); } catch (e) {} });
  if (rith && rith.client && rith.client.on) { try { rith.client.on((ev) => { if (ev && ev.type === 'state') schedule(); }); } catch (e) {} }
  // Market open/close and the lag re-measure: a light timer, plus straight away when the tab returns.
  setInterval(() => { if (!document.hidden) sync(); }, TICK_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
  document.addEventListener('click', (e) => { if (tipFor && !(e.target && e.target.closest && e.target.closest('.stkc-dd'))) { delete tipFor.dataset.pinned; hideTip(); } });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && tipFor) { delete tipFor.dataset.pinned; hideTip(); } });
  window.addEventListener('resize', hideTip, { passive: true });
  sync();

  const api = { sync, statusOf, lag, globexOpen, nextOpen };
  window.STRYKER_DATA_DOT = api;
  return api;
}
