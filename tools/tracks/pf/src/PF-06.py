#!/usr/bin/env python3
"""PF-06 Passing the Evaluation: Sizing, Risk Plan & Frequency."""
import os, sys, random
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
from svglib import *

AS_OF = 'September 2026'
TARGET, LIMIT = 3000, 2000

# ---------------------------------------------------------------- sizing from stop and limit
def size_for(risk_budget, stop_pts, point_value):
    """Largest whole number of contracts whose stop loss fits the per-trade risk budget."""
    return int(risk_budget // (stop_pts * point_value))

BUDGET = 0.10 * LIMIT            # the example rule: risk 10% of the loss limit per trade
assert BUDGET == 200
sz = [('MES', 8, 5.0), ('ES', 8, 50.0), ('MNQ', 30, 2.0), ('NQ', 30, 20.0)]
sized = [(sym, st, pv, size_for(BUDGET, st, pv), st * pv) for sym, st, pv in sz]
assert [s[3] for s in sized] == [5, 0, 3, 0]   # one ES or NQ contract is already over a $200 budget at these stops

# ---------------------------------------------------------------- illustrative model: chance of reaching target before limit
def sim(p_win, rr, risk, target=TARGET, limit=LIMIT, runs=20000, seed=7, max_trades=400, trailing=False):
    """Random-walk model of an evaluation. Each trade wins rr*risk with probability p_win, else loses risk.
    trailing=True applies an end-of-trade trailing floor (a simplification of trailing drawdown).
    Returns share of runs that reach the target before touching the floor. Illustrative only."""
    rnd = random.Random(seed); ok = 0
    for _ in range(runs):
        bal = 0.0; peak = 0.0
        for _ in range(max_trades):
            bal += rr * risk if rnd.random() < p_win else -risk
            if trailing: peak = max(peak, bal)
            floor = (min(peak, 0.0) if False else peak) - limit if trailing else -limit
            if bal >= target: ok += 1; break
            if bal <= floor: break
    return ok / float(runs)

# One fixed, made-up edge: 45% of trades win 1.5x what losers lose (expectancy +0.125R per trade).
P, RR = 0.45, 1.5
risks = [100, 200, 400, 800]
res_static = [sim(P, RR, r) for r in risks]
res_trail = [sim(P, RR, r, trailing=True) for r in risks]
# the sanity checks the text relies on: smaller risk passes more often in this model, trailing is harder than static
assert all(a > b for a, b in zip(res_static, res_static[1:]))
assert all(t <= s + 1e-9 for s, t in zip(res_static, res_trail))
pct = lambda x: '%d%%' % round(100 * x)

def model_bars():
    o = []; left, right, top = 70, 360, 30
    sc = (right - left)
    o.append(rect(left, 6, 12, 10, fill=GREEN)); o.append(text(left + 18, 15, 'static floor', 13, INK))
    o.append(rect(left + 150, 6, 12, 10, fill=GOLD)); o.append(text(left + 168, 15, 'trailing floor', 13, INK))
    for k, r in enumerate(risks):
        y = top + k * 44
        o.append(text(left - 8, y + 18, '$%d' % r, 13, INK, 'end'))
        for j, (v, c) in enumerate(((res_static[k], GREEN), (res_trail[k], GOLD))):
            yy = y + j * 15
            o.append(rect(left, yy, max(v * sc, 1), 13, fill=c, opacity=0.85, rx=2))
            o.append(text(left + v * sc + 5, yy + 11, pct(v), 13, c))
    o.append(text(W / 2, top + len(risks) * 44 + 10, 'risk per trade (same made-up edge)', 13, MUTED, 'middle'))
    return svg(top + len(risks) * 44 + 20, o, 'Model: share of simulated evaluations reaching the target, by risk per trade')

fig_model = figure(model_bars(),
    'Illustrative model, not a statistic about real traders. 20,000 simulated evaluations per bar, each trade a coin flip with a made-up edge: 45% of trades win 1.5 times the risk, '
    'the rest lose 1 times the risk. Target $3,000, limit $2,000. The same edge passes more often at smaller size, and a trailing floor makes it harder at every size. '
    'Real results depend on your own edge, which this model does not know.')

body = [
    '<p>An evaluation is a narrow test: make a set amount before you lose a smaller set amount, without breaking any rule. Most of that is decided before your first trade, '
    'by <strong>how big you trade</strong> and <strong>how you plan to behave</strong> on good and bad days. This chapter turns the rules from PF-04 into a written risk plan you can follow.</p>',
    '<p>It won\'t tell you how to find trades. That is what the core course is for. Nothing here promises a pass: the aim is to give a genuine edge the best chance to show up inside the rules.</p>',

    callout('Key takeaways', '<ul>'
            '<li>Size from the <strong>loss limit</strong> and your <strong>stop</strong>, not from the contract limit. A common planning rule is to risk a small fixed share of the limit per trade.</li>'
            '<li>In a simple model, the same edge reaches the target more often at smaller size, and a trailing floor makes it harder at every size.</li>'
            '<li>Set daily rules: a maximum loss, a maximum number of trades, and a profit level where you stop, sized to the consistency rule.</li>'
            '<li>There is no prize for speed. Minimum-day and consistency rules reward steady days, and every extra month costs a fee.</li>'
            '</ul>'),

    '<h2>Start from the loss limit, not the contract limit</h2>',
    '<p>On a $50K plan with a $2,000 limit, the contract limit might be 5 minis. That number tells you what you are <em>allowed</em> to do. Your size should come from what one losing trade costs. '
    'A simple, common planning rule is to risk a fixed share of the loss limit on each trade. With 10%%, your budget is $%s per trade, so you can take ten full losses before the limit.</p>' % fmt(BUDGET, 0),
    '<p>Here is that budget turned into contracts, using CME point values and example stop sizes:</p>',
    table(['Contract', 'Stop (points)', '$ risk per contract', 'Contracts within $200'],
          [[s, str(st), '$%s' % fmt(st * pv, 0), str(n)] for s, st, pv, n, _ in sized]),
    '<p>One ES contract with an 8-point stop risks $400, already double the budget. That is why so many evaluation traders use the <strong>micro</strong> contracts: MES is $5 a point and MNQ $2, '
    'so size can be set in small steps. If your strategy needs a wider stop, the answer is fewer contracts, not a bigger budget.</p>',

    '<h2>Why smaller size helps: a simple model</h2>',
    '<p>To see the effect of size on its own, we can simulate an evaluation many times with a fixed, made-up edge and change only the risk per trade. This is a <strong>model</strong>, '
    'not a record of real traders. It only shows how the rules and size interact.</p>',
    fig_model,
    '<p>With the same edge, risking $100 per trade reached the target in %s of simulated runs with a static floor; risking $800 reached it in %s. The larger size didn\'t change the edge, '
    'it just gave bad luck fewer trades to happen in. With a trailing floor, every result was lower (%s and %s), because each new high tightens the floor.</p>'
    % (pct(res_static[0]), pct(res_static[-1]), pct(res_trail[0]), pct(res_trail[-1])),
    '<p>Two cautions. First, if a strategy has <strong>no</strong> edge, no sizing plan helps; smaller size just takes longer to fail. Second, the model ignores costs, slippage and rule details. '
    'Use it to understand the shape of the problem, not to predict your chances.</p>',

    '<h2>Your daily rules</h2>',
    '<p>The firm\'s rules are the outer wall. Your own daily rules sit inside them and stop one bad session becoming a failed account. Write down four numbers:</p>',
    cards(['Daily rule', 'Example ($50K, $2,000 limit)', 'Why'], [
        ['Maximum daily loss', '$400 (2 full stops at $200)', 'Two bad trades end the day, not the account.'],
        ['Maximum trades', '4', 'Stops revenge trading after losses.'],
        ['Daily profit stop', '$1,000 (under Topstep\'s $1,650 best-day line)', 'Keeps you inside a 55% consistency rule.'],
        ['No-trade times', 'CPI, FOMC, NFP releases', 'Avoids news rules and fast markets.'],
    ]),
    '<p>Several platforms can enforce these for you. Topstep\'s help page describes a <strong>Personal Daily Loss Limit</strong> you set in risk settings, with a choice to do nothing, liquidate, '
    'or "Liquidate and Block" for the session, and a Personal Daily Profit Target that works the same way. A limit the platform enforces is much harder to argue with in the moment.</p>',

    '<h2>Pacing: how fast should you go?</h2>',
    '<p>Nothing in the rules rewards passing quickly, and several things punish it. Consistency rules cap your best day. Some plans have minimum days. And on a trailing floor, a fast run-up '
    'followed by a give-back is exactly what ends accounts. A useful way to plan is in days: $3,000 over ten trading days is $300 a day, or about 1.5 full wins at a $200 risk with a 1.5R target.</p>',
    '<p>Also plan for the <strong>cost of time</strong>. Monthly evaluations bill every 30 days; PF-03 worked out that a Topstep 50K Standard path costs $49 for each month it takes. '
    'A realistic pace is cheaper than a failed rush plus a reset.</p>',

    '<h2>Adjusting size as the account changes</h2>',
    '<p>Your risk budget comes from the room you have, so it should change when the room changes. Two simple rules keep this mechanical:</p>',
    '<ul>'
    '<li><strong>After a drawdown, size down.</strong> If the gap between balance and floor falls to half the loss limit, halve your risk per trade. '
    'Ten full losses of room becomes five, and your plan should notice that before the firm does.</li>'
    '<li><strong>After gains, don\'t size up on a trailing plan.</strong> On an end-of-day trailing floor, new highs raise the floor too, so your room hasn\'t grown. '
    'Only on a static floor, or once a trailing floor has locked, does profit actually add to your buffer.</li>'
    '</ul>',
    '<p>Write both rules into your plan with numbers, so you aren\'t deciding them on a bad afternoon.</p>',

    '<h2>The written risk plan</h2>',
    '<p>Put all of this on one page. An illustrative example:</p>',
    table(['Item', 'My plan'], [
        ['Plan and firm', '50K, EOD trailing, $2,000 limit, $3,000 target'],
        ['Instruments', 'MES only (one contract type at a time)'],
        ['Risk per trade', '$200 (10% of limit); stop 8 pts; 5 MES'],
        ['Daily loss / trades', '$400 / 4 trades, then stop'],
        ['Daily profit stop', '$1,000'],
        ['Setups allowed', 'Core-course A+ setups only, in the NY session'],
        ['After passing', 'Read funded rules before first funded trade'],
    ]),
    '<p>Review it every weekend. If you broke it, write down which line and why. The plan only works if it is the same plan every day.</p>',

    '<h2>Worked example: a two-week evaluation</h2>',
    '<p>Illustrative. A trader follows the plan above for ten trading days:</p>',
]

def money(x):
    return ('−$%s' % fmt(-x, 0)) if x < 0 else '$%s' % fmt(x, 0)

# illustrative 10-day path under the plan
days = [300, -400, 150, 450, 0, 300, -200, 600, 450, 600]
bal = []; b = 0
for d in days:
    b += d; bal.append(b)
assert max(days) <= 1000 and min(days) >= -400
best = max(days); total = bal[-1]
assert total == 2250
assert best / float(TARGET) < 0.55
floor = []; peak = 0
for v in bal:
    peak = max(peak, v); floor.append(peak - LIMIT)
assert all(v > f for v, f in zip(bal, floor))
svg_path, _ = series([([0] + bal, GREEN, 'balance'), ([-LIMIT] + floor, RED, 'floor'), ([TARGET] * (len(bal) + 1), MUTED, 'target')],
                     'Illustrative ten-day evaluation: running P&L, EOD trailing floor and target', height=220, zero=True,
                     point_labels=[(days.index(best) + 1, bal[days.index(best)], 'best day', GOLD)])
fig_path = figure(svg_path, 'Illustrative. Running P&L (green) against the end-of-day trailing floor (red) and the $3,000 target, day 0 to day 10. '
                  'The floor rises with each new closing high but the gap never closes, because the daily loss rule caps each bad day at $400.')
room = [v - fl for v, fl in zip(bal, floor)]
assert min(room) >= 1400
body += [
    table(['Day', 'P&L', 'Running total', 'EOD floor (vs start)'],
          [[str(i + 1), ('+$%s' % fmt(d, 0)) if d > 0 else ('−$%s' % fmt(-d, 0) if d < 0 else '$0'), money(v), money(f)]
           for i, (d, v, f) in enumerate(zip(days, bal, floor))]),
    '<p>After ten days the trader is up $%s, with a best day of $%s (%s of the $3,000 target, inside a 55%% rule). The daily loss limit held both losing days to $400 or less, so the floor was never close. '
    'The target isn\'t reached yet, and that is fine: another few normal days will do it, without any single day having to be big.</p>' % (fmt(total, 0), fmt(best, 0), pct(best / float(TARGET))),

    fig_path,
    '<p>The smallest gap between balance and floor was $%s. That is the number to watch every day: it is how much room you really have, and in a trailing plan it shrinks as you make new highs.</p>' % fmt(min(room), 0),

    '<h2>What to track while you trade it</h2>',
    '<p>An evaluation is also a clean record of your trading under fixed rules. Keep a short log each day, so that pass or fail, you learn something specific:</p>',
    '<ul>'
    '<li><strong>Room left:</strong> balance minus the floor, at the close. If it keeps falling, cut size before the firm does it for you.</li>'
    '<li><strong>Rule breaks:</strong> any time you went past one of your own daily rules, even if the firm\'s rules were fine. These are the early warning.</li>'
    '<li><strong>Setup quality:</strong> whether each trade was one of your written setups. Losses on planned trades are normal; losses on unplanned ones are a habit to fix.</li>'
    '<li><strong>Best day share:</strong> your best day divided by total profit, so you see a consistency problem coming days before it bites.</li>'
    '</ul>',
    '<p>If you fail, this log is what you study before buying a reset. PF-08 looks at the patterns that show up most often in these logs, and how to break them.</p>',

    '<h2>Before you buy: a practice run</h2>',
    '<p>The cheapest evaluation is the one you pass on your first attempt, so rehearse first. Most platforms offer a free simulator. Set it up with the plan\'s exact numbers: '
    'the same starting balance, a manual note of the floor each night, your daily rules, and the same contract. Trade it for two weeks as if it were real. '
    'If you would have failed the practice run, you have saved the fee and learned what to fix. If you pass it comfortably, you are buying the evaluation with evidence rather than hope.</p>',

    '<h2>Common mistakes</h2>',
    cards(['Mistake', 'Better approach'], [
        ['Trading the contract limit', 'Size from your stop and a fixed share of the loss limit.'],
        ['Trying to pass in one or two days', 'Plan the target over 8–10 normal days.'],
        ['Adding size after a loss to "get it back"', 'Your daily loss rule ends the day; size stays fixed.'],
        ['No profit stop on a great day', 'Stop at your daily profit line so consistency rules don\'t raise the target.'],
        ['Changing strategy mid-evaluation', 'Trade the same A+ setups you practised, or pause and practise first.'],
    ]),

    '<h3>Practice exercises</h3>',
    '<ol>'
    '<li>Using your normal stop in points, work out how many micro contracts fit inside 10% of your plan\'s loss limit.</li>'
    '<li>Write your four daily rules with numbers, and set the ones your platform supports.</li>'
    '<li>Divide your target by ten days. How many full wins at your planned risk and reward is that per day?</li>'
    '<li>Write your one-page risk plan and trade it on a simulator for a week before buying an evaluation.</li>'
    '</ol>',

    quiz([
        ('With a $2,000 limit and a 10% rule, what is the risk budget per trade?', '<p>$200.</p>'),
        ('How many MNQ contracts fit a $200 budget with a 30-point stop?', '<p>Three ($60 each at $2 a point).</p>'),
        ('In the model, what happened to the pass share as risk per trade rose?', '<p>It fell, with the same edge. A trailing floor lowered it at every size.</p>'),
        ('Why set a daily profit stop in an evaluation with a consistency rule?', '<p>So no single day grows past the consistency limit and raises your target.</p>'),
        ('Does good sizing help a strategy with no edge?', '<p>No. It only slows the losses.</p>'),
    ]),
]

lessons = [
    ('Sizing from the loss limit', '<p>Turn a loss limit and your stop into a contract size, using micro and mini point values.</p>'),
    ('What size does to your odds', '<p>See in a simple illustrative model why the same edge passes more often at smaller size.</p>'),
    ('Daily rules and pacing', '<p>Set a daily loss, trade count and profit stop, and plan the target over normal days.</p>'),
    ('Your written risk plan', '<p>Put the whole plan on one page and follow a worked two-week example.</p>'),
]

src = [
    ('Micro E-mini Equity Index Futures FAQ - CME Group', 'https://www.cmegroup.com/articles/faqs/micro-e-mini-equity-index-futures-frequently-asked-questions.html'),
    ('Trading Combine Parameters - Topstep Help Center', 'https://help.topstep.com/en/articles/8284197-trading-combine-parameters'),
    ('Consistency at Topstep - Topstep Help Center', 'https://help.topstep.com/en/articles/8284208-consistency-at-topstep'),
    ('Daily Loss Limit in the Trading Combine and Express Funded Account - Topstep Help Center', 'https://help.topstep.com/en/articles/10490293-daily-loss-limit-in-the-trading-combine-and-express-funded-account'),
    ('Topstep Pricing and Payment Questions - Topstep Help Center', 'https://intercom.help/topstep-llc/en/articles/14289835-topstep-pricing-and-payment-questions'),
    ('Rules: Hedging & Trading Micros & Minis - Tradeify Help Center', 'https://help.tradeify.co/en/articles/10495868-rules-hedging-trading-micros-minis'),
    ('News Trading Policy - My Funded Futures Help Center', 'https://help.myfundedfutures.com/en/articles/8230009-news-trading-policy'),
]

write_chapter('pf', 'PF-06', 'Passing the Evaluation: Sizing, Risk Plan & Frequency', 'intermediate', '30 min', lessons, body, src)
