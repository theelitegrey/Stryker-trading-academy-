// 5m + 15m on BTCUSDT and ETHUSDT.P (1440 + 390) against the real Binance feeds: CHART_BASE=http://127.0.0.1:8031 OUT=/tmp node tools/tests/chart-footprint-crypto-tf-browser.js
const { launch } = require('./lib.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const BASE = process.env.CHART_BASE || process.env.BASE || 'http://127.0.0.1:8031', OUT = process.env.OUT || '/tmp/w1fp';
let fail = 0; const check = (ok, m, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + m + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 300) : '')); };
(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  for (const [w, h, tag, mob] of [[1440, 900, 'd', 0], [390, 844, 'm', 1]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: !!mob, hasTouch: !!mob });
    await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.removeItem('stryker.vela.session'); } catch (e) {} });
    const p = await ctx.newPage(); const errs = [];
    p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|econ-calendar|CORS|net::|WebSocket connection/.test(m.text())) errs.push(m.text().slice(0, 150)); });
    await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_VELA.chart && window.__stkOrderflow, null, { timeout: 60000 });
    await sleep(2500);
    for (const sym of ['binance:BTCUSDT', 'binance:ETHUSDT.P']) for (const tf of ['5', '15']) {
      await p.evaluate(async ([s, tf]) => { const ws = window.STRYKER_VELA; ws.active.setSymbol(s); ws.active.setTimeframe(tf); for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 250)); if (ws.chart.market.symbol === s && ws.chart.market.timeframe === tf && ws.chart.orchestrator.rawBars.length > 50) break; } ws.active.setPriceStyle('stk_fp'); }, [sym, tf]);
      let st; for (let i = 0; i < 60; i++) { st = await p.evaluate(() => window.__stkOrderflow.crypto()); if (st && st.status === 'live') break; await sleep(1000); }
      await p.evaluate((n) => { const c = window.STRYKER_VELA.chart, rb = c.orchestrator.rawBars, k = rb.length; c.setVisibleRange({ from: rb[k - n].time, to: rb[k - 1].time + 90000 }); }, mob ? 5 : 10);
      await sleep(2500);
      const r = await p.evaluate(() => { const rb = window.STRYKER_VELA.chart.orchestrator.rawBars; const tfm = +window.STRYKER_VELA.chart.market.timeframe; const o = window.__stkOrderflow.crypto(); const have = new Set(o.vols.map((v) => Math.floor(v[0] / (tfm * 60000)) * tfm * 60000)); const last = rb.slice(-8); let px = 0; for (const c of document.querySelectorAll('#vela-chart canvas')) { if (!c.width) continue; try { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 64) if (d[i] > 0) px++; } catch (e) {} } return { cov: last.filter((x) => have.has(x.time)).length / last.length, px, status: o.status, mins: o.minutes }; });
      const name = sym.replace('binance:', '').replace('.', '') + '-' + tf + 'm-' + tag;
      check(r.status === 'live' && r.px > 1500, `${w}: ${sym} ${tf}m footprint drawn (px ${r.px}, status ${r.status}, ${r.mins} min)`, r);
      await p.screenshot({ path: `${OUT}/${name}.png` });
      console.log('  shot', name + '.png');
    }
    check(errs.length === 0, w + ': no console errors', errs);
    await ctx.close();
  }
  await b.close(); console.log(fail ? fail + ' FAILED' : 'ALL PASSED');
})();
