#!/usr/bin/env python3
"""Phantom feeder maths (gex-feeder/phantom.py).   python3 workers/book-recorder/test/phantom_test.py
Proves: per-contract volume diff x price x 100, the bought / sold split, a dip never counted twice, the late-join baseline, the
whale-move ranking, the board rows (premium, net, OI, overnight OI change, previous-session volume), parity with ZoroTide's
per-sample totals, and the Cboe parser scope (<= 31 days, contracts with volume or OI)."""
import gzip
import json
import os
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'gex-feeder'))
import phantom  # noqa: E402
import tide  # noqa: E402

ET = ZoneInfo('America/New_York')
n = 0


def ok(c, m):
    global n
    assert c, m
    n += 1
    print('PASS', m)


def at(d, h, m):
    return datetime(2026, 11, d, h, m, 30, tzinfo=ET).strftime('%Y-%m-%dT%H:%M:%S')


def row(cp, vol, oi, last, bid, ask, exp='2026-11-20', k=7000.0):
    return (cp, exp, k, vol, oi, last, bid, ask)


A, B, C = 'SPXW261120C07000000', 'SPXW261120P06900000', 'SPXW261120C07100000'
r1 = {A: row('C', 100, 500, 2.0, 1.0, 2.0), B: row('P', 50, 40, 1.0, 1.0, 2.0, k=6900.0), C: row('C', 0, 10, 0, 0.5, 0.6, k=7100.0)}
res, st = phantom.step(None, 7000, at(17, 9, 31), r1)
ok(res['minute'] == {A: [100, 20000], B: [50, 5000]}, 'first sample of the day: everything since the open counts, per contract')
ok(st['acc'][A][:2] == [20000, 20000] and st['acc'][B][:2] == [5000, -5000], 'A bought at the ask (+), B sold at the bid (-)')
ok(st['oi'] == {A: 500, B: 40, C: 10}, 'the day OI is taken from the first chain (Cboe OI is fixed for the day)')
r2 = {A: row('C', 130, 500, 1.5, 1.0, 2.0), B: row('P', 45, 40, 1.0, 1.0, 2.0, k=6900.0), C: row('C', 20, 10, 0.55, 0.5, 0.6, k=7100.0)}
res, st = phantom.step(st, 7001, at(17, 9, 32), r2)
ok(res['minute'] == {A: [30, 4500], C: [20, 1100]}, 'only new volume counts; a falling count (B 50 -> 45) is ignored')
ok(st['acc'][A][:2] == [24500, 20000], 'middle of the spread nets 0: A premium adds up, net unchanged')
r3 = {A: row('C', 140, 500, 2.0, 1.0, 2.0), B: row('P', 52, 40, 1.0, 1.0, 2.0, k=6900.0), C: row('C', 20, 10, 0.55, 0.5, 0.6, k=7100.0)}
res, st = phantom.step(st, 7002, at(17, 9, 33), r3)
ok(res['minute'] == {A: [10, 2000], B: [2, 200]}, 'after a dip the day high is the baseline: B 52 - 50 = 2, not 7')
res2, st = phantom.step(st, 7002, at(17, 9, 33), r3)
ok(res2 is None, 'the same chain time twice makes no second sample')
ok(phantom.step(None, 7000, at(21, 10, 0), r1)[0] is None, 'Saturday: no sample')
late, stl = phantom.step(None, 7000, at(17, 10, 30), r1)
ok(late is None and stl['vols'][A] == 100 and stl['from'] is not None, 'joining mid-session: baseline only (we cannot know when that volume traded)')
res, stl = phantom.step(stl, 7000, at(17, 10, 31), {A: row('C', 110, 500, 2.0, 1.0, 2.0)})
ok(res['minute'] == {A: [10, 2000]}, 'after a late baseline only the next minute counts')

# board: totals, rows, and the next session's overnight OI change + previous-session volume
res['u'] = 'SPX'
b = phantom.board(st, r3, 7002, dict(res, lm=[], minute={}, t=1, spot=7002))
rows = {r[0]: dict(zip(phantom.BOARD_COLS, r)) for r in b['rows']}
ok(rows[A]['p'] == 26500 and rows[A]['n'] == 22000 and rows[A]['v'] == 140 and rows[A]['oi'] == 500 and rows[A]['doi'] is None, 'board row: day premium, net, volume, OI')
ok(b['tot'] == {'cp': 27600, 'pp': 5200, 'cn': 22000, 'pn': -5200, 'cv': 160, 'pv': 52}, 'board totals per side')
ok(b['exps'] == ['2026-11-20'] and rows[A]['x'] == 0, 'expiry index')
nxt = {A: row('C', 0, 620, 0, 1.0, 2.0), B: row('P', 0, 30, 0, 1.0, 2.0, k=6900.0)}
res, st2 = phantom.step(st, 7010, at(18, 9, 31), nxt)
ok(res is not None and st2['prev']['day'] == '2026-11-17', 'a new session keeps the previous one for the OI change')
b2 = phantom.board(st2, nxt, 7010, dict(res, lm=[]))
rows2 = {r[0]: dict(zip(phantom.BOARD_COLS, r)) for r in b2['rows']}
ok(rows2[A]['doi'] == 120 and rows2[A]['pv'] == 140 and rows2[B]['doi'] == -10 and rows2[B]['pv'] == 52,
   'next morning: A OI +120 after 140 traded (likely opened), B OI -10 (likely closed)')

# whale moves: biggest per-minute premium first, ties by time, capped; small jumps never qualify
m = phantom.rank_moves([[3, 'X', 1, 50000, 1, 1, 1]], [[1, 'Y', 1, 90000, 1, 1, 1], [2, 'Z', 1, 50000, 1, 1, 1], [4, 'W', 1, 70000, 1, 1, 1]], top=3)
ok([x[1] for x in m] == ['Y', 'W', 'Z'], 'whale ranking: premium desc, earlier first on a tie, top N kept')
big = {A: row('C', 1000, 500, 5.0, 4.0, 5.0)}
res, st3 = phantom.step(None, 7000, at(17, 9, 31), big)
ok(st3['moves'] and st3['moves'][0][1] == A and st3['moves'][0][3] == 500000 and st3['moves'][0][6] == 500, 'a $500K minute is a whale move (with its OI)')
res, st4 = phantom.step(None, 7000, at(17, 9, 31), {A: row('C', 10, 500, 5.0, 4.0, 5.0)})
ok(st4['moves'] == [], 'a $5K minute is not (MIN_MOVE_USD)')

# real Cboe chains (fixtures): parser scope and parity with ZoroTide on the same two chains
fx = os.path.join(HERE, 'fixtures')
pair = sorted(f for f in os.listdir(fx) if f.startswith('phantom-qqq-') and f.endswith('.json.gz'))
if len(pair) >= 2:
    raws = [gzip.open(os.path.join(fx, f)).read() for f in pair[:2]]
    old = tide.LATE_START_S
    tide.LATE_START_S = 10 ** 9           # the fixtures are mid-session: count from the first one, as at the open
    try:
        pst = tst = None
        for raw in raws:
            spot, ct, rows = phantom.read_chain(raw)
            pres, pst = phantom.step(pst, spot, ct, rows)
            ts, tst = tide.step(tst, *tide.read_chain(raw))
        ok(all(r[1] <= '2026-12-18' for r in rows.values()) and len(rows) > 1000, 'parser: expiries <= 31 days, %d contracts' % len(rows))
        tot = sum(v[1] for v in pres['minute'].values())
        ok(abs(tot - (ts['cp'] + ts['pp'])) <= len(pres['minute']), 'per-minute premium equals ZoroTide gross (%d vs %d)' % (tot, ts['cp'] + ts['pp']))
        pres['u'] = 'QQQ'
        body = json.dumps(phantom.board(pst, rows, spot, pres), separators=(',', ':')).encode()
        ok(len(gzip.compress(body, 6)) < 512 * 1024, 'board gzip %d KB < 512 KB' % (len(gzip.compress(body, 6)) // 1024))
    finally:
        tide.LATE_START_S = old
else:
    print('SKIP real-chain checks (no fixtures)')
print('%d passed' % n)
