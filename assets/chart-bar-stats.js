// TradeZoro — Charts: BAR STATS table, shared by the Footprint chart type ("Bar stats table" setting) and the "Bar Stats"
// indicator (stk_barstats, any chart style). One drawing and one maths here, so the two always look the same.
// Rows: Total volume, Delta, Delta %, Buy volume, Sell volume, Trades. One column per bar, heat-map cells (intensity by size
// within the visible bars), row labels at the right or left edge. Data is the footprint's per-bar order flow; a bar without it
// shows "—" (indicator only). Education only. Not financial advice.
export const CYAN = '#00adb5';
export const MONO = '"JetBrains Mono", ui-monospace, monospace';
export const TOP_OFF = 54, TOP_OFF_PHONE = 92;   // a top-placed table starts below the chart's own price / volume legend
export const TABLE_ROWS = [['vol', 'Total volume'], ['delta', 'Delta'], ['dpct', 'Delta %'], ['buy', 'Buy volume'], ['sell', 'Sell volume'], ['trd', 'Trades']];

export function alpha(hex, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
}
export function fmt(v) {
  const a = Math.abs(v);
  if (a >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (a >= 1e4) return Math.round(v / 1e3) + 'K';
  if (Number.isInteger(v) || a >= 100) return String(Math.round(v));
  // crypto volumes are fractional (BTC, ETH...): keep ~3 significant digits
  return v === 0 ? '0' : a < 0.01 ? '<.01' : String(+v.toFixed(a >= 10 ? 1 : 2));
}
// short number: 340, 2.1K, 15K, 1.5M (crypto volumes keep their decimals via fmt)
export function fmtD(v) {
  const a = Math.abs(v), s = v < 0 ? '\u2212' : '';
  if (a < 0.005) return '0';   // never "<.01"
  if (a >= 1e7) return s + Math.round(a / 1e6) + 'M';
  if (a >= 1e6) return s + (a / 1e6).toFixed(1) + 'M';
  if (a >= 1e4) return s + Math.round(a / 1e3) + 'K';
  if (a >= 1e3) return s + (a / 1e3).toFixed(1) + 'K';
  return s + fmt(a);
}
// rows this chart can really show: from the footprint's own volume, delta and (when the feed has them) trade counts
export function tableRowsFor(fbs, phone, hide = [], all = false) {
  const keys = ['vol', 'delta', 'buy', 'sell'];
  if (all) keys.splice(2, 0, 'dpct', 'trd');   // the indicator keeps every row on a phone; a missing value shows a dash
  else if (!phone) { keys.splice(2, 0, 'dpct'); if (fbs.some((b) => b && b.trades > 0)) keys.push('trd'); }
  return TABLE_ROWS.filter((r) => keys.includes(r[0]) && !hide.includes(r[0]));
}
export function tableVal(fb, k) {
  switch (k) {
    case 'vol': return fb.vol;
    case 'delta': return fb.delta;
    case 'dpct': return fb.vol ? fb.delta / fb.vol : 0;
    case 'buy': return (fb.vol + fb.delta) / 2;
    case 'sell': return (fb.vol - fb.delta) / 2;
    default: return fb.trades || 0;
  }
}
// the text one cell shows
export function cellText(v, k) {
  return k === 'dpct' ? (v < 0 ? '\u2212' : '') + Math.round(Math.abs(v) * 100) + '%' : k === 'delta' ? fmtD(v) : fmtD(Math.abs(v));
}
export function rowLabel(name, phone, deltaSym) {
  if (!phone) return name;
  const s = name.replace('Total volume', 'Volume').replace(' volume', '').replace('Delta %', '\u0394 %');
  return deltaSym && s === 'Delta' ? '\u0394' : s;
}

// Draws the table; returns its height. X = { g, co, a (bars), f ({ map }), cfg, i0, i1, bw, bot, day, plotR, UP, DN, tblY?, dbg? }
// cfg = { adj, tblPos ('bl'|'br'|'tl'|'tr': t/b = top/bottom edge, l/r = label side), tblHide, dash, opacity, mono, deltaSym }
export function drawTable(X) {
  const { g, co, a, f, cfg, i0, i1, bw, bot, day, plotR } = X;
  const phone = co.width < 520, rh = phone ? 14 : 16 + Math.max(0, cfg.adj > 0 ? 2 : 0), tf = 10 + cfg.adj, lf = 11 + Math.min(cfg.adj, 3);
  const atTop = cfg.tblPos[0] === 't', labL = cfg.tblPos[1] === 'l';
  const vis = [];
  for (let i = i0; i <= i1; i++) vis.push(f.map.get(a.bars[i].time));
  const rows = tableRowsFor(vis, phone, cfg.tblHide, cfg.allRows), H = rows.length * rh, y0 = X.tblY != null ? X.tblY : bot - H, labW = (phone ? 62 : 82) + Math.max(0, cfg.adj) * 4, cellL = labL ? labW : 0, cellR = labL ? plotR : plotR - labW;
  if (!rows.length) return 0;
  const mx = {};
  for (const [k] of rows) { let q = 1e-9; for (const fb of vis) if (fb) { const v = Math.abs(tableVal(fb, k)); if (v > q) q = v; } mx[k] = q; }
  if (X.dbg) X.dbg.table = { y0, rh, rows: rows.map((r) => r[0]), cols: [], plotR, H, cellL, cellR, labL };
  g.save();
  if (cfg.opacity != null && cfg.opacity < 1) g.globalAlpha = cfg.opacity;
  g.fillStyle = day ? '#ffffff' : '#050506'; g.fillRect(0, y0, plotR, H);
  g.beginPath(); g.rect(cellL, y0, cellR - cellL, H); g.clip();
  g.font = tf + 'px ' + MONO; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let i = i0; i <= i1; i++) {
    const fb = f.map.get(a.bars[i].time);
    if (!fb && !cfg.dash) continue;
    const xl = co.logicalToX(i) - bw / 2 + 0.5, w = bw - 1;
    if (xl < cellL) continue;   // a bar cut by the left edge (or the label column) gets no half column; on the other side the clip is clean
    const col = { i, t: a.bars[i].time, xc: co.logicalToX(i), xl, w, none: !fb, txt: {} };
    if (X.dbg) X.dbg.table.cols.push(col);   // browser suites read these
    rows.forEach(([k], ri) => {
      const y = y0 + ri * rh;
      if (!fb) {   // no order flow for this bar: an empty cell with a dash, never a number
        g.fillStyle = day ? 'rgba(15,23,42,0.05)' : 'rgba(255,255,255,0.04)'; g.fillRect(xl, y + 0.5, w, rh - 1);
        if (w >= 12) { g.fillStyle = day ? '#64748b' : '#8a90a0'; g.fillText('\u2014', xl + w / 2, y + rh / 2 + 0.5); }
        return;
      }
      if (k === 'trd' && cfg.dash && !(fb.trades > 0)) {   // no trade count for this bar
        g.fillStyle = day ? 'rgba(15,23,42,0.05)' : 'rgba(255,255,255,0.04)'; g.fillRect(xl, y + 0.5, w, rh - 1);
        if (w >= 12) { g.fillStyle = day ? '#64748b' : '#8a90a0'; g.fillText('\u2014', xl + w / 2, y + rh / 2 + 0.5); }
        return;
      }
      const v = tableVal(fb, k), t = Math.abs(v) / mx[k];
      const base = k === 'delta' || k === 'dpct' ? (v >= 0 ? X.UP : X.DN) : k === 'buy' ? X.UP : k === 'sell' ? X.DN : (cfg.volC || CYAN);
      g.fillStyle = alpha(base, 0.14 + 0.72 * Math.sqrt(t));
      g.fillRect(xl, y + 0.5, w, rh - 1);
      const txt = cellText(v, k); col.txt[k] = txt;
      if (txt.length * 0.6 * tf + 4 <= w && xl + w <= cellR) { g.fillStyle = t > 0.6 ? (k === 'sell' || (k !== 'buy' && v < 0) ? '#ffffff' : '#04140d') : (day ? '#1f2937' : '#e5e7eb'); g.fillText(txt, xl + w / 2, y + rh / 2 + 0.5); }
    });
  }
  g.restore();
  g.save();
  if (cfg.opacity != null && cfg.opacity < 1) g.globalAlpha = cfg.opacity;
  g.font = '500 ' + lf + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'; g.textAlign = labL ? 'left' : 'right'; g.textBaseline = 'middle';
  g.fillStyle = day ? '#475569' : '#a3a9b6';
  rows.forEach(([, name], ri) => g.fillText(rowLabel(name, phone, cfg.deltaSym), labL ? 6 : plotR - 6, y0 + ri * rh + rh / 2 + 0.5));
  g.strokeStyle = day ? 'rgba(15,23,42,0.12)' : 'rgba(255,255,255,0.08)'; g.lineWidth = 1;
  const ly = atTop ? y0 + H - 0.5 : y0 + 0.5; g.beginPath(); g.moveTo(0, ly); g.lineTo(plotR, ly); g.stroke();
  g.restore();
  return H;
}

// One short line in the table's place (indicator only): no order flow for this symbol, or zoomed out too far.
export const NOTE_H = 24;
export function drawNote(X, text) {
  const { g, day, plotR, bot, cfg } = X;
  const y0 = X.tblY != null ? X.tblY : bot - NOTE_H;
  g.save();
  if (cfg.opacity != null && cfg.opacity < 1) g.globalAlpha = cfg.opacity;
  g.fillStyle = day ? '#ffffff' : '#050506'; g.fillRect(0, y0, plotR, NOTE_H);
  g.font = '500 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = day ? '#475569' : '#a3a9b6'; g.fillText(text, plotR / 2, y0 + NOTE_H / 2 + 0.5);
  g.strokeStyle = day ? 'rgba(15,23,42,0.12)' : 'rgba(255,255,255,0.08)'; g.lineWidth = 1;
  const ly = cfg.tblPos[0] === 't' ? y0 + NOTE_H - 0.5 : y0 + 0.5; g.beginPath(); g.moveTo(0, ly); g.lineTo(plotR, ly); g.stroke();
  g.restore();
  if (X.dbg) X.dbg.table = { y0, H: NOTE_H, note: text, rows: [], cols: [] };
  return NOTE_H;
}
