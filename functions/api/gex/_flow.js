// TradeZoro — GEX: options VOLUME by strike (calls vs puts) from the compact Cboe chain we already store.
// Pure maths for functions/api/gex/flow/[name].js and tools/tests/gex-flow.test.mjs. No network here.
//
// Input: the compact chain the server's gex-feeder posts to the book-recorder Worker every 2 min in market
// hours (workers/book-recorder/gex-feeder/gex_feeder.py, part 'near' = the first 3 expiries, strikes
// +-12%): { spot, chain_time ('YYYY-MM-DDTHH:MM:SS', New York), fetched_at (epoch s), expiries: { 'YYYY-MM-DD':
// [[strike, 'C'|'P', oi, iv, bid, ask, vol, delta], ...] } }.
// vol = the contract's traded volume for the chain's session (Cboe's day volume). Cboe gives NO
// aggressor side, so this is call volume vs put volume, never "bought" vs "sold". No premium: after the
// close the expired rows carry bid = ask = 0, and volume x today's mid is not what was paid.
// Education only. Not financial advice.

const BAND = 0.05;   // strikes within +-5% of spot are returned (the panel shows fewer)

const r2 = (v) => Math.round(v * 100) / 100;

export function flowFromChain(d, { band = BAND } = {}) {
  if (!d || !(Number(d.spot) > 0) || !d.expiries || typeof d.expiries !== 'object') return null;
  const spot = Number(d.spot);
  const day = String(d.chain_time || '').slice(0, 10);
  const dayMs = Date.parse(day + 'T00:00:00Z');
  const exps = [];
  const all = new Map();
  for (const x of Object.keys(d.expiries).sort()) {
    if (day && x < day) continue;   // an expiry before the chain's own session is not part of it
    const by = new Map();
    let calls = 0, puts = 0, coi = 0, poi = 0;
    for (const r of d.expiries[x] || []) {
      if (!Array.isArray(r) || r.length < 7) continue;
      const k = Number(r[0]), cp = r[1], oi = Math.max(0, Number(r[2]) || 0), vol = Math.max(0, Number(r[6]) || 0);
      if (!(k > 0) || (cp !== 'C' && cp !== 'P')) continue;
      if (cp === 'C') { calls += vol; coi += oi; } else { puts += vol; poi += oi; }
      if (Math.abs(k - spot) / spot > band) continue;
      for (const m of [by, all]) {
        let e = m.get(k);
        if (!e) { e = [k, 0, 0, 0, 0]; m.set(k, e); }
        if (cp === 'C') { e[1] += vol; e[3] += oi; } else { e[2] += vol; e[4] += oi; }
      }
    }
    const dte = Number.isFinite(dayMs) ? Math.round((Date.parse(x + 'T00:00:00Z') - dayMs) / 86400000) : null;
    exps.push({ x, dte, calls, puts, coi, poi, pc: calls > 0 ? r2(puts / calls) : null, rows: [...by.values()].sort((a, b) => a[0] - b[0]) });
  }
  const tot = exps.reduce((s, e) => ({ calls: s.calls + e.calls, puts: s.puts + e.puts, coi: s.coi + e.coi, poi: s.poi + e.poi }), { calls: 0, puts: 0, coi: 0, poi: 0 });
  return {
    v: 1, spot, chain_time: d.chain_time || null, chain_day: day || null, fetched_at: Number(d.fetched_at) || null, band,
    cols: ['strike', 'call_vol', 'put_vol', 'call_oi', 'put_oi'],
    expiries: exps,
    all: Object.assign({ x: 'all', dte: null, pc: tot.calls > 0 ? r2(tot.puts / tot.calls) : null, rows: [...all.values()].sort((a, b) => a[0] - b[0]) }, tot)
  };
}

// The strikes with the most call / put volume in a row list ([strike, cv, pv, ...]), biggest first.
export function topStrikes(rows, n = 3) {
  const by = (i) => rows.filter((r) => r[i] > 0).sort((a, b) => b[i] - a[i] || a[0] - b[0]).slice(0, n).map((r) => [r[0], r[i]]);
  return { calls: by(1), puts: by(2) };
}
// The rows around spot: `each` strikes below and above it (the strike nearest spot is in the upper half).
export function nearSpot(rows, spot, each = 10) {
  let i = rows.findIndex((r) => r[0] >= spot);
  if (i < 0) i = rows.length;
  return rows.slice(Math.max(0, i - each), i + each);
}
