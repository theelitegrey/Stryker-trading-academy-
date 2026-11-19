// Screenshots for the FEATB feature pages (19 Nov 2026): /features/{charts,indicators,backtesting,journal,models}.
// The REAL app pages on stub data: ZoroCharts on the local chart dev server (NQ bars, our own Pine indicators),
// Kronos / Nemesis / Mentis models on the rich Firebase stub (tools/tests/richstub.js: sample member u1).
// Exchange names and feed-timing words are scrubbed from chart shots (brief: no vendor names, no "delayed"/"real-time").
// Output: 2x PNGs in <outDir>, cropped to webp by tools/feature-pages/crop.py --featb <outDir>.
//   node tools/tests/chart-dev-server.mjs 8094 &
//   tools/chrome-slot.sh env CHART_BASE=http://127.0.0.1:8094 node --max-old-space-size=768 tools/feature-pages/shoot-featb.js <outDir> [scene...]
const fs = require('fs'), path = require('path');
const { launch, ROOT } = require('../tests/lib.js');
const stub = require('../tests/richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8094';
const OUT = process.argv[2] || '/tmp/featb', ONLY = process.argv.slice(3);
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pine = (id) => fs.readFileSync(path.join(ROOT, 'assets/pine', id + '.pine'), 'utf8');

async function open(b, url, w = 1440, h = 900) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(() => { try {
    localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_tour_done', '1');
    localStorage.setItem('tz_consent', JSON.stringify({ v: 1, essential: true, analytics: false, at: new Date().toISOString() }));
  } catch (e) {} });
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
  const p = await ctx.newPage(); const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(BASE + url, { waitUntil: 'domcontentloaded' });
  return { ctx, p, errors };
}
const scrub = (p) => p.evaluate(() => {
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); const hit = [];
  while (w.nextNode()) hit.push(w.currentNode);
  hit.forEach((n) => { const t = n.nodeValue;
    if (/delayed|real-time|^\s*Live\s*$/i.test(t)) { n.parentElement.style.visibility = 'hidden'; return; }
    const v = t.replace(/\s*·\s*(CME|COMEX|NYMEX|CBOT|BINANCE)\b/g, '').replace(/\b(CME|BINANCE)\s*·\s*/g, ''); if (v !== t) n.nodeValue = v; });
  document.querySelectorAll('.stkdp-pill, [class*="stkdp-"], .tzc, .toast, #cookie-notice, .ja-fab').forEach((e) => { e.style.display = 'none'; });
});
async function shot(p, n, clip) {
  await scrub(p); await p.mouse.move(2, 2).catch(() => {}); await sleep(700);
  await p.screenshot({ path: path.join(OUT, n + '.png'), clip });
  console.log('SHOT', n);
}
async function chart(b, sym = 'NQ1!', tf = '5') {
  const o = await open(b, '/charts.html');
  await o.p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_PINE, null, { timeout: 60000 });
  await sleep(2500);
  await o.p.evaluate(([s, t]) => { const v = window.STRYKER_VELA; v.active.setSymbol(s); v.active.setTimeframe(t); }, [sym, tf]);
  await sleep(6000);
  return o;
}
const add = (p, t, inputs) => p.evaluate(([t, i]) => !!window.STRYKER_VELA.chart.addNativeIndicator(t, i ? { inputs: i } : undefined), [t, inputs || null]);
async function addPine(p, id, name) {
  const r = await p.evaluate(async ([n, s]) => { try { await window.STRYKER_PINE.addSource(n, s, { engine: 'next', builtin: true }); return 'ok'; } catch (e) { return String(e); } }, [name, pine(id)]);
  console.log('pine', id, r); await sleep(9000);
}
const clearInd = (p) => p.evaluate(() => { const c = window.STRYKER_VELA.chart; c.indicators().filter((h) => h.nativeType !== 'volume').forEach((h) => { try { c.removeIndicator ? c.removeIndicator(h.id) : h.remove(); } catch (e) {} });
  (window.STRYKER_PINE.pineHandles ? window.STRYKER_PINE.pineHandles(c) : []).forEach((h) => { try { c.removeIndicator(h.id); } catch (e) {} }); });

// element capture: the panel holding a heading/text (closest matching ancestor), padded, at 2x
async function grab(p, n, text, sel, pad = 12, minW = 300) {
  const box = await p.evaluate(([t, sel, minW]) => {
    const els = [...document.querySelectorAll('h1,h2,h3,h4,div,span,b,strong,p,button,a,th,td')].filter((e) => e.offsetParent && e.children.length < 4 && e.textContent.trim().startsWith(t));
    for (const e of els) { const a = e.closest(sel); if (a && a.getBoundingClientRect().width >= minW) { a.scrollIntoView({ block: 'center' }); const r = a.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cls: String(a.className).slice(0, 60) }; } }
    return null; }, [text, sel, minW]);
  if (!box) { console.log('MISS', n, text); return; }
  await sleep(900);
  const r = await p.evaluate(([t, sel, minW]) => { const e = [...document.querySelectorAll('h1,h2,h3,h4,div,span,b,strong,p,button,a,th,td')].filter((e) => e.offsetParent && e.children.length < 4 && e.textContent.trim().startsWith(t)).map((e) => e.closest(sel)).find((a) => a && a.getBoundingClientRect().width >= minW); const b = a => a.getBoundingClientRect(); const q = b(e); return { x: q.x, y: q.y, width: q.width, height: q.height }; }, [text, sel, minW]);
  const vw = p.viewportSize();
  const clip = { x: Math.max(0, r.x - pad), y: Math.max(0, r.y - pad), width: Math.min(vw.width, r.width + 2 * pad), height: Math.min(vw.height - Math.max(0, r.y - pad), r.height + 2 * pad) };
  console.log('GRAB', n, box.cls, JSON.stringify(clip)); await shot(p, n, clip);
}

const scenes = {
  async charts(b) {
    const { ctx, p, errors } = await chart(b);
    await add(p, 'ema', { length: 21 }); await add(p, 'vwap'); await add(p, 'stk_svp');
    await p.evaluate(() => { const ch = window.STRYKER_VELA.chart, raw = ch.orchestrator.rawBars, n = raw.length;
      const lo = Math.min(...raw.slice(n - 120).map((r) => r.low)), hi = Math.max(...raw.slice(n - 120).map((r) => r.high));
      try { ch.drawings.add('trendline', { anchors: [{ time: raw[n - 110].time, price: lo }, { time: raw[n - 20].time, price: lo + (hi - lo) * 0.55 }] }); } catch (e) {}
      try { ch.drawings.add('fibretracement', { anchors: [{ time: raw[n - 70].time, price: lo }, { time: raw[n - 30].time, price: hi }] }); } catch (e) {} });
    await sleep(3000); await shot(p, 'c-main');
    await p.evaluate(() => window.STRYKER_VELA.indicatorPicker.open()); await p.waitForSelector('.stkiw-row', { timeout: 20000 }).catch(() => {});
    await p.evaluate(() => { const t = document.querySelector('.stkiw-tab[data-k="tz"], .stkiw-tab[data-k="tradezoro"]'); t && t.click(); }); await sleep(1500);
    await shot(p, 'c-picker');
    await p.keyboard.press('Escape'); await sleep(600);
    await p.evaluate(() => window.STRYKER_PINE.open()); await sleep(3500); await shot(p, 'c-pine');
    await p.keyboard.press('Escape'); await p.evaluate(() => { try { window.STRYKER_PINE.close && window.STRYKER_PINE.close(); } catch (e) {} }); await sleep(800);
    await p.evaluate(() => { const U = window.STRYKER_CHART_UI; U.applyStarter(U.STARTERS.find((x) => x.id === 'starter:quad')); }); await sleep(9000);
    await shot(p, 'c-quad');
    console.log('errors', errors.slice(0, 3)); await ctx.close();
  },
  async charts2(b) {  // replay + alerts + drawings toolbar
    const { ctx, p, errors } = await chart(b, 'ES1!', '15');
    await p.evaluate(() => { const r = [...document.querySelectorAll('button')].find((x) => /^\s*Replay\s*$/.test(x.textContent)); r && r.click(); }); await sleep(2500);
    await shot(p, 'c-replay');
    await p.keyboard.press('Escape'); await sleep(500);
    await p.evaluate(() => { const r = document.getElementById('stkc-alerts-btn') || [...document.querySelectorAll('[aria-label]')].find((x) => /^Alerts/.test(x.getAttribute('aria-label'))); r && r.click(); }); await sleep(2500);
    await shot(p, 'c-alerts');
    console.log('errors', errors.slice(0, 3)); await ctx.close();
  },
  async ind(b) {
    const { ctx, p, errors } = await chart(b, 'NQ1!', '5');
    for (const [id, name, n] of [['liquidity-master-tradezoro', 'Liquidity Master', 'i-lm'], ['ifvg-pro-stryker', 'IFVG Pro+ [TradeZoro]', 'i-ifvg'],
      ['htf-po3-lens-stryker', 'HTF PO3 Lens [TradeZoro]', 'i-po3'], ['fvg-relay-stryker', 'FVG Relay [TradeZoro]', 'i-fvg'], ['tz-fractal-model', 'TZ Fractal Model [TradeZoro]', 'i-fractal'],
      ['smt-pro-stryker', 'SMT Divergence Pro [TradeZoro]', 'i-smt']]) {
      await clearInd(p); await sleep(800); await addPine(p, id, name); await shot(p, n);
    }
    console.log('errors', errors.slice(0, 3)); await ctx.close();
  },
  async kronos(b) {
    const { ctx, p, errors } = await open(b, '/backtests.html'); await sleep(6000);
    await shot(p, 'k-dash');
    for (const v of ['sessions', 'analytics', 'trades']) {
      await p.evaluate((v) => { location.hash = '#' + v; }, v); await sleep(2500); await p.evaluate(() => scrollTo(0, 0));
      await shot(p, 'k-' + v);
    }
    await p.evaluate(() => scrollTo(0, 1500)); await sleep(1500); await shot(p, 'k-analytics2');
    await p.evaluate(() => scrollTo(0, 2700)); await sleep(1500); await shot(p, 'k-analytics3');
    console.log('errors', errors.slice(0, 3)); await ctx.close();
  },
  async journal(b) {
    const { ctx, p, errors } = await open(b, '/trade-journal.html'); await sleep(6000);
    await shot(p, 'j-dash');
    await p.evaluate(() => scrollTo(0, 1050)); await sleep(1200); await shot(p, 'j-dash2');
    for (const t of ['calendar', 'analytics', 'ai', 'playbook', 'add', 'history', 'propfirms']) {
      await p.evaluate((t) => { scrollTo(0, 0); const e = document.querySelector('.level-tab[data-tab="' + t + '"]'); e && e.click(); }, t); await sleep(2200);
      await shot(p, 'j-' + t);
    }
    console.log('errors', errors.slice(0, 3)); await ctx.close();
  },
  async models(b) {
    let { ctx, p, errors } = await open(b, '/models.html'); await sleep(6000);
    await shot(p, 'm-list');
    await p.evaluate(() => scrollTo(0, 760)); await sleep(1500); await shot(p, 'm-list2');
    console.log('errors', errors.slice(0, 3)); await ctx.close();
    ({ ctx, p, errors } = await open(b, '/model.html?id=ict-2022-model')); await sleep(6000);
    await p.addStyleTag({ content: '*{animation:none!important;transition:none!important} [class*="reveal"],[data-reveal]{opacity:1!important;transform:none!important}' });
    await shot(p, 'm-one');
    for (const y of [900, 1700, 2350, 2500]) { await p.evaluate((y) => scrollTo(0, y), y); await sleep(1500); await shot(p, 'm-one-' + y); }
    console.log('errors', errors.slice(0, 3)); await ctx.close();
  },
};

// full-page 2x captures + element boxes (CSS px) printed as BOX lines; crop.py cuts the panels out of these
async function full(p, n, sel) {
  await scrub(p); await p.mouse.move(2, 2).catch(() => {}); await sleep(600);
  await p.screenshot({ path: path.join(OUT, n + '.png'), fullPage: true });
  const boxes = await p.evaluate((sel) => [...document.querySelectorAll(sel)].filter((e) => e.offsetParent).map((e) => { const r = e.getBoundingClientRect();
    const h = e.querySelector('h1,h2,h3,h4,.bt-card-head,.panel-head,[class*="title"]'); return [(h ? h.textContent : e.textContent).trim().replace(/\s+/g, ' ').slice(0, 40), Math.round(r.x), Math.round(r.y + scrollY), Math.round(r.width), Math.round(r.height)]; }), sel);
  boxes.filter((x) => x[3] > 200 && x[4] > 80).forEach((x) => console.log('BOX', n, JSON.stringify(x)));
}
scenes.panels = async (b) => {
  let o = await open(b, '/backtests.html#analytics'); await sleep(6000);
  await full(o.p, 'F-k-ana', '#v-analytics .bt-card, #v-analytics .bt-grid, #v-analytics .bt-h2');
  await o.p.evaluate(() => { const t = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Simulation'); t && t.click(); }); await sleep(3000);
  await full(o.p, 'F-k-sim', '#v-analytics .bt-card');
  await o.p.evaluate(() => { location.hash = '#dashboard'; }); await sleep(2500);
  await full(o.p, 'F-k-dash', '#v-dashboard .bt-card, #v-dashboard .bt-kpis');
  await o.ctx.close();
  o = await open(b, '/trade-journal.html'); await sleep(6000);
  await full(o.p, 'F-j-dash', '#tab-dashboard .panel');
  for (const t of ['propfirms', 'ai', 'analytics', 'playbook', 'calendar', 'history']) {
    await o.p.evaluate((t) => { scrollTo(0, 0); document.querySelector('.level-tab[data-tab="' + t + '"]').click(); }, t); await sleep(2200);
    await full(o.p, 'F-j-' + t, '#tab-' + t + ' .panel, #tab-' + t + ' .stat-card, #tab-' + t + ' [class*="card"]');
  }
  await o.ctx.close();
  o = await open(b, '/models.html'); await sleep(6000);
  await o.p.addStyleTag({ content: '*{animation:none!important;transition:none!important}' });
  await o.p.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 400) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 250)); } scrollTo(0, 0); }); await sleep(2000);
  await full(o.p, 'F-m-list', 'main section, main article, main [class*="card"]');
  await o.ctx.close();
  o = await open(b, '/model.html?id=ict-2022-model'); await sleep(6000);
  await o.p.addStyleTag({ content: '*{animation:none!important;transition:none!important}' }); await sleep(500);
  await o.p.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 150)); } scrollTo(0, 0); }); await sleep(1500);
  await full(o.p, 'F-m-one', 'main figure, main table, main [class*="flow"], main [class*="diagram"], main svg, main img');
  await o.ctx.close();
};

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try { for (const [n, fn] of Object.entries(scenes)) if (!ONLY.length || ONLY.includes(n)) { try { await fn(b); } catch (e) { console.log('SCENE FAIL', n, String(e).slice(0, 300)); } } }
  finally { await b.close(); }
})().catch((e) => { console.error(e); process.exit(2); });
