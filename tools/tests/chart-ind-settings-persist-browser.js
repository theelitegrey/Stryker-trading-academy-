// Indicator settings STICK (Owner 2026-10-26: "Changes I make to indicator settings like not showing
// watermark or some other line, not working properly. For example in Liquidity Master, watermark and
// equal high are showing up again even when de-selected from options.").
//
// Root cause it guards (assets/chart-pine.js cleanEntry): a restored Pine entry kept only its FIRST 100
// inputs. Liquidity Master has 190, so Watermark (#188), Relative equal highs / lows (#164) and the
// draw-on-liquidity tables (#140) came back at their defaults on every reload / layout / template,
// while the early inputs (sessions) stuck. Built-ins over 64 KB were dropped from a reload altogether.
//
// Every setting is changed with REAL input: taps (touchscreen, 390x844 phone) or mouse clicks (1440) on
// the legend row's cog, the dialog's switches and fields, Ok. Then the chart goes through each event the
// Owner may hit, and after each one every changed input must still hold, on the handle AND in the drawn
// model (the watermark table and the REQH / REQL drawings must stay gone):
//   immediately · live bar ticks pumped to the scripts · bar replay start, 3 steps, exit ·
//   timeframe change · symbol change · full screen on / off · bottom nav handle open / close (phone) ·
//   Style / Visibility tabs opened and closed (Ok and Cancel) · GEX layer redraw (its own setting
//   changed, history reload) · page reload (the saved workspace document).
// Indicators: Liquidity Master [TradeZoro] (6 inputs + one Style change), Trend Average (Zeiierman)
// (one input), GEX Levels (one input). Fixture bars only (chart-fixture-server.mjs), GEX from the saved
// fixtures; no market-data vendor is called.
//
//   node tools/tests/chart-fixture-server.mjs 8093 <bars fixture.json> &
//   flock /tmp/stryker-chrome.lock env CHART_BASE=http://127.0.0.1:8093 ENG=0.9|0.6 VP=390|1440 OUT=<dir> \
//     node tools/tests/chart-ind-settings-persist-browser.js
const fs = require('fs');
const path = require('path');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');

const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8093';
const ENG = process.env.ENG || '0.9';
const VP = Number(process.env.VP || 390);
const OUT = process.env.OUT || '/tmp/ind-settings-persist';
const PHONE = VP < 500;
const TAG = ENG + ' ' + VP;
fs.mkdirSync(OUT, { recursive: true });
const GEX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'gex', 'QQQ-0.json'), 'utf8'));

let fails = 0;
const check = (ok, msg, x) => { if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + '[' + TAG + '] ' + msg + (x === undefined ? '' : ' ' + JSON.stringify(x).slice(0, 400))); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LM = 'Liquidity Master [TradeZoro]', TA = 'Trend Average (Zeiierman)', GX = 'GEX Levels';
// LM: Watermark, Relative equal highs / lows, REQH / REQL label, draw-on-liquidity tables, New York
// session, opening prices, previous week. All default true.
const LM_KEYS = ['showMark', 'reqOn', 'reqLbl', 'dolOn', 'seNY', 'opOn', 'peW'];

// Page hooks (before any script): remember every Pine session's worker + bars so the test can pump
// live bar notifications like the feed does.
function initScript(){
  const op = Worker.prototype.postMessage;
  window.__pump = { bars: new Map(), on: false };
  Worker.prototype.postMessage = function (m) {
    try {
      if (m && m.kind === 'execute') window.__pump.bars.set(m.sessionId, { w: this, bars: m.req.bars });
      if (m && m.kind === 'notifyBars' && m.bars) { const e = window.__pump.bars.get(m.sessionId); if (e) e.bars = m.bars; }
      if (m && m.kind === 'stop') window.__pump.bars.delete(m.sessionId);
    } catch (e) {}
    return op.apply(this, arguments);
  };
  setInterval(() => { if (window.__pump.on) window.__pump.bars.forEach((e, sessionId) => { try { op.call(e.w, { kind: 'notifyBars', sessionId, bars: e.bars }); } catch (x) {} }); }, 1000);
  try {
    localStorage.setItem('stryker_install_prompt_shown_u1', '1'); localStorage.setItem('stryker_push_prompt_shown_u1', '1');
    localStorage.removeItem('stryker_bar_replay_v1');
  } catch (e) {}
}

async function open(b){
  const ctx = await b.newContext({ viewport: { width: VP, height: PHONE ? 844 : 900 }, deviceScaleFactor: PHONE ? 2 : 1, isMobile: PHONE, hasTouch: PHONE });
  await ctx.addInitScript(stub);
  await ctx.addInitScript(initScript);
  await ctx.addInitScript((eng) => { try { if (eng === '0.6') localStorage.setItem('stryker_vela06', '1'); else localStorage.removeItem('stryker_vela06'); } catch (e) {} }, ENG);
  const hits = { vendor: 0, gex: 0 };
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1|localhost|cdn\.jsdelivr\.net)/, (r) => { if (/insightsentry/i.test(r.request().url())) hits.vendor++; r.abort(); });
  await ctx.route(/\/api\/gex\/levels\//, (r) => { hits.gex++; r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(GEX) }); });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|WebSocket|ERR_FAILED|net::|status of 4|status of 5|opt-analytics|firebase/i.test(m.text())) errors.push(m.text().slice(0, 200)); });
  await p.goto(BASE + '/charts.html' + (ENG === '0.6' ? '?vela=0.6' : ''), { waitUntil: 'domcontentloaded' });
  await ready(p);
  return { ctx, p, errors, hits };
}
async function ready(p){
  await p.waitForFunction(() => window.__stkHeavyReady && window.STRYKER_VELA && window.STRYKER_PINE && window.STRYKER_IND_STYLE && window.STRYKER_VELA.context().cells.length, null, { timeout: 60000 });
  await sleep(2000);
}

// Real input at the centre of an element found in the page (fn body, `a` = arg). The element must be
// the one on top at that point (not covered by a sheet, toast or bar).
async function tap(p, finder, arg, label){
  const box = await p.evaluate(([src, a]) => {
    const el = new Function('a', src)(a);
    if (!el) return null;
    const r0 = el.getBoundingClientRect();
    if (r0.top < 0 || r0.bottom > innerHeight) el.scrollIntoView({ block: 'center', inline: 'nearest' });
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const t = document.elementFromPoint(x, y);
    return { x, y, w: r.width, hit: !!t && (t === el || el.contains(t)), top: t ? (t.id || String(t.className).slice(0, 40) || t.tagName) : null };
  }, [finder, arg]);
  if (!box || !box.w) { check(false, 'tap target found: ' + label); return false; }
  if (!box.hit) { check(false, 'tap target on top: ' + label, box); return false; }
  if (PHONE) await p.touchscreen.tap(box.x, box.y);
  else { await p.mouse.move(box.x, box.y); await p.mouse.down(); await p.mouse.up(); }
  await sleep(350);
  return true;
}
const F = {
  row: "const ch = window.STRYKER_VELA.context().cells[0].chart; const n = ch.renderer.inputsUI ? ch.renderer : ch.renderer.renderer; const r = n.inputsUI.rows.get(a); return r && r.el;",
  cog: "const ch = window.STRYKER_VELA.context().cells[0].chart; const n = ch.renderer.inputsUI ? ch.renderer : ch.renderer.renderer; const r = n.inputsUI.rows.get(a); return r && [...r.el.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Settings');",
  fold: "const b = document.querySelector('.vela-ind-fold'); return b && b.getAttribute('aria-label') === 'Show indicator legend' ? b : null;",
  field: "return document.querySelector('.vela-ind-dialog [id=\"vela-inp-' + a + '\"]');",
  footer: "return [...document.querySelectorAll('.vela-ind-dialog button')].find((b) => b.textContent.trim().toLowerCase() === a);",
  tab: "return [...document.querySelectorAll('.vela-ind-dialog .vela-ind-tab')].find((t) => t.textContent.trim() === a);",
  stGroup: "return [...document.querySelectorAll('.vela-ind-dialog [data-stk-is=style] .stk-is-gh')].find((h) => h.querySelector('.stk-is-gn').textContent.trim().startsWith(a));",
  stPill: "const [g, row, v] = a; const grp = [...document.querySelectorAll('.vela-ind-dialog .stk-is-g')].find((x) => x.querySelector('.stk-is-gn').textContent.trim().startsWith(g)); if (!grp) return null; const r = [...grp.querySelectorAll('.stk-is-r')].find((x) => x.firstChild.textContent === row); if (!r) return null; return [...r.querySelectorAll('button')].find((b) => b.dataset.v === v || b.textContent.trim() === v || b.title === v) || null;",
  pickerBtn: "return [...document.querySelectorAll('button')].find((b) => b.offsetParent && /^indicators$/i.test(b.getAttribute('aria-label') || b.title || '') );",
  pickSearch: "return document.querySelector('.stkiw-search');",
  pickRow: "const r = a.startsWith('key:') ? document.querySelector('.stkiw-row[data-key=\"' + a.slice(4) + '\"]') : [...document.querySelectorAll('.stkiw-row')].find((r) => (r.querySelector('.stkiw-name') || r).textContent.trim().startsWith(a)); return r ? r.querySelector('.stkiw-name') : null;",
  pickClose: "return document.querySelector('.stkiw-x');",
  ack: "return document.querySelector('.stkcd-ok');",
  fs: "return document.getElementById('stkc-fs-btn');",
  handle: "return document.getElementById('stkcps-handle');",
};

const dialogOpen = (p) => p.evaluate(() => !!document.querySelector('.vela-ind-dialog'));
async function legendShown(p){
  if (await p.evaluate((s) => !!new Function('a', s)(null), F.fold)) await tap(p, F.fold, null, 'show the indicator legend');
}
async function openSettings(p, id, label){
  await legendShown(p);
  if (PHONE) await tap(p, F.row, id, label + ' legend row');   // the phone shows the row's buttons on tap
  else { const b = await p.evaluate(([s, a]) => { const el = new Function('a', s)(a); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, [F.row, id]); await p.mouse.move(b.x, b.y); await sleep(300); }
  await tap(p, F.cog, id, label + ' cog');
  for (let i = 0; i < 20 && !(await dialogOpen(p)); i++) await sleep(250);
  check(await dialogOpen(p), label + ': settings dialog opened by a real ' + (PHONE ? 'tap' : 'click'));
  await sleep(300);
}
async function closeOk(p){ await tap(p, F.footer, 'ok', 'Ok'); for (let i = 0; i < 20 && (await dialogOpen(p)); i++) await sleep(200); }
async function typeNum(p, fid, v){
  if (!(await tap(p, F.field, fid, 'field ' + fid))) return;
  await p.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await p.keyboard.type(String(v), { delay: 40 });
  await p.keyboard.press('Tab');
  await sleep(300);
}

// Add from the Indicators window by real taps (search + row), like a member.
async function addByPicker(p, name, search, rowKey){
  const before = await p.evaluate(() => window.STRYKER_VELA.context().cells[0].chart.indicators().length);
  // a window left open by the previous add (desktop keeps it open) is closed first
  if (await p.evaluate(() => !!document.querySelector('.stkiw-ov'))) { await tap(p, F.pickClose, null, 'close picker'); await sleep(500); }
  const vis = () => p.evaluate(() => { const s = document.querySelector('.stkiw-search'); return !!(s && s.getBoundingClientRect().width); });
  await tap(p, F.pickerBtn, null, 'Indicators button');
  for (let i = 0; i < 20 && !(await vis()); i++) await sleep(250);
  if (!(await vis())) { console.log('INFO Indicators button did not open the window; opening it directly', await p.evaluate(() => [...document.querySelectorAll('button')].filter((b) => /^indicators$/i.test(b.getAttribute('aria-label') || b.title || '')).map((b) => b.className + ' vis=' + !!b.offsetParent).join(' | '))); await p.evaluate(() => window.STRYKER_VELA.indicatorPicker.open()); for (let i = 0; i < 20 && !(await vis()); i++) await sleep(250); }
  await sleep(600);
  if (await tap(p, F.pickSearch, null, 'picker search')) { await p.keyboard.type(search, { delay: 30 }); await sleep(900); }
  await tap(p, F.pickRow, rowKey ? 'key:' + rowKey : name, 'picker row ' + name);
  await sleep(900);
  if (await p.evaluate(() => !!document.querySelector('.stkcd-ok'))) await tap(p, F.ack, null, 'community notice: I understand');
  for (let i = 0; i < 120; i++) {
    const n = await p.evaluate(() => window.STRYKER_VELA.context().cells[0].chart.indicators().length);
    if (n > before) break;
    await sleep(500);
  }
  if (await p.evaluate(() => !!document.querySelector('.stkiw-x') && !!document.querySelector('.stkiw-x').offsetParent)) await tap(p, F.pickClose, null, 'close picker');
  await sleep(500);
}

// Everything we assert on, read from the page.
function snap(p){
  return p.evaluate(() => {
    const ch = window.STRYKER_VELA.context().cells[0].chart;
    const out = {};
    ch.indicators().forEach((h) => {
      let t = h.nativeType === 'stk_gex' ? 'GEX Levels' : (typeof h.source === 'string' ? window.STRYKER_PINE.titleOf(h) : h.nativeType || h.title);
      const rec = ch.orchestrator.registry.get(h.id);
      const m = rec && (rec.__stkRaw || rec.model);
      let iv = {}; try { iv = h.inputValues() || {}; } catch (e) {}
      const cells = [];
      ((m && m.tables) || []).forEach((tb) => (tb.cells || []).forEach((c) => { if (c && c.text) cells.push(String(c.text)); }));
      const labels = ((m && m.labels) || []).map((l) => String(l.text || ''));
      out[t] = { id: h.id, inputs: iv, model: m ? (m.inputValues || null) : null, tables: ((m && m.tables) || []).length,
        watermark: cells.some((c) => c === 'Liquidity Master [TradeZoro]'), dolTables: cells.some((c) => /draw on liquidity|^DOL|above|below/i.test(c)),
        req: labels.filter((x) => /REQ[HL]/.test(x)).length, nLabels: labels.length };
    });
    return out;
  });
}
let WANT = {};   // title -> { key: value }
let STYLE_WANT = null;
async function verify(p, phase, opts){
  opts = opts || {};
  // the script may be re-running: give the drawn model up to 25 s to land on the wanted inputs
  let s = null, bad = [];
  for (let i = 0; i < 50; i++) {
    s = await snap(p);
    bad = [];
    for (const [t, kv] of Object.entries(WANT)) {
      const x = s[t];
      if (!x) { bad.push(t + ': missing'); continue; }
      for (const [k, v] of Object.entries(kv)) {
        if (x.inputs[k] !== v) bad.push(t + '.' + k + ' handle=' + x.inputs[k]);
        if (x.model && k in x.model && x.model[k] !== v) bad.push(t + '.' + k + ' drawn=' + x.model[k]);
      }
    }
    const lm = s[LM];
    if (lm && WANT[LM] && WANT[LM].showMark === false && lm.watermark) bad.push('LM watermark drawn');
    if (lm && WANT[LM] && WANT[LM].reqOn === false && lm.req) bad.push('LM REQH/REQL drawn (' + lm.req + ')');
    if (!bad.length) break;
    await sleep(500);
  }
  check(!bad.length, phase + ': every changed input still holds (handle + drawn model)', bad.length ? bad.slice(0, 6) : undefined);
  if (STYLE_WANT && s[LM]) {
    const st = await p.evaluate((id) => window.STRYKER_IND_STYLE.styleOf(id), s[LM].id);
    const ok = JSON.stringify(st || {}).includes(STYLE_WANT);
    check(ok, phase + ': Liquidity Master style change still holds', ok ? undefined : st);
  }
  if (opts.shot) { await p.mouse.move(2, 2).catch(() => {}); await sleep(500); const f = path.join(OUT, 'persist-' + ENG + '-' + VP + '-' + opts.shot + '.png'); await p.screenshot({ path: f }); console.log('SHOT ' + f); }
  return s;
}
const quiet = async (p, ms) => { await sleep(ms || 1500); };

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=900'] });
  let ctx, p, errors, hits;
  try {
    ({ ctx, p, errors, hits } = await open(b));
    check(await p.evaluate(() => window.__stkVela090 === true) === (ENG === '0.9'), 'engine ' + ENG);
    await p.evaluate(() => { window.STRYKER_PINE.pineHandles(window.STRYKER_VELA.context().cells[0].chart).forEach((h) => h.remove()); const c = window.STRYKER_VELA.cell(window.STRYKER_VELA.context().cells[0].id); c.setSymbol('futures:MNQ1!'); c.setTimeframe('5'); });
    await sleep(4000);

    // ---- add the three indicators with real taps ----
    await addByPicker(p, LM, 'Liquidity Master');
    await addByPicker(p, TA, 'Trend Average');
    await addByPicker(p, GX, 'GEX', 'b:stk_gex');
    let s = await snap(p);
    for (let i = 0; i < 60 && !(s[LM] && s[LM].model && s[TA] && s[TA].model); i++) { await sleep(1000); s = await snap(p); }
    check(!!(s[LM] && s[TA] && s[GX]), 'Liquidity Master, Trend Average and GEX Levels added from the Indicators window', Object.keys(s));
    if (!(s[LM] && s[TA] && s[GX])) throw new Error('indicators missing');
    check(s[LM].watermark, 'before: Liquidity Master draws its watermark (default on)');
    console.log('INFO before: LM req labels ' + s[LM].req + ', tables ' + s[LM].tables);

    // ---- change the settings with real taps ----
    const lmId = s[LM].id, taId = s[TA].id, gxId = s[GX].id;
    await openSettings(p, lmId, 'Liquidity Master');
    for (const k of LM_KEYS) {
      const fid = lmId + '-' + k;
      const was = await p.evaluate((f) => { const e = document.querySelector('.vela-ind-dialog [id="vela-inp-' + f + '"]'); return e ? e.getAttribute('aria-checked') : null; }, fid);
      await tap(p, F.field, fid, 'LM switch ' + k);
      const now = await p.evaluate((f) => { const e = document.querySelector('.vela-ind-dialog [id="vela-inp-' + f + '"]'); return e ? e.getAttribute('aria-checked') : null; }, fid);
      check(was === 'true' && now === 'false', 'LM ' + k + ' switched off by a real ' + (PHONE ? 'tap' : 'click'), [was, now]);
    }
    if (PHONE) { const f = path.join(OUT, 'persist-' + ENG + '-' + VP + '-dialog.png'); await p.screenshot({ path: f }); console.log('SHOT ' + f); }
    // one Style change: boxes border width 3
    if (await tap(p, F.tab, 'Style', 'Style tab')) {
      const cat = await p.evaluate((id) => window.STRYKER_IND_STYLE.catalogOf(id), lmId);
      const bx = cat.find((c) => c.kind === 'box');
      if (bx) {
        const isOpen = await p.evaluate((g) => { const x = [...document.querySelectorAll('.vela-ind-dialog .stk-is-g')].find((e) => e.querySelector('.stk-is-gn').textContent.trim().startsWith(g)); return x && x.classList.contains('open'); }, bx.name);
        if (!isOpen) await tap(p, F.stGroup, bx.name, 'open style group ' + bx.name);
        if (await tap(p, F.stPill, [bx.name, 'Border width', '3'], 'border width 3')) STYLE_WANT = '"borderWidth":3';
      } else check(false, 'LM Style tab lists a box group', cat.map((c) => c.kind));
    }
    await closeOk(p);
    WANT[LM] = Object.fromEntries(LM_KEYS.map((k) => [k, false]));

    await openSettings(p, taId, 'Trend Average');
    await tap(p, F.field, taId + '-showEntryInput', 'TA Show Entry');
    await typeNum(p, taId + '-lenInput', 33);
    await closeOk(p);
    WANT[TA] = { showEntryInput: false, lenInput: 33 };

    await openSettings(p, gxId, 'GEX Levels');
    await tap(p, F.field, gxId + '-labels', 'GEX level text labels');
    await closeOk(p);
    WANT[GX] = { labels: false };

    await verify(p, '1 immediately', { shot: 'after-ok' });

    // ---- 2. live bar ticks ----
    await p.evaluate(() => { window.__pump.on = true; });
    await sleep(8000);
    await p.evaluate(() => { window.__pump.on = false; });
    await verify(p, '2a after 8 s of live bar ticks');

    // ---- 2b. bar replay: start, step 3, exit ----
    const rp = await p.evaluate(async () => {
      const R = window.__stkBarReplay; if (!R) return 'no replay';
      await R.startRandom();
      for (let i = 0; i < 60 && R.state.busy; i++) await new Promise((r) => setTimeout(r, 250));
      return R.state.on ? 'on' : 'off';
    });
    check(rp === 'on', '2b bar replay started', rp);
    await sleep(4000);
    await verify(p, '2b in bar replay');
    for (let k = 0; k < 3; k++) { await p.evaluate(() => window.__stkBarReplay.stepForward()); await sleep(1200); }
    await verify(p, '2b after 3 replay steps');
    await p.evaluate(async () => { await window.__stkBarReplay.exit(); });
    await sleep(4000);
    await verify(p, '2b after replay exit');

    // ---- 3. timeframe, symbol ----
    await p.evaluate(() => window.STRYKER_VELA.cell(window.STRYKER_VELA.context().cells[0].id).setTimeframe('15'));
    await sleep(5000);
    await verify(p, '3a timeframe 5m -> 15m');
    await p.evaluate(() => window.STRYKER_VELA.cell(window.STRYKER_VELA.context().cells[0].id).setSymbol('futures:NQ1!'));
    await sleep(5000);
    await verify(p, '3b symbol MNQ1! -> NQ1!');
    await p.evaluate(() => { const c = window.STRYKER_VELA.cell(window.STRYKER_VELA.context().cells[0].id); c.setSymbol('futures:MNQ1!'); c.setTimeframe('5'); });
    await sleep(5000);
    await verify(p, '3c back to MNQ1! 5m');

    // ---- 4. full screen on / off ----
    if (await tap(p, F.fs, null, 'full screen on')) {
      await sleep(1500);
      check(await p.evaluate(() => document.documentElement.classList.contains('stk-chart-fs')), '4 full screen is on');
      await verify(p, '4a full screen on', { shot: 'fullscreen' });
      await tap(p, F.fs, null, 'full screen off');
      await sleep(1500);
      await verify(p, '4b full screen off');
    }

    // ---- 5. bottom nav handle (phone) ----
    if (PHONE) {
      if (await tap(p, F.handle, null, 'bottom nav handle open')) {
        await sleep(800);
        await verify(p, '5a bottom nav shown');
        await tap(p, F.handle, null, 'bottom nav handle close');
        await sleep(800);
        await verify(p, '5b bottom nav hidden');
      }
    }

    // ---- 6. Style / Visibility tabs, Ok then Cancel ----
    await openSettings(p, lmId, 'Liquidity Master');
    const shown = await p.evaluate((id) => { const e = document.querySelector('.vela-ind-dialog [id="vela-inp-' + id + '-showMark"]'); return e && e.getAttribute('aria-checked'); }, lmId);
    check(shown === 'false', '6 the dialog shows Watermark still off', shown);
    await tap(p, F.tab, 'Style', 'Style tab'); await sleep(500);
    await tap(p, F.tab, 'Visibility', 'Visibility tab'); await sleep(500);
    await tap(p, F.tab, 'Inputs', 'Inputs tab'); await sleep(300);
    await closeOk(p);
    await verify(p, '6a Style / Visibility tabs opened, Ok');
    await openSettings(p, lmId, 'Liquidity Master');
    await tap(p, F.tab, 'Style', 'Style tab'); await sleep(500);
    await tap(p, F.tab, 'Visibility', 'Visibility tab'); await sleep(500);
    await tap(p, F.footer, 'cancel', 'Cancel'); await sleep(800);
    await verify(p, '6b Style / Visibility tabs opened, Cancel');

    // ---- 7. GEX layer redraw (its own setting changed and back) ----
    await openSettings(p, gxId, 'GEX Levels');
    await tap(p, F.field, gxId + '-priceTags', 'GEX right price tags');
    await closeOk(p);
    WANT[GX].priceTags = false;
    await sleep(3000);
    await verify(p, '7 GEX layer redrawn (setting changed, data reloaded)');

    // ---- 8. reload ----
    const ls = await p.evaluate(() => { try { window.STRYKER_VELA.context().stateChanged(); } catch (e) {} return true; });
    await sleep(3000);
    const saved = await p.evaluate(() => {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i); if (!/^vela-workspace/.test(k)) continue;
        try { const d = JSON.parse(localStorage.getItem(k)); const c = (d.charts || [])[0] || {}; const pine = (c.ext || {})['stryker.pine'] || []; const lm = pine.find((x) => /Liquidity Master/.test(x.name)); return { key: k, n: lm ? Object.keys(lm.inputs).length : -1, showMark: lm && lm.inputs.showMark, reqOn: lm && lm.inputs.reqOn }; } catch (e) {}
      }
      return null;
    });
    check(saved && saved.showMark === false && saved.reqOn === false && saved.n >= 190, '8 the saved workspace holds all LM inputs', saved);
    await p.reload({ waitUntil: 'domcontentloaded' });
    await ready(p);
    for (let i = 0; i < 60; i++) { const x = await snap(p); if (x[LM] && x[LM].model && x[TA] && x[TA].model && x[GX]) break; await sleep(1000); }
    await sleep(3000);
    s = await verify(p, '8 after a page reload', { shot: 'after-reload' });
    const counts = Object.fromEntries(Object.entries(s).map(([k, v]) => [k, 1]));
    check(Object.keys(s).filter((k) => k === LM || k === TA || k === GX).length === 3, '8 no indicator lost or doubled on reload', Object.keys(counts));
    // and once more after a reload: a tick + timeframe change
    await p.evaluate(() => { window.__pump.on = true; }); await sleep(5000); await p.evaluate(() => { window.__pump.on = false; });
    await p.evaluate(() => window.STRYKER_VELA.cell(window.STRYKER_VELA.context().cells[0].id).setTimeframe('1'));
    await sleep(5000);
    await verify(p, '9 after reload + ticks + timeframe 1m');
    check(hits.vendor === 0, 'no market-data vendor called', hits);
    check(!errors.length, 'no page errors', errors.slice(0, 4));
  } catch (e) {
    check(false, 'run crashed: ' + String(e && e.stack || e).slice(0, 500));
  } finally { try { if (ctx) await ctx.close(); } catch (e) {} await b.close(); }
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})();
