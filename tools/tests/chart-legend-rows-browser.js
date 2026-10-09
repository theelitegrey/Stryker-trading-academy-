// Charts legend rows browser test (assets/chart-legend-rows.js): every indicator gets a legend
// row (title + eye / cog / ×), GEX Levels included.
//   node tools/tests/chart-dev-server.mjs 8041     (site + /api/chart/bars, binds 127.0.0.1)
//   flock /tmp/stryker-chrome.lock env CHART_BASE=http://127.0.0.1:8041 node tools/tests/chart-legend-rows-browser.js [shotsDir]
// /api/gex/levels/* is answered from tools/tests/fixtures/gex/*.json. Firebase is stubbed (richstub.js).
const fs = require('fs');
const path = require('path');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8041';
const OUT = process.argv[2] || '/tmp';
const FIX = path.join(__dirname, 'fixtures', 'gex');
let fail = 0;
const check = (ok, msg) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(b, ctx0, { w, h, mobile }) {
  const ctx = ctx0 || await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: !!mobile, hasTouch: !!mobile });
  if (!ctx0) {
    await ctx.addInitScript(stub);
    await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); localStorage.setItem('stryker_community_disclaimer_ack_v1', JSON.stringify({ _anon: 1, u1: 1 })); } catch (e) {} });
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|cdn\.jsdelivr\.net)/, (r) => r.abort());
    await ctx.route(/\/api\/gex\/levels\//, (r) => {
      const n = new URL(r.request().url()).pathname.split('/').pop().toUpperCase();
      r.fulfill({ status: 200, contentType: 'application/json', body: fs.readFileSync(path.join(FIX, (n === 'SPX' ? 'SPX' : 'QQQ') + '-0.json')) });
    });
  }
  const p = await ctx.newPage();
  const errors = [];
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_FAILED|net::|status of 4|status of 5/.test(m.text())) errors.push(m.text()); });
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('crash', () => console.log('PAGE CRASHED (renderer)'));
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STRYKER_VELA, null, { timeout: 45000 });
  await waitBars(p);
  return { ctx, p, errors };
}
const waitBars = (p) => p.evaluate(async () => {
  for (let i = 0; i < 80; i++) {
    await new Promise((r) => setTimeout(r, 300));
    try { if (window.STRYKER_VELA.context().cells[0].chart.orchestrator.rawBars.length > 0) return true; } catch (e) {}
  }
  return false;
});
const setSym = async (p, sym, tf) => { await p.evaluate(([s, tf]) => { const ws = window.STRYKER_VELA; const c = ws.cell(ws.context().cells[0].id); c.setSymbol(s); if (tf) c.setTimeframe(tf); }, [sym, tf]); await sleep(2500); await waitBars(p); await sleep(1500); };
// Legend rows of cell 0, top to bottom: { id, title, note, y, hidden }
const rows = (p) => p.evaluate(() => {
  const o = window.STRYKER_VELA.context().cells[0].chart.orchestrator;
  const ui = o.renderer.inputsUI;
  return [...ui.rows.values()].map((r) => { const b = r.el.getBoundingClientRect(); const n = r.el.querySelector('.stk-leg-note');
    return { id: r.id, title: r.titleEl.textContent, note: n ? n.textContent : null, noteVis: n ? n.getBoundingClientRect().width > 0 : false, y: b.top, x: b.left, w: b.width, hidden: r.hidden, vis: b.height > 0 }; })
    .sort((a, b) => a.y - b.y);
});
const gexId = (p) => p.evaluate(() => { const h = window.STRYKER_VELA.context().cells[0].chart.indicators().find((x) => x.nativeType === 'stk_gex'); return h ? h.id : null; });
const gexData = (p) => p.evaluate(() => { for (const c of document.querySelectorAll('canvas')) if (c.__stkGexTags) return c.__stkGexTags.length; return -1; });
const layerData = (p, type) => p.evaluate((t) => { const s = window.STRYKER_VELA.context().cells[0].chart.orchestrator.renderer.scene; const d = s.nativeData.get(t); return d == null ? null : (d.lines ? d.lines.length : 1); }, type);
// Click a row control by aria-label (hover the row first so the controls show).
async function ctl(p, id, label) {
  const box = await p.evaluate((id) => { const r = window.STRYKER_VELA.context().cells[0].chart.orchestrator.renderer.inputsUI.rows.get(id); const b = r.el.getBoundingClientRect(); return { x: b.left + 20, y: b.top + b.height / 2 }; }, id);
  await p.mouse.move(box.x, box.y); await sleep(300);
  await p.evaluate(([id, label]) => { const r = window.STRYKER_VELA.context().cells[0].chart.orchestrator.renderer.inputsUI.rows.get(id); r.el.dispatchEvent(new MouseEvent('click', { bubbles: true })); const b = [...r.el.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') || '') === label); if (!b) throw new Error('no ' + label + ' button: ' + [...r.el.querySelectorAll('button')].map((x) => x.getAttribute('aria-label')).join('|')); b.click(); }, [id, label]);
  await sleep(900);
}
async function shot(p, name, clip) { await sleep(400); await p.screenshot({ path: OUT + '/' + name, clip }); console.log('SHOT ' + OUT + '/' + name); }

(async () => {
  const b = await launch();
  try {
    let { ctx, p, errors } = await open(b, null, { w: 1440, h: 900 });
    await setSym(p, 'futures:ES1!', '5');
    await p.evaluate(() => { window.STRYKER_VELA.context().cells[0].chart.addNativeIndicator('stk_gex'); window.STRYKER_VELA.context().stateChanged(); });
    await sleep(3500);
    let r = await rows(p);
    const vi = r.findIndex((x) => x.title === 'Volume'), gi = r.findIndex((x) => x.title === 'GEX Levels');
    check(gi >= 0 && r[gi].vis, 'GEX Levels has a visible legend row (' + r.map((x) => x.title).join(' | ') + ')');
    check(gi >= 0 && vi >= 0 && gi === vi + 1, 'GEX Levels row sits directly under Volume');
    const note = gi >= 0 ? r[gi].note : null;
    check(/^ES \(from SPX\) 0DTE · updated (just now|\d+ (min|h) ago|\d+ days ago)/.test(note || '') && !/live|real-time|delayed/i.test(note || ''), 'row note, symbol first: ' + note);
    check((await layerData(p, 'stk_gex')) > 0, 'GEX lines pushed');
    await p.mouse.move(700, 600);
    await shot(p, 'legend-gex-1440.png', { x: 0, y: 0, width: 760, height: 260 });
    const id = await gexId(p);
    // eye: hide -> lines gone, row marked hidden; show -> back
    await ctl(p, id, 'Hide');
    r = await rows(p);
    check(r.find((x) => x.id === id).hidden && (await layerData(p, 'stk_gex')) == null, 'eye hides: row hidden, layer data cleared');
    await shot(p, 'legend-gex-hidden-1440.png', { x: 0, y: 0, width: 760, height: 260 });
    await ctl(p, id, 'Show');
    await sleep(1200);
    r = await rows(p);
    const back = r.find((x) => x.id === id);
    check(back && !back.hidden && back.vis && (await layerData(p, 'stk_gex')) > 0, 'eye shows again: row back, lines pushed');
    // cog: settings dialog with the GEX schema
    await ctl(p, id, 'Settings');
    const dlg = await p.evaluate(() => { const d = document.querySelector('.vela-ind-dialog'); return d && d.getBoundingClientRect().width > 0 ? d.textContent.slice(0, 400) : null; });
    check(!!dlg && /Expiry|GEX levels|CALL|Call/i.test(dlg), 'cog opens the GEX settings dialog');
    await shot(p, 'legend-gex-settings-1440.png');
    await p.keyboard.press('Escape'); await sleep(600);
    // order-flow natives stay on raw Core: adding SVP still produces its own row/data.
    await p.evaluate(() => { window.STRYKER_VELA.context().cells[0].chart.addNativeIndicator('stk_svp'); window.STRYKER_VELA.context().stateChanged(); });
    await sleep(2500);
    r = await rows(p);
    check(r.some((x) => x.title === 'Session Volume Profile' || x.title === 'SVP') && (await layerData(p, 'stk_svp')) != null, 'SVP order-flow native still mounts outside the GEX legend wrapper');
    // persistence: browser reload keeps GEX + its row
    await p.evaluate(() => window.STRYKER_VELA.context().stateChanged());
    await sleep(2500);
    const e1 = errors.slice();
    await p.reload({ waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.STRYKER_VELA, null, { timeout: 45000 });
    await waitBars(p);
    await sleep(5000);
    r = await rows(p);
    const g2 = r.find((x) => x.title === 'GEX Levels');
    check(g2 && g2.vis && /ES \(from SPX\) 0DTE · updated/.test(g2.note || ''), 'after reload: GEX row back with note: ' + (g2 && g2.note));
    // remove
    const id2 = await gexId(p);
    await ctl(p, id2, 'Remove indicator');
    r = await rows(p);
    check(!r.some((x) => x.title === 'GEX Levels') && !(await gexId(p)) && (await layerData(p, 'stk_gex')) == null, '× removes GEX (row, indicator and lines gone)');
    check(e1.length === 0 && errors.length === 0, 'no console errors desktop: ' + JSON.stringify(e1.concat(errors).slice(0, 3)));
    try {
    // Pine built-ins get rows. Add from the picker and assert the legend handle appears;
    // do not wait for the heavy scripts to finish drawing, because this suite is about legend rows.
    const pp = await ctx.newPage(); pp.on('crash', () => console.log('CRASH Pine page renderer'));
    await pp.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' }); await pp.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_PINE, null, { timeout: 45000 }); await waitBars(pp);
    const pine = await pp.evaluate(async () => {
      window.STRYKER_VELA.indicatorPicker.open();
      await new Promise((r) => setTimeout(r, 500));
      const top = document.querySelector('.stkiw-tab[data-k="top"]');
      if (top) top.click();
      await new Promise((r) => setTimeout(r, 500));
      const out = [];
      for (const key of ['x:stoic-edge-compass', 'x:wcsmc-sp']) {
        const row = document.querySelector('.stkiw-row[data-key="' + key + '"] .stkiw-name');
        if (!row) { out.push('missing ' + key); continue; }
        row.click();
        const until = Date.now() + 20000;
        while (Date.now() < until) {
          const titles = window.STRYKER_PINE.pineHandles(window.STRYKER_VELA.context().cells[0].chart).map((h) => window.STRYKER_PINE.titleOf(h));
          if ((key.includes('stoic') && titles.some((t) => /Stoic/.test(t))) || (key.includes('wcsmc') && titles.some((t) => /WCSMC/.test(t)))) break;
          await new Promise((r) => setTimeout(r, 300));
        }
        out.push(key);
      }
      try { window.STRYKER_VELA.indicatorPicker.close(); } catch (e) {}
      return out.join(', ');
    });
    await sleep(1500);
    r = await rows(pp);
    check(r.some((x) => /Stoic/.test(x.title) && x.vis), 'Pine built-in Stoic has a legend row (' + r.map((x) => x.title).join(' | ') + ')');
    check(r.some((x) => /WCSMC/.test(x.title) && x.vis), 'Pine built-in WCSMC has a legend row after picker add (' + pine + '; ' + r.map((x) => x.title).join(' | ') + ')');
    } catch (e) { fail++; console.log('FAIL Pine step: ' + String(e).slice(0, 240)); }
    await ctx.close();

    // phone 390
    const m = await open(b, null, { w: 390, h: 844, mobile: true });
    await setSym(m.p, 'futures:ES1!', '5');
    await m.p.evaluate(() => { window.STRYKER_VELA.context().cells[0].chart.addNativeIndicator('stk_gex'); window.STRYKER_VELA.context().stateChanged(); });
    await sleep(3500);
    // the phone legend starts folded ("⌄ N"): the count includes GEX; unfold it
    const fold = await m.p.evaluate(() => { const f = document.querySelector('.vela-ind-fold'); const t = f ? f.textContent : null; if (f) f.click(); return t; });
    check(fold === '2', '390: folded legend counts 2 indicators (Volume + GEX): ' + fold);
    await sleep(700);
    r = await rows(m.p);
    const gm = r.find((x) => x.title === 'GEX Levels');
    check(gm && gm.vis && gm.x >= 0 && gm.x + gm.w <= 390, '390: GEX row visible and inside the screen (' + (gm && [gm.x, gm.w].join('/')) + ', note ' + (gm && gm.note) + ')');
    const sw = await m.p.evaluate(() => document.documentElement.scrollWidth);
    check(sw <= 390, '390: no sideways overflow (' + sw + ')');
    await shot(m.p, 'legend-gex-390.png');
    check(m.errors.length === 0, 'no console errors phone: ' + JSON.stringify(m.errors.slice(0, 3)));
    await m.ctx.close();
  } catch (e) { fail++; console.log('FAIL exception ' + (e && e.stack || e)); }
  await b.close();
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
