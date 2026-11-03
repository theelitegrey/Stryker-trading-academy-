#!/usr/bin/env python3
"""Rewrites the <main> of academy.html from the real data (assets/academy-index.json, built by
tools/gen-academy-index.js). Run: node tools/gen-academy-index.js && python3 tools/gen-academy-page.py"""
import json, re, html, os
R = os.path.join(os.path.dirname(__file__), '..')
I = json.load(open(R + '/assets/academy-index.json'))
CH = {c[0]: c for c in I['ch']}
e = html.escape
def chl(n): return 'chapter.html?ch=' + n
def pic(name, w, h, alt, cls='', lazy=True):
    a = ' loading="lazy" decoding="async"' if lazy else ' fetchpriority="high" decoding="async"'
    return (f'<img data-fp-nopad class="az-d {cls}" src="assets/images/academy/{name}-d.webp" width="{w}" height="{h}" alt="{e(alt)}"{a}>'
            f'<img data-fp-nopad class="az-l {cls}" src="assets/images/academy/{name}-l.webp" width="{w}" height="{h}" alt="{e(alt)}"{a}>')
def one(src, w, h, alt, cls=''):
    return f'<img data-fp-nopad class="{cls}" src="assets/images/academy/{src}.webp" width="{w}" height="{h}" alt="{e(alt)}" loading="lazy" decoding="async">'
def ico(p): return f'<svg class="az-i" viewBox="0 0 24 24" aria-hidden="true" focusable="false">{p}</svg>'
ARW = ico('<path d="M5 12h14M13 6l6 6-6 6"/>')
BOOK = ico('<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>')

core = [c for c in I['ch'] if c[0].isdigit()]
lv = lambda l: [c for c in core if c[2] == l]
fo, im, ad = lv('foundation'), lv('intermediate'), lv('advanced')
vp = [c for c in I['ch'] if c[0].startswith('VP-')]
pf = [c for c in I['ch'] if c[0].startswith('PF-')]
nles = sum(len(c[3]) for c in I['ch'])
stats = [('chapters', len(I['ch']), 'chapters'), ('lessons', nles, 'lessons'), ('articles', len(I['a']), 'free articles'),
         ('glossary', len(I['g']), 'glossary terms'), ('sheets', 2, 'cheat sheets'), ('tracks', 2, 'specialist tracks')]

# example session: hand-written OHLC (o,h,l,c) on a 0-100 scale; an illustration, not data
OHLC = [(52,56,49,50),(50,54,46,53),(53,58,52,57),(57,60,55,56),(56,57,48,49),(49,51,42,44),(44,47,38,46),(46,52,45,51),
        (51,55,50,54),(54,60,53,59),(59,64,58,63),(63,66,60,61),(61,62,55,56),(56,58,52,57),(57,63,56,62),(62,69,61,68)]
cw, gap, x0 = 12, 10, 16
cs = ''
for k, (o, h, l, c) in enumerate(OHLC):
    x = x0 + k * (cw + gap); cx = x + cw / 2
    y = lambda v: 170 - v * 2.0
    up = c >= o
    cs += (f'<g class="{"u" if up else "d"}"><line x1="{cx}" x2="{cx}" y1="{y(h):.1f}" y2="{y(l):.1f}"/>'
           f'<rect x="{x}" y="{y(max(o,c)):.1f}" width="{cw}" height="{max(3,abs(y(o)-y(c))):.1f}" rx="2"/></g>')
sweepy = 170 - 38 * 2.0
chart = (f'<svg class="az-chart" viewBox="0 0 380 190" role="img" aria-label="Example session: candles drift lower, wick under an old low, then close back above it and rally. Illustration only.">'
         f'<line class="lv" x1="16" x2="364" y1="{sweepy+8:.0f}" y2="{sweepy+8:.0f}"/>{cs}'
         f'<text x="22" y="{sweepy+22:.0f}">Old low</text><text x="150" y="{sweepy+34:.0f}" class="a">Sweep, then close back inside</text></svg>')

def card(href, img, t, p, meta):
    return (f'<a class="az-course" href="{href}"><span class="az-cv">{one(img,560,294,"")}</span><span class="az-cb"><b>{e(t)}</b>'
            f'<span>{e(p)}</span><i>{e(meta)}</i></span></a>')
courses = ''.join([
 card('courses', 'cv-curriculum', 'Core curriculum', 'ICT and smart money from candles to execution, in a deliberate order.', f'{len(core)} chapters · {sum(len(c[3]) for c in core)} lessons'),
 card('courses', 'cv-vp', 'Volume Profile & Order Flow', 'Auction theory, profiles, VWAP, the book, footprint and delta.', f'{len(vp)} chapters · specialist track'),
 card('courses', 'cv-pf', 'Prop Firm Mastery', 'How firms work, how to vet one, the rules, and staying funded.', f'{len(pf)} chapters · specialist track'),
 card('models', 'cv-models', 'Trading models', 'Playbooks with the conditions, entry criteria and a walkthrough.', f'{len(I["m"])} models'),
 card('learn', 'cv-articles', 'Articles', 'Plain-English guides you can read without an account.', f'{len(I["a"])} articles'),
 card('cheat-sheet', 'cv-cheat', 'Cheat sheets', 'Free printable rules: FVG & Order Block, and Prop Firm.', '2 sheets'),
])

def ring(i, lab):
    return (f'<span class="az-ring" data-ring="{i}" hidden role="img" aria-label="{lab}"><svg viewBox="0 0 36 36" aria-hidden="true"><circle class="t" cx="18" cy="18" r="15"/>'
            f'<circle class="p" cx="18" cy="18" r="15" pathLength="100" stroke-dasharray="0 100"/></svg><b>0%</b></span>')
def step(i, lvl, title, p, rng, ids, first):
    return (f'<li class="az-step az-rv"><span class="az-sn">{i}</span><div><h3>{title}</h3><p>{p}</p>'
            f'<span class="az-meta">{len(ids)} chapters · {rng}</span>'
            f'<a class="az-link" href="{chl(first)}">Start at chapter {first}{ARW}</a></div>{ring(lvl, title+" progress")}</li>')
path = ''.join([
 step(1, 'foundation', 'Beginner', 'Candles, market structure, levels and liquidity. The ground floor.', 'Ch. 01 to 07', fo, '01'),
 step(2, 'intermediate', 'Intermediate', 'Break of structure, order blocks, fair value gaps, sweeps and killzones.', 'Ch. 08 to 16', im, '08'),
 step(3, 'advanced', 'Advanced', 'SMT divergence, price delivery, risk, execution and your own playbook.', 'Ch. 17 to 42', ad, '17'),
])

def chlist(items, n=99):
    return '<ol class="az-chl">' + ''.join(f'<li><a href="{chl(c[0])}"><span>{c[0]}</span><b>{e(c[1])}</b>{ARW}</a></li>' for c in items[:n]) + '</ol>'
ictpick = [CH[n] for n in ('04','07','08','09','10','12','13','18')]
risk = [CH['03'], CH['PF-08']]
tabs = [
 ('ict', 'ICT / SMC', 'Structure, liquidity, order blocks, gaps and SMT, the core of the curriculum.', ictpick, 'Open all 42 core chapters', 'courses'),
 ('vp', 'Order flow', 'Auction theory, profiles, VWAP, the order book, footprint and delta.', vp[:8], 'Open the track', 'courses'),
 ('pf', 'Prop firms', 'How firms make money, how to vet one, the rules, and the funded stage.', pf[:8], 'Open the track', 'courses'),
 ('rk', 'Risk & mindset', 'Process before prediction, and the psychology behind the failure modes.', risk, 'Read the prop firm rules guide', 'learn-prop-firm-challenge-rules'),
]
tabbtn = ''.join(f'<button type="button" role="tab" id="az-t-{k}" aria-controls="az-p-{k}" aria-selected="{"true" if i==0 else "false"}" tabindex="{0 if i==0 else -1}">{t}</button>' for i,(k,t,*_) in enumerate(tabs))
tabpan = ''.join(f'<div role="tabpanel" id="az-p-{k}" aria-labelledby="az-t-{k}"{"" if i==0 else " hidden"}><p>{p}</p>{chlist(l)}<a class="btn btn-ghost az-btn" href="{href}">{lab}{ARW}</a></div>'
                 for i,(k,t,p,l,lab,href) in enumerate(tabs))

faq = [
 ('Is ZoroAcademy free?', 'Yes. All 64 chapters, including both specialist tracks, are free with an account. The articles, glossary and cheat sheets need no account at all.'),
 ('How long does it take?', 'It is self-paced. Every chapter shows its own length and every lesson is a short read, so you can finish one in a sitting or spread them over weeks.'),
 ('Do I need any experience?', 'No. Chapter 01 starts with what a candle is recording. The path above takes you from beginner to advanced in the order the chapters are written.'),
 ('Is this financial advice?', 'No. Education only. Not financial advice. Trading carries a high level of risk and may not be suitable for everyone. Examples are illustrations, not results.'),
 ('Does TradeZoro place trades for me?', 'No. TradeZoro is for charts, learning and review. You trade at your own broker or prop firm.'),
 ('Where do I practise what I learn?', 'On ZoroCharts and Replay One, where you can step through past sessions, and in JournalX to review your own notes.'),
]
faqh = ''.join(f'<details><summary>{q}</summary><div class="a">{a}</div></details>' for q, a in faq)
faqld = {"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":q,"acceptedAnswer":{"@type":"Answer","text":a}} for q,a in faq]}

main = f'''<main id="main" tabindex="-1" class="dash-main az-main">
<header class="az-hero" id="top">
<div class="az-w az-hero-grid">
<div class="az-hero-copy">
<nav class="az-crumbs" aria-label="Breadcrumb"><a href="/">Home</a> / <span aria-current="page">ZoroAcademy</span></nav>
<span class="az-kicker az-in">{BOOK}TradeZoro</span>
<h1 class="az-in" style="--d:60ms">ZoroAcademy</h1>
<p class="az-sub az-in" style="--d:120ms">Learn price action the way a desk reads it: {len(I["ch"])} chapters, plain English, free with an account.</p>
<div class="az-cta az-in" style="--d:180ms"><a class="btn btn-primary az-btn" href="{chl('01')}">Start chapter 01{ARW}</a><a class="btn btn-ghost az-btn" href="courses">Browse the curriculum</a></div>
<p class="az-fine az-in" style="--d:240ms">Education only. Not financial advice.</p>
</div>
<div class="az-scene az-in" style="--d:120ms">
<figure class="az-frame az-desk"><div class="az-bar"><span class="az-dots" aria-hidden="true"><i></i><i></i><i></i></span><b>Chapter reader</b><span class="az-tag">Sample view</span></div>{pic("reader-desk",1100,535,"The ZoroAcademy chapter reader open on Order Blocks, with a labelled chart diagram.","",False)}</figure>
<figure class="az-phone" aria-label="Phone view of the chapter reader">{pic("reader-ph",390,712,"The chapter reader on a phone.","",False)}</figure>
<div class="az-chartcard"><span class="az-tag">Example session</span>{chart}<small>Hand-drawn illustration, not market data.</small></div>
</div>
</div>
</header>

<section class="az-stats az-w" aria-label="ZoroAcademy in numbers"><ul>
{''.join(f'<li class="az-rv"><b data-stat="{k}" data-n="{n}">{n}</b><span>{l}</span></li>' for k,n,l in stats)}
</ul></section>

<section class="az-sec az-w" id="start" aria-labelledby="az-start-h">
<div class="az-head az-rv"><span class="az-eyebrow">Start here</span><h2 id="az-start-h">A path from beginner to advanced</h2><p>Follow the chapters in order, or jump to the level that fits you.</p></div>
<div class="az-continue" id="az-continue" hidden><div><span class="az-eyebrow">Continue where you left off</span><b id="az-cont-t"></b><span id="az-cont-s"></span></div><a class="btn btn-primary az-btn" id="az-cont-a" href="courses">Resume{ARW}</a></div>
<ol class="az-path">{path}</ol>
</section>

<section class="az-sec" id="courses" aria-labelledby="az-courses-h">
<div class="az-w az-head az-rv"><span class="az-eyebrow">Everything in the academy</span><h2 id="az-courses-h">Pick a course, a guide or a sheet</h2><p>Swipe on a phone, or scan the grid on a desktop.</p></div>
<div class="az-w"><div class="az-rail" role="list" tabindex="0" aria-label="Courses and guides">{courses}</div></div>
</section>

<section class="az-sec az-w" id="tracks" aria-labelledby="az-tracks-h">
<div class="az-head az-rv"><span class="az-eyebrow">Tracks by topic</span><h2 id="az-tracks-h">Go deep on what you trade</h2></div>
<div class="az-show az-rv">
<div class="az-showtxt"><div class="az-tabs" role="tablist" aria-label="Topic tracks">{tabbtn}</div>{tabpan}</div>
<figure class="az-frame"><div class="az-bar"><span class="az-dots" aria-hidden="true"><i></i><i></i><i></i></span><b>Curriculum</b><span class="az-tag">Sample progress</span></div>{pic("courses-desk",1100,489,"The curriculum list with level tabs, a Continue learning card and chapter rows.")}</figure>
</div>
</section>

<section class="az-sec az-w" id="library" aria-labelledby="az-lib-h">
<div class="az-head az-rv"><span class="az-eyebrow">The library</span><h2 id="az-lib-h">Look it up, print it, practise it</h2></div>
<div class="az-bento">
<a class="az-tile az-t-gloss az-rv" href="/#concepts"><h3>Glossary</h3><p>{len(I["g"])} core terms, each tied to the chapter that teaches it.</p><div class="az-chips">{''.join(f'<i>{e(g[0])}</i>' for g in I["g"][:9])}<i>+{len(I["g"])-9} more</i></div></a>
<a class="az-tile az-t-sheet az-rv" href="cheat-sheet" style="--d:60ms"><h3>Cheat sheets</h3><p>Free printable rules.</p><span class="az-sheets"><img data-fp-nopad src="assets/images/cheatsheet-preview.webp" width="560" height="792" alt="FVG and Order Block cheat sheet preview" loading="lazy" decoding="async"><img data-fp-nopad src="assets/images/propfirm-cheatsheet-preview-480.webp" width="480" height="679" alt="Prop Firm cheat sheet preview" loading="lazy" decoding="async"></span></a>
<a class="az-tile az-t-models az-rv" href="models" style="--d:120ms"><h3>Trading models</h3><p>{len(I["m"])} playbooks with entry criteria and a walkthrough.</p><div class="az-shot">{pic("models-desk",1100,535,"The trading models list with category filters and model cards.")}<span class="az-tag">Sample view</span></div></a>
<a class="az-tile az-t-ind az-rv" href="indicators" style="--d:180ms"><h3>Indicator guides</h3><p>How each chart indicator works and how to read it, with its inputs explained.</p><span class="az-link">Open the guides{ARW}</span></a>
</div>
</section>

<section class="az-sec az-w" id="search" aria-labelledby="az-search-h">
<div class="az-head az-rv"><span class="az-eyebrow">Search</span><h2 id="az-search-h">Find a lesson in seconds</h2><p>Search {len(I["ch"])} chapters and {nles} lessons, plus articles, glossary terms and models.</p></div>
<div class="az-search az-rv"><label class="sr-only" for="az-q">Search ZoroAcademy</label><input id="az-q" type="search" inputmode="search" autocomplete="off" placeholder="Try &quot;order block&quot; or &quot;VWAP&quot;" aria-controls="az-res"><ul id="az-res" aria-live="polite"></ul></div>
</section>

<section class="az-sec az-w" id="featured" aria-labelledby="az-feat-h">
<div class="az-feat az-rv"><a class="az-featimg" href="learn-order-blocks" tabindex="-1" aria-hidden="true">{one("cv-ob",640,336,"")}</a>
<div><span class="az-eyebrow">Featured lesson</span><h2 id="az-feat-h">Order blocks explained</h2><p>What an order block is, what makes one valid, and how it combines with liquidity. Read the free guide, then study chapters 09 and 21 in the curriculum.</p>
<div class="az-cta"><a class="btn btn-primary az-btn" href="learn-order-blocks">Read the guide{ARW}</a><a class="btn btn-ghost az-btn" href="{chl('09')}">Chapter 09</a></div></div></div>
</section>

<section class="az-sec az-w" id="faq" aria-labelledby="az-faq-h">
<div class="az-head az-rv"><span class="az-eyebrow">Questions</span><h2 id="az-faq-h">Before you start</h2></div>
<div class="az-faq az-rv">{faqh}</div>
</section>

<section class="az-sec az-w az-last" aria-labelledby="az-cta-h">
<div class="az-final az-rv"><h2 id="az-cta-h">Open chapter 01 and start reading.</h2><p>Free with an account. Pick up where you stopped on any device.</p>
<div class="az-cta"><a class="btn btn-primary az-btn" href="signup">Create your free account</a><a class="btn btn-ghost az-btn" href="courses">Browse the curriculum</a><a class="btn btn-ghost az-btn" href="learn">Read the articles</a></div>
<p class="az-fine">Education only. Not financial advice. Trading carries a high level of risk and may not be suitable for everyone.</p></div>
</section>
</main>'''

p = R + '/academy.html'
s = open(p).read()
s = re.sub(r'<main id="main".*?</main>', lambda m: main, s, flags=re.S)
if 'academy-page.css' not in s:
    s = s.replace('<link rel="stylesheet" href="assets/learn.css', '<link rel="stylesheet" href="assets/academy-page.css?v=831">\n<link rel="stylesheet" href="assets/learn.css', 1)
    s = s.replace('<body data-page-key="learn" class="dual-shell">', '<body data-page-key="learn" class="dual-shell az-page">')
    s = s.replace('<script src="assets/theme.js', '<script src="assets/academy-page.js?v=831" defer></script>\n<script src="assets/theme.js', 1)
s = re.sub(r'<script type="application/ld\+json" id="az-faq">.*?</script>\n', '', s, flags=re.S)
s = s.replace('</head>', '<script type="application/ld+json" id="az-faq">' + json.dumps(faqld) + '</script>\n</head>', 1)
open(p, 'w').write(s)
print('ok', len(s))
