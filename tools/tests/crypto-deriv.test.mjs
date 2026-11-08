// Unit tests: assets/crypto-deriv-data.js (symbol mapping, liquidation parsers, per-bar totals, OI per bar + sum, funding, L/S ratio).
// Fixtures: tools/fixtures/crypto-deriv-*.json are REAL replies saved from the public endpoints on 2026-11-07 (OKX + Hyperliquid answer
// from this server; Binance / Bybit refuse it by region, so their parsers are checked against the documented message shapes).
//   node tools/tests/crypto-deriv.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
const D = await import('../../assets/crypto-deriv-data.js');
const FX = (n) => JSON.parse(fs.readFileSync(new URL('../fixtures/crypto-deriv-' + n + '.json', import.meta.url)));
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; console.log('PASS ' + m); };

// symbols
ok(D.baseOf('binance:BTCUSDT') === 'BTC' && D.baseOf('binance:ETHUSDT.P') === 'ETH' && D.baseOf('okx:SOL-USDT-SWAP') === 'SOL' && D.baseOf('hyperliquid:SOL') === 'SOL', 'base coin from each venue form');
ok(D.baseOf('kraken:XBTUSD') === 'BTC' && D.baseOf('bybit:DOGEUSDT.P') === 'DOGE' && D.baseOf('coinbase:ETH-USD') === 'ETH' && D.baseOf('BTCUSDT', 'binance') === 'BTC', 'aliases, dashes and resolved provider');
ok(D.baseOf('futures:NQ1!') === '' && D.baseOf('IDX:SPY') === '' && D.baseOf('fx:EURUSD') === '', 'not crypto -> none');
ok(D.exSymbol('binance', 'SOL') === 'SOLUSDT' && D.exSymbol('okx', 'SOL') === 'SOL-USDT-SWAP' && D.exSymbol('hyperliquid', 'SOL') === 'SOL' && D.exSymbol('x', 'SOL') === '', 'exchange perp symbols');

// liquidation parsers
const bin = D.parseBinanceLiq({ e: 'forceOrder', E: 1, o: { s: 'BTCUSDT', S: 'SELL', o: 'LIMIT', q: '0.014', p: '9910', ap: '9910', X: 'FILLED', l: '0.014', z: '0.014', T: 1568014460893 } });
ok(bin.length === 1 && bin[0].side === 'long' && Math.abs(bin[0].usd - 138.74) < 1e-6 && bin[0].ex === 'binance', 'Binance forceOrder: SELL = long liquidated, USD = avg price x filled');
ok(D.parseBinanceLiq({ o: { S: 'BUY', ap: '0', p: '100', z: '2', T: 5 } })[0].usd === 200 && D.parseBinanceLiq({}).length === 0, 'Binance: price fallback, junk ignored');
const by = D.parseBybitLiq({ topic: 'allLiquidation.ROSEUSDT', data: [{ T: 1739502302929, s: 'ROSEUSDT', S: 'Sell', v: '20000', p: '0.04499' }, { T: 1739502302930, s: 'ROSEUSDT', S: 'Buy', v: '10', p: '0.05' }] });
ok(by.length === 2 && by[0].side === 'short' && by[1].side === 'long' && Math.abs(by[0].usd - 899.8) < 1e-6, 'Bybit allLiquidation: S Buy = long liquidated');
const okxRest = FX('okx-liq-btc');
const ol = D.parseOkxLiq(okxRest, 'BTC-USDT-SWAP', 0.01);
ok(ol.length === okxRest.data[0].details.length && ol.every((x) => x.ex === 'okx' && x.usd > 0 && (x.side === 'long' || x.side === 'short')), 'OKX REST liquidations (real reply): ' + ol.length + ' prints');
ok(ol.some((x) => x.side === 'long') && ol.some((x) => x.side === 'short'), 'OKX: both sides present in the real reply');
const d0 = okxRest.data[0].details[0];
ok(Math.abs(ol.find((x) => x.t === +d0.ts).usd - (+d0.bkPx) * (+d0.sz) * 0.01) < 1e-6, 'OKX: USD = bankruptcy price x contracts x contract value');
ok(D.parseOkxLiq(okxRest, 'ETH-USDT-SWAP', 0.1).length === 0 && D.parseOkxLiq(okxRest, 'BTC-USDT-SWAP', 0).length === 0, 'OKX: other instruments and unknown contract size dropped');
ok(D.dedupe(ol.concat(ol)).length === D.dedupe(ol).length, 'dedupe REST + socket overlap');

// per-bar totals
const bars = [0, 1, 2, 3].map((i) => ({ time: 60000 * i, open: 100, close: 100 + i, high: 110, low: 90 }));
const L = [{ t: 61000, side: 'long', usd: 50 }, { t: 61500, side: 'short', usd: 20 }, { t: 179999, side: 'long', usd: 5 }, { t: 300000, side: 'long', usd: 999 }];
const pb = D.liqPerBar(L, bars, 60000, 60000);
ok(pb.long[0] === null && pb.long[1] === 50 && pb.short[1] === 20 && pb.long[2] === 5 && pb.long[3] === 0 && pb.n[1] === 2, 'per-bar totals; before collection = empty, after = 0; outside bars ignored');
ok(D.barIndex(bars, 119999, 60000) === 1 && D.barIndex(bars, 240000, 60000) === -1 && D.barMs(bars) === 60000, 'bar index');
ok(D.radius(0, 100) === 3 && D.radius(100, 100, 14) === 14, 'bubble radius');

// open interest
ok(D.oiPeriod('binance', 1).code === '5m' && D.oiPeriod('binance', 60).code === '1h' && D.oiPeriod('bybit', 240).code === '4h' && D.oiPeriod('okx', 60).code === '1H' && D.oiPeriod('okx', 45).code === '30m', 'OI history step <= bar, 5 min at the least');
ok(D.oiUrl('hyperliquid', 'BTC', 5) === '' && D.oiUrl('okx', 'BTC', 1) === '/api/chart/okx-stat?kind=oi&base=BTC&period=5m', 'OI urls (OKX through the same-origin pass-through)');
const S = await import('../../functions/api/chart/okx-stat.js');
const up = (q) => S.upstreamUrl(new URLSearchParams(q));
ok(up('kind=oi&base=BTC&period=5m') === 'https://www.okx.com/api/v5/rubik/stat/contracts/open-interest-history?instId=BTC-USDT-SWAP&period=5m&limit=100'
  && /long-short-account-ratio-contract\?instId=ETH-USDT-SWAP&period=1H&limit=100&end=1794074100000$/.test(up('kind=lsr&base=eth&period=1H&end=1794074100000')), 'okx-stat: allowed requests map to OKX');
ok(up('kind=x&base=BTC') === '' && up('kind=oi&base=BTC/../x') === '' && up('kind=oi&base=BTC&period=7m') === '' && up('kind=oi&base=BTC&end=1;x') === '', 'okx-stat: anything else refused');
ok(D.parseLsr('OKX: all accounts', { code: '0', data: [['1794074400000', '1.25'], ['1794074100000', '1.5']] })[0].ratio === 1.5, 'OKX long/short ratio, oldest first');
const okxOi = D.parseOI('okx', FX('okx-oi-btc'));
ok(okxOi.length > 50 && okxOi[0].t < okxOi[1].t && okxOi.every((x) => x.usd > 1e8), 'OKX OI (real reply): ' + okxOi.length + ' samples oldest first, USD');
ok(D.parseOI('binance', [{ symbol: 'BTCUSDT', sumOpenInterest: '20403.6', sumOpenInterestValue: '150570784.07', timestamp: 1583127900000 }])[0].usd === 150570784.07, 'Binance openInterestHist');
const byOi = D.parseOI('bybit', { result: { list: [{ openInterest: '461134384.0', timestamp: '1669571400000' }, { openInterest: '461000000', timestamp: '1669571100000' }] } });
ok(byOi.length === 2 && byOi[0].t === 1669571100000 && byOi[0].usd === undefined, 'Bybit open-interest: coins, sorted');
const s5 = [{ t: 60000, usd: 10 }, { t: 120000, usd: 12 }, { t: 180000, usd: 11 }];
const per = D.oiPerBar(s5, bars, 60000, 60000);
ok(per[0] === 10 && per[1] === 12 && per[2] === 11 && per[3] === 11, 'OI per bar = last sample at or before the bar close');
ok(D.oiPerBar([{ t: 60000, base: 2 }], bars, 60000, 60000)[1] === 202, 'coins x bar close when the exchange gives no USD');
ok(D.oiPerBar([{ t: 0, usd: 1 }], [{ time: 0 }, { time: 600000 }], 60000, 60000)[1] === null, 'stale sample -> gap, not carried forward');
const sum = D.sumSeries([[1, 2, null], [10, 20, 30]], 3);
ok(sum[0] === 11 && sum[1] === 22 && sum[2] === null, 'sum over exchanges; a bar missing one exchange stays empty');
ok(JSON.stringify(D.diffs([1, 3, null, 4])) === '[null,2,null,null]', 'OI change per bar');
ok(D.oiState(5, 1) === 'upUp' && D.oiState(5, -1) === 'upDown' && D.oiState(-5, 1) === 'downUp' && D.oiState(-5, -1) === 'downDown' && D.oiState(0, 1) === 'flat' && D.oiState(null, 1) === 'flat', 'OI vs price states');

// funding
const okxNow = D.parseFundingNow('okx', FX('okx-funding-btc'));
ok(okxNow && Math.abs(okxNow.rate) < 0.01 && okxNow.next > 1.7e12 && okxNow.intervalH === 8, 'OKX funding now (real reply): rate, settlement time, 8h');
const hl = FX('hl-meta');
const hlNow = D.parseFundingNow('hyperliquid', hl, 'BTC');
ok(hlNow && hlNow.intervalH === 1 && Math.abs(hlNow.rate) < 0.01 && hlNow.next % 3600000 === 0, 'Hyperliquid funding now (real reply): hourly');
ok(D.parseFundingNow('hyperliquid', hl, 'NOPECOIN') === null && D.parseFundingNow('okx', { code: '51001', data: [] }) === null, 'coin not listed -> null (not available)');
ok(D.parseFundingNow('binance', { symbol: 'BTCUSDT', lastFundingRate: '0.00010000', nextFundingTime: 1597392000000 }).rate === 0.0001, 'Binance premiumIndex');
ok(D.parseFundingNow('bybit', { result: { list: [{ fundingRate: '-0.0001', nextFundingTime: '1673280000000', fundingIntervalHour: '8' }] } }).intervalH === 8, 'Bybit tickers');
const okxH = D.parseFundingHist('okx', FX('okx-fundhist-btc'));
ok(okxH.length > 10 && okxH[0].t < okxH[okxH.length - 1].t && D.intervalFromHist(okxH) === 8, 'OKX funding history (real reply), interval 8h');
const hlH = D.parseFundingHist('hyperliquid', FX('hl-fundhist-btc'));
ok(hlH.length > 10 && D.intervalFromHist(hlH) === 1, 'Hyperliquid funding history (real reply), interval 1h');
const FH = [{ t: 60000, rate: 0.0001 }, { t: 180000, rate: -0.0002 }];
const fb = D.fundingPerBar(FH, bars, 60000);
ok(JSON.stringify(fb) === '[null,-2,-2,null]', 'each bar gets the rate settled at the end of its funding period (bp); unknown periods empty ' + JSON.stringify(fb));
ok(D.fundingPerBar(FH, bars, 60000, { rate: 0.0003, next: 240000 })[3] === 3 && D.fundingPerBar(FH, bars, 60000, { rate: 0.0003, next: 180000 })[3] === null, 'open period uses the current rate, only until the next settlement');
ok(D.pct(0.0001) === '+0.0100%' && D.pct(-0.00005) === '-0.0050%' && D.pct(null) === '—', 'rate format');
ok(D.countdown(2 * 3600e3 + 5 * 60e3) === '2h 05m' && D.countdown(250e3) === '4m 10s' && D.countdown(-1) === '—', 'countdown');

// long / short
const ls = D.parseLsr('Binance: all accounts', [{ symbol: 'BTCUSDT', longShortRatio: '0.1960', longAccount: '0.6622', shortAccount: '0.3378', timestamp: '1583139600000' }]);
ok(ls.length === 1 && ls[0].ratio === 0.196, 'Binance long/short ratio');
const lb = D.parseLsr('Bybit: all accounts', { result: { list: [{ buyRatio: '0.6', sellRatio: '0.4', timestamp: '1695772800000' }] } });
ok(Math.abs(lb[0].ratio - 1.5) < 1e-9, 'Bybit account ratio = buy / sell');
ok(/topLongShortPositionRatio\?symbol=ETHUSDT&period=5m/.test(D.lsrUrl('Binance: top traders (positions)', 'ETH', 1)), 'L/S url');
ok(D.usd(1234) === '$1.2K' && D.usd(2.5e6) === '$2.5M' && D.usd(-3e9) === '-$3.00B', 'usd format');
console.log(n + ' passed');
