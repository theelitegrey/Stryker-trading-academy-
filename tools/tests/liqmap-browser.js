// Liquidity Map in the browser (assets/chart-liquidity-map.js): BTC 1m on Vela 0.9 + 0.6, 1440 + 390, from the REAL
// recording fixture (see chart-liquidity-browser.js). Shots to argv[2]. LM_ENG=09|06, LM_W=1440|390, LM_SLOW=4 (CPU throttle).
const path = require('path');
const { launch } = require('./lib.js');
const L = require('./liqmap-lib.js');
const { open, R, T_END, MIN, sleep } = L;
const OUT = process.argv[2] || '.';
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 400))); };
const dbg = (p) => p.evaluate(() => window.__stkFlow.lmDebug());
const frame = (p, a, z) => p.evaluate(([a, z]) => window.STRYKER_VELA.chart.setVisibleRange({ from: a, to: z }), [a, z]).then(() => sleep(1500));
(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=600'] });
  try {
    for (const v09 of (process.env.LM_ENG === '09' ? [true] : process.env.LM_ENG === '06' ? [false] : [true, false])) {
      const eng = v09 ? 'v09' : 'v06';
      for (const [w, h, mobile] of [[1440, 900, false], [390, 844, true]].filter((x) => !process.env.LM_W || String(x[0]) === process.env.LM_W)) {
        const { ctx, p, errors } = await open(b, { w, h, mobile, v09 });
        const ok = await p.evaluate(() => !!window.STRYKER_VELA.chart.addNativeIndicator('stk_liqmap', { inputs: {} }));
        check(ok, eng + ' ' + w + ': Liquidity Map added');
        await sleep(1500);
        await p.evaluate((s) => window.__stkFlow.domDebugLoad(s), R.samples);
        await p.waitForFunction(() => { const d = window.__stkFlow.lmDebug(); return d && d.cells > 0; }, null, { timeout: 30000 }).catch(() => {});
        const span = T_END - R.samples[0].ts;
        await frame(p, T_END - (w < 500 ? 20 * MIN : span), T_END + (w < 500 ? 3 : 6) * MIN);
        await sleep(2500);
        if (process.env.LM_SLOW) {
          const cdp = await ctx.newCDPSession(p);
          await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.LM_SLOW) });
          const fps = await p.evaluate(async () => {
            const c = window.STRYKER_VELA.chart, vr = c.getVisibleRange ? c.getVisibleRange() : null;
            let n = 0; const t0 = performance.now(); let raf;
            await new Promise((res) => { const tick = () => { n++; if (performance.now() - t0 < 3000) requestAnimationFrame(tick); else res(); }; requestAnimationFrame(tick); });
            return Math.round(n / ((performance.now() - t0) / 1000));
          });
          const ms = (await dbg(p)).ms;
          console.log('SLOWDOWN x' + process.env.LM_SLOW + ' idle fps ' + fps + ', frame ms ' + ms);
          // scroll: drag-pan simulation by moving the visible range
          const t0 = Date.now(); let frames = 0;
          for (let i = 0; i < 30; i++) { await p.evaluate((i) => window.STRYKER_VELA.chart.setVisibleRange({ from: Date.now() - 20 * 60000 - i * 20000, to: Date.now() + 3 * 60000 - i * 20000 }), i); await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); frames++; }
          console.log('SCROLL x' + process.env.LM_SLOW + ': ' + Math.round(frames / ((Date.now() - t0) / 1000)) + ' set+paint cycles/s, last frame ' + (await dbg(p)).ms + ' ms');
          await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
          await frame(p, T_END - 20 * MIN, T_END + 3 * MIN);
        }
        const d = await dbg(p);
        console.log('STAT', JSON.stringify(d).slice(0, 700));
        check(d && d.cells > 0, eng + ' ' + w + ': heat texture drawn', d && d.cells);
        check(d && d.bubbles > 0, eng + ' ' + w + ': bubbles drawn (' + (d && d.bubbles) + ')');
        check(d && d.ladderRows > 5, eng + ' ' + w + ': ladder rows (' + (d && d.ladderRows) + ')');
        check(d && d.volBars > 0, eng + ' ' + w + ': volume bars (' + (d && d.volBars) + ')');
        check(d && d.gridLines > 1, eng + ' ' + w + ': time grid (' + (d && d.gridLabels) + ')');
        await p.mouse.move(5, 5).catch(() => {}); await sleep(500);
        await p.screenshot({ path: path.join(OUT, 'lm-' + eng + '-' + w + '.png') });
        if (w === 1440 && !process.env.LM_SLOW) {   // display filter (assets/chart-heat-filter.js): blue cells go, warm cells stay
          const blue = () => p.evaluate(() => { let n = 0, warm = 0; for (const c of document.querySelectorAll('#vela-chart canvas')) { if (!c.width) continue; let d; try { d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; } catch (e) { continue; } for (let q = 0; q < d.length; q += 4 * 5) { if (d[q + 3] < 200) continue; if (d[q + 2] > d[q] + 60 && d[q + 2] > 90) n++; else if (d[q] > 200 && d[q + 2] < 120) warm++; } } return [n, warm]; });
          const setF = (o) => p.evaluate((o) => { const h = window.STRYKER_VELA.chart.indicators().find((x) => x.nativeType === 'stk_liqmap'); h.setInputs(Object.assign({}, h.inputValues(), o)); }, o);
          const b0 = await blue(); await setF({ hfStep_lm: 'Yellow and above' }); await sleep(1500); const b1 = await blue();
          check(b0[0] > 1000 && b1[0] < b0[0] * 0.5, eng + ' lm: Yellow and above hides the blue cells', [b0, b1]);
          await setF({ hfStep_lm: 'All', hfTop: 1 }); await sleep(1500); const b2 = await blue();
          check(b2[0] < b0[0] * 0.5, eng + ' lm: Top 1 per column hides most cells', [b0, b2]);
          await setF({ hfTop: 0, hfMax: 1e-9 }); await sleep(1500);
          check((await blue())[0] < b0[0] * 0.5, eng + ' lm: Max size hides cells');
          await setF({ hfMax: 0 }); await sleep(1500);
          check((await blue())[0] > b0[0] * 0.8, eng + ' lm: filters off = same look');
        }
        if (w === 1440 && !process.env.LM_SLOW) {
          // settings: contrast / min size / hide candles off
          await p.evaluate(() => { const h = window.STRYKER_VELA.chart.indicators().find((x) => x.nativeType === 'stk_liqmap'); h.setInputs(Object.assign({}, h.inputValues(), { hideCandles: false, contrast: 2 })); });
          await sleep(1500);
          await p.screenshot({ path: path.join(OUT, 'lm-' + eng + '-1440-seethrough.png') });
          const d2 = await dbg(p); check(d2 && d2.hide === false, 'see-through mode (hide candles off)');
          const txt = await p.evaluate(() => document.body.innerText);
          check(!/\blive\b|real[- ]time|delayed/i.test(JSON.stringify(d) + (d.note || '')), eng + ' no live/real-time/delayed in tool text');
        }
        check(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), eng + ' ' + w + ': no horizontal scroll');
        check(!errors.length, eng + ' ' + w + ': no console errors', errors);
        await ctx.close();
      }
    }
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
