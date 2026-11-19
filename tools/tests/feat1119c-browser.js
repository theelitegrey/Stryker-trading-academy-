// Browser shots + checks for the 19 Nov member options (roadmap vp-always-visible, vp-combine-near, tpo-single-prints, of-buy-sell-heavy).
// REAL recorded NQ order flow fixtures (no live calls). Every option is OFF by default; each case checks default == before, then turns it ON.
//   node tools/tests/chart-dev-server.mjs 8071 &
//   CHART_BASE=http://127.0.0.1:8071 flock /tmp/stryker-chrome.lock node tools/tests/feat1119c-browser.js <shotsDir>
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8071';
const OUT = process.argv[2] || '.';
const ONLY = process.argv.slice(3);
const FIX = path.join(__dirname, 'fixtures/orderflow');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 400))); };
const BODY = {};
for (const d of ['2026-10-20', '2026-10-21']) BODY[d] = zlib.gunzipSync(fs.readFileSync(path.join(FIX, 'NQ-' + d + '.bin.gz')));
let CAND = null;
async function candles(tf) {
  if (!CAND) {
    const D = await import(path.resolve(__dirname, '../../assets/chart-footprint-data.js'));
    const bars = [].concat(...Object.values(BODY).map((u) => D.decodeOrderflow(new Uint8Array(u)).bars));
    CAND = { D, bars };
  }
  return CAND.D.aggregate(CAND.bars, tf * 60000).map((b) => [b.t / 1000, b.o * 0.25, b.hi * 0.25, b.lo * 0.25, b.c * 0.25, b.vol]);
}
// The chart's "now": 21 Oct 17:00 UTC (13:00 New York), mid-session, so some levels still hold
const NOW = Date.UTC(2026, 9, 21, 17, 0);

async function open(b, { w, h, mobile, v09 }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(([now, theme]) => {
    try { if (theme) localStorage.setItem('stryker_theme', theme); localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_community_disclaimer_ack_v1', '1');
      localStorage.removeItem('stryker.vela.session'); localStorage.removeItem('vela-workspace'); localStorage.removeItem('vela-workspace-090'); } catch (e) {}
    const RealDate = Date, off = now - RealDate.now();
    class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + off); } static now() { return RealDate.now() + off; } }
    window.Date = FakeDate;
    window.__stkOfTestTier = { free: false, plan: 'Pro', admin: true };
  }, [NOW, process.env.OFP_THEME === 'light' ? 'day' : (process.env.OFP_THEME || '')]);
  await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  await ctx.route(/127\.0\.0\.1:\d+\/api\/chart\/bars\//, async (r) => {
    const u = new URL(r.request().url());
    const tf = Number(u.searchParams.get('tf')) || 1, page = Number(u.searchParams.get('page')) || 0;
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
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/stream\.binance\.com.*451|ERR_FAILED|Failed to load resource|\/api\/chart\/stream|firebase|firestore|CORS/i.test(m.text())) errors.push(m.text().slice(0, 200)); });
  p.on('pageerror', (e) => { if (!/docChanges/.test(String(e))) errors.push(String(e).slice(0, 200)); });
  await p.goto(BASE + '/charts.html?vela=' + (v09 ? '0.9' : '0.6'), { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_VELA.chart && window.__stkOrderflow, null, { timeout: 60000 });
  await sleep(2500);
  return { ctx, p, errors };
}
async function setMarket(p, sym, tf) {
  await p.evaluate(async ([sym, tf]) => {
    const ws = window.STRYKER_VELA;
    ws.active.setSymbol(sym); ws.active.setTimeframe(tf);
    for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 250)); const c = ws.chart; if (c.market.symbol === sym && c.market.timeframe === tf && c.orchestrator.rawBars.length > 50) break; }
  }, [sym, tf]);
  await sleep(1200);
}
const frameOn = (p, a, z) => p.evaluate(([a, z]) => window.STRYKER_VELA.chart.setVisibleRange({ from: a, to: z }), [a, z]).then(() => sleep(900));
const clearInd = (p) => p.evaluate(() => { const c = window.STRYKER_VELA.chart; for (const h of c.indicators()) if (/^stk_(of_|d)/.test(h.nativeType || '')) { try { h.remove(); } catch (e) {} } });
const add = (p, type, inputs) => p.evaluate(([type, inputs]) => !!window.STRYKER_VELA.chart.addNativeIndicator(type, { inputs }), [type, inputs || {}]);
const ink = (p) => p.evaluate(() => {
  let n = 0;
  for (const c of document.querySelectorAll('#vela-chart canvas')) {
    if (!c.width || !c.height) continue;
    const g = c.getContext('2d'); if (!g) continue;
    let d; try { d = g.getImageData(0, 0, c.width, c.height).data; } catch (e) { continue; }
    for (let i = 3; i < d.length; i += 32) if (d[i] > 0) n++;
  }
  return n;
});
const tablesOf = (p, type) => p.evaluate((type) => { try { return [...window.STRYKER_VELA.chart.renderer.renderer.scene.indicators.values()].filter((m) => m.native && m.native.type === type).map((m) => (m.tables || []).map((t) => t.cells[0][0].text)); } catch (e) { return String(e); } }, type);

const D21 = (h, m) => Date.UTC(2026, 9, 21, h, m);
const setI = (p, type, o) => p.evaluate(([type, o]) => { const h = window.STRYKER_VELA.chart.indicators().find((x) => x.nativeType === type); h.setInputs(Object.assign({}, h.inputValues(), o)); }, [type, o]).then(() => sleep(1500));
const inputs = (p, type) => p.evaluate((type) => window.STRYKER_VELA.chart.indicators().find((x) => x.nativeType === type).inputValues(), type);
const clearAll = (p) => p.evaluate(() => { const c = window.STRYKER_VELA.chart; for (const h of c.indicators()) if (/^stk_/.test(h.nativeType || '')) { try { h.remove(); } catch (e) {} } });
const shot = (p, name) => p.screenshot({ path: path.join(OUT, 'f1119c-' + (process.env.OFP_THEME || 'dark') + '-' + name + '.png') });
const W_ = Number(process.env.OFP_W || 1440);

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    const w = W_, mobile = w < 500;
    const { ctx, p, errors } = await open(b, { w, h: mobile ? 844 : 900, mobile, v09: true });
    await setMarket(p, 'futures:NQ1!', '30');
    // ---- TPO: single prints until filled, merge, always visible
    await clearAll(p); await frameOn(p, Date.UTC(2026, 9, 19, 12, 0), D21(17, 0));
    await add(p, 'stk_of_tpo', {}); await sleep(2000);
    const d = await inputs(p, 'stk_of_tpo');
    check(d.singlesExt === 'touch' && d.mergeMode === 'off' && d.alwaysVisible === false, w + ' tpo: new options default off / unchanged', { s: d.singlesExt, m: d.mergeMode, a: d.alwaysVisible });
    const n0 = await ink(p);
    await setI(p, 'stk_of_tpo', { singles: true, singlesExt: 'touch' }); const nt = await ink(p);
    await setI(p, 'stk_of_tpo', { singles: true, singlesExt: 'filled' }); const nf = await ink(p);
    check(nt > n0 && nf > n0, w + ' tpo singles: touch ' + nt + ' / filled ' + nf + ' px (default ' + n0 + ')');
    await shot(p, w + '-tpo-singles-filled');
    await setI(p, 'stk_of_tpo', { singles: false, mergeMode: 'count', mergeCount: 2 }); const nm = await ink(p);
    check(nm !== n0, w + ' tpo merge count 2 changes the chart (' + n0 + ' -> ' + nm + ')');
    await shot(p, w + '-tpo-merge');
    await setI(p, 'stk_of_tpo', { mergeMode: 'off' });
    check(Math.abs((await ink(p)) - n0) <= Math.max(10, n0 * 0.002), w + ' tpo merge off again = default look');
    // settings panel: the new rows show, conditional rows follow their switch
    await setI(p, 'stk_of_tpo', { singles: true, mergeMode: 'overlap' });
    const opened = await p.evaluate(() => { const c = window.STRYKER_VELA.chart, h = c.indicators().find((x) => x.nativeType === 'stk_of_tpo'), r = c.renderer; try { r.openIndicatorSettings(h.id); return true; } catch (e) { return String(e); } });
    await sleep(1200);
    const rows = await p.evaluate(() => { const d = [...document.querySelectorAll('.vela-dialog')].find((x) => /Period \(minutes per letter\)/.test(x.textContent)); if (!d) return null; return [...d.querySelectorAll('*')].filter((e) => e.children.length === 0).map((e) => (e.textContent || '').trim()).filter(Boolean); });
    const want = ['Merge nearby profiles', 'Merge when value areas overlap', 'Always visible', 'Single prints extend'];
    check(opened === true && rows && want.every((x) => rows.some((r) => r.indexOf(x) === 0)), w + ' tpo settings: new rows listed', want.filter((x) => !rows || !rows.some((r) => r.indexOf(x) === 0)));
    // scroll the new rows into view inside the dialog and measure row alignment (label + control share a centre)
    const al = await p.evaluate(() => {
      const d = [...document.querySelectorAll('.vela-dialog')].find((x) => /Period \(minutes per letter\)/.test(x.textContent)); if (!d) return null;
      const lab = [...d.querySelectorAll('*')].find((e) => e.children.length === 0 && /^Merge nearby profiles/.test((e.textContent || '').trim()));
      if (!lab) return null;
      let row = lab; for (let i = 0; i < 4 && row.parentElement && row.querySelectorAll('input, select, button, [role=switch], [role=combobox]').length === 0; i++) row = row.parentElement;
      const sc = [...d.querySelectorAll('*')].find((e) => e.contains(row) && e.scrollHeight > e.clientHeight + 2 && /auto|scroll/.test(getComputedStyle(e).overflowY)) || d.querySelector('.vela-dialog-body');
      if (sc) sc.scrollTop += lab.getBoundingClientRect().top - sc.getBoundingClientRect().top - 120;   // set the scroller directly (no scrollIntoView)
      const ctls = [...row.querySelectorAll('select, input, button, [role=combobox]')], lr0 = lab.getBoundingClientRect();
      const ctl = ctls.sort((x, y) => Math.abs(x.getBoundingClientRect().top - lr0.top) - Math.abs(y.getBoundingClientRect().top - lr0.top))[0]; if (!ctl) return { noCtl: true };
      const sr = sc && sc.getBoundingClientRect(), lr = lab.getBoundingClientRect();
      const a = lab.getBoundingClientRect(), b = ctl.getBoundingClientRect(), dd = d.getBoundingClientRect();
      return { dy: Math.abs((a.top + a.height / 2) - (b.top + b.height / 2)), inside: b.right <= dd.right + 0.5 && a.left >= dd.left - 0.5, clip: lab.scrollWidth > lab.clientWidth + 1, scrolled: !!sc && sc.scrollTop > 0, inView: !!sr && lr.top >= sr.top && lr.bottom <= sr.bottom };
    });
    check(al && al.dy <= 1 && al.inside && !al.clip && al.inView, w + ' tpo settings: Merge row label and control share one centre, inside the dialog, not clipped', al);
    await sleep(400); await shot(p, w + '-tpo-settings');
    await p.keyboard.press('Escape'); await sleep(500);
    await setI(p, 'stk_of_tpo', { singles: false, mergeMode: 'off' });
    // always visible: scroll so the sessions are off to the left
    await frameOn(p, D21(17, 0) + 3600000, D21(17, 0) + 3600000 * 20);
    const a0 = await ink(p);
    await setI(p, 'stk_of_tpo', { alwaysVisible: true }); const a1 = await ink(p);
    check(a1 > a0 + 50, w + ' tpo always visible: pinned profile drawn after scrolling away (' + a0 + ' -> ' + a1 + ')');
    await shot(p, w + '-tpo-alwaysvisible');
    // ---- SVP merge
    await clearAll(p); await setMarket(p, 'futures:NQ1!', '5'); await frameOn(p, Date.UTC(2026, 9, 20, 0, 0), D21(17, 0));
    await add(p, 'stk_svp', {}); await sleep(2000);
    const sd = await inputs(p, 'stk_svp');
    check(sd.mergeMode === 'off', w + ' svp: merge off by default', sd.mergeMode);
    const s0 = await ink(p);
    await setI(p, 'stk_svp', { mergeMode: 'overlap', mergePct: 30 }); const s1 = await ink(p);
    check(s1 !== s0, w + ' svp merge overlap 30% changes the chart (' + s0 + ' -> ' + s1 + ')');
    await shot(p, w + '-svp-merge');
    await setI(p, 'stk_svp', { mergeMode: 'count', mergeCount: 2 });
    await shot(p, w + '-svp-merge-count2');
    // ---- footprint heavy buy / sell + marker
    await clearAll(p); await setMarket(p, 'futures:NQ1!', '1');
    await p.evaluate(() => window.STRYKER_VELA.active.setPriceStyle('stk_fp')); await sleep(2500);
    const setCfg = (o) => p.evaluate((o) => window.STRYKER_VELA.chart.renderer.renderer.applyConfig({ chartTypes: { stk_fp: o } }), o).then(() => sleep(1500));
    await setCfg({ fpSrc: 'l1', fpStyle: 'classic' });
    await frameOn(p, D21(14, 30), D21(14, 48));
    const c0 = await p.evaluate(() => { const e = window.STRYKER_VELA.chart.orchestrator.typeEngines.get('stk_fp'); return e && e.cfg && e.cfg.heavyMark; });
    check(c0 === false, w + ' footprint: heavy marker off by default', c0);
    // ink() counts painted pixels; heavy colours and dots paint over cells already painted, so compare the pictures instead
    const nudge = () => frameOn(p, D21(14, 30), D21(14, 48) + 1000);
    const pic = async () => { await nudge(); await frameOn(p, D21(14, 30), D21(14, 48)); return p.screenshot({ clip: { x: 60, y: 140, width: w - 160, height: 640 } }); };
    const diff = (x, y) => { let n = 0; for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) n++; return n + Math.abs(x.length - y.length); };
    const g0 = await pic();
    await setCfg({ fpHeavy: 'fixed', fpHeavyFixed: 8,   /* per price level; a cell here groups several levels */ fpHeavyLevel: 'strong' }); const g1 = await pic();
    await setCfg({ fpHeavyMark: true }); const g2 = await pic();
    check(diff(g0, g1) > 0, w + ' footprint: heavy buy / sell colours change the chart');
    if (w >= 1000) check(diff(g1, g2) > 0, w + ' footprint: marker adds dots');
    else console.log('NOTE ' + w + ' footprint: cells under 12 px wide get no dot (heavy colours still show)');
    await shot(p, w + '-fp-heavy-marker');
    check(!errors.length, w + ': no console errors', errors.slice(0, 3));
    check(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), w + ': no horizontal scroll');
    await ctx.close();
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
