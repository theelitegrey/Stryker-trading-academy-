// TradeZoro — ZoroCharts ready-made chart templates (ES module, loaded by assets/vela-chart.js).
// A template = timeframe + indicators with settings (+ optionally a market). Free to apply; a Pro
// indicator inside follows the member's plan: it is skipped for a Free member and the normal
// upgrade prompt opens (gate helpers: assets/chart-pro-gate.js). Members save their OWN layouts with
// the Templates menu (assets/chart-templates.js), so this file only holds the built-in set.
// Thumbnails: assets/images/templates/<id>.webp (+ <id>-light.webp): each template applied on the recorded test bars
// (tools/tests/chart-tpl-thumbs.js regenerates them). They are labelled "Sample data" on the cards.
// Education only. Not financial advice. A template is a way to set up a chart, not a signal.

import { kindOf, locked, upgrade, proTag } from './chart-pro-gate.js?v=1161';

// Anchors for the composite templates, computed when the template is applied: UTC midnight of the 1st / of this week's Monday.
const monthStart = () => { const d = new Date(); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); };
const weekStart = () => { const d = new Date(), t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); return t - ((d.getUTCDay() + 6) % 7) * 864e5; };

// blurb = the one short line on the gallery card (max ~90 chars); desc = the full text in the detail view.
// market: 'futures' | 'crypto' | 'stocks' -> the template sets this symbol; absent -> keeps the member's market.
export const TEMPLATES = [
  { id: 'scalp-nq', blurb: 'Nasdaq futures on 1m with big trades, delta and stop runs.', name: 'Scalping NQ (order flow)', desc: 'Nasdaq futures on 1m with big trades, delta and stop runs from the order book.',
    symbol: 'futures:NQ1!', tf: '1', ind: [['stk_l2f_big'], ['stk_l2f_delta'], ['stk_l2f_stop'], ['stk_l2f_cvd']] },
  { id: 'futures-open', blurb: 'Options levels, yesterday\u2019s value area and session stats for the open.', name: 'Futures open (GEX + levels)', desc: 'Options-based levels, previous-day value area and session marks for the open.',
    symbol: 'futures:NQ1!', tf: '5', ind: [['stk_gex'], ['stk_pdvp'], ['stk_msess'], ['stk_econ']] },
  { id: 'gex-flow', blurb: 'Gamma walls, a net-GEX heatmap and options flow marks on one chart.', name: 'GEX Levels & Options Flow', desc: 'Call and put walls, zero gamma, top open-interest strikes and past days\u2019 levels, a net-GEX heatmap by strike, positive and negative gamma zones shaded, call and put premium marks, fresh option volume and ZoroTide. Price is the candles.',
    symbol: 'futures:NQ1!', tf: '5', ind: [['stk_gex', { showOi: true, oiCount: 5, show0dte: true, showRanked: true, showProfile: true, showRegime: true, showPrev: true, prevDays: 2 }], ['stk_gexheat'], ['stk_zzone'], ['stk_optflow'], ['stk_zvol'], ['stk_tide']] },
  { id: 'vp-monthly', blurb: 'A month of 1h candles with one volume profile and a monthly VWAP.', name: 'Volume profile: Monthly', desc: 'About a month of 1-hour candles with one composite volume profile over the visible range (POC, value area high and low), VWAP anchored to the start of the month and the previous day\u2019s levels.',
    symbol: 'futures:NQ1!', tf: '60', view: 30, ind: [['vpvr'], ['stk_avwap', () => ({ anchor: monthStart() })], ['stk_pdvp']] },
  { id: 'vp-weekly', blurb: 'A week of 30m candles with one volume profile and a weekly VWAP.', name: 'Volume profile: Weekly', desc: 'About a week of 30-minute candles with one composite volume profile over the visible range (POC, value area high and low) and VWAP anchored to the start of the week.',
    symbol: 'futures:NQ1!', tf: '30', view: 7, ind: [['vpvr'], ['stk_avwap', () => ({ anchor: weekStart() })], ['stk_pdvp']] },
  { id: 'vp-daily', blurb: 'A volume profile per session with delta, market profile and VWAP.', name: 'Volume profile: Daily', desc: 'One session volume profile per day with delta bars at each price row (order flow, from 8 Oct 2026), a time-price profile with single prints, and session VWAP.',
    symbol: 'futures:NQ1!', tf: '5', view: 2, ind: [['stk_svp', { session: 'day', showDelta: true }], ['stk_of_tpo'], ['stk_of_vwap']] },
  { id: 'options-levels', blurb: 'Expected move, gamma levels and calls vs puts flow on an index ETF.', name: 'Options levels', desc: 'Expected move, gamma levels and calls-vs-puts money flow on an index ETF.',
    symbol: 'IDX:SPY', tf: '15', ind: [['stk_gex'], ['stk_em'], ['stk_tide'], ['stk_optflow']] },
  { id: 'dark-pool', blurb: 'Large off-exchange prints and weekly off-exchange levels on the candles.', name: 'Dark pool watch', desc: 'Large off-exchange prints on the candles plus weekly off-exchange levels and daily share.',
    symbol: 'IDX:SPY', tf: '5', ind: [['stk_darkpool'], ['stk_offex_lv'], ['stk_offex'], ['volume']] },
  { id: 'swing-stocks', blurb: 'Daily chart with 20 and 50 averages, RSI, volume and the 52-week range.', name: 'Swing stocks', desc: 'Daily chart with 20 and 50 averages, RSI, volume and the 52-week range.',
    tf: 'D', ind: [['ema', { length: 20 }], ['ema', { length: 50 }], ['rsi'], ['volume'], ['52-week-high-low']] },
  { id: 'market-profile', blurb: 'Time-price profile with value area, yesterday\u2019s levels and VWAP.', name: 'Market profile day', desc: 'Time-price profile with value area for the day, with the previous day\u2019s levels and VWAP.',
    symbol: 'futures:NQ1!', tf: '30', ind: [['stk_of_tpo'], ['stk_pdvp'], ['stk_avwap']] },
  { id: 'clean', blurb: 'Candles, volume and yesterday\u2019s levels. Nothing else.', name: 'Clean price action', desc: 'Candles, volume and previous-day levels only. Nothing else on the chart.',
    tf: '15', ind: [['volume'], ['stk_pdvp']] },
  { id: 'depth-heatmap', blurb: 'Order book size over time with walls, icebergs and big trades.', name: 'Depth heatmap', desc: 'Futures order book resting size over time, with liquidity walls, iceberg marks and big trades on top.',
    symbol: 'futures:NQ1!', tf: '1', ind: [['stk_depth_heat', { showIce: true }], ['stk_fut_walls'], ['stk_l2f_big']] },
  { id: 'footprint', blurb: 'Buy and sell volume at each price inside every candle.', name: 'Footprint day trading', desc: 'Per-price buy and sell volume in each candle, with a volume profile and stop runs.',
    symbol: 'futures:NQ1!', tf: '5', ind: [['stk_l2f_fp'], ['stk_l2f_vp'], ['stk_l2f_stop']] },
  { id: 'crypto-book', blurb: 'Bitcoin order book heatmap with large volume bubbles.', name: 'Crypto order book', desc: 'Bitcoin order book heatmap with large volume bubbles.',
    symbol: 'binance:BTCUSDT', tf: '5', ind: [['stk_crypto_dom'], ['stk_vbubble']] },
  { id: 'trend-momentum', blurb: 'SuperTrend with MACD and RSI on the hourly chart.', name: 'Trend and momentum', desc: 'SuperTrend with MACD and RSI panes on the hourly chart.',
    tf: '60', ind: [['supertrend'], ['macd'], ['rsi']] },
  { id: 'squeeze', blurb: 'Bollinger Bands, TTM Squeeze and ATR to spot tight and wide ranges.', name: 'Volatility squeeze', desc: 'Bollinger Bands, TTM Squeeze and ATR to see when ranges tighten and widen.',
    tf: '60', ind: [['bollinger-bands'], ['ttm-squeeze'], ['average-true-range']] },
  { id: 'vwap-profile', blurb: 'Intraday VWAP with bands, a volume profile and relative volume.', name: 'VWAP and volume profile', desc: 'Intraday VWAP with bands, visible-range volume profile and relative volume.',
    tf: '5', ind: [['vwap'], ['vpvr'], ['stk_rvol']] },
  { id: 'news-day', blurb: 'Economic events, news markers and pivot points for event days.', name: 'News day', desc: 'Economic events and news markers with pivot points, for event days.',
    tf: '15', ind: [['stk_econ'], ['stk_news'], ['pivot-points']] }
];

const NAMES = { vpvr: 'Volume Profile (visible range)', stk_svp: 'Session Volume Profile', stk_gexheat: 'GEX Heatmap', stk_of_vwap: 'Session VWAP', stk_l2f_big: 'Big Trades (L2)', stk_l2f_delta: 'Delta (L2)', stk_l2f_stop: 'Stop Runs (L2)', stk_l2f_cvd: 'Cumulative Delta (L2)', stk_gex: 'GEX Levels', stk_pdvp: 'Previous day levels',
  stk_msess: 'Market Stats', stk_econ: 'Economic events', stk_em: 'Expected Move', stk_tide: 'ZoroTide', stk_optflow: 'Options Flow Marks', stk_zzone: 'Gamma Zone', stk_zvol: 'Fresh Volume marks', stk_darkpool: 'Dark Pool Prints', stk_offex_lv: 'Off-exchange levels',
  stk_offex: 'Off-exchange Volume', volume: 'Volume', ema: 'EMA', rsi: 'RSI', '52-week-high-low': '52-week high / low', stk_of_tpo: 'Market Profile', stk_avwap: 'Anchored VWAP', stk_depth_heat: 'Depth Heatmap (L2)', stk_fut_walls: 'Liquidity Walls (L2)',
  stk_l2f_fp: 'Footprint (L2)', stk_l2f_vp: 'Volume Profile (L2)', stk_crypto_dom: 'Crypto DOM Heatmap', stk_vbubble: 'Volume Bubbles', supertrend: 'SuperTrend', macd: 'MACD', 'bollinger-bands': 'Bollinger Bands',
  'ttm-squeeze': 'TTM Squeeze', 'average-true-range': 'ATR', vwap: 'VWAP', vpvr: 'Volume Profile', stk_rvol: 'Relative Volume', stk_news: 'News markers', 'pivot-points': 'Pivot Points' };
export const toolNames = (t) => t.ind.map(([type, inp]) => (NAMES[type] || type) + (type === 'ema' && inp ? ' ' + inp.length : ''));

// Pro kinds a template contains ('of' | 'gex'), for the card tags.
export function proKinds(t) {
  const s = new Set();
  t.ind.forEach(([type]) => { const k = kindOf(type); if (k) s.add(k); });
  return [...s];
}

// Apply one template to the active chart. deps: { ws, Pine, afterStructural, setLayout, toast }.
// Returns { added, skipped } (skipped = Pro tools a Free member did not get).
export function applyTemplate(t, deps) {
  const { ws, Pine, afterStructural, setLayout, toast } = deps;
  try { ws.maximizeCell(null); } catch (e) {}
  try { Pine.clearAllPine(); } catch (e) {}
  if (setLayout) { try { setLayout('1'); } catch (e) {} }
  const cells = ws.context().cells || [];
  const cell = ws.cell((cells.find((c) => c.active) || cells[0]).id);
  if (t.symbol) { try { cell.setSymbol(t.symbol); } catch (e) { console.warn('TradeZoro: template symbol', e); } }
  try { cell.setTimeframe(t.tf); } catch (e) { console.warn('TradeZoro: template timeframe', e); }
  try { (cell.chart.indicators() || []).slice().forEach((h) => { try { h.remove(); } catch (e) {} }); } catch (e) {}
  const out = { added: 0, skipped: [] };
  t.ind.forEach(([type, inputs]) => {
    const k = kindOf(type);
    if (k && locked(k)) { if (out.skipped.indexOf(k) < 0) out.skipped.push(k); return; }
    try { const inp = typeof inputs === 'function' ? inputs() : inputs; cell.chart.addNativeIndicator(type, inp ? { inputs: inp } : undefined); out.added++; }
    catch (e) { console.warn('TradeZoro: template indicator ' + type, e); }
  });
  // t.view = days of candles to show (so a visible-range profile covers about that span); the bars load after the timeframe change, so retry a few times
  if (t.view) {
    let n = 0;
    const fit = () => { try { const bars = cell.chart.orchestrator.rawBars, last = bars && bars.length && bars[bars.length - 1].time; if (last) { cell.chart.setVisibleRange({ from: last - t.view * 864e5, to: last + 36e5 }); return; } } catch (e) {} if (++n < 15) setTimeout(fit, 500); };
    setTimeout(fit, 600);
  }
  try { ws.context().stateChanged(); } catch (e) {}
  if (afterStructural) afterStructural();
  if (out.skipped.length) {
    if (toast) toast('Applied \u201C' + t.name + '\u201D without its Pro tools.', 'info');
    upgrade(out.skipped[0]);
  } else if (toast) toast('Applied \u201C' + t.name + '\u201D');
  return out;
}

// ---- gallery dialog -------------------------------------------------------------------------------
// Header (title, search, Ready-made | My templates, filter pills) + a card grid; a card opens a detail view (big preview,
// full description, every tool, one Apply). Desktop: Preview + Apply appear on hover/focus. Touch: the card opens the detail.
function el(tag, attrs, kids) {
  const n = document.createElement(tag);
  Object.keys(attrs || {}).forEach((k) => { if (k === 'text') n.textContent = attrs[k]; else if (k === 'html') n.innerHTML = attrs[k]; else n.setAttribute(k, attrs[k]); });
  (kids || []).forEach((c) => c && n.appendChild(c));
  return n;
}
const tfLabel = (tf) => tf === 'D' ? '1D' : (Number(tf) >= 60 ? (Number(tf) / 60) + 'h' : tf + 'm');
const SVG = (d, s) => '<svg width="' + (s || 16) + '" height="' + (s || 16) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';

// Filter pills, derived from each template's tools and timeframe.
const VP = ['vpvr', 'stk_svp', 'stk_of_tpo', 'stk_l2f_vp'];
const OPT = ['stk_tide', 'stk_darkpool', 'stk_offex', 'stk_offex_lv'];
export const FILTERS = [
  ['all', 'All', () => true],
  ['of', 'Order flow', (t) => t.ind.some(([x]) => kindOf(x) === 'of')],
  ['gex', 'GEX & options', (t) => t.ind.some(([x]) => kindOf(x) === 'gex' || OPT.includes(x))],
  ['vp', 'Volume profile', (t) => t.ind.some(([x]) => VP.includes(x))],
  ['swing', 'Swing', (t) => t.tf === 'D' || Number(t.tf) >= 60],
  ['scalp', 'Scalping', (t) => t.tf !== 'D' && Number(t.tf) <= 5],
  ['free', 'Free', (t) => !proKinds(t).length],
  ['pro', 'Pro', (t) => proKinds(t).length > 0]
];

function thumb(t, cls) {
  const base = 'assets/images/templates/' + t.id;
  return el('div', { class: cls }, [
    el('img', { class: 'stkt-th-d', src: base + '.webp?v=1161', alt: '', width: '640', height: '360', loading: 'lazy', decoding: 'async' }),
    el('img', { class: 'stkt-th-l', src: base + '-light.webp?v=1161', alt: '', width: '640', height: '360', loading: 'lazy', decoding: 'async' }),
    el('span', { class: 'stkt-ov' }, [el('span', { class: 'stkt-tf', text: tfLabel(t.tf) }), proKinds(t).length ? proTag() : null]),
    el('span', { class: 'stkt-sample', text: 'Sample data' })
  ]);
}

// deps: { ws, Pine, afterStructural, setLayout, toast, myTemplates?: () => Promise<{items, defaultId}>, applySaved?: (t) => void, tab?: 'mine' }
export function openGallery(deps) {
  if (document.querySelector('.stkt-back')) return;
  const opener = document.activeElement;
  let tab = deps.tab === 'mine' ? 'mine' : 'ready', filter = 'all', q = '', detail = null;
  const back = el('div', { class: 'stkt-back' });
  const box = el('div', { class: 'stkt-dlg', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'stkt-title' });
  const close = el('button', { type: 'button', class: 'stkt-x', 'aria-label': 'Close', html: SVG('<path d="M6 6l12 12M18 6L6 18"/>', 18) });
  const search = el('input', { type: 'search', class: 'stkt-search', placeholder: 'Search templates or tools', 'aria-label': 'Search templates', enterkeyhint: 'search', autocomplete: 'off' });
  const tabs = el('div', { class: 'stkt-seg', role: 'tablist', 'aria-label': 'Template source' });
  const tabBtn = (id, label) => { const b = el('button', { type: 'button', role: 'tab', 'data-tab': id, text: label }); b.addEventListener('click', () => { tab = id; render(); }); return b; };
  tabs.append(tabBtn('ready', 'Ready-made'), tabBtn('mine', 'My templates'));
  const pills = el('div', { class: 'stkt-pills', role: 'group', 'aria-label': 'Filter templates' });
  FILTERS.forEach(([id, label, fn]) => {
    const n = TEMPLATES.filter(fn).length;
    if (!n) return;   // a category with no template (e.g. Pro while everything is free) is not shown
    const b = el('button', { type: 'button', class: 'stkt-pill', 'data-f': id, text: label });
    b.addEventListener('click', () => { filter = id; render(); });
    pills.appendChild(b);
  });
  box.appendChild(el('div', { class: 'stkt-hd' }, [
    el('span', { class: 'stkc-sh-grab stkt-grab', 'aria-hidden': 'true' }),
    el('div', { class: 'stkt-hd-r' }, [el('div', { class: 'stkt-hd-t' }, [el('h2', { id: 'stkt-title', text: 'Templates' }),
      el('p', { text: 'Free to apply. Sets the timeframe, tools and panes on your chart. Education only. Not financial advice.' })]), close]),
    el('div', { class: 'stkt-tools' }, [tabs, el('label', { class: 'stkt-sw' }, [el('span', { class: 'stkt-sw-ic', html: SVG('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>') }), search])]),
    pills]));
  const body = el('div', { class: 'stkt-body' });
  box.appendChild(body);
  back.appendChild(box);

  const apply = (t) => { done(); applyTemplate(t, deps); };
  const match = (t) => { if (!q) return true; const hay = (t.name + ' ' + t.blurb + ' ' + t.desc + ' ' + toolNames(t).join(' ')).toLowerCase(); return q.split(/\s+/).every((w) => hay.includes(w)); };

  function card(t) {
    const names = toolNames(t), shown = names.slice(0, 4);
    const open = el('button', { type: 'button', class: 'stkt-open', text: t.name, 'aria-label': 'Preview ' + t.name });
    open.addEventListener('click', () => showDetail(t));
    const prev = el('button', { type: 'button', class: 'stkt-pv', text: 'Preview', tabindex: '-1', 'aria-hidden': 'true' });
    prev.addEventListener('click', () => showDetail(t));
    const ap = el('button', { type: 'button', class: 'stkt-apply', text: 'Apply', 'aria-label': 'Apply ' + t.name });
    ap.addEventListener('click', () => apply(t));
    return el('li', { class: 'stkt-card', 'data-tpl': t.id }, [
      thumb(t, 'stkt-img'),
      el('div', { class: 'stkt-bd' }, [el('h3', {}, [open]), el('p', { class: 'stkt-blurb', text: t.blurb }),
        el('div', { class: 'stkt-chips', 'aria-label': 'Tools: ' + names.join(', '), 'data-n': String(names.length) }, [...shown.map((n) => el('span', { class: 'stkt-chip', text: n })),
          el('span', { class: 'stkt-chip stkt-more' })])]),
      el('div', { class: 'stkt-acts' }, [prev, ap])]);
  }

  // One row of whole chips: drop chips from the end until the row fits, the rest go into "+N" (never a chip cut mid-word).
  function fitChips() {
    body.querySelectorAll('.stkt-card .stkt-chips').forEach((row) => {
      const total = +row.dataset.n, chips = [...row.querySelectorAll('.stkt-chip:not(.stkt-more)')], more = row.querySelector('.stkt-more');
      chips.forEach((c) => { c.hidden = false; });
      let shown = chips.length;
      const sync = () => { const rest = total - shown; more.hidden = rest <= 0; more.textContent = '+' + rest; };
      sync();
      while (shown > 1 && row.scrollWidth > row.clientWidth + 1) { chips[--shown].hidden = true; sync(); }
    });
  }
  const ro = new ResizeObserver(() => fitChips());

  function showDetail(t) {
    detail = t;
    const ap = el('button', { type: 'button', class: 'stkt-apply stkt-apply-lg', text: 'Apply template', 'aria-label': 'Apply ' + t.name });
    ap.addEventListener('click', () => apply(t));
    const bk = el('button', { type: 'button', class: 'stkt-back-btn', html: SVG('<path d="M15 6l-6 6 6 6"/>', 18) + '<span>All templates</span>' });
    bk.addEventListener('click', () => { detail = null; render(); });
    const mk = t.symbol ? t.symbol.split(':').pop().replace(/1!$/, '') : 'Keeps your market';
    body.innerHTML = '';
    body.appendChild(el('div', { class: 'stkt-dt' }, [bk,
      el('div', { class: 'stkt-dt-g' }, [thumb(t, 'stkt-img stkt-dt-img'),
        el('div', { class: 'stkt-dt-bd' }, [
          el('h3', { class: 'stkt-dt-t', 'data-tpl': t.id }, [document.createTextNode(t.name), proKinds(t).length ? proTag() : null]),
          el('dl', { class: 'stkt-meta' }, [el('div', {}, [el('dt', { text: 'Timeframe' }), el('dd', { text: tfLabel(t.tf) })]), el('div', {}, [el('dt', { text: 'Market' }), el('dd', { text: mk })])]),
          el('p', { class: 'stkt-dt-p', text: t.desc }),
          el('p', { class: 'stkt-pop-h', text: 'What\u2019s on it' }),
          el('div', { class: 'stkt-chips stkt-chips-all' }, toolNames(t).map((n) => el('span', { class: 'stkt-chip', text: n }))),
          ap])])]));
    body.scrollTop = 0;
    box.classList.add('is-detail');
    ap.focus({ preventScroll: true });
  }

  async function renderMine() {
    body.appendChild(el('p', { class: 'stkt-empty', text: 'Loading your templates\u2026' }));
    let r = { items: [] };
    try { if (deps.myTemplates) r = await deps.myTemplates(); } catch (e) { r = { items: [], note: 'Could not load your templates.' }; }
    if (tab !== 'mine' || detail) return;
    body.innerHTML = '';
    const items = (r.items || []).filter((t) => !q || t.name.toLowerCase().includes(q));
    if (!items.length) { body.appendChild(el('div', { class: 'stkt-empty' }, [el('strong', { text: q ? 'No saved template matches.' : 'No saved templates yet.' }), el('span', { text: r.note || 'Name your chart in the Templates menu and tap Save. It shows up here.' })])); return; }
    const ul = el('ul', { class: 'stkt-mine' });
    items.forEach((t) => {
      const ap = el('button', { type: 'button', class: 'stkt-apply', text: 'Apply', 'aria-label': 'Apply ' + t.name });
      ap.addEventListener('click', () => { done(); if (deps.applySaved) deps.applySaved(t); });
      const when = t.updatedAt ? new Date(t.updatedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
      ul.appendChild(el('li', { class: 'stkt-mrow' }, [el('span', { class: 'stkt-ini', 'aria-hidden': 'true', text: (t.name.trim()[0] || '?').toUpperCase() }),
        el('span', { class: 'stkt-mt' }, [el('span', { class: 'stkt-mn', text: t.name }), el('small', { text: [t.id === r.defaultId ? 'Default' : '', when ? 'Saved ' + when : ''].filter(Boolean).join(' \u00b7 ') })]), ap]));
    });
    body.appendChild(ul);
  }

  function render() {
    detail = null;
    box.classList.remove('is-detail');
    box.dataset.tab = tab;
    tabs.querySelectorAll('[role=tab]').forEach((b) => { const on = b.dataset.tab === tab; b.setAttribute('aria-selected', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1; });
    pills.hidden = tab !== 'ready';
    pills.querySelectorAll('.stkt-pill').forEach((b) => b.setAttribute('aria-pressed', b.dataset.f === filter ? 'true' : 'false'));
    body.innerHTML = '';
    body.scrollTop = 0;
    if (tab === 'mine') { renderMine(); return; }
    const fn = FILTERS.find((f) => f[0] === filter)[2];
    const list = TEMPLATES.filter((t) => fn(t) && match(t));
    if (!list.length) { body.appendChild(el('div', { class: 'stkt-empty' }, [el('strong', { text: 'No templates match.' }), el('span', { text: 'Try another word or filter.' })])); return; }
    body.appendChild(el('ul', { class: 'stkt-grid', 'aria-label': list.length + ' templates' }, list.map(card)));
    fitChips();
  }
  search.addEventListener('input', () => { q = search.value.trim().toLowerCase(); render(); });

  const focusables = () => [...box.querySelectorAll('button, input, [tabindex="0"]')].filter((n) => !n.disabled && n.getClientRects().length && n.tabIndex >= 0);
  const keys = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); if (detail) render(); else done(); return; }
    if (e.key === 'Tab') {   // focus trap
      const f = focusables(); if (!f.length) return;
      const i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && (i === f.length - 1 || i < 0)) { e.preventDefault(); f[0].focus(); }
    }
  };
  function done() {
    back.remove(); ro.disconnect(); document.removeEventListener('keydown', keys, true);
    document.documentElement.classList.remove('stkt-open-html');
    try { if (opener && opener.isConnected) opener.focus(); } catch (e) {}
  }
  close.addEventListener('click', done);
  back.addEventListener('mousedown', (e) => { if (e.target === back) done(); });
  document.addEventListener('keydown', keys, true);
  render();
  document.body.appendChild(back);
  fitChips(); ro.observe(body);
  document.documentElement.classList.add('stkt-open-html');
  (matchMedia('(pointer:coarse)').matches ? close : search).focus();
}
