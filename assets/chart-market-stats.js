// TradeZoro — Charts: "Market Stats session" overlay (ES module, charts.html). Opened from /market-stats:
//   charts?symbol=NQ&date=2026-10-28&tf=5&o=..&pdh=..&pdl=..&pdc=..&orw=15&orh=..&orl=..&t=20&lbl=Break&vela=0.9
// Draws the levels of ONE past session on the chart: prior day high / low / close, the open, the gap band, the opening range
// (15 or 30 min) and initial balance lines, and a marker at the minute the outcome happened. Nothing is fetched here: the
// numbers come in the URL-free drill object that assets/market-stats.js stores in sessionStorage ('stk_ms_drill'), so a page
// reload keeps it and no server is asked anything.
//
// How the chart gets to the date: this file adds the "?date=" deep link that was missing. After the workspace exists,
// installMarketStats() reads the query, sets the symbol and timeframe, adds the overlay, and then pages older history in
// (the same backfillHistory the history pager uses) until the session is on screen, and sets the visible range to that day.
// SPX has no chart feed of its own: its levels are drawn on the ES chart shifted by the open basis (ES open of that day minus
// the SPX open), and the chip says so.
//
// Depends on: Vela plugin SDK (registerNativeIndicator / registerRendererLayer / registerStatePersistence) as the other
// chart-*.js natives; assets/market-stats-core.js is NOT needed (the epoch of the open is passed in).
// Education only. Historical frequencies, not predictions.

const TYPE = 'stk_msess';
const KEY = 'stk_ms_drill';
const SCHEMA = [{ key: 'labels', title: 'Labels', type: 'bool', defval: true }];
const COL = { prior: '#9aa0a6', open: '#e8eaed', gap: '#f5b942', or: '#00adb5', ib: '#8b7cf6', mark: '#4fe3ac' };

// New York open of a date as epoch seconds (09:30 ET, US DST rules; same maths as _bars.js nyOffset).
export function sessionOpenEpoch(date) {
  const [y, m, d] = date.split('-').map(Number);
  const nth = (mm, n) => { const dw = new Date(Date.UTC(y, mm, 1)).getUTCDay(); return 1 + ((7 - dw) % 7) + 7 * (n - 1); };
  const ms = Date.UTC(y, m - 1, d), off = ms >= Date.UTC(y, 2, nth(2, 2)) && ms < Date.UTC(y, 10, nth(10, 1)) ? -4 : -5;
  return Date.UTC(y, m - 1, d, 9 - off, 30) / 1000;
}
// Drill object from the link's numbers (the page puts them in the URL so a link works in any tab).
// ?o=&pdh=&pdl=&pdc= (prior day and open), orw= orh= orl= (opening range), ibh= ibl=, t= (minutes after the open), lbl=, sx=1 (SPX on ES)
export function drillFromQuery(q, date, chartSym) {
  const n = (k) => (q.has(k) && q.get(k) !== '' ? Number(q.get(k)) : NaN);
  const o = n('o');
  if (!Number.isFinite(o)) return null;
  const d = { date, open: sessionOpenEpoch(date), o, pdh: n('pdh'), pdl: n('pdl'), pdc: n('pdc'), t: Number.isFinite(n('t')) ? n('t') : -1,
    markLabel: String(q.get('lbl') || '').slice(0, 40), title: String(q.get('title') || '').slice(0, 60), chartSym, shiftToOpen: q.get('sx') === '1' };
  if (Number.isFinite(n('orh')) && Number.isFinite(n('orl'))) d.or = { win: n('orw') || 15, h: n('orh'), l: n('orl') };
  if (Number.isFinite(n('ibh')) && Number.isFinite(n('ibl'))) d.ib = { h: n('ibh'), l: n('ibl') };
  return d;
}

export function readDrill() {
  try {
    const d = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    return d && d.date && d.open ? d : null;
  } catch (e) { return null; }
}

// ---- the lines of a drill (pure; unit-tested in tools/tests/market-stats.test.js) -----------------------------------
export function drillLines(d, shift) {
  const s = shift || 0, out = [];
  const add = (id, label, price, color, dash) => { if (Number.isFinite(price)) out.push({ id, label, price: price + s, color, dash }); };
  add('pdh', 'PDH', d.pdh, COL.prior, [6, 4]); add('pdl', 'PDL', d.pdl, COL.prior, [6, 4]); add('pdc', 'PDC', d.pdc, COL.prior, [2, 3]);
  add('open', 'Open', d.o, COL.open, []);
  if (d.or) { add('orh', 'OR' + d.or.win + ' high', d.or.h, COL.or, []); add('orl', 'OR' + d.or.win + ' low', d.or.l, COL.or, []); }
  if (d.ib) { add('ibh', 'IB high', d.ib.h, COL.ib, []); add('ibl', 'IB low', d.ib.l, COL.ib, []); }
  return out;
}

class MsNative {
  constructor() { this.ctx = null; this.sig = ''; this.inputs = {}; }
  start(ctx, inputs) { this.ctx = ctx; this.inputs = inputs || {}; this.push(); }
  onBars() { this.push(); }
  onViewport() {}
  setInputs(i) { this.inputs = i || {}; this.sig = ''; this.push(); }
  suspend() {}
  resume() { this.sig = ''; this.push(); }
  stop() { try { this.ctx.pushData(null); } catch (e) {} }
  push() {
    if (!this.ctx) return;
    const d = readDrill();
    let payload = null;
    if (d) {
      // The chart's futures bars are the unadjusted front month; the stats rows use the back-adjusted continuous
      // contract, so older sessions differ by the roll offsets. Align the levels to the chart with the open basis:
      // the chart's bar at the 09:30 open minus the session open in the data (exact on 5m bars, about 30 min early on hourly).
      let shift = 0, chip = '', ready = false;
      try {
        const bars = this.ctx.bars(); let bar = null;
        for (let i = bars.length - 1; i >= 0; i--) { if (bars[i].time <= d.open * 1000) { bar = bars[i]; break; } }
        if (bar && d.open * 1000 - bar.time < 3600 * 1000) {
          ready = true; shift = bar.open - d.o;
          const exact = bar.time === d.open * 1000;
          if (Math.abs(shift) >= 0.005 || d.shiftToOpen) chip = (d.shiftToOpen ? 'SPX' : 'Levels') + ' shifted ' + (shift >= 0 ? '+' : '') + shift.toFixed(2) + ' to this chart (open basis' + (exact ? '' : ', approximate on hourly bars') + ')';
        }
      } catch (e) {}
      if (!ready) chip = 'Waiting for the session bars…';
      payload = { lines: ready ? drillLines(d, shift) : [], open: d.open, close: d.open + 390 * 60, markT: Number.isFinite(d.t) && d.t >= 0 ? d.open + d.t * 60 : null,
        markLabel: d.markLabel || '', gap: ready ? [d.pdc + shift, d.o + shift] : null, labels: this.inputs.labels !== false, chip: (d.title ? d.title + ' · ' + d.date : d.date) + (chip ? ' · ' + chip : '') };
    }
    const sig = JSON.stringify(payload);
    if (sig === this.sig) return;
    this.sig = sig;
    try { this.ctx.pushData(payload); } catch (e) {}
  }
}

function layer() {
  let canvas = null, chip = null, last = '';
  function paintChip(text) {
    if (!chip && canvas && canvas.parentElement) {
      chip = document.createElement('div');
      chip.className = 'stk-gex-chip stk-ms-chip';
      canvas.parentElement.appendChild(chip);
    }
    if (!chip || text === last) return;
    last = text;
    chip.hidden = !text;
    chip.style.right = 'auto'; chip.style.left = '8px'; chip.style.bottom = '32px';
    chip.textContent = text;
  }
  return {
    mount(cv) { canvas = cv; },
    render(a) {
      if (!canvas) return;
      const g = canvas.getContext('2d');
      if (!g) return;
      const co = a.coords, dpr = co.dpr || 1;
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, canvas.width, canvas.height);
      const d = a.data;
      paintChip(d ? d.chip : '');
      if (!d) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const W = co.width, top = a.bounds.top, H = a.bounds.height;
      const Y = (p) => co.priceToY(p, a.scale, a.bounds);
      const x0 = co.timeToX(d.open * 1000), x1 = co.timeToX(d.close * 1000);
      g.save();
      g.beginPath(); g.rect(0, top, W, H); g.clip();
      g.font = '600 10px -apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, sans-serif';
      g.textBaseline = 'middle';
      // gap band: the space between the prior close and the open, across the session
      if (d.gap && Number.isFinite(d.gap[0]) && Number.isFinite(d.gap[1]) && d.gap[0] !== d.gap[1]) {
        const ya = Y(d.gap[0]), yb = Y(d.gap[1]);
        g.fillStyle = 'rgba(245,185,66,0.14)';
        g.fillRect(Math.max(0, x0), Math.min(ya, yb), Math.max(0, Math.min(W, x1) - Math.max(0, x0)), Math.abs(yb - ya));
      }
      const left = Math.max(0, x0), right = Math.min(W, x1);
      for (const l of d.lines) {
        const y = Math.round(Y(l.price)) + 0.5;
        if (!(y >= top - 4 && y <= top + H + 4)) continue;
        g.strokeStyle = l.color; g.lineWidth = 1; g.setLineDash(l.dash || []);
        g.beginPath(); g.moveTo(left, y); g.lineTo(right, y); g.stroke();
        g.setLineDash([]);
        if (d.labels) {
          const w = Math.ceil(g.measureText(l.label).width) + 8;
          const lx = Math.min(W - w - 2, Math.max(2, right - w));
          g.fillStyle = l.color; g.fillRect(lx, y - 7, w, 14);
          g.fillStyle = '#0b0b0d'; g.fillText(l.label, lx + 4, y + 0.5);
        }
      }
      // the outcome minute
      if (d.markT) {
        const xm = Math.round(co.timeToX(d.markT * 1000)) + 0.5;
        if (xm >= 0 && xm <= W) {
          g.strokeStyle = COL.mark; g.lineWidth = 1.5; g.setLineDash([3, 3]);
          g.beginPath(); g.moveTo(xm, top); g.lineTo(xm, top + H); g.stroke(); g.setLineDash([]);
          const t = d.markLabel || 'Outcome';
          const w = Math.ceil(g.measureText(t).width) + 10;
          const lx = Math.min(W - w - 2, Math.max(2, xm - w / 2));
          g.fillStyle = COL.mark; g.fillRect(lx, top + 4, w, 15);
          g.fillStyle = '#0b0b0d'; g.fillText(t, lx + 5, top + 12);
        }
      }
      g.restore();
    },
    destroy() { if (chip) chip.remove(); chip = null; canvas = null; }
  };
}

let installed = false;
export function installMarketStats(Core) {
  if (installed) return;
  installed = true;
  Core.registerRendererLayer({ id: TYPE, placement: 'above-data', create: layer });
  Core.registerNativeIndicator({
    type: TYPE, title: 'TradeZoro Market Stats session', shortTitle: 'Market Stats', paneHint: 'price', overlay: true,
    inputsSchema: () => SCHEMA, defaultInputs: () => Object.fromEntries(SCHEMA.map((x) => [x.key, x.defval])),
    create: () => new MsNative(), legendNote: (d) => (d ? d.chip : '')
  });
  // Never saved with the workspace: the overlay belongs to one drill-down visit.
}
export const MS_TYPE = TYPE;

// ---- deep link: charts?symbol=NQ&date=YYYY-MM-DD[&tf=5] ------------------------------------------------------------
// Called once from vela-chart.js after the workspace is built. Returns a promise that resolves when done (never throws).
export function openSessionFromLink(ws) {
  const q = new URL(location.href).searchParams;
  const date = q.get('date');
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    // an ordinary visit: drop a session overlay a saved workspace may still carry
    try { ws.cells().forEach((c) => c.chart.indicators().forEach((h) => { if (h.nativeType === TYPE) c.chart.removeIndicator(h); })); } catch (e) {}
    return Promise.resolve(false);
  }
  const root = String(q.get('symbol') || 'NQ').toUpperCase().replace(/1!$/, '');
  const drill = drillFromQuery(q, date, root);
  if (drill) { try { sessionStorage.setItem(KEY, JSON.stringify(drill)); } catch (e) {} }
  else { try { sessionStorage.removeItem(KEY); } catch (e) {} }
  const withLines = !!drill;
  const sym = 'futures:' + root + '1!';
  // the other deep link (chart-watchlist.js, ?symbol=) must not fight this one
  try { const u = new URL(location.href); ['symbol', 'date', 'tf', 'o', 'pdh', 'pdl', 'pdc', 'orw', 'orh', 'orl', 'ibh', 'ibl', 't', 'lbl', 'title', 'sx'].forEach((k) => u.searchParams.delete(k)); history.replaceState(null, '', u.pathname + u.search + u.hash); } catch (e) {}
  const openEpoch = sessionOpenEpoch(date);
  return (async () => {
    try {
      const cell = ws.active;
      cell.setSymbol(sym);
      const chart = cell.chart;
      const orch = chart.orchestrator;
      // 5-minute bars reach back about 59 days, hourly bars about 2 years: try the asked timeframe, then hourly
      let reached = false;
      for (const tf of [String(q.get('tf') || '5'), '60']) {
        cell.setTimeframe(tf);
        const t0 = Date.now();
        await new Promise((r) => setTimeout(r, 300));
        while (Date.now() - t0 < 15000) { await new Promise((r) => setTimeout(r, 150)); if (!orch.switchingMarket && orch.historyCompleted && orch.rawBars.length > 50 && String(orch.config.market.symbol).indexOf(root) >= 0 && String(orch.config.market.timeframe) === tf) break; }
        // page older history in until the day's open is on the chart
        for (let i = 0; i < 40 && orch.rawBars.length && orch.rawBars[0].time / 1000 > openEpoch - 3600 && orch.rawBars.length < 30000; i++) {
          const before = orch.rawBars.length;
          orch.resetHistoryTracking(); orch.historyState = 'backfill';
          await orch.backfillHistory(orch.generation, Math.min(30000, before + 4000));
          if (!orch.historyCompleted) { try { orch.completeHistory('aborted'); } catch (e) {} }
          if (orch.rawBars.length <= before) break;
        }
        const first = orch.rawBars[0] ? orch.rawBars[0].time / 1000 : 0;
        if (first && first <= openEpoch) { reached = true; break; }
      }
      if (!reached) {
        try { window.__msNoData = date; window.dispatchEvent(new CustomEvent('stk:ms-nodata', { detail: { date } })); } catch (e) {}
        try { if (window.showToast) window.showToast('Chart history for ' + date + ' is not available yet. The numbers on Market Stats still count it.', 'info'); } catch (e) {}
        return false;
      }
      if (withLines) { try { chart.addNativeIndicator(TYPE, {}); } catch (e) { console.warn('TradeZoro: market stats overlay', e); } }
      // the session plus an hour either side
      chart.setVisibleRange({ from: (openEpoch - 40 * 60) * 1000, to: (openEpoch + 390 * 60 + 40 * 60) * 1000 });
      return true;
    } catch (e) { console.warn('TradeZoro: open session', e); return false; }
  })();
}
