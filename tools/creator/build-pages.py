#!/usr/bin/env python3
"""Generates the Creator Hub HTML pages from the Help Center page shell (nav, footer, head), so they stay in step with the site chrome.
Run from the repo root:  python3 tools/creator/build-pages.py   (reads help.html + courses.html, writes creators/creator-new/c/creator/communities/creator-admin/creator-rules .html)
Re-run after a build bump only if the shell changes; the bump script rewrites ?v= in the generated files like any other page."""
import re, html, json
V = json.load(open('assets/version.json'))['build']
help_ = open('help.html', encoding='utf-8').read()
courses = open('courses.html', encoding='utf-8').read()
dock = re.search(r'<nav class="appnav-dock".*?</nav>\n<script src="assets/app-nav.js\?v=\d+"></script>', courses, re.S).group(0)
head_end = help_.index('<!--HELP-JSONLD-->')
head_a = help_[:head_end]
head_b = help_[help_.index('<!--/HELP-JSONLD-->') + len('<!--/HELP-JSONLD-->'):help_.index('</head>')]
nav = help_[help_.index('<nav class="nav" id="site-nav">'):help_.index('<main id="main"')]
footer = help_[help_.index('<footer>'):help_.index('</footer>') + 9]
FB = '''<script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore-compat.js"></script>
{storage}<script src="/assets/auth.js?v=%d"></script>
<script src="/assets/progress.js?v=%d"></script>
<script src="/assets/banned-check.js?v=%d"></script>
<script src="/assets/email-verify.js?v=%d"></script>
<script src="/assets/branding.js?v=%d"></script>
{extra}<script src="/assets/creator-config.js?v=%d"></script>
<script src="/assets/creator.js?v=%d"></script>
{page}<script src="/assets/theme.js?v=%d"></script>
<script src="/assets/nav-features.js?v=%d" defer></script>
<script src="/assets/main.js?v=%d"></script>''' % ((V,) * 10)

def page(fname, key, title, desc, body, scripts, storage=False, admin=False, jsfile=None):
    h = head_a
    h = re.sub(r'<meta name="description"[^>]*>\n', '<meta name="description" content="%s">\n<meta name="robots" content="noindex, nofollow">\n' % html.escape(desc, quote=True), h, count=1)
    h = re.sub(r'<meta property="og:[^>]*>\n|<meta name="twitter:[^>]*>\n|<link rel="canonical"[^>]*>\n', '', h)
    h = re.sub(r'<title>.*?</title>', '<title>%s — TradeZoro</title>' % html.escape(title), h, count=1)
    h = re.sub(r'<link rel="stylesheet" href="assets/help.css\?v=\d+">\n', '', h)
    h = re.sub(r'<link rel="preload" href="/assets/help/help-data.json[^>]*>\n', '', h)
    h = re.sub(r'<noscript>.*?</noscript>\n', '', h, flags=re.S)
    tail = head_b.replace('<link rel="stylesheet" href="assets/help.css?v=%d">' % V, '')
    css = '<link rel="stylesheet" href="assets/creator.css?v=%d">\n' % V
    out = h + tail.replace('</head>', '') + css + '</head>\n<body data-page-key="%s" class="cx-page">\n<a class="skip-link" href="#main">Skip to content</a>\n' % key
    out += dock + '\n' + nav + '<main id="main" tabindex="-1">\n<div class="cx-wrap">\n' + body + '\n</div>\n</main>\n' + footer + '\n\n'
    out += FB.format(storage='<script src="https://www.gstatic.com/firebasejs/10.14.1/firebase-storage-compat.js"></script>\n' if storage else '',
                     extra='<script src="/assets/admin-guard.js?v=%d"></script>\n' % V if admin else '', page=scripts)
    out += '\n</body>\n</html>\n'
    # absolute paths so the pages also work under /c/<slug>
    out = re.sub(r'(href|src|srcset)="(?!https?:|/|#|mailto:|data:)([^"]*)"', lambda m: '%s="/%s"' % (m.group(1), m.group(2)), out)
    out = out.replace('href="//"', 'href="/"').replace('href="/#', 'href="/#')
    open(fname, 'w', encoding='utf-8').write(out)

S = lambda f: '<script src="/assets/%s?v=%d"></script>\n' % (f, V)

# ---------------------------------------------------------------- /creators
# NOTE: the public landing moved to features/creators.html (hand-written, 2026-10-30). Do not regenerate creators.html from here;
# the call below is kept only as the old template and its output is deleted by the line after the pages are built.
page('creators.html', 'creators', 'Creator Hub: start your own trading community',
     'Start a community on TradeZoro: free communities, invite links and member import today. Paid plans, indicators that run on ZoroCharts, courses and Discord roles are coming.', '''
<section class="cx-hero">
  <p class="cx-eyebrow">Creator Hub</p>
  <h1>Start your own trading community on TradeZoro</h1>
  <p class="lede">Give your members one place for your content, your plans and your people. Free to start, and set up on your phone in a few minutes.</p>
  <div class="cx-offer"><div><b>Founding Creators: 0% TradeZoro fee during launch</b><span class="cx-muted">Payment-processor fees will apply once paid checkout opens.</span></div></div>
  <p class="cx-note"><b>Paid checkout opens soon.</b> Start free communities, invite links and member import today.</p>
  <div class="cx-row"><button class="btn btn-primary" id="cx-start" type="button">Start your community</button><a class="btn btn-ghost" href="/communities">Browse communities</a></div>
</section>
<section>
  <h2>What you can do</h2>
  <div class="cx-grid">
    <div class="cx-box"><h3>Run a community</h3><p class="cx-muted">Your own page at tradezoro.com/c/your-name with a cover, logo, intro video, about section and member count.</p></div>
    <div class="cx-box"><h3>Offer plans</h3><p class="cx-muted">Create free plans today. Set prices on paid plans now and they go live when paid checkout opens. <span class="cx-soon">Paid checkout soon</span></p></div>
    <div class="cx-box"><h3>Invite and import</h3><p class="cx-muted">Share invite links and codes with a use limit and an expiry, or add members in bulk by email.</p></div>
    <div class="cx-box"><h3>Sell indicators</h3><p class="cx-muted">Publish a Pine indicator that runs on ZoroCharts and choose who gets access. <span class="cx-soon">Coming soon</span></p></div>
    <div class="cx-box"><h3>Sell courses</h3><p class="cx-muted">Chapters of text, links and video embeds, kept for your members. <span class="cx-soon">Coming soon</span></p></div>
    <div class="cx-box"><h3>Discord roles</h3><p class="cx-muted">Give paying members a role in your Discord server. <span class="cx-soon">Coming soon</span></p></div>
  </div>
</section>
<section style="margin-top:26px">
  <h2>How it works</h2>
  <ol class="cx-muted" style="line-height:1.8;padding-left:20px"><li>Sign in and pick a name and web address for your community.</li><li>Add a logo, cover, tagline and an intro video link.</li><li>Create your first plan: free, or a priced plan saved as a draft.</li><li>Share your link. Manage members, invites and plans in the Creator Hub.</li></ol>
  <p class="cx-muted">You run an independent community. TradeZoro does not verify creators or their claims. Read the <a href="/creator-rules" style="color:var(--gold-bright)">Creator Rules</a> first.</p>
</section>''', S('creator-landing.js'))

# ---------------------------------------------------------------- /creator-new
page('creator-new.html', 'creator-new', 'Create your community', 'Create a TradeZoro community in three short steps.', '''
<p class="cx-eyebrow">Creator Hub</p><h1>Create your community</h1>
<div class="cx-steps" id="cn-steps"><span class="on"></span><span></span><span></span></div>
<div id="cn-gate" class="cx-empty">Loading…</div>
<form id="cn-form" class="cx-f" hidden novalidate>
  <section data-step="1">
    <h2>1. Name and address</h2>
    <div><label for="cn-name">Community name</label><input id="cn-name" type="text" maxlength="50" autocomplete="off" placeholder="e.g. Alpha Desk"></div>
    <div><label for="cn-slug">Web address</label><input id="cn-slug" type="text" maxlength="30" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="alpha-desk"><div class="hint">tradezoro.com/c/<b id="cn-slugshow">your-name</b> <span id="cn-avail"></span></div></div>
    <div><label>Topics (up to 3)</label><div class="cx-pick" id="cn-tags"></div></div>
  </section>
  <section data-step="2" hidden>
    <h2>2. Look</h2>
    <div><label for="cn-tagline">Tagline</label><input id="cn-tagline" type="text" maxlength="100" placeholder="One line about your community"></div>
    <div><label for="cn-about">About</label><textarea id="cn-about" maxlength="4000" placeholder="What members get and how you run things"></textarea></div>
    <div><label for="cn-logo">Logo (image, up to 5 MB)</label><input id="cn-logo" type="file" accept="image/png,image/jpeg,image/webp"><img id="cn-logo-p" class="cx-prev" alt="" hidden style="max-width:96px;max-height:96px"></div>
    <div><label for="cn-cover">Cover (image, up to 5 MB)</label><input id="cn-cover" type="file" accept="image/png,image/jpeg,image/webp"><img id="cn-cover-p" class="cx-prev" alt="" hidden></div>
    <div><label for="cn-accent">Accent colour</label><input id="cn-accent" type="color" value="#03c988"></div>
    <div><label for="cn-video">Intro video link (YouTube, Vimeo or Loom)</label><input id="cn-video" type="url" placeholder="https://"><div class="hint" id="cn-video-h"></div></div>
  </section>
  <section data-step="3" hidden>
    <h2>3. First plan</h2>
    <div class="cx-pick" id="cn-ptype"><label><input type="radio" name="ptype" value="free" checked> Free</label><label><input type="radio" name="ptype" value="paid"> Priced plan (saved as a draft)</label></div>
    <div><label for="cn-pname">Plan name</label><input id="cn-pname" type="text" maxlength="40" value="Free"></div>
    <div id="cn-paid" hidden>
      <div class="cx-row"><div style="flex:1 1 120px"><label for="cn-pamt">Price</label><input id="cn-pamt" type="number" min="1" max="100000" step="1" inputmode="numeric"></div>
      <div style="flex:1 1 100px"><label for="cn-pcur">Currency</label><select id="cn-pcur"><option>USD</option><option>INR</option></select></div>
      <div style="flex:1 1 120px"><label for="cn-pint">Every</label><select id="cn-pint"><option value="month">month</option><option value="week">week</option><option value="year">year</option><option value="lifetime">once (lifetime)</option></select></div></div>
      <p class="cx-note" style="margin-top:12px"><b>Paid checkout opens soon.</b> This plan is saved as a draft with its price. Members cannot buy it yet; you can still give access by invite or by email.</p>
    </div>
    <div><label for="cn-pdesc">Short description</label><textarea id="cn-pdesc" maxlength="300" style="min-height:70px"></textarea></div>
    <label class="cx-check"><input type="checkbox" id="cn-rules"><span>I agree to the <a href="/creator-rules" target="_blank" rel="noopener" style="color:var(--gold-bright)">Creator Rules</a>. I am 18 or older and responsible for what I post and claim.</span></label>
    <p class="hint" style="margin:0">Founding Creators: 0% TradeZoro fee during launch.</p>
  </section>
  <div id="cn-err" class="cx-bad" role="alert"></div>
  <div class="cx-actions"><button type="button" class="btn btn-ghost" id="cn-back" hidden>Back</button><button type="button" class="btn btn-primary" id="cn-next">Next</button></div>
</form>''', S('creator-new.js'), storage=True)

# ---------------------------------------------------------------- /c/<slug>
page('c.html', 'community', 'Community', 'A community on TradeZoro.', '''
<div id="cm-root"><div class="cx-empty">Loading…</div></div>''', S('creator-c.js'))

# ---------------------------------------------------------------- /communities
page('communities.html', 'communities', 'Communities', 'Find communities run by independent creators on TradeZoro.', '''
<p class="cx-eyebrow">Communities</p><h1>Find your community</h1>
<p class="cx-muted">Run by independent creators, not by TradeZoro. <a href="/creators" style="color:var(--gold-bright)">Start your own</a>.</p>
<div class="cx-tabs" id="cd-tabs" hidden><button type="button" class="on" data-t="all">All communities</button><button type="button" data-t="mine">My communities</button></div>
<div class="cx-search"><input class="cx-in" id="cd-q" type="search" placeholder="Search by name or tagline" aria-label="Search communities"><select class="cx-in-s" id="cd-sort" aria-label="Sort"><option value="new">Newest</option><option value="members">Most members</option></select></div>
<div class="cx-row" id="cd-tags" style="margin-bottom:16px"></div>
<div class="cx-grid" id="cd-grid"></div><div id="cd-empty" class="cx-empty" hidden></div>''', S('creator-dir.js'))

# ---------------------------------------------------------------- /creator (hub)
page('creator.html', 'creator', 'Creator Hub', 'Manage your TradeZoro communities.', '''
<div id="hb-root"><div class="cx-empty">Loading…</div></div>''', S('creator-hub.js'), storage=True)

# ---------------------------------------------------------------- staff moderation
page('creator-admin.html', 'creator-admin', 'Creator moderation (staff)', 'TradeZoro staff: suspend communities and review reports.', '''
<p class="cx-eyebrow">Staff</p><h1>Creator moderation</h1>
<div class="cx-tabs"><button type="button" class="on" data-t="cm">Communities</button><button type="button" data-t="rp">Reports</button></div>
<div id="ad-root"><div class="cx-empty">Checking access…</div></div>''', S('creator-staff.js'), admin=True)

# ---------------------------------------------------------------- /creator-rules
md = open('creator-rules.md', encoding='utf-8').read()
def inline(t):
    t = html.escape(t, quote=False)
    t = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', t)
    t = re.sub(r'\[([^\]]+)\]\((/[^)]*)\)', r'<a href="\2">\1</a>', t)
    t = t.replace('{{legal}}', '<span data-legal-name>Gaurav Singh LLC</span>')   # live value: assets/creator-legal.js
    return t
out, ul = [], False
for line in md.splitlines():
    if line.startswith('- '):
        if not ul: out.append('<ul>'); ul = True
        out.append('<li>%s</li>' % inline(line[2:])); continue
    if ul: out.append('</ul>'); ul = False
    if line.startswith('## '): out.append('<h2>%s</h2>' % inline(line[3:]))
    elif line.startswith('# '): out.append('<h1>%s</h1>' % inline(line[2:]))
    elif line.strip(): out.append('<p>%s</p>' % inline(line))
if ul: out.append('</ul>')
page('creator-rules.html', 'creator-rules', 'Creator Rules', 'The rules for creators and communities on TradeZoro.', '<div class="cx-md">' + '\n'.join(out) + '</div>', S('creator-legal.js'))
print('built 7 pages, build', V)

import os as _os
if _os.path.exists('creators.html'): _os.remove('creators.html')  # superseded by features/creators.html
