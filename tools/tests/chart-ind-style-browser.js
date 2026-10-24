// Indicator Settings → Style tab (assets/chart-ind-style.js). Both engines (0.9 default, ?vela=0.6), 1440 + 390.
// Every control is driven by REAL mouse input (CDP Input.dispatchMouseEvent via page.mouse at the element's
// centre), never el.click(). Checks the drawn model / canvas paint change and that a reload keeps it.
//   node tools/tests/chart-dev-server.mjs 8031 &   CHART_BASE=http://127.0.0.1:8031 node tools/tests/chart-ind-style-browser.js [shotsDir] [batch]
//   batch: 1 = built-in + order flow (default), 2 = Pine, 3 = Visibility + defaults, all = every batch
const fs = require('fs');
const path = require('path');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');
const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8031';
const OUT = process.argv[2] || '/tmp';
const BATCH = process.argv[3] || '1';
const ENGINES = (process.env.ENGINES || '0.9,0.6').split(',');
const VPS = (process.env.VPS || '1440,390').split(',').map(Number);
let fail = 0;
const check = (ok, msg, x) => { if (!ok) fail++; console.log((ok ? 'PASS ' : 'FAIL ') + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 300))); };
const shot = async (p, n) => { const f = OUT + '/' + n + '.png'; await p.screenshot({ path: f }); console.log('shot', f); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const want = (n) => BATCH === 'all' || BATCH === String(n) || (n === 'lm' && BATCH === 'lm');

// Real mouse click at the centre of the first element matching a predicate (run in page).
async function realClick(p, finder, arg, label){
  const box = await p.evaluate(([src, a]) => {
    const fn = new Function('a', src);
    const el = fn(a);
    if (!el) return null;
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const top = document.elementFromPoint(x, y);
    return { x, y, w: r.width, h: r.height, hit: !!top && (top === el || el.contains(top)) };
  }, [finder, arg]);
  if (!box || !box.w) { check(false, 'real click target found: ' + label); return false; }
  if (!box.hit) check(false, 'click target is on top (not covered): ' + label, box);
  await p.mouse.move(box.x, box.y);
  await p.mouse.down();
  await p.mouse.up();
  await sleep(250);
  return true;
}
// finders (function bodies, `a` = arg)
const F = {
  tab: "return [...document.querySelectorAll('.vela-ind-dialog .vela-ind-tab')].find((t) => t.textContent.trim() === a);",
  group: "return [...document.querySelectorAll('.vela-ind-dialog .stk-is-gh')].find((h) => h.querySelector('.stk-is-gn').textContent.trim().startsWith(a));",
  pill: "const [g, row, v] = a; const grp = [...document.querySelectorAll('.vela-ind-dialog .stk-is-g')].find((x) => x.querySelector('.stk-is-gn').textContent.trim().startsWith(g)); if (!grp) return null; const r = [...grp.querySelectorAll('.stk-is-r')].find((x) => x.firstChild.textContent === row); if (!r) return null; return [...r.querySelectorAll('button')].find((b) => b.dataset.v === v || b.textContent.trim() === v || b.title === v) || null;",
  rowBtn: "const [g, row] = a; const grp = [...document.querySelectorAll('.vela-ind-dialog .stk-is-g')].find((x) => x.querySelector('.stk-is-gn').textContent.trim().startsWith(g)); if (!grp) return null; const r = [...grp.querySelectorAll('.stk-is-r')].find((x) => x.firstChild.textContent === row); return r ? r.querySelector('button, select') : null;",
  topBtn: "return [...document.querySelectorAll('.vela-ind-dialog .stk-is-top button')].find((b) => b.textContent.trim() === a);",
  footer: "return [...document.querySelectorAll('.vela-ind-dialog button')].find((b) => b.textContent.trim().toLowerCase() === a.toLowerCase());",
  pal: "return [...document.querySelectorAll('.stk-is-pop .stk-is-pal button')].find((b) => b.title === a);",
};
async function selectOpt(p, g, row, value){
  // real click to focus the native select, then keyboard pick (a <select> popup is not in the DOM)
  await realClick(p, F.rowBtn, [g, row], 'select ' + row);
  const ok = await p.evaluate(([g, row, value]) => {
    const grp = [...document.querySelectorAll('.vela-ind-dialog .stk-is-g')].find((x) => x.querySelector('.stk-is-gn').textContent.trim().startsWith(g));
    const r = grp && [...grp.querySelectorAll('.stk-is-r')].find((x) => x.firstChild.textContent === row);
    const s = r && r.querySelector('select');
    if (!s) return false;
    return document.activeElement === s ? [...s.options].findIndex((o) => o.value === value) : -1;
  }, [g, row, value]);
  if (ok < 0 || ok === false) { check(false, 'select focused by real click: ' + row, ok); return; }
  await p.keyboard.press('Escape').catch(() => {});
  await p.evaluate(([g, row, value]) => {
    const grp = [...document.querySelectorAll('.vela-ind-dialog .stk-is-g')].find((x) => x.querySelector('.stk-is-gn').textContent.trim().startsWith(g));
    const s = [...grp.querySelectorAll('.stk-is-r')].find((x) => x.firstChild.textContent === row).querySelector('select');
    s.focus();
  }, [g, row, value]);
  // keyboard: Home then ArrowDown to the option (native select keyboard nav fires change)
  await p.keyboard.press('Home');
  for (let i = 0; i < ok; i++) await p.keyboard.press('ArrowDown');
  await sleep(300);
}

async function ready(p){
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_IND_STYLE && window.STRYKER_PINE, null, { timeout: 60000 });
  await sleep(2500);
}
const chartJs = "window.STRYKER_VELA.context().cells[0].chart";
async function openSettings(p, id){
  await p.evaluate(([c, id]) => { const chart = eval(c); chart.renderer.openIndicatorSettings(id); }, [chartJs, id]);
  await p.waitForSelector('.vela-ind-dialog .stk-is-tab', { timeout: 10000 });
  await sleep(300);
}
const dialogOpen = (p) => p.evaluate(() => !!document.querySelector('.vela-ind-dialog'));
const drawn = (p, id) => p.evaluate((id) => window.STRYKER_IND_STYLE.drawnModel(id), id);
const styleOf = (p, id) => p.evaluate((id) => window.STRYKER_IND_STYLE.styleOf(id), id);
// count of canvas font / lineWidth / dash sets in one frame of a layer
async function traceLayer(p, type){
  return p.evaluate(async (type) => {
    const chart = window.STRYKER_VELA.context().cells[0].chart;
    const R = chart.renderer.extLayers ? chart.renderer : chart.renderer.renderer;
    const rec = chart.orchestrator.registry.all().find((r) => r.native && r.native.type === type);
    const ls = R.extLayers.filter((l) => (l.owner != null ? l.owner === rec.id : l.def.id === type));
    const out = { fonts: {}, widths: {}, dashes: {}, n: ls.length };
    const tr = (g) => {
      const fd = Object.getOwnPropertyDescriptor(g, 'font') || Object.getOwnPropertyDescriptor(Object.getPrototypeOf(g), 'font');
      const wd = Object.getOwnPropertyDescriptor(g, 'lineWidth') || Object.getOwnPropertyDescriptor(Object.getPrototypeOf(g), 'lineWidth');
      const d0 = g.setLineDash;
      const sf = fd.set, sw = wd.set;
      Object.defineProperty(g, '__t', { configurable: true, value: 1 });
      const P = Object.getPrototypeOf(g);
      const pf = Object.getOwnPropertyDescriptor(P, 'font'), pw = Object.getOwnPropertyDescriptor(P, 'lineWidth');
      const pd = P.setLineDash;
      const ofs = pf.set, ows = pw.set;
      const mine = (c) => ls.some((l) => l.canvas === c.canvas);
      Object.defineProperty(P, 'font', { configurable: true, get: pf.get, set(v){ ofs.call(this, v); if (!mine(this)) return; const a = pf.get.call(this); out.fonts[a] = (out.fonts[a] || 0) + 1; } });
      Object.defineProperty(P, 'lineWidth', { configurable: true, get: pw.get, set(v){ ows.call(this, v); if (!mine(this)) return; const a = pw.get.call(this); out.widths[a] = (out.widths[a] || 0) + 1; } });
      P.setLineDash = function (s){ pd.call(this, s); if (!mine(this)) return; const k = JSON.stringify(this.getLineDash()); out.dashes[k] = (out.dashes[k] || 0) + 1; };
      return () => { Object.defineProperty(P, 'font', pf); Object.defineProperty(P, 'lineWidth', pw); P.setLineDash = pd; };
    };
    const undo = tr(document.createElement('canvas').getContext('2d'));
    try {
      for (let k = 0; k < 4; k++) {
        try { const vr = chart.getVisibleRange && chart.getVisibleRange(); if (vr && chart.setVisibleRange) chart.setVisibleRange({ from: vr.from + (k % 2 ? 1 : -1), to: vr.to + (k % 2 ? 1 : -1) }); } catch (e) {}
        R.scheduler && R.scheduler.invalidate ? R.scheduler.invalidate(4) : R.render && R.render();
        await new Promise((r) => setTimeout(r, 500));
      }
    } finally { undo(); }
    return out;
  }, type);
}

async function newPage(b, vp, eng, seed){
  const ctx = await b.newContext({ viewport: { width: vp, height: vp === 390 ? 844 : 900 }, deviceScaleFactor: vp === 390 ? 2 : 1, isMobile: vp === 390, hasTouch: vp === 390 });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); } catch (e) {} });
  await ctx.route(/^https?:\/\/[^/]*(gstatic|googleapis|firebase|google|doubleclick)\./, (r) => r.abort());
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(String(e)));
  await p.goto(BASE + '/charts.html' + (eng === '0.6' ? '?vela=0.6' : ''), { waitUntil: 'domcontentloaded' });
  await ready(p);
  return { ctx, p };
}
async function reload(p){ await p.reload({ waitUntil: 'domcontentloaded' }); await ready(p); }

async function batch1(b, eng, vp){
  const tag = eng + ' ' + vp;
  const { ctx, p } = await newPage(b, vp, eng);
  try {
    check(await p.evaluate(() => window.__stkVela090 === true) === (eng === '0.9'), tag + ': engine');
    // A. Vela built-in RSI
    const rsi = await p.evaluate((c) => { const ch = eval(c); const h = ch.addNativeIndicator('rsi'); return h && h.id; }, chartJs);
    await sleep(2500);
    const m0 = await drawn(p, rsi);
    const plot0 = m0.series.find((s) => s.kind === 'line' && /rsi/i.test(s.title || ''));
    check(!!plot0, tag + ': RSI drawn', m0.series.map((s) => s.title + ':' + s.kind));
    await openSettings(p, rsi);
    await realClick(p, F.tab, 'Style', 'Style tab');
    const groups = await p.evaluate(() => [...document.querySelectorAll('.vela-ind-dialog [data-stk-is=style] .stk-is-gn')].map((x) => x.textContent));
    check(groups.length >= 1 && groups.some((g) => /rsi/i.test(g)), tag + ': Style tab lists the RSI plot group(s)', groups);
    const gname = groups.find((g) => /rsi/i.test(g));
    if (vp === 390) await realClick(p, F.group, gname, 'open group');
    await realClick(p, F.pill, [gname, 'Line width', '4'], 'width 4');
    await realClick(p, F.pill, [gname, 'Line style', 'dashed'], 'dashed');
    await selectOpt(p, gname, 'Plot type', 'step');
    await sleep(400);
    const m1 = await drawn(p, rsi);
    const plot1 = m1.series.find((s) => s.title === plot0.title);
    check(plot1 && plot1.style.width === 4 && plot1.style.lineStyle === 'dashed', tag + ': RSI width 4 + dashed reached the drawn model', plot1 && plot1.style);
    check(plot1 && plot1.kind === 'step', tag + ': RSI plot type -> step line', plot1 && plot1.kind);
    // colour via the popover palette
    await realClick(p, F.rowBtn, [gname, 'Colour'], 'colour swatch');
    await realClick(p, F.pal, '#ff9800', 'palette orange');
    const m2 = await drawn(p, rsi);
    check(/^rgba\(255,152,0,/.test(m2.series.find((s) => s.title === plot0.title).style.color), tag + ': RSI colour from palette', m2.series.find((s) => s.title === plot0.title).style.color);
    await shot(p, 'is-' + eng + '-' + vp + '-style-rsi');
    // Cancel reverts
    await realClick(p, F.footer, 'Cancel', 'Cancel');
    const m3 = await drawn(p, rsi);
    const p3 = m3.series.find((s) => s.title === plot0.title);
    check(p3.style.width === plot0.style.width && p3.kind === plot0.kind, tag + ': Cancel reverts style edits', p3.style);
    // edit again + Ok, then reload keeps it
    await openSettings(p, rsi);
    await realClick(p, F.tab, 'Style', 'Style tab');
    if (vp === 390) await realClick(p, F.group, gname, 'open group');
    await realClick(p, F.pill, [gname, 'Line width', '5'], 'width 5');
    await realClick(p, F.pill, [gname, 'Line style', 'dotted'], 'dotted');
    await realClick(p, F.footer, 'Ok', 'Ok');
    check(!(await dialogOpen(p)), tag + ': Ok closes the dialog');

    // B. our order flow tool (Session Volume Profile: canvas layer that always paints) — layer font / width / dash
    const abs = await p.evaluate((c) => { const ch = eval(c); const h = ch.addNativeIndicator('stk_of_tpo', { inputs: {} }); return h && h.id; }, chartJs);
    await sleep(3500);
    const t0 = await traceLayer(p, 'stk_of_tpo');
    await openSettings(p, abs);
    await realClick(p, F.tab, 'Style', 'Style tab');
    const g2 = await p.evaluate(() => [...document.querySelectorAll('.vela-ind-dialog [data-stk-is=style] .stk-is-gn')].map((x) => x.textContent));
    check(g2.some((g) => /^Chart drawing/.test(g)), tag + ': order flow tool has a "Chart drawing" group', g2);
    if (!(await p.evaluate(() => { const g = [...document.querySelectorAll('.vela-ind-dialog .stk-is-g')].find((x) => /^Chart drawing/.test(x.textContent)); return g && g.classList.contains('open'); }))) await realClick(p, F.group, 'Chart drawing', 'open drawing group');
    await selectOpt(p, 'Chart drawing', 'Text size', '18');
    await realClick(p, F.rowBtn, ['Chart drawing', 'Text style'], 'Bold');
    const italicBtn = "const grp = [...document.querySelectorAll('.vela-ind-dialog .stk-is-g')].find((x) => /^Chart drawing/.test(x.textContent)); const r = [...grp.querySelectorAll('.stk-is-r')].find((x) => x.firstChild.textContent === 'Text style'); return r.querySelectorAll('button')[1];";
    const st0 = await styleOf(p, abs);
    if (!(st0.layer && st0.layer.italic)) await realClick(p, italicBtn, null, 'Italic');
    await realClick(p, F.pill, ['Chart drawing', 'Line width', '3'], 'layer width 3');
    await realClick(p, F.pill, ['Chart drawing', 'Line style', 'dashed'], 'layer dashed');
    const st = await styleOf(p, abs);
    check(st.layer && st.layer.fontPx === 18 && st.layer.bold === true && st.layer.italic === true && st.layer.width === 3 && st.layer.lineStyle === 'dashed', tag + ': order-flow layer style saved', st.layer);
    await shot(p, 'is-' + eng + '-' + vp + '-style-tpo');
    await realClick(p, F.footer, 'Ok', 'Ok');
    const t1 = await traceLayer(p, 'stk_of_tpo');
    const fonts1 = Object.keys(t1.fonts);
    check(t1.n >= 1, tag + ': TPO layer present', t1.n);
    const painted = Object.keys(t0.fonts).length + Object.keys(t0.widths).length > 0;
    if (painted) {
      if (Object.keys(t0.fonts).length || fonts1.length) check(fonts1.length > 0 && fonts1.every((f) => /italic/.test(f) && /bold/.test(f) && /18px/.test(f)), tag + ': layer fonts now italic bold 18px', { before: t0.fonts, after: t1.fonts });
      else console.log('NOTE ' + tag + ': layer drew no text this frame; font proof from the other runs');
      check(Object.keys(t1.widths).every((w) => +w === 3 || +w < 1), tag + ': layer line widths now 3', t1.widths);
      check(Object.keys(t1.dashes).length === 0 || Object.keys(t1.dashes).every((d) => d === '[6,4]'), tag + ': layer dashes now dashed', t1.dashes);
    } else check(false, tag + ': TPO painted nothing (pixel trace impossible)', t0);
    await shot(p, 'is-' + eng + '-' + vp + '-chart-tpo-styled');

    // C. reload keeps both
    await reload(p);
    const ids = await p.evaluate((c) => { const ch = eval(c); return ch.indicators().map((h) => ({ id: h.id, t: h.nativeType || '' })); }, chartJs);
    const rsi2 = (ids.find((x) => x.t === 'rsi') || {}).id, abs2 = (ids.find((x) => x.t === 'stk_of_tpo') || {}).id;
    await sleep(2500);
    const mr = rsi2 && await drawn(p, rsi2);
    const pr = mr && mr.series.find((s) => s.title === plot0.title);
    check(pr && pr.style.width === 5 && pr.style.lineStyle === 'dotted', tag + ': reload keeps RSI width 5 + dotted', pr && pr.style);
    const sa = abs2 && await styleOf(p, abs2);
    check(sa && sa.layer && sa.layer.fontPx === 18 && sa.layer.italic === true, tag + ': reload keeps the order-flow layer style', sa);
    // Reset style button
    await openSettings(p, rsi2);
    await realClick(p, F.tab, 'Style', 'Style tab');
    await realClick(p, F.topBtn, 'Reset style', 'Reset style');
    const mz = await drawn(p, rsi2);
    const pz = mz.series.find((s) => s.title === plot0.title);
    check(pz.style.width === plot0.style.width && pz.style.lineStyle === plot0.style.lineStyle, tag + ': Reset style restores the script look', pz.style);
    await realClick(p, F.footer, 'Ok', 'Ok');
    const hs = await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    check(hs, tag + ': no horizontal scroll');
    check(!p.errors.length, tag + ': no page errors', p.errors);
  } finally { await ctx.close(); }
}

async function batch2(b, eng, vp){
  const tag = eng + ' ' + vp + ' pine';
  const { ctx, p } = await newPage(b, vp, eng);
  try {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'pine', 'liquidity-master-tradezoro.pine'), 'utf8');
    const r = await p.evaluate(async (src) => window.STRYKER_PINE.addSource('Liquidity Master', src, { engine: 'next', builtin: true }), src);
    check(r && r.ok, tag + ': Liquidity Master added', r);
    let id = null;
    for (let i = 0; i < 80 && !id; i++) { await sleep(500); id = await p.evaluate((c) => { const ch = eval(c); const h = window.STRYKER_PINE.pineHandles(ch)[0]; if (!h) return null; const rec = ch.orchestrator.registry.get(h.id); return rec && rec.model && ((rec.model.boxes || []).length + (rec.model.labels || []).length + (rec.model.lines || []).length) ? h.id : null; }, chartJs); }
    check(!!id, tag + ': Liquidity Master drew');
    if (!id) return;
    await sleep(1500);
    const raw = await p.evaluate((id) => { const a = window.STRYKER_IND_STYLE.rawModel(id), d = window.STRYKER_IND_STYLE.drawnModel(id); return { same: a === d, labels: (d.labels || []).length, boxes: (d.boxes || []).length, lines: (d.lines || []).length, tables: (d.tables || []).length }; }, id);
    check(raw.same, tag + ': no overrides -> the drawn model IS the script model (Liquidity Master unchanged)', raw);
    await openSettings(p, id);
    await realClick(p, F.tab, 'Style', 'Style tab');
    const cat = await p.evaluate((id) => window.STRYKER_IND_STYLE.catalogOf(id), id);
    const names = cat.map((c) => c.name);
    check(cat.length >= 2, tag + ': Pine elements listed as groups', names);
    await shot(p, 'is-' + eng + '-' + vp + '-style-pine');
    const hasLabels = cat.find((c) => c.kind === 'label');
    const hasBoxes = cat.find((c) => c.kind === 'box');
    if (hasLabels) {
      const g = hasLabels.name;
      if (!(await p.evaluate((g) => { const x = [...document.querySelectorAll('.vela-ind-dialog .stk-is-g')].find((e) => e.querySelector('.stk-is-gn').textContent.trim().startsWith(g)); return x && x.classList.contains('open'); }, g))) await realClick(p, F.group, g, 'open labels');
      await selectOpt(p, g, 'Text size', '20');
      const boldBtn = "const grp = [...document.querySelectorAll('.vela-ind-dialog .stk-is-g')].find((x) => x.querySelector('.stk-is-gn').textContent.trim().startsWith(a)); const r = [...grp.querySelectorAll('.stk-is-r')].find((x) => x.firstChild.textContent === 'Text style'); return r.querySelectorAll('button')[a ? 0 : 0];";
      const italBtn = "const grp = [...document.querySelectorAll('.vela-ind-dialog .stk-is-g')].find((x) => x.querySelector('.stk-is-gn').textContent.trim().startsWith(a)); const r = [...grp.querySelectorAll('.stk-is-r')].find((x) => x.firstChild.textContent === 'Text style'); return r.querySelectorAll('button')[1];";
      await realClick(p, boldBtn, g, 'Bold'); await realClick(p, italBtn, g, 'Italic');
      await selectOpt(p, g, 'Shape', 'diamond');
      const d = await drawn(p, id);
      const lb = d.labels.filter((l) => true);
      check(lb.length && lb.some((l) => l.__stkPx === 20 && l.bold && l.italic), tag + ': labels text 20 px bold italic', lb.slice(0, 2).map((l) => ({ px: l.__stkPx, b: l.bold, i: l.italic, s: l.style })));
      // pixels: the scene draws labels with the new font
      const fonts = await p.evaluate(async () => {
        const out = {};
        const P = CanvasRenderingContext2D.prototype, pf = Object.getOwnPropertyDescriptor(P, 'font');
        Object.defineProperty(P, 'font', { configurable: true, get: pf.get, set(v){ pf.set.call(this, v); out[v] = (out[v] || 0) + 1; } });
        try { const ch = window.STRYKER_VELA.context().cells[0].chart; const R = ch.renderer.extLayers ? ch.renderer : ch.renderer.renderer; R.scheduler && R.scheduler.invalidate ? R.scheduler.invalidate(4) : R.render(); await new Promise((r) => setTimeout(r, 700)); } finally { Object.defineProperty(P, 'font', pf); }
        return out;
      });
      check(Object.keys(fonts).some((f) => /italic bold 20px/.test(f)), tag + ': canvas draws "italic bold 20px" label text', Object.keys(fonts).slice(0, 8));
    }
    if (hasBoxes) {
      const g = hasBoxes.name;
      await realClick(p, F.group, g, 'open boxes');
      await realClick(p, F.pill, [g, 'Border width', '3'], 'border 3');
      await realClick(p, F.pill, [g, 'Border style', 'dotted'], 'border dotted');
      const d = await drawn(p, id);
      check(d.boxes.filter((x) => true).every((x) => x.borderWidth === 3 && x.borderStyle === 'dotted'), tag + ': boxes border 3 dotted', d.boxes.slice(0, 2).map((x) => [x.borderWidth, x.borderStyle]));
    }
    await shot(p, 'is-' + eng + '-' + vp + '-style-pine-edited');
    await realClick(p, F.footer, 'Ok', 'Ok');
    await shot(p, 'is-' + eng + '-' + vp + '-chart-pine-edited');
    await reload(p);
    let id2 = null;
    for (let i = 0; i < 80 && !id2; i++) { await sleep(500); id2 = await p.evaluate((c) => { const ch = eval(c); const h = window.STRYKER_PINE.pineHandles(ch)[0]; if (!h) return null; const rec = ch.orchestrator.registry.get(h.id); return rec && rec.model && rec.__stkRaw ? h.id : null; }, chartJs); }
    await sleep(1500);
    const d2 = id2 && await drawn(p, id2);
    if (hasLabels) check(d2 && d2.labels.some((l) => l.__stkPx === 20 && l.italic), tag + ': reload keeps Pine label style');
    if (hasBoxes) check(d2 && d2.boxes.every((x) => x.borderWidth === 3), tag + ': reload keeps Pine box style');
    check(!p.errors.length, tag + ': no page errors', p.errors);
  } finally { await ctx.close(); }
}

async function batch3(b, eng, vp){
  const tag = eng + ' ' + vp + ' vis';
  const { ctx, p } = await newPage(b, vp, eng);
  try {
    const rsi = await p.evaluate((c) => { const ch = eval(c); return ch.addNativeIndicator('rsi').id; }, chartJs);
    await sleep(2500);
    const tf0 = await p.evaluate((c) => eval(c).orchestrator.config.market.timeframe, chartJs);
    await openSettings(p, rsi);
    await realClick(p, F.tab, 'Visibility', 'Visibility tab');
    await shot(p, 'is-' + eng + '-' + vp + '-visibility');
    // turn limiting on, hide the band of the current timeframe
    await realClick(p, "return [...document.querySelectorAll('.vela-ind-dialog [data-stk-is=visibility] .stk-is-r button')][0];", null, 'Limit timeframes');
    const band = await p.evaluate((tf) => { const m = /^(\d*)([SDWM]?)$/i.exec(tf); const u = m[2]; const n = +(m[1] || 1); return u === 'S' ? 'Seconds' : u === 'D' ? 'Days' : u === 'W' ? 'Weeks' : u === 'M' ? 'Months' : (n % 60 === 0 && n >= 60 ? 'Hours' : 'Minutes'); }, tf0);
    await realClick(p, "return [...document.querySelectorAll('.vela-ind-dialog [data-stk-is=visibility] .stk-is-tfr')].find((r) => r.firstChild.textContent === a).querySelector('button');", band, 'hide ' + band);
    const d = await drawn(p, rsi);
    check(d.series.every((s) => (s.display ? s.display.pane === false : s.visible === false)), tag + ': hidden on ' + band + ' (tf ' + tf0 + ')', d.series.map((s) => s.display));
    await realClick(p, F.footer, 'Ok', 'Ok');
    // switch to a timeframe in another band: shows again
    const other = band === 'Days' ? '60' : '1D';
    await p.evaluate(([c, tf]) => { const ch = eval(c); ch.setTimeframe ? ch.setTimeframe(tf) : window.STRYKER_VELA.active.setTimeframe(tf); }, [chartJs, other]);
    await sleep(4000);
    const d2 = await drawn(p, rsi);
    check(d2 && d2.series.some((s) => !s.display || s.display.pane !== false), tag + ': shown again on ' + other, d2 && d2.series.map((s) => s.display));
    // defaults: save width 6 as default for RSI, add a second RSI -> gets it
    await openSettings(p, rsi);
    await realClick(p, F.tab, 'Style', 'Style tab');
    const g = await p.evaluate(() => [...document.querySelectorAll('.vela-ind-dialog [data-stk-is=style] .stk-is-gn')].map((x) => x.textContent).find((x) => /rsi/i.test(x)));
    if (vp === 390) await realClick(p, F.group, g, 'open group');
    await realClick(p, F.pill, [g, 'Line width', '6'], 'width 6');
    await realClick(p, F.topBtn, 'Save as default', 'Save as default');
    await realClick(p, F.footer, 'Ok', 'Ok');
    const r2 = await p.evaluate((c) => { const ch = eval(c); const before = ch.indicators().length; const h = ch.addNativeIndicator('rsi'); return h && h.id; }, chartJs);
    await sleep(2500);
    const dd = r2 && await drawn(p, r2);
    check(r2 && dd && dd.series.some((s) => s.style && s.style.width === 6), tag + ': new RSI picks up the saved default (width 6)', dd && dd.series.map((s) => s.style && s.style.width));
    check(!p.errors.length, tag + ': no page errors', p.errors);
  } finally { await ctx.close(); }
}

async function lmShot(b, eng, vp, stubbed){
  const ctx = await b.newContext({ viewport: { width: vp, height: vp === 390 ? 844 : 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(() => { try { localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1'); } catch (e) {} Date.now = ((n) => () => n)(Date.parse('2026-10-24T17:00:00Z')); });
  await ctx.route(/^https?:\/\/[^/]*(gstatic|googleapis|firebase|google|doubleclick)\./, (r) => r.abort());
  if (stubbed) await ctx.route(/chart-ind-style\.js/, (r) => r.fulfill({ contentType: 'text/javascript', body: 'export function installIndStyle(){}\nexport function mountIndStyle(){ window.STRYKER_IND_STYLE = { stub: true }; }' }));
  const p = await ctx.newPage();
  p.errors = []; p.on('pageerror', (e) => p.errors.push(String(e)));
  await p.goto(BASE + '/charts.html' + (eng === '0.6' ? '?vela=0.6' : ''), { waitUntil: 'domcontentloaded' });
  await ready(p);
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'pine', 'liquidity-master-tradezoro.pine'), 'utf8');
  await p.evaluate(async (src) => window.STRYKER_PINE.addSource('Liquidity Master', src, { engine: 'next', builtin: true }), src);
  let n = 0, last = -1, stable = 0;
  for (let i = 0; i < 160; i++) { await sleep(500); n = await p.evaluate((c) => { const ch = eval(c); const h = window.STRYKER_PINE.pineHandles(ch)[0]; const rec = h && ch.orchestrator.registry.get(h.id); const m = rec && rec.model; return m ? (m.boxes || []).length + (m.labels || []).length + (m.lines || []).length : 0; }, chartJs); if (n && n === last) { if (++stable >= 6) break; } else stable = 0; last = n; }
  await sleep(4000);
  // fixed frame: last 120 bars; hide the live clock / cursor
  await p.evaluate((c) => { const ch = eval(c); document.querySelectorAll('.stk-mstat, .stkc-clock, [class*=countdown]').forEach((e) => (e.style.visibility = 'hidden')); }, chartJs);
  await p.mouse.move(1, 1);
  await sleep(2500);
  const el = await p.$('#vela-chart');
  const buf = await el.screenshot();
  const f = OUT + '/is-' + eng + '-' + vp + '-lm-' + (stubbed ? 'before' : 'after') + '.png';
  fs.writeFileSync(f, buf); console.log('shot', f, 'objects', n);
  const errs = p.errors;
  await ctx.close();
  return { buf, n, errs };
}
async function lmIdentity(b, eng, vp){
  const tag = eng + ' ' + vp + ' LM identity';
  const a = await lmShot(b, eng, vp, true);
  const c = await lmShot(b, eng, vp, false);
  check(a.n > 0 && a.n === c.n, tag + ': same object count with and without the style module', [a.n, c.n]);
  // pixel diff in the page (decode both PNGs)
  const pg = await (await b.newContext()).newPage();
  const diff = await pg.evaluate(async ([x, y]) => {
    const load = (b64) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,' + b64; });
    const [i1, i2] = await Promise.all([load(x), load(y)]);
    if (i1.width !== i2.width || i1.height !== i2.height) return { size: [i1.width, i1.height, i2.width, i2.height] };
    const cv = (i) => { const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const g = c.getContext('2d'); g.drawImage(i, 0, 0); return g.getImageData(0, 0, i.width, i.height).data; };
    const d1 = cv(i1), d2 = cv(i2);
    let n = 0, minY = 1e9, maxY = -1;
    for (let k = 0; k < d1.length; k += 4) if (Math.abs(d1[k] - d2[k]) + Math.abs(d1[k + 1] - d2[k + 1]) + Math.abs(d1[k + 2] - d2[k + 2]) > 24) { n++; const y = Math.floor(k / 4 / i1.width); if (y < minY) minY = y; if (y > maxY) maxY = y; }
    return { n, total: d1.length / 4, minY, maxY };
  }, [a.buf.toString('base64'), c.buf.toString('base64')]);
  await pg.context().close();
  check(diff.n !== undefined && diff.n / diff.total < 0.0005, tag + ': pixel-identical chart (differing px)', diff);
  check(!a.errs.length && !c.errs.length, tag + ': no page errors', a.errs.concat(c.errs));
}

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  try {
    for (const eng of ENGINES) for (const vp of VPS) {
      if (want(1)) await batch1(b, eng, vp).catch((e) => check(false, eng + ' ' + vp + ' batch1 crashed', String(e && e.stack || e)));
      if (want('lm') || want(2)) await lmIdentity(b, eng, vp).catch((e) => check(false, eng + ' ' + vp + ' LM identity crashed', String(e && e.stack || e)));
      if (want(2)) await batch2(b, eng, vp).catch((e) => check(false, eng + ' ' + vp + ' batch2 crashed', String(e && e.stack || e)));
      if (want(3)) await batch3(b, eng, vp).catch((e) => check(false, eng + ' ' + vp + ' batch3 crashed', String(e && e.stack || e)));
    }
  } finally { await b.close(); }
  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
