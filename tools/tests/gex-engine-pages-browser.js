// GEX audit 2026-10-13: the GEX page and the Charts "TradeZoro GEX Levels" indicator, both fed by
// THIS branch's engine (functions/api/gex/_engine.js buildLevels, run in node, real upstream data).
//   node tools/tests/chart-dev-server.mjs 8047     (site + /api/chart/bars)
//   flock /tmp/stryker-chrome.lock env CHART_BASE=http://127.0.0.1:8047 node --max-old-space-size=768 tools/tests/gex-engine-pages-browser.js [shotsDir]
// Checks: API wall_source is gamma; the GEX page shows the API's call/put walls; the chart's
// ES and NQ wall lines = API futures levels (+ the chart re-anchor, which may be 0).
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8047';
const OUT = process.argv[2] || '/tmp';
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const data = {};
let engine, candles, lastReq = null;
const emMem = new Map();
const emStore = { get: async (k) => emMem.get(k), put: async (k, v) => { emMem.set(k, v); } };

async function body(name, dte) {
  const k = name + ':' + dte;
  if (!data[k]) {
    for (let i = 0; i < 3 && !data[k]; i++) {
      const d = await engine.buildLevels(name, dte, {}, { emStore });
      if (Object.values(d.futures).every((f) => !f.error)) data[k] = d; else await sleep(3000);
    }
  }
  return data[k];
}
async function ctxFor(b, w, h, mobile) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); } catch (e) {} });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  await ctx.route(/\/api\/gex\/levels\//, async (r) => {
    const u = new URL(r.request().url());
    const name = u.pathname.split('/').pop().toUpperCase(), dte = Number(u.searchParams.get('dte') || 1);
    lastReq = name + ':' + dte;
    const d = await body(name, dte);
    r.fulfill({ status: d ? 200 : 502, contentType: 'application/json', body: JSON.stringify(d || { error: 'upstream' }) });
  });
  await ctx.route(/127\.0\.0\.1:\d+\/api\/gex\/candles\//, async (r) => {
    const u = new URL(r.request().url());
    const res = await candles.onRequestGet({ request: new Request(u.href), params: { fut: u.pathname.split('/').pop() }, env: {} });
    r.fulfill({ status: res.status, contentType: 'application/json', body: await res.text() });
  });
  return ctx;
}

(async () => {
  engine = await import('../../functions/api/gex/_engine.js');
  candles = await import('../../functions/api/gex/candles/[fut].js');
  const b = await launch();
  try {
    const spx = await body('SPX', 0), qqq = await body('QQQ', 0);
    check(spx && qqq, 'engine built SPX and QQQ 0DTE with futures');
    for (const [n, d] of [['SPX', spx], ['QQQ', qqq]]) {
      check(d.wall_source === 'gamma', n + ' wall_source ' + d.wall_source + ', call ' + d.call_wall + ', put ' + d.put_wall + ', spot ' + d.spot + ', iv30 ' + d.iv30);
      check(d.call_wall >= d.spot && d.put_wall <= d.spot, n + ' call wall above spot, put wall below');
      check(d.source === 'cboe' && d.sources && d.sources.chain === 'cboe' && Math.abs(d.zero_gamma / d.spot - 1) < 0.01, n + ' source ' + d.source + ', zero gamma ' + (d.zero_gamma && d.zero_gamma.toFixed(2)) + ' near spot');
      check(d.expected_info && /atm_/.test(d.expected_info.method), n + ' expected range ' + JSON.stringify(d.expected_info));
    }
    // ---- GEX page, desktop + phone ----
    for (const [w, h, mob] of [[1280, 800, false], [390, 844, true]]) {
      const ctx = await ctxFor(b, w, h, mob);
      const p = await ctx.newPage();
      const errors = [];
      p.on('pageerror', (e) => errors.push(String(e)));
      await p.goto(BASE + '/gex.html', { waitUntil: 'domcontentloaded' });
      await sleep(8000);
      const txt = await p.evaluate(() => document.body.innerText);
      const has = (v) => txt.includes(v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })) || txt.includes(v.toFixed(2));
      const d = data[lastReq];
      const ws = d && d.wall_source;
      check(ws === 'gamma', 'GEX page ' + w + ' requested ' + lastReq + ': wall_source ' + ws);
      check(has(d.call_wall) && has(d.put_wall), 'GEX page ' + w + ': shows call wall ' + d.call_wall + ' and put wall ' + d.put_wall);
      const sw = await p.evaluate(() => document.documentElement.scrollWidth);
      check(sw <= w, 'GEX page ' + w + ': no horizontal overflow (' + sw + ')');
      check(!errors.length, 'GEX page ' + w + ': no page errors ' + errors.join(' | '));
      await p.evaluate(() => { const el = document.getElementById('gex-ranges') || document.querySelector('.gex-range'); if (el) window.scrollTo(0, Math.max(0, el.getBoundingClientRect().top + window.scrollY - 420)); });
      await sleep(1200);
      await p.screenshot({ path: OUT + '/gex-page-' + w + '.png' }); console.log('SHOT ' + OUT + '/gex-page-' + w + '.png');
      await ctx.close();
    }
    // ---- chart indicator ----
    const ctx = await ctxFor(b, 1280, 800, false);
    const p = await ctx.newPage();
    await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.STRYKER_VELA, null, { timeout: 45000 });
    await sleep(4000);
    await p.evaluate(() => { const ws = window.STRYKER_VELA; ws.cell(ws.context().cells[0].id).setSymbol('futures:ES1!'); ws.context().cells[0].chart.addNativeIndicator('stk_gex', { inputs: { dte: '0' } }); });
    for (const [sym, api, fut] of [['futures:ES1!', spx, 'ES'], ['futures:NQ1!', qqq, 'NQ']]) {
      await p.evaluate((s) => { const ws = window.STRYKER_VELA; ws.cell(ws.context().cells[0].id).setSymbol(s); }, sym);
      await sleep(7000);
      const lines = await p.evaluate(async () => {
        const c = window.STRYKER_VELA.context().cells[0].chart; const seen = new Set();
        const find = (o, d) => { if (!o || typeof o !== 'object' || d > 4 || seen.has(o)) return null; seen.add(o); if (o.nativeData instanceof Map && o.nativeData.has('stk_gex')) return o.nativeData.get('stk_gex'); for (const k of Object.keys(o)) { try { const r = find(o[k], d + 1); if (r) return r; } catch (e) {} } return null; };
        const x = find(c, 0); const b = c.orchestrator.rawBars; const lb = b[b.length - 1];
        return x && x.lines ? { lines: x.lines.map((l) => ({ id: l.id, price: l.price, text: l.text })), shift: x.shift, last: lb && (lb.close != null ? lb.close : lb.c) } : null;
      });
      const L = api.futures[fut].levels;
      const sh = lines ? lines.shift || 0 : 0;
      const g = (id) => lines && lines.lines.find((l) => l.id === id);
      check(g('call') && Math.abs(g('call').price - (L.call_wall + sh)) < 0.011 && g('put') && Math.abs(g('put').price - (L.put_wall + sh)) < 0.011,
        fut + ' chart walls = API (' + L.call_wall + ' / ' + L.put_wall + ') + shift ' + sh + ': ' + (lines && [g('call'), g('put')].map((l) => l && l.text).join(' | ')));
      console.log('INFO ' + fut + ' last ' + (lines && lines.last) + ' | ' + (lines ? lines.lines.filter((l) => ['call', 'zero', 'put', 'ivhi', 'ivlo'].includes(l.id)).map((l) => l.text).join(' | ') : ''));
      // chip must not cover any right-edge label
      const ov = await p.evaluate(() => { const c = document.querySelector('.stk-gex-chip'); let cv = null; for (const x of document.querySelectorAll('canvas')) if (x.__stkGexTags) cv = x; if (!c || c.hidden || !cv) return null; const r = c.getBoundingClientRect(), q = cv.getBoundingClientRect(); return cv.__stkGexTags.filter((t) => t.box && !(q.left + t.box.x > r.right || q.left + t.box.x + t.box.w < r.left || q.top + t.box.y > r.bottom || q.top + t.box.y + t.box.h < r.top)).map((t) => t.text); });
      check(ov === null || ov.length === 0, fut + ': status chip covers no level label ' + JSON.stringify(ov));
      await p.screenshot({ path: OUT + '/gex-r4-' + fut.toLowerCase() + '-1280.png' }); console.log('SHOT ' + OUT + '/gex-r4-' + fut.toLowerCase() + '-1280.png');
    }
    await ctx.close();
  } catch (e) { fail++; console.log('FAIL exception ' + (e && e.stack || e)); }
  finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
