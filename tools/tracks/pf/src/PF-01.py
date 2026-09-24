#!/usr/bin/env python3
"""PF-01 What Prop Firms Are & How They Make Money."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
from svglib import *

AS_OF = 'September 2026'

# ---------------------------------------------------------------- the three stages (Topstep's published path, as of AS_OF)
fig_stages = figure(boxes([
    ('1. Evaluation', ['simulated account', 'you pay a fee', 'hit target, keep rules'], GREEN),
    ('2. Sim funded', ['still simulated', 'payouts from the firm', 'rules continue'], GOLD),
    ('3. Live', ['real exchange orders', 'often by firm review', 'rules vary by firm'], INK),
    ('Fail any stage', ['account closes', 'pay again to retry', '(reset or new eval)'], RED),
], 'The typical futures prop firm path', cols=2, box_h=96),
    'The usual path at a U.S. futures prop firm, using Topstep\'s published structure as of %s: the Trading Combine (evaluation), '
    'the Express Funded Account (simulated funded) and the Live Funded Account (by call-up only). Other firms use different names for the same stages.' % AS_OF,
    illustrative=False)

# ---------------------------------------------------------------- Topstep live call-up arithmetic (from their published rule)
def live_start(cumulative, account_size, minimum=10000):
    capped = min(cumulative, account_size)
    start = max(0.20 * capped, min(minimum, capped))
    return capped, start, capped - start, cumulative - capped

ex = [(60000, 150000), (80000, 50000)]
calc = [live_start(c, a) for c, a in ex]
assert calc[0] == (60000, 12000, 48000, 0)
assert calc[1] == (50000, 10000, 40000, 30000)

# ---------------------------------------------------------------- MFF allegations, CFTC complaint (real figures, not illustrative)
FEES, PAID = 310, 137          # $ millions, CFTC complaint para. (allegations)
CUST, DEMO, LIVE = 135000, 111000, 24000
assert FEES - PAID == 173  # the complaint states net income of $172M; its own figures are "approximately", so we quote the complaint, not our subtraction

def mff_bars():
    o = []; left, right = 150, 360; top = 30
    scale = (right - left) / float(FEES)
    rows = [('Fees taken in', FEES, GOLD), ('Paid out to customers', PAID, GREEN)]
    for k, (name, v, c) in enumerate(rows):
        y = top + k * 58
        o.append(text(left - 8, y + 24, name, 13, INK, 'end'))
        o.append(rect(left, y, v * scale, 34, fill=c, opacity=0.8, rx=3))
        o.append(text(left + v * scale - 6, y + 23, '$%dM' % v, 14, BG, 'end', 'bold'))
    o.append(text(W / 2, top + 140, 'Customers: %s (%s demo, %s "live")' % (fmt(CUST, 0), fmt(DEMO, 0), fmt(LIVE, 0)), 13, MUTED, 'middle'))
    o.append(text(W / 2, top + 160, 'CFTC allegations, 2023. Case dismissed in 2025.', 13, MUTED, 'middle'))
    return svg(top + 172, o, 'My Forex Funds: fees vs payouts as alleged by the CFTC')

fig_mff = figure(mff_bars(),
    'Figures as alleged in the CFTC\'s August 2023 complaint against Traders Global Group ("My Forex Funds"). These were allegations. '
    'The court dismissed the case in May 2025 and sanctioned the CFTC for its conduct, so none of it was proven at trial.',
    illustrative=False)

# ---------------------------------------------------------------- revenue lines (from firm pages; illustrative arrows)
fig_money = figure(boxes([
    ('Money in', ['evaluation fees', 'resets / reactivations', 'activation fees', 'data add-ons'], GREEN),
    ('Money out', ['payouts to traders', 'platform & data costs', 'staff, marketing', 'live capital (if any)'], RED),
], 'Where a prop firm\'s money comes from and goes', cols=2, box_h=112),
    'The main revenue and cost lines named on firm help pages (evaluation, reset, activation and data fees; payouts). The split between them '
    'is private for each firm, so this diagram shows the categories only, not their sizes.', illustrative=False)

body = [
    '<p>A <strong>prop firm</strong> (short for proprietary trading firm) is a company that trades with its own money instead of its customers\' money. '
    'Traditional prop firms hire traders, give them the firm\'s capital and share the profits. The firms most retail traders now mean by "prop firm" '
    'work differently: you pay a fee to take a trading test, and if you pass under their rules, you trade a firm account and can request a share of the profits.</p>',
    '<p>This track is about that second kind: the <strong>evaluation-model</strong> prop firm, and mainly the U.S. futures firms that Stryker members use most. '
    'This chapter explains what you are actually buying, how the accounts are set up, and how these firms make money. That last part matters, because '
    'it explains almost every rule you will meet in the rest of the track.</p>',
    '<p>Firm rules change often. Every rule in this track is quoted from the firm\'s own help pages <strong>as of %s</strong>, with a link. '
    'Check the current page before you buy anything.</p>' % AS_OF,

    callout('Key takeaways', '<ul>'
            '<li>An evaluation-model prop firm sells you a trading test. You pay a fee, trade a <strong>simulated</strong> account, and must hit a profit target without breaking a loss rule.</li>'
            '<li>Passing usually leads to a second <strong>simulated</strong> account that pays out real money. Moving to a live account is by firm review, not automatic.</li>'
            '<li>Firms earn from fees (evaluations, resets, activations, data) and pay out to the traders who qualify. How big each line is stays private.</li>'
            '<li>Read every rule as the firm\'s risk control. Nothing in this track promises you will pass or be paid.</li>'
            '</ul>'),

    '<h2>From trading desk to trading test</h2>',
    '<p>A classic proprietary trading desk is part of a bank or trading company. The firm puts its own capital at risk, its traders are employees or '
    'contracted partners, and the firm keeps most of the profit. You don\'t buy your way in; you are hired.</p>',
    '<p>The evaluation model turned the hiring process into a product. Instead of interviews, there is a <strong>challenge</strong> or <strong>evaluation</strong> '
    'with published rules. Anyone can buy one. The firm uses the rules to filter traders and the fees to fund the business. Some firms call the test a '
    '"combine", some a "qualification", some an "evaluation", but the structure is the same.</p>',
    '<p>A useful way to think about it: you are not getting a job and you are not opening a brokerage account. You are buying access to a '
    '<strong>rules-based program</strong>, and the contract is the firm\'s terms and help pages.</p>',

    '<h2>The three stages</h2>',
    fig_stages,
    '<p>Most U.S. futures firms follow three stages. The names below are Topstep\'s, as of %s, because their help centre documents each stage clearly.</p>' % AS_OF,
    '<h3>Stage 1: the evaluation</h3>',
    '<p>Topstep calls it the <strong>Trading Combine</strong> and describes it as "a simulated account with one rule and two objectives". The rule is not to let '
    'your balance hit the <strong>Maximum Loss Limit</strong> (a floor that trails up as you make money). The objectives are a <strong>Profit Target</strong> and a '
    '<strong>Consistency Target</strong> (your best day must stay below 55%% of the target). On the $50K account the target is $3,000 and the loss limit is $2,000, as of %s.</p>' % AS_OF,
    '<p>Two details surprise beginners. First, the account is <strong>simulated</strong>: your orders don\'t reach the exchange. Second, Topstep states that '
    '"profits don\'t transfer": money made in the evaluation does not carry over. Passing earns access to the next stage, not cash.</p>',
    '<h3>Stage 2: the simulated funded account</h3>',
    '<p>Topstep\'s next stage is the <strong>Express Funded Account (XFA)</strong>. Its help page calls it "the simulated funded-level account you earn after '
    'passing". The balance starts at <strong>$0</strong>; the "50K" label is your buying power, not money in the account. You build a balance from '
    'profits, and once you meet the payout conditions you can request a share of it, paid in real money with a 90/10 split (you keep 90%%), as of %s.</p>' % AS_OF,
    '<p>Other firms work the same way under other names. My Funded Futures (MFFU) calls it the <strong>Sim Funded</strong> stage, and its $50K Flex plan '
    'page, as of %s, lists a maximum of five sim payouts before the transition to live.</p>' % AS_OF,
    '<h3>Stage 3: live</h3>',
    '<p>Live means orders go to the real market with real firm capital. At Topstep this is the <strong>Live Funded Account</strong>, and its help page says '
    'moving there "isn\'t automatic — it\'s earned": the risk team reviews traders case by case. Some firms, such as Lucid\'s LucidMaxx program '
    'as of %s, advertise a direct move to live after the evaluation. Read the exact wording for the plan you are buying.</p>' % AS_OF,

    '<h2>Worked example: what "live" starts with</h2>',
    '<p>The size of a live account is not always the number on the plan. Topstep\'s published rule (as of %s) is that your live starting balance is '
    '<strong>20%% of your cumulative XFA balance</strong>, capped at your account size, with a $10,000 minimum. The remaining 80%% is held in a <strong>reserve</strong>, '
    'and anything above the cap is forfeited. Here are two illustrative cases worked through that rule:</p>' % AS_OF,
    table(['', 'Case A', 'Case B'], [
        ['Account size', '$%s' % fmt(ex[0][1], 0), '$%s' % fmt(ex[1][1], 0)],
        ['Cumulative XFA balance', '$%s' % fmt(ex[0][0], 0), '$%s' % fmt(ex[1][0], 0)],
        ['Counted (capped at size)', '$%s' % fmt(calc[0][0], 0), '$%s' % fmt(calc[1][0], 0)],
        ['Live starting balance', '$%s' % fmt(calc[0][1], 0), '$%s' % fmt(calc[1][1], 0)],
        ['Held in reserve', '$%s' % fmt(calc[0][2], 0), '$%s' % fmt(calc[1][2], 0)],
        ['Forfeited above cap', '$%s' % fmt(calc[0][3], 0), '$%s' % fmt(calc[1][3], 0)],
    ]),
    '<p>In case A, 20% of $60,000 is $12,000, which is above the $10,000 minimum, so that is the starting balance and $48,000 sits in reserve. '
    'In case B, the $80,000 balance is capped at the $50,000 account size, so $30,000 is forfeited, and 20% of $50,000 is exactly the $10,000 minimum. '
    'The lesson is not the arithmetic. It is that every stage has its own rules, and the headline account size is only one of them.</p>',

    '<h2>How prop firms make money</h2>',
    fig_money,
    '<p>A prop firm\'s income comes mainly from fees. The help pages we read for this track list evaluation fees (often a monthly subscription), '
    '<strong>resets</strong> (paying to restart a failed evaluation), <strong>activation</strong> or reactivation fees for the funded stage, and data add-ons '
    '(for example, Topstep offers Level 2 depth-of-market data as a paid upgrade, as of %s). Its costs include payouts to traders, platform and data fees, staff and marketing.</p>' % AS_OF,
    '<p>What the firms don\'t publish is the balance between these lines: how many evaluations are sold, how many pass, and how much is paid out. '
    'You will see pass rates and payout rates quoted online. Unless a number links to audited or official data, treat it as a guess. '
    'Stryker\'s rule for this track is simple: if we can\'t open the source, we don\'t print the number.</p>',
    '<h3>Why the model shapes the rules</h3>',
    '<p>Because most of a firm\'s traders are on simulated accounts, the firm\'s real risk isn\'t market losses. It is <strong>paying out</strong> to traders whose '
    'results came from luck, oversizing or rule gaming, not repeatable skill. That is why you will see:</p>',
    '<ul>'
    '<li><strong>Loss limits that trail</strong> your best balance, so a lucky spike followed by a give-back ends the account.</li>'
    '<li><strong>Consistency rules</strong> that cap how much of your profit can come from one day.</li>'
    '<li><strong>Minimum winning days</strong> and payout caps, so money is paid out in steps.</li>'
    '<li><strong>Bans</strong> on copying between firms, exploiting simulation fills, or trading around specific news releases (these vary by firm).</li>'
    '</ul>',
    '<p>You don\'t have to like these rules, but you do have to trade inside them. The rest of this track treats each one as a design constraint: '
    'PF-04 takes them apart one by one, and PF-06 builds a risk plan around them.</p>',

    '<h2>A cautionary case: the My Forex Funds complaint</h2>',
    fig_mff,
    '<p>In August 2023 the U.S. Commodity Futures Trading Commission (<strong>CFTC</strong>), the federal regulator for futures markets, sued Traders Global Group, '
    'which traded as My Forex Funds (MFF), a forex and CFD prop firm. The CFTC\'s complaint alleged that about 135,000 customers paid roughly $310 million in fees, '
    'that the firm paid out roughly $137 million, and that the firm itself, not an outside liquidity provider, was the counterparty to its customers\' trades. It also alleged '
    'the firm used pretexts to close accounts and software that worsened customers\' fills.</p>',
    '<p>Here is the part that matters just as much: <strong>those were allegations</strong>. In May 2025 a federal judge dismissed the case and ordered the CFTC to pay the '
    'firm\'s legal fees as a sanction, after a court-appointed special master found the agency had "acted willfully and in bad faith" during the litigation, as Reuters reported. '
    'The claims against MFF were never proven.</p>',
    '<p>So what should a trader take from it? Two things. First, the complaint shows the questions worth asking any firm: who is on the other side of my trades, '
    'where do payouts come from, and what can the firm close my account for? Second, the case outcome is a reminder to separate an accusation from a finding. '
    'PF-02 covers the regulatory picture for futures and forex firms, and PF-03 turns these questions into a vetting checklist.</p>',

    '<h2>What you are really buying</h2>',
    '<p>Put it together and an evaluation is best described as a <strong>paid test with a conditional reward</strong>. You pay for:</p>',
    '<ul>'
    '<li>A simulated account with published rules and a platform to trade it.</li>'
    '<li>The chance to reach a funded stage where the firm pays you a share of simulated profits, within its payout rules.</li>'
    '<li>For some traders, and at the firm\'s discretion, a route to trading live firm capital.</li>'
    '</ul>',
    '<p>You are <strong>not</strong> buying capital, a salary, or any promise of income. Topstep\'s own consistency page makes the design goal plain: '
    '"big spike days don\'t build funded traders. Sustainable habits do." Firms want steady, rule-following traders. That is the trader this track is built to help you become.</p>',
    '<p>This chapter builds on core <a href="chapter.html?ch=41">chapter 41, Prop Firm &amp; Funded Account Considerations</a>, which covers the basics of using a firm with the Stryker framework. '
    'This track goes deeper into the rules, costs and habits.</p>',

    '<h2>Common mistakes</h2>',
    cards(['Mistake', 'Why it hurts', 'Better approach'], [
        ['Treating the evaluation account as real money', 'You trade it with less care, or expect its profits to be paid.', 'Evaluation profit is a score. Read "profits don\'t transfer" literally.'],
        ['Reading the account size as your balance', 'A "50K" funded account may start at $0 with a $2,000 floor.', 'Look up the starting balance and the loss floor for each stage.'],
        ['Assuming live is automatic', 'You plan around capital you may never be given.', 'Read the firm\'s call-up rule; plan on the sim-funded stage.'],
        ['Trusting unsourced pass-rate numbers', 'They shape your expectations with made-up data.', 'Ask for the source. If there isn\'t one, ignore the number.'],
        ['Skipping the terms', 'Account closures often cite rules in the terms, not the summary page.', 'Read the terms and prohibited-practices pages before buying.'],
    ]),

    '<h3>Practice exercises</h3>',
    '<ol>'
    '<li>Pick one futures prop firm. From its help pages, write down the name of each stage and whether each one is simulated or live. Note the date you read them.</li>'
    '<li>For the same firm, list every fee you could pay from first purchase to a first payout: evaluation, reset, activation, data. Link each one to its page.</li>'
    '<li>Find the firm\'s rule for moving to a live account. Is it automatic, or by review? Quote the sentence.</li>'
    '<li>Using Topstep\'s live starting-balance rule from this chapter, work out the live start and reserve for a $40,000 cumulative XFA balance on a $100K account.</li>'
    '</ol>',

    quiz([
        ('In an evaluation-model prop firm, is the evaluation account live or simulated?', '<p>Simulated. Your orders don\'t reach the exchange.</p>'),
        ('Do profits made in Topstep\'s Trading Combine carry over to the funded stage?', '<p>No. Topstep states that profits don\'t transfer; passing earns access to the next stage.</p>'),
        ('What balance does Topstep\'s Express Funded Account start with?', '<p>$0. The 50K/100K/150K label is buying power, not balance.</p>'),
        ('Name three fee types prop firms charge.', '<p>Any three of: evaluation fees, resets, activation or reactivation fees, data add-ons.</p>'),
        ('What happened to the CFTC\'s case against My Forex Funds?', '<p>It was dismissed in May 2025, with sanctions against the CFTC. The allegations were never proven.</p>'),
        ('Work the exercise: $40,000 cumulative XFA balance, $100K account. Live start and reserve?', '<p>Capped amount $40,000 (below $100K). 20% is $8,000, under the $10,000 minimum, so the start is $10,000 and $30,000 is held in reserve.</p>'),
    ]),
]

assert live_start(40000, 100000) == (40000, 10000, 30000, 0)

lessons = [
    ('What an evaluation-model prop firm is', '<p>Learn how the modern prop firm differs from a traditional trading desk, and what you are buying when you pay for an evaluation.</p>'),
    ('The three stages', '<p>Walk through the evaluation, simulated funded and live stages, using one firm\'s published rules as the example.</p>'),
    ('How prop firms make money', '<p>See the fee and payout lines behind the business, and why that model explains the rules.</p>'),
    ('A cautionary case', '<p>Read what the CFTC alleged about My Forex Funds, why the case was dismissed, and the questions it teaches you to ask.</p>'),
]

src = [
    ('Trading Combine Parameters - Topstep Help Center', 'https://help.topstep.com/en/articles/8284197-trading-combine-parameters'),
    ('What is the Maximum Loss Limit? - Topstep Help Center', 'https://help.topstep.com/en/articles/8284204-what-is-the-maximum-loss-limit'),
    ('Express Funded Account Parameters - Topstep Help Center', 'https://help.topstep.com/en/articles/8284215-express-funded-account-parameters'),
    ('Live Funded Account Call Up and Call Down Process - Topstep Help Center', 'https://help.topstep.com/en/articles/13747178-live-funded-account-call-up-and-call-down-process'),
    ('Consistency at Topstep - Topstep Help Center', 'https://help.topstep.com/en/articles/8284208-consistency-at-topstep'),
    ('Flex Plan $50,000: A Comprehensive Guide - My Funded Futures Help Center', 'https://help.myfundedfutures.com/en/articles/15072271-flex-plan-50-000-a-comprehensive-guide'),
    ('LucidMaxx Eval Rules - Lucid Trading Help Center', 'https://support.lucidtrading.com/en/articles/14315460-lucidmaxx-eval-rules'),
    ('CFTC v. Traders Global Group Inc. (My Forex Funds), complaint, D.N.J., Aug 2023 - CFTC', 'https://www.cftc.gov/media/9196/enftradersglobalgroupcomplaint082923/download'),
    ('Judge sanctions CFTC over agency\'s conduct in My Forex Funds case - Reuters, May 2025', 'https://www.reuters.com/legal/government/judge-sanctions-cftc-over-agencys-conduct-my-forex-funds-case-2025-05-14'),
]

write_chapter('pf', 'PF-01', 'What Prop Firms Are & How They Make Money', 'foundation', '25 min', lessons, body, src)
