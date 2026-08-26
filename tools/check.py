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

    for path in sorted(glob.glob('*.html')):
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
        stale = [f for f in changed if f.endswith(('.js', '.css'))
                 and not f.endswith('version.json')]
        if stale:
            print('WARNING — changed since the last version bump, so browsers '
                  'will serve the cached copy:')
            for f in stale:
                print('  •', f)
            print('  Bump ?v= and assets/version.json before deploying.\n')
    except Exception:
        pass   # never let a diagnostic break the deploy check


def main():
    check_unversioned_assets()
    version = check_version_consistency()
    check_js_syntax()
    check_html_structure()
    check_css_braces()
    check_referenced_assets_exist()
    check_build_markers()
    check_assets_changed_without_bump()

    if FAILURES:
        print(f'FAILED — {len(FAILURES)} problem(s):\n')
        for f in FAILURES:
            print('  •', f)
        sys.exit(1)

    print(f'All checks passed. {len(glob.glob("*.html"))} HTML, '
          f'{len(glob.glob("assets/*.js"))} JS, cache v={version}.')


if __name__ == '__main__':
    main()
