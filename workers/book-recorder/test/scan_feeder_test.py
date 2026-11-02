#!/usr/bin/env python3
"""Unit tests for the market scanner feeder (scan-feeder/scan_feeder.py): query building, row
mapping, presets. Run: python3 workers/book-recorder/test/scan_feeder_test.py (stdlib; CI runs it)."""
import gzip
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scan-feeder'))
import scan_feeder as f  # noqa: E402
import scan_fut as sf  # noqa: E402

fails = 0


def ok(c, m):
    global fails
    print(('PASS ' if c else 'FAIL ') + m)
    if not c:
        fails += 1


# --- screener query building
b = f.screener_body(['close', 'volume'], exchanges=['NYSE'], countries=['US'], market_cap_min=3e8, nothing=None)
ok(b['fields'] == ['close', 'volume'] and b['exchanges'] == ['NYSE'] and b['market_cap_min'] == 3e8, 'body has fields + filters')
ok('nothing' not in b, 'None filters dropped')
ok(b['sortBy'] == 'market_cap' and b['sortOrder'] == 'desc' and b['max_range'] == 15000, 'default sort + one page')
ok(f.screener_body(['close'], sortBy='volume', sortOrder='asc')['sortBy'] == 'volume', 'sort override')
for bad in ([], ['x'] * 11):
    try:
        f.screener_body(bad)
        ok(False, 'field count %d rejected' % len(bad))
    except ValueError:
        ok(True, 'field count %d rejected' % len(bad))
ok(len(f.STOCK_A) <= 10 and len(f.STOCK_B) <= 10 and len(f.ETF_F) <= 10 and len(f.CRYPTO_F) <= 10, 'every request <= 10 fields (IS limit)')

# --- row mapping
r = f.row_from({'symbol_code': 'NASDAQ:AAA', 'name': 'Aaa Inc', 'close': 10.456, 'change_percent_1D': 3.14159, 'volume': 1e6,
                'relative_volume_intraday': 2.5, 'gap_1D': 1.23456, 'relative_strength_index_14_1D': 71.234,
                'highest_price_52Weeks': 10.5, 'lowest_price_52Weeks': 5, 'market_cap': 4e9, 'sector': 'Tech'}, 'stock')
ok(r['s'] == 'NASDAQ:AAA' and r['c'] == 10.46 and r['chg'] == 3.14 and r['gap'] == 1.23 and r['rsi'] == 71.2, 'row rounded')
ok(list(r.keys()) == f.COLS, 'row keys = COLS')
ok(f.COLS[:len(f.PRESET_COLS)] == f.PRESET_COLS, 'v2 columns extend the preset columns')
ok(f.row_from({'symbol_code': 'X:Y', 'close': float('nan')}, 'stock')['c'] is None, 'NaN -> None')

# --- presets
def R(s, c=20, chg=0, vol=1e6, rvol=1, gap=0, rsi=50, hi=30, lo=10, cap=1e9):
    return {'s': s, 'n': s, 'c': c, 'chg': chg, 'vol': vol, 'rvol': rvol, 'gap': gap, 'rsi': rsi, 'hi52': hi, 'lo52': lo,
            'cap': cap, 'pe': None, 'sec': None, 'perfW': None, 'perfYtd': None, **{k: None for k in f.SLOW_COLS}}
stocks = [R('A', chg=9, gap=4), R('B', chg=5, rvol=3), R('C', chg=-7, gap=-3, rsi=25), R('D', chg=2, c=29.9, hi=30, rsi=75),
          R('E', chg=-1, c=10.02, lo=10), R('PENNY', c=0.5, chg=80), R('THIN', vol=100, chg=60)]
p = f.build_presets(stocks, [R('ETF1', chg=1)], [R('BTC', chg=2, cap=1e12), R('TINY', chg=50, cap=1e6)])
ok(p['gainers']['syms'][:2] == ['A', 'B'], 'gainers sorted, desc')
ok('PENNY' not in p['gainers']['syms'] and 'THIN' not in p['gainers']['syms'], 'sub-$1 and <$1M traded dropped')
ok(p['losers']['syms'] == ['C', 'E'], 'losers asc, only negatives')
ok(p['unusual']['syms'] == ['B'], 'unusual volume = rvol >= 2')
ok(p['high52']['syms'] == ['D'] and p['low52']['syms'] == ['E'], '52-week high / low within 0.5%')
ok(p['gapup']['syms'] == ['A'] and p['gapdown']['syms'] == ['C'], 'gap up / down >= 2%')
ok(p['rsihigh']['syms'] == ['D'] and p['rsilow']['syms'] == ['C'], 'RSI 70 / 30')
ok(p['cryptoup']['syms'] == ['BTC'], 'crypto under $50M cap dropped')
ok(all(len(v['syms']) <= f.TOP_N for v in p.values()), 'every preset <= TOP_N')

# --- parts
ps = f.parts(stocks, [R('ETF1', chg=1)], [R('BTC', chg=2, cap=1e12)], 1000)
pre = json.loads(gzip.decompress(ps['presets']))
ok(pre['cols'] == f.PRESET_COLS and pre['presets']['gainers']['rows'][0][0] == 'A' and len(pre['presets']['gainers']['rows'][0]) == len(f.PRESET_COLS), 'presets part rows in COLS order')
st = json.loads(gzip.decompress(ps['stock']))
ok(st['n'] == len(stocks) and st['d']['s'][0] == 'A' and len(st['d']['chg']) == len(stocks), 'universe part column-major')
ok(st['v'] == 2 and st['cols'] == f.COLS, 'universe part is v2 with the extra columns')
ok(set(ps) == {'presets', 'stock', 'etf', 'crypto'}, 'four parts')
ok(set(f.parts(stocks, [], [], 1000, [R('F')])) == {'presets', 'stock', 'etf', 'crypto', 'fut'}, 'futures part added when there are futures')


# --- screener v2: IS budget, slow fields, crypto widening, futures maths
ok(all(len(x) <= 10 for x in (f.STOCK_SLOW, f.ETF_SLOW, f.ETF_SLOW2, f.CRYPTO_SLOW, f.STOCK_B)), 'every v2 request <= 10 fields')
ok(f.slow_due({}, 'stock', 1000) and not f.slow_due({'stock': {'t': 1000}}, 'stock', 1000 + 3600) and f.slow_due({'stock': {'t': 1000}}, 'stock', 1000 + f.SLOW_TTL), 'slow block due only after 4 h')
# worst-case IS calls per weekday: base 4 per run + slow (stock 1 + etf 2 + crypto 1) per 4 h
refreshes = 7.5 * 3600 // f.SLOW_TTL + 1
ok(refreshes * 4 <= 150, 'screener adds at most %d IS calls a weekday (budget 150)' % (refreshes * 4))
ok(f.crypto_pick('BINANCE:BTCUSDT') == ('BTC', 0, 'BINANCE:BTCUSDT') and f.crypto_pick('COINBASE:ARBUSD')[2] == 'COINBASE:ARBUSD' and f.crypto_pick('KRAKEN:BTCUSD') is None and f.crypto_pick('BINANCE:USDCUSDT') is None, 'crypto: Binance first, Coinbase-only coins added, stables and other venues dropped')
cr = f.crypto_rows([{'symbol_code': 'COINBASE:ABCUSD', 'name': 'Abc', 'close': 1}, {'symbol_code': 'BINANCE:ABCUSDT', 'name': 'Abc', 'close': 2}, {'symbol_code': 'COINBASE:ZZZUSD', 'name': 'Zzz', 'close': 3}])
ok(set(cr) == {'BINANCE:ABCUSDT', 'COINBASE:ZZZUSD'} and cr['BINANCE:ABCUSDT']['c'] == 2, 'one row per coin, Binance wins')
cm = f.crypto_rows([{'symbol_code': 'BINANCE:BTCUSDT', 'name': 'Bitcoin', 'close': 5}, {'symbol_code': 'BINANCE:BTCUSD', 'name': 'Bitcoin', 'close': 5, 'market_cap': 9e11}])
ok(cm['BINANCE:BTCUSDT']['cap'] == 9e11, 'a coin takes its market cap from its other pair')
rows = [{'s': 'A', 'sma20': None, 'atr': 1.5}]
ok(f.merge_slow(rows, {'A': {'sma20': 9.0, 'atr': 7}})[0]['sma20'] == 9.0 and rows[0]['atr'] == 1.5, 'cached slow fields fill gaps, never overwrite fresh values')
ok(f.slow_of([{'s': 'A', 'sma20': 1, 'c': 5}]) == {'A': {'sma20': 1}}, 'slow_of keeps only slow keys')
ok(f.futures_due({}, 1793000000, True) is not None, 'futures_due runs')

import math
cl = [float(i) for i in range(1, 31)]
ok(abs(sf.sma(cl, 10) - 25.5) < 1e-9 and sf.sma(cl, 31) is None, 'SMA')
ok(sf.rsi14(cl) == 100.0 and sf.rsi14(cl[:10]) is None, 'RSI of a straight rise is 100; too few closes -> None')
zig = [10, 11] * 20
ok(40 < sf.rsi14([float(x) for x in zig]) < 60, 'RSI of a zig-zag is near 50')
ok(abs(sf.ema([1.0] * 30, 20) - 1.0) < 1e-9, 'EMA of a flat series is flat')
ok(abs(sf.atr14([2.0] * 20, [1.0] * 20, [1.5] * 20) - 1.0) < 1e-9, 'ATR of constant 1.0 ranges')
n = 260
bars = {'o': [100 + i * .1 for i in range(n)], 'h': [101 + i * .1 for i in range(n)], 'l': [99 + i * .1 for i in range(n)], 'c': [100.5 + i * .1 for i in range(n)], 'v': [1000.0] * n}
fr = sf.row_from_bars('NQ', bars, 100.0)
ok(fr['s'] == 'CME_MINI:NQ1!' and fr['rvol'] == 1.0 and fr['sec'] == 'Index' and fr['cap'] is None, 'futures row: symbol, rel volume, group, no market cap')
ok(list(fr.keys()) == f.COLS, 'futures row keys = COLS')
ok(fr['sma20'] is not None and fr['sma200'] is not None and fr['ema200'] is not None and fr['atr'] is not None and fr['perfQ'] is not None, 'futures technicals computed from bars')
ok(sf.row_from_bars('NQ', {k: v[:5] for k, v in bars.items()}) is None, 'too few bars -> no row')
y = {'chart': {'result': [{'timestamp': [1735689600 + 86400 * i for i in range(40)], 'indicators': {'quote': [{'open': [1.0] * 40, 'high': [2.0] * 40, 'low': [0.5] * 40, 'close': [1.5] * 39 + [None], 'volume': [5] * 40}]}}]}}
pb = sf.parse_yahoo(y)
ok(pb and len(pb[0]['c']) == 39, 'parse_yahoo drops null closes')
ok(sf.parse_yahoo({}) is None, 'parse_yahoo bad json -> None')
ok(set(sf.ROOTS) >= {'NQ', 'ES', 'MNQ', 'MES', 'YM', 'MYM', 'RTY', 'M2K', 'CL', 'MCL', 'GC', 'MGC', 'SI', 'SIL'}, 'every charted futures root is covered')
print('ALL PASS' if not fails else '%d FAILED' % fails)
sys.exit(1 if fails else 0)
