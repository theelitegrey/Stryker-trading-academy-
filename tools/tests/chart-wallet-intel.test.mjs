// Unit tests: assets/chart-wallet-intel.js pure helpers (coin from symbol, formats, server JSON -> UI shape, cluster filter, candle hit).
// Fixtures: tools/fixtures/hl-intel/*.json, built by tools/fixtures/hl-intel/make_fixtures.py from REAL public Hyperliquid data
// captured 2026-11-07 (7 min of BTC trades with their wallets; positions + orders of 249 public wallets).
//   node tools/tests/chart-wallet-intel.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
globalThis.window = globalThis.window || {};
const M = await import('../../assets/chart-wallet-intel.js');
const fx = (n) => JSON.parse(fs.readFileSync(new URL('../fixtures/hl-intel/' + n, import.meta.url)));
let n = 0;
const ok = (c, m) => { assert.ok(c, m); n++; console.log('PASS ' + m); };

ok(M.coinOf('hyperliquid:BTC') === 'BTC' && M.coinOf('HYPERLIQUID:ETH') === 'ETH' && M.coinOf('hyperliquid:PURR/USDC') === 'PURR/USDC', 'Hyperliquid coin from the chart symbol');
ok(M.coinOf('binance:BTCUSDT') === '' && M.coinOf('futures:ES1!') === '' && M.coinOf('') === '', 'other venues -> no coin (the "Hyperliquid charts only" note)');
ok(M.sizeUsd('$10K') === 1e4 && M.sizeUsd('$100K') === 1e5 && M.sizeUsd('$1M') === 1e6 && M.sizeUsd('x') === 1e5, 'size presets');
ok(M.usd(39250.4) === '$39K' && M.usd(1.2e6) === '$1.2M' && M.usd(101.68e6) === '$102M' && M.usd(950) === '$950' && M.usd(-2500) === '-$2.5K', '$ labels');
ok(M.shortAddr('0x63f6411ca61733af716c9a50a56a84ea38a0af59') === '0x63f6…af59' && M.shortAddr('nope') === 'nope', 'short address');
ok(M.labelOf({ a: '0x63f6411ca61733af716c9a50a56a84ea38a0af59', label: 'John Wick' }, true) === 'John Wick' && M.labelOf({ a: '0x63f6411ca61733af716c9a50a56a84ea38a0af59', label: 'John Wick' }, false) === '0x63f6…af59', 'labels on / off');
ok(M.agoText(1000, 1000e3 + 5 * 60e3) === 'updated 5 min ago' && M.agoText(1000, 1000e3 + 30e3) === 'updated just now', 'updated X min ago');

// candle: every fill has a buyer and a seller -> the wallets' buys add up to the candle volume, and so do their sells
const C = M.normCandle(fx('candle-btc-1m.json'));
ok(C.list.length === 50 && C.wallets === 50, 'candle: 50 wallets');
const sb = C.list.reduce((s, w) => s + w.buyNtl, 0), ss = C.list.reduce((s, w) => s + w.sellNtl, 0);
ok(Math.abs(sb - C.ntl) < 1 && Math.abs(ss - C.ntl) < 1, 'candle: wallet buys = wallet sells = volume ($' + Math.round(C.ntl) + ')');
ok(Math.abs(C.aggBuyNtl + C.aggSellNtl - C.ntl) < 1, 'candle: taker buys + taker sells = volume');
ok(C.list.every((w, i) => i === 0 || C.list[i - 1].ntl >= w.ntl), 'candle: wallets biggest first');
ok(C.list.every((w) => w.pct > 0 && w.pct <= 2), 'candle: % of candle in (0, 200%] (a wallet that bought and sold can pass 100%)');
ok(C.list.every((w) => w.px > 0 && Math.abs(w.px / 75800 - 1) < 0.01), 'candle: average prices near the BTC price');
ok(M.normCandle(null) === null && M.normCandle({ wallets: [{ a: '' }] }).list.length === 0, 'candle: bad input -> empty, never invented');

// clusters
const K = M.normClusters(fx('clusters-btc.json'));
ok(K.liq.length === 38 && K.stops.length === 12, 'clusters: 38 liquidation buckets, 12 stop buckets');
ok(K.coverage.oi > 0 && K.coverage.oi < 1, 'clusters: coverage share of open interest (' + Math.round(K.coverage.oi * 100) + '%)');
ok(K.liq.every((c) => (c.side > 0) === (c.px < K.mark)), 'clusters: long liquidations below the mark, short liquidations above');
ok(K.liq.every((c) => Math.abs(c.wallets.reduce((s, w) => s + w.ntl, 0) - c.ntl) < 1), 'clusters: bucket notional = its wallets');
const I = { liq: true, stops: true, minSize: '$100K' };
const vis = M.visibleClusters(K, I);
ok(vis.length && vis.every((c) => c.ntl >= 1e5), 'filter: only clusters >= $100K (' + vis.length + ')');
ok(M.visibleClusters(K, Object.assign({}, I, { liq: false })).every((c) => c.kind === 'stop'), 'filter: liquidations off');
ok(M.visibleClusters(K, Object.assign({}, I, { stops: false })).every((c) => c.kind === 'liq'), 'filter: stops off');
ok(M.visibleClusters(null, I).length === 0, 'filter: no data -> nothing');

// level + wallet
const L = M.normLevel(fx('level-btc.json'));
ok(L.orders.length >= 1 && L.orders.every((o) => o.px === L.px) && Math.abs(L.trackedSz - L.orders.reduce((s, o) => s + o.sz, 0)) < 1e-6, 'level: tracked orders at the price, sizes add up');
const W = M.normWallet(fx('wallet.json'));
ok(W.a.length === 42 && W.accountValue > 0 && W.positions.length > 0, 'wallet: account value + positions');
ok(W.positions.every((p, i) => i === 0 || Math.abs(W.positions[i - 1].ntl) >= Math.abs(p.ntl)), 'wallet: biggest position first');
ok(W.fills.every((f, i) => i === 0 || W.fills[i - 1].t >= f.t) && W.fills.every((f) => f.ntl >= 1e4), 'wallet: recent large fills, newest first');
ok(M.EXPLORER(W.a).endsWith('/' + W.a), 'wallet: explorer link');

// bars + hit test
const bars = [0, 1, 2, 3].map((i) => ({ time: 6e4 * i, high: 10 + i, low: 5 + i }));
ok(M.barMs(bars) === 6e4 && M.barAt(bars, 61000, 6e4) === 1 && M.barAt(bars, 300000, 6e4) === -1, 'bar lookup');
const xs = [10, 20, 30, 40], ys = [[10, 50], [10, 50], [10, 50], [10, 50]];
ok(M.candleHit(bars, xs, ys, 21, 30, 6) === 1, 'hit: inside a candle');
ok(M.candleHit(bars, xs, ys, 21, 80, 6) === -1, 'hit: below the candle -> none');
ok(M.candleHit(bars, xs, ys, 21, 54, 6) === 1, 'hit: within the tolerance');
ok(M.candleHit(bars, xs, ys, 90, 30, 6) === -1, 'hit: right of the last candle -> none');
console.log(n + ' passed');
