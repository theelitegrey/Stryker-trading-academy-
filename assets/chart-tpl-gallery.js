// TradeZoro — ZoroCharts ready-made chart templates (ES module, loaded by assets/vela-chart.js).
// A template = timeframe + indicators with settings (+ optionally a market). Free to apply; a Pro
// indicator inside follows the member's plan: it is skipped for a Free member and the normal
// upgrade prompt opens (gate helpers: assets/chart-pro-gate.js). Members save their OWN layouts with
// the Templates menu (assets/chart-templates.js), so this file only holds the built-in set.
// Thumbnails: assets/images/chart-templates/<id>.webp (real renders, tools/tests/chart-tpl-shots.js).
// Education only. Not financial advice. A template is a way to set up a chart, not a signal.

import { kindOf, locked, upgrade, proTag } from './chart-pro-gate.js?v=939';

// thumb: true = a real render of the template is in assets/images/chart-templates (only where the recorded test bars can draw its tools;
// tools that need a live feed show their names as chips instead, never a made-up picture).
// market: 'futures' | 'crypto' | 'stocks' -> the template sets this symbol; absent -> keeps the member's market.
export const TEMPLATES = [
  { id: 'scalp-nq', name: 'Scalping NQ (order flow)', desc: 'Nasdaq futures on 1m with big trades, delta and stop runs from the order book.',
    symbol: 'futures:NQ1!', tf: '1', ind: [['stk_l2f_big'], ['stk_l2f_delta'], ['stk_l2f_stop'], ['stk_l2f_cvd']] },
  { id: 'futures-open', name: 'Futures open (GEX + levels)', desc: 'Options-based levels, previous-day value area and session marks for the open.',
    symbol: 'futures:NQ1!', tf: '5', ind: [['stk_gex'], ['stk_pdvp'], ['stk_msess'], ['stk_econ']] },
  { id: 'options-levels', name: 'Options levels', desc: 'Expected move, gamma levels and calls-vs-puts money flow on an index ETF.',
    symbol: 'IDX:SPY', tf: '15', ind: [['stk_gex'], ['stk_em'], ['stk_tide'], ['stk_optflow']] },
  { id: 'dark-pool', name: 'Dark pool watch', desc: 'Large off-exchange prints on the candles plus weekly off-exchange levels and daily share.',
    symbol: 'IDX:SPY', tf: '5', ind: [['stk_darkpool'], ['stk_offex_lv'], ['stk_offex'], ['volume']] },
  { id: 'swing-stocks', thumb: true, name: 'Swing stocks', desc: 'Daily chart with 20 and 50 averages, RSI, volume and the 52-week range.',
    tf: 'D', ind: [['ema', { length: 20 }], ['ema', { length: 50 }], ['rsi'], ['volume'], ['52-week-high-low']] },
  { id: 'market-profile', thumb: true, name: 'Market profile day', desc: 'Time-price profile with value area for the day, with the previous day\u2019s levels and VWAP.',
    symbol: 'futures:NQ1!', tf: '30', ind: [['stk_of_tpo'], ['stk_pdvp'], ['stk_avwap']] },
  { id: 'clean', thumb: true, name: 'Clean price action', desc: 'Candles, volume and previous-day levels only. Nothing else on the chart.',
    tf: '15', ind: [['volume'], ['stk_pdvp']] },
  { id: 'depth-heatmap', name: 'Depth heatmap', desc: 'Futures order book resting size over time, with big trades on top.',
    symbol: 'futures:NQ1!', tf: '1', ind: [['stk_depth_heat'], ['stk_l2f_big']] },
  { id: 'footprint', name: 'Footprint day trading', desc: 'Per-price buy and sell volume in each candle, with a volume profile and stop runs.',
    symbol: 'futures:NQ1!', tf: '5', ind: [['stk_l2f_fp'], ['stk_l2f_vp'], ['stk_l2f_stop']] },
  { id: 'crypto-book', name: 'Crypto order book', desc: 'Bitcoin order book heatmap with large volume bubbles.',
    symbol: 'binance:BTCUSDT', tf: '5', ind: [['stk_crypto_dom'], ['stk_vbubble']] },
  { id: 'trend-momentum', thumb: true, name: 'Trend and momentum', desc: 'SuperTrend with MACD and RSI panes on the hourly chart.',
    tf: '60', ind: [['supertrend'], ['macd'], ['rsi']] },
  { id: 'squeeze', thumb: true, name: 'Volatility squeeze', desc: 'Bollinger Bands, TTM Squeeze and ATR to see when ranges tighten and widen.',
    tf: '60', ind: [['bollinger-bands'], ['ttm-squeeze'], ['average-true-range']] },
  { id: 'vwap-profile', thumb: true, name: 'VWAP and volume profile', desc: 'Intraday VWAP with bands, visible-range volume profile and relative volume.',
    tf: '5', ind: [['vwap'], ['vpvr'], ['stk_rvol']] },
  { id: 'news-day', name: 'News day', desc: 'Economic events and news markers with pivot points, for event days.',
    tf: '15', ind: [['stk_econ'], ['stk_news'], ['pivot-points']] }
];

const NAMES = { stk_l2f_big: 'Big Trades (L2)', stk_l2f_delta: 'Delta (L2)', stk_l2f_stop: 'Stop Runs (L2)', stk_l2f_cvd: 'Cumulative Delta (L2)', stk_gex: 'GEX Levels', stk_pdvp: 'Previous day levels',
  stk_msess: 'Market Stats', stk_econ: 'Economic events', stk_em: 'Expected Move', stk_tide: 'ZoroTide', stk_optflow: 'Options Flow Marks', stk_darkpool: 'Dark Pool Prints', stk_offex_lv: 'Off-exchange levels',
  stk_offex: 'Off-exchange Volume', volume: 'Volume', ema: 'EMA', rsi: 'RSI', '52-week-high-low': '52-week high / low', stk_of_tpo: 'Market Profile', stk_avwap: 'Anchored VWAP', stk_depth_heat: 'Depth Heatmap (L2)',
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
    try { cell.chart.addNativeIndicator(type, inputs ? { inputs } : undefined); out.added++; }
    catch (e) { console.warn('TradeZoro: template indicator ' + type, e); }
  });
  try { ws.context().stateChanged(); } catch (e) {}
  if (afterStructural) afterStructural();
  if (out.skipped.length) {
    if (toast) toast('Applied \u201C' + t.name + '\u201D without its Pro tools.', 'info');
    upgrade(out.skipped[0]);
  } else if (toast) toast('Applied \u201C' + t.name + '\u201D');
  return out;
}

// ---- gallery dialog -------------------------------------------------------------------------------
function el(tag, attrs, kids) {
  const n = document.createElement(tag);
  Object.keys(attrs || {}).forEach((k) => { if (k === 'text') n.textContent = attrs[k]; else if (k === 'html') n.innerHTML = attrs[k]; else n.setAttribute(k, attrs[k]); });
  (kids || []).forEach((c) => c && n.appendChild(c));
  return n;
}

export function openGallery(deps) {
  if (document.querySelector('.stkt-back')) return;
  const back = el('div', { class: 'stkt-back' });
  const box = el('div', { class: 'stkt-dlg', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Ready-made templates' });
  const close = el('button', { type: 'button', class: 'stkc-ib', 'aria-label': 'Close',
    html: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6L6 18"/></svg>' });
  box.appendChild(el('div', { class: 'stkt-hd' }, [el('div', {}, [el('h2', { text: 'Ready-made templates' }),
    el('p', { text: 'Free to apply. Sets the timeframe, indicators and panes on your chart. Save your own from the Templates menu.' })]), close]));
  const grid = el('ul', { class: 'stkt-grid' });
  TEMPLATES.forEach((t) => {
    const kinds = proKinds(t);
    const thumb = t.thumb
      ? el('img', { src: 'assets/images/chart-templates/' + t.id + '.webp?v=939', alt: 'Preview of the ' + t.name + ' template', width: '640', height: '400', loading: 'lazy' })
      : el('div', { class: 'stkt-chips', 'aria-label': 'Tools in this template' }, [el('span', { class: 'stkt-tf', text: t.tf === 'D' ? '1D' : (Number(t.tf) >= 60 ? (Number(t.tf) / 60) + 'h' : t.tf + 'm') }),
          ...toolNames(t).map((n) => el('span', { class: 'stkt-chip', text: n }))]);
    const apply = el('button', { type: 'button', class: 'stkc-sbtn', text: 'Apply', 'aria-label': 'Apply ' + t.name });
    apply.addEventListener('click', () => { done(); applyTemplate(t, deps); });
    const title = el('h3', { text: t.name });
    if (kinds.length) title.appendChild(proTag());
    grid.appendChild(el('li', { class: 'stkt-card', 'data-tpl': t.id }, [el('div', { class: 'stkt-img' }, [thumb]),
      el('div', { class: 'stkt-bd' }, [title, el('p', { text: t.desc }), apply])]));
  });
  box.appendChild(grid);
  back.appendChild(box);
  const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(); } };
  function done() { back.remove(); document.removeEventListener('keydown', esc, true); }
  close.addEventListener('click', done);
  back.addEventListener('mousedown', (e) => { if (e.target === back) done(); });
  document.addEventListener('keydown', esc, true);
  document.body.appendChild(back);
  close.focus();
}
