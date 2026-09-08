/**
 * Stryker Trading Academy — Backtest replay page controller
 *
 * FX-Replay-style bar-by-bar backtesting: pick a market and a start date,
 * the chart shows history up to that moment and nothing after it, then you
 * step or play forward while placing simulated orders. Positions, stops,
 * targets, account balance, equity curve and trade statistics update on every
 * bar. Sessions save to this browser (IndexedDB) and, best-effort, to
 * students/{uid}/replay in Firestore so they can be resumed elsewhere.
 *
 * Depends on: replay-engine.js (logic), replay-chart.js (canvas view),
 * replay-data.js (candles + storage). Gate: Pro and above (RP_MIN_RANK).
 */
(function () {
  'use strict';
  const E = window.ReplayEngine, D = window.ReplayData;
  const RP_MIN_RANK = 1;
  const SPEEDS = [1, 2, 4, 8, 15, 30];
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n, sign) => { const v = Number(n) || 0; const s = (v < 0 ? '-' : (sign && v > 0 ? '+' : '')) + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return s; };
  const toast = (m, kind) => { if (typeof showToast === 'function') showToast(m, kind); else console.log(kind || 'info', m); };

  const RP = window.__RP = { uid: null, spec: null, series: null, sim: null, cursor: 0, tf: '5m', htfTf: '1h', chart: null, htf: null, playing: false, timer: null, speedIdx: 2, session: null, side: 'buy', dirty: false, tz: 'America/New_York', tradesRendered: -1, stepsSinceSave: 0 };

  // ---- setup screen ----------------------------------------------------------
  function fillSymbols() {
    const sel = $('rp-symbol'); const groups = {};
    for (const s of D.SYMBOLS) (groups[s.group] = groups[s.group] || []).push(s);
    sel.innerHTML = Object.keys(groups).map((g) => '<optgroup label="' + esc(g) + '">' + groups[g].map((s) => '<option value="' + esc(s.id) + '">' + esc(s.label) + '</option>').join('') + '</optgroup>').join('');
    const saved = localStorage.getItem('stryker_replay_symbol'); if (saved && D.findSymbol(saved)) sel.value = saved;
  }
  function defaultDates() {
    const d = new Date(Date.now() - 10 * 86400000); $('rp-start').value = d.toISOString().slice(0, 10);
    $('rp-start').max = new Date().toISOString().slice(0, 10);
  }
  function updateDataNote() {
    const spec = D.findSymbol($('rp-symbol').value); const wrap = $('rp-csv-wrap');
    wrap.hidden = !spec || spec.src !== 'csv';
    const note = $('rp-datanote'); if (!spec) return;
    const startMs = Date.parse($('rp-start').value + 'T00:00:00Z'); const days = Number($('rp-days').value);
    if (spec.src === 'binance') note.textContent = 'Binance public data · ' + D.binanceInterval(days) + ' candles will be loaded for ' + days + ' days. Full history is available.';
    else if (spec.src === 'yahoo') { const iv = D.yahooInterval(startMs - 2 * 86400000); note.textContent = 'Yahoo Finance · finest resolution for that start date is ' + iv + (iv === '1m' ? ' (last 30 days only)' : iv === '5m' ? ' (last 60 days only)' : iv === '1h' ? ' (last 2 years)' : ' (daily)') + '. For 1-minute NQ further back, import a CSV export.'; }
    else note.textContent = 'Your own candles, parsed in this browser. TradingView, MT4 and MT5 exports work (time, open, high, low, close, volume).';
    $('rp-unit').textContent = spec.unit || 'units';
  }
  async function refreshCsvList() {
    const list = await D.store.listCsv(); const sel = $('rp-csv-list');
    sel.innerHTML = list.length ? list.map((c) => '<option value="' + esc(c.name) + '">' + esc(c.name) + ' · ' + c.bars.toLocaleString() + ' bars · ' + esc(c.baseTf) + '</option>').join('') : '<option value="">No files yet — choose one below</option>';
  }
  async function onCsvFile(e) {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    try {
      const text = await f.text(); const parsed = D.parseCsv(text);
      await D.store.putCsv({ name: f.name, bars: parsed.bars, baseTf: parsed.baseTf, savedAt: Date.now() });
      await refreshCsvList(); $('rp-csv-list').value = f.name;
      const first = new Date(parsed.bars[0].t).toISOString().slice(0, 10), last = new Date(parsed.bars[parsed.bars.length - 1].t).toISOString().slice(0, 10);
      $('rp-start').value = first; $('rp-start').min = ''; $('rp-datanote').textContent = 'Loaded ' + parsed.bars.length.toLocaleString() + ' ' + parsed.baseTf + ' candles from ' + first + ' to ' + last + '. ' + parsed.note.replace(/^Your file · [^·]+· ?/, '');
      toast('CSV stored in this browser: ' + f.name, 'success');
    } catch (err) { toast(err.message || String(err), 'error'); }
    e.target.value = '';
  }
  async function renderSessionList() {
    const list = await D.store.listSessions(); const el = $('rp-session-list');
    if (!list.length) { el.innerHTML = '<p class="rp-empty">No saved sessions yet. Start one above — progress saves automatically.</p>'; return; }
    el.innerHTML = list.map((s) => {
      const st = s.summary || {}; const pct = s.total ? Math.round(100 * (s.cursor + 1) / s.total) : 0;
      return '<div class="rp-sess" data-id="' + esc(s.id) + '"><div class="rp-sess-main"><b>' + esc(s.name || s.symbolId) + '</b><span>' + esc(s.symbolLabel || s.symbolId) + ' · ' + esc(s.tf) + ' · from ' + new Date(s.startMs).toISOString().slice(0, 10) + ' · ' + pct + '% replayed</span></div>' +
        '<div class="rp-sess-stats"><span class="' + ((st.net || 0) >= 0 ? 'up' : 'down') + '">' + money(st.net || 0, true) + '</span><span>' + (st.count || 0) + ' trades · ' + (st.winRate || 0) + '% win</span></div>' +
        '<div class="rp-sess-actions"><button type="button" class="btn btn-secondary btn-sm" data-resume>Resume</button><button type="button" class="icon-btn" data-del title="Delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg></button></div></div>';
    }).join('');
  }

  // ---- start / resume ----------------------------------------------------------
  async function startNew() {
    const spec = D.findSymbol($('rp-symbol').value); if (!spec) return;
    const startMs = Date.parse($('rp-start').value + 'T00:00:00Z'); if (!isFinite(startMs)) { toast('Pick a start date', 'error'); return; }
    const days = Number($('rp-days').value) || 14; const balance = Number($('rp-balance').value) || 100000;
    const csvName = spec.src === 'csv' ? $('rp-csv-list').value : null;
    if (spec.src === 'csv' && !csvName) { toast('Choose a CSV file first', 'error'); return; }
    localStorage.setItem('stryker_replay_symbol', spec.id);
    const warmup = 3 * 86400000;
    const session = { id: 'rp_' + Date.now().toString(36), name: $('rp-name').value.trim() || (spec.label.split(' · ')[0] + ' · ' + $('rp-start').value), symbolId: spec.id, symbolLabel: spec.label, csvName, startMs, endMs: startMs + days * 86400000, loadFrom: startMs - warmup, balance, tz: $('rp-tz').value, tf: null, htfTf: null, cursor: null, sim: null, drawings: [], createdAt: Date.now(), updatedAt: Date.now() };
    await openSession(session, spec, true);
  }
  async function resumeSession(id) {
    const s = await D.store.getSession(id); if (!s) { toast('That session is gone', 'error'); return; }
    const spec = D.findSymbol(s.symbolId); if (!spec) { toast('Unknown market in that session', 'error'); return; }
    await openSession(s, spec, false);
  }
  async function openSession(session, spec, fresh) {
    const btn = $('rp-start-btn'); btn.disabled = true; const prog = $('rp-progress'); prog.textContent = 'Loading candles…';
    try {
      const data = await D.load({ spec, startMs: session.loadFrom, endMs: session.endMs, csvName: session.csvName, onProgress: (p, n) => { prog.textContent = 'Loading candles… ' + Math.round(p * 100) + '%' + (n ? ' (' + n.toLocaleString() + ' bars)' : ''); } });
      RP.spec = Object.assign({}, spec, session.csvName ? { symbol: session.csvName.replace(/\.csv$/i, '') } : { symbol: spec.id.replace(/=F|=X|USDT$/, (m) => m === 'USDT' ? '/USDT' : '') });
      RP.series = new E.Series(data.bars, data.baseTf);
      RP.session = session; RP.tz = session.tz || 'America/New_York';
      session.total = RP.series.length; session.dataNote = data.note;
      const tfs = RP.series.availableTimeframes();
      RP.tf = session.tf && tfs.includes(session.tf) ? session.tf : (tfs.includes('5m') ? '5m' : tfs.includes('1h') ? '1h' : tfs[0]);
      RP.htfTf = session.htfTf && tfs.includes(session.htfTf) ? session.htfTf : (tfs.includes('1h') && RP.tf !== '1h' ? '1h' : tfs.includes('4h') ? '4h' : tfs[tfs.length - 1]);
      if (fresh || session.cursor == null) { let c = RP.series.indexAt(session.startMs); if (c < 0) c = 0; RP.cursor = Math.max(0, Math.min(RP.series.length - 1, c)); }
      else RP.cursor = Math.max(0, Math.min(RP.series.length - 1, session.cursor));
      RP.sim = session.sim ? E.Simulator.fromSnapshot(RP.spec, session.sim) : new E.Simulator(RP.spec, { balance: session.balance });
      RP.sim.setBar(RP.series.base[RP.cursor], RP.cursor);
      buildWorkspace(); RP.chart.setDrawings(session.drawings || []);
      $('rp-setup').hidden = true; $('rp-work').hidden = false;
      $('rp-title').textContent = session.name; $('rp-res').textContent = data.note + (data.cached ? ' · cached' : '');
      refresh(true); RP.chart.scrollToEnd(); if (RP.htf) RP.htf.scrollToEnd();
      RP.tradesRendered = -1; renderTrades(); renderStats();
      saveSession();
    } catch (err) { console.error(err); toast(err.message || String(err), 'error'); }
    btn.disabled = false; prog.textContent = '';
  }
  function leaveWorkspace() {
    pause(); saveSession(); if (RP.chart) { RP.chart.destroy(); RP.chart = null; } if (RP.htf) { RP.htf.destroy(); RP.htf = null; }
    $('rp-work').hidden = true; $('rp-setup').hidden = false; renderSessionList();
  }

  // ---- workspace -----------------------------------------------------------------
  function buildWorkspace() {
    if (RP.chart) RP.chart.destroy(); if (RP.htf) RP.htf.destroy();
    const theme = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    const opts = { tz: RP.tz, decimals: RP.spec.decimals, tick: RP.spec.tick, symbol: RP.spec.symbol, theme, sessions: { ny: $('rp-sess-ny').checked, ldn: $('rp-sess-ldn').checked } };
    RP.chart = new window.ReplayChart($('rp-chart-main'), opts);
    RP.chart.onLineDrag = onLineDrag; RP.chart.onDrawingsChange = (d) => { RP.session.drawings = d; markDirty(); };
    RP.chart.onSelect = (i) => { $('rp-tool-del').disabled = i == null; };
    RP.htf = new window.ReplayChart($('rp-chart-htf'), opts); RP.htf.onLineDrag = onLineDrag;
    // timeframe buttons
    const tfs = RP.series.availableTimeframes();
    $('rp-tfs').innerHTML = tfs.map((tf) => '<button type="button" class="rp-tf' + (tf === RP.tf ? ' is-on' : '') + '" data-tf="' + tf + '">' + tf + '</button>').join('');
    $('rp-htf-tf').innerHTML = tfs.map((tf) => '<option value="' + tf + '"' + (tf === RP.htfTf ? ' selected' : '') + '>' + tf + '</option>').join('');
    $('rp-chart-htf').hidden = !$('rp-split').checked; $('rp-charts').classList.toggle('is-split', $('rp-split').checked);
    $('rp-speed').innerHTML = SPEEDS.map((s, i) => '<option value="' + i + '"' + (i === RP.speedIdx ? ' selected' : '') + '>' + s + ' bar' + (s > 1 ? 's' : '') + '/s</option>').join('');
    setTool('none');
  }
  function views() {
    const main = RP.series.view(RP.tf, RP.cursor); RP.chart.setView(main, true);
    if (RP.htf && !$('rp-chart-htf').hidden) RP.htf.setView(RP.series.view(RP.htfTf, RP.cursor), true);
  }
  function refresh(full) {
    views(); syncLines(); syncMarkers(); renderAccount(); renderPositions(); renderCursor();
    if (RP.sim.trades.length !== RP.tradesRendered) { renderTrades(); renderStats(); renderEquity(); }
    if (full) renderLog();
    if ($('rp-type').value === 'market') $('rp-price').value = RP.chart.fmt(RP.sim.price());
    updateTicketMath();
  }
  function markDirty() { RP.dirty = true; }

  // ---- playback ----------------------------------------------------------------------
  function advance(n) {
    const base = RP.series.base; let moved = 0;
    for (let k = 0; k < n; k++) {
      if (RP.cursor >= base.length - 1) { pause(); toast('End of the loaded data — start a new session to continue from here.', 'info'); break; }
      RP.cursor++; RP.sim.onBar(base[RP.cursor], RP.cursor); moved++;
    }
    if (moved) { RP.stepsSinceSave += moved; refresh(); if (RP.stepsSinceSave >= 120) saveSession(); }
  }
  function play() { if (RP.playing) return; RP.playing = true; $('rp-play').classList.add('is-on'); $('rp-play').innerHTML = ICON_PAUSE; schedule(); }
  function schedule() { clearInterval(RP.timer); RP.timer = setInterval(() => advance(1), Math.max(16, 1000 / SPEEDS[RP.speedIdx])); }
  function pause() { if (!RP.playing) return; RP.playing = false; clearInterval(RP.timer); RP.timer = null; $('rp-play').classList.remove('is-on'); $('rp-play').innerHTML = ICON_PLAY; saveSession(); }
  function setSpeed(i) { RP.speedIdx = Math.max(0, Math.min(SPEEDS.length - 1, i)); $('rp-speed').value = String(RP.speedIdx); if (RP.playing) schedule(); }
  function jumpTo(pred, cap) {
    pause(); const base = RP.series.base; let steps = 0;
    while (RP.cursor < base.length - 1 && steps < (cap || 20000)) { RP.cursor++; RP.sim.onBar(base[RP.cursor], RP.cursor); steps++; if (pred(base[RP.cursor], base[RP.cursor - 1])) break; }
    RP.stepsSinceSave += steps; refresh(); saveSession();
    if (RP.cursor >= base.length - 1) toast('Reached the end of the loaded data.', 'info');
  }
  const nyParts = (t) => { const f = nyParts.f || (nyParts.f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hour12: false, weekday: 'short', day: 'numeric' })); const o = {}; for (const p of f.formatToParts(new Date(t))) o[p.type] = p.value; return { min: (Number(o.hour) % 24) * 60 + Number(o.minute), wd: o.weekday, day: o.day }; };
  function jumpNextNyOpen() { jumpTo((b, prev) => { const p = nyParts(b.t), q = nyParts(prev.t); return p.min >= 570 && q.min < 570 && p.wd !== 'Sat' && p.wd !== 'Sun'; }); }
  function jumpNextDay() { jumpTo((b, prev) => nyParts(b.t).day !== nyParts(prev.t).day); }
  function renderCursor() {
    const b = RP.series.base[RP.cursor]; const f = new Intl.DateTimeFormat('en-US', { timeZone: RP.tz, weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
    $('rp-cursor').textContent = f.format(new Date(b.t)) + ' · bar ' + (RP.cursor + 1).toLocaleString() + ' / ' + RP.series.length.toLocaleString();
    $('rp-cursorbar').style.width = (100 * (RP.cursor + 1) / RP.series.length) + '%';
  }

  // ---- lines / markers -----------------------------------------------------------------
  function syncLines() {
    const lines = []; const sim = RP.sim; const fmt = (p) => RP.chart.fmt(p);
    for (const p of sim.positions) {
      const pnl = sim.openPnl(p); const lab = (p.side === 'buy' ? 'LONG ' : 'SHORT ') + p.size + ' @ ' + fmt(p.entry) + '  ' + money(pnl, true);
      lines.push({ id: 'e' + p.id, price: p.entry, color: p.side === 'buy' ? '#03c988' : '#e5484d', label: lab, kind: 'entry' });
      if (p.sl != null) lines.push({ id: 's' + p.id, price: p.sl, color: '#e5484d', dash: [6, 4], label: 'SL ' + money(-Math.abs(p.entry - p.sl) * p.size * RP.spec.pointValue), draggable: true, kind: 'sl', pos: p });
      if (p.tp != null) lines.push({ id: 't' + p.id, price: p.tp, color: '#03c988', dash: [6, 4], label: 'TP ' + money(Math.abs(p.tp - p.entry) * p.size * RP.spec.pointValue, true), draggable: true, kind: 'tp', pos: p });
    }
    for (const o of sim.pending) {
      lines.push({ id: 'o' + o.id, price: o.price, color: '#f5c542', dash: [3, 3], label: (o.side === 'buy' ? 'BUY ' : 'SELL ') + o.type.toUpperCase() + ' ' + o.size, draggable: true, kind: 'order', order: o });
      if (o.sl != null) lines.push({ id: 'os' + o.id, price: o.sl, color: 'rgba(229,72,77,0.6)', dash: [2, 4], kind: 'osl', order: o, draggable: true });
      if (o.tp != null) lines.push({ id: 'ot' + o.id, price: o.tp, color: 'rgba(3,201,136,0.6)', dash: [2, 4], kind: 'otp', order: o, draggable: true });
    }
    // ticket preview lines while typing
    const t = ticketValues();
    if (t.sl > 0) lines.push({ id: 'psl', price: t.sl, color: 'rgba(229,72,77,0.45)', dash: [1, 3], kind: 'preview' });
    if (t.tp > 0) lines.push({ id: 'ptp', price: t.tp, color: 'rgba(3,201,136,0.45)', dash: [1, 3], kind: 'preview' });
    if (t.type !== 'market' && t.price > 0) lines.push({ id: 'pp', price: t.price, color: 'rgba(245,197,66,0.5)', dash: [1, 3], kind: 'preview' });
    RP.chart.setLines(lines); if (RP.htf) RP.htf.setLines(lines);
  }
  function onLineDrag(line, price) {
    try {
      if (line.kind === 'sl') RP.sim.modifyPosition(line.pos.id, { sl: price });
      else if (line.kind === 'tp') RP.sim.modifyPosition(line.pos.id, { tp: price });
      else if (line.kind === 'order') RP.sim.modifyOrder(line.order.id, { price });
      else if (line.kind === 'osl') RP.sim.modifyOrder(line.order.id, { sl: price });
      else if (line.kind === 'otp') RP.sim.modifyOrder(line.order.id, { tp: price });
      markDirty();
    } catch (err) { toast(err.message, 'error'); }
    refresh();
  }
  function syncMarkers() {
    const m = [];
    for (const t of RP.sim.trades) { m.push({ t: t.entryT, price: t.entry, side: t.side, kind: 'entry' }); m.push({ t: t.exitT, price: t.exit, side: t.side, kind: 'exit', from: { t: t.entryT, price: t.entry }, pnl: t.pnl, color: t.pnl >= 0 ? '#03c988' : '#e5484d', label: money(t.pnl, true) }); }
    for (const p of RP.sim.positions) m.push({ t: p.entryT, price: p.entry, side: p.side, kind: 'entry' });
    RP.chart.setMarkers(m); if (RP.htf) RP.htf.setMarkers(m);
  }

  // ---- ticket ------------------------------------------------------------------------
  function ticketValues() {
    return { side: RP.side, type: $('rp-type').value, price: Number($('rp-price').value), size: Number($('rp-size').value), sl: Number($('rp-sl').value), tp: Number($('rp-tp').value), riskPct: Number($('rp-risk').value) };
  }
  function updateTicketMath() {
    const t = ticketValues(); const ref = t.type === 'market' ? RP.sim.price() : t.price; const pv = RP.spec.pointValue;
    const risk = t.sl > 0 && t.size > 0 ? Math.abs(ref - t.sl) * t.size * pv : 0; const reward = t.tp > 0 && t.size > 0 ? Math.abs(t.tp - ref) * t.size * pv : 0;
    $('rp-math').innerHTML = (risk ? 'Risk <b class="down">' + money(risk) + '</b> (' + (100 * risk / RP.sim.balance).toFixed(2) + '%)' : 'Set a stop to see risk') + (reward ? ' · Reward <b class="up">' + money(reward) + '</b>' : '') + (risk && reward ? ' · <b>' + (reward / risk).toFixed(2) + 'R</b>' : '');
    $('rp-submit').textContent = (t.side === 'buy' ? 'Buy ' : 'Sell ') + (t.type === 'market' ? 'market' : t.type) + (t.size ? ' · ' + t.size + ' ' + (RP.spec.unit || '') : '');
    $('rp-submit').className = 'btn rp-submit ' + (t.side === 'buy' ? 'is-buy' : 'is-sell');
  }
  function sizeFromRisk() {
    const t = ticketValues(); const ref = t.type === 'market' ? RP.sim.price() : t.price;
    if (!(t.sl > 0)) { toast('Enter a stop-loss first', 'error'); return; }
    const size = E.riskSize({ balance: RP.sim.balance, riskPct: t.riskPct || 1, entry: ref, sl: t.sl, pointValue: RP.spec.pointValue, lotStep: RP.spec.lotStep });
    if (!size) { toast('Stop is too close for that risk budget', 'error'); return; }
    $('rp-size').value = size; updateTicketMath(); syncLines();
  }
  function quickStop(kind) { // fill SL/TP from ticks or R
    const t = ticketValues(); const ref = t.type === 'market' ? RP.sim.price() : t.price; const dir = t.side === 'buy' ? 1 : -1; const tick = RP.spec.tick;
    if (kind === 'sl') { const n = Number(prompt('Stop distance in ticks (1 tick = ' + tick + ')', '40')); if (n > 0) $('rp-sl').value = RP.chart.fmt(ref - dir * n * tick); }
    else { const sl = t.sl; if (!(sl > 0)) { toast('Set the stop first, then the target as an R multiple', 'error'); return; } const r = Number(prompt('Target as a multiple of risk (R)', '2')); if (r > 0) $('rp-tp').value = RP.chart.fmt(ref + (ref - sl) * r); }
    updateTicketMath(); syncLines();
  }
  function submitTicket() {
    const t = ticketValues();
    try {
      const r = RP.sim.submit({ side: t.side, type: t.type, price: t.price, size: t.size, sl: t.sl > 0 ? t.sl : null, tp: t.tp > 0 ? t.tp : null });
      toast(t.type === 'market' ? ('Filled ' + t.side + ' ' + t.size + ' @ ' + RP.chart.fmt(r.entry)) : ('Order placed @ ' + RP.chart.fmt(r.price)), 'success');
      $('rp-sl').value = ''; $('rp-tp').value = ''; $('rp-err').textContent = ''; markDirty(); refresh(); saveSession();
    } catch (err) { $('rp-err').textContent = err.message; }
  }

  // ---- panels ------------------------------------------------------------------------
  function renderAccount() {
    const s = RP.sim; const eq = s.equityValue(); const open = eq - s.balance; const net = s.balance - s.startBalance;
    $('rp-acc-balance').textContent = money(s.balance); $('rp-acc-equity').textContent = money(eq);
    const o = $('rp-acc-open'); o.textContent = money(open, true); o.className = 'rp-acc-val ' + (open > 0 ? 'up' : open < 0 ? 'down' : '');
    const n = $('rp-acc-net'); n.textContent = money(net, true) + ' (' + (100 * net / s.startBalance).toFixed(2) + '%)'; n.className = 'rp-acc-val ' + (net > 0 ? 'up' : net < 0 ? 'down' : '');
  }
  function renderPositions() {
    const s = RP.sim; const fmt = (p) => RP.chart.fmt(p); const el = $('rp-positions');
    if (!s.positions.length && !s.pending.length) { el.innerHTML = '<p class="rp-empty">No open positions. Place an order to begin.</p>'; return; }
    let html = '';
    for (const p of s.positions) {
      const pnl = s.openPnl(p);
      html += '<div class="rp-pos ' + p.side + '" data-pos="' + p.id + '"><div class="rp-pos-head"><b>' + (p.side === 'buy' ? 'LONG' : 'SHORT') + ' ' + p.size + '</b><span>@ ' + fmt(p.entry) + '</span><span class="rp-pos-pnl ' + (pnl >= 0 ? 'up' : 'down') + '">' + money(pnl, true) + '</span></div>' +
        '<div class="rp-pos-row"><label>SL <input type="number" step="' + RP.spec.tick + '" value="' + (p.sl != null ? fmt(p.sl) : '') + '" data-field="sl" placeholder="—"></label><label>TP <input type="number" step="' + RP.spec.tick + '" value="' + (p.tp != null ? fmt(p.tp) : '') + '" data-field="tp" placeholder="—"></label>' +
        '<button type="button" class="btn btn-secondary btn-sm" data-be title="Move stop to entry">BE</button><button type="button" class="btn btn-secondary btn-sm" data-half title="Close half">½</button><button type="button" class="btn btn-sm rp-close" data-close>Close</button></div></div>';
    }
    for (const o of s.pending) {
      html += '<div class="rp-pos pending" data-order="' + o.id + '"><div class="rp-pos-head"><b>' + o.side.toUpperCase() + ' ' + o.type.toUpperCase() + ' ' + o.size + '</b><span>@ ' + fmt(o.price) + '</span><span class="rp-pos-pnl">' + (o.sl != null ? 'SL ' + fmt(o.sl) : '') + (o.tp != null ? ' · TP ' + fmt(o.tp) : '') + '</span></div>' +
        '<div class="rp-pos-row"><span class="rp-empty">Waiting for price to reach ' + fmt(o.price) + '</span><button type="button" class="btn btn-secondary btn-sm" data-cancel>Cancel</button></div></div>';
    }
    el.innerHTML = html;
  }
  function onPositionsClick(e) {
    const posEl = e.target.closest('[data-pos]'); const ordEl = e.target.closest('[data-order]');
    try {
      if (posEl) {
        const id = Number(posEl.dataset.pos); const p = RP.sim.positions.find((x) => x.id === id); if (!p) return;
        if (e.target.closest('[data-close]')) RP.sim.close(id);
        else if (e.target.closest('[data-half]')) RP.sim.close(id, p.size / 2);
        else if (e.target.closest('[data-be]')) RP.sim.modifyPosition(id, { sl: p.entry });
        else return;
      } else if (ordEl && e.target.closest('[data-cancel]')) RP.sim.cancel(Number(ordEl.dataset.order));
      else return;
      markDirty(); refresh(); saveSession();
    } catch (err) { toast(err.message, 'error'); }
  }
  function onPositionsChange(e) {
    const inp = e.target.closest('input[data-field]'); const posEl = e.target.closest('[data-pos]'); if (!inp || !posEl) return;
    try { RP.sim.modifyPosition(Number(posEl.dataset.pos), { [inp.dataset.field]: inp.value === '' ? null : Number(inp.value) }); markDirty(); refresh(); }
    catch (err) { toast(err.message, 'error'); renderPositions(); }
  }
  function renderTrades() {
    RP.tradesRendered = RP.sim.trades.length; const el = $('rp-trades'); const fmt = (p) => RP.chart.fmt(p);
    if (!RP.sim.trades.length) { el.innerHTML = '<p class="rp-empty">Closed trades will appear here.</p>'; return; }
    const f = new Intl.DateTimeFormat('en-US', { timeZone: RP.tz, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
    el.innerHTML = '<table class="rp-table"><thead><tr><th>#</th><th>Side</th><th>Size</th><th>Entry</th><th>Exit</th><th>P&amp;L</th><th>R</th><th>Exit by</th><th>MFE / MAE</th><th>Bars</th></tr></thead><tbody>' +
      RP.sim.trades.slice().reverse().map((t, i, arr) => '<tr><td>' + (arr.length - i) + '</td><td class="' + (t.side === 'buy' ? 'up' : 'down') + '">' + (t.side === 'buy' ? 'Long' : 'Short') + '</td><td>' + t.size + '</td><td>' + fmt(t.entry) + '<small>' + f.format(new Date(t.entryT)) + '</small></td><td>' + fmt(t.exit) + '<small>' + f.format(new Date(t.exitT)) + '</small></td><td class="' + (t.pnl >= 0 ? 'up' : 'down') + '"><b>' + money(t.pnl, true) + '</b></td><td>' + (t.r != null ? t.r.toFixed(2) + 'R' : '—') + '</td><td>' + ({ sl: 'Stop', tp: 'Target', manual: 'Manual' }[t.reason] || t.reason) + '</td><td>' + money(t.mfe) + ' / ' + money(-t.mae) + '</td><td>' + t.bars + '</td></tr>').join('') + '</tbody></table>';
  }
  function renderStats() {
    const s = E.stats(RP.sim.trades, RP.sim.equity, RP.sim.startBalance); RP.session && (RP.session.summary = { net: s.net, count: s.count, winRate: s.winRate, pf: s.profitFactor === Infinity ? null : s.profitFactor, maxDD: s.maxDD });
    const pf = s.profitFactor == null ? '—' : s.profitFactor === Infinity ? '∞' : s.profitFactor.toFixed(2);
    const tile = (l, v, cls) => '<div class="rp-stat"><span>' + l + '</span><b class="' + (cls || '') + '">' + v + '</b></div>';
    $('rp-stats').innerHTML = tile('Net P&L', money(s.net, true), s.net > 0 ? 'up' : s.net < 0 ? 'down' : '') + tile('Return', (s.returnPct >= 0 ? '+' : '') + s.returnPct + '%', s.returnPct > 0 ? 'up' : s.returnPct < 0 ? 'down' : '') + tile('Trades', s.count + ' <small>(' + s.longs + 'L / ' + s.shorts + 'S)</small>') + tile('Win rate', s.winRate + '%') + tile('Profit factor', pf) + tile('Expectancy', money(s.expectancy, true) + ' / trade') + tile('Avg R', s.avgR != null ? s.avgR.toFixed(2) + 'R' : '—') + tile('Avg win / loss', money(s.avgWin) + ' / ' + money(s.avgLoss)) + tile('Max drawdown', money(-s.maxDD) + ' <small>(' + s.maxDDPct + '%)</small>', s.maxDD > 0 ? 'down' : '') + tile('Best / worst', money(s.best, true) + ' / ' + money(s.worst, true)) + tile('Streaks', s.maxWinStreak + ' wins · ' + s.maxLossStreak + ' losses') + tile('Fees paid', money(s.fees)) + tile('Long / short P&L', money(s.longNet, true) + ' / ' + money(s.shortNet, true)) + tile('Avg bars held', s.avgBars);
  }
  function renderEquity() {
    const c = $('rp-eq'); const ctx = c.getContext('2d'); const d = window.devicePixelRatio || 1;
    const w = c.clientWidth || 600, h = c.clientHeight || 160; c.width = w * d; c.height = h * d; ctx.setTransform(d, 0, 0, d, 0, 0); ctx.clearRect(0, 0, w, h);
    const pts = RP.sim.equity; if (pts.length < 2) { ctx.fillStyle = '#8b93a0'; ctx.font = '12px sans-serif'; ctx.fillText('The equity curve draws as you step through bars.', 12, 24); return; }
    const step = Math.max(1, Math.floor(pts.length / 1200)); const sample = []; for (let i = 0; i < pts.length; i += step) sample.push(pts[i]); if (sample[sample.length - 1] !== pts[pts.length - 1]) sample.push(pts[pts.length - 1]);
    let mn = Infinity, mx = -Infinity; for (const p of sample) { if (p.equity < mn) mn = p.equity; if (p.equity > mx) mx = p.equity; } const base = RP.sim.startBalance; mn = Math.min(mn, base); mx = Math.max(mx, base); const pad = (mx - mn || 1) * 0.1; mn -= pad; mx += pad;
    const x = (i) => 8 + i / (sample.length - 1) * (w - 16), y = (v) => 8 + (mx - v) / (mx - mn) * (h - 16);
    ctx.strokeStyle = 'rgba(139,147,160,0.4)'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(8, y(base)); ctx.lineTo(w - 8, y(base)); ctx.stroke(); ctx.setLineDash([]);
    const last = sample[sample.length - 1].equity; const col = last >= base ? '#03c988' : '#e5484d';
    ctx.beginPath(); sample.forEach((p, i) => { i ? ctx.lineTo(x(i), y(p.equity)) : ctx.moveTo(x(i), y(p.equity)); }); ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.lineTo(x(sample.length - 1), h - 8); ctx.lineTo(8, h - 8); ctx.closePath(); ctx.fillStyle = last >= base ? 'rgba(3,201,136,0.12)' : 'rgba(229,72,77,0.12)'; ctx.fill();
    ctx.fillStyle = '#8b93a0'; ctx.font = '11px JetBrains Mono, monospace'; ctx.fillText(money(mx + pad), 10, 18); ctx.fillText(money(mn - pad), 10, h - 12);
  }
  function renderLog() {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: RP.tz, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
    $('rp-log').innerHTML = RP.sim.log.slice(-80).reverse().map((l) => '<div><span>' + f.format(new Date(l.t)) + '</span>' + esc(l.msg) + '</div>').join('') || '<p class="rp-empty">Fills, stops and targets are logged here.</p>';
  }
  function exportCsv() {
    const rows = [['#', 'symbol', 'side', 'size', 'entry_time_utc', 'entry', 'exit_time_utc', 'exit', 'gross', 'fees', 'pnl', 'r', 'reason', 'mfe', 'mae', 'bars']];
    RP.sim.trades.forEach((t, i) => rows.push([i + 1, RP.spec.symbol, t.side, t.size, new Date(t.entryT).toISOString(), t.entry, new Date(t.exitT).toISOString(), t.exit, t.gross, t.fees, t.pnl, t.r == null ? '' : t.r, t.reason, t.mfe, t.mae, t.bars]));
    const blob = new Blob([rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = (RP.session.name || 'replay').replace(/[^\w.-]+/g, '_') + '-trades.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // ---- persistence -----------------------------------------------------------------------
  let saveTimer = null;
  function saveSession() {
    if (!RP.session || !RP.sim) return; RP.stepsSinceSave = 0;
    const s = RP.session; s.tf = RP.tf; s.htfTf = RP.htfTf; s.cursor = RP.cursor; s.sim = RP.sim.snapshot(); s.drawings = RP.chart ? RP.chart.getDrawings() : s.drawings; s.updatedAt = Date.now(); s.tz = RP.tz;
    D.store.putSession(s);
    clearTimeout(saveTimer); saveTimer = setTimeout(() => cloudSave(s), 1500);
  }
  function cloudSave(s) {
    if (!RP.uid || typeof db === 'undefined' || !db) return;
    const doc = { name: s.name, symbolId: s.symbolId, symbolLabel: s.symbolLabel, startMs: s.startMs, endMs: s.endMs, cursor: s.cursor, total: s.total, tf: s.tf, summary: s.summary || null, balance: s.sim.balance, startBalance: s.sim.startBalance, trades: s.sim.trades.slice(-300), updatedAt: Date.now() };
    db.collection('students').doc(RP.uid).collection('replay').doc(s.id).set(doc, { merge: true }).catch((e) => { if (!cloudSave.warned) { cloudSave.warned = true; console.warn('replay cloud save unavailable:', e && e.message); } });
  }

  // ---- tools / options --------------------------------------------------------------------------
  function setTool(tool) { RP.chart.setTool(tool); document.querySelectorAll('#rp-tools [data-tool]').forEach((b) => b.classList.toggle('is-on', b.dataset.tool === tool)); }
  function setTf(tf) { RP.tf = tf; document.querySelectorAll('#rp-tfs .rp-tf').forEach((b) => b.classList.toggle('is-on', b.dataset.tf === tf)); RP.chart.scrollToEnd(); refresh(); markDirty(); }

  // ---- boot ----------------------------------------------------------------------------------
  function wire() {
    fillSymbols(); defaultDates(); updateDataNote(); refreshCsvList(); renderSessionList();
    $('rp-symbol').addEventListener('change', updateDataNote); $('rp-start').addEventListener('change', updateDataNote); $('rp-days').addEventListener('change', updateDataNote);
    $('rp-csv-file').addEventListener('change', onCsvFile);
    $('rp-start-btn').addEventListener('click', startNew);
    $('rp-session-list').addEventListener('click', async (e) => { const card = e.target.closest('.rp-sess'); if (!card) return; if (e.target.closest('[data-resume]')) resumeSession(card.dataset.id); else if (e.target.closest('[data-del]')) { if (confirm('Delete this saved session?')) { await D.store.deleteSession(card.dataset.id); renderSessionList(); } } });
    $('rp-back').addEventListener('click', leaveWorkspace);
    $('rp-play').addEventListener('click', () => RP.playing ? pause() : play());
    $('rp-step').addEventListener('click', () => { pause(); advance(1); });
    $('rp-step10').addEventListener('click', () => { pause(); advance(10); });
    $('rp-jumpny').addEventListener('click', jumpNextNyOpen); $('rp-jumpday').addEventListener('click', jumpNextDay);
    $('rp-speed').addEventListener('change', (e) => setSpeed(Number(e.target.value)));
    $('rp-tfs').addEventListener('click', (e) => { const b = e.target.closest('[data-tf]'); if (b) setTf(b.dataset.tf); });
    $('rp-htf-tf').addEventListener('change', (e) => { RP.htfTf = e.target.value; refresh(); markDirty(); });
    $('rp-split').addEventListener('change', (e) => { $('rp-chart-htf').hidden = !e.target.checked; $('rp-charts').classList.toggle('is-split', e.target.checked); setTimeout(() => { RP.chart.resize(); if (RP.htf) { RP.htf.resize(); RP.htf.scrollToEnd(); } refresh(); }, 30); });
    ['rp-sess-ny', 'rp-sess-ldn'].forEach((id) => $(id).addEventListener('change', () => { const o = { sessions: { ny: $('rp-sess-ny').checked, ldn: $('rp-sess-ldn').checked } }; RP.chart.setOptions(o); RP.htf.setOptions(o); }));
    $('rp-tools').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.tool) setTool(b.dataset.tool === RP.chart.tool ? 'none' : b.dataset.tool); else if (b.id === 'rp-tool-del') RP.chart.deleteSelected(); else if (b.id === 'rp-tool-clear') { if (confirm('Remove all drawings?')) RP.chart.clearDrawings(); } });
    document.querySelectorAll('#rp-sidebtns [data-side]').forEach((b) => b.addEventListener('click', () => { RP.side = b.dataset.side; document.querySelectorAll('#rp-sidebtns [data-side]').forEach((x) => x.classList.toggle('is-on', x === b)); updateTicketMath(); }));
    $('rp-type').addEventListener('change', () => { $('rp-price').disabled = $('rp-type').value === 'market'; if ($('rp-type').value === 'market') $('rp-price').value = RP.chart.fmt(RP.sim.price()); updateTicketMath(); syncLines(); });
    ['rp-price', 'rp-size', 'rp-sl', 'rp-tp', 'rp-risk'].forEach((id) => $(id).addEventListener('input', () => { updateTicketMath(); syncLines(); }));
    $('rp-size-risk').addEventListener('click', sizeFromRisk); $('rp-quick-sl').addEventListener('click', () => quickStop('sl')); $('rp-quick-tp').addEventListener('click', () => quickStop('tp'));
    $('rp-submit').addEventListener('click', submitTicket);
    $('rp-closeall').addEventListener('click', () => { if (RP.sim.positions.length && confirm('Close every open position at the current price?')) { RP.sim.closeAll(); markDirty(); refresh(); saveSession(); } });
    $('rp-positions').addEventListener('click', onPositionsClick); $('rp-positions').addEventListener('change', onPositionsChange);
    $('rp-export').addEventListener('click', exportCsv);
    document.querySelectorAll('.rp-tabs button').forEach((b) => b.addEventListener('click', () => { document.querySelectorAll('.rp-tabs button').forEach((x) => x.classList.toggle('is-on', x === b)); document.querySelectorAll('.rp-tabpane').forEach((p) => { p.hidden = p.id !== 'rp-tab-' + b.dataset.tab; }); if (b.dataset.tab === 'equity') renderEquity(); if (b.dataset.tab === 'log') renderLog(); }));
    $('rp-tz-live').addEventListener('change', (e) => { RP.tz = e.target.value; RP.chart.setOptions({ tz: RP.tz }); RP.htf.setOptions({ tz: RP.tz }); renderCursor(); renderTrades(); markDirty(); });
    document.addEventListener('keydown', (e) => {
      if ($('rp-work').hidden) return; const tag = (e.target.tagName || '').toLowerCase(); if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
      if (e.code === 'Space') { e.preventDefault(); RP.playing ? pause() : play(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); pause(); advance(e.shiftKey ? 10 : 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setSpeed(RP.speedIdx + 1); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setSpeed(RP.speedIdx - 1); }
      else if (e.key === 'Escape') setTool('none');
      else if (e.key === 'Delete' || e.key === 'Backspace') { if (RP.chart.deleteSelected()) e.preventDefault(); }
      else if (e.key === '=' || e.key === '+') RP.chart.zoom(1.2); else if (e.key === '-') RP.chart.zoom(1 / 1.2);
    });
    window.addEventListener('beforeunload', () => { if (RP.session) saveSession(); });
    new MutationObserver(() => { const theme = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'; if (RP.chart) RP.chart.setOptions({ theme }); if (RP.htf) RP.htf.setOptions({ theme }); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }
  const ICON_PLAY = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4l13 8-13 8z"/></svg>';
  const ICON_PAUSE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>';

  function planNameForRank(minRank) { const plans = (typeof getCachedPlansForRoles === 'function') ? getCachedPlansForRoles() : []; const m = plans.find((p) => (p.rank ?? 0) >= minRank); return m ? m.name : null; }
  function showLocked() {
    $('rp-app').style.display = 'none'; const locked = $('rp-locked'); const name = planNameForRank(RP_MIN_RANK); const btn = $('rp-locked-btn');
    if (btn) { btn.textContent = name ? 'Go ' + name + ' to unlock' : 'Upgrade to unlock'; btn.dataset.upgradeReason = (name ? name + ' members' : 'Members') + ' can backtest any market bar by bar with simulated orders, stops and targets.'; }
    locked.style.display = '';
  }
  function showApp() { $('rp-locked').style.display = 'none'; $('rp-app').style.display = ''; wire(); $('rp-play').innerHTML = ICON_PLAY; }

  document.addEventListener('DOMContentLoaded', () => {
    if (typeof auth === 'undefined' || !auth || !$('rp-app')) return;
    let handled = false;
    auth.onAuthStateChanged((user) => {
      if (handled) return;
      if (!user) { setTimeout(() => { if (!handled && typeof goToLoginPreservingReturn === 'function') goToLoginPreservingReturn(); }, 1500); return; }
      handled = true; RP.uid = user.uid;
      const adminCheck = db.collection('admins').doc(user.uid).get().catch(() => null);
      const studentCheck = db.collection('students').doc(user.uid).get().catch(() => null);
      const rolesCheck = (typeof loadPlansForRoles === 'function') ? loadPlansForRoles() : Promise.resolve();
      Promise.all([adminCheck, studentCheck, rolesCheck]).then(([adminDoc, studentDoc]) => {
        if (adminDoc && adminDoc.exists) return true;
        const plan = (studentDoc && studentDoc.exists) ? studentDoc.data().plan : null;
        if (!plan || typeof rankOf !== 'function' || typeof findPlan !== 'function' || !findPlan(plan)) return true;   // unresolvable plan fails open, like every other gate
        return rankOf(plan) >= RP_MIN_RANK;
      }).catch(() => true).then((allowed) => { if (allowed) showApp(); else showLocked(); });
    });
  });
})();
