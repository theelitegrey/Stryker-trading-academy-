#!/usr/bin/env python3
"""Unit tests for brief_feeder.py's pure parts. Run: python3 workers/book-recorder/test/brief_feeder_test.py"""
import os
import sys
from datetime import datetime, date, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'brief-feeder'))
import brief_feeder as F  # noqa: E402

UTC = timezone.utc
n = 0


def ok(name, cond):
    global n
    assert cond, name
    n += 1
    print('ok  ' + name)


def day(s):
    return int(datetime.strptime(s, '%Y-%m-%d').replace(hour=4, tzinfo=UTC).timestamp())


# goodUntil = next weekday 05:30 UTC run + 90 min
ok('Wed afternoon -> Thu 07:00', F.iso(F.good_until(datetime(2026, 10, 14, 19, 0, tzinfo=UTC))) == '2026-10-15T07:00:00Z')
ok('Wed 05:31 -> Thu 07:00', F.iso(F.good_until(datetime(2026, 10, 14, 5, 31, tzinfo=UTC))) == '2026-10-15T07:00:00Z')
ok('Wed 05:00 (before the run) -> Wed 07:00', F.iso(F.good_until(datetime(2026, 10, 14, 5, 0, tzinfo=UTC))) == '2026-10-14T07:00:00Z')
ok('Fri -> Mon 07:00', F.iso(F.good_until(datetime(2026, 10, 16, 6, 0, tzinfo=UTC))) == '2026-10-19T07:00:00Z')
ok('Sat -> Mon 07:00', F.iso(F.good_until(datetime(2026, 10, 17, 12, 0, tzinfo=UTC))) == '2026-10-19T07:00:00Z')

# session date
ok('Wed 15:00 ET -> Wed', F.session_date(datetime(2026, 10, 14, 19, 0, tzinfo=UTC)) == date(2026, 10, 14))
ok('Wed 17:00 ET -> Thu', F.session_date(datetime(2026, 10, 14, 21, 0, tzinfo=UTC)) == date(2026, 10, 15))
ok('Fri evening -> Mon', F.session_date(datetime(2026, 10, 16, 22, 0, tzinfo=UTC)) == date(2026, 10, 19))

# plan
ok('first run is full', F.plan(datetime(2026, 10, 14, 19, 0, tzinfo=UTC), {}, []) == 'full')
ok('weekday after 05:30, not yet run today -> full', F.plan(datetime(2026, 10, 15, 5, 45, tzinfo=UTC), {'fullDay': '2026-10-14'}, []) == 'full')
ok('in the US session -> map', F.plan(datetime(2026, 10, 15, 15, 0, tzinfo=UTC), {'fullDay': '2026-10-15'}, []) == 'map')
ok('overnight -> cal', F.plan(datetime(2026, 10, 15, 2, 0, tzinfo=UTC), {'fullDay': '2026-10-14'}, []) == 'cal')
ok('weekend -> cal', F.plan(datetime(2026, 10, 17, 15, 0, tzinfo=UTC), {'fullDay': '2026-10-16'}, []) == 'cal')

# returns
bars = [(day('2025-10-14'), 100.0), (day('2025-12-31'), 110.0), (day('2026-09-14'), 115.0), (day('2026-10-07'), 118.0),
        (day('2026-10-08'), 119.0), (day('2026-10-09'), 117.0), (day('2026-10-12'), 120.0), (day('2026-10-13'), 121.0), (day('2026-10-14'), 120.0)]
v = F.returns(bars)
ok('1D', v[0] == round((120 / 121 - 1) * 100, 2))
ok('5D = five bars back', v[1] == round((120 / 118 - 1) * 100, 2))
ok('1M = last close on or before the same day a month ago', v[2] == round((120 / 115 - 1) * 100, 2))
ok('YTD from the last close of the previous year', v[5] == round((120 / 110 - 1) * 100, 2))
ok('1Y', v[6] == round((120 / 100 - 1) * 100, 2))
ok('a window the history does not reach is None', F.returns(bars[-3:])[4] is None)

# quotes on top of daily bars
now = day('2026-10-14') + 11 * 3600
b2 = F.merge_quote(list(bars), {'last_price': 125.0, 'lp_time': now - 10, 'status': 'OPEN'}, 'AMEX:SPY', now)
ok('same-day quote replaces the close', b2[-1][1] == 125.0 and len(b2) == len(bars))
b3 = F.merge_quote(list(bars), {'last_price': 125.0, 'lp_time': now - 10, 'status': 'CLOSED'}, 'AMEX:SPY', now)
ok('a closed US cash quote is not used', b3[-1][1] == 120.0)
b4 = F.merge_quote(list(bars), {'last_price': 99.0, 'lp_time': now + 2 * 86400, 'status': 'OPEN'}, 'FX:EURUSD', now + 2 * 86400)
ok('a next-day quote appends a bar', len(b4) == len(bars) + 1)
pre = int(datetime(2026, 10, 14, 12, 0, tzinfo=UTC).timestamp())   # 08:00 ET
ok('pre-market bar of today dropped for US cash', len(F.drop_premarket_bar(list(bars), 'AMEX:SPY', pre)) == len(bars) - 1)
ok('...but kept for futures', len(F.drop_premarket_bar(list(bars), 'NYMEX:CL1!', pre)) == len(bars))

# text
ok('signed percent uses a real minus', F.sp(-1.2) == '\u22121.20%' and F.sp(0.5) == '+0.50%')
ok('bp', F.sbp(-3.4) == '\u22123bp' and F.sbp(2.6) == '+3bp')

# calendar rows
e = {'t': 1791981000000, 'c': 'US', 'cur': 'USD', 'i': 'high', 'ti': 'Inflation Rate YoY', 'a': 3.7, 'f': 3.6, 'p': 3.4, 'u': '%'}
r = F.cal_row(e)
ok('row at is UTC ISO Z', r['at'] == '2026-10-14T12:30:00Z')
ok('row carries actual/forecast/previous', (r['actual'], r['forecast'], r['previous']) == ('3.7%', '3.6%', '3.4%'))
ok('high row has a note', 'Printed 3.7%' in r['note'])
ok('no time zone names in the note', not any(z in r['note'] for z in (' ET', 'GMT', 'EST')))
ok('countries we do not list are dropped', F.cal_row(dict(e, c='UG')) is None)
r2 = F.cal_row({'t': 1791981000000, 'c': 'US', 'i': 'medium', 'ti': 'Fed Barkin Speech'})
ok('no actual invented', 'actual' not in r2 and 'forecast' not in r2)

# banks: a decision moves the rate exactly once
raw = [{'t': 1000, 'c': 'US', 'ti': 'Fed Interest Rate Decision', 'a': 4.25, 'p': 4.0},
       {'t': 5000, 'c': 'US', 'ti': 'Fed Interest Rate Decision'}]
memo = {}
b = F.build_banks(raw, [{'cur': 'USD', 'rate': '3.75\u20134.00%', 'bias': 'up'}], 2000, memo)
ok('hike applied to the range', b[0]['rate'] == '4.00\u20134.25%' and b[0]['bias'] == 'up')
b = F.build_banks(raw, [{'cur': 'USD', 'rate': '4.00\u20134.25%', 'bias': 'up'}], 2000, memo)
ok('...and not applied twice', b[0]['rate'] == '4.00\u20134.25%')
ok('a bank with no rate anywhere is left out', all(x['cur'] == 'USD' for x in b))

print('%d brief-feeder tests passed' % n)
