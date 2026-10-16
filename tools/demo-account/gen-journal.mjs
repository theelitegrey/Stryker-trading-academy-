// Generates the demo journal (data/journal.json) from REAL historical bars. Run: node gen-journal.mjs
// Entries/exits sit inside real candle ranges of the minute (1m/5m bars where the API has them, hourly bars further back).
// P&L uses the app's own journalComputeDerived: pnl = (exit - entry) x positionSize - fees, with positionSize = contracts x
// point value (the convention of the app's own sample journal), fees = commission per contract per side x 2 x contracts.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rng } from './lib/rng.mjs';
import { getBars, nyToEpoch, nyParts } from './lib/bars.mjs';
import { journalCalc } from './lib/appcode.mjs';
import { makeNote } from './lib/notes.mjs';
import { getDoc } from './lib/gcp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SEED = Number(process.env.SEED || 20261016);
const OUT = process.env.OUT || 'journal.json';
const rn = rng(SEED);
const calc = journalCalc();
const ACCOUNT = 50000;
const START = process.env.START || '2026-06-22', END = '2026-10-14';
const NO_TRADE_WEEKS = new Set(['2026-08-03']);          // a week off
const THIN_WEEKS = new Set(['2026-09-21']);              // almost flat week
const HOLIDAYS = new Set(['2026-07-03', '2026-09-07']);
const FINE_FROM = '2026-08-19';                          // 5m history starts about here, 1m about 29 days back

const INS = {
  NQ:  { pv: 20, feeSide: 2.2,  stop: [12, 32], ct: [1, 2], tick: 0.25 },
  MNQ: { pv: 2,  feeSide: 0.62, stop: [12, 32], ct: [3, 8], tick: 0.25 },
  ES:  { pv: 50, feeSide: 2.2,  stop: [3, 7.5], ct: [1, 2], tick: 0.25 },
  MES: { pv: 5,  feeSide: 0.62, stop: [3, 7.5], ct: [3, 10], tick: 0.25 }
};
const SESS = {
  'London': [185, 330], 'London/NY Overlap': [480, 560], 'New York AM': [575, 690], 'New York PM': [810, 930]
};
const SETUPS = [['ICT 2022', 22], ['Liquidity Sweep', 16], ['IFVG', 14], ['FVG', 14], ['ORB', 12], ['MSS', 10], ['Silver Bullet', 7], ['Order Block', 5]];
const MODEL_FOR = { 'ICT 2022': 'ict-2022-model', 'Silver Bullet': 'silver-bullet-model', 'IFVG': 'ifvg-model-c', 'ORB': 'orb-model-a', 'FVG': 'fvg-model-b' };

const r2 = (n) => Math.round(n * 100) / 100;
const tickR = (p, t) => Math.round(p / t) * t;
const dayAdd = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const dow = (d) => new Date(d + 'T12:00:00Z').getUTCDay();
const mondayOf = (d) => dayAdd(d, -((dow(d) + 6) % 7));

// ---- playbooks (built from the academy's taught models, as the app's pbFromModel does) -----
async function buildPlaybooks() {
  const out = [];
  const colours = ['#03a872', '#3f7fe8', '#b07c0e', '#8b7dd8', '#d1685a', '#4aa3a3'];
  let ci = 0;
  for (const [setup, mid] of Object.entries(MODEL_FOR)) {
    const m = await getDoc('models/' + mid);
    if (!m) continue;
    const id = 'pb_' + mid.replace(/[^a-z0-9]/g, '').slice(0, 10) + '1';
    out.push({
      id, name: m.name, source: 'model', sourceModelId: mid, market: 'NQ', timeframe: setup === 'ORB' ? '5m' : '1m', direction: 'both',
      sessions: ['New York AM'], status: setup === 'ICT 2022' || setup === 'Silver Bullet' ? 'active' : 'testing',
      colour: colours[ci++ % colours.length], targetRR: setup === 'ICT 2022' ? 2.5 : 2, maxRiskPct: 1, notes: '',
      rules: (m.steps || []).map((s, i) => ({ id: `r_${mid.slice(0, 6).replace(/[^a-z0-9]/g, '')}${i}`, text: String(s.title || s.desc || 'Step ' + (i + 1)), detail: s.title && s.desc && s.title !== s.desc ? String(s.desc) : '' })),
      createdAt: Date.parse('2026-06-24T14:00:00Z'), updatedAt: Date.parse('2026-09-30T14:00:00Z'), _setup: setup
    });
  }
  return out;
}

// ---- trade slots -------------------------------------------------------------------------------
function buildSlots() {
  const slots = [];
  for (let d = START; d <= END; d = dayAdd(d, 1)) {
    const w = dow(d); if (w === 0 || w === 6 || HOLIDAYS.has(d)) continue;
    const mon = mondayOf(d);
    if (NO_TRADE_WEEKS.has(mon)) continue;
    if (THIN_WEEKS.has(mon) && !(w === 3 || w === 4)) continue;
    if (!rn.chance(THIN_WEEKS.has(mon) ? 0.7 : 0.97)) continue;
    let n = rn.weighted([[1, 22], [2, 38], [3, 28], [4, 12]]);
    if (THIN_WEEKS.has(mon)) n = 1;
    const used = [];
    for (let i = 0; i < n; i++) {
      const session = rn.weighted([['New York AM', 68], ['London', 12], ['New York PM', 14], ['London/NY Overlap', 6]]);
      const setup = rn.weighted(SETUPS.filter(([s]) => s !== 'ORB' || session === 'New York AM'));
      const [a, b] = setup === 'ORB' ? [575, 620] : setup === 'Silver Bullet' ? (session === 'New York AM' ? [600, 660] : SESS[session]) : SESS[session];
      slots.push({ date: d, session, setup, win: [a, b], inst: rn.weighted([['NQ', 38], ['MNQ', 24], ['ES', 22], ['MES', 16]]) });
    }
  }
  // order within a day by a random minute
  for (const s of slots) s.m0 = rn.int(s.win[0], s.win[1]);
  slots.sort((x, y) => x.date === y.date ? x.m0 - y.m0 : x.date.localeCompare(y.date));
  return slots;
}

// desired outcomes: ~58% base win chance, with scripted losing streaks and a couple of hot runs
function assignOutcomes(slots) {
  const N = slots.length;
  const streaks = [[Math.floor(N * 0.17), 5], [Math.floor(N * 0.46), 4], [Math.floor(N * 0.74), 6]];
  const hot = [[Math.floor(N * 0.30), 5], [Math.floor(N * 0.88), 4]];
  let lossRun = 0;
  slots.forEach((s, i) => {
    let win = rn.chance(0.5);
    for (const [a, len] of streaks) if (i >= a && i < a + len) win = false;
    for (const [a, len] of hot) if (i >= a && i < a + len) win = true;
    const scripted = streaks.some(([a, len]) => i >= a && i < a + len);
    if (!win && !scripted && lossRun >= 3) win = true;       // no accidental streaks beyond the scripted ones
    s.want = win ? 'win' : 'loss';
    lossRun = win ? 0 : lossRun + 1;
    s.afterLosses = lossRun - 1;
  });
}

// ---- bar walking ----------------------------------------------------------------------------------
function walk(bars, i, dir, entry, stop, tp, maxBars) {
  const S = Math.abs(entry - stop), T = Math.abs(tp - entry);
  let earlyLoss = null, earlyWin = null;
  for (let k = i; k < Math.min(bars.length, i + maxBars); k++) {
    const b = bars[k];
    const slHit = dir > 0 ? b[3] <= stop : b[2] >= stop;
    const tpHit = dir > 0 ? b[2] >= tp : b[3] <= tp;
    if (slHit) { const gap = dir > 0 ? b[1] < stop : b[1] > stop; return { kind: 'sl', k, px: gap ? b[1] : stop, earlyWin, earlyLoss }; }
    if (tpHit) return { kind: 'tp', k, px: tp, earlyWin, earlyLoss };
    const adv = dir > 0 ? entry - b[4] : b[4] - entry, fav = -adv;
    if (!earlyLoss && adv >= 0.55 * S) earlyLoss = { k, px: b[4] };
    if (!earlyWin && fav >= 0.7 * T) earlyWin = { k, px: b[4] };
  }
  const k = Math.min(bars.length, i + maxBars) - 1;
  return { kind: 'timeout', k, px: bars[k][4], earlyWin, earlyLoss };
}

async function fineTrade(slot, spec) {
  // 1m bars when available (last ~28 days), else 5m
  const tf = slot.date >= dayAdd(END, -27) ? '1' : '5';
  const from = nyToEpoch(slot.date, 170), to = nyToEpoch(slot.date, 17 * 60);
  const bars = await getBars(slot.inst, tf, from, to);
  if (bars.length < 60) return null;
  for (let attempt = 0; attempt < 300; attempt++) {
    const m = tf === '1' ? rn.int(slot.win[0], slot.win[1]) : Math.floor(rn.int(slot.win[0], slot.win[1]) / 5) * 5;
    const t = nyToEpoch(slot.date, m);
    const i = bars.findIndex((b) => b[0] === t);
    if (i < 0 || i > bars.length - 40) continue;
    const dir = rn.chance(0.5) ? 1 : -1;
    const slip = rn.int(0, 1) * spec.tick;
    const entry = tickR(bars[i][1] + dir * slip, spec.tick);
    const S = tickR(rn.between(spec.stop[0], spec.stop[1]), spec.tick);
    const rr = rn.pick([1, 1.5, 1.5, 2, 2, 2.5]);
    const stop = entry - dir * S, tp = tickR(entry + dir * S * rr, spec.tick);
    const w = walk(bars, i, dir, entry, stop, tp, tf === '1' ? 75 : 20);
    const out = pickExit(slot, w, dir, entry, stop, tp, spec);
    if (!out) continue;
    return Object.assign(out, { dir, entry, stop, tp, minutes: m });
  }
  return null;
}

// returns {exit} when the natural/early outcome matches the wanted result
function pickExit(slot, w, dir, entry, stop, tp, spec) {
  const net = (px) => (px - entry) * dir * spec.pv;   // per 1x multiplier (fees ignored for sign unless tiny)
  const wantWin = slot.want === 'win';
  if (wantWin) {
    if (w.kind === 'tp') { if (w.earlyWin && rn.chance(0.45) && net(w.earlyWin.px) > 6) return { exit: w.earlyWin.px, how: 'early' }; return { exit: w.px, how: 'tp' }; }
    if (w.kind === 'timeout' && net(w.px) > 8 * spec.pv / 20 && rn.chance(0.5)) return { exit: w.px, how: 'timeout' };
    return null;
  }
  if (w.kind === 'sl') { if (w.earlyLoss && rn.chance(0.3) && net(w.earlyLoss.px) < -6) return { exit: w.earlyLoss.px, how: 'early' }; return { exit: w.px, how: 'sl' }; }
  if (w.kind === 'timeout' && net(w.px) < -8 * spec.pv / 20) return { exit: w.px, how: 'timeout' };
  return null;
}

async function hourlyTrade(slot, spec) {
  const from = nyToEpoch(slot.date, 8 * 60), to = nyToEpoch(slot.date, 17 * 60);
  const bars = await getBars(slot.inst, '60', from - 3600, to);
  if (!bars.length) return null;
  const wantWin = slot.want === 'win';
  for (let attempt = 0; attempt < 300; attempt++) {
    const m = rn.int(slot.win[0], slot.win[1]);
    const hourStart = Math.floor(m / 60) * 60;
    const b = bars.find((x) => x[0] === nyToEpoch(slot.date, hourStart));
    if (!b) continue;
    const mi = m - hourStart; if (mi > 40) continue;
    const [, , H, L] = b;
    const rangeH = H - L; if (rangeH < 2 * spec.stop[0] * 0.5) continue;
    const e = tickR(L + rn.between(0.15, 0.85) * rangeH, spec.tick);
    const longFav = H - e, shortFav = e - L;
    let dir;
    if (wantWin) dir = (longFav > shortFav) === rn.chance(0.75) ? 1 : -1; else dir = rn.chance(0.5) ? 1 : -1;
    const fav = dir > 0 ? H - e : e - L, adv = dir > 0 ? e - L : H - e;
    let S, tp, exit;
    if (wantWin) {
      S = tickR(Math.max(rn.between(spec.stop[0], spec.stop[1]), adv + spec.tick * 2), spec.tick);
      if (S > spec.stop[1] * 1.15) continue;
      const maxRR = (fav * 0.92) / S; if (maxRR < 1.0) continue;
      const rr = Math.min(maxRR, rn.pick([1, 1.5, 1.5, 2, 2.5]));
      exit = tickR(e + dir * S * rr * rn.between(0.55, 1), spec.tick); tp = tickR(e + dir * S * Math.max(rr, 1.5) * 1.05, spec.tick);
      if ((exit - e) * dir <= spec.tick * 2) continue;
      if (dir > 0 ? exit > H : exit < L) continue;
    } else {
      S = tickR(rn.between(spec.stop[0], spec.stop[1]), spec.tick);
      if (S > adv * 0.97) continue;
      exit = tickR(e - dir * S, spec.tick); tp = tickR(e + dir * S * rn.pick([2, 2.5, 3]), spec.tick);
    }
    return { exit, how: wantWin ? 'tp' : 'sl', dir, entry: e, stop: tickR(e - dir * S, spec.tick), tp, minutes: m };
  }
  return null;
}

const SESSION_BY_MIN = (m) => (m < 480 ? 'London' : m < 570 ? 'London/NY Overlap' : m < 780 ? 'New York AM' : 'New York PM');

async function main() {
  const slots = buildSlots(); assignOutcomes(slots);
  console.log('slots', slots.length);
  const playbooks = await buildPlaybooks();
  const pbBySetup = Object.fromEntries(playbooks.map((p) => [p._setup, p]));
  const used = new Set(); const trades = [];
  let prevLoss = 0, failed = 0;
  for (const slot of slots) {
    const spec = INS[slot.inst];
    const res = slot.date >= FINE_FROM ? await fineTrade(slot, spec) : await hourlyTrade(slot, spec);
    if (!res) { failed++; continue; }
    const contracts = (() => { const stopPts = Math.abs(res.entry - res.stop); const riskPer = stopPts * spec.pv; const target = rn.between(110, 300); let c = Math.round(target / riskPer); const [lo, hi] = spec.ct; return Math.max(lo, Math.min(hi, c)); })();
    const tilt = slot.afterLosses >= 2 && rn.chance(0.4);
    const fomo = !tilt && rn.chance(0.06);
    const oversized = tilt && rn.chance(0.5);
    const cts = oversized ? Math.min(spec.ct[1] + 2, contracts + 2) : contracts;
    const size = cts * spec.pv;
    const fees = r2(spec.feeSide * 2 * cts);
    const dirName = res.dir > 0 ? 'long' : 'short';
    const pts = (res.exit - res.entry) * res.dir;
    const mins = res.minutes;
    const hh = String(Math.floor(mins / 60)).padStart(2, '0'), mm = String(mins % 60).padStart(2, '0');
    const raw = {
      date: slot.date, time: `${hh}:${mm}`, instrument: slot.inst, direction: dirName,
      entryPrice: res.entry, exitPrice: res.exit, positionSize: size, fees, stopLoss: res.stop, takeProfit: res.tp,
      setup: slot.setup, session: SESSION_BY_MIN(mins), account: '', tags: [], playbookId: null, rulesMet: null, notes: ''
    };
    const d = calc.journalComputeDerived(raw, ACCOUNT);
    const win = d.pnl > 0;
    // tags
    const tags = [];
    if (tilt) tags.push('Revenge trade', 'Plan broken'); else if (fomo) tags.push('FOMO', 'Plan broken');
    else { tags.push('Plan followed'); if (win && Math.abs(d.rMultiple || 0) >= 1.8 && rn.chance(0.6)) tags.push('A+ setup'); }
    raw.tags = tags;
    const pb = pbBySetup[slot.setup];
    if (pb && !tilt) {
      raw.playbookId = pb.id;
      const ids = pb.rules.map((r) => r.id);
      raw.rulesMet = win || rn.chance(0.5) ? ids.slice() : ids.filter(() => rn.chance(0.8));
      if (fomo) raw.rulesMet = ids.slice(0, Math.max(1, ids.length - 2));
    }
    if (!rn.chance(0.14)) raw.notes = makeNote(rn, { setup: slot.setup, dir: dirName, win, r: d.rMultiple || 0, pts, tilt, fomo }, used);
    trades.push(Object.assign(raw, d));
  }
  const agg = calc.journalAggregateStats(trades);
  console.log({ n: trades.length, failedSlots: failed, winRate: r2(agg.winRate), pf: r2(agg.profitFactor), net: r2(agg.totalPnl), avgWin: r2(agg.avgWin), avgLoss: r2(agg.avgLoss) });
  // max drawdown + streaks
  let eq = 0, peak = 0, dd = 0, run = 0, maxRun = 0;
  for (const t of trades) { eq += t.pnl; peak = Math.max(peak, eq); dd = Math.max(dd, peak - eq); run = t.pnl < 0 ? run + 1 : 0; maxRun = Math.max(maxRun, run); }
  console.log({ maxDrawdown: r2(dd), maxLossStreak: maxRun, byIns: Object.fromEntries(['NQ', 'MNQ', 'ES', 'MES'].map((k) => [k, trades.filter((t) => t.instrument === k).length])) });
  fs.mkdirSync(path.join(HERE, 'data'), { recursive: true });
  fs.writeFileSync(path.join(HERE, 'data/' + OUT), JSON.stringify({ seed: SEED, account: ACCOUNT, trades }, null, 1));
  if (!process.env.OUT) fs.writeFileSync(path.join(HERE, 'data/playbooks.json'), JSON.stringify(playbooks.map(({ _setup, ...p }) => p), null, 1));
}
main().catch((e) => { console.error(e); process.exit(1); });
