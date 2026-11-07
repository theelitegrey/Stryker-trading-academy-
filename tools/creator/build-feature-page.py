#!/usr/bin/env python3
"""Builds the <main> of features/creators.html (Creator Hub feature page, v2) and splices it into the page.
Head, nav and footer of the page stay as they are in the file; only <main>, the page CSS/JS links and the OG alt text are rewritten.
Run from the repo root: python3 tools/creator/build-feature-page.py
Images: assets/images/creators/rn/*.webp (made by tools/creator/rn-shots.js + rn-build.py from the live Richard NQ page).
"""
import re, pathlib
ROOT = pathlib.Path(__file__).resolve().parents[2]
PAGE = ROOT / 'features' / 'creators.html'
html = PAGE.read_text()

IC = {
 'users': '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
 'course': '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
 'ind': '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
 'charts': '<path d="M7 3v3M7 17v4M17 3v5M17 15v6"/><rect x="4.5" y="6" width="5" height="11" rx="1"/><rect x="14.5" y="8" width="5" height="7" rx="1"/>',
 'cal': '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
 'msg': '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M9 10h.01M15 10h.01"/>',
 'shield': '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
 'check': '<path d="M20 6L9 17l-5-5"/>',
 'trophy': '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.7V17c0 .6-.5 1-1.1 1.2C7.8 18.8 7 20.2 7 22M14 14.7V17c0 .6.5 1 1.1 1.2 1.1.6 1.9 2 1.9 3.8M18 2H6v7a6 6 0 0 0 12 0z"/>',
 'lock': '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
 'card': '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
 'bank': '<path d="M3 22h18M6 18v-7M10 18v-7M14 18v-7M18 18v-7M12 2l9 5H3z"/>',
 'play': '<path d="M6 4l14 8-14 8z"/>',
 'file': '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>',
 'set': '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
 'user': '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
 'link': '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
 'clock': '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
 'share': '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>',
 'tag': '<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z"/><path d="M7 7h.01"/>',
 'mail': '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7l-10 6L2 7"/>',
 'gift': '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
}
def ico(n, c='ci'):
    return f'<svg class="{c}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">{IC[n]}</svg>'

def img(name, w, h, alt='', cls='', lazy=True, prio=False):
    """theme-aware pair of images (dark + light variants)."""
    a = ' loading="lazy"' if lazy else ' fetchpriority="high"' if prio else ''
    return (f'<img data-fp-nopad class="d-only {cls}" src="/assets/images/creators/rn/{name}-d.webp?v=BUILD" width="{w}" height="{h}" alt="{alt}"{a} decoding="async">'
            f'<img data-fp-nopad class="l-only {cls}" src="/assets/images/creators/rn/{name}-l.webp?v=BUILD" width="{w}" height="{h}" alt="{alt}" loading="lazy" decoding="async">')

def bar(label):
    return (f'<div class="cm-bar"><span class="cm-dots" aria-hidden="true"><i></i><i></i><i></i></span><b>{label}</b>'
            f'<span class="cm-tag">Example community</span></div>')

# ---------------------------------------------------------------- hero
hero = f'''
<header class="cm-hero" id="top">
<div class="cm-w cm-hero-copy">
<span class="cm-kicker cm-in" style="--d:0ms">Creator Hub</span>
<h1 class="cm-in" style="--d:80ms">Build the trading community <em>you wished existed.</em></h1>
<p class="cm-sub cm-in" style="--d:160ms">I built TradeZoro for my own traders. Now you can run yours here: your indicators on ZoroCharts, your courses, your events and your Discord, under your name.</p>
<div class="cm-cta cm-in" style="--d:240ms"><a href="/signup" class="btn btn-primary cm-btn" data-cl-start data-mag>Start your community</a><a href="/c/tradezoro" class="btn btn-ghost cm-btn" data-mag>See an example</a></div>
<p class="cm-fine cm-in" style="--d:300ms">Free to start. 0% platform fee for Founding Creators during launch; Stripe's standard fees apply.</p>
</div>

<div class="cm-w">
<div class="cm-scene" data-scene>
<div class="cm-fl cm-fl-ind" style="--d:900ms"><div class="cm-px" data-depth="14"><figure class="cm-card cm-fc" data-tilt>{img('ind1', 640, 666, 'Richard NQ indicator card: HTF PO3 Lens on a chart')}</figure></div></div>
<div class="cm-fl cm-fl-lesson" style="--d:1050ms"><div class="cm-px" data-depth="22"><div class="cm-card cm-lesson" data-tilt>
<span class="cm-lico">{ico('play')}</span><div><b>Welcome and your first layout</b><span>Lesson 1 · 6 min · Free preview</span><i class="cm-prog"><u></u></i></div></div></div></div>
<div class="cm-fl cm-fl-event" style="--d:1200ms"><div class="cm-px" data-depth="18"><div class="cm-card cm-event" data-tilt>
<span class="cm-lico">{ico('cal')}</span><div><b>Monday market prep</b><span>Weekly session · Example event</span></div><span class="cm-rsvp">RSVP</span></div></div></div>
<div class="cm-fl cm-fl-role" style="--d:1350ms"><div class="cm-px" data-depth="26"><div class="cm-role">{ico('msg')}<span>Discord role</span><b>Member</b>{ico('check','ci cm-ok')}</div></div></div>
<div class="cm-toasts" aria-hidden="true">
<div class="cm-toast">{ico('user')}<div><b>New member joined</b><span>Free plan</span></div></div>
<div class="cm-toast">{ico('card')}<div><b>Payment received</b><span>$19 · Paid plan</span></div></div>
<div class="cm-toast">{ico('check')}<div><b>Course completed</b><span>ZoroCharts Basics</span></div></div>
</div>

<div class="cm-fl cm-fl-main" style="--d:350ms"><div class="cm-px" data-depth="6"><figure class="cm-frame cm-hero-frame" role="img" aria-label="Example Creator Hub community page for Richard NQ: cover, avatar, tabs, about and plan card.">
{bar('tradezoro.com/c/tradezoro')}
<div class="cm-page">
<div class="cm-cover"><img data-fp-nopad src="/assets/images/creators/rn/cover.webp?v=BUILD" width="1080" height="360" alt="" fetchpriority="high" decoding="async"></div>
<div class="cm-head"><span class="cm-av"><img data-fp-nopad src="/assets/images/creators/rn/avatar.webp?v=BUILD" width="256" height="256" alt="" decoding="async"></span>
<div class="cm-title"><b>Richard NQ</b><span>Charts, indicators, a short course and weekly sessions, from the team behind ZoroCharts.</span>
<div class="cm-chips"><i>Futures</i><i>ICT</i><i>Order flow</i></div></div>
<div class="cm-hbtn"><span class="cm-jn">Join</span><span class="cm-sh">{ico('share')}Share</span></div></div>
<div class="cm-tabs"><span class="on">{ico('ind')}About</span><span>{ico('ind')}Indicators</span><span>{ico('course')}Courses</span></div>
<div class="cm-body"><div class="cm-about">{img('about', 640, 596, '', 'cm-fill')}</div><div class="cm-plan">{img('plan', 429, 555, '', 'cm-fill')}</div></div>
</div></figure></div></div>
</div>
<p class="cm-cap">Example community: Richard NQ at tradezoro.com/c/tradezoro. Floating cards are illustrations.</p>
</div>
</header>
'''

# ---------------------------------------------------------------- scroll story
steps = [
 ('Name it', 'Pick a name and a web address, then add a cover and a logo. Your page is live as soon as you save.'),
 ('Show the room', 'Your page counts your courses and indicators for you and lays out the tabs your members use.'),
 ('Add an indicator', 'Upload a Pine script. Members add it to their ZoroCharts chart in one click.'),
 ('Add a course', 'Modules and lessons from video, text and PDF links, with quizzes and drip dates.'),
 ('Add events and a plan', 'Put a session on the calendar and start with a free plan. Paid plans come when you are ready.'),
]
story_steps = ''.join(f'<li data-i="{i}"><span class="cm-sn">{i+1}</span><div><b>{t}</b><p>{d}</p></div></li>' for i, (t, d) in enumerate(steps))
story = f'''
<section class="cm-story" id="build" data-story aria-labelledby="build-h">
<div class="cm-sticky">
<div class="cm-w cm-story-grid">
<div class="cm-story-copy">
<span class="cm-eyebrow">Build your community</span>
<h2 id="build-h">Watch a page come together</h2>
<ol class="cm-steps-list">{story_steps}</ol>
<div class="cm-prog-line" aria-hidden="true"><u data-story-bar></u></div>
</div>
<div class="cm-stage-wrap"><div class="cm-stage" data-stage data-s="0">
<div class="cm-sbar"><span class="cm-dots" aria-hidden="true"><i></i><i></i><i></i></span><b>tradezoro.com/c/tradezoro</b><span class="cm-tag">Example community</span></div>
<div class="cm-spage">
<div class="cm-scover" data-at="0"><img data-fp-nopad src="/assets/images/creators/rn/cover.webp?v=BUILD" width="1080" height="360" alt="" loading="lazy" decoding="async"></div>
<div class="cm-shead">
<span class="cm-sav" data-at="0"><img data-fp-nopad src="/assets/images/creators/rn/avatar.webp?v=BUILD" width="256" height="256" alt="" loading="lazy" decoding="async"></span>
<div class="cm-sname" data-at="0"><b>Richard NQ</b><span>Charts, indicators, a short course and weekly sessions.</span></div>
</div>
<div class="cm-sstats" data-at="1"><div><span class="cm-sic">{ico('course')}</span><b data-count="1">1</b><i>Course</i></div><div><span class="cm-sic">{ico('ind')}</span><b data-count="3">3</b><i>Indicators</i></div></div>
<div class="cm-stabs" data-at="1"><span class="on">About</span><span>Indicators</span><span>Courses</span><u></u></div>
<div class="cm-scards">
<div class="cm-sc cm-sc-ind" data-at="2"><div class="cm-sc-img">{img('ind1', 640, 666)}</div><b>HTF PO3 Lens [TradeZoro]</b><span>{ico('shield')}Protected code</span></div>
<div class="cm-sc cm-sc-course" data-at="3"><b>ZoroCharts Basics</b><span>Getting started · 6 lessons</span><i></i><i></i><i></i></div>
<div class="cm-sc cm-sc-event" data-at="4"><b>Monday market prep</b><span>Weekly session</span><em>RSVP</em></div>
<div class="cm-sc cm-sc-plan" data-at="4"><b>Free</b><span>No charge</span><em>Join free</em></div>
</div>
</div>
</div>
<p class="cm-story-cap" data-story-cap aria-hidden="true"></p>
</div>
</div>
</div>
</section>
'''

# ---------------------------------------------------------------- indicators
indicators = f'''
<section class="cm-sec" id="indicators" aria-labelledby="ind-h">
<div class="cm-w cm-split">
<div class="cm-copy cm-rv">
<span class="cm-eyebrow">{ico('ind')}Indicators on ZoroCharts</span>
<h2 id="ind-h">Your indicator, on your members' charts</h2>
<p>Upload a Pine script, check that it compiles, and choose who gets it: a plan, a free claim, an invite code or one email at a time. Members add it to their chart in one click.</p>
<ul class="cm-list"><li>{ico('lock')}<span>The source stays hidden. Each member gets their own tagged copy.</span></li><li>{ico('shield')}<span>Access is checked every time a chart loads it, so ending a plan ends access.</span></li><li>{ico('set')}<span>Versions, settings notes, screenshots and 7-day usage.</span></li></ul>
</div>
<div class="cm-rv" style="--d:120ms">
<figure class="cm-frame cm-chartfig">
<div class="cm-bar"><span class="cm-dots" aria-hidden="true"><i></i><i></i><i></i></span><b>ZoroCharts</b><span class="cm-tag">Illustration</span></div>
<div class="cm-chart" data-chart role="img" aria-label="Illustration of a candle chart drawing itself, with an indicator marking session levels, a fair value gap and a sweep.">
<svg viewBox="0 0 640 320" width="640" height="320" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
<g class="cm-grid"></g><g class="cm-candles"></g><g class="cm-marks"></g></svg>
<div class="cm-legend"><span><i></i>Session Sweep</span><span><i class="b"></i>Fair value gap</span></div>
</div>
<figcaption>Candles are drawn for illustration. The indicator marks the chart. It does not place or suggest trades.</figcaption>
</figure>
</div>
</div>
<div class="cm-w"><p class="cm-minihead cm-rv">Richard NQ publishes three indicators. Members see them on his page:</p>
<div class="cm-trio">
<figure class="cm-card cm-rv" data-tilt style="--d:0ms">{img('ind1', 640, 666, 'Richard NQ indicator: HTF PO3 Lens')}</figure>
<figure class="cm-card cm-rv" data-tilt style="--d:100ms">{img('ind2', 640, 666, 'Richard NQ indicator: Liquidity Master')}</figure>
<figure class="cm-card cm-rv" data-tilt style="--d:200ms">{img('ind3', 640, 666, 'Richard NQ indicator: Session Sweep, SMT and IFVG')}</figure>
</div></div>
</section>
'''

# ---------------------------------------------------------------- courses
lessons = [('Welcome and your first layout', 'Video · 6 min · Free preview', 'play'), ('Adding indicators to your chart', 'Text lesson', 'file'),
           ('Replay: practise on past sessions', 'Video lesson', 'play'), ('The journal: write the plan first', 'Text lesson with quiz', 'file'),
           ('The GEX levels page', 'Text lesson', 'file'), ('Cheat sheet (PDF)', 'PDF with email watermark', 'file')]
lrows = ''.join(f'<li style="--k:{i}"><span class="cm-lstat"><i class="lk">{ico("lock")}</i><i class="ok">{ico("check")}</i></span><span class="cm-lt">{ico(ic)}<div><b>{t}</b><span>{s}</span></div></span></li>' for i, (t, s, ic) in enumerate(lessons))
courses = f'''
<section class="cm-sec" id="courses" aria-labelledby="co-h">
<div class="cm-w cm-split flip">
<div class="cm-copy cm-rv">
<span class="cm-eyebrow">{ico('course')}Courses</span>
<h2 id="co-h">Teach with courses people can finish</h2>
<p>Build modules and lessons from video, text, PDF and links. Add a quiz, set a drip date, and members see their own progress and where to resume.</p>
<ul class="cm-list"><li>{ico('play')}<span>Video from YouTube, Vimeo or Loom links.</span></li><li>{ico('file')}<span>PDFs open in a viewer with the member's email as a moving watermark.</span></li><li>{ico('clock')}<span>Lock a lesson to a plan, a date or the lesson before it.</span></li></ul>
</div>
<div class="cm-rv" style="--d:120ms">
<figure class="cm-frame">
{bar('ZoroCharts Basics')}
<div class="cm-course" data-course>
<div class="cm-chead"><div><b>ZoroCharts Basics</b><span>Getting started · 6 lessons</span></div><div class="cm-ring"><svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15" class="t"/><circle cx="18" cy="18" r="15" class="f"/></svg><em data-ring-n>0</em></div></div>
<ol class="cm-lessons">{lrows}</ol>
</div>
<figcaption>Lesson titles are from Richard NQ's course. The unlock animation shows how a member moves through it.</figcaption>
</figure>
</div>
</div>
</section>
'''

# ---------------------------------------------------------------- community
def skel(w1, w2):
    return f'<i class="sk" style="width:{w1}%"></i><i class="sk" style="width:{w2}%"></i>'
community = f'''
<section class="cm-sec" id="community" aria-labelledby="cmty-h">
<div class="cm-w">
<div class="cm-head2 cm-rv"><span class="cm-eyebrow">{ico('users')}Community</span><h2 id="cmty-h">Keep the conversation in your room</h2><p>A members-only feed for posts and comments, an events calendar with RSVPs, and a leaderboard that shows who is most active. You can pin posts and remove anything that breaks your rules.</p></div>
<div class="cm-tri">
<div class="cm-card cm-pad cm-rv" data-tilt style="--d:0ms"><div class="cm-ch">{ico('msg')}<b>Feed</b></div>
<div class="cm-post"><span class="cm-ini">R</span><div>{skel(60,90)}</div></div>
<div class="cm-post"><span class="cm-ini a">A</span><div>{skel(45,80)}</div></div>
<div class="cm-post"><span class="cm-ini b">J</span><div>{skel(55,70)}</div></div>
<p class="cm-note">Pinned posts, comments, and moderation tools for you and your team.</p></div>
<div class="cm-card cm-pad cm-rv" data-tilt style="--d:100ms"><div class="cm-ch">{ico('cal')}<b>Events</b></div>
<div class="cm-ev"><span class="cm-date"><b>Mon</b><i>Weekly</i></span><div><b>Monday market prep</b><span>Time, link and a going count</span></div><em class="cm-rsvp">RSVP</em></div>
<div class="cm-ev"><span class="cm-date"><b>Wk</b><i>Weekly</i></span><div><b>Replay One practice</b><span>Practice session</span></div><em class="cm-rsvp on">Going</em></div>
<p class="cm-note">Both are weekly sessions listed on Richard NQ's page.</p></div>
<div class="cm-card cm-pad cm-rv" data-tilt style="--d:200ms"><div class="cm-ch">{ico('trophy')}<b>Leaderboard</b></div>
<div class="cm-lb"><span class="cm-ini">A</span><i class="bar" style="--w:92%"></i></div>
<div class="cm-lb"><span class="cm-ini b">B</span><i class="bar" style="--w:74%"></i></div>
<div class="cm-lb"><span class="cm-ini c">C</span><i class="bar" style="--w:58%"></i></div>
<div class="cm-lb"><span class="cm-ini d">D</span><i class="bar" style="--w:40%"></i></div>
<p class="cm-note">Counts activity only. It is not a trading ranking.</p></div>
</div>
<p class="cm-cap">Illustration with placeholder initials.</p>
</div>
</section>
'''

# ---------------------------------------------------------------- discord
discord = f'''
<section class="cm-sec" id="discord" aria-labelledby="dc-h">
<div class="cm-w cm-split">
<div class="cm-copy cm-rv">
<span class="cm-eyebrow">{ico('msg')}Discord</span>
<h2 id="dc-h">Discord roles that follow the plan</h2>
<p>Connect your Discord server once and pick a role for each plan. Members link their Discord, get the role, and lose it when their membership ends. No manual role handing.</p>
<ul class="cm-list"><li>{ico('shield')}<span>TradeZoro sees only the member's Discord name and ID.</span></li><li>{ico('link')}<span>Members can unlink any time.</span></li><li>{ico('set')}<span>You keep running your server your way.</span></li></ul>
</div>
<div class="cm-rv" style="--d:120ms">
<figure class="cm-card cm-flow cm-dflow" data-flow="discord" role="img" aria-label="Diagram: a member joins a plan, links Discord, and the role appears. When the plan ends, the role goes away.">
<svg viewBox="0 0 560 200" width="560" height="200" aria-hidden="true" focusable="false">
<path id="dpath" class="cm-path" d="M96 100 H464" />
<path class="cm-path run" d="M96 100 H464" pathLength="1"/>
<circle class="cm-dot" r="6"><animateMotion dur="3.2s" repeatCount="indefinite" calcMode="spline" keyTimes="0;1" keySplines=".4 0 .2 1"><mpath href="#dpath"/></animateMotion></circle>
<g class="cm-node" transform="translate(48 100)"><circle r="40"/><g transform="translate(-14 -14) scale(1.17)">{IC['user']}</g></g>
<g class="cm-node mid" transform="translate(280 100)"><circle r="40"/><g transform="translate(-14 -14) scale(1.17)">{IC['link']}</g></g>
<g class="cm-node end" transform="translate(512 100)"><circle r="40"/><g transform="translate(-14 -14) scale(1.17)">{IC['msg']}</g></g>
</svg>
<div class="cm-flowlab"><span><b>Member joins</b>Picks a plan</span><span><b>Links Discord</b>One sign-in</span><span><b>Role appears</b><em class="cm-chip">Member</em></span></div>
</figure>
</div>
</div>
</section>
'''

# ---------------------------------------------------------------- payments
payments = f'''
<section class="cm-sec" id="payments" aria-labelledby="pay-h">
<div class="cm-w">
<div class="cm-head2 cm-rv"><span class="cm-eyebrow">{ico('card')}Paid plans with Stripe</span><h2 id="pay-h">Members pay you directly</h2><p>Charge monthly, yearly or one-time. Payouts go to your bank on Stripe's normal schedule. You sell as an independent creator, and you handle refunds and taxes.</p></div>
<figure class="cm-card cm-flow cm-pflow cm-rv" data-flow="pay" role="img" aria-label="Diagram: member pays, Stripe processes the payment, payout goes to the creator's bank on Stripe's normal schedule.">
<svg viewBox="0 0 760 200" width="760" height="200" aria-hidden="true" focusable="false">
<path id="ppath" class="cm-path" d="M90 100 H670"/>
<path class="cm-path run" d="M90 100 H670" pathLength="1"/>
<circle class="cm-dot" r="6"><animateMotion dur="4s" repeatCount="indefinite" calcMode="spline" keyTimes="0;1" keySplines=".4 0 .2 1"><mpath href="#ppath"/></animateMotion></circle>
<g class="cm-node" transform="translate(50 100)"><circle r="40"/><g transform="translate(-14 -14) scale(1.17)">{IC['user']}</g></g>
<g class="cm-node mid" transform="translate(380 100)"><circle r="40"/><g transform="translate(-14 -14) scale(1.17)">{IC['card']}</g></g>
<g class="cm-node end" transform="translate(710 100)"><circle r="40"/><g transform="translate(-14 -14) scale(1.17)">{IC['bank']}</g></g>
</svg>
<div class="cm-flowlab three"><span><b>Member pays</b>On your plan page</span><span><b>Stripe</b>Checks and processes</span><span><b>Your bank</b>Stripe's normal schedule</span></div>
</figure>
<div class="cm-two">
<div class="cm-card cm-pad cm-fee cm-rv"><span class="cm-chip">Founding Creators</span><div class="cm-reel" data-reel aria-label="0 percent"><span class="cm-digits" aria-hidden="true"><span class="cm-col"><i>9</i><i>8</i><i>7</i><i>6</i><i>5</i><i>4</i><i>3</i><i>2</i><i>1</i><i>0</i></span></span><span class="cm-pct" aria-hidden="true">%</span></div><h3>TradeZoro platform fee, during launch</h3><p>0% platform fee for Founding Creators during launch; Stripe's standard fees apply. They come out of your sales. <a href="https://stripe.com/pricing" target="_blank" rel="noopener">See Stripe pricing</a>.</p></div>
<div class="cm-card cm-pad cm-rv" style="--d:100ms"><span class="cm-chip">Richard NQ's plan card</span><div class="cm-planshot">{img('plan', 429, 555, 'Richard NQ plan card: Free plan with Join free button')}</div><p class="cm-note">Start with a free plan and add paid plans later. Stripe is only available in some countries; the setup screen shows whether yours is covered.</p></div>
</div>
<p class="cm-legal cm-rv">Payments by Stripe. TradeZoro is operated by <span data-legal-name>TradeZoro LLC</span>.</p>
</div>
</section>
'''

# ---------------------------------------------------------------- dashboard
tabs = [('Dashboard', 'charts'), ('Settings', 'set'), ('Plans', 'tag'), ('Members', 'users'), ('Invites', 'mail'), ('Indicators', 'ind'), ('Courses', 'course'), ('Discord', 'msg'), ('Moderators', 'shield')]
tab_html = ''.join(f'<li data-t="{i}"{" class=on" if i==0 else ""}>{ico(ic)}<span>{n}</span></li>' for i, (n, ic) in enumerate(tabs))
dash = f'''
<section class="cm-sec" id="dashboard" aria-labelledby="db-h">
<div class="cm-w cm-split flip">
<div class="cm-copy cm-rv">
<span class="cm-eyebrow">{ico('set')}Creator dashboard</span>
<h2 id="db-h">Run it all from one place</h2>
<p>Inside the app you manage your plans, members, invites, indicators, courses, Discord and moderators from the Creator Hub. It works on your phone as well as on a desktop.</p>
<ul class="cm-list"><li>{ico('tag')}<span>Free, paid or invite-only plans.</span></li><li>{ico('mail')}<span>Invite links and codes, and member import.</span></li><li>{ico('shield')}<span>Moderators to help you run the room.</span></li></ul>
</div>
<div class="cm-rv" style="--d:120ms">
<figure class="cm-frame">
<div class="cm-bar"><span class="cm-dots" aria-hidden="true"><i></i><i></i><i></i></span><b>Creator Hub</b><span class="cm-tag">Illustration</span></div>
<div class="cm-app" data-app role="img" aria-label="Illustration of the Creator Hub dashboard with its tabs: Dashboard, Settings, Plans, Members, Invites, Indicators, Courses, Discord and Moderators.">
<ul class="cm-side">{tab_html}</ul>
<div class="cm-main"><div class="cm-mh"><i class="sk" style="width:38%"></i><i class="sk s" style="width:22%"></i></div>
<div class="cm-tiles"><div><i class="sk" style="width:50%"></i><i class="sk b" style="width:70%"></i></div><div><i class="sk" style="width:45%"></i><i class="sk b" style="width:60%"></i></div><div><i class="sk" style="width:55%"></i><i class="sk b" style="width:66%"></i></div></div>
<div class="cm-rows"><i class="sk"></i><i class="sk" style="width:86%"></i><i class="sk" style="width:94%"></i><i class="sk" style="width:72%"></i></div></div>
</div>
<figcaption>Illustration of the layout. No real data is shown.</figcaption>
</figure>
</div>
</div>
</section>
'''

# ---------------------------------------------------------------- steps
how = f'''
<section class="cm-sec" id="how-it-works" aria-labelledby="how-h">
<div class="cm-w">
<div class="cm-head2 cm-rv"><span class="cm-eyebrow">How it works</span><h2 id="how-h">Set up on your phone in a few minutes</h2></div>
<ol class="cm-3">
<li class="cm-card cm-pad cm-rv"><span class="cm-num">1</span><h3>Name it</h3><p>Sign in, pick a name and a web address like tradezoro.com/c/your-name, and add a logo and cover.</p></li>
<li class="cm-card cm-pad cm-rv" style="--d:100ms"><span class="cm-num">2</span><h3>Add your plans</h3><p>Start with a free plan, or add a paid one. Then add an indicator, a course or an event when you are ready.</p></li>
<li class="cm-card cm-pad cm-rv" style="--d:200ms"><span class="cm-num">3</span><h3>Share your link</h3><p>Send it to your audience, or use invite links and codes. Manage members, plans and content in the Creator Hub.</p></li>
</ol>
</div>
</section>
'''

faq_items = ''.join(re.findall(r'<details>.*?</details>', html, re.S))
faq = f'''
<section class="cm-sec" id="faq" aria-labelledby="faq-h">
<div class="cm-w"><div class="cm-head2 cm-rv"><span class="cm-eyebrow">Questions</span><h2 id="faq-h">Before you start</h2></div>
<div class="fg-faq cm-faq cm-rv">{faq_items}</div></div>
</section>
'''

cta = '''
<section class="cm-sec cm-last" aria-labelledby="end-h">
<div class="cm-w"><div class="cm-final cm-rv"><h2 id="end-h">Start your community today</h2><p>Pick a name, add a free plan and share your link. You can add indicators, courses and paid plans as you go.</p>
<div class="cm-cta"><a href="/signup" class="btn btn-primary cm-btn" data-cl-start data-mag>Start your community</a><a href="/c/tradezoro" class="btn btn-ghost cm-btn" data-mag>See an example</a></div>
<p class="cm-edu">Education only. Not financial advice. Communities are run by independent creators.</p></div></div>
</section>
'''

main = '<main id="main" tabindex="-1" class="cm-main-page">\n<div class="cm-scroll" aria-hidden="true"><u data-scroll-bar></u></div>' + hero + story + indicators + courses + community + discord + payments + dash + how + faq + cta + '\n</main>'

# ---------------------------------------------------------------- splice
build = re.search(r'name="stryker-build" content="(\d+)"', html).group(1)
main = main.replace('BUILD', build)
html = re.sub(r'<main id="main".*?</main>', lambda m: main, html, flags=re.S)
html = html.replace('<body class="fp-page cl-page"', '<body class="fp-page cm-page"')
# head: preload + css
html = re.sub(r'<link rel="preload" as="image" href="/assets/images/creators/hero-1440[^>]*>\n<link rel="preload" as="image" href="/assets/images/creators/hero-390[^>]*>',
              f'<link rel="preload" as="image" href="/assets/images/creators/rn/cover.webp?v={build}" fetchpriority="high">', html)
html = html.replace('og:image:alt" content="Creator Hub share card: a demo community page with plans, with the TradeZoro logo"',
                    'og:image:alt" content="Creator Hub share card: the Richard NQ example community page with the TradeZoro logo"')
html = html.replace('twitter:image:alt" content="Creator Hub share card: a demo community page with plans, with the TradeZoro logo"',
                    'twitter:image:alt" content="Creator Hub share card: the Richard NQ example community page with the TradeZoro logo"')
# scripts: replace features.js with the motion script, add legal-name filler
html = re.sub(r'<script src="/assets/features.js\?v=\d+"></script>\n', '', html)
if 'creator-legal.js' not in html:
    html = html.replace('<script src="/assets/creator-landing.js', '<script src="/assets/creator-legal.js?v=%s"></script>\n<script src="/assets/creator-landing.js' % build)
if 'creators-motion.js' not in html:
    html = html.replace('<script src="/assets/theme.js', '<script src="/assets/creators-motion.js?v=%s" defer></script>\n<script src="/assets/theme.js' % build)
PAGE.write_text(html)
print('ok', len(html))
