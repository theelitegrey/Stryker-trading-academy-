// Unit tests: assets/chart-wallet-intel.js pure helpers against the data contract v1
// (stryker-notes/reports/workers/hl-intel/contract.md): coin from symbol, formats, server JSON -> UI shape, book-row band,
// cluster filter, candle hit. Fixtures: tools/fixtures/hl-intel/hl-*.json = the Worker's real answers, written by
// `node workers/book-recorder/test/hl.test.mjs --write-fixtures DIR` from a live Hyperliquid dry run (2026-11-07).
//   node tools/tests/chart-wallet-intel.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
globalThis.window = globalThis.window || {};
const M = await import('../../assets/chart-wallet-intel.js');
const fx = (n) => JSON.parse(fs.readFileSync(new URL('../fixtures/hl-intel/' + n, import.meta.url)));
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; console.log('PASS ' + m); };
const A = '0x7fdafde5cfb5465924316eced2d3715494c517d1';

ok(M.coinOf('hyperliquid:BTC') === 'BTC' && M.coinOf('HYPERLIQUID:ETH') === 'ETH' && M.coinOf('hyperliquid:kPEPE') === 'kPEPE', 'Hyperliquid perp coin from the chart symbol (case kept: kPEPE)');
ok(M.coinOf('hyperliquid:PURR/USDC') === '' && M.coinOf('binance:BTCUSDT') === '' && M.coinOf('futures:ES1!') === '' && M.coinOf('') === '', 'spot pairs and other venues -> no coin (the "Hyperliquid perps" note)');
ok(/Hyperliquid perps/.test(M.NOT_HL), 'other-symbol note names Hyperliquid perps');
ok(M.sizeUsd('$10K') === 1e4 && M.sizeUsd('$100K') === 1e5 && M.sizeUsd('$1M') === 1e6 && M.sizeUsd('x') === 1e5, 'size presets');
ok(M.usd(39250.4) === '$39K' && M.usd(1.2e6) === '$1.2M' && M.usd(101.68e6) === '$102M' && M.usd(950) === '$950' && M.usd(-2500) === '-$2.5K', '$ labels');
ok(M.shortAddr(A) === '0x7fda…17d1' && M.shortAddr('nope') === 'nope', 'short address');
ok(M.labelOf({ a: A, label: 'BobbyBigSize' }, true) === 'BobbyBigSize' && M.labelOf({ a: A, label: 'BobbyBigSize' }, false) === '0x7fda…17d1', 'labels on / off');
ok(M.agoText(1000, 1000 + 5 * 60e3) === 'updated 5 min ago' && M.agoText(1000, 1000 + 30e3) === 'updated just now' && M.agoText(0) === '', 'updated X min ago from ms');
ok(M.coverageText({ oiPct: 15.5, wallets: 281 }) === 'tracking 281 of the biggest wallets ≈ 16% of open interest' && M.coverageText({ oiPct: 4.25, wallets: 9 }) === 'tracking 9 of the biggest wallets ≈ 4.3% of open interest' && M.coverageText({}) === '', 'coverage line');

// /hl-candle: every fill has a buyer and a seller -> the wallets' buys add up to the volume, and so do their sells
for (const f of ['hl-candle-BTC-1m.json', 'hl-candle-BTC-3m.json']) {
  const j = fx(f), C = M.normCandle(j);
  const sb = C.list.reduce((s, w) => s + w.buyNtl, 0) + (j.others ? j.others.buyNtl : 0), ss = C.list.reduce((s, w) => s + w.sellNtl, 0) + (j.others ? j.others.sellNtl : 0);
  ok(Math.abs(sb - C.ntl) < 1 && Math.abs(ss - C.ntl) < 1, f + ': wallet buys = wallet sells = volume ($' + Math.round(C.ntl) + ')');
  ok(Math.abs(C.takerBuyNtl + C.takerSellNtl - C.ntl) < 1, f + ': taker buys + taker sells = volume');
  ok(C.list.length === j.wallets.length && C.list.every((w, i) => i === 0 || C.list[i - 1].ntl >= w.ntl), f + ': ' + C.list.length + ' wallets, biggest first');
  ok(C.list.every((w) => (w.buySz ? Math.abs(w.buyPx / 75800 - 1) < 0.02 : isNaN(w.buyPx)) && (w.sellSz ? Math.abs(w.sellPx / 75800 - 1) < 0.02 : isNaN(w.sellPx))), f + ': buy / sell avg prices near the BTC price, missing side -> none');
  ok(C.list.every((w) => Math.abs(w.pct - (w.ntl / C.ntl) * 100) < 0.11), f + ': pct = wallet buys + sells / volume (server value)');
  ok(C.list.every((w) => w.a.length === 42 && w.label), f + ': every wallet has an address and a label');
}
const C1 = M.normCandle(fx('hl-candle-BTC-1m.json'));
ok(C1.trades === 53 && C1.wallets === 38 && C1.others && C1.others.ntl > 0 && C1.partial === false, '1m candle: 53 trades, 38 wallets, smaller wallets summed');
ok(M.normCandle(null) === null && M.normCandle({ wallets: [] }) === null && M.normCandle({ tot: {}, wallets: [{ a: '' }] }).list.length === 0, 'candle: bad input -> empty, never invented');

// /hl-clusters: a band holds both sides -> one cluster per side present
const J = fx('hl-clusters-BTC.json'), K = M.normClusters(J);
ok(K.liq.length === J.liq.reduce((s, b) => s + (b.long ? 1 : 0) + (b.short ? 1 : 0), 0) && K.stops.length === J.stops.reduce((s, b) => s + (b.buy ? 1 : 0) + (b.sell ? 1 : 0), 0), 'clusters: ' + K.liq.length + ' liquidation, ' + K.stops.length + ' stop clusters');
ok(K.coverage.oiPct === 15.5 && K.coverage.wallets === 281 && K.mid === 75833.5 && K.step === 200, 'clusters: coverage % of open interest + wallets tracked');
ok(K.liq.every((c) => (c.side > 0) === (c.hi <= K.mid)), 'clusters: long liquidations below the mid, short liquidations above');
ok(K.liq.every((c) => c.hi - c.lo === K.step && c.px === c.lo + K.step / 2), 'clusters: band [px, px + step), drawn at its middle');
ok(K.liq.every((c) => c.wallets.every((w) => w.px >= c.lo && w.px < c.hi)), 'clusters: each wallet\'s liquidation price sits in its band');
ok([...K.liq, ...K.stops].every((c) => c.wallets.every((w) => w.side === c.side)), 'clusters: every wallet carries its cluster side (long / short, buy / sell)');
ok([...K.liq, ...K.stops].every((c) => c.cut || Math.abs(c.wallets.reduce((s, w) => s + w.ntl, 0) - c.ntl) < 1), 'clusters: band notional = its wallets');
ok(K.stops.every((c) => c.wallets.every((w) => w.kind === 'Stop loss' || w.kind === 'Take profit')), 'stops: stop loss / take profit');
const I = { liq: true, stops: true, minSize: '$100K' };
const vis = M.visibleClusters(K, I);
ok(vis.length && vis.every((c) => c.ntl >= 1e5), 'filter: only clusters >= $100K (' + vis.length + ')');
ok(M.visibleClusters(K, Object.assign({}, I, { liq: false })).every((c) => c.kind === 'stop'), 'filter: liquidations off');
ok(M.visibleClusters(K, Object.assign({}, I, { stops: false })).every((c) => c.kind === 'liq'), 'filter: stops off');
ok(M.visibleClusters(null, I).length === 0 && M.normClusters({ error: 'no_data' }) === null, 'no data -> nothing');

// /hl-level: book row band. The book buckets bids down, asks up, so the row at px holds bids in [px, px+step), asks in (px-step, px]
ok(JSON.stringify(M.levelBand(75500, 10)) === '{"lo":75490,"hi":75510}' && JSON.stringify(M.levelBand(75532, 0)) === '{"lo":75532,"hi":75532}', 'level: band asked for a row');
const LJ = fx('hl-level-BTC.json'), L = M.normLevel(LJ, 75532, 0);
ok(L.orders.length === 1 && L.orders[0].side > 0 && Math.abs(L.trackedSz - LJ.totSz) < 1e-9 && L.bookPct === 43.4, 'level: exact price -> the tracked bid there');
const band = { levels: [{ px: 75488, side: 'bid', w: [{ a: A, sz: 1, ntl: 1 }] }, { px: 75500, side: 'bid', w: [{ a: A, sz: 2, ntl: 2 }] }, { px: 75509, side: 'bid', w: [{ a: A, sz: 4, ntl: 4 }] }, { px: 75491, side: 'ask', w: [{ a: A, sz: 8, ntl: 8 }] }, { px: 75500, side: 'ask', w: [{ a: A, sz: 16, ntl: 16 }] }, { px: 75501, side: 'ask', w: [{ a: A, sz: 32, ntl: 32 }] }] };
ok(M.normLevel(band, 75500, 10).trackedSz === 2 + 4 + 8 + 16, 'level: a grouped row keeps bids in [px, px+step) and asks in (px-step, px]');
ok(M.normLevel(null, 1, 1) === null, 'level: bad input -> null');

// /hl-wallet
const W = M.normWallet(fx('hl-wallet-named.json'));
ok(W.label === 'BobbyBigSize' && W.tags.join() === 'whale,top100vol' && W.tracked && W.av > 1e6 && W.vol30 > 0, 'wallet: public name, tags, account value, 30-day volume');
ok(W.positions.length === 35 && W.positions.every((p, i) => i === 0 || W.positions[i - 1].ntl >= p.ntl) && W.positions.every((p) => p.sz > 0 && (p.side === 1 || p.side === -1)), 'wallet: positions biggest first, side + unsigned size');
const W2 = M.normWallet(Object.assign(fx('hl-wallet.json'), { fills: [[1794074147228, 'ETH', 'B', 50.4928, 112856.46, 2235.1], [1794074247228, 'BTC', 'A', 2, 150000, 75000]] }));
ok(W2.fills.length === 2 && W2.fills[0].coin === 'BTC' && W2.fills[0].side === -1 && W2.fills[1].side === 1 && W2.fills[1].px === 2235.1, 'wallet: fills arrays -> newest first, B = bought');
ok(M.normWallet({ a: 'nope' }) === null && M.normWallet({ a: A, tracked: false }).positions.length === 0, 'wallet: bad address -> null, untracked -> no positions');
ok(M.EXPLORER(W.a) === 'https://app.hyperliquid.xyz/explorer/address/' + A, 'wallet: explorer link');
ok(M.TAG_TEXT.top100vol === 'Top 100 volume' && M.normWallet({ a: A, tags: ['famous fund', 'whale'] }).tags.join() === 'whale', 'tags: only the three known tags, shown in words');

// bars + hit test
const bars = [0, 1, 2, 3].map((i) => ({ time: 6e4 * i, high: 10 + i, low: 5 + i }));
ok(M.barMs(bars) === 6e4 && M.barAt(bars, 61000, 6e4) === 1 && M.barAt(bars, 300000, 6e4) === -1, 'bar lookup');
const xs = [10, 20, 30, 40], ys = [[10, 50], [10, 50], [10, 50], [10, 50]];
ok(M.candleHit(bars, xs, ys, 21, 30, 6) === 1, 'hit: inside a candle');
ok(M.candleHit(bars, xs, ys, 21, 80, 6) === -1, 'hit: below the candle -> none');
ok(M.candleHit(bars, xs, ys, 21, 54, 6) === 1, 'hit: within the tolerance');
ok(M.candleHit(bars, xs, ys, 90, 30, 6) === -1, 'hit: right of the last candle -> none');
ok(M.P.candle('BTC', 1, 2) === '/hl-candle?coin=BTC&from=1&to=2&n=50' && M.P.level('BTC', 1, 2) === '/hl-level?coin=BTC&lo=1&hi=2' && M.P.clusters('kPEPE') === '/hl-clusters?coin=kPEPE', 'contract paths');
console.log(n + ' passed');
