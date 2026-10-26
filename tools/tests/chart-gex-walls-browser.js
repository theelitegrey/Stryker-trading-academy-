// GEX walls over time, browser test (assets/chart-gex-levels.js + assets/chart-gex-walls-core.js).
//   node tools/tests/chart-dev-server.mjs 8131      (site + real /api/chart/bars, binds 127.0.0.1)
//   flock /tmp/stryker-chrome.lock env CHART_BASE=http://127.0.0.1:8131 STK_VELA=0.9|0.6 node tools/tests/chart-gex-walls-browser.js <shotsDir> [tag]
// GEX history = the REAL recorded QQQ 0DTE sessions in tools/tests/fixtures/gex/hist-QQQ-2026-10-2{1,2,3}.json;
// /api/gex/levels/QQQ = a real reply saved Sun 2026-10-25 (cash closed, chain of Fri 10-23 16:00 ET) in
// GEX_LIVE (env) or fixtures/gex/QQQ-0.json. Futures bars are the dev server's real MNQ bars.
// Opens Charts on MNQ1! 3m, adds "TradeZoro GEX Levels" from the indicator window with real clicks,
// checks the step lines live, then bar replay at Fri 10-23 10:56 ET (the 29,325 RTH high) and Sun 10-25
// 18:46 ET (the 29,345 tap).
const fs = require('fs');
const path = require('path');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8131';
const OUT = process.argv[2] || '/tmp';
const TAG = process.argv[3] || 'after';
const ENG = process.env.STK_VELA === '0.6' ? '0.6' : '0.9';
const FIX = path.join(__dirname, 'fixtures', 'gex');
const LIVE = JSON.parse(fs.readFileSync(process.env.GEX_LIVE || path.join(FIX, 'QQQ-0.json')));
const unpackRows = (p) => p.t.map((t, i) => ({ i, t, p }));
const HIST0 = ['21', '22', '23'].map((d) => JSON.parse(fs.readFileSync(path.join(FIX, 'hist-QQQ-2026-10-' + d + '.json'))));
const HIST1 = [JSON.parse(fs.readFileSync(path.join(FIX, 'hist-QQQ1-2026-10-23.json')))];   // 1DTE (expiry Mon 10-26), Fri 10-23
let HIST = HIST0;
function slice(from, to, d) {
  HIST = d === 1 ? HIST1 : HIST0;
  // pack the snapshots with from <= t <= to back into one /gex-history reply (same shape as the recorder's)
  const out = { v: 1, u: 'QQQ', d: d || 0, k: [], t: [], fa: [], day: [], x: [], s: [], cw: [], pw: [], zg: [], n: [], em: [], g: [] };
  const axis = [...new Set(HIST.flatMap((h) => h.k))].sort((a, b) => a - b), idx = new Map(axis.map((k, i) => [k, i]));
  out.k = axis;
  for (const h of HIST) h.t.forEach((t, i) => {
    if (t < from || t > to) return;
    ['t', 'fa', 'day', 'x', 's', 'cw', 'pw', 'zg', 'n', 'em'].forEach((f) => out[f].push(h[f] ? h[f][i] : null));
    const row = h.g[i], i0 = row[0], vals = row.slice(1);
    const ks = vals.map((_, j) => h.k[i0 + j]);
    const n0 = idx.get(ks[0]), arr = new Array(idx.get(ks[ks.length - 1]) - n0 + 1).fill(null);
    vals.forEach((v, j) => { arr[idx.get(ks[j]) - n0] = v; });
    out.g.push([n0].concat(arr));
  });
  return out;
}
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + '[' + ENG + ' ' + TAG + '] ' + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const et = (t) => new Date(t * 1000).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });

async function open(b, w, h, mobile) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  // spy: vertical strokes (same x, > 12 px tall) painted on the GEX layer's canvas (the one with __stkGexTags)
  await ctx.addInitScript(() => {
    const P = CanvasRenderingContext2D.prototype, mt = P.moveTo, lt = P.lineTo;
    window.__gexVert = 0;
    P.moveTo = function (x, y) { this.__mx = x; this.__my = y; return mt.call(this, x, y); };
    P.lineTo = function (x, y) {
      if (this.canvas && this.canvas.__stkGexTags && Math.abs(x - this.__mx) < 0.5 && Math.abs(y - this.__my) > 12) window.__gexVert++;
      this.__mx = x; this.__my = y; return lt.call(this, x, y);
    };
  });
  await ctx.addInitScript((eng) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.removeItem('stryker_bar_replay_v1'); if (eng === '0.6') localStorage.setItem('stryker_vela06', '1'); else localStorage.removeItem('stryker_vela06'); localStorage.setItem('stryker_gex_heat_k', JSON.stringify({ NQ: 41.08, MNQ: 41.08 })); } catch (e) {} }, ENG);
  const hits = { hist: 0, levels: 0, vendor: 0 };
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net|book-recorder\.)/, (r) => { if (/insightsentry/i.test(r.request().url())) hits.vendor++; r.abort(); });
  await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\//, (r) => {
    const u = new URL(r.request().url()), hdr = { 'access-control-allow-origin': '*' };
    if (u.pathname === '/gex-sessions') return r.fulfill({ status: 200, contentType: 'application/json', headers: hdr, body: JSON.stringify(HIST0.map((hh) => ({ u: 'QQQ', d: 0, day: hh.day[0], n: hh.t.length, t0: hh.t[0], t1: hh.t[hh.t.length - 1] })).reverse()) });
    if (u.pathname === '/gex-history') { hits.hist++; const U = u.searchParams.get('u'), d = +u.searchParams.get('dte'); const body = U === 'QQQ' ? slice(+u.searchParams.get('from'), +u.searchParams.get('to') || 4e9, d) : { v: 1, u: U, d, k: [], t: [], fa: [], day: [], x: [], s: [], cw: [], pw: [], zg: [], n: [], em: [], g: [] }; return r.fulfill({ status: 200, contentType: 'application/json', headers: hdr, body: JSON.stringify(body) }); }
    r.abort();
  });
  await ctx.route(/\/api\/gex\/levels\//, (r) => { hits.levels++; r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(LIVE) }); });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|status of 4|status of 5|WebSocket|opt-analytics/.test(m.text())) errors.push(m.text()); });
  await p.goto(BASE + '/charts.html' + (ENG === '0.6' ? '?vela=0.6' : ''), { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA, null, { timeout: 60000 });
  return { ctx, p, errors, hits };
}
const waitBars = (p) => p.evaluate(async () => { for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 300)); try { if (window.STRYKER_VELA.context().cells[0].chart.orchestrator.rawBars.length > 50) return true; } catch (e) {} } return false; });
const payload = (p) => p.evaluate(() => {
  const c = window.STRYKER_VELA.context().cells[0].chart, seen = new Set();
  const find = (o, d) => { if (!o || typeof o !== 'object' || d > 4 || seen.has(o)) return null; seen.add(o); if (o.nativeData instanceof Map && o.nativeData.has('stk_gex')) return o.nativeData.get('stk_gex'); for (const k of Object.keys(o)) { try { const r = find(o[k], d + 1); if (r) return r; } catch (e) {} } return null; };
  return JSON.parse(JSON.stringify(find(c, 0) || null));
});
const painted = (p) => p.evaluate(() => { for (const c of document.querySelectorAll('canvas')) if (c.__stkGexTags) return { steps: c.__stkGexSteps || 0, tags: c.__stkGexTags.map((t) => t.text), lines: (c.__stkGexLines || []).length }; return null; });
async function shot(p, name) { await p.mouse.move(5, 5).catch(() => {}); await sleep(700); await p.screenshot({ path: path.join(OUT, name) }); console.log('SHOT ' + path.join(OUT, name)); }
async function addByClicks(p) {
  await p.evaluate(() => window.STRYKER_VELA.indicatorPicker.open());
  await sleep(800);
  const side = await p.$$('.stkiw-side button, .stkiw-side a');
  for (const s of side) if (/Technicals/.test(await s.textContent())) { await s.click(); break; }
  await sleep(500);
  const row = await p.$('.stkiw-row[data-key="b:stk_gex"] .stkiw-name');
  if (!row) return false;
  await row.scrollIntoViewIfNeeded().catch(() => {});
  await row.click();
  await sleep(600);
  await p.keyboard.press('Escape').catch(() => {});
  return true;
}
async function startReplay(p, ms) {
  await p.evaluate(async (E) => { await window.__stkBarReplay.setStepTf('1'); await window.__stkBarReplay.start(E); }, ms);
  await p.waitForFunction(() => window.__stkBarReplay.state.on && !window.__stkBarReplay.state.busy, null, { timeout: 40000 });
  await sleep(5000);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await launch();
  try {
    for (const [w, h, mobile] of [[1440, 900, false], [390, 844, true]]) {
      const tag = ENG.replace('.', '') + '-' + w + '-' + TAG;
      const { ctx, p, errors, hits } = await open(b, w, h, mobile);
      const hasT = await p.evaluate(() => typeof window.STRYKER_VELA.context().cells[0].chart.renderer === 'object');
      await p.evaluate(() => { const ws = window.STRYKER_VELA; const c = ws.cell(ws.context().cells[0].id); c.setSymbol('futures:MNQ1!'); c.setTimeframe('3'); });
      await sleep(3000); await waitBars(p); await sleep(1500);
      const added = await addByClicks(p);
      check(added, w + ': added "TradeZoro GEX Levels" from the indicator window (real click)');
      await sleep(6000);
      let d = await payload(p), pt = await painted(p);
      const cw = d && d.lines && d.lines.find((l) => l.id === 'call');
      if (TAG === 'after') {
        check(cw && Array.isArray(cw.steps) && cw.steps.length >= 2, w + ' live: CALL WALL has ' + (cw && cw.steps ? cw.steps.length : 0) + ' step segments');
        check(pt && pt.steps > 0, w + ' live: step segments painted (' + (pt && pt.steps) + ', engine timeToX ok)');
        await p.evaluate(() => { window.__gexVert = 0; }); await sleep(1500);
        const vert = await p.evaluate(() => window.__gexVert);
        check(vert === 0, w + ' live: no vertical connectors on the GEX layer (' + vert + ')');
        const last = cw && cw.steps && cw.steps[cw.steps.length - 1];
        check(last && last.b == null && Math.abs(last.p - cw.price) < 0.02, w + ' live: last segment runs to the right edge at the label price ' + (cw && cw.price));
        check(/updated/.test(d.status) && !/live|real-time|delayed/i.test(d.status), w + ' live: status "' + d.status + '"');
      }
      console.log('INFO live CW ' + (cw && cw.text) + ' | tags ' + JSON.stringify(pt && pt.tags));
      // zoom out a bit so Friday's session is in view (scroll with the mouse wheel over the plot)
      const box = await p.evaluate(() => { const c = document.querySelector('.vela-chart canvas, canvas'); const r = c.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
      await p.mouse.move(box.x, box.y);
      for (let i = 0; i < 4; i++) { await p.mouse.wheel(0, 300); await sleep(250); }
      await sleep(1200);
      await shot(p, 'gexwall-live-' + tag + '.png');
      // ---- replay 1: Fri 10-23 10:56 ET, just after the 29,325.75 RTH high (10:53)
      const E1 = Date.parse('2026-10-23T14:56:00Z');
      await startReplay(p, E1);
      d = await payload(p); pt = await painted(p);
      const r1 = d && d.lines && d.lines.find((l) => l.id === 'call');
      console.log('INFO replay 10:56 status ' + (d && (d.status || d.note)) + ' | CW ' + (r1 && r1.text));
      check(d && d.snapT && d.snapT <= E1 / 1000, w + ' replay Fri 10:56: snapshot ' + (d && d.snapT && et(d.snapT)) + ' <= clock');
      if (TAG === 'after') {
        check(r1 && r1.steps && r1.steps.every((s) => s.a <= E1 / 1000), w + ' replay Fri 10:56: no step starts after the replay clock');
        check(r1 && /\(QQQ 710\)/.test(r1.text), w + ' replay Fri 10:56: CALL WALL on QQQ 710 (' + (r1 && r1.text) + ')');
      }
      await shot(p, 'gexwall-replay-fri1056-' + tag + '.png');
      // ---- replay 2: Sun 10-25 18:46 ET, the 29,345.25 tap (no new chain since Fri 16:00)
      const E2 = Date.parse('2026-10-25T22:46:00Z');
      await startReplay(p, E2);
      d = await payload(p);
      const r2 = d && d.lines && d.lines.find((l) => l.id === 'call');
      console.log('INFO replay Sun 18:46 status ' + (d && (d.status || d.note)) + ' | CW ' + (r2 && r2.text));
      if (TAG === 'after') {
        check(r2 && /\(QQQ 710\)/.test(r2.text) && Math.abs(r2.price - 29345) < 30, w + ' replay Sun 18:46: CALL WALL ' + (r2 && r2.text) + ' (within 30 pts of the 29,345.25 tap)');
        const r3 = d && d.lines && d.lines.find((l) => l.id === 'call');
        check(r3 && r3.steps && r3.steps.length >= 2, w + ' replay Sun 18:46: Friday 0DTE steps + the next-expiry step (' + (r3 && r3.steps && r3.steps.length) + ')');
      }
      console.log('SEGS ' + JSON.stringify(await p.evaluate(() => { for (const c of document.querySelectorAll('canvas')) if (c.__stkGexSegs) return { W: c.width / devicePixelRatio, s: c.__stkGexSegs }; return null; })));
      if (TAG === 'after') { await p.evaluate(() => { window.__gexVert = 0; }); await sleep(1500); const v2 = await p.evaluate(() => window.__gexVert); check(v2 === 0, w + ' replay Sun 18:46: no vertical connectors (' + v2 + ')'); }
      await shot(p, 'gexwall-replay-sun1846-' + tag + '.png');
      await p.evaluate(() => window.__stkBarReplay.stop && window.__stkBarReplay.stop()).catch(() => {});
      check(!errors.length, w + ': no page errors (' + errors.slice(0, 2).join(' | ') + ')');
      check(hits.vendor === 0, w + ': no GEX vendor requests from the page');
      console.log('INFO requests: gex-history ' + hits.hist + ', levels ' + hits.levels + ', engine ' + ENG + ', renderer ' + hasT);
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAIL' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
