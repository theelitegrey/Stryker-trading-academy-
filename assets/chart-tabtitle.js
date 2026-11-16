// TradeZoro — Charts: live browser-tab title "<price> <▲|▼> <SYMBOL> · ZoroCharts" (Owner 15 Nov).
// Follows the active pane (symbol, workspace and replay switches are all just "the active cell's
// last bars"). One 500 ms poll that only writes document.title when the text changed; hidden tabs
// are polled at most every 5 s. Arrow = last close vs the previous bar's close (what the legend shows).
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

export function installTabTitle(ws) {
  const original = document.title;
  let lastRun = 0;
  const tick = () => {
    const now = Date.now();
    if (document.hidden ? now - lastRun < 5000 : now - lastRun < 500) return;
    lastRun = now;
    try {
      const c = ws.cell(ws.active.id);
      const sc = c.chart.renderer.renderer.scene;
      const t = buildTitle(c.symbol, sc.bars, sc.priceMintick);
      if (document.title !== t) document.title = t;
    } catch (e) { /* cell not ready yet: keep the current title */ }
  };
  const timer = setInterval(tick, 500);
  window.addEventListener('pagehide', () => { clearInterval(timer); document.title = original; });
  tick();
  return () => { clearInterval(timer); document.title = original; };
}
