#!/usr/bin/env python3
"""Regenerate src/manual/14-error-codes.md from the engine spec's error catalogue (section 10).
   python3 tools/zs-book/gen-errors.py /root/projects/stryker-notes/reports/workers/zscript/SPEC.md"""
import re, sys, os
spec = open(sys.argv[1]).read()
sec = spec[spec.index('## 10. Error catalogue'):spec.index('## 11.')]
groups, cur = [], None
for ln in sec.splitlines():
    if ln.startswith(('Lexer', 'Checker', 'Runtime')):
        cur = [re.sub(r' \(.*', '', ln).strip(), []]; groups.append(cur)
    m = re.match(r'^([EW]\d{3}) (.*)', ln)
    if m and cur: cur[1].append((m.group(1), m.group(2)))
out = ['---', 'title: Error and warning codes', 'dek: Every message the engine can give, in plain words.', '---',
       'Each message has a code, a line and column, and often a hint. Words in {braces} are filled in with your own names and numbers.', '']
for name, items in groups:
    out += ['## ' + name, '', '| Code | Meaning |', '|---|---|']
    for c, t in items:
        t = t.replace('|', '/')
        t = re.sub(r'`([^`]*)`', r'`\1`', t)
        out.append('| %s | %s |' % (c, t))
    out.append('')
dest = os.path.join(os.path.dirname(__file__), 'src/manual/14-error-codes.md')
open(dest, 'w').write('\n'.join(out))
print('wrote', dest, sum(len(g[1]) for g in groups), 'codes')
