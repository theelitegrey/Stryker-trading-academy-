// TradeZoro Phantom page (phantom.html): options money flow for SPX, SPY, QQQ and GLD, estimated from options volume and quotes.
// Owner order 17 Nov (roadmap card "phantom"). Maths: assets/phantom-core.js. Data: the recorder's /phantom/* (signed-in members;
// the server answers 403 when signed out) and /tide (ZoroTide). Dark pool: assets/chart-darkpool.js (the same feed as the chart layer).
// Alerts: assets/chart-metric-alerts.js (metric types ph_premium / ph_voloi, run by workers/alert-engine).
// COPY RULES: no "trade / print / sweep / block / live / real-time / delayed" for options; "Updated X s ago"; Education only.
import * as P from './phantom-core.js?v=1107';
import * as DP from './chart-darkpool.js?v=1107';
import * as MA from './chart-metric-alerts.js?v=1107';

const REC = () => window.__STK_BOOK_RECORDER || 'https://book-recorder.theelitegrey.workers.dev';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const Q = new URLSearchParams(location.search);
const REFRESH_MS = 60 * 1000;
const WF_DEF = [{ name: 'All', u: 'all', side: 'all', maxDte: null, minPrem: 0 }];
const st = {
  u: P.PH_SYMS.includes((Q.get('u') || '').toUpperCase()) ? Q.get('u').toUpperCase() : 'SPX',
  day: null, days: [], summary: null, board: null, rows: [], byKey: new Map(), side: 'all', tide: null, tideDay: 0, drill: null,
  wf: loadWf(), wtab: 0, locked: false, timer: 0
};

// ---- data ---------------------------------------------------------------------------------------------
async function hdrs() { try { return window.strykerGexHeaders ? await window.strykerGexHeaders() : {}; } catch (e) { return {}; } }
async function getPh(route, q) {
  const r = await fetch(REC() + '/phantom/' + route + '?' + new URLSearchParams(q), { headers: await hdrs(), cache: 'no-store' });
  if (r.status === 401 || r.status === 403) { const e = new Error('locked'); e.locked = true; throw e; }
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('HTTP ' + r.status);
  if (route === 'board') {
    const raw = r.headers.get('x-ph-gzip') === '1' ? r.body.pipeThrough(new DecompressionStream('gzip')) : r.body;
    return new Response(raw).json();
  }
  return r.json();
}
async function getTide(u) {
  const r = await fetch(REC() + '/tide?days=6&u=' + u, { headers: { accept: 'application/json' } });
  return r.ok ? r.json() : null;
}

// ---- top bar ------------------------------------------------------------------------------------------
function bar() {
  $('ph-syms').innerHTML = P.PH_SYMS.map((u) => `<button type="button" data-u="${u}" aria-pressed="${u === st.u}">${u}</button>`).join('');
  $('ph-syms').onclick = (e) => { const b = e.target.closest('button[data-u]'); if (!b || b.dataset.u === st.u) return; st.u = b.dataset.u; history.replaceState(null, '', '?u=' + st.u); bar(); loadSym(true); };
}
function meta() {
  const b = st.board;
  $('ph-spot').textContent = b && b.spot ? b.spot.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '–';
  $('ph-upd').textContent = b ? (b.day === todayEt() ? P.agoText(b.t) : 'Session of ' + P.fmtExp(b.day) + ', ' + b.day.slice(0, 4)) : '';
}
const todayEt = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
function msg(text, err) { const m = $('ph-msg'); m.hidden = !text; m.textContent = text || ''; m.classList.toggle('is-err', !!err); }

// ---- load ---------------------------------------------------------------------------------------------
async function loadAll() {
  try {
    const [sum, days] = await Promise.all([getPh('summary', st.day ? { day: st.day } : {}), getPh('days', { u: st.u })]);
    st.summary = sum; st.days = (days && days.days) || [];
    if (!st.day && sum && sum.day) st.day = sum.day;
    unlock();
    await loadSym(false);
    const k = decodeURIComponent(location.hash.slice(1));
    if (P.parseOcc(k) && st.byKey.has(k)) openDrill([k]);   // from the Charts panel
  } catch (e) {
    if (e.locked) return lock();
    msg('Phantom data could not be loaded. Check your connection and try again.', true);
  }
}
async function loadSym(full) {
  try {
    if (full) { const d = await getPh('days', { u: st.u }); st.days = (d && d.days) || []; }
    const day = st.days.includes(st.day) ? st.day : st.days[0];
    const b = day ? await getPh('board', { u: st.u, day }) : null;
    st.board = b; st.rows = P.boardRows(b); st.byKey = new Map(st.rows.map((r) => [r.k, r]));
    st.drill = null; $('ph-drill').hidden = true;
    msg(b ? '' : 'No Phantom data for ' + st.u + ' yet. It starts with the first options update of a US session.');
    renderDays(); meta(); renderImpact(); renderBoard(); renderWhales(); loadTide(); loadDp(); renderAlerts();
  } catch (e) {
    if (e.locked) return lock();
    msg('Phantom data could not be loaded. Check your connection and try again.', true);
  }
}
function lock() {
  st.locked = true; $('ph-body').hidden = true; const h = $('ph-lock'); h.hidden = false;
  h.innerHTML = '<section class="oc-card ph-lockcard"><img src="assets/images/phantom/phantom-128.png" width="64" height="64" alt=""><h2>Sign in to open Phantom</h2><p class="oc-dek">Phantom reads the full option chain every minute. It is free with an account.</p><div class="ph-lockbtns"><a class="oc-btn is-primary" href="login">Log in</a><a class="oc-btn" href="signup">Create account</a></div></section>';
}
function unlock() { st.locked = false; $('ph-lock').hidden = true; $('ph-body').hidden = false; }
function renderDays() {
  const sel = $('ph-day');
  sel.innerHTML = st.days.map((d) => `<option value="${d}">${P.fmtExp(d)}${d === todayEt() ? ' (today)' : ''}</option>`).join('');
  if (st.board) sel.value = st.board.day;
  sel.disabled = st.days.length < 2;
  sel.onchange = async () => { st.day = sel.value; try { st.summary = await getPh('summary', { day: st.day }); } catch (e) {} loadSym(false); };
}

// ---- 1. Market Tide --------------------------------------------------------------------------------------
async function loadTide() {
  const card = $('ph-tide');
  if (!P.TIDE_SYMS.includes(st.u)) { card.querySelector('.ph-tide-note').textContent = 'The session tide covers SPX, SPY and QQQ.'; st.tide = null; drawTide(); return; }
  const j = await getTide(st.u).catch(() => null);
  const days = j && Array.isArray(j.days) ? j.days.map(P.tideSeries).filter((d) => d && d.t.length) : [];
  st.tide = days; st.tideDay = Math.max(0, days.findIndex((d) => d.day === (st.board && st.board.day)));
  drawTide();
}
function drawTide() {
  const d = st.tide && st.tide[st.tideDay];
  const prev = $('ph-tprev'), next = $('ph-tnext');
  prev.disabled = !st.tide || st.tideDay >= st.tide.length - 1; next.disabled = !st.tide || st.tideDay <= 0;
  $('ph-tday').textContent = d ? P.fmtExp(d.day) + (d.day === todayEt() ? ' (today)' : '') : '–';
  const note = $('ph-tide').querySelector('.ph-tide-note');
  if (P.TIDE_SYMS.includes(st.u)) note.textContent = d ? 'Running total since the open, estimated from options volume and quotes, per minute.' : 'No session stored yet.';
  $('ph-tcall').textContent = d ? P.usd(d.cn[d.cn.length - 1], true) : '–';
  $('ph-tput').textContent = d ? P.usd(d.pn[d.pn.length - 1], true) : '–';
  const c = $('ph-tide-c'), g = setup(c);
  if (!d) return;
  const pad = { l: 56, r: 56, t: 12, b: 24 }, W = g.w - pad.l - pad.r, H = g.h - pad.t - pad.b;
  const t0 = d.t[0], t1 = Math.max(d.t[d.t.length - 1], t0 + 60000);
  let lo = Math.min(0, ...d.cn, ...d.pn), hi = Math.max(0, ...d.cn, ...d.pn); if (hi === lo) hi = lo + 1;
  const sp = d.s.filter((v) => v > 0); let slo = Math.min(...sp), shi = Math.max(...sp); if (!(shi > slo)) { slo -= 1; shi += 1; }
  const X = (t) => pad.l + (t - t0) / (t1 - t0) * W, Y = (v) => pad.t + (hi - v) / (hi - lo) * H, YS = (v) => pad.t + (shi - v) / (shi - slo) * H;
  const x = g.x;
  x.strokeStyle = g.P.grid; x.lineWidth = 1;
  niceTicks(lo, hi, 4).forEach((v) => { x.beginPath(); x.moveTo(pad.l, Y(v) + 0.5); x.lineTo(pad.l + W, Y(v) + 0.5); x.stroke(); text(x, P.usd(v), pad.l - 8, Y(v), g.P.ink3, 'right'); });
  niceTicks(slo, shi, 4).forEach((v) => text(x, v.toLocaleString('en-US', { maximumFractionDigits: 2 }), pad.l + W + 8, YS(v), g.P.teal, 'left'));
  x.strokeStyle = g.P.axis; x.beginPath(); x.moveTo(pad.l, Y(0) + 0.5); x.lineTo(pad.l + W, Y(0) + 0.5); x.stroke();
  const line = (arr, y, col, dash) => { x.strokeStyle = col; x.lineWidth = 2; x.setLineDash(dash || []); x.beginPath(); arr.forEach((v, i) => { if (!(v || v === 0) || (y === YS && !(v > 0))) return; const px = X(d.t[i]), py = y(v); i ? x.lineTo(px, py) : x.moveTo(px, py); }); x.stroke(); x.setLineDash([]); };
  line(d.s, YS, g.P.teal, [4, 3]); line(d.cn, Y, g.P.pos); line(d.pn, Y, g.P.neg);
  [0, 0.5, 1].forEach((f) => { const t = t0 + (t1 - t0) * f; text(x, P.fmtTime(t), X(t), pad.t + H + 14, g.P.ink3, f === 0 ? 'left' : f === 1 ? 'right' : 'center'); });
}

// ---- 2. Net Impact -------------------------------------------------------------------------------------
function renderImpact() {
  const list = P.netImpact(st.summary), el = $('ph-impact');
  if (!list.length) { el.innerHTML = '<p class="oc-foot">No data for this session yet.</p>'; return; }
  const max = Math.max(...list.map((x) => Math.abs(x.net)), 1);
  el.innerHTML = list.map((x) => `<button type="button" class="ph-imp${x.u === st.u ? ' on' : ''}" data-u="${x.u}" aria-label="${x.u} net premium ${P.usd(x.net, true)}">
    <span class="ph-imp-u">${x.u}</span><span class="ph-imp-track"><span class="ph-imp-mid"></span><span class="ph-imp-bar ${x.net >= 0 ? 'is-pos' : 'is-neg'}" style="${x.net >= 0 ? 'left:50%' : 'right:50%'};width:${(Math.abs(x.net) / max * 50).toFixed(1)}%"></span></span>
    <span class="ph-imp-v ${x.net >= 0 ? 'pos' : 'neg'}">${P.usd(x.net, true)}</span></button>`).join('');
  el.onclick = (e) => { const b = e.target.closest('[data-u]'); if (b && b.dataset.u !== st.u) { st.u = b.dataset.u; history.replaceState(null, '', '?u=' + st.u); bar(); loadSym(true); } };
}

// ---- 3. Strike Flow board -------------------------------------------------------------------------------------
function renderBoard() {
  const host = $('ph-board');
  document.querySelectorAll('#ph-sides button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.s === st.side)));
  if (!st.rows.length) { host.innerHTML = '<p class="oc-foot">No contracts with volume yet.</p>'; return; }
  const g = P.strikeGrid(st.rows, { side: st.side, topPct: 5 });
  const spot = st.board && st.board.spot;
  const sideCls = st.side === 'P' ? 'neg' : st.side === 'C' ? 'pos' : '';
  let html = '<table class="ph-grid"><thead><tr><th scope="col">Strike</th>' + g.exps.map((e) => `<th scope="col">${P.fmtExp(e)}<small>${P.dte(e, st.board.day)}d</small></th>`).join('') + '</tr></thead><tbody>';
  g.strikes.forEach((k, i) => {
    const atm = spot && i < g.strikes.length - 1 && k >= spot && g.strikes[i + 1] < spot;
    html += `<tr${atm ? ' class="ph-atm"' : ''}><th scope="row">${P.fmtStrike(k)}</th>`;
    g.cells[i].forEach((c, j) => {
      if (!c) { html += '<td class="ph-c is-empty"></td>'; return; }
      const h = P.heat(c.p, g.max), cls = st.side === 'net' ? (c.p >= 0 ? 'pos' : 'neg') : sideCls || (c.n >= 0 ? 'pos' : 'neg');
      const flag = (c.flags.vo ? '<i class="ph-f ph-f-vo" title="Volume today above open interest">V</i>' : '') + (c.flags.top ? '<i class="ph-f ph-f-top" title="Premium in the top 5% today">$</i>' : '');
      html += `<td class="ph-c ${cls}${c.flags.vo ? ' is-vo' : ''}" style="--h:${h.toFixed(3)}"><button type="button" data-i="${i}" data-j="${j}" aria-label="${P.fmtStrike(k)} ${P.fmtExp(g.exps[j])}: ${P.usd(c.p, st.side === 'net')}${c.flags.vo ? ', volume above open interest' : ''}">${P.usd(c.p, st.side === 'net')}${flag}</button></td>`;
    });
    html += '</tr>';
  });
  host.innerHTML = html + '</tbody></table>';
  host.onclick = (e) => { const b = e.target.closest('button[data-i]'); if (b) openDrill(g.cells[+b.dataset.i][+b.dataset.j].keys); };
}

// ---- 4. Drilldown ----------------------------------------------------------------------------------------
async function openDrill(keys) {
  const box = $('ph-drill'); box.hidden = false;
  keys = keys.slice().sort((a, b) => (st.byKey.get(b).p || 0) - (st.byKey.get(a).p || 0)).slice(0, 4);
  const c0 = P.parseOcc(keys[0]);
  $('ph-dtitle').textContent = st.u + ' ' + P.fmtStrike(c0.strike) + ' · ' + P.fmtExp(c0.exp);
  $('ph-dbody').innerHTML = '<p class="oc-foot">Loading…</p>';
  box.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' });
  let rep = null;
  try { rep = await getPh('contract', { u: st.u, day: st.board.day, k: keys.join(',') }); } catch (e) { if (e.locked) return lock(); }
  const ser = P.drillSeries(rep || { k: keys, t: [], s: keys.map(() => []), next: null }, st.byKey);
  st.drill = ser;
  $('ph-dbody').innerHTML = ser.map((s, i) => {
    const r = st.byKey.get(s.k) || {};
    const side = s.c.cp === 'C' ? 'Call' : 'Put';
    const nx = s.next ? `<span class="ph-dnext ${s.next.doi > 0 ? 'pos' : s.next.doi < 0 ? 'neg' : ''}">${esc(s.next.label)} (${P.fmtExp(s.next.day)} open interest ${s.next.doi > 0 ? '+' : ''}${s.next.doi.toLocaleString('en-US')})</span>`
      : `<span class="ph-dnext">${st.board.day === todayEt() ? 'Next morning\u2019s open interest change shows here after the next session opens.' : 'No next session stored.'}</span>`;
    return `<div class="ph-dc"><div class="ph-dhead"><b class="${s.c.cp === 'C' ? 'pos' : 'neg'}">${side}</b>
      <span>Premium today <b>${P.usd(r.p)}</b></span><span>Net <b class="${(r.n || 0) >= 0 ? 'pos' : 'neg'}">${P.usd(r.n, true)}</b></span><span>Volume <b>${(r.v || 0).toLocaleString('en-US')}</b></span>
      <span>Open interest <b>${(r.oi || 0).toLocaleString('en-US')}</b></span><span>Vol/OI <b class="${r.vo > 1 ? 'ph-hot' : ''}">${P.fmtVo(r.vo)}</b></span></div>
      <div class="ph-dplot"><canvas data-d="${i}" role="img" aria-label="${side} premium per minute"></canvas></div>${nx}</div>`;
  }).join('') || '<p class="oc-foot">No per-minute data stored for this contract.</p>';
  $('ph-dbody').querySelectorAll('canvas[data-d]').forEach((cv) => drawDrill(cv, ser[+cv.dataset.d]));
}
function drawDrill(c, s) {
  const g = setup(c), x = g.x;
  if (!s.t.length) { text(x, 'No per-minute data stored for this contract on this day.', g.w / 2, g.h / 2, g.P.ink3, 'center'); return; }
  const pad = { l: 56, r: 12, t: 8, b: 22 }, W = g.w - pad.l - pad.r, H = g.h - pad.t - pad.b;
  const t0 = s.t[0], t1 = Math.max(s.t[s.t.length - 1], t0 + 60000), max = Math.max(...s.p, 1);
  const X = (t) => pad.l + (t - t0) / (t1 - t0) * W, bw = Math.max(2, Math.min(10, W / Math.max(1, (t1 - t0) / 60000) - 1));
  niceTicks(0, max, 3).forEach((v) => { const y = pad.t + H - v / max * H; x.strokeStyle = g.P.grid; x.beginPath(); x.moveTo(pad.l, y + 0.5); x.lineTo(pad.l + W, y + 0.5); x.stroke(); text(x, P.usd(v), pad.l - 8, y, g.P.ink3, 'right'); });
  x.fillStyle = s.c.cp === 'C' ? g.P.pos : g.P.neg;
  s.p.forEach((v, i) => { if (v > 0) { const h = v / max * H; x.fillRect(X(s.t[i]) - bw / 2, pad.t + H - h, bw, h); } });
  [0, 1].forEach((f) => { const t = t0 + (t1 - t0) * f; text(x, P.fmtTime(t), X(t), pad.t + H + 13, g.P.ink3, f ? 'right' : 'left'); });
}

// ---- 5. Whale moves ----------------------------------------------------------------------------------------
function loadWf() { try { const j = JSON.parse(localStorage.getItem('stk_ph_wtabs') || 'null'); if (Array.isArray(j) && j.length) return j.slice(0, 6); } catch (e) {} return WF_DEF.slice(); }
function saveWf() { try { localStorage.setItem('stk_ph_wtabs', JSON.stringify(st.wf)); } catch (e) {} }
function readFilter() {
  const v = (id) => $(id).value;
  return { u: v('ph-wu'), side: v('ph-ws'), maxDte: v('ph-wd') === '' ? null : +v('ph-wd'), minPrem: +v('ph-wm') || 0 };
}
function writeFilter(f) { $('ph-wu').value = f.u; $('ph-ws').value = f.side; $('ph-wd').value = f.maxDte == null ? '' : String(f.maxDte); $('ph-wm').value = String(f.minPrem || 0); }
function renderWhales() {
  const tabs = $('ph-wtabs');
  tabs.innerHTML = st.wf.map((f, i) => `<button type="button" role="tab" class="oc-chip" data-i="${i}" aria-selected="${i === st.wtab}" aria-pressed="${i === st.wtab}">${esc(f.name)}</button>`).join('')
    + `<button type="button" class="oc-chip ph-wsave" id="ph-wsave">+ Save filter</button>`;
  writeFilter(st.wf[st.wtab] || WF_DEF[0]);
  drawWhales();
}
function drawWhales() {
  const f = readFilter(), all = P.summaryWhales(st.summary), list = P.filterWhales(all, f).slice(0, 100);
  $('ph-wcount').textContent = list.length ? list.length + ' of ' + all.length + ' minutes' : '';
  const body = $('ph-wbody');
  if (!list.length) { body.innerHTML = `<tr><td colspan="8" class="ph-wempty">${all.length ? 'Nothing matches these filters.' : 'No minutes over $25K yet this session.'}</td></tr>`; return; }
  body.innerHTML = list.map((w) => `<tr data-u="${w.u}" data-k="${w.k}"><th scope="row">${P.fmtTime(w.t * 1000)}</th><td>${w.u}</td><td>${P.fmtStrike(w.strike)}</td><td>${P.fmtExp(w.exp)}<small> ${w.dte}d</small></td>
    <td class="${w.cp === 'C' ? 'pos' : 'neg'}">${w.cp === 'C' ? 'Call' : 'Put'}</td><td class="num"><b>${P.usd(w.p)}</b></td><td class="num">${w.dv.toLocaleString('en-US')}</td><td class="num${w.vo > 1 ? ' ph-hot' : ''}">${P.fmtVo(w.vo)}</td></tr>`).join('');
}
function wireWhales() {
  ['ph-wu', 'ph-ws', 'ph-wd', 'ph-wm'].forEach((id) => { $(id).onchange = () => { drawWhales(); }; });
  $('ph-wtabs').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.id === 'ph-wsave') {
      const f = readFilter();
      const name = [f.u === 'all' ? '' : f.u, f.side === 'C' ? 'Calls' : f.side === 'P' ? 'Puts' : '', f.maxDte != null ? '≤' + f.maxDte + 'd' : '', f.minPrem ? P.usd(f.minPrem) + '+' : ''].filter(Boolean).join(' ') || 'All';
      if (st.wf.length >= 6) st.wf.splice(1, 1);
      st.wf.push(Object.assign({ name }, f)); st.wtab = st.wf.length - 1; saveWf(); renderWhales(); return;
    }
    st.wtab = +b.dataset.i; renderWhales();
  };
  $('ph-wtabs').oncontextmenu = (e) => { const b = e.target.closest('button[data-i]'); if (!b || b.dataset.i === '0') return; e.preventDefault(); st.wf.splice(+b.dataset.i, 1); st.wtab = 0; saveWf(); renderWhales(); };
  $('ph-wbody').onclick = (e) => { const r = e.target.closest('tr[data-k]'); if (!r) return; if (r.dataset.u !== st.u) { st.u = r.dataset.u; bar(); loadSym(true).then(() => openDrill([r.dataset.k])); } else openDrill([r.dataset.k]); };
}

// ---- 6. Dark pool --------------------------------------------------------------------------------------------
async function loadDp() {
  const etf = st.u === 'SPX' ? 'SPY' : st.u;   // SPX is an index: no stock prints; SPY is its ETF
  $('ph-dpsym').textContent = etf + (st.u === 'SPX' ? ' (SPX has no stock prints; SPY tracks it)' : '');
  const el = $('ph-dp');
  el.innerHTML = '<p class="oc-foot">Loading…</p>';
  const part = await DP.load(etf).catch(() => null);
  const list = DP.prints(part, 1e6, true).slice(-12).reverse();
  if (!list.length) { el.innerHTML = '<p class="oc-foot">No dark pool prints of $1M or more stored for ' + etf + ' right now.</p>'; return; }
  el.innerHTML = '<table class="ph-tbl"><thead><tr><th scope="col">Time (ET)</th><th scope="col" class="num">Price</th><th scope="col" class="num">Shares</th><th scope="col" class="num">Value</th></tr></thead><tbody>'
    + list.map((x) => `<tr${x.big ? ' class="ph-big"' : ''}><th scope="row">${P.fmtExp(new Date(x.t).toISOString().slice(0, 10))} ${P.fmtTime(x.t)}</th><td class="num">${x.p.toLocaleString('en-US', { maximumFractionDigits: 2 })}</td><td class="num">${x.s.toLocaleString('en-US')}</td><td class="num"><b>${DP.usd(x.v)}</b></td></tr>`).join('')
    + '</tbody></table>';
  $('ph-dpupd').textContent = part && part.t ? DP.agoText(part.t) : '';
}

// ---- 7. Alerts ----------------------------------------------------------------------------------------------
function renderAlerts() {
  $('ph-asym').textContent = st.u;
  const mine = MA.metricAlerts().filter((a) => /^ph_/.test(a.metric));
  $('ph-alist').innerHTML = mine.length ? mine.map((a) => `<li><span>${esc(MA.titleOf(a))}</span><span class="ph-astate">${a.active ? (a.freq === 'every' ? 'Every time' : 'Only once') : 'Stopped'}</span></li>`).join('') : '<li class="ph-anone">No Phantom alerts yet.</li>';
}
function wireAlerts() {
  $('ph-aform').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target, metric = f.metric.value, value = f.value.value === '' ? NaN : Number(f.value.value);
    const b = MA.buildMetric({ metric, symbol: st.u, phside: f.side.value, value, freq: f.freq.value, message: '' });
    if (b.error) return toast(b.error);
    try { await MA.save(b, null); toast('Alert saved. It runs on our server and sends a push to your phone.', 'success'); renderAlerts(); }
    catch (err) { toast(err && err.signin ? 'Sign in to create alerts.' : err && err.full ? 'You have ' + err.full + ' metric alerts, the most we keep. Delete one first.' : 'Could not save the alert. Try again.'); }
  };
  $('ph-aform').metric.onchange = (e) => { const p = e.target.value === 'ph_premium'; const v = $('ph-aform').value; v.min = p ? 10000 : 0.5; v.step = p ? 1000 : 0.1; v.value = p ? 500000 : 2; $('ph-avl').textContent = p ? 'Premium in one minute, $' : 'Vol/OI at least'; };
  MA.onChange(renderAlerts);
}
function toast(m, t) { try { if (window.showToast) window.showToast(t || 'info', m); } catch (e) {} }

// ---- canvas helpers (theme colours from CSS) ------------------------------------------------------------
function css(el, n, fb) { return (getComputedStyle(el).getPropertyValue(n) || '').trim() || fb; }
function setup(c) {
  const r = c.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1), w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
  if (c.width !== w * dpr || c.height !== h * dpr) { c.width = w * dpr; c.height = h * dpr; }
  const x = c.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, w, h);
  x.font = '11px ' + css(c, '--oc-mono', 'ui-monospace, monospace'); x.textBaseline = 'middle';
  return { x, w, h, P: { pos: css(c, '--oc-pos', '#03c988'), neg: css(c, '--oc-neg', '#ff6369'), teal: css(c, '--oc-teal', '#00adb5'), ink3: css(c, '--oc-t3', '#888'), grid: css(c, '--oc-hair', 'rgba(255,255,255,.08)'), axis: css(c, '--oc-hair2', 'rgba(255,255,255,.16)') } };
}
function text(x, s, px, py, col, align) { x.fillStyle = col; x.textAlign = align || 'left'; x.fillText(s, px, py); }
function niceTicks(lo, hi, n) {
  const span = hi - lo || 1, raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag, step = (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * mag, out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-6; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

// ---- boot ---------------------------------------------------------------------------------------------------
function boot() {
  bar(); wireWhales(); wireAlerts();
  $('ph-sides').onclick = (e) => { const b = e.target.closest('button[data-s]'); if (b) { st.side = b.dataset.s; renderBoard(); } };
  $('ph-tprev').onclick = () => { st.tideDay++; drawTide(); };
  $('ph-tnext').onclick = () => { st.tideDay--; drawTide(); };
  $('ph-dclose').onclick = () => { $('ph-drill').hidden = true; };
  let rz = 0; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { drawTide(); if (st.drill) $('ph-dbody').querySelectorAll('canvas[data-d]').forEach((cv) => drawDrill(cv, st.drill[+cv.dataset.d])); }, 120); }, { passive: true });
  new MutationObserver(() => { drawTide(); if (st.drill) $('ph-dbody').querySelectorAll('canvas[data-d]').forEach((cv) => drawDrill(cv, st.drill[+cv.dataset.d])); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  setInterval(() => { if (document.visibilityState === 'visible' && !st.locked && st.board && st.board.day === todayEt()) { getPh('summary', { day: st.day }).then((s) => { st.summary = s; }).catch(() => {}).then(() => loadSym(false)); } }, REFRESH_MS);
  setInterval(meta, 5000);
  loadAll();
  window.__stkPhantom = { st, openDrill, P };
}
boot();
