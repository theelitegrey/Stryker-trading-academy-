// TradeZoro — Charts (charts.html) — loaded as <script type="module">
// Depends on: the shared page shell (login gate); assets/chart-templates.js
// (saved templates store, window.StrykerChartTemplates); assets/toast.js.
//
// A full charting workspace powered by Vela (github.com/LuxAlgo/Vela,
// Apache-2.0). The workspace UI lives in the package's ES-module build (the
// global script bundle carries only the headless core), so this imports
// dist/workspace.js and the three data providers from jsDelivr, pinned to an
// exact version. Vela's providers stream free public crypto data from
// Binance, Coinbase, Hyperliquid and OKX — no API keys. CME-group futures (NQ, ES,
// CL, GC ...) come from our own provider, assets/chart-futures-provider.js,
// backed by /api/chart/bars (continuous front-month bars from Yahoo Finance,
// edge-cached; polled, not streamed — never describe it as live/real-time; the
// legend's amber data dot, assets/chart-data-dot.js, says "Delayed data").
//
// SRI (P3-4 audit): these load via dynamic import(), which has no
// integrity="" attribute to set (that only exists on <script> tags and on
// <link rel="modulepreload">, and browsers don't check it for import()
// resolution). Left pinned-only — VELA_BASE below is already locked to an
// exact version, never a moving tag.
//
// ATTRIBUTION (Owner order 2026-10-05): the on-chart logomark is turned off
// (renderer default `attribution: false`). Vela's NOTICE allows that ONLY
// because an equivalent attribution — the name "Vela" plus a link to
// https://luxalgo.com/vela — stays on the same page: the (i) Credits popover
// in the chart toolbar (#stkc-credits, charts.html), which also links the
// NOTICE copy in assets/vendor/VELA-NOTICE.txt. Never remove that popover
// without turning the mark back on.
//
// MULTI-CHART: TradingView-style grid picker + "Sync in layout" switches live in
// assets/chart-grid.js (1 to 16 charts on desktop, 4 on tablets/phones); Vela's
// built-in picker (which goes up to 4x4) is dropped from its topbar, and
// maxWebglCells keeps every cell on WebGL only up to 4. Phones show every chart of a
// 2-4 chart layout at once (stacked / 2 x 2; a tab strip when panes would be too small):
// applyPhoneLayout below (2026-10-26).
//
// persist:true keeps the student's symbol, drawings, indicators and layout in
// localStorage, so the workspace reopens the way they left it. A DEFAULT
// template only applies when there was no saved session at page load (or when
// the member picks it from the Templates menu).
//
// PINE SCRIPT (phase 3): assets/chart-pine.js wires LuxAlgo's AGPL vela-pinets engine
// (loaded unmodified from jsDelivr, lazily) and draws the Pine editor; Pine indicators
// ride the workspace document under ext 'stryker.pine', so persist and templates keep them.
//
// INDICATOR WINDOW: assets/chart-indicator-window.js takes over ws.indicatorPicker (the
// topbar Indicators button and "/") with the TradingView-style window: Favorites, My scripts,
// Technicals by category, Editors' picks / Top / Trending, boosts, stars.
//
// GEX LEVELS: assets/chart-gex-levels.js registers the "TradeZoro GEX Levels" native (call wall,
// put wall, zero gamma from /api/gex/levels) at the top of the indicator window's TradeZoro group.
//
// VOLUME & ORDER FLOW: assets/chart-orderflow.js registers the volume-profile / VWAP /
// relative-volume / order-flow natives and puts them in a "Volume & Order flow" group at the
// top of the Indicators picker; their settings ride the document under ext 'stryker.volume'.

// CANDLE LOOK (Owner order 2026-10-05: "same aesthetics as TradingView"):
// Vela is self-hosted from assets/vendor/vela-0.6.17-s4/ — the unmodified
// 0.6.17 ESM build (Apache-2.0, LICENSE + NOTICE in that folder) with ONE
// patched file, chunk-YCD72KGK.js, marked "TradeZoro patch": 1-device-px wicks
// (Vela drew 1.5 px) and TradingView's body-width curve (~80% of the bar
// spacing, 3 px floor, collapsing to a 1 px stick when zoomed far out), plus
// TV-like dark/light theme defaults (#0f0f0f / white, faint grid, TV font
// stack). Candle colours were already TV's (#089981 / #F23645). s2 adds the
// settings-window hooks (margins, 12h time, weekday, previous-close colouring;
// see CHANGES.md there). The chunk files carry no ?v=, so any further patch
// goes in a NEW folder (-s3) and
// the charts.html import map ("@luxalgo/vela/plugin") must move with it, or
// the Pine engine gets a second copy of Vela's registries.
// VELA 0.9.0 (CoS order 2026-10-22; DEFAULT FOR EVERYONE since build 625, Owner "push test
// version live"; rollback: ?vela=0.6 per browser, or VELA090_DEFAULT in charts.html for all).
// Was an admin trial: the upgraded engine in
// assets/vendor/vela-0.9.0-s7/ (tools/vela-090-patch.py: our s1-s3 patches re-applied plus the
// TradingView-feel fixes). The inline script in charts.html picks the
// folder BEFORE any module loads (the import map must match) and sets window.__stkVela090; the
// 0.9.0 engine keeps its own saved workspace (vela-workspace-090) so switching back is safe.

// See "EMPTY LAYER CANVASES OFF" in the boot code.
const DRAW_OPS = ['fill', 'stroke', 'fillRect', 'strokeRect', 'fillText', 'strokeText', 'drawImage', 'putImageData'];
function quietLayer(def){
  if (!def || typeof def.create !== 'function' || def.__stkQuiet) return def;
  const create = def.create;
  return Object.assign({}, def, { __stkQuiet: true, create: (...a) => {
    const inst = create(...a);
    if (!inst || typeof inst.mount !== 'function' || typeof inst.render !== 'function') return inst;
    // PHONE SPEED (2026-10-26). Vela gives every registered layer a full-size canvas (25 of them,
    // ~1024 x 2071 px each at a phone's 2.6x pixel ratio) and every layer render starts with
    // clearRect + setTransform, drawn on or not. The first of those calls makes the browser allocate
    // the canvas's pixel memory: ~8 MB per layer and 1.8 s of main thread before the first candle on a
    // throttled phone (tools/tests/chart-phone-speed-canvas.js). Now, until a layer has drawn
    // something, its state calls (transform, save/restore, path, clip, dash) are only RECORDED and
    // its clears are skipped (a blank canvas cleared stays blank); the first real draw replays the
    // recorded calls in order and draws, so what reaches the canvas is exactly what it was before.
    // After that the canvas works directly, as before (ink = it has been drawn on since it was last
    // blank; only a resize, which wipes pixels and state, makes it blank again: a full clearRect
    // is not trusted for that because a clip may limit it). A resize also drops the record.
    let cv = null, drew = false, cleared = false, ink = false, inkW = 0, inkH = 0;
    const mount = inst.mount;
    inst.mount = function (canvas) {
      const r = mount.apply(this, arguments);
      try {
        const ctx = canvas && canvas.getContext && canvas.getContext('2d');
        if (ctx) {
          cv = canvas;
          // Own-property wrappers that call whatever the prototype holds at call time (so other
          // code that wraps CanvasRenderingContext2D.prototype keeps seeing these calls).
          const proto = Object.getPrototypeOf(ctx);
          // q: recorded state calls; depth: saves recorded and not yet restored; pinned: a recorded call
          // that can not be dropped (a clip / restore reaching outside the record); pathOpen: path
          // calls recorded since the last beginPath.
          let q = [], qW = canvas.width, qH = canvas.height, depth = 0, pinned = false, pathOpen = false, live = false;
          const PATH = /^(closePath|moveTo|lineTo|rect|roundRect|arc|arcTo|ellipse|bezierCurveTo|quadraticCurveTo)$/;
          // Style properties (fillStyle, font, ...) set while a recorded save() is open must also be
          // recorded, or the replayed restore() would not undo them: shadow = their pending values
          // (what the getters answer), stack = the shadow at each recorded save().
          let shadow = new Map(), stack = [];
          const reset = () => { q = []; depth = 0; pinned = false; pathOpen = false; qW = canvas.width; qH = canvas.height; shadow = new Map(); stack = []; };
          const sized = () => { if (canvas.width !== qW || canvas.height !== qH) reset(); };   // a resize wipes all canvas state
          const flush = () => {
            if (live) return;
            sized();
            live = true;
            const list = q; q = []; shadow = new Map(); stack = [];
            for (const [k, args] of list) {
              try { if (k === '=') PDESC[args[0]].set.call(ctx, args[1]); else proto[k].apply(ctx, args); } catch (e) {}
            }
          };
          const PROPS = ['fillStyle', 'strokeStyle', 'lineWidth', 'lineCap', 'lineJoin', 'miterLimit', 'lineDashOffset', 'font', 'textAlign', 'textBaseline', 'direction', 'letterSpacing', 'wordSpacing', 'fontKerning', 'fontStretch', 'fontVariantCaps', 'textRendering', 'globalAlpha', 'globalCompositeOperation', 'imageSmoothingEnabled', 'imageSmoothingQuality', 'shadowBlur', 'shadowColor', 'shadowOffsetX', 'shadowOffsetY', 'filter'];
          const PDESC = {};
          for (const pr of PROPS) {
            let d = null; for (let o = proto; o && !d; o = Object.getPrototypeOf(o)) d = Object.getOwnPropertyDescriptor(o, pr);
            if (!d || !d.set || !d.get) continue;
            PDESC[pr] = d;
            Object.defineProperty(ctx, pr, {
              configurable: true,
              get() { return !live && shadow.has(pr) ? shadow.get(pr) : d.get.call(this); },
              set(v) {
                if (live || depth === 0) { d.set.call(this, v); return; }
                shadow.set(pr, v); q.push(['=', [pr, v]]);
              }
            });
          }
          const DEFER = ['setTransform', 'resetTransform', 'transform', 'translate', 'scale', 'rotate', 'save', 'restore', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'rect', 'roundRect', 'arc', 'arcTo', 'ellipse', 'bezierCurveTo', 'quadraticCurveTo', 'clip', 'setLineDash'];
          for (const k of DEFER) {
            if (typeof proto[k] !== 'function') continue;
            ctx[k] = function () {
              if (live) return proto[k].apply(this, arguments);
              sized();
              if (k === 'save') { depth++; stack.push(new Map(shadow)); }
              else if (k === 'restore') { if (depth > 0) { depth--; shadow = stack.pop() || new Map(); } else pinned = true; }
              else if (k === 'clip' && depth === 0) pinned = true;
              else if (k === 'beginPath') pathOpen = false;
              else if (PATH.test(k)) pathOpen = true;
              // An absolute transform with nothing saved, no clip and no open path in the record makes
              // every recorded call before it irrelevant, except the line dash: keep the last one.
              if ((k === 'setTransform' || k === 'resetTransform') && depth === 0 && !pinned && !pathOpen) {
                let dash = null; for (const e of q) if (e[0] === 'setLineDash') dash = e;
                q = dash ? [dash] : [];
              }
              q.push([k, Array.prototype.slice.call(arguments)]);
              if (q.length > 4000) flush();   // never grow without bound: stop deferring
              return undefined;
            };
          }
          // calls whose answer depends on the recorded state: replay first
          for (const k of ['getTransform', 'isPointInPath', 'isPointInStroke', 'getImageData', 'getLineDash']) {
            if (typeof proto[k] === 'function') ctx[k] = function () { flush(); return proto[k].apply(this, arguments); };
          }
          // measureText reads the font: replay first only when a recorded save() holds a pending font
          if (typeof proto.measureText === 'function') ctx.measureText = function () { if (!live && shadow.size) flush(); return proto.measureText.apply(this, arguments); };
          for (const k of DRAW_OPS) if (typeof proto[k] === 'function') ctx[k] = function () { drew = true; if (!live) flush(); if (!ink) { ink = true; inkW = canvas.width; inkH = canvas.height; } return proto[k].apply(this, arguments); };
          ctx.clearRect = function (x, y, w, h) {
            cleared = true;
            if (ink && (canvas.width !== inkW || canvas.height !== inkH)) ink = false;   // resized = wiped
            if (!ink) return undefined;
            const res = proto.clearRect.apply(this, arguments);
            return res;
          };
        }
      } catch (e) { cv = null; }
      return r;
    };
    const render = inst.render;
    inst.render = function () {
      if (!cv) return render.apply(this, arguments);
      drew = false; cleared = false;
      try { return render.apply(this, arguments); }
      finally {
        if (drew) { if (cv.style.visibility) cv.style.visibility = ''; }
        else if (cleared && cv.style.visibility !== 'hidden') cv.style.visibility = 'hidden';
      }
    };
    return inst;
  } });
}

// LATE LAYERS (fix 2026-10-24): Vela's renderer builds one canvas per registered renderer layer
// ONCE, in mount(). chart-orderflow.js (Session Volume Profile, Volume Bubble, Volume Heatmap,
// Liquidity Trend Heatmap, Crypto DOM, Footprint via Flow) is lazy: on a browser whose saved state
// has no volume tool it registers its layers after the first chart exists, so those tools showed a
// legend row and drew nothing until a reload. The renderer prototype's mountIndicator now creates
// the missing layer entry on demand (same shape, canvas and stacking slot mount() would have given
// it) when an indicator whose type names a registered layer arrives, and removeIndicator drops it
// again when the last indicator of that type leaves. Layers a renderer already has are untouched,
// so nothing changes for any tool registered before boot (GEX, footprint, delta suite, ...).
const LAYER_DEFS = new Map();
function lateLayers(R){
  const proto = R && Object.getPrototypeOf(R);
  if (!proto || proto.__stkLateLayers || typeof proto.mountIndicator !== 'function' || typeof proto.removeIndicator !== 'function') return;
  proto.__stkLateLayers = true;
  const v09 = typeof proto.ensureInstanceLayer === 'function';
  const mountIndicator = proto.mountIndicator, removeIndicator = proto.removeIndicator;
  proto.mountIndicator = function (model) {
    // Repaint hook for chart-layer labels that settle over two frames (right-edge collision
    // handling in chart-gex-levels.js / chart-of-pro.js): plot.__stkInv() asks for one more frame.
    try { if (this.plot && !this.plot.__stkInv && this.scheduler) { const R = this; this.plot.__stkInv = () => { try { R.scheduler.invalidate(4); } catch (e) {} }; } } catch (e) {}
    try {
      const t = model && model.native && model.native.type;
      const def = t && LAYER_DEFS.get(t);
      if (def && this.plot && Array.isArray(this.extLayers) && !this.extLayers.some((l) => l.def && l.def.id === t && l.owner == null)) {
        const canvas = typeof this.createPlotCanvas === 'function' ? this.createPlotCanvas() : document.createElement('canvas');
        if (typeof this.createPlotCanvas !== 'function') Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none' });
        const ref = this.chromeCanvas;
        if (ref) { canvas.width = ref.width; canvas.height = ref.height; if (ref.style.width) canvas.style.width = ref.style.width; if (ref.style.height) canvas.style.height = ref.style.height; }
        const entry = v09 ? { def, instance: def.create(), canvas, channel: def.id, owner: null } : { def, instance: def.create(), canvas };
        entry.__stkLate = true;
        this.extLayers.push(entry);
        this.plot.insertBefore(canvas, def.placement === 'below-data' ? this.dataCanvas : this.chromeCanvas);
        entry.instance.mount(canvas);
        this.layerOrderSig = '';
      }
    } catch (e) { console.warn('TradeZoro: late layer mount', e); }
    return mountIndicator.apply(this, arguments);
  };
  proto.removeIndicator = function (handle) {
    const r = removeIndicator.apply(this, arguments);
    try {
      if (Array.isArray(this.extLayers) && this.extLayers.some((l) => l.__stkLate)) {
        const used = new Set();
        for (const m of this.scene.indicators.values()) if (m && m.native && m.native.type) used.add(m.native.type);
        for (let i = this.extLayers.length - 1; i >= 0; i--) {
          const l = this.extLayers[i];
          if (!l.__stkLate || used.has(l.def.id) || this.extLayers.some((x) => x !== l && x.def === l.def && x.owner != null)) continue;
          this.extLayers.splice(i, 1);
          try { l.instance.destroy && l.instance.destroy(); } catch (e) {}
          l.canvas.remove();
          this.layerOrderSig = '';
        }
      }
    } catch (e) { console.warn('TradeZoro: late layer drop', e); }
    return r;
  };
}

// BACKTEST MODE (replay.html?chart=tz, assets/bt-vela-chart.js sets window.__stkBt before this module loads):
// same chart, but the data is one backtest session (provider "bt", assets/bt-vela-feed.js), no live
// panels (watchlist, news, GEX ladder, paper account, Charts bar replay, alerts). Charts page: BT is null, nothing changes.
const BT = window.__stkBt || null;
const VELA090 = window.__stkVela090 === true;
const VELA_BASE = VELA090 ? './vendor/vela-0.9.0-s7/' : './vendor/vela-0.6.17-s4/';
// One-time migration for members whose saved workspace still carries the old
// Vela theme defaults (see migrateTvLook below).
const TV_LOOK_KEY = 'stryker_chart_tv_look';
const TV_LOOK_VER = '1';
const PERSIST_KEY = BT ? ((VELA090 ? 'vela-workspace-bt-090-' : 'vela-workspace-bt-') + (BT.sessionId || 'x')) : (VELA090 ? 'vela-workspace-090' : 'vela-workspace');
window.__stkPersistKey = PERSIST_KEY;
if (VELA090 && !BT) {
  // First run on 0.9.0: start from the member's 0.6.17 session (0.9.0 reads old saves).
  try { if (!localStorage.getItem(PERSIST_KEY) && localStorage.getItem('vela-workspace')) localStorage.setItem(PERSIST_KEY, localStorage.getItem('vela-workspace')); } catch (e) {}
}
const PHONE_MAX = 700;

function velaFail(){
  const fb = document.getElementById('stkchart-fallback');
  if (fb) fb.hidden = false;
}

// ---- full-height sizing: header and phone dock are measured, not guessed ----
function measureFrame(){
  const root = document.documentElement;
  const head = document.querySelector('.mobile-topnav');
  const dock = document.getElementById('appnav-dock');
  const top = head && head.getClientRects().length ? Math.max(0, Math.round(head.getBoundingClientRect().bottom)) : 0;
  let dockH = 0;
  // phone Charts page (chart-phone-space.js): the dock sits below the screen behind a handle
  if (dock && !root.classList.contains('stk-cps') && getComputedStyle(dock).display !== 'none' && getComputedStyle(dock).position === 'fixed') {
    dockH = Math.round(dock.getBoundingClientRect().height);
  }
  root.style.setProperty('--stkc-top', top + 'px');
  root.style.setProperty('--stkc-dock', dockH + 'px');
}
measureFrame();
window.addEventListener('resize', measureFrame, { passive: true });
window.addEventListener('load', measureFrame);
document.addEventListener('DOMContentLoaded', measureFrame);
setTimeout(measureFrame, 1500);
setTimeout(measureFrame, 4000);

// ---- tiny popover helper (toolbar menus + credits) ----
const pops = [];
function bindPopover(btn, pop, onOpen){
  // phone (<600 px, style.css .stkc-sheet): the menu is a bottom sheet over a scrim; tap the scrim to close
  let scrim = null;
  const set = (open) => {
    const was = !pop.hidden;
    pop.hidden = !open;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (pop.classList.contains('stkc-sheet')) {
      if (!scrim && pop.parentNode) {
        scrim = document.createElement('div');
        scrim.className = 'stkc-scrim';
        scrim.addEventListener('click', (e) => { e.stopPropagation(); set(false); });
        pop.parentNode.insertBefore(scrim, pop);
      }
      if (scrim) scrim.hidden = !open;
      // a phone sheet closing (X, swipe, tap outside, Apply) goes back to the chart, not to the ⋯ list it came from
      const list = was && !open && pop.closest('#stkc-more-pop');
      if (list && !list.hidden) document.body.click();
      pop.style.transform = '';
      // slide up once per open (script animation: the onebar re-homes the menu every clock tick, which would restart a CSS one)
      if (open && pop.animate && matchMedia('(max-width:599px) and (prefers-reduced-motion: no-preference)').matches)
        pop.animate([{ transform: 'translateY(100%)' }, { transform: 'none' }], { duration: 300, easing: 'cubic-bezier(.2,0,0,1)' });
    }
    if (open && onOpen) onOpen();
  };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = pop.hidden;
    pops.forEach((p) => { if (p.pop !== pop) p.set(false); });
    set(open);
  });
  pop.addEventListener('click', (e) => e.stopPropagation());
  pops.push({ pop, set });
  return set;
}
document.addEventListener('click', () => pops.forEach((p) => { if (!p.pop.hidden) p.set(false); }));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') pops.forEach((p) => { if (!p.pop.hidden) p.set(false); }); });
// Sheet header (grabber, title, one-line subtitle, round close). Shown only on phones (style.css);
// dragging it down more than 64 px closes the sheet.
function sheetHead(pop, title, sub){
  const close = () => { const p = pops.find((x) => x.pop === pop); if (p) p.set(false); };
  const x = document.createElement('button');
  x.type = 'button'; x.className = 'stkc-sh-x'; x.setAttribute('aria-label', 'Close');
  x.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  x.addEventListener('click', close);
  const h = document.createElement('div');
  h.className = 'stkc-sh';
  h.innerHTML = '<span class="stkc-sh-grab" aria-hidden="true"></span><div class="stkc-sh-t"><h2></h2><p></p></div>';
  h.querySelector('h2').textContent = title;
  const p = h.querySelector('p'); if (sub) p.textContent = sub; else p.remove();
  h.appendChild(x);
  let y0 = null, dy = 0;
  h.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) return; y0 = e.clientY; dy = 0; pop.style.transition = 'none'; try { h.setPointerCapture(e.pointerId); } catch (er) {} });
  h.addEventListener('pointermove', (e) => { if (y0 == null) return; dy = Math.max(0, e.clientY - y0); pop.style.transform = 'translateY(' + dy + 'px)'; });
  const end = () => { if (y0 == null) return; y0 = null; pop.style.transition = ''; pop.style.transform = ''; if (dy > 64) close(); };
  h.addEventListener('pointerup', end); h.addEventListener('pointercancel', end);
  return h;
}

const credBtn = document.getElementById('stkc-credits-btn');
const credPop = document.getElementById('stkc-credits');
if (credBtn && credPop) bindPopover(credBtn, credPop);

function el(tag, attrs, kids){
  const n = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    if (k === 'text') n.textContent = attrs[k];
    else if (k === 'html') n.innerHTML = attrs[k];
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), attrs[k]);
    else n.setAttribute(k, attrs[k]);
  }
  (kids || []).forEach((c) => c && n.appendChild(c));
  return n;
}

const icon = (inner) => '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
// Saved workspaces snapshot every cosmetic value, so the new TV-like theme
// defaults would never reach a returning member. Once (versioned flag), swap
// ONLY values that still equal Vela's old stock defaults; anything a member
// picked themselves is left alone, and later changes are never touched again.
function migrateTvLook(){
  try {
    if (localStorage.getItem(TV_LOOK_KEY) === TV_LOOK_VER) return;
    const raw = localStorage.getItem(PERSIST_KEY);
    if (raw) {
      const st = JSON.parse(raw);
      const FONT = '-apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, Ubuntu, sans-serif';
      const swap = (obj, key, map) => { if (obj && typeof obj[key] === 'string' && Object.prototype.hasOwnProperty.call(map, obj[key].toLowerCase())) obj[key] = map[obj[key].toLowerCase()]; };
      (st.charts || []).forEach((c) => {
        const rc = c && c.rendererConfig;
        if (!rc) return;
        const dark = !rc.layout || String(rc.layout.background).toLowerCase() !== '#ffffff';
        swap(rc.layout, 'background', { '#151619': '#0f0f0f' });
        swap(rc.layout, 'fontFamily', { 'sans-serif': FONT });
        const grid = dark ? { '#20222c': '#1c1c1c' } : { '#cccccc': '#f0f3fa' };
        const border = dark ? { '#2a2b30': '#2a2a2a' } : { '#d4dae3': '#e0e3eb' };
        if (rc.grid) { swap(rc.grid.vertLines, 'color', grid); swap(rc.grid.horzLines, 'color', grid); }
        swap(rc.priceScale, 'borderColor', border);
        swap(rc.panes, 'separatorColor', border);
      });
      localStorage.setItem(PERSIST_KEY, JSON.stringify(st));
    }
    localStorage.setItem(TV_LOOK_KEY, TV_LOOK_VER);
  } catch (e) { console.warn('TradeZoro: chart look migration', e); }
}

// toast.js signature is showToast(type, message).
const toast = (m, type) => { try { if (window.showToast) window.showToast(type || 'success', m); } catch (e) {} };

// CRYPTO SYMBOL LISTS LATER (phone speed, 2026-10-26): Vela asks every provider for its full symbol
// list the moment it is registered. For Binance (spot + futures exchangeInfo, ~19 MB of JSON),
// Hyperliquid and Coinbase that is a big download and parse on the way to the first candle, and only
// symbol search uses the lists (a saved symbol carries its venue prefix, so it resolves without them).
// Their listSymbols() now waits until the first candles are on screen and the page is idle, or the
// member first touches / types anything, whichever comes first, and then runs exactly as before.
let listsGoRes = null;
const listsGo = new Promise((r) => { listsGoRes = r; });
const listsNow = () => { if (listsGoRes) { const r = listsGoRes; listsGoRes = null; r(); } };
['pointerdown', 'keydown', 'focusin'].forEach((t) => window.addEventListener(t, listsNow, { capture: true, once: true, passive: true }));
setTimeout(listsNow, 20000);   // never wait forever
function lateLists(provider){
  try {
    if (provider && typeof provider.listSymbols === 'function') {
      const ls = provider.listSymbols.bind(provider);
      provider.listSymbols = () => listsGo.then(ls);
    }
  } catch (e) {}
  return provider;
}

(async () => {
  const host = document.getElementById('vela-chart');
  if (!host) return;

  // FIRST CHART FASTER (2026-10-14): the bars for the chart(s) the member will see are requested NOW,
  // in parallel with the module downloads and the login gate, instead of after the workspace boots
  // (live 537: gate cleared 2.9 s, bars requested 3.6 s, candles 4.7 s). They land in the shared
  // page memo of assets/chart-futures-provider.js, which the chart reads when it starts. Symbols and
  // timeframes come from the saved workspace (any object with a string symbol + timeframe), else
  // the default NQ1! 15m. Futures/forex only; anything else is ignored by prefetchBars.
  try {
    const want = [];
    try {
      const walk = (o, d) => {
        if (!o || typeof o !== 'object' || d > 6 || want.length >= 8) return;
        if (typeof o.symbol === 'string' && o.timeframe != null) want.push([o.symbol, String(o.timeframe)]);
        for (const k in o) if (o[k] && typeof o[k] === 'object') walk(o[k], d + 1);
      };
      walk(JSON.parse(localStorage.getItem(PERSIST_KEY) || 'null'), 0);
    } catch (e) {}
    if (!want.length) want.push(['binance:BTCUSDT', '15']);   // default chart = BTC (crypto, live for everyone), Owner 2026-10-30
    import('./chart-futures-provider.js?v=938')
      .then((m) => { if (m.prefetchBars) want.slice(0, 4).forEach(([s, tf]) => m.prefetchBars(s, tf)); })
      .catch(() => {});
  } catch (e) {}

  // LAZY HEAVY MODULES (2026-10-15): order flow (130 KB), footprint, GEX levels / heatmap and Expected Move
  // are not needed to paint the first candles. They download in parallel (modulepreload) but are
  // evaluated + installed after the first chart paints. A saved session / template / tick interval that
  // uses them (state mentions stk_*, stryker.volume or a tick/second interval) still installs them
  // BEFORE boot, exactly as before, so nothing restores half-empty.
  const HEAVY_URLS = ['orderflow', 'gex-levels', 'gex-heatmap', 'expected-move', 'footprint'].map((n) => './chart-' + n + '.js?v=938');
  let heavyNeeded = false;
  try {
    heavyNeeded = !!localStorage.getItem('stryker.volume');
    if (!heavyNeeded) for (let i = 0; i < localStorage.length && !heavyNeeded; i++) {
      const v = localStorage.getItem(localStorage.key(i)) || '';
      if (v.length < 3e6 && /stk_|stryker\.volume|"\d+[TtSs]"/.test(v)) heavyNeeded = true;
    }
  } catch (e) { heavyNeeded = true; }

  const pm = (n) => { try { performance.mark(n); } catch (e) {} };
  pm('stk:boot-start');
  let mods;
  // Zscript (assets/chart-zscript.js): our own indicator language. Loaded beside the boot modules; optional.
  // HIDDEN until launch (assets/zs-config.js ZS_LAUNCHED); ?zs=1 opens a preview for this tab.
  const zsP = import('./zs-config.js?v=938').then((c) => (c.zsEnabled() ? import('./chart-zscript.js?v=938') : null)).catch((e) => { console.warn('TradeZoro: Zscript module', e); return null; });
  try {
    mods = await Promise.all([
      import(VELA_BASE + 'workspace.js'),
      import(VELA_BASE + 'providers/binance.js'),
      import(VELA_BASE + 'providers/coinbase.js'),
      import(VELA_BASE + 'providers/hyperliquid.js'),
      import('./chart-futures-provider.js?v=938'),
      import(VELA_BASE + 'index.js'),
      import('./chart-pine.js?v=938'),
      Promise.resolve(null),
      import('./chart-settings.js?v=938'),
      VELA090 ? Promise.all([import(VELA_BASE + 'index.js'), import(VELA_BASE + 'chunk-YRCL3WMD.js')]).then(([a, b]) => ({ sharedBarStore: a.sharedBarStore, TIMEZONES: b.TIMEZONES })) : import(VELA_BASE + 'chunk-YCD72KGK.js'),
      import('./chart-grid.js?v=938'),
      import('./chart-alerts.js?v=938'),
      import('./chart-events.js?v=938'),
      import('./chart-intervals.js?v=938'),
      Promise.resolve(null),
      import('./chart-legend-rows.js?v=938'),
      import('./chart-paper.js?v=938'),
      import('./chart-bar-replay.js?v=938'),
      import('./chart-tick-boost.js?v=938'),
      Promise.resolve(null),
      Promise.resolve(null),
      Promise.resolve(null),
      import('./chart-tool-icons.js?v=938'),
      import(VELA_BASE + (VELA090 ? 'chunk-YRCL3WMD.js' : 'chunk-IFJJPXSV.js')),
      import('./chart-ind-style.js?v=938'),
      import('./chart-stocks-provider.js?v=938'),   // STOCKS ENGINE: every stock / ETF (assets/chart-stocks-provider.js)
      import('./byo-provider.js?v=938')   // last: connect-your-own-data providers (assets/byo-provider.js)
    ]);
  } catch (err) {
    console.error('TradeZoro: Vela modules failed to load', err);
    velaFail();
    return;
  }

  // eslint-disable-next-line
  const loadHeavy = () => Promise.all(HEAVY_URLS.map((u) => import(u)));
  if (heavyNeeded) { try { const h = await loadHeavy(); mods[7] = h[0]; mods[14] = h[1]; mods[19] = h[2]; mods[20] = h[3]; mods[21] = h[4]; } catch (err) { console.error('TradeZoro: Vela modules failed to load', err); velaFail(); return; } }
  pm('stk:mods-loaded');
  const W = mods[0];
  const VelaWorkspace = W.VelaWorkspace;
  // Binance candles follow every trade (aggTrade), not just the ~1 s kline push: assets/chart-tick-boost.js.
  let BinanceProvider = mods[1].BinanceProvider;
  try { BinanceProvider = mods[18].boostBinance(BinanceProvider); } catch (e) { console.warn('TradeZoro: tick boost', e); }
  const CoinbaseProvider = mods[2].CoinbaseProvider;
  let HyperliquidProvider = mods[3].HyperliquidProvider;
  try { HyperliquidProvider = mods[18].boostVenue(HyperliquidProvider, 'hyperliquid'); } catch (e) { console.warn('TradeZoro: tick boost', e); }
  const boostV = (P, id) => { try { return mods[18].boostVenue(P, id); } catch (e) { console.warn('TradeZoro: tick boost', e); return P; } };   // tick-speed candles; a failure keeps the plain provider
  let BybitProvider = null; try { BybitProvider = boostV((await import(VELA_BASE + 'providers/bybit.js')).BybitProvider, 'bybit'); } catch (e) { console.warn('TradeZoro: bybit provider', e); }
  let OkxProvider = null; try { OkxProvider = boostV((await import(VELA_BASE + 'providers/okx.js')).OkxProvider, 'okx'); } catch (e) { console.warn('TradeZoro: OKX provider', e); }
  let BitgetProvider = null, KrakenProvider = null;   // more crypto venues (providers/bitget.js, kraken.js); a failed load just leaves them out
  try { const [bg, kr] = await Promise.all([import(VELA_BASE + 'providers/bitget.js'), import(VELA_BASE + 'providers/kraken.js')]); BitgetProvider = boostV(bg.BitgetProvider, 'bitget'); KrakenProvider = boostV(kr.KrakenProvider, 'kraken'); } catch (e) { console.warn('TradeZoro: Bitget/Kraken providers', e); }
  let VestProvider = null; try { VestProvider = boostV((await import('./vest-provider.js?v=938')).VestProvider, 'vest'); } catch (e) { console.warn('TradeZoro: Vest provider', e); }   // Vest perps (assets/vest-provider.js)
  const FuturesProvider = mods[4].FuturesProvider;
  const FxProvider = mods[4].FxProvider;
  const IdxProvider = mods[4].IdxProvider;
  const BYO = mods[mods.length - 1];   // withByo(), ByoProvider
  const Stocks = mods[mods.length - 2];   // StocksProvider, installStockSearch, stockStatus
  const COMMODITY_ROOTS = mods[4].COMMODITY_ROOTS || [];
  let Flow, Gex, GexHeat;
  // EMPTY LAYER CANVASES OFF (speed, 2026-10-23): Vela gives every registered renderer layer
  // (order flow, GEX, events, paper, alerts, ... 20+ of them) its own full-size canvas, and the
  // browser composites ALL of them on every frame even when a layer draws nothing. On a 2-core
  // machine that compositing took the CPU from the Pine worker (Liquidity Master on 1m: ~40 s on
  // the chart page vs ~5 s alone). Each layer's canvas is now hidden (visibility) after a render
  // that cleared it and drew nothing, and shown again by the first render that draws. A render
  // that neither clears nor draws (a layer keeping its last picture) leaves it as it was.
  // Every layer def that goes through Core is also kept here, so a renderer built before the def was
  // registered can still mount it when an indicator of that type is added (see lateLayers below).
  const Core = Object.assign({}, mods[5], { registerRendererLayer: (def) => { const q = quietLayer(def); if (q && q.id) LAYER_DEFS.set(q.id, q); return mods[5].registerRendererLayer(q); } });
  const Pine = mods[6];
  const Settings = mods[8];
  const Grid = mods[10];
  const Alerts = mods[11];
  const Events = mods[12];
  const Iv = mods[13];
  // Every TradeZoro overlay/native that lacks its own emitted model gets a legend row (eye / cog / ×)
  // through one path (assets/chart-legend-rows.js). Keep order-flow on raw Core to avoid repaint risk.
  const LCore = mods[15].legendCore(Core, () => ws);
  const Paper = mods[16];
  // BAR REPLAY (Owner order 2026-10-12): the outermost provider wrapper + toolbar + control bar
  // (assets/chart-bar-replay.js). A pass-through while replay is off.
  const Replay = mods[17];
  // Tick bars (and seconds where a venue has no 1-second candles) are built from the same trade
  // sources the order-flow tools use.

  // Logomark off — the Credits popover carries the attribution (see header).
  try { Core.registerRendererDefaults({ attribution: false }); } catch (e) { console.warn('TradeZoro: attribution default', e); }

  // Grid shapes (1 to 8 charts, assets/chart-grid.js) are registered before boot so a
  // persisted / template / saved-layout state that uses one resolves.
  let ws;
  try { W.registerBuiltinLayouts(); Grid.installGrid(W, Core, () => ws); } catch (e) { console.warn('TradeZoro: layout register', e); }

  // Pine Script (assets/chart-pine.js): its persistence handler must be registered
  // before the workspace restores a saved session. The engine itself loads lazily.
  try { Pine.installPine(Core, () => ws); } catch (e) { console.warn('TradeZoro: Pine install', e); }
  const Zs = await zsP;
  if (Zs) try { Zs.installZscript(Core, () => ws); } catch (e) { console.warn('TradeZoro: Zscript install', e); }
  // Indicator Settings → Style / Visibility tabs (assets/chart-ind-style.js): its persistence handler too.
  const IndStyle = mods[24];
  try { IndStyle.installIndStyle(Core); } catch (e) { console.warn('TradeZoro: indicator style install', e); }
  // Install of the lazy-heavy modules (see HEAVY_URLS): before boot when the saved state needs them, else after the first paint.
  const installHeavy = () => {
    Flow = mods[7]; Gex = mods[14]; GexHeat = mods[19];
    // Tick bars (and seconds where a venue has no 1-second candles) are built from the same trade
    // sources the order-flow tools use.
    try { Iv.useTrades(Flow); } catch (e) { console.warn('TradeZoro: interval trades', e); }
  // Volume & order-flow tools (assets/chart-orderflow.js): registered before boot too, so a
  // saved session or template that carries them restores.
  try { Flow.installOrderflow(Core); } catch (e) { console.warn('TradeZoro: volume tools install', e); }
  // Order flow from exchange trades (assets/chart-footprint.js): the Footprint chart type + the
  // "Order Flow" indicators. Registered before boot so a saved session or template restores them.
  try { mods[21].installFootprint(Core, Flow); } catch (e) { console.warn('TradeZoro: order flow install', e); }
  // TradeZoro GEX Levels (assets/chart-gex-levels.js): registered before boot so a saved session restores it.
  try { Gex.installGexLevels(LCore); } catch (e) { console.warn('TradeZoro: GEX levels install', e); }
  // TradeZoro GEX Heatmap (assets/chart-gex-heatmap.js): net GEX by strike over time, behind the candles.
  try { GexHeat.installGexHeatmap(LCore); } catch (e) { console.warn('TradeZoro: GEX heatmap install', e); }
  // Expected Move (options ATM straddle range; assets/chart-expected-move.js), same plug-in path as GEX.
  try { mods[20].installExpectedMove(LCore); } catch (e) { console.warn('TradeZoro: expected move install', e); }
  };
  // SPEED (2026-10-29): the four import groups below used to be awaited one after the other (each its own
  // round trip on a phone); they are independent, so they are requested together and installed in the old order.
  const newsP = import('./chart-news-markers.js?v=938');
  const msP = import('./chart-market-stats.js?v=938');
  const camP = import('./chart-camarilla.js?v=938');
  const tideP = import('./chart-zorotide.js?v=938');
  const flowP = import('./chart-optflow.js?v=938');
  const offexP = import('./chart-offex.js?v=938');
  const dpP = import('./chart-darkpool.js?v=938');
  const cdP = import('./chart-crypto-deriv.js?v=938');
  const wiP = import('./chart-wallet-intel.js?v=938');
  const hlP = BT ? null : import('./hl-trade.js?v=938');   // Hyperliquid trading from the member's own wallet (admin beta, dark)
  let MSess = null;
  if (heavyNeeded) installHeavy();
  else {
    // The renderer builds its layer canvases once, at construction: a layer registered after the first
    // chart exists never mounts. Footprint is small, so it always registers before boot (rest stays lazy).
    // Same rule for the GEX Levels, GEX Heatmap and Expected Move layers (50 + 20 + 15 KB): they were only
    // registered after the first paint, so the indicator drew nothing on a browser that had never used it
    // (found 2026-10-18). Their install functions are guarded, so installHeavy() later is a no-op for them.
    const fpP = import('./chart-footprint.js?v=938');
    const gexP = Promise.all(['gex-levels', 'gex-heatmap', 'expected-move'].map((n) => import('./chart-' + n + '.js?v=938')));
    try { const FpM = await fpP; FpM.installFootprint(Core, null); mods[21] = FpM; } catch (e) { console.warn('TradeZoro: footprint install', e); }
    try {
      const pre = await gexP;
      mods[14] = pre[0]; mods[19] = pre[1]; mods[20] = pre[2];
      pre[0].installGexLevels(LCore); pre[1].installGexHeatmap(LCore); pre[2].installExpectedMove(LCore);
    } catch (e) { console.warn('TradeZoro: GEX layers pre-install', e); }
  }
  // News markers + Economic events natives (assets/chart-news-markers.js, Pro): registered before boot too.
  try { (await newsP).installNewsMarkers(LCore); } catch (e) { console.warn('TradeZoro: news markers install', e); }
  // ZoroTide (assets/chart-zorotide.js, Pro): options money flow in a lower pane, registered before boot so a saved chart restores it.
  try { (await tideP).installZoroTide(LCore); } catch (e) { console.warn('TradeZoro: ZoroTide install', e); }
  // Options Flow Marks (Pro) and Off-exchange Volume (Free): natives with a price-pane layer, registered before boot like the others.
  try { (await flowP).installOptFlow(LCore); } catch (e) { console.warn('TradeZoro: options flow install', e); }
  // ZoroOptions indicators (Zoro Range, Gamma Zone, IV Rank): loaded and registered only with the page flag on (assets/chart-zoro-data.js).
  try {
    const zd = await import('./chart-zoro-data.js?v=938');
    if (zd.zoroOn()) { (await import('./chart-zoro-range.js?v=938')).installZoroRange(LCore); (await import('./chart-iv-rank.js?v=938')).installIvRank(LCore); (await import('./chart-greek-exposure.js?v=938')).installGreekExposure(LCore); }
  } catch (e) { console.warn('TradeZoro: Zoro indicators install', e); }
  try { (await offexP).installOffex(LCore); } catch (e) { console.warn('TradeZoro: off-exchange install', e); }
  // Dark Pool Prints (assets/chart-darkpool.js, free for everyone): off-exchange block prints at their price and time, registered before boot too.
  try { (await dpP).installDarkPool(LCore); } catch (e) { console.warn('TradeZoro: dark pool install', e); }
  // Crypto derivatives (assets/chart-crypto-deriv.js, Pro): liquidations, open interest, funding, long/short ratio.
  try { (await cdP).installCryptoDeriv(LCore); } catch (e) { console.warn('TradeZoro: crypto derivatives install', e); }
  // Wallet Intel (assets/chart-wallet-intel.js, free for everyone): Hyperliquid candle wallets, liquidation + stop clusters, registered before boot too.
  try { (await wiP).installWalletIntel(LCore); } catch (e) { console.warn('TradeZoro: wallet intel install', e); }
  if (hlP) try { (await hlP).installHlTrade(Core); } catch (e) { console.warn('TradeZoro: HL trade install', e); }
  // Market Stats session overlay + the ?date= deep link (assets/chart-market-stats.js): registered before boot like the other natives.
  try { MSess = await msP; MSess.installMarketStats(LCore); } catch (e) { console.warn('TradeZoro: market stats install', e); }
  // Camarilla Pivots (assets/chart-camarilla.js, Free): level overlay from the prior session, registered before boot too.
  try { (await camP).installCamarilla(LCore); } catch (e) { console.warn('TradeZoro: camarilla install', e); }
  // Settings window (assets/chart-settings.js): its per-cell state handler registers before boot too.
  try { Alerts.installChartAlerts(Core); } catch (e) { console.warn('TradeZoro: alerts install', e); }
  try { Events.installChartEvents(Core); } catch (e) { console.warn('TradeZoro: events install', e); }
  try { Settings.installChartSettings(Core, mods[9]); } catch (e) { console.warn('TradeZoro: settings install', e); }
  // ONE icon set for every drawing tool (Owner order 2026-10-14, TradingView look): the column,
  // its flyouts, the phone sheet, the object tree and the favourites bar all read these; plus
  // separate Long / Short Position tools (assets/chart-tool-icons.js). Before the workspace is built.
  const ToolIcons = mods[22];
  try {
    const miss = ToolIcons.installToolIcons(Core, mods[23].PositionTool);
    if (miss.length) console.warn('TradeZoro: drawing tools without an icon', miss);
  } catch (e) { console.warn('TradeZoro: tool icons', e); }
  // Paper trading (assets/chart-paper.js): its on-chart line layer + right-click items register before boot.
  if (!BT) try { Paper.installPaper(Core); } catch (e) { console.warn('TradeZoro: paper install', e); }
  // backtest: the order-lines / trade-markers layer (assets/chart-bt-orders.js), installed before the workspace is built
  if (BT && BT.install) { try { await BT.install(Core); } catch (e) { console.warn('TradeZoro: backtest layer', e); } }

  pm('stk:installs-done');
  let day = false;
  try { day = localStorage.getItem('stryker_theme') === 'day'; } catch (e) {}
  migrateTvLook();
  let hadSession = false;
  try { hadSession = !!localStorage.getItem(PERSIST_KEY); } catch (e) {}

  // PHONE SPEED B (2026-10-26): the chart is BUILT while the login / plan gate is still checking.
  // Before, the boot waited for the gate to clear (the plan read from Firestore: live phone 1.4-2.2 s
  // after the modules were ready). Now it waits only until Firebase knows WHO is signed in (needed by
  // the Rithmic flag below), then builds the engine, canvases and layers under the still-hidden shell.
  // Nothing about data access changes:
  //   - every bars request waits for rt-access (assets/rt-access.js rtHeadersReady: signed-in user,
  //     token and the server's admin answer), exactly as before; the server picks the lane from the
  //     token (real-time CME admin-only, everyone else cut 10 min), so a request made without a token
  //     is always the delayed lane;
  //   - the shell (.dash-shell.gate-pending, visibility:hidden) stays hidden until the gate clears, so
  //     nothing is SHOWN before the check has passed; a denied visitor still gets the paywall / sign-in.
  // When the gate clears the frame is re-measured and a resize is sent so Vela re-fits to the final
  // layout (the reason the old code waited).
  const gateShell = document.querySelector('.dash-shell');
  const gatePending = () => !!(gateShell && gateShell.classList.contains('gate-pending'));
  if (gatePending()) {
    const obs = new MutationObserver(() => {
      if (gatePending()) return;
      obs.disconnect();
      pm('stk:gate-cleared');
      measureFrame();
      requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
    });
    obs.observe(gateShell, { attributes: true, attributeFilter: ['class'] });
  }
  await new Promise((resolve) => {
    let settled = false;
    const done = () => { if (!settled) { settled = true; clearTimeout(cap); resolve(); } };
    const cap = setTimeout(done, 6000);
    if (!gatePending()) { done(); return; }
    try {
      // eslint-disable-next-line no-undef
      const a = typeof auth !== 'undefined' && auth ? auth : null;
      if (!a || typeof a.onAuthStateChanged !== 'function') { done(); return; }
      const off = a.onAuthStateChanged(() => { try { off && off(); } catch (e) {} done(); });
    } catch (e) { done(); }
  });
  pm('stk:gate-ok');
  measureFrame();
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

  // Charts phase 4 (Rithmic, assets/rithmic-config.js): Connect broker is on for every signed-in member.
  // SPEED (Owner 2026-10-29, "candles are loading slow"): the Rithmic modules (config, ui, client, provider,
  // proto = a 5-file import chain) used to be awaited HERE, before the workspace was built, so the first
  // candles waited on them (+0.35 s desktop, +0.9 s on a throttled phone). Now the chart starts on the plain
  // futures provider and `rith` is a light stand-in; the real module loads at idle AFTER the first candles
  // (loadRithLater below), swaps itself in behind the same provider object and mounts the Connect broker
  // button. Nothing connects to Rithmic until the member taps Connect.
  let rith = null;       // the real module once loaded
  const rithEv = new Set();
  const rithRef = { client: { get state() { return rith ? rith.client.state : 'idle'; }, on(fn) { rithEv.add(fn); return () => rithEv.delete(fn); } } };
  const swapFut = { to: null };
  const futFactory = () => {
    const base = new FuturesProvider();
    // Delegates every call to the Rithmic-wrapped provider once it exists (same methods, same `this`).
    return new Proxy(base, {
      get(t, k) { const o = swapFut.to || t; const v = o[k]; return typeof v === 'function' ? v.bind(o) : v; },
      set(t, k, v) { (swapFut.to || t)[k] = v; return true; },
      has(t, k) { return k in (swapFut.to || t); }
    });
  };

  // Crash-loop guard (assets/chart-safe-mode.js): phones only; a load that never finished opens the next one in safe mode.
  let Safe = { phone: false, active: false };
  if (!BT) { try { Safe = (await import('./chart-safe-mode.js?v=938')).createSafeMode(PERSIST_KEY); } catch (e) { console.warn('TradeZoro: safe mode', e); } }
  let FormulaMod = null, FormulaNorm = null;
  try { [FormulaMod, { normalizeSymbol: FormulaNorm }] = await Promise.all([import('./chart-formula.js?v=938'), import('./chart-watchlist.js?v=938')]); } catch (e) { console.warn('TradeZoro: formula', e); }
  try {
    ws = window.STRYKER_VELA = new VelaWorkspace('#vela-chart', {
      layout: '1',
      symbol: BT ? 'bt:SESSION' : 'binance:BTCUSDT',   // Owner 2026-10-30: open on BTC (live data); a saved workspace keeps its own symbol
      timeframe: BT ? BT.tf : '15',
      // Seeds for the extra cells when a member widens the grid.
      cells: {
        A: { symbol: BT ? 'bt:SESSION' : 'binance:BTCUSDT', timeframe: '15' },
        B: { symbol: BT ? 'bt:SESSION' : 'futures:ES1!', timeframe: '15' },
        C: { symbol: BT ? 'bt:SESSION' : 'futures:GC1!', timeframe: '15' },
        D: { symbol: BT ? 'bt:SESSION' : 'futures:CL1!', timeframe: '15' },
        E: { symbol: BT ? 'bt:SESSION' : 'futures:YM1!', timeframe: '15' },
        F: { symbol: BT ? 'bt:SESSION' : 'futures:RTY1!', timeframe: '15' },
        G: { symbol: BT ? 'bt:SESSION' : 'futures:SI1!', timeframe: '15' },
        H: { symbol: BT ? 'bt:SESSION' : 'futures:NQ1!', timeframe: '15' }
      },
      maxWebglCells: 4,
      // Vela's own layout dropdown offers grids up to 4x4; ours (assets/chart-grid.js)
      // caps at 8 on desktop and 4 on tablets / phones.
      topbar: { left: ['symbol', 'timeframes', 'style', 'indicators', 'actions', 'undo-redo'], right: ['actions', 'alerts', 'panels', 'screenshot'] },
      live: true,
      theme: day ? 'light' : 'dark',
      providers: BT ? { bt: () => BT.feed.provider } : {
        // Iv.wrapFactory (assets/chart-intervals.js) builds the intervals a source does not
        // serve natively (futures 2m/3m/10m/45m/3h, 3M/6M/12M everywhere) from a smaller one.
        futures: Replay.wrapFactory(Iv.wrapFactory(futFactory, 'futures'), 'futures'),
        binance: Replay.wrapFactory(Iv.wrapFactory(() => lateLists(new BinanceProvider()), 'binance'), 'binance'),
        coinbase: Replay.wrapFactory(Iv.wrapFactory(() => lateLists(new CoinbaseProvider()), 'coinbase'), 'coinbase'),
        hyperliquid: Replay.wrapFactory(Iv.wrapFactory(() => lateLists(new HyperliquidProvider()), 'hyperliquid'), 'hyperliquid'),
        ...(BybitProvider ? { bybit: Replay.wrapFactory(Iv.wrapFactory(() => lateLists(new BybitProvider()), 'bybit'), 'bybit') } : {}),
        ...(OkxProvider ? { okx: Replay.wrapFactory(Iv.wrapFactory(() => lateLists(new OkxProvider()), 'okx'), 'okx') } : {}),
        ...(BitgetProvider ? { bitget: Replay.wrapFactory(Iv.wrapFactory(() => lateLists(new BitgetProvider()), 'bitget'), 'bitget') } : {}),
        ...(KrakenProvider ? { kraken: Replay.wrapFactory(Iv.wrapFactory(() => lateLists(new KrakenProvider()), 'kraken'), 'kraken') } : {}),
        ...(VestProvider ? { vest: Replay.wrapFactory(Iv.wrapFactory(() => lateLists(new VestProvider()), 'vest'), 'vest') } : {}),
        // Spot forex pairs (same /api/chart/bars endpoint, Yahoo "=X" series, delayed).
        fx: Replay.wrapFactory(Iv.wrapFactory(() => new (BYO.withByo(FxProvider, 'fx'))(), 'fx'), 'fx'),
        // Indices & ETFs (SPX NDX VIX RUT QQQ SPY IWM DIA): same endpoint, Yahoo, delayed; admin live candle from the hub's quote frames.
        idx: Replay.wrapFactory(Iv.wrapFactory(() => new (BYO.withByo(IdxProvider, 'idx'))(), 'idx'), 'idx'),
        // STOCKS ENGINE: every stock / ETF / fund worldwide, history + forming bar from the book recorder (assets/chart-stocks-provider.js).
        // Registered AFTER idx, so the bare SPY QQQ IWM DIA keep resolving to the index provider; stocks are always "stocks:EXCH:TICKER".
        stocks: Replay.wrapFactory(Iv.wrapFactory(() => new Stocks.StocksProvider(), 'stocks'), 'stocks'),
        // Stocks from the member's OWN connected account (assets/byo-core.js); empty until they connect one.
        byo: Replay.wrapFactory(Iv.wrapFactory(() => new BYO.ByoProvider(), 'byo'), 'byo'),
        // Formula symbols ("ES1!-NQ1!*0.25"): candles computed from the legs' own providers (assets/chart-formula.js).
        ...(FormulaMod ? { formula: () => FormulaMod.createFormulaProvider(() => window.STRYKER_VELA && window.STRYKER_VELA.feed, FormulaNorm) } : {}),
      },
      persist: PERSIST_KEY,
      ...(Safe.storage ? { storage: Safe.storage } : {})
    });
  } catch (err) {
    console.error('TradeZoro: Vela failed to start', err);
    velaFail();
    return;
  }

  pm('stk:workspace-built');
  if (BT) { try { BT.onReady && BT.onReady(ws, { Core, Pine, mods }); } catch (e) { console.warn('TradeZoro: backtest ready', e); } }
  // First candles on screen: mark it, then release the crypto symbol lists (lateLists) at idle.
  {
    const t0 = Date.now();
    const look = () => {
      let ok = false;
      try { ok = ws.cells().some((c) => c.chart.orchestrator.rawBars.length > 0); } catch (e) {}
      if (ok) {
        requestAnimationFrame(() => { pm('stk:first-candles'); window.__stkFirstCandles = true; try { window.dispatchEvent(new Event('stk:first-candles')); } catch (e) {} });
        (window.requestIdleCallback ? requestIdleCallback(listsNow, { timeout: 4000 }) : setTimeout(listsNow, 1500));
      } else if (Date.now() - t0 < 15000) setTimeout(look, 50);
      else listsNow();
    };
    look();
  }
  // LATE LAYERS (see lateLayers): patch the renderer prototype once (shared by every cell, so grid
  // cells added later are covered too).
  try { for (const c of ws.context().cells) { const r = c.chart.renderer; lateLayers(r && r.extLayers ? r : r && r.renderer); } } catch (e) { console.warn('TradeZoro: late layers', e); }

  // charts?symbol=NQ&date=2026-10-28 (from /market-stats): open that session on the chart.
  if (MSess && !BT) { try { MSess.openSessionFromLink(ws); } catch (e) { console.warn('TradeZoro: market stats link', e); } }

  try { ToolIcons.addShortToToolbar(ws, Core); } catch (e) { console.warn('TradeZoro: short position tool', e); }

  // Symbol search "Commodities" tab: Vela files a row there only when its type is "commodity",
  // and our metals/energy contracts are typed "futures" (so they also stay in the Futures tab).
  // While that tab is open the picker's pool gets type-"commodity" copies of those rows (same
  // ticker + venue, so picking one opens the same futures symbol). No vendor patch.
  try {
    const sp = ws.symbolPicker;
    if (sp && typeof sp.pool === 'function' && COMMODITY_ROOTS.length) {
      const basePool = sp.pool.bind(sp);
      const isCmd = (d) => d && String(d.type || '').toLowerCase() === 'futures' && COMMODITY_ROOTS.includes(String(d.ticker || '').toUpperCase().replace(/1!$/, ''));
      sp.pool = () => {
        const pool = basePool();
        return sp.activeTab === 'Commodities' ? pool.map((d) => (isCmd(d) ? Object.assign({}, d, { type: 'commodity' }) : d)) : pool;
      };
    }
  } catch (e) { console.warn('TradeZoro: commodities tab', e); }

  const cellCount = () => { try { return ws.layout.cells.length; } catch (e) { return 1; } };
  const currentTheme = () => (document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark');
  const liveCells = () => { try { return ws.context().cells; } catch (e) { return []; } };

  // ---------------- prefetch (Owner order 2026-10-14: symbol switch under 1 s) ----------------
  // Warms the shared bars memo in assets/chart-futures-provider.js (prefetchBars) so a switch paints
  // from memory: a watchlist or symbol-search row the pointer rests on for 120 ms, and at idle the
  // Owner's contracts + the first watchlist rows at the active chart's timeframe (again whenever the
  // timeframe changes). Futures and forex only, a handful of small edge-cached GETs, sequential.
  try {
    const prefetchBars = mods[4].prefetchBars;
    if (typeof prefetchBars === 'function' && !BT) {   // backtests never prefetch live symbols
      const activeTf = () => { try { return String(ws.chart.market.timeframe || '15'); } catch (e) { return '15'; } };
      let hoverT = null;
      document.addEventListener('pointerover', (e) => {
        const row = e.target && e.target.closest && e.target.closest('.stkw-row[data-sym], .vela-sp-row[data-ticker]');
        if (!row) return;
        clearTimeout(hoverT);
        hoverT = setTimeout(() => prefetchBars(row.dataset.sym || row.dataset.ticker, activeTf()), 120);
      }, { passive: true });
      const OWNER = ['NQ1!', 'ES1!', 'YM1!', 'GC1!', 'SI1!', 'CL1!', 'MNQ1!', 'MES1!', 'MYM1!', 'MGC1!', 'MCL1!'];
      const idle = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 4000 }) : setTimeout(fn, 1500));
      let warmedTf = null, warming = false;
      const warm = () => {
        const tf = activeTf();
        if (warming || tf === warmedTf || document.hidden || (navigator.connection && navigator.connection.saveData)) return;
        warming = true; warmedTf = tf;
        const list = OWNER.slice();
        document.querySelectorAll('.stkw-row[data-sym]').forEach((r, i) => { if (i < 12) list.push(r.dataset.sym); });
        (async () => { for (const s of list) { if (activeTf() !== tf) break; await prefetchBars(s, tf); } })()
          .finally(() => { warming = false; });
      };
      setTimeout(() => idle(warm), 3000);
      setInterval(() => { if (activeTf() !== warmedTf) idle(warm); }, 4000);
    }
  } catch (e) { console.warn('TradeZoro: bars prefetch', e); }

  pm('stk:mount-start');
  // ---------------- toolbar ----------------
  const barL = document.getElementById('stkc-bar-l');
  const isPhone = () => window.innerWidth <= PHONE_MAX;

  // Grid picker + Sync in layout (assets/chart-grid.js)
  let plMode = null;   // phone layout mode (applyPhoneLayout below): null | 'p2'..'p4' | 'l2'..'l4' | 'strip'
  const grid = Grid.mountGrid(ws, { bindPopover, sheetHead, onStructural: () => afterStructural(), isStrip: () => plMode === 'strip' });
  const layWrap = grid.el;
  const SYNCS = [['crosshair'], ['viewport'], ['symbol'], ['timeframe']];

  // Phone chart tabs (only when the panes would be too small to stack: see applyPhoneLayout)
  const cellSw = el('div', { class: 'stkc-cells', role: 'tablist', 'aria-label': 'Charts in this layout', hidden: '' });

  // Templates menu
  const tplBtn = el('button', { type: 'button', class: 'stkc-btn', id: 'stkc-tpl-btn', 'aria-haspopup': 'true', 'aria-expanded': 'false', title: 'Templates',
    html: icon('<path d="M6 4h12v16l-6-4-6 4z"/>') + '<span class="stkc-btn-l">Templates</span>' });
  const tplPop = el('div', { class: 'stkc-pop stkc-sheet stkc-tpl', id: 'stkc-tpl-pop', role: 'dialog', 'aria-label': 'Templates', hidden: '' });
  const tplWrap = el('div', { class: 'stkc-menu' }, [tplBtn, tplPop]);
  const setTpl = bindPopover(tplBtn, tplPop, () => renderTemplates());

  barL.appendChild(layWrap);
  barL.appendChild(tplWrap);
  try { Pine.mountPine(ws, barL, { toast, tfLabel }); } catch (e) { console.warn('TradeZoro: Pine editor', e); }
  if (Zs) try { Zs.mountZscript(ws, { toast, tfLabel }); } catch (e) { console.warn('TradeZoro: Zscript editor', e); }
  // the tab strip is its own slim row between the toolbar and the chart (never in the crowded phone toolbar)
  { const panel = document.querySelector('.stkchart-panel'); if (panel && panel.parentNode) panel.parentNode.insertBefore(cellSw, panel); else barL.appendChild(cellSw); }
  // Real Rithmic module: after the first candles are on screen (see the look() loop above), at idle.
  const loadRithLater = async () => {
    try {
      const r = await (await import('./rithmic-config.js?v=938')).loadRithmicIfEnabled();
      if (!r) return;
      rith = r;
      swapFut.to = r.providerFactory(FuturesProvider)();
      r.client.on((ev) => { rithEv.forEach((f) => { try { f(ev); } catch (e) {} }); });
      r.mount(ws, Core);
      rithEv.forEach((f) => { try { f({ type: 'state', state: r.client.state }); } catch (e) {} });
    } catch (e) { console.warn('TradeZoro: Rithmic module', e); }
  };
  if (window.__stkFirstCandles) setTimeout(loadRithLater, 0);
  else window.addEventListener('stk:first-candles', () => (window.requestIdleCallback ? requestIdleCallback(loadRithLater, { timeout: 2500 }) : setTimeout(loadRithLater, 800)), { once: true });
  // Connect your own data (Data source sheet): restores saved connections (decrypted on this device only), mounts the toolbar button.
  import('./byo-tastytrade.js?v=938').then(() => import('./byo-bridge.js?v=938')).then(() => import('./byo-ctrader.js?v=938')).then(() => import('./byo-oauth.js?v=938')).then(() => import('./byo-india.js?v=938')).then(() => import('./byo-dhan.js?v=938')).then(() => import('./byo-core.js?v=938')).then((c) => {
    // Keys follow the signed-in user: sign-out or another account wipes the vault and closes the streams.
    const bind = (u) => c.bindUser(u && u.uid).then(() => c.restore()).catch((e) => console.warn('TradeZoro: own data', e));
    try { if (typeof firebase !== 'undefined') firebase.auth().onAuthStateChanged(bind); } catch (e) { /* no auth on this page */ }
  }).catch((e) => console.warn('TradeZoro: own data', e));
  import('./byo-ui.js?v=938').then((m) => m.mountByo()).catch((e) => console.warn('TradeZoro: data source sheet', e));
  // Delayed-data pill at the bottom of the chart + its sheet (CME futures, viewer not real-time): assets/chart-data-banner.js.
  try { Stocks.installStockSearch(ws); } catch (e) { console.warn('TradeZoro: stock search', e); }   // server search in every symbol picker
  import('./chart-data-banner.js?v=938')
    .then((m) => m.installDataBanner(ws, { rith: rithRef, getRith: () => rith }))
    .catch((e) => console.warn('TradeZoro: data banner', e));
  // Data-status dot by each symbol (green real-time / amber delayed / grey closed): assets/chart-data-dot.js.
  import('./chart-data-dot.js?v=938')
    .then((m) => m.installDataDot(ws, { rith: rithRef, FuturesProvider, FxProvider, IdxProvider, stockStatus: Stocks.stockStatus, onStockMeta: Stocks.onStockMeta }))
    .catch((e) => console.warn('TradeZoro: data dot', e));
  // Stronger weak magnet on 0.9.0 (nearest OHLC in pixels across nearby candles, 28 px): assets/chart-magnet.js.
  if (VELA090) import('./chart-magnet.js?v=938')
    .then((m) => m.installMagnet(ws))
    .catch((e) => console.warn('TradeZoro: magnet', e));
  // TradeZoro corner mark on every cell's main pane, always on (assets/chart-brand.js).
  import('./chart-brand.js?v=938')
    .then(() => window.TzBrand && window.TzBrand.installVela(ws))
    .catch((e) => console.warn('TradeZoro: corner mark', e));
  // Price-axis countdown to bar close: current wall-clock bar, hidden while CME is closed,
  // timers paused on hidden tabs: assets/chart-countdown.js.
  import('./chart-countdown.js?v=938')
    .then((m) => m.installCountdown(ws))
    .catch((e) => console.warn('TradeZoro: countdown', e));
  // Endless scroll-back: older history pages load before the view reaches the oldest bar,
  // the view stays on its candles (assets/chart-history-pager.js).
  import('./chart-history-pager.js?v=938')
    .then((m) => m.installHistoryPager(ws))
    .catch((e) => console.warn('TradeZoro: history pager', e));
  // Floating Favorites drawing toolbar (starred tools, draggable): assets/chart-fav-toolbar.js.
  import('./chart-fav-toolbar.js?v=938')
    .then((m) => m.mountFavToolbar(ws, Core, { toast }))
    .catch((e) => console.warn('TradeZoro: favorites toolbar', e));
  // "Chart type" grid sheet + favourites in the top bar (assets/chart-type-picker.js).
  import('./chart-type-picker.js?v=938')
    .then((m) => m.mountChartTypePicker(ws, { toast }))
    .catch((e) => console.warn('TradeZoro: chart type picker', e));
  const mountHeavy = () => {
    window.__stkFlow = Flow;
    try { Flow.mountOrderflow(ws, { toast }); } catch (e) { console.warn('TradeZoro: volume tools', e); }
  };
  if (heavyNeeded) mountHeavy();
  import('./chart-pro-gate.js?v=938').then((m) => m.mountProGate(ws, { toast })).catch((e) => console.warn('TradeZoro: pro gate', e));
  try { Pine.mountCommunityPicker(ws); } catch (e) { console.warn('TradeZoro: community picker', e); }
  try { Settings.mountChartSettings(ws, { toast, bar: document.querySelector('#stkc-bar .stkc-bar-r') }); } catch (e) { console.warn('TradeZoro: settings window', e); }
  if (!BT) try { Alerts.mountChartAlerts(ws, { toast, bar: document.querySelector('#stkc-bar .stkc-bar-r') }); } catch (e) { console.warn('TradeZoro: alerts', e); }
  // PAPER TRADING (Owner order 2026-10-12): demo money, simulated fills, no broker. Trade button,
  // order ticket, on-chart lines, one-click Buy/Sell, bottom panel: assets/chart-paper.js.
  if (!BT) try { Paper.mountPaper(ws, { toast, bar: document.querySelector('#stkc-bar .stkc-bar-r') }); } catch (e) { console.warn('TradeZoro: paper trading', e); }
  if (hlP) hlP.then((m) => m.mountHlTrade(ws, { bar: document.querySelector('#stkc-bar .stkc-bar-r') })).catch((e) => console.warn('TradeZoro: HL trade', e));
  if (!BT) try { Replay.mountBarReplay(ws, { toast, Paper, store: mods[9].sharedBarStore }); } catch (e) { console.warn('TradeZoro: bar replay', e); }
  // Right-side Watchlist panel + icon rail (phones: a full-screen sheet): assets/chart-watchlist.js.
  // SymbolPicker comes from Vela's widget build (same chunk the workspace already loaded).
  Promise.all([import('./chart-watchlist.js?v=938'), import(VELA_BASE + 'widget.js')])
    .then(([m, Wd]) => m.mountWatchlist(ws, { toast, Core, SymbolPicker: Wd.SymbolPicker, rith: rithRef }))
    .catch((e) => console.warn('TradeZoro: watchlist', e));
  // News panel (right icon bar, phones: a sheet): headlines for the chart's market, replay-safe (assets/chart-news.js).
  import('./chart-news.js?v=938').then((m) => m.mountNews(ws, { toast })).catch((e) => console.warn('TradeZoro: news', e));
  // GEX Ladder panel (right icon bar, phones: a sheet): SPX / QQQ / SPY strikes, click draws the level (assets/chart-gex-ladder.js).
  import('./chart-gex-ladder.js?v=938').then((m) => m.mountGexLadder(ws, { toast })).catch((e) => console.warn('TradeZoro: gex ladder', e));
  // Futures L2 DOM ladder (admin only until the Tick-stream licence flag flips): assets/chart-futures-l2.js
  // Book · DOM · Trades panel (crypto + futures; replaces the futures-only ladder): assets/chart-book-panel.js
  import('./chart-book-panel.js?v=938').then((m) => m.mountBookPanel(ws, { toast })).catch((e) => console.warn('TradeZoro: book panel', e));
  import('./chart-feeds.js?v=938').then((m) => m.mountFeedBadges(ws)).catch((e) => console.warn('TradeZoro: feed badges', e));
  import('./venue-logos.js?v=938').then((m) => m.mountVenueLogos(ws)).catch((e) => console.warn('TradeZoro: venue logos', e));   // exchange / broker marks beside the text tags
  // Symbol info panel (right icon bar, phones: a sheet): contract specs, roll calendar, session (assets/chart-symbol-info.js).
  import('./chart-symbol-info.js?v=938').then((m) => m.mountSymbolInfo(ws)).catch((e) => console.warn('TradeZoro: symbol info', e));
  // "Dark pool" prints list beside the chart (right icon bar, phones: a sheet): assets/chart-darkpool.js.
  import('./chart-darkpool.js?v=938').then((m) => m.mountDarkPoolPanel(ws)).catch((e) => console.warn('TradeZoro: dark pool panel', e));
  // Wallet Intel panel (candle / cluster / book-level wallets and the wallet profile; phones: a sheet): assets/chart-wallet-intel.js.
  import('./chart-wallet-intel.js?v=938').then((m) => m.mountWalletIntel(ws)).catch((e) => console.warn('TradeZoro: wallet intel panel', e));
  try { IndStyle.mountIndStyle(ws); } catch (e) { console.warn('TradeZoro: indicator style', e); }
  // Indicator Settings → Inputs: every input.symbol opens the same symbol search
  // (assets/chart-symbol-input.js).
  try { FormulaMod && FormulaMod.mountFormula(ws, { SymbolPicker: null, normalize: FormulaNorm }); } catch (e) {}
  Promise.all([import('./chart-symbol-input.js?v=938'), import(VELA_BASE + 'widget.js')])
    .then(([m, Wd]) => m.mountSymbolInputPicker(ws, { toast, SymbolPicker: Wd.SymbolPicker, COMMODITY_ROOTS }))
    .catch((e) => console.warn('TradeZoro: symbol inputs', e));
  // "+" on the price axis (alerts / disabled trade items / horizontal line): assets/chart-plus.js
  import('./chart-plus.js?v=938').then((m) => m.mountChartPlus(ws, { openAlerts: Alerts.openAlerts, chartPlots: Alerts.chartPlots })).catch((e) => console.warn('TradeZoro: + menu', e));
  try { Events.mountChartEvents(ws); } catch (e) { console.warn('TradeZoro: events', e); }
  // TradingView-style interval row + menu (assets/chart-intervals.js).
  try { Iv.mountIntervals(ws, { toast }); } catch (e) { console.warn('TradeZoro: intervals', e); }
  // Footprint (and any chart type registered after boot) must reach the already-built top-bar chart-style menu:
  // Vela builds its item list once at construction, so without this the lazy-loaded Footprint item never appears.
  const refreshStyleMenu = () => { try { const t = ws.topbar; if (t && t.styleMenu && t.styleItems) t.styleMenu.setItems(t.styleItems()); } catch (e) {} };
  if (!heavyNeeded) {
    // First paint done (or 6 s at most), then an idle slot: load, install and mount the heavy modules.
    const firstPaint = () => new Promise((res) => {
      const t0 = Date.now();
      const tick = () => {
        let ok = false;
        try { ok = ws.cells().some((c) => c.chart.orchestrator.rawBars.length > 0); } catch (e) {}
        if (ok || Date.now() - t0 > 6000) res(); else setTimeout(tick, 100);
      };
      tick();
    });
    // LAYOUT-PERF (2026-11-08): shorter idle wait (was 2.5 s), and opening the Indicators window (window.__stkHeavyNow)
    // starts the load at once, so an order-flow / GEX tool picked early doesn't wait for the page to go idle.
    let now = null; const kick = new Promise((r) => { now = r; }); window.__stkHeavyNow = () => now();
    Promise.race([kick, firstPaint().then(() => new Promise((r) => (window.requestIdleCallback ? requestIdleCallback(r, { timeout: 800 }) : setTimeout(r, 300))))])
      .then(loadHeavy).then((h) => { mods[7] = h[0]; mods[14] = h[1]; mods[19] = h[2]; mods[20] = h[3]; mods[21] = h[4]; installHeavy(); mountHeavy(); refreshStyleMenu();
        // Each cell caches the native-indicator catalog the Indicators window lists; it was built before the
        // late volume tools registered, so on a fresh browser they were missing until a symbol change.
        try { (ws.cells ? ws.cells() : []).forEach((c) => { try { if (c && typeof c.refreshNativeCatalog === 'function') c.refreshNativeCatalog(); } catch (e) {} }); } catch (e) {}
        window.__stkHeavyReady = true; try { window.dispatchEvent(new Event('stk:heavy-ready')); } catch (e) {} })
      .catch((e) => console.warn('TradeZoro: order flow / GEX modules', e));
  } else window.__stkHeavyReady = true;
  // ONE toolbar (Owner order 2026-10-14): Vela's chart topbar joins #stkc-bar on a desktop-mode
  // chart, so the chart gets the second row's height; ⋯ More takes what does not fit
  // (assets/chart-onebar.js). Buttons added later (layout menu, watchlist) are picked up live.
  import('./chart-onebar.js?v=938')
    .then((m) => m.mountOneBar(ws))
    .catch((e) => console.warn('TradeZoro: one toolbar', e))
    // phone: one top bar, footnote in ⓘ, bottom nav behind a handle (assets/chart-phone-space.js)
    .then(() => import('./chart-phone-space.js?v=938'))
    .then((m) => m.mountPhoneSpace())
    .catch((e) => console.warn('TradeZoro: phone space', e));
  // TradingView-style left drawing column, right icon bar, fullscreen (assets/chart-tv-toolbars.js).
  import('./chart-tv-toolbars.js?v=938')
    .then((m) => m.mountTvToolbars(ws, { toast }))
    .catch((e) => console.warn('TradeZoro: tv toolbars', e));
  // TradingView-style "Indicators, metrics, and strategies" window replaces Vela's picker
  // (assets/chart-indicator-window.js); loaded after the two picker wrappers above.
  import('./chart-indicator-window.js?v=938')
    .then((m) => m.mountIndicatorWindow(ws, { toast, tfLabel }))
    .catch((e) => console.warn('TradeZoro: indicator window', e));

  pm('stk:mounts-sync-done'); requestAnimationFrame(() => pm('stk:raf-after-mounts'));
  function refreshLayoutUi(){
    grid.refresh();
    renderCellSwitcher();
  }

  function setLayout(id){ grid.setLayout(id); }

  function tfLabel(tf){
    tf = String(tf || '');
    if (/^\d+$/.test(tf)) { const n = +tf; return n % 60 === 0 && n >= 60 ? (n / 60) + 'h' : n + 'm'; }
    try { return Iv.ivShort(tf); } catch (e) { return tf; }
  }

  // PHONE MULTI-CHART (Owner bug 2026-10-26: "Chart layouts not working properly on Mobile phone.
  // Not showing up"). Before: a phone maximized ONE chart over the grid, so picking 2-4 charts looked
  // like nothing happened. Now every chart of the layout is on screen, in a phone shape set by
  // #vela-chart[data-stkpl] (style.css), whatever the desktop shape of the saved layout is:
  //   portrait  p2 / p3 / p4: panes stacked top to bottom, full width (each keeps its price axis);
  //   landscape l2: side by side, l3: two on top + one wide, l4: 2 x 2.
  //   strip: when stacked panes would be shorter than PANE_MIN px (a short phone, 4 charts) ONE chart
  //   shows at a time with a tab row ("1 NQ 15m", "2 ES 15m" ...) + dots; swipe the row or tap a tab.
  // Each pane is its own Vela cell (own symbol, timeframe, indicators, drawings); tapping a pane makes
  // it the active one, and the toolbar (symbol, interval, Indicators, drawings) edits that pane.
  // Desktop and tablets: data-stkpl is never set and nothing here runs a layout change.
  const PANE_MIN = 150;
  let swKey = '';
  let plKey = '';
  function phoneLayoutMode(cells){
    const pm = Grid.phoneMode();
    const n = Math.min(cells.length, 4);
    if (!pm || n < 2) return null;
    if (pm === 'landscape') return 'l' + n;
    const host = document.getElementById('vela-chart');
    const h = host ? host.getBoundingClientRect().height : window.innerHeight;
    // the tab row (when shown) is not part of the grid's height
    const tabs = cellSw.hidden ? 0 : cellSw.getBoundingClientRect().height;
    return (h + tabs) / n < PANE_MIN ? 'strip' : 'p' + n;
  }
  function applyPhoneLayout(){
    const cells = liveCells();
    const mode = phoneLayoutMode(cells);
    const host = document.getElementById('vela-chart');
    const was = plMode;
    plMode = mode;
    if (host) { if (mode) host.dataset.stkpl = mode; else delete host.dataset.stkpl; }
    let active = null; try { active = ws.active.id; } catch (e) {}
    if (cells.length && !cells.some((c) => c.id === active)) active = cells[0].id;
    // pane order in the phone grid = the workspace's cell order (Vela may have swapped slots)
    try { ws.cells().forEach((c, i) => { if (c && c.host) c.host.style.order = mode && mode !== 'strip' ? String(i) : ''; }); } catch (e) {}
    const key = (mode || '-') + '|' + cells.length;
    const changed = key !== plKey;
    plKey = key;
    if (mode === 'strip') {
      try { if (ws.maximizedCell !== active) ws.maximizeCell(active); } catch (e) {}
    } else if (changed && (was === 'strip' || mode)) {
      // entering a phone grid (or leaving the strip): show every pane once; a pane the member
      // maximizes afterwards (Vela's maximize) is left alone
      try { if (ws.maximizedCell) ws.maximizeCell(null); } catch (e) {}
    }
    renderCellTabs(cells, active, mode === 'strip');
    if (changed) { try { grid.refresh(); } catch (e) {} }
  }
  function renderCellTabs(cells, active, show){
    const wasHidden = cellSw.hidden;
    cellSw.hidden = !show;
    if (!show) { swKey = ''; cellSw.innerHTML = ''; if (!wasHidden) window.dispatchEvent(new Event('resize')); return; }
    const key = active + '|' + cells.map((c) => c.id + c.symbol + c.timeframe).join(',');
    if (key !== swKey) {
      swKey = key;
      cellSw.innerHTML = '';
      const tabs = el('div', { class: 'stkc-cells-tabs' });
      const dots = el('div', { class: 'stkc-cells-dots', 'aria-hidden': 'true' });
      cells.forEach((c, i) => {
        const lab = (String(c.symbol || '').replace(/^[a-z]+:/i, '').replace(/1!$/, '') + ' ' + tfLabel(c.timeframe)).trim();
        const on = c.id === active;
        tabs.appendChild(el('button', { type: 'button', role: 'tab', class: 'stkc-cell' + (on ? ' on' : ''),
          'aria-selected': on ? 'true' : 'false', 'aria-label': 'Chart ' + (i + 1) + ': ' + lab, 'data-cell': c.id,
          html: '<b>' + (i + 1) + '</b> <span></span>',
          onclick: () => showCell(c.id) }));
        tabs.lastChild.querySelector('span').textContent = lab;
        dots.appendChild(el('i', { class: on ? 'on' : '' }));
      });
      cellSw.append(tabs, dots);
    }
    if (wasHidden) window.dispatchEvent(new Event('resize'));
  }
  function showCell(id){
    try { ws.setActiveCell(id); if (plMode === 'strip') ws.maximizeCell(id); } catch (e) {}
    applyPhoneLayout();
  }
  // swipe the tab row left / right = next / previous chart
  let swX = null, swY = null;
  cellSw.addEventListener('touchstart', (e) => { if (e.touches.length === 1) { swX = e.touches[0].clientX; swY = e.touches[0].clientY; } }, { passive: true });
  cellSw.addEventListener('touchend', (e) => {
    if (swX == null || !e.changedTouches.length) return;
    const dx = e.changedTouches[0].clientX - swX, dy = e.changedTouches[0].clientY - swY;
    swX = null;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;
    const cells = liveCells();
    let i = 0; try { i = cells.findIndex((c) => c.id === ws.active.id); } catch (e) {}
    const next = cells[(i + (dx < 0 ? 1 : -1) + cells.length) % cells.length];
    if (next) showCell(next.id);
  }, { passive: true });
  function renderCellSwitcher(){ applyPhoneLayout(); }   // old name (refreshLayoutUi)

  function afterStructural(){
    grid.enforceCap();
    try { ws.setTheme(currentTheme()); } catch (e) {}
    refreshLayoutUi();
  }

  try { ws.on('layout:changed', () => setTimeout(refreshLayoutUi, 0)); } catch (e) {}
  try { ws.on('cell:active', () => setTimeout(applyPhoneLayout, 0)); } catch (e) {}
  try { ws.on('state:changed', () => { if (plMode) applyPhoneLayout(); }); } catch (e) {}
  let plRaf = 0;
  const plQueue = () => { if (plRaf) return; plRaf = requestAnimationFrame(() => { plRaf = 0; applyPhoneLayout(); }); };
  window.addEventListener('resize', plQueue, { passive: true });
  window.addEventListener('orientationchange', () => setTimeout(plQueue, 250), { passive: true });
  // full screen on / off changes the plot height (strip vs stacked)
  new MutationObserver(plQueue).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  // A grid wider than this device allows (8 on desktop, 4 on tablets/phones) drops to 4.
  if (cellCount() > Grid.maxCells()) afterStructural();
  refreshLayoutUi();

  // ---------------- templates ----------------
  const T = window.StrykerChartTemplates;

  // Built-in starters (read-only, never stored).
  const STARTERS = [
    { id: 'starter:nq-scalp', name: 'NQ scalping', desc: 'NQ 1m + 5m side by side, synced', layout: '2h', cells: [['futures:NQ1!', '1'], ['futures:NQ1!', '5']], sync: { crosshair: true, viewport: true } },
    { id: 'starter:index-pair', name: 'Index pair', desc: 'NQ + ES on 5m', layout: '2h', cells: [['futures:NQ1!', '5'], ['futures:ES1!', '5']], sync: {} },
    { id: 'starter:quad', name: 'Quad', desc: 'NQ, ES, gold, crude on 15m', layout: '4', cells: [['futures:NQ1!', '15'], ['futures:ES1!', '15'], ['futures:GC1!', '15'], ['futures:CL1!', '15']], sync: {} }
  ];

  function applyStarter(s){
    try { ws.maximizeCell(null); } catch (e) {}
    try { Pine.clearAllPine(); } catch (e) {}
    SYNCS.forEach(([k]) => { try { ws.sync.set(k, false); } catch (e) {} });
    grid.setDateRange(false);
    ws.setLayout(s.layout);
    const cells = liveCells();
    s.cells.forEach(([sym, tf], i) => {
      const c = cells[i] && ws.cell(cells[i].id);
      if (!c) return;
      try { c.setSymbol(sym); c.setTimeframe(tf); } catch (e) { console.warn('TradeZoro: starter cell', e); }
    });
    SYNCS.forEach(([k]) => { if (s.sync[k]) { try { ws.sync.set(k, true); } catch (e) {} } });
    afterStructural();
  }
  // A SETUP (Owner 2026-11-01) = indicators, their settings/colours and panes only. No symbol, interval,
  // drawings or date range, so it lands on whatever the member has open. Templates and library setups share it.
  const SETUP_DROP = ['symbol', 'provider', 'timeframe', 'drawings'];
  function setupOf(st){
    const charts = ((st && st.charts) || []).map((c) => {
      const o = Object.assign({}, c);
      SETUP_DROP.forEach((k) => delete o[k]);
      if (o.ext) { o.ext = Object.assign({}, o.ext); delete o.ext['stryker.grid']; }
      return o;
    });
    // drawings sync is a drawing setting, not a setup one (and the rules refuse "drawings" in a setup)
    const sync = st.sync ? Object.assign({}, st.sync) : undefined; if (sync) delete sync.drawings;
    return { version: 1, setup: true, layout: st.layout, sync, trackSizes: st.trackSizes, charts };
  }
  // Setup onto the current workspace: chart i keeps its own symbol, interval and drawings (extra charts take the active one's market).
  function mergeSetup(curSt, s){
    curSt = curSt || { version: 1, charts: [] };
    const now = (Array.isArray(curSt.charts) ? curSt.charts : []).filter(Boolean);
    const act = now.find((c) => c.id === curSt.activeCellId) || now[0] || {};
    const used = new Set();
    const charts = (Array.isArray(s.charts) ? s.charts : []).filter((c) => c && typeof c === 'object').map((c, i) => {
      const keep = now[i] || { symbol: act.symbol, provider: act.provider, timeframe: act.timeframe };
      const o = Object.assign({}, keep, c);
      SETUP_DROP.forEach((k) => { if (k in keep) o[k] = keep[k]; else delete o[k]; });
      if (keep.ext && keep.ext['stryker.grid']) o.ext = Object.assign({}, o.ext, { 'stryker.grid': keep.ext['stryker.grid'] });
      let id = now[i] ? now[i].id : c.id;
      if (!id || used.has(id)) id = 'S' + i;
      used.add(id); o.id = id;
      return o;
    });
    if (!charts.length) return curSt;  // nothing to apply: never swap the member's charts for an empty list
    // charts beyond the setup's count stay (Vela pools them), so their drawings and symbols survive a smaller grid
    now.slice(charts.length).forEach((c) => { if (c && c.id && !used.has(c.id)) { used.add(c.id); charts.push(c); } });
    const out = Object.assign({}, curSt, { layout: s.layout || curSt.layout, charts });
    if (s.sync) { out.sync = Object.assign({}, s.sync); delete out.sync.drawings; if (curSt.sync && curSt.sync.drawings) out.sync.drawings = curSt.sync.drawings; }
    if (s.trackSizes) out.trackSizes = s.trackSizes; else delete out.trackSizes;
    if (!charts.some((c) => c.id === out.activeCellId)) delete out.activeCellId;
    return out;
  }
  function applySaved(t){
    let doc = t.state;
    if (typeof doc === 'string') { try { doc = JSON.parse(doc); } catch (e) { doc = null; } }
    if (!doc) { toast('That template could not be read.', 'error'); return; }
    if (doc.setup) doc = mergeSetup(ws.getState(), doc);
    try { ws.maximizeCell(null); } catch (e) {}
    try { Pine.clearAllPine(); } catch (e) {}
    ws.applyState(doc);
    afterStructural();
  }
  function applyAny(t){ if (t.starter) applyStarter(t); else applySaved(t); }

  window.STRYKER_CHART_UI = { applyStarter, applySaved, setupOf, mergeSetup, STARTERS, setLayout, refreshLayoutUi, grid };
  if (Safe.phone) {
    import('./chart-safe-mode.js?v=938').then((m) => m.mountSafeBanner(Safe, ws, applySaved)).catch((e) => console.warn('TradeZoro: safe mode banner', e));
    // stable = the indicators are loaded; the guard clears its mark 20 s later
    const go = () => { Safe.started(); if (Safe.onChange) Safe.onChange(); };
    if (window.__stkHeavyReady) go(); else window.addEventListener('stk:heavy-ready', go, { once: true });
  }

  // Layout menu (assets/chart-layouts.js): mounted after the default template has had its
  // chance to apply, so a shared-layout link (?layout=) is never overwritten by it.
  function mountLayoutMenu(){
    import('./chart-layouts.js?v=938')
      .then((m) => m.mountLayouts(ws, { barL, bindPopover, sheetHead, toast, ui: window.STRYKER_CHART_UI, grid, Pine }))
      .catch((e) => console.warn('TradeZoro: layout menu', e));
  }
  if (!T) { tplWrap.hidden = true; mountLayoutMenu(); return; }

  let editing = null;   // id of the template being renamed
  let saving = false;
  let lastErr = '';

  async function renderTemplates(){
    let list = [];
    let defId = null;
    let note = '';
    try { const r = await T.list(); list = r.items; defId = r.defaultId; note = r.note || ''; }
    catch (e) { note = 'Could not load your templates.'; }
    tplPop.innerHTML = '';
    tplPop.appendChild(sheetHead(tplPop, 'Templates', T.signedIn() ? 'Saved to your account' : 'Saved in this browser. Sign in to keep them on your account.'));

    const nameIn = el('input', { type: 'text', class: 'stkc-in', maxlength: String(T.NAME_MAX), placeholder: 'Name this chart setup', 'aria-label': 'Template name', enterkeyhint: 'done' });
    const saveBtn = el('button', { type: 'button', class: 'stkc-sbtn', text: 'Save' });
    const setupBtn = el('button', { type: 'button', class: 'stkc-sbtn stkc-sbtn-2', text: 'Save as setup', title: 'Indicators, settings and panes only. Applies to any symbol and keeps your drawings.' });
    const doSave = async (setup) => {
      const name = nameIn.value.trim();
      if (!name) { nameIn.focus(); return; }
      if (saving) return;
      saving = true; saveBtn.disabled = setupBtn.disabled = true; lastErr = '';
      try { await T.save(name, setup ? setupOf(ws.getState()) : ws.getState()); toast(setup ? 'Setup saved' : 'Template saved'); }
      catch (e) { lastErr = (e && e.userMessage) || 'Could not save the template.'; console.warn('TradeZoro: template save', e); }
      saving = false; renderTemplates();
    };
    saveBtn.addEventListener('click', () => doSave(false));
    setupBtn.addEventListener('click', () => doSave(true));
    nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSave(false); });
    tplPop.appendChild(el('button', { type: 'button', class: 'stkc-tname stkt-browse', 'aria-label': 'Browse ready-made templates', onclick: () => {
      setTpl(false);
      import('./chart-tpl-gallery.js?v=938').then((m) => m.openGallery({ ws, Pine, afterStructural, setLayout, toast })).catch((e) => { console.warn('TradeZoro: template gallery', e); toast('Could not open the templates.', 'error'); });
    } }, [el('span', { class: 'stkc-mi-t' }, [el('span', { class: 'stkc-mi-l', text: 'Ready-made templates' }), el('small', { class: 'stkc-mi-s', text: 'Order flow, GEX, dark pool, swing and more. Free to apply.' })]), el('span', { class: 'stkc-tapply', 'aria-hidden': 'true', text: 'Browse' })]));
    tplPop.appendChild(el('p', { class: 'stkc-pop-h', text: 'Save current chart' }));
    tplPop.appendChild(el('div', { class: 'stkc-saverow' }, [nameIn, saveBtn]));
    tplPop.appendChild(el('div', { class: 'stkc-saverow stkc-saverow-2' }, [setupBtn]));
    const msg = lastErr || note;
    if (msg) tplPop.appendChild(el('p', { class: 'stkc-err', role: 'status', text: msg }));

    tplPop.appendChild(el('p', { class: 'stkc-pop-h', text: 'My templates' + (list.length ? ' (' + list.length + '/' + T.MAX_COUNT + ')' : '') }));
    if (!list.length) tplPop.appendChild(el('div', { class: 'stkc-tpl-empty' }, [el('span', { class: 'stkc-mi-ic', html: icon('<path d="M6 4h12v16l-6-4-6 4z"/>') }), el('span', { text: 'Name the chart above and tap Save to keep it here.' })]));
    const ul = el('ul', { class: 'stkc-tlist' });
    list.forEach((t) => ul.appendChild(row(t, t.id === defId)));
    tplPop.appendChild(ul);

    tplPop.appendChild(el('p', { class: 'stkc-pop-h', text: 'Starters' }));
    const ul2 = el('ul', { class: 'stkc-tlist' });
    STARTERS.forEach((s) => ul2.appendChild(row(Object.assign({ starter: true }, s), s.id === defId)));
    tplPop.appendChild(ul2);
  }

  const STAR = '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"';
  function row(t, isDef){
    const li = el('li', { class: 'stkc-trow' + (isDef ? ' is-def' : '') });
    if (editing === t.id && !t.starter) {
      const inp = el('input', { type: 'text', class: 'stkc-in', maxlength: String(T.NAME_MAX), 'aria-label': 'New name' });
      inp.value = t.name;
      const ok = el('button', { type: 'button', class: 'stkc-sbtn', text: 'OK' });
      const go = async () => {
        const v = inp.value.trim(); if (!v) return;
        try { await T.rename(t.id, v); lastErr = ''; } catch (e) { lastErr = 'Could not rename.'; }
        editing = null; renderTemplates();
      };
      ok.addEventListener('click', go);
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') go();
        if (e.key === 'Escape') { e.stopPropagation(); editing = null; renderTemplates(); }
      });
      li.appendChild(inp); li.appendChild(ok);
      setTimeout(() => inp.focus(), 0);
      return li;
    }
    const sub = [t.desc, isDef ? 'Default' : ''].filter(Boolean).join(' · ');
    li.appendChild(el('button', { type: 'button', class: 'stkc-tname', title: 'Apply ' + t.name, 'aria-label': 'Apply ' + t.name,
      onclick: () => { applyAny(t); setTpl(false); toast('Applied "' + t.name + '"'); } }, [
      el('span', { class: 'stkc-mi-t' }, [el('span', { class: 'stkc-mi-l', text: t.name }), sub ? el('small', { class: 'stkc-mi-s', text: sub }) : null]),
      el('span', { class: 'stkc-tapply', 'aria-hidden': 'true', text: 'Apply' })]));
    const acts = el('span', { class: 'stkc-tacts' });
    const defTip = isDef ? 'Default: opens when this browser has no chart yet. Tap to clear.' : 'Set as default: opens when this browser has no chart yet';
    acts.appendChild(el('button', { type: 'button', class: 'stkc-ib stkc-tstar' + (isDef ? ' on' : ''),
      title: defTip, 'aria-label': (isDef ? 'Clear default: ' : 'Set as default: ') + t.name, 'aria-pressed': isDef ? 'true' : 'false',
      html: icon(STAR + (isDef ? ' fill="currentColor"' : '') + '/>'),
      onclick: async () => { try { await T.setDefault(isDef ? null : t.id); lastErr = ''; toast(isDef ? 'Default cleared' : '"' + t.name + '" is now your default'); } catch (e) { lastErr = 'Could not set the default.'; } renderTemplates(); } }));
    if (!t.starter) {
      acts.appendChild(el('button', { type: 'button', class: 'stkc-ib', title: 'Rename', 'aria-label': 'Rename ' + t.name,
        html: icon('<path d="M4 20h4L19 9l-4-4L4 16z"/>'), onclick: () => { editing = t.id; renderTemplates(); } }));
      acts.appendChild(el('button', { type: 'button', class: 'stkc-ib stkc-del', title: 'Delete', 'aria-label': 'Delete ' + t.name,
        html: icon('<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>'),
        onclick: async () => {
          if (!window.confirm('Delete the template "' + t.name + '"?')) return;
          try { await T.remove(t.id); lastErr = ''; } catch (e) { lastErr = 'Could not delete.'; }
          renderTemplates();
        } }));
    }
    li.appendChild(acts);
    return li;
  }

  window.STRYKER_CHART_UI.renderTemplates = renderTemplates;

  // Default template: only when this browser had no saved session at load.
  if (!hadSession && !BT) {
    try {
      const r = await T.list();
      if (r.defaultId) {
        const t = r.defaultId.startsWith('starter:')
          ? STARTERS.map((s) => Object.assign({ starter: true }, s)).find((s) => s.id === r.defaultId)
          : r.items.find((x) => x.id === r.defaultId);
        if (t) applyAny(t);
      }
    } catch (e) { /* no default: keep the stock chart */ }
  }
  mountLayoutMenu();
})();

// Owner 11-04: no vendor name visible. The engine keeps a hidden attribution <a> in the DOM; blank its text hooks.
(function () {
  const clean = () => document.querySelectorAll('a.vela-attribution').forEach((a) => {
    a.removeAttribute('title'); a.removeAttribute('aria-label'); a.removeAttribute('href'); a.setAttribute('aria-hidden', 'true'); a.tabIndex = -1;
  });
  new MutationObserver(clean).observe(document.documentElement, { childList: true, subtree: true });
  clean();
})();
