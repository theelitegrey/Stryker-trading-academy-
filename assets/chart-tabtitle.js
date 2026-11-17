// TradeZoro — Charts: live browser-tab title "<price> <▲|▼> <SYMBOL> · ZoroCharts" (Owner 15 Nov).
// Follows the active pane (symbol, workspace and replay switches are all just "the active cell's
// last bars"). Driven by the live-bar event of every tick (see below), plus a 500 ms safety poll; document.title is only
// written when the text changed. Arrow = last close vs the previous bar's close (what the legend shows).
const SUFFIX = ' · ZoroCharts';

export function fmtPrice(p, mintick) {
  let d = 2;
  if (mintick > 0) { d = 0; while (d < 8 && Math.abs(Math.round(mintick * 10 ** d) - mintick * 10 ** d) > 1e-9) d++; }
  else if (Math.abs(p) < 1) d = 4;
  return p.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function buildTitle(symbol, bars, mintick) {
  const name = String(symbol || '').replace(/^[^:]*:/, '').toUpperCase();
  const last = bars && bars.length ? bars[bars.length - 1] : null;
  if (!name) return 'ZoroCharts · Free trading charts | TradeZoro';
  if (!last || !Number.isFinite(last.close)) return name + SUFFIX;
  const prev = bars.length > 1 ? bars[bars.length - 2].close : NaN;
  const arrow = !Number.isFinite(prev) || last.close === prev ? '' : last.close > prev ? ' ▲' : ' ▼';
  return fmtPrice(last.close, mintick) + arrow + ' ' + name + SUFFIX;
}

// Owner 17 Nov: the title did not follow the price. Root cause: it was only sampled by a timer (500 ms visible, 5 s hidden, and
// Chrome clamps a hidden page's timers further, to 1 per minute after 5 minutes), so it lagged the chart's own last price, which
// moves with every tick. Now the feed's own callback drives it: assets/chart-live-resume.js fires 'stryker:livebar' right after each
// live bar reaches the chart (a feed callback is not throttled in a hidden tab). Writes are limited to one per 250 ms visible and one
// per second hidden; the timer stays as a safety net. The price is read from the same array the price-axis label draws from.
export function installTabTitle(ws) {
  const original = document.title;
  let lastWrite = 0, trailing = 0;
  const write = () => {
    trailing = 0; lastWrite = Date.now();
    try {
      const c = ws.cell(ws.active.id);
      const sc = c.chart.renderer.renderer.scene;
      const t = buildTitle(c.symbol, sc.bars, sc.priceMintick);
      if (document.title !== t) document.title = t;
    } catch (e) { /* cell not ready yet: keep the current title */ }
  };
  const request = () => {
    const gap = document.hidden ? 1000 : 250, wait = gap - (Date.now() - lastWrite);
    if (wait <= 0) { if (trailing) { clearTimeout(trailing); trailing = 0; } write(); }
    else if (!trailing) trailing = setTimeout(write, wait);
  };
  const timer = setInterval(request, 500);
  window.addEventListener('stryker:livebar', request);
  const off = () => { clearInterval(timer); clearTimeout(trailing); window.removeEventListener('stryker:livebar', request); document.title = original; };
  window.addEventListener('pagehide', off);
  write();
  return off;
}
