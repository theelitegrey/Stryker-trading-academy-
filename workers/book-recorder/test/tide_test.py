#!/usr/bin/env python3
"""ZoroTide maths (gex-feeder/tide.py). python3 workers/book-recorder/test/tide_test.py
Proves: volume diff x price x 100, the 25 % bought / sold bands, the mid fallback, negative diffs ignored,
the baseline for a late first sample, the session-open reset, and the Cboe chain parser."""
import json
import os
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'gex-feeder'))
import tide  # noqa: E402

ET = ZoneInfo('America/New_York')
n = 0


def ok(c, m):
    global n
    assert c, m
    n += 1
    print('PASS', m)


# side bands: bid 1.00 ask 2.00 (spread 1.00): >= 1.75 bought, <= 1.25 sold, between half
ok(tide.bought_share(1.80, 1.0, 2.0) == 1.0 and tide.bought_share(1.75, 1.0, 2.0) == 1.0, 'last in the top 25 % of the spread (or above the ask) = bought')
ok(tide.bought_share(1.20, 1.0, 2.0) == 0.0 and tide.bought_share(1.25, 1.0, 2.0) == 0.0 and tide.bought_share(0.9, 1.0, 2.0) == 0.0, 'last in the bottom 25 % (or below the bid) = sold')
ok(tide.bought_share(1.5, 1.0, 2.0) == 0.5, 'last in the middle = half and half')
ok(tide.bought_share(1.5, 0.0, 0.0) == 0.5 and tide.bought_share(0.0, 1.0, 2.0) == 0.5, 'no usable quote or no last = half and half')
ok(tide.price_of(1.5, 1.0, 2.0) == 1.5 and tide.price_of(0.0, 1.0, 2.0) == 1.5 and tide.price_of(0.0, 0.0, 0.0) == 0.0, 'price = last, else mid')


def row(cp, vol, last, bid, ask):
    return (cp, vol, last, bid, ask)


def at(h, m):
    return datetime(2026, 10, 29, h, m, 30, tzinfo=ET).strftime('%Y-%m-%dT%H:%M:%S')


r1 = {'A': row('C', 100, 2.0, 1.0, 2.0), 'B': row('P', 50, 1.0, 1.0, 2.0)}
s, st = tide.step(None, 7000, at(9, 31), r1)
# first sample of the day: everything since the open counts. A: 100 x 2.00 x 100 = 20000 bought. B: 50 x 1.00 x 100 = 5000 sold.
ok(s and s['cp'] == 20000 and s['cn'] == 20000 and s['pp'] == 5000 and s['pn'] == -5000 and s['cv'] == 100 and s['pv'] == 50, 'first sample: calls bought +20000, puts sold -5000')
r2 = {'A': row('C', 130, 1.1, 1.0, 2.0), 'B': row('P', 50, 1.0, 1.0, 2.0), 'C': row('P', 10, 1.5, 1.0, 2.0)}
s, st = tide.step(st, 7001, at(9, 32), r2)
ok(s['cp'] == 30 * 1.1 * 100 + 0 and s['cn'] == -round(30 * 1.1 * 100) and s['cv'] == 30, 'only the NEW volume counts (130 - 100 = 30), sold side negative')
ok(s['pp'] == 10 * 1.5 * 100 and s['pn'] == 0 and s['pv'] == 10, 'new contract: 10 x 1.50 x 100 = 1500, middle of the spread nets 0')
r3 = {'A': row('C', 120, 1.1, 1.0, 2.0), 'B': row('P', 60, 1.9, 1.0, 2.0)}   # A went DOWN (Cboe correction): ignored
s, st = tide.step(st, 7002, at(9, 33), r3)
ok(s['cv'] == 0 and s['pv'] == 10 and s['pn'] == 10 * 1.9 * 100, 'a falling count is ignored, B bought +1900')
r4 = {'A': row('C', 135, 1.9, 1.0, 2.0)}
s, st = tide.step(st, 7002, at(9, 34), r4)
ok(s['cv'] == 5, 'after a dip the day high is the baseline: 135 - 130 = 5, not 15')
s2, st2 = tide.step(st, 7002, at(9, 34), r4)
ok(s2 is None, 'the same chain time twice makes no second sample')
s, stl = tide.step(None, 7000, at(10, 30), r1)
ok(s is None and stl and stl['vols'], 'joining mid-session: baseline only, no sample (we cannot know when that volume traded)')
s, st3 = tide.step(stl, 7000, at(10, 31), {'A': row('C', 110, 2.0, 1.0, 2.0)})
ok(s['cv'] == 10, 'the next sample after a baseline counts normally')
s, _ = tide.step(st3, 7000, '2026-10-30T09:31:00', r1)
ok(s and s['day'] == '2026-10-30' and s['cv'] == 100, 'new day: the count resets at the open')
ok(tide.step(None, 7000, at(9, 10), r1)[0] is None and tide.step(None, 7000, at(16, 40), r1)[0] is None, 'nothing before 9:30 or after 16:20 ET')
ok(tide.step(None, 7000, '2026-10-31T10:00:00', r1)[0] is None, 'nothing on a Saturday')

raw = json.dumps({'data': {'symbol': '^SPX', 'current_price': 7000.5, 'last_trade_time': '2026-10-29T10:00:00', 'options': [
    {'option': 'SPXW261029C07000000', 'bid': 1.0, 'ask': 2.0, 'volume': 12.0, 'last_trade_price': 1.8},
    {'option': 'SPXW261029P07000000', 'bid': 1.0, 'ask': 2.0, 'volume': 0.0, 'last_trade_price': 0},
    {'option': 'SPXW261029P06990000', 'bid': 0.5, 'ask': 0.6, 'volume': 7.0, 'last_trade_price': 0}]}}).encode()
spot, ct, rows = tide.read_chain(raw)
ok(spot == 7000.5 and ct == '2026-10-29T10:00:00' and len(rows) == 2 and rows['SPXW261029C07000000'] == ('C', 12, 1.8, 1.0, 2.0), 'Cboe chain parser keeps only contracts with volume')
print('ALL PASS', n)
