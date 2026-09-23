#!/usr/bin/env python3
"""Sync the status table in TRACKS.md from the built chapter JSONs.

  python3 tools/tracks/status.py vp "VP-05=reviewed" "VP-06=reviewed"
Rows are '| ID | Title | level | status | words | sources |'.
Words come from build.py's counter so the numbers always match the checker.
"""
import json, os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from build import words  # noqa: E402

track = sys.argv[1]
marks = dict(a.split('=', 1) for a in sys.argv[2:])
p = os.path.join(HERE, 'TRACKS.md')
s = open(p).read()


def row(m):
    cid, title, level, status = m.group(1), m.group(2), m.group(3), m.group(4).strip()
    jp = os.path.join(HERE, track, cid + '.json')
    if not os.path.exists(jp):
        return m.group(0)
    ch = json.load(open(jp))
    w = words(ch['bodyHtml'] + ''.join(l.get('descHtml', '') for l in ch['lessons']))
    srcs = len(re.findall(r'<li[ >]', re.search(r'<h3>Sources</h3><ol[^>]*>([\s\S]*?)</ol>', ch['bodyHtml']).group(1)))
    status = marks.get(cid, status if status != 'todo' else 'drafted')
    return '| %s | %s | %s | %s | %d | %d |' % (cid, title, level, status, w, srcs)


s = re.sub(r'^\| (%s-\d\d) \| ([^|]+?) \| ([^|]+?) \| ([^|]*?) \|[^\n]*$' % track.upper(), row, s, flags=re.M)
open(p, 'w').write(s)
print('\n'.join(l for l in s.splitlines() if l.startswith('| %s-' % track.upper())))
