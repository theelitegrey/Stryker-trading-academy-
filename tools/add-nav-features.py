#!/usr/bin/env python3
"""Add the Features hero menu include (nav-features.css + nav-features.js) to
every page that carries the marketing nav (.nav-links). Idempotent: a page that
already has an include is left alone. Run from the repo root."""
import glob, re, sys

pages = sorted(glob.glob('*.html') + glob.glob('features/*.html'))
changed = 0
for p in pages:
    s = open(p, encoding='utf-8').read()
    if 'class="nav-links' not in s or 'nav-features.js' in s:
        continue
    css = re.search(r'^([ \t]*)<link rel="stylesheet" href="(/?)assets/style\.css\?v=(\d+)">[^\n]*\n', s, re.M)
    js = re.search(r'^([ \t]*)<script src="(/?)assets/main\.js\?v=(\d+)"[^>]*></script>', s, re.M)
    if not css or not js:
        sys.exit(f'{p}: style.css or main.js tag not found')
    ind, pre, v = css.groups()
    s = s[:css.end()] + f'{ind}<link rel="stylesheet" href="{pre}assets/nav-features.css?v={v}">\n' + s[css.end():]
    js = re.search(r'^([ \t]*)<script src="(/?)assets/main\.js\?v=(\d+)"[^>]*></script>', s, re.M)
    ind, pre, v = js.groups()
    s = s[:js.start()] + f'{ind}<script src="{pre}assets/nav-features.js?v={v}" defer></script>\n' + s[js.start():]
    open(p, 'w', encoding='utf-8').write(s)
    changed += 1
print(f'{changed} page(s) updated')
