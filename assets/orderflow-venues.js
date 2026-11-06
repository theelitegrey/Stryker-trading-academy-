// TradeZoro: crypto order-flow venue registry. Minimal copy of the shared interface (the Binance switch owner's version wins at merge).
//   registerVenue(id, { bookStream(pair, { snapshot(bids, asks), diff(bids, asks), status }) -> stop,
//                       tradeStream(pair, { trade({ t, p, s, side }), status }) -> stop,
//                       tick(pair) -> number })
//   bids / asks = [[price, size], ...] (numbers); size 0 in diff() removes a level. side: 1 buyer-aggressor, -1 seller-aggressor.
//   pair = { base, quote, perp }
const venues = new Map();
export const registerVenue = (id, v) => { venues.set(String(id).toLowerCase(), v); };
export const getVenue = (id) => venues.get(String(id).toLowerCase()) || null;
