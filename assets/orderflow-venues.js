// TradeZoro — crypto order-flow venue registry (minimal copy; the full version with the Binance default is owned by Engineer A and wins at merge).
//   registerVenue(id, { bookStream(pair, {snapshot(bids,asks), diff(bids,asks), status}) -> stop,
//                       tradeStream(pair, {trade({t,p,s,side}), status}) -> stop, tick(pair) -> number })
//   getVenue(id) -> that object, or undefined
const venues = new Map();
export const registerVenue = (id, v) => { venues.set(String(id).toLowerCase(), v); return v; };
export const getVenue = (id) => venues.get(String(id).toLowerCase());
