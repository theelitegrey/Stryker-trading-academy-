// LIVE soak (market hours): signs in with the demo/admin account file, opens NQ 1m and NQ 5m (second one with
// HTF PO3 Lens) on the live site, samples every second, logs stuck periods, hides the 5m tab for 5 min.
//   node tools/tests/chart-live-soak.mjs <minutes> <outdir>   (credentials file: see tools/demo-account/lib/browser.mjs; never printed)
import fs from 'node:fs';
import { launch, login, BASE } from '../demo-account/lib/browser.mjs';
const MIN = Number(process.argv[2] || 32), OUT = process.argv[3] || '.';
const { b, ctx, page: p1, errors } = await launch(1440, 900);
const out = { samples: 0, tabs: {}, hidden: null };
try {
  await login(p1);
  const p2 = await ctx.newPage();
  for (const p of [p1, p2]) p.on('pageerror', (e) => errors.push('PAGEERR ' + String(e.message).slice(0, 160)));
  const tabs = [{ name: 'NQ 1m', p: p1, tf: '1', step: 60, pine: false }, { name: 'NQ 5m + HTF PO3 Lens', p: p2, tf: '5', step: 300, pine: true }];
  for (const t of tabs) {
    await t.p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
    await t.p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA, null, { timeout: 60000 });
    await t.p.evaluate(([tf]) => { const ws = window.STRYKER_VELA; ws.active.setSymbol('futures:NQ1!'); ws.active.setTimeframe(tf); }, [t.tf]);
    await t.p.waitForTimeout(6000);
    if (t.pine) {
      await t.p.evaluate(async () => { const src = await (await fetch('/assets/pine/htf-po3-lens-stryker.pine')).text(); await window.STRYKER_PINE.addSource('htf-po3-lens-stryker', src, { engine: 'next', builtin: true }); });
      await t.p.waitForTimeout(4000);
    }
    out.tabs[t.name] = { stuckPeriods: [], maxStuckS: 0, maxBehindS: 0, lastChange: Date.now(), last: '', behindSince: 0 };
  }
  const state = (p) => p.evaluate(() => {
    const r = window.STRYKER_VELA.chart.orchestrator.rawBars, l = r[r.length - 1];
    const dot = document.querySelector('.stkc-dd-t');
    return { t: l && l.time, sig: l ? [l.time, l.high, l.low, l.close, l.volume].join('|') : '', dot: dot ? dot.textContent : '', rt: window.tzRtState && window.tzRtState(), stalls: window.tzStallStats && window.tzStallStats().count };
  });
  const end = Date.now() + MIN * 60000, hideAt = Date.now() + 8 * 60000, showAt = hideAt + 5 * 60000;
  let hid = false, shown = false; const hideLog = {};
  while (Date.now() < end) {
    const now = Date.now();
    if (!hid && now >= hideAt) {
      hid = true;
      await p2.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
      hideLog.hiddenAt = new Date().toISOString();
    }
    if (hid && !shown && now >= showAt) {
      shown = true; hideLog.t0 = Date.now();
      await p2.evaluate(() => { delete document.hidden; delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange')); });
      hideLog.shownAt = new Date().toISOString();
    }
    for (const t of tabs) {
      const o = out.tabs[t.name]; let s;
      try { s = await state(t.p); } catch (e) { continue; }
      const hiddenNow = t.p === p2 && hid && !shown;
      const behind = Math.floor(now / 1000) - Math.floor(s.t / 1000) - t.step;   // > 0: a newer bar should already exist
      if (!hiddenNow) {
        o.maxBehindS = Math.max(o.maxBehindS, behind > 0 ? behind : 0);
        if (s.sig !== o.last) { o.last = s.sig; o.lastChange = now; }
        const quiet = (now - o.lastChange) / 1000;
        const stuck = behind > 15 || quiet > 15;
        if (stuck && !o.behindSince) o.behindSince = now;
        if (!stuck && o.behindSince) { const d = (now - o.behindSince) / 1000; o.stuckPeriods.push({ at: new Date(o.behindSince).toISOString(), seconds: Math.round(d), why: behind > 15 ? 'behind' : 'quiet' }); o.maxStuckS = Math.max(o.maxStuckS, d); o.behindSince = 0; }
      }
      o.dot = s.dot; o.rt = s.rt; o.stalls = s.stalls; o.behindNow = behind;
      if (hideLog.t0 && t.p === p2 && !hideLog.caughtAt && behind <= 15 && now > hideLog.t0) { hideLog.caughtAt = now; hideLog.catchUpS = (now - hideLog.t0) / 1000; }
    }
    out.samples++;
    if (out.samples % 30 === 0) console.log(new Date().toISOString(), JSON.stringify(Object.fromEntries(Object.entries(out.tabs).map(([k, v]) => [k, { dot: v.dot, stalls: v.stalls, behindNow: v.behindNow, maxBehindS: v.maxBehindS, stuck: v.stuckPeriods.length }]))));
    await new Promise((r) => setTimeout(r, 1000));
  }
  out.hidden = hideLog;
  for (const t of tabs) { out.tabs[t.name].stallLog = await t.p.evaluate(() => window.tzStallStats && window.tzStallStats()); await t.p.screenshot({ path: `${OUT}/soak-${t.tf}m-1440.png` }); }
  out.errors = errors.slice(0, 20);
} finally { await b.close(); fs.writeFileSync(`${OUT}/soak-result.json`, JSON.stringify(out, null, 1)); console.log(JSON.stringify(out, null, 1).slice(0, 4000)); }
