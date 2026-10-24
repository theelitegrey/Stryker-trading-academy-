// Browser check for live order flow ("deep data speed" a1): the admin footprint's forming minute is built from
// the stream's prints and keeps up with them. Nothing live: the page is served from the repo, Firebase is the
// test stub, /api/chart/rt says admin, /api/chart/bars + the recorder /orderflow serve the REAL NQ fixture
// (workers/book-recorder/test/fixtures/nq-trades-20261013-12utc.json.gz) shifted so its hour ends now, and
// the /api/chart/stream WebSocket is a mock that sends that hour's prints like the bridge does with of=1
// ({event:'trades'} every 250 ms) in real time. The recorder copy is made to lag 3 minutes, as it does live.
//   STRYKER_TEST_BASE=http://127.0.0.1:8093 NODE_PATH=<repo>/node_modules \
//     flock /tmp/stryker-chrome.lock node tools/tests/chart-live-of-browser.js <shotsDir>
// Checks at 1440 and 390: flag OFF -> the stream URL has no of=1 and the forming minute has no footprint
// (only the lagging recorder); flag ON -> of=1, the forming minute is drawn from live prints and its print
// count equals the prints sent for that minute; footprint version changes >= 2x a second; no console errors.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');
const { launch, BASE } = require('./lib.js');
const stub = require('./richstub.js');
const ROOT = path.resolve(__dirname, '..', '..');
const OUT = process.argv[2] || '/tmp';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, extra) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (extra !== undefined && !ok ? ' ' + JSON.stringify(extra).slice(0, 600) : '')); };

const RAW = JSON.parse(zlib.gunzipSync(fs.readFileSync(ROOT + '/workers/book-recorder/test/fixtures/nq-trades-20261013-12utc.json.gz'))).series;
// ---- payload codec (as ofcodec.py) to serve the shifted recorder copy
function uv(n, out) { while (n >= 0x80) { out.push((n % 128) | 0x80); n = Math.floor(n / 128); } out.push(n); }
function sv(n, out) { uv(n < 0 ? -2 * n - 1 : 2 * n, out); }

(async () => {
  const D = await import(path.join(ROOT, 'assets/chart-footprint-data.js'));
  const tmp = fs.mkdtempSync('/tmp/liveofb-'); const bin = path.join(tmp, 'nq.bin');
  execFileSync('python3', [ROOT + '/workers/book-recorder/of-feeder/of_feeder.py', '--dry-run', ROOT + '/workers/book-recorder/test/fixtures/nq-trades-20261013-12utc.json.gz', 'NQ', bin]);
  const recRaw = new Uint8Array(fs.readFileSync(bin));
  fs.rmSync(tmp, { recursive: true, force: true });
  const rec = D.decodeOrderflow(recRaw);
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    for (const [W, H, mobile, flag] of [[1440, 900, false, false], [1440, 900, false, true], [390, 844, true, true]]) {
      const tag = W + (flag ? ' ON' : ' OFF');
      // shift: fixture minute 0 starts 57 min before the current minute; its last prints land in "now"
      const nowMin = Math.floor(Date.now() / 60000) + 1;   // a little headroom for the boot
      const SHIFT = (nowMin - 57) * 60 - Math.floor(RAW[0].time / 60) * 60;
      const prints = RAW.map((x) => [x.time + SHIFT, x.close, x.volume, x.type === 'buy' ? 1 : x.type === 'sell' ? 0 : -1]);
      const recBars = rec.bars.map((x) => Object.assign({}, x, { t: x.t + SHIFT * 1000 }));
      const candles = recBars.map((x) => [x.t / 1000, x.o * 0.25, x.hi * 0.25, x.lo * 0.25, x.c * 0.25, x.vol]);
      // recorder copy as of 3 minutes ago (its live lag)
      const payload = () => {
        const cut = (Math.floor(Date.now() / 60000) - 3) * 60000;
        const keep = new Set(recBars.filter((x) => x.t < cut).map((x) => x.t - SHIFT * 1000));
        // re-pack the original records whose (unshifted) minute is kept, with the minute shifted
        let i = 4, hl; [hl, i] = (() => { let n = 0, s = 1, x; do { x = recRaw[i++]; n += (x & 0x7f) * s; s *= 128; } while (x >= 0x80); return [n, i]; })();
        const hdr = JSON.parse(Buffer.from(recRaw.subarray(i, i + hl)).toString()); i += hl;
        const rd = () => { let n = 0, s = 1, x; do { x = recRaw[i++]; n += (x & 0x7f) * s; s *= 128; } while (x >= 0x80); return n; };
        const cnt = rd(), recs = [];
        for (let k = 0; k < cnt; k++) {
          const len = rd(), body = recRaw.subarray(i, i + len); i += len;
          let j = 0, t = 0, s2 = 1, x; do { x = body[j++]; t += (x & 0x7f) * s2; s2 *= 128; } while (x >= 0x80);
          if (!keep.has(t * 60000)) continue;
          const o = []; uv(t + SHIFT / 60, o); recs.push(Buffer.concat([Buffer.from(o), Buffer.from(body.subarray(j))]));
        }
        const out = [0x4f, 0x46, 0x31, 0x0a]; const h = Buffer.from(JSON.stringify(hdr)); uv(h.length, out);
        const parts = [Buffer.from(out), h]; const c = []; uv(recs.length, c); parts.push(Buffer.from(c));
        for (const r of recs) { const l = []; uv(r.length, l); parts.push(Buffer.from(l), r); }
        return zlib.gzipSync(Buffer.concat(parts));
      };
      const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
      await ctx.addInitScript(stub);
      await ctx.addInitScript((flag) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.removeItem('stryker.vela.session'); localStorage.setItem('stk_live_of', flag ? '1' : '0'); } catch (e) {} }, flag);
      await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => (/book-recorder\.theelitegrey\.workers\.dev\/orderflow/.test(r.request().url())
        ? r.fulfill({ status: 200, contentType: 'application/octet-stream', headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'x-of-gzip', 'x-of-gzip': '1' }, body: payload() })
        : r.abort()));
      await ctx.route(/\/api\/chart\/rt/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"admin":true}' }));
      await ctx.route(/\/api\/chart\/bars\//, (r) => {
        const u = new URL(r.request().url()); const tf = Number(u.searchParams.get('tf')) || 1;
        const rows = D.aggregate(recBars, tf * 60000).map((x) => [x.t / 1000, x.o * 0.25, x.hi * 0.25, x.lo * 0.25, x.c * 0.25, x.vol]);
        r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ s: 'NQ', tf: String(tf), page: Number(u.searchParams.get('page')) || 0, bars: tf === 1 ? candles : rows, rt: true }) });
      });
      const streamUrls = [], sent = new Map();   // minute -> prints sent
      await ctx.routeWebSocket(/\/api\/chart\/stream\//, (ws) => {
        const u = new URL(ws.url()); streamUrls.push(u.search);
        const of = u.searchParams.get('of') === '1';
        let k = prints.findIndex((p) => p[0] * 1000 > Date.now() - 5 * 60000);   // replay the last 5 min, then real time
        let closed = false; ws.onClose(() => { closed = true; });
        ws.send(JSON.stringify({ event: 'connected', s: 'NQ', tf: '1', hub: true }));
        let forming = null;
        const tick = () => {
          if (closed) return;
          const now = Date.now() / 1000, batch = [];
          while (k < prints.length && prints[k][0] <= now) batch.push(prints[k++]);
          for (const p of batch) {
            const m = Math.floor(p[0] / 60); sent.set(m, (sent.get(m) || 0) + 1);
            const bt = m * 60;
            if (!forming || bt > forming[0]) forming = [bt, p[1], p[1], p[1], p[1], 0];
            forming[2] = Math.max(forming[2], p[1]); forming[3] = Math.min(forming[3], p[1]); forming[4] = p[1]; forming[5] += p[2];
          }
          if (batch.length && of) ws.send(JSON.stringify({ event: 'trades', s: 'NQ', tr: batch }));
          if (forming) ws.send(JSON.stringify({ event: 'bar', s: 'NQ', tf: '1', bar: forming }));
          ws.send(JSON.stringify({ event: 'ping', t: Date.now(), up: 100 }));
          setTimeout(tick, 250);
        };
        tick();
      });
      const p = await ctx.newPage();
      const errors = [];
      p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource/.test(m.text())) errors.push(m.text()); });
      p.on('pageerror', (e) => errors.push(String(e)));
      await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
      await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_VELA.chart && window.__stkOrderflow, null, { timeout: 60000 });
      await p.evaluate(() => { window.__stkOfTestTier = { free: false, plan: 'Pro', admin: true }; });
      await p.evaluate(async () => {
        const ws = window.STRYKER_VELA; ws.active.setSymbol('futures:NQ1!'); ws.active.setTimeframe('1');
        for (let i = 0; i < 80; i++) { await new Promise((r) => setTimeout(r, 250)); if (ws.chart.market.symbol === 'futures:NQ1!' && ws.chart.orchestrator.rawBars.length > 30) break; }
        ws.active.setPriceStyle('stk_fp');
      });
      await sleep(3000);
      await p.evaluate(() => { const c = window.STRYKER_VELA.chart; const t = Date.now(); c.setVisibleRange({ from: t - 9 * 60000, to: t + 90000 }); });
      // sample the newest order-flow minute for 6 s
      const samp = await p.evaluate(async () => {
        const O = window.__stkOrderflow, out = [];
        for (let i = 0; i < 24; i++) {
          const bs = O.minuteBars('NQ', Date.now() - 8 * 60000, Date.now() + 60000), last = bs[bs.length - 1];
          out.push({ at: Date.now(), n: bs.length, t: last ? last.t : 0, trades: last ? last.trades : 0, live: !!(last && last.live), v: O.version ? O.version() : 0, stats: typeof window.tzLiveOfStats === 'function' ? null : 'none' });
          await new Promise((r) => setTimeout(r, 250));
        }
        return out;
      });
      const nowM = Math.floor(Date.now() / 60000);
      const last = samp[samp.length - 1];
      const urlOf = streamUrls.some((s) => /of=1/.test(s));
      if (!flag) {
        check(!urlOf && streamUrls.length > 0, tag + ': stream opened without of=1', streamUrls);
        check(last.t < (nowM - 2) * 60000 && !last.live, tag + ': newest footprint minute is the lagging recorder one (' + new Date(last.t).toISOString().slice(11, 16) + ', now ' + new Date(nowM * 60000).toISOString().slice(11, 16) + ')', last);
      } else {
        check(urlOf, tag + ': stream opened with of=1', streamUrls);
        check(last.live && last.t >= (nowM - 1) * 60000, tag + ': newest footprint minute is LIVE and current (' + new Date(last.t).toISOString().slice(11, 16) + ')', last);
        const sentN = sent.get(last.t / 60000) || 0;
        check(Math.abs(sentN - last.trades) <= 40 && last.trades > 0, tag + ': forming minute holds ' + last.trades + ' prints, ' + sentN + ' sent by the stream so far', { sentN, last });
        const changes = samp.filter((x, i) => i && (x.trades !== samp[i - 1].trades || x.t !== samp[i - 1].t)).length;
        check(changes >= 6, tag + ': forming footprint changed ' + changes + ' times in 6 s (prints arrive in real time; quiet seconds stay put)', samp.map((x) => x.trades));
        const st = await p.evaluate(() => window.tzLiveOfStats('NQ'));
        check(st && st.minutes >= 1 && st.coverPct === 100 && st.exact === st.minutes, tag + ': tzLiveOfStats: ' + (st && st.minutes) + ' closed minutes compared, coverage ' + (st && st.coverPct) + '%, exact ' + (st && st.exact), st);
      }
      // the footprint cells in frame + the forming bar: screenshot
      await p.evaluate(() => { const c = window.STRYKER_VELA.chart; const t = Date.now(); c.setVisibleRange({ from: t - 7 * 60000, to: t + 60000 }); });
      await sleep(1200);
      const shot = path.join(OUT, 'live-of-' + W + (flag ? '-on' : '-off') + '.png');
      const style = await p.evaluate(() => window.STRYKER_VELA.chart.market && window.STRYKER_VELA.active && document.querySelector('#vela-chart') ? 'ok' : 'no-chart');
      await p.screenshot({ path: shot });
      console.log('SHOT ' + shot + ' (' + style + ')');
      const sw = await p.evaluate(() => document.documentElement.scrollWidth);
      check(sw <= W + 1, tag + ': no horizontal scroll (' + sw + ')');
      check(!errors.length, tag + ': no console errors', errors.slice(0, 5));
      await ctx.close();
    }
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
