// GEX REPLAY browser test: (1) the GEX page heatmap time slider + play, (2) Charts bar replay ->
// GEX Levels + GEX Heatmap show the snapshot as of the replay clock (no lookahead).
//   node tools/tests/chart-dev-server.mjs 8091
//   flock /tmp/stryker-chrome.lock env CHART_BASE=http://127.0.0.1:8091 node --max-old-space-size=768 tools/tests/gex-replay-browser.js [shotsDir]
// GEX history = the SYNTHETIC sessions of gex-history-fixture.js (today + the previous weekday, ET),
// so the replay times line up with the real futures bars of the dev server. NOT market data.
const fs = require('fs');
const path = require('path');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const { session, packed } = require('./gex-history-fixture.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8091';
const OUT = process.argv[2] || '/tmp';
const FIX = path.join(__dirname, 'fixtures', 'gex');
const LV = { SPX: JSON.parse(fs.readFileSync(path.join(FIX, 'SPX-0.json'))), QQQ: JSON.parse(fs.readFileSync(path.join(FIX, 'QQQ-0.json'))) };
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const etDay = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(ms));
const DAY = etDay(Date.now());
const PREV = (() => { let t = Date.parse(DAY + 'T12:00:00Z') - 86400000; while ([0, 6].includes(new Date(t).getUTCDay())) t -= 86400000; return new Date(t).toISOString().slice(0, 10); })();
const ALL = (U, d) => [PREV, DAY].flatMap((day) => session(U, d, day));

async function open(b, { w, h, mobile, page }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.removeItem('stryker_bar_replay_v1'); } catch (e) {} });
  const hits = [];
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net|book-recorder\.)/, (r) => r.abort());
  await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\/gex-(history|sessions)/, (r) => {
    const u = new URL(r.request().url()); hits.push({ path: u.pathname, u: u.searchParams.get('u'), from: +u.searchParams.get('from'), to: +u.searchParams.get('to') });
    const U = u.searchParams.get('u'), d = Number(u.searchParams.get('dte'));
    const hdr = { 'access-control-allow-origin': '*' };
    if (u.pathname === '/gex-sessions') {
      const list = U === 'SPX' || U === 'QQQ' ? [DAY, PREV].map((day) => { const s = session(U, d, day); return { u: U, d, day, n: s.length, t0: s[0].t, t1: s[s.length - 1].t }; }) : [];
      return r.fulfill({ status: 200, contentType: 'application/json', headers: hdr, body: JSON.stringify(list) });
    }
    const from = +u.searchParams.get('from'), to = +u.searchParams.get('to');
    r.fulfill({ status: 200, contentType: 'application/json', headers: hdr, body: JSON.stringify(packed(U, d, ALL(U, d).filter((x) => x.t >= from && x.t <= to))) });
  });
  await ctx.route(/\/api\/gex\/(levels|candles)\//, (r) => {
    const u = new URL(r.request().url());
    if (/candles/.test(u.pathname)) return r.fulfill({ status: 200, contentType: 'application/json', body: '{"candles":[]}' });
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(LV[u.pathname.split('/').pop().toUpperCase()] || LV.SPX) });
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|status of 4|status of 5|WebSocket connection|opt-analytics/.test(m.text())) errors.push(m.text()); });
  await p.goto(BASE + '/' + page, { waitUntil: 'domcontentloaded' });
  return { ctx, p, errors, hits };
}
async function shot(p, name) { await sleep(500); await p.screenshot({ path: OUT + '/' + name }); console.log('SHOT ' + OUT + '/' + name); }

(async () => {
  const b = await launch();
  try {
    // ================= (1) GEX page: slider + play =================
    for (const [w, h, mobile] of [[1280, 900, false], [390, 844, true]]) {
      const { ctx, p, errors } = await open(b, { w, h, mobile, page: 'gex.html' });
      await sleep(4500);
      await p.click('.gex-dte[data-d="0"]').catch(() => {});
      await p.click('.gex-vtab[data-view="heat"]');
      await p.waitForFunction(() => { const s = window.strykerGexHeatmap.state; return s.heat && s.rows.length > 100; }, null, { timeout: 20000 });
      const rows = session('SPX', 0, DAY);
      // jump the slider to snapshot 60
      await p.evaluate(() => { const sl = document.getElementById('gex-heat-slider'); sl.value = '60'; sl.dispatchEvent(new Event('input', { bubbles: true })); });
      await sleep(300);
      let r = await p.evaluate(() => { const s = window.strykerGexHeatmap.state, c = window.strykerGexHeatmap.current(); return { until: s.until, t: c && c.t, s: c && c.s, zg: c && c.zg, read: document.getElementById('gex-heat-read').innerText, time: document.getElementById('gex-heat-time').innerText, max: document.getElementById('gex-heat-slider').max }; });
      check(r.until === rows[60].t && r.t === rows[60].t, w + ': slider 60 -> snapshot ' + rows[60].t + ' (' + r.time + ')');
      check(+r.max === rows.length - 1, w + ': slider covers the ' + rows.length + ' snapshots of the day');
      check(r.read.includes(rows[60].s.toLocaleString('en-US', { minimumFractionDigits: 2 })) && /Call wall/i.test(r.read) && /Zero gamma/i.test(r.read), w + ': levels readout shows that moment (' + r.read.replace(/\n/g, ' ') + ')');
      // no lookahead: the heat image holds nothing after the slider
      const look = await p.evaluate((later) => { const s = window.strykerGexHeatmap.state, H = window.StrykerGexHeat; return later.map((t) => { const c = H.cellAt(s.heat, t + 5, s.rows[0].k[10]); return c ? c.snap.t : null; }); }, [rows[80].t, rows[150].t]);
      check(look.every((t) => t === null || t <= rows[60].t), w + ': cells after the slider time are empty (no lookahead): ' + JSON.stringify(look));
      await p.evaluate(() => { const c = document.getElementById('gex-heat-card'); window.scrollTo(0, c.getBoundingClientRect().top + window.scrollY - (window.innerWidth < 700 ? 60 : 80)); });
      await shot(p, 'gex-replay-slider-' + w + '.png');
      // play: steps forward on its own
      await p.click('#gex-heat-play');
      await sleep(1600);
      r = await p.evaluate(() => ({ playing: window.strykerGexHeatmap.state.playing, until: window.strykerGexHeatmap.state.until, btn: document.getElementById('gex-heat-play').textContent }));
      check(r.playing && r.until > rows[60].t && r.btn === '❚❚', w + ': ▶ plays forward (now at ' + r.until + ', button ' + r.btn + ')');
      await p.click('#gex-heat-play');
      const u1 = await p.evaluate(() => window.strykerGexHeatmap.state.until); await sleep(800);
      const u2 = await p.evaluate(() => window.strykerGexHeatmap.state.until);
      check(u1 === u2 && !(await p.evaluate(() => window.strykerGexHeatmap.state.playing)), w + ': pause stops it');
      const ms = await p.evaluate(() => { window.strykerGexHeatmap.paint(); return +document.getElementById('gex-heat-canvas').dataset.ms; });
      check(ms < 8, w + ': repaint with the profile ' + ms + ' ms (< 8 ms)');
      check(!errors.length, w + ': no page errors (' + errors.slice(0, 2).join(' | ') + ')');
      await ctx.close();
    }

    // ================= (2) Charts bar replay sync =================
    const { ctx, p, errors, hits } = await open(b, { w: 1440, h: 900, page: 'charts.html' });
    await p.waitForFunction(() => window.STRYKER_VELA && window.__stkBarReplay, null, { timeout: 45000 });
    await sleep(3000);
    for (const [sym, api, fut] of [['futures:NQ1!', 'QQQ', 'NQ'], ['futures:ES1!', 'SPX', 'ES']]) {
      await p.evaluate((s) => { const ws = window.STRYKER_VELA; const c = ws.cell(ws.context().cells[0].id); c.setSymbol(s); c.setTimeframe('5'); }, sym);
      await sleep(5000);
      await p.evaluate(() => { const c = window.STRYKER_VELA.context().cells[0].chart; c.indicators().filter((h) => /^stk_gex/.test(h.nativeType || '')).forEach((h) => { try { c.removeIndicator(h.id); } catch (e) { try { h.remove(); } catch (e2) {} } }); c.addNativeIndicator('stk_gex', { inputs: {} }); c.addNativeIndicator('stk_gexheat', { inputs: {} }); });
      await sleep(3000);
      const rows = ALL(api, 0);
      const prev = session(api, 0, PREV);
      // replay at the previous session, 11:00 ET + 1 s past snapshot 45
      const E = (prev[45].t + 1) * 1000;
      hits.length = 0;   // only requests made while replaying count below
      await p.evaluate(async (E) => { await window.__stkBarReplay.setStepTf('5'); await window.__stkBarReplay.start(E); }, E);
      await p.waitForFunction(() => window.__stkBarReplay.state.on && !window.__stkBarReplay.state.busy, null, { timeout: 30000 });
      await sleep(4000);
      const st = await p.evaluate(() => {
        const c = window.STRYKER_VELA.context().cells[0].chart, seen = new Set();
        const find = (o, d, key) => { if (!o || typeof o !== 'object' || d > 4 || seen.has(o)) return null; seen.add(o); if (o.nativeData instanceof Map && o.nativeData.has(key)) return o.nativeData.get(key); for (const k of Object.keys(o)) { try { const r = find(o[k], d + 1, key); if (r) return r; } catch (e) {} } return null; };
        const lv = find(c, 0, 'stk_gex'); seen.clear();
        let hf = null; for (const cv of document.querySelectorAll('canvas')) if (cv.__stkGexHeat) hf = cv.__stkGexHeat;
        const T = window.__stkGexHeat; const h = T ? [...T.heats.values()].pop() : null;
        return { E: window.__stkReplay.E, lv: lv && JSON.parse(JSON.stringify(lv)), heat: hf, maxT: h ? h.rows[h.rows.length - 1].t : null, nRows: h ? h.rows.length : 0 };
      });
      const want = prev[45];
      check(st.lv && st.lv.snapT === want.t && /bar replay/.test(st.lv.status), sym + ' replay: GEX Levels = snapshot ' + want.t + ' as of the replay clock (' + (st.lv && (st.lv.status || st.lv.note)) + ')');
      const zg = st.lv && st.lv.lines && st.lv.lines.find((l) => l.id === 'zero');
      check(!!zg, sym + ' replay: zero gamma line drawn (' + (zg && zg.text) + ')');
      check(st.maxT != null && st.maxT <= Math.floor(st.E / 1000), sym + ' replay: heatmap uses no snapshot after the clock (newest ' + st.maxT + ' <= ' + Math.floor(st.E / 1000) + ', ' + st.nRows + ' rows)');
      check(st.heat && st.heat.cols > 0 && /as of replay time/.test(st.heat.text), sym + ' replay: heat painted, "' + (st.heat && st.heat.text) + '"');
      // prefetch blocks may end up to 6 h past the clock (never shown: frames stop at the clock)
      const far = hits.filter((x) => x.path === '/gex-history' && x.to > Math.floor(st.E / 1000) + 6 * 3600 + 60);
      check(!far.length, sym + ' replay: history requests end within 6 h of the clock (' + hits.filter((x) => x.path === '/gex-history').map((x) => ((x.to - Math.floor(st.E / 1000)) / 3600).toFixed(1) + 'h').join(',') + ')');
      if (fut === 'NQ') await shot(p, 'gex-replay-chart-nq-1440.png');
      // step forward: passes the next snapshots
      for (let i = 0; i < 3; i++) await p.evaluate(() => window.__stkBarReplay.stepForward());
      await sleep(2500);
      const st2 = await p.evaluate(() => { const c = window.STRYKER_VELA.context().cells[0].chart, seen = new Set(); const find = (o, d) => { if (!o || typeof o !== 'object' || d > 4 || seen.has(o)) return null; seen.add(o); if (o.nativeData instanceof Map && o.nativeData.has('stk_gex')) return o.nativeData.get('stk_gex'); for (const k of Object.keys(o)) { try { const r = find(o[k], d + 1); if (r) return r; } catch (e) {} } return null; }; const lv = find(c, 0); return { E: window.__stkReplay.E, snapT: lv && lv.snapT }; });
      const exp = prev.filter((r) => r.t <= Math.floor(st2.E / 1000)).pop();
      check(st2.snapT === exp.t && st2.snapT > want.t, sym + ' replay step: levels follow the clock (snapshot ' + st2.snapT + ', want ' + exp.t + ')');
      // before the history begins
      await p.evaluate(async (E) => { await window.__stkBarReplay.start(E); }, (prev[0].t - 3 * 3600) * 1000);
      await p.waitForFunction(() => window.__stkBarReplay.state.on && !window.__stkBarReplay.state.busy, null, { timeout: 30000 });
      await sleep(3500);
      const st3 = await p.evaluate(() => { let hf = null; for (const cv of document.querySelectorAll('canvas')) if (cv.__stkGexHeat) hf = cv.__stkGexHeat; const chip = document.querySelector('.stk-gex-chip'); return { heat: hf && hf.text, chip: chip && !chip.hidden ? chip.textContent : null }; });
      check(/No GEX history for this time/.test(st3.chip || '') && /No GEX history for this time/.test(st3.heat || ''), sym + ' replay before the history: "' + st3.chip + '" / "' + st3.heat + '"');
      if (fut === 'NQ') await shot(p, 'gex-replay-chart-nohist-1440.png');
      await p.evaluate(() => window.__stkBarReplay.exit()); await sleep(3000);
      const st4 = await p.evaluate(() => { let hf = null; for (const cv of document.querySelectorAll('canvas')) if (cv.__stkGexHeat) hf = cv.__stkGexHeat; return hf && hf.text; });
      check(!/replay|No GEX history/.test(st4 || '') && /updated/.test(st4 || ''), sym + ' exit replay: back to the current history (' + st4 + ')');
    }
    check(!errors.length, 'charts: no page errors (' + errors.slice(0, 3).join(' | ') + ')');
    await ctx.close();
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
