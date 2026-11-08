#!/usr/bin/env python3
"""GEX-FAST2 (2026-11-08): near-money 0DTE IV from streamed option quotes. python3 workers/book-recorder/test/gex_fast2_test.py
Real captured fixtures only (2026-11-08, markets shut): the InsightSentry SPX 0DTE reply for 2026-11-09 (one REST call),
the Cboe compact near chain, and the raw socket messages of a 6-symbol probe (5 OPRA option quotes + CBOE:SPX)."""
import gzip
import json
import os
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'gex-feeder'))
sys.path.insert(0, os.path.join(HERE, '..', 'of-feeder'))
import gex_fast as g  # noqa: E402

FX = os.path.join(HERE, 'fixtures')
IS = json.load(gzip.open(os.path.join(FX, 'gex-fast2-is-spx-20261109.json.gz'), 'rt'))
NEAR = json.loads(gzip.decompress(open(os.path.join(FX, 'gex-fast2-near-spx-20261108.json.gz'), 'rb').read()))
WSMSG = [json.loads(x) for x in open(os.path.join(FX, 'gex-fast2-ws-20261108.ndjson'))]
EXP = '2026-11-09'
NOW = datetime(2026, 11, 9, 10, 0, tzinfo=ZoneInfo('America/New_York')).timestamp()   # Monday 10:00 ET
S = IS['last_price']
n = 0


def ok(c, m):
    global n
    assert c, m
    n += 1
    print('PASS', m)


# 1. Black-Scholes IV inversion round-trips, and matches the vendor's bid/ask IV on the real reply (T = time to Monday close
#    at the vendor's own stamp)
T0 = g.years_to_close(EXP, IS['last_update'] / 1000)
for iv in (0.08, 0.25, 0.9):
    ok(abs(g.bs_iv('C', S, 7400, T0, g.bs_price('C', S, 7400, T0, iv)) - iv) < 1e-6, 'bs_iv round trip at %.2f' % iv)
ok(g.bs_iv('C', S, 7400, T0, 0) is None and g.bs_iv('C', S, 7400, T0, S) is None, 'bs_iv refuses prices outside the no-arbitrage range')
near = sorted([o for o in IS['data'] if o['bid_price'] > 0 and abs(o['strike_price'] - S) < 30], key=lambda o: abs(o['strike_price'] - S))[:8]
worst = max(abs(g.bs_iv(o['type'][0], S, o['strike_price'], T0, o['bid_price']) - o['bid_iv']) for o in near)
ok(worst < 0.005, 'our IV of the real bid matches the vendor bid_iv within %.4f (8 near strikes)' % worst)

# 2. contract pick: OTM side, nearest spot, SPXW root, right expiry
pk = g.pick_codes(IS, EXP, S, 23)
ok(len(pk) == 23, '23 contracts picked')
ok(all(('C' if k >= S else 'P') == cp for cp, k in pk.values()), 'calls at/above spot, puts below')
ok(all(c.startswith('OPRA:SPXW261109') for c in pk), 'weekly SPXW codes for 2026-11-09 only')
ks = sorted(k for _, k in pk.values())
ok(ks[0] < S < ks[-1] and ks[-1] - ks[0] <= 23 * 5, 'strikes straddle spot: %g-%g' % (ks[0], ks[-1]))
ok(g.pick_codes(IS, '2026-11-10', S, 23) == {}, 'no contracts for an expiry not in the reply')
ok(not g.need_repick(pk, S) and g.need_repick(pk, ks[0] + 1) and g.need_repick({}, S), 're-centre only when spot leaves the middle half')

# 3. the socket parser on the REAL probe messages (codes from the probe; bid/ask zero on a shut market)
sp = g.Spots('x', start=False)
for d in WSMSG:
    sp.on_msg(d, NOW)
ok(sp.active and abs(sp.get()['SPX']['p'] - 7376.86) < 1e-9, 'probe: subscription active, SPX spot parsed')
q = sp.quotes()
ok(len(q) == 5 and all(c.startswith('OPRA:') for c in q), 'probe: 5 option contracts stream quotes')
ok(q['OPRA:SPXW261109C7375.0'] == {'bid': 0.0, 'ask': 0.0, 't': NOW}, 'probe: bid/ask merged per code')
ok(g.mid_of(0.0, 0.0) is None, 'a closed-market zero quote is never used')
lim = {'error': 'subscription_limit_exceeded', 'retryable': False, 'details': {'requested_subscriptions': 6, 'max_subscriptions': 5}}
ok(sp.on_msg(lim, NOW) and sp.opt_off and sp.subs() == list(g.CODES.values()), 'plan cap -> spots only, socket kept')

# 4. subscription pacing: first set at once, a change waits RESUB_GAP, nothing re-sent when unchanged
sp = g.Spots('x', start=False)
ok(sp.due_send(0) == list(g.CODES.values()), 'connect: spots')
sp.want(list(pk), force=True)
ok(len(sp.due_send(10)) == 3 + 23, 'first option set sent at once')
ok(sp.due_send(11) is None, 'unchanged set not re-sent')
sp.want(list(pk)[:20])
ok(sp.due_send(100) is None and len(sp.due_send(10 + g.RESUB_GAP)) == 23, 'a changed set waits %d s' % g.RESUB_GAP)
ok(3 * 3600 / g.RESUB_GAP + 2 < 40, 'worst case %d option-set messages / 3 h (account cap 120, shared)' % (3 * 3600 / g.RESUB_GAP + 2))

# 5. rebuild from streamed quotes
blk0 = g.reduce_chain(IS, NEAR, 0, NOW)
ok(blk0 and blk0['x'] == EXP and len(blk0['k']) >= 20, 'REST block for 2026-11-09 (%d strikes)' % len(blk0['k']))
T = g.years_to_close(EXP, NOW)
base = g.ws_base(IS, pk, S, T)
ok(len(base) == 23, 'base IV for every streamed contract')
quotes = {}
for o in IS['data']:
    if o['code'] in pk:
        quotes[o['code']] = {'bid': o['bid_price'], 'ask': o['ask_price'], 't': NOW + 5}
same, nm, newest = g.overlay(IS, pk, base, quotes, S, T, NOW + 5)
blk1 = g.reduce_chain(same, NEAR, 0, NOW, mp=blk0['mp'])
ok(nm == 23 and newest == NOW + 5, 'unchanged quotes move all 23 strikes by 0')
ok(max(abs(a - b) for a, b in zip(blk0['ci'] + blk0['pi'], blk1['ci'] + blk1['pi'])) < 1e-3, 'unchanged quotes -> the REST block IVs')
up = {c: {'bid': v['bid'] * 1.10, 'ask': v['ask'] * 1.10, 't': v['t']} for c, v in quotes.items()}
moved, nm2, _ = g.overlay(IS, pk, base, up, S, T, NOW + 5)
blk2 = g.reduce_chain(moved, NEAR, 0, NOW, mp=blk0['mp'])
diff = [i for i, k in enumerate(blk2['k']) if k in ks and blk2['ci'][i] > blk0['ci'][i] + 1e-4]
ok(nm2 == 23 and len(diff) >= 15, 'premiums +10 %% -> IV up on %d streamed strikes' % len(diff))
far = [i for i, k in enumerate(blk2['k']) if k not in ks]
ok(all(blk2['ci'][i] == blk0['ci'][i] and blk2['pi'][i] == blk0['pi'][i] for i in far), 'strikes not streamed keep the REST IV')
ok(blk2['mp'] == blk0['mp'] and blk2['c'] == blk0['c'], 'OI and max pain unchanged by quotes')
old = {c: dict(v, t=NOW - g.QUOTE_MAX_AGE - 1) for c, v in up.items()}
ok(g.overlay(IS, pk, base, old, S, T, NOW)[1] == 0, 'quotes older than %d s are ignored' % g.QUOTE_MAX_AGE)
bad = {c: dict(v, bid=v['bid'] * 4, ask=v['ask'] * 4) for c, v in quotes.items()}
ok(g.overlay(IS, pk, base, bad, S, T, NOW + 5)[1] < 23, 'a wild quote (IV move > 50 %) is ignored')


# 6. ws_rebuild end to end on the feeder's state
class FakeSpots:
    def get(self):
        return {'SPX': {'p': S, 't': NOW + 5}}

    def quotes(self):
        return up


builds = {'SPX': {'0': dict(blk0, b=int(NOW)), 'built': int(NOW)}}
rest = {'SPX': {'d': IS, 'x': EXP, 'mp': blk0['mp'], 'picks': pk, 'base': base}}
g.ws_rebuild(builds, rest, {'SPX': (NOW, NEAR)}, FakeSpots(), NOW + 6)
b = builds['SPX']['0']
ok(b['b'] == int(NOW + 5) and b['ws'] == 23 and builds['SPX']['built'] == int(NOW + 5), 'socket rebuild stamps the newest quote time')
g.ws_rebuild(builds, rest, {'SPX': (NOW, NEAR)}, FakeSpots(), NOW + 8)
ok(builds['SPX']['0'] is b, 'no new quote -> no rebuild')
print('gex_fast2_test: %d checks passed' % n)
