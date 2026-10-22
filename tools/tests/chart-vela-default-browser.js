// Vela 0.9.0 is the default for members (no admin), ?vela=0.6 escapes per browser, ?vela=0.9 undoes it.
//   CHART_BASE=http://127.0.0.1:PORT node tools/tests/chart-vela-default-browser.js <shotsDir>
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '.';
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 300))); };
const ready = (p) => p.waitForFunction(() => { try { const ws = window.STRYKER_VELA; return ws && ws.cell(ws.active.id).chart.renderer.renderer.coords.barCount > 20; } catch (e) { return false; } }, null, { timeout: 60000 });
const state = (p) => p.evaluate(() => ({ v090: window.__stkVela090, map: document.querySelector('script[type=importmap]').textContent.match(/vela-[0-9.]+-s\d/)[0], key: window.__stkPersistKey }));

(async () => {
  const b = await launch();
  for (const [w, h, mobile] of [[1440, 900, false], [390, 844, true]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
    await ctx.addInitScript(stub);
    // A plain MEMBER: the admin check answers no.
    await ctx.addInitScript(() => {
      try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_community_disclaimer_ack_v1', '1'); } catch (e) {}
      let L; Object.defineProperty(window, 'StrykerPineLibrary', { configurable: true, get() { return L; }, set(v) { if (v) v.isAdmin = () => Promise.resolve(false); L = v; } });
    });
    await ctx.route(/^https?:\/\/[^/]*(gstatic|googleapis|firebase|google|doubleclick)\./, (r) => r.abort());
    const p = await ctx.newPage();
    const errors = []; let navs = 0;
    p.on('pageerror', (e) => { if (!/docChanges/.test(String(e))) errors.push(String(e)); });
    p.on('framenavigated', (f) => { if (f === p.mainFrame()) navs++; });
    await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' }); await ready(p);
    let s = await state(p);
    check(s.v090 === true && s.map === 'vela-0.9.0-s4', `${w}: member gets 0.9.0 by default`, s);
    navs = 0; await p.waitForTimeout(8000);
    check(navs === 0 && (await state(p)).v090 === true, `${w}: no admin refusal reload for members`, { navs });
    await p.screenshot({ path: `${OUT}/vela-default-member-${w}.png` });
    // Footprint chart type on 0.9.0 (no recorder data here: checks it registers and switches cleanly).
    const fp = await p.evaluate(async () => { try { const ws = window.STRYKER_VELA; ws.active.setPriceStyle('stk_fp'); await new Promise((r) => setTimeout(r, 1500)); const st = ws.cell(ws.active.id).chart.renderer.renderer.scene; ws.active.setPriceStyle('candles'); return { ok: true, bars: st.bars.length }; } catch (e) { return { ok: false, e: String(e) }; } });
    check(fp.ok && fp.bars > 20, `${w}: Footprint chart type switches on and off on 0.9.0`, fp);
    // Drawings save and restore across a reload (0.9.0 workspace key).
    const nd = () => p.evaluate(() => { const ws = window.STRYKER_VELA, cell = ws.cell(ws.active.id), r = cell.chart.renderer.renderer, d = cell.chart.drawings; try { return (d.list ? d.list() : d.all ? d.all() : r.userDrawings.store.all()).length; } catch (e) { try { return r.userDrawings.drawings().length; } catch (e2) { return -1; } } });
    const box = await p.evaluate(() => { const ws = window.STRYKER_VELA; const host = ws.cell(ws.active.id).host || document.querySelector('.vela-cell'); const c = [...host.querySelectorAll('canvas')].sort((a, b) => b.width * b.height - a.width * a.height)[0]; const b = c.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
    const d0 = await nd();
    await p.evaluate(() => { const ws = window.STRYKER_VELA; ws.cell(ws.active.id).chart.drawings.setTool('trendline'); });
    const x1 = box.x + box.w * 0.3, y1 = box.y + box.h * 0.4, x2 = box.x + box.w * 0.55, y2 = box.y + box.h * 0.6;
    if (mobile) { await p.mouse.click(x1, y1); await p.waitForTimeout(200); await p.mouse.click(x2, y2); }
    else { await p.mouse.move(x1, y1); await p.mouse.down(); await p.mouse.move(x2, y2, { steps: 8 }); await p.mouse.up(); }
    await p.waitForTimeout(800);
    const d1 = await nd();
    await p.waitForTimeout(2500);   // workspace autosave
    await p.reload({ waitUntil: 'domcontentloaded' }); await ready(p); await p.waitForTimeout(2500);
    const d2 = await nd();
    check(d1 === d0 + 1 && d2 === d1, `${w}: a trend line drawn on 0.9.0 is kept after a reload`, { d0, d1, d2 });
    await p.screenshot({ path: `${OUT}/vela-default-drawing-${w}.png` });
    await p.goto(BASE + '/charts.html?vela=0.6', { waitUntil: 'domcontentloaded' }); await ready(p);
    s = await state(p);
    check(s.v090 === false && s.map === 'vela-0.6.17-s3' && s.key === 'vela-workspace', `${w}: ?vela=0.6 loads 0.6.17`, s);
    await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' }); await ready(p);
    check((await state(p)).v090 === false, `${w}: the 0.6 choice sticks for this browser`);
    await p.goto(BASE + '/charts.html?vela=0.9', { waitUntil: 'domcontentloaded' }); await ready(p);
    await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' }); await ready(p);
    check((await state(p)).v090 === true, `${w}: ?vela=0.9 brings it back`);
    check(!errors.length, `${w}: no page errors`, errors);
    await ctx.close();
  }
  await b.close();
  console.log(fail ? `FAILED ${fail}` : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
