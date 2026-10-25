#!/usr/bin/env python3
"""gex_fast.py schedule (2026-10-25 InsightSentry monthly-quota cut). python3 workers/book-recorder/test/gex_fast_test.py
Proves: the trading window is 09:28-16:02 ET weekdays only; 0DTE is due every 120 s and 1DTE every 600 s per underlying;
a whole simulated weekday (the main loop's one-underlying-per-2-s rotation) spends ~710 REST calls, under 800."""
import os
import sys
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'gex-feeder'))
sys.path.insert(0, os.path.join(HERE, '..', 'of-feeder'))
import gex_fast as g  # noqa: E402

ET = ZoneInfo('America/New_York')
n = 0


def ok(m):
    global n
    n += 1
    print('PASS', m)


def et(y, mo, d, h, mi):
    return datetime(y, mo, d, h, mi, tzinfo=ET).astimezone(timezone.utc)


# window: Monday 2026-10-26
assert not g.in_window(et(2026, 10, 26, 9, 27))
assert g.in_window(et(2026, 10, 26, 9, 28))
assert g.in_window(et(2026, 10, 26, 16, 2))
assert not g.in_window(et(2026, 10, 26, 16, 3))
assert not g.in_window(et(2026, 10, 25, 12, 0))   # Sunday
assert not g.in_window(et(2026, 10, 24, 12, 0))   # Saturday
ok('window 09:28-16:02 ET, weekdays only')

assert g.STEP_0 == 120 and g.STEP_1 == 600
p = {}
assert g.due(p, 'SPX', 0, 1000) and g.due(p, 'SPX', 1, 1000)
p[('SPX', 0)] = 1000; p[('SPX', 1)] = 1000
assert not g.due(p, 'SPX', 0, 1000 + 100) and g.due(p, 'SPX', 0, 1000 + 119)
assert not g.due(p, 'SPX', 1, 1000 + 500) and g.due(p, 'SPX', 1, 1000 + 599)
assert g.due(p, 'QQQ', 0, 1001)
ok('0DTE due every 120 s, 1DTE every 600 s, per underlying')

# simulate the main loop's selection (0.25 s ticks, one pull per 2 s at most, rotating SPX -> QQQ -> SPY)
t = et(2026, 10, 26, 9, 0).timestamp()
end = et(2026, 10, 26, 16, 30).timestamp()
order, i, nxt, pulled, calls = list(g.CODES), 0, 0, {}, 0
gaps0 = []
last0 = {}
while t < end:
    if g.in_window(datetime.fromtimestamp(t, timezone.utc)):
        u = order[i % 3]
        want = [d for d in (0, 1) if g.due(pulled, u, d, t)]
        if not want:
            i += 1
        if want and t >= nxt:
            i += 1; nxt = t + 2
            for d in want:
                pulled[(u, d)] = t
                calls += 1
                if d == 0:
                    if u in last0:
                        gaps0.append(t - last0[u])
                    last0[u] = t
    t += 0.25
assert 650 <= calls <= 800, calls
assert max(gaps0) <= 125, max(gaps0)
ok('one simulated weekday = %d REST calls (was ~9,700); 0DTE never older than %.0f s' % (calls, max(gaps0)))
print('gex_fast_test: %d checks passed' % n)
