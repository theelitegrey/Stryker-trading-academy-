// Browser test: indicator Settings changes apply WITHOUT a page reload (Owner, 2026-10-12).
//
// Root cause it guards (assets/chart-pine-next-worker.js, build 515): on a streaming chart
// every settings event restarted the script's live stream, a full recompute that blocks the
// worker shared by every script on the chart and cannot be interrupted. Quick toggles, a
// typed number ("1" then "12") or a colour pick stacked several full recomputes back to back,
// so the new value showed 15-25 s later or looked lost, and the member reloaded the page.
// Static sessions also kept ONE pending job, which a live bar tick could replace.
//
// Cases (fresh page each, to keep memory low on the 4 GB server):
//   A  busy worker: SMT Divergence Pro + Trend Average on NQ1! 1m with a bar notification
//      pumped to every script each second. Change an SMT input, 3 rapid SMT toggles, a typed
//      Trend Average length; each must reach the drawn model (model.inputValues) within
//      APPLY_LIMIT_MS, no duplicate indicators; Cancel reverts. Run counters (started vs
//      finished, from the worker) must not run away. Then reload: inputs persisted.
//   B  Liquidity Master: a session toggle and a colour input apply (colour on the boxes).
//   C  390 phone: dialog change on Trend Average applies live; screenshot settings-apply-390.png.
//
// Run: CHART_BASE=http://127.0.0.1:8071 OUT=/tmp/x node tools/tests/chart-indicator-settings-apply-browser.js
const path = require('path');
const fs = require('fs');
const { launch } = require('./lib.js');
const stub = require('./richstub.js');

const BASE = process.env.CHART_BASE || 'http://127.0.0.1:8071';
const OUT = process.env.OUT || path.join(__dirname, 'out-settings-apply');
const LIMIT_MS = Number(process.env.APPLY_LIMIT_MS || 8000);
fs.mkdirSync(OUT, { recursive: true });

let fails = 0;
function check(ok, msg){ console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fails++; }

const SMT = 'SMT Divergence Pro [TradeZoro]', TA = 'Trend Average (Zeiierman)', LM = 'Liquidity Master [TradeZoro]';

// Before any page script: remember each session's worker + bars, pump bar notifications
// (no reason, like the feed's live ticks) once a second while __pump.on.
function initScript(){
  const op = Worker.prototype.postMessage;
  window.__pump = { workers: new Set(), bars: new Map(), on: false };
  window.__tl = []; window.__T0 = Date.now();
  Worker.prototype.postMessage = function (m) {
    try {
      if (m && m.kind === 'execute') { window.__pump.workers.add(this); window.__pump.bars.set(m.sessionId, { w: this, bars: m.req.bars }); }
      if (m && m.kind === 'notifyBars' && m.bars) { const e = window.__pump.bars.get(m.sessionId); if (e) e.bars = m.bars; }
      if (m && m.kind === 'stop') window.__pump.bars.delete(m.sessionId);
      if (m && (m.kind === 'update' || m.kind === 'execute' || m.kind === 'stop')) window.__tl.push((Date.now() - window.__T0) + ' >' + m.kind + ' s' + m.sessionId + ((m.inputs || (m.req && m.req.inputs) || {}).autoSym !== undefined ? ' autoSym=' + (m.inputs || m.req.inputs).autoSym : ''));
    } catch (e) {}
    return op.apply(this, arguments);
  };
  const ael = Worker.prototype.addEventListener;
  Worker.prototype.addEventListener = function (type, fn, o) {
    if (type === 'message' && !this.__tap) { this.__tap = 1; ael.call(this, 'message', (e) => { const m = e.data || {}; if (m.kind === 'debugState') window.__dbg = m; if (m.kind === 'model' && m.model && m.model.inputValues && 'autoSym' in m.model.inputValues) window.__tl.push((Date.now() - window.__T0) + ' <model autoSym=' + m.model.inputValues.autoSym); }); }
    return ael.call(this, type, fn, o);
  };
  setInterval(() => {
    if (!window.__pump.on) return;
    window.__pump.bars.forEach((e, sessionId) => { try { op.call(e.w, { kind: 'notifyBars', sessionId, bars: e.bars }); } catch (x) {} });
  }, 1000);
}

async function boot(p){
  await p.goto(BASE + '/charts.html', { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.STRYKER_VELA && window.STRYKER_PINE && window.STRYKER_VELA.context().cells.length, null, { timeout: 60000 });
}
async function newPage(b, vp, errors, tag){
  const ctx = await b.newContext(vp);
  await ctx.addInitScript(stub);
  await ctx.addInitScript(initScript);
  await ctx.route(/^https?:\/\/(?!localhost|127\.0\.0\.1|cdn\.jsdelivr\.net|api\.binance|data-api\.binance)/, r => r.abort());
  const p = await ctx.newPage();
  p.on('pageerror', e => errors.push(tag + ' pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|WebSocket|ERR_FAILED|net::/.test(m.text())) errors.push(tag + ' ' + m.text().slice(0, 200)); });
  await boot(p);
  await p.evaluate(() => { const c = window.STRYKER_VELA.cell(window.STRYKER_VELA.context().cells[0].id); c.setSymbol('futures:NQ1!'); c.setTimeframe('1'); });
  await p.waitForTimeout(4000);
  return { ctx, p };
}

async function addScripts(p, names){
  return p.evaluate(async (names) => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const chart = window.STRYKER_VELA.context().cells[0].chart;
    const B = await import('/assets/chart-pine-builtins.js?v=' + (document.querySelector('meta[name="build"]') || {}).content);
    const out = [];
    for (const name of names) {
      const it = B.PICKER_SCRIPTS.find(x => x.name === name);
      if (!it) { out.push('missing ' + name); continue; }
      const src = await B.builtinSource(it.id);
      const n0 = window.STRYKER_PINE.pineHandles(chart).length;
      // Community scripts ask once ("I understand"); click it like a member would.
      const ack = setInterval(() => { const b = document.querySelector('.stkcd-ok'); if (b) b.click(); }, 200);
      const r = await Promise.race([window.STRYKER_PINE.addSource(it.name, src, { engine: 'next', builtin: true, rightOffset: it.rightOffset }), sleep(45000).then(() => ({ ok: false, msg: 'add timed out' }))]);
      clearInterval(ack);
      if (!r.ok) out.push('fail ' + name + ': ' + r.msg);
      for (let i = 0; i < 60 && window.STRYKER_PINE.pineHandles(chart).length === n0; i++) await sleep(250);
    }
    return out;
  }, names);
}

function state(p){
  return p.evaluate((names) => {
    const chart = window.STRYKER_VELA.context().cells[0].chart;
    const P = window.STRYKER_PINE;
    const res = { indicators: chart.indicators().length, pine: P.pineHandles(chart).length, by: {} };
    P.pineHandles(chart).forEach((h) => {
      const t = P.titleOf(h);
      const name = names.find(n => t && n.startsWith(t.split(' [')[0].split(' (')[0]));
      const rec = chart.orchestrator.registry.get(h.id);
      const m = (rec && rec.model) || null;
      res.by[name || t] = { id: h.id, inputs: h.inputValues(), modelInputs: m ? m.inputValues || {} : null,
        boxes: m ? (m.boxes || []).map(b => String(b.bgColor || b.color || b.fillColor || '')) : [] };
    });
    return res;
  }, [SMT, TA, LM]);
}
async function waitModel(p, name, key, val, limit){
  const t0 = Date.now();
  while (Date.now() - t0 < limit) {
    const s = await state(p);
    const x = s.by[name];
    if (x && x.modelInputs && x.modelInputs[key] === val) return { ms: Date.now() - t0, s };
    await p.waitForTimeout(200);
  }
  return { ms: null, s: await state(p) };
}
async function runs(p){
  await p.evaluate(() => { window.__dbg = null; window.__pump.workers.forEach(w => w.postMessage({ kind: 'debugState' })); });
  await p.waitForFunction(() => window.__dbg, null, { timeout: 20000 }).catch(() => {});
  return p.evaluate(() => window.__dbg);
}
async function openSettings(p, id){
  await p.evaluate((id) => window.STRYKER_VELA.context().cells[0].chart.renderer.openIndicatorSettings(id), id);
  await p.waitForSelector('.vela-ind-dialog', { timeout: 10000 });
  await p.waitForTimeout(300);
}
async function dialogButton(p, re){
  await p.evaluate((src) => { const r = new RegExp(src, 'i'); const b = [...document.querySelectorAll('.vela-ind-dialog button')].find(x => r.test(x.textContent.trim())); if (b) b.click(); }, re);
  await p.waitForTimeout(300);
}
async function setField(p, id, key, kind, val){
  const sel = '.vela-ind-dialog [id="vela-inp-' + id + '-' + key + '"]';
  await p.waitForSelector(sel, { timeout: 5000 });
  if (kind === 'num') { await p.click(sel, { clickCount: 3 }); await p.keyboard.type(String(val), { delay: 60 }); await p.press(sel, 'Tab'); }
  else await p.click(sel);
}
function diffInputs(a, b){ return Object.keys(a || {}).filter(k => JSON.stringify(a[k]) !== JSON.stringify((b || {})[k])); }
const ms = (r) => (r.ms === null ? 'NOT within ' + LIMIT_MS + ' ms' : r.ms + ' ms');

(async () => {
  const b = await launch({ args: ['--js-flags=--max-old-space-size=768'] });
  const errors = [];
  try {
    // ---------------- A: busy worker, SMT + Trend Average ----------------
    {
      const { ctx, p } = await newPage(b, { viewport: { width: 1280, height: 860 } }, errors, 'A');
      const addErr = await addScripts(p, [SMT, TA]);
      check(!addErr.length, 'A: SMT + Trend Average added (' + (addErr.join('; ') || 'ok') + ')');
      await p.waitForTimeout(6000);
      const s0 = await state(p);
      check(s0.pine === 2, 'A: 2 Pine scripts on the chart (' + s0.pine + ')');
      await p.evaluate(() => { window.__pump.on = true; });
      const r0 = await runs(p);
      const t0 = Date.now();

      let x = s0.by[SMT];
      const key = 'autoSym';
      const next = !x.inputs[key];
      await openSettings(p, x.id); await setField(p, x.id, key, 'sw'); await dialogButton(p, '^ok$');
      let r = await waitModel(p, SMT, key, next, LIMIT_MS);
      check(r.ms !== null, `A: SMT "${key}" -> ${next} redrawn without reload, worker busy (${ms(r)})`);
      check(r.s.pine === 2 && r.s.indicators === s0.indicators, `A: no duplicate indicators (pine ${r.s.pine}, all ${r.s.indicators})`);

      await openSettings(p, x.id);
      for (let i = 0; i < 3; i++) { await setField(p, x.id, key, 'sw'); await p.waitForTimeout(80); }
      await dialogButton(p, '^ok$');
      r = await waitModel(p, SMT, key, !next, LIMIT_MS);
      check(r.ms !== null, `A: 3 rapid SMT toggles end on the last value (${ms(r)})`);
      // Every queued restart must have landed and the drawing must END on the last value
      // (an older restart landing after it would leave the stale value on screen).
      for (let i = 0; i < 60; i++) { const d = await runs(p); if (d && d.sessions.every(x => !x.restarting && !x.queued)) break; await p.waitForTimeout(500); }
      await p.waitForTimeout(1500);
      const held = (await state(p)).by[SMT].modelInputs[key];
      check(held === !next, `A: after the rapid toggles the drawn value stays on the last one (${held})`);
      if (held !== !next) console.log('TRACE\n' + (await p.evaluate(() => window.__tl.slice(-30).join('\n'))));

      x = (await state(p)).by[TA];
      await openSettings(p, x.id); await setField(p, x.id, 'lenInput', 'num', 12); await dialogButton(p, '^ok$');
      r = await waitModel(p, TA, 'lenInput', 12, LIMIT_MS);
      check(r.ms !== null, `A: Trend Average length typed 12 redrawn (${ms(r)})`);

      await openSettings(p, x.id); await setField(p, x.id, 'lenInput', 'num', 77); await p.waitForTimeout(400); await dialogButton(p, '^cancel$');
      r = await waitModel(p, TA, 'lenInput', 12, LIMIT_MS);
      const after = r.s.by[TA].inputs.lenInput;
      check(after === 12 && r.ms !== null, `A: Cancel reverts (lenInput ${after}, model ${r.ms === null ? 'NOT reverted' : 'reverted'})`);

      const left = 30000 - (Date.now() - t0); if (left > 0) await p.waitForTimeout(left);
      const r1 = await runs(p);
      if (r0 && r1 && r1.runs) {
        const st = r1.runs.started - r0.runs.started, fin = r1.runs.finished - r0.runs.finished;
        console.log('INFO runs in ' + Math.round((Date.now() - t0) / 1000) + ' s: started ' + st + ', finished ' + fin + ', sessions ' + JSON.stringify(r1.sessions));
        check(st - fin <= r1.sessions.length && st < 60, `A: no runaway runs (started ${st}, finished ${fin})`);
      } else check(false, 'A: worker run counters readable');
      const mem = await p.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1);
      console.log('INFO page JS heap ' + mem + ' MB');

      const want = Object.fromEntries(Object.entries((await state(p)).by).map(([k, v]) => [k, v.inputs]));
      await p.evaluate(() => { window.__pump.on = false; try { window.STRYKER_VELA.context().stateChanged(); } catch (e) {} });
      await p.waitForTimeout(2500);
      await boot(p);
      await p.waitForFunction(() => window.STRYKER_PINE.pineHandles(window.STRYKER_VELA.context().cells[0].chart).length >= 2, null, { timeout: 60000 }).catch(() => {});
      await p.waitForTimeout(2000);
      const s2 = await state(p);
      check(s2.pine === 2, 'A: after reload 2 scripts, no duplicates (' + s2.pine + ')');
      for (const name of Object.keys(want)) {
        const d = s2.by[name] ? diffInputs(want[name], s2.by[name].inputs) : ['missing'];
        check(!d.length, `A: after reload ${name} kept its inputs` + (d.length ? ' (differs: ' + d.slice(0, 4).join(',') + ')' : ''));
      }
      await p.screenshot({ path: path.join(OUT, 'settings-apply-1280.png') });
      await ctx.close();
    }

    // ---------------- B: Liquidity Master, short ----------------
    {
      const { ctx, p } = await newPage(b, { viewport: { width: 1280, height: 860 } }, errors, 'B');
      const addErr = await addScripts(p, [LM]);
      check(!addErr.length, 'B: Liquidity Master added (' + (addErr.join('; ') || 'ok') + ')');
      await p.waitForTimeout(5000);
      await p.evaluate(() => { window.__pump.on = true; });
      const x = (await state(p)).by[LM];
      await openSettings(p, x.id); await setField(p, x.id, 'fC', 'sw'); await dialogButton(p, '^ok$');
      let r = await waitModel(p, LM, 'fC', !x.inputs.fC, LIMIT_MS);
      check(r.ms !== null, `B: Liquidity Master session toggle redrawn (${ms(r)})`);
      const col = '#FF00FF33';
      await p.evaluate(([id, col]) => window.STRYKER_VELA.context().cells[0].chart.indicators().find(i => i.id === id).setInputs({ fvgBearBg: col }), [x.id, col]);
      r = await waitModel(p, LM, 'fvgBearBg', col, LIMIT_MS);
      const used = r.s.by[LM].boxes.some(c => /FF00FF/i.test(c.replace(/\s/g, '')) || /rgba\(255,0,255/i.test(c.replace(/\s/g, '')));
      check(r.ms !== null, 'B: colour input applied (' + ms(r) + ')');
      check(used, 'B: FVG boxes drawn in the new colour' + (used ? '' : ' (box colours: ' + [...new Set(r.s.by[LM].boxes)].slice(0, 6).join(' ') + ')'));
      await ctx.close();
    }

    // ---------------- C: phone 390 ----------------
    {
      const { ctx, p } = await newPage(b, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, errors, 'C');
      await p.evaluate(() => { const chart = window.STRYKER_VELA.context().cells[0].chart; window.STRYKER_PINE.pineHandles(chart).forEach(h => h.remove()); });
      const addErr = await addScripts(p, [TA]);
      check(!addErr.length, '390: Trend Average added (' + (addErr.join('; ') || 'ok') + ')');
      await p.waitForTimeout(5000);
      await p.evaluate(() => { window.__pump.on = true; });
      const x = (await state(p)).by[TA];
      if (!x) check(false, '390: Trend Average on chart');
      else {
        const v = x.inputs.lenInput === 25 ? 26 : 25;
        await openSettings(p, x.id);
        await setField(p, x.id, 'lenInput', 'num', v);
        const r = await waitModel(p, TA, 'lenInput', v, LIMIT_MS);
        check(r.ms !== null, '390: dialog change redrawn live (' + ms(r) + ')');
        await p.screenshot({ path: path.join(OUT, 'settings-apply-390.png') });
        await dialogButton(p, '^ok$');
      }
      await ctx.close();
    }
  } finally { await b.close(); }
  check(!errors.length, 'no console errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
