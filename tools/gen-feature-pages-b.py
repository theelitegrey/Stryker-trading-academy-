#!/usr/bin/env python3
"""Builds features/{curriculum,models,indicators,community,live-sessions}.html and features.html in the new-hub style.
Template = features/charts.html (shell, head, footer, scripts). Re-run after editing copy below. Screenshots: assets/images/fx/."""
import re, os, html
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
V = '781'
tpl = open(f'{ROOT}/features/charts.html', encoding='utf-8').read()
a = tpl.index('<main id="main"'); b = tpl.index('</main>')
HEAD, TAIL = tpl[:a], tpl[b + len('</main>'):]
HEAD = re.sub(r'\s*<a href="/live-sessions\.html" class="side-link">.*?</a>', '', HEAD, flags=re.S)
MAIN_OPEN = '<main id="main" tabindex="-1" class="dash-main cm-main-page fx-main">\n<div class="cm-scroll" aria-hidden="true"><u data-scroll-bar></u></div>\n'
TAIL = TAIL.replace('<script src="/assets/charts-page.js?v=781" defer></script>', '<script src="/assets/fx-page.js?v=781" defer></script>')
HEAD = HEAD.replace('<link rel="stylesheet" href="/assets/charts-page.css?v=781">', '<link rel="stylesheet" href="/assets/fx-page.css?v=781">')
e = html.escape

IC = {
 'book': '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5z"/><path d="M4 19.5V22h16"/>',
 'check': '<path d="M20 6L9 17l-5-5"/>', 'bell': '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
 'trophy': '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
 'list': '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>', 'play': '<path d="M6 4l14 8-14 8z"/>',
 'users': '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
 'link': '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
 'chart': '<path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/>', 'shield': '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
 'phone': '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>', 'yt': '<rect x="2" y="5" width="20" height="14" rx="4"/><path d="M10 9l5 3-5 3z"/>',
 'msg': '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>', 'grid': '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
}
def ico(k, cls='ci'): return f'<svg class="{cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">{IC[k]}</svg>'
def img(name, alt, w=1100, h=687, theme=None, lazy=True, extra=''):
    ld = ' loading="lazy" decoding="async"' if lazy else ' fetchpriority="high" decoding="async"'
    def one(sfx, cls, a):
        return f'<img data-fp-nopad class="{cls} fx-shot{extra}" src="/assets/images/fx/{name}-{sfx}.webp?v={V}" width="{w}" height="{h}" alt="{e(a)}"{ld}>'
    return one('d', 'd-only', alt) + one('l', 'l-only', 'The same screen in the light theme.')
def img1(name, alt, w=1100, h=687, cls=''):
    return f'<img data-fp-nopad class="fx-bimg {cls}" src="/assets/images/fx/{name}.webp?v={V}" width="{w}" height="{h}" alt="{e(alt)}" loading="lazy" decoding="async">'
def frame(title, tag, inner, cap=''):
    c = f'<figcaption>{cap}</figcaption>' if cap else ''
    return f'<figure class="cm-frame"><div class="cm-bar"><span class="cm-dots" aria-hidden="true"><i></i><i></i><i></i></span><b>{e(title)}</b><span class="cm-tag">{tag}</span></div>{inner}{c}</figure>'
def fcard(cls, d, depth, icon, b, s):
    return f'<div class="cm-fl fx-fl {cls}" style="--d:{d}ms" aria-hidden="true"><div class="cm-px" data-depth="{depth}"><div class="fx-fc">{ico(icon)}<div><b>{e(b)}</b><span>{s}</span></div></div></div></div>\n'
def hero(P):
    ph = img(P['phone'], P['phone_alt'], 390, 780)
    return f'''<header class="cm-hero" id="top">
<div class="cm-w cm-hero-copy">
<span class="cm-kicker cm-in" style="--d:0ms">{e(P['kicker'])}</span>
<h1 class="cm-in" style="--d:80ms">{P['h1']}</h1>
<p class="cm-sub cm-in" style="--d:160ms">{P['sub']}</p>
<div class="cm-cta cm-in" style="--d:240ms">{P['cta']}</div>
<p class="cm-fine cm-in" style="--d:300ms">{P['fine']}</p>
</div>
<div class="cm-w"><div class="cm-scene fx-scene{P.get('nc','')}" data-scene>
<div class="cm-fl cm-fl-main" style="--d:350ms"><div class="cm-px" data-depth="6"><figure class="cm-frame cm-hero-frame">
<div class="cm-bar"><span class="cm-dots" aria-hidden="true"><i></i><i></i><i></i></span><b>{e(P['bar'])}</b><span class="cm-tag">{P.get('tag','Sample data')}</span></div>
{img(P['hero'], P['hero_alt'], lazy=False)}
</figure></div></div>
<div class="cm-fl fx-phone-fl" style="--d:600ms"><div class="cm-px" data-depth="10"><figure class="fx-phone" aria-label="{e(P['phone_alt'])}"><div class="fx-ph-scr"><i class="fx-ph-isl" aria-hidden="true"></i>{ph}</div></figure></div></div>
{fcard('fx-l1', 700, 16, *P['cards'][0])}{fcard('fx-l3', 1000, 12, *P['cards'][1])}{fcard('fx-r1', 780, 18, *P['cards'][2])}{fcard('fx-r2', 930, 24, *P['cards'][3])}</div>
<p class="cm-cap">Real screens with sample data. Floating cards are illustrations.</p></div>
</header>
'''
def story(P):
    steps = P['story']; n = len(steps)
    lis = ''.join(f'<li><span class="cm-sn">{i+1}</span><div><b>{e(s[0])}</b><p>{e(s[1])}</p></div></li>\n' for i, s in enumerate(steps))
    figs = ''.join(f'<figure class="fx-sl">{img(s[2], s[3])}</figure>\n' for s in steps)
    return f'''<section class="cm-story fx-story" id="story" data-fx-story style="--n:{n}" aria-labelledby="st-h">
<div class="cm-sticky"><div class="cm-w cm-story-grid">
<div class="cm-story-copy"><span class="cm-eyebrow">{e(P['story_eyebrow'])}</span><h2 id="st-h">{e(P['story_h'])}</h2>
<ol class="cm-steps-list">
{lis}</ol><div class="cm-prog-line" aria-hidden="true"><u data-fx-bar></u></div></div>
<div class="cm-stage-wrap"><div class="cm-stage fx-stage"><div class="cm-sbar"><span class="cm-dots" aria-hidden="true"><i></i><i></i><i></i></span><b>{e(P['bar'])}</b><span class="cm-tag">Sample data</span></div>
<div class="fx-sv" role="group" aria-label="Screens for each step, shown one at a time">
{figs}</div></div>
<p class="cm-story-cap" data-fx-cap aria-hidden="true"></p></div>
</div></div></section>
'''
def split(sid, eyebrow, icon, h, ps, items, shot_html, flip=False, title='', tag='Screenshot', cap=''):
    ul = ''.join(f'<li>{ico(i)}<span>{e(t)}</span></li>' for i, t in items)
    p = ''.join(f'<p>{x}</p>' for x in ps)
    return f'''<section class="cm-sec" id="{sid}" aria-labelledby="{sid}-h">
<div class="cm-w cm-split{' flip' if flip else ''}">
<div class="cm-copy cm-rv"><span class="cm-eyebrow">{ico(icon)}{e(eyebrow)}</span><h2 id="{sid}-h">{e(h)}</h2>{p}<ul class="cm-list">{ul}</ul></div>
<div class="cm-rv" style="--d:120ms">{frame(title, tag, shot_html, cap)}</div>
</div></section>
'''
def bento(sid, eyebrow, h, sub, cards):
    out = ''
    for i, c in enumerate(cards):
        wide, icon, t, p, im = c
        d = f' style="--d:{(i%3)*80}ms"' if i % 3 else ''
        out += f'<div class="cm-card cm-pad cm-rv{" fx-b2" if wide else ""}"{d} data-tilt><div class="cm-ch">{ico(icon)}<b>{e(t)}</b></div><p class="fx-p">{p}</p>{im}</div>\n'
    return f'''<section class="cm-sec" id="{sid}" aria-labelledby="{sid}-h"><div class="cm-w">
<div class="cm-head2 cm-rv"><span class="cm-eyebrow">{e(eyebrow)}</span><h2 id="{sid}-h">{e(h)}</h2><p>{sub}</p></div>
<div class="fx-bento">
{out}</div></div></section>
'''
def grid(sid, eyebrow, h, items, note=''):
    li = ''.join(f'<li class="cm-card cm-pad cm-rv" style="--d:{(i%3)*60}ms"><b>{e(t)}</b><span>{s}</span></li>' for i, (t, s) in enumerate(items))
    n = f'<p class="cm-cap">{note}</p>' if note else ''
    return f'<section class="cm-sec" id="{sid}" aria-labelledby="{sid}-h"><div class="cm-w"><div class="cm-head2 cm-rv"><span class="cm-eyebrow">{e(eyebrow)}</span><h2 id="{sid}-h">{e(h)}</h2></div><ul class="fx-grid">{li}</ul>{n}</div></section>\n'
def phones(sid, eyebrow, h, p, name, alt, items):
    li = ''.join(f'<li>{ico(i)}<span>{e(t)}</span></li>' for i, t in items)
    ph = f'<figure class="fx-phone"><div class="fx-ph-scr">{img(name, alt, 390, 780)}</div></figure>'
    return f'''<section class="cm-sec" id="{sid}" aria-labelledby="{sid}-h"><div class="cm-w cm-split">
<div class="cm-copy cm-rv"><span class="cm-eyebrow">{ico('phone')}{e(eyebrow)}</span><h2 id="{sid}-h">{e(h)}</h2><p>{p}</p><ul class="cm-list">{li}</ul></div>
<div class="cm-rv" style="--d:120ms"><div class="fx-phones" style="grid-template-columns:minmax(0,230px);justify-content:center">{ph}</div></div></div></section>
'''
def faq(qs):
    d = ''.join(f'<details><summary>{e(q)}</summary><div class="fg-a"><p>{a}</p></div></details>\n' for q, a in qs)
    return f'<section class="cm-sec" id="faq" aria-labelledby="faq-h"><div class="cm-w"><div class="cm-head2 cm-rv"><span class="cm-eyebrow">Questions</span><h2 id="faq-h">Before you start</h2></div><div class="fg-faq cm-faq cm-rv">\n{d}</div></div></section>\n'
def final(h, p, cta, edu='Education only. Not financial advice.'):
    return f'<section class="cm-sec cm-last" aria-labelledby="end-h"><div class="cm-w"><div class="cm-final cm-rv"><h2 id="end-h">{e(h)}</h2><p>{p}</p><div class="cm-cta">{cta}</div><p class="cm-edu">{edu}</p></div></div></section>\n'
def btn(h, t, primary=True): return f'<a href="{h}" class="btn {"btn-primary" if primary else "btn-ghost"} cm-btn" data-mag>{e(t)}</a>'

def page(slug, P, body):
    old = open(f'{ROOT}/features/{slug}.html', encoding='utf-8').read() if slug != '_hub' else open(f'{ROOT}/features.html', encoding='utf-8').read()
    head = HEAD
    # carry over each page's own title, description, canonical, OG and twitter tags
    for key in ['<meta name="description"', '<meta property="og:title"', '<meta property="og:description"', '<meta property="og:url"', '<meta property="og:image"', '<meta property="og:image:alt"',
                '<meta name="twitter:title"', '<meta name="twitter:description"', '<meta name="twitter:image"', '<meta name="twitter:image:alt"', '<title>', '<link rel="canonical"']:
        o = next((l for l in old.split('\n') if l.startswith(key)), None)
        if not o: continue
        head = '\n'.join(o if l.startswith(key) else l for l in head.split('\n'))
    if slug == '_hub': head = head.replace('<body class="dual-shell fp-page cm-page">', '<body class="dual-shell fp-page cm-page" data-page-key="features">')
    out = head + MAIN_OPEN + body + '</main>' + TAIL
    path = f'{ROOT}/features.html' if slug == '_hub' else f'{ROOT}/features/{slug}.html'
    open(path, 'w', encoding='utf-8').write(out)
    print('wrote', path, len(out))
