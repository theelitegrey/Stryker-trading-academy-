#!/usr/bin/env python3
"""Research only. Compare our GEX levels (ours.jsonl) with hand-entered levels (theirs.csv).
Usage: python3 gex_compare.py [DIR]   (DIR default /root/projects/stryker-notes/reports/gex-compare)
theirs.csv columns: date,sym,callResistance,putSupport,gammaFlip,other  (other = "7400;7350" extra levels, optional)
Per day+sym+snapshot: diff in points (ours - theirs) and % of spot, plus same strike / within 1 strike / further."""
import csv, json, sys, os
D = sys.argv[1] if len(sys.argv) > 1 else '/root/projects/stryker-notes/reports/gex-compare'
STEP = {'SPX': 5, 'ES': 5, 'SPY': 1, 'QQQ': 1, 'NQ': 25}  # strike spacing used for "within 1 strike"
MAP = [('callResistance', 'callWall'), ('putSupport', 'putWall'), ('gammaFlip', 'gammaFlip')]

def num(x):
    try: return float(str(x).replace(',', '').strip())
    except ValueError: return None

ours = [json.loads(l) for l in open(os.path.join(D, 'ours.jsonl')) if l.strip()]
ours = [o for o in ours if 'callWall' in o]
theirs = list(csv.DictReader(open(os.path.join(D, 'theirs.csv'))))
for t in theirs:
    sym = t['sym'].strip().upper(); step = STEP.get(sym, 1)
    snaps = [o for o in ours if o['date'] == t['date'].strip() and o['sym'] == sym]
    if not snaps: print(f"{t['date']} {sym}: no snapshot of ours"); continue
    for o in snaps:
        print(f"{o['date']} {sym} ours@{o['time_ny']} NY spot {o['spot']}")
        for tk, ok in MAP:
            a, b = o.get(ok), num(t.get(tk))
            if a is None or b is None: print(f"  {tk:15} n/a (ours={a}, theirs={b})"); continue
            d = a - b; ad = abs(d)
            cls = 'same strike' if ad < step / 2 else 'within 1 strike' if ad <= step * 1.01 else 'further'
            print(f"  {tk:15} ours {a:>10.2f} theirs {b:>10.2f} diff {d:+9.2f} pts {d / o['spot'] * 100:+6.2f}% {cls}")
        for x in filter(None, (num(v) for v in (t.get('other') or '').split(';'))):
            n = min(o['topStrikes'], key=lambda s: abs(s['strike'] - x), default=None)
            if n: print(f"  other {x:g}: nearest of our top-5 strikes {n['strike']} ({n['strike'] - x:+g} pts)")
