// TradeZoro — order-flow venue registry (minimal copy; the full version with the Binance adapter lives on Engineer A's branch and wins at merge).
// registerVenue(id, { bookStream(pair, { snapshot(bids, asks), diff(bids, asks), status }) -> stop,
//                     tradeStream(pair, { trade({ t, p, s, side }), status }) -> stop, tick(pair) -> number })
// rows are [price, size] numbers; size 0 in a diff = remove the level; side 1 = buyer aggressor, -1 = seller aggressor.
const venues = new Map();
export function registerVenue(id, v) { venues.set(String(id).toLowerCase(), v); }
export function getVenue(id) { return venues.get(String(id).toLowerCase()) || null; }
