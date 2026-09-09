/**
 * Stryker Trading Academy — Backtest replay page controller
 *
 * FX-Replay-style bar-by-bar backtesting on a TradingView Lightweight Charts
 * canvas: pick a market and a start date, the chart shows history up to that
 * moment and nothing after it, then step or play forward while trading with
 * simulated orders. Everything updates per bar: positions, stop and target
 * lines (draggable), account, equity curve, statistics, coach.
 *
 * Pieces: replay-engine.js (simulation), replay-chart.js (chart), replay-data.js
 * (candles + IndexedDB), replay-indicators.js (built-in indicators),
 * replay-coach.js (rule-based coach). Gate: Pro and above (RP_MIN_RANK).
 * Sessions autosave to IndexedDB and, best-effort, to students/{uid}/replay.
 */
(function () {
  'use strict';
  const E = window.ReplayEngine, D = window.ReplayData, IND = window.ReplayIndicators, COACH = window.ReplayCoach;
  const RP_MIN_RANK = 1;
  const SPEEDS = [1, 2, 4, 8, 15, 30];
  const LWC_URL = 'https://cdn.jsdelivr.net/npm/lightweight-charts@5.2.1/dist/lightweight-charts.standalone.production.js';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n, sign) => { const v = Number(n) || 0; return (v < 0 ? '-' : (sign && v > 0 ? '+' : '')) + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  const toast = (m, kind) => { if (typeof showToast === 'function') showToast(m, kind); else console.log(kind || 'info', m); };
  const pref = (k, d) => { try { const v = localStorage.getItem('stryker_replay_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const setPref = (k, v) => { try { localStorage.setItem('stryker_replay_' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } };

  const RP = window.__RP = { uid: null, spec: null, series: null, sim: null, cursor: 0, tf: '5m', htfTf: '1h', chart: null, htf: null, playing: false, timer: null, speedIdx: 2, session: null, side: 'buy', tz: 'America/New_York', tradesRendered: -1, stepsSinceSave: 0, nextTags: [], pendingSubmit: null, snapQueue: [] };

  // ---- setup screen ---------------------------------------------------------------
  function fillSymbols() {
    const sel = $('rp-symbol'); const groups = {};
    for (const s of D.SYMBOLS) (groups[s.group] = groups[s.group] || []).push(s);
    sel.innerHTML = Object.keys(groups).map((g) => '<optgroup label="' + esc(g) + '">' + groups[g].map((s) => '<option value="' + esc(s.id) + '">' + esc(s.label) + '</option>').join('') + '</optgroup>').join('');
    const saved = pref('symbol', null); if (saved && D.findSymbol(saved)) sel.value = saved;
  }
  function defaultDates() { const d = new Date(Date.now() - 10 * 86400000); $('rp-start').value = d.toISOString().slice(0, 10); $('rp-start').max = new Date().toISOString().slice(0, 10); }
  function updateDataNote() {
    const spec = D.findSymbol($('rp-symbol').value); $('rp-csv-wrap').hidden = !spec || spec.src !== 'csv'; if (!spec) return;
    const startMs = Date.parse($('rp-start').value + 'T00:00:00Z'); const days = Number($('rp-days').value); const note = $('rp-datanote');
    if (spec.src === 'binance') note.textContent = 'Binance public data · ' + D.binanceInterval(days) + ' candles for ' + days + ' days. Full history available.';
    else if (spec.src === 'yahoo') { const iv = D.yahooInterval(startMs - 2 * 86400000); note.textContent = 'Yahoo Finance · finest resolution for that start date is ' + iv + (iv === '1m' ? ' (last 30 days only)' : iv === '5m' ? ' (last 60 days only)' : iv === '1h' ? ' (last 2 years)' : ' (daily)') + '. For 1-minute history further back, import a CSV export.'; }
    else note.textContent = 'Your own candles, parsed in this browser. TradingView, MT4 and MT5 exports work (time, open, high, low, close, volume).';
    $('rp-commission').value = spec.commission; $('rp-commission-unit').textContent = 'per ' + (spec.unit || 'unit') + ' per side';
  }
  async function refreshCsvList() { const list = await D.store.listCsv(); const sel = $('rp-csv-list'); sel.innerHTML = list.length ? list.map((c) => '<option value="' + esc(c.name) + '">' + esc(c.name) + ' · ' + c.bars.toLocaleString() + ' bars · ' + esc(c.baseTf) + '</option>').join('') : '<option value="">No files yet — choose one below</option>'; }
  async function onCsvFile(e) {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    try { const parsed = D.parseCsv(await f.text()); await D.store.putCsv({ name: f.name, bars: parsed.bars, baseTf: parsed.baseTf, savedAt: Date.now() }); await refreshCsvList(); $('rp-csv-list').value = f.name; const first = new Date(parsed.bars[0].t).toISOString().slice(0, 10), last = new Date(parsed.bars[parsed.bars.length - 1].t).toISOString().slice(0, 10); $('rp-start').value = first; $('rp-datanote').textContent = 'Loaded ' + parsed.bars.length.toLocaleString() + ' ' + parsed.baseTf + ' candles from ' + first + ' to ' + last + '. ' + parsed.note.replace(/^Your file · [^·]+· ?/, ''); toast('CSV stored in this browser: ' + f.name, 'success'); }
    catch (err) { toast(err.message || String(err), 'error'); }
    e.target.value = '';
  }
  async function renderSessionList() {
    const list = await D.store.listSessions(); const el = $('rp-session-list');
    if (!list.length) { el.innerHTML = '<p class="rp-empty">No saved sessions yet. Start one above — progress saves automatically.</p>'; return; }
    el.innerHTML = list.map((s) => { const st = s.summary || {}; const pct = s.total ? Math.round(100 * (s.cursor + 1) / s.total) : 0; return '<div class="rp-sess" data-id="' + esc(s.id) + '"><div class="rp-sess-main"><b>' + esc(s.name || s.symbolId) + '</b><span>' + esc(s.symbolLabel || s.symbolId) + ' · ' + esc(s.tf || '') + ' · from ' + new Date(s.startMs).toISOString().slice(0, 10) + ' · ' + pct + '% replayed</span></div><div class="rp-sess-stats"><span class="' + ((st.net || 0) >= 0 ? 'up' : 'down') + '">' + money(st.net || 0, true) + '</span><span>' + (st.count || 0) + ' trades · ' + (st.winRate || 0) + '% win</span></div><div class="rp-sess-actions"><button type="button" class="btn btn-primary btn-sm" data-resume>Resume</button><button type="button" class="icon-btn" data-del title="Delete"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg></button></div></div>'; }).join('');
  }

  // ---- start / resume -------------------------------------------------------------------
  function loadLwc() { if (window.LightweightCharts) return Promise.resolve(); if (loadLwc.p) return loadLwc.p; loadLwc.p = new Promise((res, rej) => { const s = document.createElement('script'); s.src = LWC_URL; s.onload = res; s.onerror = () => rej(new Error('The chart engine could not be loaded (cdn.jsdelivr.net). Check your connection or ad-blocker and try again.')); document.head.appendChild(s); }); return loadLwc.p; }
  async function startNew() {
    const spec = D.findSymbol($('rp-symbol').value); if (!spec) return;
    const startMs = Date.parse($('rp-start').value + 'T00:00:00Z'); if (!isFinite(startMs)) { toast('Pick a start date', 'error'); return; }
    const days = Number($('rp-days').value) || 14; const balance = Number($('rp-balance').value) || 100000; const csvName = spec.src === 'csv' ? $('rp-csv-list').value : null;
    if (spec.src === 'csv' && !csvName) { toast('Choose a CSV file first', 'error'); return; }
    setPref('symbol', spec.id); setPref('checklistItems', $('rp-checklist-items').value); setPref('checklistOn', $('rp-opt-checklist').checked); setPref('nudgesOn', $('rp-opt-nudges').checked);
    const pbSel = $('rp-playbook'); const pb = pbSel ? findPlaybook(pbSel.value) : null; setPref('playbookId', pb ? pb.id : '');
    const session = { id: 'rp_' + Date.now().toString(36), name: $('rp-name').value.trim() || (spec.label.split(' · ')[0] + ' · ' + $('rp-start').value), symbolId: spec.id, symbolLabel: spec.label, csvName, startMs, endMs: startMs + days * 86400000, loadFrom: startMs - 3 * 86400000, balance, tz: $('rp-tz').value, tf: null, htfTf: null, cursor: null, sim: null, drawings: [], indicators: pref('lastIndicators', [{ id: 'ema', params: { len: 20 } }, { id: 'killzones', params: {} }]),
      settings: { commission: Number($('rp-commission').value) || 0, slippage: Number($('rp-slippage').value) || 0, checklistOn: $('rp-opt-checklist').checked, nudgesOn: $('rp-opt-nudges').checked,
        checklist: pb ? (pb.rules || []).map((r) => r.text) : $('rp-checklist-items').value.split('\n').map((x) => x.trim()).filter(Boolean),
        playbookId: pb ? pb.id : null, playbookName: pb ? pb.name : null,
        // Rule ids in the same order as `checklist`, so a ticked box maps back
        // to a rule id rather than to a line of text that could be reworded.
        checklistRuleIds: pb ? (pb.rules || []).map((r) => r.id) : null },
      createdAt: Date.now(), updatedAt: Date.now() };
    await openSession(session, spec, true);
  }
  async function resumeSession(id) { const s = await D.store.getSession(id); if (!s) { toast('That session is gone', 'error'); return; } const spec = D.findSymbol(s.symbolId); if (!spec) { toast('Unknown market in that session', 'error'); return; } await openSession(s, spec, false); }
  async function openSession(session, spec, fresh) {
    const btn = $('rp-start-btn'); btn.disabled = true; const prog = $('rp-progress'); prog.textContent = 'Loading chart engine…';
    try {
      await loadLwc(); prog.textContent = 'Loading candles…';
      const data = await D.load({ spec, startMs: session.loadFrom, endMs: session.endMs, csvName: session.csvName, onProgress: (p, n) => { prog.textContent = 'Loading candles… ' + Math.round(p * 100) + '%' + (n ? ' (' + n.toLocaleString() + ' bars)' : ''); } });
      const st = session.settings || (session.settings = { commission: spec.commission, slippage: 0, checklistOn: false, nudgesOn: true, checklist: COACH.CHECKLIST });
      RP.spec = Object.assign({}, spec, { commission: st.commission != null ? st.commission : spec.commission, slippage: st.slippage || 0, symbol: session.csvName ? session.csvName.replace(/\.csv$/i, '') : spec.id.replace(/=F|=X/, '').replace(/USDT$/, '/USDT') });
      RP.series = new E.Series(data.bars, data.baseTf); RP.session = session; RP.tz = session.tz || 'America/New_York';
      session.total = RP.series.length; session.dataNote = data.note;
      const tfs = RP.series.availableTimeframes();
      RP.tf = session.tf && tfs.includes(session.tf) ? session.tf : (tfs.includes('5m') ? '5m' : tfs.includes('1h') ? '1h' : tfs[0]);
      RP.htfTf = session.htfTf && tfs.includes(session.htfTf) ? session.htfTf : (tfs.includes('1h') && RP.tf !== '1h' ? '1h' : tfs.includes('4h') ? '4h' : tfs[tfs.length - 1]);
      if (fresh || session.cursor == null) { let c = RP.series.indexAt(session.startMs); if (c < 0) c = 0; RP.cursor = Math.max(0, Math.min(RP.series.length - 1, c)); } else RP.cursor = Math.max(0, Math.min(RP.series.length - 1, session.cursor));
      RP.sim = session.sim ? E.Simulator.fromSnapshot(RP.spec, session.sim) : new E.Simulator(RP.spec, { balance: session.balance }); RP.sim.setBar(RP.series.base[RP.cursor], RP.cursor);
      buildWorkspace(); RP.chart.setDrawings(session.drawings || []);
      for (const ind of (session.indicators || [])) RP.chart.addIndicator(ind.id, ind.params, ind.iid);
      renderObjects();
      closeSetup(); $('rp-home').hidden = true; $('rp-work').hidden = false; $('rp-title').textContent = RP.spec.symbol + ' · ' + session.name; $('rp-res').textContent = data.note + (data.cached ? ' · cached' : '');
      RP.tradesRendered = -1; refresh(true); RP.chart.scrollToEnd(); if (RP.htf) RP.htf.scrollToEnd(); renderTrades(); renderStats(); saveSession();
      history.replaceState(null, '', 'replay.html?session=' + encodeURIComponent(session.id));
    } catch (err) { console.error(err); toast(err.message || String(err), 'error'); }
    btn.disabled = false; prog.textContent = '';
  }
  function leaveWorkspace() { pause(); saveSession(); if (RP.chart) { RP.chart.destroy(); RP.chart = null; } if (RP.htf) { RP.htf.destroy(); RP.htf = null; } $('rp-work').hidden = true; $('rp-home').hidden = false; $('rp-h1').textContent = 'Replay'; $('rp-h1-sub').textContent = 'Bar-by-bar replay with the future hidden.'; history.replaceState(null, '', 'replay.html'); renderSessionList(); }

  // ---- workspace ---------------------------------------------------------------------------
  function buildWorkspace() {
    if (RP.chart) RP.chart.destroy(); if (RP.htf) RP.htf.destroy();
    const theme = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    const opts = { tz: RP.tz, decimals: RP.spec.decimals, tick: RP.spec.tick, symbol: RP.spec.symbol, theme, sessions: { ny: $('rp-sess-ny').checked, ldn: $('rp-sess-ldn').checked } };
    RP.chart = new window.ReplayChart($('rp-chart-main'), opts);
    RP.chart.onLineDrag = onLineDrag; RP.chart.onDrawingsChange = (d) => { RP.session.drawings = d; }; RP.chart.onSelect = (i) => { $('rp-tool-del').disabled = i == null; };
    RP.chart.onIndicatorAction = (iid, act) => { if (act === 'remove') RP.chart.removeIndicator(iid); else if (act === 'toggle') RP.chart.toggleIndicator(iid); else if (act === 'settings') openIndicatorSettings(iid); saveIndicators(); renderObjects(); };
    RP.chart.onLineAction = (line, act) => { try { const before = RP.sim.trades.length; if (act === 'close' && line.pos) RP.sim.close(line.pos.id); else if (act === 'cancel' && line.order) RP.sim.cancel(line.order.id); refresh(); if (RP.sim.trades.length > before) onTradesClosed(RP.sim.trades.slice(before)); saveSession(); } catch (err) { toast(err.message, 'error'); } };
    RP.chart.onContextMenu = openContextMenu;
    const _odc = RP.chart.onDrawingsChange; RP.chart.onDrawingsChange = (d) => { _odc(d); renderObjects(); };
    RP.htf = new window.ReplayChart($('rp-chart-htf'), Object.assign({}, opts, { symbol: RP.spec.symbol + ' HTF' })); RP.htf.onLineDrag = onLineDrag;
    buildStrip();
    const tfs = RP.series.availableTimeframes();
    $('rp-tfs').innerHTML = tfs.map((tf) => '<button type="button" class="rp-tf' + (tf === RP.tf ? ' is-on' : '') + '" data-tf="' + tf + '">' + tf + '</button>').join('');
    $('rp-htf-tf').innerHTML = tfs.map((tf) => '<option value="' + tf + '"' + (tf === RP.htfTf ? ' selected' : '') + '>' + tf + '</option>').join('');
    $('rp-tz-live').value = RP.tz;
    $('rp-chart-htf').hidden = !$('rp-split').checked; $('rp-charts').classList.toggle('is-split', $('rp-split').checked);
    $('rp-speed').innerHTML = SPEEDS.map((s, i) => '<option value="' + i + '"' + (i === RP.speedIdx ? ' selected' : '') + '>' + s + ' bar' + (s > 1 ? 's' : '') + '/s</option>').join('');
    $('rp-unit').textContent = RP.spec.unit || 'units'; $('rp-size').value = RP.spec.lotStep >= 1 ? 1 : RP.spec.lotStep * 10; $('rp-size').step = RP.spec.lotStep;
    renderTagChips(); setTool('none'); $('rp-nudge').hidden = true; renderObjects(); $('rp-h1').textContent = RP.session.name;
    // Say out loud when a session is being graded against a playbook, so the
    // pre-trade checklist is understood as evidence rather than a nag.
    const pbName = (RP.session.settings || {}).playbookName;
    $('rp-h1-sub').textContent = RP.spec.label + ' · ' + (RP.session.dataNote || '') +
      (pbName ? ' · playbook: ' + pbName : '');
  }
  function buildStrip() {
    const el = $('rp-tradebar-strip'); el.innerHTML = '<button type="button" class="rp-sbtn is-sell" id="rp-strip-sell"><small>SELL</small><b>—</b></button><div class="rp-smid"><input type="number" id="rp-strip-size" step="' + RP.spec.lotStep + '" min="0" value="' + ($('rp-size').value || 1) + '" title="Size"><label title="Attach stop (ticks) and target (R) automatically"><input type="checkbox" id="rp-strip-attach" checked> SL <input type="number" id="rp-strip-sl" value="' + pref('stripSl', 40) + '" min="1" title="Stop in ticks"> t · TP <input type="number" id="rp-strip-tp" value="' + pref('stripTp', 2) + '" min="0.1" step="0.1" title="Target as R multiple"> R</label></div><button type="button" class="rp-sbtn is-buy" id="rp-strip-buy"><small>BUY</small><b>—</b></button>';
    $('rp-strip-sell').addEventListener('click', () => stripOrder('sell')); $('rp-strip-buy').addEventListener('click', () => stripOrder('buy'));
    $('rp-strip-size').addEventListener('change', (e) => { $('rp-size').value = e.target.value; updateTicketMath(); });
    $('rp-strip-sl').addEventListener('change', (e) => setPref('stripSl', Number(e.target.value))); $('rp-strip-tp').addEventListener('change', (e) => setPref('stripTp', Number(e.target.value)));
  }
  function updateStrip() { const px = RP.sim.price(); const b = $('rp-strip-buy'), s = $('rp-strip-sell'); if (!b) return; b.querySelector('b').textContent = RP.chart.fmt(px); s.querySelector('b').textContent = RP.chart.fmt(px); }
  function stripOrder(side) {
    const size = Number($('rp-strip-size').value); const px = RP.sim.price(); const dir = side === 'buy' ? 1 : -1; let sl = null, tp = null;
    if ($('rp-strip-attach').checked) { const ticks = Number($('rp-strip-sl').value) || 0, r = Number($('rp-strip-tp').value) || 0; if (ticks > 0) sl = RP.chart.snap(px - dir * ticks * RP.spec.tick); if (sl != null && r > 0) tp = RP.chart.snap(px + dir * ticks * RP.spec.tick * r); }
    placeOrder({ side, type: 'market', size, sl, tp });
  }
  function views() { RP.chart.setView(RP.series.view(RP.tf, RP.cursor)); if (RP.htf && !$('rp-chart-htf').hidden) RP.htf.setView(RP.series.view(RP.htfTf, RP.cursor)); }
  function refresh(full) {
    views(); syncLines(); syncMarkers(); renderAccount(); renderPositions(); renderCursor(); updateStrip();
    if (RP.sim.trades.length !== RP.tradesRendered) { renderTrades(); renderStats(); renderEquity(); }
    if (full) renderLog();
    if ($('rp-type').value === 'market') $('rp-price').value = RP.chart.fmt(RP.sim.price());
    updateTicketMath();
  }

  // ---- playback ------------------------------------------------------------------------------
  function advance(n) {
    const base = RP.series.base; let moved = 0; const before = RP.sim.trades.length;
    for (let k = 0; k < n; k++) { if (RP.cursor >= base.length - 1) { pause(); toast('End of the loaded data — start a new session to continue from here.', 'info'); break; } RP.cursor++; RP.sim.onBar(base[RP.cursor], RP.cursor); moved++; }
    if (moved) { RP.stepsSinceSave += moved; refresh(); if (RP.sim.trades.length > before) onTradesClosed(RP.sim.trades.slice(before)); if (RP.stepsSinceSave >= 120) saveSession(); }
  }
  function play() { if (RP.playing) return; RP.playing = true; $('rp-play').classList.add('is-on'); $('rp-play').innerHTML = ICON_PAUSE; schedule(); }
  function schedule() { clearInterval(RP.timer); RP.timer = setInterval(() => advance(1), Math.max(16, 1000 / SPEEDS[RP.speedIdx])); }
  function pause() { if (!RP.playing) return; RP.playing = false; clearInterval(RP.timer); RP.timer = null; $('rp-play').classList.remove('is-on'); $('rp-play').innerHTML = ICON_PLAY; saveSession(); }
  function setSpeed(i) { RP.speedIdx = Math.max(0, Math.min(SPEEDS.length - 1, i)); $('rp-speed').value = String(RP.speedIdx); if (RP.playing) schedule(); }
  function jumpTo(pred, cap) { pause(); const base = RP.series.base; let steps = 0; const before = RP.sim.trades.length; while (RP.cursor < base.length - 1 && steps < (cap || 20000)) { RP.cursor++; RP.sim.onBar(base[RP.cursor], RP.cursor); steps++; if (pred(base[RP.cursor], base[RP.cursor - 1])) break; } RP.stepsSinceSave += steps; refresh(); if (RP.sim.trades.length > before) onTradesClosed(RP.sim.trades.slice(before)); saveSession(); if (RP.cursor >= base.length - 1) toast('Reached the end of the loaded data.', 'info'); }
  const ny = (t) => COACH.nyMinutes(t);
  function jumpNextNyOpen() { jumpTo((b, prev) => { const p = ny(b.t), q = ny(prev.t); return p.min >= 570 && q.min < 570 && p.wd !== 'Sat' && p.wd !== 'Sun'; }); }
  function jumpNextDay() { jumpTo((b, prev) => new Date(b.t + 0).toISOString().slice(0, 10) !== new Date(prev.t).toISOString().slice(0, 10) && ny(b.t).min >= 0); }
  function renderCursor() { const b = RP.series.base[RP.cursor]; const f = new Intl.DateTimeFormat('en-US', { timeZone: RP.tz, weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }); $('rp-cursor').textContent = f.format(new Date(b.t)) + ' · bar ' + (RP.cursor + 1).toLocaleString() + ' / ' + RP.series.length.toLocaleString(); $('rp-cursorbar').style.width = (100 * (RP.cursor + 1) / RP.series.length) + '%'; }

  // ---- lines / markers ------------------------------------------------------------------------
  function syncLines() {
    const lines = []; const sim = RP.sim; const fmt = (p) => RP.chart.fmt(p); const pv = RP.spec.pointValue;
    for (const p of sim.positions) {
      const pnl = sim.openPnl(p); const risk = p.sl != null ? Math.abs(p.entry - p.sl) * p.size * pv : 0;
      lines.push({ id: 'e' + p.id, price: p.entry, color: p.side === 'buy' ? '#03c988' : '#e5484d', width: 1, label: (p.side === 'buy' ? 'LONG ' : 'SHORT ') + p.size + ' @ ' + fmt(p.entry), kind: 'entry', pos: p, chip: { text: '#' + p.id + ' → ' + money(pnl, true) + ' | ' + p.size, action: 'close' } });
      if (p.sl != null) lines.push({ id: 's' + p.id, price: p.sl, color: '#e5484d', dash: true, label: 'SL  ' + money(-risk), draggable: true, kind: 'sl', pos: p, dragLabel: (np) => 'SL  ' + money(-Math.abs(p.entry - np) * p.size * pv) });
      if (p.tp != null) lines.push({ id: 't' + p.id, price: p.tp, color: '#03c988', dash: true, label: 'TP  ' + money(Math.abs(p.tp - p.entry) * p.size * pv, true) + (risk ? '  ' + (Math.abs(p.tp - p.entry) * p.size * pv / risk).toFixed(1) + 'R' : ''), draggable: true, kind: 'tp', pos: p, dragLabel: (np) => 'TP  ' + money(Math.abs(np - p.entry) * p.size * pv, true) + (risk ? '  ' + (Math.abs(np - p.entry) * p.size * pv / risk).toFixed(1) + 'R' : '') });
    }
    for (const o of sim.pending) {
      lines.push({ id: 'o' + o.id, price: o.price, color: '#f5c542', dash: true, label: (o.side === 'buy' ? 'BUY ' : 'SELL ') + o.type.toUpperCase(), draggable: true, kind: 'order', order: o, chip: { text: '#' + o.id + ' ' + o.side.toUpperCase() + ' ' + o.type + ' | ' + o.size, action: 'cancel' } });
      if (o.sl != null) lines.push({ id: 'os' + o.id, price: o.sl, color: 'rgba(229,72,77,0.7)', dash: true, label: 'SL', kind: 'osl', order: o, draggable: true });
      if (o.tp != null) lines.push({ id: 'ot' + o.id, price: o.tp, color: 'rgba(3,201,136,0.7)', dash: true, label: 'TP', kind: 'otp', order: o, draggable: true });
    }
    const t = ticketValues();
    if (t.sl > 0) lines.push({ id: 'psl', price: t.sl, color: 'rgba(229,72,77,0.5)', dash: true, label: 'SL?', kind: 'preview', axis: false });
    if (t.tp > 0) lines.push({ id: 'ptp', price: t.tp, color: 'rgba(3,201,136,0.5)', dash: true, label: 'TP?', kind: 'preview', axis: false });
    if (t.type !== 'market' && t.price > 0) lines.push({ id: 'pp', price: t.price, color: 'rgba(245,197,66,0.6)', dash: true, label: t.type.toUpperCase() + '?', kind: 'preview', axis: false });
    RP.chart.setLines(lines); if (RP.htf) RP.htf.setLines(lines);
  }
  function onLineDrag(line, price) {
    try { if (line.kind === 'sl') RP.sim.modifyPosition(line.pos.id, { sl: price }); else if (line.kind === 'tp') RP.sim.modifyPosition(line.pos.id, { tp: price }); else if (line.kind === 'order') RP.sim.modifyOrder(line.order.id, { price }); else if (line.kind === 'osl') RP.sim.modifyOrder(line.order.id, { sl: price }); else if (line.kind === 'otp') RP.sim.modifyOrder(line.order.id, { tp: price }); }
    catch (err) { toast(err.message, 'error'); }
    refresh(); saveSession();
  }
  function syncMarkers() {
    const m = [];
    for (const t of RP.sim.trades) { m.push({ t: t.entryT, price: t.entry, side: t.side, kind: 'entry', label: (t.side === 'buy' ? 'L' : 'S') + t.size }); m.push({ t: t.exitT, price: t.exit, side: t.side, kind: 'exit', color: t.pnl >= 0 ? '#03c988' : '#e5484d', label: money(t.pnl, true) }); }
    for (const p of RP.sim.positions) m.push({ t: p.entryT, price: p.entry, side: p.side, kind: 'entry', label: (p.side === 'buy' ? 'L' : 'S') + p.size });
    RP.chart.setMarkers(m); if (RP.htf) RP.htf.setMarkers(m);
  }

  // ---- ticket / orders ---------------------------------------------------------------------------
  function ticketValues() { return { side: RP.side, type: $('rp-type').value, price: Number($('rp-price').value), size: Number($('rp-size').value), sl: Number($('rp-sl').value), tp: Number($('rp-tp').value), riskPct: Number($('rp-risk').value) }; }
  function updateTicketMath() {
    const t = ticketValues(); const ref = t.type === 'market' ? RP.sim.price() : t.price; const pv = RP.spec.pointValue;
    const risk = t.sl > 0 && t.size > 0 ? Math.abs(ref - t.sl) * t.size * pv : 0; const reward = t.tp > 0 && t.size > 0 ? Math.abs(t.tp - ref) * t.size * pv : 0;
    $('rp-math').innerHTML = (risk ? 'Risk <b class="down">' + money(risk) + '</b> (' + (100 * risk / RP.sim.balance).toFixed(2) + '%)' : 'Set a stop to see risk') + (reward ? ' · Reward <b class="up">' + money(reward) + '</b>' : '') + (risk && reward ? ' · <b>' + (reward / risk).toFixed(2) + 'R</b>' : '');
    $('rp-submit').textContent = (t.side === 'buy' ? 'Buy ' : 'Sell ') + (t.type === 'market' ? 'market' : t.type) + (t.size ? ' · ' + t.size + ' ' + (RP.spec.unit || '') : '');
    $('rp-submit').className = 'btn rp-submit ' + (t.side === 'buy' ? 'is-buy' : 'is-sell');
  }
  function sizeFromRisk() { const t = ticketValues(); const ref = t.type === 'market' ? RP.sim.price() : t.price; if (!(t.sl > 0)) { toast('Enter a stop-loss first', 'error'); return; } const size = E.riskSize({ balance: RP.sim.balance, riskPct: t.riskPct || 1, entry: ref, sl: t.sl, pointValue: RP.spec.pointValue, lotStep: RP.spec.lotStep }); if (!size) { toast('Stop is too close for that risk budget', 'error'); return; } $('rp-size').value = size; $('rp-strip-size').value = size; updateTicketMath(); syncLines(); }
  function quickStop(kind) {
    const t = ticketValues(); const ref = t.type === 'market' ? RP.sim.price() : t.price; const dir = t.side === 'buy' ? 1 : -1; const tick = RP.spec.tick;
    if (kind === 'sl') { const n = Number(prompt('Stop distance in ticks (1 tick = ' + tick + ')', pref('stripSl', 40))); if (n > 0) $('rp-sl').value = RP.chart.fmt(ref - dir * n * tick); }
    else { const sl = t.sl; if (!(sl > 0)) { toast('Set the stop first, then the target as an R multiple', 'error'); return; } const r = Number(prompt('Target as a multiple of risk (R)', pref('stripTp', 2))); if (r > 0) $('rp-tp').value = RP.chart.fmt(ref + (ref - sl) * r); }
    updateTicketMath(); syncLines();
  }
  function submitTicket() { const t = ticketValues(); placeOrder({ side: t.side, type: t.type, price: t.price, size: t.size, sl: t.sl > 0 ? t.sl : null, tp: t.tp > 0 ? t.tp : null }); }
  function placeOrder(o) {
    o.tags = RP.nextTags.slice(); const st = RP.session.settings || {};
    if (st.checklistOn && (st.checklist || []).length) { openChecklist(o); return; }
    finalizeOrder(o);
  }
  function finalizeOrder(o) {
    try {
      const r = RP.sim.submit(o); $('rp-err').textContent = '';
      toast(o.type === 'market' ? ('Filled ' + o.side + ' ' + o.size + ' @ ' + RP.chart.fmt(r.entry)) : ('Order placed @ ' + RP.chart.fmt(r.price)), 'success');
      $('rp-sl').value = ''; $('rp-tp').value = ''; refresh(); saveSession();
      if (o.type === 'market') queueSnap(r.id, 'entry');
      if ((RP.session.settings || {}).nudgesOn !== false) { const n = COACH.nudge({ type: 'submit', order: o, cursor: RP.cursor, t: RP.series.base[RP.cursor].t }, { trades: RP.sim.trades }); if (n) showNudge(n); }
    } catch (err) { $('rp-err').textContent = err.message; toast(err.message, 'error'); }
  }
  function openChecklist(o) {
    const items = RP.session.settings.checklist; RP.pendingSubmit = o;
    openModal('<h3>Pre-trade checklist</h3><p class="rp-modal-sub">' + (o.side === 'buy' ? 'Buy' : 'Sell') + ' ' + o.type + ' · ' + o.size + ' ' + esc(RP.spec.unit || '') + (o.sl != null ? ' · SL ' + RP.chart.fmt(o.sl) : ' · <span class="down">no stop</span>') + (o.tp != null ? ' · TP ' + RP.chart.fmt(o.tp) : '') + '</p><div class="rp-checklist">' + items.map((it, i) => '<label><input type="checkbox" data-ci="' + i + '"> ' + esc(it) + '</label>').join('') + '</div><div class="rp-modal-actions"><button type="button" class="btn btn-secondary" data-close>Cancel</button><button type="button" class="btn btn-primary" id="rp-check-go">Place order</button></div>');
    $('rp-check-go').addEventListener('click', () => {
      const boxes = [...document.querySelectorAll('#rp-modal [data-ci]')];
      const done = boxes.filter((b) => b.checked).length;
      const o2 = RP.pendingSubmit; RP.pendingSubmit = null;
      // Which items, not just how many. Against a playbook these map to rule
      // ids, which is what makes per-rule analysis possible later.
      const ruleIds = (RP.session.settings || {}).checklistRuleIds || null;
      const metIdx = boxes.map((b, i) => (b.checked ? i : -1)).filter((i) => i >= 0);
      o2.checklist = {
        done, total: boxes.length,
        metIndexes: metIdx,
        rulesMet: ruleIds ? metIdx.map((i) => ruleIds[i]).filter(Boolean) : null
      };
      closeModal();
      if (done < boxes.length && !confirm('Only ' + done + ' of ' + boxes.length + ' items checked. Place the order anyway?')) return;
      finalizeOrder(o2);
    });
  }
  function renderTagChips() { $('rp-tags').innerHTML = COACH.TAGS.map((t) => '<button type="button" class="rp-chip' + (RP.nextTags.includes(t) ? ' is-on' : '') + '" data-tag="' + esc(t) + '">' + esc(t) + '</button>').join(''); }

  // ---- positions / trades panels ---------------------------------------------------------------------
  function renderAccount() { const s = RP.sim; const eq = s.equityValue(); const open = eq - s.balance; const net = s.balance - s.startBalance; $('rp-bb-balance').textContent = money(s.balance); const br = $('rp-bb-real'); br.textContent = money(net, true); br.className = net > 0 ? 'up' : net < 0 ? 'down' : ''; const bu = $('rp-bb-unreal'); bu.textContent = money(open, true); bu.className = open > 0 ? 'up' : open < 0 ? 'down' : ''; $('rp-acc-balance').textContent = money(s.balance); $('rp-acc-equity').textContent = money(eq); const o = $('rp-acc-open'); o.textContent = money(open, true); o.className = 'rp-acc-val ' + (open > 0 ? 'up' : open < 0 ? 'down' : ''); const n = $('rp-acc-net'); n.textContent = money(net, true) + ' (' + (100 * net / s.startBalance).toFixed(2) + '%)'; n.className = 'rp-acc-val ' + (net > 0 ? 'up' : net < 0 ? 'down' : ''); }
  function renderPositions() {
    const s = RP.sim; const fmt = (p) => RP.chart.fmt(p); const el = $('rp-positions'); $('rp-poscount').textContent = s.positions.length + (s.pending.length ? ' + ' + s.pending.length + ' pending' : '');
    if (!s.positions.length && !s.pending.length) { el.innerHTML = '<p class="rp-empty">Flat. Use the Buy / Sell strip on the chart or the ticket to open a position.</p>'; return; }
    let html = '';
    for (const p of s.positions) { const pnl = s.openPnl(p); const risk = p.sl != null ? Math.abs(p.entry - p.sl) * p.size * RP.spec.pointValue : 0; html += '<div class="rp-pos ' + p.side + '" data-pos="' + p.id + '"><div class="rp-pos-head"><b>' + (p.side === 'buy' ? 'LONG' : 'SHORT') + ' ' + p.size + '</b><span>@ ' + fmt(p.entry) + '</span>' + (p.tags && p.tags.length ? '<span class="rp-pos-tag">' + esc(p.tags.join(', ')) + '</span>' : '') + '<span class="rp-pos-pnl ' + (pnl >= 0 ? 'up' : 'down') + '">' + money(pnl, true) + (risk ? ' <small>' + (pnl / risk).toFixed(2) + 'R</small>' : '') + '</span></div><div class="rp-pos-row"><label>SL <input type="number" step="' + RP.spec.tick + '" value="' + (p.sl != null ? fmt(p.sl) : '') + '" data-field="sl" placeholder="—"></label><label>TP <input type="number" step="' + RP.spec.tick + '" value="' + (p.tp != null ? fmt(p.tp) : '') + '" data-field="tp" placeholder="—"></label><button type="button" class="rp-mini" data-be title="Stop to break-even">BE</button><button type="button" class="rp-mini" data-half title="Close half">½</button><button type="button" class="rp-mini" data-rev title="Reverse">⇄</button><button type="button" class="btn btn-sm rp-close" data-close>Close</button></div></div>'; }
    for (const o of s.pending) html += '<div class="rp-pos pending" data-order="' + o.id + '"><div class="rp-pos-head"><b>' + o.side.toUpperCase() + ' ' + o.type.toUpperCase() + ' ' + o.size + '</b><span>@ ' + fmt(o.price) + '</span><span class="rp-pos-pnl">' + (o.sl != null ? 'SL ' + fmt(o.sl) : '') + (o.tp != null ? ' · TP ' + fmt(o.tp) : '') + '</span></div><div class="rp-pos-row"><span class="rp-empty">Waiting for ' + fmt(o.price) + ' · drag the line to move it</span><button type="button" class="btn btn-secondary btn-sm" data-cancel>Cancel</button></div></div>';
    el.innerHTML = html;
  }
  function onPositionsClick(e) {
    const posEl = e.target.closest('[data-pos]'), ordEl = e.target.closest('[data-order]'); const before = RP.sim.trades.length;
    try {
      if (posEl) { const id = Number(posEl.dataset.pos); const p = RP.sim.positions.find((x) => x.id === id); if (!p) return; if (e.target.closest('[data-close]')) RP.sim.close(id); else if (e.target.closest('[data-half]')) RP.sim.close(id, p.size / 2); else if (e.target.closest('[data-be]')) RP.sim.modifyPosition(id, { sl: p.entry }); else if (e.target.closest('[data-rev]')) RP.sim.reverse(id); else return; }
      else if (ordEl && e.target.closest('[data-cancel]')) RP.sim.cancel(Number(ordEl.dataset.order)); else return;
      refresh(); if (RP.sim.trades.length > before) onTradesClosed(RP.sim.trades.slice(before)); saveSession();
    } catch (err) { toast(err.message, 'error'); }
  }
  function onPositionsChange(e) { const inp = e.target.closest('input[data-field]'), posEl = e.target.closest('[data-pos]'); if (!inp || !posEl) return; try { RP.sim.modifyPosition(Number(posEl.dataset.pos), { [inp.dataset.field]: inp.value === '' ? null : Number(inp.value) }); refresh(); saveSession(); } catch (err) { toast(err.message, 'error'); renderPositions(); } }
  function onTradesClosed(newTrades) {
    for (const t of newTrades) { queueSnap(t.posId, 'exit'); if ((RP.session.settings || {}).nudgesOn !== false) { const n = COACH.nudge({ type: 'close', trade: t }, { trades: RP.sim.trades }); if (n) showNudge(n); } }
    if (!RP.playing && newTrades.length === 1) openTradeEditor(newTrades[0].id, true);
  }
  function renderTrades() {
    RP.tradesRendered = RP.sim.trades.length; const el = $('rp-trades'); const fmt = (p) => RP.chart.fmt(p);
    if (!RP.sim.trades.length) { el.innerHTML = '<p class="rp-empty">Closed trades appear here with tags, notes and snapshots.</p>'; return; }
    const f = new Intl.DateTimeFormat('en-US', { timeZone: RP.tz, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
    el.innerHTML = '<table class="rp-table"><thead><tr><th>#</th><th>Side</th><th>Size</th><th>Entry</th><th>Exit</th><th>P&amp;L</th><th>R</th><th>Exit by</th><th>MFE / MAE</th><th>Bars</th><th>Setup</th><th></th></tr></thead><tbody>' +
      RP.sim.trades.slice().reverse().map((t, i, arr) => '<tr data-trade="' + t.id + '"><td>' + (arr.length - i) + '</td><td class="' + (t.side === 'buy' ? 'up' : 'down') + '">' + (t.side === 'buy' ? 'Long' : 'Short') + '</td><td>' + t.size + '</td><td>' + fmt(t.entry) + '<small>' + f.format(new Date(t.entryT)) + '</small></td><td>' + fmt(t.exit) + '<small>' + f.format(new Date(t.exitT)) + '</small></td><td class="' + (t.pnl >= 0 ? 'up' : 'down') + '"><b>' + money(t.pnl, true) + '</b></td><td>' + (t.r != null ? t.r.toFixed(2) + 'R' : '—') + '</td><td>' + ({ sl: 'Stop', tp: 'Target', manual: 'Manual' }[t.reason] || t.reason) + '</td><td>' + money(t.mfe) + ' / ' + money(-t.mae) + '</td><td>' + t.bars + '</td><td class="rp-td-tags">' + (t.tags || []).map((x) => '<i>' + esc(x) + '</i>').join('') + (t.mistakes && t.mistakes.length ? '<i class="bad">' + t.mistakes.length + ' ✕</i>' : '') + (t.journaled ? '<i class="ok" title="Sent to journal">✓ journal</i>' : '') + '</td><td><button type="button" class="rp-mini" data-edit title="Tags, notes, snapshots">✎</button></td></tr>').join('') + '</tbody></table>';
  }
  async function openTradeEditor(tradeId, fresh) {
    const t = RP.sim.trades.find((x) => x.id === tradeId); if (!t) return;
    const [snapIn, snapOut] = await Promise.all([D.store.getSnap(snapKey(t.posId, 'entry')), D.store.getSnap(snapKey(t.posId, 'exit'))]);
    const chips = (list, sel, attr) => list.map((x) => '<button type="button" class="rp-chip' + (sel.includes(x) ? ' is-on' : '') + '" data-' + attr + '="' + esc(x) + '">' + esc(x) + '</button>').join('');
    openModal('<h3>' + (fresh ? 'Trade closed: ' : 'Trade ') + (t.side === 'buy' ? 'Long' : 'Short') + ' ' + t.size + ' · <span class="' + (t.pnl >= 0 ? 'up' : 'down') + '">' + money(t.pnl, true) + (t.r != null ? ' (' + t.r.toFixed(2) + 'R)' : '') + '</span></h3><p class="rp-modal-sub">' + RP.chart.fmt(t.entry) + ' → ' + RP.chart.fmt(t.exit) + ' · ' + ({ sl: 'stopped out', tp: 'target hit', manual: 'closed manually' }[t.reason] || t.reason) + ' · ' + t.bars + ' bars · MFE ' + money(t.mfe) + ' · MAE ' + money(-t.mae) + '</p>' +
      '<div class="rp-modal-grid"><div><h4>Setup</h4><div class="rp-chips" id="rp-te-tags">' + chips(COACH.TAGS, t.tags || [], 'tag') + '</div><h4>Mistakes</h4><div class="rp-chips" id="rp-te-mist">' + chips(COACH.MISTAKES, t.mistakes || [], 'mist') + '</div><h4>Notes</h4><textarea id="rp-te-notes" rows="4" placeholder="What did you see? What would you do differently?">' + esc(t.notes || '') + '</textarea></div><div class="rp-snaps">' + (snapIn ? '<figure><img src="' + snapIn + '" alt="Entry"><figcaption>Entry</figcaption></figure>' : '<p class="rp-empty">No entry snapshot</p>') + (snapOut ? '<figure><img src="' + snapOut + '" alt="Exit"><figcaption>Exit</figcaption></figure>' : '<p class="rp-empty">No exit snapshot</p>') + '</div></div><div class="rp-modal-actions"><button type="button" class="btn btn-secondary" data-close>Close</button><button type="button" class="btn btn-primary" id="rp-te-save">Save</button></div>');
    document.querySelectorAll('#rp-te-tags .rp-chip, #rp-te-mist .rp-chip').forEach((b) => b.addEventListener('click', () => b.classList.toggle('is-on')));
    $('rp-te-save').addEventListener('click', () => { RP.sim.updateTradeMeta(t.id, { tags: [...document.querySelectorAll('#rp-te-tags .is-on')].map((b) => b.dataset.tag), mistakes: [...document.querySelectorAll('#rp-te-mist .is-on')].map((b) => b.dataset.mist), notes: $('rp-te-notes').value.trim() }); closeModal(); RP.tradesRendered = -1; renderTrades(); renderStats(); saveSession(); });
  }
  const snapKey = (posId, kind) => RP.session.id + ':' + posId + ':' + kind;
  function queueSnap(posId, kind) { RP.snapQueue.push([posId, kind]); if (!queueSnap.t) queueSnap.t = setTimeout(flushSnaps, 250); }
  function flushSnaps() { queueSnap.t = null; const q = RP.snapQueue.splice(0); if (!RP.chart || !q.length) return; try { const url = RP.chart.screenshot(720); for (const [posId, kind] of q) D.store.putSnap(snapKey(posId, kind), url); } catch (e) { console.warn('snapshot failed', e); } }
  function renderStats() {
    const s = E.stats(RP.sim.trades, RP.sim.equity, RP.sim.startBalance); if (RP.session) RP.session.summary = { net: s.net, count: s.count, winRate: s.winRate, pf: s.profitFactor === Infinity ? null : s.profitFactor, maxDD: s.maxDD, avgR: s.avgR };
    const pf = s.profitFactor == null ? '—' : s.profitFactor === Infinity ? '∞' : s.profitFactor.toFixed(2); const tile = (l, v, cls) => '<div class="rp-stat"><span>' + l + '</span><b class="' + (cls || '') + '">' + v + '</b></div>';
    $('rp-stats').innerHTML = tile('Net P&L', money(s.net, true), s.net > 0 ? 'up' : s.net < 0 ? 'down' : '') + tile('Return', (s.returnPct >= 0 ? '+' : '') + s.returnPct + '%', s.returnPct > 0 ? 'up' : s.returnPct < 0 ? 'down' : '') + tile('Trades', s.count + ' <small>(' + s.longs + 'L / ' + s.shorts + 'S)</small>') + tile('Win rate', s.winRate + '%') + tile('Profit factor', pf) + tile('Expectancy', money(s.expectancy, true) + ' <small>/ trade</small>') + tile('Avg R', s.avgR != null ? s.avgR.toFixed(2) + 'R' : '—') + tile('Avg win / loss', money(s.avgWin) + ' / ' + money(s.avgLoss)) + tile('Max drawdown', money(-s.maxDD) + ' <small>(' + s.maxDDPct + '%)</small>', s.maxDD > 0 ? 'down' : '') + tile('Best / worst', money(s.best, true) + ' / ' + money(s.worst, true)) + tile('Streaks', s.maxWinStreak + ' W · ' + s.maxLossStreak + ' L') + tile('Fees paid', money(s.fees)) + tile('Long / short P&L', money(s.longNet, true) + ' / ' + money(s.shortNet, true)) + tile('Avg bars held', s.avgBars);
  }
  function renderEquity() {
    const c = $('rp-eq'); if (!c.clientWidth) return; const ctx = c.getContext('2d'); const d = window.devicePixelRatio || 1; const w = c.clientWidth, h = c.clientHeight || 200; c.width = w * d; c.height = h * d; ctx.setTransform(d, 0, 0, d, 0, 0); ctx.clearRect(0, 0, w, h);
    const pts = RP.sim.equity; if (pts.length < 2) { ctx.fillStyle = '#8b93a0'; ctx.font = '12px sans-serif'; ctx.fillText('The equity curve draws as you step through bars.', 12, 24); return; }
    const step = Math.max(1, Math.floor(pts.length / 1400)); const sample = []; for (let i = 0; i < pts.length; i += step) sample.push(pts[i]); if (sample[sample.length - 1] !== pts[pts.length - 1]) sample.push(pts[pts.length - 1]);
    let mn = Infinity, mx = -Infinity; for (const p of sample) { if (p.equity < mn) mn = p.equity; if (p.equity > mx) mx = p.equity; } const base = RP.sim.startBalance; mn = Math.min(mn, base); mx = Math.max(mx, base); const pad = (mx - mn || 1) * 0.1; mn -= pad; mx += pad;
    const x = (i) => 8 + i / (sample.length - 1) * (w - 16), y = (v) => 8 + (mx - v) / (mx - mn) * (h - 16);
    ctx.strokeStyle = 'rgba(139,147,160,0.4)'; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(8, y(base)); ctx.lineTo(w - 8, y(base)); ctx.stroke(); ctx.setLineDash([]);
    const last = sample[sample.length - 1].equity; const col = last >= base ? '#03c988' : '#e5484d';
    ctx.beginPath(); sample.forEach((p, i) => { i ? ctx.lineTo(x(i), y(p.equity)) : ctx.moveTo(x(i), y(p.equity)); }); ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke(); ctx.lineTo(x(sample.length - 1), h - 8); ctx.lineTo(8, h - 8); ctx.closePath(); ctx.fillStyle = last >= base ? 'rgba(3,201,136,0.12)' : 'rgba(229,72,77,0.12)'; ctx.fill();
    ctx.fillStyle = '#8b93a0'; ctx.font = '11px JetBrains Mono, monospace'; ctx.fillText(money(mx + pad), 10, 18); ctx.fillText(money(mn - pad), 10, h - 12);
  }
  function renderLog() { const f = new Intl.DateTimeFormat('en-US', { timeZone: RP.tz, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }); $('rp-log').innerHTML = RP.sim.log.slice(-80).reverse().map((l) => '<div><span>' + f.format(new Date(l.t)) + '</span>' + esc(l.msg) + '</div>').join('') || '<p class="rp-empty">Fills, stops and targets are logged here.</p>'; }
  function renderCoach() {
    const r = COACH.report(RP.sim.trades, RP.sim.equity, { startBalance: RP.sim.startBalance }); const el = $('rp-coach');
    const card = (f) => '<div class="rp-finding is-' + f.severity + '"><b>' + esc(f.title) + '</b><p>' + esc(f.detail) + '</p><p class="rp-sugg">' + esc(f.suggestion) + '</p></div>';
    const table = (title, rows, keyLbl) => rows && rows.length ? '<div class="rp-coach-table"><h4>' + title + '</h4><table class="rp-table"><thead><tr><th>' + keyLbl + '</th><th>Trades</th><th>Net</th><th>Per trade</th><th>Win</th></tr></thead><tbody>' + rows.map((g) => '<tr><td>' + esc(g.key) + '</td><td>' + g.n + '</td><td class="' + (g.net >= 0 ? 'up' : 'down') + '">' + money(g.net, true) + '</td><td>' + money(g.exp, true) + '</td><td>' + g.winRate.toFixed(0) + '%</td></tr>').join('') + '</tbody></table></div>' : '';
    el.innerHTML = '<div class="rp-findings">' + r.findings.map(card).join('') + '</div>' + (r.groups ? '<div class="rp-coach-tables">' + table('By hour (ET)', (r.groups.byHour || []).slice().sort((a, b) => Number(a.key) - Number(b.key)).map((g) => Object.assign({}, g, { key: g.key + ':00' })), 'Hour') + table('By session', r.groups.bySess, 'Session') + table('By setup', r.groups.byTag, 'Setup') + '</div>' : '') + '<p class="rp-fine">Rule-based diagnostics computed on this device from this session\'s trades. No AI model, nothing leaves your browser.</p>';
  }
  function showNudge(n) { const el = $('rp-nudge'); el.className = 'rp-nudge is-' + n.level; $('rp-nudge-text').textContent = n.text; el.hidden = false; clearTimeout(showNudge.t); showNudge.t = setTimeout(() => { el.hidden = true; }, 14000); }
  function exportCsv() { const rows = [['#', 'symbol', 'side', 'size', 'entry_time_utc', 'entry', 'exit_time_utc', 'exit', 'gross', 'fees', 'pnl', 'r', 'reason', 'mfe', 'mae', 'bars', 'tags', 'mistakes', 'notes']]; RP.sim.trades.forEach((t, i) => rows.push([i + 1, RP.spec.symbol, t.side, t.size, new Date(t.entryT).toISOString(), t.entry, new Date(t.exitT).toISOString(), t.exit, t.gross, t.fees, t.pnl, t.r == null ? '' : t.r, t.reason, t.mfe, t.mae, t.bars, '"' + (t.tags || []).join('|') + '"', '"' + (t.mistakes || []).join('|') + '"', '"' + String(t.notes || '').replace(/"/g, '""') + '"'])); const blob = new Blob([rows.map((r) => r.join(',')).join('\n')], { type: 'text/csv' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = (RP.session.name || 'replay').replace(/[^\w.-]+/g, '_') + '-trades.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
  async function sendToJournal() {
    if (!RP.uid || typeof db === 'undefined' || !db || typeof journalComputeDerived !== 'function') { toast('The journal is not available right now', 'error'); return; }
    const todo = RP.sim.trades.filter((t) => !t.journaled); if (!todo.length) { toast('Every trade in this session is already in your journal', 'info'); return; }
    if (!confirm('Copy ' + todo.length + ' trade' + (todo.length > 1 ? 's' : '') + ' into your Trade journal, tagged "backtest"?')) return;
    const fmtD = new Intl.DateTimeFormat('en-CA', { timeZone: RP.tz, year: 'numeric', month: '2-digit', day: '2-digit' }), fmtT = new Intl.DateTimeFormat('en-US', { timeZone: RP.tz, hour: '2-digit', minute: '2-digit', hour12: false });
    const pbId = (RP.session.settings || {}).playbookId || null;
    let ok = 0;
    for (const t of todo) {
      try {
        const snap = await D.store.getSnap(snapKey(t.posId, 'entry'));
        const raw = { instrument: RP.spec.symbol, direction: t.side === 'buy' ? 'long' : 'short', date: fmtD.format(new Date(t.entryT)), time: fmtT.format(new Date(t.entryT)), entryPrice: String(t.entry), exitPrice: String(t.exit), positionSize: String(t.size), fees: String(t.fees || 0), stopLoss: t.sl != null ? String(t.sl) : null, takeProfit: t.tp != null ? String(t.tp) : null, session: COACH.sessionOf(t.entryT), setup: (t.tags && t.tags[0]) || 'Backtest', account: 'Backtest', tags: ['backtest'].concat(t.tags || []),
          playbookId: pbId,
          // null means "not graded" and must stay null: an empty array would
          // read as "met none of the rules" and unfairly drag the discipline
          // numbers down for a session run without a checklist.
          rulesMet: (t.checklist && Array.isArray(t.checklist.rulesMet)) ? t.checklist.rulesMet : null, notes: ((t.notes || '') + '\nBacktest replay · ' + RP.session.name + (t.mistakes && t.mistakes.length ? ' · mistakes: ' + t.mistakes.join(', ') : '')).trim(), screenshotDataUrl: snap || null, source: 'replay', replaySessionId: RP.session.id, replayTradeId: t.id };
        const derived = journalComputeDerived(raw, RP.sim.startBalance);
        await db.collection('students').doc(RP.uid).collection('journal').doc().set(Object.assign({}, raw, derived, { createdAt: firebase.firestore.FieldValue.serverTimestamp(), updatedAt: firebase.firestore.FieldValue.serverTimestamp() }));
        RP.sim.updateTradeMeta(t.id, { journaled: true }); ok++;
      } catch (e) { console.warn('journal copy failed', e); }
    }
    RP.tradesRendered = -1; renderTrades(); saveSession(); toast(ok + ' of ' + todo.length + ' trades copied to the journal', ok === todo.length ? 'success' : 'error');
  }

  // ---- indicators UI ---------------------------------------------------------------------------------
  function openIndicatorPicker() {
    const list = IND.list(); const groups = {}; for (const i of list) (groups[i.group] = groups[i.group] || []).push(i);
    openModal('<h3>Indicators</h3><p class="rp-modal-sub">Overlays draw on the price chart, oscillators open their own pane. Click ⚙ in the chart legend to change settings later.</p><div class="rp-indpick">' + Object.keys(groups).map((g) => '<h4>' + esc(g) + '</h4>' + groups[g].map((i) => '<button type="button" class="rp-indopt" data-ind="' + i.id + '"><b>' + esc(i.name) + '</b><span>' + (i.overlay ? 'overlay' : 'pane') + '</span></button>').join('')).join('') + '</div><div class="rp-modal-actions"><button type="button" class="btn btn-secondary" data-close>Done</button></div>');
    document.querySelectorAll('#rp-modal .rp-indopt').forEach((b) => b.addEventListener('click', () => { RP.chart.addIndicator(b.dataset.ind, {}); saveIndicators(); b.classList.add('is-added'); b.querySelector('span').textContent = 'added ✓'; }));
  }
  function openIndicatorSettings(iid) {
    const inst = RP.chart.indicators.find((x) => x.iid === iid); if (!inst) return;
    openModal('<h3>' + esc(inst.def.name) + '</h3><div class="rp-form">' + inst.def.inputs.map((inp) => '<label>' + esc(inp.label) + (inp.type === 'bool' ? '<input type="checkbox" data-key="' + inp.key + '"' + (inst.params[inp.key] ? ' checked' : '') + '>' : inp.type === 'select' ? '<select data-key="' + inp.key + '">' + inp.options.map((o) => '<option value="' + o + '"' + (inst.params[inp.key] === o ? ' selected' : '') + '>' + o + '</option>').join('') + '</select>' : '<input type="number" data-key="' + inp.key + '" value="' + inst.params[inp.key] + '" step="' + (inp.type === 'int' ? 1 : 0.1) + '"' + (inp.min != null ? ' min="' + inp.min + '"' : '') + (inp.max != null ? ' max="' + inp.max + '"' : '') + '>') + '</label>').join('') + '</div><div class="rp-modal-actions"><button type="button" class="btn btn-secondary" data-close>Cancel</button><button type="button" class="btn btn-primary" id="rp-ind-save">Apply</button></div>');
    $('rp-ind-save').addEventListener('click', () => { const p = {}; document.querySelectorAll('#rp-modal [data-key]').forEach((el) => { const inp = inst.def.inputs.find((x) => x.key === el.dataset.key); p[el.dataset.key] = inp.type === 'bool' ? el.checked : inp.type === 'select' ? el.value : Number(el.value); }); RP.chart.setIndicatorParams(iid, p); saveIndicators(); closeModal(); });
  }
  function saveIndicators() { if (!RP.session || !RP.chart) return; RP.session.indicators = RP.chart.getIndicators(); setPref('lastIndicators', RP.session.indicators.map((i) => ({ id: i.id, params: i.params }))); saveSession(); }

  // ---- object tree -----------------------------------------------------------------------------------
  const DRAW_NAMES = { trend: 'Trend line', ray: 'Ray', hline: 'Horizontal line', rect: 'Rectangle', fib: 'Fibonacci', measure: 'Measure' };
  function renderObjects() {
    const el = $('rp-objtree'); if (!el || !RP.chart) return; const inds = RP.chart.indicators, dr = RP.chart.drawings;
    el.innerHTML = '<h4>Indicators</h4>' + (inds.length ? inds.map((i) => '<div class="rp-obj' + (i.visible ? '' : ' is-off') + '" data-iid="' + i.iid + '"><span class="rp-obj-ic">ƒ</span><b>' + esc(i.def.name) + '</b><button type="button" data-act="toggle" title="Show / hide">' + (i.visible ? '👁' : '◌') + '</button><button type="button" data-act="settings" title="Settings">⚙</button><button type="button" data-act="remove" title="Remove">✕</button></div>').join('') : '<p class="rp-empty">No indicators. Add one from the top bar.</p>') +
      '<h4>Drawings</h4>' + (dr.length ? dr.map((d, i) => '<div class="rp-obj' + (d.hidden ? ' is-off' : '') + (RP.chart.selected === i ? ' is-sel' : '') + '" data-di="' + i + '"><span class="rp-obj-ic">✎</span><b>' + (DRAW_NAMES[d.type] || d.type) + '</b><small>' + RP.chart.fmt(d.p1.price) + (d.p2 ? ' → ' + RP.chart.fmt(d.p2.price) : '') + '</small><button type="button" data-act="dtoggle" title="Show / hide">' + (d.hidden ? '◌' : '👁') + '</button><button type="button" data-act="dremove" title="Remove">✕</button></div>').join('') : '<p class="rp-empty">No drawings yet. Pick a tool on the left rail.</p>');
  }
  function onObjectsClick(e) {
    const b = e.target.closest('button'), row = e.target.closest('.rp-obj'); if (!row) return;
    if (row.dataset.iid) { if (b) RP.chart.onIndicatorAction(row.dataset.iid, b.dataset.act); return; }
    const i = Number(row.dataset.di);
    if (!b) { RP.chart.selectDrawing(i); renderObjects(); return; }
    if (b.dataset.act === 'dtoggle') RP.chart.toggleDrawing(i); else if (b.dataset.act === 'dremove') RP.chart.removeDrawing(i); saveSession();
  }
  // ---- context menu -------------------------------------------------------------------------------------
  function openContextMenu(info) {
    const m = $('rp-ctx'); const px = RP.sim.price(); const size = Number($('rp-strip-size') ? $('rp-strip-size').value : $('rp-size').value) || 1; const fmt = (v) => RP.chart.fmt(v); const items = [];
    const buyType = info.price < px ? 'limit' : 'stop', sellType = info.price > px ? 'limit' : 'stop';
    items.push({ t: 'Buy ' + size + ' @ ' + fmt(info.price) + ' ' + buyType, f: () => placeOrder({ side: 'buy', type: buyType, price: info.price, size }) });
    items.push({ t: 'Sell ' + size + ' @ ' + fmt(info.price) + ' ' + sellType, f: () => placeOrder({ side: 'sell', type: sellType, price: info.price, size }) });
    const pos = RP.sim.positions[RP.sim.positions.length - 1];
    if (pos) { const dir = pos.side === 'buy' ? 1 : -1; if ((info.price - px) * dir < 0) items.push({ t: 'Set stop here (' + fmt(info.price) + ')', f: () => { RP.sim.modifyPosition(pos.id, { sl: info.price }); refresh(); saveSession(); } }); else items.push({ t: 'Set target here (' + fmt(info.price) + ')', f: () => { RP.sim.modifyPosition(pos.id, { tp: info.price }); refresh(); saveSession(); } }); items.push({ t: 'Close position #' + pos.id, f: () => { const before = RP.sim.trades.length; RP.sim.close(pos.id); refresh(); onTradesClosed(RP.sim.trades.slice(before)); saveSession(); } }); }
    items.push({ sep: true });
    items.push({ t: 'Horizontal line at ' + fmt(info.price), f: () => { RP.chart.drawings.push({ type: 'hline', p1: { t: info.bar ? info.bar.t : RP.series.base[RP.cursor].t, price: info.price } }); RP.chart._changed(); saveSession(); } });
    if (info.hitDrawing != null) items.push({ t: 'Delete this drawing', f: () => { RP.chart.removeDrawing(info.hitDrawing); saveSession(); } });
    items.push({ t: 'Copy price ' + fmt(info.price), f: () => { try { navigator.clipboard.writeText(fmt(info.price)); } catch (e) { /* clipboard blocked */ } } });
    items.push({ t: 'Reset chart view', f: () => RP.chart.scrollToEnd() });
    m.innerHTML = items.map((it, i) => it.sep ? '<li class="sep"></li>' : '<li data-i="' + i + '">' + esc(it.t) + '</li>').join('');
    m.hidden = false; const w = m.offsetWidth, h = m.offsetHeight; m.style.left = Math.min(window.innerWidth - w - 8, info.x) + 'px'; m.style.top = Math.min(window.innerHeight - h - 8, info.y) + 'px';
    m.onclick = (e) => { const li = e.target.closest('li[data-i]'); if (!li) return; m.hidden = true; try { items[Number(li.dataset.i)].f(); } catch (err) { toast(err.message, 'error'); } };
  }
  function closeContextMenu() { const m = $('rp-ctx'); if (m) m.hidden = true; }
  function setDrawer(which) { if (which === 'objects') renderObjects(); document.querySelectorAll('#rp-drawerbtns [data-d]').forEach((b) => b.classList.toggle('is-on', b.dataset.d === which)); document.querySelectorAll('.rpw-pane').forEach((p) => { p.hidden = p.id !== 'rp-pane-' + which; }); $('rp-drawer').classList.toggle('is-closed', !which); if (RP.chart) setTimeout(() => { RP.chart.resize(); if (RP.htf) RP.htf.resize(); }, 220); }
  function openSetup() { $('rp-setup-modal').hidden = false; }
  function closeSetup() { $('rp-setup-modal').hidden = true; }

  // ---- modal ------------------------------------------------------------------------------------------
  function openModal(html) { const m = $('rp-modal'); m.querySelector('.rp-modal-card').innerHTML = html; m.hidden = false; m.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', closeModal)); }
  function closeModal() { $('rp-modal').hidden = true; RP.pendingSubmit = null; }

  // ---- persistence -------------------------------------------------------------------------------------
  let saveTimer = null;
  function saveSession() { if (!RP.session || !RP.sim) return; RP.stepsSinceSave = 0; const s = RP.session; s.tf = RP.tf; s.htfTf = RP.htfTf; s.cursor = RP.cursor; s.sim = RP.sim.snapshot(); s.drawings = RP.chart ? RP.chart.getDrawings() : s.drawings; s.indicators = RP.chart ? RP.chart.getIndicators() : s.indicators; s.updatedAt = Date.now(); s.tz = RP.tz; D.store.putSession(s); clearTimeout(saveTimer); saveTimer = setTimeout(() => cloudSave(s), 1500); }
  function cloudSave(s) { if (!RP.uid || typeof db === 'undefined' || !db) return; const doc = { name: s.name, symbolId: s.symbolId, symbolLabel: s.symbolLabel, startMs: s.startMs, endMs: s.endMs, cursor: s.cursor, total: s.total, tf: s.tf, summary: s.summary || null, balance: s.sim.balance, startBalance: s.sim.startBalance, trades: s.sim.trades.slice(-300).map((t) => Object.assign({}, t, { notes: (t.notes || '').slice(0, 500) })), updatedAt: Date.now() }; db.collection('students').doc(RP.uid).collection('replay').doc(s.id).set(doc, { merge: true }).catch((e) => { if (!cloudSave.warned) { cloudSave.warned = true; console.warn('replay cloud save unavailable:', e && e.message); } }); }

  // ---- tools / options -----------------------------------------------------------------------------------
  function setTool(tool) { RP.chart.setTool(tool); document.querySelectorAll('#rp-tools [data-tool]').forEach((b) => b.classList.toggle('is-on', b.dataset.tool === tool)); }
  function setTf(tf) { RP.tf = tf; document.querySelectorAll('#rp-tfs .rp-tf').forEach((b) => b.classList.toggle('is-on', b.dataset.tf === tf)); refresh(); RP.chart.scrollToEnd(); saveSession(); }
  // ---- playbooks ------------------------------------------------------------------------------
  // A backtest session can be run against one of the student's playbooks. Its
  // rules become the pre-trade checklist, and every trade records which of them
  // were actually met — so a replay evening produces the same graded evidence a
  // month of live trades would, and the Playbook tab can say something useful
  // far sooner.
  RP.playbooks = [];

  function loadPlaybookPicker() {
    const sel = $('rp-playbook'); if (!sel) return;
    if (!RP.uid || typeof loadPlaybooks !== 'function') return;
    loadPlaybooks(RP.uid).then((data) => {
      RP.playbooks = ((data && data.playbooks) || []).filter((p) => p.status !== 'retired');
      const prev = pref('playbookId', '');
      sel.innerHTML = '<option value="">No playbook</option>' +
        RP.playbooks.map((p) => '<option value="' + esc(p.id) + '">' + esc(p.name || 'Untitled playbook') + '</option>').join('');
      if (prev && RP.playbooks.some((p) => p.id === prev)) sel.value = prev;
      applyPlaybookToChecklist();
    }).catch(() => {});
  }

  function findPlaybook(id) { return RP.playbooks.find((p) => p.id === id) || null; }

  // Choosing a playbook replaces the checklist text with its rules and turns
  // the checklist on, because a playbook you do not grade against is just a
  // label. Choosing "No playbook" restores the coach's generic list.
  function applyPlaybookToChecklist() {
    const sel = $('rp-playbook'); if (!sel) return;
    const pb = findPlaybook(sel.value);
    const ta = $('rp-checklist-items');
    if (pb && (pb.rules || []).length) {
      ta.value = pb.rules.map((r) => r.text).join('\n');
      ta.readOnly = true;
      $('rp-opt-checklist').checked = true;
    } else {
      ta.readOnly = false;
      if (ta.value === '' ) ta.value = pref('checklistItems', COACH.CHECKLIST.join('\n'));
    }
  }

  const ICON_PLAY = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4l13 8-13 8z"/></svg>', ICON_PAUSE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>';

  function wire() {
    fillSymbols(); defaultDates(); updateDataNote(); refreshCsvList(); renderSessionList();
    $('rp-checklist-items').value = pref('checklistItems', COACH.CHECKLIST.join('\n')); $('rp-opt-checklist').checked = !!pref('checklistOn', false); $('rp-opt-nudges').checked = pref('nudgesOn', true) !== false;
    loadPlaybookPicker();
    $('rp-symbol').addEventListener('change', updateDataNote); $('rp-start').addEventListener('change', updateDataNote); $('rp-days').addEventListener('change', updateDataNote); $('rp-csv-file').addEventListener('change', onCsvFile);
    if ($('rp-playbook')) $('rp-playbook').addEventListener('change', applyPlaybookToChecklist);
    $('rp-start-btn').addEventListener('click', startNew);
    $('rp-session-list').addEventListener('click', async (e) => { const card = e.target.closest('.rp-sess'); if (!card) return; if (e.target.closest('[data-resume]')) resumeSession(card.dataset.id); else if (e.target.closest('[data-del]') && confirm('Delete this saved session and its snapshots?')) { await D.store.deleteSession(card.dataset.id); D.store.deleteSnaps(card.dataset.id); renderSessionList(); } });
    $('rp-back').addEventListener('click', leaveWorkspace); $('rp-play').addEventListener('click', () => RP.playing ? pause() : play()); $('rp-step').addEventListener('click', () => { pause(); advance(1); }); $('rp-step10').addEventListener('click', () => { pause(); advance(10); }); $('rp-jumpny').addEventListener('click', jumpNextNyOpen); $('rp-jumpday').addEventListener('click', jumpNextDay); $('rp-speed').addEventListener('change', (e) => setSpeed(Number(e.target.value)));
    $('rp-tfs').addEventListener('click', (e) => { const b = e.target.closest('[data-tf]'); if (b) setTf(b.dataset.tf); });
    $('rp-htf-tf').addEventListener('change', (e) => { RP.htfTf = e.target.value; refresh(); RP.htf.scrollToEnd(); saveSession(); });
    $('rp-split').addEventListener('change', (e) => { $('rp-chart-htf').hidden = !e.target.checked; $('rp-charts').classList.toggle('is-split', e.target.checked); setTimeout(() => { RP.chart.resize(); if (RP.htf) { RP.htf.resize(); refresh(); RP.htf.scrollToEnd(); } }, 30); });
    ['rp-sess-ny', 'rp-sess-ldn'].forEach((id) => $(id).addEventListener('change', () => { const o = { sessions: { ny: $('rp-sess-ny').checked, ldn: $('rp-sess-ldn').checked } }; RP.chart.setOptions(o); RP.htf.setOptions(o); }));
    $('rp-tools').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; if (b.dataset.tool) setTool(b.dataset.tool === RP.chart.tool && b.dataset.tool !== 'none' ? 'none' : b.dataset.tool); else if (b.id === 'rp-tool-del') { RP.chart.deleteSelected(); saveSession(); } else if (b.id === 'rp-tool-clear' && confirm('Remove all drawings?')) { RP.chart.clearDrawings(); saveSession(); } });
    $('rp-ind-btn').addEventListener('click', openIndicatorPicker); $('rp-snap-btn').addEventListener('click', () => { try { const url = RP.chart.screenshot(1280); const a = document.createElement('a'); a.href = url; a.download = (RP.session.name || 'replay').replace(/[^\w.-]+/g, '_') + '-' + Date.now() + '.jpg'; a.click(); } catch (e) { toast('Snapshot failed', 'error'); } });
    document.querySelectorAll('#rp-sidebtns [data-side]').forEach((b) => b.addEventListener('click', () => { RP.side = b.dataset.side; document.querySelectorAll('#rp-sidebtns [data-side]').forEach((x) => x.classList.toggle('is-on', x === b)); updateTicketMath(); }));
    $('rp-type').addEventListener('change', () => { $('rp-price').disabled = $('rp-type').value === 'market'; if ($('rp-type').value === 'market') $('rp-price').value = RP.chart.fmt(RP.sim.price()); updateTicketMath(); syncLines(); });
    ['rp-price', 'rp-size', 'rp-sl', 'rp-tp', 'rp-risk'].forEach((id) => $(id).addEventListener('input', () => { if (id === 'rp-size' && $('rp-strip-size')) $('rp-strip-size').value = $('rp-size').value; updateTicketMath(); syncLines(); }));
    $('rp-size-risk').addEventListener('click', sizeFromRisk); $('rp-quick-sl').addEventListener('click', () => quickStop('sl')); $('rp-quick-tp').addEventListener('click', () => quickStop('tp')); $('rp-submit').addEventListener('click', submitTicket);
    $('rp-tags').addEventListener('click', (e) => { const b = e.target.closest('[data-tag]'); if (!b) return; const t = b.dataset.tag; RP.nextTags = RP.nextTags.includes(t) ? RP.nextTags.filter((x) => x !== t) : RP.nextTags.concat(t); renderTagChips(); });
    $('rp-closeall').addEventListener('click', () => { if (RP.sim.positions.length && confirm('Close every open position at the current price?')) { const before = RP.sim.trades.length; RP.sim.closeAll(); refresh(); onTradesClosed(RP.sim.trades.slice(before)); saveSession(); } });
    $('rp-positions').addEventListener('click', onPositionsClick); $('rp-positions').addEventListener('change', onPositionsChange);
    $('rp-trades').addEventListener('click', (e) => { const b = e.target.closest('[data-edit]'); const row = e.target.closest('[data-trade]'); if (b && row) openTradeEditor(Number(row.dataset.trade), false); });
    $('rp-export').addEventListener('click', exportCsv); $('rp-journal').addEventListener('click', sendToJournal);
    document.querySelectorAll('.rp-tabs button[data-tab]').forEach((b) => b.addEventListener('click', () => { document.querySelectorAll('.rp-tabs button[data-tab]').forEach((x) => x.classList.toggle('is-on', x === b)); document.querySelectorAll('.rp-tabpane').forEach((p) => { p.hidden = p.id !== 'rp-tab-' + b.dataset.tab; }); if (b.dataset.tab === 'equity') renderEquity(); if (b.dataset.tab === 'log') renderLog(); if (b.dataset.tab === 'coach') renderCoach(); }));
    $('rp-tz-live').addEventListener('change', (e) => { RP.tz = e.target.value; RP.chart.setOptions({ tz: RP.tz }); RP.htf.setOptions({ tz: RP.tz }); renderCursor(); RP.tradesRendered = -1; renderTrades(); saveSession(); });
    $('rp-nudge-close').addEventListener('click', () => { $('rp-nudge').hidden = true; });
    $('rp-modal').addEventListener('click', (e) => { if (e.target === $('rp-modal')) closeModal(); });
    document.addEventListener('keydown', (e) => {
      if (!$('rp-modal').hidden) { if (e.key === 'Escape') closeModal(); return; }
      if ($('rp-work').hidden) return; const tag = (e.target.tagName || '').toLowerCase(); if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
      if (e.code === 'Space') { e.preventDefault(); RP.playing ? pause() : play(); } else if (e.key === 'ArrowRight') { e.preventDefault(); pause(); advance(e.shiftKey ? 10 : 1); } else if (e.key === 'ArrowUp') { e.preventDefault(); setSpeed(RP.speedIdx + 1); } else if (e.key === 'ArrowDown') { e.preventDefault(); setSpeed(RP.speedIdx - 1); }
      else if (e.key === 'Escape') setTool('none'); else if (e.key === 'Delete' || e.key === 'Backspace') { if (RP.chart.deleteSelected()) { e.preventDefault(); saveSession(); } } else if (e.key === '=' || e.key === '+') RP.chart.zoom(1.25); else if (e.key === '-') RP.chart.zoom(0.8);
      else if (e.key.toLowerCase() === 'b' && e.shiftKey) stripOrder('buy'); else if (e.key.toLowerCase() === 's' && e.shiftKey) stripOrder('sell');
    });
    window.addEventListener('beforeunload', () => { if (RP.session) saveSession(); });
    new MutationObserver(() => { const theme = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'; if (RP.chart) RP.chart.setOptions({ theme }); if (RP.htf) RP.htf.setOptions({ theme }); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    $('rp-new-btn').addEventListener('click', openSetup); $('rp-hero-btn').addEventListener('click', openSetup); $('rp-setup-modal').querySelector('[data-close]').addEventListener('click', closeSetup); $('rp-setup-modal').addEventListener('click', (e) => { if (e.target === $('rp-setup-modal')) closeSetup(); });
    document.querySelectorAll('#rp-drawerbtns [data-d]').forEach((b) => b.addEventListener('click', () => setDrawer(b.classList.contains('is-on') ? null : b.dataset.d)));
    $('rp-objtree').addEventListener('click', onObjectsClick);
    $('rp-sheet-toggle').addEventListener('click', () => { const open = $('rp-sheet').classList.toggle('is-open'); $('rp-sheet-toggle').classList.toggle('is-on', open); if (open) { renderEquity(); $('rp-sheet').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } });
    document.addEventListener('mousedown', (e) => { if (!e.target.closest('#rp-ctx')) closeContextMenu(); }); window.addEventListener('blur', closeContextMenu);
    const q = new URLSearchParams(location.search); if (q.get('session')) resumeSession(q.get('session')); else if (q.get('new')) openSetup();
  }

  function planNameForRank(minRank) { const plans = (typeof getCachedPlansForRoles === 'function') ? getCachedPlansForRoles() : []; const m = plans.find((p) => (p.rank ?? 0) >= minRank); return m ? m.name : null; }
  function showLocked() { $('rp-app').style.display = 'none'; const name = planNameForRank(RP_MIN_RANK); const btn = $('rp-locked-btn'); if (btn) { btn.textContent = name ? 'Go ' + name + ' to unlock' : 'Upgrade to unlock'; btn.dataset.upgradeReason = (name ? name + ' members' : 'Members') + ' can backtest any market bar by bar with simulated orders, stops and targets.'; } $('rp-locked').style.display = ''; }
  function showApp() { $('rp-locked').style.display = 'none'; $('rp-app').style.display = ''; wire(); $('rp-play').innerHTML = ICON_PLAY; }

  document.addEventListener('DOMContentLoaded', () => {
    if (typeof auth === 'undefined' || !auth || !$('rp-app')) return;
    let handled = false;
    auth.onAuthStateChanged((user) => {
      if (handled) return;
      if (!user) { setTimeout(() => { if (!handled && typeof goToLoginPreservingReturn === 'function') goToLoginPreservingReturn(); }, 1500); return; }
      handled = true; RP.uid = user.uid;
      const adminCheck = db.collection('admins').doc(user.uid).get().catch(() => null), studentCheck = db.collection('students').doc(user.uid).get().catch(() => null), rolesCheck = (typeof loadPlansForRoles === 'function') ? loadPlansForRoles() : Promise.resolve();
      Promise.all([adminCheck, studentCheck, rolesCheck]).then(([adminDoc, studentDoc]) => { if (adminDoc && adminDoc.exists) return true; const plan = (studentDoc && studentDoc.exists) ? studentDoc.data().plan : null; if (!plan || typeof rankOf !== 'function' || typeof findPlan !== 'function' || !findPlan(plan)) return true; return rankOf(plan) >= RP_MIN_RANK; }).catch(() => true).then((allowed) => { if (allowed) showApp(); else showLocked(); });
    });
  });
})();
