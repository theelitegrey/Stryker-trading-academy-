// TradeZoro — Swing VWAP + Profile (L2) (stk_l2f_sw): for every leg between two confirmed swing pivots, an anchored VWAP (optional ±1 / ±2 SD)
// and a volume profile drawn inside the leg's own time span, with POC (thick), VAH / VAL (thin dashed), optional delta colouring, optional
// "extend POC until touched" and small price labels. Hosted by assets/chart-l2-flow.js (data hub, gate, plate); maths in chart-swing-vwap-data.js.
// Data: the L2 order-flow trade minutes (aggressor side per price) where the feed has them; older chart bars fall back to the bar volume
// spread over the bar's range, and a leg that uses any of that says "approx". Education only. Not financial advice.
import { buildLegs, legVwap, legTab, buildProfile, rowPrice, touchedAt, autoRowTicks } from './chart-swing-vwap-data.js?v=951';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const STEPS = [1, 2, 4, 5, 8, 10, 16, 20, 25, 40, 50, 80, 100, 200, 400];
const MAX_ROWS = 36;

// Bars and inputs -> the legs to draw. `cache` (a Map owned by the indicator) keeps frozen legs: they are computed once.
// fb = { bars, from } (the trade minutes), tick = price per tick, tf = chart bar length in ms.
export function swingModel(bars, tf, I, fb, tick, cache) {
  const len = clamp(Math.round(num(I.len, 10)), 2, 50), maxLegs = clamp(Math.round(num(I.legs, 6)), 1, 30), va = clamp(num(I.va, 70), 10, 100);
  const n = bars.length, highs = new Array(n), lows = new Array(n);
  for (let i = 0; i < n; i++) { highs[i] = bars[i].high; lows[i] = bars[i].low; }
  const L = buildLegs(highs, lows, len), pick = L.legs.slice(-maxLegs), rowFix = Math.round(num(I.rowTicks, 0)), from = fb && fb.from > 0 ? fb.from : 0;
  const out = [], live = new Set(); let computed = 0;
  for (const g of pick) {
    const key = [g.a, g.b, bars[g.a].time, tf, len, rowFix, va, from, tick].join('|');
    live.add(key);
    let c = g.final ? cache.get(key) : null;
    if (!c) {
      const tb = legTab(bars, g.a, g.b, tf, fb, tick), span = tb.tab.size ? Math.max(...tb.tab.keys()) - Math.min(...tb.tab.keys()) + 1 : 0;
      const m = rowFix > 0 ? rowFix : autoRowTicks(span, 1, 0, MAX_ROWS, STEPS), P = buildProfile(tb.tab, m, va), V = legVwap(bars, g.a, g.b);
      c = { P, m, vwap: V.vwap, sd: V.sd, approx: tb.approx, exact: tb.exactBars, approxBars: tb.approxBars, touch: -1, scanned: g.b };
      if (P) { c.poc = rowPrice(P, P.poc, tick); c.vah = rowPrice(P, P.vaHi, tick); c.val = rowPrice(P, P.vaLo, tick); }
      if (g.final) cache.set(key, c);
      computed++;
    }
    if (c.P && c.touch < 0) { const j = touchedAt(bars, Math.max(c.scanned + 1, g.b + 1), c.poc); if (j >= 0) c.touch = j; c.scanned = bars.length - 1; }
    out.push(Object.assign({}, g, c));
  }
  if (cache.size > 120) for (const k of cache.keys()) if (!live.has(k)) cache.delete(k);
  return { legs: out, pivots: L.pivots.length, computed, tick, len };
}

export function swingLayer(E) {
  const { frame, Yp, plate, ink, light, rgba, MONO, plateLine, ovCount, fmtP } = E;
  let canvas = null;
  const dash = (g, x0, x1, y) => { g.beginPath(); g.setLineDash([4, 3]); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke(); g.setLineDash([]); };
  function legend(g, a, d, W, phone) {
    const o = d.model.legs[d.model.legs.length - 1]; if (!o || !o.P) return;
    const rows = [[(o.dir > 0 ? 'Open up leg' : 'Open down leg') + (o.approx ? ' · approx' : ''), null], ['POC ' + fmtP(o.poc) + ' · VWAP ' + (o.vwap[o.vwap.length - 1] == null ? '–' : fmtP(o.vwap[o.vwap.length - 1])), d.I.pocColor], ['VAH ' + fmtP(o.vah) + ' · VAL ' + fmtP(o.val), d.I.vaColor]];
    g.font = '700 ' + (phone ? 9 : 10) + 'px ' + MONO; g.textAlign = 'right'; g.textBaseline = 'middle';
    const y0 = a.bounds.top + 10 + ovCount() * 17 + 8;
    rows.forEach(([t, c], i) => {
      const tw = g.measureText(t).width + 12, y = y0 + i * 16, x = Math.max(tw + 4, W - 6);
      g.fillStyle = plate(); g.fillRect(x - tw, y - 7, tw, 14); if (c) { g.fillStyle = c; g.fillRect(x - tw, y - 7, 2, 14); }
      g.fillStyle = ink(); g.fillText(t, x - 4, y);
    });
  }
  return {
    mount(c) { canvas = c; },
    render(a) {
      const g = frame(canvas, a); if (!g) return;
      try {
        const d = a.data, I = d.owner.inputs, M = d.model; if (!M || !M.legs.length) return;
        d.I = I;
        const co = a.coords, W = co.width, phone = W < 520, top = a.bounds.top, bot = top + a.bounds.height, tick = M.tick, ppb = co.pxPerBar();
        const wPct = clamp(num(I.widthPct, 40), 10, 100) / 100, right = I.anchor === 'Right', fs = phone ? 9 : 10, day = light();
        const nLast = a.bars.length - 1; let drawn = 0, labels = 0;
        g.font = '600 ' + fs + 'px ' + MONO; g.textBaseline = 'middle';
        for (const L of M.legs) {
          const x0 = co.logicalToX(L.a), x1 = co.logicalToX(L.b);
          if (x1 < -4 || x0 > W + 4) continue;
          drawn++;
          const span = Math.max(1, x1 - x0), pw = Math.min(span * wPct, span), P = L.P;
          // ---- profile rows
          if (I.profile !== false && P && span > 6) {
            const rowPx = Math.abs(Yp(a, P.m * tick) - Yp(a, 0)), base = right ? x1 : x0, sgn = right ? -1 : 1;
            for (let k = 0; k < P.n; k++) {
              if (!P.vol[k]) continue;
              const yT = Yp(a, ((P.r0 + k + 1) * P.m - 0.5) * tick), yB = Yp(a, ((P.r0 + k) * P.m - 0.5) * tick), y = Math.min(yT, yB), h = Math.max(1, Math.abs(yB - yT) - (rowPx > 4 ? 1 : 0));
              if (y > bot || y + h < top) continue;
              const w = Math.max(1, pw * P.vol[k] / P.maxVol), inVA = k >= P.vaLo && k <= P.vaHi, al = inVA ? 0.62 : 0.3, xs = right ? base - w : base;
              if (I.delta === true && (P.buy[k] || P.sell[k])) {   // buy part next to the edge, sell part after it; approx volume (no side) is grey
                const tot = P.vol[k], wb = w * P.buy[k] / tot, ws = w * P.sell[k] / tot, wa = w - wb - ws; let xx = base;
                const seg = (wd, col) => { if (wd <= 0) return; g.fillStyle = col; g.fillRect(sgn > 0 ? xx : xx - wd, y, wd, h); xx += sgn * wd; };
                seg(wb, rgba(I.buyColor, al)); seg(ws, rgba(I.sellColor, al)); seg(wa, day ? 'rgba(100,116,139,' + al * 0.7 + ')' : 'rgba(148,163,184,' + al * 0.7 + ')');
              } else {
                g.fillStyle = P.vol[k] && !P.buy[k] && !P.sell[k] ? (day ? 'rgba(100,116,139,' + al * 0.7 + ')' : 'rgba(148,163,184,' + al * 0.7 + ')') : rgba(L.dir > 0 ? I.buyColor : I.sellColor, al);
                g.fillRect(xs, y, w, h);
              }
            }
          }
          // ---- VWAP + bands
          if (I.vwap !== false) {
            const line = (f, col, wd, al, dashed) => {
              g.beginPath(); let on = false;
              for (let i = L.a; i <= L.b; i++) { const v = f(i - L.a); if (v == null) { on = false; continue; } const x = co.logicalToX(i), y = Yp(a, v); if (!on) { g.moveTo(x, y); on = true; } else g.lineTo(x, y); }
              g.strokeStyle = rgba(col, al); g.lineWidth = wd; if (dashed) g.setLineDash([3, 3]); g.stroke(); if (dashed) g.setLineDash([]);
            };
            if (I.bands === true) for (const s of [1, 2]) for (const q of [1, -1]) line((j) => (L.vwap[j] == null ? null : L.vwap[j] + q * s * L.sd[j]), I.vwapColor, 1, s === 1 ? 0.55 : 0.32, true);
            line((j) => L.vwap[j], I.vwapColor, 2, 0.95, false);
          }
          // ---- POC / VAH / VAL lines + labels
          if (I.profile !== false && P) {
            const yPoc = Yp(a, L.poc), yH = Yp(a, L.vah), yL = Yp(a, L.val);
            const inView = (y) => y >= top && y <= bot;
            g.lineWidth = 1;
            g.strokeStyle = rgba(I.vaColor, 0.85); if (inView(yH)) dash(g, x0, x1, yH); if (inView(yL)) dash(g, x0, x1, yL);
            if (inView(yPoc)) { g.strokeStyle = I.pocColor; g.lineWidth = 2.5; g.beginPath(); g.moveTo(x0, yPoc); g.lineTo(x1, yPoc); g.stroke(); g.lineWidth = 1; }
            if (I.extend === true && !L.open) {   // naked POC: carry it right until a later bar trades through it
              const end = L.touch >= 0 ? L.touch : nLast, xe = Math.min(co.logicalToX(end), W);
              if (xe > x1 && inView(yPoc)) { g.strokeStyle = rgba(I.pocColor, 0.75); g.lineWidth = 1.5; g.setLineDash([2, 3]); g.beginPath(); g.moveTo(x1, yPoc); g.lineTo(xe, yPoc); g.stroke(); g.setLineDash([]); g.lineWidth = 1; }
            }
            if (I.labels !== false && span >= (phone ? 64 : 84)) {   // on the side away from the profile; skipped when two would touch
              g.textAlign = right ? 'left' : 'right'; const lx = right ? x0 + 3 : x1 - 3, placed = [];
              for (const [t, y, c] of [['POC', yPoc, I.pocColor], ['VAH', yH, I.vaColor], ['VAL', yL, I.vaColor]]) {
                if (!inView(y) || placed.some((q) => Math.abs(q - y) < fs + 3)) continue;
                placed.push(y); const tx = t + ' ' + fmtP(t === 'POC' ? L.poc : t === 'VAH' ? L.vah : L.val), tw = g.measureText(tx).width + 6;
                g.fillStyle = plate(); g.fillRect(right ? lx - 2 : lx - tw + 2, y - fs / 2 - 2, tw, fs + 4); g.fillStyle = c === I.pocColor && day ? '#b45309' : c; g.fillText(tx, lx, y); labels++;
              }
            }
          }
        }
        if (d.model.legs.length) legend(g, a, d, W, phone);
        Object.assign(window.__stkL2Flow.stk_l2f_sw, { drawn, labels, draws: (window.__stkL2Flow.stk_l2f_sw.draws || 0) + 1 });
      } finally { try { plateLine(g, a, a.data.owner); } catch (e) {} g.restore(); }
    },
    destroy() { canvas = null; }
  };
}
