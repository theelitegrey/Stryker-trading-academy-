// Consistency check: recompute win rate / PF / net from the RAW seeded journal docs and compare with what the app shows.
import * as G from './lib/gcp.mjs';
import fs from 'node:fs';
const uid = Object.fromEntries(fs.readFileSync(process.env.DEMO_CREDENTIALS || '/root/.hermes/profiles/chief-of-staff/secure/demo-account/credentials','utf8').split('\n').filter(l=>l.includes('=')).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1)])).uid;
const paths = (await G.listPaths(`students/${uid}/journal`)).filter(p => !/\/_/.test(p));
const docs = []; for (const p of paths) docs.push(await G.getDoc(p));
const PV = { NQ: 20, MNQ: 2, ES: 50, MES: 5 };
let w = 0, l = 0, gw = 0, gl = 0, net = 0, bad = 0;
for (const t of docs) {
  const pts = (t.direction === 'long' ? 1 : -1) * (t.exitPrice - t.entryPrice);
  const exp = Math.round((pts * PV[t.instrument] * (t.positionSize / PV[t.instrument]) - (t.fees || 0)) * 100) / 100;   // positionSize is $/pt
  if (Math.abs(exp - t.pnl) > 0.51) bad++;
  net += t.pnl; if (t.pnl > 0) { w++; gw += t.pnl; } else if (t.pnl < 0) { l++; gl -= t.pnl; }
}
console.log({ trades: docs.length, wins: w, losses: l, winRate: +(100 * w / (w + l)).toFixed(2), pf: +(gw / gl).toFixed(2), net: +net.toFixed(2), pnlMismatches: bad });
