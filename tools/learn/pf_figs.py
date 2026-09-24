#!/usr/bin/env python3
"""Figures and tables for the Prop Firm Mastery funnel article (how-prop-firms-work).

Uses the track library (tools/tracks/svglib.py). Content is written fresh for the
public article: no paid-chapter figure is reproduced.
Run: python3 tools/learn/pf_figs.py   (then node tools/gen-learn.js)
"""
import os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'tracks'))
from svglib import boxes, table, fmt  # noqa: E402
import svglib  # noqa: E402

SLUG = 'how-prop-firms-work'


def paste(marker, markup, kind='FIG'):
    p = os.path.join(HERE, SLUG + '.html')
    s = open(p).read()
    pat = re.compile(r'(<!-- %s:%s -->)[\s\S]*?(<!-- /%s:%s -->)' % (kind, marker, kind, marker))
    if not pat.search(s):   # first run: a single placeholder comment
        single = '<!-- %s:%s -->' % (kind, marker)
        assert single in s, marker
        s = s.replace(single, single + '\n<!-- /%s:%s -->' % (kind, marker))
    s = pat.sub(lambda m: m.group(1) + '\n' + markup + '\n' + m.group(2), s)
    open(p, 'w').write(s)


G, GO, R, I = svglib.GREEN, svglib.GOLD, svglib.RED, svglib.INK

# the path: four stages
path_svg = boxes([
    ('1. Evaluation', ['you pay a fee', 'hit the target, keep the rules'], GO),
    ('2. Funded account', ['usually simulated', 'activation fee at some firms'], G),
    ('3. Payouts', ['meet payout rules', 'you keep the split'], G),
    ('4. Live (sometimes)', ['firm decides, after review', 'not automatic'], I),
], 'The usual path at a futures prop firm', cols=2)

# the money: where it flows in the simulated model
money_svg = boxes([
    ('Traders pay in', ['evaluation fees', 'resets, activation fees'], GO),
    ('The firm', ['keeps fees as income', 'runs the platform'], I),
    ('The firm pays out', ['payouts to funded traders', 'from its own funds'], G),
    ('The market', ['usually not involved', 'in simulated stages'], R),
], 'Where the money goes in the simulated model', cols=2)

# worked cost table (Topstep 50K Standard, published prices, Sep 2026)
MONTH, RESET, ACT = 49, 49, 149
rows = [['Month 1 subscription (failed)', '$%s' % fmt(MONTH, 0), '$%s' % fmt(MONTH, 0)],
        ['Reset (passed on 2nd attempt)', '$%s' % fmt(RESET, 0), '$%s' % fmt(MONTH + RESET, 0)],
        ['Activation fee on passing', '$%s' % fmt(ACT, 0), '$%s' % fmt(MONTH + RESET + ACT, 0)]]
assert MONTH + RESET + ACT == 247
payout = min(0.5 * 2000, 2000); net = 0.9 * payout
assert (payout, net) == (1000, 900)
cost_table = table(['Item (hypothetical)', 'Cost', 'Running total'], rows)

paste('path', path_svg)
paste('money', money_svg)
paste('cost', cost_table, kind='TABLE')
print('pf figs pasted')
