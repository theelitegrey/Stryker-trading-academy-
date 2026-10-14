// TradeZoro — economic calendar: InsightSentry rows + earnings / dividends / IPO tabs.
// ES module, loaded lazily by assets/econ-calendar.js (classic script) with import().
// Owner-approved 2026-10-14 (news + economic calendar job, B1 + B3). Free for everyone.
//
// DATA: book-recorder /cal?kind=events|earnings|dividends|ipos (edge-cached; the server feeder
// is the only caller of the data vendor). The page keeps assets/econ-calendar.json as the FALLBACK
// (and for its "why it matters" notes and central-bank cards): if /cal does not answer with rows
// the page renders the JSON exactly as before.
// Education only. Not financial advice.

export const RECORDER = 'https://book-recorder.theelitegrey.workers.dev';
export const ZONES = { local: undefined, ny: 'America/New_York', ist: 'Asia/Kolkata' };

// ---- time zones (unit-tested) -------------------------------------------------------------
export function fmtTime(ms, mode) {
  return new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: ZONES[mode] });
}
export function dayKey(ms, mode) {
  return new Date(ms).toLocaleDateString('en-CA', { timeZone: ZONES[mode] });
}
export function countdown(ms) {
  if (!(ms > 0)) return null;
  const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  if (d > 0) return d + 'd ' + h + 'h';
  if (h > 0) return h + 'h ' + String(m).padStart(2, '0') + 'm ' + String(ss).padStart(2, '0') + 's';
  return m + 'm ' + String(ss).padStart(2, '0') + 's';
}

// ---- events -> the page's own row shape -------------------------------------------------
const PREFIX = { '$': 1, '€': 1, '£': 1 };
const val = (v, u) => (v === undefined || v === null ? undefined : (u && PREFIX[u] ? u + v : String(v) + (u && !PREFIX[u] ? (u === '%' ? '%' : ' ' + u) : '')));
export const FLAGS = { USD: '🇺🇸', EUR: '🇪🇺', GBP: '🇬🇧', JPY: '🇯🇵', CNY: '🇨🇳', CAD: '🇨🇦', AUD: '🇦🇺', NZD: '🇳🇿', CHF: '🇨🇭', INR: '🇮🇳', KRW: '🇰🇷', BRL: '🇧🇷', MXN: '🇲🇽', TRY: '🇹🇷', ZAR: '🇿🇦', SGD: '🇸🇬' };
const words = (s) => new Set(String(s).toLowerCase().match(/[a-z]{4,}/g) || []);
// items: /cal events rows; jsonEvents: the file's rows (their notes are kept when the same release).
export function mapEvents(items, jsonEvents) {
  const notes = (jsonEvents || []).filter((e) => e.note);
  return (items || []).map((e) => {
    const out = { at: new Date(e.t).toISOString(), cur: e.cur || e.c, country: e.c, impact: e.i, event: e.ti, allday: e.i === 'holiday' };
    const a = val(e.a, e.u), f = val(e.f, e.u), p = val(e.p, e.u);
    if (a !== undefined) out.actual = a;
    if (f !== undefined) out.forecast = f;
    if (p !== undefined) out.previous = p;
    if (e.i === 'high' || e.i === 'medium') {
      const w = words(e.ti);
      const n = notes.find((x) => x.cur === out.cur && Math.abs(Date.parse(x.at) - e.t) <= 30 * 60000 && [...words(x.event)].some((k) => w.has(k)));
      if (n) out.note = n.note;
    }
    return out;
  });
}
// The extra rows only the file knows (earnings lines etc.) are NOT carried: the Earnings tab is the IS one.
export function currenciesOf(events) {
  const seen = new Map();
  for (const e of events) if (e.impact !== 'holiday' && (e.impact === 'high' || e.impact === 'medium') && !seen.has(e.cur)) seen.set(e.cur, { code: e.cur, name: e.cur, flag: FLAGS[e.cur] || '' });
  return [...seen.values()].sort((a, b) => (a.code === 'USD' ? -1 : b.code === 'USD' ? 1 : a.code.localeCompare(b.code)));
}
export function countriesOf(events) {
  return [...new Set(events.filter((e) => e.impact === 'high' || e.impact === 'medium').map((e) => e.country).filter(Boolean))].sort();
}
export async function fetchCal(kind, timeoutMs) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs || 7000);
  try {
    const r = await fetch(RECORDER + '/cal?kind=' + kind, { credentials: 'omit', signal: ac.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) { return null; } finally { clearTimeout(t); }
}

// ---- earnings / dividends / IPO tabs (B3) -------------------------------------------------
const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const money = (n) => (n === null || n === undefined ? '' : Math.abs(n) >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : String(n));
const num = (n, d) => (n === null || n === undefined || !Number.isFinite(Number(n)) ? '' : Number(n).toFixed(d === undefined ? 2 : d));
const tick = (code) => String(code || '').split(':').pop();
export const TABS = [['econ', 'Economic'], ['earnings', 'Earnings'], ['dividends', 'Dividends'], ['ipos', 'IPOs']];
// scope: 'us' | 'all' ; mode: tz mode ; range: 'ahead' | 'past' | 'all' (today onward / last 7 days / everything)
export function filterCorp(items, o) {
  const today = dayKey(Date.now(), o.mode);
  const back = dayKey(Date.now() - 7 * 86400000, o.mode);
  return (items || []).filter((x) => {
    if (o.scope === 'us' && x.c !== 'US' && x.c !== 'UNITED STATES') return false;
    const k = dayKey(x.t, o.mode);
    if (o.range === 'ahead') return k >= today;
    if (o.range === 'past') return k >= back && k < today;
    return true;
  }).sort((a, b) => (o.range === 'past' ? b.t - a.t : a.t - b.t));
}
function dayHead(key, n, mode) {
  const d = new Date(key + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' });
  return '<header class="ec-day-head"><h3>' + esc(d) + '</h3><span class="ec-daycount">' + n + ' ' + (n === 1 ? 'company' : 'companies') + '</span></header>';
}
export function renderCorp(kind, items, o) {
  const list = filterCorp(items, o);
  if (!list.length) return '<div class="ec-empty"><b>Nothing in this window.</b><p>Try “All dates” or the other scope.</p></div>';
  const heads = {
    earnings: ['Time', 'Company', 'EPS actual', 'EPS est.', 'Revenue', 'Rev. est.'],
    dividends: ['Ex-date', 'Company', 'Dividend', 'Yield', 'Pay date'],
    ipos: ['Time', 'Company', 'Exchange', 'Status', 'Price']
  }[kind];
  const row = (x) => {
    const tc = '<td class="ec-time"><span class="ec-time-v">' + esc(kind === 'dividends' ? '' : fmtTime(x.t, o.mode)) + '</span></td>';
    const co = '<td class="ec-name"><span class="ec-name-v">' + esc(x.n) + '</span><span class="ec-tick">' + esc(tick(x.code)) + '</span></td>';
    if (kind === 'earnings') {
      const beat = x.done && x.eps != null && x.epsF != null ? (x.eps > x.epsF ? ' is-above' : x.eps < x.epsF ? ' is-below' : ' is-inline') : '';
      return '<tr class="ec-row is-earnings">' + tc + co +
        '<td class="ec-num ec-actual' + beat + '">' + (x.done && x.eps != null ? num(x.eps) : '<i>—</i>') + '</td>' +
        '<td class="ec-num ec-fc">' + (x.epsF != null ? num(x.epsF) : '<i>—</i>') + '</td>' +
        '<td class="ec-num">' + (x.done && x.rev != null ? money(x.rev) : '<i>—</i>') + '</td>' +
        '<td class="ec-num ec-fc">' + (x.revF != null ? money(x.revF) : '<i>—</i>') + '</td></tr>';
    }
    if (kind === 'dividends') {
      return '<tr class="ec-row">' + '<td class="ec-time"><span class="ec-time-v">' + esc(dayKey(x.t, o.mode).slice(5)) + '</span></td>' + co +
        '<td class="ec-num ec-actual">' + (x.amt != null ? num(x.amt, 4) : '<i>—</i>') + '</td>' +
        '<td class="ec-num ec-fc">' + (x.y != null ? num(x.y) + '%' : '<i>—</i>') + '</td>' +
        '<td class="ec-num ec-prev">' + (x.pay ? esc(dayKey(x.pay, o.mode).slice(5)) : '<i>—</i>') + '</td></tr>';
    }
    return '<tr class="ec-row">' + tc + co + '<td class="ec-num ec-fc">' + esc(x.x || '') + '</td><td class="ec-num">' + esc(x.st || '') + '</td><td class="ec-num ec-fc">' + (x.px != null ? num(x.px) : '<i>—</i>') + '</td></tr>';
  };
  const groups = [];
  list.forEach((x) => { const k = dayKey(x.t, o.mode); const g = groups[groups.length - 1]; if (g && g.k === k) g.r.push(x); else groups.push({ k, r: [x] }); });
  const capped = groups.slice(0, 31);
  return capped.map((g) => '<section class="ec-day">' + dayHead(g.k, g.r.length, o.mode) +
    '<div class="ec-scroll"><table class="ec-table ec-corp"><caption class="sr-only">' + esc(kind) + '</caption><thead><tr>' +
    heads.map((h, i) => '<th scope="col"' + (i > 1 ? ' class="ec-num"' : '') + '>' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' +
    g.r.slice(0, 120).map(row).join('') + '</tbody></table></div></section>').join('');
}
