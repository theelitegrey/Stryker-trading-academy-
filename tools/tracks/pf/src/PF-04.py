#!/usr/bin/env python3
"""PF-04 The Rules Deep Dive."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
from svglib import *

AS_OF = 'September 2026'
START, DD = 50000, 2000

# ---------------------------------------------------------------- illustrative 8-day path: (intraday peak, close)
days = [(50600, 50400), (51300, 50700), (51500, 51400), (51900, 51100), (52600, 52300), (52500, 52000), (52700, 52450), (52900, 52800)]

def thresholds(days, start=START, dd=DD, lock=None):
    """Return per-day floors after each day for intraday-trailing, EOD-trailing and static rules.
    lock: level at which a trailing floor stops rising (None = never)."""
    cap = (lambda x: min(x, lock)) if lock is not None else (lambda x: x)
    intr, eod, stat = [], [], []
    peak_i, peak_c = start, start
    for hi, cl in days:
        peak_i = max(peak_i, hi); peak_c = max(peak_c, cl)
        intr.append(cap(peak_i - dd)); eod.append(cap(peak_c - dd)); stat.append(start - dd)
    return intr, eod, stat

intr, eod, stat = thresholds(days)
# every floor never falls
assert all(b >= a for a, b in zip(intr, intr[1:])) and all(b >= a for a, b in zip(eod, eod[1:]))
# intraday floor is always at or above the EOD floor, because peaks >= closes
assert all(i >= e for i, e in zip(intr, eod))
# day 4: peak 51,900 but close 51,100 -> intraday floor 49,900, EOD floor stays 49,400 (best close 51,400)
assert intr[3] == 49900 and eod[3] == 49400
# room left at day-4 close under each rule
room_i, room_e = days[3][1] - intr[3], days[3][1] - eod[3]
assert (room_i, room_e) == (1200, 1700)

closes = [START] + [c for _, c in days]
series_i = [START - DD] + intr
series_e = [START - DD] + eod
series_s = [START - DD] * (len(days) + 1)
svg_dd, _ = series([(closes, INK, 'close'), (series_i, RED, 'intraday'), (series_e, GOLD, 'EOD'), (series_s, MUTED, 'static')],
                   'Three drawdown rules on the same eight days', height=230, right=316, point_labels=[(4, closes[4], 'day 4', INK)])
fig_dd = figure(svg_dd,
    'Illustrative: one 50K account over eight days with a $2,000 limit, drawn three ways. The static floor never moves. The end-of-day (EOD) floor follows the best '
    'closing balance. The intraday floor follows the best balance reached at any moment, including open profit. On day 4 the account reached $51,900 but closed at $51,100.')

# ---------------------------------------------------------------- lock examples (from firm pages, as of AS_OF)
lock_rows = [
    ['Topstep Trading Combine', 'EOD trailing', '$2,000', 'Locks at the $50,000 starting balance'],
    ['Apex Performance Account (intraday)', 'Intraday trailing', '$2,000', 'Stops at $50,100 (start + $100)'],
    ['Tradeify Growth', 'EOD trailing', '$2,000', 'Locks at $50,100'],
    ['MFFU Flex sim funded', 'EOD trailing', '$2,000', 'Fixed at $100 after first payout'],
]
# Apex intraday PA stop: highest balance must reach start + DD + 100
assert START + DD + 100 == 52100

# ---------------------------------------------------------------- consistency rule arithmetic (Topstep Combine 55%)
TARGET = 3000; PCT = 0.55
best_limit = round(PCT * TARGET, 2)
assert best_limit == 1650
def required_total(best_day, pct=PCT, target=TARGET):
    """If your best day exceeds pct of target, total profit must reach best_day / pct."""
    return max(target, best_day / pct)
assert round(required_total(1600)) == 3000
assert round(required_total(2200)) == 4000


fig_types = figure(boxes([
    ('Static', ['floor never moves', 'e.g. $48,000 forever', 'simplest to plan'], GREEN),
    ('EOD trailing', ['moves on new best close', 'intraday dips ignored', 'enforced in real time'], GOLD),
    ('Intraday trailing', ['moves on any new high', 'open profit counts', 'tightest of the three'], RED),
    ('Lock level', ['trailing stops here', 'often start + $100', 'check it for your plan'], INK),
], 'The three drawdown designs and the lock level', cols=2, box_h=96),
    'Summary of the three maximum loss limit designs and the lock level where a trailing floor stops rising. Examples use a $50K account with a $2,000 limit.',
    illustrative=False)

body = [
    '<p>Every prop firm account is a set of rules. Break one, and the account ends, however good your trading was. This chapter explains each rule type you will meet at the '
    'main U.S. futures firms, how the maths works, and how the same rule can behave differently from one firm to the next. It is the reference chapter for the rest of the track.</p>',
    '<p>Numbers are quoted from each firm\'s help pages <strong>as of %s</strong>, for $50K accounts unless noted. Firms change them often, so always check the current page for your exact plan.</p>' % AS_OF,

    callout('Key takeaways', '<ul>'
            '<li>The <strong>maximum loss limit</strong> (drawdown) is the rule that ends most accounts. Know whether yours is static, end-of-day trailing or intraday trailing, and where it stops trailing.</li>'
            '<li>Intraday trailing counts <strong>open profit</strong>: giving back an unrealised gain moves your floor up for good.</li>'
            '<li><strong>Consistency rules</strong> cap how much of your profit can come from one day. They change the target, not just the payout.</li>'
            '<li>Contract limits, close times, news rules and minimum days are all enforceable. Put every one in your trading plan.</li>'
            '</ul>'),

    '<h2>The maximum loss limit</h2>',
    '<p>The <strong>maximum loss limit</strong>, also called max drawdown or trailing threshold, is the lowest balance your account may reach. Touch it and the account fails. '
    'Topstep\'s page puts it plainly: "If your balance hits it at any point during the trading day, including on unrealized P&amp;L, your account is liquidated immediately."</p>',
    '<p>There are three main designs.</p>',
    fig_types,
    '<h3>Static</h3>',
    '<p>A <strong>static</strong> floor never moves. On a $50K account with a $2,000 limit, the floor is $48,000 for the life of the account. Many forex/CFD firms use a static overall limit (Blue Guardian\'s 2-Step lists 8%% static, as of %s).</p>' % AS_OF,
    '<h3>End-of-day (EOD) trailing</h3>',
    '<p>An <strong>EOD trailing</strong> floor moves up only when your account <em>closes the day</em> at a new high. Topstep\'s example: start at $50,000 with the limit at $48,000; '
    'make $500 on day 1 and the limit trails up to $48,500; lose $500 on day 2 and it stays at $48,500. Tradeify describes its version the same way: it "recalculates only at market close", '
    'but "the limit itself is still enforced in real time".</p>',
    '<h3>Intraday trailing</h3>',
    '<p>An <strong>intraday trailing</strong> floor follows the highest balance reached <em>at any moment</em>, including open profit. Apex\'s help page gives the example: '
    'a $50,000 evaluation with a $2,000 drawdown starts with the floor at $48,000. If open profit lifts the balance to $50,900, the floor jumps to $48,900 immediately, '
    '"No closing trade is required". If the trade then closes at $50,300, the floor stays at $48,900.</p>',
    fig_dd,
    '<p>Look at day 4 in the chart. The account ran to $51,900 and closed at $51,100. Under the <strong>intraday</strong> rule the floor is now $%s, leaving $%s of room. '
    'Under the <strong>EOD</strong> rule the floor stays at $%s (its best close is $51,400), leaving $%s. Same trades, $%s less room, just because of the rule design. '
    'That is why intraday-trailing accounts reward taking profit and punish letting winners give back.</p>'
    % (fmt(intr[3], 0), fmt(room_i, 0), fmt(eod[3], 0), fmt(room_e, 0), fmt(room_e - room_i, 0)),
    '<h3>Where trailing stops</h3>',
    '<p>Most trailing floors stop rising at some level, which makes the account far safer from then on. This is one of the most important numbers on any plan page:</p>',
    cards(['Plan (as of %s)' % AS_OF, 'Type', 'Limit', 'Where it stops trailing'], lock_rows),
    '<p>Apex, for example, says the intraday floor of a 50K Performance Account stops at $50,100 once the highest balance reaches $52,100 (start + $2,000 + $100). '
    'From that point on, the account can lose everything above $50,100 and survive. Until then, every new high tightens the rope.</p>',
    '<h3>Funded accounts that start at $0</h3>',
    '<p>Some firms show funded balances from zero. Topstep\'s Express Funded Account starts at $0 with the 50K limit at &minus;$2,000; once the balance reaches $2,000 the limit locks at $0. '
    'After the first payout, Topstep sets the limit to $0 whatever it was before, so the remaining balance becomes your whole cushion. It is the same idea as a trailing floor, just drawn from a different starting point.</p>',

    '<h2>Daily loss limits</h2>',
    '<p>A <strong>daily loss limit (DLL)</strong> caps how much you can lose in one trading day. Firms treat it in two different ways, and the difference matters:</p>',
    '<ul>'
    '<li><strong>Soft stop:</strong> trading is paused until the next session, but the account survives. Topstep says triggering its DLL "is not a rule violation — it\'s a forced break", '
    'and Apex says hitting the DLL on its Performance Account "pauses trading for the remainder of the session".</li>'
    '<li><strong>Hard breach:</strong> the account fails. Many forex/CFD firms work this way; Blue Guardian\'s 2-Step, for example, breaches the account when the daily loss exceeds 4% of the initial balance.</li>'
    '</ul>',
    '<p>Also check what the "day" is. Topstep\'s trading day runs 5:00 p.m. CT to 3:10 p.m. CT, so a trade at 6:30 p.m. Tuesday counts toward Wednesday. '
    'Tradeify warns that trading at 1:00 a.m. and 7:00 p.m. on one calendar day can count as <strong>two</strong> trading days.</p>',

    '<h2>Consistency rules</h2>',
    '<p>A <strong>consistency rule</strong> limits how much of your total profit can come from your single best day. It is designed to stop one lucky day passing an evaluation or unlocking a payout.</p>',
    '<p>Topstep\'s Trading Combine uses 55%%: "Your single best day of profit must stay at or below 55%% of your Profit Target. If it exceeds that, your Profit Target increases." '
    'On a 50K with a $3,000 target, that means a best day under $%s.</p>' % fmt(best_limit, 0),
    '<p>Here is the effect, worked with Topstep\'s formula (best day &divide; total profit):</p>',
    table(['Best day', 'Share of $3,000', 'Total profit needed'], [
        ['$1,600', '53%', '$%s (target unchanged)' % fmt(required_total(1600), 0)],
        ['$2,200', '73%', '$%s (so the best day is 55%%)' % fmt(round(required_total(2200)), 0)],
    ]),
    '<p>A $2,200 day feels like progress, but it raises the bar to $4,000. Other firms use different numbers and apply them at different stages: LucidMaxx uses 40% in the evaluation; '
    'Apex\'s EOD Performance Account requires that no day be 50% or more of profit since the last payout; MFFU\'s Flex plan uses 50% in the evaluation only.</p>',

    '<h2>Position size, scaling and product rules</h2>',
    '<p>Every plan has a <strong>maximum position size</strong>. Topstep\'s 50K Combine allows 5 contracts or 50 micros, with micros counted at 10:1. Tradeify\'s 50K allows 4 minis or 40 micros. '
    'Funded accounts often add a <strong>scaling plan</strong>, where the limit rises with your balance: MFFU\'s Flex sim funded account allows 1 mini below $1,500 of profit, 2 up to $1,999, and 3 from $2,000.</p>',
    '<p>Product rules vary too. Tradeify does not allow micros and minis to be held at the same time. Tradeify and Lucid prohibit hedging (opposite positions on the same or related contracts), '
    'including across accounts. Always read the approved products list, because some contracts aren\'t available at all.</p>',

    '<h2>Time rules</h2>',
    '<ul>'
    '<li><strong>Close time:</strong> most futures firms are day-trade only. Tradeify requires all positions closed by 4:45 p.m. ET; Topstep\'s day ends at 3:10 p.m. CT.</li>'
    '<li><strong>Minimum days:</strong> Apex\'s current EOD and intraday evaluations list no minimum; Tradeify Growth lists 1 day and Select 3; MFFU lists 2; LucidMaxx lists 5. Topstep says you can pass "in as few as two days".</li>'
    '<li><strong>Inactivity:</strong> MFFU\'s Flex sim funded page lists a 7-calendar-day inactivity rule. Going quiet can close an account.</li>'
    '<li><strong>News:</strong> MFFU\'s news-restricted accounts must be flat from 2 minutes before to 2 minutes after Tier 1 releases; Topstep prohibits trading your full maximum size into a scheduled major news event.</li>'
    '</ul>',

    '<h2>When the rules change</h2>',
    '<p>Firms update rules often, sometimes several times a year. Before you trade each week, check three things: the date on your plan\'s rule page, whether any announcement '
    'says the change applies to existing accounts or only new ones, and whether your rule card still matches. If a change is unclear, ask support in writing which version '
    'applies to your account, and keep the answer with your saved copy of the page (PF-03 covers keeping this paper trail).</p>',

    '<h2>Worked example: turning rules into a one-page card</h2>',
    '<p>Illustrative. Before your first trade on a new plan, write a rule card and keep it next to your chart:</p>',
    table(['Rule', 'My plan (example: EOD trailing 50K)'], [
        ['Loss floor today', 'Best close minus $2,000; stops at $50,100'],
        ['Daily loss', '$1,000 soft stop (optional add-on)'],
        ['Consistency', 'Best day under 55% of target'],
        ['Max size', '5 minis / 50 micros; one type at a time'],
        ['Flat by', '3:10 p.m. CT; no full size into CPI/FOMC/NFP'],
        ['Minimum days', '2'],
    ]),
    '<p>Update the loss floor line every evening. It is the one number that tells you how much room you really have tomorrow.</p>',

    '<h2>Common mistakes</h2>',
    cards(['Mistake', 'Better approach'], [
        ['Thinking the floor uses closed trades only', 'Check whether your plan is intraday or EOD trailing. Intraday counts open profit.'],
        ['Letting a big open winner come back', 'On intraday trailing, take partial profit or move your stop, because the floor has already moved up.'],
        ['Forgetting the consistency rule', 'Set a daily profit cap near the limit; some platforms can enforce it.'],
        ['Mixing up soft and hard daily limits', 'Read whether hitting the DLL pauses or fails the account.'],
        ['Trading into news on a restricted account', 'Put the release times in your calendar with a two-minute buffer.'],
    ]),

    '<h3>Practice exercises</h3>',
    '<ol>'
    '<li>For your plan, write down the loss limit type, amount, and the balance at which it stops trailing.</li>'
    '<li>Using the eight-day path in this chapter, what would the intraday floor be after day 5? And the EOD floor?</li>'
    '<li>On a $3,000 target with a 55% consistency rule, what total profit do you need if your best day is $1,980?</li>'
    '<li>Build the one-page rule card for your plan and keep it next to your chart for a week.</li>'
    '</ol>',

    quiz([
        ('What is the difference between EOD and intraday trailing drawdown?', '<p>EOD trails your best closing balance. Intraday trails your best balance at any moment, including open profit.</p>'),
        ('On Apex\'s 50K intraday Performance Account, where does the floor stop?', '<p>At $50,100, once the highest balance reaches $52,100.</p>'),
        ('Is Topstep\'s Daily Loss Limit a rule violation?', '<p>No. It flattens and pauses trading for the session; the account stays eligible.</p>'),
        ('Exercise: floors after day 5?', '<p>Intraday: $50,600 (peak $52,600 minus $2,000). EOD: $50,300 (best close $52,300 minus $2,000).</p>'),
        ('Exercise: best day $1,980, 55% rule, $3,000 target. Total needed?', '<p>$1,980 &divide; 0.55 = $3,600.</p>'),
    ]),
]

assert intr[4] == 50600 and eod[4] == 50300
assert round(required_total(1980)) == 3600

lessons = [
    ('The maximum loss limit', '<p>Understand static, end-of-day trailing and intraday trailing drawdowns, and where each one stops.</p>'),
    ('Daily loss limits', '<p>Tell soft stops from hard breaches, and know when a firm\'s trading day starts.</p>'),
    ('Consistency rules', '<p>Work out how a big day changes your target or payout eligibility.</p>'),
    ('Size, time and news rules', '<p>Learn contract limits, scaling plans, close times, minimum days and news restrictions, and build a rule card.</p>'),
]

src = [
    ('What is the Maximum Loss Limit? - Topstep Help Center', 'https://help.topstep.com/en/articles/8284204-what-is-the-maximum-loss-limit'),
    ('Trading Combine Parameters - Topstep Help Center', 'https://help.topstep.com/en/articles/8284197-trading-combine-parameters'),
    ('Daily Loss Limit in the Trading Combine and Express Funded Account - Topstep Help Center', 'https://help.topstep.com/en/articles/10490293-daily-loss-limit-in-the-trading-combine-and-express-funded-account'),
    ('Consistency at Topstep - Topstep Help Center', 'https://help.topstep.com/en/articles/8284208-consistency-at-topstep'),
    ('Prohibited Trading Strategies at Topstep - Topstep Help Center', 'https://help.topstep.com/en/articles/10305426-prohibited-trading-strategies-at-topstep'),
    ('Intraday Trailing Drawdown Explained - Apex Trader Funding Help Center', 'https://apextraderfunding.com/help-center/intraday-trailing-drawdown-accounts/intraday-trailing-drawdown-explained/'),
    ('EOD Evaluations - Apex Trader Funding Help Center', 'https://apextraderfunding.com/help-center/eod-trailing-drawdown-accounts/eod-evaluations'),
    ('SELECT vs Growth: Choosing Your Evaluation Type - Tradeify Help Center', 'https://help.tradeify.co/en/articles/13252431-select-vs-growth-choosing-your-evaluation-type'),
    ('EOD Performance Accounts (PA) - Apex Trader Funding Help Center', 'https://apextraderfunding.com/help-center/eod-trailing-drawdown-accounts/eod-performance-accounts-pa/'),
    ('EOD Payouts - Apex Trader Funding Help Center', 'https://apextraderfunding.com/help-center/eod-trailing-drawdown-accounts/eod-payouts/'),
    ('Essential Trading Rules Overview - Tradeify Help Center', 'https://help.tradeify.co/en/articles/12268167-essential-trading-rules-overview'),
    ('Rules: Hedging & Trading Micros & Minis - Tradeify Help Center', 'https://help.tradeify.co/en/articles/10495868-rules-hedging-trading-micros-minis'),
    ('Flex Plan $50,000: A Comprehensive Guide - My Funded Futures Help Center', 'https://help.myfundedfutures.com/en/articles/15072271-flex-plan-50-000-a-comprehensive-guide'),
    ('News Trading Policy - My Funded Futures Help Center', 'https://help.myfundedfutures.com/en/articles/8230009-news-trading-policy'),
    ('LucidMaxx Eval Rules - Lucid Trading Help Center', 'https://support.lucidtrading.com/en/articles/14315460-lucidmaxx-eval-rules'),
    ('2 Step Standard Rules - Blue Guardian Help Center', 'https://help.blueguardian.com/en/articles/14062291-2-step-standard-rules'),
]

write_chapter('pf', 'PF-04', 'The Rules Deep Dive', 'intermediate', '30 min', lessons, body, src)
