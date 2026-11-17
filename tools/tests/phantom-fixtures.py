#!/usr/bin/env python3
"""Build tools/fixtures/phantom/* from REAL Cboe chain snapshots (one per minute) with the real feeder code (gex-feeder/phantom.py
and tide.py). The browser test (tools/tests/phantom-browser.js) serves these as the recorder's /phantom/* and /tide replies, so the
page is tested and photographed on real numbers, never invented ones.
   python3 tools/tests/phantom-fixtures.py <dir with SYM-<epoch>.json.gz files>
The first snapshot of each symbol is a baseline (joined mid-session), exactly as the feeder does."""
import glob
import gzip
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
sys.path.insert(0, os.path.join(ROOT, 'workers', 'book-recorder', 'gex-feeder'))
import phantom  # noqa: E402
import tide  # noqa: E402

src = sys.argv[1]
out = os.path.join(ROOT, 'tools', 'fixtures', 'phantom')
os.makedirs(out, exist_ok=True)
summary = {'v': 1, 'day': None, 'u': {}}
KEEP = 60     # contracts whose per-minute series are kept for the drilldown fixture
for sym in ('_SPX', 'SPY', 'QQQ'):
    u = sym.lstrip('_')
    pst = tst = None
    minutes, tide_day, last = [], None, None
    for f in sorted(glob.glob(os.path.join(src, sym + '-*.json.gz'))):
        raw = gzip.open(f).read()
        spot, ct, rows = phantom.read_chain(raw)
        res, pst = phantom.step(pst, spot, ct, rows)
        ts, tst = tide.step(tst, *tide.read_chain(raw))
        if ts:
            d = tide_day = tide_day or {'day': ts['day'], 't': [], 's': [], 'cn': [], 'pn': [], 'cp': [], 'pp': [], 'cv': [], 'pv': []}
            for k in d:
                if k != 'day':
                    d[k].append(ts[k])
        if res:
            res['u'] = u
            minutes.append((res['t'], res['minute']))
            last = (res, rows, spot)
    res, rows, spot = last
    b = phantom.board(pst, rows, spot, res)
    b.pop('minute')
    open(os.path.join(out, 'board-%s.json' % u), 'w').write(json.dumps(b, separators=(',', ':')))
    summary['day'] = b['day']
    summary['u'][u] = {'t': b['t'], 'spot': b['spot'], 'from': b['from'], 'tot': b['tot'], 'mcols': b['mcols'], 'moves': b['moves'], 'lm': b['lm']}
    top = sorted(b['rows'], key=lambda r: -r[6])[:KEEP]
    keys = {r[0] for r in top} | {m[1] for m in b['moves']}
    mins = [[t, {k: v for k, v in m.items() if k in keys}] for t, m in minutes]
    open(os.path.join(out, 'minutes-%s.json' % u), 'w').write(json.dumps(mins, separators=(',', ':')))
    open(os.path.join(out, 'tide-%s.json' % u), 'w').write(json.dumps({'v': 1, 'u': u, 'keepDays': 30, 'days': [tide_day] if tide_day else []}, separators=(',', ':')))
    print(u, 'rows', len(b['rows']), 'moves', len(b['moves']), 'minutes', len(minutes), 'tide', len(tide_day['t']) if tide_day else 0)
open(os.path.join(out, 'summary.json'), 'w').write(json.dumps(summary, separators=(',', ':')))
print('day', summary['day'])
