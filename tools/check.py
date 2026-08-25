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

FAILURES = []


def fail(msg):
    FAILURES.append(msg)


def check_unversioned_assets():
    """Every local css/js reference must carry ?v= or it can never be busted."""
    pattern = re.compile(r'(?:href|src)="(assets/[^"?]+\.(?:css|js))"')
    for path in sorted(glob.glob('*.html')):
        html = open(path).read()
        for match in pattern.finditer(html):
            fail(f'{path}: {match.group(1)} has no ?v= — it will never cache-bust')


def check_version_consistency():
    """All ?v= values across the site should be the same number."""
    versions = set()
    for path in sorted(glob.glob('*.html')):
        versions.update(re.findall(r'\?v=(\d+)', open(path).read()))
    if len(versions) > 1:
        fail(f'Mixed cache versions in use: {sorted(versions)}')
    return versions.pop() if len(versions) == 1 else None


def check_js_syntax():
    for path in sorted(glob.glob('assets/*.js')):
        result = subprocess.run(['node', '--check', path],
                                capture_output=True, text=True)
        if result.returncode != 0:
            first = result.stderr.strip().split('\n')[0]
            fail(f'{path}: JS syntax error — {first}')


def check_html_structure():
    for path in sorted(glob.glob('*.html')):
        html = open(path).read()
        if html.count('<html') != 1 or html.count('</html>') != 1:
            fail(f'{path}: unbalanced <html> tags')
        opens = len(re.findall(r'<div\b', html))
        closes = html.count('</div>')
        if opens != closes:
            fail(f'{path}: {opens} <div> vs {closes} </div>')


def check_css_braces():
    css = open('assets/style.css').read()
    if css.count('{') != css.count('}'):
        fail(f"style.css: {css.count('{')} {{ vs {css.count('}')} }}")


def check_referenced_assets_exist():
    """A typo'd filename 404s silently in the browser."""
    pattern = re.compile(r'(?:href|src)="(assets/[^"?]+)(?:\?v=\d+)?"')
    for path in sorted(glob.glob('*.html')):
        for match in pattern.finditer(open(path).read()):
            target = match.group(1)
            if not os.path.exists(target):
                fail(f'{path}: references {target}, which does not exist')


def main():
    check_unversioned_assets()
    version = check_version_consistency()
    check_js_syntax()
    check_html_structure()
    check_css_braces()
    check_referenced_assets_exist()

    if FAILURES:
        print(f'FAILED — {len(FAILURES)} problem(s):\n')
        for f in FAILURES:
            print('  •', f)
        sys.exit(1)

    print(f'All checks passed. {len(glob.glob("*.html"))} HTML, '
          f'{len(glob.glob("assets/*.js"))} JS, cache v={version}.')


if __name__ == '__main__':
    main()
