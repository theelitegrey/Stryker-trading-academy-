#!/usr/bin/env python3
"""Build assets/fonts/archivo-tnum-latin-variable.woff2 from the self-hosted Archivo.

Same font, but the default digits 0-9 point at Archivo's own tabular glyphs
(zero.tf ... nine.tf), so numbers line up in columns without needing
font-variant-numeric on every rule. CSS `font:` shorthands reset
font-variant-numeric, so a feature switch alone would miss most of the
~1200 data rules; a font whose default digits are tabular cannot be reset.
It backs --font-mono ("data" text: prices, P&L, times, labels).

Needs fonttools + brotli (pip install fonttools brotli). Run from the repo root:
  python3 tools/make-archivo-tnum.py
"""
from fontTools.ttLib import TTFont

SRC = 'assets/fonts/archivo-latin-variable.woff2'
OUT = 'assets/fonts/archivo-tnum-latin-variable.woff2'

f = TTFont(SRC)
gsub = f['GSUB'].table
tnum = {}
for fr in gsub.FeatureList.FeatureRecord:
    if fr.FeatureTag == 'tnum':
        for li in fr.Feature.LookupListIndex:
            for st in gsub.LookupList.Lookup[li].SubTable:
                tnum.update(getattr(st, 'mapping', {}))
digits = {ord(c): n for c, n in zip('0123456789', ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'])}
assert all(n in tnum for n in digits.values()), 'Archivo lost its tnum glyphs'
for t in f['cmap'].tables:
    if t.isUnicode():
        for cp, name in digits.items():
            if cp in t.cmap:
                t.cmap[cp] = tnum[name]
for rec in f['name'].names:
    if rec.nameID in (1, 4, 16):
        rec.string = str(rec.toUnicode()).replace('Archivo', 'Archivo Tnum')
f.flavor = 'woff2'
f.save(OUT)
# self-check: every digit now has one advance width
g = TTFont(OUT)
cm, hm = g.getBestCmap(), g['hmtx']
widths = {hm[cm[cp]][0] for cp in digits}
assert len(widths) == 1, widths
print('wrote', OUT, 'digit advance', widths.pop())
