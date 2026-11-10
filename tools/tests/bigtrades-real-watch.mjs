// REAL-feed watch for Big Trades (L2) (member GK, 10 Nov: "not updating automatically", "symbols appear when I drag, gone after refresh").
// Live site, demo/real-time account (tools/demo-account/lib/browser.mjs; credentials never printed), NO mouse input at all.
// Per chart cell, every STEP s: plate count (owner.text), prints in the hub, layer data pushes, layer renders, circles actually drawn
// (ctx.arc calls in the last render), newest selected print time. Phases: 1 chart (TF1), then 2 charts (TF1 + TF2), then a reload.
//   flock /tmp/stryker-chrome.lock node tools/tests/bigtrades-real-watch.mjs <minutesPerPhase> <outdir> [tf1] [tf2]
import fs from 'node:fs';
import dns from 'node:dns/promises';
import { createRequire } from 'node:module';
import { login, BASE } from '../demo-account/lib/browser.mjs';
const { chromium } = createRequire('/root/projects/stryker-trading-academy/package.json')('playwright-core');
const MIN = Number(process.argv[2] || 5), OUT = process.argv[3] || '.', TF1 = process.argv[4] || '1', TF2 = process.argv[5] || '5', STEP = 10;
fs.mkdirSync(OUT, { recursive: true });
const log = [], say = (...a) => { const l = new Date().toISOString().slice(11, 19) + ' ' + a.join(' '); console.log(l); log.push(l); };
// this server's IPv6 is refused by Google's sign-in hosts (403): pin them to IPv4 for this browser only
const G = ['identitytoolkit.googleapis.com', 'securetoken.googleapis.com', 'firestore.googleapis.com', 'www.googleapis.com', 'firebaseinstallations.googleapis.com'];
const rules = (await Promise.all(G.map(async (h) => { try { return 'MAP ' + h + ' ' + (await dns.resolve4(h))[0]; } catch (e) { return ''; } }))).filter(Boolean).join(', ');
const b = await chromium.launch({ executablePath: process.env.CHROME || '/root/.cache/ms-playwright/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=768', '--host-resolver-rules=' + rules] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
const page = await ctx.newPage(), errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => errors.push('PAGEERR ' + String(e.message).slice(0, 200)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// hook every cell's stk_l2f_big layer: count pushes / renders / arcs (idempotent, re-run after layout changes)
const hook = () => page.evaluate(() => {
  const W = window.__btw || (window.__btw = { cells: [] });
  const cells = window.STRYKER_VELA.cells();
  cells.forEach((c, i) => {
    let r = c.chart.renderer; r = r && r.extLayers ? r : r && r.renderer;
    const l = r && r.extLayers.find((x) => x.def.id === 'stk_l2f_big'); if (!l || l.__btw) return;
    const st = W.cells[i] = { pushes: 0, renders: 0, arcs: 0, lastArcs: 0, painted: 0 };
    l.__btw = st;
    const g = l.canvas.getContext('2d'), arc = g.arc.bind(g); g.arc = (...a) => { st.arcs++; return arc(...a); };
    const rend = l.instance.render.bind(l.instance);
    l.instance.render = (a) => { const before = st.arcs; st.renders++; const out = rend(a); st.lastArcs = st.arcs - before; st.lastData = a.data; st.lastBars = a.bars.length; try { const vr = a.coords.visibleLogicalRange(); st.vis = [a.bars[Math.max(0, Math.floor(vr.from))].time, a.bars[Math.min(a.bars.length - 1, Math.ceil(vr.to))].time]; } catch (e) {} return out; };
    const snd = r.setNativeData.bind(r); r.setNativeData = (t, d) => { if (t === 'stk_l2f_big') st.pushes++; return snd(t, d); };
  });
  return cells.length;
});
const sample = () => page.evaluate(() => (window.__btw.cells || []).map((st, i) => {
  const d = st.lastData || {}, o = d.owner, sel = d.sel, last = sel && sel.list.length ? Math.max(...sel.list.map((p) => p.ms)) : 0;
  const cell = window.STRYKER_VELA.cells()[i], bars = cell.chart.orchestrator.rawBars, lb = bars[bars.length - 1];
  const hub = [...(window.__stkL2FlowHubs || new Map()).values()][0], s = hub && hub.ts && hub.ts.s;
  return { i, tf: cell.timeframe, plate: o ? o.text : '', pushes: st.pushes, renders: st.renders, arcsLast: st.lastArcs,
    selected: sel ? sel.list.length : -1, inView: sel && st.vis ? sel.list.filter((p) => p.ms >= st.vis[0] && p.ms <= st.vis[1] + 86400000).length : -1, thr: sel ? sel.thr : 0, parents: sel ? sel.all : 0, newestTradeAgoS: s && s.trades.length ? Math.round((Date.now() - s.trades[s.trades.length - 1][0]) / 1000) : null, histFromH: s ? +((Date.now() - s.loadedFrom) / 3600000).toFixed(1) : null, newestPrintAgoS: last ? Math.round((Date.now() - last) / 1000) : null, bars: bars.length, lastBarAgoS: lb ? Math.round((Date.now() - lb.time) / 1000) : null,
    storeTrades: s ? s.trades.length : -1, storeV: s ? s.v : -1, storeErr: s ? s.err : '', floor: s ? s.floor : 0 };
}));
async function watch(tag) {
  const rows = [];
  for (let t = 0; t < MIN * 60; t += STEP) {
    await sleep(STEP * 1000);
    try { const s = await sample(); rows.push({ t, s }); say(tag, 't=' + t, JSON.stringify(s)); } catch (e) { say(tag, 'sample err', String(e.message).slice(0, 120)); }
  }
  return rows;
}
async function setup(layout) {
  await page.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA, null, { timeout: 90000 });
  if (layout) {
    await page.evaluate(() => window.STRYKER_CHART_UI.setLayout('2v')); await sleep(4000);
  }
  await page.evaluate(([t1, t2]) => {
    const ws = window.STRYKER_VELA, cells = ws.cells(); try { ws.sync.set('timeframe', false); } catch (e) {}
    cells.forEach((c, i) => { c.setSymbol('futures:NQ1!'); c.setTimeframe(i ? t2 : t1); });
  }, [TF1, TF2]);
  await sleep(8000);
  await page.evaluate(() => { for (const c of window.STRYKER_VELA.cells()) if (!(c.chart.indicators() || []).some((h) => h.nativeType === 'stk_l2f_big')) c.chart.addNativeIndicator('stk_l2f_big', {}); window.STRYKER_VELA.context().stateChanged(); });
  await sleep(4000);
  say('cells', await hook());
}
const out = { base: BASE, start: new Date().toISOString() };
try {
  say('login ->', (await login(page)).replace(/\?.*/, ''));
  await page.waitForTimeout(4000); say('after login', page.url().replace(/\?.*/, ''));
  await page.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await setup(false);
  await page.screenshot({ path: OUT + '/real-1chart-start.png' });
  out.one = await watch('1chart');
  await page.screenshot({ path: OUT + '/real-1chart-end.png' });
  await setup(true);
  await page.screenshot({ path: OUT + '/real-2chart-start.png' });
  out.two = await watch('2chart');
  await page.screenshot({ path: OUT + '/real-2chart-end.png' });
  say('RELOAD');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA, null, { timeout: 90000 });
  await sleep(15000);
  say('cells after reload', await hook());
  out.reload = await watch('reload');
  await page.screenshot({ path: OUT + '/real-reload.png' });
} catch (e) { say('ERR', String(e.stack || e).slice(0, 400)); }
out.errors = errors.filter((e) => !/favicon|WebSocket/.test(e)).slice(0, 30);
fs.writeFileSync(OUT + '/real-watch.json', JSON.stringify(out, null, 1));
fs.writeFileSync(OUT + '/real-watch.log', log.join('\n'));
await b.close();
