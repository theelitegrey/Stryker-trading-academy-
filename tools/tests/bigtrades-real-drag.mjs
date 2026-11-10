// REAL-feed probe for GK's "symbols appear when I drag, gone after refresh" (Big Trades (L2), NQ1! 1m, one chart, live site).
// 1) load, record the marks (ms|size) and the auto threshold; 2) real mouse drags to the right (scroll back in time, like a member does):
// the chart loads older bars -> the indicator asks the shared trade store for more history; record again; 3) reload, record again.
// Also: the trades folded live during the run vs the same minutes re-read from the recorder after the reload (live fold == history?).
//   flock /tmp/stryker-chrome.lock node tools/tests/bigtrades-real-drag.mjs <outdir>
import fs from 'node:fs';
import dns from 'node:dns/promises';
import { createRequire } from 'node:module';
import { login, BASE } from '../demo-account/lib/browser.mjs';
const { chromium } = createRequire('/root/projects/stryker-trading-academy/package.json')('playwright-core');
const OUT = process.argv[2] || '.', LIVE_MIN = Number(process.argv[3] || 4);
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const G = ['identitytoolkit.googleapis.com', 'securetoken.googleapis.com', 'firestore.googleapis.com', 'www.googleapis.com', 'firebaseinstallations.googleapis.com'];
const rules = (await Promise.all(G.map(async (h) => { try { return 'MAP ' + h + ' ' + (await dns.resolve4(h))[0]; } catch (e) { return ''; } }))).filter(Boolean).join(', ');   // this server's IPv6 gets 403 from Google sign-in
const b = await chromium.launch({ executablePath: '/root/.cache/ms-playwright/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=768', '--host-resolver-rules=' + rules] });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
// LOCAL=1: the live site + real feed, but the Big Trades files come from this worktree (tests a fix before it ships)
if (process.env.LOCAL) await ctx.route(/\/assets\/(chart-bigtrades|chart-l2-flow|chart-ts-trades)\.js/, async (r) => {
  const u = new URL(r.request().url()), f = u.pathname.split('/').pop(), v = u.searchParams.get('v');
  // same ?v= as the live page for every sibling import, else the page loads a second, never-started copy of the feed modules
  r.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(new URL('../../assets/' + f, import.meta.url), 'utf8').replace(/\?v=\d+/g, '?v=' + v) });
});
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('CONSOLE', m.type(), m.text().slice(0, 200)); });
page.on('pageerror', (e) => console.log('PAGEERR', String(e.message).slice(0, 200)));
page.on('response', (r) => { if (/ts-trades/.test(r.url())) console.log('TS-TRADES', r.status(), r.url().replace(/.*\?/, '').slice(0, 80)); });
const out = {};
const snap = (tag) => page.evaluate((tag) => {
  const c = window.STRYKER_VELA.cells()[0], bars = c.chart.orchestrator.rawBars;
  const o = [...(window.__stkL2FlowHubs || new Map()).values()][0], s = o && o.ts && o.ts.s;
  let r = c.chart.renderer; r = r && r.extLayers ? r : r && r.renderer;
  const l = r.extLayers.find((x) => x.def.id === 'stk_l2f_big'), d = r.scene.nativeData.get(l.channel) || {};
  const sel = d.sel || { list: [] };
  return { tag, bars: bars.length, firstBarH: +((Date.now() - bars[0].time) / 3600000).toFixed(1), histH: s ? +((Date.now() - s.loadedFrom) / 3600000).toFixed(1) : null, err: s ? s.err : 'no store', started: s ? s.started : null, loading: s ? s.loading : null, need: s ? +((Date.now() - s.need) / 3600000).toFixed(1) : null, storeTrades: s ? s.trades.length : 0,
    thr: sel.thr, parents: sel.all, marks: sel.list.map((p) => p.ms + '|' + p.size), plate: d.owner ? d.owner.text : '' };
}, tag);
const tradesSince = (t0) => page.evaluate((t0) => { const o = [...window.__stkL2FlowHubs.values()][0]; return o.ts.s.trades.filter((x) => x[0] >= t0 && x[0] < Date.now() - 5000).map((x) => x.join('|')); }, t0);
try {
  console.log('login', (await login(page)).replace(/\?.*/, ''));
  await page.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA, null, { timeout: 90000 });
  await page.evaluate(() => { try { window.STRYKER_CHART_UI.setLayout('1'); } catch (e) {} const c = window.STRYKER_VELA.cells()[0]; c.setSymbol('futures:NQ1!'); c.setTimeframe('1'); });
  await sleep(8000);
  await page.evaluate(() => { const c = window.STRYKER_VELA.cells()[0]; if (!(c.chart.indicators() || []).some((h) => h.nativeType === 'stk_l2f_big')) c.chart.addNativeIndicator('stk_l2f_big', {}); window.STRYKER_VELA.context().stateChanged(); });
  await sleep(15000);
  out.a = await snap('loaded'); console.log(JSON.stringify(Object.assign({}, out.a, { marks: out.a.marks.length })));
  const tLive = Date.now();
  await page.screenshot({ path: OUT + '/drag-0-loaded.png' });
  // close any modal (country / agreement) so the mouse reaches the chart; the modal is not part of the bug
  await page.keyboard.press('Escape'); await sleep(500);
  // hide whatever sits over the plot at the drag point (agreement / country modal and its backdrop), until the chart canvas is hit
  console.log('hidden overlays', await page.evaluate(() => { let n = 0; for (let k = 0; k < 20; k++) { const e = document.elementFromPoint(500, 450); if (!e || e.tagName === 'CANVAS' || e.closest('.vela-chart, [class*=vela]')) break; let t = e; while (t.parentElement && t.parentElement !== document.body) t = t.parentElement; t.style.display = 'none'; n++; } return n + ' -> ' + (document.elementFromPoint(500, 450) || {}).tagName; }));
  for (let k = 0; k < 6; k++) {   // real drags: grab the plot and pull right = older bars come into view
    await page.mouse.move(500, 450); await page.mouse.down(); await page.mouse.move(1250, 450, { steps: 20 }); await page.mouse.up(); await sleep(2500);
  }
  await sleep(15000);
  out.b = await snap('after drag'); console.log(JSON.stringify(Object.assign({}, out.b, { marks: out.b.marks.length })));
  await page.screenshot({ path: OUT + '/drag-1-dragged.png' });
  console.log('waiting', LIVE_MIN, 'min of live trades');
  await sleep(LIVE_MIN * 60000);
  out.b2 = await snap('after live wait'); console.log(JSON.stringify(Object.assign({}, out.b2, { marks: out.b2.marks.length })));
  out.liveFold = await tradesSince(tLive);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA, null, { timeout: 90000 });
  await sleep(25000);
  out.c = await snap('after reload'); console.log(JSON.stringify(Object.assign({}, out.c, { marks: out.c.marks.length })));
  out.histSame = await tradesSince(tLive);
  await page.screenshot({ path: OUT + '/drag-2-reloaded.png' });
  const tEnd = Math.min(...[out.liveFold, out.histSame].map((a) => (a.length ? Number(a[a.length - 1].split('|')[0]) : 0)));
  const A = new Set(out.liveFold.filter((x) => Number(x.split('|')[0]) <= tEnd)), B = new Set(out.histSame.filter((x) => Number(x.split('|')[0]) <= tEnd));
  console.log('live-folded trades', A.size, 'history trades same span', B.size, 'in both', [...A].filter((x) => B.has(x)).length);
  const inA = (set, lo, hi) => [...set].filter((m) => { const t = Number(m.split('|')[0]); return t >= lo && t <= hi; });
  const lo = Date.now() - out.a.firstBarH * 3600000;
  const ma = new Set(out.a.marks), mb = new Set(out.b.marks), mc = new Set(out.c.marks);
  console.log('marks in the first view span: loaded', inA(ma, lo, Infinity).length, '| after drag', inA(mb, lo, Infinity).length, '| after reload', inA(mc, lo, Infinity).length);
  console.log('thr loaded', out.a.thr, 'after drag', out.b.thr, 'after reload', out.c.thr);
  // the check: marks older than the live wait, inside the first view, are the same on load, after the drag and after the reload
  const span = (m) => [...m].filter((x) => { const t = Number(x.split('|')[0]); return t >= lo && t < tLive; }).sort().join(',');
  const same = span(ma) === span(mb) && span(mb) === span(mc) && span(ma).length > 0;
  console.log((same ? 'PASS' : 'FAIL') + ' same marks in the first view on load / after drag / after reload');
} catch (e) { console.log('ERR', String(e.stack || e).slice(0, 400)); }
fs.writeFileSync(OUT + '/real-drag.json', JSON.stringify(out));
await b.close();
