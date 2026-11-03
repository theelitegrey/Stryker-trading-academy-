#!/usr/bin/env python3
"""Contact sheet: python3 tools/tests/chart-types-sheet.py <shotsDir> <prefix e.g. dark-1440> <out.png> id1,id2,...
Crops each shot to the plot area and tiles them 3 per row with a label."""
import sys
from PIL import Image, ImageDraw
d, prefix, out, ids = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4].split(',')
tiles = []
for i in ids:
    try: im = Image.open(f'{d}/{prefix}-{i}.png').convert('RGB')
    except Exception: continue
    w, h = im.size
    if w > 1000: im = im.crop((44, 112, 1330, 818))       # desktop plot area
    else: im = im.crop((0, int(h * .17), w, int(h * .80)))
    tiles.append((i, im))
cols = 3 if tiles and tiles[0][1].size[0] < 1000 else 2
tw = 640 if cols == 2 else 400
rows = (len(tiles) + cols - 1) // cols
th = max(int(t.size[1] * tw / t.size[0]) for _, t in tiles) + 22
sheet = Image.new('RGB', (cols * tw, rows * th), (30, 30, 30))
dr = ImageDraw.Draw(sheet)
for k, (i, t) in enumerate(tiles):
    t = t.resize((tw, int(t.size[1] * tw / t.size[0])))
    x, y = (k % cols) * tw, (k // cols) * th
    sheet.paste(t, (x, y + 22)); dr.text((x + 8, y + 5), i, fill=(255, 255, 255))
sheet.save(out); print(out, sheet.size)
