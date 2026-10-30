// TradeZoro — Rithmic fills -> journal round trips (ES module, pure, no DOM, no network)
// Depends on: nothing at run time (assets/rithmic-orders.js feeds it raw order notifications).
// Used by the browser import (assets/rithmic-journal-ui.js), the node tests, and the scheduled auto sync
// (functions-src/rithmic/fills.js is a byte-identical CommonJS-free copy kept in step by the test).
//
// Rules (Owner 2026-10-30): fills are grouped per account + symbol into round trips with FIFO matching.
// A round trip runs from flat to flat. Scale-ins and scale-outs stay in one trip; a partial fill is just
// a smaller fill; a flip (long to short in one fill) closes the trip and opens the next one with the
// remainder. P&L = points x point value per contract. Fees come only from what Rithmic sends.

// Point value in dollars per 1.0 of price, per futures ROOT. Same numbers as assets/journal-lux.js
// (LUX_FUT_MULTIPLIERS) and assets/paper-engine.js. The test fails if the two tables drift apart.
export const POINT_VALUES = {
  ES: 50, MES: 5, NQ: 20, MNQ: 2, YM: 5, MYM: 0.5, RTY: 50, M2K: 5,
  CL: 1000, MCL: 100, QM: 500, NG: 10000, QG: 2500,
  GC: 100, MGC: 10, SI: 5000, SIL: 1000, HG: 25000, PL: 50,
  ZB: 1000, ZN: 1000, ZF: 1000, ZT: 2000,
  ZC: 50, ZS: 50, ZW: 50,
  '6E': 125000, '6B': 62500, '6J': 12500000, '6A': 100000, '6C': 100000, M6E: 12500, M6B: 6250
};

// "NQZ6" -> "NQ", "MNQZ6" -> "MNQ", "ESH26" -> "ES", "6EZ6" -> "6E", "ZN" -> "ZN".
export function rootOf(symbol) {
  const s = String(symbol || '').toUpperCase().trim();
  const m = s.match(/^(.+?)[FGHJKMNQUVXZ]\d{1,2}$/);
  return m ? m[1] : s;
}

export function pointValueFor(symbol, extra) {
  const root = rootOf(symbol);
  if (extra && extra[root] > 0) return extra[root];
  return POINT_VALUES[root] > 0 ? POINT_VALUES[root] : null;
}

const num = (v) => (v == null || v === '' || !isFinite(Number(v)) ? null : Number(v));

// ---- raw ExchangeOrderNotification (352) -> normalised fills --------------------------------------------
// Only FILL notifications (notify_type 5, or a fill_id present) are fills. The same fill can arrive twice
// (summary + detail), so rows are de-duplicated by account + fill_id.
// Time: source_ssboe (exchange time) when present, else ssboe, in epoch seconds; usecs refine it.
export function fillsFromNotes(notes, { feePerContract } = {}) {
  const out = [];
  const seen = new Set();
  for (const m of notes || []) {
    if (!m) continue;
    const isFill = m.notify_type === 5 || (m.fill_id && m.fill_price != null);
    if (!isFill) continue;
    const qty = num(m.fill_size_64) || num(m.fill_size) || 0;
    const price = num(m.fill_price);
    if (!(qty > 0) || price == null || !m.symbol || !m.account_id) continue;
    const secs = m.source_ssboe || m.ssboe;
    if (!secs) continue;
    const us = m.source_ssboe ? (m.source_usecs || 0) : (m.usecs || 0);
    const id = m.fill_id ? String(m.fill_id) : (m.basket_id ? m.basket_id + ':' + secs + ':' + us : '');
    if (!id) continue;
    const key = m.account_id + '|' + id;
    if (seen.has(key)) continue;
    seen.add(key);
    // 1 BUY, 2 SELL, 3 SELL SHORT
    const side = m.transaction_type === 1 ? 'buy' : (m.transaction_type === 2 || m.transaction_type === 3) ? 'sell' : null;
    if (!side) continue;
    let fee = null;
    const rate = num(m.commission_fill_rate);
    if (rate != null && rate > 0) fee = Math.round(rate * qty * 100) / 100;
    else if (feePerContract) fee = Math.round(feePerContract * qty * 100) / 100;
    out.push({ fillId: id, orderId: m.basket_id || '', account: m.account_id, symbol: String(m.symbol).toUpperCase(), exchange: m.exchange || '',
      side, qty, price, ts: secs * 1000 + Math.floor(us / 1000), fee });
  }
  out.sort((a, b) => a.ts - b.ts || (a.fillId < b.fillId ? -1 : a.fillId > b.fillId ? 1 : 0));
  return out;
}

// ---- FIFO round trips ----------------------------------------------------------------------------------
// Returns { trips, open } where each trip is closed (flat) and `open` lists positions still open at the
// end of the data (not importable yet). A fill's quantity can be split across two trips (flip).
export function buildTrips(fills, { pointValues } = {}) {
  const groups = new Map();
  for (const f of fills) {
    const k = f.account + '|' + f.symbol;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(f);
  }
  const trips = [], open = [], needsPointValue = new Set();
  for (const [k, list] of groups) {
    list.sort((a, b) => a.ts - b.ts || (a.fillId < b.fillId ? -1 : 1));
    const [account, symbol] = [list[0].account, list[0].symbol];
    const pv = pointValueFor(symbol, pointValues);
    let cur = null;   // { dir:+1|-1, lots:[{qty,price}], ... }
    const newTrip = (f, dir) => ({ account, symbol, exchange: f.exchange, dir, lots: [], pos: 0, entryQty: 0, entryCost: 0, exitQty: 0, exitCost: 0,
      gross: 0, fees: 0, openedAt: f.ts, closedAt: f.ts, fillIds: [], orderIds: new Set(), fills: 0 });
    for (const f of list) {
      let remaining = f.qty;
      const fdir = f.side === 'buy' ? 1 : -1;
      // fee is shared across the pieces of a split fill, in proportion to quantity
      const feeOf = (q) => (f.fee == null ? 0 : f.fee * q / f.qty);
      let hasFee = f.fee != null;
      while (remaining > 1e-9) {
        if (!cur) cur = newTrip(f, fdir);
        const touch = (q) => { cur.fillIds.indexOf(f.fillId) < 0 && cur.fillIds.push(f.fillId); if (f.orderId) cur.orderIds.add(f.orderId); cur.fills++; cur.closedAt = f.ts; cur.fees += feeOf(q); if (hasFee) cur.hasFees = true; };
        if (fdir === cur.dir) {                                   // adds to the position (scale in)
          cur.lots.push({ qty: remaining, price: f.price });
          cur.pos += remaining; cur.entryQty += remaining; cur.entryCost += remaining * f.price;
          touch(remaining); remaining = 0;
        } else {                                                  // reduces it (scale out / close / flip)
          let q = Math.min(remaining, cur.pos);
          let left = q;
          while (left > 1e-9) {                                   // FIFO
            const lot = cur.lots[0];
            const take = Math.min(lot.qty, left);
            cur.gross += (f.price - lot.price) * take * cur.dir * (pv || 1);
            lot.qty -= take; left -= take;
            if (lot.qty <= 1e-9) cur.lots.shift();
          }
          cur.pos -= q; cur.exitQty += q; cur.exitCost += q * f.price;
          touch(q); remaining -= q;
          if (cur.pos <= 1e-9) {                                  // flat: the trip is done
            trips.push(finish(cur, pv));
            cur = null;
          }
        }
      }
    }
    if (cur) open.push({ account, symbol, side: cur.dir > 0 ? 'long' : 'short', qty: cur.pos, openedAt: cur.openedAt });
    if (!pv) needsPointValue.add(rootOf(symbol));
  }
  trips.sort((a, b) => a.openedAt - b.openedAt);
  return { trips, open, needsPointValue: [...needsPointValue] };
}

function finish(t, pv) {
  const r2 = (v) => Math.round(v * 100) / 100;
  const key = t.account + '|' + t.symbol + '|' + t.fillIds[0] + '|' + t.fillIds.length;
  return {
    key, account: t.account, symbol: t.symbol, root: rootOf(t.symbol), exchange: t.exchange,
    direction: t.dir > 0 ? 'long' : 'short', quantity: t.entryQty,
    avgEntry: t.entryCost / t.entryQty, avgExit: t.exitCost / t.exitQty,
    openedAt: t.openedAt, closedAt: t.closedAt, fills: t.fills, fillIds: t.fillIds.slice(), orderIds: [...t.orderIds],
    pointValue: pv || null, grossPnl: pv ? r2(t.gross) : null, fees: t.hasFees ? r2(t.fees) : null,
    netPnl: pv ? r2(t.gross - (t.hasFees ? t.fees : 0)) : null
  };
}

// ---- trip -> the journal's stored trade ------------------------------------------------------------------
const pad = (n) => String(n).padStart(2, '0');
// Date / time strings in a given IANA zone (default: the viewer's). Kept as the journal does: 'YYYY-MM-DD', 'HH:MM'.
export function zoneParts(ms, tz) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: p.year + '-' + p.month + '-' + p.day, time: p.hour + ':' + p.minute };
}
export const EXCHANGE_TZ = 'America/Chicago';
export const IST_TZ = 'Asia/Kolkata';

export function tripToJournalTrade(trip, { tz, label } = {}) {
  const zone = tz || (typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'UTC') || 'UTC';
  const z = zoneParts(trip.openedAt, zone);
  const r2 = (v) => Math.round(v * 100) / 100;
  const pnl = trip.netPnl;
  const accLabel = label || trip.account;
  return {
    date: z.date, time: z.time,
    instrument: String(trip.symbol).slice(0, 20),
    direction: trip.direction,
    entryPrice: Math.round(trip.avgEntry * 10000) / 10000,
    exitPrice: Math.round(trip.avgExit * 10000) / 10000,
    positionSize: trip.quantity,
    fees: trip.fees || 0,
    stopLoss: null, takeProfit: null, setup: '', session: '',
    account: String(accLabel).slice(0, 40),
    tags: ['Rithmic \u00b7 ' + accLabel],
    notes: '',
    pnl, result: pnl > 0 ? 'Win' : (pnl < 0 ? 'Loss' : 'Breakeven'),
    riskAmount: null, riskPercent: null, rMultiple: null, plannedRR: null,
    imported: true, importFormat: 'rithmic', source: 'rithmic',
    rithmicAccount: trip.account, rithmicIds: trip.fillIds.slice(0, 200), rithmicOrderIds: trip.orderIds.slice(0, 100),
    rithmicOpenedAt: trip.openedAt, rithmicClosedAt: trip.closedAt, rithmicPointValue: trip.pointValue,
    syncKey: trip.key
  };
}

// ---- de-dupe + Free plan cap ---------------------------------------------------------------------------------
// `existingKeys` = Set of trip keys (trade.syncKey) already in the journal. A trip key is built from the
// account, symbol, first fill id and fill count, so the same fills always give the same key (re-import = no-op).
export function planImport(trips, { existingKeys, freeRoom } = {}) {
  const have = existingKeys || new Set();
  const fresh = [], dupes = [];
  for (const t of trips) {
    const dup = have.has(t.key);
    (dup ? dupes : fresh).push(t);
  }
  const canTake = freeRoom == null ? fresh.length : Math.max(0, Math.min(fresh.length, freeRoom));
  return { fresh, dupes, take: fresh.slice(0, canTake), overCap: fresh.slice(canTake) };
}

// Stable Firestore doc id for a trip, so a second import of the same trip writes the same document.
export function tripDocId(trip) {
  let h1 = 0x811c9dc5, h2 = 0x1b873593;
  const s = trip.key;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 + c, 2246822519) >>> 0; h2 ^= h2 >>> 13;
  }
  return 'rith' + h1.toString(36) + h2.toString(36) + s.length.toString(36);
}

// Cross-check: sum of trip net P&L (fees excluded) vs Rithmic's closed P&L for the same account/day.
export function crossCheck(trips, snapshot, account) {
  if (!snapshot || snapshot.error || snapshot.dayClosedPnl == null) return { status: 'unavailable' };
  const mine = trips.filter((t) => t.account === account && t.netPnl != null).reduce((a, t) => a + (t.grossPnl || 0), 0);
  const theirs = snapshot.dayClosedPnl;
  const diff = Math.round((mine - theirs) * 100) / 100;
  return { status: Math.abs(diff) <= Math.max(1, Math.abs(theirs) * 0.005) ? 'match' : 'differs', ours: Math.round(mine * 100) / 100, rithmic: theirs, diff };
}
