// ZoroOptions chart indicators: browser test (stream 4).
//   node tools/tests/chart-dev-server.mjs 8071 &   (site + /api/chart/bars, binds 127.0.0.1)
//   flock /tmp/stryker-chrome.lock env CHART_BASE=http://127.0.0.1:8071 node tools/tests/zoro-indicators-browser.js [shotsDir]
// /api/zo/* is answered here from the real S1 fixtures (tools/fixtures/zoro/summary.json, activity*.json), prices scaled to
// the symbol and times shifted to now, Pro member (richstub). Launched: on by default, stk_zoro_options='0' opts out.
const { launch } = require('./lib.js');
const fs = require('fs');
const path = require('path');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8071';
const OUT = process.argv[2] || '/tmp';
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NOW = Math.floor(Date.now() / 1000);
const DAY = 86400;
const SPOT = { IWM: 2000, USO: 80, SPX: 6800 };
const FIX = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'zoro', n), 'utf8'));
const F0 = FIX('summary.json');
const NBANDS = new Set(Object.values(F0.ranges).map((r) => r.join(','))).size;   // same expiry twice (weekly = 0DTE on a Friday) is one band
const GEX_SPX = fs.readFileSync(path.join(__dirname, 'fixtures', 'gex', 'SPX-0.json'), 'utf8');   // ES/SPX still use /api/gex/levels
function summary(u) {
  // the real feeder fixture, scaled to this symbol's spot and moved so its chain time is 2 min ago
  const f = FIX('summary.json'), k = (SPOT[u] || 100) / f.spot, dt = NOW - 120 - f.t;
  const px = (v) => (typeof v === 'number' ? v * k : v);
  const L = f.levels, iv = f.iv;
  return Object.assign({}, f, { u, t: f.t + dt, built: f.built + dt, spot: px(f.spot),
    levels: Object.assign({}, L, { call_ceiling: px(L.call_ceiling), put_floor: px(L.put_floor), flip_line: px(L.flip_line), pin: px(L.pin) }),
    nodes: f.nodes.map((n) => Object.assign({}, n, { k: px(n.k) })),
    ranges: Object.fromEntries(Object.entries(f.ranges).map(([key, r]) => [key, r.map(px)])),
    iv: Object.assign({}, iv, { t: iv.t.map((x) => x + dt) }) });
}
function activity(u, kind) {
  const f = FIX(kind === 'burst' ? 'activity.json' : 'activity-fresh.json'), k = (SPOT[u] || 100) / FIX('summary.json').spot, dt = NOW - 120 - f.t;
  return Object.assign({}, f, { u, t: f.t + dt, built: f.built + dt, rows: f.rows.map((r) => Object.assign({}, r, { t: r.t + dt, k: r.k * k })) });
}

async function open(b, { w, h, mobile, flag }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((off) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); if (off) localStorage.setItem('stk_zoro_options', '0'); } catch (e) {} }, !flag);
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  const zoHits = [];
  await ctx.route(/\/api\/zo\//, (r) => {
    const u = new URL(r.request().url()); zoHits.push(u.pathname + u.search);
    const sym = u.searchParams.get('u');
    const name = u.pathname.split('/').pop();
    const body = name === 'summary' ? summary(sym) : name === 'activity' ? activity(sym, u.searchParams.get('kind')) : { error: 'n/a' };
    r.fulfill({ status: body.error ? 404 : 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await ctx.route(/\/api\/gex\//, (r) => (/\/api\/gex\/levels\/SPX\b/i.test(r.request().url()) ? r.fulfill({ status: 200, contentType: 'application/json', body: GEX_SPX })
    : r.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"x"}' })));
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|status of 4|status of 5|WebSocket|wss?:\/\//.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });   // no ?zoro=1: launched = on by default
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA, null, { timeout: 45000 });
  await p.evaluate(async () => { for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 300)); try { if (window.STRYKER_VELA.context().cells[0].chart.orchestrator.rawBars.length > 0) return; } catch (e) {} } });
  return { ctx, p, errors, zoHits };
}
const setSym = async (p, sym, tf) => { await p.evaluate(([s, tf]) => { const ws = window.STRYKER_VELA; const c = ws.cell(ws.context().cells[0].id); c.setSymbol(s); if (tf) c.setTimeframe(tf); }, [sym, tf]); await sleep(2500); };
const types = (p) => p.evaluate(() => { const o = []; document.querySelectorAll('.stkiw-row').forEach((r) => o.push(r.getAttribute('data-key'))); return o; });
const add = (p, type) => p.evaluate((t) => { const c = window.STRYKER_VELA.context().cells[0].chart; return (c.addNativeIndicator(t, { inputs: {} }), window.STRYKER_VELA.context().stateChanged(), true); }, type);
const natives = (p) => p.evaluate(() => window.STRYKER_VELA.context().cells[0].chart.indicators().filter((h) => h.nativeType).map((h) => h.nativeType));
const dataOf = (p, type) => p.evaluate((t) => {
  const c = window.STRYKER_VELA.context().cells[0].chart, seen = new Set();
  const find = (o, d) => { if (!o || typeof o !== 'object' || d > 4 || seen.has(o)) return null; seen.add(o); if (o.nativeData instanceof Map && o.nativeData.has(t)) return o.nativeData.get(t); for (const k of Object.keys(o)) { try { const r = find(o[k], d + 1); if (r) return r; } catch (e) {} } return null; };
  return JSON.parse(JSON.stringify(find(c, 0) || null));
}, type);
const lastClose = (p) => p.evaluate(() => { const rb = window.STRYKER_VELA.context().cells[0].chart.orchestrator.rawBars; return rb.length ? (rb[rb.length - 1].close != null ? rb[rb.length - 1].close : rb[rb.length - 1][4]) : null; });
async function shot(p, name) { await p.mouse.move(5, 5).catch(() => {}); await sleep(500); await p.screenshot({ path: OUT + '/' + name }); console.log('SHOT ' + OUT + '/' + name); }

(async () => {
  const b = await launch();
  try {
    // ---- opted out (stk_zoro_options='0'): nothing new, no /api/zo call ----
    {
      const { ctx, p, errors, zoHits } = await open(b, { w: 1440, h: 900, flag: false });
      await setSym(p, 'futures:ES1!', '5');
      await p.evaluate(() => window.STRYKER_VELA.indicatorPicker.open()); await sleep(700);
      const keys = await types(p);
      check(!keys.some((k) => /zrange|zzone|ivrank|zvol/.test(k)), 'flag off: no Zoro indicators listed (' + keys.length + ' rows)');
      await p.keyboard.press('Escape');
      check(zoHits.length === 0, 'flag off: no /api/zo request');
      check(errors.length === 0, 'flag off: no console errors ' + errors.slice(0, 2).join(' | '));
      await ctx.close();
    }
    // ---- default (launched), desktop + phones, Russell future ----
    for (const [w, h, mobile, tag] of [[1440, 900, false, '1440'], [412, 915, true, '412'], [390, 844, true, '390']]) {
      const { ctx, p, errors, zoHits } = await open(b, { w, h, mobile, flag: true });
      await setSym(p, 'futures:RTY1!', '5');
      await p.evaluate(() => window.STRYKER_VELA.indicatorPicker.open()); await sleep(700);
      const keys = await types(p);
      for (const k of ['b:stk_zrange', 'b:stk_zzone', 'b:stk_ivrank', 'b:stk_zvol', 'b:stk_gex', 'b:stk_gexheat']) check(keys.includes(k), tag + ': ' + k + ' listed');
      await p.keyboard.press('Escape'); await sleep(300);
      // Zoro Levels with nodes / ranges / pin
      await p.evaluate(() => { const ws = window.STRYKER_VELA; const c = ws.context().cells[0].chart; c.addNativeIndicator('stk_gex', { inputs: {} }); ws.context().stateChanged(); });
      await sleep(1500);
      await p.evaluate(() => { const h = window.STRYKER_VELA.context().cells[0].chart.indicators().find((x) => x.nativeType === 'stk_gex'); if (h) h.setInputs(Object.assign({}, h.inputValues(), { showNodes: true, showRanges: true, showPin: true, nodeCount: 10, showPrev: false })); });
      await sleep(2500);
      const d = await dataOf(p, 'stk_gex');
      const ids = d && d.lines ? d.lines.map((l) => l.id) : [];
      check(ids.filter((x) => /^zn/.test(x)).length === 10, tag + ': RTY Zoro Levels draws 10 Gamma Nodes (' + ids.join(',') + ')');
      check(ids.filter((x) => /^zr/.test(x)).length === 8, tag + ': 4 Zoro Range expiries x 2 edges');
      check(ids.includes('zpin') && ids.includes('call') && ids.includes('put'), tag + ': Pin Strike + Call Ceiling + Put Floor drawn');
      const call = d && d.lines && d.lines.find((l) => l.id === 'call');
      check(call && /^CALL CEILING/.test(call.text), tag + ': glossary name "' + (call && call.text) + '"');
      check(d && /updated (just now|\d+ min ago)/.test(d.status || '') && !/\blive\b|real-time|delayed|behind/i.test(d.status || ''), tag + ': status "' + (d && d.status) + '"');
      // ratio check: IWM spot 2000 -> RTY chart price near bar close; flip/spot as in the fixture
      const c = await lastClose(p);
      const flip = d && d.lines && d.lines.find((l) => l.id === 'zero');
      check(flip && c && Math.abs(flip.price / c - F0.levels.flip_line / F0.spot) < 0.02, tag + ': Flip Line mapped to RTY scale (' + (flip && flip.price) + ' vs close ' + c + ')');
      check(zoHits.some((x) => /summary\?u=IWM/.test(x)), tag + ': asked /api/zo/summary?u=IWM');
      // other indicators
      for (const t of ['stk_zrange', 'stk_zzone', 'stk_ivrank', 'stk_zvol']) await add(p, t);
      await sleep(3500);
      const nt = await natives(p);
      for (const t of ['stk_zrange', 'stk_zzone', 'stk_ivrank', 'stk_zvol']) check(nt.includes(t), tag + ': ' + t + ' added');
      const zr = await dataOf(p, 'stk_zrange'), zz = await dataOf(p, 'stk_zzone'), zv = await dataOf(p, 'stk_zvol');
      check(zr && zr.bands && zr.bands.length === NBANDS && /updated/.test(zr.status), tag + ': Zoro Range ' + NBANDS + ' bands, "' + (zr && zr.status) + '"');
      check(zz && zz.zone === F0.zone && /Swing/.test(zz.status), tag + ': Gamma Zone ' + (zz && zz.zone));
      check(zv && (zv.agg || zv.note), tag + ': Volume Burst marks ' + (zv && (zv.note || (zv.agg && zv.agg.filter(Boolean).length + ' bars'))));
      const iv = await p.evaluate(() => window.__stkIvRank || null);
      check(iv && iv.u === 'IWM' && iv.rank >= 0 && iv.rank <= 100 && iv.n > 100, tag + ': IV Rank ' + JSON.stringify(iv));
      await shot(p, 'S4-rty-' + tag + '-dark.png');
      if (tag === '1440') { await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'light')); await sleep(1200); await shot(p, 'S4-rty-1440-light.png'); await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark')); await sleep(500); }
      // bar replay: clock 2 h ago -> no marks after it, IV rank recomputed from older values, levels indicators hidden (no lookahead)
      await p.evaluate((E) => { window.__stkReplay = { on: true, E }; }, (NOW - 7200) * 1000);
      await p.evaluate(() => window.STRYKER_VELA.context().cells[0].chart.indicators().filter((h) => /stk_(zvol|ivrank|zrange|zzone)/.test(h.nativeType)).forEach((h) => h.setInputs(Object.assign({}, h.inputValues(), { showStatus: h.inputValues().showStatus === false }))));
      await sleep(1500);
      const rz = await dataOf(p, 'stk_zvol'), rr = await dataOf(p, 'stk_zrange'), riv = await p.evaluate(() => window.__stkIvRank || null);
      const lastMark = rz && rz.agg ? rz.agg.map((x, i) => (x ? i : -1)).filter((i) => i >= 0).length : -1;
      check(rz && rz.until && rz.agg && rz.agg.every((x) => !x || x.zv.items.every((it) => it.t <= rz.until)), tag + ': replay: no Fresh Volume / Burst mark after the clock (' + lastMark + ' bars)');
      check(rr && /hidden during bar replay/.test(rr.note || ''), tag + ': replay: Zoro Range hidden');
      check(riv && riv.until && riv.until <= NOW - 7200 + 1, tag + ': replay: IV rank uses values up to the clock');
      await p.evaluate(() => { window.__stkReplay = { on: false }; });
      // CL -> USO
      await setSym(p, 'futures:CL1!', '5'); await sleep(2500);
      check(zoHits.some((x) => /summary\?u=USO/.test(x)), tag + ': CL asks USO');
      // ES -> SPX: Zoro Levels nodes on the S&P future
      await setSym(p, 'futures:ES1!', '5'); await sleep(2500);
      const de = await dataOf(p, 'stk_gex');
      check(zoHits.some((x) => /summary\?u=SPX/.test(x)) && de && de.lines && de.lines.filter((l) => /^zn/.test(l.id)).length === 10, tag + ': ES asks SPX, 10 Gamma Nodes');
      await shot(p, 'zo-es-' + tag + '-dark.png');
      if (tag === '1440') { await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'light')); await sleep(1200); await shot(p, 'zo-es-1440-light.png'); await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark')); await sleep(500); }
      const all = await p.evaluate(() => document.body.innerText);
      check(!/Call Resistance|Put Support|\bHVL\b|Q-Score|Market Tide|\bHIRO\b|Periscope|Gamma Wall|bullish|bearish/i.test(all), tag + ': no rival terms');
      check(errors.length === 0, tag + ': no console errors ' + errors.slice(0, 2).join(' | '));
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
