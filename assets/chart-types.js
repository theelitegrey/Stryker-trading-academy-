// TradeZoro: the extra standard chart types (research + rules: stryker-notes/reports/workers/chart-types.md).
// Group 1 (time-based, one element per candle): Hollow candles, Volume candles, Line with markers, Step line,
// HLC area, Columns, High-low. Group 2/3 (price-based, built by assets/chart-types-math.js through a
// `derive` bar transform, see tools/vela-090-ctypes-patch.py): Renko, Range, Line break, Kagi, Point & Figure.
// Pattern copied from chart-footprint.js: registerChartType + one renderer layer per type (basePainting none).
// Education only. Not financial advice.
import { renko, range, lineBreak, kagi, pnf, sizeOf } from './chart-types-math.js?v=825';

export const CT_TIME = ['stk_hollow', 'stk_volcandle', 'stk_linemark', 'stk_step', 'stk_hlcarea', 'stk_columns', 'stk_highlow'];
export const CT_PRICE = ['stk_renko', 'stk_range', 'stk_linebreak', 'stk_kagi', 'stk_pnf'];
export const CT_ALL = CT_TIME.concat(CT_PRICE);

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
  stk_pnf: svg('<path d="M6 6l5 5M11 6l-5 5M6 12l5 5M11 12l-5 5"/><circle cx="19" cy="17" r="2.6"/><circle cx="19" cy="9" r="2.6" opacity="0"/><circle cx="19" cy="22.5" r="2.6" opacity="0"/>')
};
export const CT_LABELS = {
  stk_hollow: 'Hollow candles', stk_volcandle: 'Volume candles', stk_linemark: 'Line with markers', stk_step: 'Step line',
  stk_hlcarea: 'HLC area', stk_columns: 'Columns', stk_highlow: 'High-low',
  stk_renko: 'Renko', stk_range: 'Range', stk_linebreak: 'Line break', stk_kagi: 'Kagi', stk_pnf: 'Point & Figure'
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

function typeLayer(id) {
  let canvas = null;
  return {
    mount(c) { canvas = c; },
    render(a) {
      const f = a.priceStyle === id && a.bars.length ? frame(a, canvas) : null;
      if (!f) { const g = canvas && canvas.getContext('2d'); if (g && a.priceStyle !== id) { g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, canvas.width, canvas.height); } return; }
      try { DRAW[id](f, a); } finally { f.g.restore(); }
    },
    destroy() { canvas = null; }
  };
}

// ---------------------------------------------------------------- install
let installed = false;
export function installChartTypes(Core) {
  if (installed) return;
  installed = true;
  for (const id of CT_ALL) {
    if (!DRAW[id]) continue;   // later groups register themselves below
    Core.registerRendererLayer({ id, placement: 'above-data', create: () => typeLayer(id) });
    Core.registerChartType({ id, label: CT_LABELS[id], icon: CT_ICONS[id], basePainting: 'none' });
  }
}
