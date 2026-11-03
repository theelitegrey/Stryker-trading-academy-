// TradeZoro — where LIVE futures / index data comes from (ES module, no imports, no network).
// ONE FLAG (Owner order 2026-11-03, "from now on use the tick stream live, not the old vendor"):
//   'hub' = the book-recorder hub (/ts-live: one upstream socket, every trade with its side + the index quotes). Default.
//   'is'  = the old server bridge /api/chart/stream (kept in the code, unused). Switch back by changing the line below + bumping the build.
// Only the LIVE stream moves; REST history / bars / screener / GEX never read this flag.
// Education only. Not financial advice.
export const LIVE_SOURCE = 'hub';
export const hubLive = () => LIVE_SOURCE === 'hub';

// Futures roots the hub streams live (trades -> candles + order flow). Same list as TS_SYMBOLS + TS_TRADES in
// workers/book-recorder/src/ts-hub.js (tools/tests/ts-live-source.test.mjs keeps the two equal). Micros have their OWN trades.
export const HUB_BOOKS = ['NQ', 'ES', 'MNQ', 'MES', 'YM', 'RTY', 'CL', 'GC'];                                   // trades + L2 book
export const HUB_TRADES = ['SI', 'SIL', 'ZB', 'ZN', '6E', 'HG', 'MHG', 'MGC', 'MCL', 'MYM', 'M2K'];       // trades only
export const HUB_FUTURES = HUB_BOOKS.concat(HUB_TRADES);
export const HUB_QUOTES = ['SPX', 'NDX', 'VIX', 'RUT', 'QQQ', 'SPY', 'IWM', 'DIA'];                              // index / ETF level only
export const hubCovers = (root) => HUB_FUTURES.includes(root) || HUB_QUOTES.includes(root);
