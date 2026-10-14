#!/usr/bin/env python3
"""Unit tests for the market scanner feeder (scan-feeder/scan_feeder.py): query building, row
mapping, presets. Run: python3 workers/book-recorder/test/scan_feeder_test.py (stdlib; CI runs it)."""
import gzip
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'scan-feeder'))
import scan_feeder as f  # noqa: E402

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
ok(f.row_from({'symbol_code': 'X:Y', 'close': float('nan')}, 'stock')['c'] is None, 'NaN -> None')

# --- presets
def R(s, c=20, chg=0, vol=1e6, rvol=1, gap=0, rsi=50, hi=30, lo=10, cap=1e9):
    return {'s': s, 'n': s, 'c': c, 'chg': chg, 'vol': vol, 'rvol': rvol, 'gap': gap, 'rsi': rsi, 'hi52': hi, 'lo52': lo,
            'cap': cap, 'pe': None, 'sec': None, 'perfW': None, 'perfYtd': None}
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
ok(pre['cols'] == f.COLS and pre['presets']['gainers']['rows'][0][0] == 'A' and len(pre['presets']['gainers']['rows'][0]) == len(f.COLS), 'presets part rows in COLS order')
st = json.loads(gzip.decompress(ps['stock']))
ok(st['n'] == len(stocks) and st['d']['s'][0] == 'A' and len(st['d']['chg']) == len(stocks), 'universe part column-major')
ok(set(ps) == {'presets', 'stock', 'etf', 'crypto'}, 'four parts')

print('ALL PASS' if not fails else '%d FAILED' % fails)
sys.exit(1 if fails else 0)
