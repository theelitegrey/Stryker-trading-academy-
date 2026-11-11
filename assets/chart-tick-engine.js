// TICK ENGINE on the chart (Owner order 2026-11-05). ONE candle source for futures: the bars come from the Worker's record of every trade
// (GET /te-bars, built from the same trades the socket streams), the forming candle from those trades (assets/tick-feed.js, the one socket
// per browser), joined by seq: the snapshot says q = seq of its newest trade, the stream delivers seq > q only. No delayed bars and live
// ticks are ever mixed inside one candle. Older history than our record comes from the old bars source ONCE, strictly before `rec` (the
// first whole bar of the record, a bar-close boundary), never interleaved.
// Who gets newer than 10 min is the SERVER's call from the verified token (/te-bars x-te-lane); a delayed answer has no seq and is polled.
// SWITCH: TICK_ENGINE below ('admins' = admin accounts only, the first rollout step; 'all'; 'off'). ?engine=0 falls back to the old path
// on this page load, ?engine=1 turns it on for a non-admin test (the server still decides the lane).
import { tfSpec, foldTick, sessionOpen } from './tick-codec.js?v=957';
import { feedConfig, feedJoin, feedTokenChanged } from './tick-feed.js?v=957';
import { rtReady, rtToken, isRealtimeAdmin, rtHeadersReady, rtOnChange, rtNoteStreamBar } from './rt-access.js?v=957';

export const TICK_ENGINE = 'admins';
// = TE_SYMBOLS in workers/book-recorder/src/tick-engine.js (tools/tests/tick-engine-client.test.mjs keeps the two equal)
export const TE_ROOTS = ['NQ', 'ES', 'MNQ', 'MES', 'YM', 'RTY', 'CL', 'GC', 'SI', 'ZN', '6E', 'MGC', 'MYM', 'M2K'];
const TFS = ['1', '5', '15', '30', '60', '120', '240', 'D'];
const RECORDER = 'https://book-recorder.theelitegrey.workers.dev';
const base = () => { try { if (window.__STK_BOOK_RECORDER !== undefined && window.__STK_BOOK_RECORDER) return window.__STK_BOOK_RECORDER; } catch (e) {} return RECORDER; };
const urlParam = () => { try { return new URLSearchParams(location.search).get('engine'); } catch (e) { return null; } };
let configured = false;
function config() {
  if (configured) return; configured = true;
  feedConfig(() => rtToken() || '', () => base().replace(/^http/i, 'ws') + '/ts-live');
  try { rtOnChange(() => feedTokenChanged()); } catch (e) {}
}
// N-tick timeframe '100T' -> 100, else 0 (= tickN in workers/book-recorder/src/tick-engine.js)
export const teTickN = (tf) => { const m = /^(\d+)T$/i.exec(String(tf || '')); const n = m ? +m[1] : 0; return n >= 1 && n <= 5000 ? n : 0; };
// may this page use the engine for root at tf ('1S'..'59S', '1'..'240', 'D', 'NT' ticks)? Async: waits for the sign-in answer.
export async function teWanted(root, tf) {
  if (!TE_ROOTS.includes(root) || !((TFS.includes(tf) || /^\d+S$/.test(tf)) && tfSpec(tf) || teTickN(tf))) return false;
  const p = urlParam();
  if (p === '0') return false;
  if (p === '1') return true;
  if (TICK_ENGINE === 'off') return false;
  if (TICK_ENGINE === 'all') return true;
  try { await rtReady(); } catch (e) {}
  return isRealtimeAdmin();
}
const toBar = (b) => ({ time: b[0], open: b[1], high: b[2], low: b[3], close: b[4], volume: b[5] });
const SPAN = (sp) => (sp.k === 's' ? 6 * 3600000 : sp.k === 'D' || sp.ms >= 3600000 ? 400 * 86400000 : 30 * 86400000);
const HIST = new Map();   // root|tf|rec -> Promise<bars before rec> (the old source, read once per record start)
export const teStatus = { lane: '', rec: 0, at: 0, n: 0 };

// one snapshot: { bars, e, q, rec, lane, more, c }. more = archive minutes the server could not fetch in this read's budget (ask
// again); c = trades in the last N-tick bar (the live fold continues it).
async function snapshot(root, tf, from, to, limit) {
  config();
  const u = base() + '/te-bars?sym=' + root + '&tf=' + tf + '&from=' + Math.floor(from) + '&to=' + Math.ceil(to) + (limit ? '&limit=' + limit : '');
  const r = await fetch(u, { headers: await rtHeadersReady(), cache: 'no-store' });
  if (!r.ok) throw new Error('te-bars ' + r.status);
  const j = await r.json();
  const lane = r.headers.get('x-te-lane') || (j.q != null ? 'live' : 'delayed');
  Object.assign(teStatus, { lane, rec: j.rec, at: Date.now(), n: j.b.length });
  return { bars: j.b, e: j.e, q: j.q, rec: j.rec, lane, more: j.more || 0, c: j.c || 0 };
}
// a read the server answered `more` (archive still being fetched for it): asked again, at most 3 more times
async function snapshotAll(root, tf, from, to, limit) {
  let s = await snapshot(root, tf, from, to, limit);
  for (let i = 0; i < 3 && s.more > 0; i++) s = await snapshot(root, tf, from, to, limit);
  return s;
}
// N-tick bars: the newest `limit` before range.to, counted by the server from the session open (same bars on every reload)
async function teTickBars(root, tf, range) {
  const now = Date.now(), want = range.limit != null ? range.limit : 500;
  const to = range.to != null ? Math.min(range.to + 1, now + 60000) : now + 60000;
  const s = await snapshotAll(root, tf, to - 2 * 86400000, to, Math.min(5000, want));
  let bars = s.bars.filter((b) => b[0] < to && (range.from == null || b[0] >= range.from)).map(toBar);
  if (bars.length > want) bars = bars.slice(-want);
  return bars;
}
// getBars for the engine: the record from rec, the old source before it (oldGetBars(range) = the provider's own getBars, no engine)
export async function teGetBars(root, tf, range, oldGetBars) {
  if (teTickN(tf)) return teTickBars(root, tf, range);
  const sp = tfSpec(tf), now = Date.now();
  const to = range.to != null ? Math.min(range.to + 1, now + 60000) : now + 60000;
  const want = range.limit != null ? range.limit : 500;
  let from = range.from != null ? range.from : to - Math.min(SPAN(sp), want * sp.ms * 3);
  from = Math.max(from, to - SPAN(sp));
  let s = await (sp.k === 's' ? snapshotAll : snapshot)(root, tf, from, to);
  let bars = s.bars.filter((b) => b[0] < to && (range.from == null || b[0] >= range.from)).map(toBar);
  // seconds, counted reads (first load / scroll-back): a window that is short (overnight, a weekend) steps back, 6 h at a time, while
  // the record or the archive still has data (rec moved back) and not past 3 days (the server keeps seconds SEC_DAYS)
  for (let k = 0; sp.k === 's' && range.from == null && bars.length < want && k < 12 && to - from < 3 * 86400000; k++) {
    const t1 = bars.length ? bars[0].time : from, f1 = t1 - SPAN(sp);
    if (s.rec > t1 && k > 0) break;   // the record does not reach further back (no archive key / older than the archive)
    const s1 = await snapshotAll(root, tf, f1, t1);
    bars = s1.bars.filter((b) => b[0] < t1).map(toBar).concat(bars);
    from = f1; s = Object.assign({}, s, { rec: Math.min(s.rec, s1.rec) });
  }
  // minutes / hours: a short window (a weekend, overnight) steps back to the record start before the old source is asked, so the old
  // source never fills in front of record bars that were simply outside the first window (HISTORY GAP 2, 2026-11-08)
  if (sp.k !== 's' && range.from == null && bars.length < want && from > s.rec && to > s.rec) {
    const f1 = Math.max(s.rec, to - SPAN(sp));
    if (f1 < from) { s = await snapshot(root, tf, f1, to); bars = s.bars.filter((b) => b[0] < to).map(toBar); from = f1; }
  }
  // the old source only covers what lies before the record AND before this read's `to`, and only once the window reached the record start
  const end = Math.min(s.rec, to);
  const need = range.from != null ? range.from < end : bars.length < want && from <= s.rec;
  if (need && oldGetBars) {
    // HISTORY GAP 2 (2026-11-08): the memo was keyed by rec alone, so every scroll-back read older than the record got the FIRST
    // load's chunk again (nothing older than the oldest bar -> 'genesis' -> the chart stopped at the record start). Keyed by end now.
    const lim = range.from != null ? undefined : Math.max(want - bars.length, 50);
    const key = root + '|' + tf + '|' + end + '|' + lim;
    let p = HIST.get(key);
    if (!p || range.from != null) {
      p = oldGetBars({ to: end - 1, from: range.from, limit: lim }).then((x) => (x || []).filter((b) => b.time < end)).catch(() => []);
      if (range.from == null) { HIST.set(key, p); if (HIST.size > 40) HIST.delete(HIST.keys().next().value); }
    }
    const old = await p;
    bars = old.concat(bars);
  }
  if (range.limit != null && bars.length > range.limit) bars = bars.slice(-range.limit);
  return bars;
}
// subscribe: the snapshot's newest bars, then every trade after its seq folded into the forming candle. Delayed lane (no seq): re-read
// the newest bars every 15 s. Resync (Durable Object restart / a hole): read the bars again and join again.
// fallback(): the old live path (provider.subscribeOld). Taken when the record cannot be read on the FIRST try (the Worker without the
// engine answers /te-bars 404, a network block): the chart then streams exactly as before instead of retrying a record that is not there.
// The same trades also feed every tick consumer of root (chart-futures-l2.js teTicks: live footprint, Big Trades, delta, book tools).
export function teSubscribe(root, tf, onBar, fallback) {
  const sp = tfSpec(tf), tn = teTickN(tf);
  let tc = 0, tso = 0, tnext = 0;   // N-tick fold: trades in the last bar, its session open, the next session open
  const fold = (x) => {   // x = [ts, px, size, side] -> the touched bar (same rule as the server's tickBars)
    if (!tn) return foldTick(bars, x, sp);
    const [ts, px, sz, side] = x; let b = bars[bars.length - 1];
    if (!b || ts >= tnext) { tso = sessionOpen(ts); tnext = sessionOpen(tso + 25 * 3600000); if (!b || b[0] < tso) tc = tn; }   // a new session opens a new bar
    if (tc >= tn) { b = [Math.max(ts, b ? b[0] + 1 : ts), px, px, px, px, 0, 0]; bars.push(b); tc = 0; }
    if (px > b[2]) b[2] = px; if (px < b[3]) b[3] = px; b[4] = px; b[5] += sz; if (side > 0) b[6] += sz; tc++;
    return b;
  };
  let stopped = false, leave = null, timer = null, bars = [], fails = 0, lastTT = 0, fed = false, ok = false, old = null;
  const L2p = import('./chart-futures-l2.js?v=957').catch(() => null);
  let L2 = null;
  const emit = (b) => { if (!stopped) onBar(toBar(b)); };
  // the same "this root is fed" flag the hub path sets (window.__stkL2Live): the data dot / status read it, no copy of their own here
  const setFed = (v) => { if (v === fed) return; fed = v; if (L2) L2.teOwn(root, v); try { const L = window.__stkL2Live || (window.__stkL2Live = new Set()); if (v) L.add(root); else L.delete(root); window.dispatchEvent(new Event('stryker:l2live')); } catch (e) {} };
  const quiet = setInterval(() => { if (fed && Date.now() - lastTT > 20000) setFed(false); }, 5000);
  const go = async () => {
    timer = null;
    if (stopped) return;
    if (leave) { leave(); leave = null; }
    let s;
    try { const now = Date.now(); s = tn ? await snapshot(root, tf, now - 86400000, now + 60000, 3) : await snapshot(root, tf, now - Math.max(sp.ms * 3, 120000), now + 60000); fails = 0; }
    catch (e) {
      if (stopped) return;
      if (!ok && fallback) { teStatus.lane = 'fallback'; stopped = true; clearInterval(quiet); old = fallback(); return; }
      fails++; timer = setTimeout(go, Math.min(30000, 1000 * Math.pow(2, fails))); return;
    }
    ok = true;
    if (!L2) L2 = await L2p;
    if (stopped) return;
    bars = s.bars.slice(-3).map((b) => b.slice());
    if (tn) { tc = s.c; const l = bars[bars.length - 1]; tso = l ? sessionOpen(l[0]) : 0; tnext = l ? sessionOpen(tso + 25 * 3600000) : 0; }
    bars.forEach(emit);
    if (s.q == null) { timer = setTimeout(go, 15000); return; }   // delayed lane: the server gave no seq, there is no stream to join
    leave = feedJoin(root, s.e, s.q, (f) => {
      if (stopped) return;
      if (f.type === 'resync') { setFed(false); if (!timer) timer = setTimeout(go, 300); return; }
      if (f.type !== 'tt') return;
      lastTT = Date.now(); setFed(true);
      if (L2) L2.teTicks(root, f.e, f.q, f.t);
      try { rtNoteStreamBar(); } catch (e) {}   // the data dot's "stream is delivering" proof, as on the hub path
      let touched = null;
      for (const x of f.t) { const b = fold([x[3], x[0], x[1], x[2]]); if (b) { if (touched && touched !== b) emit(touched); touched = b; } }
      if (bars.length > 5) bars.splice(0, bars.length - 5);
      if (touched) emit(touched);
    });
  };
  go();
  return () => { stopped = true; clearInterval(quiet); setFed(false); if (timer) clearTimeout(timer); if (leave) leave(); if (old) { const o = old; old = null; o(); } };
}
