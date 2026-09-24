#!/usr/bin/env python3
"""PF-10 The Business View: Costs, Resets & Expected Value."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
from svglib import *

AS_OF = 'September 2026'
m = lambda x: ('\u2212$' + fmt(-x, 0)) if x < 0 else '$' + fmt(x, 0)

# ---------------------------------------------------------------- Topstep 50K published prices (as of AS_OF)
MONTH_STD, MONTH_NAF = 49, 95
RESET_STD, RESET_NAF = 49, 95
ACTIVATION_STD = 149
B2F_50K = 599

# ---------------------------------------------------------------- expected-cost model (inputs are illustrative, not statistics)
def spend_per_xfa(p, attempt_cost=MONTH_STD, activation=ACTIVATION_STD):
    """Each attempt costs one month or one reset; attempts until a pass follow a geometric distribution (mean 1/p)."""
    return attempt_cost / p + activation
def spend_per_first_payout(p, q, **kw):
    """q = chance a funded account reaches its first payout. Expected XFAs needed = 1/q."""
    return spend_per_xfa(p, **kw) / q

assert round(spend_per_xfa(0.25)) == 345                 # 49/0.25 + 149
assert round(spend_per_first_payout(0.25, 0.5)) == 690
ps = [0.1, 0.2, 0.3, 0.5]; qs = [0.25, 0.5, 0.75]
grid = [[spend_per_first_payout(p, q) for q in qs] for p in ps]
assert all(a > b for a, b in zip([r[0] for r in grid], [r[0] for r in grid][1:]))   # better pass rate, lower spend

# break-even: the net first payout must exceed expected spend per first payout
NET_FIRST = 900   # PF-07 example: $1,000 gross first XFA payout at 90%
be = [(p, q, spend_per_first_payout(p, q)) for p in ps for q in qs]
covered = [(p, q) for p, q, s in be if s <= NET_FIRST]
assert (0.5, 0.5) in covered and (0.1, 0.5) not in covered

# ---------------------------------------------------------------- Standard vs No Activation Fee path, now including resets
def path_cost(attempts, path):
    if path == 'std':
        return MONTH_STD + (attempts - 1) * RESET_STD + ACTIVATION_STD
    return MONTH_NAF + (attempts - 1) * RESET_NAF
rows_path = [(a, path_cost(a, 'std'), path_cost(a, 'naf')) for a in (1, 2, 3, 4)]
assert rows_path[0] == (1, 198, 95) and rows_path[2] == (3, 296, 285) and rows_path[3] == (4, 345, 380)
cross = next(a for a, s, n in rows_path if n > s)
assert cross == 4
assert 2 * 49 + 149 == 247 and 6 * 49 + 149 == 443

def spend_bars():
    o = []; left, right, top = 70, 340, 30
    mx = max(max(r) for r in grid); sc = (right - left) / mx
    cols = [RED, GOLD, GREEN]
    for j, q in enumerate(qs):
        x = left + j * 92
        o.append(rect(x, 6, 12, 10, fill=cols[j])); o.append(text(x + 17, 15, 'q=%d%%' % round(100 * q), 13, INK))
    nx = left + NET_FIRST * sc
    labels = []
    for i, p in enumerate(ps):
        y = top + i * 56
        o.append(text(left - 8, y + 26, 'p=%d%%' % round(100 * p), 13, INK, 'end'))
        for j, q in enumerate(qs):
            v = grid[i][j]; yy = y + j * 16
            o.append(rect(left, yy, v * sc, 14, fill=cols[j], opacity=0.85, rx=2))
            lab = m(v); tx = left + v * sc + 5
            if tx + 7 * len(lab) > W - 4:
                labels.append(text(left + v * sc - 5, yy + 12, lab, 13, BG, 'end', 'bold'))
            else:
                # Dark backing so the dashed $900 line never runs through a value label.
                labels.append(rect(tx - 2, yy, 8 * len(lab) + 4, 15, fill=BG))
                labels.append(text(tx, yy + 12, lab, 13, cols[j]))
    # Draw the line under the labels.
    o.append(line(nx, top - 4, nx, top + len(ps) * 56 - 8, INK, 1.2, '4 3'))
    o.extend(labels)
    o.append(text(nx + 4, top + len(ps) * 56 + 6, '$900 first payout', 13, INK))
    return svg(top + len(ps) * 56 + 16, o, 'Model: expected spend per first payout by pass chance p and funded survival q')

fig_spend = figure(spend_bars(),
    'Illustrative model using Topstep\'s published 50K Standard prices as of %s ($49 per attempt, $149 activation). p is the chance one attempt passes; q is the chance a funded account '
    'reaches its first payout. Both are made-up inputs, not statistics: plug in your own. The dashed line is the $900 net first payout from PF-07\'s example.' % AS_OF)

body = [
    '<p>Prop trading is sold as a trading opportunity, but from your side it is also a small business with clear costs: evaluation fees, resets, activation, data and your time. '
    'This chapter adds those costs up and shows how to judge whether your own numbers make sense. It uses one firm\'s published prices as a worked example, and a simple '
    '<strong>expected value</strong> model with inputs you supply.</p>',
    '<p>Nothing here predicts your results. The model is only as good as the pass and survival rates you put in, and those should come from your own practice records, not hope.</p>',

    callout('Key takeaways', '<ul>'
            '<li>Count the full path cost: every attempt, reset and activation fee until you are paid, not just the first month.</li>'
            '<li>Expected spend per first payout rises fast as your pass chance falls. At low pass rates, costs can exceed a typical first payout.</li>'
            '<li>The cheaper headline path is not always cheaper: it depends on how many attempts you take.</li>'
            '<li>Set a monthly budget and a stop rule in advance, and review your real numbers every quarter.</li>'
            '</ul>'),

    '<h2>The costs</h2>',
    '<p>Topstep publishes its prices on its help centre. For the 50K Trading Combine, as of %s:</p>' % AS_OF,
    table(['Item', 'Standard path', 'No Activation Fee path'], [
        ['Monthly subscription', m(MONTH_STD), m(MONTH_NAF)],
        ['Reset', m(RESET_STD), m(RESET_NAF)],
        ['Activation when you pass', m(ACTIVATION_STD) + ' per XFA', '$0'],
        ['Back2Funded reactivation (lost XFA before first payout)', m(B2F_50K), m(B2F_50K)],
    ]),
    '<p>A <strong>reset</strong> "returns your Trading Combine to its original starting balance", and "pushes your Rebill date out 30 days". Each monthly rebill adds one reset credit. '
    'Topstep also limits resets to "2 Resets per account each day", which tells you something: the fastest way to spend money in prop trading is resetting in a hurry. '
    'Data fees, commissions and sales tax can be extra; the pricing page lists them separately.</p>',

    '<h2>Full path cost by number of attempts</h2>',
    '<p>An attempt is one try at the evaluation: the first month, or one reset. Here is the cost to reach a funded account on each path, depending on how many attempts it takes:</p>',
    table(['Attempts to pass', 'Standard path', 'No Activation Fee path'],
          [[str(a), m(s), m(n)] for a, s, n in rows_path]),
    '<p>The No Activation Fee path is cheaper if you pass within three attempts, and more expensive from the ' + str(cross) + 'th. Topstep itself describes it as "best for Traders confident '
    'they\'ll pass in 1\u20132 attempts". PF-03 compared the two paths by months; this is the same idea, counted in attempts.</p>',

    '<h2>Expected value, in plain terms</h2>',
    '<p><strong>Expected value</strong> is the average result of a repeated decision, counting how often each outcome happens. For a prop-firm plan, the question is: on average, '
    'how much do I spend to get one payout, and is the payout bigger?</p>',
    '<p>You need two numbers about yourself:</p>',
    '<ul>'
    '<li><strong>p</strong>: the chance that one attempt passes the evaluation.</li>'
    '<li><strong>q</strong>: the chance that a funded account reaches its first payout before it is lost.</li>'
    '</ul>',
    '<p>If each attempt costs $49, the average number of attempts to pass is 1 \u00f7 p. So the expected spend to reach one funded account is $49 \u00f7 p, plus the $149 activation. '
    'And because only a share q of funded accounts reach a payout, the expected spend per first payout is that amount \u00f7 q.</p>',
    '<p>Worked example: with p = 25%% and q = 50%%, the spend per funded account is $49 \u00f7 0.25 + $149 = %s, and per first payout %s. '
    'Compare that with the first payout you expect, after the split.</p>' % (m(spend_per_xfa(0.25)), m(spend_per_first_payout(0.25, 0.5))),
    fig_spend,
    '<p>The shape is the useful part. At p = 50%% and q = 50%%, expected spend (%s) is under a $900 first payout. At p = 10%%, it is %s even with q = 50%%, far above it. '
    'Small changes in your pass rate move the answer a long way, and that is where your effort should go: into the trading and the risk plan, not into more attempts.</p>'
    % (m(spend_per_first_payout(0.5, 0.5)), m(spend_per_first_payout(0.1, 0.5))),
    '<p>Two limits of the model. It assumes each attempt is independent and equally likely to pass, which is not true if you learn from each one, or if you tilt after failing. '
    'And it ignores later payouts, which can make a funded account worth more than its first payout, and your time, which makes it worth less. Use it to sanity-check a plan, not to forecast.</p>',

    '<h2>What a funded account is worth after the first payout</h2>',
    '<p>The model above stops at the first payout, but a funded account that keeps trading can pay again. Firms cap this in different ways (PF-07): Apex lists a maximum of six payouts per '
    '50K Performance Account, and MFFU Flex a maximum of five sim payouts. Each extra payout needs new qualifying days and profit, and each one carries the same risk of losing the account first.</p>',
    '<p>A careful way to include this is to ask, from your own records, how many payouts your funded accounts have averaged before they ended. If you have no record, count only the first '
    'payout. That errs on the side of caution, which is where a budget should sit.</p>',

    '<h2>Your time is a cost too</h2>',
    '<p>An evaluation takes hours: preparing, trading the session, reviewing and journalling. None of that shows up in the fee table, but it is real. If two plans cost the same in fees '
    'but one needs twice the trading days, the cheaper one in time is the better business choice for most people. Write down roughly how many hours a week your plan takes, '
    'and include it in your quarterly review alongside spend and payouts.</p>',
    '<p>Time also changes your trading. Traders who try to squeeze an evaluation into a busy week often rush the pace, which PF-06 showed is the costly way to pass. '
    'A plan that fits your week is part of the risk plan, not separate from it.</p>',

    '<h2>Where to get p and q</h2>',
    '<p>Not from marketing, forums or other people\'s results. The only honest source is your own record:</p>',
    '<ol>'
    '<li><strong>Practice runs.</strong> Run the evaluation rules on a simulator for several two-week blocks (PF-06). The share you pass is a rough starting p.</li>'
    '<li><strong>Your real attempts.</strong> Once you have paid for a few, use the real count. Update it every quarter.</li>'
    '<li><strong>Funded survival.</strong> Track how many funded accounts reach a first payout. Until you have your own data, assume q is lower than you hope.</li>'
    '</ol>',
    '<p>If you have no record yet, you don\'t know p. That is a good reason to practise before paying, not a reason to guess high.</p>',

    '<h2>Worked example: two traders, same firm</h2>',
    '<p>Hypothetical. Two traders buy the same 50K Standard plan. Their records after a quarter:</p>',
    table(['', 'Trader A', 'Trader B'], [
        ['Practice runs passed', '3 of 4', '1 of 5'],
        ['Paid attempts', '2 (1 month, 1 reset)', '6 (3 months, 3 resets)'],
        ['Passed', '1', '1'],
        ['Fees paid', m(2 * 49 + 149), m(6 * 49 + 149)],
        ['First payout, net', m(900), 'account lost before payout'],
    ]),
    '<p>Trader A practised until the plan passed most of the time, then paid. Trader B practised less and paid more, and the one funded account ended before its first payout, '
    'which is what a low q looks like. Same firm, same prices, very different business. The difference was made before either of them paid a fee.</p>',

    '<h2>A simple monthly budget</h2>',
    '<p>Treat evaluation fees as a fixed budget you can afford to lose entirely, like any other training cost. An illustrative plan:</p>',
    table(['Item', 'Rule'], [
        ['Monthly budget', '$150 total on evaluations and resets'],
        ['Reset rule', 'No reset on the day of a breach; review first (PF-08)'],
        ['Stop rule', 'After 3 failed attempts in a row, one month of simulator practice only'],
        ['Scale rule', 'Add a second account only after a first payout on the first'],
        ['Review', 'Every quarter: real p, real q, total spend, total received'],
    ]),
    '<p>A written budget turns "just one more reset" into a decision you already made when calm.</p>',

    '<h2>Keeping business records</h2>',
    '<p>Keep a simple ledger: date, firm, account, what you paid (subscription, reset, activation, data), what you received, and the account\'s outcome. It gives you your real p and q, '
    'and it is what a tax adviser will ask for. How fees and payouts are taxed depends on your country, so get local professional advice; we don\'t give tax advice.</p>',
    table(['Date', 'Firm / account', 'Item', 'Paid', 'Received', 'Outcome'], [
        ['1 Sep', 'Topstep 50K Std', 'Subscription', m(49), '', 'failed day 6'],
        ['9 Sep', 'Topstep 50K Std', 'Reset', m(49), '', 'passed day 12'],
        ['21 Sep', 'Topstep 50K XFA', 'Activation', m(149), '', 'funded'],
        ['14 Oct', 'Topstep 50K XFA', 'Payout', '', m(900), 'active'],
    ]),
    '<p>Illustrative. In this ledger the trader paid $247 and received $900 on this account. Two attempts, one pass (p so far: 50%), and one first payout from one funded account. '
    'That is one data point, not a rate: keep going until you have several.</p>',

    '<h2>When to stop, pause or switch</h2>',
    '<p>Good businesses have exit rules. Consider pausing paid attempts if your quarterly review shows spend above payouts and no improvement in p, if you keep breaking your own rules, '
    'or if a firm changes its rules in a way that no longer fits your style. Switching firms does not fix a trading problem; it only changes the fees. Pausing to practise often does more.</p>',

    '<h2>Bringing the track together</h2>',
    '<p>This is the last chapter of Prop Firm Mastery. The business view ties the rest together: PF-03\'s vetting decides which firm you pay, PF-04 and PF-05 tell you the rules you are paying for, '
    'PF-06 and PF-08 raise your pass rate p, PF-07 and PF-09 protect your funded survival q, and this chapter checks whether the numbers add up. '
    'If one number is weak, go back to the chapter that controls it.</p>',

    '<h2>Common mistakes</h2>',
    cards(['Mistake', 'Better approach'], [
        ['Counting only the first month', 'Count every attempt, reset and activation until the first payout.'],
        ['Using hoped-for pass rates', 'Use your own practice and real attempt records.'],
        ['Unlimited resets', 'Set a monthly budget and a stop rule.'],
        ['Picking the path with the lower headline price', 'Compare full path cost at your realistic number of attempts.'],
        ['No records', 'Keep a ledger of every fee and payout.'],
    ]),

    '<h3>Practice exercises</h3>',
    '<ol>'
    '<li>Using your firm\'s current prices, rebuild the path-cost table for 1\u20135 attempts on each path.</li>'
    '<li>Estimate p from your practice runs, and assume q = 50%. Work out expected spend per first payout.</li>'
    '<li>Compare it with the net first payout on your plan (PF-07). What pass rate would you need to break even?</li>'
    '<li>Write your monthly budget, reset rule and stop rule, and start a ledger today.</li>'
    '</ol>',

    quiz([
        ('What does a Topstep reset do?', '<p>Returns the Trading Combine to its starting balance, loss limit and day count, and pushes the rebill date out 30 days.</p>'),
        ('At what number of attempts does the No Activation Fee 50K path cost more than Standard?', '<p>From the ' + str(cross) + 'th attempt.</p>'),
        ('With p = 25% and q = 50%, what is expected spend per first payout on the Standard path?', '<p>' + m(spend_per_first_payout(0.25, 0.5)) + '.</p>'),
        ('Where should p and q come from?', '<p>Your own practice runs and real attempts, not marketing or other traders.</p>'),
        ('Does switching firms fix a low pass rate?', '<p>No. It changes the fees, not the trading.</p>'),
    ]),
]

lessons = [
    ('The costs', '<p>List every fee on the path to a payout, using one firm\'s published prices as an example.</p>'),
    ('Path cost by attempts', '<p>Compare Standard and No Activation Fee paths by the number of attempts you take.</p>'),
    ('Expected value', '<p>Use your pass and survival rates to estimate spend per first payout, and see its limits.</p>'),
    ('Budget, records and exit rules', '<p>Set a monthly budget, keep a ledger, and decide in advance when to pause.</p>'),
]

src = [
    ('Topstep Pricing and Payment Questions - Topstep Help Center', 'https://intercom.help/topstep-llc/en/articles/14289835-topstep-pricing-and-payment-questions'),
    ('What is a Reset? - Topstep Help Center', 'https://help.topstep.com/en/articles/8284128-what-is-a-reset'),
    ('Express Funded Account Parameters - Topstep Help Center', 'https://help.topstep.com/en/articles/8284215-express-funded-account-parameters'),
    ('Topstep Payout Policy - Topstep Help Center', 'https://help.topstep.com/en/articles/8284233-topstep-payout-policy'),
    ('Trading Combine Parameters - Topstep Help Center', 'https://help.topstep.com/en/articles/8284197-trading-combine-parameters'),
    ('EOD Payouts - Apex Trader Funding Help Center', 'https://apextraderfunding.com/help-center/eod-trailing-drawdown-accounts/eod-payouts/'),
    ('Flex Plan $50,000: A Comprehensive Guide - My Funded Futures Help Center', 'https://help.myfundedfutures.com/en/articles/15072271-flex-plan-50-000-a-comprehensive-guide'),
]

write_chapter('pf', 'PF-10', 'The Business View: Costs, Resets & Expected Value', 'advanced', '30 min', lessons, body, src)
