#!/usr/bin/env python3
"""PF-09 Multiple Accounts, Copy Trading & Automation Rules."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
from svglib import *

AS_OF = 'September 2026'
m = lambda x: ('\u2212$' + fmt(-x, 0)) if x < 0 else '$' + fmt(x, 0)

# ---------------------------------------------------------------- account limits from firm pages (as of AS_OF)
LIMITS = [
    ('Topstep', 'up to 5 Express Funded Accounts at once; only 1 Live Funded Account, and moving to Live closes all XFAs'),
    ('Tradeify', 'maximum of 5 Sim Funded Accounts across Growth, Select and Lightning; group trading on up to 5 accounts'),
    ('Lucid', 'up to 10 evaluation and 5 funded accounts per household, 10 in total'),
    ('Apex', 'its help page gives an example household reaching 20 Performance Accounts across people, companies and platforms'),
]

# ---------------------------------------------------------------- copier maths (hypothetical): copying multiplies both sides
N = 5
LIMIT = 2000
day_moves = [-600, 450, -900, 700, -1200]      # one account's daily P&L at 1x size, illustrative
one = []; b = 0
for d in day_moves:
    b += d; one.append(b)
assert min(one) == -1550 and min(one) > -LIMIT
# copied to N accounts: each account has the same path, so every account is 450 from breach on the same day
room_each = LIMIT + min(one)
assert room_each == 450
total_at_risk = N * LIMIT
assert total_at_risk == 10000
# scale-up mistake: trader doubles size because "risk is spread" - one account path doubles
two = [2 * v for v in one]
first_breach = next(i for i, v in enumerate(two) if v <= -LIMIT) + 1
assert first_breach == 3

def copier_chart():
    return series([(one, GREEN, '1x, each acct'), (two, RED, '2x, each acct'), ([-LIMIT] * len(one), MUTED, 'limit')],
                  'Illustrative: copied accounts share one path; doubling size breaches all of them together',
                  height=230, zero=True, right=290,
                  point_labels=[(first_breach - 1, two[first_breach - 1], 'all %d fail' % N, RED)])
svg_c, _ = copier_chart()
fig_copier = figure(svg_c,
    'Hypothetical five trading days. A copier puts the same trades in every account, so all %d accounts follow the green line together; they are not five separate chances. '
    'At double size (red) the $2,000 limit is hit on day %d, in every account at once.' % (N, first_breach))

# ---------------------------------------------------------------- microscalp rule arithmetic (Lucid: flagged if >50% of profits from trades held 5 s or less)
trades = [(3, 120), (4, 80), (45, 150), (120, 200), (2, 60)]      # (seconds held, profit $), illustrative
short = sum(p for s, p in trades if s <= 5); total = sum(p for s, p in trades)
assert (short, total) == (260, 610) and short / total < 0.5
trades2 = trades + [(4, 100)]
short2 = sum(p for s, p in trades2 if s <= 5); total2 = sum(p for s, p in trades2)
assert short2 / total2 > 0.5

fig_rules = figure(boxes([
    ('Usually allowed', ['copier, own accounts', 'your own bot', 'real scalping'], GREEN),
    ('Usually conditional', ['firm allows copier', 'you own every acct', 'no help if it breaks'], GOLD),
    ('Usually banned', ['hedging across accts', 'copying other people', 'sim-fill exploits'], RED),
    ('Always check', ['household acct caps', 'what live call-up', 'closes; news rules'], INK),
], 'Multiple accounts and automation: the common pattern', cols=2, box_h=96),
    'A summary of the pattern across the firm pages cited in this chapter, as of %s. Individual firms differ: read each one before you set anything up.' % AS_OF, illustrative=False)

body = [
    '<p>Once traders pass one evaluation, many want to run several accounts, copy trades between them, or automate a strategy. Firms allow a lot of this, but with limits, '
    'and the rules against <strong>hedging</strong> and <strong>simulator exploits</strong> are among the strictest in the industry. Breaking them can cost every account at once.</p>',
    '<p>All rules below are quoted from the firms\' help pages as of %s.</p>' % AS_OF,

    callout('Key takeaways', '<ul>'
            '<li>Firms cap how many accounts you can hold, often per household, not just per person.</li>'
            '<li>A trade copier is usually allowed between your own accounts. Copying other people, or trading opposite positions in different accounts, is not.</li>'
            '<li>Copied accounts share one equity path. Five copied accounts are one bet at five times the cost, not five chances.</li>'
            '<li>Automation is often allowed, but not strategies built to exploit simulated fills, and the firm won\'t fix it if it breaks.</li>'
            '</ul>'),

    '<h2>How many accounts can you hold?</h2>',
    cards(['Firm (as of %s)' % AS_OF, 'Account limits'], [list(r) for r in LIMITS]),
    '<p>Two details matter more than the number. First, limits are often per <strong>household</strong> or family, so accounts held by a partner count. Second, at Topstep, a call-up to '
    'the Live Funded Account closes every open Express Funded Account ("When you receive a Live Funded Account, all Express Funded Accounts are closed"). Plan for that before you build five.</p>',

    '<h2>Trade copiers</h2>',
    '<p>A <strong>trade copier</strong> takes the orders you place in one "lead" account and places the same orders in "follower" accounts. TopstepX describes it as a tool for '
    '"synchronized placement of orders without manual intervention".</p>',
    '<p>The firms\' conditions are similar:</p>',
    '<ul>'
    '<li><strong>Only your own accounts.</strong> Tradeify: "You may only group trade between accounts you own and manage. Copying other strategies or engaging in copy trading with others is not permitted."</li>'
    '<li><strong>Your risk, your problem.</strong> Tradeify says third-party copiers are used "at your own risk". TopstepX says "You are responsible for managing all trades executed via the copier" '
    'and that timing differences "may result in minor discrepancies" between accounts.</li>'
    '<li><strong>Risk settings may switch off.</strong> TopstepX says Personal Risk Settings are "automatically disabled on Follower Account(s)", except the Personal Daily Loss Limit and Profit Target.</li>'
    '<li><strong>Clearing it can close everything.</strong> Clearing the TopstepX copier with open positions "will result in the immediate liquidation of all such positions and orders across all accounts".</li>'
    '</ul>',

    '<h2>Why five copied accounts are not five chances</h2>',
    '<p>This is the most common misunderstanding. Five accounts traded independently, with different trades, give five different outcomes. Five accounts on a copier all take '
    '<em>the same trades</em>, so they rise and fall together. Here is a hypothetical week:</p>',
    table(['Day', 'P&L per account (1x)', 'Running, each account', 'Running, 2x size'],
          [[str(i + 1), m(d), m(v), m(w)] for i, (d, v, w) in enumerate(zip(day_moves, one, two))]),
    fig_copier,
    '<p>At normal size, every account ends the week with ' + m(room_each) + ' of room, all on the same day. The trader has ' + m(total_at_risk) + ' of combined loss limits, '
    'but only one real equity path. A trader who thinks "risk is spread over five accounts" and doubles size breaches all five on day ' + str(first_breach) + '.</p>',
    '<p>Copying can still make sense. It turns one good trading plan into several payouts without extra screen time. Just size each account as if it were your only one, '
    'and count the fees for all of them when you work out your costs (PF-10).</p>',

    '<h2>Hedging: the rule that ends accounts</h2>',
    '<p><strong>Hedging</strong>, in the firms\' sense, means holding opposite positions on the same or related instruments, in one account or across several, so that one side wins '
    'whichever way the market moves. It is prohibited almost everywhere, because it passes evaluations without showing any trading skill.</p>',
    '<ul>'
    '<li><strong>Tradeify:</strong> "we do not allow hedging at all". Examples include "going long on ES and short on MES at the same time". It also bars holding micros and minis at once in one account.</li>'
    '<li><strong>Lucid:</strong> prohibits hedging "across multiple accounts held by the same user", "between different users\' accounts" and "between different firms". '
    'It gives the example that you "cannot go long ES in one account and short NQ in a separate account", because the two are correlated.</li>'
    '<li><strong>MFFU:</strong> prohibits "collaborating with others to execute identical or opposite strategies across unconnected accounts".</li>'
    '<li><strong>Topstep:</strong> prohibits "account stacking": hitting the loss limit in one account, "then switching to another account and repeating".</li>'
    '</ul>',
    '<p>Note the last point in Lucid\'s list. Holding a long in one firm\'s account and a short in another firm\'s account is still hedging. Firms say they detect it automatically: '
    'Lucid says it has "automated risk systems in place to detect hedging behavior".</p>',

    '<h2>Automated trading</h2>',
    '<p>Many firms allow automated strategies, with conditions:</p>',
    cards(['Firm', 'What the help page says'], [
        ['Topstep', '"Yes, with conditions." It won\'t help set them up, "no exceptions are made for errant trades or malfunctions", and it tells you to test on a practice account first.'],
        ['MFFU', 'Automated strategies are allowed "so long as these automated tools do not aim to exploit the favorable fills" in simulation. "High-frequency Trading is not allowed."'],
        ['Topstep (prohibited)', 'Using "software, AI, ultra-high speed systems, or mass data entry" that manipulates the platform or gives an unfair advantage.'],
    ]),
    '<p>If you automate, keep a written log of every change to the strategy\'s settings, and switch it off during scheduled news unless you have checked the firm\'s news rules. '
    'A bot follows its code exactly, including into a rule you forgot to program.</p>',
    '<p>The line firms draw is between a strategy that would work in a real market, and one that only works because a simulator fills orders more kindly than a real exchange.</p>',

    '<h2>Simulator exploits</h2>',
    '<p>Simulated fills are not the same as real fills: in a real market you may not get filled at your price, and you may get slippage. Firms prohibit strategies that rely on that gap. '
    'Topstep lists examples, including "making hundreds of rapid trades to take advantage of preferential queue position in SIM" and "using tight brackets or auto-breakeven to take advantage of favorable SIM fills". '
    'MFFU bars "exploiting the absence of slippage and utilizing tight brackets".</p>',
    fig_rules,
    '<p>Lucid publishes a number. It flags <strong>microscalping</strong> if "more than 50% of your profits are generated from trades held for 5 seconds or less". Hypothetical: '
    'five trades earning ' + m(total) + ', of which ' + m(short) + ' came from trades held 5 seconds or less. That is ' + '%d%%' % round(100.0 * short / total) + ', under the line. '
    'Add one more quick $100 trade and it is ' + '%d%%' % round(100.0 * short2 / total2) + ', over it. Lucid says it then starts a manual review, and that genuine scalping "is permitted".</p>',
    '<p>If you are a genuine short-term trader, keep your own records of holding times so you can show your pattern if asked. Topstep reassures traders that "a few lucky fills won\'t get your Payout rejected". The rules target patterns, not the occasional good fill.</p>',

    '<h2>Running several accounts day to day</h2>',
    '<p>More accounts means more to watch. A few habits keep it manageable:</p>',
    '<ul>'
    '<li><strong>Name them clearly.</strong> Topstep warns: "If you have multiple accounts, double-check which one you\'re trading on before you start. Topstep isn\'t responsible for trades made on the wrong account."</li>'
    '<li><strong>Track each floor separately.</strong> After payouts, accounts drift apart: one may have a $0 floor and $1,000 of room, another $1,800. Your size should follow the smallest buffer, '
    'because on a copier every account takes the same trade.</li>'
    '<li><strong>Keep one account as the lead.</strong> Make it the one with the least room, so the platform\'s daily limit on the lead stops you before a weaker follower is at risk.</li>'
    '<li><strong>Stagger new accounts.</strong> Adding accounts one at a time, after the plan has worked on fewer, stops you scaling a mistake.</li>'
    '</ul>',
    '<p>If you run different strategies in different accounts without a copier, the accounts really are more independent. They are still one trader, though, and a bad day for your '
    'judgement is usually a bad day in all of them. Keep the same daily rules on each.</p>',

    '<h2>A checklist before you scale up</h2>',
    '<ol>'
    '<li>Read the firm\'s page on account limits, and count every account in your household.</li>'
    '<li>Confirm the firm allows copiers, and which ones, and that every account is yours.</li>'
    '<li>Check that each follower has the same or larger size limit as the lead account.</li>'
    '<li>Re-set any risk settings the copier turns off, and set daily limits on every account.</li>'
    '<li>Never hold opposite or correlated positions across accounts, even at different firms.</li>'
    '<li>For automation, test on a practice account, and check the strategy doesn\'t depend on perfect fills.</li>'
    '</ol>',

    '<h2>Common mistakes</h2>',
    cards(['Mistake', 'Better approach'], [
        ['Treating copied accounts as separate chances', 'Size each one as if it were your only account.'],
        ['Long in one account, short in another', 'Never. It is hedging, even across firms.'],
        ['Copying a friend\'s or a signal service\'s trades', 'Only copy between accounts you own and manage.'],
        ['Forgetting the copier disables risk settings', 'Re-check every follower\'s settings after setup.'],
        ['Running an untested bot on a funded account', 'Test on a practice account; firms won\'t reverse errant trades.'],
    ]),

    '<h3>Practice exercises</h3>',
    '<ol>'
    '<li>List the account limit, copier rule and hedging rule for your firm, with the page links.</li>'
    '<li>Using the table above, work out the room left per account after day 3 at 1x and 2x size.</li>'
    '<li>From your last 20 trades, work out what share of profit came from trades held 5 seconds or less.</li>'
    '<li>Write your scale-up rule: how many accounts, what size each, and what ends the day on all of them.</li>'
    '</ol>',

    quiz([
        ('Why are five copied accounts not five independent chances?', '<p>They take the same trades, so they share one equity path and can all fail together.</p>'),
        ('Is holding a long at one firm and a short at another allowed at Lucid?', '<p>No. Lucid prohibits hedging "between different firms".</p>'),
        ('What does Topstep call hitting the limit in one account and moving to the next?', '<p>Account stacking. It is prohibited.</p>'),
        ('When does Lucid flag microscalping?', '<p>When more than 50% of profits come from trades held 5 seconds or less.</p>'),
        ('What happens to Topstep XFAs when you are called up to Live?', '<p>They are all closed.</p>'),
    ]),
]

lessons = [
    ('Account limits', '<p>See how many accounts each firm allows, and why household limits and live call-ups matter.</p>'),
    ('Trade copiers', '<p>Learn the copier rules, and why copied accounts share one equity path.</p>'),
    ('Hedging and account stacking', '<p>Understand the strictest rules in prop trading and how firms detect breaches.</p>'),
    ('Automation and simulator exploits', '<p>See what automated trading is allowed, and how firms define sim-fill abuse.</p>'),
]

src = [
    ('Can I have more than one Funded Account? - Topstep Help Center', 'https://help.topstep.com/en/articles/8284219-can-i-have-more-than-one-funded-account'),
    ('Multiple Express Funded Accounts - Topstep Help Center', 'https://intercom.help/topstep-llc/en/articles/8284218-multiple-express-funded-accounts'),
    ('Copy Trading - TopstepX Help', 'https://help.topstepx.com/settings/copy-trading'),
    ('Prohibited Trading Strategies at Topstep - Topstep Help Center', 'https://help.topstep.com/en/articles/10305426-prohibited-trading-strategies-at-topstep'),
    ('Trading Combine Parameters - Topstep Help Center', 'https://help.topstep.com/en/articles/8284197-trading-combine-parameters'),
    ('Group Trading / Copy Trading - Tradeify Help Center', 'https://help.tradeify.co/en/articles/10468299-group-trading-copy-trading'),
    ('Rules: Hedging & Trading Micros & Minis - Tradeify Help Center', 'https://help.tradeify.co/en/articles/10495868-rules-hedging-trading-micros-minis'),
    ('Growth Funded Account Payout Policy - Tradeify Help Center', 'https://help.tradeify.co/en/articles/11083796-growth-funded-account-payout-policy'),
    ('Maximum Number of Accounts - Lucid Trading Help Center', 'https://support.lucidtrading.com/en/articles/11404617-maximum-number-of-accounts'),
    ('Prohibited: Hedging - Lucid Trading Help Center', 'https://support.lucidtrading.com/en/articles/11404734-prohibited-hedging'),
    ('Prohibited: Microscalping - Lucid Trading Help Center', 'https://support.lucidtrading.com/en/articles/11404742-prohibited-microscalping'),
    ('Fair Play and Prohibited Trading Practices - My Funded Futures Help Center', 'https://help.myfundedfutures.com/en/articles/8444599-fair-play-and-prohibited-trading-practices'),
    ('How Many Paid/Funded Accounts Am I Allowed to Have? - Apex Trader Funding Help Center', 'https://apextraderfunding.com/help-center/performance-accounts-pa/how-many-paid-funded-accounts-am-i-allowed-to-have/'),
]

write_chapter('pf', 'PF-09', 'Multiple Accounts, Copy Trading & Automation Rules', 'advanced', '25 min', lessons, body, src)
