#!/usr/bin/env python3
"""Deploy-time CSS minifier (first-paint work, build 337).

Why: assets/style.css is ~425 KB of source, and about a third of that is
comments. Every page loads it as a render-blocking stylesheet, so on a slow
phone connection nothing paints until the whole file has arrived. Shipping
it without comments and redundant whitespace cuts the compressed transfer
by roughly a third, and that time comes straight off first paint.

The repo keeps the commented source. Only the copy assembled for Cloudflare
in the Deploy workflow is minified (`python3 tools/min-css.py /tmp/site`).

Deliberately conservative. It only:
  - removes /* comments */ (never inside a quoted string),
  - collapses whitespace runs to one space,
  - drops whitespace next to { } ; and the last ; before a }.
It never touches spaces around ':' '>' '+' '~' or inside strings or url(),
because `a :hover` / `a:hover` and calc() operators depend on them.
Brace balance is checked before writing; any mismatch aborts the deploy.

Usage:
  python3 tools/min-css.py <dir>          minify every *.css under <dir>/assets in place
  python3 tools/min-css.py --stdout <f>   print the minified file (for tests)
"""
import os
import sys


def minify(src):
    out = []
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        if c in '"\'':                       # copy strings verbatim
            j = i + 1
            while j < n and src[j] != c:
                j += 2 if src[j] == '\\' else 1
            out.append(src[i:j + 1])
            i = j + 1
        elif src.startswith('url(', i):      # copy url(...) verbatim
            j = src.find(')', i)
            if j < 0:
                raise ValueError('unterminated url( at %d' % i)
            out.append(src[i:j + 1])
            i = j + 1
        elif src.startswith('/*', i):
            j = src.find('*/', i + 2)
            if j < 0:
                raise ValueError('unterminated comment at %d' % i)
            i = j + 2
            out.append(' ')                  # a comment can separate tokens
        elif c.isspace():
            j = i
            while j < n and src[j].isspace():
                j += 1
            out.append(' ')
            i = j
        else:
            out.append(c)
            i += 1
    s = ''.join(out)
    # second pass outside strings: tidy around { } ;
    res, i, n = [], 0, len(s)
    while i < n:
        c = s[i]
        if c in '"\'':
            j = i + 1
            while j < n and s[j] != c:
                j += 2 if s[j] == '\\' else 1
            res.append(s[i:j + 1]); i = j + 1; continue
        if s.startswith('url(', i):
            j = s.find(')', i)
            res.append(s[i:j + 1]); i = j + 1; continue
        if c == ' ':
            prev = res[-1][-1] if res and res[-1] else ''
            nxt = s[i + 1] if i + 1 < n else ''
            if prev in '{};' or nxt in '{};' or prev == '' or nxt == '':
                i += 1; continue
        if c == '}' and res and res[-1] == ';':
            res.pop()
        res.append(c)
        i += 1
    return ''.join(res).strip() + '\n'


def check(src, out):
    """Same number of { and } as the source minus those inside comments."""
    for ch in '{}':
        if out.count(ch) != src.count(ch) - _in_comments(src, ch):
            raise ValueError('min-css: %r count changed; refusing to ship' % ch)
    if out.count('{') != out.count('}'):
        raise ValueError('min-css: unbalanced braces; refusing to ship')


def _in_comments(src, ch):
    total, i = 0, 0
    while True:
        a = src.find('/*', i)
        if a < 0:
            return total
        b = src.find('*/', a + 2)
        total += src[a:b].count(ch)
        i = b + 2


def main(argv):
    if len(argv) == 3 and argv[1] == '--stdout':
        src = open(argv[2], encoding='utf-8').read()
        out = minify(src); check(src, out)
        sys.stdout.write(out)
        return 0
    if len(argv) != 2:
        print(__doc__); return 2
    root = os.path.join(argv[1], 'assets')
    for dp, _, files in os.walk(root):
        if os.sep + 'vendor' in dp:
            continue
        for f in sorted(files):
            if not f.endswith('.css'):
                continue
            p = os.path.join(dp, f)
            src = open(p, encoding='utf-8').read()
            out = minify(src)
            check(src, out)
            open(p, 'w', encoding='utf-8').write(out)
            print('min-css: %-40s %7d -> %7d bytes' % (os.path.relpath(p, argv[1]), len(src.encode()), len(out.encode())))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
