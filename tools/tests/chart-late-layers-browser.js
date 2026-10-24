// Late-loaded overlay layers (job "late overlay fix 1024"). A browser whose saved state has no
// volume / order-flow tool loads chart-orderflow.js AFTER the first chart exists; Vela builds the
// renderer layer canvases once at construction, so Session Volume Profile & co drew nothing until a
// reload. This suite adds each such tool through the Indicators window with REAL mouse clicks
// (CDP Input.dispatchMouseEvent via page.mouse) on a fresh browser, and checks that its layer
// canvas exists and carries pixels without a reload, and that removing the last one drops it.
// Recorder /orderflow + candles come from REAL recorded NQ order flow (fixtures/orderflow), with
// the clock faked to 21 Oct 2026 13:00 New York, so nothing live is called.
//   node tools/tests/chart-dev-server.mjs 8231 &
//   CHART_BASE=http://127.0.0.1:8231 node tools/tests/chart-late-layers-browser.js <shotsDir>
//   env ENGINES=0.9,0.6 VPS=1440,390 MODE=late|shots   (shots = fixed overlay screenshots for a before/after diff)
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8231';
const OUT = process.argv[2] || '/tmp';
const MODE = process.env.MODE || 'late';
const TAG = process.env.TAG || 'x';
const ENGINES = (process.env.ENGINES || '0.9,0.6').split(',');
const VPS = (process.env.VPS || '1440,390').split(',').map(Number);
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const FIX = path.join(__dirname, 'fixtures');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 400))); };
const BODY = {};
for (const d of ['2026-10-20', '2026-10-21']) BODY[d] = zlib.gunzipSync(fs.readFileSync(path.join(FIX, 'orderflow', 'NQ-' + d + '.bin.gz')));
const LV = { SPX: fs.readFileSync(path.join(FIX, 'gex', 'SPX-0.json'), 'utf8'), QQQ: fs.readFileSync(path.join(FIX, 'gex', 'QQQ-0.json'), 'utf8') };
let CAND = null;
async function candles(tf) {
  if (!CAND) {
    const D = await import(path.resolve(__dirname, '../../assets/chart-footprint-data.js'));
    CAND = { D, bars: [].concat(...Object.values(BODY).map((u) => D.decodeOrderflow(new Uint8Array(u)).bars)) };
  }
  return CAND.D.aggregate(CAND.bars, tf * 60000).map((b) => [b.t / 1000, b.o * 0.25, b.hi * 0.25, b.lo * 0.25, b.c * 0.25, b.vol]);
}
const NOW = Date.UTC(2026, 9, 21, 17, 0);

// The tools that ride the lazy path (chart-orderflow.js registers their layers after boot), by the
// name the Indicators window shows. Volume Profile (trades) + Footprint order flow register pre-boot
// (chart-footprint.js) and are checked too, as controls.
const LATE = [
  ['stk_svp', 'Session Volume Profile'],
  ['stk_vbubble', 'Volume Bubble / Big Prints'],
  ['stk_vheatmap', 'Volume Heatmap'],
  ['stk_lth', 'Liquidity Trend Heatmap'],
  ['stk_of_vp', 'Volume Profile (trades: session / swing + naked POC)'],
];

async function open(b, vp, eng, seed) {
  const ctx = await b.newContext({ viewport: { width: vp, height: vp === 390 ? 844 : 900 }, deviceScaleFactor: 1, isMobile: vp === 390, hasTouch: vp === 390 });
  await ctx.addInitScript(stub);
  if (MODE === 'shots') await ctx.addInitScript(() => { window.__stkFreeze = true; });
  await ctx.addInitScript(([now, seed]) => {
    try {
      localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_community_disclaimer_ack_v1', '1');
      if (!sessionStorage.getItem('__seeded')) {
        for (const k of Object.keys(localStorage)) if (/vela|stryker\.volume|stryker\.gex/.test(k)) localStorage.removeItem(k);
        if (seed) for (const k in seed) localStorage.setItem(k, seed[k]);
        sessionStorage.setItem('__seeded', '1');
      }
    } catch (e) {}
    const RealDate = Date, off = now - RealDate.now(), frozen = /MODE=shots/.test(location.hash) || window.__stkFreeze;
    const t = () => (frozen ? now : RealDate.now() + off);
    class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(t()); } static now() { return t(); } }
    window.Date = FakeDate;
    window.__stkOfTestTier = { free: false, plan: 'Pro', admin: true };
  }, [NOW, seed || null]);
  await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  await ctx.route(/127\.0\.0\.1:\d+\/api\/chart\/bars\//, async (r) => {
    const u = new URL(r.request().url());
    const tf = Number(u.searchParams.get('tf')) || (u.searchParams.get('tf') === 'D' ? 1440 : 15), page = Number(u.searchParams.get('page')) || 0;
    const bars = (await candles(tf)).filter((x) => x[0] * 1000 < NOW);
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ s: 'NQ', tf: String(tf), page, bars }) });
  });
  await ctx.route(/127\.0\.0\.1:\d+\/api\/chart\/stream/, (r) => r.abort());
  await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\/orderflow/, (r) => {
    const u = new URL(r.request().url());
    const body = u.searchParams.get('sym') === 'NQ' && BODY[u.searchParams.get('day')];
    if (!body) { r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' }); return; }
    r.fulfill({ status: 200, contentType: 'application/octet-stream', headers: { 'access-control-allow-origin': '*' }, body });
  });
  await ctx.route(/127\.0\.0\.1:\d+\/api\/gex\/levels\//, (r) => {
    const n = new URL(r.request().url()).pathname.split('/').pop().toUpperCase();
    r.fulfill({ status: 200, contentType: 'application/json', body: LV[n] || LV.SPX });
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource|\/api\/chart\/stream|firebase|firestore|CORS|WebSocket/i.test(m.text())) errors.push(m.text().slice(0, 200)); });
  p.on('pageerror', (e) => { if (!/docChanges/.test(String(e))) errors.push(String(e).slice(0, 200)); });
  await p.goto(BASE + '/charts.html' + (eng === '0.6' ? '?vela=0.6' : ''), { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STRYKER_VELA && window.__stkHeavyReady, null, { timeout: 90000 });
  await p.evaluate(async () => { for (let i = 0; i < 100; i++) { await new Promise((r) => setTimeout(r, 300)); try { if (window.STRYKER_VELA.context().cells[0].chart.orchestrator.rawBars.length > 50) return; } catch (e) {} } });
  await sleep(2500);
  return { ctx, p, errors };
}

async function realClickBox(p, box, label) {
  if (!box || !box.w) { check(false, 'real click target found: ' + label); return false; }
  if (!box.hit) check(false, 'click target is on top: ' + label, box);
  await p.mouse.move(box.x, box.y); await p.mouse.down(); await p.mouse.up();
  await sleep(350);
  return true;
}
const boxOf = (p, src, arg) => p.evaluate(([src, a]) => {
  const el = new Function('a', src)(a);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  const top = document.elementFromPoint(x, y);
  return { x, y, w: r.width, h: r.height, hit: !!top && (top === el || el.contains(top)) };
}, [src, arg]);
// The toolbar "Indicators" button (desktop top bar, phone one-row bar).
const IND_BTN = "return [...document.querySelectorAll('button')].find((b) => { const r = b.getBoundingClientRect(); return r.width > 0 && r.top < 140 && /^indicators/i.test((b.getAttribute('aria-label') || b.title || b.textContent || '').trim()); }) || null;";
const ROW = "return document.querySelector('.stkiw-row[data-key=\"b:' + a + '\"] .stkiw-name');";

async function addViaWindow(p, type, name) {
  if (!(await realClickBox(p, await boxOf(p, IND_BTN), 'Indicators button'))) return false;
  await p.waitForSelector('.stkiw-search', { timeout: 15000 });
  await p.waitForSelector('.stkiw-row', { timeout: 20000 }).catch(() => {});
  await sleep(300);
  await p.mouse.click(...(await p.evaluate(() => { const r = document.querySelector('.stkiw-search').getBoundingClientRect(); return [r.left + 20, r.top + r.height / 2]; })));
  await p.keyboard.type(name.split(' (')[0].split(' / ')[0], { delay: 15 });
  await p.waitForSelector('.stkiw-row[data-key="b:' + type + '"]', { timeout: 15000 }).catch(async () => {
    console.log('rows for "' + name + '":', JSON.stringify(await p.evaluate(() => ({ q: (document.querySelector('.stkiw-search') || {}).value, list: (document.querySelector('.stkiw-list') || {}).innerText.slice(0, 300), rows: [...document.querySelectorAll('.stkiw-row')].slice(0, 12).map((r) => r.dataset.key + '=' + (r.querySelector('.stkiw-nm') || {}).textContent) }))));
  });
  await p.evaluate((t) => { const el = document.querySelector('.stkiw-row[data-key="b:' + t + '"]'); if (el) el.scrollIntoView({ block: 'center' }); }, type);
  const ok = await realClickBox(p, await boxOf(p, ROW, type), 'row ' + type);
  await sleep(400);
  // close the window (Escape) so the chart is visible
  if (await p.evaluate(() => !!document.querySelector('.stkiw-search'))) { await p.keyboard.press('Escape'); await sleep(300); }
  return ok;
}

// Layer canvas state for a type on the first chart: entry exists, in the DOM, opaque pixel count.
const layerState = (p, type) => p.evaluate((type) => {
  const chart = window.STRYKER_VELA.context().cells[0].chart;
  const R = chart.renderer.extLayers ? chart.renderer : chart.renderer.renderer;
  const ls = R.extLayers.filter((l) => l.def.id === type);
  let px = 0, sized = true;
  for (const l of ls) {
    const c = l.canvas; if (!c.width || !c.height || c.width !== R.chromeCanvas.width) sized = false;
    if (!c.width || !c.height) continue;
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    for (let i = 3; i < d.length; i += 16) if (d[i] > 8) px++;
  }
  const onChart = chart.indicators().some((h) => h.nativeType === type);
  return { n: ls.length, inDom: ls.every((l) => l.canvas.isConnected && l.canvas.parentNode === R.plot), px, sized, onChart, total: R.extLayers.length };
}, type);
const wait = async (fn, ms) => { const t0 = Date.now(); let v; while (Date.now() - t0 < ms) { v = await fn(); if (v) return v; await sleep(500); } return v; };

async function lateRun(b, eng, vp) {
  const tag = eng + ' ' + vp;
  const { ctx, p, errors } = await open(b, vp, eng);
  try {
    check(await p.evaluate(() => window.__stkVela090 === true) === (eng === '0.9'), tag + ': engine');
    const preHeavy = await p.evaluate(() => { try { return !!window.__stkFlow; } catch (e) { return null; } });
    check(preHeavy === true, tag + ': heavy modules loaded after boot (fresh browser)');
    const total0 = (await layerState(p, 'stk_svp')).total;
    for (const [type, name] of LATE) {
      if (ONLY.length && !ONLY.includes(type)) continue;
      const s0 = await layerState(p, type);
      await addViaWindow(p, type, name);
      const s1 = await wait(async () => { const s = await layerState(p, type); return s.onChart && s.px > 0 ? s : null; }, 12000) || await layerState(p, type);
      check(s1.onChart, tag + ': ' + type + ' added via the Indicators window');
      check(s1.n === 1 && s1.inDom && s1.sized, tag + ': ' + type + ' has a mounted, sized layer canvas', { before: s0, after: s1 });
      check(s1.px > 0, tag + ': ' + type + ' draws pixels without a reload', s1);
      await p.screenshot({ path: path.join(OUT, 'late-' + eng + '-' + vp + '-' + type + '.png') });
      // remove the last instance: a late layer goes away again
      await p.evaluate((t) => { const c = window.STRYKER_VELA.context().cells[0].chart; c.indicators().filter((h) => h.nativeType === t).forEach((h) => h.remove()); }, type);
      await sleep(600);
      const s2 = await layerState(p, type);
      check(!s2.onChart && s2.px === 0, tag + ': ' + type + ' removed, nothing left drawn', s2);
    }
    const total1 = (await layerState(p, 'stk_svp')).total;
    check(total1 <= total0 + 0, tag + ': no leftover layer canvases after removing (' + total0 + ' -> ' + total1 + ')');
    // Add SVP again, then reload: restores from the saved state (heavy before boot) and still draws.
    await addViaWindow(p, 'stk_svp', 'Session Volume Profile');
    await p.evaluate(() => window.STRYKER_VELA.context().stateChanged());
    await sleep(1500);
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.STRYKER_VELA && window.__stkHeavyReady, null, { timeout: 90000 });
    const s3 = await wait(async () => { const s = await layerState(p, 'stk_svp'); return s.onChart && s.px > 0 ? s : null; }, 20000) || await layerState(p, 'stk_svp');
    check(s3.onChart && s3.n === 1 && s3.px > 0, tag + ': SVP after reload: one layer, draws', s3);
    const sw = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    check(sw <= 0, tag + ': no horizontal scroll', sw);
    check(errors.length === 0, tag + ': no console errors', errors);
  } finally { await ctx.close(); }
}

// Fixed overlay screenshots (MODE=shots): GEX levels, GEX heatmap, footprint VP, delta suite and,
// separately, the bare chart. Run once on the old build and once on the new; diff the PNGs.
async function shotsRun(b, eng, vp) {
  const tag = eng + '-' + vp;
  const sets = [
    ['bare', []],
    ['gex', ['stk_gex']],
    ['gexheat', ['stk_gexheat']],
    ['ofvp', ['stk_of_vp']],
    ['dsuite', ['stk_dsuite']],
    ['fpchart', ['@fp']],
    ['lm', ['@lm']],
  ];
  for (const [nm, types] of sets) {
    if (ONLY.length && !ONLY.includes(nm)) continue;
    const { ctx, p, errors } = await open(b, vp, eng);
    try {
      for (const t of types) {
        if (t === '@lm') {
          await p.evaluate(() => window.STRYKER_VELA.indicatorPicker.open());
          await p.waitForSelector('.stkiw-row', { timeout: 20000 });
          await p.evaluate(() => document.querySelector('.stkiw-tab[data-k="picks"]').click());
          await sleep(400);
          await p.evaluate(() => document.querySelector('.stkiw-row[data-key="x:liquidity-master-tradezoro"] .stkiw-name').click());
          await sleep(1000);
          if (await p.evaluate(() => !!document.querySelector('.stkiw-search'))) await p.keyboard.press('Escape');
          await p.waitForFunction(() => { try { return window.STRYKER_VELA.context().cells[0].chart.orchestrator.registry.all().some((r) => r.model && /Liquidity Master/.test(r.model.title || '') && (r.model.lines || []).length); } catch (e) { return false; } }, null, { timeout: 120000 }).catch(() => console.log('LM model not seen'));
          continue;
        }
        if (t === '@fp') await p.evaluate(() => window.STRYKER_VELA.active.setPriceStyle('stk_fp'));
        else await p.evaluate((t) => window.STRYKER_VELA.context().cells[0].chart.addNativeIndicator(t), t);
      }
      await p.evaluate(() => { const c = window.STRYKER_VELA.context().cells[0].chart; const n = c.orchestrator.rawBars.length; c.setVisibleRange({ from: n - (window.innerWidth < 500 ? 40 : 120), to: n + 3 }); });
      await sleep(7000);
      await p.mouse.move(2, vp === 390 ? 830 : 890);
      await sleep(500);
      await p.screenshot({ path: path.join(OUT, 'ov-' + TAG + '-' + tag + '-' + nm + '.png') });
      const st = await p.evaluate(() => { const chart = window.STRYKER_VELA.context().cells[0].chart; const R = chart.renderer.extLayers ? chart.renderer : chart.renderer.renderer; return R.extLayers.map((l) => l.def.id).join(','); });
      console.log('shot', tag, nm, 'layers:', st);
      check(errors.length === 0, tag + ' ' + nm + ': no console errors', errors);
    } finally { await ctx.close(); }
  }
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=768'] });
  try {
    for (const eng of ENGINES) for (const vp of VPS) {
      if (MODE === 'probe') {
        const { ctx, p } = await open(b, vp, eng);
        await p.evaluate(() => window.STRYKER_VELA.indicatorPicker.open());
        await p.waitForSelector('.stkiw-row', { timeout: 20000 });
        const tabs = await p.evaluate(() => [...document.querySelectorAll('.stkiw-tab')].map((t) => t.dataset.k));
        for (const k of tabs) {
          await p.evaluate((k) => document.querySelector('.stkiw-tab[data-k="' + k + '"]').click(), k);
          await sleep(400);
          const rows = await p.evaluate(() => [...document.querySelectorAll(".stkiw-row")].filter((r) => /b:(stk_|vpvr)/.test(r.dataset.key)).map((r) => r.dataset.key + '=' + (r.querySelector('.stkiw-nm') || {}).textContent));
          if (rows.length) console.log(k, JSON.stringify(rows));
        }
        await ctx.close();
        continue;
      }
      if (MODE === 'shots') await shotsRun(b, eng, vp); else await lateRun(b, eng, vp);
    }
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASSED');
  process.exit(fail ? 1 : 0);
})();
