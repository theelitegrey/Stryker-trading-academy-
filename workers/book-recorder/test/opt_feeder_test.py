#!/usr/bin/env python3
"""Unit tests for the options analytics feeder maths (opt-feeder/opt_feeder.py).
Run: python3 workers/book-recorder/test/opt_feeder_test.py   (stdlib only; CI runs it)."""
import math
import os
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'opt-feeder'))
import opt_feeder as f  # noqa: E402

ET = ZoneInfo('America/New_York')
fails = 0


def ok(cond, name):
    global fails
    print(('PASS ' if cond else 'FAIL ') + name)
    if not cond:
        fails += 1


def close(a, b, tol=1e-6):
    return a is not None and b is not None and abs(a - b) <= tol


def ts(y, m, d, hh, mm=0):
    return datetime(y, m, d, hh, mm, tzinfo=ET).timestamp()


def C(k, cp, bid, ask, iv=0.2, delta=None):
    return {'k': k, 'cp': cp, 'root': '', 'bid': bid, 'ask': ask, 'iv': iv, 'delta': delta}


# --- expected move: ATM straddle, interpolated between the strikes around spot
cs = [C(100, 'C', 2.0, 2.2), C(100, 'P', 1.0, 1.2), C(105, 'C', 0.4, 0.6), C(105, 'P', 4.0, 4.2)]
st, iv, k = f.atm_straddle(cs, 101.0)
# straddle(100) = 2.1 + 1.1 = 3.2, straddle(105) = 0.5 + 4.1 = 4.6, w = 0.2 -> 3.48
ok(close(st, 3.48), 'straddle interpolated at spot 101 = 3.48 (got %s)' % st)
ok(k == 100, 'lower strike 100')
st, _, _ = f.atm_straddle(cs, 100.0)
ok(close(st, 3.2), 'spot on a strike -> that straddle')
st, _, _ = f.atm_straddle(cs, 99.0)
ok(close(st, 3.2), 'spot below every strike -> nearest straddle')
ok(f.atm_straddle([C(100, 'C', 0, 0)], 100)[0] is None, 'no ask -> no straddle')
ok(f.mid({'bid': 3, 'ask': 2}) is None, 'crossed quote ignored')
ok(close(f.mid({'bid': None, 'ask': 0.1}), 0.05), 'missing bid counts as 0')

# --- skew: IV at 25 delta, linear in delta
puts = [C(90, 'P', 1, 1, iv=0.30, delta=-0.10), C(95, 'P', 1, 1, iv=0.25, delta=-0.20), C(97, 'P', 1, 1, iv=0.23, delta=-0.30),
        C(103, 'C', 1, 1, iv=0.17, delta=0.30), C(105, 'C', 1, 1, iv=0.16, delta=0.20)]
p25 = f.iv_at_delta(puts, 'P', 0.25)
c25 = f.iv_at_delta(puts, 'C', 0.25)
ok(close(p25, 0.24), '25d put IV interpolated = 0.24 (got %s)' % p25)
ok(close(c25, 0.165), '25d call IV interpolated = 0.165 (got %s)' % c25)
ok(f.iv_at_delta(puts, 'C', 0.5) is None, 'delta outside the chain -> None')

# --- IV rank / percentile
closes = list(range(10, 40))   # 10..39, 30 days
r = f.iv_rank(closes, 20)
ok(close(r['rank'], round((20 - 10) / 29 * 100, 1)), 'IV rank = (now-min)/(max-min) (got %s)' % r['rank'])
ok(close(r['pct'], round(10 / 30 * 100, 1)), 'IV percentile = share of days below (got %s)' % r['pct'])
ok(f.iv_rank(closes, 50)['rank'] == 100.0, 'rank clamps at 100')
ok(f.iv_rank(closes[:5], 20) is None, 'fewer than 20 days -> None')
ok(f.iv_rank(list(range(1000)), 999)['n'] == 252, 'only the last 252 days are used')

# --- expiry picking (Wednesday 2026-10-14, a normal week; third Friday = 2026-10-16)
exps = ['2026-10-14', '2026-10-15', '2026-10-16', '2026-10-19', '2026-10-23', '2026-11-20']
p = f.pick_expiries(exps, ts(2026, 10, 14, 11))
ok(p == {'0DTE': '2026-10-14', '1DTE': '2026-10-15', 'Weekly': '2026-10-16', 'Monthly': '2026-10-16'}, 'Wed before close: %s' % p)
p = f.pick_expiries(exps, ts(2026, 10, 14, 16, 30))
ok('0DTE' not in p and p['1DTE'] == '2026-10-15', 'after 16:00 ET today is not 0DTE: %s' % p)
p = f.pick_expiries(exps, ts(2026, 10, 16, 17))
ok(p.get('Weekly') == '2026-10-23' and p.get('Monthly') == '2026-11-20', 'Friday after close rolls weekly and monthly: %s' % p)
ok(f.third_friday(2026, 11).isoformat() == '2026-11-20', 'third Friday Nov 2026')
p = f.pick_expiries(['2026-10-22', '2026-10-30'], ts(2026, 10, 19, 10))
ok(p.get('Weekly') == '2026-10-22', 'holiday Friday -> Thursday weekly: %s' % p)

# --- 30-day interpolation (variance-time for IV)
term = [{'days': 20, 'iv': 0.2, 'skew': 0.02}, {'days': 40, 'iv': 0.3, 'skew': 0.04}]
v = f.interp_30d(term, 'iv')
ok(close(v, math.sqrt((0.04 * 20 + 0.5 * (0.09 * 40 - 0.04 * 20)) / 30)), 'atm30 variance-time (got %s)' % v)
ok(close(f.interp_30d(term, 'skew'), 0.03), 'skew30 linear')
ok(close(f.interp_30d([{'days': 5, 'iv': 0.2}], 'iv'), 0.2), 'one expiry -> its value')

# --- put/call from a Cboe compact chain
chain = {'expiries': {'2026-10-14': [[100, 'C', 10, 0.2, 1, 1, 50, 0.5], [100, 'P', 30, 0.2, 1, 1, 100, -0.5]],
                      '2026-10-16': [[100, 'C', 90, 0.2, 1, 1, 50, 0.5], [100, 'P', 70, 0.2, 1, 1, 50, -0.5]]}}
pc = f.put_call(chain)
ok(close(pc['vol'], 1.5) and close(pc['oi'], 1.0), 'P/C volume 150/100, OI 100/100: %s' % pc)
ok(close(pc['vol_first'], 2.0) and close(pc['oi_first'], 3.0), 'P/C of the first expiry')
ok(f.put_call({'expiries': {}}) is None, 'empty chain -> None')

# --- InsightSentry rows: SPXW wins over SPX AM on the same Friday; expired dropped
rows = [{'code': 'OPRA:SPX261016C7700.0', 'expiration': 20261016, 'type': 'CALL', 'strike_price': 7700, 'bid_price': 1, 'ask_price': 2},
        {'code': 'OPRA:SPXW261016C7700.0', 'expiration': 20261016, 'type': 'CALL', 'strike_price': 7700, 'bid_price': 3, 'ask_price': 4},
        {'code': 'OPRA:SPXW261013C7700.0', 'expiration': 20261013, 'type': 'CALL', 'strike_price': 7700, 'bid_price': 3, 'ask_price': 4}]
ch = f.parse_is_rows(rows, '2026-10-14')
ok(list(ch) == ['2026-10-16'] and len(ch['2026-10-16']) == 1 and ch['2026-10-16'][0]['root'] == 'SPXW', 'SPXW kept, SPX AM + expired dropped')

# --- analyse end to end on a synthetic chain + futures mapping
def chain_for_exp(spot, sd):
    out = []
    for k in range(int(spot) - 20, int(spot) + 21, 5):
        c = max(spot - k, 0) + sd * 0.4
        p = max(k - spot, 0) + sd * 0.4
        d = 0.5 - (k - spot) / 40
        out += [C(k, 'C', c - 0.05, c + 0.05, 0.2, d), C(k, 'P', p - 0.05, p + 0.05, 0.22, d - 1)]
    return out
now = ts(2026, 10, 14, 11)
a = f.analyse({'2026-10-14': chain_for_exp(100, 2), '2026-10-15': chain_for_exp(100, 4)}, 'SPX', 100.0, now, ('ES', 100.5))
e0 = [r for r in a['em'] if r['k'] == '0DTE'][0]
ok(close(e0['em'], 1.6, 1e-6) and close(e0['lo'], 98.4) and close(e0['hi'], 101.6), '0DTE expected move = straddle 1.6: %s' % e0)
ok(close(e0['fut']['em'], 1.6 * 1.005, 1e-2) and close(e0['fut']['c'], 100.5), 'ES mapping = straddle x futures/spot ratio')
ok(len(a['term']) == 2 and a['term'][0][0] == '2026-10-14', 'term structure rows')

print('%d failed' % fails if fails else 'ALL PASS')
sys.exit(1 if fails else 0)
