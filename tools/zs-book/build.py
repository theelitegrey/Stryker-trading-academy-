#!/usr/bin/env python3
"""Zscript docs builder: one markdown source -> site pages (zscript/*.html) + book (PDF).

  python3 tools/zs-book/build.py            site pages + book HTML (tools/zs-book/out/book.html)
  python3 tools/zs-book/build.py --pdf      also render dist PDF  (assets/zscript/The-Zscript-Book.pdf)
  python3 tools/zs-book/build.py --check    exit 1 if committed site pages are out of date

Sources (tools/zs-book/src/):
  manual/NN-slug.md      hand-written chapters      (front matter: title, dek, part)
  cookbook/NN-slug.md    one recipe each            (front matter: title, dek, level)
  reference.json         built-ins list from the engine (see tools/zs-book/gen-reference.mjs)
Code fences:  ```zscript = full script (must start //@zscript 1), ```zs-snippet = wrapped in a
stub indicator; both are compiled + run by tools/tests/zs-docs-samples.test.mjs. ```text = not run.
Directive on its own line:  @chart <name>  -> figure from tools/zs-book/charts/<name>.svg
"""
import html, json, os, re, subprocess, sys
import markdown

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.path.join(ROOT, 'tools/zs-book/src')
OUT = os.path.join(ROOT, 'tools/zs-book/out')
BUILD = json.load(open(os.path.join(ROOT, 'assets/version.json')))['build']
CHECK = '--check' in sys.argv
esc = html.escape

# ---------------------------------------------------------------- highlight
KW = r'\b(if|else|for|to|by|in|while|switch|return|break|continue|var|varip|and|or|not|true|false|na|import|export|method|type)\b'
TYPES = r'\b(int|float|bool|string|color|series|array|map)\b'
NS = r'\b(ta|math|str|color|input|array|map|request|book|flow|gex|opt|label|line|box|table|syminfo|timeframe|barstate|alert|session|chart)\b(?=\.)'
FN = r'\b(indicator|plot|plotshape|plotchar|plotarrow|plotcandle|hline|fill|bgcolor|barcolor|alertcondition|nz|fixnan|na)\b(?=\()'
BAR = r'\b(open|high|low|close|volume|time|bar_index|hl2|hlc3|ohlc4)\b'

def hl(code):
    out, i = [], 0
    tok = re.compile(r'(//[^\n]*)|("(?:\\.|[^"\\])*"|\'(?:\\.|[^\'\\])*\')|(\b\d[\d_]*\.?\d*(?:e[+-]?\d+)?\b|#[0-9a-fA-F]{6,8}\b)')
    def plain(s):
        s = esc(s, quote=False)
        s = re.sub(KW, r'<span class="k">\1</span>', s)
        s = re.sub(TYPES, r'<span class="t">\1</span>', s)
        s = re.sub(NS, r'<span class="n">\1</span>', s)
        s = re.sub(FN, r'<span class="f">\1</span>', s)
        s = re.sub(BAR, r'<span class="b">\1</span>', s)
        return s
    for m in tok.finditer(code):
        out.append(plain(code[i:m.start()]))
        cls = 'c' if m.group(1) else 's' if m.group(2) else 'm'
        out.append('<span class="%s">%s</span>' % (cls, esc(m.group(0), quote=False)))
        i = m.end()
    out.append(plain(code[i:]))
    return ''.join(out)

# ---------------------------------------------------------------- markdown
def front(text):
    m = re.match(r'---\n(.*?)\n---\n', text, re.S)
    meta = {}
    if m:
        for ln in m.group(1).splitlines():
            k, _, v = ln.partition(':')
            meta[k.strip()] = v.strip()
        text = text[m.end():]
    return meta, text

def render_md(text, ctx):
    """markdown -> html; code fences highlighted; @chart directives -> figures."""
    blocks = []
    def grab(m):
        lang, body = m.group(1), m.group(2).rstrip('\n')
        blocks.append((lang, body))
        return '\n\nZSBLOCK%d\n\n' % (len(blocks) - 1)
    text = re.sub(r'^```([\w-]*)\n(.*?)^```[ \t]*$', grab, text, flags=re.S | re.M)
    charts = []
    def grabc(m):
        charts.append(m.group(1).strip())
        return '\n\nZSCHART%d\n\n' % (len(charts) - 1)
    text = re.sub(r'^@chart\s+(\S+)\s*$', grabc, text, flags=re.M)
    h = markdown.markdown(text, extensions=['tables', 'toc', 'sane_lists'], extension_configs={'toc': {'permalink': False}})
    def put(m):
        lang, body = blocks[int(m.group(1))]
        if lang in ('zscript', 'zs-snippet'):
            return '<pre class="zs-code" data-lang="Zscript"><code>%s</code></pre>' % hl(body)
        return '<pre class="zs-code zs-plain"><code>%s</code></pre>' % esc(body, quote=False)
    h = re.sub(r'<p>ZSBLOCK(\d+)</p>', put, h)
    def putc(m):
        name = charts[int(m.group(1))]
        p = os.path.join(SRC, '..', 'charts', name + '.svg')
        if not os.path.exists(p):
            ctx.setdefault('missing_charts', []).append(name)
            return ''
        cap = ''
        mj = os.path.join(SRC, '..', 'charts', name + '.json')
        if os.path.exists(mj):
            cap = json.load(open(mj)).get('caption', '')
        return '<figure class="zs-fig">%s<figcaption>%s</figcaption></figure>' % (open(p).read(), esc(cap))
    h = re.sub(r'<p>ZSCHART(\d+)</p>', putc, h)
    return h

def load_dir(sub):
    d = os.path.join(SRC, sub)
    items = []
    for fn in sorted(os.listdir(d)):
        if not fn.endswith('.md'):
            continue
        meta, body = front(open(os.path.join(d, fn)).read())
        meta['slug'] = re.sub(r'^\d+-', '', fn[:-3])
        meta['file'] = fn
        meta['body'] = body
        items.append(meta)
    return items

# ---------------------------------------------------------------- reference
def reference_pages():
    p = os.path.join(SRC, 'reference.json')
    if not os.path.exists(p):
        return []
    data = json.load(open(p))
    groups = {}
    for f in data['functions']:
        groups.setdefault(f['group'], []).append(f)
    pages = []
    for g in data['groups']:
        fns = sorted(groups.get(g['id'], []), key=lambda f: f['name'])
        if not fns:
            continue
        parts = []
        if g.get('plan'):
            parts.append('<p class="zs-note"><strong>Plan:</strong> %s</p>' % esc(g['plan']))
        for f in fns:
            parts.append('<section class="zs-ref" id="%s"><h3><code>%s</code></h3>' % (esc(f['name'].replace('.', '-')), esc(f['signature'])))
            parts.append('<p>%s</p>' % esc(f['desc']))
            if f.get('returns'):
                parts.append('<p><strong>Returns:</strong> %s</p>' % esc(f['returns']))
            if f.get('params'):
                hasd = any(q.get('desc') for q in f['params'])
                parts.append('<table><thead><tr><th>Parameter</th><th>Type</th>%s</tr></thead><tbody>%s</tbody></table>' % ('<th>Notes</th>' if hasd else '', ''.join(
                    '<tr><td><code>%s</code></td><td>%s</td>%s</tr>' % (esc(q['name']), esc(q.get('type', '')), ('<td>%s</td>' % esc(q.get('desc', ''))) if hasd else '') for q in f['params'])))
            if f.get('example'):
                parts.append('<pre class="zs-code" data-lang="Zscript"><code>%s</code></pre>' % hl(f['example']))
            parts.append('</section>')
        pages.append({'slug': g['id'], 'title': g['title'], 'dek': g.get('desc', ''), 'html': ''.join(parts), 'count': len(fns)})
    if data.get('constantsText'):
        rows = ''.join('<tr><td><code>%s</code></td><td>%s</td></tr>' % (esc(l.split(':')[0]), ' '.join('<code>%s</code>' % esc(x.strip()) for x in l.split(':', 1)[1].split(','))) for l in data['constantsText'].splitlines())
        pages.append({'slug': 'constants', 'title': 'Named constants', 'dek': 'Ready-made names for colors, styles, shapes, sizes and positions.',
                      'html': '<table><thead><tr><th>Group</th><th>Names</th></tr></thead><tbody>%s</tbody></table><p>Keywords: %s.</p><p>Types: %s.</p>' % (rows, ', '.join('<code>%s</code>' % esc(k) for k in data['keywords']), ', '.join('<code>%s</code>' % esc(k) for k in data['types'])), 'count': 0})
    return pages

# ---------------------------------------------------------------- site shell
def node_dual(htmls):
    js = ("const {toDual}=require('./tools/app-shell/dual-shell.js');"
          "const a=JSON.parse(require('fs').readFileSync(0,'utf8'));"
          "process.stdout.write(JSON.stringify(a.map(h=>toDual(h))))")
    r = subprocess.run(['node', '-e', js], input=json.dumps(htmls), capture_output=True, text=True, cwd=ROOT)
    if r.returncode:
        raise SystemExit(r.stderr)
    return json.loads(r.stdout)

about = open(os.path.join(ROOT, 'about.html')).read()
NAV = about[about.index('<nav class="nav"'):about.index('</nav>') + 6]
FOOTER = about[about.index('<footer>'):about.index('</footer>') + 9]
HS = about.index('<link rel="preload"')
ver = lambda h: re.sub(r'\?v=\d+', '?v=%s' % BUILD, h)
HEAD_ASSETS = ver(about[HS:about.index('</head>')].strip())
# root-relative assets: pages live in /zscript/
HEAD_ASSETS = re.sub(r'(href|src)="(?!/|https?:|data:|#)', r'\1="/', HEAD_ASSETS)
HEAD_ASSETS = HEAD_ASSETS.replace('</head>', '')
SCRIPTS = ver(about[about.index('</footer>') + 9:about.index('</body>')].strip())
SCRIPTS = re.sub(r'(src)="(?!/|https?:|data:|#)', r'\1="/', SCRIPTS)
NAV = re.sub(r'(href|src|srcset)="(?!/|https?:|#|mailto:|data:)', r'\1="/', NAV)
FOOTER = re.sub(r'(href|src|srcset)="(?!/|https?:|#|mailto:|data:)', r'\1="/', FOOTER)

GATE = ('<script src="/assets/zs-config.js?v=%s"></script>\n'
        '<script>if(!window.ZS_LIVE&&!/[?&]preview=1/.test(location.search))document.documentElement.classList.add("zs-hidden")</script>' % BUILD)

def site_page(slug, title, dek, body_html, nav_items, cur, kind='Manual'):
    url = 'https://tradezoro.com/zscript/' + slug if slug else 'https://tradezoro.com/zscript/'
    side = ''
    for s_, t_ in nav_items:
        if s_.startswith('~'):
            side += '<span class="zd-grp">%s</span>' % esc(t_)
        else:
            side += '<a href="/zscript/%s"%s>%s</a>' % (s_, ' aria-current="page"' if s_ == cur else '', esc(t_))
    head = f'''<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="stryker-build" content="{BUILD}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex">
<meta name="description" content="{esc(dek, True)}">
<meta name="theme-color" content="#050506">
<title>{esc(title)} | Zscript | TradeZoro</title>
<link rel="canonical" href="{url}">
{HEAD_ASSETS}
<link rel="stylesheet" href="/assets/zscript-docs.css?v={BUILD}">
{GATE}
</head>'''
    main = f'''<div class="zd-wrap">
<aside class="zd-side" aria-label="Zscript manual"><details class="zd-menu" id="zd-menu"><summary>Zscript manual<span class="zd-here">{esc(title)}</span></summary><nav>{side}</nav></details></aside>
<article class="zd-body">
<nav class="lx-crumbs" aria-label="Breadcrumb"><a href="/">Home</a> / <a href="/zscript/">Zscript</a> / <span aria-current="page">{esc(title)}</span></nav>
<header class="zd-head"><p class="zd-kind">{kind}</p><h1>{esc(title)}</h1><p class="zd-dek">{esc(dek)}</p></header>
<div class="zd-prose">{body_html}</div>
<p class="zd-disc">Education only. Not financial advice. Examples are teaching samples, not trading results.</p>
</article>
<script>if(window.innerWidth>860)document.getElementById('zd-menu').open=true</script>
<div class="zd-soon" role="status"><h1>Zscript is coming soon</h1><p>The manual opens when Zscript launches.</p><a class="btn btn-primary" href="/">Back to home</a></div>
</div>'''
    return f'''{head}
<body data-page-key="zscript-{slug or 'index'}">
<a class="skip-link" href="#main">Skip to content</a>

{NAV}
<main id="main" tabindex="-1">
{main}
</main>
{FOOTER}
{SCRIPTS}
</body>
</html>
'''

# ---------------------------------------------------------------- main
def main():
    ctx = {}
    manual = load_dir('manual')
    cook = load_dir('cookbook')
    refs = reference_pages()
    for m in manual:
        m['html'] = render_md(m['body'], ctx)
    for c in cook:
        c['html'] = render_md(c['body'], ctx)

    nav = [('', 'Start here'), ('~', 'Learn')] + [(m['slug'], m['title']) for m in manual]
    nav += [('~', 'Reference')] + [('reference/' + r['slug'], r['title']) for r in refs]
    nav += [('~', 'Practice'), ('cookbook/', 'Cookbook (%d recipes)' % len(cook)), ('course/', 'Course (12 lessons)')]
    nav = [(s, t) for s, t in nav]
    pages = {}
    # index
    cards = ''.join('<li><a class="lx-card" href="/zscript/%s"><h2>%s</h2><p>%s</p></a></li>' % (m['slug'], esc(m['title']), esc(m.get('dek', ''))) for m in manual)
    pages['zscript/index.html'] = site_page('', 'The Zscript manual', 'Write your own chart indicators. Plain English, every example runs.',
        '<ul class="lx-list">%s<li><a class="lx-card" href="/zscript/cookbook/"><h2>Cookbook</h2><p>%d working scripts to copy and change.</p></a></li></ul>' % (cards, len(cook)), nav, '')
    for m in manual:
        pages['zscript/%s.html' % m['slug']] = site_page(m['slug'], m['title'], m.get('dek', ''), m['html'], nav, m['slug'])
    for r in refs:
        pages['zscript/reference/%s.html' % r['slug']] = site_page('reference/' + r['slug'], r['title'], r['dek'], r['html'], nav, 'reference/' + r['slug'], 'Reference')
    ci = ''.join('<li><a class="lx-card" href="/zscript/cookbook/%s"><h3>%s</h3><p>%s</p><span>%s</span></a></li>' % (c['slug'], esc(c['title']), esc(c.get('dek', '')), esc(c.get('level', ''))) for c in cook)
    pages['zscript/cookbook/index.html'] = site_page('cookbook/', 'Cookbook', '%d scripts. Copy one, change a number, learn by doing.' % len(cook), '<ul class="lx-list">%s</ul>' % ci, nav, 'cookbook/', 'Cookbook')
    for c in cook:
        pages['zscript/cookbook/%s.html' % c['slug']] = site_page('cookbook/' + c['slug'], c['title'], c.get('dek', ''), c['html'], nav, 'cookbook/', 'Cookbook')

    course = json.load(open(os.path.join(ROOT, 'tools/content/zscript-course.json')))
    cc = ''.join('<li><a class="lx-card" href="/zscript/course/%s"><h3>Lesson %d. %s</h3><p>%s &middot; %s</p></a></li>' % (c['num'].lower(), i + 1, esc(c['title']), esc(c['dur']), esc(c['level'])) for i, c in enumerate(course))
    pages['zscript/course/index.html'] = site_page('course/', 'Zscript course', '%d short lessons with exercises and a quiz. About 6 hours in total.' % len(course), '<ul class="lx-list">%s</ul>' % cc, nav, 'course/', 'ZoroAcademy course')
    for i, c in enumerate(course):
        ex = ''.join('<li><strong>%s.</strong> %s</li>' % (esc(l['title']), esc(l['desc'])) for l in c['lessons'])
        body = c['bodyHtml'].replace('class="zs-code"><code>', 'class="zs-code" data-lang="Zscript"><code>')
        body = re.sub(r'<pre class="zs-code"[^>]*><code>(.*?)</code></pre>', lambda m: '<pre class="zs-code" data-lang="Zscript"><code>%s</code></pre>' % hl(html.unescape(m.group(1))), body, flags=re.S)
        body = body.replace('<h3>Quick quiz</h3>', '<h2>Exercises</h2><ol>%s</ol><h2>Quick quiz</h2>' % ex)
        nxt = ('<p><a class="btn btn-primary" href="/zscript/course/%s">Next lesson</a></p>' % course[i + 1]['num'].lower()) if i + 1 < len(course) else '<p><a class="btn btn-primary" href="/zscript/cookbook/">Open the Cookbook</a></p>'
        pages['zscript/course/%s.html' % c['num'].lower()] = site_page('course/' + c['num'].lower(), 'Lesson %d. %s' % (i + 1, c['title']), '%s &middot; %s' % (c['dur'], c['level']) if False else '%s, %s level' % (c['dur'], c['level']),
            body + nxt + '<script src="/assets/zscript-quiz.js?v=%s" defer></script>' % BUILD, nav, 'course/', 'ZoroAcademy course')
    keys = list(pages)
    duals = node_dual([pages[k] for k in keys])
    for k, v in zip(keys, duals):
        pages[k] = v
    # fix relative nav hrefs inserted by toDual only if needed (none: all absolute)

    stale = 0
    existing = set()
    for dp, _, fns in os.walk(os.path.join(ROOT, 'zscript')):
        for fn in fns:
            existing.add(os.path.relpath(os.path.join(dp, fn), ROOT))
    for k, v in pages.items():
        p = os.path.join(ROOT, k)
        cur = open(p).read() if os.path.exists(p) else None
        existing.discard(k)
        if cur == v:
            continue
        if CHECK:
            print(k, 'out of date: run python3 tools/zs-book/build.py'); stale += 1
        else:
            os.makedirs(os.path.dirname(p), exist_ok=True); open(p, 'w').write(v)
    for k in existing:  # removed sources
        if CHECK: print(k, 'is orphaned'); stale += 1
        else: os.remove(os.path.join(ROOT, k))
    if CHECK:
        sys.exit(1 if stale else 0)

    # ---- book
    import book
    book.build(ROOT, SRC, OUT, manual, cook, refs, hl, '--pdf' in sys.argv, ctx, course)
    if ctx.get('missing_charts'):
        print('charts missing:', sorted(set(ctx['missing_charts'])))
    print('pages:', len(pages), '| recipes:', len(cook), '| chapters:', len(manual), '| ref pages:', len(refs))

sys.path.insert(0, os.path.dirname(__file__))
if __name__ == '__main__':
    main()
