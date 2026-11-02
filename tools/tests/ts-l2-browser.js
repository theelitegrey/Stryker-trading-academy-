// Futures L2 (assets/chart-futures-l2.js) browser test with FIXTURE frames, no Worker and no key.
//   node tools/tests/chart-dev-server.mjs 8031
//   CHART_BASE=http://127.0.0.1:8031 flock /tmp/stryker-chrome.lock node tools/tests/ts-l2-browser.js <shotsDir>
// A fake WebSocket answers /ts-live with snap / coarse / ticks frames in the Worker's own shapes (ts-hub.js header).
// Checks: NON-admin (no test flag): no L2 indicator in the picker list, no socket opened, no ladder button;
// admin (localhost test flag): heatmap, walls (PULLED / CONSUMED tags), imbalance pane and DOM ladder render at 1440 and 390,
// dark + light; touch on the 390 sheet (open, level switch, close); no console errors; no "real-time"/"live" copy except "Live L2".
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
// SYM=CL|GC|... runs the same suite on another root (price scale from the CFG table); default NQ.
const SYM = process.env.SYM || 'NQ';
const CFG = { NQ: { tk: 0.25, step: 2.5, mid: 28750 }, MNQ: { tk: 0.25, step: 2.5, mid: 28750 }, YM: { tk: 1, step: 2, mid: 45000 }, RTY: { tk: 0.1, step: 0.2, mid: 2300 }, CL: { tk: 0.01, step: 0.01, mid: 60.5 }, GC: { tk: 0.1, step: 0.2, mid: 4012.3 } }[SYM];
const OUT = process.argv[2] || '/tmp';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 300) : '')); };

function fakeWs([admin, SYM, C]) {
  window.__wsOpened = 0; window.__L2MID = C.mid;
  if (admin) window.__stkL2Test = { base: 'http://127.0.0.1:9' };
  const Real = window.WebSocket;
  window.WebSocket = function (url, proto) {
    if (!/\/ts-live/.test(String(url))) return new Real(url, proto);
    window.__wsOpened++;
    const ws = { readyState: 0, send() {}, close() { this.readyState = 3; clearInterval(this.iv); this.onclose && this.onclose({ code: 1000 }); } };
    const T0 = Date.now(); let n = 0;
    window.__l2ws = ws;
    setTimeout(() => {
      ws.readyState = 1; ws.onopen && ws.onopen(); ws.onmessage && ws.onmessage({ data: JSON.stringify({ event: 'status', state: 'live' }) });
      // the hub's last 15 min of 1m candles (what the 10-min-delayed lane has not delivered yet)
      const m0 = Math.floor(Date.now() / 60000) * 60000, mid0 = window.__L2MID || 21000, b = [];
      for (let k = 15; k >= 0; k--) { const o = mid0 + Math.sin(k) * 4 * C.step / 2.5; b.push([m0 - k * 60000, o, o + 6 * C.step / 2.5, o - 5 * C.step / 2.5, o + 2 * C.step / 2.5, 300 + k]); }
      ws.onmessage({ data: JSON.stringify({ type: 'bars', symbol: SYM, b }) });
    }, 50);
    ws.iv = setInterval(() => {
      if (ws.readyState !== 1 || !ws.onmessage) return;
      n++;
      const mid = Math.round((window.__L2MID || 21000) / C.tk) * C.tk + Math.sin(n / 9) * 3 * C.step / 2.5, now = Date.now();
      const step = C.step, i0 = Math.floor(mid * 0.996 / step), len = Math.ceil(mid * 0.008 / step) + 2;
      const v = new Array(len).fill(0);
      for (let k = 0; k < len; k++) {
        const p = (i0 + k + 0.5) * step, d = Math.abs(p - mid);
        let q = 30 + 25 * Math.abs(Math.sin(k * 1.7 + n / 40)) + Math.max(0, 200 - d * 4 * 2.5 / C.step);
        if (Math.abs(d - 14 * C.step / 2.5) < 1.1 * C.step / 2.5) q += 900;                       // standing wall each side
        if (p > mid && Math.abs(d - 40 * C.step / 2.5) < 1.1 * C.step / 2.5 && n < 90) q += 700;  // a wall that is pulled at n=90
        v[k] = p < mid ? Math.round(q) : -Math.round(q);
      }
      const bid = Math.floor(mid / C.tk) * C.tk, ask = bid + C.tk, bids = [], asks = [];
      for (let j = 0; j < 150; j++) { bids.push([bid - j * C.tk, Math.round(5 + 40 * Math.abs(Math.sin(j / 3 + n / 20)) + (j === 40 ? 500 : 0))]); asks.push([ask + j * C.tk, Math.round(5 + 40 * Math.abs(Math.cos(j / 3 + n / 25)) + (j === 52 ? 450 : 0))]); }
      const send = (o) => ws.onmessage({ data: JSON.stringify(o) });
      send({ type: 'snap', symbol: SYM, ts: now, bids, asks, imb: Math.sin(n / 30) * 0.6, imb10: Math.sin(n / 30 + 0.7) * 0.45 });
      send({ type: 'coarse', symbol: SYM, ts: now, mid, bb: bid, ba: ask, step, i0, v });
      send({ type: 'ticks', symbol: SYM, t: [[bid, 1 + (n % 7), -1, now], [ask, 2 + (n % 5), 1, now], [ask + 2 * C.tk, 3, 1, now]] });
    }, 100);
    return ws;
  };
  window.WebSocket.OPEN = 1; window.WebSocket.CONNECTING = 0;
}
async function open(b, { w, h, mobile, admin, theme }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(fakeWs, [!!admin, SYM, CFG]);
  await ctx.addInitScript((t) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker.vela.session', ''); if (t) localStorage.setItem('stryker_theme', t === 'light' ? 'day' : 'night'); } catch (e) {} }, theme || '');
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  await ctx.route(/127\.0\.0\.1:9\/ts-book-history/, async (r) => {
    // the Worker's archive-backed history: one sample per 2 min over the asked range, thin rows everywhere, a few walls
    const { encodeSamples } = await import('../../workers/book-recorder/src/bucket.js');
    const u = new URL(r.request().url()), from = Number(u.searchParams.get('from')), to = Number(u.searchParams.get('to')), out = [];
    let mid0 = 21000; try { mid0 = (await ctx.pages()[0].evaluate(() => window.__L2MID)) || mid0; } catch (e) {}
    for (let t = Math.ceil(from / 120000) * 120000; t < to; t += 120000) {
      const mid = mid0 + Math.sin(t / 900000) * 20 * CFG.step / 2.5, step = CFG.step, i0 = Math.floor(mid * 0.996 / step), len = Math.ceil(mid * 0.008 / step) + 2, v = new Float32Array(len);
      for (let k = 0; k < len; k++) { const p = (i0 + k + 0.5) * step, d = Math.abs(p - mid); let q = 2 + 14 * Math.abs(Math.sin(k * 2.3 + t / 3e5)) + Math.max(0, 40 - d); if (Math.abs(d - 30 - 10 * Math.sin(t / 2e6)) < 2) q += 400; v[k] = p < mid ? q : -q; }
      out.push({ ts: t, mid, bb: mid - 0.25, ba: mid + 0.25, step, i0, v });
    }
    r.fulfill({ status: 200, contentType: 'application/octet-stream', headers: { 'access-control-allow-origin': '*', 'x-ts-fill-left': '0', 'access-control-expose-headers': 'x-ts-fill-left' }, body: Buffer.from(encodeSamples(out)) });
  });
  await ctx.route(/127\.0\.0\.1:9\/(?!ts-book-history)/, (r) => r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' }));
  const p = await ctx.newPage();
  if (process.env.DBG) { p.on('request', (q) => { if (/127\.0\.0\.1:9/.test(q.url())) console.log('REQ', q.url().slice(0, 120)); }); p.on('console', (m) => { if (/L2|history|bad body/i.test(m.text())) console.log('CON', m.text().slice(0, 200)); }); }
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|status of 4|status of 5|\/api\/chart\/stream|Failed to load resource|Ping received after close/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart, null, { timeout: 60000 });
  await sleep(2000);
  return { ctx, p, errors };
}
const chartOf = (p) => p.evaluate(() => window.STRYKER_VELA.context().cells[0].chart.market.symbol);
async function setNQ(p) {
  await p.evaluate(async (S) => {
    const ws = window.STRYKER_VELA; ws.active.setSymbol('futures:' + S + '1!'); ws.active.setTimeframe('1');
    for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 300)); const c = ws.chart; if (c.market.symbol === 'futures:' + S + '1!' && c.orchestrator.rawBars.length > 50) break; }
    const rb = ws.chart.orchestrator.rawBars; const last = rb[rb.length - 1], px = last && (last.close != null ? last.close : last.c);
    if (px > 0) window.__L2MID = px;   // follow the stub's candles when on the same scale
  }, SYM);
  await sleep(800);
}
const add = (p, type, inputs) => p.evaluate(([t, i]) => { const c = window.STRYKER_VELA.context().cells[0].chart; c.addNativeIndicator(t, { inputs: i || {} }); window.STRYKER_VELA.context().stateChanged(); }, [type, inputs]);
const pickerHas = (p) => p.evaluate(() => { const t = document.body.innerText; return /Futures DOM Heatmap \(L2\)|Liquidity Walls \(L2\)|Book Imbalance \(L2\)/.test(t); });
const canv = (p) => p.evaluate(() => { let best = 0; for (const c of document.querySelectorAll('#vela-chart canvas')) { if (!c.width) continue; const g = c.getContext('2d'); if (!g) continue; let d; try { d = g.getImageData(0, 0, c.width, c.height).data; } catch (e) { continue; } let n = 0; for (let i = 3; i < d.length; i += 64) if (d[i] > 0) n++; best = Math.max(best, n); } return best; });

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    // ---- NON-admin: nothing new, nothing opened
    {
      const { ctx, p, errors } = await open(b, { w: 1440, h: 900, admin: false });
      await setNQ(p);
      // try to add anyway: the registry must not list it
      const listed = await p.evaluate(() => { try { const c = window.STRYKER_VELA.context().cells[0].chart; return (c.nativeCatalog ? c.nativeCatalog() : []).map((x) => x.type || x.id).filter((t) => /^stk_fut_/.test(t)); } catch (e) { return ['err']; } });
      const ladderBtn = await p.evaluate(() => { const b = document.querySelector('.stkl2-railbtn'); return !b || b.hidden || getComputedStyle(b).display === 'none'; });
      await sleep(1500);
      check(listed.length === 0, 'non-admin: no L2 indicator in the catalog', listed);
      check(ladderBtn, 'non-admin: DOM ladder button hidden');
      check(await p.evaluate(() => window.__wsOpened) === 0, 'non-admin: no /ts-live socket opened');
      check(!(await p.evaluate(() => !!document.getElementById('stkl2-badge'))), 'non-admin: no Live L2 badge');
      check(errors.length === 0, 'non-admin: no console errors', errors);
      await p.screenshot({ path: OUT + '/l2-nonadmin-1440.png' });
      await ctx.close();
    }
    // ---- admin: 1440 dark + light, then 390 dark + light
    for (const [w, h, mobile, theme, tag] of (process.env.ONE === "m" ? [[390, 844, true, "dark", "390-dark"]] : process.env.ONE ? [[1440, 900, false, "dark", "1440-dark"]] : [[1440, 900, false, "dark", "1440-dark"], [1440, 900, false, "light", "1440-light"], [390, 844, true, "dark", "390-dark"], [390, 844, true, "light", "390-light"]])) {
      const { ctx, p, errors } = await open(b, { w, h, mobile, admin: true, theme });
      await setNQ(p);
      await add(p, 'stk_fut_dom', { style: process.env.DOMSTYLE || 'Combined (heatmap + depth + walls)' });
      await add(p, 'stk_fut_imb');
      await sleep(9000);   // ~90 fake coarse columns
      // heatmap fills the visible window from the left edge (backfill), and no empty band inside the book's price range
      const hm = await p.evaluate(() => { const d = window.__stkFlow && window.__stkFlow.domDebug && window.__stkFlow.domDebug(); return d || null; });
      if (process.env.DBG) console.log('HM', JSON.stringify(hm && { rs: hm.remoteSamples, st: hm.remoteState, s: hm.samples, cols: hm.columns, vis: hm.visFrom, cells: hm.cells }));
      if (hm) { check(hm.remoteSamples > 20, tag + ': history backfill samples loaded (' + hm.remoteSamples + ')'); check(hm.heatX0 != null && hm.heatX0 <= 60, tag + ': heatmap starts at the left edge of the screen', hm.heatX0); }
      const nSock = await p.evaluate(() => window.__wsOpened);
      // candles: the hub's ticks + 1m bars carry the chart past the 10-min delayed bars; no gap, no duplicate; pill hidden; back on drop
      const cd = await p.evaluate(() => { const rb = window.STRYKER_VELA.chart.orchestrator.rawBars.map((x) => x.time); return { n: rb.length, last: rb[rb.length - 1], tail: rb.slice(-16), now: Date.now() }; });
      const minNow = Math.floor(cd.now / 60000) * 60000;
      check(cd.last >= minNow - 60000, tag + ': newest candle is the current minute (not 10 min behind)', { lag: Math.round((cd.now - cd.last) / 60000) });
      check(cd.tail.every((t, i, a) => i === 0 || (a[i] > a[i - 1] && (a[i] - a[i - 1]) % 60000 === 0)), tag + ': candles strictly increasing, whole minutes (no duplicate bar)', cd.tail.slice(-5));
      check(cd.tail.every((t, i, a) => i === 0 || a[i] - a[i - 1] === 60000) || process.env.CME_CLOSED, tag + ': no gap in the last 15 candles', cd.tail.slice(-5));
      check(await p.evaluate(() => { const pl = document.getElementById('stkdp'); return !pl || pl.hidden || getComputedStyle(pl).display === 'none'; }), tag + ': delayed pill hidden while Live L2 feeds the chart');
      await p.evaluate(() => window.__l2ws.close());
      await sleep(700);
      check(await p.evaluate((S) => !(window.__stkL2Live && window.__stkL2Live.has(S)), SYM), tag + ': L2 drop releases the candle feed');
      check(await p.evaluate(() => { const pl = document.getElementById('stkdp'); return !!pl && !pl.hidden; }), tag + ': delayed pill is back after the drop');
      await sleep(4000);   // the hook reconnects on its own backoff
      const n = nSock;
      check(n === 1, tag + ': ONE browser socket shared by dom + imbalance (+ ladder)', n);
      check((await canv(p)) > 300, tag + ': heatmap / depth pixels drawn', await canv(p));
      check(await p.evaluate(() => { const b = document.getElementById('stkl2-badge'); return !!b && !b.hidden && /Live L2/.test(b.textContent) && !!b.querySelector('.stkl2-dot'); }), tag + ': "Live L2" badge with the dot');
      const txt = await p.evaluate(() => document.body.innerText);
      check(!/real-?time/i.test(txt), tag + ': no "real-time" wording');
      await p.screenshot({ path: OUT + '/l2-' + tag + '-heatmap.png' });
      // walls view with PULLED / CONSUMED tags
      await add(p, 'stk_fut_walls');
      await sleep(3000);
      await p.screenshot({ path: OUT + '/l2-' + tag + '-walls.png' });
      // ladder
      if (!mobile) {
        await p.click('.stkl2-railbtn');
      } else {
        // header: the full symbol shows (the L2 button lives in the ⋯ menu, not the bar)
        const hd = await p.evaluate((S) => { const bs = [...document.querySelectorAll('#stkc-bar-l button, #stkc-bar button')].filter((x) => new RegExp('^(' + S + '1!|' + S[0] + ')').test(x.textContent.trim()) && x.offsetWidth); const b = bs[0]; return { txt: b && b.textContent.trim(), clipped: b ? b.scrollWidth > b.clientWidth + 1 || getComputedStyle(b).textOverflow === 'ellipsis' && b.scrollWidth > b.clientWidth : null, w: b && b.offsetWidth }; }, SYM);
        check(hd.clipped === false && new RegExp(SYM + '1!').test(hd.txt || ''), tag + ': header shows "NQ1!" in full', hd);
        await p.evaluate(() => window.__stkL2Ladder.open());
      }
      await sleep(1800);
      if (process.env.DBG) console.log(await p.evaluate(() => { const ws = window.STRYKER_VELA; const sym = ws.active.symbol; let r; try { r = ws.cell(ws.active.id).data.resolve(sym); } catch (e) { r = String(e); } return JSON.stringify([sym, r, document.getElementById('stkl2') && document.getElementById('stkl2').innerText.slice(0, 200)]); }));
      const rows = await p.evaluate(() => document.querySelectorAll('.stkl2-row').length);
      const open_ = await p.evaluate(() => { const a = document.getElementById('stkl2'); return !!a && !a.hidden; });
      check(open_ && rows >= 11, tag + ': DOM ladder open with rows', rows);
      check(await p.evaluate(() => { const r = [...document.querySelectorAll('.stkl2-row')]; const i = r.findIndex((x) => x.classList.contains('is-ask')); const j = r.findIndex((x) => x.classList.contains('is-bid')); return i >= 0 && j === i + 1 && Math.abs(i - r.length / 2) <= 2; }), tag + ': ladder auto-centred, ask row directly above bid row');
      check(await p.evaluate(() => document.querySelectorAll('.stkl2-t u:not(:empty), .stkl2-t s:not(:empty)').length > 0), tag + ': traded-at-price column filled');
      const sheetBox = await p.evaluate(() => { const r = document.getElementById('stkl2').getBoundingClientRect(); return [r.left, r.right, r.top, r.bottom, innerWidth, innerHeight]; });
      check(sheetBox[0] >= -1 && sheetBox[1] <= sheetBox[4] + 1 && sheetBox[3] <= sheetBox[5] + 1, tag + ': ladder inside the viewport', sheetBox);
      check(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), tag + ': no horizontal overflow');
      await p.screenshot({ path: OUT + '/l2-' + tag + '-ladder.png' });
      if (mobile) {
        // touch: level switch 150, then close with the round x (44 px target)
        const lvBox = await p.evaluate(() => { const b = document.querySelector('.stkl2-lv[data-n="150"]').getBoundingClientRect(); const c = document.querySelector('.stkl2-close').getBoundingClientRect(); return [b.width, b.height, c.width, c.height]; });
        check(lvBox[1] >= 36 && lvBox[2] >= 44 && lvBox[3] >= 44, tag + ': touch targets >= 36 / 44 px', lvBox);
        await p.tap('.stkl2-lv[data-n="150"]');
        await sleep(400);
        check(await p.evaluate(() => document.querySelector('.stkl2-lv[data-n="150"]').classList.contains('on')), tag + ': tap switches levels to 150');
        await p.tap('.stkl2-close');
        await sleep(500);
        check(await p.evaluate(() => document.getElementById('stkl2').hidden), tag + ': tap on x closes the sheet');
      }
      check(errors.length === 0, tag + ': no console errors', errors);
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? 'FAILED ' + fail : 'ALL PASSED');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
