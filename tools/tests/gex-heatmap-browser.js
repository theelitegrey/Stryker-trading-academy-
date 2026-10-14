// GEX page "Heatmap" tab (assets/gex-heatmap.js + assets/gex-heat-core.js) browser test.
//   node tools/tests/chart-dev-server.mjs 8031     (static site, binds 127.0.0.1)
//   flock /tmp/stryker-chrome.lock env CHART_BASE=http://127.0.0.1:8031 node --max-old-space-size=768 tools/tests/gex-heatmap-browser.js [shotsDir]
// The book-recorder Worker's /gex-history and /gex-sessions are answered from a SYNTHETIC session
// (tools/tests/gex-history-fixture.js: built from the real 2026-10-14 SPX snapshot, the spot path
// and the GEX values are moved by a fixed formula), so the expected numbers are known.
// /api/gex/levels comes from fixtures/gex/*.json. Firebase is stubbed (richstub.js, an Elite
// member); the Free case applies the Free limit the way assets/plan-limits.js does.
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const fs = require('fs');
const path = require('path');
const { session, packed } = require('./gex-history-fixture.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp';
const FIX = path.join(__dirname, 'fixtures', 'gex');
const LV = { SPX: JSON.parse(fs.readFileSync(path.join(FIX, 'SPX-0.json'))), QQQ: JSON.parse(fs.readFileSync(path.join(FIX, 'QQQ-0.json'))) };
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = '2026-10-14', PREV = '2026-10-13';

async function open(b, { w, h, mobile, free }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript((free) => {
    try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); } catch (e) {}
  }, !!free);
  const hits = [];
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net|book-recorder\.)/, (r) => r.abort());
  await ctx.route(/book-recorder\.theelitegrey\.workers\.dev\/gex-(history|sessions)/, (r) => {
    const u = new URL(r.request().url()); hits.push(u.pathname + u.search);
    const U = u.searchParams.get('u'), d = Number(u.searchParams.get('dte'));
    const hdr = { 'access-control-allow-origin': '*' };
    if (u.pathname === '/gex-sessions') {
      const list = U === 'SPX' || U === 'QQQ' ? [DAY, PREV].map((day) => { const s = session(U, d, day); return { u: U, d, day, n: s.length, t0: s[0].t, t1: s[s.length - 1].t }; }) : [];
      return r.fulfill({ status: 200, contentType: 'application/json', headers: hdr, body: JSON.stringify(list) });
    }
    const from = Number(u.searchParams.get('from')), to = Number(u.searchParams.get('to'));
    const rows = [DAY, PREV].flatMap((day) => session(U, d, day)).filter((x) => x.t >= from && x.t <= to).sort((a, b) => a.t - b.t);
    r.fulfill({ status: 200, contentType: 'application/json', headers: hdr, body: JSON.stringify(packed(U, d, rows)) });
  });
  await ctx.route(/\/api\/gex\/(levels|candles)\//, (r) => {
    const u = new URL(r.request().url());
    if (/candles/.test(u.pathname)) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ candles: [] }) });
    const name = u.pathname.split('/').pop().toUpperCase();
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(LV[name] || LV.SPX) });
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|status of 4|status of 5|opt-analytics/.test(m.text())) errors.push(m.text()); });
  await p.goto(BASE + '/gex.html', { waitUntil: 'domcontentloaded' });
  await sleep(4500);
  return { ctx, p, errors, hits };
}
const loaded = (p, n) => p.waitForFunction((n) => { const s = window.strykerGexHeatmap && window.strykerGexHeatmap.state; return s && s.heat && s.rows.length >= n && !document.getElementById('gex-heat-card').hidden; }, n, { timeout: 15000 }).then(() => true, () => false);
// the pixel colour on the heat canvas at a (time, price) inside the plot
const pixelAt = (p, t, price) => p.evaluate(([t, price]) => {
  const st = window.strykerGexHeatmap.state, cv = document.getElementById('gex-heat-canvas'), wrap = document.getElementById('gex-heat-wrap');
  const H = window.StrykerGexHeat, w0 = H.sessionWindow(st.day);
  const pw = wrap.clientWidth - 58, ph = wrap.clientHeight - 22, dpr = cv.width / wrap.clientWidth;
  const x = (t - w0.x0) / (w0.x1 - w0.x0) * pw, y = (st.pHi - price) / (st.pHi - st.pLo) * ph;
  const d = cv.getContext('2d').getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data;
  return { x, y, rgb: [d[0], d[1], d[2]] };
}, [t, price]);

(async () => {
  const b = await launch();
  try {
    const spx = session('SPX', 0, DAY);
    for (const [w, h, mob] of [[1280, 860, false], [390, 844, true]]) {
      const { ctx, p, errors, hits } = await open(b, { w, h, mobile: mob });
      check(await p.evaluate(() => !!document.getElementById('gex-view-tabs') && document.getElementById('gex-heat-card').hidden), w + ': Chart / Heatmap tabs mounted, heatmap hidden at first');
      // pick 0DTE (default page view is 1DTE for a Pro member)
      await p.click('.gex-dte[data-d="0"]');
      await sleep(600);
      await p.click('.gex-vtab[data-view="heat"]');
      check(await loaded(p, spx.length), w + ': SPX 0DTE heatmap loaded ' + spx.length + ' snapshots');
      const info = await p.evaluate(() => {
        const st = window.strykerGexHeatmap.state, cv = document.getElementById('gex-heat-canvas');
        return { day: st.day, days: [...document.querySelectorAll('#gex-heat-day option')].map((o) => o.value), cols: st.heat.cols, rowsN: st.heat.rowsN, ms: Number(cv.dataset.ms),
          chartHidden: document.querySelector('.gex-chart-card').hidden, status: document.getElementById('gex-heat-status').innerText, title: document.getElementById('gex-heat-title').innerText,
          sw: document.documentElement.scrollWidth, edu: document.getElementById('gex-heat-card').innerText.includes('Education only. Not financial advice.'),
          banned: /\b(live|real-time|realtime|delayed)\b/i.test(document.getElementById('gex-heat-card').innerText) };
      });
      check(info.day === DAY && info.days.join() === [DAY, PREV].join(), w + ': day picker lists the recorded days, newest first (' + info.days.join(', ') + ')');
      check(info.cols === 203 && info.rowsN > 100, w + ': base image ' + info.cols + ' 2-min columns x ' + info.rowsN + ' price rows (09:30-16:16 ET)');
      check(info.ms < 8, w + ': full repaint ' + info.ms + ' ms (< 8 ms)');
      check(info.chartHidden && /SPX · 0DTE/.test(info.title), w + ': chart card hidden, title "' + info.title + '"');
      check(/203 snapshots|\d+ snapshots/.test(info.status) && /expiry 2026-10-14/.test(info.status), w + ': status "' + info.status.replace(/\s+/g, ' ') + '"');
      check(info.sw <= w, w + ': no horizontal overflow (' + info.sw + ')');
      check(info.edu && !info.banned, w + ': disclaimer present, no live/real-time/delayed wording');
      // colours: a strongly positive strike is mint, a strongly negative one red/magenta, at a known time
      // (skip the wall strikes: their traces are drawn over the cells)
      const s = spx[100];
      const okK = (i) => Math.abs(s.k[i] - s.cw) > 6 && Math.abs(s.k[i] - s.pw) > 6 && Math.abs(s.k[i] - s.zg) > 6 && Math.abs(s.k[i] - s.s) > 6;
      const all = s.k.map((k, i) => i).filter(okK);
      const iPos = all.reduce((a, i) => (s.g[i] > s.g[a] ? i : a), all[0]), iNeg = all.reduce((a, i) => (s.g[i] < s.g[a] ? i : a), all[0]);
      check(s.g[iPos] > 0 && s.g[iNeg] < 0, w + ': fixture has a positive (' + s.k[iPos] + ') and a negative (' + s.k[iNeg] + ') strike');
      // frame both strikes (the same as zooming out by hand)
      await p.evaluate(([a, b]) => { const st = window.strykerGexHeatmap.state; st.pLo = Math.min(a, b) - 15; st.pHi = Math.max(a, b) + 15; window.strykerGexHeatmap.paint(); }, [s.k[iPos], s.k[iNeg]]);
      const pos = await pixelAt(p, s.t + 60, s.k[iPos]), neg = await pixelAt(p, s.t + 60, s.k[iNeg]);
      const inView = (q) => q.y > 0 && q.y < h;
      if (inView(pos)) check(pos.rgb[1] > pos.rgb[0] + 10 && pos.rgb[2] > pos.rgb[0], w + ': strike ' + s.k[iPos] + ' (+' + s.g[iPos] + ' $M, small next to the day\'s largest) paints the teal/mint ramp rgb(' + pos.rgb + ')');
      if (inView(neg)) check(neg.rgb[0] > neg.rgb[1] + 60, w + ': strike ' + s.k[iNeg] + ' (' + s.g[iNeg] + ' $M) paints red/magenta rgb(' + neg.rgb + ')');
      // hover / tap tooltip: strike, time, value (card scrolled into view first)
      await p.evaluate(() => { const c = document.getElementById('gex-view-tabs'); window.scrollTo(0, c.getBoundingClientRect().top + window.scrollY - (window.innerWidth < 700 ? 64 : 84)); });
      await sleep(400);
      const tgt = await p.evaluate(([t, k]) => {
        const st = window.strykerGexHeatmap.state, wrap = document.getElementById('gex-heat-wrap'), r = wrap.getBoundingClientRect(), H = window.StrykerGexHeat, w0 = H.sessionWindow(st.day);
        return { x: r.left + (t - w0.x0) / (w0.x1 - w0.x0) * (wrap.clientWidth - 58), y: r.top + (st.pHi - k) / (st.pHi - st.pLo) * (wrap.clientHeight - 22) };
      }, [s.t + 60, s.k[iPos]]);
      if (mob) await p.touchscreen.tap(tgt.x, tgt.y); else await p.mouse.move(tgt.x, tgt.y);
      await sleep(300);
      const tip = await p.evaluate(() => { const t = document.getElementById('gex-heat-tip'); return t.hidden ? '' : t.innerText; });
      const clock = new Date(s.t * 1000).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
      check(tip.includes(s.k[iPos].toLocaleString('en-US')) && tip.includes(clock) && /Net GEX \+\$/.test(tip) && tip.includes(String(Math.round(s.g[iPos]))), w + ': ' + (mob ? 'tap' : 'hover') + ' tooltip "' + tip.replace(/\s+/g, ' ') + '"');
      const shotPath = path.join(OUT, 'gex-heatmap-' + w + '.png');
      await p.screenshot({ path: shotPath });
      console.log('shot', shotPath);
      // zoom (+) narrows the price range; day picker loads the previous day
      const span0 = await p.evaluate(() => { const s = window.strykerGexHeatmap.state; return s.pHi - s.pLo; });
      await p.click('#gex-heat-in'); await sleep(200);
      const span1 = await p.evaluate(() => { const s = window.strykerGexHeatmap.state; return s.pHi - s.pLo; });
      check(span1 < span0 * 0.8, w + ': + zooms the price axis (' + span0.toFixed(1) + ' -> ' + span1.toFixed(1) + ')');
      if (mob) {
        // pinch out on the heatmap zooms in
        const cdp = await ctx.newCDPSession(p);
        const r = await p.evaluate(() => { const b = document.getElementById('gex-heat-wrap').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
        const tp = (y1, y2) => [{ x: r.x - 20, y: y1, id: 1 }, { x: r.x + 20, y: y2, id: 2 }];
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: tp(r.y - 40, r.y + 40) });
        for (let i = 1; i <= 5; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: tp(r.y - 40 - i * 20, r.y + 40 + i * 20) });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await sleep(200);
        const span2 = await p.evaluate(() => { const s = window.strykerGexHeatmap.state; return s.pHi - s.pLo; });
        check(span2 < span1 * 0.6, '390: pinch-out zooms the price axis (' + span1.toFixed(1) + ' -> ' + span2.toFixed(1) + ')');
      }
      await p.selectOption('#gex-heat-day', PREV);
      await sleep(800);
      const prev = await p.evaluate(() => { const s = window.strykerGexHeatmap.state; return { day: s.day, n: s.rows.length, first: s.rows[0] && s.rows[0].day }; });
      check(prev.day === PREV && prev.n === session('SPX', 0, PREV).length && prev.first === PREV, w + ': day picker loads ' + PREV + ' (' + prev.n + ' snapshots)');
      check(hits.every((x) => /u=SPX&dte=0/.test(x)), w + ': only SPX 0DTE history requested (' + hits.length + ' requests)');
      // switching to QQQ 1DTE follows the page selection
      await p.click('.gex-tab[data-m="QQQ"]'); await sleep(300); await p.click('.gex-dte[data-d="1"]');
      check(await p.waitForFunction(() => { const s = window.strykerGexHeatmap.state; return s.u === 'QQQ' && s.dte === 1 && s.heat; }, null, { timeout: 8000 }).then(() => true, () => false), w + ': heatmap follows the page selection to QQQ 1DTE');
      await p.click('.gex-dte[data-d="7"]'); await sleep(500);
      const wk = await p.evaluate(() => document.getElementById('gex-heat-empty').innerText);
      check(/0DTE and 1DTE/.test(wk), w + ': 1W view explains history is 0DTE/1DTE only');
      check(!errors.length, w + ': no page errors ' + errors.join(' | '));
      await ctx.close();
    }
    // ---- Free member: SPX 0DTE allowed, QQQ locked ----
    const f = await open(b, { w: 390, h: 844, mobile: true, free: true });
    // what assets/plan-limits.js applyGex() does for a Free member
    await f.p.evaluate(() => window.strykerGexSetLimit({ markets: ['SPX'], dtes: [0], noLadder: true }));
    await sleep(800);
    await f.p.click('.gex-vtab[data-view="heat"]');
    check(await loaded(f.p, spx.length), 'Free 390: SPX 0DTE heatmap shows (free)');
    await f.p.click('.gex-tab[data-m="QQQ"]'); await sleep(600);
    const fr = await f.p.evaluate(() => ({ u: window.strykerGexHeatmap.state.u, lock: !!document.querySelector('.plan-lock') }));
    check(fr.u === 'SPX' && fr.lock, 'Free 390: QQQ tap shows the Pro lock, heatmap stays on SPX');
    check(f.hits.every((x) => /u=SPX&dte=0/.test(x)), 'Free: only SPX 0DTE history requested (' + f.hits.join(',') + ')');
    await f.p.evaluate(() => { const c = document.getElementById('gex-heat-card'); window.scrollTo(0, c.getBoundingClientRect().top + window.scrollY - 220); });
    await sleep(300);
    await f.p.screenshot({ path: path.join(OUT, 'gex-heatmap-390-free.png') });
    console.log('shot', path.join(OUT, 'gex-heatmap-390-free.png'));
    check(!f.errors.length, 'Free: no page errors ' + f.errors.join(' | '));
    await f.ctx.close();
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
