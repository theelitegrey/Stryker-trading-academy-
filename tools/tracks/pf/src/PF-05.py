#!/usr/bin/env python3
"""PF-05 Major Firms Compared (as of September 2026)."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
from svglib import *

AS_OF = 'September 2026'

# ---------------------------------------------------------------- $50K evaluation facts, each from the firm's own help page (as of AS_OF)
# (firm/plan, target, max loss, drawdown type, daily loss, consistency, min days, max minis)
NS = None   # not stated on the page we read
F = [
    ('Topstep Trading Combine', 3000, 2000, 'EOD trailing', 'optional add-on ($1,000, soft)', '55% (raises target)', '2', 5),
    ('Apex EOD Evaluation', 3000, NS, 'EOD trailing', '$1,000', 'not applied', 'none', 6),
    ('Apex Intraday Evaluation', 3000, 2000, 'intraday trailing', 'none', 'not applied', 'none', 6),
    ('Tradeify Growth', 3000, 2000, 'EOD trailing', '$1,250', 'none', '1', 4),
    ('Tradeify Select', 3000, NS, 'EOD trailing', 'none', '40%', '3', 4),
    ('MFFU Flex', 3000, 2000, 'EOD trailing', 'optional add-on ($1,000, soft)', '50% (evaluation only)', '2', 3),
    ('LucidMaxx', 3000, 2000, 'not stated on eval page', 'not stated on eval page', '40%', '5', None),
]
# Every value above is taken from the firm page listed in sources, as of AS_OF.
# NS: the evaluation page we read gives no dollar figure; we do not infer one from other plans.
for row in F:
    assert row[1] == 3000
stated = [r for r in F if r[2] is not None]
reward_risk = [(r[0], r[1] / float(r[2])) for r in stated]
assert all(abs(v - 1.5) < 1e-9 for _, v in reward_risk)   # every $50K plan here asks for 1.5x its loss limit

# ---------------------------------------------------------------- funded stage payout terms (as of AS_OF)
P = [
    ('Topstep XFA (Standard)', '5 winning days of $150+', '50% of balance, cap $2,000 (50K)', '90/10', 'none stated'),
    ('Apex EOD PA', '5 days of $250+ (50K)', '$500 minimum; keep $52,100 safety net', '100%', '6 payouts'),
    ('Tradeify Growth funded', '5 days of $150+ (50K); 35% consistency', '$500 minimum; balance $53,000 to request', '90%', 'none stated'),
    ('MFFU Flex sim funded', '5 winning days of $150+', '50% of profit, up to $2,000', '80/20', '5 sim payouts'),
]

# ---------------------------------------------------------------- figure: max contracts by plan (from pages)
def contracts_bars():
    rows = [(r[0], r[7]) for r in F if r[7] is not None]
    # de-duplicate Apex (same limit on both evaluation types) and Tradeify (same on both)
    seen, uniq = set(), []
    for n, v in rows:
        key = n.split()[0]
        if key in seen: continue
        seen.add(key); uniq.append((n.replace(' Evaluation', '').replace(' Trading Combine', ''), v))
    o = []; left, right, top = 132, 360, 12
    mx = max(v for _, v in uniq); sc = (right - left) / float(mx)
    for k, (n, v) in enumerate(uniq):
        y = top + k * 38
        o.append(text(left - 8, y + 19, n, 13, INK, 'end'))
        o.append(rect(left, y + 4, v * sc, 24, fill=GREEN, opacity=0.75, rx=3))
        o.append(text(left + v * sc - 6, y + 21, '%d' % v, 14, BG, 'end', 'bold'))
    o.append(text(W / 2, top + len(uniq) * 38 + 12, 'max mini contracts, $50K evaluation', 13, MUTED, 'middle'))
    return svg(top + len(uniq) * 38 + 22, o, 'Maximum contracts on a $50K evaluation by firm'), uniq

svg_c, uniq = contracts_bars()
assert dict(uniq)['Topstep'] == 5 and dict(uniq)['Apex EOD'] == 6 and dict(uniq)['Tradeify Growth'] == 4 and dict(uniq)['MFFU Flex'] == 3
fig_contracts = figure(svg_c,
    'Maximum mini contracts (10 micros count as 1 mini) on each firm\'s $50K evaluation, from each firm\'s help page as of %s. '
    'Lucid\'s LucidMaxx page does not list a contract limit, so it is left out rather than guessed.' % AS_OF, illustrative=False)

# ---------------------------------------------------------------- worked risk-per-trade example (illustrative)
LIMIT = 2000
def trades_to_limit(risk_per_trade):
    return LIMIT // risk_per_trade
examples = [(ctr, pts) for ctr, pts in [(1, 8), (3, 8), (5, 8)]]
risk = [(c, p, c * p * 50) for c, p in examples]     # ES $50/point
assert [r[2] for r in risk] == [400, 1200, 2000]
assert [trades_to_limit(r[2]) for r in risk] == [5, 1, 1]

body = [
    '<p>This chapter puts the main U.S. futures prop firms side by side, using their own help pages. It is a <strong>snapshot as of %s</strong>. '
    'Firms change their rules and prices often, sometimes monthly, so treat every number as a starting point and check the linked page before you buy.</p>' % AS_OF,
    '<p>We compare the $50K evaluation, because it is the most common starting size and every firm offers one. We don\'t rank the firms. The right one depends on how you trade, '
    'and PF-03 gave you the scorecard to decide. Stryker is not paid by any firm mentioned here.</p>',

    callout('Key takeaways', '<ul>'
            '<li>At $50K, every plan here has a $3,000 profit target, and every page that states a loss limit gives $2,000: the target is 1.5 times the limit.</li>'
            '<li>The real differences are in <strong>how</strong> the limit trails, daily loss rules, consistency rules, contract limits and payout terms.</li>'
            '<li>Most plans now use end-of-day trailing. Apex still offers an intraday trailing option.</li>'
            '<li>Payout terms differ more than evaluation terms: splits from 80% to 100%, and some plans cap the number of payouts.</li>'
            '</ul>'),

    '<h2>How to read this comparison</h2>',
    '<ul>'
    '<li><strong>Source:</strong> each number comes from the firm\'s own help page, listed in the sources. Where a page did not state a value, we say so instead of filling it in.</li>'
    '<li><strong>Plan names matter:</strong> firms sell several plans at once. The table names the exact plan.</li>'
    '<li><strong>Snapshot, not a rating:</strong> nothing here says one firm is better, safer or more likely to pay.</li>'
    '</ul>',

    '<h2>The $50K evaluations side by side</h2>',
    cards(['Plan (as of %s)' % AS_OF, 'Profit target', 'Max loss', 'Drawdown', 'Daily loss limit', 'Consistency', 'Minimum days'],
          [[r[0], '$%s' % fmt(r[1], 0), ('$%s' % fmt(r[2], 0)) if r[2] else 'not stated on eval page', r[3], r[4], r[5], r[6]] for r in F]),
    '<p>Notice what is the same. Every plan has a $3,000 target, and every page that states a loss limit gives $2,000, so the headline challenge is the same. Two evaluation pages (Apex EOD and Tradeify Select) did not state the dollar limit when we read them. Check it on the checkout page before buying. What differs is the path you are allowed to take:</p>',
    '<ul>'
    '<li><strong>Drawdown style.</strong> Topstep, Tradeify, MFFU and Apex\'s EOD plan trail your best <em>close</em>. Apex\'s intraday plan trails your best <em>moment</em>, including open profit. PF-04 showed how much room that difference costs.</li>'
    '<li><strong>Daily loss.</strong> Tradeify Growth and Apex EOD have a daily limit built in. Topstep and MFFU make it an optional soft stop. Tradeify Select and Apex intraday have none.</li>'
    '<li><strong>Consistency.</strong> Topstep\'s 55% rule raises the target if you have a big day; Tradeify Select and LucidMaxx apply 40%; Apex and Tradeify Growth have none in the evaluation.</li>'
    '<li><strong>Minimum days.</strong> From none (Apex) to 5 (LucidMaxx). A plan with a consistency rule effectively needs more days too: at 40%, you need at least 3 days.</li>'
    '</ul>',

    '<h2>Position size</h2>',
    fig_contracts,
    '<p>Contract limits range from 3 to 6 minis. That matters less than it looks, because few traders should use the maximum. On ES, an 8-point stop costs $400 per contract. '
    'Here is what that does to a $2,000 limit (illustrative):</p>',
    table(['Contracts', 'Stop (ES points)', 'Risk per trade', 'Full losses to hit $2,000'],
          [[str(c), str(p), '$%s' % fmt(r, 0), str(trades_to_limit(r))] for c, p, r in risk]),
    '<p>At 5 contracts, one full stop ends the evaluation. At 1 contract, you can take five full losses in a row and still be trading. The contract limit is a ceiling, not a target. '
    'PF-06 builds a sizing plan from your stop size and the loss limit.</p>',

    '<h2>What happens after you pass</h2>',
    '<p>Evaluation rules are similar; funded rules are not. Here are the payout terms for the funded stage of each $50K plan, as of %s:</p>' % AS_OF,
    cards(['Funded plan', 'Payout eligibility', 'Amount', 'Your split', 'Payout limit'], [list(p) for p in P]),
    '<p>A few things stand out:</p>',
    '<ul>'
    '<li><strong>Splits range from 80% to 100%.</strong> A higher split is only worth more if you can meet that plan\'s eligibility rules.</li>'
    '<li><strong>Some plans cap payouts.</strong> MFFU Flex lists 5 sim payouts; Apex\'s EOD page lists 6 per Performance Account. After that, the account either moves to live or ends, per the firm\'s rules.</li>'
    '<li><strong>Balance floors differ.</strong> Apex\'s 50K safety net is $52,100, and Tradeify Growth needs a $53,000 balance to request. That profit must be built before you can take any out.</li>'
    '<li><strong>Consistency can return.</strong> Tradeify Growth has no consistency rule to pass, but its funded payout policy applies a 35% rule; Apex applies 50% to payouts.</li>'
    '</ul>',
    '<p>Funded accounts are simulated at all four (Apex says its Performance Account "is a Simulated Funded (Sim Funded) account"). PF-07 covers the funded stage in detail.</p>',

    '<h2>Costs</h2>',
    '<p>We only quote prices a firm publishes on its own help pages, because advertised prices change with promotions. Topstep\'s pricing page, as of %s, lists the 50K Trading Combine at '
    '$49 a month (Standard path, plus a $149 activation fee when you pass) or $95 a month (No Activation Fee path). Apex\'s evaluations run on a 30-day access period, and its site was advertising '
    'a percentage discount code at the time we checked, so its list price and what traders pay can be far apart. For each firm, price the full path to your first payout as PF-03 showed, on the day you buy.</p>',

    '<h2>Beyond futures: a forex/CFD example</h2>',
    '<p>Forex and CFD firms express rules as percentages. Blue Guardian\'s 2-Step Standard, as of %s, lists an 8%% then 4%% profit target, a 4%% maximum daily drawdown of the '
    'initial balance, an 8%% static maximum drawdown, an 85%% profit split, and a minimum holding time of 2 minutes. On a $50,000 account that is a $4,000 then $2,000 target and a '
    '$4,000 static floor, so the maths is quite different from the futures plans above. PF-02 covered why the instruments and data are different too.</p>' % AS_OF,

    '<h2>Questions to ask before you pick one</h2>',
    '<p>The table shows the rules. These questions tie them to you. Answer each one in writing for the plan you are leaning towards:</p>',
    '<ol>'
    '<li><strong>How do I handle open profit?</strong> If you often let a winner run and give some back, an intraday trailing floor will move against you. Prefer end-of-day trailing.</li>'
    '<li><strong>How big are my best days compared with my average?</strong> If one day often makes most of your week, a 40% or 55% consistency rule will slow you down or raise your target.</li>'
    '<li><strong>What is my normal stop, in dollars, at my normal size?</strong> Divide the loss limit by it. Fewer than five full losses leaves very little room for a normal losing streak.</li>'
    '<li><strong>When do I trade?</strong> Check the firm\'s close time and news rules against your session. A New York open trader and a London trader need different things.</li>'
    '<li><strong>What happens after I pass?</strong> Read the funded payout rules now. A plan that is easy to pass but hard to be paid from isn\'t a shortcut.</li>'
    '</ol>',
    '<p>If two plans both pass these questions, the cheaper full path wins. If none does, adjust your trading plan before you adjust your firm.</p>',

    '<h2>Worked example: matching a plan to a trading style</h2>',
    '<p>Illustrative. Three traders read the same table:</p>',
    cards(['Trader', 'Style', 'What fits, and why'], [
        ['A', 'Scalps NQ, sometimes gives back open profit', 'EOD trailing plans. Intraday trailing would tighten the floor on every open high.'],
        ['B', 'Swing-style intraday, one or two big days a week', 'A plan without an evaluation consistency rule, then read the funded payout consistency before buying.'],
        ['C', 'Trades CPI and FOMC releases', 'Check every news rule first. MFFU restricts Tier 1 news on some funded plans; Topstep bars full size into major news.'],
    ]),
    '<p>None of these traders picked a firm on price or on the biggest account. They picked the rules they could live with.</p>',

    '<h2>Common mistakes</h2>',
    cards(['Mistake', 'Better approach'], [
        ['Comparing firms on headline account size', 'Compare target, loss limit, drawdown type and payout terms for the same size.'],
        ['Assuming today\'s table is still true', 'Re-check every page on the day you buy. Save a dated copy.'],
        ['Ignoring funded payout rules', 'Read them before buying: they decide when you can be paid.'],
        ['Choosing the highest contract limit', 'Size from your stop and the loss limit, not the ceiling.'],
        ['Mixing plans from one firm', 'Check which plan each rule belongs to; firms run several at once.'],
    ]),

    '<h3>Practice exercises</h3>',
    '<ol>'
    '<li>Rebuild the evaluation table for the firm and plan you are considering, from today\'s pages. Note any changes from this chapter.</li>'
    '<li>For that plan, write down the payout eligibility, split, minimum balance to request, and any payout cap.</li>'
    '<li>Work out how many full stop-outs your normal size and stop can take before the loss limit.</li>'
    '<li>Write one sentence on which drawdown style suits the way you manage open profit, and why.</li>'
    '</ol>',

    quiz([
        ('What profit target do all the $50K plans here share, and what loss limit do the pages that state one give?', '<p>A $3,000 target; $2,000 maximum loss.</p>'),
        ('Which plan here uses intraday trailing drawdown?', '<p>Apex\'s Intraday Evaluation (and its Intraday Performance Account).</p>'),
        ('How many full $400 stops fit inside a $2,000 limit?', '<p>Five.</p>'),
        ('Which funded plans here cap the number of payouts?', '<p>MFFU Flex (5 sim payouts) and Apex EOD PA (6 payouts).</p>'),
        ('Why is this chapter a snapshot, not a ranking?', '<p>Rules and prices change often, and the right plan depends on your trading style.</p>'),
    ]),
]

lessons = [
    ('Reading a firm comparison', '<p>Learn how the comparison was built, and why it is a dated snapshot rather than a ranking.</p>'),
    ('The $50K evaluations side by side', '<p>Compare targets, loss limits, drawdown types, daily limits, consistency and minimum days.</p>'),
    ('Size and payouts', '<p>See how contract limits turn into risk, and how funded payout terms differ between firms.</p>'),
    ('Matching a plan to your style', '<p>Use the comparison to pick rules that fit how you actually trade.</p>'),
]

src = [
    ('Trading Combine Parameters - Topstep Help Center', 'https://help.topstep.com/en/articles/8284197-trading-combine-parameters'),
    ('Consistency at Topstep - Topstep Help Center', 'https://help.topstep.com/en/articles/8284208-consistency-at-topstep'),
    ('Topstep Payout Policy - Topstep Help Center', 'https://help.topstep.com/en/articles/8284233-topstep-payout-policy'),
    ('Topstep Pricing and Payment Questions - Topstep Help Center', 'https://intercom.help/topstep-llc/en/articles/14289835-topstep-pricing-and-payment-questions'),
    ('EOD Evaluations - Apex Trader Funding Help Center', 'https://apextraderfunding.com/help-center/eod-trailing-drawdown-accounts/eod-evaluations'),
    ('Intraday Trailing Drawdown Evaluations - Apex Trader Funding Help Center', 'https://apextraderfunding.com/help-center/evaluation-accounts-ea/intraday-trailing-drawdown-evaluations/'),
    ('EOD Performance Accounts (PA) - Apex Trader Funding Help Center', 'https://apextraderfunding.com/help-center/eod-trailing-drawdown-accounts/eod-performance-accounts-pa/'),
    ('EOD Payouts - Apex Trader Funding Help Center', 'https://apextraderfunding.com/help-center/eod-trailing-drawdown-accounts/eod-payouts/'),
    ('SELECT vs Growth: Choosing Your Evaluation Type - Tradeify Help Center', 'https://help.tradeify.co/en/articles/13252431-select-vs-growth-choosing-your-evaluation-type'),
    ('Essential Trading Rules Overview - Tradeify Help Center', 'https://help.tradeify.co/en/articles/12268167-essential-trading-rules-overview'),
    ('Growth Funded Account Payout Policy - Tradeify Help Center', 'https://help.tradeify.co/en/articles/11083796-growth-funded-account-payout-policy'),
    ('Flex Plan $50,000: A Comprehensive Guide - My Funded Futures Help Center', 'https://help.myfundedfutures.com/en/articles/15072271-flex-plan-50-000-a-comprehensive-guide'),
    ('News Trading Policy - My Funded Futures Help Center', 'https://help.myfundedfutures.com/en/articles/8230009-news-trading-policy'),
    ('LucidMaxx Eval Rules - Lucid Trading Help Center', 'https://support.lucidtrading.com/en/articles/14315460-lucidmaxx-eval-rules'),
    ('2 Step Standard Rules - Blue Guardian Help Center', 'https://help.blueguardian.com/en/articles/14062291-2-step-standard-rules'),
    ('Micro E-mini Equity Index Futures FAQ - CME Group', 'https://www.cmegroup.com/articles/faqs/micro-e-mini-equity-index-futures-frequently-asked-questions.html'),
]

write_chapter('pf', 'PF-05', 'Major Firms Compared (as of September 2026)', 'intermediate', '25 min', lessons, body, src)
