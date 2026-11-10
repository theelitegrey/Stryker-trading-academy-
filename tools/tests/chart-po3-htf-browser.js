// Browser test: HTF PO3 Lens candles == direct OHLC aggregation of the chart's own bars (bug-po3, 2026-11-10).
//   CHART_BASE=http://127.0.0.1:8641 SYMS=5,1 [OUT=dir] node tools/tests/chart-po3-htf-browser.js
// Run under `flock /tmp/stryker-chrome.lock` with tools/tests/chart-dev-server.mjs. NQ1! futures bars.
// For every stack (15m, 1H, 4H, D) each drawn candle (wick line + body box) must equal the OHLC of the
// bars in its trading-session period (periods anchored to 18:00 New York); the live candle's close is the last close.
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const fs = require('fs'), path = require('path');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8641';
const OUT = process.env.OUT || '/tmp/po3-shots'; fs.mkdirSync(OUT, { recursive: true });
const TICKS = !!process.env.TICKS;   // TICKS=1: also feed live ticks across a period boundary
const SYMS = (process.env.SYMS || '5').split(',');
const TFS = [['15', 15], ['60', 60], ['240', 240], ['D', 1440]];
let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fails++; };

function nyOff(t) { // New York UTC offset in ms at t
  const w = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(new Date(t));
  const o = {}; for (const p of w) if (p.type !== 'literal') o[p.type] = +p.value;
  return Date.UTC(o.year, o.month - 1, o.day, o.hour, o.minute) - Math.floor(t / 6e4) * 6e4;
}
function periodOf(t, mins) { const off = nyOff(t), ms = mins * 6e4, a = 18 * 36e5; return Math.floor((t + off - a) / ms); }
function aggregate(bars, mins) {
  const out = []; let cur = null;
  for (const b of bars) { const k = periodOf(b.time, mins);
    if (!cur || cur.k !== k) { cur = { k, o: b.open, h: b.high, l: b.low, c: b.close, t0: b.time, n: 0 }; out.push(cur); }
    else { cur.h = Math.max(cur.h, b.high); cur.l = Math.min(cur.l, b.low); cur.c = b.close; }
    cur.n++; }
  // the first period is partial when the data starts inside it: it must not be shown as a complete candle
  if (out.length && bars.length && bars[0].time !== periodStart(bars[0].time, mins)) out.shift();
  return out;
}
function periodStart(t, mins) { const off = nyOff(t), ms = mins * 6e4, a = 18 * 36e5; return Math.floor((t + off - a) / ms) * ms + a - off; }
module.exports = { aggregate, periodOf };
if (require.main !== module) return;

async function run(b, w, tf, shot, ticks) {
  const ctx = await b.newContext({ viewport: { width: w, height: w < 500 ? 800 : 900 }, isMobile: w < 500, hasTouch: w < 500 });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(() => { try { localStorage.setItem('stryker_theme', 'dark'); } catch (e) {} });
  await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  const p = await ctx.newPage();
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_PINE, null, { timeout: 60000 });
  const res = await p.evaluate(async ([tf, ticks, mod]) => {
    const V = window.STRYKER_VELA, P = window.STRYKER_PINE; const c = V.cell(V.context().cells[0].id);
    c.setSymbol('futures:NQ1!'); c.setTimeframe(tf);
    const chart = V.context().cells[0].chart;
    for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 500)); try { if (chart.market.timeframe === tf && chart.orchestrator.rawBars.length > 50 && chart.orchestrator.historyState !== 'backfill') break; } catch (e) {} }
    const m = await import('/assets/chart-pine-builtins.js?v=' + document.querySelector('meta[name=stryker-build]').content);
    let src = await m.builtinSource('htf-po3-lens-stryker');
    src = src.replace('on4 = input.bool(false', 'on4 = input.bool(true').replace('nCdl = input.int(2,', 'nCdl = input.int(4,');
    await P.addSource(chart, src, { title: 'po3' });
    let rec, last = -1, stable = 0;
    for (let i = 0; i < 120; i++) { await new Promise((r) => setTimeout(r, 500)); const h = P.pineHandles(chart)[0]; rec = h && chart.orchestrator.registry.get(h.id); const n = rec && rec.model ? (rec.model.boxes || []).length : 0; if (n && n === last) { if (++stable >= 4) break; } else stable = 0; last = n; }
    if (ticks) { // live updates of ONE new bar that opens a new 15m/1H/4H/D period (every HTF boundary at once)
      const O = chart.orchestrator, lastB = O.rawBars[O.rawBars.length - 1];
      const per = (t) => { const w = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(new Date(t)), o = {}; for (const q of w) if (q.type !== 'literal') o[q.type] = +q.value; return Math.floor((Date.UTC(o.year, o.month - 1, o.day, o.hour, o.minute) - 18 * 36e5) / 864e5); };
      let t = lastB.time + mod; while (per(t) === per(lastB.time)) t += mod;
      const c0 = lastB.close;
      for (const [cl, hi, lo] of [[c0 + 1, c0 + 2, c0 - 1], [c0 + 3, c0 + 4, c0 - 1], [c0 - 2, c0 + 4, c0 - 6], [c0 + 2, c0 + 5, c0 - 6]]) {
        O.onBar({ time: t, open: c0, high: hi, low: lo, close: cl, volume: 5 }); await new Promise((r) => setTimeout(r, 3000));
      }
      rec = O.registry.get(P.pineHandles(chart)[0].id);
    }
    const mod2 = rec.model, bars = chart.orchestrator.rawBars.map((x) => ({ time: x.time, open: x.open, high: x.high, low: x.low, close: x.close }));
    return { bars, boxes: mod2.boxes, lines: mod2.lines, labels: mod2.labels };
  }, [tf, !!ticks, +tf * 60000]);
  if (shot) { await p.waitForTimeout(500); await p.screenshot({ path: path.join(OUT, shot) }); }
  await ctx.close();
  return res;
}
// drawn candles = vertical 1px wick lines paired with the body box centred on the same x
function drawn(r) {
  const c = [];
  for (const l of r.lines) { if (l.x1 !== l.x2) continue;
    const bx = r.boxes.find((b) => (b.left + b.right) / 2 === l.x1 && b.bottom >= Math.min(l.y1, l.y2) - 1e-6 && b.top <= Math.max(l.y1, l.y2) + 1e-6);
    if (bx) c.push({ x: l.x1, h: Math.max(l.y1, l.y2), l: Math.min(l.y1, l.y2), bt: bx.top, bb: bx.bottom, up: l.color.startsWith('#26A69A') }); }
  return c.sort((a, b) => a.x - b.x);
}
(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    for (const tf of SYMS) for (const w of [1440, 390]) {
      const r = await run(b, w, tf, `po3-${tf}m-${w}${TICKS ? '-live' : ''}.png`, TICKS);
      const cs = drawn(r);
      console.log(`# NQ1! ${tf}m @${w}: ${r.bars.length} bars, ${cs.length} drawn candles`);
      check(cs.length >= 8, `${tf}m: candles drawn (${cs.length})`);
      // stacks are ordered 15m, 1H, 4H, D; each shows 4 candles (live last)
      const groups = []; cs.forEach((d, i) => { if (i === 0 || d.x - cs[i - 1].x > 6) groups.push([]); groups[groups.length - 1].push(d); });
      check(groups.length === TFS.length, `${tf}m: ${groups.length} stacks drawn`);
      TFS.forEach(([name, mins], si) => {
        const agg = aggregate(r.bars, mins), mine = groups[si] || [];
        if (mins <= +tf) return;
        check(mine.length === Math.min(4, agg.length), `${tf}m chart, ${name}: ${mine.length} candles (real complete+live: ${agg.length}, max 4)`);
        const exp = agg.slice(-mine.length);
        mine.forEach((d, i) => {
          const e = exp[i]; if (!e) return;
          const live = i === mine.length - 1, hasC = !live;
          const bt = Math.max(e.o, e.c), bb = Math.min(e.o, e.c);
          const ok = Math.abs(d.h - e.h) < 1e-6 && Math.abs(d.l - e.l) < 1e-6 && (Math.abs(d.bt - bt) < 1e-6 || bt === bb) && (Math.abs(d.bb - bb) < 1e-6 || bt === bb);
          check(ok, `${tf}m chart, ${name}: candle ${i}${live ? ' (live)' : ''} drawn H${d.h} L${d.l} body ${d.bb}-${d.bt} | real H${e.h} L${e.l} body ${bb}-${bt} (${e.n} bars)`);
        });
      });
    }
  } finally { await b.close(); }
  console.log(fails ? `${fails} FAILED` : 'ALL PASS'); process.exit(fails ? 1 : 0);
})();
