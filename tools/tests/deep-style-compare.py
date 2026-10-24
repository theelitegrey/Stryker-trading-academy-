#!/usr/bin/env python3
"""Side-by-side sheets: the public Deepcharts reference image (left) next to our chart shot (right).
  python3 tools/tests/deep-style-compare.py <ourShotsDir> <before|after> [tool ...]
Writes reports/shots/deepcharts-ref/compare/<tool>-<tag>.png (reference + our 1440 shot, our 390 shot
inset when present). Our shots come from tools/tests/chart-deep-style-shots.js (v09-1440-<case>.png).
"""
import os, sys
from PIL import Image, ImageDraw, ImageFont

REF = '/root/projects/stryker-notes/reports/shots/deepcharts-ref'
FONT = os.path.join(os.path.dirname(__file__), '..', '..', 'assets', 'fonts')
# tool -> (reference image, our case id)
PAIRS = {
    'theme': ('theme-1.png', 'theme'),
    'footprint': ('footprint-2.png', 'footprint'),
    'bigtrades': ('bigtrades-1.png', 'bigtrades'),
    'absorption': ('absorption-1.png', 'absorption'),
    'imbalance': ('imbalance-1.png', 'imbalance'),
    'volumeprofile': ('volumeprofile-1.png', 'volumeprofile'),
    'tpo': ('tpo-1.png', 'tpo'),
    'delta': ('delta-1.png', 'delta'),
    'cvd': ('delta-2.png', 'cvd'),
    'delta-profile': ('volumeprofile-3.png', 'delta-profile'),
    'effort': ('effort-1.png', 'effort'),
    'heatmap': ('heatmap-1.png', 'heatmap'),
}


def font(sz):
    for f in ('Archivo-SemiBold.ttf', 'Archivo-Regular.ttf'):
        p = os.path.join(FONT, f)
        if os.path.exists(p):
            return ImageFont.truetype(p, sz)
    try:
        return ImageFont.truetype('DejaVuSans-Bold.ttf', sz)
    except Exception:
        return ImageFont.load_default()


def fit(im, w, h):
    im = im.copy()
    im.thumbnail((w, h))
    return im


def main():
    ours, tag = sys.argv[1], sys.argv[2]
    tools = sys.argv[3:] or list(PAIRS)
    os.makedirs(os.path.join(REF, 'compare'), exist_ok=True)
    W, H, HEAD = 960, 600, 34
    for t in tools:
        ref, case = PAIRS[t]
        o = os.path.join(ours, 'v09-1440-' + case + '.png')
        if not os.path.exists(o):
            print('skip', t, '(no shot)')
            continue
        sheet = Image.new('RGB', (W * 2 + 12, H + HEAD), (10, 10, 12))
        d = ImageDraw.Draw(sheet)
        a = fit(Image.open(os.path.join(REF, ref)).convert('RGB'), W, H)
        b = fit(Image.open(o).convert('RGB'), W, H)
        sheet.paste(a, ((W - a.width) // 2, HEAD + (H - a.height) // 2))
        sheet.paste(b, (W + 12 + (W - b.width) // 2, HEAD + (H - b.height) // 2))
        ph = os.path.join(ours, 'v09-390-' + case + '.png')
        if os.path.exists(ph):
            p = fit(Image.open(ph).convert('RGB'), 180, 390)
            x, y = W * 2 + 12 - p.width - 6, HEAD + H - p.height - 6
            d.rectangle((x - 2, y - 2, x + p.width + 1, y + p.height + 1), outline=(3, 201, 136))
            sheet.paste(p, (x, y))
        f = font(17)
        d.text((10, 8), 'Deepcharts (public help/feature page): ' + ref, fill=(200, 200, 200), font=f)
        d.text((W + 22, 8), 'TradeZoro ' + tag + ': NQ recorded data, 1440' + (' + 390 inset' if os.path.exists(ph) else ''), fill=(3, 201, 136), font=f)
        out = os.path.join(REF, 'compare', t + '-' + tag + '.png')
        sheet.save(out, optimize=True)
        print(out)


if __name__ == '__main__':
    main()
