/**
 * TradeZoro — Paper trading TRADE REVIEW (UI component, classic script: window.PaperReview)
 *
 * Owner order 2026-10-14: "Paper trading leaderboard + trade review". Private to the member: it
 * reads only the member's own paper account (the state the Charts page keeps, see
 * assets/chart-paper.js) and writes back only the member's own notes and tags on a trade.
 *
 * Two hosts:
 *   - the "Review" tab of the Charts paper panel (assets/chart-paper.js, compact: KPIs, equity
 *     curve, trade list; link to the full page);
 *   - the full page paper-review.html (assets/paper-review-page.js): adds the breakdowns by
 *     setup / session / weekday / symbol.
 * For every closed trade: entry / exit on a mini chart snapshot (bars around the trade from the
 * same market data the Charts page uses), R multiple from its first stop, MAE / MFE, hold time,
 * session, and an editable note + three tags (setup, mistake, emotion). Filters by date, symbol,
 * tag and outcome; CSV export of the filtered trades. The bar-replay account is a separate
 * source behind a toggle; its trades are never mixed into the paper account's numbers.
 *
 * Depends on: assets/paper-review-stats.js (window.PaperReviewStats: all maths), assets/toast.js
 * (showToast, optional), the shared scrollbar + theme tokens in assets/style.css (.pr-* styles).
 * Mini chart data: opts.getBars(symbol, tf, fromMs, toMs) when the host has the chart providers
 * (Charts page); otherwise a built-in fetch: futures from our own /api/chart/bars endpoint through
 * assets/chart-futures-provider.js, Binance spot from Binance's public klines REST.
 *
 * mount(el, opts) -> { update(), destroy() }
 *   opts.compact       bool, the panel layout
 *   opts.getState(kind) -> paper account state ({ startBalance, trades, resetAt }) or null;
 *                      kind 'paper' | 'replay'
 *   opts.save(kind, tradeId, patch) -> Promise; patch = { note, setup, mistake, emotion }
 *   opts.getBars       optional, see above
 *   opts.fullHref      link to the full page (compact only)
 *   opts.leaderboard   optional node appended under the header (the opt-in card, step B)
 *
 * Demo account. Simulated results, not real trading. Education only. Not financial advice.
 */
(function () {
  'use strict';
  const S = window.PaperReviewStats;
  if (!S) { console.warn('TradeZoro review: assets/paper-review-stats.js missing'); return; }

  const NOTE_MAX = 500, TAG_MAX = 40;
  const PRESETS = {
    setup: ['FVG', 'Order block', 'Liquidity sweep', 'Break of structure', 'SMT divergence', 'Breakout', 'Range fade', 'Trend pullback'],
    mistake: ['Early entry', 'Late entry', 'No stop', 'Moved stop', 'Oversized', 'Early exit', 'Revenge trade', 'Broke my plan'],
    emotion: ['Calm', 'Confident', 'Hesitant', 'FOMO', 'Fear', 'Greedy', 'Frustrated', 'Bored']
  };
  const TAG_LABEL = { setup: 'Setup', mistake: 'Mistake', emotion: 'Emotion' };
  const UI_KEY = 'stryker_paper_review_ui';

  // ------------------------------------------------------------------ helpers
  function h(tag, attrs, kids) {
    const n = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'text') n.textContent = v;
      else if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    (kids || []).forEach((c) => { if (c != null && c !== false) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return n;
  }
  const showSym = (s) => String(s || '').replace(/^[^:]+:/, '');
  function money(n, sign) {
    if (n == null || !Number.isFinite(n)) return '—';
    const s = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (n < 0 ? '-' : (sign && n > 0 ? '+' : '')) + '$' + s;
  }
  // Big amounts in cards, tables and axis labels drop the cents so the full value fits (the trade rows keep exact cents).
  const moneyW = (n, sign) => (n != null && Number.isFinite(n) && Math.abs(n) >= 1000 ? money(Math.round(n), sign).replace(/\.00$/, '') : money(n, sign));
  const pct = (n, sign) => (n == null || !Number.isFinite(n) ? '—' : (sign && n > 0 ? '+' : '') + n.toFixed(2) + '%');
  const rr = (n) => (n == null || !Number.isFinite(n) ? '—' : (n > 0 ? '+' : '') + n.toFixed(2) + 'R');
  const cls = (n) => (n > 0 ? 'up' : n < 0 ? 'down' : '');
  function decimals(t) {
    const e = Math.abs(Number(t.entry) || 0);
    const s = String(t.entry) + ' ' + String(t.exit);   // separator: '31256.25'+'31272' must not read as 7 decimals
    const m = s.match(/\.(\d+)/g); let d = 0; if (m) for (const x of m) d = Math.max(d, x.length - 1);
    return Math.min(Math.max(d, e >= 1000 ? 2 : e >= 1 ? 2 : 5), 8);
  }
  const px = (t, v) => (v == null || !Number.isFinite(Number(v)) ? '—' : Number(v).toLocaleString('en-US', { minimumFractionDigits: decimals(t), maximumFractionDigits: decimals(t) }));
  const dtf = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const fmtDate = (ms) => (Number.isFinite(ms) ? dtf.format(new Date(ms)) : '—');
  function css(name, fb) { try { const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); return v || fb; } catch (e) { return fb; } }
  function toast(msg, type) { try { if (typeof window.showToast === 'function') window.showToast(type || 'info', msg); } catch (e) {} }   // assets/toast.js: showToast(type, message)
  function loadUi() { try { return Object.assign({ kind: 'paper', from: '', to: '', symbol: '', tag: '', outcome: '' }, JSON.parse(localStorage.getItem(UI_KEY) || '{}')); } catch (e) { return { kind: 'paper', from: '', to: '', symbol: '', tag: '', outcome: '' }; } }
  function saveUi(u) { try { localStorage.setItem(UI_KEY, JSON.stringify(u)); } catch (e) {} }
  const dayMs = (s, end) => { if (!s) return null; const d = new Date(s + 'T00:00:00'); if (isNaN(d)) return null; if (end) d.setDate(d.getDate() + 1); return d.getTime(); };

  // ------------------------------------------------------------------ canvas: equity curve
  function sizeCanvas(cv, cssH) {
    const w = Math.max(10, cv.parentElement ? cv.parentElement.clientWidth : 300), dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.style.width = w + 'px'; cv.style.height = cssH + 'px';
    cv.width = Math.round(w * dpr); cv.height = Math.round(cssH * dpr);
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { g, w, hgt: cssH };
  }
  function drawEquity(cv, s, cssH) {
    const { g, w, hgt } = sizeCanvas(cv, cssH);
    g.clearRect(0, 0, w, hgt);
    const pts = s.equity;
    const ink3 = css('--ink-3', '#6b6f7a'), line = css('--line', '#2c2c32'), bull = css('--bull', '#03c988'), bear = css('--bear', '#e5484d');
    g.font = '10px ' + (css('--font-mono', '') || 'monospace');
    if (pts.length < 2) { g.fillStyle = ink3; g.textAlign = 'center'; g.fillText('The equity curve appears after your first closed trade.', w / 2, hgt / 2); return; }
    let lo = Infinity, hi = -Infinity;
    for (const p of pts) { lo = Math.min(lo, p.eq); hi = Math.max(hi, p.eq); }
    lo = Math.min(lo, s.startBalance); hi = Math.max(hi, s.startBalance);
    if (hi - lo < 1) { hi += 1; lo -= 1; }
    const padL = 6, padR = 62, padT = 8, padB = 8;
    const X = (i) => padL + (w - padL - padR) * (i / (pts.length - 1));
    const Y = (v) => padT + (hgt - padT - padB) * (1 - (v - lo) / (hi - lo));
    // start-balance line
    g.strokeStyle = line; g.setLineDash([3, 3]); g.lineWidth = 1;
    g.beginPath(); g.moveTo(padL, Y(s.startBalance)); g.lineTo(w - padR, Y(s.startBalance)); g.stroke(); g.setLineDash([]);
    const end = pts[pts.length - 1].eq, col = end >= s.startBalance ? bull : bear;
    // area
    const grad = g.createLinearGradient(0, padT, 0, hgt - padB);
    grad.addColorStop(0, col + '55'); grad.addColorStop(1, col + '00');
    g.beginPath(); g.moveTo(X(0), Y(s.startBalance));
    pts.forEach((p, i) => g.lineTo(X(i), Y(p.eq)));
    g.lineTo(X(pts.length - 1), Y(s.startBalance)); g.closePath();
    g.fillStyle = /^#[0-9a-f]{6}$/i.test(col) ? grad : 'transparent'; g.fill();
    g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(X(i), Y(p.eq)) : g.moveTo(X(i), Y(p.eq))));
    g.strokeStyle = col; g.lineWidth = 1.6; g.stroke();
    g.fillStyle = ink3; g.textAlign = 'left';
    g.fillText(money(Math.round(hi)).replace('.00', ''), w - padR + 6, padT + 8);
    g.fillText(money(Math.round(lo)).replace('.00', ''), w - padR + 6, hgt - padB);
    g.fillStyle = col; g.fillText(money(Math.round(end)).replace('.00', ''), w - padR + 6, Math.min(hgt - padB - 12, Math.max(padT + 20, Y(end) + 3)));
  }

  // ------------------------------------------------------------------ mini chart snapshot
  const TFS = [['1', 60e3], ['5', 300e3], ['15', 900e3], ['60', 3600e3], ['240', 14400e3], ['D', 86400e3]];
  function planBars(t) {
    const hold = Math.max(60e3, (t.exitAt || 0) - (t.entryAt || 0));
    for (let i = 0; i < TFS.length; i++) {
      const [tf, ms] = TFS[i];
      const pad = Math.max(hold * 0.6, 15 * ms);
      if ((hold + 2 * pad) / ms <= 90 || i === TFS.length - 1) return { tf, ms, from: t.entryAt - pad, to: t.exitAt + pad, idx: i };
    }
  }
  let futMod = null;
  async function builtinBars(symbol, tf, from, to) {
    const m = /^([a-z_]+):(.+)$/i.exec(String(symbol || ''));
    const prov = m ? m[1].toLowerCase() : '', tick = m ? m[2] : String(symbol);
    if (prov === 'futures') {
      if (!futMod) {
        const v = (document.querySelector('meta[name="stryker-build"]') || {}).content || '';
        futMod = import('/assets/chart-futures-provider.js?v=' + v).then((x) => new x.FuturesProvider());
      }
      const p = await futMod;
      return p.getBars(tick, tf, { from, to });
    }
    if (prov === 'binance' && !/\.P$|PERP/i.test(tick)) {
      const iv = { '1': '1m', '5': '5m', '15': '15m', '60': '1h', '240': '4h', D: '1d' }[tf];
      for (const base of ['https://api.binance.com/api/v3', 'https://data-api.binance.vision/api/v3']) {
        try {
          const u = base + '/klines?symbol=' + encodeURIComponent(tick.toUpperCase()) + '&interval=' + iv + '&startTime=' + Math.floor(from) + '&endTime=' + Math.floor(to) + '&limit=1000';
          const r = await fetch(u); if (!r.ok) continue;
          const d = await r.json();
          return (Array.isArray(d) ? d : []).map((k) => ({ time: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4] }));
        } catch (e) { /* next mirror */ }
      }
      return [];
    }
    return null;   // no data source here for this provider
  }
  async function barsFor(t, getBars) {
    const plan = planBars(t);
    for (let i = plan.idx; i < TFS.length; i++) {
      const [tf, ms] = TFS[i];
      const pad = Math.max(((t.exitAt - t.entryAt) || 0) * 0.6, 15 * ms);
      const from = t.entryAt - pad, to = t.exitAt + pad;
      let bars = null;
      try { bars = getBars ? await getBars(t.symbol, tf, from, to) : null; } catch (e) { bars = null; }
      if (bars == null) { try { bars = await builtinBars(t.symbol, tf, from, to); } catch (e) { bars = []; } }
      if (bars == null) return { bars: [], tf, unavailable: true };
      const norm = (bars || []).map((b) => ({ t: b.time != null ? b.time : b.t, o: b.open != null ? b.open : b.o, h: b.high != null ? b.high : b.h, l: b.low != null ? b.low : b.l, c: b.close != null ? b.close : b.c }))
        .filter((b) => b.t >= from - ms && b.t <= to && b.h > 0).slice(-160);
      // the snapshot needs bars that actually cover the trade
      if (norm.length >= 3 && norm[0].t <= t.entryAt && norm[norm.length - 1].t + ms >= t.exitAt) return { bars: norm, tf, ms };
      if (norm.length >= 3 && i === TFS.length - 1) return { bars: norm, tf, ms };
    }
    return { bars: [], tf: '1' };
  }
  function drawSnapshot(cv, t, data, cssH) {
    const { g, w, hgt } = sizeCanvas(cv, cssH);
    const ink3 = css('--ink-3', '#6b6f7a'), ink1 = css('--ink-1', '#d6d8de'), bull = css('--bull', '#03c988'), bear = css('--bear', '#e5484d'), teal = css('--teal', '#00adb5');
    const font = css('--font-mono', '') || 'monospace';
    g.clearRect(0, 0, w, hgt); g.font = '10px ' + font;
    const bars = data.bars;
    if (!bars.length) { g.fillStyle = ink3; g.textAlign = 'center'; g.fillText(data.unavailable ? 'No chart snapshot for this market here.' : 'No bars found around this trade.', w / 2, hgt / 2); return; }
    const sl = t.sl0 != null ? t.sl0 : t.sl;
    let lo = Infinity, hi = -Infinity;
    for (const b of bars) { lo = Math.min(lo, b.l); hi = Math.max(hi, b.h); }
    for (const v of [t.entry, t.exit, sl, t.tp]) if (v != null && Number.isFinite(+v)) { lo = Math.min(lo, +v); hi = Math.max(hi, +v); }
    const span = hi - lo || 1; lo -= span * 0.06; hi += span * 0.06;
    const padL = 4, padR = 64, padT = 8, padB = 16;
    const n = bars.length, cw = (w - padL - padR) / n;
    const X = (i) => padL + cw * (i + 0.5);
    const Y = (v) => padT + (hgt - padT - padB) * (1 - (v - lo) / (hi - lo));
    const ms = data.ms || 60e3;
    const xAt = (time) => { let i = 0; while (i < n - 1 && bars[i + 1].t <= time) i++; return X(i) + Math.max(-cw / 2, Math.min(cw / 2, ((time - bars[i].t) / ms - 0.5) * cw)); };
    const ex = xAt(t.entryAt), xx = xAt(t.exitAt);
    // hold window
    g.fillStyle = 'rgba(128,128,128,.10)'; g.fillRect(Math.min(ex, xx), padT, Math.max(2, Math.abs(xx - ex)), hgt - padT - padB);
    // candles
    for (let i = 0; i < n; i++) {
      const b = bars[i], up = b.c >= b.o;
      g.strokeStyle = g.fillStyle = up ? bull : bear;
      g.beginPath(); g.moveTo(Math.round(X(i)) + 0.5, Y(b.h)); g.lineTo(Math.round(X(i)) + 0.5, Y(b.l)); g.stroke();
      const bw = Math.max(1, cw * 0.62), top = Y(Math.max(b.o, b.c)), bh = Math.max(1, Math.abs(Y(b.o) - Y(b.c)));
      g.fillRect(X(i) - bw / 2, top, bw, bh);
    }
    // levels
    const level = (v, col, label) => {
      if (v == null || !Number.isFinite(+v)) return;
      const y = Math.round(Y(+v)) + 0.5;
      g.strokeStyle = col; g.setLineDash([4, 3]); g.lineWidth = 1;
      g.beginPath(); g.moveTo(padL, y); g.lineTo(w - padR, y); g.stroke(); g.setLineDash([]);
      g.fillStyle = col; g.fillRect(w - padR + 2, y - 7, padR - 2, 14);
      g.fillStyle = '#0b0b0d'; g.textAlign = 'left'; g.fillText(label, w - padR + 5, y + 3.5);
    };
    level(t.tp, bull, 'TP');
    level(sl, bear, 'SL');
    // entry / exit markers
    const long = t.side === 'buy';
    const arrow = (x, y, upw, col) => { g.fillStyle = col; g.beginPath(); if (upw) { g.moveTo(x, y); g.lineTo(x - 5, y + 8); g.lineTo(x + 5, y + 8); } else { g.moveTo(x, y); g.lineTo(x - 5, y - 8); g.lineTo(x + 5, y - 8); } g.closePath(); g.fill(); };
    const ye = Y(+t.entry), yx = Y(+t.exit);
    g.strokeStyle = ink1; g.lineWidth = 1; g.setLineDash([2, 2]);
    g.beginPath(); g.moveTo(ex, ye); g.lineTo(xx, yx); g.stroke(); g.setLineDash([]);
    arrow(ex, long ? ye + 2 : ye - 2, long, teal);
    g.fillStyle = (t.pnl >= 0 ? bull : bear); g.beginPath(); g.arc(xx, yx, 4, 0, Math.PI * 2); g.fill();
    g.strokeStyle = ink1; g.stroke();
    g.fillStyle = ink3; g.textAlign = 'left';
    g.fillText((long ? 'Long' : 'Short') + ' entry ' + px(t, t.entry), padL + 2, hgt - 4);
    g.textAlign = 'right'; g.fillText((data.tf === 'D' ? '1D' : data.tf + 'm') + ' bars', w - padR - 4, hgt - 4);
  }

  // ------------------------------------------------------------------ component
  function mount(el, opts) {
    opts = opts || {};
    const compact = !!opts.compact;
    const ui = loadUi();
    if (ui.kind !== 'replay') ui.kind = 'paper';
    let open = null;           // trade id of the expanded row
    let dirty = false;         // an editor has unsaved input
    let sig = '';
    let lastStats = null;
    const root = h('div', { class: 'pr' + (compact ? ' pr-compact' : ' pr-full') });
    el.textContent = ''; el.appendChild(root);

    function state() { try { return opts.getState(ui.kind) || null; } catch (e) { return null; } }
    function signature(st) {
      if (!st) return ui.kind + ':none';
      const tr = st.trades || [];
      let a = 0; for (const t of tr) a += (t.note || '').length + (t.setup || '').length * 3 + (t.mistake || '').length * 7 + (t.emotion || '').length * 11;
      return [ui.kind, st.resetAt, st.startBalance, tr.length, tr.length ? tr[tr.length - 1].id : 0, a].join(':');
    }

    function render() {
      const st = state();
      sig = signature(st);
      root.textContent = '';
      const all = st && Array.isArray(st.trades) ? st.trades.filter((t) => t && Number.isFinite(Number(t.pnl))) : [];
      const tags = S.tagsOf(all);
      const f = { from: dayMs(ui.from), to: dayMs(ui.to, true), symbol: ui.symbol, tag: ui.tag, outcome: ui.outcome };
      const list = S.filterTrades(all, f);
      const s = S.stats(list, st ? st.startBalance : 100000);
      lastStats = s;

      // header
      const kindBtn = (k, label) => h('button', { type: 'button', role: 'tab', class: ui.kind === k ? 'on' : '', 'aria-selected': ui.kind === k ? 'true' : 'false',
        onclick: () => { if (ui.kind === k) return; ui.kind = k; open = null; saveUi(ui); render(); } }, [label]);
      root.appendChild(h('div', { class: 'pr-head' }, [
        compact ? null : h('h1', { class: 'pr-title', text: 'Trade review' }),
        h('div', { class: 'pr-kind', role: 'tablist', 'aria-label': 'Which account' }, [kindBtn('paper', 'Paper account'), kindBtn('replay', 'Replay account')]),
        h('span', { class: 'pr-sp' }),
        h('button', { type: 'button', class: 'pr-btn', title: 'Download the filtered trades as a CSV file', onclick: () => exportCsv(list) }, ['Export CSV']),
        compact && opts.fullHref ? h('a', { class: 'pr-btn pr-btn-pri', href: opts.fullHref, target: '_blank', rel: 'noopener' }, ['Full review ↗']) : null
      ]));
      root.appendChild(h('p', { class: 'pr-disc', role: 'note', text: S.DISCLAIMER }));
      if (ui.kind === 'replay') root.appendChild(h('p', { class: 'pr-note', text: 'Bar replay account: trades placed while replaying history. Kept apart from your paper account, saved in this browser only, and never counted on the leaderboard.' }));
      if (opts.leaderboard && ui.kind === 'paper') { const lb = opts.leaderboard(); if (lb) root.appendChild(lb); }

      // filters
      const sel = (key, label, values) => h('label', { class: 'pr-f' }, [h('span', { text: label }), (() => {
        const s2 = h('select', { 'data-f': key, onchange: (e) => { ui[key] = e.target.value; saveUi(ui); open = null; render(); } }, [h('option', { value: '', text: 'All' })].concat(values.map((v) => h('option', { value: v, text: v }))));
        s2.value = values.indexOf(ui[key]) >= 0 ? ui[key] : ''; return s2;
      })()]);
      const date = (key, label) => h('label', { class: 'pr-f' }, [h('span', { text: label }), h('input', { type: 'date', value: ui[key] || '', 'data-f': key, onchange: (e) => { ui[key] = e.target.value; saveUi(ui); open = null; render(); } })]);
      const allTags = Array.from(new Set(tags.setup.concat(tags.mistake, tags.emotion))).sort((a, b) => a.localeCompare(b));
      const outSel = h('select', { 'data-f': 'outcome', onchange: (e) => { ui.outcome = e.target.value; saveUi(ui); open = null; render(); } },
        [['', 'All'], ['win', 'Wins'], ['loss', 'Losses'], ['scratch', 'Break-even']].map(([v, t]) => h('option', { value: v, text: t })));
      outSel.value = ui.outcome || '';
      const active = ui.from || ui.to || ui.symbol || ui.tag || ui.outcome;
      root.appendChild(h('div', { class: 'pr-filters' }, [
        date('from', 'From'), date('to', 'To'), sel('symbol', 'Symbol', tags.symbol), sel('tag', 'Tag', allTags),
        h('label', { class: 'pr-f' }, [h('span', { text: 'Outcome' }), outSel]),
        active ? h('button', { type: 'button', class: 'pr-btn pr-clear', onclick: () => { Object.assign(ui, { from: '', to: '', symbol: '', tag: '', outcome: '' }); saveUi(ui); render(); } }, ['Clear']) : null,
        h('span', { class: 'pr-count', text: list.length + (list.length === 1 ? ' trade' : ' trades') + (active ? ' of ' + all.length : '') })
      ]));

      // KPIs
      const kpi = (label, val, c, sub) => h('div', { class: 'pr-kpi' }, [h('em', { text: label }), h('b', { class: c || null, text: val }), sub ? h('small', { text: sub }) : null]);
      root.appendChild(h('div', { class: 'pr-kpis' }, [
        kpi('Net P&L', moneyW(s.net, true), cls(s.net), pct(s.returnPct, true) + ' on start'),
        kpi('Win rate', s.winRate == null ? '—' : s.winRate.toFixed(1) + '%', null, s.wins + 'W · ' + s.losses + 'L' + (s.scratches ? ' · ' + s.scratches + ' BE' : '')),
        kpi('Average R', rr(s.avgR), cls(s.avgR), s.rTrades + ' with a stop'),
        kpi('Expectancy', moneyW(s.expectancy, true), cls(s.expectancy), 'per trade'),
        kpi('Profit factor', s.profitFactor == null ? (s.wins ? '∞' : '—') : s.profitFactor.toFixed(2), s.profitFactor == null ? null : s.profitFactor >= 1 ? 'up' : 'down'),
        kpi('Max drawdown', moneyW(-s.maxDD), s.maxDD ? 'down' : null, pct(s.maxDDPct) + ' from peak'),
        kpi('Best trade', s.best ? moneyW(s.best.pnl, true) : '—', s.best ? cls(s.best.pnl) : null, s.best ? showSym(s.best.symbol) : ''),
        kpi('Worst trade', s.worst ? moneyW(s.worst.pnl, true) : '—', s.worst ? cls(s.worst.pnl) : null, s.worst ? showSym(s.worst.symbol) : ''),
        kpi('Average hold', S.fmtHold(s.avgHold), null, s.trades + ' trades')
      ]));

      // equity curve
      const eqWrap = h('div', { class: 'pr-card pr-eq' }, [h('h3', { class: 'pr-h3', text: 'Equity curve' }), h('div', { class: 'pr-cv' }, [h('canvas', { 'aria-label': 'Equity curve of the filtered trades', role: 'img' })])]);
      root.appendChild(eqWrap);

      // breakdowns (full page)
      if (!compact) {
        const tbl = (title, rows) => {
          const t = h('table', { class: 'pr-t' });
          t.appendChild(h('thead', null, [h('tr', null, [title, 'Trades', 'Win', 'Avg R', 'Exp.', 'Net'].map((x) => h('th', { text: x, title: x === 'Exp.' ? 'Expectancy: average P&L per trade' : x === 'Win' ? 'Win rate' : null })))]));
          const tb = h('tbody');
          if (!rows.length) tb.appendChild(h('tr', null, [h('td', { colspan: '6', class: 'pr-empty', text: 'No trades yet.' })]));
          rows.forEach((r) => tb.appendChild(h('tr', null, [h('td', { text: r.key === '(none)' ? 'No ' + title.toLowerCase() + ' tag' : r.key }), h('td', { text: String(r.trades) }),
            h('td', { text: r.winRate == null ? '—' : r.winRate.toFixed(0) + '%' }), h('td', { class: cls(r.avgR), text: rr(r.avgR) }),
            h('td', { class: cls(r.expectancy), text: moneyW(r.expectancy, true) }), h('td', { class: cls(r.net), text: moneyW(r.net, true) })])));
          t.appendChild(tb);
          return h('div', { class: 'pr-card' }, [h('h3', { class: 'pr-h3', text: 'By ' + title.toLowerCase() }), h('div', { class: 'pr-tw' }, [t])]);
        };
        root.appendChild(h('div', { class: 'pr-grid' }, [tbl('Setup', S.bySetup(list)), tbl('Session', S.bySession(list)), tbl('Weekday', S.byWeekday(list)), tbl('Symbol', S.bySymbol(list))]));
        root.appendChild(h('p', { class: 'pr-note', text: 'Sessions by entry time in New York: Asia 17:00-02:00, London 02:00-08:00, New York 08:00-17:00. R = P&L divided by the risk at the first stop loss; trades without a stop have no R.' }));
      }

      // trades
      const rows = list.map(S.enrich).sort((a, b) => b.exitAt - a.exitAt || b.id - a.id);
      const tw = h('div', { class: 'pr-card pr-trades' }, [h('h3', { class: 'pr-h3', text: 'Closed trades' + (rows.length ? ' (newest first)' : '') })]);
      if (!rows.length) {
        tw.appendChild(h('p', { class: 'pr-empty', text: all.length ? 'No trades match these filters.' : (ui.kind === 'replay' ? 'No closed trades in the Replay account yet. Start Bar replay on the Charts page and trade.' : 'No closed paper trades yet. Turn on paper trading in the Charts settings, place a trade, and it will appear here when it closes.') }));
      } else {
        const listEl = h('div', { class: 'pr-list', role: 'list' });
        for (const t of rows.slice(0, 250)) listEl.appendChild(row(t));
        tw.appendChild(listEl);
      }
      root.appendChild(tw);
      if (compact) root.appendChild(h('p', { class: 'pr-note', text: 'Breakdowns by setup, session and weekday are on the full review page.' }));
      requestAnimationFrame(() => { const cv = eqWrap.querySelector('canvas'); if (cv) drawEquity(cv, s, compact ? 110 : 190); });
    }

    function row(t) {
      const isOpen = open === t.id;
      const head = h('button', { type: 'button', class: 'pr-row', 'aria-expanded': isOpen ? 'true' : 'false', onclick: () => {
        if (dirty && open !== t.id && !window.confirm('Discard the unsaved note?')) return;
        dirty = false; open = isOpen ? null : t.id; render();
      } }, [
        h('span', { class: 'pr-c-when', text: fmtDate(t.exitAt) }),
        h('span', { class: 'pr-c-sym' }, [h('b', { text: showSym(t.symbol) }), ' ', h('i', { class: t.side === 'buy' ? 'up' : 'down', text: t.side === 'buy' ? 'Long' : 'Short' }), ' ', h('small', { text: String(t.qty) })]),
        h('span', { class: 'pr-c-px', text: px(t, t.entry) + ' → ' + px(t, t.exit) }),
        h('span', { class: 'pr-c-r ' + cls(t.r), text: rr(t.r) }),
        h('span', { class: 'pr-c-pnl ' + cls(t.pnl), text: money(t.pnl, true) }),
        h('span', { class: 'pr-c-meta' }, [
          h('span', { text: S.fmtHold(t.hold) }), h('span', { text: t.session || '—' }),
          t.setup ? h('span', { class: 'pr-chip', text: t.setup }) : null,
          t.mistake ? h('span', { class: 'pr-chip pr-chip-m', text: t.mistake }) : null,
          t.emotion ? h('span', { class: 'pr-chip pr-chip-e', text: t.emotion }) : null,
          t.note ? h('span', { class: 'pr-chip pr-chip-n', title: t.note, text: '✎ note' }) : null
        ])
      ]);
      const wrap = h('div', { class: 'pr-item' + (isOpen ? ' open' : ''), role: 'listitem', 'data-tid': String(t.id) }, [head]);
      if (isOpen) wrap.appendChild(detail(t));
      return wrap;
    }

    function detail(t) {
      const cvWrap = h('div', { class: 'pr-snap' }, [h('canvas', { role: 'img', 'aria-label': 'Chart snapshot: price bars around this trade with its entry, exit, stop loss and take profit' }), h('p', { class: 'pr-snap-wait', text: 'Loading the chart…' })]);
      const kv = (k, v, c) => h('div', { class: 'pr-kv' }, [h('em', { text: k }), h('b', { class: c || null, text: v })]);
      const reason = { tp: 'Take profit', sl: 'Stop loss', manual: 'Closed by you', reverse: 'Reversed' }[t.reason] || t.reason || '—';
      const facts = h('div', { class: 'pr-kvs' }, [
        kv('Entry', px(t, t.entry) + ' · ' + fmtDate(t.entryAt)), kv('Exit', px(t, t.exit) + ' · ' + fmtDate(t.exitAt)), kv('Exit by', reason),
        kv('First stop', t.sl0 != null ? px(t, t.sl0) : (t.sl != null ? px(t, t.sl) : 'None')), kv('Risk', t.risk ? money(t.risk) : '—'), kv('R multiple', rr(t.r), cls(t.r)),
        kv('MAE', t.mae != null ? px(t, t.mae) + ' pts' + (t.maeR != null ? ' (' + t.maeR.toFixed(2) + 'R)' : '') : '—', t.mae ? 'down' : null),
        kv('MFE', t.mfe != null ? px(t, t.mfe) + ' pts' + (t.mfeR != null ? ' (' + t.mfeR.toFixed(2) + 'R)' : '') : '—', t.mfe ? 'up' : null),
        kv('Hold', S.fmtHold(t.hold)), kv('Session', (t.session || '—') + (t.weekday ? ' · ' + t.weekday : '')), kv('Fees', money(t.fees)), kv('P&L', money(t.pnl, true), cls(t.pnl))
      ]);
      const field = (key) => {
        const id = 'pr-' + key + '-' + t.id, dl = 'pr-dl-' + key;
        const inp = h('input', { id, type: 'text', maxlength: String(TAG_MAX), list: dl, value: t[key] || '', placeholder: key === 'mistake' ? 'None' : 'Pick or type', autocomplete: 'off', 'data-k': key, oninput: () => { dirty = true; } });
        return h('label', { class: 'pr-f pr-tag', for: id }, [h('span', { text: TAG_LABEL[key] }), inp]);
      };
      const note = h('textarea', { rows: '3', maxlength: String(NOTE_MAX), 'data-k': 'note', placeholder: 'What did you see, why did you take it, what would you do differently?', oninput: () => { dirty = true; } });
      note.value = t.note || '';
      const saveBtn = h('button', { type: 'button', class: 'pr-btn pr-btn-pri', text: 'Save review' });
      const form = h('div', { class: 'pr-form' }, [
        h('div', { class: 'pr-tags' }, [field('setup'), field('mistake'), field('emotion')]),
        h('label', { class: 'pr-f pr-notef' }, [h('span', { text: 'Note' }), note]),
        h('div', { class: 'pr-actions' }, [saveBtn, h('span', { class: 'pr-note', text: t.src === 'replay' || ui.kind === 'replay' ? 'Saved in this browser with the Replay account.' : 'Saved with your paper account.' })])
      ]);
      saveBtn.onclick = async () => {
        const patch = { note: note.value.slice(0, NOTE_MAX).trim() };
        for (const k of ['setup', 'mistake', 'emotion']) patch[k] = String(form.querySelector('[data-k=' + k + ']').value || '').slice(0, TAG_MAX).trim();
        saveBtn.disabled = true;
        try { await opts.save(ui.kind, t.id, patch); dirty = false; toast('Review saved.', 'success'); render(); }
        catch (e) { saveBtn.disabled = false; toast((e && e.message) || 'Could not save the review. Try again.', 'error'); }
      };
      const box = h('div', { class: 'pr-detail' }, [h('div', { class: 'pr-dl' }, [cvWrap, facts]), form]);
      // datalists (once per component)
      for (const k of ['setup', 'mistake', 'emotion']) {
        if (root.querySelector('#pr-dl-' + k)) continue;
        const st = state(); const used = st ? S.tagsOf(st.trades || [])[k] : [];
        root.appendChild(h('datalist', { id: 'pr-dl-' + k }, Array.from(new Set(PRESETS[k].concat(used))).map((v) => h('option', { value: v }))));
      }
      const cv = cvWrap.querySelector('canvas');
      const hgt = compact ? 150 : 210;
      barsFor(t, opts.getBars).then((data) => {
        if (!cv.isConnected) return;
        const w = cvWrap.querySelector('.pr-snap-wait'); if (w) w.remove();
        drawSnapshot(cv, t, data, hgt);
        cv._redraw = () => drawSnapshot(cv, t, data, hgt);
      }).catch(() => { const w = cvWrap.querySelector('.pr-snap-wait'); if (w) w.textContent = 'Could not load the chart for this trade.'; });
      return box;
    }

    function exportCsv(list) {
      if (!list.length) { toast('No trades to export.', 'info'); return; }
      const blob = new Blob([S.toCSV(list.slice().sort((a, b) => a.exitAt - b.exitAt))], { type: 'text/csv;charset=utf-8' });
      const a = h('a', { href: URL.createObjectURL(blob), download: 'tradezoro-' + (ui.kind === 'replay' ? 'replay' : 'paper') + '-trades-' + new Date().toISOString().slice(0, 10) + '.csv' });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }

    let rz = 0;
    const onResize = () => { clearTimeout(rz); rz = setTimeout(() => {
      if (!root.isConnected || !lastStats) return;
      const cv = root.querySelector('.pr-eq canvas'); if (cv) drawEquity(cv, lastStats, compact ? 110 : 190);
      const sc = root.querySelector('.pr-snap canvas'); if (sc && sc._redraw) sc._redraw();
    }, 120); };
    window.addEventListener('resize', onResize, { passive: true });
    const onTheme = () => onResize();
    window.addEventListener('stryker:theme', onTheme);

    render();
    return {
      update(force) {
        if (!root.isConnected) return;
        const st = state();
        if (!force && signature(st) === sig) return;
        if (dirty || (root.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName))) return;   // never wipe what the member is typing
        render();
      },
      get stats() { return lastStats; },
      destroy() { window.removeEventListener('resize', onResize); window.removeEventListener('stryker:theme', onTheme); root.remove(); }
    };
  }

  /** Apply a review patch to one trade of a state object (in place). Returns the trade or null. */
  function applyPatch(st, tradeId, patch) {
    const t = st && Array.isArray(st.trades) ? st.trades.find((x) => x && x.id === tradeId) : null;
    if (!t) return null;
    for (const k of ['note', 'setup', 'mistake', 'emotion']) {
      if (!(k in patch)) continue;
      const v = String(patch[k] == null ? '' : patch[k]).slice(0, k === 'note' ? NOTE_MAX : TAG_MAX).trim();
      if (v) t[k] = v; else delete t[k];
    }
    return t;
  }

  window.PaperReview = { mount, applyPatch, NOTE_MAX, TAG_MAX, PRESETS };
})();
