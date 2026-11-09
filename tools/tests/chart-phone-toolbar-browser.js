// Chart toolbar never overlaps (Owner 2026-11-09, phone 412: chart-type icon on the wallet icon, pencil on the data-source icon,
// symbol cut to "M…"). At 360 / 390 / 412 / 768 / 1440, signed in and out, after a symbol change and a rotation: no two toolbar
// controls' boxes overlap, the symbol keeps its root text, nothing spills off-screen.
//   node tools/tests/chart-speed-server.mjs 8271 &
//   CHART_BASE=http://127.0.0.1:8271 flock /tmp/stryker-chrome.lock node tools/tests/chart-phone-toolbar-browser.js [shotsDir]
const fs = require('fs');
const { launch } = require('./lib.js');
const { speedInit } = require('./chart-phone-speed-init.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8271';
const OUT = process.argv[2];
if (OUT) fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 400))); };

// runs in the page
function measure() {
  const bar = document.getElementById('stkc-bar'); const br = bar.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const sel = 'button, a, [role=button], .mclock-pill';
  const items = [...bar.querySelectorAll(sel)].filter((e) => !e.closest('.stkc-pop, .stkc-ob-pop, #stkc-credits, .mclock-pop, [hidden]') && e.getClientRects().length)
    .map((e) => ({ e, r: e.getBoundingClientRect(), n: (e.id || e.className || e.tagName).toString().slice(0, 28) })).filter((o) => o.r.width > 0 && o.r.height > 0);
  const overlaps = [];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i], b = items[j];
    if (a.e.contains(b.e) || b.e.contains(a.e)) continue;
    const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left), h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
    if (w > 1 && h > 1) overlaps.push(a.n + ' x ' + b.n);
  }
  const spill = items.filter((o) => o.r.left < -0.5 || o.r.right > vw + 0.5 || o.r.right > br.right + 1).map((o) => o.n);
  const sym = document.querySelector('#stkc-bar .vela-mb-symbol, #stkc-bar .vela-widget-symbol');
  let symInfo = null;
  if (sym) {
    const t = sym.textContent.trim();
    symInfo = { t, clipped: sym.scrollWidth > sym.clientWidth + 1, w: Math.round(sym.getBoundingClientRect().width), ellipsis: /…|\.\.\./.test(t) };
  }
  return { overlaps, spill, symInfo, hscroll: document.documentElement.scrollWidth > vw + 1, n: items.length };
}

(async () => {
  const b = await launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=600'] });
  const run = async (tag, w, h, mobile, { signedOut = false, steps } = {}) => {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 2 });
    await speedInit(ctx);
    if (signedOut) await ctx.addInitScript(() => { try { const a = window.__stubAuth; a.currentUser = null; a.onAuthStateChanged = (cb) => { setTimeout(() => cb(null), 10); return () => {}; }; a.onIdTokenChanged = (cb) => { setTimeout(() => cb(null), 30); return () => {}; }; } catch (e) {} });
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net)/, (r) => r.abort());
    const p = await ctx.newPage();
    await p.goto(BASE + '/charts.html?vela=0.9', { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('#stkc-bar .vela-mb-symbol, #stkc-bar .vela-widget-symbol', { timeout: 60000 });
    await sleep(5000);
    const verify = async (label) => {
      const m = await p.evaluate(measure);
      const phone = w < 600;
      check(m.n > 3 && m.overlaps.length === 0, tag + ' ' + label + ': no toolbar items overlap', m.overlaps);
      check(m.spill.length === 0 && !m.hscroll, tag + ' ' + label + ': nothing spills off-screen', m.spill);
      check(!!m.symInfo && !m.symInfo.clipped && (!phone || m.symInfo.w >= 56), tag + ' ' + label + ': symbol text is whole', m.symInfo);
      if (OUT) await p.screenshot({ path: OUT + '/' + tag + '-' + label.replace(/\W+/g, '') + '.png', clip: { x: 0, y: 0, width: w, height: 120 } });
    };
    await verify('load');
    if (steps) await steps(p, verify);
    await ctx.close();
  };
  const sym = async (p, verify, s) => {
    await p.evaluate((x) => { window.STRYKER_VELA.active.setSymbol(x); }, s);
    await sleep(3500); await verify('symbol ' + s);
  };
  for (const [w, h, mob] of [[360, 780, true], [390, 844, true], [412, 915, true], [768, 1024, false], [1440, 900, false]]) {
    await run('w' + w, w, h, mob, { steps: async (p, v) => {
      await sym(p, v, 'futures:MNQ1!'); await sym(p, v, 'binance:BTCUSDT');
      if (mob) { await p.setViewportSize({ width: h, height: w }); await sleep(1500); await v('rotated'); await p.setViewportSize({ width: w, height: h }); await sleep(1500); await v('back'); }
    } });
  }
  for (const w of [360, 390, 412]) await run('out' + w, w, 844, true, { signedOut: true });
  await b.close();
  console.log(fail ? 'FAILED ' + fail : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
