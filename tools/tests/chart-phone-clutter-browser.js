// Phone chart clutter (Owner 2026-10-26): NQ1! 3m with Liquidity Master + GEX Levels + Absorption,
// live and bar replay, at 390x844 (phone, touch) and 1440x900, on Vela 0.9.0 and 0.6.17.
// Candles + order flow = REAL recorded NQ order flow (fixtures/orderflow, 20-21 Oct); GEX levels =
// the saved QQQ response shifted next to those candles, GEX history = gex-history-fixture.js
// (synthetic). Test input only, nothing live is called (every non-local request is aborted).
//   node tools/tests/chart-fixture-server.mjs 8197 <any fixture.json> &
//   CHART_BASE=http://127.0.0.1:8197 flock -w 1500 /tmp/stryker-chrome.lock \
//     node --max-old-space-size=768 tools/tests/chart-phone-clutter-browser.js <outDir> [tag]
// Env: PC_ENG=09|06 (default both), PC_W=390|1440 (default both), PC_REPLAY=0 skips replay.
// Writes <outDir>/<tag>-<eng>-<w>-{live,replay}.png and <outDir>/<tag>-metrics.json.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const { session, packed } = require('./gex-history-fixture.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8197';
const OUT = process.argv[2] || '.';
const TAG = process.argv[3] || 'run';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 500))); };
const FIX = path.join(__dirname, 'fixtures');
const BODY = {};
for (const d of ['2026-10-20', '2026-10-21']) BODY[d] = zlib.gunzipSync(fs.readFileSync(path.join(FIX, 'orderflow', 'NQ-' + d + '.bin.gz')));
const NOW = Date.UTC(2026, 9, 21, 17, 0);
let CAND = null;
async function candles(tfMin) {
  if (!CAND) {
    const D = await import(path.resolve(__dirname, '../../assets/chart-footprint-data.js'));
    CAND = { D, bars: [].concat(...Object.values(BODY).map((u) => D.decodeOrderflow(new Uint8Array(u)).bars)) };
  }
  return CAND.D.aggregate(CAND.bars, tfMin * 60000).map((b) => [b.t / 1000, b.o * 0.25, b.hi * 0.25, b.lo * 0.25, b.c * 0.25, b.vol]);
}
// GEX: the saved QQQ response, futures levels moved next to the recorded candles (test input).
async function gexBody() {
  const j = JSON.parse(fs.readFileSync(path.join(FIX, 'gex', 'QQQ-0.json')));
  const c1 = (await candles(1)).filter((x) => x[0] * 1000 < NOW);
  const close = c1[c1.length - 1][4];
  for (const k of ['NQ', 'MNQ']) {
    const f = j.futures[k], d = close - f.futures_price;
    f.basis += d; f.futures_price += d;
    for (const n of Object.keys(f.levels)) f.levels[n] += d;
    const s = j.session[k];
    for (const n of Object.keys(s)) if (typeof s[n] === 'number') s[n] = Math.round((s[n] + d) * 4) / 4;
    // spread the session levels round the last price the way the Owner's shot has them
    s.prior_vah = close + 70; s.overnight_high = close + 40; s.prior_poc = close + 18; s.overnight_low = close - 6; s.prior_val = close - 60;
  }
  return JSON.stringify(j);
}
const DAYS = ['2026-10-16', '2026-10-19', '2026-10-20', '2026-10-21'];
const ALL = (U, d) => DAYS.flatMap((day) => session(U, d, day));

async function open(b, { w, h, mobile, v09 }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(([now]) => {
    try {
      localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_community_disclaimer_ack_v1', '1');
      localStorage.removeItem('vela-workspace'); localStorage.removeItem('vela-workspace-090'); localStorage.removeItem('stryker_bar_replay_v1');
      // the Owner's favourites bar: six tools, parked low on the chart
      localStorage.setItem('stryker_chart_favbar', JSON.stringify({ tools: ['trendline', 'ray', 'hline', 'rectangle', 'horizontalray', 'longposition', 'fib', 'text'], x: 0.2, y: 0.86, visible: true }));
    } catch (e) {}
    const RealDate = Date, off = now - RealDate.now();
    class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + off); } static now() { return RealDate.now() + off; } }
    window.Date = FakeDate;
    window.__stkOfTestTier = { free: false, plan: 'Pro', admin: true };
  }, [NOW]);
  const gex = await gexBody();
  await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1|cdn\.jsdelivr\.net|book-recorder\.)/, (r) => r.abort());
  await ctx.route(/127\.0\.0\.1:\d+\/api\/chart\/bars\//, async (r) => {
    const u = new URL(r.request().url());
    const tf = Number(u.searchParams.get('tf')) || 1, page = Number(u.searchParams.get('page')) || 0;
    const bars = (await candles(tf)).filter((x) => x[0] * 1000 < NOW);
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ s: 'NQ', tf: String(tf), page, bars }) });
  });
  await ctx.route(/127\.0\.0\.1:\d+\/api\/chart\/stream/, (r) => r.abort());
  await ctx.route(/127\.0\.0\.1:\d+\/api\/gex\/levels\//, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: gex }));
  await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\/.*/, (r) => {
    const u = new URL(r.request().url()); const hdr = { 'access-control-allow-origin': '*' };
    if (u.pathname === '/orderflow') {
      const body = u.searchParams.get('sym') === 'NQ' && BODY[u.searchParams.get('day')];
      return body ? r.fulfill({ status: 200, contentType: 'application/octet-stream', headers: hdr, body }) : r.fulfill({ status: 404, headers: hdr, body: '' });
    }
    const U = u.searchParams.get('u'), d = Number(u.searchParams.get('dte'));
    if (u.pathname === '/gex-sessions') return r.fulfill({ status: 200, contentType: 'application/json', headers: hdr, body: JSON.stringify(DAYS.map((day) => { const s = session(U, d, day); return { u: U, d, day, n: s.length, t0: s[0].t, t1: s[s.length - 1].t }; })) });
    if (u.pathname === '/gex-history') { const from = +u.searchParams.get('from'), to = +u.searchParams.get('to'); return r.fulfill({ status: 200, contentType: 'application/json', headers: hdr, body: JSON.stringify(packed(U, d, ALL(U, d).filter((x) => x.t >= from && x.t <= to))) }); }
    return r.fulfill({ status: 404, headers: hdr, body: '' });
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource|\/api\/chart\/stream|firebase|firestore|CORS|WebSocket|econ-calendar/i.test(m.text())) errors.push(m.text().slice(0, 200)); });
  p.on('pageerror', (e) => { if (!/docChanges/.test(String(e))) errors.push(String(e).slice(0, 200)); });
  await p.goto(BASE + '/charts.html?vela=' + (v09 ? '0.9' : '0.6'), { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_VELA.chart && window.STRYKER_PINE && window.__stkBarReplay, null, { timeout: 60000 });
  await sleep(2000);
  return { ctx, p, errors };
}
async function setMarket(p, sym, tf) {
  await p.evaluate(async ([sym, tf]) => {
    const ws = window.STRYKER_VELA;
    ws.active.setSymbol(sym); ws.active.setTimeframe(tf);
    for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 250)); const c = ws.chart; if (c.market.symbol === sym && c.orchestrator.rawBars.length > 50) break; }
  }, [sym, tf]);
  await sleep(1500);
}
async function addLM(p) {
  return p.evaluate(async () => {
    const chart = window.STRYKER_VELA.chart;
    const before = window.STRYKER_PINE.pineHandles(chart).length;
    window.STRYKER_VELA.indicatorPicker.open();
    for (let i = 0; i < 60 && !document.querySelector('.stkiw-row'); i++) await new Promise((r) => setTimeout(r, 300));
    const tab = document.querySelector('.stkiw-tab[data-k="picks"]'); if (tab) tab.click();
    await new Promise((r) => setTimeout(r, 400));
    const row = [...document.querySelectorAll('.stkiw-row')].find((r) => (r.querySelector('.stkiw-nm') || {}).textContent === 'Liquidity Master [TradeZoro]');
    if (!row) return 'no row';
    row.querySelector('.stkiw-name').click();
    for (let i = 0; i < 120 && window.STRYKER_PINE.pineHandles(chart).length <= before; i++) await new Promise((r) => setTimeout(r, 500));
    try { window.STRYKER_VELA.indicatorPicker.close(); } catch (e) {}
    // wait for its tables (the model arrived)
    for (let i = 0; i < 120; i++) {
      const ms = [...chart.renderer.renderer.scene.indicators.values()];
      if (ms.some((m) => (m.tables || []).length)) return 'ok';
      await new Promise((r) => setTimeout(r, 500));
    }
    return 'no tables';
  });
}
const addNative = (p, type, inputs) => p.evaluate(([type, inputs]) => { const r = !!window.STRYKER_VELA.chart.addNativeIndicator(type, { inputs }); window.STRYKER_VELA.context().stateChanged(); return r; }, [type, inputs || {}]);

// Everything the report needs, read in ONE evaluate (same frame as the screenshot that follows).
const metrics = (p) => p.evaluate(() => {
  const R0 = (el) => { if (!el || el.hidden) return null; const r = el.getBoundingClientRect(); if (!r.width || !r.height) return null; const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') return null; return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), b: Math.round(r.bottom), r: Math.round(r.right) }; };
  const inter = (a, b) => !!(a && b && a.x < b.r && b.x < a.r && a.y < b.b && b.y < a.b);
  const cell = document.querySelector('#vela-chart .vela-cell[data-active="1"]') || document.querySelector('#vela-chart .vela-cell');
  const R = window.STRYKER_VELA.chart.renderer.renderer;
  const cv = R.input && R.input.el; const cr = cv.getBoundingClientRect();
  const plot = { x: Math.round(cr.left), y: Math.round(cr.top), w: Math.round(R.coords.width), h: Math.round(cr.height), r: Math.round(cr.left + R.coords.width), b: Math.round(cr.bottom) };
  const fl = R0(cell && cell.querySelector('.stkc-fl'));
  const fav = R0(document.querySelector('.stk-fb'));
  const favToggle = R0(document.querySelector('.stk-fb-fab'));
  const rbar = R0(document.getElementById('stkr-bar'));
  const chip = R0(cell && cell.querySelector('.stk-gex-chip'));
  const dd = R0(cell && cell.querySelector('.stkc-dd'));
  const sl = R0(cell && cell.querySelector('.vela-statusline'));
  const topBar = R0(document.querySelector('.mobile-topnav'));
  const stkcBar = R0(document.getElementById('stkc-bar'));
  const mclock = R0(document.getElementById('mclock'));
  const credit = R0(document.querySelector('.stkchart-credit'));
  const dock = R0(document.getElementById('appnav-dock'));
  // what a tap on the middle of Fit price / Latest / the chip would actually hit
  const hit = (r, sel) => { if (!r) return null; const e = document.elementFromPoint(r.x + r.w / 2, r.y + r.h / 2); return !!(e && e.closest(sel)); };
  const flBtns = cell ? [...cell.querySelectorAll('.stkc-fl button')].map((b) => hit(R0(b), '.stkc-fl')) : [];
  // the chip is pointer-events:none: switch them on for the probe, so elementFromPoint sees it
  const chipEl = cell && cell.querySelector('.stk-gex-chip');
  if (chipEl) chipEl.style.pointerEvents = 'auto';
  const chipVisible = hit(chip, '.stk-gex-chip');
  if (chipEl) chipEl.style.pointerEvents = '';
  // GEX tags vs the Pine text drawn on the price pane (test hooks; null on builds without them)
  let gexTags = null, pineRects = null, absTags = null;
  for (const c of cell.querySelectorAll('canvas')) { if (c.__stkGexTags) gexTags = c.__stkGexTags.map((t) => ({ text: t.text, box: t.box })); if (c.__stkAbsTags) absTags = c.__stkAbsTags; }
  try { pineRects = (window.__stkPineTextRects && window.__stkPineTextRects(window.STRYKER_VELA.chart)) || null; } catch (e) {}
  let tagHits = null;
  if (gexTags && pineRects) {
    const ov = (a, b) => a.x < b.right && b.left < a.x + a.w && a.y < b.bottom && b.top < a.y + a.h;
    tagHits = [];
    for (const t of gexTags) for (const q of pineRects) if (t.box && ov(t.box, q)) tagHits.push(t.text + ' x ' + q.text);
    for (const t of (absTags || [])) for (const q of pineRects.concat((gexTags || []).map((g) => g.box && { left: g.box.x, right: g.box.x + g.box.w, top: g.box.y, bottom: g.box.y + g.box.h, text: g.text }).filter(Boolean))) if (ov(t, q)) tagHits.push(t.text + ' x ' + q.text);
  }
  // DOM overlays (GEX chip, the legend's data dot, the folded drawing button, the legend line) vs
  // EVERYTHING the indicators painted on the price pane: text, table cells and the pane title.
  let domHits = null;
  try {
    const pe = R.plot, pr = pe.getBoundingClientRect();
    const rects = (pe.__stkPineRects || []).filter((q) => q.text !== 'table' || (q.right - q.left) * (q.bottom - q.top) > 0)
      .map((q) => ({ x: q.left + pr.left, y: q.top + pr.top, r: q.right + pr.left, b: q.bottom + pr.top, text: q.text }));
    const els = { chip, dd, fab: favToggle, fav };   // Fit price / Latest are fixed buttons: labels scroll under them
    domHits = [];
    for (const [n, r] of Object.entries(els)) if (r) for (const q of rects) if (r.x < q.r - 1 && q.x + 1 < r.r && r.y < q.b - 1 && q.y + 1 < r.b) domHits.push(n + ' x ' + String(q.text).slice(0, 30));
  } catch (e) { domHits = ['error ' + e]; }
  // table rect of the DOL ABOVE table: top-right of the price pane, read from Vela's last layout is not exposed;
  // use the data dot vs the right 45% of the plot as the "collides with the top-right table" proxy
  return { vw: innerWidth, vh: innerHeight, plot, plotPct: +(plot.h / innerHeight * 100).toFixed(1), fl, fav, favToggle, rbar, chip, chipVisible, flBtns, dd, sl, topBar, stkcBar, mclock, credit, dock,
    favOverFl: inter(fav, fl), favOverPlotBottom: !!(fav && fav.b > plot.b - 40), rbarOverFav: inter(rbar, fav), rbarOverChip: inter(rbar, chip), favOverChip: inter(fav, chip),
    replayOn: !!(window.__stkReplay && window.__stkReplay.on), domHits, gexTags, pineRects: pineRects && pineRects.length, absTags, tagHits };
});

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  const all = {};
  try {
    for (const v09 of (process.env.PC_ENG === '09' ? [true] : process.env.PC_ENG === '06' ? [false] : [true, false])) {
      const eng = v09 ? 'v09' : 'v06';
      for (const [w, h, mobile] of [[390, 844, true], [1440, 900, false]].filter((x) => !process.env.PC_W || String(x[0]) === process.env.PC_W)) {
        const key = eng + '-' + w;
        const { ctx, p, errors } = await open(b, { w, h, mobile, v09 });
        await setMarket(p, 'futures:NQ1!', '3');
        const lm = await addLM(p);
        check(lm === 'ok', key + ': Liquidity Master added and drew its tables', lm);
        check(await addNative(p, 'stk_gex', {}), key + ': GEX Levels added');
        check(await addNative(p, 'stk_of_abs', {}), key + ': Absorption added');
        await sleep(6000);
        await p.evaluate(() => { try { window.STRYKER_VELA.chart.renderer.renderer.scheduler.invalidate(4); } catch (e) {} });
        await sleep(1200);
        const live = await metrics(p);
        await p.screenshot({ path: path.join(OUT, TAG + '-' + key + '-live.png') });
        console.log('SHOT ' + path.join(OUT, TAG + '-' + key + '-live.png'));
        console.log('METRICS ' + key + ' live ' + JSON.stringify(live));
        all[key + '-live'] = live;
        if (mobile) {
          // GEX tags and the GEX chip are kept as before 659 (Owner order 2026-10-26): reported, not failed
          const hard = (live.domHits || ['none']).filter((h) => !/^chip /.test(h));
          check(live.domHits && !hard.length, key + ': live, data dot / pencil / drawing bar clear of indicator text, tables, title', hard);
          console.log('INFO ' + key + ' live: GEX chip/tag overlaps (pre-659 placement, kept) ' + JSON.stringify([(live.domHits || []).filter((h) => /^chip /.test(h)), live.tagHits]).slice(0, 300));
        }
        // Fit price / Latest by real tap / click
        const flB = await p.$$('#vela-chart .vela-cell .stkc-fl button');
        let flOk = flB.length === 2;
        for (const btn of flB) {
          const bb = await btn.boundingBox();
          if (!bb) { flOk = false; continue; }
          const cx = bb.x + bb.width / 2, cy = bb.y + bb.height / 2;
          const onIt = await p.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return !!(e && e.closest('.stkc-fl')); }, [cx, cy]);
          if (!onIt) flOk = false;
          if (mobile) await p.touchscreen.tap(cx, cy); else await p.mouse.click(cx, cy);
          await sleep(500);
        }
        all[key + '-flTappable'] = flOk;
        console.log('INFO ' + key + ' Fit price / Latest reachable by a real tap: ' + flOk);
        if (process.env.PC_REPLAY !== '0') {
          // Replay by real taps: the Replay button, then a bar in the middle of the plot.
          // on a phone the Replay button can sit in ⋯ More (one top bar): open it first, by a real tap
          const rbVis = await p.evaluate(() => { const b = document.querySelector('.stkr-btn'); return !!(b && b.getClientRects().length && b.getBoundingClientRect().width && !b.closest('[hidden]')); });
          if (!rbVis) {
            const mb = await p.$('#stkc-more-btn'); const mbb = mb && await mb.boundingBox();
            if (mbb) { if (mobile) await p.touchscreen.tap(mbb.x + mbb.width / 2, mbb.y + mbb.height / 2); else await p.mouse.click(mbb.x + mbb.width / 2, mbb.y + mbb.height / 2); await sleep(500); }
          }
          const rb = await p.$('.stkr-btn');
          const bb = rb && await rb.boundingBox();
          if (bb) { if (mobile) await p.touchscreen.tap(bb.x + bb.width / 2, bb.y + bb.height / 2); else await p.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2); }
          await sleep(900);
          // the Replay menu: "Select bar" (real tap), then a bar
          const sel = await p.evaluateHandle(() => [...document.querySelectorAll('button, [role=menuitem], .stkr-pop *')].find((e) => /^\s*Select bar/.test(e.textContent || '') && e.getBoundingClientRect().height > 0 && e.getBoundingClientRect().height < 80) || null);
          const sb = sel && sel.asElement() && await sel.asElement().boundingBox();
          if (sb) { if (mobile) await p.touchscreen.tap(sb.x + sb.width / 2, sb.y + sb.height / 2); else await p.mouse.click(sb.x + sb.width / 2, sb.y + sb.height / 2); }
          else console.log('INFO no Select bar row');
          await sleep(900);
          const pl = live.plot;
          const tx = pl.x + pl.w * 0.55, ty = pl.y + pl.h * 0.5;
          if (mobile) await p.touchscreen.tap(tx, ty); else await p.mouse.click(tx, ty);
          await p.waitForFunction(() => window.__stkReplay && window.__stkReplay.on && !window.__stkBarReplay.state.busy, null, { timeout: 30000 }).catch(() => {});
          await sleep(7000);
          const rp = await metrics(p);
          await p.screenshot({ path: path.join(OUT, TAG + '-' + key + '-replay.png') });
          console.log('SHOT ' + path.join(OUT, TAG + '-' + key + '-replay.png'));
          console.log('METRICS ' + key + ' replay ' + JSON.stringify(rp));
          all[key + '-replay'] = rp;
          check(rp.replayOn, key + ': replay entered by real taps');
          if (mobile) {
          // GEX tags and the GEX chip are kept as before 659 (Owner order 2026-10-26): reported, not failed
          const hard = (rp.domHits || ['none']).filter((h) => !/^chip /.test(h));
          check(rp.domHits && !hard.length, key + ': replay, data dot / pencil / drawing bar clear of indicator text, tables, title', hard);
          console.log('INFO ' + key + ' replay: GEX chip/tag overlaps (pre-659 placement, kept) ' + JSON.stringify([(rp.domHits || []).filter((h) => /^chip /.test(h)), rp.tagHits]).slice(0, 300));
        }
          // the drawing toolbar is still reachable in replay (opener button or the bar itself)
          // exit by a real tap on Real-time
          const lb = await p.$('#stkr-bar .stkr-live');
          const lbb = lb && await lb.boundingBox();
          if (lbb) { if (mobile) await p.touchscreen.tap(lbb.x + lbb.width / 2, lbb.y + lbb.height / 2); else await p.mouse.click(lbb.x + lbb.width / 2, lbb.y + lbb.height / 2); }
          await sleep(2500);
          const back = await metrics(p);
          all[key + '-after-exit'] = back;
          check(!back.replayOn, key + ': replay left by a real tap on Real-time');
        }
        check(!errors.length, key + ': no console errors', errors.slice(0, 3));
        await ctx.close();
      }
    }
  } finally { await b.close(); }
  fs.writeFileSync(path.join(OUT, TAG + '-metrics.json'), JSON.stringify(all, null, 1));
  console.log(fail ? fail + ' FAILED' : 'ALL PASSED');
  process.exit(fail ? 1 : 0);
})();
