#!/usr/bin/env python3
"""Build and validate specialist-track chapters.

  python3 tools/tracks/build.py vp          # run every tools/tracks/vp/src/*.py, then validate
  python3 tools/tracks/build.py vp --check  # validate the JSON only

Each src/<ID>.py writes tools/tracks/<track>/<ID>.json in the core chapter
schema (the same shape as CHAPTERS_SEED entries in assets/chapters-data.js):
  num, title, level, dur, video, minRole, track, lessons[{title, desc, descHtml}],
  bodyHtml, paragraphs[]
The validator enforces the house rules the content gate checks by hand.
"""
import json, os, re, subprocess, sys, glob
from xml.etree import ElementTree as ET

HERE = os.path.dirname(os.path.abspath(__file__))
LEVELS = {'foundation', 'intermediate', 'advanced'}
BANNED = [r'\bguarantee', r'\bhigh[- ]probability\b', r'\bstatistically\b', r'\bwin[- ]rate\b',
          r'\bvideo\b', r'\brecording\b', r'\bwatch (the|this) (video|clip|lesson|recording)', r'\binstitutions? (always|never)\b']
FORBIDDEN_MARKUP = [r'<script', r'<style', r'<iframe', r'\son[a-z]+\s*=', r'javascript:', r'<image\b', r'xlink:href']


def words(h):
    h = re.sub(r'<svg[\s\S]*?</svg>', ' ', h or '')
    h = re.sub(r'<[^>]+>', ' ', h)
    return len([w for w in re.split(r'\s+', h) if w])


def check(track):
    out = []; bad = 0
    for p in sorted(glob.glob(os.path.join(HERE, track, '*.json'))):
        ch = json.load(open(p))
        errs = []
        for k in ('num', 'title', 'level', 'dur', 'lessons', 'bodyHtml', 'paragraphs'):
            if k not in ch: errs.append('missing ' + k)
        if ch.get('level') not in LEVELS: errs.append('bad level')
        if os.path.basename(p)[:-5] != ch.get('num'): errs.append('file name != num')
        body = ch.get('bodyHtml', '')
        allhtml = body + ''.join(l.get('descHtml', '') for l in ch.get('lessons', []))
        for pat in FORBIDDEN_MARKUP:
            if re.search(pat, allhtml, re.I): errs.append('forbidden markup ' + pat)
        text = re.sub(r'<[^>]+>', ' ', re.sub(r'<svg[\s\S]*?</svg>', ' ', allhtml))
        for pat in BANNED:
            for m in re.finditer(pat, text, re.I):
                ctx = text[max(0, m.start() - 60):m.end() + 60].replace('\n', ' ')
                if not re.search(r'(no|not|never|isn.t|aren.t|don.t|without|avoid|cannot|can.t)\b', ctx, re.I):
                    errs.append('check wording: ...%s...' % ctx.strip())
        svgs = re.findall(r'<svg[\s\S]*?</svg>', body)
        for s in svgs:
            try: ET.fromstring(s)
            except ET.ParseError as e: errs.append('bad svg: %s' % e)
        for m in re.finditer(r'font-size="(\d+(?:\.\d+)?)"', ''.join(svgs)):
            if float(m.group(1)) < 13: errs.append('svg font < 13'); break
        if '%%' in allhtml: errs.append('literal %% in text (format escape left in)')
        if re.search(r'&amp;(?:[a-z]+|#\d+);', allhtml): errs.append('double-escaped entity (shows as literal text)')
        if 'Illustrative' not in body and 'illustrative' not in body: errs.append('no illustrative label')
        if 'Education only. Not financial advice.' not in body: errs.append('no disclaimer')
        srcs = re.search(r'<h3>Sources</h3><ol[^>]*>([\s\S]*?)</ol>', body)
        nsrc = len(re.findall(r'<li[ >]', srcs.group(1))) if srcs else 0
        if nsrc < 3: errs.append('fewer than 3 sources')
        if 'Self-check quiz' not in body: errs.append('no quiz')
        if not re.search(r'<h3>(Practice|Exercises|Practice exercises)', body): errs.append('no practice section')
        if len(ch.get('lessons', [])) < 4: errs.append('fewer than 4 lessons')
        for l in ch.get('lessons', []):
            if not (l.get('title') and l.get('desc') and l.get('descHtml')): errs.append('lesson missing fields')
        wc = words(body) + sum(words(l.get('descHtml', '')) for l in ch.get('lessons', []))
        if not 2000 <= wc <= 3600: errs.append('word count %d outside 2000-3500' % wc)
        out.append((ch.get('num'), ch.get('title'), wc, nsrc, len(svgs), errs))
        bad += bool(errs)
    for num, title, wc, ns, nv, errs in out:
        print('%-6s %5d words %3d sources %2d figures  %s' % (num, wc, ns, nv, title))
        for e in errs: print('        ! ' + e)
    print('%d chapters, %d with problems' % (len(out), bad))
    return bad == 0


if __name__ == '__main__':
    track = sys.argv[1]
    if '--check' not in sys.argv:
        for s in sorted(glob.glob(os.path.join(HERE, track, 'src', '*.py'))):
            r = subprocess.run([sys.executable, s], cwd=os.path.dirname(HERE), capture_output=True, text=True)
            if r.returncode:
                print('FAILED', s, r.stderr[-2000:]); sys.exit(1)
    sys.exit(0 if check(track) else 1)
