// Footprint history (member Harry 2026-11-12: "Footprint not loading, I want historical data"; MNQ1! 5m footprint began at 14:03 on a
// page opened at 17:19 = the 3 h /ts-aux seed only). FIXTURE data: 5m MNQ bars over 30 h, a fake /ts-live socket, and a fake Worker
// /ts-aux that answers ANY window (one footprint minute per minute, around the bar's price). Checks, 1440 + 390 dark, Volume footprint
// style, Data = L2: every visible bar has footprint, including bars from before the page-open seed (> 3 h back); the "Footprint (L2)
// from" note is gone; scrolling 20 h back loads those bars too (more /ts-aux reads, none past 48 h, no window twice); a Worker that has no
// minutes before some point gives the plain "No footprint recorded before HH:MM" note. No console errors.
//   node tools/tests/chart-dev-server.mjs 8031 &
//   CHART_BASE=http://127.0.0.1:8031 flock /tmp/stryker-chrome.lock node tools/tests/footprint-history-browser.js <shotsDir>
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (!ok && x !== undefined ? ' ' + JSON.stringify(x).slice(0, 500) : '')); };
const H = 3600000, TICK = 0.25, NOW = Date.now(), MIN = Math.floor(NOW / 60000);
const price = (m) => 25650 + Math.sin(m / 170) * 60 + Math.sin(m / 23) * 12;
const q = (p) => Math.round(p / TICK) * TICK;
function bars(tf) {   // [sec, o, h, l, c, v], tf minutes, 30 h back
  const out = [], step = tf;
  for (let m = Math.floor((MIN - 30 * 60) / step) * step; m <= MIN; m += step) { const o = q(price(m)), c = q(price(m + step)); out.push([m * 60, o, Math.max(o, c) + 2, Math.min(o, c) - 2, c, 900 + (m % 11) * 40]); }
  return out;
}
function auxBody(from, to, floor) {   // the hub's recorded footprint minutes: { t (minute), lv: [[price, buy, sell]] }
  const fp = [];
  for (let m = Math.max(Math.floor(from / 60000), Math.ceil(floor / 60000)); m <= Math.min(Math.floor(to / 60000), MIN); m++) {
    const o = q(price(m)), c = q(price(m + 1)), lv = [];
    for (let p = Math.min(o, c) - 1; p <= Math.max(o, c) + 1; p += TICK) lv.push([p, 3 + ((p * 4 + m) % 17), 2 + ((p * 4 + 2 * m) % 13)]);
    fp.push({ t: m, lv });
  }
  return JSON.stringify({ fp, imb: [] });
}
function fakeWs() {
  window.__stkL2Test = { base: 'http://127.0.0.1:9' };
  try { document.documentElement.setAttribute('data-theme', 'dark'); localStorage.setItem('stryker-theme', 'dark'); } catch (e) {}
  const Real = window.WebSocket;
  window.WebSocket = function (url, proto) {
    if (!/\/ts-live/.test(String(url))) return new Real(url, proto);
    const sym = (/symbol=([A-Z]+)/.exec(String(url)) || [])[1] || 'MNQ';
    const ws = { readyState: 0, send() {}, close() { this.readyState = 3; clearInterval(this.iv); this.onclose && this.onclose({ code: 1000 }); } };
    setTimeout(() => { ws.readyState = 1; ws.onopen && ws.onopen(); ws.onmessage({ data: JSON.stringify({ event: 'hub_attached', state: 'live', tier: 'book' }) }); ws.onmessage({ data: JSON.stringify({ event: 'status', state: 'live' }) }); }, 50);
    let n = 0;
    ws.iv = setInterval(() => {
      if (ws.readyState !== 1 || !ws.onmessage) return; n++;
      const now = Date.now(), b = Math.floor((window.__L2MID || 25650) * 4) / 4, bids = [], asks = [];
      for (let i = 0; i < 12; i++) { bids.push([b - i * 0.25, 10 + ((i * 7 + n) % 30)]); asks.push([b + 0.25 + i * 0.25, 10 + ((i * 5 + n) % 30)]); }
      ws.onmessage({ data: JSON.stringify({ type: 'snap', symbol: sym, ts: now, bids, asks, imb: 0, imb10: 0 }) });
      ws.onmessage({ data: JSON.stringify({ type: 'ticks', symbol: sym, t: [[b, 3, -1, now], [b + 0.25, 2, 1, now]] }) });
    }, 250);
    return ws;
  };
  window.WebSocket.OPEN = 1; window.WebSocket.CONNECTING = 0;
}
async function open(b, { w, h, mobile, floor }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 2 : 1, isMobile: !!mobile, hasTouch: !!mobile, colorScheme: 'dark' });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(fakeWs);
  await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker.vela.session', ''); } catch (e) {} });
  const aux = [];
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net)/, (r) => r.abort());
  await ctx.route(/127\.0\.0\.1:\d+\/api\/chart\/bars\//, (r) => { const tf = Number(new URL(r.request().url()).searchParams.get('tf')) || 1; r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ s: 'MNQ', tf: String(tf), page: 0, bars: bars(tf) }) }); });
  await ctx.route(/127\.0\.0\.1:9\//, (r) => {
    const u = new URL(r.request().url());
    if (u.pathname !== '/ts-aux') return r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: '' });
    const from = Number(u.searchParams.get('from')), to = Number(u.searchParams.get('to')); aux.push([from, to]);
    r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: auxBody(from, to, floor || 0) });
  });
  const p = await ctx.newPage(), errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|status of 4|status of 5|451|\/api\/chart\/stream|Failed to load resource|Ping received after close/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart, null, { timeout: 60000 });
  await sleep(1500);
  await p.evaluate(async (mid) => {
    window.__L2MID = mid;
    const ws = window.STRYKER_VELA; ws.active.setSymbol('futures:MNQ1!'); ws.active.setTimeframe('5');
    for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 300)); const c = ws.chart; if (c.market.symbol === 'futures:MNQ1!' && c.orchestrator.rawBars.length > 50) break; }
    ws.active.setPriceStyle('stk_fp');
  }, price(MIN));
  await sleep(4000);
  return { ctx, p, errors, aux };
}
// visible bars, and how many of them the footprint flow has (the layer's own data: the engine's L2 flow map)
const cover = (p) => p.evaluate(() => {
  const c = window.STRYKER_VELA.chart, rb = c.orchestrator.rawBars, e = c.orchestrator.typeEngines.get('stk_fp');
  const vis = c.getVisibleRange ? c.getVisibleRange() : null;
  const from = vis ? vis.from : rb[Math.max(0, rb.length - 60)].time, to = vis ? vis.to : rb[rb.length - 1].time;
  const out = e && e.l2own && e.l2own.out, map = out ? out.map : new Map(), inView = rb.filter((b) => b.time >= from && b.time <= to && b.time < Date.now() - 300000);
  const miss = inView.filter((b) => !map.has(b.time));
  return { inView: inView.length, has: inView.length - miss.length, firstH: inView.length ? +((Date.now() - inView[0].time) / 3600000).toFixed(1) : null, missH: miss.slice(0, 3).map((b) => +((Date.now() - b.time) / 3600000).toFixed(1)), note: out ? out.note : 'no flow', src: e && e.cfg && e.cfg.src };
});
const view = (p, hBack, nBars) => p.evaluate(([hb, n]) => { const c = window.STRYKER_VELA.chart, t1 = Date.now() - hb * 3600000; c.setVisibleRange({ from: t1 - n * 300000, to: t1 }); }, [hBack, nBars]);
(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    for (const [w, h, mobile, tag, nb] of [[1440, 900, false, '1440-dark', 60], [390, 844, true, '390-dark', 10]]) {
      const { ctx, p, errors, aux } = await open(b, { w, h, mobile });
      // the screen of Harry's screenshot: about 5 h of 5m bars ending now (the left part is older than the 3 h seed)
      await view(p, 0, mobile ? 10 : 60); await sleep(5000);
      let c = await cover(p);
      console.log(tag, 'now view', JSON.stringify(c), 'aux', aux.length);
      check(c.src === 'l2', tag + ': Volume footprint, Data = L2', c.src);
      check(c.inView >= nb - 2 && c.has === c.inView, tag + ': every visible bar has footprint (' + c.has + '/' + c.inView + ', left edge ' + c.firstH + ' h back)', c);
      if (!mobile) check(c.firstH > 3.2, tag + ': the view reaches past the 3 h page-open seed (' + c.firstH + ' h)', c);
      check(!/from/.test(c.note || ''), tag + ': no "Footprint (L2) from HH:MM" note', c.note);
      await p.screenshot({ path: OUT + '/fphist-' + tag + '.png' });
      // scroll back 20 h: older bars fill from history too
      await view(p, 20, mobile ? 10 : 60); await sleep(6000);
      c = await cover(p);
      console.log(tag, '20 h back', JSON.stringify(c), 'aux', aux.length);
      check(c.inView > 0 && c.has === c.inView, tag + ': 20 h back: every visible bar has footprint (' + c.has + '/' + c.inView + ')', c);
      check(aux.length >= 4 && aux.every(([f]) => f >= Date.now() - 48 * H - 120000), tag + ': history read in more /ts-aux windows, none past 48 h (' + aux.length + ')', aux);
      const keys = aux.map((x) => x.join('-')); check(keys.every((k, i) => keys.indexOf(k) === i), tag + ': no window read twice', keys);
      await p.screenshot({ path: OUT + '/fphist-' + tag + '-20h.png' });
      check(errors.length === 0, tag + ': no console errors', errors.slice(0, 3));
      await ctx.close();
    }
    {   // the Worker holds nothing before 8 h ago: the note says so in plain words, and nothing is faked
      const floor = NOW - 8 * H, { ctx, p, errors } = await open(b, { w: 1440, h: 900, mobile: false, floor });
      await view(p, 6, 60); await sleep(6000);
      const c = await cover(p);
      console.log('floor', JSON.stringify(c));
      check(/^No footprint recorded before \d\d:\d\d$/.test(c.note || ''), 'no history before 8 h: plain note "' + c.note + '"', c);
      check(c.has < c.inView && c.has > 0, 'no history before 8 h: bars older than that have no footprint (' + c.has + '/' + c.inView + ')', c);
      await p.screenshot({ path: OUT + '/fphist-floor-1440-dark.png' });
      check(errors.length === 0, 'floor: no console errors', errors.slice(0, 3));
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
