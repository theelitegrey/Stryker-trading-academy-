#!/usr/bin/env python3
"""PF-03 How to Vet a Prop Firm."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
from svglib import *

AS_OF = 'September 2026'

# ---------------------------------------------------------------- Topstep published prices (as of AS_OF), 50K
STD_MONTH, STD_ACT = 49, 149        # Standard path: monthly + one activation fee per XFA
NAF_MONTH, NAF_ACT = 95, 0          # No Activation Fee path
RESET_STD = 49
REACT_50K = 599

def cost(month, act, months):
    return month * months + act

months = list(range(1, 7))
std = [cost(STD_MONTH, STD_ACT, m) for m in months]
naf = [cost(NAF_MONTH, NAF_ACT, m) for m in months]
breakeven = STD_ACT / float(NAF_MONTH - STD_MONTH)
assert 3 < breakeven < 4                     # 149 / 46 = 3.24 months
assert std[2] > naf[2] and std[3] < naf[3]   # NAF cheaper if you pass in 3 months or less; Standard from month 4

def cost_bars():
    o = []; left, right, top = 40, 384, 26; bh = 11
    mx = max(max(std), max(naf)); sc = (right - left - 40) / float(mx)
    o.append(rect(left, 6, 12, 10, fill=GOLD)); o.append(text(left + 18, 15, 'Standard ($49/mo + $149)', 13, INK))
    o.append(rect(left, 22, 12, 10, fill=GREEN)); o.append(text(left + 18, 31, 'No Activation Fee ($95/mo)', 13, INK))
    top = 46
    for k, m in enumerate(months):
        y = top + k * 34
        o.append(text(left - 8, y + 16, '%dm' % m, 13, MUTED, 'end'))
        o.append(rect(left, y, std[k] * sc, bh, fill=GOLD, opacity=0.85, rx=2))
        o.append(text(left + std[k] * sc + 5, y + 10, '$%d' % std[k], 13, GOLD))
        o.append(rect(left, y + bh + 2, naf[k] * sc, bh, fill=GREEN, opacity=0.85, rx=2))
        o.append(text(left + naf[k] * sc + 5, y + bh + 12, '$%d' % naf[k], 13, GREEN))
    return svg(top + len(months) * 34 + 4, o, 'Cost to reach a funded account by months taken, two Topstep 50K paths')

fig_cost = figure(cost_bars(),
    'Total cost to earn one 50K Express Funded Account at Topstep, by how many monthly billing cycles it takes to pass, from its published prices '
    'as of %s. Standard: $49 a month plus a $149 activation fee when you pass. No Activation Fee: $95 a month. The lines cross at about %s months. '
    'Excludes data add-ons, taxes and any extra resets.' % (AS_OF, fmt(breakeven, 1)), illustrative=False)

# ---------------------------------------------------------------- vetting scorecard (a template, not a rating)
checks = [
    ('Identity', ['legal entity named', 'address and support']),
    ('Terms', ['simulated disclosed', 'closure reasons listed']),
    ('Payouts', ['conditions and caps', 'methods and fees']),
    ('Rules', ['one page per plan', 'worked examples']),
    ('Costs', ['all fees on one page', 'refund policy']),
    ('Conduct', ['prohibited list', 'appeal route']),
]
fig_card = figure(boxes([(h, l, GREEN) for h, l in checks], 'Six-part vetting scorecard', cols=2, box_h=80),
    'The six areas to check before buying any evaluation. Each is a yes/no question you can answer from the firm\'s own pages. '
    'It is a checklist template, not a rating of any firm.', illustrative=False)

body = [
    '<p>There are dozens of prop firms, and new ones launch all the time. Some last; some change rules overnight; a few close. Choosing well won\'t make you a better trader, '
    'but choosing badly can cost you fees, time and payouts you thought you had earned. This chapter gives you a repeatable way to <strong>vet</strong> a firm, meaning to check it '
    'properly before you pay, using only what the firm publishes and what regulators let you look up.</p>',
    '<p>We use real examples from firm help pages, quoted <strong>as of %s</strong>. They are examples of what to look for, not recommendations. Stryker is not paid by any firm '
    'mentioned in this track.</p>' % AS_OF,

    callout('Key takeaways', '<ul>'
            '<li>Vet a firm on six areas: identity, terms, payouts, rules, costs and conduct. Each can be checked from public pages.</li>'
            '<li>Price the whole path to a first payout, not the headline evaluation price. Activation, reset and reactivation fees change the maths.</li>'
            '<li>The terms decide disputes. Read the prohibited-practices and payout pages before you buy, not after a rejection.</li>'
            '<li>Treat reviews and influencer codes as marketing. Firm documents and regulator records are your evidence.</li>'
            '</ul>'),

    '<h2>The six-part scorecard</h2>',
    fig_card,
    '<p>Work through each area and write yes or no, with a link to where you found it. If you can\'t find an answer, that is a "no" until support answers in writing.</p>',

    '<h3>1. Identity: who are you paying?</h3>',
    '<p>Find the <strong>legal entity</strong> in the terms of use or the footer. Note its country. This is who you have a contract with and who you would complain to. '
    'If the firm names a brokerage or clearing partner, write that down too. PF-02 showed how to search both on NFA BASIC (U.S.) or the FCA register (UK). '
    'A firm with no named legal entity, or one that won\'t tell support where it is based, fails this step.</p>',

    '<h3>2. Terms: what does the contract say?</h3>',
    '<p>Look for three things. First, whether accounts are <strong>simulated</strong> (most are, as PF-02 showed with Topstep, MFFU and FTMO\'s own wording). Second, the '
    'grounds on which the firm can <strong>close an account or refuse a payout</strong>. Third, whether the firm can <strong>change rules</strong> on existing accounts, and how it tells you.</p>',
    '<p>Firms usually keep discretion. Topstep\'s prohibited-strategies page, for example, says it will "retain the right to reject profit claims if abuse is suspected". '
    'That isn\'t unusual, but it means you need to know exactly what counts as abuse. We cover that in section 6.</p>',

    '<h3>3. Payouts: when, how much, and how?</h3>',
    '<p>A payout policy has four parts. Write each one down:</p>',
    '<ul>'
    '<li><strong>Eligibility:</strong> e.g. Topstep\'s Standard path needs 5 winning days of $150 or more; Apex\'s EOD Performance Account needs 5 qualifying days with a minimum daily profit ($250 on a 50K), as of %s.</li>'
    '<li><strong>Amount:</strong> caps and minimums. Topstep lets you request 50%% of the balance up to a cap by account size; Apex has a $500 minimum and a "safety net" balance you must keep.</li>'
    '<li><strong>Split:</strong> what share you keep. Topstep lists 90/10; Apex lists 100%% of approved payouts; MFFU\'s Flex plan lists 80/20.</li>'
    '<li><strong>Method and fees:</strong> e.g. Topstep lists ACH and wire at $30 each, and some methods with no Topstep fee.</li>'
    '</ul>' % AS_OF,
    '<p>Then look for limits on the number of payouts. MFFU\'s Flex page lists a maximum of 5 sim payouts; Apex\'s EOD page lists a maximum of 6 payouts per Performance Account. '
    'Those limits change the long-run value of an account, which PF-07 and PF-10 come back to.</p>',

    '<h3>4. Rules: can you understand them?</h3>',
    '<p>A good sign is one clear page per plan with the numbers in a table and worked examples. Topstep\'s Maximum Loss Limit page and Apex\'s trailing drawdown page both work through '
    'examples in dollars. A bad sign is rules scattered across blog posts, Discord announcements and FAQs that disagree. If two official pages conflict, ask support which one '
    'applies and keep the reply.</p>',
    '<p>Check the rules for the <strong>exact plan</strong> you would buy. Firms often run several at once: Tradeify lists Growth and Select evaluations with different daily loss rules; '
    'Apex runs intraday and end-of-day drawdown accounts; MFFU keeps "legacy" plans. PF-04 explains every rule type in detail.</p>',

    '<h3>5. Costs: the whole path, not the sticker price</h3>',
    '<p>The evaluation price is only the first fee. List every fee from purchase to first payout: the evaluation (often monthly), resets, activation, data, and the price of getting a funded '
    'account back if you lose it. Topstep\'s pricing page, as of %s, is a good example because it lists them all:</p>' % AS_OF,
    table(['Topstep 50K', 'Standard path', 'No Activation Fee path'], [
        ['Trading Combine', '$%d/month' % STD_MONTH, '$%d/month' % NAF_MONTH],
        ['Reset', '$%d' % RESET_STD, '$95'],
        ['Activation when you pass', '$%d' % STD_ACT, '$0'],
        ['Back2Funded reactivation', '$%d' % REACT_50K, '$%d' % REACT_50K],
    ]),
    '<p>Which path is cheaper depends on how long you take to pass. Here is the maths, using those prices:</p>',
    fig_cost,
    '<p>If you pass in the first three billing months, the No Activation Fee path costs less. From the fourth month, the Standard path does. The crossover is $149 &divide; ($95 &minus; $49) '
    '&asymp; %s months. Most importantly, both lines keep climbing: every extra month costs money, which is why a realistic plan for how long you will take (PF-06) is part of choosing a firm.</p>' % fmt(breakeven, 1),
    '<p>Also read the <strong>refund policy</strong>. Topstep\'s help centre has a refund page; other firms state that fees are non-refundable once an account is used. Know before you pay.</p>',

    '<h3>6. Conduct: what gets you closed</h3>',
    '<p>Every firm publishes a list of prohibited behaviour. Read it line by line and ask: does anything I normally do appear here? Examples as of %s:</p>' % AS_OF,
    '<ul>'
    '<li>Topstep prohibits "account stacking" (blowing one account and repeating on the next), orders outside the best bid or offer, and "trading your full Maximum Position Size directly into a scheduled major news event".</li>'
    '<li>MFFU requires no open positions or orders from 2 minutes before to 2 minutes after Tier 1 releases (FOMC, the employment report, CPI) on its news-restricted accounts.</li>'
    '<li>Lucid flags microscalping when "more than 50% of your profits are generated from trades held for 5 seconds or less".</li>'
    '<li>Tradeify and Lucid both prohibit hedging (opposite positions on the same or related contracts), including across accounts.</li>'
    '</ul>',
    '<p>If your strategy trades the 8:30 a.m. ET data releases, holds overnight, or scalps for a few ticks, some firms will be a poor fit however good their price is. PF-09 covers copy trading and automation rules.</p>',

    '<h2>Evidence you can trust, and evidence you can\'t</h2>',
    cards(['Source', 'How much weight', 'Why'], [
        ['Firm terms and help pages', 'High', 'They are the contract. Save a dated copy.'],
        ['Regulator records (NFA BASIC, FCA register)', 'High', 'Official, searchable and dated.'],
        ['Written answers from support', 'Medium-high', 'Useful when pages are unclear. Keep the email or ticket.'],
        ['Court filings and news reports', 'Medium', 'Show risks, but allegations are not findings (see PF-01).'],
        ['Review sites, Discord, social posts', 'Low', 'Unverified, and often paid through affiliate codes.'],
        ['Payout screenshots and "pass rates"', 'Very low', 'Unverifiable and chosen to impress.'],
    ]),
    '<p>The payout certificates on Stryker\'s own site are real, but the same rule applies: they show that past payouts happened. They are not a promise that you will receive one.</p>',

    '<h2>Worked example: vetting one plan in 30 minutes</h2>',
    '<p>Illustrative walkthrough using the scorecard on a 50K futures evaluation.</p>',
    '<ol>'
    '<li><strong>Identity (5 min).</strong> Find the legal entity in the terms. Search it on NFA BASIC. Note what it is registered as, if anything, and any partner FCM.</li>'
    '<li><strong>Terms (5 min).</strong> Search the terms for "simulated", "terminate" and "modify". Copy the three sentences into your notes.</li>'
    '<li><strong>Payouts (5 min).</strong> Fill in eligibility, amount, split, method and maximum number of payouts.</li>'
    '<li><strong>Rules (5 min).</strong> Write the loss limit type, daily limit, consistency rule, contract limit and close time.</li>'
    '<li><strong>Costs (5 min).</strong> Price the path for passing in month 1, 3 and 6, including activation and one reset.</li>'
    '<li><strong>Conduct (5 min).</strong> Mark anything on the prohibited list that overlaps your strategy.</li>'
    '</ol>',
    '<p>At the end you have a one-page record with links. If a later rule change or payout dispute comes up, you know exactly what you agreed to and when.</p>',

    '<h2>After you buy: keep a paper trail</h2>',
    '<p>Vetting doesn\'t stop at checkout. Rules and pages change, and a dispute months later is decided on what applied at the time. Three habits make that easy:</p>',
    '<ul>'
    '<li><strong>Save dated copies</strong> of the rule, payout and prohibited-practices pages for your plan on the day you buy. A PDF print from the browser is enough.</li>'
    '<li><strong>Keep every support answer</strong> in writing. A chat reply you can\'t find later is worth nothing in a dispute.</li>'
    '<li><strong>Export your trade history</strong> from the platform each week, so you can show exactly what you did if a payout is questioned.</li>'
    '</ul>',
    '<p>If a firm changes a rule, check whether the change applies to your existing account or only to new purchases, and note the date you were told.</p>',

    '<h2>Red flags</h2>',
    '<ul>'
    '<li>No legal entity, or a claimed registration you can\'t find.</li>'
    '<li>Rules that only exist in social posts or change without notice on live accounts.</li>'
    '<li>Payout conditions that are vague ("at our discretion") with no listed criteria.</li>'
    '<li>Pressure tactics: countdown discounts that never end, or "guaranteed" funding claims.</li>'
    '<li>Requests to send fees to personal accounts or crypto wallets outside the checkout.</li>'
    '</ul>',

    '<h2>Common mistakes</h2>',
    cards(['Mistake', 'Better approach'], [
        ['Choosing on the biggest discount code', 'Price the full path to a first payout.'],
        ['Reading rules for the wrong plan', 'Check the plan name on every page you rely on.'],
        ['Relying on a social-media or Discord summary', 'Use the help-centre page, dated and saved.'],
        ['Skipping the prohibited-practices page', 'Compare it line by line with your strategy.'],
        ['Buying several firms at once to "see which works"', 'Vet one properly and learn its rules first.'],
    ]),

    '<h3>Practice exercises</h3>',
    '<ol>'
    '<li>Fill in the six-part scorecard for one firm and plan. Link every answer.</li>'
    '<li>Using Topstep\'s published 50K prices, work out the total cost to pass on the Standard path in month 5 with two extra resets.</li>'
    '<li>Find the maximum number of payouts, if any, on the plan you are considering.</li>'
    '<li>List every prohibited practice that could affect your own strategy, and decide whether the firm is a fit.</li>'
    '</ol>',

    quiz([
        ('What are the six areas of the vetting scorecard?', '<p>Identity, terms, payouts, rules, costs and conduct.</p>'),
        ('At Topstep 50K prices, which path is cheaper if you pass in month 2?', '<p>No Activation Fee: $190, against $247 on the Standard path.</p>'),
        ('Why read the prohibited-practices page before buying?', '<p>It lists behaviour that can close an account or void profits. Your strategy must fit it.</p>'),
        ('How much weight should payout screenshots get?', '<p>Very little. They are unverifiable and selected to impress.</p>'),
        ('Exercise answer: Standard path, pass in month 5, two extra resets?', '<p>$49 &times; 5 + $149 + 2 &times; $49 = $492.</p>'),
    ]),
]

assert cost(STD_MONTH, STD_ACT, 2) == 247 and cost(NAF_MONTH, NAF_ACT, 2) == 190
assert cost(STD_MONTH, STD_ACT, 5) + 2 * RESET_STD == 492

lessons = [
    ('The six-part scorecard', '<p>Learn a repeatable checklist for vetting any prop firm from public documents.</p>'),
    ('Terms, payouts and rules', '<p>Read the contract, payout policy and rule pages for what actually matters.</p>'),
    ('Pricing the whole path', '<p>Work out the full cost to a funded account, including activation and resets, with real published prices.</p>'),
    ('Evidence and red flags', '<p>Know which sources to trust and the warning signs that should stop a purchase.</p>'),
]

src = [
    ('Topstep Pricing and Payment Questions - Topstep Help Center', 'https://intercom.help/topstep-llc/en/articles/14289835-topstep-pricing-and-payment-questions'),
    ('What is a Reset? - Topstep Help Center', 'https://help.topstep.com/en/articles/8284128-what-is-a-reset'),
    ('Topstep Payout Policy - Topstep Help Center', 'https://help.topstep.com/en/articles/8284233-topstep-payout-policy'),
    ('Prohibited Trading Strategies at Topstep - Topstep Help Center', 'https://help.topstep.com/en/articles/10305426-prohibited-trading-strategies-at-topstep'),
    ('EOD Payouts - Apex Trader Funding Help Center', 'https://apextraderfunding.com/help-center/eod-trailing-drawdown-accounts/eod-payouts/'),
    ('Flex Plan $50,000: A Comprehensive Guide - My Funded Futures Help Center', 'https://help.myfundedfutures.com/en/articles/15072271-flex-plan-50-000-a-comprehensive-guide'),
    ('News Trading Policy - My Funded Futures Help Center', 'https://help.myfundedfutures.com/en/articles/8230009-news-trading-policy'),
    ('Prohibited: Microscalping - Lucid Trading Help Center', 'https://support.lucidtrading.com/en/articles/11404742-prohibited-microscalping'),
    ('Prohibited: Hedging - Lucid Trading Help Center', 'https://support.lucidtrading.com/en/articles/11404734-prohibited-hedging'),
    ('Rules: Hedging & Trading Micros & Minis - Tradeify Help Center', 'https://help.tradeify.co/en/articles/10495868-rules-hedging-trading-micros-minis'),
    ('Essential Trading Rules Overview - Tradeify Help Center', 'https://help.tradeify.co/en/articles/12268167-essential-trading-rules-overview'),
    ('Be Smart: Check Registration & Backgrounds Before You Trade - CFTC', 'https://www.cftc.gov/check'),
]

write_chapter('pf', 'PF-03', 'How to Vet a Prop Firm', 'foundation', '25 min', lessons, body, src)
