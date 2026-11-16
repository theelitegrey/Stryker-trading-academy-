// Default chart look (Owner 14 Nov): fresh profile gets it, a saved layout is untouched, Reset gives it.
//   node tools/tests/chart-dev-server.mjs 8031 &   CHART_BASE=http://127.0.0.1:8031 node tools/tests/chart-defstyle-browser.js <shotsDir>
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '.';
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 400))); };
const CFG = () => { const ws = window.STRYKER_VELA; const c = ws.cell(ws.active.id).chart.renderer.getConfig(); return { bg: c.layout.background, tx: c.layout.textColor, up: c.candles.upColor, dn: c.candles.downColor, bu: c.candles.borderUpColor, bd: c.candles.borderDownColor, wu: c.candles.wickUpColor, wd: c.candles.wickDownColor, body: c.candles.bodyVisible, bor: c.candles.borderVisible, wick: c.candles.wickVisible, gv: c.grid.vertLines.visible, gh: c.grid.horzLines.visible, az: c.animations.zoom, sp: c.series.spacing }; };
async function open(b, { w, h, theme, seed }) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: w < 700, hasTouch: w < 700 });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(([t, s]) => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_community_disclaimer_ack_v1', '1'); if (t === 'light') localStorage.setItem('stryker_theme', 'day'); if (s && !sessionStorage.getItem('seeded')) { localStorage.setItem('vela-workspace-090', s); sessionStorage.setItem('seeded', '1'); } } catch (e) {} }, [theme, seed || '']);
  await ctx.route(/^https?:\/\/[^/]*(gstatic|googleapis|firebase|google|doubleclick)\./, (r) => r.abort());
  const p = await ctx.newPage();
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => { try { const ws = window.STRYKER_VELA; return ws && ws.cell(ws.active.id).chart.renderer.renderer.coords.barCount > 20; } catch (e) { return false; } }, null, { timeout: 60000 });
  await p.waitForTimeout(2500);
  return { ctx, p };
}
(async () => {
  const b = await launch();
  const want = { bg: '#0f0f0f', up: '#24a34e', dn: '#adadad', bu: '#24a34e', bd: '#adadad', wu: '#24a34e', wd: '#adadad', body: true, bor: true, wick: true, gv: false, gh: false, az: false, sp: 1 };
  const lo = (c) => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, typeof v === 'string' ? v.toLowerCase() : v]));
  // (a) fresh, dark 1440 + phone, light 1440
  let { ctx, p } = await open(b, { w: 1440, h: 900 });
  let c = lo(await p.evaluate(CFG));
  check(Object.keys(want).every((k) => c[k] === want[k]), '(a) fresh dark = Owner values', c);
  await p.screenshot({ path: OUT + '/defstyle-dark-1440.png' });
  // (c) change, then reset
  await p.evaluate(() => { const ws = window.STRYKER_VELA; ws.cell(ws.active.id).chart.renderer.applyConfig({ candles: { upColor: '#ff0000', downColor: '#0000ff' }, grid: { vertLines: { visible: true }, horzLines: { visible: true } } }); });
  c = lo(await p.evaluate(CFG)); check(c.up === '#ff0000' && c.gh === true, '(c) setup: custom colours applied');
  await p.evaluate(() => { const S = window.__stkSettings; const ws = window.STRYKER_VELA; S.restore(ws.active.id, window.__stkDefaultsFor(ws.active.id), { tz: true }); });
  c = lo(await p.evaluate(CFG)); check(Object.keys(want).every((k) => c[k] === want[k]), '(c) Reset to defaults = Owner values', c);
  await ctx.close();
  ({ ctx, p } = await open(b, { w: 1440, h: 900, theme: 'light' }));
  c = lo(await p.evaluate(CFG)); check(c.bg === '#ffffff' && c.up === '#24a34e' && c.gv === false && c.gh === false, 'fresh light', c);
  await p.screenshot({ path: OUT + '/defstyle-light-1440.png' }); await ctx.close();
  ({ ctx, p } = await open(b, { w: 390, h: 844 }));
  c = lo(await p.evaluate(CFG)); check(c.up === '#24a34e' && c.bg === '#0f0f0f', 'fresh phone', c);
  await p.screenshot({ path: OUT + '/defstyle-dark-390.png' }); await ctx.close();
  // (b) saved layout with red/blue + grid: take a real saved doc from a fresh run, alter it, reload
  ({ ctx, p } = await open(b, { w: 1440, h: 900 }));
  await p.evaluate(() => { const ws = window.STRYKER_VELA; ws.cell(ws.active.id).chart.renderer.applyConfig({ candles: { upColor: '#ff0000', downColor: '#0000ff', borderUpColor: '#ff0000', borderDownColor: '#0000ff', wickUpColor: '#ff0000', wickDownColor: '#0000ff' }, grid: { vertLines: { visible: true }, horzLines: { visible: true } }, layout: { background: '#222233' } }); ws.markStateDirty(); });
  await p.waitForTimeout(2500);
  const doc = await p.evaluate(() => localStorage.getItem('vela-workspace-090'));
  await ctx.close();
  check(!!doc && doc.includes('#ff0000'), '(b) saved doc captured');
  ({ ctx, p } = await open(b, { w: 1440, h: 900, seed: doc }));
  c = lo(await p.evaluate(CFG));
  check(c.up === '#ff0000' && c.dn === '#0000ff' && c.gv === true && c.gh === true && c.bg === '#222233', '(b) saved layout loads unchanged', c);
  const after = await p.evaluate(() => localStorage.getItem('vela-workspace-090'));
  check(!/24a34e/i.test(after), '(b) saved doc not rewritten with new default');
  await p.screenshot({ path: OUT + '/defstyle-saved-1440.png' }); await ctx.close();
  // (b2) old saved doc with NO rendererConfig at all: loads as today (stock), not the new default
  const old = JSON.stringify({ version: 1, layout: '1', charts: [{ id: 'A', symbol: 'binance:BTCUSDT', timeframe: '15' }] });
  ({ ctx, p } = await open(b, { w: 1440, h: 900, seed: old }));
  c = lo(await p.evaluate(CFG)); check(c.up !== '#24a34e' && c.gh === true, '(b2) doc without style key keeps stock look', c);
  await ctx.close(); await b.close();
  process.exit(fail ? 1 : 0);
})();
