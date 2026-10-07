#!/usr/bin/env python3
"""Stryker Trading Academy: generator for the unlisted /demo-curriculum page.

Owner order 2026-10-07: "now create bento design inspired for curriculum
section on homepage, show me 4 variations". Four bento layouts of the
homepage CURRICULUM section (index.html#curriculum), stacked on one page
with a sticky A/B/C/D switcher. The homepage itself is not touched.

Every chapter number, title, level, lesson count and summary comes from
assets/chapters-index.js (CHAPTERS_SEED, itself generated from
tools/content/chapters-data.js + tools/tracks/*), and the two track names
come from assets/chapters-store.js (TRACKS). The section heading and intro
are read from index.html#curriculum. "Chapters 1-10 free" is the Free
plan's chapterAccess ("1-10", see assets/pricing-hero.js); specialist-track
chapters are always Pro (assets/courses.js unlockLabel). Nothing is retyped.

    python3 tools/demo-curriculum/gen.py      writes demo-curriculum.html

Behaviour: assets/demo-curriculum.js. Styles: assets/demo-curriculum.css.
"""
import html
import json
import os
import re
import subprocess

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
FREE_MAX = 10  # Free plan chapterAccess "1-10" (core curriculum only)


def esc(s):
    return html.escape(str(s), quote=True)


def load():
    js = r"""
const fs=require('fs'),vm=require('vm');const c={};vm.createContext(c);
vm.runInContext(fs.readFileSync('assets/chapters-index.js','utf8')+';this.S=CHAPTERS_SEED;',c);
const st=fs.readFileSync('assets/chapters-store.js','utf8');
const m=st.match(/const TRACKS = (\[[\s\S]*?\n\]);/);
const t={};vm.createContext(t);vm.runInContext('this.T='+m[1].replace(/\/\/.*$/mg,''),t);
process.stdout.write(JSON.stringify({S:c.S,T:t.T}));
"""
    out = subprocess.run(['node', '-e', js], cwd=ROOT, check=True, capture_output=True, text=True).stdout
    d = json.loads(out)
    return d['S'], d['T']


def summary(text, limit=150):
    text = re.sub(r'\s+', ' ', text or '').strip()
    m = re.match(r'(.{40,}?[.!?])(\s|$)', text)
    s = m.group(1) if m else text
    if len(s) > limit:
        s = s[:limit].rsplit(' ', 1)[0].rstrip(',;:—-') + '…'
    return s


CH, TRACKS = load()
BY = {c['num']: c for c in CH}
CORE = [c for c in CH if not c.get('track')]
TR = {t['id']: [c for c in CH if c.get('track') == t['id']] for t in TRACKS}
TNAME = {t['id']: t['name'] for t in TRACKS}
TOTAL = len(CH)
LEV = {k: [c for c in CORE if c['level'] == k] for k in ('foundation', 'intermediate', 'advanced')}
assert TOTAL == 64 and len(CORE) == 42, (TOTAL, len(CORE))


def is_free(c):
    return not c.get('track') and int(c['num']) <= FREE_MAX


def rng(chs):
    return chs[0]['num'] + '–' + chs[-1]['num']


idx = open(os.path.join(ROOT, 'index.html'), encoding='utf8').read()
sec = idx[idx.index('<section class="container" id="curriculum">'):]
sec = sec[:sec.index('</section>')]
EYEBROW = re.search(r'<span class="eyebrow">(.*?)</span>', sec).group(1)
H2 = re.search(r'<h2>(.*?)</h2>', sec).group(1)
INTRO = re.search(r'<div class="section-head reveal">.*?<p>(.*?)</p>', sec, re.S).group(1)
BROWSE = re.search(r'<a href="(courses)" class="btn btn-ghost">', sec).group(1)
BUILD = json.load(open(os.path.join(ROOT, 'assets', 'version.json')))['build']

LOCK = '<svg class="dc-lock" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="2" fill="currentColor"/><path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>'
CHECK = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'


def head(vid):
    return (f'<div class="dp-head">\n  <span class="eyebrow">{EYEBROW}</span>\n'
            f'  <h2 id="{vid}-h">{H2}</h2>\n  <p>{INTRO}</p>\n</div>\n')


def cta(extra=''):
    return (f'<div class="dc-cta{extra}">'
            f'<a class="btn btn-primary" href="signup">Start free</a>'
            f'<a class="btn btn-ghost" href="{BROWSE}">Browse chapters</a>'
            f'<p class="dc-note">Chapters 1–{FREE_MAX} free with a free account. No card required. Education only. Not financial advice.</p></div>\n')


def label(letter, name, idea):
    return (f'<div class="dp-label"><span class="dp-letter" aria-hidden="true">{letter}</span><div>'
            f'<h2 class="dp-name" id="v{letter.lower()}-lbl">Variation {letter} · {esc(name)}</h2><p>{esc(idea)}</p></div></div>\n')


def wrap(letter, name, idea, body):
    return (f'<section class="dp-var v{letter.lower()}" id="var-{letter}" aria-labelledby="v{letter.lower()}-lbl">\n'
            + label(letter, name, idea) + '<div class="dp-sec">\n' + head('v' + letter.lower()) + body + '</div>\n</section>\n')


def ring(n, total=TOTAL):
    # share of the whole curriculum, drawn as an arc (r=26, circumference 163.4)
    c = 163.36
    on = c * n / total
    return (f'<svg class="ca-ring" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="26" class="ca-ring-bg"/>'
            f'<circle cx="32" cy="32" r="26" class="ca-ring-on" stroke-dasharray="{on:.1f} {c:.1f}" transform="rotate(-90 32 32)"/></svg>')


# ===================================================================== A
def var_a():
    groups = [
        ('foundation', 'Foundation', 'Core · Level 1', LEV['foundation'], 'ca-f'),
        ('intermediate', 'Intermediate', 'Core · Level 2', LEV['intermediate'], 'ca-i'),
        ('advanced', 'Advanced', 'Core · Level 3', LEV['advanced'], 'ca-a'),
        ('vp', TNAME['vp'], 'Specialist track', TR['vp'], 'ca-vp'),
        ('pf', TNAME['pf'], 'Specialist track', TR['pf'], 'ca-pf'),
    ]
    tiles = []
    for gid, name, kind, chs, cls in groups:
        nfree = sum(1 for c in chs if is_free(c))
        if nfree == len(chs):
            badge = '<span class="dc-badge dc-free">All free</span>'
        elif nfree:
            fr = [c for c in chs if is_free(c)]
            badge = f'<span class="dc-badge dc-free">{rng(fr)} free</span>'
        else:
            badge = f'<span class="dc-badge dc-pro">{LOCK}Pro</span>'
        top3 = ''.join(f'<li{" class=ca-x" if k >= 3 else ""}><span>{esc(c["num"])}</span>{esc(c["title"])}</li>' for k, c in enumerate(chs[:8 if gid == 'advanced' else 3]))
        full = ''.join(
            f'<li class="{"is-free" if is_free(c) else ""}"><span>{esc(c["num"])}</span><em>{esc(c["title"])}</em>'
            f'{"<b>Free</b>" if is_free(c) else LOCK}</li>' for c in chs)
        lessons = sum(len(c.get('lessons') or []) for c in chs)
        tiles.append(f'''  <article class="ca-tile {cls}" data-g="{gid}">
    <div class="ca-glow" aria-hidden="true"></div>
    <div class="ca-top"><span class="dp-k">{esc(kind)}</span>{badge}</div>
    <div class="ca-mid"><b class="ca-big" data-count="{len(chs)}">{len(chs)}</b><span class="ca-unit">chapters<br><small>{esc(rng(chs))}</small></span>
      <span class="ca-ringw">{ring(len(chs))}<i>{len(chs)}/{TOTAL}</i></span></div>
    <h3>{esc(name)}</h3>
    <ol class="ca-top3">{top3}</ol>
    <button type="button" class="ca-more" aria-expanded="false" aria-controls="ca-list-{gid}"><span>All {len(chs)} chapters</span><i aria-hidden="true"></i></button>
    <div class="ca-list" id="ca-list-{gid}" hidden><p class="ca-lessons">{lessons} lessons across these {len(chs)} chapters.</p><ol>{full}</ol></div>
  </article>''')
    hub = f'''  <article class="ca-tile ca-hub">
    <span class="dp-k">The whole curriculum</span>
    <b class="ca-hub-big"><span data-count="{TOTAL}">{TOTAL}</span><small>chapters</small></b>
    <p>3 levels · {len(CORE)} core chapters in order · 2 specialist tracks</p>
    <a class="ca-hub-go" href="chapter?ch=01">Chapter 01 is free <i aria-hidden="true">→</i></a>
  </article>'''
    body = '<div class="ca-grid">\n' + tiles[2] + '\n' + hub + '\n' + tiles[0] + '\n' + tiles[1] + '\n' + tiles[3] + '\n' + tiles[4] + '\n</div>\n' + cta()
    return wrap('A', 'Track bento', 'One tile per level and track: giant chapter count, its share of the 64 as a ring, the first three titles. Tap "All chapters" to open the full list in place.', body)


# ===================================================================== B
# Each stage: name, chapter numbers (core) or track ids, visual key, caption.
STAGES = [
    ('Foundations', [f'{i:02d}' for i in range(1, 8)], 'candle', 'Candle anatomy'),
    ('Structure & PD arrays', ['08', '09', '10', '11'], 'fvg', 'Fair value gap'),
    ('Liquidity & timing', ['12', '13', '14', '15', '16'], 'sweep', 'Sweep of equal lows'),
    ('SMT & refinement', ['17', '18', '19', '20', '21', '22', '26', '27', '28', '29'], 'smt', 'SMT divergence'),
    ('Price delivery', ['23', '24', '25', '30', '31', '32', '33'], 'po3', 'Power of three'),
    ('Playbook, risk & funded', ['34', '35', '36', '37', '38', '39', '40', '41', '42'], 'risk', 'Risk box'),
    ('Specialist tracks', [c['num'] for c in TR['vp']] + [c['num'] for c in TR['pf']], 'profile', 'Volume profile'),
]


def viz(kind):
    g, r, m = 'var(--bull)', 'var(--bear)', 'var(--ink-3)'
    def cdl(x, o, c, h, l, w=10):
        col = g if c < o else r  # y grows downward: close above open = bullish
        top, bot = min(o, c), max(o, c)
        return (f'<line x1="{x}" y1="{h}" x2="{x}" y2="{l}" stroke="{col}" stroke-width="1.4"/>'
                f'<rect x="{x - w / 2}" y="{top}" width="{w}" height="{max(bot - top, 1.5)}" rx="1.5" fill="{col}"/>')
    if kind == 'candle':
        s = (cdl(46, 62, 34, 18, 78, 16) + cdl(104, 30, 58, 16, 74, 16)
             + f'<text x="46" y="94" class="cb-t" text-anchor="middle">bull</text><text x="104" y="94" class="cb-t" text-anchor="middle">bear</text>'
             + f'<line x1="58" y1="18" x2="72" y2="18" stroke="{m}" stroke-dasharray="2 2"/><text x="76" y="21" class="cb-t">high</text>'
             + f'<line x1="58" y1="78" x2="72" y2="78" stroke="{m}" stroke-dasharray="2 2"/><text x="76" y="81" class="cb-t">low</text>')
    elif kind == 'fvg':
        # bullish FVG: candle1 high (y=60) below candle3 low (y=40) -> gap 40..60
        s = (f'<rect class="cb-zone" x="20" y="40" width="130" height="20" fill="var(--gold)" opacity=".16"/>'
             + f'<line x1="20" y1="40" x2="150" y2="40" stroke="var(--gold)" stroke-dasharray="3 3" opacity=".7"/>'
             + f'<line x1="20" y1="60" x2="150" y2="60" stroke="var(--gold)" stroke-dasharray="3 3" opacity=".7"/>'
             + cdl(40, 78, 66, 60, 86) + cdl(62, 70, 30, 26, 74) + cdl(84, 32, 22, 14, 40)
             + f'<text x="100" y="54" class="cb-t cb-tg">FVG</text>')
    elif kind == 'sweep':
        s = (f'<line x1="10" y1="66" x2="150" y2="66" stroke="var(--teal)" stroke-dasharray="3 3"/>'
             + f'<text x="10" y="97" class="cb-t" fill="var(--teal)">equal lows · SSL swept</text>'
             + cdl(24, 50, 60, 44, 66, 9) + cdl(44, 58, 46, 40, 66, 9) + cdl(64, 48, 58, 42, 63, 9)
             + cdl(86, 56, 62, 50, 82, 9) + cdl(108, 60, 36, 30, 64, 9) + cdl(130, 36, 20, 14, 40, 9)
             + f'<circle cx="86" cy="82" r="6" fill="none" stroke="var(--gold)" class="cb-pulse"/>')
    elif kind == 'smt':
        s = (f'<polyline points="10,40 40,58 70,30 100,50 130,66" fill="none" stroke="var(--teal)" stroke-width="2"/>'
             + f'<polyline points="10,74 40,90 70,66 100,80 130,82" fill="none" stroke="var(--gold)" stroke-width="2"/>'
             + f'<line x1="40" y1="58" x2="130" y2="66" stroke="var(--teal)" stroke-dasharray="2 3"/>'
             + f'<line x1="40" y1="90" x2="130" y2="82" stroke="var(--gold)" stroke-dasharray="2 3"/>'
             + f'<text x="134" y="64" class="cb-t" fill="var(--teal)">LL</text><text x="134" y="84" class="cb-t" fill="var(--gold)">HL</text>')
    elif kind == 'po3':
        s = (f'<rect x="10" y="44" width="56" height="20" fill="var(--teal)" opacity=".10"/>'
             + f'<polyline points="10,54 20,48 30,58 40,47 50,57 62,52 72,76 84,60 100,36 116,40 132,20 150,14" fill="none" stroke="var(--ink-1)" stroke-width="2" stroke-linejoin="round"/>'
             + f'<text x="14" y="40" class="cb-t">A</text><text x="70" y="90" class="cb-t">M</text><text x="128" y="34" class="cb-t">D</text>')
    elif kind == 'risk':
        s = (f'<rect x="60" y="22" width="80" height="34" fill="var(--bull)" opacity=".16"/>'
             + f'<rect x="60" y="56" width="80" height="17" fill="var(--bear)" opacity=".16"/>'
             + f'<line x1="60" y1="56" x2="140" y2="56" stroke="var(--ink-2)"/>'
             + f'<text x="66" y="34" class="cb-t">target · 2R</text><text x="66" y="68" class="cb-t">stop · 1R</text>'
             + f'<polyline points="10,70 24,60 36,66 50,56 60,56" fill="none" stroke="var(--ink-1)" stroke-width="2"/>')
    else:  # volume profile, horizontal bars; POC = longest
        bars = [18, 30, 46, 64, 82, 58, 40, 26, 14]
        s = ''.join(f'<rect x="20" y="{12 + i * 8.6:.1f}" width="{b}" height="6.4" rx="1.5" fill="{"var(--gold)" if b == 82 else "var(--ink-3)"}" opacity="{1 if b == 82 else .55}" class="cb-bar" style="--d:{i * 40}ms"/>' for i, b in enumerate(bars))
        s += f'<line x1="18" y1="49.6" x2="150" y2="49.6" stroke="var(--gold)" stroke-dasharray="3 3"/><text x="110" y="46" class="cb-t cb-tg">POC</text>'
    return f'<svg class="cb-viz" viewBox="0 0 160 100" aria-hidden="true" focusable="false">{s}</svg>'


def var_b():
    # the path: a rising line over chapter 1..64 with one node per stage
    pos, acc = [], 0
    for _, nums, _, _ in STAGES:
        acc += len(nums)
        pos.append(acc)
    def route_svg(W, H, cls, step, fs):
        base = H - 26
        pts = [(16, base)]
        for i, p in enumerate(pos):
            x = 16 + (W - 32) * p / TOTAL
            y = base - (i + 1) * step - (step * .4 if i % 2 else 0)
            pts.append((round(x, 1), round(y, 1)))
        path = 'M' + ' L'.join(f'{x},{y}' for x, y in pts)
        nodes = ''.join(f'<g class="cb-node" data-i="{i}" transform="translate({x} {y})"><circle r="9" class="cb-node-ring"/><circle r="4.5" class="cb-node-dot"/>'
                        f'<text y="-15" text-anchor="middle" class="cb-node-t" font-size="{fs}">{i + 1}</text></g>' for i, (x, y) in enumerate(pts[1:]))
        fw = (W - 32) * FREE_MAX / TOTAL
        ticks = (f'<text x="16" y="{H - 4}" class="cb-axis" font-size="{fs - 1}">ch. 1</text><text x="{W - 16}" y="{H - 4}" text-anchor="end" class="cb-axis" font-size="{fs - 1}">ch. {TOTAL}</text>'
                 f'<rect x="16" y="{H - 20}" width="{fw:.1f}" height="3" rx="1.5" fill="var(--gold)"/>'
                 f'<text x="{16 + fw + 6:.1f}" y="{H - 16}" class="cb-axis cb-tg" font-size="{fs - 1}">1–{FREE_MAX} free</text>')
        return (f'<svg class="cb-line {cls}" viewBox="0 0 {W} {H}" aria-hidden="true" focusable="false">'
                f'<path d="{path}" class="cb-trail"/><path d="{path}" class="cb-trail-hi cb-route"/>{ticks}{nodes}'
                f'<circle r="5" class="cb-runner" transform="translate({pts[-1][0]} {pts[-1][1]})"/></svg>')
    strip = (f'<div class="cb-tile cb-path"><div class="cb-path-h"><span class="dp-k">The path · chapter 1 to {TOTAL}</span>'
             f'<span class="dp-cap">Illustrative drawing, not market data</span></div>'
             + route_svg(1000, 150, 'cb-line-d', 13, 12) + route_svg(360, 170, 'cb-line-m', 15, 11) + '</div>')
    tiles = []
    sizes = ['cb-l', 'cb-m', 'cb-m', 'cb-w', 'cb-w', 'cb-w', 'cb-w3']
    for i, (name, nums, vk, cap) in enumerate(STAGES):
        chs = [BY[n] for n in nums]
        free = [c for c in chs if is_free(c)]
        chip = (f'<span class="dc-badge dc-free">{rng(free)} free</span>' if free and len(free) < len(chs)
                else '<span class="dc-badge dc-free">Free</span>' if free else f'<span class="dc-badge dc-pro">{LOCK}Pro</span>')
        if vk == 'profile':
            where = f'{TNAME["vp"]} ({len(TR["vp"])}) · {TNAME["pf"]} ({len(TR["pf"])})'
        else:
            where = 'Ch. ' + ', '.join(re.sub(r'^(\d+)–\1$', r'\1', r) for r in _runs(nums))
        picks = chs if i == 0 else chs[:3] if i != 6 else [TR['vp'][0], TR['vp'][2], TR['pf'][2]]
        li = ''.join(f'<li><span>{esc(c["num"])}</span>{esc(c["title"])}</li>' for c in picks)
        tiles.append(f'''  <article class="cb-tile cb-stage {sizes[i]}" data-i="{i}" tabindex="0" aria-label="Stage {i + 1}: {esc(name)}, {len(chs)} chapters">
    <div class="cb-st-top"><span class="cb-step">{i + 1:02d}</span><div><h3>{esc(name)}</h3><span class="cb-where">{esc(where)}</span></div>{chip}</div>
    <figure class="cb-fig">{viz(vk)}<figcaption>{esc(cap)} · Illustrative</figcaption></figure>
    <div class="cb-bot"><b class="cb-n">{len(chs)}</b><span>chapters</span></div>
    <ul class="cb-picks">{li}</ul>
  </article>''')
    end = f'''  <article class="cb-tile cb-end">
    <span class="dp-k">Stage {len(STAGES)} done</span>
    <h3>Ch. 42 is the capstone: <em>{esc(BY["42"]["title"])}</em>.</h3>
    <a class="btn btn-primary" href="signup">Start free</a>
  </article>'''
    body = '<div class="cb-grid">\n' + strip + '\n' + '\n'.join(tiles) + '\n' + end + '\n</div>\n' + cta()
    return wrap('B', 'Journey bento', 'The 64 chapters as one route: seven stage tiles of mixed size, each with a small textbook drawing of its key idea, linked by a rising path from chapter 1 to 64.', body)


def _runs(nums):
    ints = [int(n) for n in nums]
    out, s, p = [], ints[0], ints[0]
    for n in ints[1:]:
        if n == p + 1:
            p = n
            continue
        out.append(f'{s:02d}–{p:02d}')
        s = p = n
    out.append(f'{s:02d}–{p:02d}')
    return out


# ===================================================================== C
CUT = 22  # cards shown before "Show all" when the mosaic is collapsed (JS only)


def var_c():
    cells = [f'''  <div class="cc-hero">
    <span class="dp-k">Curriculum</span>
    <h3><b>{TOTAL} chapters.</b> Start with {FREE_MAX} free.</h3>
    <p>Tap any card to read what it covers. Mint cards open with a free account.</p>
    <a class="btn btn-primary" href="signup">Start free</a>
  </div>''']
    def card(c, i):
        fr = is_free(c)
        n = len(c.get('lessons') or [])
        wide = ' cc-w' if len(c['title']) > 40 else ''
        st = (f'<b class="cc-st">Free</b>' if fr else f'<b class="cc-st cc-lockd">{LOCK}Pro</b>')
        x = ' cc-x' if i >= CUT else ''
        return (f'<button type="button" class="cc-card{" cc-free" if fr else ""}{wide}{x}" aria-pressed="false" data-i="{i}">'
                f'<span class="cc-in"><span class="cc-face cc-front"><span class="cc-num">{esc(c["num"])}</span>{st}<span class="cc-title">{esc(c["title"])}</span></span>'
                f'<span class="cc-face cc-back"><span class="cc-num">{esc(c["num"])} · {n} lessons</span><span class="cc-sum">{esc(summary(c.get("preview"), 118))}</span></span></span></button>')
    groups, i = [], 0
    def grp(title, sub, chs, first=False):
        nonlocal i
        cards = []
        for c in chs:
            cards.append('  ' + card(c, i)); i += 1
        hide = ' cc-x' if all('cc-x' in x for x in cards) else ''
        hero = cells[0] + '\n' if first else ''
        return (f'<div class="cc-grp{hide}"><div class="cc-div"><b>{title}</b><span>{sub}</span></div>\n<div class="cc-cells">\n'
                + hero + '\n'.join(cards) + '\n</div></div>')
    for k, (lev, lname) in enumerate((('foundation', 'Foundation'), ('intermediate', 'Intermediate'), ('advanced', 'Advanced'))):
        chs = LEV[lev]
        groups.append(grp(lname, f'Ch. {rng(chs)} · {len(chs)}', chs, first=(k == 0)))
    for t in TRACKS:
        chs = TR[t['id']]
        groups.append(grp(esc(t['name']), f'Track · {len(chs)}', chs))
    cells = groups
    body = ('<div class="cc-legend" aria-hidden="true"><span><i class="cc-sw cc-sw-f"></i>Free with an account</span><span><i class="cc-sw"></i>Pro</span></div>\n'
            '<div class="cc-mosaic" id="cc-mosaic">\n' + '\n'.join(cells) + '\n</div>\n'
            f'<div class="cc-more-w"><button type="button" class="btn btn-ghost cc-more" aria-expanded="false" aria-controls="cc-mosaic">Show all {TOTAL} chapters</button></div>\n' + cta())
    return wrap('C', 'Chapter-card mosaic', f'All {TOTAL} real chapter cards in one dense mosaic: free chapters in mint, Pro ones with a soft lock. Tap a card to flip it to its one-line summary.', body)


# ===================================================================== D
def var_d():
    ch1 = BY['01']
    learn = [('07', 'Liquidity: BSL, SSL and resting orders'), ('08', 'Market structure and break of structure'),
             ('09', 'Order blocks and when they are valid'), ('10', 'Fair value gaps and imbalance'),
             ('13', 'Killzones and session timing'), ('18', 'SMT divergence'),
             ('26', 'Optimal trade entry (OTE) zones'), ('36', 'Risk and position sizing'),
             ('41', 'Prop firm and funded-account considerations')]
    for n, _ in learn:
        assert n in BY
    li = ''.join(f'<li class="{"is-free" if int(n) <= FREE_MAX else ""}">{CHECK}<span>{esc(t)}</span><b>Ch. {n}</b></li>' for n, t in learn)
    lessons = ''.join(f'<li><span>{i + 1}</span>{esc(l["title"])}</li>' for i, l in enumerate(ch1['lessons']))
    body = f'''<div class="cd-grid">
  <div class="cd-tile cd-stat cd-s1"><b data-count="{TOTAL}">{TOTAL}</b><span>chapters in all</span></div>
  <div class="cd-tile cd-stat cd-s2"><b>1–{FREE_MAX}</b><span>free with an account</span></div>
  <div class="cd-tile cd-stat cd-s3"><b data-count="{len(CORE)}">{len(CORE)}</b><span>core chapters, in order</span></div>
  <div class="cd-tile cd-stat cd-s4"><b>3<i>+</i>2</b><span>levels + specialist tracks</span></div>
  <figure class="cd-tile cd-preview">
    <div class="cd-pv-h"><span class="dp-k">Lesson preview · Chapter 01</span><span class="dp-cap">Screen capture of the reader</span></div>
    <div class="cd-laptop"><div class="dp-chrome" aria-hidden="true"><i></i><i></i><i></i><span>strykertrading.com/<b>chapter?ch=01</b></span></div>
      <div class="cd-scr"><img src="/assets/images/curriculum/reader.webp?v={BUILD}" width="740" height="774" loading="lazy" decoding="async" alt="The chapter reader showing Chapter 01, Candles, Charts and the Language of Price, with a candle anatomy diagram."></div></div>
    <div class="cd-phone" aria-hidden="true"><div class="cd-scr"><img src="/assets/images/curriculum/mobile.webp?v={BUILD}" width="740" height="1000" loading="lazy" decoding="async" alt=""></div></div>
  </figure>
  <div class="cd-tile cd-learn"><span class="dp-k">What you'll learn</span><ul>{li}</ul></div>
  <div class="cd-tile cd-ch1"><span class="dp-k">Inside chapter 01 · {len(ch1["lessons"])} lessons</span><ol>{lessons}</ol></div>
  <div class="cd-tile cd-go">
    <span class="dp-k">Start here · Free</span>
    <h3>{esc(ch1["title"])}</h3>
    <a class="cd-go-btn" href="chapter?ch=01">Start chapter 1 free <i aria-hidden="true">→</i></a>
  </div>
</div>
''' + cta()
    return wrap('D', 'Stat + preview bento', 'Big true numbers, a real screen of the chapter reader in a laptop and phone frame, a "what you\'ll learn" checklist mapped to chapter numbers, and a bold "Start chapter 1 free" tile.', body)


CHIPS = ''.join(f'<a href="#var-{v}" data-v="{v}">{v}</a>' for v in 'ABCD')
tpl = open(os.path.join(os.path.dirname(__file__), 'page.tpl.html'), encoding='utf8').read()
page = (tpl.replace('{{BUILD}}', str(BUILD)).replace('{{CHIPS}}', CHIPS)
        .replace('{{VARIANTS}}', var_a() + '\n' + var_b() + '\n' + var_c() + '\n' + var_d()))
open(os.path.join(ROOT, 'demo-curriculum.html'), 'w', encoding='utf8').write(page)
print('wrote demo-curriculum.html', len(page), 'bytes; chapters', TOTAL, 'build', BUILD)
