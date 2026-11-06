// TradeZoro: the extra standard chart types (research + rules: stryker-notes/reports/workers/chart-types.md).
// Group 1 (time-based, one element per candle): Hollow candles, Volume candles, Line with markers, Step line,
// HLC area, Columns, High-low. Group 2/3 (price-based, built by assets/chart-types-math.js through a
// `derive` bar transform, see tools/vela-090-ctypes-patch.py): Renko, Range, Line break, Kagi, Point & Figure.
// Pattern copied from chart-footprint.js: registerChartType + one renderer layer per type (basePainting none).
// Education only. Not financial advice.
import { renko, range, lineBreak, kagi, pnf, sizeOf, guessTick } from './chart-types-math.js?v=898';
import { tpoProfile, tpoLetter, autoRow, rthKey } from './chart-of-pro-data.js?v=898';

export const CT_TIME = ['stk_hollow', 'stk_volcandle', 'stk_linemark', 'stk_step', 'stk_hlcarea', 'stk_columns', 'stk_highlow'];
export const CT_PRICE = ['stk_renko', 'stk_range', 'stk_linebreak', 'stk_kagi', 'stk_pnf'];
export const CT_PRO = ['stk_tpoc', 'stk_svp'];   // Pro, like the order-flow tools they reuse
export const CT_ALL = CT_TIME.concat(CT_PRICE, CT_PRO);

const svg = (inner) => '<svg viewBox="0 0 28 28" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>';
export const CT_ICONS = {
  stk_hollow: svg('<path d="M9 5v3M9 18v4M19 8v3M19 19v3"/><rect x="6.5" y="8" width="5" height="10" rx="1"/><rect x="16.5" y="11" width="5" height="8" rx="1" fill="currentColor" stroke="none"/>'),
  stk_volcandle: svg('<path d="M7 5v4M7 20v3M20 7v3M20 17v5"/><rect x="4" y="9" width="6" height="11" rx="1"/><rect x="15" y="10" width="10" height="7" rx="1" fill="currentColor" stroke="none"/>'),
  stk_linemark: svg('<path d="M4 20l6-7 5 4 9-10"/><circle cx="4" cy="20" r="1.6" fill="currentColor"/><circle cx="10" cy="13" r="1.6" fill="currentColor"/><circle cx="15" cy="17" r="1.6" fill="currentColor"/><circle cx="24" cy="7" r="1.6" fill="currentColor"/>'),
  stk_step: svg('<path d="M4 20h5v-6h6v4h4V8h5"/>'),
  stk_hlcarea: svg('<path d="M4 18l6-5 5 3 9-8" /><path d="M4 22l6-6 5 3 9-7V6L15 14l-5-3-6 3z" fill="currentColor" fill-opacity=".18" stroke="none"/>'),
  stk_columns: svg('<path d="M6 23V13M11 23V9M16 23V15M21 23V6"/><path d="M4 23h21" stroke-width="1"/>'),
  stk_highlow: svg('<path d="M7 5v18M14 9v13M21 4v15"/><path d="M5 5h4M12 9h4M19 4h4" stroke-width="1" opacity=".0"/>'),
  stk_renko: svg('<rect x="5" y="15" width="5" height="5" rx=".8"/><rect x="10" y="10" width="5" height="5" rx=".8" fill="currentColor" stroke="none"/><rect x="15" y="5" width="5" height="5" rx=".8" fill="currentColor" stroke="none"/><rect x="20" y="10" width="4" height="5" rx=".8"/>'),
  stk_range: svg('<path d="M6 6v12M12 10v13M18 5v14M24 9v12"/><path d="M4 6h4M10 10h4M16 5h4M22 9h4" opacity="0"/>'),
  stk_linebreak: svg('<rect x="5" y="15" width="5" height="6" rx=".8"/><rect x="11" y="11" width="5" height="9" rx=".8" fill="currentColor" stroke="none"/><rect x="17" y="6" width="5" height="9" rx=".8" fill="currentColor" stroke="none"/><rect x="22" y="13" width="3" height="9" rx=".8"/>'),
  stk_kagi: svg('<path d="M5 20v-8h6V6h6v14h6v-9"/>'),
  stk_tpoc: svg('<path d="M5 6h6M5 11h10M5 16h14M5 21h8"/><path d="M19 6v16" opacity=".35"/>'),
  stk_svp: svg('<path d="M5 5v18"/><path d="M5 7h7M5 11h13M5 15h9M5 19h5" stroke-width="3"/>'),
  stk_pnf: svg('<path d="M6 6l5 5M11 6l-5 5M6 12l5 5M11 12l-5 5"/><circle cx="19" cy="17" r="2.6"/><circle cx="19" cy="9" r="2.6" opacity="0"/><circle cx="19" cy="22.5" r="2.6" opacity="0"/>')
};
export const CT_LABELS = {
  stk_hollow: 'Hollow candles', stk_volcandle: 'Volume candles', stk_linemark: 'Line with markers', stk_step: 'Step line',
  stk_hlcarea: 'HLC area', stk_columns: 'Columns', stk_highlow: 'High-low',
  stk_renko: 'Renko', stk_range: 'Range', stk_linebreak: 'Line break', stk_kagi: 'Kagi', stk_pnf: 'Point & Figure',
  stk_tpoc: 'Time price opportunity', stk_svp: 'Session volume profile'
};

// ---------------------------------------------------------------- drawing
const alpha = (hex, a) => {
  const m = /^#?([0-9a-f]{6})/i.exec(String(hex || ''));
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
};
const px = (v, dpr) => Math.round(v * dpr) / dpr;

function frame(a, canvas) {
  const g = canvas && canvas.getContext('2d');
  if (!g) return null;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, canvas.width, canvas.height);
  const co = a.coords, dpr = co.dpr || 1;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const vr = co.visibleLogicalRange();
  const top = a.bounds.top, h = a.bounds.height;
  g.save(); g.beginPath(); g.rect(0, top, co.width, h); g.clip();
  return {
    g, co, dpr, top, bot: top + h,
    i0: Math.max(0, Math.floor(vr.from) - 1), i1: Math.min(a.bars.length - 1, Math.ceil(vr.to) + 1),
    X: (i) => co.logicalToX(i), Y: (p) => co.priceToY(p, a.scale, a.bounds),
    up: a.theme.upColor || '#089981', dn: a.theme.downColor || '#f23645',
    sp: co.bodySpacing(), pitch: co.pxPerBar()
  };
}
const bodyW = (sp) => { let w = Math.max(1, Math.round(sp * 0.78)); if (w % 2 === 0) w -= 1; return Math.max(1, w); };
// close vs previous close (the first bar: vs its own open)
const upVs = (bars, i) => (i > 0 ? bars[i].close >= bars[i - 1].close : bars[i].close >= bars[i].open);

const DRAW = {
  stk_hollow(f, a) {
    const { g, X, Y, dpr } = f, w = bodyW(f.sp);
    for (let i = f.i0; i <= f.i1; i++) {
      const b = a.bars[i]; if (!b) continue;
      const col = upVs(a.bars, i) ? f.up : f.dn, x = X(i);
      g.fillStyle = col; g.strokeStyle = col;
      const hY = Y(b.high), lY = Y(b.low), oY = Y(b.open), cY = Y(b.close);
      const yT = px(Math.min(oY, cY), dpr), yB = Math.max(px(Math.max(oY, cY), dpr), yT + 1 / dpr);
      const wx = Math.round(x * dpr) / dpr - 0.5 / dpr * Math.max(1, Math.floor(dpr));
      g.fillRect(wx, px(hY, dpr), Math.max(1, Math.floor(dpr)) / dpr, px(lY, dpr) - px(hY, dpr));
      if (f.sp < 3) continue;
      const bx = Math.round(x - w / 2);
      if (b.close > b.open) { g.lineWidth = 1; g.strokeRect(bx + 0.5, yT + 0.5, w - 1, Math.max(0, yB - yT - 1)); }
      else g.fillRect(bx, yT, w, yB - yT);
    }
  },
  stk_volcandle(f, a) {
    const { g, X, Y, dpr } = f;
    let vmax = 0;
    for (let i = f.i0; i <= f.i1; i++) { const v = a.bars[i] && a.bars[i].volume; if (v > vmax) vmax = v; }
    for (let i = f.i0; i <= f.i1; i++) {
      const b = a.bars[i]; if (!b) continue;
      const frac = b.volume != null && vmax > 0 ? 0.2 + 0.8 * Math.sqrt(b.volume / vmax) : 0.6;   // sqrt keeps thin bars readable
      let w = Math.max(1, Math.round(f.pitch * 0.96 * frac)); if (w % 2 === 0) w += 1;
      const col = b.close >= b.open ? f.up : f.dn, x = X(i);
      g.fillStyle = col;
      const wd = Math.max(1, Math.floor(dpr)) / dpr, wx = Math.round(x * dpr) / dpr - wd / 2;
      g.fillRect(wx, px(Y(b.high), dpr), wd, px(Y(b.low), dpr) - px(Y(b.high), dpr));
      const oY = Y(b.open), cY = Y(b.close), yT = px(Math.min(oY, cY), dpr);
      g.fillRect(Math.round(x - w / 2), yT, w, Math.max(1 / dpr, px(Math.max(oY, cY), dpr) - yT));
    }
  },
  stk_linemark(f, a) {
    const { g, X, Y } = f;
    const col = f.up;
    g.strokeStyle = col; g.lineWidth = 2; g.lineJoin = 'round'; g.beginPath();
    let first = true;
    for (let i = Math.max(0, f.i0 - 1); i <= Math.min(a.bars.length - 1, f.i1 + 1); i++) { const x = X(i), y = Y(a.bars[i].close); if (first) { g.moveTo(x, y); first = false; } else g.lineTo(x, y); }
    g.stroke();
    if (f.pitch >= 5) {
      const r = Math.min(4.5, Math.max(2, f.pitch / 5));
      const bg = a.theme.background || '#0f0f0f';
      for (let i = f.i0; i <= f.i1; i++) { const b = a.bars[i]; if (!b) continue; g.beginPath(); g.arc(X(i), Y(b.close), r, 0, 6.2832); g.fillStyle = bg; g.fill(); g.lineWidth = 1.6; g.strokeStyle = col; g.stroke(); }
    }
  },
  stk_step(f, a) {
    const { g, X, Y } = f;
    g.strokeStyle = f.up; g.lineWidth = 2; g.lineJoin = 'miter'; g.beginPath();
    let first = true, py = 0;
    for (let i = Math.max(0, f.i0 - 1); i <= Math.min(a.bars.length - 1, f.i1 + 1); i++) {
      const x = X(i), y = Y(a.bars[i].close);
      if (first) { g.moveTo(x, y); first = false; } else { g.lineTo(x, py); g.lineTo(x, y); }   // hold the last close to the next bar, then step
      py = y;
    }
    g.stroke();
  },
  stk_hlcarea(f, a) {
    const { g, X, Y } = f;
    const lo = Math.max(0, f.i0 - 1), hi = Math.min(a.bars.length - 1, f.i1 + 1);
    g.beginPath();
    for (let i = lo; i <= hi; i++) { const x = X(i), y = Y(a.bars[i].high); if (i === lo) g.moveTo(x, y); else g.lineTo(x, y); }
    for (let i = hi; i >= lo; i--) g.lineTo(X(i), Y(a.bars[i].low));
    g.closePath(); g.fillStyle = alpha(f.up, 0.2); g.fill();
    g.lineWidth = 1; g.strokeStyle = alpha(f.up, 0.55);
    for (const key of ['high', 'low']) { g.beginPath(); for (let i = lo; i <= hi; i++) { const x = X(i), y = Y(a.bars[i][key]); if (i === lo) g.moveTo(x, y); else g.lineTo(x, y); } g.stroke(); }
    g.lineWidth = 2; g.strokeStyle = f.up; g.beginPath();
    for (let i = lo; i <= hi; i++) { const x = X(i), y = Y(a.bars[i].close); if (i === lo) g.moveTo(x, y); else g.lineTo(x, y); }
    g.stroke();
  },
  stk_columns(f, a) {
    const { g, X, Y, dpr } = f, w = Math.max(1, Math.round(f.pitch * 0.8));
    for (let i = f.i0; i <= f.i1; i++) {
      const b = a.bars[i]; if (!b) continue;
      const y = px(Y(b.close), dpr);
      g.fillStyle = upVs(a.bars, i) ? f.up : f.dn;
      g.fillRect(Math.round(X(i) - w / 2), y, w, f.bot - y);
    }
  },
  stk_highlow(f, a) {
    const { g, X, Y, dpr } = f, w = Math.max(1, Math.round(f.pitch * 0.5));
    for (let i = f.i0; i <= f.i1; i++) {
      const b = a.bars[i]; if (!b) continue;
      g.fillStyle = upVs(a.bars, i) ? f.up : f.dn;
      const y0 = px(Y(b.high), dpr);
      g.fillRect(Math.round(X(i) - w / 2), y0, w, Math.max(1 / dpr, px(Y(b.low), dpr) - y0));
    }
  }
};

const FIT = new Set(['stk_renko', 'stk_range', 'stk_linebreak', 'stk_kagi', 'stk_pnf']);
function typeLayer(id) {
  let canvas = null, fitted = false;
  return {
    mount(c) { canvas = c; },
    render(a) {
      if (a.priceStyle !== id) fitted = false;
      else { try { window.__stkCT = { id, bars: a.bars }; } catch (e) {} }
      // Price-based types have far fewer elements than candles: on first paint open them wide enough to read.
      if (a.priceStyle === id && FIT.has(id) && !fitted && a.bars.length > 3) {
        fitted = true;
        try {
          const co = a.coords, vp = co.getViewport();
          const want = Math.max(id === 'stk_pnf' ? 16 : 7, Math.min(28, Math.floor((co.width - 70) / (a.bars.length + 6))));
          const rr = window.STRYKER_VELA && window.STRYKER_VELA.chart && window.STRYKER_VELA.chart.renderer;
          const ctl = rr && (rr.applyViewport ? rr : rr.renderer);
          if (ctl && ctl.applyViewport && Math.abs(vp.barSpacing - want) > 1) ctl.applyViewport({ barSpacing: want, rightOffset: Math.max(vp.rightOffset, 4) });
        } catch (e) {}
      }
      const f = a.priceStyle === id && a.bars.length ? frame(a, canvas) : null;
      if (!f) { const g = canvas && canvas.getContext('2d'); if (g && a.priceStyle !== id) { g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, canvas.width, canvas.height); } return; }
      try { DRAW[id](f, a); } finally { f.g.restore(); }
    },
    destroy() { canvas = null; }
  };
}

// ---------------------------------------------------------------- price-based types (derive transforms)
const NUM = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
const PB_DEF = { method: 'atr', atrLen: 14, fixed: 0, pct: 1, ticks: 10, source: 'close', rev: 3, lines: 3 };
const opts = (s) => Object.assign({}, PB_DEF, s || {});
// the size comes from the finished bars (not the forming one), so it stays put between ticks
const sizeFor = (raw, o) => sizeOf(raw.length > 20 ? raw.slice(0, -1) : raw, o.fixed > 0 ? Object.assign({}, o, { method: 'fixed' }) : o);
const DERIVE = {
  stk_renko: { derive: true, full: (raw, s) => { const o = opts(s); return renko(raw, sizeFor(raw, o), o.source); }, next: (b) => b },
  stk_range: { derive: true, full: (raw, s) => { const o = opts(s); return range(raw, sizeFor(raw, o)); }, next: (b) => b },
  stk_linebreak: { derive: true, full: (raw, s) => lineBreak(raw, opts(s).lines), next: (b) => b },
  stk_kagi: { derive: true, full: (raw, s) => { const o = opts(s); return kagi(raw, sizeFor(raw, o), o.source); }, next: (b) => b },
  stk_pnf: { derive: true, full: (raw, s) => { const o = opts(s); return pnf(raw, sizeFor(raw, o), o.rev, o.source); }, next: (b) => b }
};
const M_OPTS = [['atr', 'ATR (adapts to the symbol)'], ['fixed', 'Fixed size'], ['pct', 'Percent of price']];
const rowsSize = (what, extra) => [
  { kind: 'select', key: 'method', label: what + ' size method', defval: 'atr', options: M_OPTS.concat(extra || []) },
  { kind: 'number', key: 'atrLen', label: 'ATR length', defval: 14, min: 1, max: 200, step: 1 },
  { kind: 'number', key: 'fixed', label: 'Fixed size in price (0 = use the method above)', defval: 0, min: 0, max: 1e9, step: 0.01 },
  { kind: 'number', key: 'pct', label: 'Percent of last price', defval: 1, min: 0.01, max: 50, step: 0.01 }
];
const SRC = { kind: 'select', key: 'source', label: 'Source', defval: 'close', options: [['close', 'Close'], ['hl', 'High / low']] };
const SETTINGS = {
  stk_renko: { title: 'Renko', rows: rowsSize('Brick').concat([SRC]) },
  stk_range: { title: 'Range bars', rows: rowsSize('Range', [['ticks', 'Ticks']]).concat([{ kind: 'number', key: 'ticks', label: 'Range in ticks (method: Ticks)', defval: 10, min: 1, max: 100000, step: 1 }]) },
  stk_linebreak: { title: 'Line break', rows: [{ kind: 'number', key: 'lines', label: 'Number of lines', defval: 3, min: 1, max: 12, step: 1 }] },
  stk_kagi: { title: 'Kagi', rows: rowsSize('Reversal').concat([SRC]) },
  stk_pnf: { title: 'Point & Figure', rows: rowsSize('Box').concat([{ kind: 'number', key: 'rev', label: 'Reversal (boxes)', defval: 3, min: 1, max: 10, step: 1 }, SRC]) }
};
Object.assign(DRAW, {
  // bricks / lines: filled boxes, corners touching (Renko, Line break)
  stk_renko: (f, a) => boxes(f, a),
  stk_linebreak: (f, a) => boxes(f, a),
  stk_range(f, a) {
    const { g, X, Y, dpr } = f, w = bodyW(f.sp);
    for (let i = f.i0; i <= f.i1; i++) {
      const b = a.bars[i]; if (!b) continue;
      const col = b.close >= b.open ? f.up : f.dn, x = X(i);
      g.fillStyle = col;
      const wd = Math.max(1, Math.floor(dpr)) / dpr;
      g.fillRect(Math.round(x * dpr) / dpr - wd / 2, px(Y(b.high), dpr), wd, px(Y(b.low), dpr) - px(Y(b.high), dpr));
      const oY = Y(b.open), cY = Y(b.close), yT = px(Math.min(oY, cY), dpr);
      g.fillRect(Math.round(x - w / 2), yT, w, Math.max(1 / dpr, px(Math.max(oY, cY), dpr) - yT));
    }
  },
  stk_kagi(f, a) {
    const { g, X, Y } = f, lo = Math.max(0, f.i0 - 1), hi = Math.min(a.bars.length - 1, f.i1 + 1);
    const thick = Math.max(2.5, Math.min(5, f.pitch / 3)), thin = 1.4;
    g.lineCap = 'butt';
    const seg = (x0, y0, x1, y1, yang) => { g.strokeStyle = yang ? f.up : f.dn; g.lineWidth = yang ? thick : thin; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); };
    for (let i = lo; i <= hi; i++) {
      const b = a.bars[i]; if (!b) continue;
      const x = X(i), yO = Y(b.open), yC = Y(b.close);
      if (i > 0) seg(X(i - 1), yO, x, yO, b.thick0);   // the shoulder / waist joining the strokes
      if (b.brk != null) { const yB = Y(b.brk); seg(x, yO, x, yB, b.thick0); seg(x, yB, x, yC, b.thick1); } else seg(x, yO, x, yC, b.thick0);
    }
  },
  stk_pnf(f, a) {
    const { g, X, Y } = f;
    for (let i = f.i0; i <= f.i1; i++) {
      const b = a.bars[i]; if (!b) continue;
      const bh = Math.abs(Y(b.low) - Y(b.low + b.box)), s = Math.min(bh, f.pitch) * 0.78, x = X(i);
      if (s < 3) { g.fillStyle = b.up ? f.up : f.dn; g.fillRect(x - 1, Y(b.high), 2, Y(b.low) - Y(b.high)); continue; }
      g.lineWidth = Math.max(1.2, Math.min(2, s / 7)); g.strokeStyle = b.up ? f.up : f.dn;
      for (let k = 0; k < b.boxes; k++) {
        const yc = Y(b.low + (k + 0.5) * b.box);
        g.beginPath();
        if (b.up) { g.moveTo(x - s / 2, yc - s / 2); g.lineTo(x + s / 2, yc + s / 2); g.moveTo(x + s / 2, yc - s / 2); g.lineTo(x - s / 2, yc + s / 2); }
        else g.ellipse(x, yc, s / 2, s / 2, 0, 0, 6.2832);
        g.stroke();
      }
    }
  }
});
function boxes(f, a) {
  const { g, X, Y, dpr } = f, w = Math.max(1, Math.round(f.pitch * 0.92));
  for (let i = f.i0; i <= f.i1; i++) {
    const b = a.bars[i]; if (!b) continue;
    g.fillStyle = b.close >= b.open ? f.up : f.dn;
    const y0 = px(Y(b.high), dpr), y1 = px(Y(b.low), dpr);
    g.fillRect(Math.round(X(i) - w / 2), y0, w, Math.max(1 / dpr, y1 - y0));
  }
}

// ---------------------------------------------------------------- group 4: TPO + session volume profile (Pro)
const FUT = /^(MNQ|NQ|MES|ES|MYM|YM|MGC|GC|SIL|SI|MCL|CL|RTY|M2K)\d*!?$/i;
const isFut = () => { try { const sym = String(window.STRYKER_VELA.active.symbol || '').replace(/^.*:/, ''); return FUT.test(sym); } catch (e) { return false; } };
const lightPage = () => { try { return document.documentElement.getAttribute('data-theme') === 'light'; } catch (e) { return false; } };
const TPO_IN = '#9aa3ad', TPO_OUT = '#3f8f9a', MAGENTA = '#e040fb', VAL_LN = '#8fd8dc';
function sessionsOf(bars, fut) {   // futures: the regular session (New York day); everything else: the UTC day
  const out = []; let cur = null;
  bars.forEach((b, i) => {
    const k = fut ? rthKey(b.time) : Math.floor(b.time / 86400000);
    if (k == null) { cur = null; return; }
    if (!cur || cur.k !== k) { cur = { k, i0: i, i1: i }; out.push(cur); } else cur.i1 = i;
  });
  return out;
}
// session volume histogram: each candle's volume spread evenly over the rows it touched; POC + value area as in the TPO maths
function volProfile(bars, row, va) {
  let lo = Infinity, hi = -Infinity;
  for (const b of bars) { lo = Math.min(lo, b.low); hi = Math.max(hi, b.high); }
  const r0 = Math.floor(lo / row + 1e-9), n = Math.floor(hi / row + 1e-9) - r0 + 1, vol = new Float64Array(n);
  for (const b of bars) {
    const a = Math.floor(b.low / row + 1e-9) - r0, z = Math.floor(b.high / row + 1e-9) - r0, v = (b.volume || 0) / (z - a + 1);
    for (let k = a; k <= z; k++) vol[k] += v;
  }
  let total = 0, pk = 0;
  for (let k = 0; k < n; k++) { total += vol[k]; if (vol[k] > vol[pk]) pk = k; }
  let a = pk, z = pk, acc = vol[pk];
  while (acc < total * va / 100 && (a > 0 || z < n - 1)) {
    const up = z < n - 1 ? vol[z + 1] : -1, dn = a > 0 ? vol[a - 1] : -1;
    if (up >= dn) { z++; acc += up; } else { a--; acc += dn; }
  }
  return { r0, n, vol, max: vol[pk], poc: pk, val: a, vah: z };
}
function notePill(f, txt) {
  const { g, co } = f; g.font = '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  const w = Math.round(g.measureText(txt).width + 20), x = Math.round((co.width - 56 - w) / 2), y = Math.round(f.bot - 60);
  g.fillStyle = lightPage() ? 'rgba(255,255,255,.94)' : 'rgba(15,15,15,.88)'; g.strokeStyle = 'rgba(128,128,128,.35)';
  g.beginPath(); if (g.roundRect) g.roundRect(x + .5, y + .5, w, 22, 11); else g.rect(x + .5, y + .5, w, 22); g.fill(); g.stroke();
  g.fillStyle = lightPage() ? '#334155' : '#cbd5e1'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(txt, x + w / 2, y + 11.5);
}
function profileDraw(kind) {
  const memo = new Map();
  return (f, a) => {
    const { g, co, X, Y } = f, bars = a.bars, tf = bars.length > 2 ? bars[2].time - bars[1].time : 60000;
    const settings = a.settings || {}, va = NUM(+settings.va, 70), periodMin = NUM(+settings.block, 30);
    if (kind === 'tpo' && tf > periodMin * 60000) { notePill(f, 'Time price opportunity needs a chart timeframe of ' + periodMin + ' min or less'); return; }
    const fut = isFut(), tick = guessTick(bars), phone = co.width < 520, ink = lightPage() ? '#0f172a' : '#e8ecf1';
    const vr = co.visibleLogicalRange(), i0 = Math.max(0, Math.floor(vr.from)), i1 = Math.min(bars.length - 1, Math.ceil(vr.to));
    const key = bars.length + '|' + bars[0].time + '|' + fut; let ss = memo.get('s'); if (!ss || ss.key !== key) { ss = { key, list: sessionsOf(bars, fut) }; memo.set('s', ss); }
    const tickPx = Math.abs(Y(tick) - Y(0));
    // close line behind the profile, so price is still readable
    g.strokeStyle = lightPage() ? 'rgba(15,23,42,.35)' : 'rgba(209,212,220,.35)'; g.lineWidth = 1; g.beginPath();
    for (let i = Math.max(0, i0 - 1); i <= Math.min(bars.length - 1, i1 + 1); i++) { const x = X(i), y = Y(bars[i].close); if (i === Math.max(0, i0 - 1)) g.moveTo(x, y); else g.lineTo(x, y); }
    g.stroke();
    for (const s of ss.list) {
      if (s.i1 < i0 || s.i0 > i1) continue;
      const sb = bars.slice(s.i0, s.i1 + 1); let hi = -Infinity, lo = Infinity;
      for (const b of sb) { hi = Math.max(hi, b.high); lo = Math.min(lo, b.low); }
      let row = autoRow(hi - lo, tick, 40);
      for (let guard = 0; guard < 12 && (row / tick) * tickPx < (kind === 'tpo' ? (phone ? 9 : 11) : 4); guard++) row *= 2;
      const x0 = Math.max(X(s.i0) - f.pitch / 2, 8), x1 = X(s.i1) + f.pitch / 2;
      if (x1 < 0 || x0 > co.width) continue;
      const last = s.i1 >= bars.length - 1, span = Math.max(30, (x1 - x0) * 0.9);
      if (kind === 'tpo') {
        const p = tpoProfile(sb, { periodMs: periodMin * 60000, row, va, ibPeriods: 2 }); if (!p) continue;
        const maxC = Math.max(...p.counts), cellW = Math.min(phone ? 9 : 11, span / Math.max(1, maxC));
        const rowPx = Math.abs(Y(row) - Y(0)), letters = rowPx >= (phone ? 9 : 11) && cellW >= (phone ? 6 : 7);
        const fs = Math.max(7, Math.min(phone ? 9 : 11, Math.floor(Math.min(rowPx * .85, cellW * 1.2))));
        g.font = '600 ' + fs + 'px "JetBrains Mono", ui-monospace, monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
        for (let k = 0; k < p.n; k++) {
          if (!p.counts[k]) continue;
          const yT = Y((p.r0 + k + 1) * row), yB = Y((p.r0 + k) * row), y = Math.min(yT, yB), h = Math.abs(yB - yT);
          const c = k === p.poc ? MAGENTA : k >= p.val && k <= p.vah ? TPO_IN : TPO_OUT;
          p.cols[k].forEach((per, j) => {
            g.fillStyle = alpha(c, k === p.poc ? 0.95 : 0.6); g.fillRect(x0 + cellW * j + .5, y + .5, Math.max(1, cellW - 1), Math.max(1, h - 1));
            if (letters) { g.fillStyle = k === p.poc ? '#fff' : ink; g.fillText(tpoLetter(per), x0 + cellW * (j + .5), y + h / 2); }
          });
        }
        const ln = (k, c, w, d) => { const y = Y((p.r0 + k + .5) * row); g.setLineDash(d); g.strokeStyle = c; g.lineWidth = w; g.beginPath(); g.moveTo(x0, y); g.lineTo(last ? co.width : x1, y); g.stroke(); g.setLineDash([]); };
        ln(p.poc, alpha(MAGENTA, .9), 1.5, []); ln(p.vah, alpha(VAL_LN, .7), 1, [4, 3]); ln(p.val, alpha(VAL_LN, .7), 1, [4, 3]);
      } else {
        const p = volProfile(sb, row, va); if (!(p.max > 0)) continue;
        const wMax = Math.min(span, (x1 - x0) * 0.9);
        for (let k = 0; k < p.n; k++) {
          if (!p.vol[k]) continue;
          const yT = Y((p.r0 + k + 1) * row), yB = Y((p.r0 + k) * row), y = Math.min(yT, yB), h = Math.abs(yB - yT), w = wMax * p.vol[k] / p.max;
          const c = k === p.poc ? MAGENTA : k >= p.val && k <= p.vah ? '#f59e0b' : '#b8a15a';
          g.fillStyle = alpha(c, k === p.poc ? .95 : .7); g.fillRect(x0, y + (h > 3 ? .5 : 0), w, Math.max(1, h - (h > 3 ? 1 : 0)));
        }
        const ln = (k, c, w, d) => { const y = Y((p.r0 + k + .5) * row); g.setLineDash(d); g.strokeStyle = c; g.lineWidth = w; g.beginPath(); g.moveTo(x0, y); g.lineTo(last ? co.width : x1, y); g.stroke(); g.setLineDash([]); };
        ln(p.poc, alpha(MAGENTA, .9), 1.5, []); ln(p.vah, alpha(VAL_LN, .7), 1, [4, 3]); ln(p.val, alpha(VAL_LN, .7), 1, [4, 3]);
      }
    }
  };
}
DRAW.stk_tpoc = profileDraw('tpo');
DRAW.stk_svp = profileDraw('svp');
SETTINGS.stk_tpoc = { title: 'Time price opportunity', rows: [{ kind: 'select', key: 'block', label: 'Letter block (minutes)', defval: 30, options: [[5, '5'], [10, '10'], [15, '15'], [30, '30'], [60, '60']] }, { kind: 'number', key: 'va', label: 'Value area %', defval: 70, min: 10, max: 100, step: 1 }] };
SETTINGS.stk_svp = { title: 'Session volume profile', rows: [{ kind: 'number', key: 'va', label: 'Value area %', defval: 70, min: 10, max: 100, step: 1 }] };

// ---------------------------------------------------------------- install
let installed = false;
export function installChartTypes(Core) {
  if (installed) return;
  installed = true;
  for (const id of CT_ALL) {
    if (!DRAW[id]) continue;
    Core.registerRendererLayer({ id, placement: 'above-data', create: () => typeLayer(id) });
    const def = { id, label: CT_LABELS[id], icon: CT_ICONS[id], basePainting: 'none' };
    if (DERIVE[id]) def.barTransform = DERIVE[id];
    if (SETTINGS[id]) def.settings = SETTINGS[id];
    Core.registerChartType(def);
  }
}
