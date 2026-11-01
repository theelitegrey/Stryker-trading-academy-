#!/usr/bin/env python3
"""Copy + layout for the five feature pages and the hub. Run: python3 tools/gen-feature-pages-b.py [slug ...]"""
import sys, importlib.util, os
spec = importlib.util.spec_from_file_location('g', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'gen-feature-pages-b.py'))
g = importlib.util.module_from_spec(spec); spec.loader.exec_module(g)
from_g = g.__dict__
globals().update({k: v for k, v in from_g.items() if not k.startswith('__')})
EDU = 'Education only. Not financial advice.'
SIGN = btn('/signup', 'Create a free account') if False else None
def cta(open_href, open_label): return btn(open_href, open_label) + btn('/signup', 'Start free', False)
DONE = sys.argv[1:] or ['curriculum', 'models', 'indicators', 'community', 'live-sessions', '_hub']

# ------------------------------------------------------------------ curriculum
if 'curriculum' in DONE:
    P = dict(kicker='The Curriculum', h1='Learn ICT and SMT in order, <em>chapter by chapter.</em>',
      sub='64 written chapters on ICT concepts and SMT divergence, with chart diagrams and a checklist for every lesson. Your place is saved, so you always know what to open next.',
      cta=cta('/courses', 'Open the curriculum'), fine=f'All 64 chapters are free with an account. {EDU}',
      bar='Courses · Curriculum', hero='cur-courses', hero_alt='The Courses page in the dark theme: filter tabs for Foundation, Intermediate, Advanced and Specialist tracks, a Continue learning card and the first chapters of Part I.',
      phone='cur-phone', phone_alt='The same Courses page on a phone, with the chapter filters and a Continue learning card.',
      cards=[('book', 'Chapter 5 saved', 'Resume where you stopped'), ('list', 'Foundation', '7 chapters, in order'), ('trophy', 'Badge unlocked', 'First chapter complete'), ('check', 'Lesson done', 'Tick it off in the reader')],
      story_eyebrow='A path, not a playlist', story_h='From the first candle to a full playbook', bar2='')
    P['story'] = [
      ('Pick a level', 'Foundation, Intermediate, Advanced and the Specialist tracks, each with its own filter.', 'cur-courses', 'The Courses page listing chapters by level.'),
      ('Keep going', 'Chapters are written to build on each other. A Continue learning card brings you back to the next one.', 'cur-courses2', 'The chapter list scrolled down, with each chapter marked Done, in progress or open.'),
      ('See your progress', 'The dashboard shows your learning path and where you are on it.', 'cur-dash', 'The member dashboard with the learning path across the top.'),
      ('Collect badges', 'Milestones unlock badges as your progress is saved. Locked badges stay visible so you can see what is next.', 'cur-ach', 'The Achievements page with unlocked and locked badges.')]
    b = hero(P) + story(P)
    b += split('levels', 'Structure', 'list', 'Three levels and two specialist tracks',
      ['The core curriculum is 42 chapters in three levels: Foundation, Intermediate and Advanced. Two specialist tracks, Volume Profile and Prop Firm, bring the total to 64.'],
      [('book', 'Written lessons with chart diagrams, not videos.'), ('check', 'A checklist on every chapter to tick off as you go.'), ('list', 'Filter the list by level or track at any time.')],
      img('cur-courses2', 'The chapter list: each chapter shows its number, title, level tag and lesson count.'), title='Courses · chapter list', cap='Sample data. Your own progress shows on your account.')
    b += bento('inside', 'Inside the platform', 'Made for steady study', 'The parts of the members area that keep you moving through the course.', [
      (True, 'trophy', 'Badges for your progress', 'Finish chapters and lessons, keep a streak, use the journal and more. Each badge says what it takes.', img1('cur-ach-d', 'The Achievements page with a grid of badges, some unlocked and some locked.')),
      (False, 'chart', 'Your learning path', 'The dashboard shows the whole path and the chapter you are on.', img1('cur-dash-d', 'The dashboard with a row of numbered chapter steps.')),
      (False, 'check', 'Progress that saves', 'Every completed chapter is saved to your account and follows you between devices.', ''),
      (True, 'phone', 'Study on any screen', 'The same account and the same progress on your phone and on your desktop, so you can read a chapter wherever you are.', img1('cur-phone-d', 'The Courses page on a phone.', 390, 780, 'fx-tall'))])
    b += phones('mobile', 'Mobile', 'Pick up where you stopped', 'Read on the train, continue at your desk. The curriculum and your progress are the same on both.', 'cur-phone', 'The Courses page on a phone with filters and a Continue learning card.', [('check', 'One account, one progress record.'), ('book', 'Chapters and diagrams sized for a phone.')])
    b += faq([('Is the curriculum free?', 'Yes. All 64 chapters, including both specialist tracks, are free with an account. No card required.'),
      ('Do I have to go in order?', 'The chapters are built to be taken in order, because each one assumes the ones before it. You can open any chapter from the list.'),
      ('Does my progress save?', 'Yes. Every chapter you complete is saved to your account and shows on your dashboard on any device.'),
      ('Is it video?', 'No. The chapters are written lessons with chart diagrams.'),
      ('Is this financial advice?', 'No. The curriculum teaches methods many traders use, for study. It does not tell you what to trade.')])
    b += final('Start the first chapter', 'Make a free account and open Chapter 1. Your progress saves from the first lesson.', cta('/courses', 'Open the curriculum'), EDU)
    page('curriculum', P, b)

# ------------------------------------------------------------------ models
if 'models' in DONE:
    P = dict(kicker='Trading Models', h1='Complete models, <em>not lone setups.</em>',
      sub='A library of full written playbooks: the context to look for, the trigger to wait for, where the idea is wrong and how it is managed after entry. Every step documented, with a checklist to work through.',
      cta=cta('/models', 'Open the model library'), fine=f'Models are methods to study, not trade signals. {EDU}',
      bar='Models · Library', hero='mod-top', hero_alt='The Trading models page: a five-step process panel (prep, apply rules, confirm, size the risk, journal it) above the model library.',
      phone='mod-phone', phone_alt='A model page on a phone with its diagram and written walkthrough.',
      cards=[('list', '5-step process', 'The same routine for every model'), ('check', 'Checklist', 'Tick the steps as you learn'), ('grid', 'Model library', 'Filter by category'), ('play', 'Walkthrough', 'Step through an example')])
    P.update(story_eyebrow='One standard', story_h='Every model reads the same way')
    P['story'] = [('Start with the process', 'The same five steps sit at the top of the library: prep, apply the rules, confirm, size the risk, journal it.', 'mod-top', 'The five-step process panel at the top of the model page.'),
      ('Browse the library', 'Filter the cards by category, such as opening and session, liquidity and reversal, imbalance and FVG, or mean reversion.', 'mod-list', 'The model library with category filters and model cards.'),
      ('Read one model', 'Each model has a diagram, a written walkthrough, its entry criteria and its stop. The stop is part of the model.', 'mod-one', 'A model page with a diagram and the written explanation.')]
    b = hero(P) + story(P)
    b += split('anatomy', 'The anatomy', 'list', 'Context, trigger, invalidation, management',
      ['Each model is written to the same standard, so two students read the same setup the same way. Open any model and you find the same parts in the same order.'],
      [('check', 'Context: the conditions that must exist first.'), ('list', 'Trigger: what you wait for before acting.'), ('shield', 'Invalidation: where the idea is wrong, decided before entry.'), ('chart', 'Management: how the trade is handled after entry.')],
      img('mod-one', 'A model page showing a diagram of the setup and a written walkthrough.'), title='Model · written walkthrough', cap='Illustrative example. Not real market data and not a trade record.')
    b += bento('tools', 'In each model', 'Tools for learning a model', 'Built for studying one setup at a time.', [
      (True, 'play', 'Animated walkthrough', 'Step through the setup one stage at a time on an illustrative chart. Pause, go back, or change the speed. The page labels it an illustrative example.', img1('mod-one2-d', 'A model page scrolled to its illustrative example chart.')),
      (False, 'check', 'Steps checklist', 'Every model ends in a numbered checklist you tick off as you learn it, with a reset button.', ''),
      (False, 'grid', 'Tagged and filterable', 'Find models by category and open the playbook you want.', ''),
      (True, 'list', 'One library', 'Model cards show the diagram, a category tag, the first steps and how many steps and minutes of reading the model has.', img1('mod-list-d', 'The model library with category filters and model cards.'))])
    b += phones('mobile', 'Mobile', 'Run the checklist from your phone', 'Open a model before a session and work through it on any screen. Same account, same models.', 'mod-phone', 'A model page on a phone.', [('check', 'Library, walkthroughs and checklists work on a phone.'), ('list', 'Same models on every device.')])
    b += faq([('What is a trading model?', 'A complete written method that traders use: the context to look for, the trigger, where the idea is wrong, and how the trade is managed after entry.'),
      ('Are the walkthrough charts real trades?', 'No. The walkthroughs use illustrative candles drawn to teach the pattern. The page says so.'),
      ('Are models trade signals?', 'No. Models are methods to study. They do not tell you what to trade.'),
      ('Will more models be added?', 'New models may be added to the library over time.'),
      ('Does TradeZoro place trades from a model?', 'No. TradeZoro never places real orders. Practice in paper trading and bar replay.')])
    b += final('Trade a plan, not a feeling', 'Create an account and open the model library.', cta('/models', 'Open the model library'), EDU)
    page('models', P, b)

# ------------------------------------------------------------------ indicators
if 'indicators' in DONE:
    P = dict(kicker='Private Indicators', h1='Our indicators, <em>on ZoroCharts and TradingView.</em>',
      sub='Five indicators built around the concepts the curriculum teaches: liquidity, SMT divergence, fair value gaps and the Power of Three. Add them in ZoroCharts, or request access on TradingView.',
      cta=cta('/charts', 'Open ZoroCharts') , fine=f'Indicators mark concepts on the chart; they are not trade signals. {EDU}',
      bar='Indicators', hero='ind-top', hero_alt='The Indicators page with a banner saying all TradeZoro indicators are now on ZoroCharts, and an Open ZoroCharts button.',
      phone='ind-phone', phone_alt='The Indicators page on a phone with the ZoroCharts banner.',
      cards=[('chart', 'Liquidity Master', 'Highs, lows and equal levels'), ('link', 'SMT Divergence Pro', 'Two markets, one divergence'), ('grid', 'IFVG Pro', 'Inverted fair value gaps'), ('shield', 'Invite-only', 'Access follows your plan')])
    P.update(story_eyebrow='The toolkit', story_h='One concept per indicator')
    P['story'] = [('Where to find them', 'The Indicators page lists the suite and links straight into ZoroCharts.', 'ind-top', 'The Indicators page banner pointing to ZoroCharts.'),
      ('The five scripts', 'Liquidity Master, SMT Divergence Pro, IFVG Pro, FVG Relay and HTF PO3 Lens. Each automates one idea from the curriculum.', 'ind-suite', 'The indicator suite cards with a preview image and tag chips for each script.'),
      ('Request access', 'For TradingView, enter your exact TradingView username on the Indicators page. Access is granted by hand, so it can take a little time.', 'ind-access', 'The TradingView username request form.')]
    # ind-access only has a dark capture: use pair-less image through d/l names
    b = hero(P).replace('x', 'x', 0)
    b += story(P)
    b += split('suite', 'The suite', 'chart', 'Five scripts, one idea each',
      ['Each indicator automates one concept from the curriculum, so the chart marks what you have learned to see.'],
      [('chart', 'Liquidity Master: session, previous day, week and month highs and lows, plus swing liquidity.'), ('link', 'SMT Divergence Pro: marks SMT divergence between correlated markets.'), ('grid', 'IFVG Pro: inversion fair value gaps and the retest.'), ('list', 'FVG Relay: chains of fair value gaps across a move.'), ('chart', 'HTF PO3 Lens: higher-timeframe Power of Three beside your chart.')],
      img('ind-suite', 'The indicator suite: cards for each script with a preview image, a summary and feature chips.'), flip=True, title='Indicators · the suite', cap='Preview images are illustrations of the indicators.')
    b += bento('access', 'Access', 'Two ways to use them', 'In ZoroCharts, or on TradingView with an invite.', [
      (True, 'chart', 'Inside ZoroCharts', 'Members can add the scripts in ZoroCharts under Editors\u2019 picks in the Indicators window. No TradingView account needed there.', img1('ind-top-d', 'The Indicators page with the ZoroCharts banner.')),
      (False, 'link', 'On TradingView', 'Invite-only scripts are licensed to your TradingView username. Check TradingView\u2019s own plan page for what your plan supports.', ''),
      (False, 'shield', 'Plan-linked', 'Access follows your plan: the license is managed alongside it.', ''),
      (True, 'check', 'Request it once', 'Enter your exact TradingView username on the Indicators page. Switching accounts needs a new request.', img1('ind-access-d', 'The TradingView access form on the Indicators page.'))])
    b += faq([('Do I need TradingView?', 'No. You can add the indicators in ZoroCharts. TradingView is only needed if you want the invite-only scripts there.'),
      ('Do I need a paid TradingView plan?', 'Invite-only scripts need a TradingView plan that supports them. Check TradingView\u2019s own plan page.'),
      ('Are these buy and sell signals?', 'No. Each script marks a concept the curriculum teaches, so you learn why a level matters and then let the script do the marking.'),
      ('How do I get access on TradingView?', 'Enter your TradingView username on the Indicators page. When your plan includes the indicators, access is granted to that username by hand.')])
    b += final('Put the toolkit on your charts', 'Open ZoroCharts and search Editors\u2019 picks, or request TradingView access from the Indicators page.', cta('/charts', 'Open ZoroCharts'), EDU)
    page('indicators', P, b)

# ------------------------------------------------------------------ community
if 'community' in DONE:
    P = dict(kicker='Community', h1='Study with people <em>on the same path.</em>',
      sub='Post your daily bias, a question or a setup on the Trading Floor, collect badges as you work through the academy, and invite friends with your own link.',
      cta=cta('/trading-floor', 'Open the Trading Floor'), fine=f'Posts are members\u2019 own notes, not trade signals. {EDU}',
      bar='Trading Floor · Posts', hero='com-floor', hero_alt='The Trading Floor: filter pills for New, Top, Trending, Setups and Questions, and a feed of member posts.',
      phone='com-phone', phone_alt='The Trading Floor on a phone, showing two posts.',
      cards=[('msg', 'New post', 'Setup or Question flair'), ('trophy', 'Badge unlocked', 'Progress on the course'), ('link', 'Invite link', 'Credited automatically'), ('users', 'Trading Floor', 'Posts, replies, saves')])
    P.update(story_eyebrow='Around the course', story_h='Study, post, progress')
    P['story'] = [('Read the floor', 'Posts are visible to every signed-in member, with New, Top and Trending sorting and Setups and Questions filters.', 'com-floor', 'The Trading Floor feed.'),
      ('Post and reply', 'Share your bias, a question or a setup. Flair it as a Setup or a Question so others can filter for it.', 'com-post', 'The new post composer open over the Trading Floor.'),
      ('Earn badges', 'Badges unlock as you finish chapters, keep a streak, use the journal and take part. Locked ones stay visible.', 'com-ach', 'The Achievements page with unlocked and locked badges.'),
      ('Message members', 'Private conversations sit in Messages.', 'com-msg', 'The Messages page with the conversation list and a message box.')]
    b = hero(P) + story(P)
    b += split('floor', 'The Trading Floor', 'msg', 'A feed built for study',
      ['Members react, vote, save and reply. Posting, reacting and replying depend on your plan; everyone signed in can read.'],
      [('msg', 'New, Top and Trending sorting.'), ('list', 'Setups and Questions filters.'), ('check', 'React, vote, save and reply.'), ('users', 'A Prop firm feed tab beside Posts.')],
      img('com-floor', 'The Trading Floor feed with filter pills and posts.'), title='Trading Floor', cap='Sample posts. Not trade signals.')
    b += bento('more', 'Around the floor', 'More ways to take part', 'The parts of the members area that sit around the curriculum.', [
      (True, 'trophy', 'Badges for your progress', 'Each badge says what it takes, and locked badges stay visible so you can see what is next.', img1('com-ach-d', 'The Achievements page with a grid of badges.')),
      (False, 'link', 'Invite and earn', 'Share your link and earn points for every trader who joins. Anyone who signs up through it is credited to you automatically.', ''),
      (False, 'users', 'Leaderboards', 'See how you rank on the invite leaderboard.', ''),
      (True, 'msg', 'Direct messages', 'Private conversations with other members, from the Messages page.', img1('com-msg-d', 'The Messages page with the conversation list.'))])
    b += phones('mobile', 'Mobile', 'The floor in your pocket', 'The floor, your badges and your invite link all work on a phone. Same account, same posts.', 'com-phone', 'The Trading Floor on a phone.', [('msg', 'Read and post from your phone.'), ('trophy', 'Badges and invites on any screen.')])
    b += faq([('Who can see my posts?', 'Posts on the Trading Floor are visible to every signed-in member.'),
      ('Can I post on every plan?', 'Everyone signed in can read the floor. Posting, reacting, replying and direct messages depend on your plan; the floor shows a note if yours is read-only.'),
      ('How do referrals work?', 'Anyone who signs up through your link is credited to you automatically, and you earn points. Points show on your Invite & earn page.'),
      ('Are posts trade signals?', 'No. Posts are members\u2019 own notes and questions, shared to learn the method.')])
    b += final('Join the floor', 'Create an account to read the Trading Floor, start collecting badges and get your own invite link.', cta('/trading-floor', 'Open the Trading Floor'), EDU)
    page('community', P, b)

# ------------------------------------------------------------------ live sessions
if 'live-sessions' in DONE:
    P = dict(kicker='Live Sessions', h1='Live sessions are going <em>free on YouTube.</em>',
      sub='Every live trading session will stream 100% free on our YouTube channel. Expected from December. No sessions are running yet.',
      cta=btn('https://youtube.com/@tradezoro?sub_confirmation=1', 'Subscribe on YouTube') + btn('/signup', 'Start free', False), fine=EDU,
      bar='Live Sessions', tag='Coming soon', nc=' fx-nc', hero='live-banner', hero_alt='The Live Sessions page in the app: a Coming soon pill and the headline Live sessions are going free on YouTube.',
      phone='live-phone', phone_alt='The same Live Sessions notice on a phone.',
      cards=[('yt', 'Free on YouTube', 'On our channel'), ('bell', 'Get notified', 'Follow @tradezoro'), ('list', 'From December', 'Expected, not scheduled yet'), ('shield', 'Education only', 'Not financial advice')])
    b = hero(P)
    b += split('how', 'How it will work', 'yt', 'Watch on YouTube, no account needed',
      ['Sessions have not started. When they do, every live trading session will stream on the TradeZoro YouTube channel, free to watch. The Live Sessions page in the app shows the same notice until then.'],
      [('yt', 'Free to watch on YouTube.'), ('bell', 'Subscribe or follow @tradezoro to get notified.'), ('list', 'Expected from December. We will not list dates until they are set.')],
      img('live-banner', 'The Live Sessions page with a Coming soon pill and the free on YouTube headline.'), title='Live Sessions', tag='Coming soon')
    b += phones('mobile', 'Mobile', 'Same notice on your phone', 'Open Live Sessions in the app on any screen to see the latest status.', 'live-phone', 'The Live Sessions notice on a phone.', [('phone', 'Works on phone and desktop.'), ('yt', 'Subscribe button goes to the channel.')])
    b += faq([('Are live sessions running now?', 'Not yet. They are expected from December, and the date is not fixed.'),
      ('Is it free?', 'Yes. Every live session will stream 100% free on YouTube.'),
      ('How do I get notified?', 'Subscribe to or follow @tradezoro on YouTube.'),
      ('Is a session financial advice?', 'No. Sessions are for education only.')])
    b += final('Follow along on YouTube', 'Subscribe so you hear when the first session is set.', btn('https://youtube.com/@tradezoro?sub_confirmation=1', 'Subscribe on YouTube') + btn('/signup', 'Start free', False), EDU)
    page('live-sessions', P, b)

# ------------------------------------------------------------------ hub
if '_hub' in DONE:
    import json, re
    names = {'gex': ('GEX+', 'Options gamma levels on a futures chart: call wall, put wall and zero gamma, read as context.', 'Pro'),
      'smart-money-desk': ('Smart Money Desk', 'What Congress and insiders file, in one place.', ''),
      'curriculum': ('Curriculum', '64 written chapters on ICT and SMT, free with an account.', ''),
      'global-monitor': ('Global Monitor', 'Market context on one screen.', ''),
      'journal': ('JournalX', 'A trade journal with a calendar and review tools.', ''),
      'models': ('Trading Models', 'Complete written models with a checklist.', ''),
      'indicators': ('Private Indicators', 'Five indicators on ZoroCharts, or invite-only on TradingView.', ''),
      'backtesting': ('Replay One', 'Practise on past charts, one bar at a time.', ''),
      'community': ('Community', 'The Trading Floor, badges and invites.', ''),
      'charts': ('ZoroCharts', 'A full charting desk in your browser.', ''),
      'orderflow': ('Order Flow', 'Footprint and delta tools on the chart.', 'Pro'),
      'market-stats': ('Market Stats', 'How often gaps, ranges and levels played out, with sample sizes.', ''),
      'creators': ('Creator Hub', 'Start a trading community: indicators, courses, feed and Discord roles.', ''),
      'live-sessions': ('Live Sessions', 'Free on YouTube, expected from December.', 'Soon')}
    js = open(f'{g.ROOT}/assets/nav-features.js', encoding='utf-8').read()
    order = re.findall(r"id: '([a-z-]+)', name:", js)
    groups = [('Charts & data', 'Read the market and practise on it.', ['charts', 'orderflow', 'gex', 'market-stats', 'global-monitor', 'smart-money-desk']),
              ('Learn', 'Study the method, then practise it.', ['curriculum', 'models', 'indicators', 'live-sessions']),
              ('Journal & review', 'Practise, record and review.', ['backtesting', 'journal']),
              ('Community & creators', 'Learn with others, or start your own.', ['community', 'creators'])]
    assert sorted(sum([x[2] for x in groups], [])) == sorted(order), (sorted(order), 'hub groups must cover nav-features.js')
    def card(i, k):
        n, d, tag = names[k]
        t = {'Pro': ' <em class="fx-pro">Pro</em>', 'Soon': ' <em class="fx-soon">Soon</em>'}.get(tag, '')
        return f'<li><a class="cm-card fx-hc cm-rv" style="--d:{(i%3)*60}ms" href="/features/{k}"><img data-fp-nopad src="/assets/images/navfx/{k}-360.webp?v={V}" width="360" height="225" alt="" loading="lazy" decoding="async"><div><b>{e(n)}{t}</b><span>{e(d)}</span><em>Explore \u2192</em></div></a></li>'
    secs = ''.join(f'<div class="fx-hubgrp" id="g{gi}"><div class="cm-rv"><h2>{e(t)}</h2><p>{e(s)}</p></div><ul class="fx-hub">' + ''.join(card(i, k) for i, k in enumerate(ks)) + '</ul></div>\n' for gi, (t, s, ks) in enumerate(groups))
    P = dict(kicker='Features', h1='Everything in TradeZoro, <em>on one page.</em>',
      sub='Charts and order flow, GEX+, a 64-chapter curriculum, models, indicators, a journal, replay and a community. Most of it is free. Order flow and GEX+ are Pro.',
      cta=btn('/signup', 'Start free') + btn('/charts', 'Open ZoroCharts', False), fine=EDU,
      bar='ZoroCharts', hero='cur-courses', hero_alt='The Courses page.', phone='cur-phone', phone_alt='x', cards=[])
    top = f'''<header class="cm-hero" id="top"><div class="cm-w cm-hero-copy">
<span class="cm-kicker cm-in" style="--d:0ms">{P['kicker']}</span><h1 class="cm-in" style="--d:80ms">{P['h1']}</h1>
<p class="cm-sub cm-in" style="--d:160ms">{P['sub']}</p><div class="cm-cta cm-in" style="--d:240ms">{P['cta']}</div><p class="cm-fine cm-in" style="--d:300ms">{EDU}</p></div></header>
<section class="cm-sec" aria-label="All features"><div class="cm-w">
{secs}</div></section>
'''
    top += final('Start free', 'Make an account and open the curriculum or a chart in a few seconds.', btn('/signup', 'Start free') + btn('/charts', 'Open ZoroCharts', False), EDU)
    page('_hub', P, top)
