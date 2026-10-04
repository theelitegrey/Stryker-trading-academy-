#!/usr/bin/env python3
"""Generator for the illustrative hero chart of preview variation C ("Dashboard").

All data here is HAND-BUILT and ILLUSTRATIVE (SVG y-units, no prices).
The volume profile is derived from the candles below, so POC / VAH / VAL are
computed rather than placed by eye: each candle's volume is spread evenly
over its high-low range, then the value area grows outward from the POC bin
until it holds 70% of the total.

Usage: python3 tools/storyboards/home-combo-c-gen.py > /tmp/svg.html
"""

# (open, high, low, close, relative volume) in SVG y units (smaller = higher price)
C = [
    (160, 150, 166, 140, 5), (140, 124, 146, 118, 5),                       # lead-in
    (118, 100, 122, 104, 9), (104, 96, 112, 110, 9), (110, 94, 116, 98, 9),
    (98, 88, 104, 106, 9), (106, 96, 118, 112, 9), (112, 98, 116, 100, 9),
    (100, 86, 106, 94, 9), (94, 90, 110, 104, 9), (104, 92, 112, 108, 9),   # balance, equal highs
    (108, 92, 112, 94, 8),                                                  # last up candle = OB
    (94, 58, 98, 96, 9),                                                    # Judas sweep above EQH
    (96, 94, 150, 146, 8),                                                  # displacement, MSS
    (146, 124, 160, 154, 5),                                                # FVG = i12 low .. i14 high
    (154, 150, 172, 166, 4), (166, 156, 170, 158, 4),
    (158, 138, 162, 142, 4), (142, 120, 146, 124, 4),                       # retrace
    (124, 100, 130, 126, 6),                                                # tap into zone, rejects
    (126, 122, 150, 146, 4), (146, 140, 168, 164, 4), (164, 160, 190, 186, 3),
    (186, 180, 206, 200, 3), (200, 194, 222, 216, 3), (216, 210, 234, 228, 3),
    (228, 222, 238, 226, 4), (226, 214, 232, 218, 4),                       # stalls at put wall
]

X0, DX, BW = 12, 10, 6          # candle centre start, spacing, body width
Y_SWING_HIGH, Y_SWING_LOW = 86, 122
FVG = (98, 124)                  # i12 low .. i14 high
OB = (94, 108)                   # i11 body
ZONE = (98, 108)                 # FVG and OB overlap = entry zone
I_OB, I_SWEEP, I_DISP, I_ENTRY, I_EQH0, I_SL0 = 11, 12, 13, 19, 5, 2
Y_CALL, Y_FLIP, Y_PUT = 54, 103, 236

# --- volume profile -----------------------------------------------------------
BIN, B_TOP, B_BOT = 6, 48, 240
bins = list(range(B_TOP, B_BOT, BIN))
vol = [0.0] * len(bins)
for o, h, l, c, v in C:
    rng = max(1, l - h)
    for k, b in enumerate(bins):
        ov = max(0, min(l, b + BIN) - max(h, b))
        vol[k] += v * ov / rng
poc = max(range(len(vol)), key=lambda k: vol[k])
total, lo, hi, acc = sum(vol), poc, poc, vol[poc]
while acc < 0.7 * total:
    up = vol[lo - 1] if lo > 0 else -1
    dn = vol[hi + 1] if hi < len(vol) - 1 else -1
    if up >= dn:
        lo -= 1; acc += up
    else:
        hi += 1; acc += dn
VMAX = max(vol)
Y_POC = bins[poc] + BIN / 2
Y_VAH, Y_VAL = bins[lo], bins[hi] + BIN

# --- gamma ladder (net gamma by strike, illustrative) -------------------------
STRIKES = list(range(26, 265, 14))
G = {26: 6, 40: 12, 54: 26, 68: 14, 82: 9, 96: 3, 110: -3, 124: -6, 138: -8,
     152: -7, 166: -10, 180: -9, 194: -12, 208: -14, 222: -18, 236: -26, 250: -12, 264: -6}

VP_R, VP_W = 352, 46            # profile anchored on its right edge, grows left
LAD_C, LAD_W = 388, 24          # ladder centre and half-width
W, H = 420, 272


def f(n):
    return ('%.1f' % n).rstrip('0').rstrip('.')


out = []
p = out.append
p('<svg class="hcc-svg" viewBox="0 0 %d %d" xmlns="http://www.w3.org/2000/svg" role="img" '
  'aria-labelledby="hcc-title">' % (W, H))
p('<title id="hcc-title">Illustrative chart combining three lenses: gamma levels (call wall, zero-gamma '
  'flip, put wall), a volume profile (POC and value area) and an ICT setup (liquidity sweep above the '
  'swing high, displacement, market structure shift, fair value gap and order block). The entry zone, '
  'the zero-gamma flip and the value area high sit at the same price zone.</title>')

# backgrounds of the side columns
p('<rect class="hcc-col" x="%d" y="20" width="%d" height="%d" rx="3"/>' % (VP_R - VP_W - 4, VP_W + 8, H - 26))
p('<rect class="hcc-gpos" x="%d" y="20" width="%d" height="%s" rx="3"/>' % (LAD_C - LAD_W - 4, 2 * LAD_W + 8, f(Y_FLIP - 20)))
p('<rect class="hcc-gneg" x="%d" y="%s" width="%d" height="%s" rx="3"/>' % (LAD_C - LAD_W - 4, f(Y_FLIP), 2 * LAD_W + 8, f(H - 6 - Y_FLIP)))
p('<text class="hcc-colh" x="%d" y="13" text-anchor="middle">VOL</text>' % (VP_R - VP_W / 2))
p('<text class="hcc-colh" x="%d" y="13" text-anchor="middle">GEX</text>' % LAD_C)
p('<text class="hcc-gsign hcc-gsign-p" x="%d" y="32" text-anchor="end">+γ</text>' % (LAD_C + LAD_W + 2))
p('<text class="hcc-gsign hcc-gsign-n" x="%d" y="%d" text-anchor="end">−γ</text>' % (LAD_C + LAD_W + 2, H - 12))

# grid
p('<g class="hcc-grid">')
for y in (60, 120, 180, 240):
    p('<line x1="0" y1="%d" x2="300" y2="%d"/>' % (y, y))
p('</g>')

# confluence band (spans all three lenses)
p('<g class="hcc-band" data-k="3"><rect class="hcc-band-r" x="0" y="%d" width="%d" height="%d"/>'
  '<rect class="hcc-band-glow" x="0" y="%d" width="%d" height="%d"/></g>'
  % (ZONE[0], W, ZONE[1] - ZONE[0], ZONE[0], W, ZONE[1] - ZONE[0]))

# GEX levels across chart + profile
def level(cls, y, k, label, lx, anchor='start', lbl_dy=-4):
    p('<g class="hcc-lv %s" data-k="%s"><line class="hcc-hl" x1="0" y1="%s" x2="%d" y2="%s"/>'
      '<line class="hcc-ln" x1="0" y1="%s" x2="%d" y2="%s"/>'
      '<text class="hcc-t" x="%s" y="%s" text-anchor="%s">%s</text></g>'
      % (cls, k, f(y), W - 4, f(y), f(y), W - 4, f(y), f(lx), f(y + lbl_dy), anchor, label))

level('hcc-call', Y_CALL, 0, 'CALL WALL', 298, 'end')
level('hcc-flip', Y_FLIP, 1, 'ZERO GAMMA', 298, 'end')
level('hcc-put', Y_PUT, '', 'PUT WALL', 4)
# volume profile levels: only across the profile and a short stub into the chart
p('<g class="hcc-lv hcc-poc" data-k="2"><line class="hcc-hl" x1="0" y1="%s" x2="%d" y2="%s"/>'
  '<line class="hcc-ln" x1="0" y1="%s" x2="%d" y2="%s"/></g>' % (f(Y_POC), VP_R + 2, f(Y_POC), f(Y_POC), VP_R + 2, f(Y_POC)))
p('<g class="hcc-va"><line x1="%d" y1="%s" x2="%d" y2="%s"/><line x1="%d" y1="%s" x2="%d" y2="%s"/></g>'
  % (VP_R - VP_W - 4, f(Y_VAH), VP_R + 4, f(Y_VAH), VP_R - VP_W - 4, f(Y_VAL), VP_R + 4, f(Y_VAL)))

# ICT zones
ZX1 = X0 + I_ENTRY * DX + 6
p('<g class="hcc-ict hcc-pop" style="--d:2.0s">')
p('<rect class="hcc-ob" x="%d" y="%d" width="%d" height="%d"/>' % (X0 + I_OB * DX - 4, OB[0], ZX1 - (X0 + I_OB * DX - 4), OB[1] - OB[0]))
p('<rect class="hcc-fvg" x="%d" y="%d" width="%d" height="%d"/>' % (X0 + I_SWEEP * DX - 3, FVG[0], ZX1 - (X0 + I_SWEEP * DX - 3), FVG[1] - FVG[0]))
p('</g>')
p('<g class="hcc-ict hcc-pop" style="--d:1.7s"><line class="hcc-swing" x1="%d" y1="%d" x2="%d" y2="%d"/>'
  '<line class="hcc-mss" x1="%d" y1="%d" x2="%d" y2="%d"/></g>'
  % (X0 + I_EQH0 * DX, Y_SWING_HIGH, X0 + I_SWEEP * DX + 4, Y_SWING_HIGH, X0 + I_SL0 * DX, Y_SWING_LOW, X0 + I_DISP * DX + 4, Y_SWING_LOW))

# candles
p('<g class="hcc-candles">')
for i, (o, h, l, c, v) in enumerate(C):
    x = X0 + i * DX
    bull = c < o
    top, bot = min(o, c), max(o, c)
    p('<g class="hcc-c %s" style="--i:%d"><rect class="hcc-wick" x="%s" y="%d" width="1.2" height="%d"/>'
      '<rect class="hcc-body" x="%s" y="%d" width="%d" height="%d" rx="1"/></g>'
      % ('up' if bull else 'dn', i, f(x - 0.6), h, l - h, f(x - BW / 2), top, BW, max(2, bot - top)))
p('</g>')

# volume profile bars
p('<g class="hcc-vp">')
for k, b in enumerate(bins):
    w = VP_W * vol[k] / VMAX
    if w < 0.6:
        continue
    cls = 'poc' if k == poc else ('va' if lo <= k <= hi else 'out')
    p('<rect class="hcc-vb %s" style="--i:%d" x="%s" y="%s" width="%s" height="%d" rx="1"/>'
      % (cls, k, f(VP_R - w), f(b + 0.5), f(w), BIN - 1))
p('</g>')

# gamma ladder
p('<g class="hcc-lad"><line class="hcc-lad-axis" x1="%d" y1="20" x2="%d" y2="%d"/>' % (LAD_C, LAD_C, H - 6))
for s in STRIKES:
    g = G[s]
    w = LAD_W * abs(g) / 26
    x = LAD_C if g > 0 else LAD_C - w
    cls = 'pos' if g > 0 else 'neg'
    if s in (Y_CALL, Y_PUT):
        cls += ' wall'
    p('<rect class="hcc-gb %s" style="--i:%d" x="%s" y="%s" width="%s" height="7" rx="1"/>'
      % (cls, STRIKES.index(s), f(x), f(s - 3.5), f(w)))
p('</g>')

# ICT labels (late)
SX = X0 + I_SWEEP * DX
p('<g class="hcc-pop" style="--d:2.3s"><circle class="hcc-sweep" cx="%d" cy="59" r="6"/>'
  '<text class="hcc-t hcc-blue" x="%d" y="72">JUDAS SWEEP</text>'
  '<text class="hcc-t hcc-s hcc-mut" x="%d" y="82">EQH</text></g>' % (SX, SX + 9, X0 + I_EQH0 * DX - 2))
p('<g class="hcc-pop" style="--d:2.5s"><text class="hcc-t hcc-green" x="%d" y="%d">MSS</text></g>'
  % (X0 + 2 * DX + 4, Y_SWING_LOW + 11))
p('<g class="hcc-pop" style="--d:2.6s"><text class="hcc-t hcc-s hcc-fvg-t" x="%d" y="%d">FVG</text>'
  '<text class="hcc-t hcc-s hcc-ob-t hcc-halo" x="%d" y="%d">OB</text></g>'
  % (X0 + 14 * DX - 4, FVG[1] - 3, ZX1 + 3, OB[0] + 3))
ex = X0 + I_ENTRY * DX
p('<g class="hcc-pop" style="--d:2.9s"><g class="hcc-entry"><path d="M%d 95 l-4.5 -8 h9 z"/></g>'
  '<text class="hcc-t hcc-amber" x="%d" y="82" text-anchor="middle">ENTRY</text></g>' % (ex, ex))
# POC / VAH / VAL tags inside the profile column (bars are short at VAH/VAL)
p('<g class="hcc-pop" style="--d:1.6s"><text class="hcc-t hcc-s hcc-poc-t hcc-halo" x="%d" y="%s" text-anchor="end">POC</text>'
  '<text class="hcc-t hcc-s hcc-va-t" x="%d" y="%s">VAH</text>'
  '<text class="hcc-t hcc-s hcc-va-t" x="%d" y="%s">VAL</text></g>'
  % (VP_R - 2, f(Y_POC - 3), VP_R - VP_W - 2, f(Y_VAH - 2), VP_R - VP_W - 2, f(Y_VAL + 9)))
# confluence tag
p('<g class="hcc-ctag"><rect x="%d" y="%d" width="78" height="15" rx="7.5"/>'
  '<text x="%d" y="%d" text-anchor="middle">CONFLUENCE</text></g>' % (220, ZONE[1] + 5, 259, ZONE[1] + 15.5))

# crosshair cursor: JS moves it with transforms only
p('<g class="hcc-cur" aria-hidden="true">'
  '<g class="hcc-cur-x"><line x1="0" y1="18" x2="0" y2="%d"/></g>'
  '<g class="hcc-cur-y"><line x1="0" y1="0" x2="%d" y2="0"/></g>'
  '<g class="hcc-cur-d"><circle r="3.2"/><circle class="hcc-cur-ring" r="7"/></g></g>' % (H - 4, W))
p('</svg>')

print('\n'.join(out))
import sys
print('POC y=%s VAH y=%s VAL y=%s zone=%s flip=%s' % (Y_POC, Y_VAH, Y_VAL, ZONE, Y_FLIP), file=sys.stderr)
print('CURSOR = [[%d,%d],[%d,%d],[%d,%s],[%d,%d]]' % (X0 + I_SWEEP * DX, Y_CALL, LAD_C, Y_FLIP, VP_R - 16, f(Y_POC), X0 + I_ENTRY * DX, (ZONE[0] + ZONE[1]) // 2), file=sys.stderr)
