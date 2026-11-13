// TradeZoro — indicator versions: the ONE manifest + the helpers the chart uses (ES module, no imports).
// Owner order 13 Nov 2026: "add versions to indicators, add option to choose version, do not auto force updates on
// indicators rather add update indicator icon and option ... to update to users. show changelog in indicators own page."
// How-to for workers: docs/INDICATOR-VERSIONS.md. Read by:
//   assets/chart-ind-versions.js       chart side: Version setting, update icon + popup, keeps settings on Update
//   assets/chart-l2-flow.js (etc.)     an indicator gates old behaviour with below(inputs, '1.1')
//   tools/gen-indicator-pages.js       the "Changelog" section of /indicators/<slug> (reads VERSIONS as text, keep it plain data
//                                      + migrate functions; no imports, no references to other names)
//
// VERSIONS[key]: key = the Indicators-window key ('b:<native type>', 'x:<built-in Pine id>', 'p:<drawing tool>', 'c:<chart type>').
//   base      the version an instance is on when its saved chart has no version stored (= the behaviour it had before versions
//             existed). NEVER change it once shipped: instances on base store nothing, so moving it would move them.
//   versions  oldest first: { v: '1.1', date: 'YYYY-MM-DD', notes: [member-facing lines, plain English], all?: true, migrate?: fn }
//             all: true  = the change reached every chart (bug fix or new options that change nothing until used). Shown in the
//                          changelog, not a choice in the Version setting, no update icon.
//             otherwise  = a behaviour switch: the indicator checks below(inputs, v) and keeps the old behaviour for older
//                          instances; the member picks it in Settings > Version and gets the update icon.
//             migrate(inputs) -> patch of inputs, run once when a member presses Update past this version (renamed settings).
// An indicator not listed is v1.0 (first release date on its page: tools/indicator-pages/first-release.json).
// Only TradeZoro natives can be pinned today. Built-in Pine scripts are listed for the changelog only (all: true); pinning one
// needs its old source kept (docs/INDICATOR-VERSIONS.md, "Pine").

export const VERSIONS = {
  'b:stk_l2f_fp': { base: '1.1', versions: [
    { v: '1.0', date: '2026-11-03', notes: ['First release: traded volume per price in each candle, with the resting book size at the candle close beside it, over the full depth of the book.'] },
    { v: '1.1', date: '2026-11-11', notes: [
      'Resting book bars now show only near each candle by default (its high to low plus 2 rows), so the chart stays readable.',
      'New setting "Resting book shown": Near the candle, Off or Full depth.',
      'New setting "Rows beyond the candle".',
      'Lighter colours for the resting book bars.'] },
    { v: '1.2', date: '2026-11-13', all: true, notes: ['New setting: Text size for the traded numbers.'] }
  ] },
  'b:stk_l2f_sw': { base: '1.1', versions: [
    { v: '1.0', date: '2026-11-10', notes: ['First release: an anchored VWAP and a volume profile with POC, VAH and VAL for every swing leg.'] },
    { v: '1.1', date: '2026-11-11', all: true, notes: [
      'New "Profile shows" option: Volume, or Volume + Delta.',
      'New "Rows" setting for a fixed number of price rows in each profile.',
      'Fix: POC, VAH and VAL now always sit inside the swing leg.'] }
  ] },
  'b:stk_l2f_dp': { base: '1.1', versions: [
    { v: '1.0', date: '2026-11-09', notes: ['First release: delta per price over the last few minutes, a picked range or the session.'] },
    { v: '1.1', date: '2026-11-11', all: true, notes: [
      'New window mode "Reset every interval": the profile fills from the start of each block of minutes, then starts again.',
      'Optional faint line at the previous block\'s POC.'] }
  ] },
  'b:stk_of_big': { base: '1.1', versions: [
    { v: '1.0', date: '2026-10-14', notes: ['First release.'] },
    { v: '1.1', date: '2026-11-10', all: true, notes: ['Fix: the automatic size threshold now uses a fixed 24 hour window, so marks no longer change when you drag the chart or reload.'] }
  ] },
  'b:stk_ts_big': { base: '1.1', versions: [
    { v: '1.0', date: '2026-11-02', notes: ['First release.'] },
    { v: '1.1', date: '2026-11-10', all: true, notes: ['Fix: the automatic size threshold now uses a fixed 24 hour window, so marks no longer change when you drag the chart or reload.'] },
    { v: '1.2', date: '2026-11-13', all: true, notes: ['Fix: the markers stay on the chart after you switch chart tabs and come back.'] }
  ] },
  'b:stk_l2f_big': { base: '1.1', versions: [
    { v: '1.0', date: '2026-11-03', notes: ['First release.'] },
    { v: '1.1', date: '2026-11-10', all: true, notes: ['Fix: the automatic size threshold now uses a fixed 24 hour window, so marks no longer change when you drag the chart or reload.'] },
    { v: '1.2', date: '2026-11-13', all: true, notes: ['Fix: older big trades now get their W, C and P tags straight away, without dragging the chart back first.'] }
  ] },
  'b:stk_fpat': { base: '1.0', versions: [
    { v: '1.0', date: '2026-11-10', notes: ['First release: marks absorption, exhaustion, stacked imbalances, unfinished auctions, delta divergence and trapped traders.'] }
  ] },
  'b:stk_fpat_l2': { base: '1.0', versions: [
    { v: '1.0', date: '2026-11-10', notes: ['First release: marks absorption, exhaustion, stacked imbalances, unfinished auctions, delta divergence and trapped traders.'] }
  ] },
  'b:stk_bk_walls': { base: '1.1', versions: [
    { v: '1.0', date: '2026-11-04', notes: ['First release.'] },
    { v: '1.1', date: '2026-11-10', all: true, notes: [
      'Works when the feed sends only one side of the book.',
      'A book side that stops updating is left out, and the chart says so.'] }
  ] },
  'b:stk_footprint': { base: '1.3', versions: [
    { v: '1.0', date: '2026-10-05', notes: ['First release of the Footprint chart type.'] },
    { v: '1.1', date: '2026-11-10', all: true, notes: [
      'New Style menu with two new looks: Delta boxes and Delta bars.',
      'Optional Bar stats table.'] },
    { v: '1.2', date: '2026-11-13', all: true, notes: [
      'New settings: Text size, Buy colour and Sell colour.',
      'The Bar stats table and the delta + volume strip can each sit at any corner of the chart.'] },
    { v: '1.3', date: '2026-11-13', all: true, notes: ['Fix: the Bar stats table now always stays on top of candles and other indicators.'] }
  ] },
  'p:frvp': { base: '1.3', versions: [
    { v: '1.0', date: '2026-10-05', notes: ['First release.'] },
    { v: '1.1', date: '2026-11-11', all: true, notes: [
      'POC, VAH and VAL lines stop at the end of the range. New setting "Extend lines right".',
      'Clicks on candles inside the range reach the chart instead of moving the drawing.',
      'New setting "Show thin rows".',
      'Optional delta bars, and an anchored VWAP with bands.',
      'Drawings saved before this keep their old look.'] },
    { v: '1.2', date: '2026-11-13', all: true, notes: [
      'The value area stays the same when you change the number of rows.',
      'Corner handles to resize the range.',
      'Dashes instead of empty delta values where there is no order flow data.'] },
    { v: '1.3', date: '2026-11-13', all: true, notes: ['The value area is now the same on every timeframe: the profile is built from 1-minute bars when they are available.'] }
  ] },
  'b:stk_svp': { base: '1.1', versions: [
    { v: '1.0', date: '2026-10-05', notes: ['First release.'] },
    { v: '1.1', date: '2026-11-13', all: true, notes: [
      'Draws and updates live, including the session that is running now.',
      'Session now starts on "both" (day session and overnight, each with its own profile), so the current session is always shown. Pick "rth" in the settings for day session only.'] }
  ] },
  'b:stk_gex': { base: '1.1', versions: [
    { v: '1.0', date: '2026-10-07', notes: ['First release.'] },
    { v: '1.1', date: '2026-11-13', all: true, notes: [
      'New optional live levels on futures charts: overnight high and low while the overnight session runs, and the current day high and low.',
      'They are off by default, so your chart looks the same until you turn them on.'] }
  ] },
  'x:htf-po3-lens-stryker': { base: '1.1', versions: [
    { v: '1.0', date: '2026-10-07', notes: ['First release.'] },
    { v: '1.1', date: '2026-11-10', all: true, notes: [
      'Fix: live updates no longer add flat stub candles, and the first partial period is not drawn as complete.',
      'Fix: the wick is drawn above and below the body, never across it.'] }
  ] },
  'x:liquidity-master-tradezoro': { base: '1.1', versions: [
    { v: '1.0', date: '2026-10-12', notes: ['First release.'] },
    { v: '1.1', date: '2026-11-10', all: true, notes: ['Fix: an Asia session that starts on the first loaded bar is partial and is no longer drawn, so the Asia high and low are the same on every timeframe.'] }
  ] },
  'x:session-sweep-smt-ifvg': { base: '1.1', versions: [
    { v: '1.0', date: '2026-10-29', notes: ['First release.'] },
    { v: '1.1', date: '2026-11-10', all: true, notes: ['Fix: an Asia session that starts on the first loaded bar is partial and is no longer drawn, so the Asia high and low are the same on every timeframe.'] }
  ] }
};

export const VER_KEY = 'ver';   // the input key every pinnable native gets

// '1.10' > '1.9'; a missing part counts as 0
export function cmp(a, b) {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d < 0 ? -1 : 1; }
  return 0;
}

// window.__stkIndVerTest: a test page's own manifest (tools/tests/indicator-versions-browser.js), set before the chart loads
let table = (typeof window !== 'undefined' && window.__stkIndVerTest) || VERSIONS;
// tests only: replace the manifest (a "new version ships" without a deploy)
export function setManifest(m) { table = m || VERSIONS; }
export const entry = (key) => table[key] || null;

// the versions a member can pick (behaviour switches), oldest first
export function pickable(key) {
  const e = entry(key);
  if (!e) return [];
  const out = e.versions.filter((x, i) => i === 0 || !x.all);
  return out.length > 1 ? out : [];
}
export const pinnable = (key) => pickable(key).length > 1;
export function latest(key) { const p = pickable(key); return p.length ? p[p.length - 1].v : null; }
export function current(key) { const e = entry(key); return e ? e.versions[e.versions.length - 1].v : '1.0'; }

// An instance's version: the stored value, else base. An unknown stored value (a chart saved by a newer page) is clamped
// to the newest known version not above it.
export function verOf(key, inputs) {
  const e = entry(key), p = pickable(key);
  if (!e || !p.length) return null;
  const v = inputs && inputs[VER_KEY] != null ? String(inputs[VER_KEY]) : e.base;
  let best = p[0].v;
  for (const x of p) if (cmp(x.v, v) <= 0) best = x.v;
  return best;
}
// For indicator code: is this instance older than version v? Instances with no version input (another page, a test) run the newest code.
export const below = (inputs, v) => !!(inputs && inputs[VER_KEY] != null && cmp(inputs[VER_KEY], v) < 0);
// `when` for a setting that exists from version v on (Vela hides it on older instances)
// (undefined in the list: where the Version setting is absent, e.g. a page without assets/chart-ind-versions.js, the setting shows)
export function since(key, v) { return { key: VER_KEY, anyOf: pickable(key).filter((x) => cmp(x.v, v) >= 0).map((x) => x.v).concat([undefined]) }; }

// the versions after `from`, up to the latest pickable one (what the update popup lists)
export function newer(key, from) {
  const e = entry(key), to = latest(key);
  return e && to ? e.versions.filter((x) => cmp(x.v, from) > 0 && cmp(x.v, to) <= 0) : [];
}
// inputs patch for moving an instance to version `to`: the new version + each passed version's migrate (forward only)
export function upgradePatch(key, inputs, to) {
  const from = verOf(key, inputs) || '0', patch = {};
  let cur = Object.assign({}, inputs);
  for (const x of newer(key, from)) {
    if (cmp(x.v, to) > 0) break;
    if (typeof x.migrate === 'function') { const p = x.migrate(cur) || {}; Object.assign(patch, p); Object.assign(cur, p); }
  }
  patch[VER_KEY] = to;
  return patch;
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function fmtDate(d) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || ''); return m ? (+m[3]) + ' ' + MON[+m[2] - 1] + ' ' + m[1] : String(d || ''); }

// The descriptor a pinnable native is registered with: + the Version setting (first row; default = base, so saved charts without
// it load as before), and new adds start on the latest version. Everything else is the original descriptor.
export function withVersion(desc) {
  const key = 'b:' + (desc && desc.type);
  if (!desc || !pinnable(key) || typeof desc.inputsSchema !== 'function') return desc;
  const p = pickable(key), e = entry(key), last = p[p.length - 1].v;
  const input = { key: VER_KEY, title: 'Version', type: 'string', defval: e.base, options: p.map((x) => x.v),
    display: { options: Object.fromEntries(p.map((x) => ['' + x.v, 'v' + x.v + ' · ' + fmtDate(x.date) + (x.v === last ? ' (latest)' : '')])) },
    tooltip: 'Your chart stays on the version it was added with. Pick an older version to go back, or the latest to update.' };
  let src = null, out = null;
  const schema = () => { const s = desc.inputsSchema() || []; if (s !== src) { src = s; out = [input].concat(s.filter((i) => i.key !== VER_KEY)); } return out; };
  const defs = () => Object.assign(desc.defaultInputs ? desc.defaultInputs() : Object.fromEntries((desc.inputsSchema() || []).map((i) => [i.key, i.defval])), { [VER_KEY]: last });
  return Object.assign({}, desc, { inputsSchema: schema, defaultInputs: defs, __stkVer: input });
}
