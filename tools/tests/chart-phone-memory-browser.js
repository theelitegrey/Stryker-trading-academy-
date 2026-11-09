// Phone chart memory + crash-loop guard (phone crash 09 Nov: member Neon's iPhone crash-looped on the Charts page).
// Layout: Neon's saved state (tools/tests/fixtures/neon-layout-state.json): CME:NQ1! 1m, two big Pine scripts on the
// next engine, absorption + big trades + GEX levels; signed-in tick-engine lane (fixture hub), 390x844 at 3x, iPhone UA.
//
// MEMORY: after the chart and indicators are up, then every minute for MINUTES (default 5) of live ticks:
//   - canvas pixel memory: every canvas that has a 2D/GL context, 4 B/px <= CANVAS_MB (200). WebKit backs a canvas
//     with its full width x height as soon as it has a context, drawn on or not (origin/main 09 Nov: 856 MB, s7: 169 MB)
//   - JS heap, page + every worker                                   <= HEAP_MB   (300)
//   - growth over the ticks (last - first sample, page + workers)    <= GROW_MB   (40)
//   - DOM nodes growth                                                <= GROW_NODES (400)
// Budget: iOS Safari kills a tab at roughly 1-1.5 GB for everything (canvases + JS + images + WebKit itself).
// 300 MB JS + 200 MB canvas leaves half the low end for the browser engine and the GPU copies.
//
// GUARD: a load that dies before the chart is stable (CDP Page.crash, so no pagehide) leaves the "chart loading" mark;
// the next load opens in safe mode: the banner shows, no Pine script or native indicator runs, the saved layout in
// localStorage is unchanged after 25 s (autosave must not write over it); "Turn them back on" brings back both Pine
// scripts and the 3 natives and removes the banner.
//
//   python3 tools/tests/tick-engine-hub.py 8091 1 &
//   node tools/tests/chart-dev-server.mjs 8090 &   (or any static server of the repo root)
//   flock /tmp/stryker-chrome.lock node tools/tests/chart-phone-memory-browser.js [--guard-only] [--mem-only]
// env: CHART_BASE (http://127.0.0.1:8090), HUB (http://127.0.0.1:8091), MINUTES, OUT (json file of the samples)
const fs = require('fs');
const { launch } = require('./lib.js');
const { openPhone, measure, neonState } = require('./phone-mem-lib.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8090', HUB = process.env.HUB || 'http://127.0.0.1:8091';
const MIN = +(process.env.MINUTES || 5);
const BUDGET = { canvasMB: 200, heapMB: 300, growMB: 40, growNodes: 400 };
const KEY = 'vela-workspace-090';
let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fails++; };
const up = (p) => p.waitForFunction(() => window.__stkFirstCandles && window.__stkHeavyReady, null, { timeout: 180000, polling: 250 });
const idle = (p) => p.waitForFunction(() => !document.documentElement.classList.contains('stk-pine-busy'), null, { timeout: 180000, polling: 500 }).catch(() => {});
const state = (p) => p.evaluate(() => {
  const c = window.STRYKER_VELA.chart;
  let pine = 0; try { pine = window.STRYKER_PINE.pineHandles(c).length; } catch (e) {}
  let nat = ['?']; try { nat = window.STRYKER_VELA.active.nativeHandles().map((h) => h.nativeType).filter((t) => t !== 'volume'); } catch (e) {}
  const b = document.getElementById('stks-banner');
  return { pine, nat: nat.sort(), banner: b ? b.innerText : null, safe: !!(window.__stkSafe && window.__stkSafe.active), mark: localStorage.getItem('stryker_chart_loading') };
});

async function memory(b) {
  const { p, cdp, errors } = await openPhone(b, { base: BASE, hub: HUB });
  await up(p);
  await p.waitForFunction(() => { try { return window.STRYKER_PINE.pineHandles(window.STRYKER_VELA.chart).length >= 2; } catch (e) { return false; } }, null, { timeout: 120000 });
  await p.waitForTimeout(5000); await idle(p);
  const s = [];
  for (let i = 0; i <= MIN; i++) {
    if (i) await p.waitForTimeout(60000);
    const m = await measure(b, p, cdp, process.pid);
    m.t = i; s.push(m);
    console.log(`t=${i}m page ${m.pageHeapMB} MB, workers ${m.workerHeapMB} MB, canvas ${m.census && m.census.ctxMB} MB (drawn on ${m.census && m.census.touchedMB}), nodes ${m.dom.nodes}, bars ${m.bars}, pine ${m.pine}`);
  }
  if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify({ budget: BUDGET, samples: s }, null, 1));
  const first = s[0], last = s[s.length - 1];
  const maxHeap = Math.max(...s.map((x) => x.totalHeapMB)), maxCanvas = Math.max(...s.map((x) => (x.census && x.census.ctxMB) || 0));
  check(first.pine === 2, 'both Pine scripts run (' + first.pine + ')');
  check(maxCanvas <= BUDGET.canvasMB, `canvas pixels ${maxCanvas} MB <= ${BUDGET.canvasMB} MB`);
  check(maxHeap <= BUDGET.heapMB, `JS heap page + workers ${maxHeap} MB <= ${BUDGET.heapMB} MB`);
  check(last.totalHeapMB - first.totalHeapMB <= BUDGET.growMB, `heap growth over ${MIN} min ${Math.round(last.totalHeapMB - first.totalHeapMB)} MB <= ${BUDGET.growMB} MB`);
  check(last.dom.nodes - first.dom.nodes <= BUDGET.growNodes, `DOM nodes growth ${last.dom.nodes - first.dom.nodes} <= ${BUDGET.growNodes}`);
  check(!errors.length, 'no page errors ' + errors.slice(0, 3).join(' | '));
  await p.context().close();
}

async function guard(b) {
  // 1) a load that dies before the chart is stable
  const a = await openPhone(b, { base: BASE, hub: HUB });
  await a.p.waitForFunction(() => window.__stkFirstCandles, null, { timeout: 120000 });
  const mark = await a.p.evaluate(() => localStorage.getItem('stryker_chart_loading'));
  check(!!mark, 'a phone load sets the "chart loading" mark');
  const saved = await a.p.evaluate((k) => localStorage.getItem(k), KEY);
  // Page.crash never answers (the renderer is gone), so do not await it
  a.cdp.send('Page.crash').catch(() => {});
  await a.p.waitForEvent('crash', { timeout: 15000 }).catch(() => {});
  console.log('  crashed the first load');
  await a.p.waitForTimeout(500);
  // 2) the next load (same storage): safe mode
  const p = await a.ctx.newPage();
  const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html?engine=1', { waitUntil: 'domcontentloaded' });
  await p.evaluate(async () => { const v = (await (await fetch('/assets/version.json')).json()).build; (await import('/assets/rt-access.js?v=' + v))._rtSetForTests(true, 'test-token'); });
  await up(p);
  await p.waitForSelector('#stks-banner', { timeout: 30000 }).catch(() => {});
  await p.waitForTimeout(25000);   // past the 20 s stable timer and well past every autosave
  let st = await state(p);
  check(st.safe && /closed unexpectedly/.test(st.banner || '') && /Turn them back on/.test(st.banner || ''), 'safe mode: banner shown: ' + JSON.stringify(st.banner));
  check(st.pine === 0 && st.nat.length === 0, 'safe mode: no indicator runs (pine ' + st.pine + ', natives ' + st.nat + ')');
  check(/CISD Model\+/.test(st.banner) && /2022 Model Pro\+/.test(st.banner) && (st.banner.match(/\n/g) || []).length >= 5, 'safe mode: each paused indicator listed');
  const after = await p.evaluate((k) => localStorage.getItem(k), KEY);
  check(after === saved, 'safe mode: saved layout untouched after 25 s (' + (after || '').length + ' vs ' + (saved || '').length + ' chars)');
  check(!!st.mark, 'safe mode keeps the mark until the indicators are back');
  if (process.env.SHOT) await p.screenshot({ path: process.env.SHOT });
  // 3) turn them back on
  await p.click('.stks-on');
  await p.waitForFunction(() => { try { return window.STRYKER_PINE.pineHandles(window.STRYKER_VELA.chart).length >= 2; } catch (e) { return false; } }, null, { timeout: 120000 });
  await p.waitForTimeout(3000);
  st = await state(p);
  check(!st.safe && st.banner === null, 'turned back on: banner gone, safe mode off');
  check(st.pine === 2 && JSON.stringify(st.nat) === JSON.stringify(['stk_gex', 'stk_l2f_big', 'stk_of_abs']), 'turned back on: 2 Pine + 3 natives (' + st.pine + ', ' + st.nat + ')');
  // a later state change may save again, with the indicators in it
  const fin = JSON.parse(await p.evaluate((k) => localStorage.getItem(k), KEY) || '{}');
  const c0 = (fin.charts || [])[0] || {};
  check(((c0.ext && c0.ext['stryker.pine']) || []).length === 2, 'saved layout still has both Pine scripts');
  check(!errors.length, 'no page errors ' + errors.slice(0, 3).join(' | '));
  await a.ctx.close();
}

(async () => {
  const b = await launch();
  try {
    if (!process.argv.includes('--mem-only')) await guard(b);
    if (!process.argv.includes('--guard-only')) await memory(b);
  } finally { await b.close(); }
  console.log(fails ? `${fails} FAILED` : 'ALL PASS');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
