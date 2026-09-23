#!/usr/bin/env python3
"""Figures for the two Volume Profile & Order Flow funnel articles.

Uses the track library (tools/tracks/svglib.py) so the public articles and the
paid chapters draw with the same geometry rules. Data is illustrative and
different from the chapter data, so no paid figure is reproduced.
Run: python3 tools/learn/vp_figs.py   (then node tools/gen-learn.js)
"""
import os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'tracks'))
from svglib import profile, footprint, dom, value_area, delta_rows, diagonal_imbalances, fmt  # noqa: E402


def paste(slug, marker, svg):
    p = os.path.join(HERE, slug + '.html')
    s = open(p).read()
    pat = re.compile(r'(<!-- FIG:%s -->)[\s\S]*?(<!-- /FIG:%s -->)' % (marker, marker))
    assert pat.search(s), (slug, marker)
    s = pat.sub(lambda m: m.group(1) + '\n' + svg + '\n' + m.group(2), s)
    open(p, 'w').write(s)


# ---------------------------------------------------------------- volume profile article
P = [4810.0 + i for i in range(14)]
V = [40, 90, 210, 430, 610, 780, 900, 720, 380, 150, 110, 260, 340, 120]
poc, lo, hi = value_area(P, V)
lvn = min(range(poc + 1, len(V) - 2), key=lambda i: V[i])
hvn2 = max(range(lvn + 1, len(V)), key=lambda i: V[i])
assert V[lvn] < V[lvn - 1] and V[lvn] < V[lvn + 1] and V[hvn2] > V[hvn2 - 1]
svg_vp, _ = profile(P, V, 'Illustrative volume profile', dp=0, row_h=18,
                    mark_nodes={lvn: 'LVN', hvn2: 'HVN'})
VP_FACTS = dict(poc=fmt(P[poc], 0), val=fmt(P[lo], 0), vah=fmt(P[hi], 0), lvn=fmt(P[lvn], 0), hvn=fmt(P[hvn2], 0),
                total=sum(V), va=sum(V[lo:hi + 1]))

# ---------------------------------------------------------------- order flow article
T = 0.25
book = [(4812.00, None, 55), (4811.75, None, 34), (4811.50, None, 18), (4811.25, 21, None), (4811.00, 40, None), (4810.75, 62, None)]
svg_dom = dom(book, 'Illustrative order book', note='spread = 1 tick (0.25)')
bar = {'o': 4811.00, 'c': 4812.00, 'rows': {4812.25: (3, 14), 4812.00: (9, 38), 4811.75: (11, 42), 4811.50: (8, 40),
                                            4811.25: (12, 19), 4811.00: (28, 16), 4810.75: (17, 8)}}
buys, sells = diagonal_imbalances(bar['rows'], T, 3.0)
d, t = delta_rows(bar['rows'])
assert len(buys) >= 3 and d > 0
svg_fp = footprint([bar], 'Illustrative footprint bar', T, ratio=3.0)
OF_FACTS = dict(delta=d, vol=t, buys=', '.join(fmt(p) for p in sorted(buys, reverse=True)))

if __name__ == '__main__':
    paste('volume-profile', 'vp', svg_vp)
    paste('order-flow', 'dom', svg_dom)
    paste('order-flow', 'fp', svg_fp)
    print(VP_FACTS)
    print(OF_FACTS)
