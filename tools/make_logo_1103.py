"""Resize/pad the Owner's correct TZORO art (1014 wordmark + TZ mark). Never draws a logo.
Writes tradezoro-wordmark-1103-*, tradezoro-tzmark-1103-*, and overwrites the legacy panther files."""
import os
from PIL import Image
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'images')
P = lambda n: os.path.join(D, n)
wm = Image.open(P('tradezoro-wordmark-1014-192.png')).convert('RGBA')
tz = Image.open(P('tradezoro-tzmark-1014-144.png')).convert('RGBA')
wm = wm.crop(wm.getbbox()); tz = tz.crop(tz.getbbox())

def fit(img, w, h, fill=0.86):
    s = min(w * fill / img.width, h * fill / img.height)
    im = img.resize((max(1, round(img.width * s)), max(1, round(img.height * s))), Image.LANCZOS)
    c = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    c.alpha_composite(im, ((w - im.width) // 2, (h - im.height) // 2))
    return c

def save(im, name):
    im.save(P(name))
    if name.endswith('.png') and ('wordmark' in name or 'tzmark' in name or name.startswith('logo-header') or '-header-' in name):
        im.save(P(name[:-4] + '.webp'), quality=92) if name.startswith(('tradezoro-wordmark', 'tradezoro-tzmark')) else None

for h in (144, 192, 384):
    save(wm.resize((round(wm.width * h / wm.height), h), Image.LANCZOS), f'tradezoro-wordmark-1103-{h}.png')
for s in (200, 512, 1124):
    save(fit(tz, s, s, 0.80), f'tradezoro-tzmark-1103-{s}.png')

# legacy panther filenames, same pixel sizes, correct art
for n in ('logo-full.png', 'tradezoro-logo-full-494.png'): save(fit(wm, 925, 608, 0.90), n)
for n in ('logo-master.png', 'tradezoro-logo-master-494.png'): save(fit(wm, 1173, 771, 0.90), n)
for n in ('logo-header.png', 'tradezoro-logo-header-494.png'):
    im = fit(wm, 243, 160, 0.95); im.save(P(n)); im.save(P(n[:-4] + '.webp'), quality=92)
for n in ('logo-emblem.png', 'tradezoro-logo-emblem-494.png'): save(fit(tz, 1124, 1124, 0.80), n)
for n in ('logo-emblem-sm.png', 'tradezoro-logo-emblem-sm-494.png'): save(fit(tz, 200, 200, 0.80), n)
