// Research only (GEX compare). Runs our GEX engine (functions/api/gex/_engine.js) on this server and appends one
// JSON line per symbol to ours.jsonl. Reads the recorder with the server's own ingest key (BOOK_INGEST_SECRET,
// from feeder.env via the systemd unit), the same path the feeders use. No new bypass, no secret printed or stored.
// Usage: node gex_snapshot.mjs [OUT.jsonl]
import fs from 'node:fs';
import { buildLevels, fetchCompact, compactToContracts, ownGamma, profile, gammaWalls, gammaFlip } from '../../functions/api/gex/_engine.js';

const OUT = process.argv[2] || '/root/projects/stryker-notes/reports/gex-compare/ours.jsonl';
const key = process.env.BOOK_INGEST_SECRET || '';
if (!key) { console.error('BOOK_INGEST_SECRET missing'); process.exit(2); }
const realFetch = globalThis.fetch;
globalThis.fetch = (u, o = {}) => String(u).includes('/gex-chain')
  ? realFetch(u, { ...o, headers: { ...(o.headers || {}), 'x-ingest-key': key } }) : realFetch(u, o);

const ny = new Date().toLocaleString('sv-SE', { timeZone: 'America/New_York' }); // "YYYY-MM-DD HH:MM:SS"
const [date, time_ny] = [ny.slice(0, 10), ny.slice(11, 16)];
const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);
const lines = [];
// 'allexp' variant: same gammaWalls() but over every expiry in the term chain we download (today's left out),
// flip over all of them incl. today, top-10 strikes by |net GEX|. shortcut: the term chain holds expiries <=31 days
// only (feeder filter), so this is NOT the full chain; a true all-expiry run needs a feeder change.
async function allexp(sym, d, fut) {
  const now = Date.now() / 1000;
  const td = await fetchCompact(sym, 30, {});
  const all = ownGamma(compactToContracts(td, 100000, now).contracts, d.spot, now);
  const main = all.filter((c) => c.dte >= 1);
  const p = profile(d.spot, main);
  const [cw, pw] = gammaWalls(d.spot, p.callGex, p.putGex);
  const zg = gammaFlip(d.spot, all, 0.90, 1.10, 80, now);
  const top = [...p.gex].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 10).map(([strike, g]) => ({ strike, netGEX: r2(g) }));
  const maxDte = Math.max(...main.map((c) => c.dte));
  const base = { date, time_ny, variant: 'allexp', sym, spot: r2(d.spot), callWall: cw, putWall: pw, gammaFlip: r2(zg), topStrikes: top, source: 'tradezoro', wall_method: 'allexp_term_chain', max_dte: maxDte, chain_asof: d.asof };
  const out = [base];
  if (fut && !fut.error) { const cv = (v) => (v == null ? null : r2(v * fut.ratio + fut.basis)); out.push({ ...base, sym: fut.sym, mapped_from: sym, spot: r2(fut.futures_price), callWall: cv(cw), putWall: cv(pw), gammaFlip: cv(zg), topStrikes: [], basis: fut.basis }); }
  return out;
}
for (const sym of ['SPX', 'SPY', 'QQQ']) {
  try {
    const d = await buildLevels(sym, 1, {}, {});
    const top = [...d.ladder].sort((a, b) => Math.abs(b.gex) - Math.abs(a.gex)).slice(0, 5).map((x) => ({ strike: x.strike, netGEX: r2(x.gex) }));
    const base = { date, time_ny, variant: 'ours', sym, spot: r2(d.spot), callWall: d.call_wall, putWall: d.put_wall, gammaFlip: r2(d.zero_gamma), topStrikes: top, source: 'tradezoro', wall_method: d.wall_method, chain_asof: d.asof };
    lines.push(base);
    // mapped futures levels (NQ from QQQ, ES from SPX)
    const f = d.futures && d.futures[sym === 'QQQ' ? 'NQ' : sym === 'SPX' ? 'ES' : null];
    if (f && !f.error) { const L = f.levels || {}; lines.push({ date, time_ny, variant: 'ours', sym: sym === 'QQQ' ? 'NQ' : 'ES', mapped_from: sym, spot: r2(f.futures_price), callWall: r2(L.call_wall), putWall: r2(L.put_wall), gammaFlip: r2(L.zero_gamma), topStrikes: [], source: 'tradezoro', basis: f.basis }); }
    try { lines.push(...await allexp(sym, d, f && { ...f, sym: sym === 'QQQ' ? 'NQ' : 'ES' })); } catch (e) { lines.push({ date, time_ny, variant: 'allexp', sym, error: String(e.message || e).slice(0, 120), source: 'tradezoro' }); }
  } catch (e) { lines.push({ date, time_ny, variant: 'ours', sym, error: String(e.message || e).slice(0, 120), source: 'tradezoro' }); }
}
fs.mkdirSync(OUT.replace(/\/[^/]*$/, ''), { recursive: true });
fs.appendFileSync(OUT, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
console.log(lines.map((l) => JSON.stringify(l)).join('\n'));
