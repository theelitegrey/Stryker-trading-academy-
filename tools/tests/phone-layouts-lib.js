// Shared open() for the phone layouts / ⋯ menu suite (chart-phone-layouts-browser.js).
// Bars come from the recorded NQ order-flow fixture (fixtures/orderflow), every symbol gets the
// same candles; nothing reaches a live data source (no InsightSentry, no Yahoo, no exchanges).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const stub = require('./richstub.js');
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function newCtx(b, { w, h, mobile }) {
  const ua = mobile ? 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36' : undefined;
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile, userAgent: ua });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(([now]) => {
    try {
      localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_community_disclaimer_ack_v1', '1');
    } catch (e) {}
    const RealDate = Date, off = now - RealDate.now();
    class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + off); } static now() { return RealDate.now() + off; } }
    window.Date = FakeDate;
  }, [NOW]);
  await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  await ctx.route(/127\.0\.0\.1:\d+\/api\/chart\/bars\//, async (r) => {
    const u = new URL(r.request().url());
    const tfs = u.searchParams.get('tf') || '1';
    const tf = /^\d+$/.test(tfs) ? Number(tfs) : (tfs === 'D' ? 1440 : 60);
    const page = Number(u.searchParams.get('page')) || 0;
    const bars = (await candles(Math.min(tf, 240))).filter((x) => x[0] * 1000 < NOW);
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ s: 'NQ', tf: tfs, page, bars }) });
  });
  await ctx.route(/127\.0\.0\.1:\d+\/api\/(chart\/stream|gex|fx|news|opt)/, (r) => r.abort());
  return ctx;
}
async function openPage(ctx, base, v09, extra) {
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource|\/api\/|firebase|firestore|CORS|WebSocket|econ-calendar|net::/i.test(m.text())) errors.push(m.text().slice(0, 200)); });
  p.on('pageerror', (e) => { if (!/docChanges/.test(String(e))) errors.push(String(e).slice(0, 200)); });
  await p.goto(base + '/charts.html?vela=' + (v09 ? '0.9' : '0.6') + (extra || ''), { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_CHART_UI && window.STRYKER_CHART_UI.grid && window.__stkOneBar, null, { timeout: 60000 });
  await sleep(2500);
  return { p, errors };
}
module.exports = { newCtx, openPage, sleep, candles };
