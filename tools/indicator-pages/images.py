#!/usr/bin/env python3
"""Indicator page images: assets/images/indicators/pages/<slug>.webp (1280x720) + <slug>-t.webp (480x270).

From the chart capture (tools/indicator-pages/captures.json says 'ok', PNG written by capture.js) when there is
one; otherwise a clean generated preview card (name, group, plan, brand mark). Never a broken image, and never
made-up chart data: the preview draws no candles or values.

    python3 tools/indicator-pages/images.py
"""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(ROOT, 'assets', 'images', 'indicators', 'pages')
W, H = 1280, 720
BG = (11, 11, 13)
MINT = (3, 201, 136)
TEAL = (0, 173, 181)


def font(size, mono=False, weight=b'Bold'):
    name = 'jetbrains-mono-latin-variable.woff2' if mono else 'archivo-latin-variable.woff2'
    try:
        f = ImageFont.truetype(os.path.join(ROOT, 'assets', 'fonts', name), size)
        try:
            f.set_variation_by_name(weight if not mono else b'Medium')
        except Exception:
            pass
        return f
    except Exception:
        return ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', size)


def cover(im, w, h):
    s = max(w / im.width, h / im.height)
    im = im.resize((max(w, round(im.width * s)), max(h, round(im.height * s))), Image.LANCZOS)
    x, y = (im.width - w) // 2, (im.height - h) // 2
    return im.crop((x, y, x + w, y + h))


def wrap(d, text, f, maxw):
    lines, cur = [], ''
    for w in text.split():
        t = (cur + ' ' + w).strip()
        if d.textlength(t, font=f) <= maxw:
            cur = t
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def preview(item):
    im = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(im)
    for x in range(0, W, 64):
        d.line((x, 0, x, H), fill=(19, 19, 23))
    for y in range(0, H, 64):
        d.line((0, y, W, y), fill=(19, 19, 23))
    glow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse((W - 760, -300, W + 200, 420), fill=MINT + (40,))
    ImageDraw.Draw(glow).ellipse((-300, H - 260, 520, H + 300), fill=TEAL + (26,))
    im = im.convert('RGBA')
    im.alpha_composite(glow.filter(ImageFilter.GaussianBlur(110)))
    d = ImageDraw.Draw(im)
    mark = Image.open(os.path.join(ROOT, 'assets', 'images', 'tradezoro-tzmark-1103-512.png')).convert('RGBA').resize((76, 76), Image.LANCZOS)
    im.alpha_composite(mark, (80, 80))
    d.text((176, 98), 'ZoroCharts indicator', font=font(30, weight=b'SemiBold'), fill=(200, 204, 210))
    f = font(76)
    lines = wrap(d, item['name'], f, W - 160)
    while len(lines) > 3:
        f = font(f.size - 6)
        lines = wrap(d, item['name'], f, W - 160)
    y = 300 - (len(lines) - 1) * f.size // 2
    for ln in lines:
        d.text((80, y), ln, font=f, fill=(242, 243, 245))
        y += int(f.size * 1.14)
    y += 28
    x = 80
    fc = font(26, mono=True)
    for t, col in ((item['group'], (150, 156, 166)), (item['plan'], MINT if item['plan'] == 'Pro' else (150, 156, 166))):
        tw = d.textlength(t, font=fc)
        d.rounded_rectangle((x, y, x + tw + 36, y + 48), radius=24, outline=col, width=2)
        d.text((x + 18, y + 9), t, font=fc, fill=col)
        x += tw + 52
    d.rounded_rectangle((80, H - 92, 152, H - 86), radius=3, fill=MINT)
    d.text((80, H - 72), 'Add it to a chart to see it on your symbol', font=font(24, weight=b'Medium'), fill=(140, 146, 156))
    return im.convert('RGB')


def main():
    sys.path.insert(0, HERE)
    import subprocess
    items = json.loads(subprocess.run(['node', '-e', "const {buildCatalog}=require('./catalog.js');process.stdout.write(JSON.stringify(buildCatalog().items.map(x=>({slug:x.slug,name:x.name,group:x.group,plan:x.plan}))))"],
                                      cwd=HERE, capture_output=True, text=True, check=True).stdout)
    caps = json.load(open(os.path.join(HERE, 'captures.json'))) if os.path.exists(os.path.join(HERE, 'captures.json')) else {}
    os.makedirs(OUT, exist_ok=True)
    n_cap = n_prev = 0
    for it in items:
        png = os.path.join(OUT, it['slug'] + '.png')
        webp = os.path.join(OUT, it['slug'] + '.webp')
        if caps.get(it['slug']) == 'ok' and not os.path.exists(png) and os.path.exists(webp):
            n_cap += 1   # converted on an earlier run (the PNG is removed after conversion)
            continue
        if caps.get(it['slug']) == 'ok' and os.path.exists(png):
            im = cover(Image.open(png).convert('RGB'), W, H)
            n_cap += 1
        else:
            im = preview(it)
            n_prev += 1
        im.save(os.path.join(OUT, it['slug'] + '.webp'), 'WEBP', quality=80, method=6)
        im.resize((480, 270), Image.LANCZOS).save(os.path.join(OUT, it['slug'] + '-t.webp'), 'WEBP', quality=76, method=6)
        if os.path.exists(png):
            os.remove(png)
    print(f'{n_cap} chart captures, {n_prev} generated previews -> {os.path.relpath(OUT, ROOT)}')


if __name__ == '__main__':
    main()
