// TradeZoro — Charts: the Heatmap panel (ES module). Owner order 2026-11-10 ("add this heatmap setting option to chart,
// this is not a indicator").
// A chart-level panel opened from a toolbar button. It owns NO data code: it adds and configures the existing layers
//   Order book   -> Depth Heatmap (L2)        assets/chart-depth-heatmap.js (+ chart-heatmap-gl.js, chart-heat-filter.js rank cutoff)
//   Liquidations -> Liquidations (crypto)     assets/chart-crypto-deriv.js   (forced closes as they happen)
//   Options      -> GEX Heatmap               assets/chart-gex-heatmap.js    (updated from the options data)
// and writes its choices into those layers' own inputs, so saved charts / layouts / templates carry them and the
// existing indicators behave exactly as before. It adds NOTHING to the Indicators list (the picker is not touched).
// With the switch OFF nothing is subscribed: ON adds the layer, OFF removes it.
// Pro: the same gate as the existing tools (chart-pro-gate.js kindOf): a Free member sees the usual upgrade modal.
// Education only. Not financial advice.
import { kindOf, isFree, upgrade } from './chart-pro-gate.js?v=987';
import { l2Root } from './chart-futures-l2.js?v=987';
import { getVenue } from './orderflow-venues.js?v=987';

const EXT_KEY = 'stryker.heatmap', TPL_KEY = 'stk_heatmap_templates', MAG_KEY = 'stk_heatmap_magnifier';
export const SRC = { book: { type: 'stk_depth_heat', label: 'Order book' }, liq: { type: 'stk_liq', label: 'Liquidations' }, opt: { type: 'stk_gexheat', label: 'Options' } };
export const THEMES = ['Classic', 'Green', 'Gold', 'Fire', 'Mono'];
export const SENS = { High: 0, Mid: 30, Low: 60 };   // lower cutoff (% of the thinnest sizes hidden) = the Depth Heatmap's own "Lower cutoff"
const SW = { Classic: ['#0a1a4a', '#1f6fe0', '#9fd8ff', '#ffe14a', '#ff7a1a', '#e5322d'], Green: ['#001a09', '#0c6e30', '#28be5a', '#8cf078', '#ebffd2'], Gold: ['#080500', '#3c2604', '#8c600a', '#dea61e', '#fff6d2'], Fire: ['#080000', '#460808', '#aa180e', '#f05a10', '#ffbe28', '#fffac8'], Mono: ['#000', '#222', '#606060', '#aaa', '#fff'] };

// ---- pure helpers (tools/tests/heatmap-panel.test.mjs) ----
export const stepOf = (max) => { if (!(max > 0)) return 1; const raw = max / 20, p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p; return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p; };
export const stepVal = (v, dir, max) => { const s = stepOf(max), n = Math.round((v + dir * s) / s) * s; return Math.max(0, Math.min(max > 0 ? max : Infinity, +n.toFixed(6))); };
export function sourcesFor(symbol, supported, isOptionsSymbol, resolved) {
  // resolved = the chart's own data.resolve(symbol) { provider, ticker }, as marketOf() in chart-orderflow.js / the Depth Heatmap use it:
  // the live NQ symbol is 'NQ1!' or 'CME:NQ1!' (both resolve to provider 'futures'); without a resolver the text prefix is used.
  const m = /^([a-z0-9_-]+):(.+)$/i.exec(String(symbol || ''));
  const prov = String((resolved && resolved.provider) || (m ? m[1] : '')).toLowerCase(), tk = String((resolved && resolved.ticker) || (m ? m[2] : symbol || ''));
  const crypto = !!prov && prov !== 'futures' && prov !== 'stocks' && !!(prov === 'binance' || getVenue(prov));
  const fut = prov === 'futures';
  const out = {};
  out.book = (fut && l2Root(tk)) || crypto ? { ok: true } : { ok: false, why: 'Order book needs a futures contract with L2 (NQ, ES, YM, RTY, CL, GC) or a crypto pair.' };
  out.liq = crypto && supported.has('stk_liq') ? { ok: true } : { ok: false, why: 'Liquidations are shown for crypto pairs only.' };
  out.opt = isOptionsSymbol && supported.has('stk_gexheat') ? { ok: true } : { ok: false, why: 'Options data exists for index, ETF and stock symbols that have options (and their futures).' };
  return { crypto, fut, src: out };
}
// the chart's resolver for a cell (null when it cannot place the symbol)
const resolveOf = (c, sym) => { try { const r = (c.data || c.chart.data).resolve(sym); return r && r.provider ? { provider: r.provider, ticker: r.ticker } : null; } catch (e) { return null; } };
// Options layer state from its own frame hook (chart-gex-heatmap.js canvas.__stkGexHeat): columns in view + the status text.
// GEX history covers the US session only, so overnight the latest columns sit left of the view: say so instead of an empty chart.
export function optNote(f) {
  if (!f || f.cols > 0) return '';
  const ago = /(?:^|· )(live|updated .+ ago)$/.exec(String(f.text || ''));
  if (!ago) return '';
  return 'Options data updates during US market hours; last update ' + (ago[1] === 'live' ? 'GEX live' : ago[1].replace(/^updated /, '')) + '. Scroll back to that session to see the heatmap.';
}
const optFrame = () => { for (const cv of document.querySelectorAll('canvas')) if (cv.__stkGexHeat) return cv.__stkGexHeat; return null; };

// ---- state ----
const store = new Map();   // cellId -> { src: 'book'|'liq'|'opt', types: [native types this panel added] }
const tplAll = () => { try { return JSON.parse(localStorage.getItem(TPL_KEY) || '{}') || {}; } catch (e) { return {}; } };
const tplSave = (o) => { try { localStorage.setItem(TPL_KEY, JSON.stringify(o)); } catch (e) {} };
let WS = null, panel = null, btn = null, toastFn = () => {};

export function installHeatmapPanel(Core) {
  Core.registerStatePersistence({
    key: EXT_KEY, scope: 'cell',
    serialize(ctx) { const s = store.get(ctx.cellId); return s && s.types && s.types.length ? { src: s.src, types: s.types.slice(0, 3) } : undefined; },
    restore(p, ctx) {
      const ok = (t) => Object.values(SRC).some((x) => x.type === t);
      if (p && typeof p === 'object') store.set(ctx.cellId, { src: ['book', 'liq', 'opt'].includes(p.src) ? p.src : 'book', types: (Array.isArray(p.types) ? p.types : []).filter(ok) });
    }
  });
}

const cell = () => { try { return WS.cell(WS.active.id); } catch (e) { return null; } };
const st = () => { const id = WS && WS.active && WS.active.id; if (!store.has(id)) store.set(id, { src: 'book', types: [] }); return store.get(id); };
const handleOf = (type) => { try { return cell().chart.indicators().find((h) => h.nativeType === type) || null; } catch (e) { return null; } };
const dirty = () => { try { WS.markStateDirty(); } catch (e) { try { WS.context().stateChanged(); } catch (e2) {} } };
const dh = () => { try { return window.__stkFlow && window.__stkFlow.dhDebug && window.__stkFlow.dhDebug(); } catch (e) { return null; } };

async function turnOn(src) {
  const t = SRC[src].type, kind = kindOf(t);
  if (kind && isFree()) { upgrade(kind); return false; }
  if (!window.__stkHeavyReady && (src === 'book' || src === 'opt')) await new Promise((r) => { window.addEventListener('stk:heavy-ready', r, { once: true }); setTimeout(r, 15000); });
  const c = cell(); if (!c) return false;
  if (!handleOf(t)) {
    let h = null; try { h = c.chart.addNativeIndicator(t); } catch (e) { console.warn('TradeZoro heatmap panel:', e); return false; }
    h = h || handleOf(t);
    if (src === 'book' && h) { try { h.setInputs({ hmOwned: true, showBubbles: false, showVolume: false }); } catch (e) {} }
  }
  const s = st(); s.src = src; if (!s.types.includes(t)) s.types.push(t);
  dirty(); return true;
}
function turnOff() {
  const s = st();
  s.types.forEach((t) => { const h = handleOf(t); if (h) { try { h.remove(); } catch (e) {} } });
  s.types = []; dirty();
}
const isOn = () => { const s = st(); return s.types.some((t) => !!handleOf(t)); };
const setIn = (src, o) => { const h = handleOf(SRC[src].type); if (h) { try { h.setInputs(o); } catch (e) {} dirty(); } };
const getIn = (src) => { const h = handleOf(SRC[src].type); try { return h ? h.inputValues() : null; } catch (e) { return null; } };

// ---- a template = the panel's inputs for the active source ----
const KEYS = { book: ['hmTheme', 'hmStyle', 'hmShow', 'hmMin', 'hmMax', 'hmUsd', 'hmValues', 'cutoffPct', 'showCum'], liq: ['minUsd', 'labels'], opt: ['opacity'] };
const snap = (src) => { const v = getIn(src) || {}, o = { src }; KEYS[src].forEach((k) => { if (v[k] !== undefined) o[k] = v[k]; }); return o; };

// ---- UI ----
const CSS = `
.stkhm{position:fixed;z-index:8200;top:var(--hm-top,112px);right:12px;width:340px;max-height:calc(100vh - var(--hm-top,112px) - 16px);display:flex;flex-direction:column;background:var(--bg-2);color:var(--ink-1);border:1px solid var(--line);border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.45);font:14px/20px system-ui,-apple-system,"Segoe UI",sans-serif}
.stkhm[hidden]{display:none}
.stkhm *{box-sizing:border-box}
.stkhm-h{display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--line-soft);flex:none}
.stkhm-h b{font-size:16px;line-height:24px;font-weight:600;color:var(--ink-0);flex:1}
.stkhm-x{width:32px;height:32px;border:0;background:transparent;color:var(--ink-2);border-radius:8px;cursor:pointer;font-size:20px;line-height:1}
.stkhm-x:hover{background:var(--bg-3);color:var(--ink-0)}
.stkhm-sw{position:relative;width:44px;height:26px;border-radius:13px;border:0;background:var(--bg-3);box-shadow:inset 0 0 0 1px var(--line);cursor:pointer;flex:none;transition:background .15s}
.stkhm-sw::after{content:"";position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:var(--ink-2);transition:transform .15s,background .15s}
.stkhm-sw[aria-checked="true"]{background:var(--gold);box-shadow:none}
.stkhm-sw[aria-checked="true"]::after{transform:translateX(18px);background:#04140d}
.stkhm-b{padding:8px 16px 16px;overflow:auto;scrollbar-width:thin;scrollbar-color:var(--line) transparent;flex:1 1 auto}
.stkhm-b::-webkit-scrollbar{width:6px}.stkhm-b::-webkit-scrollbar-thumb{background:var(--line);border-radius:3px}
.stkhm-sec{padding:12px 0;border-bottom:1px solid var(--line-soft)}
.stkhm-sec:last-child{border-bottom:0}
.stkhm-l{font-size:12px;line-height:16px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--ink-2);margin:0 0 8px;display:flex;justify-content:space-between;align-items:center}
.stkhm-l button{font:inherit;text-transform:none;letter-spacing:0;color:var(--gold);background:none;border:0;cursor:pointer;padding:0}
.stkhm-seg{display:flex;gap:4px;background:var(--bg-1);border:1px solid var(--line-soft);border-radius:10px;padding:3px}
.stkhm-seg button{flex:1;min-height:32px;border:0;border-radius:8px;background:transparent;color:var(--ink-1);font:inherit;font-size:13px;cursor:pointer;padding:0 8px}
.stkhm-seg button[aria-pressed="true"]{background:var(--bg-3);color:var(--ink-0);box-shadow:inset 0 0 0 1px var(--gold)}
.stkhm-seg button:disabled{opacity:.4;cursor:not-allowed}
.stkhm-note{font-size:12px;line-height:16px;color:var(--ink-3);margin:6px 0 0}
.stkhm-note:empty{display:none}
.stkhm-optnote{color:var(--ink-1)}
.stkhm-sws{display:flex;gap:8px;flex-wrap:wrap}
.stkhm-sws button{width:56px;padding:4px;border:1px solid var(--line);border-radius:10px;background:var(--bg-1);color:var(--ink-2);font-size:12px;line-height:16px;cursor:pointer}
.stkhm-sws button i{display:block;height:16px;border-radius:5px;margin-bottom:4px;border:1px solid rgba(255,255,255,.08)}
.stkhm-sws button[aria-pressed="true"]{border-color:var(--gold);color:var(--ink-0)}
.stkhm-hist{display:flex;align-items:flex-end;gap:2px;height:44px;margin-bottom:8px}
.stkhm-hist i{flex:1;background:var(--teal);opacity:.75;border-radius:2px 2px 0 0;min-height:2px}
.stkhm-row{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:36px}
.stkhm-step{display:flex;align-items:center;gap:6px}
.stkhm-step button{width:32px;height:32px;border:1px solid var(--line);border-radius:8px;background:var(--bg-1);color:var(--ink-0);font-size:18px;line-height:1;cursor:pointer}
.stkhm-step span{min-width:64px;text-align:center;font-variant-numeric:tabular-nums;color:var(--ink-0)}
.stkhm-tg{display:flex;gap:8px;flex-wrap:wrap}
.stkhm-tg button,.stkhm-tp button{min-height:32px;padding:0 12px;border:1px solid var(--line);border-radius:16px;background:var(--bg-1);color:var(--ink-1);font:inherit;font-size:13px;cursor:pointer}
.stkhm-tg button[aria-pressed="true"]{border-color:var(--gold);color:var(--ink-0)}
.stkhm-tp{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.stkhm-in{flex:1;min-height:32px;border:1px solid var(--line);border-radius:8px;background:var(--bg-1);color:var(--ink-0);padding:0 10px;font:inherit}
.stkhm button:focus-visible{outline:2px solid var(--teal);outline-offset:1px}
.stkhm-lens{position:fixed;z-index:8100;width:140px;height:140px;border-radius:50%;border:2px solid var(--gold);box-shadow:0 6px 20px rgba(0,0,0,.5);pointer-events:none;background:#000;display:none}
@media (max-width:600px){
 .stkhm{left:0;right:0;top:auto;bottom:0;width:auto;max-height:78vh;border-radius:20px 20px 0 0;border-bottom:0}
 .stkhm::before{content:"";display:block;width:36px;height:4px;border-radius:2px;background:var(--line);margin:8px auto 0;flex:none}
 .stkhm-seg button,.stkhm-tg button,.stkhm-tp button{min-height:44px}
 .stkhm-step button{width:44px;height:44px}.stkhm-x{width:44px;height:44px}
 .stkhm-in{min-height:44px}
}`;
const h = (tag, attrs, kids) => { const e = document.createElement(tag); Object.entries(attrs || {}).forEach(([k, v]) => { if (k === 'text') e.textContent = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v); }); (kids || []).forEach((c) => c && e.appendChild(c)); return e; };
const seg = (opts, cur, on, dis) => h('div', { class: 'stkhm-seg', role: 'group' }, opts.map((o) => h('button', { type: 'button', text: o, 'aria-pressed': String(o === cur), disabled: dis && dis(o), onclick: () => on(o) })));
const sec = (title, kids, right) => h('section', { class: 'stkhm-sec' }, [title ? h('p', { class: 'stkhm-l' }, [h('span', { text: title }), right]) : null].concat(kids));
const fmt = (v) => (v >= 1e9 ? (v / 1e9).toFixed(1) + 'B' : v >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? (v / 1e3).toFixed(1) + 'K' : String(Math.round(v * 100) / 100));
let supported = new Set(), optSym = false, info = null;

function stepper(label, val, max, on) {
  return h('div', { class: 'stkhm-row' }, [h('span', { text: label }), h('div', { class: 'stkhm-step' }, [
    h('button', { type: 'button', 'aria-label': label + ' lower', text: '−', onclick: () => on(stepVal(val, -1, max)) }),
    h('span', { text: val > 0 ? fmt(val) : 'Off' }),
    h('button', { type: 'button', 'aria-label': label + ' higher', text: '+', onclick: () => on(stepVal(val, 1, max)) })])]);
}

function render() {
  if (!panel || panel.hidden) return;
  const s = st(), c = cell(), on = isOn(), body = panel.querySelector('.stkhm-b'), sw = panel.querySelector('.stkhm-sw');
  sw.setAttribute('aria-checked', String(on));
  const sym = c && c.symbol || (WS.active && WS.active.symbol) || '';
  info = sourcesFor(sym, supported, optSym, c && resolveOf(c, sym));
  const first = ['book', 'liq', 'opt'].find((k) => info.src[k].ok);
  if (!info.src[s.src].ok && first) s.src = first;
  const src = s.src, v = (on && getIn(src)) || {};
  const kids = [];
  kids.push(sec('Source', [seg(['Order book', 'Liquidations', 'Options'], SRC[src].label, async (o) => {
    const k = Object.keys(SRC).find((x) => SRC[x].label === o); if (!info.src[k].ok) return;
    const was = isOn(); if (was) turnOff(); s.src = k; if (was) await turnOn(k); render();
  }, (o) => !info.src[Object.keys(SRC).find((x) => SRC[x].label === o)].ok)].concat(
    ['book', 'liq', 'opt'].filter((k) => !info.src[k].ok).map((k) => h('p', { class: 'stkhm-note', text: info.src[k].why })))));
  if (!first) { body.replaceChildren(...kids); return; }
  if (!on) kids.push(h('p', { class: 'stkhm-note', text: 'Switch on to draw the heatmap behind the candles. Switch off to clear it.' }));
  if (on && src === 'book') {
    if (info.crypto) kids.push(sec('Denomination', [seg(['USD', 'Coin'], v.hmUsd ? 'USD' : 'Coin', (o) => { setIn('book', { hmUsd: o === 'USD' }); render(); })]));
    kids.push(sec('Appearance', [h('div', { class: 'stkhm-sws' }, THEMES.map((t) => h('button', { type: 'button', 'aria-pressed': String((v.hmTheme || 'Classic') === t), title: t, onclick: () => { setIn('book', { hmTheme: t }); render(); } },
      [h('i', { style: 'background:linear-gradient(90deg,' + SW[t].join(',') + ')' }), h('span', { text: t })])))]));
    const d = dh(), bins = d && d.spread, mx = d && d.maxSize || 0, px = info.crypto && v.hmUsd ? ((cell().chart.orchestrator.rawBars.slice(-1)[0] || {}).close || 1) : 1, bound = mx * px, cut = Number(v.cutoffPct || 0);
    const preset = Object.keys(SENS).find((k) => SENS[k] === cut) || '';
    const top = bins ? Math.max(1, ...bins) : 1;
    kids.push(sec('Sensitivity', [h('div', { class: 'stkhm-hist', 'aria-label': 'Spread of sizes now' }, (bins || new Array(12).fill(0)).map((n) => h('i', { style: 'height:' + Math.max(4, Math.round(100 * n / top)) + '%' }))),
      seg(['High', 'Mid', 'Low'], preset, (o) => { setIn('book', { cutoffPct: SENS[o] }); render(); })],
      h('button', { type: 'button', text: 'Reset', onclick: () => { setIn('book', { cutoffPct: 0, hmMin: 0, hmMax: 0, hmTheme: 'Classic', hmStyle: 'Classic', hmShow: 'Heatmap', hmValues: false, showCum: true }); render(); } })));
    kids.push(sec('Intensity', [stepper('Threshold', Number(v.hmMin || 0), bound, (n) => { setIn('book', { hmMin: n }); render(); }),
      stepper('Ceiling', Number(v.hmMax || 0), bound, (n) => { setIn('book', { hmMax: n }); render(); }),
      h('p', { class: 'stkhm-note', text: bound > 0 ? 'Min 0 · Max ' + fmt(bound) + (v.hmUsd ? ' USD' : info.crypto ? ' coins' : ' contracts') : 'Bounds appear when the book has data.' })]));
    kids.push(sec('Display', [seg(['Heatmap', 'Profile', 'Both'], v.hmShow || 'Heatmap', (o) => { setIn('book', { hmShow: o }); render(); }),
      (v.hmShow || 'Heatmap') !== 'Heatmap' ? h('div', { class: 'stkhm-tg', style: 'margin-top:8px' }, [h('button', { type: 'button', text: 'Running total', 'aria-pressed': String(v.showCum !== false), onclick: () => { setIn('book', { showCum: v.showCum === false }); render(); } })]) : null,
      h('p', { class: 'stkhm-note', text: 'Profile is the side column: the size resting at each price now.' })]));
    kids.push(sec('Style', [seg(['Volumetric', 'Classic'], v.hmStyle || 'Classic', (o) => { setIn('book', { hmStyle: o }); render(); })]));
    kids.push(sec('View', [h('div', { class: 'stkhm-tg' }, [
      h('button', { type: 'button', text: 'Values', 'aria-pressed': String(!!v.hmValues), onclick: () => { setIn('book', { hmValues: !v.hmValues }); render(); } }),
      h('button', { type: 'button', text: 'Magnifier', 'aria-pressed': String(magOn()), onclick: () => { magSet(!magOn()); render(); } })]),
      h('p', { class: 'stkhm-note', text: 'Values shows sizes on the strongest cells. Magnifier enlarges the area under the pointer.' })]));
  }
  if (on && src === 'liq') {
    kids.push(sec('Intensity', [stepper('Smallest shown (USD)', Number(v.minUsd || 0), 10000000, (n) => { setIn('liq', { minUsd: n }); render(); })]));
    kids.push(sec('View', [h('div', { class: 'stkhm-tg' }, [h('button', { type: 'button', text: 'Values', 'aria-pressed': String(v.labels !== false), onclick: () => { setIn('liq', { labels: v.labels === false }); render(); } })]),
      h('p', { class: 'stkhm-note', text: 'Forced closes as they happen: long closes red, short closes green. Sized by USD. No stop-loss / take-profit data is available.' })]));
  }
  if (on && src === 'opt') {
    kids.push(sec('Intensity', [stepper('Opacity %', Math.round(Number(v.opacity || 0.55) * 100), 100, (n) => { setIn('opt', { opacity: Math.max(0.1, n / 100) }); render(); }),
      h('p', { class: 'stkhm-note', text: 'Net gamma by strike over time, behind the candles. Colours follow the sign of the exposure.' }),
      h('p', { class: 'stkhm-note stkhm-optnote', text: optNote(optFrame()) })]));
  }
  if (on) {
    const t = tplAll(), names = Object.keys(t).slice(0, 12), inp = h('input', { class: 'stkhm-in', placeholder: 'Template name', maxlength: '24', 'aria-label': 'Template name' });
    kids.push(sec('Templates', [h('div', { class: 'stkhm-row' }, [inp, h('button', { type: 'button', class: 'stkhm-save', text: 'Save', style: 'min-height:32px;padding:0 14px;border:1px solid var(--line);border-radius:8px;background:var(--bg-1);color:var(--ink-0);cursor:pointer', onclick: () => {
      const n = inp.value.trim().slice(0, 24); if (!n) return; const all = tplAll(); all[n] = snap(src); tplSave(all); toastFn('Saved "' + n + '"', 'info'); render(); } })]),
      h('div', { class: 'stkhm-tp' }, names.map((n) => h('button', { type: 'button', text: n, onclick: async () => {
        const o = tplAll()[n]; if (!o || !SRC[o.src]) return;
        if (!info.src[o.src].ok) { toastFn('This template is for ' + SRC[o.src].label + ', not available here.', 'info'); return; }
        if (o.src !== st().src || !isOn()) { if (isOn()) turnOff(); if (!(await turnOn(o.src))) return; }
        const { src: _s, ...rest } = o; setIn(o.src, rest); render(); } })))]));
  }
  body.replaceChildren(...kids);
}

// ---- magnifier: a lens that redraws the canvases under the pointer, 3x ----
const magOn = () => { try { return localStorage.getItem(MAG_KEY) === '1'; } catch (e) { return false; } };
let lens = null, magWired = false;
function magSet(v) { try { localStorage.setItem(MAG_KEY, v ? '1' : '0'); } catch (e) {} wireMag(); }
function wireMag() {
  if (magWired) return; magWired = true;
  document.addEventListener('mousemove', (e) => {
    if (!magOn() || !isOn() || st().src !== 'book') { if (lens) lens.style.display = 'none'; return; }
    const plot = e.target && e.target.closest && e.target.closest('.vela-plot, [class*="vela-plot"]'); const root = plot || (e.target && e.target.closest && e.target.closest('.vela-chart, .vela-cell'));
    const cvs = root ? [...root.querySelectorAll('canvas')].filter((cv) => cv.style.display !== 'none' && cv.width > 300) : [];
    if (!cvs.length) { if (lens) lens.style.display = 'none'; return; }
    if (!lens) { lens = h('canvas', { class: 'stkhm-lens', width: 280, height: 280 }); document.body.appendChild(lens); }
    const L = 140, z = 3, g = lens.getContext('2d'); g.clearRect(0, 0, 280, 280);
    for (const cv of cvs) {
      const r = cv.getBoundingClientRect(), kx = cv.width / r.width, ky = cv.height / r.height, sw = L / z * kx, sh = L / z * ky;
      const sx = (e.clientX - r.left) * kx - sw / 2, sy = (e.clientY - r.top) * ky - sh / 2;
      try { g.drawImage(cv, sx, sy, sw, sh, 0, 0, 280, 280); } catch (err) {}
    }
    lens.style.display = 'block'; lens.style.left = Math.min(innerWidth - L - 8, e.clientX + 18) + 'px'; lens.style.top = Math.max(8, e.clientY - L - 18) + 'px';
  }, { passive: true });
}

async function refreshSupport() {
  try {
    const c = cell(); const list = await c.chart.availableNativeIndicators();
    supported = new Set(list.filter((x) => x.supported).map((x) => x.type));
    const { gexSource } = await import('./chart-gex-levels.js?v=987');
    optSym = !!gexSource(c.symbol || WS.active.symbol, '');
  } catch (e) { supported = new Set(); optSym = false; }
}

function open() {
  if (!panel) {
    if (!document.getElementById('stk-hm-css')) { const s = document.createElement('style'); s.id = 'stk-hm-css'; s.textContent = CSS; document.head.appendChild(s); }
    panel = h('aside', { class: 'stkhm', role: 'dialog', 'aria-label': 'Heatmap', hidden: true }, [
      h('div', { class: 'stkhm-h' }, [h('b', { text: 'Heatmap' }),
        h('button', { type: 'button', class: 'stkhm-sw', role: 'switch', 'aria-checked': 'false', 'aria-label': 'Heatmap on or off', onclick: async () => {
          if (isOn()) turnOff(); else { await refreshSupport(); render(); await turnOn(st().src); }
          render(); } }),
        h('button', { type: 'button', class: 'stkhm-x', 'aria-label': 'Close', text: '×', onclick: () => close() })]),
      h('div', { class: 'stkhm-b' })]);
    document.body.appendChild(panel);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) close(); });
    document.addEventListener('pointerdown', (e) => { if (!panel.hidden && !panel.contains(e.target) && !(btn && btn.contains(e.target)) && innerWidth <= 600 && !e.target.closest('.stkhm-lens')) close(); });
    setInterval(() => {
      if (panel.hidden || !isOn()) return;
      if (st().src === 'book') { const b = panel.querySelector('.stkhm-hist'); if (b) renderHist(b); }
      if (st().src === 'opt') { const n = panel.querySelector('.stkhm-optnote'); if (n) n.textContent = optNote(optFrame()); }
    }, 2000);
    try { WS.on('state:changed', () => setTimeout(render, 0)); } catch (e) {}
  }
  panel.hidden = false; btn && btn.setAttribute('aria-expanded', 'true');
  refreshSupport().then(render); render();
}
function renderHist(b) { const d = dh(), bins = d && d.spread; if (!bins) return; const top = Math.max(1, ...bins); [...b.children].forEach((e, i) => { e.style.height = Math.max(4, Math.round(100 * (bins[i] || 0) / top)) + '%'; }); }
function close() { if (panel) panel.hidden = true; btn && btn.setAttribute('aria-expanded', 'false'); }

export function mountHeatmapPanel(ws, opts) {
  WS = ws; toastFn = (opts && opts.toast) || toastFn;
  const bar = opts && opts.bar;
  if (bar && !document.getElementById('stkc-heatmap-btn')) {
    btn = document.createElement('button'); btn.type = 'button'; btn.className = 'stkc-ib'; btn.id = 'stkc-heatmap-btn'; btn.title = 'Heatmap'; btn.setAttribute('aria-label', 'Heatmap'); btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="3" y="3" width="5" height="5" rx="1" opacity=".35"/><rect x="9.5" y="3" width="5" height="5" rx="1" opacity=".9"/><rect x="16" y="3" width="5" height="5" rx="1" opacity=".55"/><rect x="3" y="9.5" width="5" height="5" rx="1" opacity=".8"/><rect x="9.5" y="9.5" width="5" height="5" rx="1" opacity=".4"/><rect x="16" y="9.5" width="5" height="5" rx="1"/><rect x="3" y="16" width="5" height="5" rx="1" opacity=".6"/><rect x="9.5" y="16" width="5" height="5" rx="1"/><rect x="16" y="16" width="5" height="5" rx="1" opacity=".3"/></svg>';
    btn.addEventListener('click', (e) => { e.stopPropagation(); if (panel && !panel.hidden) close(); else open(); });
    const gear = document.getElementById('stkc-settings-btn');
    if (gear && gear.parentNode === bar) bar.insertBefore(btn, gear); else bar.insertBefore(btn, bar.firstChild);
  }
  wireMag();
  window.__stkHeatmapPanel = { open, close, isOn, state: () => ({ on: isOn(), src: st().src, types: st().types.slice() }), sourcesFor, optNote };   // test hook
}
