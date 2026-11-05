// Wall Events (L2) (assets/chart-book-pack.js stk_bk_walls) browser test on a SCRIPTED NQ L2 hub: the plain NQ fixture has walls that never
// trade, so this fake /ts-live plays one 16 s cycle again and again, in the Worker's own frame shapes (snap + coarse + ticks):
//   f 0-59    ask wall 800 at P+3.00: price walks up to it, buyers print 25 lots a frame into it, it shrinks to 0, price goes through -> EATEN
//   f 70-99   bid wall 800 at P-3.00: price drops onto it, sellers print 30 a frame, it refills (iceberg), price goes back up      -> HELD
//   f 110-139 ask wall 800 at P+2.75 (6 ticks over the ask), no trades at its price, then gone                                    -> PULLED
//   always    bid wall 800 at P-4.50, never touched (keeps the session's wall share steady)
// Heatmap (Futures DOM, Midnight, "Show from colour" = Yellow and above; canvas path + no depth bars so the test can read its pixels) + Wall Events + Big Trades (L1, Very low, one-price cluster 30 s).
// Checks: >= 1 event of each kind, each marker drawn at its wall's price row on the heatmap, threshold follows the heatmap filter, no errors.
//   node tools/tests/chart-dev-server.mjs 8172 &   CHART_BASE=http://127.0.0.1:8172 flock /tmp/stryker-chrome.lock node tools/tests/wall-events-browser.js <shotsDir>
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8172';
const OUT = process.argv[2] || '/tmp';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 400) : '')); };
function fakeWs() {
  window.__stkBookPackMin = 30; window.__L2MID = 28750; window.__stkL2Test = { base: 'http://127.0.0.1:9' };
  const Real = window.WebSocket;
  window.WebSocket = function (url, proto) {
    if (!/\/ts-live/.test(String(url))) return new Real(url, proto);
    const ws = { readyState: 0, send() {}, close() { this.readyState = 3; clearInterval(this.iv); this.onclose && this.onclose({ code: 1000 }); } };
    let n = 0;
    setTimeout(() => {
      ws.readyState = 1; ws.onopen && ws.onopen(); ws.onmessage({ data: JSON.stringify({ event: 'status', state: 'live' }) });
      const m0 = Math.floor(Date.now() / 60000) * 60000, P = window.__L2MID, b = [];
      for (let k = 15; k >= 0; k--) { const o = P + Math.sin(k) * 2; b.push([m0 - k * 60000, o, o + 4, o - 4, o + 1, 300 + k]); }
      ws.onmessage({ data: JSON.stringify({ type: 'bars', symbol: 'NQ', b }) });
    }, 50);
    ws.iv = setInterval(() => {
      if (ws.readyState !== 1 || !ws.onmessage) return;
      const f = n++ % 160, P = Math.round(window.__L2MID * 4) / 4, T = 0.25, now = Date.now();
      let bid = P;
      if (f >= 20 && f < 52) bid = P + 2.75; else if (f >= 52 && f < 60) bid = P + 3.0;   // up onto the ask wall, then through it
      if (f >= 75 && f < 100) bid = P - 3.0;                                                 // down onto the bid wall
      if (f >= 110 && f < 140) bid = P + 1.0;                                                // near the wall that is then pulled
      const ask = bid + T, extra = new Map();   // price -> signed size (bids +, asks -)
      if (f < 52) extra.set(P + 3.0, -(f < 20 ? 800 : Math.max(0, 800 - 25 * (f - 20))));
      if (f >= 60) extra.set(P - 3.0, 800 - (f >= 75 && f < 100 ? 30 * (f % 5) : 0));
      else extra.set(P - 3.0, 800);
      if (f >= 110 && f < 140) extra.set(P + 2.75, -800);
      extra.set(P - 4.5, 800);
      const bids = [], asks = [], wob = (j) => 5 + Math.round(4 * Math.abs(Math.sin(n / 5 + j)));
      for (let j = 0; j < 20; j++) {
        const pb = bid - j * T, pa = ask + j * T, eb = extra.get(pb), ea = extra.get(pa);
        bids.push([pb, eb > 0 ? eb : wob(j)]); if (!(ea === 0)) asks.push([pa, ea < 0 ? -ea : wob(j + 30)]);
      }
      // coarse: the whole book in 2.5-point rows (the Worker's NQ rule), from the same fine book + a thin far book
      const step = 2.5, i0 = Math.floor(P * 0.996 / step), len = Math.ceil(P * 0.008 / step) + 2, v = new Array(len).fill(0);
      for (let k = 0; k < len; k++) { const p = (i0 + k + 0.5) * step; v[k] = p < bid ? 40 + (k % 5) * 6 : -(40 + (k % 7) * 5); }
      const into = (p, q, sg) => { const k = Math.floor(p / step + 1e-9) - i0; if (k >= 0 && k < len) { if (Math.abs(v[k]) < 100) v[k] = 0; v[k] += sg * q; } };
      for (const [p, q] of bids) into(p, q, 1); for (const [p, q] of asks) into(p, q, -1);
      const send = (o) => ws.onmessage({ data: JSON.stringify(o) });
      send({ type: 'snap', symbol: 'NQ', ts: now, bids, asks, imb: 0, imb10: 0 });
      send({ type: 'coarse', symbol: 'NQ', ts: now, mid: (bid + ask) / 2, bb: bid, ba: ask, step, i0, v });
      const t = [[bid, 1 + (n % 4), -1, now], [ask, 1 + (n % 3), 1, now]];
      if (f >= 20 && f < 52) t.push([P + 3.0, 25, 1, now]);       // buyers into the ask wall
      if (f >= 75 && f < 100) t.push([P - 3.0, 30, -1, now]);     // sellers into the bid wall
      send({ type: 'ticks', symbol: 'NQ', t });
    }, 100);
    return ws;
  };
  window.WebSocket.OPEN = 1; window.WebSocket.CONNECTING = 0;
}
async function open(b, { w, h, mobile }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(fakeWs);
  await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker.vela.session', ''); localStorage.setItem('stryker_theme', 'night'); } catch (e) {} });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  await ctx.route(/127\.0\.0\.1:9\//, (r) => r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' }));   // no recorder history: live frames only
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|status of 4|status of 5|451|\/api\/chart\/stream|Failed to load resource|Ping received after close|Unexpected response code/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart, null, { timeout: 60000 });
  await sleep(2000);
  return { ctx, p, errors };
}
async function setNQ(p) {
  await p.evaluate(async () => {
    const ws = window.STRYKER_VELA; ws.active.setSymbol('futures:NQ1!'); ws.active.setTimeframe('1');
    for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 300)); const c = ws.chart; if (c.market.symbol === 'futures:NQ1!' && c.orchestrator.rawBars.length > 10) break; }
    const rb = ws.chart.orchestrator.rawBars; const last = rb[rb.length - 1], px = last && (last.close != null ? last.close : last.c);
    if (px > 20000 && Math.abs(px - 28750) < 3000) window.__L2MID = Math.round(px / 2.5) * 2.5;
  });
  await sleep(800);
}
const add = (p, type, inputs) => p.evaluate(([t, i]) => { const c = window.STRYKER_VELA.context().cells[0].chart; c.addNativeIndicator(t, { inputs: i || {} }); window.STRYKER_VELA.context().stateChanged(); }, [type, inputs]);
const read = (p) => p.evaluate(() => {
  const st = [...(window.__stkBookPackStores || new Map()).values()][0], w = st && [...st.walls.values()][0];
  return { n: w ? w.tr.n : null, thr: w ? w.thr : null, pct: w ? w.pct : null, ev: w ? w.tr.events.map((e) => ({ k: e.kind, s: e.side, p: e.idx * st.tick, tr: e.traded, pk: e.peak })) : [], P: window.__L2MID,
    shown: window.__stkWallShown || [], leg: (window.__stkWallLegend || []).join(' / ') + ' | ' + (window.__stkWallSub || ''), big: window.__stkBigShown ? window.__stkBigShown().n : -1, perf: (window.__stkBookPack || {}).stk_bk_walls };
});
(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    for (const [w, h, mobile, tag] of (process.env.ONE ? [[1440, 900, false, '1440-dark']] : [[1440, 900, false, '1440-dark'], [390, 844, true, '390-dark']])) {
      const { ctx, p, errors } = await open(b, { w, h, mobile });
      await setNQ(p);
      await add(p, 'stk_fut_dom', { look: 'Midnight', hfStep_midnight: 'Yellow and above', showDepthBars: false, gpuHeatmap: false });
      await add(p, 'stk_bk_walls', {});
      await add(p, 'stk_l2f_big', {});   // futures Big Trades = Big Trades (L2) since 2026-11-06
      console.log('INFO inds', await p.evaluate(() => JSON.stringify(window.STRYKER_VELA.context().cells[0].chart.indicators().map((h) => h.nativeType)) + ' stores ' + (window.__stkBookPackStores ? window.__stkBookPackStores.size : -1) + ' perf ' + JSON.stringify(window.__stkBookPack) + ' txt ' + document.body.innerText.slice(0, 600).replace(/\n/g, ' | ')));
      let c = await read(p);
      for (let k = 0; k < (process.env.QUICK ? 4 : 40) && !(c.n && c.n.E >= 1 && c.n.H >= 1 && c.n.P >= 1); k++) { await sleep(1500); c = await read(p); }
      const P = c.P;
      check(c.n && c.n.E >= 1, tag + ': EATEN found (' + (c.n && c.n.E) + ')', c.ev);
      check(c.n && c.n.H >= 1, tag + ': HELD found (' + (c.n && c.n.H) + ')', c.ev);
      check(c.n && c.n.P >= 1, tag + ': PULLED found (' + (c.n && c.n.P) + ')', c.ev);
      const at = (k, price, side) => c.ev.filter((e) => e.k === k).every((e) => Math.abs(e.p - price) < 1e-6 && e.s === side);
      check(at('E', P + 3, -1) && at('H', P - 3, 1) && at('P', P + 2.75, -1), tag + ': every event sits at its scripted wall (E ask P+3, H bid P-3, P ask P+2.75)', c.ev);
      check(!c.ev.some((e) => Math.abs(e.p - (P - 4.5)) < 1e-6), tag + ': the untouched wall has no event');
      check(Math.abs(c.pct - 3) < 1e-6 && c.thr > 100 && c.thr <= 800, tag + ': wall size follows the heatmap filter (Yellow and above = top 3 %, thr ' + c.thr + ')', c);
      check(/heatmap filter/.test(c.leg), tag + ': legend says the threshold comes from the heatmap filter', c.leg);
      // zoom onto the walls: the last 3 minutes and P +- 8 points, so the 2.5-point heatmap rows and the markers are readable
      await p.evaluate((P) => { const c = window.STRYKER_VELA.context().cells[0].chart, rb = c.orchestrator.rawBars; c.setVisibleRange({ from: rb[Math.max(0, rb.length - 3)].time, to: rb[rb.length - 1].time + 60000 }); try { c.setPriceRange(P - 8, P + 8); } catch (e) {} }, c.P);
      await sleep(1500);
      // markers on the heatmap rows: the y of each drawn marker = the chart's y of its price, and that price's 2.5-pt row is a hot (wall) row in the latest coarse frame
      // the heatmap pixel 10 px left of each marker (the wall's own row just before the event) must be a hot wall colour (red channel > 180:
      // yellow / orange / red / white on the Midnight ramp; thin book is blue)
      const geo = await p.evaluate(() => {
        const hm = [...document.querySelectorAll('#vela-chart canvas')].find((c) => c.__stkBmUnder), out = [];
        const g = hm && hm.getContext('2d'), k = hm ? hm.width / hm.getBoundingClientRect().width : 1;
        for (const m of window.__stkWallShown || []) {
          let rgb = null; try { const d = g.getImageData(Math.round((m.x - 12) * k), Math.round(m.y * k), Math.round(10 * k), 1).data; for (let j = 0; j < d.length; j += 4) if (!rgb || d[j] > rgb[0]) rgb = [d[j], d[j + 1], d[j + 2]]; } catch (e) {}
          out.push({ kind: m.kind, price: m.price, x: Math.round(m.x), y: m.y, rgb });
        }
        return out;
      });
      if (process.env.DBG > 1) console.log('DBG', JSON.stringify(await p.evaluate(() => { const st = window.__stkFlow && window.__stkFlow.domDebug ? window.__stkFlow.domDebug() : null; const c = window.STRYKER_VELA.context().cells[0].chart; const h = c.indicators().find((x) => x.nativeType === 'stk_bk_walls');
        const cs = [...document.querySelectorAll('#vela-chart canvas')].map((c, i) => { let n = 0; try { const g = c.getContext('2d'); if (!g) return { i, gl: 1, w: c.width, op: getComputedStyle(c).opacity, z: getComputedStyle(c).zIndex }; const d = g.getImageData(0, 0, c.width, c.height).data; for (let k = 3; k < d.length; k += 16) if (d[k]) n++; } catch (e) { return { i, err: 1 }; } return n ? { i, n, w: c.width, wall: c === window.__stkWallCanvas, bm: !!c.__stkBmUnder, op: getComputedStyle(c).opacity, disp: getComputedStyle(c).display } : null; }).filter(Boolean);
        const all = [...document.querySelectorAll('#vela-chart canvas')]; const near = all.map((c, i) => ({ i, par: all.indexOf(c.parentElement) + ':' + (c.parentElement && c.parentElement.className), idx: [...c.parentElement.children].indexOf(c), bm: !!c.__stkBmUnder, dim: !!c.__stkGridDim, wall: c === window.__stkWallCanvas, op: c.style.opacity })).filter((x) => x.i >= 40 || x.bm || x.dim || x.i < 3);
        return { near, cs, dom: st && { cells: st.cells, columns: st.columns, histFrom: st.histFrom, bm: st.bm && { cells: st.bm.cells, columns: st.bm.columns } }, shown: window.__stkWallShown, cv: [...document.querySelectorAll('#vela-chart canvas')].length }; })).slice(0, 1500));
      check(geo.length && geo.every((g) => g.rgb && g.rgb[0] > 180), tag + ': every marker sits on a hot heatmap wall row (hottest pixel 2-12 px left of it)', geo);
      check(geo.length >= 3 && new Set(geo.map((g) => g.kind)).size === 3, tag + ': markers of all three kinds drawn (' + geo.length + ')', geo.slice(0, 6));
      const ys = {}; for (const g of geo) (ys[g.kind] = ys[g.kind] || new Set()).add(Math.round(g.y));
      check(Object.values(ys).every((s) => s.size === 1) && ys.E && ys.H && [...ys.E][0] < [...ys.H][0], tag + ': each kind on ONE price row, eaten above held', Object.fromEntries(Object.entries(ys).map(([k, s]) => [k, [...s]])));
      // hover the eaten square: the tooltip names the aggressor and the size traded into the wall
      if (!mobile) {
        const e = geo.find((g) => g.kind === 'E'), box = await p.evaluate(() => { const r = window.__stkWallCanvas.getBoundingClientRect(); return { x: r.left, y: r.top }; });
        await p.mouse.move(box.x + e.x, box.y + e.y); await sleep(300);
        const tip = await p.evaluate(() => [...document.querySelectorAll('.stk-bigtip')].filter((d) => !d.hidden).map((d) => d.innerText).join(' / '));
        check(/Buyers ate an ask wall/.test(tip) && /Traded at the wall \d+/.test(tip), tag + ': hover shows the event and the traded size', tip);
        await p.mouse.move(5, 5);
      }
      check(c.perf && c.perf.avgMs < 2.5, tag + ': draw ' + (c.perf ? c.perf.avgMs.toFixed(2) : '?') + ' ms avg', c.perf);
      check(errors.length === 0, tag + ': no console errors', errors);
      // let Big Trades draw, then shoot
      await sleep(2500);
      const big = await p.evaluate(() => (window.__stkBigShown ? window.__stkBigShown().n : -1));
      console.log('INFO ' + tag + ': Big Trades markers drawn ' + big + ', events ' + JSON.stringify(c.n) + ', thr ' + c.thr);
      fs.writeFileSync(OUT + '/walls-' + tag + '.json', JSON.stringify({ P, ev: c.ev.slice(-12), geo }, null, 1));
      await p.screenshot({ path: OUT + '/walls-' + tag + '.png' });
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'all passed');
  process.exit(fail ? 1 : 0);
})();
