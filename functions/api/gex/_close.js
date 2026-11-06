// GEX "Daily close" levels (Owner order 2026-11-06). GET /api/gex/levels/:name?dte=N&basis=close
//
// Same engine, same response shape as the levels updated through the day, built from STORED data only (no options vendor
// call, hybrid off): the compact Cboe chains the recorder froze nearest 16:00 ET of the last completed session
// (book-recorder /gex-close, workers/book-recorder/src/gex-close.js). Priced at the next session's 09:30 ET open so
// the expiry picked is the one that trades next and nothing moves during the day. Futures conversion uses the
// futures (and NDX) price at the chain time, i.e. the basis at the close.
// No frozen chain yet (first days after deploy, feeder gap) -> the GEX history snapshot nearest 16:00 ET
// (/gex-history, 16:00-16:16 ET window, walking back up to 5 weekdays): call / put wall, zero gamma, expected range
// and ladder of that snapshot, wall_method 'close_snapshot'.
// Extra fields: basis 'close', close { day, label, ct, source, fallback }. Education only. Not financial advice.
import { buildLevels, convertLevels, etEpoch } from './_engine.js';
import { pickClose, lastSessionDay, nextOpen, closeLabel, closeSnapRows, etAt } from '../../../workers/book-recorder/src/gex-close.js';

const REC = 'https://book-recorder.theelitegrey.workers.dev';
const recBase = (env) => ((env && env.GEX_CHAIN_URL) || (REC + '/gex-chain')).replace(/\/gex-chain$/, '');

async function get(url, env, ms = 4000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort('timeout'), ms);
  try { return await fetch(url, { signal: ctrl.signal, headers: { 'user-agent': 'TradeZoroGEX/1.0', authorization: (env && env.GEX_AUTH) || '' } }); }
  finally { clearTimeout(t); }
}
async function frozenChain(name, part, env) {
  const r = await get(recBase(env) + '/gex-close?sym=' + encodeURIComponent(name) + '&part=' + part, env);
  if (r.status !== 200) return null;
  const text = await new Response(new Blob([await r.arrayBuffer()]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  return { d: JSON.parse(text), day: r.headers.get('x-gex-close-day'), fallback: r.headers.get('x-gex-close-fallback') === '1' };
}
async function historyClose(name, d, nowSec, env) {
  let day = lastSessionDay(nowSec);
  for (let i = 0; i < 5; i++) {
    const t0 = etAt(day, 16 * 60);
    const r = await get(recBase(env) + '/gex-history?u=' + encodeURIComponent(name) + '&dte=' + d + '&from=' + (t0 - 60) + '&to=' + (t0 + 17 * 60), env);
    if (r.status === 200) {
      const p = await r.json();
      const snaps = (p.t || []).map((t, j) => {
        const row = p.g[j] || [0], k = [], g = [];
        for (let x = 1; x < row.length; x++) if (row[x] !== null) { k.push(p.k[row[0] + x - 1]); g.push(row[x]); }
        return { t, day: p.day[j], s: p.s[j], cw: p.cw[j], pw: p.pw[j], zg: p.zg[j], n: p.n[j], em: p.em[j], x: p.x[j], k, g };
      });
      const pk = pickClose(closeSnapRows(snaps), nowSec);
      if (pk && pk.row.day === day) return { snap: pk.row.snap, day, fallback: day !== lastSessionDay(nowSec) };
    } else if (r.status === 403) throw new Error('pro_required');
    // step back one weekday (holiday / no snapshot that day)
    const dt = new Date(day + 'T12:00:00Z');
    do dt.setUTCDate(dt.getUTCDate() - 1); while (dt.getUTCDay() === 0 || dt.getUTCDay() === 6);
    day = dt.toISOString().slice(0, 10);
  }
  return null;
}

// Pure: an API-shaped response from one history snapshot (the fields the page and the chart read).
export function snapResponse(name, snap, dte, futures) {
  const em = Array.isArray(snap.em) && snap.em.every((v) => typeof v === 'number') ? snap.em : null;
  const expected = em ? { '68%': [em[0] - em[1], em[0] + em[1]], '80%': [em[0] - 1.2816 * em[1], em[0] + 1.2816 * em[1]] } : { '68%': [null, null], '80%': [null, null] };
  const near = snap.k.map((k, i) => ({ strike: k, gex: snap.g[i] * 1e6, dex: 0, oi: 0 })).filter((x) => Math.abs(x.strike - snap.s) / snap.s < 0.04).sort((a, b) => b.strike - a.strike);
  const net = typeof snap.n === 'number' ? snap.n * 1e6 : null;
  return {
    call_wall: snap.cw, put_wall: snap.pw, zero_gamma: snap.zg, net_gex: net, regime: net > 0 ? 'POSITIVE' : 'NEGATIVE', wall_source: 'gamma',
    wall_method: 'close_snapshot', wall_note: 'from the recorded snapshot nearest the 16:00 ET close (selected expiry)',
    wall_basis: { days: null, expiries: [snap.x, snap.x], contracts: null },
    walls_0dte: dte === 0 ? { call: snap.cw, put: snap.pw, expiry: snap.x, dte: 0 } : null,
    profile: { k: snap.k, g: snap.g }, max_pain: null,
    underlying: name, spot: snap.s, iv30: null, contracts: snap.k.length, source: 'cboe', sources: { chain: 'cboe', history: true }, compare: null,
    expected, expected_info: { method: 'recorded', held: true, phase: 'close' },
    asof: null, expiry: snap.x, expiry_dte: null, ladder: near, futures, session: {}, warnings: []
  };
}

export async function buildCloseLevels(name, dte, env = {}, opts = {}) {
  const nowSec = opts.now || Date.now() / 1000;
  const part = dte === 0 || dte === 1 ? 'near' : 'term';
  const fz = opts.frozen !== undefined ? opts.frozen : {
    near: part === 'near' ? await frozenChain(name, 'near', env).catch(() => null) : null,
    term: await frozenChain(name, 'term', env).catch(() => null)
  };
  const main = part === 'near' ? fz.near : fz.term;
  let data;
  if (main && main.d) {
    const day = main.day, ct = etEpoch(main.d.chain_time) || main.d.fetched_at;
    const term = fz.term && fz.term.day === day ? fz.term.d : null;
    data = await buildLevels(name, dte, env, { now: nextOpen(day), frozen: true, hybrid: false, compact: main.d, compactTerm: term, futAt: ct, insightQuotes: null });
    data.close = { day, label: closeLabel(day), ct, source: 'chain', fallback: !!main.fallback };
  } else {
    const h = opts.history !== undefined ? opts.history : await historyClose(name, dte === 0 ? 0 : 1, nowSec, env);
    if (!h) throw new Error('no daily close stored yet');
    const s = h.snap;
    const e = Array.isArray(s.em) ? s.em : null;
    const raw = { call_wall: s.cw, zero_gamma: s.zg, wall0_call: dte === 0 ? s.cw : null, wall0_put: dte === 0 ? s.pw : null, spot: s.s, put_wall: s.pw,
      iv68_lo: e ? e[0] - e[1] : null, iv68_hi: e ? e[0] + e[1] : null, iv80_lo: e ? e[0] - 1.2816 * e[1] : null, iv80_hi: e ? e[0] + 1.2816 * e[1] : null };
    const futures = opts.convert ? await opts.convert(name, s.s, raw, s.t) : await convertLevels(name, s.s, raw, s.t);
    data = snapResponse(name, s, dte, futures);
    data.close = { day: h.day, label: closeLabel(h.day), ct: s.t, source: 'history', fallback: !!h.fallback };
    data.asof = new Date(s.t * 1000).toISOString();
  }
  data.basis = 'close';
  data.fetched_at = Date.now() / 1000;
  // the close levels never move: the status reads "Levels from <day> close", not a market state
  data.market = { state: 'close', now: data.fetched_at, options_ts: data.close.ct, futures_ts: null, data_ts: data.close.ct, chain_ts: data.close.ct };
  return data;
}
