// Unit test for assets/chart-sym.js (Owner bug 17 Nov: exchange-form futures symbols).  node tools/tests/chart-sym.test.mjs
import { isFutures, normFutures, futRoot, splitSym, FUT_EXCH } from '../../assets/chart-sym.js';

let fail = 0, n = 0;
const eq = (got, want, msg) => { n++; const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) { fail++; console.log('FAIL ' + msg + ' got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)); } };

// every CME Group exchange prefix, upper and lower case
for (const p of ['cme', 'cme_mini', 'cbot', 'cbot_mini', 'comex', 'comex_mini', 'nymex', 'nymex_mini']) {
  for (const pre of [p, p.toUpperCase()]) {
    eq(isFutures(pre + ':NQ1!'), true, pre + ':NQ1! is futures');
    eq(normFutures(pre + ':NQ1!'), 'futures:NQ1!', pre + ':NQ1! -> futures:NQ1!');
    eq(FUT_EXCH.test(pre), true, 'FUT_EXCH ' + pre);
  }
}
const cases = [
  ['CME_MINI:MNQ1!', 'futures:MNQ1!', 'MNQ'],
  ['CME:ES1!', 'futures:ES1!', 'ES'],
  ['CME:NQ1!', 'futures:NQ1!', 'NQ'],
  ['CBOT:ZN1!', 'futures:ZN1!', 'ZN'],
  ['CBOT_MINI:YM1!', 'futures:YM1!', 'YM'],
  ['COMEX:GC1!', 'futures:GC1!', 'GC'],
  ['COMEX_MINI:MGC1!', 'futures:MGC1!', 'MGC'],
  ['NYMEX:CL1!', 'futures:CL1!', 'CL'],
  ['NYMEX_MINI:MCL1!', 'futures:MCL1!', 'MCL'],
  ['CME:6E1!', 'futures:6E1!', '6E'],
  ['futures:NQ1!', 'futures:NQ1!', 'NQ'],
  ['futures:MNQ1!', 'futures:MNQ1!', 'MNQ'],
  ['NQ1!', 'futures:NQ1!', 'NQ'],
  ['MES1!', 'futures:MES1!', 'MES'],
  ['ES2!', 'futures:ES1!', 'ES'],
  // contract months -> the continuous root
  ['MNQZ6', 'futures:MNQ1!', 'MNQ'],
  ['MNQZ26', 'futures:MNQ1!', 'MNQ'],
  ['MNQZ2026', 'futures:MNQ1!', 'MNQ'],
  ['CME_MINI:MNQZ2026', 'futures:MNQ1!', 'MNQ'],
  ['CME_MINI:MNQZ6', 'futures:MNQ1!', 'MNQ'],
  ['NQH27', 'futures:NQ1!', 'NQ'],
  ['ESM6', 'futures:ES1!', 'ES'],
  ['GCG2027', 'futures:GC1!', 'GC'],
  ['CLF7', 'futures:CL1!', 'CL'],
  ['M2KU6', 'futures:M2K1!', 'M2K'],
  ['6EH27', 'futures:6E1!', '6E'],
  ['cme_mini:mnq1!', 'futures:MNQ1!', 'MNQ'],
  ['rithmic:NQ1!', 'futures:NQ1!', 'NQ']
];
for (const [s, norm, root] of cases) {
  eq(isFutures(s), true, s + ' isFutures');
  eq(normFutures(s), norm, s + ' normFutures');
  eq(futRoot(s), root, s + ' futRoot');
  eq(splitSym(s), ['futures', root + '1!'], s + ' splitSym');
}
// non-futures: untouched
const other = ['binance:BTCUSDT', 'BINANCE:BTCUSDT', 'coinbase:BTC-USD', 'hyperliquid:ETH', 'bybit:BTCUSDT.P', 'okx:BTC-USDT-SWAP', 'fx:EURUSD',
  'FX:EURUSD', 'idx:SPX', 'idx:QQQ', 'stocks:NASDAQ:AAPL', 'stocks:AAPL', 'AAPL', 'ES', 'NQ', 'SPY', 'QQQ', 'BTCUSDT', 'formula:NQ1!/ES1!',
  'bt:SESSION', 'byo:NQ', 'vest:BTC-PERP', 'kraken:XBTUSD', 'BRK.B', 'X', 'GOOGL', 'TSM', 'ESZ', '', null, undefined];
for (const s of other) {
  eq(isFutures(s), false, String(s) + ' not futures');
  eq(normFutures(s), s, String(s) + ' unchanged');
  eq(futRoot(s), '', String(s) + ' no root');
}
eq(splitSym('binance:BTCUSDT'), ['binance', 'BTCUSDT'], 'split crypto');
eq(splitSym('BINANCE:BTCUSDT'), ['binance', 'BTCUSDT'], 'split crypto upper prefix -> lower');
eq(splitSym('AAPL'), ['', 'AAPL'], 'split bare stock');
eq(splitSym('stocks:NASDAQ:AAPL'), ['stocks', 'NASDAQ:AAPL'], 'split stocks');

console.log(fail ? 'FAILED ' + fail + ' of ' + n : 'ALL PASSED (' + n + ')');
process.exit(fail ? 1 : 0);
