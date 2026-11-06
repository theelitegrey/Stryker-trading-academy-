#!/usr/bin/env python3
"""Research only. Compare our GEX levels (ours.jsonl) with hand-entered levels (theirs.csv).
Usage: python3 gex_compare.py [DIR]   (DIR default /root/projects/stryker-notes/reports/gex-compare)
theirs.csv columns: date,sym,callResistance,putSupport,gammaFlip,other  (other = "7400;7350" extra levels, optional)
Reports both variants ('ours' = 1-30d walls, 'allexp' = all term-chain expiries; old lines without variant = ours) and a closeness tally.
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
for o in ours: o.setdefault('variant', 'ours')
tally = {}  # (variant, level) -> [sum |diff| % of spot, n]
theirs = list(csv.DictReader(open(os.path.join(D, 'theirs.csv'))))
for t in theirs:
    sym = t['sym'].strip().upper(); step = STEP.get(sym, 1)
    snaps = [o for o in ours if o['date'] == t['date'].strip() and o['sym'] == sym]
    if not snaps: print(f"{t['date']} {sym}: no snapshot of ours"); continue
    for o in snaps:
        print(f"{o['date']} {sym} {o['variant']}@{o['time_ny']} NY spot {o['spot']}")
        for tk, ok in MAP:
            a, b = o.get(ok), num(t.get(tk))
            if a is None or b is None: print(f"  {tk:15} n/a ({o['variant']}={a}, theirs={b})"); continue
            d = a - b; ad = abs(d)
            t_ = tally.setdefault((o['variant'], tk), [0, 0]); t_[0] += ad / o['spot'] * 100; t_[1] += 1
            cls = 'same strike' if ad < step / 2 else 'within 1 strike' if ad <= step * 1.01 else 'further'
            print(f"  {tk:15} ours {a:>10.2f} theirs {b:>10.2f} diff {d:+9.2f} pts {d / o['spot'] * 100:+6.2f}% {cls}")
        for x in filter(None, (num(v) for v in (t.get('other') or '').split(';'))):
            n = min(o['topStrikes'], key=lambda s: abs(s['strike'] - x), default=None)
            if n: print(f"  other {x:g}: nearest of our {o['variant']} top-{len(o['topStrikes'])} strikes {n['strike']} ({n['strike'] - x:+g} pts)")

print('\nCLOSENESS (mean |diff| % of spot vs theirs; lower = closer)')
for lv in [m[0] for m in MAP]:
    row = [f"{v} {tally[(v, lv)][0] / tally[(v, lv)][1]:.3f}% (n={tally[(v, lv)][1]})" for v in ('ours', 'allexp') if (v, lv) in tally]
    if row: print(f"  {lv:15} " + '   '.join(row))
