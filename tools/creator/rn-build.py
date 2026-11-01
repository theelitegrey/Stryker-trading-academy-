#!/usr/bin/env python3
"""Turns the raw Richard NQ shots (tools/creator/rn-shots.js) plus the community's own cover and logo
into the small webp files used by features/creators.html (assets/images/creators/rn/).
Usage: rn-build.py <shots-dir> <cover-file> <logo-file>"""
import sys, os
from PIL import Image
S, COVER, LOGO = sys.argv[1:4]
OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'assets', 'images', 'creators', 'rn')
os.makedirs(OUT, exist_ok=True)
def save(im, name, w=None, q=78):
    if w and im.width > w: im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
    p = os.path.join(OUT, name); im.convert('RGB').save(p, 'WEBP', quality=q, method=6); print(name, im.size, os.path.getsize(p))
c = Image.open(COVER).convert('RGB'); h = round(c.width / 3); y = (c.height - h) // 2
save(c.crop((0, y, c.width, y + h)), 'cover.webp', 1080, 72)
l = Image.open(LOGO).convert('RGB'); s = min(l.size); y = (l.height - s) // 2
save(l.crop((0, y, s, y + s)), 'avatar.webp', 256, 80)
for t in ('dark', 'light'):
    k = t[0]
    save(Image.open(f'{S}/head-{t}.png'), f'head-{k}.webp', 1200)
    save(Image.open(f'{S}/head-{t}-m.png'), f'head-m-{k}.webp', 720)
    save(Image.open(f'{S}/about-{t}.png'), f'about-{k}.webp', 640)
    save(Image.open(f'{S}/plan-{t}.png'), f'plan-{k}.webp', 429)
    for i in (1, 2, 3): save(Image.open(f'{S}/ind{i}-{t}.png'), f'ind{i}-{k}.webp', 640)
    save(Image.open(f'{S}/curr-{t}.png'), f'curr-{k}.webp', 640)
    save(Image.open(f'{S}/chead-{t}.png'), f'chead-{k}.webp', 640)
