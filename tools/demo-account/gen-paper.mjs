// Builds the paper-trading account state by driving the app's OWN PaperEngine (assets/paper-engine.js) in Node:
// each trade is a real market order with SL/TP, then a price segment that touches the exit (or a manual close), so
// balance, fees, R, MAE/MFE, leverage and history are engine output. Input: data/paper-src.json (gen-journal, seed 20261017).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { paperEngine } from './lib/appcode.mjs';
import { nyToEpoch } from './lib/bars.mjs';
import { rng } from './lib/rng.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PE = paperEngine();
const rn = rng(77);
const src = JSON.parse(fs.readFileSync(path.join(HERE, 'data/paper-src.json'), 'utf8')).trades;
const PV = { NQ: 20, MNQ: 2, ES: 50, MES: 5 };
let now = nyToEpoch(src[0].date, 8 * 60) * 1000 - 86400000 * 2;
const acct = new PE.PaperAccount(null, { now: () => now, isOpen: () => true });
acct.state = PE.freshState(100000, { enabled: true, commission: 1.6, slippage: 0, oneClick: true, lines: true, sounds: false, askJournal: true, qty: { 'futures:NQ1!': 1, 'futures:MNQ1!': 4, 'futures:ES1!': 1, 'futures:MES1!': 5 } }, now);
let n = 0; const st0 = () => acct.state;
for (const t of src) {
  const sym = 'futures:' + t.instrument + '1!';
  const [hh, mm] = t.time.split(':').map(Number);
  const entryMs = nyToEpoch(t.date, hh * 60 + mm) * 1000;
  if (entryMs <= now) continue;
  const qty = t.positionSize / PV[t.instrument];
  const side = t.direction === 'long' ? 'buy' : 'sell', dirn = side === 'buy' ? 1 : -1;
  const holdMin = Math.max(2, Math.round(Math.abs(t.exitPrice - t.entryPrice) / 2.5) + rn.int(1, 9));
  const exitMs = entryMs + holdMin * 60000;
  now = entryMs;
  acct.setLast(sym, t.entryPrice);
  try { acct.placeOrder({ symbol: sym, side, type: 'market', qty, sl: t.stopLoss, tp: t.takeProfit }); } catch (e) { console.log('skip', e.message); continue; }
  now = exitMs;
  const S = Math.abs(t.entryPrice - t.stopLoss), T = Math.abs(t.takeProfit - t.entryPrice);
  const win = (t.exitPrice - t.entryPrice) * dirn > 0;
  const hitTp = Math.abs(t.exitPrice - t.takeProfit) < 1e-9, hitSl = Math.abs(t.exitPrice - t.stopLoss) < 1e-9;
  if (hitTp || hitSl) {
    const adverse = rn.between(0.1, 0.8) * S, fav = rn.between(0.1, 0.8) * T;
    const hi = hitTp ? Math.max(t.entryPrice, t.takeProfit) : (dirn > 0 ? t.entryPrice + fav : t.entryPrice + 0);
    const lo = hitTp ? Math.min(t.entryPrice, t.takeProfit) : (dirn > 0 ? t.stopLoss : t.entryPrice - fav);
    let h, l;
    if (hitTp) { h = dirn > 0 ? t.takeProfit : t.entryPrice + adverse; l = dirn > 0 ? t.entryPrice - adverse : t.takeProfit; }
    else { h = dirn > 0 ? t.entryPrice + fav : t.stopLoss; l = dirn > 0 ? t.stopLoss : t.entryPrice - fav; }
    acct.onSegment(sym, { t: exitMs, o: t.entryPrice, h, l, c: t.exitPrice });
  } else {
    acct.setLast(sym, t.exitPrice);
    acct.closePosition(sym);
  }
  if (acct.state.positions[sym]) { console.log('still open?', t.date); acct.setLast(sym, t.exitPrice); acct.closePosition(sym); }
  const last = st0().trades[st0().trades.length - 1];
  if (last) {
    const lose = last.pnl < 0, tilt = (t.tags || []).includes('Revenge trade'), fomo = (t.tags || []).includes('FOMO');
    last.setup = t.setup;
    last.mistake = tilt ? 'Revenge trade' : fomo ? 'Late entry' : (lose && rn.chance(0.25) ? rn.pick(['Early entry', 'Moved stop', 'Early exit']) : '');
    last.emotion = tilt ? 'Frustrated' : fomo ? 'FOMO' : rn.pick(lose ? ['Calm', 'Hesitant', 'Frustrated', 'Calm'] : ['Calm', 'Confident', 'Confident', 'Calm']);
    if (t.notes && rn.chance(0.8)) last.note = t.notes;
  }
  n++;
}
// attach the journal-style review fields the Trade review page lets a member add (tags / notes)
const st = acct.state;
st.savedAt = now + 60000;
console.log('trades', st.trades.length, 'balance', st.balance, 'realized', st.realized, 'fees', st.fees);
const S = (await import('./lib/appcode.mjs')).paperStats();
console.log(Object.keys(S));
fs.writeFileSync(path.join(HERE, 'data/paper-state.json'), JSON.stringify(st));
