#!/usr/bin/env python3
"""SUPERSEDED by tools/og/gen_og.py + tools/og/pages.json (every public page). Kept for reference.

Make the 1200x630 share image (og:image / twitter:image) for a /features page.

    python3 tools/og/make_feature_og.py <slug> "<Title>" <hero file> [--focus FX,FY] [--name NAME]
    python3 tools/og/make_feature_og.py --hub "<Title>" <hero1> <hero2> <hero3> <hero4> [--name NAME]

Writes assets/images/og/features-<slug>.png (or .jpg when the PNG would be over
300 KB) and prints the path, size and the head tags to paste. Layout: dark brand
background, a title band with the feature name and the Stryker emblem, and the
page's real hero capture filling the rest (about 70% of the card). Nothing else
goes on the card: no taglines, no claims, no numbers, no timing words.

--focus picks which part of the capture to keep when it is cropped to the frame
(0..1 for x and y, default 0.5,0.0 = centred, from the top).
--crop X0,Y0,X1,Y1 keeps only that part of the capture first (fractions of
its width/height), e.g. to leave out demo numbers.
--name overrides the output stem. Use it when an image is regenerated with
different content (features-<slug>-v2): chat apps cache share images by URL.
Pillow is the only dependency.
"""
import argparse
import io
import os
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT_DIR = os.path.join(ROOT, 'assets', 'images', 'og')
W, H = 1200, 630
BG = (10, 10, 12)
FRAME = (44, 44, 50)
TEXT = (245, 245, 247)
ACCENT = (3, 201, 136)
MAX_BYTES = 300 * 1024
PAD = 40
BAND = 132                       # title band height
FONT_SIZE = 78


def font(size):
    for path, var in ((os.path.join(ROOT, 'assets', 'fonts', 'archivo-latin-variable.woff2'), b'ExtraBold'),
                      ('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', None)):
        try:
            f = ImageFont.truetype(path, size)
            if var:
                f.set_variation_by_name(var)
            return f
        except Exception:
            continue
    sys.exit('No usable font found (Archivo woff2 or DejaVu Sans Bold).')


def cover(im, w, h, fx=0.5, fy=0.0):
    """Scale to cover w x h without stretching, then crop around the focus."""
    s = max(w / im.width, h / im.height)
    im = im.resize((max(w, round(im.width * s)), max(h, round(im.height * s))), Image.LANCZOS)
    x = round((im.width - w) * fx)
    y = round((im.height - h) * fy)
    return im.crop((x, y, x + w, y + h))


def framed(card, im, box, radius=18):
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    mask = Image.new('L', (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, w - 1, h - 1), radius=radius, fill=255)
    shadow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((x0, y0 + 8, x1, y1 + 8), radius=radius, fill=(0, 0, 0, 170))
    card.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(14)))
    card.paste(im, (x0, y0), mask)
    ImageDraw.Draw(card).rounded_rectangle((x0, y0, x1 - 1, y1 - 1), radius=radius, outline=FRAME, width=2)


def base(title):
    card = Image.new('RGBA', (W, H), BG + (255,))
    glow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse((-200, -260, 700, 260), fill=ACCENT + (40,))
    card.alpha_composite(glow.filter(ImageFilter.GaussianBlur(90)))
    d = ImageDraw.Draw(card)
    f = font(FONT_SIZE)
    logo = Image.open(os.path.join(ROOT, 'assets', 'images', 'logo-emblem.png')).convert('RGBA')
    ls = 88
    logo = logo.resize((ls, ls), Image.LANCZOS)
    max_w = W - 2 * PAD - ls - 30
    size = FONT_SIZE
    while d.textlength(title, font=f) > max_w and size > 48:
        size -= 4
        f = font(size)
    bb = d.textbbox((0, 0), title, font=f)
    ty = (BAND + 10 - (bb[3] - bb[1])) // 2 - bb[1]
    d.text((PAD, ty), title, font=f, fill=TEXT)
    d.rounded_rectangle((PAD, ty + bb[3] + 10, PAD + 64, ty + bb[3] + 16), radius=3, fill=ACCENT)
    card.alpha_composite(logo, (W - PAD - ls, (BAND + 10 - ls) // 2))
    return card


def save(card, stem):
    os.makedirs(OUT_DIR, exist_ok=True)
    rgb = card.convert('RGB')
    buf = io.BytesIO()
    rgb.save(buf, 'PNG', optimize=True)
    if buf.tell() <= MAX_BYTES:
        ext, data, mime = 'png', buf.getvalue(), 'image/png'
    else:
        for q in (90, 86, 82, 78, 74):
            buf = io.BytesIO()
            rgb.save(buf, 'JPEG', quality=q, optimize=True, progressive=True)
            if buf.tell() <= MAX_BYTES:
                break
        ext, data, mime = 'jpg', buf.getvalue(), 'image/jpeg'
    for old in ('png', 'jpg'):
        p = os.path.join(OUT_DIR, stem + '.' + old)
        if old != ext and os.path.exists(p):
            os.remove(p)
    path = os.path.join(OUT_DIR, stem + '.' + ext)
    with open(path, 'wb') as fh:
        fh.write(data)
    rel = os.path.relpath(path, ROOT)
    url = 'https://strykertrading.com/' + rel
    print(f'{rel}  {W}x{H}  {len(data) // 1024} KB  {mime}')
    print('Head tags (write your own alt text: describe the image, no market-state words):')
    print(f'<meta property="og:image" content="{url}">')
    print('<meta property="og:image:width" content="1200">')
    print('<meta property="og:image:height" content="630">')
    print(f'<meta property="og:image:type" content="{mime}">')
    print('<meta property="og:image:alt" content="ALT">')
    print('<meta name="twitter:card" content="summary_large_image">')
    print(f'<meta name="twitter:image" content="{url}">')
    print('<meta name="twitter:image:alt" content="ALT">')
    return path


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--hub', action='store_true', help='2x2 collage of four hero files')
    ap.add_argument('--focus', default='0.5,0.0')
    ap.add_argument('--name')
    ap.add_argument('--crop')
    ap.add_argument('first')
    ap.add_argument('rest', nargs='+')
    a = ap.parse_args()
    fx, fy = (float(v) for v in a.focus.split(','))
    if a.hub:
        title, heroes = a.first, a.rest
        if len(heroes) != 4:
            sys.exit('--hub needs exactly four hero files')
        card = base(title)
        gap = 16
        x0, y0, x1, y1 = PAD, BAND + 6, W - PAD, H - PAD + 10
        cw = (x1 - x0 - gap) // 2
        ch = (y1 - y0 - gap) // 2
        for i, hp in enumerate(heroes):
            cx = x0 + (i % 2) * (cw + gap)
            cy = y0 + (i // 2) * (ch + gap)
            im = cover(Image.open(os.path.join(ROOT, hp)).convert('RGB'), cw, ch, 0.5, 0.0)
            framed(card, im, (cx, cy, cx + cw, cy + ch), radius=14)
        save(card, a.name or 'features-hub')
    else:
        slug, (title, hero) = a.first, a.rest if len(a.rest) == 2 else sys.exit('usage: <slug> "<Title>" <hero file>')
        card = base(title)
        box = (PAD, BAND + 6, W - PAD, H - PAD + 10)
        src = Image.open(os.path.join(ROOT, hero)).convert('RGB')
        if a.crop:
            c = [float(v) for v in a.crop.split(',')]
            src = src.crop((round(c[0] * src.width), round(c[1] * src.height), round(c[2] * src.width), round(c[3] * src.height)))
        im = cover(src, box[2] - box[0], box[3] - box[1], fx, fy)
        framed(card, im, box)
        save(card, a.name or 'features-' + slug)


if __name__ == '__main__':
    main()
