// TradeZoro — broker-sync (beta) fills -> journal trades (ES module, pure, no DOM, no network). Admin-only feature.
// Takes fills as the aggregator API returns them (FDXBrokerOrderFill: fillId, orderId, side BUY|SELL, quantity, price,
// commission, executedAt, instrument{displaySymbol,future{contractCode}}), turns them into the fill shape that
// assets/rithmic-fills.js already round-trips (FIFO, flat to flat, partials, flips, point values) and returns journal trades.
// Dedupe: a trade's syncKey/doc id come from the broker's own fill ids, so syncing the same fills again adds nothing.
import { buildTrips, tripToJournalTrade, planImport, tripDocId } from './rithmic-fills.js?v=904';

export { buildTrips, planImport };
const num = (v) => (v == null || v === '' || !isFinite(Number(v)) ? null : Number(v));

export function symbolOf(f) {
  const i = f && f.instrument || {};
  return String((i.future && i.future.contractCode) || i.displaySymbol || i.providerSymbol || f.securityId || '').toUpperCase().trim();
}

// -> fills for buildTrips. Drops anything unusable (no id / side / qty / price / time). Same fill id twice = one fill.
export function fillsFromBroker(raw, accountId) {
  const out = [], seen = new Set();
  for (const f of raw || []) {
    if (!f) continue;
    const id = String(f.fillId || f.executionId || f._id || '');
    const side = String(f.side || '').toUpperCase() === 'BUY' ? 'buy' : String(f.side || '').toUpperCase() === 'SELL' ? 'sell' : null;
    const qty = num(f.quantity), price = num(f.price), ts = Date.parse(f.executedAt), symbol = symbolOf(f);
    if (!id || !side || !(qty > 0) || price == null || !isFinite(ts) || !symbol) continue;
    if (seen.has(id)) continue; seen.add(id);
    const fee = num(f.commission);
    out.push({ fillId: id, orderId: String(f.orderId || ''), account: String(accountId), symbol, exchange: String(f.venue || ''), side, qty, price, ts, fee: fee == null ? null : fee });
  }
  out.sort((a, b) => a.ts - b.ts || (a.fillId < b.fillId ? -1 : 1));
  return out;
}

// Re-key a trip so its identity is broker + fill ids (never collides with another source's keys).
export function keyed(trip) { return Object.assign({}, trip, { key: 'broker|' + trip.key }); }
export const tripId = (trip) => 'brk' + tripDocId(trip).slice(4);

export function tripToTrade(trip, { label, tz } = {}) {
  const t = tripToJournalTrade(trip, { label, tz });
  const own = {
    tags: ['Broker sync \u00b7 ' + (label || trip.account)], importFormat: 'broker-sync', source: 'broker-sync',
    brokerAccount: trip.account, brokerFillIds: trip.fillIds.slice(0, 200), brokerOrderIds: trip.orderIds.slice(0, 100),
    brokerOpenedAt: trip.openedAt, brokerClosedAt: trip.closedAt, brokerPointValue: trip.pointValue
  };
  ['rithmicAccount', 'rithmicIds', 'rithmicOrderIds', 'rithmicOpenedAt', 'rithmicClosedAt', 'rithmicPointValue'].forEach((k) => delete t[k]);
  return Object.assign(t, own, { syncKey: trip.key });
}

// One call for the UI: raw fills -> { trips (keyed), open, needsPointValue }.
export function tripsFromBroker(raw, accountId, pointValues) {
  const r = buildTrips(fillsFromBroker(raw, accountId), { pointValues });
  return { trips: r.trips.map(keyed), open: r.open, needsPointValue: r.needsPointValue };
}

// Which orders are worth asking fills for, and inside the date range (ms). Cancelled / rejected orders have no fills.
export function ordersToFetch(orders, fromMs, toMs) {
  const ids = [];
  for (const o of orders || []) {
    const st = String(o && o.status || '').toUpperCase();
    if (!/FILL/.test(st)) continue;
    const t = Date.parse(o.orderTerminalAt || o.orderUpdatedAt || o.orderCreatedAt);
    if (isFinite(t) && (t < fromMs || t > toMs)) continue;
    const id = o.orderId || o.brokerOrderId; if (id) ids.push(String(id));
  }
  return [...new Set(ids)];
}
