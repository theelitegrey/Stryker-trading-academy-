// Session volume profile + TPO chart types: switching to them on 1h and 1m must draw the profile at once.
//   node tools/tests/chart-dev-server.mjs 8471
//   CHART_BASE=http://127.0.0.1:8471 [LAYOUT=1] node tools/tests/chart-session-profile-browser.js [shotsDir]
// LAYOUT=1 first adds the Footprint L2 + Big Trades indicators (the member's saved-layout case).
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8471';
const OUT = process.argv[2] || '/tmp/sess';
const TAG = process.env.TAG || '';
require('fs').mkdirSync(OUT, { recursive: true });
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 300))); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await launch();
  const sizes = [{ w: 1440, h: 900, theme: 'dark', tag: '1440-dark' }, { w: 1440, h: 900, theme: 'day', tag: '1440-light' }, { w: 390, h: 800, theme: 'dark', tag: '390-dark', mobile: true }];
  for (const z of sizes) for (const tf of ['60', '1']) for (const layout of [false, true]) {
    if (layout && z.tag !== '1440-dark') continue;
    const ctx = await b.newContext({ viewport: { width: z.w, height: z.h }, deviceScaleFactor: 1, isMobile: !!z.mobile, hasTouch: !!z.mobile });
    await ctx.addInitScript(stub);
    await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_theme', t); } catch (e) {} }, z.theme);
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net)/, (r) => r.abort());
    const p = await ctx.newPage(); const errors = [];
    p.on('pageerror', (e) => errors.push(String(e)));
    p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|WebSocket|Failed to load|CORS|status of/.test(m.text())) errors.push(m.text()); });
    await p.goto(BASE + '/charts.html?symbol=' + encodeURIComponent('futures:NQ1!') + '&tf=' + tf, { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA, null, { timeout: 60000 });
    await p.evaluate(async () => { for (let i = 0; i < 100; i++) { await new Promise((r) => setTimeout(r, 300)); try { if (window.STRYKER_VELA.active.chart.orchestrator.rawBars.length > 100) return; } catch (e) {} } });
    await p.evaluate(async (tf) => { const c = window.STRYKER_VELA.active; c.setTimeframe(tf); for (let i = 0; i < 60; i++) { await new Promise((r) => setTimeout(r, 400)); if (c.timeframe === tf && c.inner.orchestrator.rawBars.length > 100) break; } await new Promise((r) => setTimeout(r, 800)); }, tf);
    if (layout) {
      await p.evaluate(async () => { const c = window.STRYKER_VELA.active; for (const t of ['stk_l2f_fp', 'stk_l2f_big']) { try { c.addNativeIndicator(t); } catch (e) { window.__addErr = String(e); } } await new Promise((r) => setTimeout(r, 1500)); });
    }
    for (const id of ['stk_svp', 'stk_tpoc']) {
      errors.length = 0;
      const t0 = Date.now();
      await p.evaluate((id) => window.STRYKER_VELA.active.setPriceStyle(id), id);
      await sleep(1500);   // no reload, no extra input
      const r = await p.evaluate(() => {
        const c = window.STRYKER_VELA.active, o = c.inner.orchestrator;
        const cv = [...document.querySelectorAll('#vela-chart canvas')];
        return { style: c.priceStyle, bars: o.bars.length, raw: o.rawBars.length, tf: c.timeframe, canvases: cv.length, drawn: window.__stkProfileDrawn || null };
      });
      // pixel probe: the profile layer must put coloured (magenta POC / amber / grey) pixels in the plot
      const shot = `${OUT}/${TAG}${z.tag}-${tf}${layout ? '-layout' : ''}-${id}.png`;
      await p.screenshot({ path: shot });
      const px = await p.evaluate((id) => {
        const hit = { n: 0 };
        for (const cv of document.querySelectorAll('#vela-chart canvas')) {
          const g = cv.getContext('2d'); if (!g) continue;
          let d; try { d = g.getImageData(0, 0, cv.width, cv.height).data; } catch (e) { continue; }
          for (let i = 0; i < d.length; i += 4) {
            const R = d[i], G = d[i + 1], B = d[i + 2], A = d[i + 3];
            if (A > 150 && ((R > 200 && G < 90 && B > 200) || (id === 'stk_svp' && R > 200 && G > 130 && G < 190 && B < 40))) hit.n++;
          }
        }
        return hit.n;
      }, id);
      check(!errors.length && r.style === id && r.bars > 50 && r.tf === tf && px > (z.mobile ? 60 : 200), `${z.tag} tf=${tf}${layout ? ' +L2/BigTrades' : ''} ${id} draws after switch`, { r, px, errors: errors.slice(0, 2) });
      if (id === 'stk_tpoc' && !layout) {
        // TPO extras (member request 13 Nov): off by default; all on adds ink; then back off
        const ink = () => p.evaluate(() => { let n = 0; for (const cv of document.querySelectorAll('#vela-chart canvas')) { const g = cv.getContext('2d'); if (!g) continue; let d; try { d = g.getImageData(0, 0, cv.width, cv.height).data; } catch (e) { continue; } for (let i = 3; i < d.length; i += 16) if (d[i] > 0) n++; } return n; });
        const setCT = (o) => p.evaluate((o) => { const r = window.STRYKER_VELA.chart.renderer, R = r.applyConfig ? r : r.renderer; R.applyConfig({ chartTypes: { stk_tpoc: o } }); }, o).then(() => sleep(1200));
        const n0 = await ink();
        await setCT({ singles: true, poor: true, nakedPoc: true, devPoc: true, ibLines: true, ibMin: '60', ibExt: '1.5, 2, 3' });
        const n1 = await ink();
        await p.screenshot({ path: `${OUT}/${TAG}${z.tag}-${tf}-stk_tpoc-extras.png` });
        await setCT({ singles: false, poor: false, nakedPoc: false, devPoc: false, ibLines: false });
        const n2 = await ink();
        check(!errors.length && n1 > n0 + 50 && Math.abs(n2 - n0) <= Math.max(20, n0 * 0.002), `${z.tag} tf=${tf} stk_tpoc: extras add lines (${n0} -> ${n1} px) and off restores the default look (${n2} px)`, errors.slice(0, 2));
      }
    }
    await ctx.close();
  }
  await b.close();
  console.log(fail ? fail + ' FAILED' : 'all ok'); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
