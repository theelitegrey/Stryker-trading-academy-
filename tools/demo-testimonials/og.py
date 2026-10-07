#!/usr/bin/env python3
"""Share card for /demo-testimonials: assets/images/og/demo-testimonials.png (1200x630).
Drawn with Pillow from site colours; no faces, no review text, no numbers.
Run from the repo root:  python3 tools/demo-testimonials/og.py"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'assets', 'images', 'og', 'demo-testimonials.png')
W, H = 1200, 630
BG, CARD, LINE, INK0, INK2, MINT, TEAL = (5, 5, 6), (19, 19, 22), (44, 44, 50), (238, 238, 238), (139, 147, 160), (3, 201, 136), (0, 173, 181)


def font(size, mono=False, var=b'ExtraBold'):
    name = 'jetbrains-mono-latin-variable.woff2' if mono else 'archivo-latin-variable.woff2'
    try:
        f = ImageFont.truetype(os.path.join(ROOT, 'assets', 'fonts', name), size)
        try:
            f.set_variation_by_name(b'Medium' if mono else var)
        except Exception:
            pass
        return f
    except Exception:
        return ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', size)


im = Image.new('RGB', (W, H), BG)
d = ImageDraw.Draw(im)
for x in range(0, W, 56):
    d.line([(x, 0), (x, H)], fill=(14, 14, 16))
for y in range(0, H, 56):
    d.line([(0, y), (W, y)], fill=(14, 14, 16))
glow = Image.new('RGB', (W, H), BG)
gd = ImageDraw.Draw(glow)
for r in range(420, 0, -6):
    a = int(26 * (1 - r / 420))
    gd.ellipse([980 - r, 560 - r, 980 + r, 560 + r], fill=(5, 5 + a * 2, 6 + a))
im = Image.blend(im, glow, .5)
d = ImageDraw.Draw(im)

d.text((64, 58), 'DEMO · HOMEPAGE SECTION', font=font(22, True), fill=MINT)
d.text((64, 96), 'Testimonials layouts', font=font(68), fill=INK0)
d.rectangle([64, 186, 184, 190], fill=MINT)
d.text((64, 214), 'Card grid · Marquee wall · Bento spotlight · Carousel', font=font(26, var=b'Medium'), fill=INK2)

# four mini layout cards, labelled A-D
labels = 'ABCD'
cw, ch, gap, top = 252, 270, 22, 300
for i, L in enumerate(labels):
    x = 64 + i * (cw + gap)
    d.rounded_rectangle([x, top, x + cw, top + ch], 20, fill=CARD, outline=LINE, width=2)
    d.text((x + 20, top + 14), L, font=font(54, var=b'Black'), fill=MINT)
    ix, iy = x + 20, top + 92
    if L == 'A':
        for r in range(3):
            for c in range(3):
                bx, by = ix + c * 72, iy + r * 54
                d.rounded_rectangle([bx, by, bx + 62, by + 44], 8, outline=LINE, width=2)
                d.ellipse([bx + 7, by + 7, bx + 19, by + 19], fill=MINT if (r + c) % 2 == 0 else TEAL)
    elif L == 'B':
        for r in range(3):
            off = 0 if r % 2 == 0 else -36
            for c in range(4):
                bx, by = ix + off + c * 76, iy + r * 54
                if bx + 66 > x + cw - 6 or bx < x + 6:
                    continue
                d.rounded_rectangle([bx, by, bx + 66, by + 44], 8, outline=LINE, width=2)
        d.line([(ix + 150, iy - 22), (ix + 200, iy - 22)], fill=MINT, width=3)
        d.polygon([(ix + 204, iy - 22), (ix + 194, iy - 29), (ix + 194, iy - 15)], fill=MINT)
    elif L == 'C':
        d.rounded_rectangle([ix, iy, ix + 130, iy + 100], 12, outline=MINT, width=2)
        d.text((ix + 10, iy - 14), '“', font=font(80, var=b'Black'), fill=MINT)
        d.rounded_rectangle([ix + 140, iy, ix + 212, iy + 46], 10, outline=LINE, width=2)
        d.rounded_rectangle([ix + 140, iy + 54, ix + 212, iy + 100], 10, outline=LINE, width=2)
        d.rounded_rectangle([ix, iy + 110, ix + 100, iy + 152], 10, outline=LINE, width=2)
        d.rounded_rectangle([ix + 110, iy + 110, ix + 212, iy + 152], 10, outline=LINE, width=2)
    else:
        d.rounded_rectangle([ix, iy, ix + 212, iy + 30], 8, outline=LINE, width=2)
        for c in range(3):
            d.rounded_rectangle([ix + c * 74, iy + 42, ix + c * 74 + 64, iy + 128], 10, outline=MINT if c == 0 else LINE, width=2)
        for c in range(5):
            cx = ix + 66 + c * 18
            d.ellipse([cx, iy + 144, cx + 8, iy + 152], fill=MINT if c == 0 else LINE)
im.save(OUT, optimize=True)
print('wrote', os.path.relpath(OUT, ROOT), os.path.getsize(OUT), 'bytes')
