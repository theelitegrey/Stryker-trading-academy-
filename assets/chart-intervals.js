// Stryker Trading Academy — Charts interval picker (ES module)
// Depends on: the Vela workspace built in assets/vela-chart.js (ws: active cell, setActiveTimeframe,
// on('cell:active' | 'state:changed'), its topbar .vela-widget-tf-group and the phone bar
// .vela-mb-tf); assets/toast.js through opts.toast. Styles are injected here (#stk-iv-css).
//
// Owner order 2026-10-06: "add timeframe and interval feature like this" (TradingView's picker).
//   - Top bar: a row of the member's STARRED intervals in time order, the active one as a grey pill,
//     then a caret that opens the full menu. Narrow widths and phones show only the active interval
//     plus the caret (no sideways scroll). Vela's own chips and caret are hidden, not removed.
//   - Menu: sections Ticks / Seconds / Minutes / Hours / Days, each collapsible (state remembered),
//     a star per row to add or remove it from the top row, the active row as a white pill.
//   - Favourites and collapse state live in localStorage for every member (stage 1).
// DATA (honest about each source, never fake bars):
//   - Minutes / hours / days work everywhere. wrapProvider() builds intervals a source does not
//     serve natively by aggregating the nearest smaller native interval: futures 2m 3m 10m 45m 3h
//     (buckets anchored to the 18:00 New York Globex open, like functions/api/chart/_bars.js
//     aggregateHours) and 3M 6M 12M everywhere (calendar quarters / halves / years). Crypto venues
//     already aggregate their own missing minute intervals.
//   - Seconds and ticks need a trade stream. Futures rows carry a "Rithmic" tag ("Needs a Rithmic
//     connection (real-time data)"); crypto seconds/ticks arrive in the next update. Clicking them
//     shows that message and never switches the chart.
// No order or trade button anywhere here (Owner rule: no buying/selling on the website).

const LS_FAVS = 'stryker_chart_iv_favs';
const LS_COLLAPSED = 'stryker_chart_iv_collapsed';
const DEFAULT_FAVS = ['1', '5', '15', '60', '240', 'D'];
const PHONE_MAX = 700;
const NARROW_BAR = 760;          // topbar narrower than this: collapse the row to the active interval
const H = 3600000, MIN = 60000;
const NEED_RITHMIC = 'Needs a Rithmic connection (real-time data)';
const NEXT_UPDATE = 'Seconds and tick charts for crypto are coming in the next update.';

export const SECTIONS = [
  { id: 'ticks', label: 'Ticks', rows: ['1T', '10T', '100T', '1000T'] },
  { id: 'seconds', label: 'Seconds', rows: ['1S', '5S', '10S', '15S', '30S', '45S'] },
  { id: 'minutes', label: 'Minutes', rows: ['1', '2', '3', '5', '10', '15', '30', '45'] },
  { id: 'hours', label: 'Hours', rows: ['60', '120', '180', '240'] },
  { id: 'days', label: 'Days', rows: ['D', 'W', 'M', '3M', '6M', '12M'] }
];

// ---------------- interval ids ----------------
// '15' minutes, '15S' seconds, '100T' ticks, 'D' 'W' 'M', '3M' months.
export function parseIv(tf) {
  tf = String(tf || '').trim();
  let m;
  if (/^\d+$/.test(tf)) return { kind: 'min', n: +tf, ms: +tf * MIN };
  if ((m = /^(\d+)S$/i.exec(tf))) return { kind: 'sec', n: +m[1], ms: +m[1] * 1000 };
  if ((m = /^(\d+)T$/i.exec(tf))) return { kind: 'tick', n: +m[1], ms: -1e9 + +m[1] };
  if (tf === 'D' || tf === '1D') return { kind: 'day', n: 1, ms: 864e5 };
  if (tf === 'W' || tf === '1W') return { kind: 'week', n: 1, ms: 6048e5 };
  if (tf === 'M') return { kind: 'month', n: 1, ms: 2592e6 };
  if ((m = /^(\d+)M$/.exec(tf))) return { kind: 'month', n: +m[1], ms: +m[1] * 2592e6 };
  return null;
}
export function ivShort(tf) {
  const p = parseIv(tf);
  if (!p) return String(tf);
  if (p.kind === 'tick') return p.n + 'T';
  if (p.kind === 'sec') return p.n + 's';
  if (p.kind === 'min') return p.n % 60 === 0 ? (p.n / 60) + 'h' : p.n + 'm';
  if (p.kind === 'day') return 'D';
  if (p.kind === 'week') return 'W';
  return p.n === 1 ? 'M' : p.n + 'M';
}
export function ivLong(tf) {
  const p = parseIv(tf);
  if (!p) return String(tf);
  const pl = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  if (p.kind === 'tick') return pl(p.n, 'tick');
  if (p.kind === 'sec') return pl(p.n, 'second');
  if (p.kind === 'min') return p.n % 60 === 0 ? pl(p.n / 60, 'hour') : pl(p.n, 'minute');
  if (p.kind === 'day') return '1 day';
  if (p.kind === 'week') return '1 week';
  return pl(p.n, 'month');
}
const ivMs = (tf) => { const p = parseIv(tf); return p ? p.ms : Infinity; };
export const sortIvs = (list) => list.slice().sort((a, b) => ivMs(a) - ivMs(b));

// ---------------- aggregation (pure, exported for tests) ----------------
// New York UTC offset (ms), US DST rules (mirrors chart-futures-provider.js nyOffset).
function nthSunday(y, m, n) { const f = Date.UTC(y, m, 1); const dow = new Date(f).getUTCDay(); return f + (((7 - dow) % 7) + 7 * (n - 1)) * 864e5; }
function nyOffsetMs(t) {
  const y = new Date(t).getUTCFullYear();
  const s = nthSunday(y, 2, 2) + 7 * H, e = nthSunday(y, 10, 1) + 6 * H;
  return t >= s && t < e ? -4 * H : -5 * H;
}
// Bucket key: N-minute bars anchored to 18:00 New York (the Globex open), so for any size that
// divides 24 h every session starts a fresh bar (45m: 18:00, 18:45 ... ; 3h: 18, 21, 00 ...).
export function sessionKey(t, sizeMs) {
  const shift = nyOffsetMs(t) + 6 * H;
  return Math.floor((t + shift) / sizeMs) * sizeMs - shift;
}
export const utcKey = (t, sizeMs) => Math.floor(t / sizeMs) * sizeMs;
export function monthKey(t, n) {
  const d = new Date(t + 12 * H); // monthly bars stamped near midnight of the 1st: stay in that month
  const idx = d.getUTCFullYear() * 12 + d.getUTCMonth();
  return Math.floor(idx / n) * n;
}
export function aggregateBars(bars, keyOf) {
  const out = [];
  let cur = null, curKey = null;
  for (const b of bars) {
    const k = keyOf(b.time);
    if (cur && k === curKey) {
      if (b.high > cur.high) cur.high = b.high;
      if (b.low < cur.low) cur.low = b.low;
      cur.close = b.close;
      cur.volume = (cur.volume || 0) + (b.volume || 0);
    } else {
      curKey = k;
      cur = { time: typeof k === 'number' && k > 1e11 ? k : b.time, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume || 0 };
      out.push(cur);
    }
  }
  return out;
}

// Which intervals a source serves natively (others are built by wrapProvider).
const NATIVE_FUT_MIN = [1, 5, 15, 30, 60, 120, 240];
// How to build `tf` for this provider, or null when the inner provider serves it itself.
export function planFor(provider, tf) {
  const p = parseIv(tf);
  if (!p) return null;
  if (p.kind === 'month' && p.n > 1) return { base: 'M', ratio: p.n, key: (t) => monthKey(t, p.n) };
  if (provider !== 'futures' || p.kind !== 'min' || NATIVE_FUT_MIN.includes(p.n)) return null;
  if (p.n >= 1440) return null;
  const base = NATIVE_FUT_MIN.filter((m) => m < p.n && p.n % m === 0).pop() || 1;
  const size = p.n * MIN;
  return { base: String(base), ratio: p.n / base, key: (t) => sessionKey(t, size) };
}

// Wrap a Vela DataProvider so the intervals above can be built from a native one. Everything else
// passes straight through to the inner provider.
export function wrapProvider(inner, name, pollMs) {
  const getBars = async (ticker, timeframe, range = {}) => {
    const plan = planFor(name, timeframe);
    if (!plan) return inner.getBars(ticker, timeframe, range);
    const lim = range.limit != null ? range.limit * plan.ratio + plan.ratio : undefined;
    const sub = await inner.getBars(ticker, plan.base, { ...range, limit: lim });
    let out = aggregateBars(sub || [], plan.key);
    if (range.limit != null && out.length > range.limit) out = out.slice(-range.limit);
    return out;
  };
  const subscribe = (ticker, timeframe, onBar, opts) => {
    if (!planFor(name, timeframe)) return inner.subscribe ? inner.subscribe(ticker, timeframe, onBar, opts) : () => {};
    // Built interval: re-read the newest two built bars (the forming one moves), paused while hidden.
    let stopped = false, timer = null;
    const tick = async () => {
      timer = null;
      if (stopped) return;
      if (typeof document === 'undefined' || !document.hidden) {
        try { const bars = await getBars(ticker, timeframe, { limit: 2 }); if (!stopped) bars.forEach((b) => onBar(b)); } catch (e) { /* next poll */ }
      }
      if (!stopped) timer = setTimeout(tick, pollMs);
    };
    timer = setTimeout(tick, pollMs);
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  };
  return new Proxy(inner, {
    get(t, prop) {
      if (prop === 'getBars') return getBars;
      if (prop === 'subscribe') return subscribe;
      const v = t[prop];
      return typeof v === 'function' ? v.bind(t) : v;
    }
  });
}
export const wrapFactory = (factory, name, pollMs) => () => wrapProvider(factory(), name, pollMs || (name === 'futures' ? 20000 : 5000));

// ---------------- UI ----------------
const CSS = `
.vela-widget-tf-group > .vela-widget-tf-chips, .vela-widget-tf-group > .vela-widget-tf-caret{display:none!important}
.stk-iv-row{display:inline-flex;align-items:center;gap:2px}
.stk-iv-b{all:unset;box-sizing:border-box;height:30px;min-width:30px;padding:0 7px;display:inline-flex;align-items:center;justify-content:center;
  border-radius:6px;cursor:pointer;font-size:13px;font-weight:550;color:#d1d4dc;white-space:nowrap}
.stk-iv-b:hover{background:rgba(255,255,255,.08);color:#fff}
.stk-iv-b.on{background:#2a2e39;color:#fff}
.stk-iv-b:focus-visible{outline:2px solid #2962ff;outline-offset:-2px}
.stk-iv-caret{min-width:20px;padding:0 3px;color:#b2b5be}
.stk-iv-caret svg{width:16px;height:16px;transition:transform .15s}
.stk-iv-caret[aria-expanded="true"] svg{transform:rotate(180deg)}
:root[data-theme="light"] .stk-iv-b{color:#131722}
:root[data-theme="light"] .stk-iv-b:hover{background:#f0f3fa;color:#131722}
:root[data-theme="light"] .stk-iv-b.on{background:#e0e3eb;color:#131722}
.stk-iv-menu{position:fixed;z-index:2147483000;width:250px;max-height:min(560px,calc(100vh - 80px));overflow-y:auto;overscroll-behavior:contain;
  background:#1e222d;color:#d1d4dc;border:1px solid #363a45;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.5);padding:6px 0;
  font:13px/1.2 -apple-system,BlinkMacSystemFont,"Trebuchet MS",Roboto,Ubuntu,sans-serif;user-select:none}
.stk-iv-menu[hidden]{display:none}
.stk-iv-menu.sheet{left:0!important;right:0;top:auto!important;bottom:0;width:auto;max-height:72vh;border-radius:14px 14px 0 0;padding-bottom:calc(10px + env(safe-area-inset-bottom))}
.stk-iv-add{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:8px;width:100%;padding:9px 14px;cursor:pointer;color:#d1d4dc}
.stk-iv-add:hover{background:#2a2e39}
.stk-iv-add[aria-disabled="true"]{color:#787b86;cursor:default}
.stk-iv-add[aria-disabled="true"]:hover{background:none}
.stk-iv-sep{height:1px;background:#363a45;margin:5px 0}
.stk-iv-h{all:unset;box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;width:100%;padding:9px 14px 6px;cursor:pointer;
  color:#787b86;font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase}
.stk-iv-h:hover{color:#b2b5be}
.stk-iv-h svg{width:14px;height:14px;transition:transform .15s}
.stk-iv-h[aria-expanded="false"] svg{transform:rotate(180deg)}
.stk-iv-list{margin:0;padding:0 6px;list-style:none}
.stk-iv-list[hidden]{display:none}
.stk-iv-r{display:flex;align-items:center;gap:6px;height:34px;padding:0 6px 0 10px;border-radius:6px;cursor:pointer}
.stk-iv-r:hover{background:#2a2e39}
.stk-iv-r.on{background:#fff;color:#131722}
.stk-iv-r .l{flex:1}
.stk-iv-r .tag{font-size:10px;font-weight:600;letter-spacing:.04em;padding:2px 5px;border-radius:4px;background:rgba(41,98,255,.18);color:#82a6ff}
.stk-iv-r.on .tag{background:#e0e3eb;color:#2962ff}
.stk-iv-r.na .l{color:#787b86}
.stk-iv-r.na.on .l{color:#131722}
.stk-iv-star{all:unset;box-sizing:border-box;width:26px;height:26px;display:flex;align-items:center;justify-content:center;border-radius:4px;cursor:pointer;color:#787b86;visibility:hidden}
.stk-iv-star svg{width:16px;height:16px}
.stk-iv-r:hover .stk-iv-star,.stk-iv-star.fav,.stk-iv-star:focus-visible{visibility:visible}
.stk-iv-star.fav{color:#f5a623}
.stk-iv-star:hover{color:#f5a623}
@media (hover:none){.stk-iv-star{visibility:visible}}
:root[data-theme="light"] .stk-iv-menu{background:#fff;color:#131722;border-color:#e0e3eb;box-shadow:0 8px 24px rgba(0,0,0,.18)}
:root[data-theme="light"] .stk-iv-add{color:#131722}
:root[data-theme="light"] .stk-iv-add:hover,:root[data-theme="light"] .stk-iv-r:hover{background:#f0f3fa}
:root[data-theme="light"] .stk-iv-r.on{background:#131722;color:#fff}
:root[data-theme="light"] .stk-iv-r.na.on .l{color:#fff}
:root[data-theme="light"] .stk-iv-r.on .tag{background:#363a45;color:#82a6ff}
:root[data-theme="light"] .stk-iv-sep{background:#e0e3eb}
.stk-iv-scrim{position:fixed;inset:0;z-index:2147482999;background:rgba(0,0,0,.45)}
.stk-iv-scrim[hidden]{display:none}
`;

const SVG = (d, extra) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"' + (extra || '') + '>' + d + '</svg>';
const CHEV_DOWN = SVG('<path d="M6 9l6 6 6-6"/>');
const CHEV_UP = SVG('<path d="M6 15l6-6 6 6"/>');
const STAR = (on) => SVG('<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8L3.5 9.7l5.9-.9z"' + (on ? ' fill="currentColor"' : '') + '/>');

function readLs(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return Array.isArray(v) ? v : fallback; } catch (e) { return fallback; }
}
function writeLs(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) {} }
const providerOf = (sym) => { const m = /^([a-z]+):/i.exec(String(sym || '')); return m ? m[1].toLowerCase() : ''; };

export function mountIntervals(ws, opts) {
  opts = opts || {};
  const toast = opts.toast || (() => {});
  if (!document.getElementById('stk-iv-css')) { const st = document.createElement('style'); st.id = 'stk-iv-css'; st.textContent = CSS; document.head.appendChild(st); }

  const known = new Set(SECTIONS.flatMap((s) => s.rows));
  let favs = readLs(LS_FAVS, DEFAULT_FAVS).filter((t) => typeof t === 'string' && parseIv(t));
  let collapsed = readLs(LS_COLLAPSED, []).filter((s) => typeof s === 'string');
  const isPhone = () => window.innerWidth <= PHONE_MAX;
  const activeCell = () => { try { return ws.active; } catch (e) { return null; } };
  const activeTf = () => { const c = activeCell(); return c ? String(c.timeframe || '') : ''; };
  const activeSym = () => { const c = activeCell(); return c ? String(c.symbol || '') : ''; };

  // Why an interval cannot open on the active chart right now, or '' when it can.
  function blocked(tf) {
    const p = parseIv(tf);
    if (!p || (p.kind !== 'sec' && p.kind !== 'tick')) return '';
    return providerOf(activeSym()) === 'futures' ? NEED_RITHMIC : NEXT_UPDATE;
  }
  function apply(tf) {
    const why = blocked(tf);
    if (why) { toast(why, 'info'); return false; }
    try { ws.setActiveTimeframe(tf); } catch (e) { console.warn('Stryker: interval', e); toast('That interval could not be opened on this chart.', 'error'); return false; }
    setTimeout(render, 0);
    return true;
  }
  function toggleFav(tf) {
    favs = favs.includes(tf) ? favs.filter((f) => f !== tf) : favs.concat(tf);
    writeLs(LS_FAVS, favs);
    render();
    renderMenu();
  }

  // ---- top-bar row ----
  const row = document.createElement('span');
  row.className = 'stk-iv-row';
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', 'Chart interval');
  const caret = document.createElement('button');
  caret.type = 'button';
  caret.className = 'stk-iv-b stk-iv-caret';
  caret.setAttribute('aria-haspopup', 'true');
  caret.setAttribute('aria-expanded', 'false');
  caret.title = 'Intervals';
  caret.innerHTML = CHEV_DOWN;
  const chips = document.createElement('span');
  chips.className = 'stk-iv-row';
  row.append(chips, caret);

  let narrow = false;
  function render() {
    const cur = activeTf();
    let list = narrow ? [] : sortIvs(favs.filter((f, i, a) => a.indexOf(f) === i));
    if (cur && !list.includes(cur)) list = sortIvs(list.concat(cur));
    chips.innerHTML = '';
    list.forEach((tf) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'stk-iv-b' + (tf === cur ? ' on' : '');
      b.textContent = ivShort(tf);
      b.title = ivLong(tf);
      b.dataset.iv = tf;
      if (tf === cur) b.setAttribute('aria-current', 'true');
      b.addEventListener('click', (e) => { e.stopPropagation(); if (narrow && tf === cur) toggleMenu(); else if (tf !== cur) apply(tf); });
      chips.appendChild(b);
    });
  }

  let topbar = null;
  let ro = null;
  function attach() {
    const group = document.querySelector('#vela-chart .vela-widget-tf-group');
    if (!group) return false;
    if (row.parentElement !== group) group.appendChild(row);
    const tb = group.closest('.vela-widget-topbar');
    if (tb && tb !== topbar) {
      topbar = tb;
      if (ro) ro.disconnect();
      ro = new ResizeObserver(() => {
        const n = isPhone() || topbar.getBoundingClientRect().width < NARROW_BAR;
        if (n !== narrow) { narrow = n; render(); }
      });
      ro.observe(topbar);
    }
    narrow = isPhone() || (topbar ? topbar.getBoundingClientRect().width < NARROW_BAR : false);
    render();
    return true;
  }

  // ---- menu ----
  const menu = document.createElement('div');
  menu.className = 'stk-iv-menu';
  menu.id = 'stk-iv-menu';
  menu.setAttribute('role', 'dialog');
  menu.setAttribute('aria-label', 'Intervals');
  menu.hidden = true;
  const scrim = document.createElement('div');
  scrim.className = 'stk-iv-scrim';
  scrim.hidden = true;
  document.body.append(scrim, menu);
  menu.addEventListener('click', (e) => e.stopPropagation());
  scrim.addEventListener('click', () => setOpen(false));

  function renderMenu() {
    if (menu.hidden) return;
    const keepScroll = menu.scrollTop;
    const cur = activeTf();
    const fut = providerOf(activeSym()) === 'futures';
    menu.innerHTML = '';
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'stk-iv-add';
    add.setAttribute('aria-disabled', 'true');
    add.title = 'Custom intervals arrive in the next update';
    add.innerHTML = '<span aria-hidden="true">+</span><span>Add custom interval…</span>';
    add.addEventListener('click', () => toast('Custom intervals arrive in the next update.', 'info'));
    menu.appendChild(add);
    SECTIONS.forEach((sec) => {
      menu.appendChild(Object.assign(document.createElement('div'), { className: 'stk-iv-sep' }));
      const open = !collapsed.includes(sec.id);
      const h = document.createElement('button');
      h.type = 'button';
      h.className = 'stk-iv-h';
      h.setAttribute('aria-expanded', open ? 'true' : 'false');
      h.setAttribute('aria-controls', 'stk-iv-sec-' + sec.id);
      h.innerHTML = '<span>' + sec.label + '</span>' + CHEV_UP;
      h.addEventListener('click', () => {
        collapsed = open ? collapsed.concat(sec.id) : collapsed.filter((s) => s !== sec.id);
        writeLs(LS_COLLAPSED, collapsed);
        renderMenu();
      });
      menu.appendChild(h);
      const ul = document.createElement('ul');
      ul.className = 'stk-iv-list';
      ul.id = 'stk-iv-sec-' + sec.id;
      ul.hidden = !open;
      sec.rows.forEach((tf) => {
        const why = blocked(tf);
        const li = document.createElement('li');
        li.className = 'stk-iv-r' + (tf === cur ? ' on' : '') + (why ? ' na' : '');
        li.dataset.iv = tf;
        li.setAttribute('role', 'button');
        li.tabIndex = 0;
        if (why) li.title = why;
        const l = document.createElement('span');
        l.className = 'l';
        l.textContent = ivLong(tf);
        li.appendChild(l);
        if (why && fut) {
          const tag = document.createElement('span');
          tag.className = 'tag';
          tag.textContent = 'Rithmic';
          tag.title = NEED_RITHMIC;
          li.appendChild(tag);
        }
        const fav = favs.includes(tf);
        const star = document.createElement('button');
        star.type = 'button';
        star.className = 'stk-iv-star' + (fav ? ' fav' : '');
        star.setAttribute('aria-pressed', fav ? 'true' : 'false');
        star.setAttribute('aria-label', (fav ? 'Remove from favourites: ' : 'Add to favourites: ') + ivLong(tf));
        star.innerHTML = STAR(fav);
        star.addEventListener('click', (e) => { e.stopPropagation(); toggleFav(tf); });
        li.appendChild(star);
        const go = () => { if (apply(tf)) setOpen(false); };
        li.addEventListener('click', go);
        li.addEventListener('keydown', (e) => { if (e.target === li && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); go(); } });
        ul.appendChild(li);
      });
      menu.appendChild(ul);
    });
    menu.scrollTop = keepScroll;
  }

  let anchor = caret;
  function place() {
    if (isPhone()) { menu.classList.add('sheet'); scrim.hidden = false; return; }
    menu.classList.remove('sheet');
    scrim.hidden = true;
    const r = anchor.getBoundingClientRect();
    const w = menu.offsetWidth || 250;
    menu.style.left = Math.max(6, Math.min(window.innerWidth - w - 6, r.left)) + 'px';
    menu.style.top = Math.round(r.bottom + 4) + 'px';
  }
  function setOpen(open, from) {
    if (open) {
      anchor = from || caret;
      menu.hidden = false;
      renderMenu();
      place();
      const on = menu.querySelector('.stk-iv-r.on');
      if (on && !isPhone()) {
        const mr = menu.getBoundingClientRect(), orr = on.getBoundingClientRect();
        if (orr.bottom > mr.bottom || orr.top < mr.top) menu.scrollTop += orr.top - mr.top - mr.height / 2;
      }
    } else {
      menu.hidden = true;
      scrim.hidden = true;
    }
    caret.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  function toggleMenu(from) { setOpen(menu.hidden, from); }
  caret.addEventListener('click', (e) => { e.stopPropagation(); toggleMenu(); });
  document.addEventListener('click', () => { if (!menu.hidden) setOpen(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !menu.hidden) setOpen(false); });
  window.addEventListener('resize', () => { if (!menu.hidden) place(); }, { passive: true });

  // Phone bar: its interval button opens this menu (as a bottom sheet) instead of Vela's drawer.
  document.addEventListener('click', (e) => {
    const b = e.target && e.target.closest && e.target.closest('#vela-chart .vela-mb-tf');
    if (!b) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    toggleMenu(b);
  }, true);

  const refresh = () => { if (!row.isConnected) attach(); render(); renderMenu(); };
  try { ws.on('cell:active', () => setTimeout(refresh, 0)); } catch (e) {}
  try { ws.on('state:changed', () => refresh()); } catch (e) {}
  try { ws.on('layout:changed', () => setTimeout(refresh, 0)); } catch (e) {}
  if (!attach()) { let n = 0; const t = setInterval(() => { if (attach() || ++n > 40) clearInterval(t); }, 250); }

  const api = { open: () => setOpen(true), close: () => setOpen(false), favs: () => favs.slice(), toggleFav, apply, known };
  window.__stkIntervals = api;
  return api;
}
