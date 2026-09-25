#!/usr/bin/env python3
"""PF-07 The Funded Stage: Buffers, Payouts & Withdrawals."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
from svglib import *

AS_OF = 'September 2026'
m = lambda x: ('\u2212$' + fmt(-x, 0)) if x < 0 else '$' + fmt(x, 0)

# ---------------------------------------------------------------- published $50K funded rules (as of AS_OF)
# Topstep XFA: balance starts at $0, MLL starts at -$2,000 and trails; after the first payout MLL is set to $0.
#   Standard path: 5 winning days of $150+, request 50% of balance, 50K cap $2,000, 90/10 split.
# MFFU Flex sim funded: starts $0, floor -$2,000; 5 winning days of $150+; up to 50% of profits, max $2,000; 80/20;
#   after the first payout the MLL moves to $100 and stays fixed; max 5 sim payouts.
# Apex EOD PA 50K: safety net $52,100, min balance to request $52,600, min payout $500, 5 days of $250+,
#   50% consistency, 100% split, max 6 payouts: 1,500 / 1,500 / 2,000 / 2,500 / 2,500 / 3,000.
APEX_CAPS = [1500, 1500, 2000, 2500, 2500, 3000]
assert sum(APEX_CAPS) == 13000
APEX_START, APEX_NET, APEX_REQ = 50000, 52100, 52600
assert APEX_REQ - APEX_NET == 500 and APEX_NET - APEX_START == 2100

# ---------------------------------------------------------------- worked example: same $3,000 profit, first payout
PROFIT = 3000
def topstep(profit):
    req = min(0.5 * profit, 2000); bal = profit - req; floor = 0
    return dict(req=req, net=0.9 * req, bal=bal, floor=floor, room=bal - floor)
def mffu(profit):
    req = min(0.5 * profit, 2000); bal = profit - req; floor = 100
    return dict(req=req, net=0.8 * req, bal=bal, floor=floor, room=bal - floor)
def apex(profit):
    bal = APEX_START + profit
    req = min(bal - APEX_NET, APEX_CAPS[0]) if bal >= APEX_REQ else 0
    bal2 = bal - req
    return dict(req=req, net=req, bal=bal2 - APEX_START, floor=APEX_NET - APEX_START, room=bal2 - APEX_NET)
T, M, A = topstep(PROFIT), mffu(PROFIT), apex(PROFIT)
assert (T['req'], T['net'], T['room']) == (1500, 1350, 1500)
assert (M['req'], M['net'], M['room']) == (1500, 1200, 1400)
assert (A['req'], A['net'], A['room']) == (900, 900, 0)   # Apex: only profit above the $52,100 safety net can be paid

def room_bars():
    rows = [('Topstep XFA', T), ('MFFU Flex', M), ('Apex EOD PA', A)]
    o = []; left, right, top = 112, 330, 30
    mx = 1600.0; sc = (right - left) / mx
    o.append(rect(left, 6, 12, 10, fill=GREEN)); o.append(text(left + 18, 15, 'you receive', 13, INK))
    o.append(rect(left + 128, 6, 12, 10, fill=GOLD)); o.append(text(left + 146, 15, 'room left', 13, INK))
    for k, (n, d) in enumerate(rows):
        y = top + k * 46
        o.append(text(left - 8, y + 20, n, 13, INK, 'end'))
        for j, (v, c) in enumerate(((d['net'], GREEN), (d['room'], GOLD))):
            yy = y + j * 16
            o.append(rect(left, yy, max(v * sc, 1.5), 14, fill=c, opacity=0.85, rx=2))
            o.append(text(left + max(v * sc, 1.5) + 5, yy + 12, m(v), 13, c))
    o.append(text(W / 2, top + 3 * 46 + 10, 'first payout after $3,000 profit', 13, MUTED, 'middle'))
    return svg(top + 3 * 46 + 20, o, 'First payout vs room left above the floor, three $50K funded plans')

fig_room = figure(room_bars(),
    'Hypothetical example using each firm\'s published $50K funded rules as of ' + AS_OF + '. Same $3,000 profit, largest first payout allowed, '
    'then how much room is left between the balance and the loss floor. Taking money out and keeping a buffer pull in opposite directions.')

# ---------------------------------------------------------------- worked multi-cycle path on the Topstep XFA rules
days = [400, 300, -250, 500, 350, 450, 250, -500, 300, 200,   # cycle 1 (10 days)
        350, -400, 300, 250, 200, 300, 150]                      # cycle 2
bal = []; floor = []; b = 0; fl = -2000; peak = 0; paid = []; taken = False
for i, d in enumerate(days):
    b += d
    peak = max(peak, b)
    if not taken:
        fl = max(fl, min(peak - 2000, 0))
    if i == 9:                      # first payout after day 10
        req = min(0.5 * b, 2000); paid.append((i, req)); b -= req; fl = 0; taken = True
    bal.append(b); floor.append(fl)
assert all(v > f for v, f in zip(bal, floor))
first_req = paid[0][1]
assert first_req == 1000 and bal[9] == 1000
wins_c1 = sum(1 for d in days[:10] if d >= 150)
assert wins_c1 >= 5
svg_path, _ = series([([0] + bal, GREEN, 'balance'), ([-2000] + floor, RED, 'floor')],
                     'Illustrative XFA path: balance and loss floor with one payout', height=220, zero=True,
                     point_labels=[(10, bal[9], 'payout', GOLD)])
fig_path = figure(svg_path,
    'Hypothetical. Seventeen trading days on a $50K XFA under Topstep\'s published rules. The floor trails up from \u2212$2,000; '
    'after the first payout it is set to $0, so the balance left after the payout becomes the whole buffer.')
min_room_after = min(v - f for v, f in zip(bal[10:], floor[10:]))
lock_day = next(i for i, f in enumerate(floor) if f == 0) + 1
assert lock_day < 10 and min_room_after == 950 and min_room_after - 2 * 400 > 0 and min_room_after - 3 * 400 <= 0

body = [
    '<p>Passing an evaluation gets you a <strong>funded account</strong>: an account where the firm pays you a share of the profits you make. '
    'At most futures firms this stage is still <strong>simulated</strong>. Topstep calls its Express Funded Account "the simulated funded-level account you earn after passing", '
    'and Apex calls its Performance Account a "Simulated Funded (Sim Funded) account". Payouts are real money, paid by the firm from its own funds, as PF-01 explained.</p>',
    '<p>This chapter covers the rules that decide <strong>when</strong> you can be paid, <strong>how much</strong>, and what each payout does to your safety margin. '
    'All rules are quoted as of ' + AS_OF + ' from each firm\'s help pages. Check them again before relying on them.</p>',

    callout('Key takeaways', '<ul>'
            '<li>Funded rules differ from evaluation rules. Read them before your first funded trade, not when you want your first payout.</li>'
            '<li>Most plans need a set number of qualifying profitable days, a minimum balance or profit, and sometimes a consistency rule before each payout.</li>'
            '<li>At several firms the first payout moves your loss floor up. After that, the money you leave in the account is your only buffer.</li>'
            '<li>A bigger payout means a thinner buffer. Decide in advance how much to take and how much to leave.</li>'
            '</ul>'),

    '<h2>What changes when you are funded</h2>',
    '<p>The account usually starts again. Topstep and MFFU both start the funded balance at <strong>$0</strong>, with the loss floor at \u2212$2,000 on a $50K plan: '
    'Topstep says the "50K" label "refers to your buying power, not your starting balance". Apex keeps the $50,000 balance and uses a fixed <strong>safety net</strong>. '
    'Either way, you begin with the same $2,000 of room you had in the evaluation, not with your evaluation profit.</p>',
    '<p>Three new kinds of rule appear:</p>',
    '<ul>'
    '<li><strong>Payout eligibility:</strong> what you must do before you can ask to be paid.</li>'
    '<li><strong>Payout size:</strong> the minimum and maximum per request, and your share (the <strong>split</strong>).</li>'
    '<li><strong>What happens after a payout:</strong> changes to the floor, the day count, or the number of payouts left.</li>'
    '</ul>',

    '<h2>Payout eligibility, $50K plans</h2>',
    cards(['Plan (as of ' + AS_OF + ')', 'Qualifying days', 'Other conditions', 'Amount per request', 'Your split'], [
        ['Topstep XFA, Standard path', '5 winning days of $150+', 'none beyond the days', '50% of balance, cap $2,000', '90%'],
        ['Apex EOD Performance Account', '5 days of $250+', 'balance of $52,600 to request; 50% consistency', '$500 minimum; caps rise from $1,500 to $3,000', '100%'],
        ['Tradeify Growth funded', '5 days of $150+', 'balance of $53,000; 35% consistency', '$500 minimum; first cap $1,500', '90%'],
        ['MFFU Flex sim funded', '5 winning days of $150+', '$500 net profit since the last payout', '50% of profits, cap $2,000; $500 minimum', '80%'],
    ]),
    '<p>Two ideas repeat. First, a <strong>qualifying day</strong> is a day that closed with at least a set profit. Losing days don\'t reset the count at most firms, '
    'but they do lower your balance, and some plans also need a minimum total. MFFU gives the example of five $150 winning days plus one \u2212$1,000 day: '
    'the day count is met, but total profit is \u2212$250, so there is no payout. Second, the count usually <strong>restarts after each payout</strong>. Tradeify says the day count '
    '"resets to zero after each successful payout".</p>',

    '<h2>The buffer: what a payout does to your floor</h2>',
    '<p>A <strong>buffer</strong> is the distance between your balance and the loss floor. It is the only thing that keeps a funded account open on a bad day.</p>',
    '<p>Several firms raise the floor at the first payout:</p>',
    '<ul>'
    '<li><strong>Topstep:</strong> "After your first Payout: Your MLL is set to $0 regardless of where it was before. The remaining balance becomes your effective loss floor."</li>'
    '<li><strong>MFFU Flex:</strong> after the first payout the maximum loss limit "moves to $100" and "becomes fixed permanently".</li>'
    '<li><strong>Apex:</strong> the safety net, "your account\'s drawdown limit plus $100", stays for the life of the account, and "only profit above the safety net is eligible" to be paid.</li>'
    '</ul>',
    '<p>So the same profit gives different results. Here is one hypothetical $3,000 profit, taking the largest first payout each plan allows:</p>',
    table(['Plan', 'First payout', 'You receive', 'Balance after', 'Floor after', 'Room left'], [
        ['Topstep XFA', m(T['req']), m(T['net']), m(T['bal']), m(T['floor']), m(T['room'])],
        ['MFFU Flex', m(M['req']), m(M['net']), m(M['bal']), m(M['floor']), m(M['room'])],
        ['Apex EOD PA', m(A['req']), m(A['net']), m(A['bal']) + ' profit', m(A['floor']) + ' profit', m(A['room'])],
    ]),
    fig_room,
    '<p>On Apex, the safety net is $2,100 above the start, so of the $3,000 profit only $900 is payable, and taking all of it leaves the balance exactly at the net. '
    'That shows the trade-off clearly: every dollar you take out is a dollar that can\'t absorb the next loss.</p>',

    '<h2>A worked path through one payout</h2>',
    '<p>Hypothetical. A trader on a $50K XFA makes steady profits for ten days, takes a first payout, then keeps trading:</p>',
    fig_path,
    '<p>On day ' + str(lock_day) + ' the balance first closed at $2,000 or more, so the floor locked at $0 ("Once your balance reaches $2,000, the MLL locks at $0 permanently"). '
    'By day 10 the balance is ' + m(bal[9] + first_req) + ' with ' + str(wins_c1) + ' days of $150 or more, so the Standard path is met. The trader asks for 50%: '
    + m(first_req) + ', of which 90% (' + m(0.9 * first_req) + ') is theirs. The floor stays at $0, but the balance above it halves: the ' + m(bal[9]) + ' left is now the whole buffer. '
    'The smallest buffer after that was ' + m(min_room_after) + ', on the \u2212$400 day. Without the payout it would have been ' + m(min_room_after + first_req) + '. '
    'At ' + m(min_room_after) + ', three more days like that would close the account.</p>',
    '<p>That is why many funded traders <strong>cut size after a payout</strong> until the buffer is rebuilt. PF-06\'s idea of sizing from the room you have applies even more here.</p>',

    '<h2>Choosing how much to take</h2>',
    '<p>There is no single right answer, but you can make it a rule instead of a mood. Three common approaches:</p>',
    cards(['Approach', 'How it works', 'Trade-off'], [
        ['Take the maximum', 'Request the most allowed each time.', 'Money out sooner; thinnest buffer; most likely to lose the account on a bad week.'],
        ['Fixed buffer first', 'Only request profit above a buffer you choose, e.g. one full loss limit.', 'Slower first payout; much more room afterwards.'],
        ['Split the difference', 'Take half of what is allowed, keep the rest.', 'Balances cash now against room later.'],
    ]),
    '<p>Whichever you choose, write it down with a number. Also remember the timing rules: Tradeify says funds are paid "within 24\u201348 hours" after approval, and that a request '
    '"cannot be edited or canceled". If you fall below the threshold before approval, "your payout will be denied".</p>',

    '<h2>A payout-day checklist</h2>',
    '<p>Before you press the request button, run through this list. It takes two minutes and catches most of the avoidable denials:</p>',
    '<ol>'
    '<li><strong>Count your qualifying days</strong> on the firm\'s dashboard, not in your head. Check the minimum profit per day for your account size.</li>'
    '<li><strong>Check the balance or net-profit condition</strong> against the published number, after fees and commissions.</li>'
    '<li><strong>Check any consistency rule.</strong> Divide your best day by total profit since the last payout. If it is too high, keep trading normal days until it drops.</li>'
    '<li><strong>Decide the amount</strong> using your written payout rule, and work out the floor and buffer afterwards.</li>'
    '<li><strong>Stop or cut size until it is approved.</strong> A loss that drops you below the threshold before approval can cost you the payout.</li>'
    '<li><strong>Record it:</strong> date, amount requested, amount received, and the balance and floor afterwards.</li>'
    '</ol>',
    '<p>Keep the list next to your risk plan from PF-06. Over several payout cycles, your records will show whether your payout rule is leaving enough room.</p>',

    '<h2>Payout caps and the road to live</h2>',
    '<p>Many funded accounts don\'t last forever by design. Apex allows a "maximum of six payouts" per Performance Account, rising from $1,500 to $3,000 on a 50K, and then '
    '"the PA is closed". The six 50K caps add up to ' + m(sum(APEX_CAPS)) + ' before split. MFFU Flex lists a maximum of 5 sim payouts, and a move to a live account after '
    '"five consecutive approved payouts", a $100,000 sim payout cap, or a risk-team review.</p>',
    '<p>Live accounts are different again. MFFU\'s live Flex account starts with "an initial balance of $2,000". Topstep says the move to its Live Funded Account '
    '"isn\'t automatic", is reviewed "case by case", and starts at 20% of your cumulative XFA balance, with the rest held in reserve (PF-01 worked through an example). '
    'Topstep can also move a live trader back to a simulated account, which it calls a "Shoulder Tap", and says "there is no warning". So plan for the funded stage '
    'as a series of accounts, not one account that grows forever.</p>',

    '<h2>Taxes and paperwork</h2>',
    '<p>Payouts are income paid to you by a company, usually as a contractor. How they are taxed depends on where you live, so we won\'t give tax advice. '
    'Keep a record of every payout, every fee and every reset, with dates, and ask a qualified tax professional in your country how to report them.</p>',

    '<h2>Common mistakes</h2>',
    cards(['Mistake', 'Better approach'], [
        ['Reading payout rules only after passing', 'Read them before you buy the evaluation, as part of PF-03\'s vetting.'],
        ['Keeping evaluation size after the floor moves up', 'Size from the buffer you actually have; cut size after a payout.'],
        ['Counting losing days as progress', 'Only qualifying days count, and some plans also need a minimum net profit.'],
        ['Trading big right after requesting', 'Falling below the threshold before approval can void the payout.'],
        ['Assuming an account lasts forever', 'Check payout caps and the account\'s end conditions.'],
    ]),

    '<h3>Practice exercises</h3>',
    '<ol>'
    '<li>For your plan, list the qualifying-day rule, minimum balance or profit, consistency rule, minimum and maximum payout, split and payout cap.</li>'
    '<li>Take a $3,000 profit and work out your first payout, what you receive, the floor afterwards and the room left.</li>'
    '<li>Write your payout rule: how much you take, and the minimum buffer you always leave.</li>'
    '<li>Write your size rule for the first week after a payout.</li>'
    '</ol>',

    quiz([
        ('What happens to Topstep\'s Maximum Loss Limit after the first XFA payout?', '<p>It is set to $0, so the balance left becomes your loss floor buffer.</p>'),
        ('On Apex\'s 50K EOD PA, which profit can be paid out?', '<p>Only profit above the $52,100 safety net, with a $500 minimum request.</p>'),
        ('Five $150 winning days and one \u2212$1,000 day on MFFU Flex: eligible?', '<p>No. Net profit is \u2212$250, below the $500 required.</p>'),
        ('Why cut size after a payout?', '<p>The buffer is smaller, so the same loss is a bigger share of the room you have.</p>'),
        ('Is the move to a live account automatic at Topstep?', '<p>No. It is reviewed case by case.</p>'),
    ]),
]

lessons = [
    ('What changes when you are funded', '<p>See how funded accounts start, and the new eligibility, size and after-payout rules.</p>'),
    ('Payout eligibility', '<p>Compare qualifying days, balances, consistency and splits on four $50K funded plans.</p>'),
    ('Buffers and the floor', '<p>Work out what a first payout does to your loss floor and the room you have left.</p>'),
    ('Caps, live accounts and your payout rule', '<p>Plan for payout caps and live call-ups, and write your own payout and size rules.</p>'),
]

src = [
    ('Express Funded Account Parameters - Topstep Help Center', 'https://help.topstep.com/en/articles/8284215-express-funded-account-parameters'),
    ('What is the Maximum Loss Limit? - Topstep Help Center', 'https://help.topstep.com/en/articles/8284204-what-is-the-maximum-loss-limit'),
    ('Topstep Payout Policy - Topstep Help Center', 'https://help.topstep.com/en/articles/8284233-topstep-payout-policy'),
    ('Live Funded Account Call Up and Call Down Process - Topstep Help Center', 'https://help.topstep.com/en/articles/13747178-live-funded-account-call-up-and-call-down-process'),
    ('Live Funded Account Parameters - Topstep Help Center', 'https://help.topstep.com/en/articles/10657969-live-funded-account-parameters'),
    ('EOD Payouts - Apex Trader Funding Help Center', 'https://apextraderfunding.com/help-center/eod-trailing-drawdown-accounts/eod-payouts/'),
    ('EOD Performance Accounts (PA) - Apex Trader Funding Help Center', 'https://apextraderfunding.com/help-center/eod-trailing-drawdown-accounts/eod-performance-accounts-pa/'),
    ('Growth Funded Account Payout Policy - Tradeify Help Center', 'https://help.tradeify.co/en/articles/11083796-growth-funded-account-payout-policy'),
    ('Flex Plan $50,000: A Comprehensive Guide - My Funded Futures Help Center', 'https://help.myfundedfutures.com/en/articles/15072271-flex-plan-50-000-a-comprehensive-guide'),
]

write_chapter('pf', 'PF-07', 'The Funded Stage: Buffers, Payouts & Withdrawals', 'intermediate', '30 min', lessons, body, src)
