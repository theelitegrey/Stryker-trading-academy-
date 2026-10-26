// TradeZoro — Charts: "TradeZoro GEX Levels" indicator (charts.html) — ES module
// Depends on: assets/vela-chart.js (calls installGexLevels(Core) BEFORE the workspace is built,
// so a persisted session can restore it); Vela 0.6.17's plugin SDK (registerNativeIndicator,
// registerRendererLayer, registerStatePersistence), passed in as `Core`; the public, read-only
// GEX API GET /api/gex/levels/:name?dte=N (functions/api/gex/*, NOT edited here);
// assets/plan-limits.js (window.strykerPlanTier, optional).
//
// WHAT IT DOES (Owner order 2026-10-07: "one indicator for charts module, when selected shows
// GEX levels"; parity order build 461: "the gex page has more stuff like Value area high/low"):
// draws every line the GEX page chart draws (assets/gex.js collectLines, read only) with the
// same names, colours and line styles: CALL WALL, ZERO GAMMA, PUT WALL, IV +68% / IV -68%, and
// the market levels pVAH, pPOC, pVAL, ONH, ONL (on by default, as on the GEX page). Optional
// extras: the GEX page's text-panel levels (IV ±80%, prior RTH high/low, prior close, RTH
// open/high/low), a shaded 68% band, and the next 3 biggest-|GEX| strikes from the ladder.
// Labels of levels within a few px of each other merge into one tag ("pPOC · ZERO GAMMA").
//
// SYMBOL MAPPING
//   SPX, SPY (index/ETF symbols)   -> that market's own levels, as published.
//   ES / MES futures                -> SPX levels converted to that contract with the API's
//                                      own futures block (futures.ES / futures.MES .levels;
//                                      ladder strikes use the same ratio + basis).
//   NQ / MNQ futures, QQQ           -> QQQ levels (converted with futures.NQ / futures.MNQ).
//   anything else                   -> a small note, nothing drawn.
//
// PLAN: the same split as the GEX page (assets/plan-limits.js applyGex): Free = SPX, 0DTE, no
// strike table; Pro = every symbol and expiry. So Free members get SPX and ES/MES (SPX-derived)
// levels at 0DTE; NQ/MNQ/QQQ/SPY show an "Unlock NQ GEX with Pro" pill (/#pricing) instead, and
// the strikes extra stays off. Client-side only, like the GEX page (the API itself is public).
// Unknown plan after a few seconds fails open, as plan-guard.js does.
//
// DATA: fetched every 5 minutes while the page is visible (paused when hidden), cached per
// API market + expiry and shared by every chart cell. The lines are painted by a renderer
// layer from the last pushed data only: no network, DOM or layout reads per frame or per
// mouse move. The status reads "GEX updated X min ago" (from the API's market data time /
// fetched_at). Never "live" / "real-time". Education only. Not financial advice.
//
// RANKED STRIKES + PREVIOUS DAYS (Owner order 2026-10-16, assets/chart-gex-ladder-core.js, pure):
//   "Top 10 ranked" (off by default): the ten biggest |GEX| strikes, each a thin dotted line with a
//   short tag "<rank> <role> <price>" and a small size bar under the tag; roles Support, Resistance,
//   Magnet, Accelerant, plus Flip on the zero-gamma line. Roles describe where dealer hedging may
//   lean; they are not signals. Uses the ladder the API already returned (no extra request).
//   "Previous days" (on, 2 days, setting 0-5): the two biggest strikes of each of the last N
//   recorded sessions as faded dotted lines tagged "10/15 · $1.6B", converted with today's
//   ratio/basis. Sessions come from the GEX history (assets/gex-heat-core.js), cached; a day with
//   fewer than MIN_SNAPS snapshots is skipped as incomplete. In bar replay only days BEFORE the
//   replay clock's Eastern-time day are used (no lookahead). Free: SPX / ES only (plan above).
//   Plan: unchanged, Free = SPX/ES at 0DTE, Pro = every symbol (futures GEX is never free).
//
// BAR REPLAY (2026-10-14): levels come from the recorded GEX history as of the replay clock
// (replayPayload below), never from the API's current levels. Before the history begins:
// "No GEX history for this time".
//
// WALLS OVER TIME (Owner report 2026-10-26, assets/chart-gex-walls-core.js): Call Wall, Put Wall and
// Zero Gamma are drawn as STEP lines from the recorded GEX history (0DTE / 1DTE), each segment where
// the level was at that time, instead of one flat line at today's value; the last segment runs to the
// right edge with the label. Walls are HELD on their strike while price is testing them (holdWalls),
// so the label no longer jumps to the next strike as price arrives. When a wall moves, the old one
// stays as a faded dotted "prev CW" / "prev PW" line for the rest of that session. Bar replay draws
// only the history up to the replay clock. Off-hours (cash closed, futures open) the futures
// conversion is anchored to the chart futures during the chain's last minutes, so the converted
// walls no longer drift with the overnight / Sunday futures move. No extra GEX vendor request: the
// history comes from our recorder (the same /gex-history the heatmap, replay and previous days use).
//
// BASIS RE-ANCHOR (GEX audit, 2026-10-13): the API converts index/ETF levels to futures with
// basis = its own futures quote - ratio x spot, but that futures quote is about 10 minutes older
// than the options chain (futures_age_min 10), so every converted level was off by however far
// the futures moved in those 10 minutes (measured 1-30 NQ points, 0.5-5 ES points during RTH).
// While the market is open (and, since 2026-10-26, while it is shut: anchorTime), the futures-converted levels are shifted by
//   shift = chart futures price at the options time (close of the last 1-minute bar completed by
//           then, from /api/chart/bars, the same source the futures chart draws) - the API's
//           futures price
// i.e. basis = chart futures at the options time - ratio x spot. Ratio and the index levels are
// unchanged. Off-hours, or when no 1-minute bar matches the options time, the API's own
// conversion is used as before. Session levels (pVAH, ONH ...) are futures prices already and
// are never shifted.

import { rtHeadersReady } from './rt-access.js?v=660';
import { ladderFromApi, ladderFromSnap, rankStrikes, previousDays, dayTop, dayTag } from './chart-gex-ladder-core.js?v=660';
import { holdWalls, basisSeries, stepsFor, previousWall, lastSessionBasis } from './chart-gex-walls-core.js?v=660';

const TYPE = 'stk_gex';
const FLASH = 'stk_gexflash';
const MIN_SNAPS = 10;          // a recorded session with fewer snapshots is not used as a "previous day"
const PREV_TOP = 2;            // biggest strikes drawn per previous day
const API = '/api/gex/levels/';
const REFRESH_MS = 5 * 60 * 1000;
const TIER_WAIT_MS = 8000;
const PRICING = '/#pricing';
const BARS_API = '/api/chart/bars/';
const ANCHOR_GAP_S = 120;     // the 1-minute bar used must have closed within 2 min before the options time
const ANCHOR_MAX_PCT = 0.03;  // a shift above 3% of price is treated as bad data and ignored
const ANCHOR_MAX_PCT_CLOSED = 0.08;  // market shut: the futures can run further from the close (weekend gap)
const RANK_COL = { pos: '#03c988', neg: '#ee4276', mag: '#f4f6fa' };   // mint / magenta from the GEX ramps, magnet = bright
export const GEX_COLORS = { call: '#ef4444', zero: '#f59e0b', put: '#22c55e', strike: '#94a3b8', em: '#8b7cf6',
  iv: '#8b7cf6', va: '#38bdf8', on: '#64748b', rth: '#8b7cf6' };

// Every level the GEX page (assets/gex.js) can show, read-only parity list (build 461):
//   chart lines (collectLines): CALL WALL, ZERO GAMMA, PUT WALL, IV +68% / IV -68%, and with
//   "Market levels: ON" pVAH, pPOC, pVAL, ONH, ONL (DATA.session[fut]).
//   text panels only (renderLevels / renderMarket): IV 80% range, PRIOR RTH HIGH/LOW,
//   PRIOR CLOSE, RTH OPEN, RTH HIGH, RTH LOW (and SPOT, which the candles already show).
// The chart ones are on by default with the GEX page's names, colours and line styles; the
// text-panel ones are optional extras (off). Session levels exist for futures charts only
// (the API computes them for ES/MES/NQ/MNQ).
// src: 'lv' = GEX level (futures-converted on futures charts), 'ses' = DATA.session[fut].
export const LEVEL_DEFS = [
  { id: 'call', on: 'showCall', col: 'callColor', label: 'CALL WALL', f: 'call_wall', src: 'lv', dash: 'solid', w: 2 },
  { id: 'zero', on: 'showZero', col: 'zeroColor', label: 'ZERO GAMMA', f: 'zero_gamma', src: 'lv', dash: 'dashed', w: 2 },
  { id: 'put', on: 'showPut', col: 'putColor', label: 'PUT WALL', f: 'put_wall', src: 'lv', dash: 'solid', w: 2 },
  { id: 'ivhi', on: 'showIv', col: 'ivColor', label: 'IV +68%', f: 'iv68_hi', src: 'lv', dash: 'dashed', w: 1 },
  { id: 'ivlo', on: 'showIv', col: 'ivColor', label: 'IV -68%', f: 'iv68_lo', src: 'lv', dash: 'dashed', w: 1 },
  { id: 'iv80hi', on: 'showIv80', col: 'ivColor', label: 'IV +80%', f: 'iv80_hi', src: 'lv', dash: 'dotted', w: 1 },
  { id: 'iv80lo', on: 'showIv80', col: 'ivColor', label: 'IV -80%', f: 'iv80_lo', src: 'lv', dash: 'dotted', w: 1 },
  { id: 'vah', on: 'showVah', col: 'vahColor', label: 'pVAH', f: 'prior_vah', src: 'ses', dash: 'dashed', w: 1 },
  { id: 'poc', on: 'showPoc', col: 'pocColor', label: 'pPOC', f: 'prior_poc', src: 'ses', dash: 'solid', w: 1 },
  { id: 'val', on: 'showVal', col: 'valColor', label: 'pVAL', f: 'prior_val', src: 'ses', dash: 'dashed', w: 1 },
  { id: 'onh', on: 'showOnh', col: 'onhColor', label: 'ONH', f: 'overnight_high', src: 'ses', dash: 'dashed', w: 1 },
  { id: 'onl', on: 'showOnl', col: 'onlColor', label: 'ONL', f: 'overnight_low', src: 'ses', dash: 'dashed', w: 1 },
  { id: 'prth_hi', on: 'showPrth', col: 'rthColor', label: 'PRIOR RTH HIGH', f: 'prior_rth_high', src: 'ses', dash: 'dotted', w: 1 },
  { id: 'prth_lo', on: 'showPrth', col: 'rthColor', label: 'PRIOR RTH LOW', f: 'prior_rth_low', src: 'ses', dash: 'dotted', w: 1 },
  { id: 'pclose', on: 'showPclose', col: 'rthColor', label: 'PRIOR CLOSE', f: 'prior_close', src: 'ses', dash: 'dotted', w: 1 },
  { id: 'rth_open', on: 'showRthOpen', col: 'rthColor', label: 'RTH OPEN', f: 'rth_open', src: 'ses', dash: 'dotted', w: 1 },
  { id: 'rth_hi', on: 'showRth', col: 'rthColor', label: 'RTH HIGH', f: 'rth_high', src: 'ses', dash: 'dotted', w: 1 },
  { id: 'rth_lo', on: 'showRth', col: 'rthColor', label: 'RTH LOW', f: 'rth_low', src: 'ses', dash: 'dotted', w: 1 }
];

const G1 = 'GEX levels', G2 = 'Market levels', G3 = 'More session levels', G4 = 'Style', G5 = 'Ranked + previous days';
const tog = (key, title, defval, group, inline) => ({ key, title, type: 'bool', defval, group, inline });
const col = (key, defval, group, inline) => ({ key, title: '', type: 'color', defval, group, inline });
const SCHEMA = [
  { key: 'dte', title: 'Expiry (Pro: all)', type: 'string', defval: '0', options: ['0', '1', '7', '30'],
    tooltip: '0 = same day (0DTE), 1 = next day, 7 = one week, 30 = one month. The Free plan covers 0DTE.' },
  tog('showCall', 'Call wall', true, G1, 'call'), col('callColor', GEX_COLORS.call, G1, 'call'),
  tog('showZero', 'Zero gamma (flip)', true, G1, 'zero'), col('zeroColor', GEX_COLORS.zero, G1, 'zero'),
  tog('showPut', 'Put wall', true, G1, 'put'), col('putColor', GEX_COLORS.put, G1, 'put'),
  tog('showIv', 'IV ±68%', true, G1, 'iv'), col('ivColor', GEX_COLORS.iv, G1, 'iv'),
  tog('wallSteps', 'Walls over time (step lines)', true, G1),
  tog('prevWall', 'Faded previous wall (prev CW / PW)', true, G1),
  tog('showStrikes', 'Next 3 big strikes (Pro)', false, G1, 'strk'), col('strikeColor', GEX_COLORS.strike, G1, 'strk'),
  tog('showEm', 'Shade 68% band', false, G1, 'em'), col('emColor', GEX_COLORS.em, G1, 'em'),
  tog('showRanked', 'Ranked strikes (rank, role, size)', false, G5),
  { key: 'rankedCount', title: 'Ranked strikes shown', type: 'string', defval: '5', options: ['5', '10'], group: G5 },
  tog('showPrev', 'Previous days\u2019 big levels', true, G5),
  { key: 'prevDays', title: 'Previous days (0-5)', type: 'int', defval: 2, min: 0, max: 5, step: 1, group: G5 },
  tog('showVah', 'pVAH', true, G2, 'vah'), col('vahColor', GEX_COLORS.va, G2, 'vah'),
  tog('showPoc', 'pPOC', true, G2, 'poc'), col('pocColor', GEX_COLORS.va, G2, 'poc'),
  tog('showVal', 'pVAL', true, G2, 'val'), col('valColor', GEX_COLORS.va, G2, 'val'),
  tog('showOnh', 'ONH', true, G2, 'onh'), col('onhColor', GEX_COLORS.on, G2, 'onh'),
  tog('showOnl', 'ONL', true, G2, 'onl'), col('onlColor', GEX_COLORS.on, G2, 'onl'),
  tog('showIv80', 'IV ±80%', false, G3),
  tog('showPrth', 'Prior RTH high / low', false, G3),
  tog('showPclose', 'Prior close', false, G3),
  tog('showRthOpen', 'RTH open', false, G3),
  tog('showRth', 'RTH high / low', false, G3),
  { key: 'rthColor', title: 'Session level colour', type: 'color', defval: GEX_COLORS.rth, group: G3 },
  { key: 'labels', title: 'Level text labels', type: 'bool', defval: true, group: G4 },
  { key: 'labelMode', title: 'Label text', type: 'string', defval: 'name + chart price + option level', options: ['name only', 'name + chart price', 'name + chart price + option level'], group: G4 },
  { key: 'priceTags', title: 'Right price tags', type: 'bool', defval: true, group: G4 },
  { key: 'showStatus', title: 'Bottom updated text', type: 'bool', defval: true, group: G4 },
  { key: 'lineStyle', title: 'Line style', type: 'string', defval: 'as GEX page', options: ['as GEX page', 'solid', 'dashed', 'dotted'], group: G4 },
  { key: 'width', title: 'Line width (0 = as GEX page)', type: 'int', defval: 0, min: 0, max: 4, step: 1, group: G4 }
];

const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v, d) => (typeof v === 'string' && v !== '' ? v : d);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// ---- symbol -> GEX source ---------------------------------------------------------------
// Returns { api, fut|null, label, pro } or null when the symbol has no GEX levels.
export function gexSource(symbol, provider) {
  let ticker = String(symbol || ''), prov = String(provider || '');
  const m = /^([a-z]+):(.+)$/i.exec(ticker);
  if (m) { if (!prov) prov = m[1].toLowerCase(); ticker = m[2]; }
  const root = ticker.toUpperCase().replace(/[0-9]?!$/, '').replace(/^\^/, '');
  if (root === 'ES' || root === 'MES') return { api: 'SPX', fut: root, label: root + ' (from SPX)', pro: false };
  if (root === 'NQ' || root === 'MNQ') return { api: 'QQQ', fut: root, label: root + ' (from QQQ)', pro: true };
  if (prov === 'futures') return null;
  if (root === 'SPX' || root === 'SPXW') return { api: 'SPX', fut: null, label: 'SPX', pro: false };
  if (root === 'SPY') return { api: 'SPY', fut: null, label: 'SPY', pro: true };
  if (root === 'QQQ') return { api: 'QQQ', fut: null, label: 'QQQ', pro: true };
  return null;
}

// ---- API data -> level list ---------------------------------------------------------------
export function fmtLevel(v) {
  if (!isNum(v)) return '';
  return Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : v.toFixed(2);
}
// Pure: the levels to draw for one source, from one API response. opts = the indicator's inputs
// (show* keys; a missing key falls back to its schema default). Futures prices come from the
// API's own conversion (futures[fut].levels); ladder strikes use its ratio + basis; session
// levels come from data.session[fut] (already in futures prices).
const DEF_ON = Object.fromEntries(SCHEMA.filter((x) => x.type === 'bool').map((x) => [x.key, x.defval]));
// Pure: strike -> chart price for one source (index/ETF: as is; futures: ratio x strike + basis + shift).
export function convOf(data, src, shift) {
  if (!src || !src.fut) return (v) => v;
  const f = data && data.futures && data.futures[src.fut];
  if (!f || f.error) return () => null;
  const ratio = num(f.ratio, null), basis = num(f.basis, 0), sh = isNum(shift) ? shift : 0;
  return (v) => (ratio == null ? null : v * ratio + basis + sh);
}
export function buildLevels(data, src, opts, shift, extra) {
  opts = opts || {};
  const sh = src.fut && isNum(shift) ? shift : 0;
  const on = (k) => (typeof opts[k] === 'boolean' ? opts[k] : DEF_ON[k]);
  if (!data || data.error) return { err: 'GEX levels are not available right now.' };
  let conv = (v) => v, L, S = null;
  if (src.fut) {
    const f = data.futures && data.futures[src.fut];
    if (!f || f.error || !f.levels) return { err: 'No ' + src.fut + ' conversion in the GEX data right now.' };
    const ratio = num(f.ratio, null), basis = num(f.basis, 0);
    L = sh ? Object.fromEntries(Object.entries(f.levels).map(([k, v]) => [k, isNum(v) ? v + sh : v])) : f.levels;
    conv = (v) => (ratio == null ? null : v * ratio + basis + sh);
    const ses = data.session && data.session[src.fut];
    if (ses && !ses.error) S = ses;
  } else {
    const e = data.expected || {}, e68 = e['68%'] || [], e80 = e['80%'] || [];
    L = { call_wall: data.call_wall, put_wall: data.put_wall, zero_gamma: data.zero_gamma,
      iv68_lo: e68[0], iv68_hi: e68[1], iv80_lo: e80[0], iv80_hi: e80[1] };
  }
  // API values are shown as published (2 dp), the same numbers the GEX page prints.
  const r = (v) => (isNum(v) ? Math.round(v * 100) / 100 : null);
  const out = { lines: [], band: null, noSession: false };
  const srcNote = (raw) => (src.fut && isNum(raw) ? ' (' + src.api + ' ' + fmtLevel(Math.round(raw * 100) / 100) + ')' : '');
  for (const d of LEVEL_DEFS) {
    if (!on(d.on)) continue;
    if (d.src === 'ses') { if (!S) { out.noSession = true; continue; } }
    const v = d.src === 'ses' ? S[d.f] : L[d.f];
    if (!isNum(v)) continue;
    const note = (d.id === 'call' || d.id === 'zero' || d.id === 'put') ? srcNote(data[d.f]) : '';
    out.lines.push({ id: d.id, label: d.id === 'zero' && on('showRanked') ? 'ZERO GAMMA \u00b7 Flip' : d.label, price: r(v), note, col: d.col, dash: d.dash, w: d.w });
  }
  // Top 10 ranked strikes (ladder already in the response) and previous days' big levels (history).
  const rawSpot = isNum(data.spot) ? data.spot : (isNum(extra && extra.spot) ? extra.spot : null);
  if (on('showRanked') && rawSpot != null) {
    const rn = parseInt(str(opts.rankedCount, '5'), 10) === 10 ? 10 : 5;
    const ranked = rankStrikes(ladderFromApi(data), rawSpot, 10).slice(0, rn);
    ranked.forEach((x) => {
      const p = conv(x.strike);
      if (isNum(p)) out.lines.push({ id: 'rk' + x.rank, label: '#' + x.rank + ' ' + x.role, price: r(p), note: '', col: null, rgb: x.g < 0 ? RANK_COL.neg : (x.role === 'Magnet' ? RANK_COL.mag : RANK_COL.pos), dash: 'dotted', w: x.role === 'Magnet' ? 2 : 1, rank: x.rank, share: x.share, alpha: 0.35 + 0.55 * x.share, ranked: true });
    });
  }
  if (on('showPrev') && extra && Array.isArray(extra.prev)) {
    extra.prev.forEach((d, di) => d.top.forEach((x, i) => {
      const p = conv(x.strike);
      if (isNum(p)) out.lines.push({ id: 'pv' + di + '_' + i, label: dayTag(d.day, x.g), price: r(p), note: '', col: null, rgb: x.g < 0 ? RANK_COL.neg : RANK_COL.pos, dash: 'dotted', w: 1, alpha: 0.5, faint: true });
    }));
  }
  if (on('showEm') && isNum(L.iv68_lo) && isNum(L.iv68_hi)) out.band = { lo: r(L.iv68_lo), hi: r(L.iv68_hi) };
  if (on('showStrikes') && Array.isArray(data.ladder)) {
    const skip = new Set([data.call_wall, data.put_wall].filter(isNum));
    data.ladder.filter((x) => x && isNum(x.strike) && isNum(x.gex) && x.gex !== 0 && !skip.has(x.strike))
      .sort((a, b) => Math.abs(b.gex) - Math.abs(a.gex)).slice(0, 3)
      .forEach((x, i) => {
        const p = conv(x.strike);
        if (isNum(p)) out.lines.push({ id: 'strike' + i, label: 'GEX strike', price: r(p), note: src.fut ? ' (' + src.api + ' ' + fmtLevel(x.strike) + ')' : '', col: 'strikeColor', dash: 'dotted', w: 1 });
      });
  }
  out.shift = sh;
  return out;
}

// Pure: the futures shift for one API response. rows = 1-minute bars [[t, o, h, l, c, v], ...]
// (t = bar open, epoch s) from /api/chart/bars/<FUT>1!?tf=1. Returns the number of points to add
// to every futures-converted level, or null to keep the API's own conversion.
// Off-hours (wall fix 2026-10-26): cash shut, futures trading. The API still converts the last chain
// with basis = CURRENT futures quote - ratio x the frozen spot, so every converted level slid one
// for one with the overnight / Sunday futures move (Owner report: on Sun 25 Oct the MNQ call wall ran
// up to ~29,549 while price rallied into 29,345, then fell back to ~29,360). Outside cash hours the
// anchor time is the chain's own time (market.chain_ts): the futures price when that chain printed.
export function anchorTime(data) {
  const m = data && data.market;
  if (!m) return null;
  if (m.state === 'open') return num(m.options_ts, null);
  if (m.state === 'cash_closed' || m.state === 'closed') return num(m.chain_ts, null);
  return null;
}
export function anchorShift(data, fut, rows) {
  const f = data && data.futures && data.futures[fut];
  const m = data && data.market;
  if (!f || f.error || !f.levels || !m) return null;
  const apiFut = isNum(f.futures_price) ? f.futures_price : f.levels.spot;
  const t = anchorTime(data);
  const maxPct = m.state === 'open' ? ANCHOR_MAX_PCT : ANCHOR_MAX_PCT_CLOSED;
  if (!isNum(apiFut) || !t || !Array.isArray(rows) || !rows.length) return null;
  // The last 1-minute bar that had CLOSED by the options time (bar open + 60 s <= t): its close is
  // fixed, so every chart and every refresh gets the same shift for the same API response.
  let bar = null;
  for (const r of rows) { if (Array.isArray(r) && r[0] + 60 <= t) bar = r; else if (Array.isArray(r) && r[0] + 60 > t) break; }
  if (!bar || t - (bar[0] + 60) > ANCHOR_GAP_S || !isNum(bar[4])) return null;
  const shift = Math.round((bar[4] - apiFut) * 100) / 100;
  return Math.abs(shift) <= apiFut * maxPct ? shift : null;
}
// Shared per futures root + options time: { shift (number|null), at, p }.
const anchors = new Map();
function anchorKey(fut, data) { const f = (data.futures || {})[fut] || {}; return fut + ':' + num(anchorTime(data), 0) + ':' + num(f.futures_price, 0); }
export function gexAnchorState() { return [...anchors.entries()].map(([k, e]) => ({ k, shift: e.shift, at: e.at, pending: !!e.p, why: e.why || '' })); }
export function gexAnchor(fut, data) {
  if (!fut || !data || !isNum(anchorTime(data))) return null;
  const k = anchorKey(fut, data);
  const e = anchors.get(k);
  if (e && (isNum(e.shift) || e.p || Date.now() - e.at < 60000)) return e.p ? null : e.shift;
  const t = anchorTime(data);
  const page = Math.floor(t / (8 * 3600));   // the 1-minute page holding the options time (_bars.js TIMEFRAMES['1'])
  const p = rtHeadersReady().then((hd) => fetch(BARS_API + encodeURIComponent(fut + '1!') + '?tf=1&page=' + page, { headers: Object.assign({ accept: 'application/json' }, hd) }))
    .then((r) => (r.ok ? r.json() : null)).catch(() => null)
    .then((j) => {
      const rows = j && j.bars;
      const shift = anchorShift(data, fut, rows);
      if (anchors.size > 20) anchors.clear();
      const why = shift == null ? (rows && rows.length ? 'no closed 1m bar within 2 min of the options time (last bar ' + rows[rows.length - 1][0] + ')' : 'no 1m bars') : '';
      anchors.set(k, { shift, at: Date.now(), p: null, why });
      subs.forEach((n) => n.refresh());
      return shift;
    });
  anchors.set(k, { shift: e ? e.shift : null, at: Date.now(), p });
  return null;
}
export function formatLabel(l, mode) {
  mode = str(mode, 'name + chart price + option level');
  if (mode === 'name only') return l.label;
  if (mode === 'name + chart price') return l.label + ' ' + fmtLevel(l.price);
  return l.label + ' ' + fmtLevel(l.price) + (l.note || '');
}

// Data time in epoch seconds: the market block's newest data stamp, else fetched_at.
export function dataTime(data) {
  if (!data) return null;
  const m = data.market || {};
  return num(m.data_ts, null) || num(data.fetched_at, null);
}
export function agoText(tsSec, nowMs) {
  if (!isNum(tsSec)) return 'GEX updated time unknown';
  const min = Math.max(0, Math.floor(((nowMs || Date.now()) / 1000 - tsSec) / 60));
  if (min < 1) return 'GEX updated just now';
  if (min < 120) return 'GEX updated ' + min + ' min ago';
  const h = Math.floor(min / 60);
  if (h < 48) return 'GEX updated ' + h + ' h ago';
  return 'GEX updated ' + Math.floor(h / 24) + ' days ago';
}

// ---- shared fetch cache (one per API market + expiry) ------------------------------------
const cache = new Map();      // key -> { data, at, p }
const subs = new Set();       // natives to nudge when data lands
function key(api, dte) { return api + ':' + dte; }
export function gexFetch(api, dte, force) {
  if (window.__stkReplay && window.__stkReplay.on) return Promise.resolve(null);   // bar replay: no live GEX
  const k = key(api, dte);
  const e = cache.get(k) || {};
  if (e.p) return e.p;
  if (!force && e.data && Date.now() - e.at < REFRESH_MS - 5000) return Promise.resolve(e.data);
  const p = fetch(API + api + '?dte=' + dte, { headers: { accept: 'application/json' } })
    .then((r) => r.json().then((j) => (r.ok ? j : { error: (j && j.error) || ('HTTP ' + r.status) })))
    .catch((err) => ({ error: String(err && err.message || err) }))
    .then((j) => {
      const prev = cache.get(k) || {};
      const good = j && !j.error;
      cache.set(k, { data: good ? j : (prev.data || j), at: good ? Date.now() : (prev.at || 0), p: null });
      return good ? j : (prev.data || j);
    });
  cache.set(k, Object.assign({}, e, { p }));
  return p;
}
export function gexCached(api, dte) { if (window.__stkReplay && window.__stkReplay.on) return null; const e = cache.get(key(api, dte)); return e ? e.data : null; }

let timer = 0;
function wantedKeys() {
  const ks = new Map();
  subs.forEach((n) => { const w = n.want(); if (w) ks.set(key(w.api, w.dte), w); });
  return [...ks.values()];
}
function tick() {
  if (document.visibilityState === 'hidden') return;
  wantedKeys().forEach((w) => gexFetch(w.api, w.dte).then(() => subs.forEach((n) => n.refresh())));
  subs.forEach((n) => n.statusTick());
}
function startTimer() {
  if (timer || !subs.size) return;
  timer = setInterval(tick, 60 * 1000);   // status text each minute; data only when 5 min old
}
function stopTimer() { if (timer) { clearInterval(timer); timer = 0; } }
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') stopTimer();
    else if (subs.size) { startTimer(); tick(); }
  });
}

// ---- bar replay: levels from the GEX history (no lookahead) -----------------------------------
// While Charts bar replay is on (window.__stkReplay, assets/chart-bar-replay.js, read only) the
// API's current levels would be lookahead, so the levels come from the GEX history the recorder
// keeps (assets/gex-heat-core.js, 2-min snapshots): the latest snapshot with chain time <= the
// replay clock. Call wall, put wall, zero gamma and the expected range (IV ±68% / ±80%) are
// recorded; the market levels (pVAH, ONH ...) are not, so they are left out in replay.
// Futures: ratio 1 for ES/MES (SPX), the API's NQ ratio for NQ/MNQ (last one seen on this device),
// and basis = this chart's own close at the snapshot time - ratio x spot.
const REPLAY_MAX_AGE_S = 4 * 86400;     // an older snapshot is "no history for this time"
const HIST_BLOCK_S = 2 * 3600;          // history asked in 2-hour blocks, 4 days back
const hist = new Map();                 // api:dte:blockEnd -> { rows, p }
export function snapAt(rows, ts, maxAge) {
  let lo = 0, hi = rows.length - 1, best = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (rows[m].t <= ts) { best = m; lo = m + 1; } else hi = m - 1; }
  if (best < 0) return null;
  return maxAge != null && ts - rows[best].t > maxAge ? null : rows[best];
}
function barCloseAt(bars, tSec, gapS) {
  let lo = 0, hi = bars.length - 1, best = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (bars[m].time <= tSec * 1000) { best = m; lo = m + 1; } else hi = m - 1; }
  if (best < 0 || (tSec * 1000 - bars[best].time) / 1000 > gapS) return null;
  return isNum(bars[best].close) ? bars[best].close : null;
}
// Pure: an API-shaped response from one history snapshot (+ the futures conversion), so
// buildLevels() draws it exactly like the live levels.
export function snapData(snap, src, ratio, close) {
  const em = Array.isArray(snap.em) && isNum(snap.em[0]) && isNum(snap.em[1]) ? snap.em : null;
  const expected = em ? { '68%': [em[0] - em[1], em[0] + em[1]], '80%': [em[0] - 1.2816 * em[1], em[0] + 1.2816 * em[1]] } : {};
  const d = { call_wall: snap.cw, put_wall: snap.pw, zero_gamma: snap.zg, expected, ladder: ladderFromSnap(snap).map((x) => ({ strike: x.k, gex: x.g })), spot: snap.s, market: { state: 'replay' } };
  if (src.fut) {
    if (!isNum(close) || !isNum(snap.s) || snap.s <= 0) return null;
    const k = isNum(ratio) && ratio > 0 ? ratio : close / snap.s;
    const basis = close - k * snap.s, cv = (v) => (isNum(v) ? v * k + basis : null);
    const e68 = expected['68%'] || [], e80 = expected['80%'] || [];
    d.futures = { [src.fut]: { ratio: k, basis, levels: { spot: close, call_wall: cv(snap.cw), put_wall: cv(snap.pw), zero_gamma: cv(snap.zg),
      iv68_lo: cv(e68[0]), iv68_hi: cv(e68[1]), iv80_lo: cv(e80[0]), iv80_hi: cv(e80[1]) } } };
  }
  return d;
}
function replayRows(api, dte, E, onLoad) {
  const core = window.StrykerGexHeat;
  if (!core) return { err: true };
  const end = Math.min(Math.ceil(E / HIST_BLOCK_S) * HIST_BLOCK_S, Math.floor(Date.now() / 1000));
  const k = api + ':' + dte + ':' + end;
  let e = hist.get(k);
  if (!e) {
    if (hist.size > 12) hist.clear();
    e = { rows: null, p: null };
    e.p = core.history(api, dte, end - REPLAY_MAX_AGE_S, end).then((rows) => { e.rows = rows || []; }, () => { e.rows = []; e.err = true; })
      .then(() => { e.p = null; onLoad(); });
    hist.set(k, e);
  }
  return e;
}
function replayK(fut) {
  if (fut === 'ES' || fut === 'MES') return 1;
  try { const o = JSON.parse(localStorage.getItem('stryker_gex_heat_k') || '{}'); return isNum(o[fut]) ? o[fut] : null; } catch (e) { return null; }
}
function etStamp(sec) {
  try { return new Date(sec * 1000).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET'; } catch (e) { return ''; }
}

// ---- walls over time (GEX history, assets/chart-gex-walls-core.js) ---------------------------------
// Rows for the step lines: the recorder's snapshots for the last WALL_DAYS UTC days, one request per
// UTC day (a finished day is fetched once and edge-cached a day; today's is re-asked at most every
// 5 min, like the levels). These are our own recorder's snapshots (the same /gex-history as the heatmap): no GEX
// vendor request is added.
const WALL_DAYS = 4, DAY_S = 86400, WALL_REFRESH_MS = 5 * 60 * 1000;
const WALL_STEP_IDS = { call: 'cw', put: 'pw', zero: 'zg' };
const PREV_LABEL = { cw: 'prev CW', pw: 'prev PW' };
const wallHist = new Map();   // api:hd:dayStart -> { rows, p, at, final }
export function wallRows(api, hd, untilSec, onLoad) {
  const core = window.StrykerGexHeat;
  if (!core) return { rows: [], pending: false };
  const nowSec = Date.now() / 1000;
  const last = Math.floor(untilSec / DAY_S) * DAY_S;
  let rows = [], pending = false;
  if (wallHist.size > 24) wallHist.clear();
  for (let d = last - (WALL_DAYS - 1) * DAY_S; d <= last; d += DAY_S) {
    const k = api + ':' + hd + ':' + d;
    let e = wallHist.get(k);
    const final = d + DAY_S < nowSec - 3600;
    if (!e || (!e.final && !e.p && Date.now() - e.at > WALL_REFRESH_MS)) {
      const ne = { rows: e ? e.rows : null, p: null, at: Date.now(), final };
      const to = final ? d + DAY_S : Math.min(d + DAY_S, Math.ceil(nowSec / 120) * 120);
      ne.p = core.history(api, hd, d, to).then((r) => { ne.rows = r || []; }, () => { ne.rows = ne.rows || []; })
        .then(() => { ne.p = null; ne.at = Date.now(); onLoad(); });
      wallHist.set(k, ne); e = ne;
    }
    if (e.rows) rows = rows.concat(e.rows.filter((r) => r.t >= d && r.t < d + DAY_S && r.t <= untilSec && isNum(r.s) && r.s > 0));
    else pending = true;
  }
  return { rows, pending };
}
// Pure: hold the walls over `rows` (+ the live API point), work out each snapshot's futures basis
// from the chart's own bars, and return what applySteps() needs. closeAt(t) -> chart close or null;
// k = futures ratio (null on an index/ETF chart).
export function wallModel(rows, live, k, closeAt) {
  if (!rows.length) return null;
  const pts = holdWalls(rows, live);
  const basis = isNum(k) ? basisSeries(rows, closeAt, k) : null;
  if (basis && live) basis.push(null);
  const hist = live ? pts.slice(0, -1) : pts;
  return { pts, basis, k: isNum(k) ? k : null, histBasis: basis ? lastSessionBasis(hist, basis) : null };
}
// Pure: turn the CALL WALL / PUT WALL / ZERO GAMMA lines of a buildLevels() result into step lines.
// conv(strike) -> chart price for the segment that runs to the right edge (the label); every older
// segment uses its own snapshots' basis. Adds the faded "prev CW / prev PW" lines when wanted.
export function applySteps(lv, M, src, conv, opts) {
  if (!lv || lv.err || !M || !M.pts.length) return lv;
  const lastPt = M.pts[M.pts.length - 1];
  const r2 = (v) => (isNum(v) ? Math.round(v * 100) / 100 : null);
  for (const l of lv.lines) {
    const f = WALL_STEP_IDS[l.id];
    if (!f) continue;
    const held = lastPt[f];
    const steps = stepsFor(M.pts, f, M.basis, M.k, isNum(held) ? conv(held) : null);
    if (!steps.length) continue;
    const tail = steps[steps.length - 1];
    if (tail.b == null && isNum(tail.p)) {
      l.price = tail.p;
      if (src.fut && isNum(held)) l.note = ' (' + src.api + ' ' + fmtLevel(r2(held)) + ')';
    }
    l.steps = steps;
  }
  const on = opts && typeof opts.prevWall === 'boolean' ? opts.prevWall : true;
  if (on) {
    ['cw', 'pw'].forEach((f) => {
      const pw = previousWall(M.pts, f);
      const p = pw ? r2(conv(pw.strike)) : null;
      const cur = lv.lines.find((l) => WALL_STEP_IDS[l.id] === f);
      if (!isNum(p) || !cur) return;
      lv.lines.push({ id: 'prev_' + f, label: PREV_LABEL[f], price: p, note: '', col: null, rgb: f === 'cw' ? GEX_COLORS.call : GEX_COLORS.put,
        dash: 'dotted', w: 1, alpha: 0.5, faint: true, steps: [{ a: pw.until, b: null, p }] });
    });
  }
  return lv;
}
// Pure: the API response as one more observation after the history (the newest raw walls), or null.
// Open market: at the options time. Shut: just after the chain's own time (the chain does not change
// until the next session; its expiry is usually the next session's, so it starts a new step).
export function livePoint(data, dayOf) {
  if (!data || data.error || !isNum(data.spot)) return null;
  const m = data.market || {};
  const t = m.state === 'open' ? num(m.options_ts, null) || num(data.fetched_at, null) : (isNum(m.chain_ts) ? m.chain_ts + 1 : null);
  if (!isNum(t)) return null;
  return { t: Math.floor(t), day: dayOf(t), x: data.expiry || '', s: data.spot, cw: data.call_wall, pw: data.put_wall, zg: data.zero_gamma };
}

// ---- previous days (GEX history) -----------------------------------------------------------------
// Per api + expiry: the recorded sessions list (refreshed every 10 min) and each past day's top strikes
// (a finished day never changes, so it is computed once). All from the history the heatmap already
// uses; nothing new is recorded and no GEX vendor is called.
const PREV_REFRESH_MS = 10 * 60 * 1000;
const sessCache = new Map();    // api:hdte -> { at, list|null, p }
const dayCache = new Map();     // api:hdte:day -> { top|null, p }
export function etDayOf(sec) { const c = window.StrykerGexHeat; return c ? c.etDay(sec) : new Date(sec * 1000).toISOString().slice(0, 10); }
// Sync read: { days: [{ day, top }], pending } for the last `count` sessions before `nowSec`'s ET day.
// Kicks the loads it needs; onLoad() fires when something landed.
export function prevState(api, dte, nowSec, count, onLoad) {
  const core = window.StrykerGexHeat;
  const n = Math.max(0, Math.min(5, Math.floor(count || 0)));
  if (!core || !n || dte > 1) return { days: [], pending: false };
  const hd = dte === 1 ? 1 : 0, sk = api + ':' + hd;
  let se = sessCache.get(sk);
  if (!se || (!se.p && Date.now() - se.at > PREV_REFRESH_MS)) {
    const e = { at: Date.now(), list: se ? se.list : null, p: null };
    e.p = core.sessions(api, hd).then((l) => { e.list = Array.isArray(l) ? l : []; }, () => { e.list = e.list || []; })
      .then(() => { e.p = null; e.at = Date.now(); onLoad(); });
    sessCache.set(sk, e); se = e;
  }
  if (!se.list) return { days: [], pending: true };
  const usable = se.list.filter((x) => x && x.n >= MIN_SNAPS);
  const wanted = previousDays(usable, nowSec, n, etDayOf);
  const days = []; let pending = false;
  for (const day of wanted) {
    const dk = sk + ':' + day;
    let de = dayCache.get(dk);
    if (!de) {
      if (dayCache.size > 40) dayCache.clear();
      de = { top: null, p: null };
      const w = core.sessionWindow(day);
      de.p = core.history(api, hd, w.x0, w.x1).then((rows) => { de.top = dayTop((rows || []).filter((r) => r.day === day), PREV_TOP); }, () => { de.top = []; })
        .then(() => { de.p = null; onLoad(); });
      dayCache.set(dk, de);
    }
    if (de.top) { if (de.top.length) days.push({ day, top: de.top }); } else pending = true;
  }
  return { days, pending };
}

// ---- flash line (a ladder click on Charts) ------------------------------------------------------
// A short pulsing horizontal line at a chart price, drawn by its own small layer (registered before
// boot with the GEX natives, so it works whether or not the GEX Levels indicator is on).
export function flashLayer() {
  let canvas = null;
  return {
    mount(cv) { canvas = cv; },
    render(a) {
      if (!canvas) return;
      const g = canvas.getContext('2d'); if (!g) return;
      const dpr = a.coords.dpr || 1;
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, canvas.width, canvas.height);
      const d = a.data;
      if (!d || !isNum(d.price) || !(d.alpha > 0)) return;
      const W = a.coords.width, top = a.bounds.top, bot = top + a.bounds.height;
      const y = Math.round(a.coords.priceToY(d.price, a.scale, a.bounds)) + 0.5;
      if (!(y >= top && y <= bot)) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.save(); g.beginPath(); g.rect(0, top, W, a.bounds.height); g.clip();
      g.globalAlpha = d.alpha; g.strokeStyle = d.color || '#4fe3ac'; g.lineWidth = 2; g.setLineDash([]);
      g.shadowColor = d.color || '#4fe3ac'; g.shadowBlur = 8;
      g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
      g.shadowBlur = 0;
      g.font = '600 11px -apple-system, BlinkMacSystemFont, \"Trebuchet MS\", Roboto, Ubuntu, sans-serif'; g.textBaseline = 'middle';
      const t = d.text || '', w = Math.ceil(g.measureText(t).width) + 10;
      g.fillStyle = d.color || '#4fe3ac'; g.fillRect(Math.max(2, W - w - 2), y - 8, w, 16);
      g.fillStyle = '#0b0b0b'; g.fillText(t, Math.max(2, W - w - 2) + 5, y + 0.5);
      g.restore();
    },
    destroy() { canvas = null; }
  };
}
const FLASH_STEPS = [1, 0.2, 1, 0.2, 1, 0.7, 0.45, 0.2, 0];
let flashSeq = 0;
// Flash a horizontal line at `price` (chart price units) on the active chart cell. Returns true when it ran.
export function flashLevel(ws, price, text, color) {
  if (!isNum(price)) return false;
  let R = null;
  try { const cell = ws.cell(ws.active.id); R = cell.chart.renderer.renderer; } catch (e) { return false; }
  if (!R || !R.setNativeData) return false;
  const my = ++flashSeq;
  FLASH_STEPS.forEach((alpha, i) => setTimeout(() => {
    if (my !== flashSeq) return;
    try { R.setNativeData(FLASH, alpha > 0 ? { price, alpha, text: text || '', color: color || '#4fe3ac' } : null); } catch (e) {}
  }, i * 260));
  return true;
}

// ---- plan tier ----------------------------------------------------------------------------
let tierP = null;
export function gexTier() {
  if (tierP) return tierP;
  tierP = new Promise((resolve) => {
    const t = setTimeout(() => resolve({ free: false, unknown: true }), TIER_WAIT_MS);
    try {
      if (typeof window.strykerPlanTier !== 'function') { clearTimeout(t); resolve({ free: false, unknown: true }); return; }
      window.strykerPlanTier().then((r) => { clearTimeout(t); resolve(r || { free: false }); }, () => { clearTimeout(t); resolve({ free: false }); });
    } catch (e) { clearTimeout(t); resolve({ free: false }); }
  });
  return tierP;
}

// ---- the native indicator -------------------------------------------------------------
function resolveSrc(ctx) {
  let provider = '';
  try { const r = ctx.data.resolve(ctx.symbol); if (r) provider = r.provider; } catch (e) {}
  return gexSource(ctx.symbol, provider);
}
// One built level -> one painted line. Ranked / previous-day lines keep their own colour, width and
// dotted style (the Style group's line style / width apply to the named GEX and market levels only).
function mapLine(l, i, color, sty, wd) {
  if (l.rgb) {
    const text = l.label;   // ranked + previous-day tags stay short: the exact price is on the axis tag
    const o = { id: l.id, price: l.price, color: l.faint ? hexA(l.rgb, l.alpha) : l.rgb, name: l.label, text, dash: l.dash, w: l.w, alpha: l.ranked ? l.alpha : 1, rank: l.rank || 0, share: l.share || 0, faint: !!l.faint };
    if (l.steps) o.steps = l.steps;
    return o;
  }
  const o = { id: l.id, price: l.price, color: color(l.col), name: l.label, text: formatLabel(l, i.labelMode),
    dash: (l.id.startsWith('strike') || !['solid', 'dashed', 'dotted'].includes(sty)) ? l.dash : sty,
    w: wd >= 1 ? Math.min(4, wd) : l.w };
  if (l.steps) o.steps = l.steps;
  return o;
}
class GexNative {
  constructor() { this.inputs = {}; this.ctx = null; this.tier = null; this.sig = ''; this.status = ''; }
  start(ctx, inputs) {
    this.ctx = ctx; this.inputs = inputs || {};
    subs.add(this); startTimer();
    gexTier().then((t) => { this.tier = t; this.load(); });
    this.load();
  }
  want() {
    if (!this.ctx || !this.tier) return null;   // the plan decides which expiry may load
    const src = resolveSrc(this.ctx);
    if (!src) return null;
    if (src.pro && (!this.tier || this.tier.free)) return null;
    return { api: src.api, dte: this.dte() };
  }
  dte() {
    const d = parseInt(str(this.inputs.dte, '0'), 10);
    if (this.tier && this.tier.free) return 0;
    return [0, 1, 7, 30].includes(d) ? d : 0;
  }
  load() {
    const w = this.want();
    this.refresh();
    if (w && document.visibilityState !== 'hidden') gexFetch(w.api, w.dte).then(() => this.refresh());
  }
  onBars() {
    const s = String(this.ctx && this.ctx.symbol); if (s !== this.lastSym) { this.lastSym = s; this.load(); return; }
    // bar replay: every step may pass a new GEX snapshot (refresh pushes only when it changed)
    if (window.__stkReplay && window.__stkReplay.on) this.refresh();
    else if (this.wasReplay) this.load();
    this.wasReplay = !!(window.__stkReplay && window.__stkReplay.on);
  }
  onViewport() {}
  setInputs(i) { this.inputs = i || {}; this.sig = ''; this.load(); }
  suspend() {}
  resume() { this.sig = ''; this.load(); }
  stop() { subs.delete(this); if (!subs.size) stopTimer(); try { this.ctx.pushData(null); this.ctx.emit({ priceLines: [], tables: [] }); } catch (e) {} }
  statusTick() { this.refresh(); }
  // Build the payload for the layer; push only when it changed (no repaint otherwise).
  refresh() {
    if (!this.ctx) return;
    const src = resolveSrc(this.ctx);
    const i = this.inputs;
    let payload;
    if (!src) payload = { note: 'GEX levels available for SPX, ES, NQ' };
    else if (!this.tier) payload = { note: 'Loading GEX levels…' };
    else if (src.pro && this.tier.free) payload = { pill: 'Unlock ' + (src.api === 'QQQ' ? 'NQ' : src.api) + ' GEX with Pro', href: PRICING };
    else if (window.__stkReplay && window.__stkReplay.on) payload = this.replayPayload(src);
    else {
      const dte = this.dte();
      const data = gexCached(src.api, dte);
      if (!data) payload = { note: 'Loading GEX levels…' };
      else {
        const opts = Object.assign({}, i);
        if (this.tier && this.tier.free) opts.showStrikes = false;
        let shift = src.fut ? gexAnchor(src.fut, data) : null;
        const M = this.wallsLive(src, dte, data, opts);
        // Market shut (futures still trading): convert with the basis of the chain's own last minutes
        // (chart bars), not the API's current futures quote, so the walls do not drift overnight.
        const fb = src.fut && data.futures && data.futures[src.fut];
        if (M && src.fut && data.market && data.market.state !== 'open' && isNum(M.histBasis) && fb && isNum(fb.basis)) shift = Math.round((M.histBasis - fb.basis) * 100) / 100;
        let lv = buildLevels(data, src, opts, shift, { prev: this.prevFor(src, dte, Math.floor(Date.now() / 1000), opts) });
        if (M && !lv.err) lv = applySteps(lv, M, src, convOf(data, src, shift), opts);
        if (lv.err) payload = { note: lv.err };
        else {
          const sty = str(i.lineStyle, 'as GEX page'), wd = Math.round(num(i.width, 0));
          const color = (k) => { const s = SCHEMA.find((x) => x.key === k); return str(i[k], s ? s.defval : GEX_COLORS.strike); };
          payload = {
            lines: lv.lines.map((l) => mapLine(l, i, color, sty, wd)),
            band: lv.band ? { lo: lv.band.lo, hi: lv.band.hi, color: color('emColor') } : null,
            labels: i.labels !== false,
            priceTags: i.priceTags !== false,
            showStatus: i.showStatus !== false,
            shift: lv.shift || 0,
            status: agoText(dataTime(data)) + ' · ' + src.label + ' ' + (dte === 0 ? '0DTE' : dte + 'DTE') + (data.stale ? ' · last saved copy' : '') + (lv.noSession && !src.fut ? ' · market levels on ES/NQ charts' : '')
          };
        }
      }
    }
    const sig = JSON.stringify(payload);
    if (sig === this.sig) return;
    this.sig = sig;
    try { this.ctx.pushData(payload); } catch (e) {}
  }
  // Walls over time for the live chart: recorded history (0DTE / 1DTE) + the API's current walls.
  wallsLive(src, dte, data, opts) {
    if (opts.wallSteps === false || dte > 1) return null;
    const st = wallRows(src.api, dte === 1 ? 1 : 0, Math.floor(Date.now() / 1000), () => this.refresh());
    if (!st.rows.length) return null;
    let live = livePoint(data, etDayOf);
    if (live && live.t <= st.rows[st.rows.length - 1].t) live = null;
    let bars = [];
    try { bars = this.ctx.bars() || []; } catch (err) {}
    const t = String(this.ctx.timeframe || ''), tfS = /^\d+$/.test(t) ? +t * 60 : /^\d*[HD]$/i.test(t) ? (parseInt(t, 10) || 1) * (/H/i.test(t) ? 3600 : 86400) : 60;
    const f = src.fut && data.futures ? data.futures[src.fut] : null;
    if (src.fut && (!f || !isNum(f.ratio))) return null;
    return wallModel(st.rows, live, f ? f.ratio : null, src.fut ? (ts) => barCloseAt(bars, ts, Math.max(180, tfS + 120)) : null);
  }
  // Previous days for this source at time nowSec (replay: the snapshot time). Free members get SPX/ES only
  // (src.pro already handled: a Pro-only source never gets here for a Free member).
  prevFor(src, dte, nowSec, opts) {
    const on = typeof opts.showPrev === 'boolean' ? opts.showPrev : true;
    const n = isNum(opts.prevDays) ? opts.prevDays : 2;
    if (!on || n <= 0) return [];
    const st = prevState(src.api, dte, nowSec, n, () => this.refresh());
    return st.days;
  }
  // Bar replay: the history snapshot as of the replay clock (see "bar replay" above).
  replayPayload(src) {
    const dte = this.dte();
    if (dte > 1) return { note: 'GEX history covers 0DTE and 1DTE: pick one to see GEX in bar replay' };
    const E = Math.floor(window.__stkReplay.E / 1000);
    const e = replayRows(src.api, dte, E, () => this.refresh());
    if (e.err && !e.rows) return { note: 'GEX history could not load' };
    if (!e.rows) return { note: 'Loading GEX history…' };
    let snap = snapAt(e.rows, E, REPLAY_MAX_AGE_S);
    if (!snap) return { note: 'No GEX history for this time' };
    // 0DTE after that session's close (evening, overnight, weekend): that expiry is gone. The live
    // chart then shows the NEXT expiry's chain (the API's 0DTE after the close), so replay does the
    // same: the last 1DTE snapshot of that session, as a new step after the 0DTE ones.
    let nextExp = null;
    const core = window.StrykerGexHeat;
    if (dte === 0 && core && E > core.sessionWindow(snap.day).x1) {
      const e1 = replayRows(src.api, 1, E, () => this.refresh());
      if (!e1.rows && !e1.err) return { note: 'Loading GEX history…' };
      const s1 = e1.rows ? snapAt(e1.rows, E, REPLAY_MAX_AGE_S) : null;
      if (s1 && s1.day === snap.day) { snap = s1; nextExp = Object.assign({}, s1, { t: Math.max(s1.t, e.rows[e.rows.length - 1].t) + 1 }); }
    }
    let bars = [];
    try { bars = this.ctx.bars() || []; } catch (err) {}
    const tfS = (() => { const t = String(this.ctx.timeframe || ''); return /^\d+$/.test(t) ? +t * 60 : /^\d*[HD]$/i.test(t) ? (parseInt(t, 10) || 1) * (/H/i.test(t) ? 3600 : 86400) : 60; })();
    const close = src.fut ? barCloseAt(bars, snap.t, Math.max(180, tfS + 120)) : null;
    const data = snapData(snap, src, src.fut ? replayK(src.fut) : null, close);
    if (!data) return { note: 'No ' + src.fut + ' bar at the GEX snapshot time (' + etStamp(snap.t) + ')' };
    const i = this.inputs;
    const opts = Object.assign({}, i);
    if (this.tier && this.tier.free) opts.showStrikes = false;
    let lv = buildLevels(data, src, opts, null, { prev: this.prevFor(src, dte, snap.t, opts), spot: snap.s });
    if (lv.err) return { note: lv.err };
    if (opts.wallSteps !== false) {
      // walls over time up to the replay clock only (no lookahead), from the rows already loaded
      const rows = e.rows.filter((r) => r.t <= E && isNum(r.s) && r.s > 0);
      const f = data.futures && src.fut ? data.futures[src.fut] : null;
      const M = wallModel(rows, nextExp, f ? f.ratio : null, src.fut ? (t) => barCloseAt(bars, t, Math.max(180, tfS + 120)) : null);
      // the label segment: median basis of the session's last snapshots (one snapshot's spot can be
      // off, e.g. the 15:59:59 closing print), the same basis the live chart uses off-hours
      const k = f ? f.ratio : null;
      const conv = src.fut && M && isNum(M.histBasis) && isNum(k) ? (v) => v * k + M.histBasis : convOf(data, src, 0);
      if (M) lv = applySteps(lv, M, src, conv, opts);
    }
    const sty = str(i.lineStyle, 'as GEX page'), wd = Math.round(num(i.width, 0));
    const color = (k) => { const s = SCHEMA.find((x) => x.key === k); return str(i[k], s ? s.defval : GEX_COLORS.strike); };
    return {
      lines: lv.lines.map((l) => mapLine(l, i, color, sty, wd)),
      band: lv.band ? { lo: lv.band.lo, hi: lv.band.hi, color: color('emColor') } : null,
      labels: i.labels !== false, priceTags: i.priceTags !== false, showStatus: i.showStatus !== false, shift: 0,
      snapT: snap.t,
      status: 'GEX as of ' + etStamp(snap.t) + ' · ' + src.label + ' ' + (dte === 0 ? '0DTE' : '1DTE') + (nextExp ? ' (next expiry ' + snap.x + ')' : '') + ' · bar replay'
    };
  }
}

// ---- renderer layer: lines + right-edge price tags + status chip ---------------------------
function hexA(hex, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
}
// One wall over time: each segment [a, b) at its own price (b null = to the right edge), drawn as a
// HORIZONTAL piece only. No vertical connector between segments (CoS/Owner 2026-10-26: tall joins
// looked like boxes on a phone); a 2 px gap where the wall changes. Older segments are fainter than
// the current (last) one, which carries the label. Clipped by the caller.
const STEP_GAP_PX = 2, OLD_ALPHA = 0.45;
let stepsDrawn = 0;   // test hook: step segments painted in the last frame (canvas.__stkGexSteps)
let stepJoins = 0;    // test hook: vertical connectors painted (must stay 0)
let segLog = [];      // test hook: every segment's pixel span (canvas.__stkGexSegs)
function drawSteps(g, steps, co, Y, W) {
  const base = g.globalAlpha;
  steps.forEach((s, i) => {
    const last = i === steps.length - 1;
    let x0 = Math.max(-2, co.timeToX(s.a * 1000));
    let x1 = s.b == null ? W : Math.min(W + 2, co.timeToX(s.b * 1000));
    const y = Math.round(Y(s.p)) + 0.5;
    segLog.push({ p: s.p, x0: Math.round(x0), x1: Math.round(x1), y, last });
    if (!isFinite(x0) || !isFinite(x1) || !isFinite(y)) return;
    if (x1 < 0 || x0 > W) return;
    if (i > 0) x0 += STEP_GAP_PX / 2;
    if (!last) x1 -= STEP_GAP_PX / 2;
    if (x1 <= x0) return;
    g.globalAlpha = last ? base : base * OLD_ALPHA;
    g.beginPath(); g.moveTo(x0, y); g.lineTo(x1, y); g.stroke();
    stepsDrawn++;
  });
  g.globalAlpha = base;
}
const TAG_H = 16, MERGE_PX = 6;
// Pure: tags [{y, l}] sorted by y -> groups whose lines sit within MERGE_PX share one label.
export function mergeTags(tags) {
  const out = [];
  [...tags].sort((p, q) => p.y - q.y).forEach((t) => {
    const g = out[out.length - 1];
    if (g && t.y - g.y0 <= MERGE_PX) { g.items.push(t); return; }
    out.push({ y0: t.y, items: [t] });
  });
  return out.map((g) => {
    const it = g.items, l0 = it[0].l;
    const names = [...new Set(it.map((x) => x.l.name || x.l.text))];
    const prices = [...new Set(it.map((x) => fmtLevel(x.l.price)))];
    const text = it.length === 1 ? l0.text : names.join(' · ') + ' ' + prices.join(' / ');
    const y = it.reduce((s2, x) => s2 + x.y, 0) / it.length;
    return { y, yc: y, axisY: it[0].y, axisText: fmtLevel(l0.price), text, color: l0.color, ids: it.map((x) => x.l.id) };
  });
}
// Pure: push stacked tags apart so no two boxes overlap, inside [top, bot].
export function layoutTags(groups, top, bot) {
  let prev = -Infinity;
  for (const t of groups) { t.yc = Math.max(t.y, prev + TAG_H + 1, top + TAG_H / 2); prev = t.yc; }
  // pushed past the bottom: walk back up
  let next = Infinity;
  for (let i = groups.length - 1; i >= 0; i--) { const t = groups[i]; t.yc = Math.min(t.yc, next - TAG_H - 1, bot - TAG_H / 2); next = t.yc; }
  return groups;
}
// Pure: slide a label box b ({x, y, w, h}) LEFT along its row past every rect it meets
// (avoid: [{left, top, right, bottom}]). Returns the new x, or null when it would pass minX.
export function slideLeft(b, avoid, minX, gap = 3) {
  let x = b.x;
  for (let k = 0; k < 6; k++) {
    const hit = (avoid || []).filter((q) => q && x < q.right + gap && q.left - gap < x + b.w && b.y < q.bottom && q.top < b.y + b.h);
    if (!hit.length) return x;
    x = Math.min(...hit.map((q) => q.left)) - gap - b.w;
    if (x < minX) return null;
  }
  return null;
}
function gexLayer() {
  let canvas = null, chip = null, last = '', lastTags = [];
  function ensureChip() {
    if (chip || !canvas || !canvas.parentElement) return chip;
    chip = document.createElement('div');
    chip.className = 'stk-gex-chip';
    chip.hidden = true;
    canvas.parentElement.appendChild(chip);
    return chip;
  }
  function paintChip(d, rightPx, bottomPx) {
    const c = ensureChip();
    if (!c) return;
    // Phone: the chip ends before the Fit price / Latest buttons (same bottom row, chart-settings.js)
    let maxW = '';
    if (c.parentElement && c.parentElement.clientWidth < 600) {
      const host = c.closest('.vela-cell') || c.parentElement.parentElement || c.parentElement;
      const fl = host && host.querySelector('.stkc-fl');
      const pr = c.parentElement.getBoundingClientRect();
      if (fl && fl.getClientRects().length) maxW = Math.max(110, Math.floor(fl.getBoundingClientRect().left - pr.left - 8 - 6)) + 'px';
    }
    if (c.style.maxWidth !== maxW) c.style.maxWidth = maxW;
    const k = d ? JSON.stringify([d.note, d.pill, d.showStatus === false ? '' : d.status, rightPx, bottomPx]) : '';
    if (k === last) return;
    last = k;
    if (!d || !(d.note || d.pill || (d.showStatus !== false && d.status))) { c.hidden = true; return; }
    c.hidden = false;
    // Bottom-LEFT of the plot (GEX audit 2026-10-13): at the bottom-right it covered the lowest
    // right-edge level label. rightPx is kept in the signature for callers/tests.
    c.style.right = 'auto';
    c.style.left = '8px';
    c.style.bottom = bottomPx + 'px';
    c.textContent = '';
    if (d.pill) {
      const a = document.createElement('a');
      a.className = 'stk-gex-pill'; a.href = d.href || PRICING; a.textContent = d.pill;
      c.appendChild(a);
    } else {
      c.classList.toggle('is-note', !!d.note);
      c.appendChild(document.createTextNode(d.note || (d.showStatus === false ? '' : d.status)));
    }
  }
  return {
    mount(cv) { canvas = cv; },
    render(a) {
      if (!canvas) return;
      const g = canvas.getContext('2d');
      if (!g) return;
      const dpr = a.coords.dpr || 1;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, canvas.width, canvas.height);
      const d = a.data;
      const W = a.coords.width;
      const fullW = canvas.width / dpr, fullH = canvas.height / dpr;
      paintChip(d, Math.max(0, fullW - W) + 8, Math.max(0, fullH - (a.bounds.top + a.bounds.height)) + 8);
      if (!d || !d.lines) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const top = a.bounds.top, bot = top + a.bounds.height;
      const Y = (p) => a.coords.priceToY(p, a.scale, a.bounds);
      g.save();
      g.beginPath(); g.rect(0, top, W, a.bounds.height); g.clip();
      if (d.band) {
        const y1 = Y(d.band.hi), y2 = Y(d.band.lo);
        g.fillStyle = hexA(d.band.color, 0.07);
        g.fillRect(0, Math.min(y1, y2), W, Math.abs(y2 - y1));
        g.strokeStyle = hexA(d.band.color, 0.55); g.lineWidth = 1; g.setLineDash([2, 3]);
        [y1, y2].forEach((y) => { const yy = Math.round(y) + 0.5; g.beginPath(); g.moveTo(0, yy); g.lineTo(W, yy); g.stroke(); });
      }
      const font = '600 11px -apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, Ubuntu, sans-serif';
      g.font = font; g.textBaseline = 'middle';
      const tags = [], drawn = [];
      stepsDrawn = 0; stepJoins = 0; segLog = [];
      for (const l of d.lines) {
        const y = Math.round(Y(l.price)) + 0.5;
        if (!(y >= top && y <= bot)) continue;
        drawn.push({ id: l.id, price: l.price, y, yPrice: a.coords.yToPrice ? a.coords.yToPrice(y - 0.5, a.scale, a.bounds) : null, pxPrice: a.coords.yToPrice ? Math.abs(a.coords.yToPrice(top, a.scale, a.bounds) - a.coords.yToPrice(top + 1, a.scale, a.bounds)) : null });
        g.strokeStyle = l.color; g.lineWidth = l.w || d.width || 1;
        g.globalAlpha = l.alpha > 0 && l.alpha < 1 ? l.alpha : 1;
        g.setLineDash(l.dash === 'dashed' ? [6, 4] : l.dash === 'dotted' ? [2, 3] : []);
        if (l.steps && a.coords.timeToX) drawSteps(g, l.steps, a.coords, Y, W);
        else { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
        g.globalAlpha = 1;
        if (d.labels) tags.push({ y, l });
      }
      // a step line whose current price is off screen still draws its older segments
      for (const l of d.lines) {
        if (!l.steps || !a.coords.timeToX) continue;
        const y = Math.round(Y(l.price)) + 0.5;
        if (y >= top && y <= bot) continue;
        g.strokeStyle = l.color; g.lineWidth = l.w || d.width || 1;
        g.globalAlpha = l.alpha > 0 && l.alpha < 1 ? l.alpha : 1;
        g.setLineDash(l.dash === 'dashed' ? [6, 4] : l.dash === 'dotted' ? [2, 3] : []);
        drawSteps(g, l.steps, a.coords, Y, W);
        g.globalAlpha = 1;
      }
      g.setLineDash([]);
      const byId = new Map(d.lines.map((l) => [l.id, l]));
      // Right-edge tags. Levels within MERGE_PX of each other share ONE tag ("pPOC · ZERO GAMMA
      // 7881"), so labels never draw on top of each other; the rest are nudged apart (stacked).
      const groups = mergeTags(tags);
      layoutTags(groups, top, bot);
      // Phone collision handling (Owner 2026-10-26): the tags also step aside for the Pine text the
      // indicators painted (Liquidity Master's "15m FVG" etc., plot.__stkPineRects from
      // chart-pine-tv-style.js). Desktop keeps the old right-edge placement untouched.
      const phone = W < 520;
      const plotEl = canvas.parentElement;
      const pine = phone && plotEl && Array.isArray(plotEl.__stkPineRects) ? plotEl.__stkPineRects : [];
      const placed = [];
      const hits = (b) => pine.some((q) => b.x < q.right + 2 && q.left - 2 < b.x + b.w && b.y < q.bottom && q.top < b.y + b.h)
        || placed.some((q) => b.x < q.x + q.w + 2 && q.x - 2 < b.x + b.w && b.y < q.y + q.h + 1 && q.y - 1 < b.y + b.h);
      for (const t of groups) {
        // narrow plots (phone): a merged tag must not stretch across the chart over the ticket and the
        // other lines. Too wide -> prices are dropped (the axis tag keeps the exact price), then cut.
        if (W < 520 && g.measureText(t.text).width + 10 > W * 0.5 && t.ids.length > 1) t.text = t.text.replace(/\s[\d.,]+( \/ [\d.,]+)*$/, '');
        const maxTw = W < 520 ? W * 0.5 : W - 8;
        while (t.text.length > 4 && g.measureText(t.text).width + 10 > maxTw) t.text = t.text.slice(0, -2).replace(/\s+$/, '') + '…';
        let w = Math.ceil(g.measureText(t.text).width) + 10;
        let x = Math.max(2, W - w - 2);
        if (phone) {
          const faint = t.ids.every((id) => byId.get(id) && byId.get(id).faint);
          let b = { x, y: t.yc - TAG_H / 2, w, h: TAG_H };
          // 1. previous-day tags drop the date when they collide ("10/22 · $620M" -> "$620M")
          if (hits(b) && faint) {
            const short = t.text.split(' · ').filter((s) => /\$/.test(s)).join(' ');
            if (short && short !== t.text) { t.text = short; w = Math.ceil(g.measureText(t.text).width) + 10; x = Math.max(2, W - w - 2); b = { x, y: b.y, w, h: TAG_H }; }
          }
          // 2. slide left along the row past the Pine text, 3. else one row up / down, 4. else stay
          if (hits(b)) {
            const others = pine.concat(placed.map((q) => ({ left: q.x, right: q.x + q.w, top: q.y, bottom: q.y + q.h })));
            const sx = slideLeft(b, others, W * 0.3);
            if (sx != null) x = sx;
            else {
              // a wide block (an indicator table): the nearest free row, up to 4 rows away
              let moved = false;
              for (let k = 1; k <= 4 && !moved; k++) {
                for (const dy of [-k * (TAG_H + 2), k * (TAG_H + 2)]) {
                  const nb = { x, y: b.y + dy, w, h: TAG_H };
                  if (nb.y >= top && nb.y + TAG_H <= bot && !hits(nb)) { t.yc += dy; moved = true; break; }
                }
              }
              if (!moved) { const fx = slideLeft(b, others, 2); if (fx != null) x = fx; }
            }
          }
        }
        t.box = { x, y: t.yc - TAG_H / 2, w, h: TAG_H };
        placed.push(t.box);
        g.fillStyle = t.color;
        g.fillRect(x, t.yc - TAG_H / 2, w, TAG_H);
        g.fillStyle = t.ids.some((id) => byId.get(id) && byId.get(id).faint) ? '#e8edf2' : '#0b0b0b';
        g.fillText(t.text, x + 5, t.yc + 0.5);
        // ranked strike: a small size bar along the bottom of its tag (width = share of the biggest)
        const rl = t.ids.length === 1 ? byId.get(t.ids[0]) : null;
        if (rl && rl.rank) { g.fillStyle = 'rgba(11,11,11,.6)'; g.fillRect(x + 1, t.yc + TAG_H / 2 - 3, Math.max(3, Math.round((w - 2) * rl.share)), 2); }
      }
      lastTags = groups.map((t) => ({ text: t.text, ids: t.ids, box: t.box, axis: t.axisY }));
      canvas.__stkGexTags = lastTags;   // test hook (a plain property: no DOM write)
      canvas.__stkGexLines = drawn;     // test hook: each painted line's price, pixel row and the price at that row
      canvas.__stkGexSteps = stepsDrawn;
      canvas.__stkGexJoins = stepJoins;
      canvas.__stkGexSegs = segLog;
      if (plotEl) {
        // the Absorption tag (chart-of-pro.js) yields to these boxes; ask for one more frame when they move
        const boxes = groups.map((t) => ({ left: t.box.x, right: t.box.x + t.box.w, top: t.box.y, bottom: t.box.y + t.box.h, text: t.text }));
        const sig = boxes.map((q) => Math.round(q.left) + ',' + Math.round(q.top)).join(';');
        plotEl.__stkGexBoxes = boxes;
        if (sig !== plotEl.__stkGexSig) { plotEl.__stkGexSig = sig; if (phone && typeof plotEl.__stkInv === 'function') requestAnimationFrame(plotEl.__stkInv); }
      }
      g.restore();
      // Price tags on the right price axis (outside the plot clip), at the exact line price.
      const axW = fullW - W;
      if (axW > 24 && d.priceTags !== false) {
        g.save();
        g.beginPath(); g.rect(W, top, axW, a.bounds.height); g.clip();
        g.font = font; g.textBaseline = 'middle';
        for (const t of groups) {
          g.fillStyle = t.color;
          g.fillRect(W + 1, t.axisY - 8, axW - 2, 16);
          g.fillStyle = '#0b0b0b';
          g.fillText(t.axisText, W + 6, t.axisY + 0.5);
        }
        g.restore();
      }
    },
    destroy() { if (chip) chip.remove(); chip = null; canvas = null; },
    // Test hook: the label boxes painted last frame.
    tags() { return lastTags; }
  };
}

// ---- registration + persistence ---------------------------------------------------------
const PERSIST_KEY = 'stryker.gex';
let installed = false;
export function installGexLevels(Core) {
  if (installed) return;
  installed = true;
  Core.registerRendererLayer({ id: TYPE, placement: 'above-data', create: gexLayer });
  Core.registerRendererLayer({ id: FLASH, placement: 'above-data', create: flashLayer });
  Core.registerNativeIndicator({
    type: TYPE, title: 'TradeZoro GEX Levels', shortTitle: 'GEX Levels', paneHint: 'price', overlay: true,
    inputsSchema: () => SCHEMA, defaultInputs: () => Object.fromEntries(SCHEMA.map((x) => [x.key, x.defval])),
    create: () => new GexNative(),
    // Short text after "GEX Levels" in the chart legend (assets/chart-legend-rows.js).
    // Symbol first: "SPX 0DTE · updated 12 min ago" (the status chip reads "GEX updated … · SPX 0DTE").
    legendNote: (d) => {
      if (!d) return '';
      if (d.pill || d.note) return d.pill || d.note;
      const p = String(d.status || '').replace(/^GEX /, '').split(' · ').filter(Boolean);
      // Status chip stores time first ("GEX updated … · SPX 0DTE"); legend reads symbol first.
      return p.length > 1 ? [p[1], p[0]].concat(p.slice(2)).join(' · ') : p[0];
    }
  });
  // Vela persists which natives are on a chart but not their settings: keep them in the
  // workspace document (session + templates), like the volume tools do.
  Core.registerStatePersistence({
    key: PERSIST_KEY, scope: 'cell',
    serialize(ctx) {
      const out = [];
      try { ctx.chart.indicators().forEach((h) => { if (h.nativeType === TYPE) out.push(h.inputValues()); }); } catch (e) {}
      return out.length ? out : undefined;
    },
    restore(payload, ctx) {
      if (!Array.isArray(payload)) return;
      let hs = [];
      try { hs = ctx.chart.indicators().filter((h) => h.nativeType === TYPE); } catch (e) { return; }
      payload.slice(0, 4).forEach((vals, i) => {
        if (!hs[i] || !vals || typeof vals !== 'object') return;
        const clean = {};
        // Settings saved before build 461 (no market-level keys) carry the old defaults
        // solid / width 1, which would flatten the GEX page's line styles: drop those two.
        if (!('showVah' in vals)) { if (vals.lineStyle === 'solid') delete vals.lineStyle; if (vals.width === 1) delete vals.width; }
        SCHEMA.forEach((s) => { const v = vals[s.key]; if (['string', 'number', 'boolean'].includes(typeof v)) clean[s.key] = v; });
        try { hs[i].setInputs(clean); } catch (e) {}
      });
    }
  });
}
export const GEX_TYPE = TYPE;
export const GEX_DESC = 'Call wall, put wall, zero gamma, IV ±68% and market levels (pVAH, pPOC, pVAL, ONH, ONL) from the GEX page, on SPX, ES and NQ charts.';
