// node tools/tests/chart-search.test.mjs — pure helpers of the Charts symbol search (assets/chart-search-core.js).
import assert from 'node:assert/strict';
import { classify, venueOf, pairOf, search, symOf, keyOf, quoteOf, decimalsOf } from '../../assets/chart-search-core.js?v=1061';

const P = [
  { ticker: 'NQ1!', description: 'Nasdaq-100 E-mini futures', type: 'futures', prefix: 'CME', exchange: 'CME', provider: 'futures', mintick: 0.25 },
  { ticker: 'MNQ1!', description: 'Micro Nasdaq-100 E-mini futures', type: 'futures', prefix: 'CME', exchange: 'CME', provider: 'futures', mintick: 0.25 },
  { ticker: 'ES1!', description: 'S&P 500 E-mini futures', type: 'futures', prefix: 'CME', exchange: 'CME', provider: 'futures', mintick: 0.25 },
  { ticker: 'BTCUSDT', description: 'BTC / USDT', type: 'crypto', provider: 'binance' },
  { ticker: 'BTCUSDT.P', description: 'BTC / USDT Perpetual', type: 'futures', provider: 'binance' },
  { ticker: 'BTC', description: 'BTC / USD Perpetual', type: 'futures', provider: 'hyperliquid' },
  { ticker: 'BTC-USD', description: 'BTC / USD', type: 'crypto', provider: 'coinbase' },
  { ticker: 'EURUSD', description: 'Euro / U.S. Dollar', type: 'forex', prefix: 'FX', provider: 'fx' },
  { ticker: 'SPY', description: 'SPDR S&P 500 ETF', type: 'etf', prefix: 'IDX', exchange: 'NYSE', provider: 'idx' },
  { ticker: 'SPX', description: 'S&P 500 Index', type: 'index', prefix: 'IDX', exchange: 'INDEX', provider: 'idx' },
  { ticker: 'NASDAQ:AAPL', description: 'Apple Inc', type: 'stock', prefix: 'stocks', exchange: 'NASDAQ', provider: 'stocks' }
];
const by = (t, p) => P.find((d) => d.ticker === t && (!p || d.provider === p));

// categories + venues
assert.equal(classify(by('NQ1!')), 'futures');
assert.equal(classify(by('BTCUSDT.P')), 'crypto');   // a crypto perp is Crypto, not Futures
assert.equal(classify(by('EURUSD')), 'forex');
assert.equal(classify(by('SPX')), 'indices');
assert.equal(classify(by('SPY')), 'stocks');
assert.equal(classify(by('NASDAQ:AAPL')), 'stocks');
assert.equal(venueOf(by('NQ1!')), 'cme');
assert.equal(venueOf(by('SPY')), 'nyse');
assert.equal(venueOf(by('BTC', 'hyperliquid')), 'hyperliquid');
assert.deepEqual(pairOf(by('BTCUSDT.P')), { base: 'BTC', quote: 'USDT', perp: true });
assert.deepEqual(pairOf(by('BTC-USD')), { base: 'BTC', quote: 'USD', perp: false });

// the opened symbol is exactly what Vela's own picker built (prefix ?? provider) + ':' + ticker
assert.equal(symOf(by('NQ1!')), 'CME:NQ1!');
assert.equal(symOf(by('BTCUSDT')), 'binance:BTCUSDT');
assert.equal(keyOf('CME:nq1!'), 'cme:NQ1!');

// ranking: exact root first, then prefix
const t = (q) => search(P, q).map((x) => x.d.ticker);
assert.equal(t('NQ')[0], 'NQ1!');
assert.ok(t('NQ').includes('MNQ1!'));
assert.equal(t('ES')[0], 'ES1!');
assert.equal(t('BTC')[0].startsWith('BTC'), true);
assert.equal(search(P, 'NQ')[0].hit.join(), '0,1');                // highlight NQ in NQ1!
// description match + fuzzy / typo
assert.ok(t('NASDAQ').includes('NQ1!'));
assert.ok(t('APPLE').includes('NASDAQ:AAPL'));
assert.ok(t('BTX').some((x) => x.startsWith('BTC')), 'one typo finds BTC');
assert.ok(t('EURUDS').includes('EURUSD'), 'swapped letters find EURUSD');
assert.ok(t('SPU').includes('SPY'));
assert.deepEqual(t('ZZZZZ'), []);
// venue scope "okx:" / "hyperliquid:btc"
assert.deepEqual(t('hyperliquid:BTC'), ['BTC']);
// empty query keeps everything
assert.equal(search(P, '').length, P.length);

// quotes: never invented
assert.equal(quoteOf([]), null);
assert.equal(quoteOf([{ close: 10 }]), null);
const q = quoteOf([{ close: 100 }, { close: 110 }]);
assert.equal(q.last, 110); assert.equal(Math.round(q.pct), 10);
assert.equal(decimalsOf({ mintick: 0.25 }, 20000), 2);
assert.equal(decimalsOf({ mintick: 0.00001 }, 1.1), 5);

// speed: 10k rows, one keystroke well under 50 ms
const big = [];
for (let i = 0; i < 10000; i++) big.push({ ticker: 'C' + i + 'USDT', description: 'C' + i + ' / USDT', type: 'crypto', provider: 'binance' });
big.push(...P);
search(big, 'NQ');
const t0 = performance.now(); for (const s of ['N', 'NQ', 'BTC', 'ETHU', 'EURUDS']) search(big, s); const per = (performance.now() - t0) / 5;
assert.ok(per < 50, 'search keystroke ' + per.toFixed(1) + ' ms');
console.log('chart-search core: ALL PASS (keystroke on 10k rows ' + per.toFixed(1) + ' ms)');
