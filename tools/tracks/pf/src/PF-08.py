#!/usr/bin/env python3
"""PF-08 Psychology & Failure Modes."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
from svglib import *

AS_OF = 'September 2026'
m = lambda x: ('\u2212$' + fmt(-x, 0)) if x < 0 else '$' + fmt(x, 0)
LIMIT, DAILY = 2000, 400

# ---------------------------------------------------------------- illustrative: one morning, two traders, same trade outcomes
# Each trade either hits the stop (-1R) or target (+1.5R). Same sequence of outcomes for both.
outcomes = ['L', 'L', 'L', 'W', 'L', 'W']
def run(sizing):
    """Plan: fixed $200 risk, stop for the day at -$400. Revenge: double the risk after each loss in a row."""
    pnl = 0; path = [0]; stopped_at = None; streak = 0
    for k, o in enumerate(outcomes):
        if sizing == 'plan' and pnl <= -DAILY:
            stopped_at = k; break
        r = 200 if sizing == 'plan' else 200 * (2 ** streak)
        pnl += int(1.5 * r) if o == 'W' else -r
        streak = streak + 1 if o == 'L' else 0
        path.append(pnl)
        if pnl <= -LIMIT:
            stopped_at = k + 1; break
    return path, stopped_at
plan_path, plan_stop = run('plan')
rev_path, rev_stop = run('revenge')
assert plan_path == [0, -200, -400] and plan_stop == 2          # daily rule ends the morning at -$400
# revenge sizing: 200, 400, 800, then a 1,600 win... check the full path
assert rev_path == [0, -200, -600, -1400, 1000, 800, 1400] and rev_stop is None
# the point: revenge got lucky here, but one more loss at step 4 would have been -3,000 (past the limit)
alt = -1400 - 1600
assert alt < -LIMIT

def spiral_chart():
    n = max(len(plan_path), len(rev_path))
    pp = plan_path + [None] * (n - len(plan_path))
    alt_path = rev_path[:4] + [alt] + [None] * (n - 5)
    return series([(rev_path, GOLD, 'doubling'), (alt_path, RED, 'if 4 lost'), (pp, GREEN, 'plan')],
                  'Illustrative: fixed size with a daily stop vs doubling after losses', height=240, zero=True, left=16, right=300)
svg_s, _ = spiral_chart()
fig_spiral = figure(svg_s,
    'Hypothetical. The same six trade outcomes (L, L, L, W, L, W), each loss \u22121R and each win +1.5R. Green: $200 per trade, stop for the day at \u2212$400. '
    'Gold: doubling size after every loss. It happened to recover, but if trade 4 had also lost (red, "if 4 lost"), the account would have dropped to \u2212$3,000, past a $2,000 limit.')

# ---------------------------------------------------------------- the failure loop diagram
fig_loop = figure(boxes([
    ('1. Trigger', ['a loss, a missed move', 'or a rule nearly hit'], RED),
    ('2. Feeling', ['urge to win it back', 'or fear of the floor'], GOLD),
    ('3. Action', ['bigger size, more', 'trades, wider stop'], GOLD),
    ('4. Result', ['a bigger loss or', 'a broken rule'], RED),
], 'The failure loop: trigger, feeling, action, result', cols=2),
    'A simple way to describe the pattern many firms list as a reason for review (Topstep names revenge trading and "large swings in position size"). '
    'The fix is to break the loop between steps 1 and 3 with a rule decided in advance.', illustrative=False)

body = [
    '<p>Most funded-account rules can be followed on paper by almost anyone. The difficulty is following them on the day you are losing, tired, or one good trade away from a payout. '
    'This chapter looks at the <strong>failure modes</strong>: the repeatable patterns that end evaluations and funded accounts. For each one, we give a rule you can set in advance.</p>',
    '<p>We won\'t quote made-up failure rates. The patterns below come from the firms\' own descriptions of what they look for, and from well-known research on how people decide under risk.</p>',

    callout('Key takeaways', '<ul>'
            '<li>Firms describe the same patterns: revenge trading, big swings in size, repeated daily-limit hits, and gambling-like activity.</li>'
            '<li>Research shows people tend to take more risk to avoid a loss, and to hold losers too long. Prop-firm limits make both expensive.</li>'
            '<li>The fix is mechanical: rules set before the session, enforced by the platform where possible.</li>'
            '<li>Keep a rule-break log. It shows your personal failure mode long before an account ends.</li>'
            '</ul>'),

    '<h2>What the firms say they look for</h2>',
    '<p>Topstep\'s help page on moving live traders back to a simulated account lists the behaviours its risk team watches, "including but not limited to":</p>',
    '<ul>'
    '<li>"Repeatedly hitting the Daily Loss Limit"</li>'
    '<li>"Activity that resembles gambling rather than disciplined trading"</li>'
    '<li>"Inconsistent performance with a risk/reward imbalance \u2014 daily losses far exceeding typical wins"</li>'
    '<li>"Continuous over-leveraging, especially during inflection points"</li>'
    '<li>"Revenge Trading: consistently taking oversized or impulsive trades after a loss"</li>'
    '<li>"Large swings in position size"</li>'
    '</ul>',
    '<p>It also says "a single trade, trading day, or isolated mistake typically won\'t trigger" a review: it is the <strong>pattern</strong> that matters. That is a useful lens for your own trading too.</p>',

    '<h2>Why these patterns are so common</h2>',
    '<p>Two pieces of research help explain them. Both describe tendencies in groups of people, not rules that apply to every trader.</p>',
    '<p><strong>Prospect theory.</strong> Kahneman and Tversky (1979) found that people judge outcomes as gains and losses from a reference point, and that the value curve is '
    '"generally steeper for losses than for gains". They also describe "risk seeking in choices involving sure losses". In trading terms: after a loss, taking a bigger risk to get back '
    'to even can feel better than accepting the loss. That is exactly the revenge trade.</p>',
    '<p><strong>The disposition effect.</strong> Odean (1998) studied trading records for 10,000 brokerage accounts and found "a strong preference for realizing winners rather than losers": '
    'the tendency "to hold losing investments too long and sell winning investments too soon". In a funded account that shows up as moving or removing a stop, and taking profits early on winners.</p>',
    '<p>Neither finding says you will behave this way. They say that, as a group, people in these studies did, which is a good reason to plan for it rather than assume you are the exception.</p>',
    '<p>Prop-firm rules punish both. A trailing floor and a daily limit turn a held loser or a doubled-up trade into a failed account, fast.</p>',

    '<h2>The failure loop</h2>',
    fig_loop,
    '<p>The loop runs quickly: a trigger, a feeling, an action, a result, and often a new trigger. You can\'t stop the feeling. You can stop the <strong>action</strong>, '
    'because it needs you to change size, add a trade, or move a stop, and each of those can be blocked by a rule you set earlier.</p>',

    '<h2>Failure mode 1: revenge sizing</h2>',
    '<p>After a loss, size goes up to win it back quickly. The risk is not that it never works. Sometimes it does, which is what makes it dangerous.</p>',
    fig_spiral,
    table(['Trade', 'Outcome', 'Plan (fixed $200)', 'Doubling after losses'],
          [[str(k + 1), o,
            (m(plan_path[k + 1]) if k + 1 < len(plan_path) else 'stopped for the day'),
            m(rev_path[k + 1])] for k, o in enumerate(outcomes)]),
    '<p>The doubling trader ended the morning up ' + m(rev_path[-1]) + ', and the plan trader down $400. On this one day, the bad habit looked better. '
    'But at trade 4 the doubling trader was risking $1,600 with ' + m(LIMIT + rev_path[3]) + ' of room left: one more loss and the account was gone. '
    'Over many days, a habit that sometimes ends the account will, eventually, end it. The plan trader can never lose more than $400 in a day.</p>',
    '<p><strong>Rule:</strong> size is fixed for the day, decided before the open. A daily loss limit ends the session, enforced by the platform if it can be.</p>',

    '<h2>Failure mode 2: the moved stop</h2>',
    '<p>The trade goes against you, and the stop gets moved further away "to give it room". This is the disposition effect in action. On a funded account, the stop is often the only '
    'thing between a normal loss and a limit breach, and firms enforce limits on open losses: Topstep says its Maximum Loss Limit "is calculated on real-time unrealized P&amp;L".</p>',
    '<p><strong>Rule:</strong> stops can be moved toward profit, never away from it. Use a bracket order so the stop is in place the moment you enter.</p>',

    '<h2>Failure mode 3: overtrading after a near-miss</h2>',
    '<p>A trade you skipped runs to target without you. Or you were stopped out and price then went your way. The next hour is spent chasing entries that are not your setups. '
    'Topstep\'s list calls this "activity that resembles gambling". It rarely shows up as one big loss. More often it is many small ones, plus commissions.</p>',
    '<p><strong>Rule:</strong> a maximum number of trades per day, and only written setups. When you hit the number, you are done.</p>',

    '<h2>Failure mode 4: the payout-line rush</h2>',
    '<p>You are $300 from a target or a payout threshold. Size goes up to finish today. In an evaluation this is where consistency rules bite (PF-04); in a funded account it risks '
    'the buffer you just built (PF-07).</p>',
    '<p><strong>Rule:</strong> being close to a line never changes size. The target will still be there tomorrow.</p>',

    '<h2>Failure mode 5: the reset habit</h2>',
    '<p>When a failed evaluation can be reset for a fee, it is tempting to treat the account as disposable. Topstep\'s help centre explains that a reset starts the account again with '
    'the original balance and rules. That is useful after a real mistake, but a reset bought within minutes of a breach, without reviewing what happened, usually repeats it.</p>',
    '<p><strong>Rule:</strong> no reset or new account on the day of a breach. Write the rule-break log first, then decide the next day. PF-10 looks at what resets cost over time.</p>',

    '<h2>Your rule-break log</h2>',
    '<p>Keep one line for every time you break one of <em>your own</em> rules, even if the firm\'s rules were fine. After a few weeks the pattern is usually obvious. '
    'An illustrative log:</p>',
    table(['Date', 'Rule broken', 'Trigger', 'Cost', 'Fix for next time'], [
        ['Mon', 'Traded after 4-trade limit', 'Missed a move', m(-180), 'Close the platform at 4 trades'],
        ['Wed', 'Doubled size', 'Two losses in a row', m(-600), 'Platform size cap at 5 MES'],
        ['Thu', 'Moved stop', 'Price near stop at news', m(-350), 'Bracket orders only; no trades 5 min before news'],
    ]),
    '<p>Notice that the fixes are mechanical: close the platform, cap size, use brackets. "Be more disciplined" is not a fix you can check.</p>',

    '<h2>A two-minute pre-session check</h2>',
    '<p>Most rule breaks start before the first trade, with a plan that was never set. Run this check at the same time every day, before the platform opens:</p>',
    '<ol>'
    '<li><strong>Numbers:</strong> today\'s size, daily loss limit, trade count and profit stop. Type them into the platform\'s risk settings, not just your notes.</li>'
    '<li><strong>Room:</strong> the distance from your balance to the firm\'s floor. If it is less than it was yesterday, today\'s size may need to be smaller.</li>'
    '<li><strong>Calendar:</strong> scheduled news for your instrument, and any firm rule about trading around it.</li>'
    '<li><strong>State:</strong> one honest line on how you feel. If you are angry about yesterday or rushing to reach a line, trade half size or don\'t trade.</li>'
    '</ol>',
    '<p>The last item is not a mood test. It is a note you can compare with your rule-break log later, to see whether certain states come before certain mistakes.</p>',

    '<h2>After a breach: a short review</h2>',
    '<p>When an account ends, the useful question is not "why was I unlucky?" but "which decision made this possible?". Answer four questions in writing, the same day:</p>',
    '<ol>'
    '<li>Which firm rule ended the account, and at what time?</li>'
    '<li>Which of <em>my</em> rules would have prevented it, and was it set?</li>'
    '<li>What was the trigger just before the rule was broken?</li>'
    '<li>What mechanical change will stop it next time?</li>'
    '</ol>',
    '<p>Only then decide on a reset or a new account. If you can\'t answer question 4 with something the platform can enforce, practise on a simulator until you can.</p>',

    '<h2>Using the platform as your guard rail</h2>',
    '<p>Many of these rules can be enforced by software rather than willpower. Topstep describes a Personal Daily Loss Limit and Personal Daily Profit Target that can liquidate '
    'and block trading for the rest of the session. Many platforms also offer maximum position size settings and bracket orders. Set them once, before trading, when you are calm.</p>',

    '<h2>Common mistakes</h2>',
    cards(['Mistake', 'Better approach'], [
        ['Judging a habit by one lucky day', 'Judge it by what happens on the bad days.'],
        ['Setting rules during the session', 'Set size, loss limit and trade count before the open.'],
        ['Vague rules ("trade less")', 'Numbers: 4 trades, $400 loss, 5 MES maximum.'],
        ['Resetting straight after a breach', 'Log what happened; decide the next day.'],
        ['Hiding rule breaks from your journal', 'Log every break; it is the most useful data you have.'],
    ]),

    '<h3>Practice exercises</h3>',
    '<ol>'
    '<li>Read the firm-behaviour list above and mark the two you are most likely to do. Write one mechanical rule for each.</li>'
    '<li>Set up your platform\'s daily loss, size limit and bracket orders on a simulator.</li>'
    '<li>Start a rule-break log today. Review it every weekend for four weeks.</li>'
    '<li>Rework the doubling example: if trade 4 had lost, how much of the $2,000 limit would be left?</li>'
    '</ol>',

    quiz([
        ('Does Topstep say one bad day triggers a call-down?', '<p>No. It says an isolated mistake "typically won\'t"; it looks for recurring patterns.</p>'),
        ('What did Odean (1998) find in 10,000 brokerage accounts?', '<p>A strong preference for realising winners rather than losers: the disposition effect.</p>'),
        ('In the example, why is doubling dangerous even though it ended the morning up?', '<p>One more loss at trade 4 would have gone past the $2,000 limit.</p>'),
        ('What is the stop-loss rule for this chapter?', '<p>Stops can move toward profit, never away from it.</p>'),
        ('What should you do on the day of a breach instead of resetting?', '<p>Write the rule-break log, then decide the next day.</p>'),
    ]),
]

lessons = [
    ('What firms look for', '<p>Read the behaviours prop firms name as reasons for review, and why patterns matter more than single days.</p>'),
    ('Why these habits are common', '<p>Learn what prospect theory and the disposition effect say about decisions after a loss.</p>'),
    ('Five failure modes', '<p>Revenge sizing, moved stops, overtrading, payout-line rushes and reset habits, each with a rule.</p>'),
    ('Your rule-break log', '<p>Track your own broken rules and turn each one into a mechanical fix.</p>'),
]

src = [
    ('Live Funded Account Call Up and Call Down Process - Topstep Help Center', 'https://help.topstep.com/en/articles/13747178-live-funded-account-call-up-and-call-down-process'),
    ('What is the Maximum Loss Limit? - Topstep Help Center', 'https://help.topstep.com/en/articles/8284204-what-is-the-maximum-loss-limit'),
    ('Daily Loss Limit in the Trading Combine and Express Funded Account - Topstep Help Center', 'https://help.topstep.com/en/articles/10490293-daily-loss-limit-in-the-trading-combine-and-express-funded-account'),
    ('What is a Reset? - Topstep Help Center', 'https://help.topstep.com/en/articles/8284128-what-is-a-reset'),
    ('Kahneman, D. and Tversky, A. (1979). Prospect Theory: An Analysis of Decision under Risk. Econometrica 47(2)', 'https://www.econometricsociety.org/publications/econometrica/1979/03/01/prospect-theory-analysis-decision-under-risk'),
    ('Odean, T. (1998). Are Investors Reluctant to Realize Their Losses? Journal of Finance 53(5)', 'https://faculty.haas.berkeley.edu/odean/papers%20current%20versions/AreInvestorsReluctant.pdf'),
]

write_chapter('pf', 'PF-08', 'Psychology & Failure Modes', 'intermediate', '25 min', lessons, body, src)
