#!/usr/bin/env python3
"""
Pre-deploy validation for Stryker Trading Academy.
Run from the repo root:  python3 tools/check.py

Why the unversioned-asset check exists
--------------------------------------
Cache busting is done by find-replacing ?v=<n> with ?v=<n+1> across the HTML.
That only rewrites tags which ALREADY carry a version. Any asset tag that
misses the initial rollout is therefore skipped by every future bump, silently
and permanently — it will serve whatever the browser cached the first time,
forever.

That is exactly what happened to style.css on six pages: they kept serving a
months-old stylesheet, so CSS fixes appeared to "not work" on those pages
only. A bare grep for the current version number would not have caught it,
because the tag had no version to be wrong.
"""

import glob
import os
import re
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
FAILURES = []


def html_files():
    """Every shipped HTML page: the root pages plus the /features/<name> pages.

    The features/ subfolder pages load assets by root-absolute path
    (/assets/...), so the asset patterns below accept an optional leading
    slash. Before this, features/*.html was never scanned at all."""
    return sorted(glob.glob('*.html') + glob.glob('features/*.html'))


def fail(msg):
    FAILURES.append(msg)


def check_merge_markers():
    """Unresolved git conflict markers in any shipped text file."""
    pat = re.compile(r'^(<{7} |={7}$|>{7} )', re.M)
    files = html_files() + glob.glob('assets/*.js') + glob.glob('assets/*.css') + ['_headers', 'robots.txt']
    for f in files:
        if os.path.exists(f) and pat.search(open(f, encoding='utf-8', errors='replace').read()):
            fail(f'{f}: unresolved merge conflict markers')


def check_unversioned_assets():
    """Every local css/js reference must carry ?v= or it can never be busted."""
    pattern = re.compile(r'(?:href|src)="(/?assets/[^"?]+\.(?:css|js))"')
    for path in html_files():
        html = open(path).read()
        for match in pattern.finditer(html):
            fail(f'{path}: {match.group(1)} has no ?v= — it will never cache-bust')


def check_version_consistency():
    """All ?v= values across the site should match, except the v341 prop firm PDF."""
    versions = set()
    exception = 'assets/downloads/stryker-prop-firm-cheat-sheet.pdf?v=341'
    for path in html_files():
        text = open(path).read()
        for match in re.finditer(r"([^\"'<> ]+)\?v=(\d+)", text):
            url, version = match.group(1), match.group(2)
            if f'{url}?v={version}' == exception:
                continue
            versions.add(version)
    if len(versions) > 1:
        fail(f'Mixed cache versions in use: {sorted(versions)}')
    return versions.pop() if len(versions) == 1 else None


def check_module_import_versions():
    """Every ES-module import of our own assets must carry ?v=<build> from version.json.

    A module imported under two different URLs (e.g. chart-alerts.js?v=425 in one file
    and ?v=427 in another) loads TWICE as two separate instances with separate state.
    Build 427 shipped exactly that: the "+" menu opened the never-mounted copy of the
    alerts panel, so its Create button threw and did nothing. A stale ?v= on a module
    import also skips cache-busting for that module forever.
    """
    import json
    try:
        build = str(json.load(open(os.path.join(ROOT, 'assets', 'version.json')))['build'])
    except Exception as e:
        fail(f'assets/version.json unreadable: {e}')
        return
    spec = re.compile(r"""(?:\bimport\s*\(\s*|\bfrom\s*|\bimport\s+)['"](\./[\w./-]+\.m?js)(?:\?v=(\d+))?['"]""")
    seen = {}
    for path in sorted(glob.glob(os.path.join(ROOT, 'assets', '*.js'))):
        rel = os.path.relpath(path, ROOT)
        for n, line in enumerate(open(path, encoding='utf-8'), 1):
            for m in spec.finditer(line):
                mod, v = m.group(1), m.group(2)
                if v is None:
                    fail(f'{rel}:{n}: import of {mod} has no ?v= (it can never cache-bust)')
                elif v != build:
                    fail(f'{rel}:{n}: import of {mod}?v={v}, but the build is {build} '
                         f'(stale ?v= = a second module instance / stale cache)')
                seen.setdefault(mod, set()).add(v)
    for mod, vs in seen.items():
        if len(vs) > 1:
            fail(f'{mod} is imported with different query strings {sorted(x or "none" for x in vs)}')


def check_js_syntax():
    for path in sorted(glob.glob('assets/*.js')):
        result = subprocess.run(['node', '--check', path],
                                capture_output=True, text=True)
        if result.returncode != 0:
            first = result.stderr.strip().split('\n')[0]
            fail(f'{path}: JS syntax error — {first}')


def check_html_structure():
    for path in html_files():
        html = open(path).read()
        if html.count('<html') != 1 or html.count('</html>') != 1:
            fail(f'{path}: unbalanced <html> tags')
        opens = len(re.findall(r'<div\b', html))
        closes = html.count('</div>')
        if opens != closes:
            fail(f'{path}: {opens} <div> vs {closes} </div>')


def check_css_braces():
    for path in sorted(glob.glob('assets/*.css')):
        css = open(path).read()
        if css.count('{') != css.count('}'):
            fail(f"{path}: {css.count('{')} {{ vs {css.count('}')} }}")


def check_referenced_assets_exist():
    """A typo'd filename 404s silently in the browser."""
    pattern = re.compile(r'(?:href|src)="/?(assets/[^"?]+)(?:\?v=\d+)?"')
    for path in html_files():
        for match in pattern.finditer(open(path).read()):
            target = match.group(1)
            if not os.path.exists(target):
                fail(f'{path}: references {target}, which does not exist')


def check_mobile_width_guards():
    """Two CSS rules stop pages forcing the document wider than the phone.

    A page whose content cannot fit the viewport does not clip or scroll by
    default — the browser shrinks the whole page to fit, so every word on it
    renders smaller than on every other page. It looks like a font bug, which
    is why it sat unnoticed on two pages.

    Both causes were shrink-to-fit sizing that nothing had constrained:
    a stacked Smart Money row sized to a long unbroken filing descriptor, and
    a reader grid track sized to its item's min-content because a grid item
    defaults to min-width:auto. This asserts the fixes are still present. It
    is a "the rule is there" check, not a layout measurement — the browser
    suite in the working notes measures the real thing.
    """
    css = open('assets/style.css').read()
    for rule, why in [
        ('.sm-row > .sm-main{ width:100%; }',
         'Smart Money rows stack at <=640px and would size to their text'),
        ('.reader-shell > .reader-main{ min-width:0; }',
         'the reader grid track would size to its min-content'),
    ]:
        if rule not in css:
            fail(f'style.css: missing mobile width guard `{rule}` — without it, {why}')


def check_build_markers():
    """Every page's build meta must match assets/version.json.

    version-check.js compares these two to detect a browser sitting on a
    stale cached HTML document. If they drift, either every visitor reloads
    forever or nobody ever recovers — both worse than the bug it fixes.
    """
    import json
    try:
        declared = json.load(open('assets/version.json'))['build']
    except Exception as exc:
        fail(f'assets/version.json unreadable: {exc}')
        return

    for path in html_files():
        html = open(path).read()
        found = re.findall(r'<meta name="stryker-build" content="(\d+)">', html)
        if len(found) != 1:
            fail(f'{path}: expected exactly one stryker-build meta, found {len(found)}')
        elif int(found[0]) != declared:
            fail(f'{path}: build meta {found[0]} != version.json {declared}')
        if 'version-check.js' not in html:
            fail(f'{path}: does not load version-check.js')


def check_assets_changed_without_bump():
    """Warn if tracked assets were modified since the last commit that touched
    version.json.

    This has now caused two wasted debugging rounds. An edited file served
    under an unchanged ?v= is invisible: the deploy succeeds, the build turns
    green, and the browser keeps handing back the previous version. There is no
    error anywhere — the only symptom is a person saying "no difference".

    A warning rather than a failure: legitimately committing an asset and its
    version bump in separate steps is normal, and blocking that would be worse
    than the bug.
    """
    try:
        last_bump = subprocess.run(
            ['git', 'log', '-1', '--format=%H', '--', 'assets/version.json'],
            capture_output=True, text=True).stdout.strip()
        if not last_bump:
            return
        changed = subprocess.run(
            ['git', 'diff', '--name-only', last_bump + '..HEAD', '--', 'assets/'],
            capture_output=True, text=True).stdout.split()
        # Only files that still exist: a DELETED asset shows up in the diff
        # but cannot be served stale, so warning about it is noise that trains
        # people to ignore the warning.
        stale = [f for f in changed if f.endswith(('.js', '.css'))
                 and not f.endswith('version.json')
                 and os.path.exists(f)]
        if stale:
            print('WARNING — changed since the last version bump, so browsers '
                  'will serve the cached copy:')
            for f in stale:
                print('  •', f)
            print('  Bump ?v= and assets/version.json before deploying.\n')
    except Exception:
        pass   # never let a diagnostic break the deploy check


def _meta(html, attr, key):
    """Content of <meta property|name="key" content="...">, either attribute order."""
    m = re.search(r'<meta\s+%s="%s"\s+content="([^"]*)"' % (attr, re.escape(key)), html) or \
        re.search(r'<meta\s+content="([^"]*)"\s+%s="%s"' % (attr, re.escape(key)), html)
    return m.group(1) if m else None


def _image_info(path):
    """(kind, width, height) from PNG/JPEG header bytes, stdlib only."""
    with open(path, 'rb') as fh:
        data = fh.read()
    if data[:8] == b'\x89PNG\r\n\x1a\n' and data[12:16] == b'IHDR':
        return 'png', int.from_bytes(data[16:20], 'big'), int.from_bytes(data[20:24], 'big')
    if data[:2] == b'\xff\xd8':
        i = 2
        while i + 9 < len(data):
            if data[i] != 0xFF:
                i += 1
                continue
            marker = data[i + 1]
            if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
                i += 2
                continue
            seg = int.from_bytes(data[i + 2:i + 4], 'big')
            if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                return 'jpeg', int.from_bytes(data[i + 7:i + 9], 'big'), int.from_bytes(data[i + 5:i + 7], 'big')
            i += 2 + seg
        return 'jpeg', 0, 0
    return 'other', 0, 0


def check_share_images():
    """Every public page (no robots noindex) carries its OWN 1200x630 PNG/JPEG
    share image with the full og/twitter tag set, matching tools/og/pages.json
    (the table tools/og/gen_og.py renders from). No two pages share an image,
    the default og-image.png is never used, and og:title contains the card title."""
    import json
    site = 'https://strykertrading.com/'
    table_path = os.path.join(ROOT, 'tools', 'og', 'pages.json')
    with open(table_path, encoding='utf-8') as fh:
        table = {e['page']: e for e in json.load(fh)['pages']}
    pages = sorted(glob.glob(os.path.join(ROOT, '*.html')) + glob.glob(os.path.join(ROOT, 'features', '*.html')))
    seen = {}
    public = set()
    for page in pages:
        rel = os.path.relpath(page, ROOT)
        with open(page, encoding='utf-8') as fh:
            html = fh.read()
        robots = _meta(html, 'name', 'robots') or ''
        if 'noindex' in robots:
            if rel in table:
                fail(f'{rel}: is noindex but listed in tools/og/pages.json')
            continue
        public.add(rel)
        entry = table.get(rel)
        if not entry:
            fail(f'{rel}: public page missing from tools/og/pages.json (add it, run python3 tools/og/gen_og.py)')
            continue
        og = _meta(html, 'property', 'og:image')
        tw = _meta(html, 'name', 'twitter:image')
        required = {
            'og:image': og, 'twitter:image': tw,
            'og:title': _meta(html, 'property', 'og:title'),
            'twitter:title': _meta(html, 'name', 'twitter:title'),
            'og:image:width': _meta(html, 'property', 'og:image:width'),
            'og:image:height': _meta(html, 'property', 'og:image:height'),
            'og:image:alt': _meta(html, 'property', 'og:image:alt'),
            'og:image:type': _meta(html, 'property', 'og:image:type'),
            'twitter:image:alt': _meta(html, 'name', 'twitter:image:alt'),
        }
        for key, val in required.items():
            if not val:
                fail(f'{rel}: missing {key}')
        if _meta(html, 'name', 'twitter:card') != 'summary_large_image':
            fail(f'{rel}: twitter:card is not summary_large_image')
        if not og:
            continue
        t = entry['title'].lower()
        for key in ('og:title', 'twitter:title'):
            if required[key] and t not in required[key].replace('&amp;', '&').lower():
                fail(f'{rel}: {key} does not contain the card title {entry["title"]!r} from pages.json')
        if required['og:title'] != required['twitter:title']:
            fail(f'{rel}: og:title and twitter:title differ')
        for key, val in (('og:image', og), ('twitter:image', tw)):
            if val and val.split('?')[0].rsplit('/', 1)[-1] == 'og-image.png':
                fail(f'{rel}: {key} is the default og-image.png; give the page its own share image (tools/og/gen_og.py)')
        if tw and og != tw:
            fail(f'{rel}: og:image and twitter:image differ')
        if not og.startswith(site):
            fail(f'{rel}: og:image must be an absolute {site} URL')
            continue
        if '?v=' not in og:
            fail(f'{rel}: og:image needs a ?v=<build> cache-buster')
        path = og[len(site):].split('?')[0]
        if path in seen:
            fail(f'{rel}: og:image {path} is also used by {seen[path]}; every page needs its own')
        seen[path] = rel
        img = os.path.join(ROOT, path)
        if not os.path.isfile(img):
            fail(f'{rel}: og:image file not in repo: {path}')
            continue
        if os.path.getsize(img) > 300 * 1024:
            fail(f'{rel}: share image over 300 KB: {path}')
        kind, w, h = _image_info(img)
        if kind not in ('png', 'jpeg'):
            fail(f'{rel}: share image is not PNG/JPEG: {path}')
        elif (w, h) != (1200, 630):
            fail(f'{rel}: share image is {w}x{h}, needs 1200x630: {path}')
        else:
            want = 'image/png' if kind == 'png' else 'image/jpeg'
            if required['og:image:type'] and required['og:image:type'] != want:
                fail(f'{rel}: og:image:type {required["og:image:type"]} does not match the file ({want})')
            if (required['og:image:width'], required['og:image:height']) != ('1200', '630'):
                fail(f'{rel}: og:image:width/height must be 1200/630')
    for rel in sorted(set(table) - public):
        if os.path.exists(os.path.join(ROOT, rel)):
            continue
        fail(f'tools/og/pages.json lists {rel}, which does not exist')
    titles = [e['title'].lower() for e in table.values()]
    if len(titles) != len(set(titles)):
        fail('tools/og/pages.json: two pages share a card title')


def check_feature_image_frames():
    """Every screenshot <img> on a /features page sits inside a .fp-pad frame
    (Improvement 2: padding between the capture and the frame border). Logos
    and icons opt out with data-fp-nopad. Walks the tag tree with the stdlib
    HTML parser, so a class anywhere up the ancestor chain counts."""
    from html.parser import HTMLParser
    VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
            'meta', 'source', 'track', 'wbr'}

    class Walk(HTMLParser):
        def __init__(self):
            super().__init__()
            self.stack, self.bad = [], []

        def handle_starttag(self, tag, attrs):
            a = dict(attrs)
            if tag == 'img':
                if 'data-fp-nopad' in a:
                    return
                if not any('fp-pad' in c.split() for _, c in self.stack):
                    self.bad.append((self.getpos()[0], a.get('src', '?')))
                return
            if tag not in VOID:
                self.stack.append((tag, a.get('class') or ''))

        def handle_endtag(self, tag):
            for i in range(len(self.stack) - 1, -1, -1):
                if self.stack[i][0] == tag:
                    del self.stack[i:]
                    break

    for path in sorted(glob.glob(os.path.join(ROOT, 'features', '*.html'))):
        w = Walk()
        w.feed(open(path, encoding='utf-8').read())
        for line, src in w.bad:
            fail(f'{os.path.relpath(path, ROOT)}:{line}: <img src="{src}"> is not '
                 f'inside a .fp-pad image frame (add class fp-pad to its frame, or '
                 f'data-fp-nopad on a logo/icon)')


def check_nav_features_menu():
    """The Features hero menu ships on every page with the marketing nav.

    - Any page with .nav-links (marketing nav) must include nav-features.css
      and nav-features.js exactly once each. Fix a new page with
      `python3 tools/add-nav-features.py`.
    - The FEATURES list in assets/nav-features.js must match the live
      feature pages (features/*.html) one to one, each with its two thumbs."""
    for path in html_files():
        html = open(path, encoding='utf-8').read()
        if 'class="nav-links' not in html:
            continue
        for asset in ('nav-features.css', 'nav-features.js'):
            n = len(re.findall(r'(?:href|src)="/?assets/' + re.escape(asset) + r'\?v=', html))
            if n != 1:
                fail(f'{path}: marketing nav page includes assets/{asset} {n} times (need exactly 1; '
                     f'run python3 tools/add-nav-features.py)')
    js_path = os.path.join(ROOT, 'assets', 'nav-features.js')
    if not os.path.exists(js_path):
        fail('assets/nav-features.js missing')
        return
    js = open(js_path, encoding='utf-8').read()
    items = re.findall(r"\{ id: '([a-z0-9-]+)', name: '[^']+', url: '([^']+)'", js)
    ids = [i for i, _ in items]
    pages = sorted(os.path.basename(p)[:-5] for p in glob.glob(os.path.join(ROOT, 'features', '*.html')))
    if sorted(ids) != pages or len(set(ids)) != len(ids):
        fail(f'assets/nav-features.js FEATURES {sorted(ids)} does not match features/*.html {pages}')
    for fid, url in items:
        if url != '/features/' + fid:
            fail(f'assets/nav-features.js: {fid} links to {url}, expected /features/{fid}')
        for w in (360, 720) if re.search(r"id: '" + fid + r"'[^}]*big: 1", js) else (360,):
            if not os.path.exists(os.path.join(ROOT, 'assets', 'images', 'navfx', f'{fid}-{w}.webp')):
                fail(f'assets/images/navfx/{fid}-{w}.webp missing (Features menu thumb)')


def main():
    check_nav_features_menu()
    check_merge_markers()
    check_unversioned_assets()
    version = check_version_consistency()
    check_module_import_versions()
    check_js_syntax()
    check_html_structure()
    check_css_braces()
    check_referenced_assets_exist()
    check_build_markers()
    check_mobile_width_guards()
    check_assets_changed_without_bump()
    check_share_images()
    check_feature_image_frames()

    if FAILURES:
        print(f'FAILED — {len(FAILURES)} problem(s):\n')
        for f in FAILURES:
            print('  •', f)
        sys.exit(1)

    print(f'All checks passed. {len(html_files())} HTML, '
          f'{len(glob.glob("assets/*.js"))} JS, cache v={version}.')


if __name__ == '__main__':
    main()
