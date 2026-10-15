// Lazy heavy modules check: after __stkHeavyReady the volume / order-flow / GEX natives exist and can be added;
// a saved session carrying them restores them (heavy loaded BEFORE boot). Usage: node chart-lazy-heavy.js <port>
const { launch } = require('./lib.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8302';
(async () => {
  const b = await launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=768'] });
  let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
  const open = async (pre) => {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(require('./richstub.js'));
    await ctx.route(/www\.gstatic\.com\/firebasejs|firestore\.googleapis|identitytoolkit|securetoken/, (r) => r.abort());
    if (pre) await ctx.addInitScript(pre);
    const p = await ctx.newPage(); const errs = [];
    p.on('pageerror', (e) => errs.push(String(e).slice(0, 150)));
    p.on('console', (m) => { if (m.type() === 'warning' && /TradeZoro/.test(m.text())) errs.push(m.text().slice(0, 150)); });
    const t0 = Date.now();
    await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
    let paint = null;
    for (let i = 0; i < 200; i++) { const r = await p.evaluate(() => { try { return window.STRYKER_VELA.cells()[0].chart.orchestrator.rawBars.length > 0; } catch (e) { return false; } }).catch(() => false); if (r) { paint = Date.now() - t0; break; } await p.waitForTimeout(50); }
    return { ctx, p, errs, paint };
  };
  // 1. fresh visitor
  let s = await open();
  const heavyAtPaint = await s.p.evaluate(() => !!window.__stkHeavyReady);
  console.log('first paint', s.paint, 'ms; heavy ready at first paint:', heavyAtPaint);
  await s.p.waitForFunction(() => window.__stkHeavyReady, null, { timeout: 20000 });
  const r = await s.p.evaluate(() => {
    const c = window.STRYKER_VELA.context().cells[0].chart; const out = {};
    for (const t of ['stk_svp', 'stk_pdvp', 'stk_avwap', 'stk_rvol', 'stk_of_cvd', 'stk_of_delta', 'stk_gex', 'stk_gexheat', 'stk_em', 'vpvr']) { try { out[t] = !!c.addNativeIndicator(t); } catch (e) { out[t] = 'ERR ' + String(e.message).slice(0, 50); } }
    out.flow = !!window.__stkFlow && typeof window.__stkFlow.installOrderflow === 'function';
    out.picker = !!Object.getPrototypeOf(window.STRYKER_VELA.active).__stkVolume;
    return out;
  });
  console.log(JSON.stringify(r));
  Object.entries(r).forEach(([k, v]) => ok(v === true, 'fresh: ' + k));
  ok(s.errs.length === 0, 'fresh: no page errors / TradeZoro warnings ' + JSON.stringify(s.errs));
  // save the session with indicators on, then reload: heavy must be loaded before boot and the indicators restore
  await s.p.evaluate(() => window.STRYKER_VELA.context().stateChanged());
  await s.p.waitForTimeout(1500);
  const saved = await s.p.evaluate(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (/vela-workspace|stryker\.volume/.test(k)) o[k] = localStorage.getItem(k); } return o; });
  await s.ctx.close();
  ok(Object.keys(saved).length > 0, 'saved keys: ' + Object.keys(saved).join(','));
  await s.ctx.close();
  const ctx2 = await b.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx2.addInitScript(require('./richstub.js'));
  await ctx2.route(/www\.gstatic\.com\/firebasejs|firestore\.googleapis|identitytoolkit|securetoken/, (x) => x.abort());
  await ctx2.addInitScript('(' + ((st) => { if (!localStorage.getItem("__seeded")) { for (const k in st) localStorage.setItem(k, st[k]); localStorage.setItem("__seeded", "1"); } }).toString() + ')(' + JSON.stringify(saved) + ')');
  const p2 = await ctx2.newPage(); const e2 = []; p2.on('pageerror', (e) => e2.push(String(e).slice(0, 150)));
  await p2.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p2.waitForFunction(() => window.STRYKER_VELA, null, { timeout: 30000 });
  const readyAtBoot = await p2.evaluate(() => !!window.__stkHeavyReady);
  ok(readyAtBoot, 'saved session with stk_ indicators: heavy loaded before boot');
  await p2.waitForTimeout(3000);
  const types = await p2.evaluate(() => window.STRYKER_VELA.context().cells[0].chart.indicators().filter((h) => h.nativeType).map((h) => h.nativeType));
  console.log('restored natives:', types.join(','));
  ok(['stk_svp', 'stk_gex', 'stk_of_cvd'].every((t) => types.includes(t)), 'restored: svp + gex + of_cvd');
  ok(e2.length === 0, 'restore: no page errors ' + JSON.stringify(e2));
  await b.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})();
