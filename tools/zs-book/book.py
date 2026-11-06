"""The Zscript Book: assemble one HTML from the same sources, render PDF with WeasyPrint."""
import html, os, re

esc = html.escape

CSS = r'''
@page { size: A5; margin: 18mm 14mm 20mm 14mm;
  @bottom-center { content: counter(page); font: 8pt -apple-system, "Helvetica Neue", Arial, sans-serif; color: #666; }
  @top-center { content: string(chap); font: 8pt -apple-system, "Helvetica Neue", Arial, sans-serif; color: #888; } }
@page cover { margin: 0; @bottom-center { content: none } @top-center { content: none } }
@page blank { @bottom-center { content: none } @top-center { content: none } }
html { font: 10pt/1.5 "Helvetica Neue", Arial, "DejaVu Sans", sans-serif; color: #1d1d1f; }
h1 { string-set: chap content(); font-size: 22pt; line-height: 1.15; margin: 0 0 4mm; break-before: page; color: #07140f; }
h2 { font-size: 14pt; margin: 8mm 0 2mm; break-after: avoid; color: #07140f; }
h3 { font-size: 11pt; margin: 6mm 0 1.5mm; break-after: avoid; }
p, li { orphans: 3; widows: 3; }
a { color: #02805a; text-decoration: none; }
code { font: 8.4pt "DejaVu Sans Mono", Menlo, monospace; background: #f1f3f2; padding: 0 1mm; border-radius: 1mm; }
pre.zs-code { font: 7.6pt/1.45 "DejaVu Sans Mono", Menlo, monospace; background: #0b0b0d; color: #e8ece9; padding: 3mm 3.5mm;
  border-radius: 2.5mm; white-space: pre-wrap; word-break: break-word; break-inside: avoid; margin: 3mm 0 4mm; }
pre.zs-code code { background: none; padding: 0; font: inherit; }
.k { color: #6fd6ff } .t { color: #c9a7ff } .n { color: #4fe3ac } .f { color: #ffd479 } .b { color: #ff9eb1 } .c { color: #7d877f } .s { color: #ffb86b } .m { color: #9ee493 }
table { border-collapse: collapse; width: 100%; font-size: 8.4pt; margin: 3mm 0; break-inside: avoid; }
th, td { border-bottom: 0.3mm solid #d6dad8; padding: 1.2mm 1.5mm; text-align: left; vertical-align: top; }
th { background: #eef2f0; }
figure.zs-fig { margin: 4mm 0; break-inside: avoid; } figure.zs-fig svg { width: 100%; height: auto; }
figcaption { font-size: 8pt; color: #555; margin-top: 1mm; }
.zs-ref { break-inside: avoid-page; border-top: 0.3mm solid #d6dad8; margin-top: 3mm; }
.part { break-before: page; page: blank; display: flex; }
.part h1 { break-before: auto; margin-top: 60mm; font-size: 30pt; color: #02805a; }
.cover { page: cover; break-after: page; height: 210mm; width: 148mm; background: #050506; color: #fff; position: relative; }
.cover .tag { position: absolute; left: 14mm; top: 20mm; font: 700 10pt "DejaVu Sans Mono", monospace; color: #03c988; letter-spacing: .2em; }
.cover h1 { position: absolute; left: 14mm; top: 70mm; width: 118mm; font-size: 40pt; line-height: 1.05; color: #fff; break-before: auto; string-set: none; }
.cover .sub { position: absolute; left: 14mm; top: 128mm; width: 110mm; font-size: 12pt; color: rgba(255,255,255,.7); }
.cover .bar { position: absolute; left: 14mm; top: 120mm; width: 22mm; height: 1.2mm; background: #03c988; }
.cover .foot { position: absolute; left: 14mm; bottom: 14mm; font-size: 8pt; color: rgba(255,255,255,.5); }
.toc { page: blank; break-after: page; } .toc h1 { string-set: none; }
.toc ol { list-style: none; padding: 0; margin: 0; } .toc li { margin: 1mm 0; } .toc li.p { font-weight: 700; margin-top: 4mm; }
.toc a::after { content: leader('.') target-counter(attr(href), page); color: #666; } .toc a { color: #1d1d1f; display: block; }
.legal { font-size: 8pt; color: #555; }
'''

def build(root, src, out, manual, cook, refs, hl, do_pdf, ctx, course=None):
    os.makedirs(out, exist_ok=True)
    parts = []   # (part title, [(id, title, html)])
    parts.append(('Part 1. The language', [('m-' + m['slug'], m['title'], m['html']) for m in manual]))
    if refs:
        parts.append(('Part 2. Reference', [('r-' + r['slug'], r['title'], '<p>%s</p>' % esc(r['dek']) + r['html']) for r in refs]))
    parts.append(('Part 3. Cookbook', [('c-' + c['slug'], c['title'], '<p><em>%s</em></p>' % esc(c.get('dek', '')) + c['html']) for c in cook]))

    toc = ['<section class="toc"><h1>Contents</h1><ol>']
    body = []
    for pt, chs in parts:
        toc.append('<li class="p">%s</li>' % esc(pt))
        body.append('<section class="part"><h1>%s</h1></section>' % esc(pt))
        for cid, title, h in chs:
            toc.append('<li><a href="#%s">%s</a></li>' % (cid, esc(title)))
            body.append('<section id="%s"><h1>%s</h1>%s</section>' % (cid, esc(title), h))
    toc.append('</ol></section>')
    cover = ('<section class="cover"><div class="tag">ZSCRIPT</div><h1>The Zscript Book</h1><div class="bar"></div>'
             '<div class="sub">Write your own chart indicators, from your first plot to order book and options data.</div>'
             '<div class="foot">TradeZoro &middot; Education only. Not financial advice.</div></section>')
    legal = ('<section class="legal" style="page:blank;break-after:page"><p>The Zscript Book. &copy; TradeZoro. All rights reserved.</p>'
             '<p>Education only. Not financial advice. Every script in this book is a teaching sample, not a trading result, '
             'and none of it promises profit. Data features depend on your plan.</p>'
             '<p>If you know other chart scripting languages, Zscript will feel familiar.</p></section>')
    doc = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>The Zscript Book</title><style>%s</style></head><body>%s%s%s%s</body></html>' % (
        CSS, cover, legal, ''.join(toc), ''.join(body))
    p = os.path.join(out, 'book.html')
    open(p, 'w').write(doc)
    if do_pdf:
        from weasyprint import HTML
        dest = os.path.join(root, 'assets/zscript/The-Zscript-Book.pdf')
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        d = HTML(string=doc, base_url=root).render()
        d.write_pdf(dest)
        print('PDF pages:', len(d.pages), '->', dest)
