// REAL-feed probe for GK 14 Nov ("heatmap and big trades not updated even after refreshing", NQ1! 1m, market closed).
// Live site, demo account, NQ1! 1m, Depth Heatmap (L2) + Big Trades (L2). No input; samples the feed state after load.
// LOCAL=1: the live site + real feed, but the chart modules listed in FILES come from this worktree (tests a fix before it ships).
//   flock /tmp/stryker-chrome.lock node tools/tests/hm-update-real-probe.mjs <outdir> [width] [theme]
import fs from 'node:fs';
import dns from 'node:dns/promises';
import { createRequire } from 'node:module';
import { login, BASE } from '../demo-account/lib/browser.mjs';
const { chromium } = createRequire('/root/projects/stryker-trading-academy/package.json')('playwright-core');
const OUT = process.argv[2] || '.', W = Number(process.argv[3] || 1440), THEME = process.argv[4] || 'dark', TAG = process.env.TAG || (process.env.LOCAL ? 'after' : 'before');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const G = ['identitytoolkit.googleapis.com', 'securetoken.googleapis.com', 'firestore.googleapis.com', 'www.googleapis.com', 'firebaseinstallations.googleapis.com'];
const rules = (await Promise.all(G.map(async (h) => { try { return 'MAP ' + h + ' ' + (await dns.resolve4(h))[0]; } catch (e) { return ''; } }))).filter(Boolean).join(', ');
const b = await chromium.launch({ executablePath: '/root/.cache/ms-playwright/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=768', '--host-resolver-rules=' + rules, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const phone = W < 500;
const ctx = await b.newContext({ viewport: { width: W, height: phone ? 844 : 900 }, deviceScaleFactor: 1, isMobile: phone, hasTouch: phone, colorScheme: THEME });
await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); } catch (e) {} }, THEME);
const FILES = (process.env.FILES || 'chart-ts-trades').split(',');
if (process.env.LOCAL) await ctx.route(new RegExp('/assets/(' + FILES.join('|') + ')\\.js'), async (r) => {
  const u = new URL(r.request().url()), f = u.pathname.split('/').pop(), v = u.searchParams.get('v');
  r.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(new URL('../../assets/' + f, import.meta.url), 'utf8').replace(/\?v=\d+/g, '?v=' + v) });
});
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERR', String(e.message).slice(0, 200)));
page.on('response', (r) => { if (/ts-trades|ts-book-history|ts-aux/.test(r.url())) console.log('NET', r.status(), r.url().replace(/^https?:\/\/[^/]+/, '').slice(0, 110)); });
const snap = (tag) => page.evaluate((tag) => {
  const c = window.STRYKER_VELA.cells()[0], bars = c.chart.orchestrator.rawBars, now = Date.now();
  const hub = [...(window.__stkL2FlowHubs || new Map()).values()][0], s = hub && hub.ts && hub.ts.s, f = hub && hub.feed;
  let r = c.chart.renderer; r = r && r.extLayers ? r : r && r.renderer;
  const l = r.extLayers.find((x) => x.def.id === 'stk_l2f_big'), d = l ? r.scene.nativeData.get(l.channel) || {} : {};
  const dh = window.__stkFlow && window.__stkFlow.dhDebug && window.__stkFlow.dhDebug();
  const diag = window.tzL2Diag ? window.tzL2Diag('futures:NQ1!') : null;
  const h = (t) => (t > 0 && Number.isFinite(t) ? +((now - t) / 3600000).toFixed(2) : null);
  return { tag, bars: bars.length, lastBarAgoH: h(bars[bars.length - 1].time), sockets: diag && diag.sockets,
    store: s ? { started: s.started, loading: s.loading, trades: s.trades.length, loadedFromAgoH: h(s.loadedFrom), err: s.err, newestAgoH: s.trades.length ? h(s.trades[s.trades.length - 1][0]) : null } : 'none',
    book: f ? { status: f.status, remote: f.remote.length, remoteState: f.remoteState, remoteFromAgoH: h(f.remoteFrom), local: f.history.length, newestRemoteAgoH: f.remote.length ? h(f.remote[f.remote.length - 1].ts) : null } : 'none',
    big: d.sel ? { marks: d.sel.list.length, thr: d.sel.thr } : null, dh: dh ? { samples: dh.samples, cells: dh.heat && dh.heat.cells, bubbles: dh.bubbles, ladder: dh.ladderRows } : null,
    dhNote: window.__stkDhNote, l2Note: window.__stkL2Note };
}, tag);
try {
  console.log('login', (await login(page)).replace(/\?.*/, ''));
  await page.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA, null, { timeout: 90000 });
  await page.evaluate(() => { try { window.STRYKER_CHART_UI.setLayout('1'); } catch (e) {} const c = window.STRYKER_VELA.cells()[0]; c.setSymbol('futures:NQ1!'); c.setTimeframe('1'); });
  await sleep(8000);
  await page.evaluate(() => { const c = window.STRYKER_VELA.cells()[0], have = (t) => (c.chart.indicators() || []).some((h) => h.nativeType === t);
    if (!have('stk_depth_heat')) c.chart.addNativeIndicator('stk_depth_heat', {}); if (!have('stk_l2f_big')) c.chart.addNativeIndicator('stk_l2f_big', {}); window.STRYKER_VELA.context().stateChanged(); });
  for (const t of [15, 30, 45]) { await sleep(15000); console.log('SNAP', JSON.stringify(await snap(t + 's'))); }
  await page.keyboard.press('Escape'); await sleep(300);
  // the demo account's one-time country dialog covers the chart (not part of this bug): hide it for the shot only
  await page.evaluate(() => { const g = document.getElementById('geo-gate'); if (g) g.style.display = 'none'; for (const e of document.querySelectorAll('[class*=modal], [class*=agree]')) if (getComputedStyle(e).position === 'fixed') e.style.display = 'none'; });
  await sleep(600);
  const fn = OUT + '/' + TAG + '-' + W + '-' + THEME + '.png';
  await page.screenshot({ path: fn }); console.log('SHOT', fn);
} catch (e) { console.log('ERR', String(e.stack || e).slice(0, 400)); }
await b.close();
