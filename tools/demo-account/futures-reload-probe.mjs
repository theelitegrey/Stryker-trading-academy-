// Futures refresh probe (member bug 2026-11-05: "every refresh gives a different result"): signs in as the demo account on the LIVE site,
// then reloads /charts N times on NQ 1m and logs, per load: the /api/chart/rt answers, every /api/chart/bars answer (rt lane + newest bar),
// the /ts-live socket, the rt-access state the page decided, the pill, and the chart's own bars (order, gaps). Read-only.
//   node tools/demo-account/futures-reload-probe.mjs [reloads=20] [out.json]
import fs from 'node:fs';
import { launch, login, BASE } from './lib/browser.mjs';
const N = Number(process.argv[2] || 20), OUT = process.argv[3] || '';
const { b, ctx, page } = await launch(1440, 900);
await login(page);
await ctx.addInitScript(() => { try { localStorage.setItem('vela-workspace', JSON.stringify({ layout: '1', cells: { A: { symbol: 'futures:NQ1!', timeframe: '1' } }, symbol: 'futures:NQ1!', timeframe: '1' })); } catch (e) {} });
let net = [];
page.on('response', async (r) => {
  const u = r.url();
  if (!/\/api\/chart\/(rt|bars\/)/.test(u)) return;
  const e = { t: Date.now(), u: u.replace(BASE, ''), s: r.status(), auth: /Bearer/.test(r.request().headers().authorization || ''), rt: r.headers()['x-tz-rt'], cc: r.headers()['cache-control'] };
  try { const j = await r.json(); if ('admin' in j) e.admin = j.admin; if (j.bars) { e.n = j.bars.length; e.last = j.bars.length ? j.bars[j.bars.length - 1][0] : 0; } } catch (x) {}
  net.push(e);
});
page.on('websocket', (w) => { if (/ts-live/.test(w.url())) net.push({ t: Date.now(), ws: w.url().replace(/token=[^&]+/, 'token=…').slice(0, 120) }); });
const log = [];
for (let i = 0; i < N; i++) {
  net = [];
  const t0 = Date.now();
  await page.goto(BASE + '/charts?symbol=NQ', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_VELA.active, null, { timeout: 60000 }).catch(() => {});
  await page.evaluate(() => { try { const a = window.STRYKER_VELA.active; if (!/NQ1!/.test(a.symbol)) a.setSymbol('futures:NQ1!'); if (String(a.timeframe) !== '1') a.setTimeframe('1'); } catch (e) {} });
  const snaps = [];
  for (const at of [3000, 8000, 15000]) {
    await page.waitForTimeout(at - (Date.now() - t0) > 0 ? at - (Date.now() - t0) : 0);
    snaps.push(await page.evaluate(() => {
      const ws = window.STRYKER_VELA, a = ws && ws.active, rb = (a && a.chart && a.chart.orchestrator && a.chart.orchestrator.rawBars) || (ws && ws.chart && ws.chart.orchestrator && ws.chart.orchestrator.rawBars) || [];
      let ooo = 0, maxGap = 0, wick = 0; for (let k = 1; k < rb.length; k++) { const d = rb[k].time - rb[k - 1].time; if (d <= 0) ooo++; if (d > maxGap) maxGap = d; }
      for (const x of rb.slice(-60)) if (x.open === x.close && x.high === x.low) wick++;
      const pill = document.getElementById('stkdp');
      return { at: Math.round(performance.now()), sym: a && a.symbol, tf: a && a.timeframe, rt: window.tzRtState ? window.tzRtState() : null, fed: !!(window.__stkL2Live && window.__stkL2Live.has('NQ')),
        pill: !!(pill && !pill.hidden), dot: (document.querySelector('.stkc-dd') || {}).dataset?.s || '', n: rb.length, first: rb[0] && rb[0].time / 1000, last: rb.length && rb[rb.length - 1].time / 1000,
        lagMin: rb.length ? Math.round((Date.now() - rb[rb.length - 1].time) / 6000) / 10 : null, ooo, maxGapMin: Math.round(maxGap / 60000), flat60: wick };
    }));
  }
  const row = { i, snaps, net: net.map((e) => ({ ...e, t: e.t - t0 })) };
  log.push(row);
  const s = snaps[snaps.length - 1];
  console.log(`#${i} rt=${JSON.stringify(s.rt && { r: s.rt.ready, a: s.rt.admin, bars: s.rt.lastBarsRt })} fed=${s.fed} pill=${s.pill} dot=${s.dot} n=${s.n} lag=${s.lagMin}m ooo=${s.ooo} gap=${s.maxGapMin}m flat=${s.flat60}`
    + ` | rt-calls=${net.filter((e) => e.admin !== undefined).map((e) => (e.auth ? 'T' : '-') + e.admin).join(',')} bars=${net.filter((e) => e.n !== undefined).map((e) => (e.auth ? 'T' : '-') + e.rt).join(',')} ws=${net.filter((e) => e.ws).length}`
    + ` | early(3s) pill=${snaps[0].pill} a=${snaps[0].rt && snaps[0].rt.admin} n=${snaps[0].n}`);
}
if (OUT) fs.writeFileSync(OUT, JSON.stringify(log, null, 1));
await b.close();
