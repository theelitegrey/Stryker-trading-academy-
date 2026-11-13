// REAL-feed probe for GK's "P markers only show while dragging" (12 Nov). Live site, demo account, NQ1! 1m, Big Trades (L2) on defaults.
// Samples the layer with NO input (rendered circles, real bitmap size, visibility, painted pixels), then after a drag, then idle again.
//   flock /tmp/stryker-chrome.lock node tools/tests/bigtrades-real-idle.mjs <outdir>
// LOCAL=1 serves chart files from this worktree (test a fix before it ships).
import fs from 'node:fs';
import dns from 'node:dns/promises';
import { createRequire } from 'node:module';
import { login, BASE } from '../demo-account/lib/browser.mjs';
const { chromium } = createRequire('/root/projects/stryker-trading-academy/package.json')('playwright-core');
const OUT = process.argv[2] || '.', W = Number(process.env.W || 1440), H = Number(process.env.H || 900);
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const G = ['identitytoolkit.googleapis.com', 'securetoken.googleapis.com', 'firestore.googleapis.com', 'www.googleapis.com', 'firebaseinstallations.googleapis.com'];
const rules = (await Promise.all(G.map(async (h) => { try { return 'MAP ' + h + ' ' + (await dns.resolve4(h))[0]; } catch (e) { return ''; } }))).filter(Boolean).join(', ');
const b = await chromium.launch({ executablePath: '/root/.cache/ms-playwright/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=768', '--host-resolver-rules=' + rules] });
const ctx = await b.newContext({ viewport: { width: W, height: H }, colorScheme: process.env.SCHEME || 'dark', deviceScaleFactor: W < 600 ? 2 : 1, isMobile: W < 600, hasTouch: W < 600 });
if (process.env.LOCAL) await ctx.route(/\/assets\/(chart-bigtrades|chart-l2-flow|chart-ts-trades|vela-chart|chart-box-canvas)\.js/, async (r) => {
  const u = new URL(r.request().url()), f = u.pathname.split('/').pop(), v = u.searchParams.get('v');
  r.fulfill({ status: 200, contentType: 'text/javascript', body: fs.readFileSync(new URL('../../assets/' + f, import.meta.url), 'utf8').replace(/\?v=\d+/g, '?v=' + v) });
});
const page = await ctx.newPage();
const hide = () => page.evaluate(() => { let n = 0; for (let k = 0; k < 20; k++) { const e = document.elementFromPoint(700, 450); if (!e || e.tagName === 'CANVAS' || e.closest('.vela-chart, [class*=vela]')) break; let t = e; while (t.parentElement && t.parentElement !== document.body) t = t.parentElement; t.style.display = 'none'; n++; } return n; });
const hook = () => page.evaluate(() => {
  const ch = window.STRYKER_VELA.cells()[0].chart, r0 = ch.renderer, r = r0.extLayers ? r0 : r0.renderer;
  const l = r.extLayers.find((x) => x.channel === 'stk_l2f_big' || (x.def && x.def.id === 'stk_l2f_big')); if (!l) return false;
  const st = window.__bp = { renders: 0, arcs: 0, lastArcs: 0, P: 0, n: 0 }, g = l.canvas.getContext('2d'), arc = g.arc.bind(g);
  g.arc = (...a) => { st.arcs++; return arc(...a); };
  const rend = l.instance.render.bind(l.instance);
  l.instance.render = (a) => { st.a = a; const b0 = st.arcs; st.renders++; const o = rend(a); st.lastArcs = st.arcs - b0; const L = (a.data && a.data.sel && a.data.sel.list) || []; st.n = L.length; st.P = L.filter((x) => x.kind === 'P').length; return o; };
  window.__bpC = l.canvas; window.__bpL = l; return true;
});
const sample = () => page.evaluate(() => { const c = window.__bpC, s = window.__bp, g = c.getContext('2d');
  if (!s.a) return { renders: 0 }; const a = s.a, L = (a && a.data && a.data.sel && a.data.sel.list) || [], vr = a && a.coords.visibleLogicalRange(), t0 = a && a.bars[Math.max(0, Math.floor(vr.from))].time, t1 = a && a.bars[Math.min(a.bars.length - 1, Math.ceil(vr.to))].time;
  const hub = [...(window.__stkL2FlowHubs || new Map()).values()][0], sm = hub ? hub.samples() : [];
  s.dbg = { vis: [new Date(t0).toISOString().slice(11, 16), new Date(t1).toISOString().slice(11, 16)], inView: L.filter((p) => p.ms >= t0 && p.ms <= t1 + 86400000).length, kinds: L.map((p) => (p.kind || '-') + new Date(p.ms).toISOString().slice(8, 16)).join(' '), book: sm.length, bookFrom: sm.length ? new Date(sm[0].ts).toISOString().slice(8, 16) : null, bookTo: sm.length ? new Date(sm[sm.length - 1].ts).toISOString().slice(8, 19) : null }; const real = c.__stkBox ? c.__stkBox.state() : null; return { dbg: s.dbg, renders: s.renders, lastArcs: s.lastArcs, n: s.n, P: s.P, vis: c.style.visibility, real: real && real.real, shown: real && real.shown }; });
const out = {};
try {
  console.log('login', (await login(page)).replace(/\?.*/, '')); await sleep(4000);
  await page.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA, null, { timeout: 90000 });
  await page.evaluate(() => { const c = window.STRYKER_VELA.cells()[0]; c.setSymbol('futures:NQ1!'); c.setTimeframe('1'); }); await sleep(8000);
  await page.evaluate((int) => { const c = window.STRYKER_VELA.cells()[0]; c.chart.addNativeIndicator('stk_l2f_big', { inputs: { intensity: int } }); window.STRYKER_VELA.context().stateChanged(); }, process.env.INT || 'Strong'); await sleep(15000);
  await page.keyboard.press('Escape'); await sleep(500); console.log('hidden', await hide()); console.log('hooked', await hook());
  const idle = async (tag, n) => { for (let i = 0; i < n; i++) { const s = await sample(); console.log(tag, JSON.stringify(s)); (out[tag] = out[tag] || []).push(s); await sleep(3000); } };
  await idle('idle1', 4); await page.screenshot({ path: OUT + '/idle1.png' });
  const box = await page.evaluate(() => { const r = document.querySelector('#vela-chart').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; });
  const x0 = box[0] + box[2] * 0.4, y = box[1] + box[3] * 0.4;
  await page.mouse.move(x0, y); await page.mouse.down(); for (let i = 1; i <= 20; i++) { await page.mouse.move(x0 + i * 12, y); await sleep(30); } await page.screenshot({ path: OUT + '/dragging.png' }); await page.mouse.up();
  await page.mouse.move(box[0] + 5, box[1] + 5);
  await idle('afterdrag', 4); await page.screenshot({ path: OUT + '/idle2.png' });
} catch (e) { console.log('ERR', String(e.stack || e).slice(0, 400)); }
fs.writeFileSync(OUT + '/real-idle.json', JSON.stringify(out, null, 1));
await b.close();
