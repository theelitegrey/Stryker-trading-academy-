// TradeZoro — Charts "Symbol info" panel (right icon bar; phones: a sheet). Own file, own mount.
// Owner-approved 2026-10-14 (InsightSentry symbol info). Shows, for the chart's futures symbol: contract
// specs (tick, point value, exchange, currency, front contract, all-time high / low), the roll calendar
// ("expires in X days", next contracts) and the trading session (hours, early closes, holidays).
// Data: book-recorder GET /scan?part=syminfo (gzip JSON, x-scan-gzip: 1), filled once a day by
// workers/book-recorder/info-feeder/info_feeder.py. One fetch per page load, memoised 1 h.
// Futures only: stocks are not charted here. Other symbols get a short note. Replay-safe: the panel
// shows static facts and the calendar counts from today's date, nothing from the future of a replay.
// Shares the Watchlist slot (opening it closes the Watchlist / News panels, as chart-news.js does).
// Depends on: vela-chart.js (ws.active.symbol, ws.on), chart-watchlist.js (.stkw-rail, .stkw-host).
const API = 'https://book-recorder.theelitegrey.workers.dev/scan?part=syminfo';
const PHONE_MAX = 700;
const LS_OPEN = 'stkin_open';
// chart symbol root (micros included) -> info key
const ROOTS = { NQ: 'NQ', MNQ: 'NQ', ES: 'ES', MES: 'ES', YM: 'YM', MYM: 'YM', RTY: 'RTY', M2K: 'RTY', GC: 'GC', MGC: 'GC', SI: 'SI', SIL: 'SI', CL: 'CL', MCL: 'CL', NG: 'NG', ZN: 'ZN', ZB: 'ZB', '6E': '6E' };
const INDEX_ROOTS = ['NQ', 'ES', 'YM', 'RTY'];
const MICRO = { MNQ: 'Micro of NQ', MES: 'Micro of ES', MYM: 'Micro of YM', M2K: 'Micro of RTY', MGC: 'Micro of GC', SIL: 'Micro of SI', MCL: 'Micro of CL' };
const IC = {
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><circle cx="12" cy="7.6" r=".6" fill="currentColor"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>'
};
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ---- pure helpers (tested in tools/tests/chart-symbol-info.test.mjs) ----
export function rootOf(symbol) {
  const t = String(symbol || '').split(':').pop().toUpperCase();
  const m = /^([A-Z0-9]{1,4}?)(?:1!|2!|[FGHJKMNQUVXZ]\d{1,4})$/.exec(t);
  const r = m ? m[1] : t;
  return { root: r, key: ROOTS[r] || '', micro: MICRO[r] || '' };
}
export function ymdToDate(s) { s = String(s); return new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8))); }
export function fmtYmd(s) { const d = ymdToDate(s); return d.getUTCDate() + ' ' + MON[d.getUTCMonth()] + ' ' + d.getUTCFullYear(); }
export function daysUntil(ymd, nowMs) {
  const n = new Date(nowMs);
  const today = Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate());
  return Math.round((ymdToDate(ymd).getTime() - today) / 86400000);
}
export function inDays(n) { return n <= 0 ? 'today' : n === 1 ? 'in 1 day' : 'in ' + n + ' days'; }
// "1700-1600" -> "17:00 - 16:00"
export function fmtHours(h) {
  const m = /^(\d{2})(\d{2})-(\d{2})(\d{2})/.exec(String(h || ''));
  return m ? m[1] + ':' + m[2] + ' - ' + m[3] + ':' + m[4] : String(h || '');
}
export function fmtBig(v) { return typeof v === 'number' && isFinite(v) ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—'; }
export function agoText(t, nowMs) {
  if (!t) return '';
  const h = Math.floor((nowMs / 1000 - t) / 3600);
  return h < 1 ? 'Updated within the hour' : h < 24 ? 'Updated ' + h + ' h ago' : 'Updated ' + Math.floor(h / 24) + ' days ago';
}
// The facts to show for one futures entry. Pure: entry + now -> { specs:[[k,v]], roll:[[k,v]], contracts:[...], session:[[k,v]] }
export function factsOf(e, key, micro, nowMs) {
  const specs = [['Name', e.name || key], ['Exchange', e.ex || '—'], ['Currency', e.cur || '—'],
    ['Tick size', e.tick != null ? String(e.tick) : '—'], ['Point value', e.pv != null ? '$' + fmtBig(e.pv) + ' per point' : '—']];
  if (e.tick != null && e.pv != null) specs.push(['Tick value', '$' + fmtBig(e.tick * e.pv)]);
  if (micro) specs.push(['This chart', micro]);
  specs.push(['Front contract', e.contract || '—']);
  if (e.under) specs.push(['Tracks', e.under.split(':').pop()]);
  if (e.ath != null) specs.push(['All-time high', fmtBig(e.ath) + (e.athDay ? ' (' + fmtYmdTs(e.athDay) + ')' : '')]);
  if (e.atl != null) specs.push(['All-time low', fmtBig(e.atl)]);
  if (e.avgVol) specs.push(['Average volume', fmtBig(e.avgVol)]);
  const roll = [], contracts = (e.roll || []).slice(0, 6);
  if (contracts.length) {
    const d = daysUntil(contracts[0].d, nowMs);
    roll.push(['Front contract expires', fmtYmd(contracts[0].d) + ' (' + inDays(d) + ')']);
    if (INDEX_ROOTS.includes(key)) {
      const r = d - 8;
      roll.push(['Typical roll', r <= 0 ? 'about now (index futures usually roll 8 days before expiry)' : inDays(r) + ' (index futures usually roll 8 days before expiry)']);
    }
    roll.push(['Next contract', contracts[1] ? contracts[1].c + ', ' + fmtYmd(contracts[1].d) : '—']);
  }
  const s = e.session || {}, session = [];
  if (s.hours) session.push(['Hours', fmtHours(s.hours) + (s.tz ? ' ' + s.tz.split('/').pop().replace('_', ' ') + ' time' : '')]);
  if (s.desc) session.push(['Session', s.desc]);
  (s.early || []).slice(0, 4).forEach((x) => session.push(['Early close', fmtYmd(x.d) + ', ' + String(x.end).replace(/^(\d{2})(\d{2}).*/, '$1:$2')]));
  if ((s.hol || []).length) session.push(['Next holidays', s.hol.slice(0, 4).map(fmtYmd).join(', ')]);
  return { specs, roll, contracts, session };
}
function fmtYmdTs(sec) { const d = new Date(sec * 1000); return d.getUTCDate() + ' ' + MON[d.getUTCMonth()] + ' ' + d.getUTCFullYear(); }

async function loadInfo() {
  const r = await fetch(API);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  if (r.headers.get('x-scan-gzip') === '1' && typeof DecompressionStream === 'function') return new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).json();
  return r.json();
}
let memo = null;
export function getInfo() {
  if (memo && Date.now() - memo.at < 3600e3) return memo.p;
  const p = loadInfo();
  memo = { at: Date.now(), p };
  p.catch(() => { if (memo && memo.p === p) memo = null; });
  return p;
}

function el(tag, attrs, kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else if (k === 'html') n.innerHTML = v; else n.setAttribute(k, v === true ? '' : v);
  }
  (kids || []).forEach((c) => c && n.appendChild(c));
  return n;
}
const svg = (p, s) => '<svg width="' + (s || 18) + '" height="' + (s || 18) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>';

export function mountSymbolInfo(ws) {
  if (!ws || document.getElementById('stkin')) return null;
  const host = document.querySelector('.stkchart-panel.stkw-host') || document.querySelector('.stkchart-panel');
  if (!host) return null;
  const isPhone = () => window.innerWidth <= PHONE_MAX;
  const activeSym = () => { try { return ws.active.symbol; } catch (e) { return ''; } };
  let open = false, data = null, err = '';

  const railBtn = el('button', { type: 'button', class: 'stkw-railbtn stkin-railbtn', title: 'Symbol info', 'aria-label': 'Symbol info', 'aria-pressed': 'false', html: svg(IC.info) });
  const closeBtn = el('button', { type: 'button', class: 'stkw-ib stkin-close', title: 'Close', 'aria-label': 'Close symbol info', html: svg(IC.close) });
  const title = el('span', { class: 'stkin-title', text: 'Symbol info' });
  const head = el('div', { class: 'stkin-hd' }, [title, el('span', { class: 'stkin-sp' }), closeBtn]);
  const body = el('div', { class: 'stkin-body', 'aria-live': 'polite' });
  const foot = el('p', { class: 'stkin-foot', text: 'Contract facts from the exchange data feed, refreshed daily. The typical roll date is a market convention, not a guarantee. Education only. Not financial advice.' });
  const panel = el('aside', { class: 'stkin', id: 'stkin', 'aria-label': 'Symbol info', hidden: true }, [head, body, foot]);
  host.appendChild(panel);
  const phoneBtn = el('button', { type: 'button', class: 'stkc-btn stkin-phonebtn', title: 'Symbol info', 'aria-label': 'Symbol info', html: svg(IC.info, 16) + '<span class="stkc-btn-l">Info</span>' });
  const barR = document.querySelector('#stkc-bar .stkc-bar-r');
  if (barR) { const nb = barR.querySelector('.stknw-phonebtn') || barR.querySelector('.stkw-phonebtn'); barR.insertBefore(phoneBtn, nb ? nb.nextSibling : barR.firstChild); }

  function placeRail() {
    const rail = document.querySelector('.stkw-rail');
    if (!rail) return false;
    if (railBtn.parentNode !== rail) {
      const after = rail.querySelector('.stknw-railbtn') || rail.querySelector('.stkw-railbtn');
      rail.insertBefore(railBtn, after ? after.nextSibling : rail.firstChild);
    }
    return true;
  }
  if (!placeRail()) {
    const mo = new MutationObserver(() => { if (placeRail()) mo.disconnect(); });
    mo.observe(host, { childList: true, subtree: true });
    setTimeout(() => mo.disconnect(), 30000);
  }

  function closeOthers() {
    if (host.classList.contains('stkw-open')) { const b = document.querySelector('.stkw .stkw-close'); if (b) b.click(); }
    if (host.classList.contains('stknw-open') && window.__stkNews) window.__stkNews.close();
  }
  function section(name, rows) {
    if (!rows.length) return null;
    return el('section', { class: 'stkin-sec' }, [el('h3', { class: 'stkin-h', text: name }),
      el('dl', { class: 'stkin-dl' }, rows.map((r) => el('div', { class: 'stkin-r' }, [el('dt', { text: r[0] }), el('dd', { text: r[1] })])))]);
  }
  function render() {
    body.textContent = '';
    const sym = activeSym();
    const { root, key, micro } = rootOf(sym);
    title.textContent = 'Symbol info' + (root ? ' · ' + root : '');
    if (err) { body.appendChild(el('p', { class: 'stkin-note', text: err })); return; }
    if (!data) { body.appendChild(el('p', { class: 'stkin-note', text: 'Loading…' })); return; }
    const e = key && data.syms && data.syms[key];
    if (!e || e.kind !== 'fut') {
      body.appendChild(el('p', { class: 'stkin-note', text: 'No contract info for this symbol yet. Symbol info covers the main futures: NQ, ES, YM, RTY, GC, SI, CL, NG, ZN, ZB, 6E and their micros.' }));
      return;
    }
    const f = factsOf(e, key, micro, Date.now());
    [section('Contract', f.specs), section('Roll calendar', f.roll)].forEach((s) => s && body.appendChild(s));
    if (f.contracts.length > 1) {
      body.appendChild(el('ul', { class: 'stkin-cl', 'aria-label': 'Upcoming contracts' }, f.contracts.map((c) => el('li', {}, [el('b', { text: c.c }), el('span', { text: fmtYmd(c.d) })]))));
    }
    const s = section('Trading session', f.session); if (s) body.appendChild(s);
    body.appendChild(el('p', { class: 'stkin-upd', text: agoText(data.t, Date.now()) }));
  }
  function setOpen(v) {
    open = !!v;
    if (open) closeOthers();
    panel.hidden = !open;
    host.classList.toggle('stkin-open', open);
    document.documentElement.classList.toggle('stkin-sheet', open && isPhone());
    railBtn.setAttribute('aria-pressed', String(open));
    railBtn.classList.toggle('on', open);
    phoneBtn.classList.toggle('on', open);
    if (!isPhone()) { try { if (open) localStorage.setItem(LS_OPEN, '1'); else localStorage.removeItem(LS_OPEN); } catch (e) {} }
    if (open) { render(); if (!data) getInfo().then((d) => { data = d; err = ''; render(); }, () => { err = 'Symbol info is temporarily unavailable. Try again in a minute.'; render(); }); }
    requestAnimationFrame(() => { try { window.dispatchEvent(new Event('resize')); } catch (e) {} });
  }
  railBtn.addEventListener('click', () => setOpen(!open));
  phoneBtn.addEventListener('click', (e) => { e.stopPropagation(); setOpen(!open); });
  closeBtn.addEventListener('click', () => setOpen(false));
  // Watchlist or News opening closes this panel
  document.addEventListener('click', (e) => {
    if (!open || !e.target.closest) return;
    if (e.target.closest('.stkw-railbtn:not(.stkin-railbtn), .stkw-phonebtn, .stknw-phonebtn')) setTimeout(() => { if (host.classList.contains('stkw-open') || host.classList.contains('stknw-open')) setOpen(false); }, 0);
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open && isPhone()) setOpen(false); });
  window.addEventListener('resize', () => document.documentElement.classList.toggle('stkin-sheet', open && isPhone()), { passive: true });
  try { ws.on('state:changed', () => { if (open) render(); }); } catch (e) {}
  try { if (!isPhone() && localStorage.getItem(LS_OPEN) === '1') setTimeout(() => setOpen(true), 500); } catch (e) {}
  const api = { open: () => setOpen(true), close: () => setOpen(false), get isOpen() { return open; } };
  window.__stkSymInfo = api;
  return api;
}
