// TradeZoro — Charts: TPO extras (member request 2026-11-13), drawn by both TPO tools: the Market
// Profile (TPO) indicator (chart-of-pro.js) and the Time price opportunity chart type (chart-types.js).
// Each is its own setting and off by default, so saved charts look as before:
//   single prints highlighted + extended right until price trades back into them,
//   poor highs / lows (the extreme hit in 2+ periods) marked + extended until touched,
//   naked POC lines (a past session's POC extended until price touches it),
//   developing POC / VAH / VAL (step lines through the session),
//   initial balance high / low (first 30 or 60 min) + extensions (IB high/low +- k x IB range).
// Maths in chart-of-pro-data.js (unit tests: tools/tests/chart-of-pro.test.mjs).
import { tpoSingleRuns, tpoPoorExtremes, tpoDeveloping, firstTouch, ibExtensions } from './chart-of-pro-data.js?v=989';

const MAG = '#e040fb', VA_LN = '#8fd8dc', SINGLE = '#9b7bff', POOR = '#f5b301', IB = '#2f6bff', IB_DAY = '#2563eb';
const MONO = '"JetBrains Mono", ui-monospace, monospace';
export const IB_EXT_OPTIONS = ['1.5, 2, 3', '0.5, 1', '1, 2', '1, 1.5, 2', '0.5, 1, 1.5, 2, 3', 'none'];
export const extMults = (s) => String(s || '').split(/[ ,x]+/).map(Number).filter((k) => k > 0 && k <= 10);

// Indicator inputs (chart-of-pro.js TPO_SCHEMA) and chart-type settings rows (chart-types.js).
export const TPO_EXTRA_INPUTS = [
  { key: 'showLetters', title: 'Show letters', type: 'bool', defval: true, tooltip: 'Off hides the period letters. The profile keeps the same width.' },
  { key: 'singles', title: 'Highlight single prints (extend until price returns)', type: 'bool', defval: false },
  { key: 'poor', title: 'Mark poor highs and lows (extend until touched)', type: 'bool', defval: false, tooltip: 'Poor = the session high or low was reached in 2 or more periods.' },
  { key: 'nakedPoc', title: 'Naked POC lines (extend until price touches)', type: 'bool', defval: false },
  { key: 'devPoc', title: 'Developing POC, VAH and VAL', type: 'bool', defval: false },
  { key: 'ibLines', title: 'Initial balance high and low lines', type: 'bool', defval: false },
  { key: 'ibMin', title: 'Initial balance length (minutes)', type: 'string', defval: '60', options: ['60', '30'] },
  { key: 'ibExt', title: 'Initial balance extensions (x the IB range)', type: 'string', defval: '1.5, 2, 3', options: IB_EXT_OPTIONS }
];
export const TPO_EXTRA_ROWS = [
  { kind: 'toggle', key: 'showLetters', label: 'Show letters', defval: true },
  { kind: 'toggle', key: 'singles', label: 'Highlight single prints (extend until price returns)', defval: false },
  { kind: 'toggle', key: 'poor', label: 'Mark poor highs and lows', defval: false },
  { kind: 'toggle', key: 'nakedPoc', label: 'Naked POC lines (extend until price touches)', defval: false },
  { kind: 'toggle', key: 'devPoc', label: 'Developing POC, VAH and VAL', defval: false },
  { kind: 'toggle', key: 'ibLines', label: 'Initial balance high and low lines', defval: false },
  { kind: 'select', key: 'ibMin', label: 'Initial balance length', defval: '60', options: [['60', '60 min'], ['30', '30 min']] },
  { kind: 'select', key: 'ibExt', label: 'Initial balance extensions (x the IB range)', defval: '1.5, 2, 3', options: IB_EXT_OPTIONS.map((o) => [o, o === 'none' ? 'None' : o + ' x']) }
];
// Any extra that draws lines beyond a session (so off-screen sessions still matter).
export const extendsRight = (I) => !!(I.singles || I.poor || I.nakedPoc);
// IB window for tpoProfile when the IB lines are on (else the tool's own IB setting stands).
export const ibMsOf = (I) => (I.ibLines ? (String(I.ibMin) === '30' ? 30 : 60) * 60000 : 0);

function rgba(hex, a) {
  const m = /^#?([0-9a-f]{6})/i.exec(String(hex || ''));
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
}

// o = { I, bars (all chart bars), s: { i0, i1 } (session bar range), p (its tpoProfile), periodMs,
// tick, X(i) -> x, Y(price) -> y, x0, x1 (session left / right px), W (plot width), last (developing
// session), top, bot, phone, day, labels (array,
// shared by the frame: right-edge labels collected here and drawn by drawLabels) }
export function drawTpoExtras(g, o) {
  const { I, bars, s, p, X, Y, W, top, bot, day } = o;
  if (!p) return;
  const sb = () => bars.slice(s.i0, s.i1 + 1);
  const from = s.i1 + 1;
  // the x where a level stops: the bar that trades back into it, else the right edge
  const endX = (lo, hi) => {
    if (o.last) return { x: W, open: true };
    const k = firstTouch(bars, from, lo, hi);
    return k < 0 ? { x: W, open: true } : { x: X(k), open: false };
  };
  const L = o.labels;
  const hline = (y, xa, xb, c, w, dash) => { if (y < top - 2 || y > bot + 2 || xb < 0 || xa > W) return false; g.setLineDash(dash || []); g.strokeStyle = c; g.lineWidth = w; g.beginPath(); g.moveTo(xa, Math.round(y) + 0.5); g.lineTo(xb, Math.round(y) + 0.5); g.stroke(); g.setLineDash([]); return true; };
  const lab = (y, txt, c) => o.labels && o.labels.push({ y, txt, c });

  if (I.singles) {
    for (const r of tpoSingleRuns(p)) {
      const yT = Y(r.hi), yB = Y(r.lo), y = Math.min(yT, yB), h = Math.max(1, Math.abs(yB - yT));
      if (y > bot || y + h < top) continue;
      const e = endX(r.lo, r.hi);
      g.fillStyle = rgba(SINGLE, day ? 0.16 : 0.2); g.fillRect(o.x0, y, Math.max(0, e.x - o.x0), h);
      hline(y, o.x0, e.x, rgba(SINGLE, 0.7), 1, [3, 3]); hline(y + h, o.x0, e.x, rgba(SINGLE, 0.7), 1, [3, 3]);
      if (e.open && !o.last) lab(y + h / 2, 'Single', SINGLE);
    }
  }
  if (I.poor) {
    const pe = tpoPoorExtremes(sb(), { periodMs: o.periodMs, tick: o.tick });
    for (const [px, txt] of [[pe.high, 'Poor high'], [pe.low, 'Poor low']]) {
      if (px == null) continue;
      const y = Y(px), e = endX(px, px);
      if (hline(y, o.x0, e.x, rgba(POOR, 0.95), 1.5, [5, 3])) L.poor = (L.poor || 0) + 1;
      if (o.x1 - o.x0 > 70 && y > top + 8 && y < bot - 8) {   // a tag on the profile itself
        g.font = '600 ' + (o.phone ? 9 : 10) + 'px ' + MONO; g.textAlign = 'left'; g.textBaseline = txt === 'Poor high' ? 'bottom' : 'top';
        g.fillStyle = POOR; g.fillText(txt, o.x0 + 2, txt === 'Poor high' ? y - 3 : y + 3);
      }
      if (e.open && !o.last) lab(y, txt, POOR);
    }
  }
  if (I.nakedPoc && !o.last) {   // the developing session's POC already runs to the right edge
    const px = (p.r0 + p.poc + 0.5) * p.row, e = endX(px, px);
    if (hline(Y(px), o.x1, e.x, rgba(MAG, e.open ? 0.9 : 0.5), 1, [6, 3])) L.naked = (L.naked || 0) + 1;
    if (e.open) lab(Y(px), 'Naked POC', MAG);
  }
  if (I.devPoc) {
    // cached on the profile object, which the caller rebuilds whenever the session's bars change
    const d = p.dev || (p.dev = tpoDeveloping(sb(), { periodMs: o.periodMs, row: p.row, va: o.va }));
    const step = (arr, c, w, dash) => {
      g.setLineDash(dash); g.strokeStyle = c; g.lineWidth = w; g.beginPath();
      for (let j = 0; j < arr.length; j++) {
        const xa = X(s.i0 + j) - o.pitch / 2, xb = X(s.i0 + j) + o.pitch / 2, y = Math.round(Y(arr[j])) + 0.5;
        if (j === 0) g.moveTo(xa, y); else g.lineTo(xa, y);
        g.lineTo(xb, y);
      }
      g.stroke(); g.setLineDash([]);
    };
    step(d.vah, rgba(VA_LN, 0.85), 1, [3, 2]); step(d.val, rgba(VA_LN, 0.85), 1, [3, 2]); step(d.poc, rgba(MAG, 0.95), 1.5, []);
  }
  if (I.ibLines && p.ibHi > -Infinity) {
    const c = day ? IB_DAY : IB, xb = o.last ? W : o.x1;
    hline(Y(p.ibHi), o.x0, xb, rgba(c, 0.95), 1.25, []); hline(Y(p.ibLo), o.x0, xb, rgba(c, 0.95), 1.25, []);
    const ext = ibExtensions(p.ibHi, p.ibLo, extMults(I.ibExt));
    for (const x of ext) { hline(Y(x.up), o.x0, xb, rgba(c, 0.6), 1, [2, 3]); hline(Y(x.dn), o.x0, xb, rgba(c, 0.6), 1, [2, 3]); }
    // names at the right end of the lines (session end), when there is room
    if (xb - o.x0 > 80) {
      g.font = '600 ' + (o.phone ? 9 : 10) + 'px ' + MONO; g.textAlign = 'right'; g.textBaseline = 'bottom'; g.fillStyle = rgba(c, 1);
      // skip a name that would sit on the POC / VAH / VAL pills or lines of the same session
      const busy = [p.poc, p.vah, p.val].map((k) => Y((p.r0 + k + 0.5) * p.row));
      const t = (y, txt) => { if (y > top + 12 && y < bot - 2 && busy.every((b) => Math.abs(b - y) > 14)) g.fillText(txt, xb - 4, y - 2); };
      t(Y(p.ibHi), 'IB high'); t(Y(p.ibLo), 'IB low');
      for (const x of ext) { t(Y(x.up), '+' + x.k + 'x'); t(Y(x.dn), '-' + x.k + 'x'); }
    }
  }
}

// Steady profile width (px): 110 desktop / 72 phone at every zoom; only squeezed when the next
// session starts closer than that (so profiles never run into each other).
export function steadyW(list, s, X, x0, W, phone) {
  const want = phone ? 72 : 132, nx = list[list.indexOf(s) + 1];
  const room = nx ? X(nx.i0) - x0 - 8 : W - x0 - 8;
  return Math.max(24, Math.min(want, room));
}

// Right-edge tags for levels still open (untouched): one per row of text, newest kept on a clash.
export function drawLabels(g, labels, { W, top, bot, phone, day }) {
  try { window.__stkTpoDrawn = { poor: labels.poor || 0, naked: labels.naked || 0 }; } catch (e) {}   // read by the browser tests
  if (!labels.length) return;
  g.font = '600 ' + (phone ? 9 : 10) + 'px ' + MONO; g.textAlign = 'right'; g.textBaseline = 'middle';
  const used = [];
  for (let k = labels.length - 1; k >= 0; k--) {
    const l = labels[k], y = Math.round(l.y);
    if (y < top + 8 || y > bot - 8 || used.some((u) => Math.abs(u - y) < 14)) continue;
    used.push(y);
    const w = g.measureText(l.txt).width + 10;
    g.fillStyle = day ? 'rgba(255,255,255,0.92)' : 'rgba(11,11,13,0.85)'; g.fillRect(W - 4 - w, y - 7, w, 14);
    g.fillStyle = l.c; g.fillText(l.txt, W - 9, y + 0.5);
  }
}
