#!/usr/bin/env python3
"""PF-02 Futures vs Forex/CFD Firms & the Regulatory Landscape."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
from svglib import *

AS_OF = 'September 2026'

# ---------------------------------------------------------------- where your money sits: fee vs brokerage deposit
def money_paths():
    o = []
    # top lane: prop firm fee
    o.append(text(10, 20, 'Prop firm evaluation', 13, GOLD, 'start', 'bold'))
    for k, (lbl, x) in enumerate([('you', 10), ('fee paid', 130), ('firm revenue', 262)]):
        o.append(rect(x, 32, 118 if k else 90, 40, stroke=GOLD, fill=GOLD, opacity=0.1, rx=6))
        o.append(text(x + (59 if k else 45), 57, lbl, 13, INK, 'middle'))
    o.append(line(100, 52, 130, 52, GOLD, 1.5)); o.append(line(248, 52, 262, 52, GOLD, 1.5))
    o.append(text(W / 2, 94, 'a purchase: it is not your deposit', 13, MUTED, 'middle'))
    # bottom lane: own brokerage account
    o.append(text(10, 128, 'Your own futures account', 13, GREEN, 'start', 'bold'))
    for k, (lbl, x) in enumerate([('you', 10), ('FCM', 130), ('segregated', 262)]):
        o.append(rect(x, 140, 118 if k else 90, 40, stroke=GREEN, fill=GREEN, opacity=0.1, rx=6))
        o.append(text(x + (59 if k else 45), 165, lbl, 13, INK, 'middle'))
    o.append(line(100, 160, 130, 160, GREEN, 1.5)); o.append(line(248, 160, 262, 160, GREEN, 1.5))
    o.append(text(W / 2, 202, 'your money, held apart under CFTC rule 1.20', 13, MUTED, 'middle'))
    return svg(214, o, 'Evaluation fee versus a deposit at a futures broker')

fig_money = figure(money_paths(),
    'Top: an evaluation fee is a purchase and becomes the firm\'s revenue. Bottom: money you deposit with a futures commission merchant (FCM) '
    'must be held as segregated customer funds under CFTC Regulation 1.20. The protections in the bottom lane do not apply to the top one.',
    illustrative=False)

# ---------------------------------------------------------------- contract point values (CME specs / Micro FAQ)
spec = [('ES', 'E-mini S&P 500', 50.0, 0.25), ('MES', 'Micro E-mini S&P 500', 5.0, 0.25),
        ('NQ', 'E-mini Nasdaq-100', 20.0, 0.25), ('MNQ', 'Micro E-mini Nasdaq-100', 2.0, 0.25)]
rows = []
for sym, name, mult, tick in spec:
    rows.append([sym, name, '$%s' % fmt(mult, 2), fmt(tick, 2), '$%s' % fmt(mult * tick, 2), '$%s' % fmt(mult * 10, 0)])
assert rows[0][4] == '$12.50' and rows[1][4] == '$1.25' and rows[2][4] == '$5.00' and rows[3][4] == '$0.50'

# ---------------------------------------------------------------- how 10 points eats a $2,000 loss limit (illustrative)
LIMIT = 2000
def pts_to_limit(mult, n):
    return LIMIT / float(mult * n)
eat = [('1 ES', pts_to_limit(50, 1)), ('4 MES', pts_to_limit(5, 4)), ('1 NQ', pts_to_limit(20, 1)), ('4 MNQ', pts_to_limit(2, 4))]
assert eat[0][1] == 40 and eat[1][1] == 100 and eat[2][1] == 100 and eat[3][1] == 250

def pts_bars():
    o = []; left, right, top = 70, 360, 16
    mx = max(v for _, v in eat); sc = (right - left) / mx
    for k, (lbl, v) in enumerate(eat):
        y = top + k * 40
        o.append(text(left - 8, y + 20, lbl, 13, INK, 'end'))
        o.append(rect(left, y + 4, v * sc, 24, fill=GREEN if v >= 100 else GOLD, opacity=0.75, rx=3))
        o.append(text(min(left + v * sc + 6, right - 60), y + 21, '%s pts' % fmt(v, 0), 13, INK))
    o.append(text(W / 2, top + 4 * 40 + 14, 'index points of adverse move to lose $2,000', 13, MUTED, 'middle'))
    return svg(top + 4 * 40 + 24, o, 'Points of adverse move to lose $2,000 by position')

fig_pts = figure(pts_bars(),
    'Illustrative: how far the index must move against each position to lose $2,000, a common $50K loss limit. Computed from CME point values '
    '(ES $50, MES $5, NQ $20, MNQ $2 per point). Real losses also include commissions and slippage.')

body = [
    '<p>"Prop firm" covers two different businesses. One offers <strong>futures</strong> evaluations, where you trade exchange-listed contracts such as the '
    'E-mini S&amp;P 500 in a simulated account. The other offers <strong>forex and CFD</strong> evaluations, where you trade currency pairs, indices and gold '
    'through a broker-style platform, also simulated. The rules look similar, but the instruments, the data and the regulatory picture are not.</p>',
    '<p>This chapter explains the difference, what regulation does and doesn\'t cover when you buy an evaluation, and how to check a firm\'s registrations yourself. '
    'It is general education, not legal advice, and rules differ by country. Firm details are quoted <strong>as of %s</strong>.</p>' % AS_OF,

    callout('Key takeaways', '<ul>'
            '<li>Futures firms simulate exchange-traded contracts with published specs. Forex/CFD firms simulate over-the-counter prices from a data provider or broker feed.</li>'
            '<li>Most evaluation and funded accounts at both kinds of firm are <strong>simulated</strong>. The firms say so in their own terms.</li>'
            '<li>An evaluation fee is a purchase, not a deposit. The customer-fund protections for futures brokers (FCMs) apply to money in your own brokerage account, not to fees paid to a prop firm.</li>'
            '<li>You can check U.S. futures registrations for free on NFA BASIC, and UK firms on the FCA register.</li>'
            '</ul>'),

    '<h2>Futures firms and forex/CFD firms</h2>',
    cards(['', 'Futures prop firms', 'Forex / CFD prop firms'], [
        ['What you trade', 'Exchange-listed futures, e.g. ES, NQ, CL, GC and their micros', 'Currency pairs, index and commodity CFDs'],
        ['Price and volume data', 'Exchange data (CME Group for the contracts above), with real volume', 'Broker or liquidity-provider feed; volume is usually tick volume'],
        ['Contract terms', 'Fixed by the exchange: multiplier, tick size, hours', 'Set by the platform: lot size, spreads, swaps, hours'],
        ['Typical rule style', 'Dollar loss limits, contract limits, often end-of-day trailing', 'Percentage daily and total loss limits'],
        ['Examples named in this track', 'Topstep, Apex, Tradeify, MFFU, Lucid', 'FTMO, Blue Guardian (and, historically, My Forex Funds)'],
    ]),
    '<p>Stryker\'s core curriculum covers forex, gold and indices. On a futures firm you trade the <strong>futures</strong> versions: E-mini and Micro E-mini '
    'index contracts, gold (GC/MGC), crude (CL/MCL) and currency futures like Euro FX (6E). If you learned a setup on spot EUR/USD, the concept carries over to 6E, '
    'but the prices, hours and tick values are different. VP-10 in the Volume Profile track covers these differences in detail.</p>',

    '<h2>Is it real money? Reading the word "simulated"</h2>',
    '<p>The most important fact about most prop firm accounts is in the firms\' own terms, not their adverts. Some examples, as of %s:</p>' % AS_OF,
    '<ul>'
    '<li>Topstep describes its Trading Combine as "a simulated account", and its Express Funded Account as "the simulated funded-level account you earn after passing".</li>'
    '<li>My Funded Futures calls its funded stage "Sim Funded" and says those accounts "start at $0".</li>'
    '<li>FTMO\'s FAQ says an FTMO Account "is an account with fully fictitious funds", and its terms say all accounts are "demo accounts with fictitious funds".</li>'
    '</ul>',
    '<p>So what is real? The <strong>fees you pay</strong> and the <strong>payouts you receive</strong>. Payouts from a simulated account are the firm paying you '
    'under its program rules, not the market paying you for a trade. Some firms move selected traders to live accounts (PF-01 covered Topstep\'s call-up rule). '
    'This matters in two ways. First, your fills are simulated, so a fill you get in simulation might not have happened in the real market. Firms write rules against exploiting that. '
    'Second, your right to a payout depends on the program terms, so reading them is not optional.</p>',

    '<h2>The U.S. regulators: CFTC and NFA</h2>',
    '<p>In the United States, futures and retail forex are overseen by the <strong>Commodity Futures Trading Commission (CFTC)</strong>, a federal agency. '
    'The CFTC\'s "Check Registration" page explains that the <strong>National Futures Association (NFA)</strong>, the industry\'s self-regulatory body, conducts '
    'registration and examination of intermediaries on the CFTC\'s behalf. The same page lists what registration indicates: background checks on principals, financial '
    'requirements, examinations and supervision, proficiency tests, and disclosure and conduct standards.</p>',
    '<p>It also warns that "registration and a clean disciplinary record won\'t protect you from fraud", while noting that most scams involve unregistered entities. '
    'Registration is a starting point, not a seal of approval.</p>',
    '<h3>Where your money sits</h3>',
    fig_money,
    '<p>When you open your own futures brokerage account, your deposit goes to a <strong>futures commission merchant (FCM)</strong>. CFTC Regulation 1.20 requires an FCM to '
    '"separately account for all futures customer funds and segregate such funds as belonging to its futures customers". CME Group\'s customer protection overview explains '
    'that segregation is applied at the FCM, clearing house and depository levels, so customer funds can\'t be used to cover the broker\'s own losses.</p>',
    '<p>An evaluation fee is different. It is a payment for a product. It isn\'t a deposit held for you, and the segregation rules for customer funds don\'t cover it. '
    'That is one reason why the <em>firm\'s</em> reputation and terms matter more than anything else when you buy an evaluation.</p>',
    '<h3>Where live trading happens</h3>',
    '<p>When a futures prop firm does trade live, orders still have to clear through a registered FCM. Topstep, for example, runs a separate brokerage product whose site '
    'says execution is through its FCM partner, Plus500US, "a Futures Commission Merchant registered with the Commodity Futures Trading Commission and a member of the '
    'National Futures Association". You can confirm any such claim yourself on NFA BASIC, which is the next section.</p>',

    '<h2>How to check a registration yourself</h2>',
    '<ol>'
    '<li>Open <strong>NFA BASIC</strong> (Background Affiliation Status Information Center), linked from the CFTC\'s check page.</li>'
    '<li>Search the firm\'s legal name, not its brand. Check the terms page for the legal entity.</li>'
    '<li>Read three things: current registration types, NFA membership status, and any regulatory or disciplinary actions.</li>'
    '<li>If the firm names a partner broker or FCM, search that too, and check the NFA ID it quotes matches.</li>'
    '<li>Save a screenshot with the date. Registrations change.</li>'
    '</ol>',
    '<p>An evaluation company itself may not appear, because selling a simulated test is not the same activity as handling customer funds. That isn\'t automatically a red flag. '
    'What should worry you is a firm that <em>claims</em> a registration you can\'t find, or that takes customer deposits for live trading without one.</p>',
    '<h3>Outside the United States</h3>',
    '<p>Other countries run their own registers. In the UK, the <strong>Financial Conduct Authority (FCA)</strong> publishes a Firm Checker and a warning list of firms it says '
    'are "not authorised" and "may be targeting people in the UK". Its warning pages explain that customers of unauthorised firms have no access to the Financial Ombudsman '
    'Service or the Financial Services Compensation Scheme. Search your own regulator\'s register the same way you would search NFA BASIC.</p>',

    '<h2>A case to learn from: My Forex Funds</h2>',
    '<p>PF-01 described the CFTC\'s 2023 case against Traders Global Group, which traded as My Forex Funds, a forex and CFD firm. The regulatory theory behind that case is worth knowing. '
    'The complaint argued that the firm was acting as the <strong>counterparty</strong> to its customers\' retail forex trades, and that doing so required registration as a retail '
    'foreign exchange dealer. The firm disputed this, and in May 2025 the court dismissed the case and sanctioned the CFTC, as Reuters reported. The allegations were never proven.</p>',
    '<p>The case shows that the line between a "simulated evaluation" and a regulated activity can be argued over in court, especially for forex and CFD firms. For you as a trader, '
    'the practical point is simpler: know what the firm says it is, check what you can, and don\'t put in more money than you are ready to lose on fees.</p>',

    '<h2>Why contract size matters more on futures firms</h2>',
    '<p>Futures rules are set in dollars, and each contract has a fixed dollar value per point. That makes position size the biggest risk decision you make. '
    'From CME Group\'s published specs:</p>',
    table(['Symbol', 'Contract', '$ per point', 'Tick', '$ per tick', '$ per 10 pts'], rows),
    fig_pts,
    '<p>With a $2,000 loss limit, one ES contract can lose it all on a 40-point move against you. Four Micro E-mini contracts (MES) need 100 points. The micro contracts are one-tenth '
    'the size of the E-minis, which is why many firms count 10 micros as one mini in their contract limits. PF-06 turns this into a sizing plan.</p>',

    '<h2>Worked example: comparing two offers</h2>',
    '<p>Illustrative. You are choosing between a futures evaluation and a forex/CFD evaluation for a gold strategy you learned in the core course.</p>',
    '<ol>'
    '<li><strong>Instrument.</strong> The futures firm offers GC and MGC (Micro Gold). The forex firm offers XAU/USD as a CFD. Your levels come from spot gold charts, so you check how much the futures price differs and build your levels on the futures chart.</li>'
    '<li><strong>Data.</strong> The futures firm uses exchange data, so you can use volume profile (the VP track). The CFD firm shows tick volume.</li>'
    '<li><strong>Rules.</strong> The futures account has a dollar loss limit and a contract cap. The CFD account uses percentage limits. You write both in the same units (dollars) before comparing.</li>'
    '<li><strong>Checks.</strong> You find the legal entities in each terms page, search them on the relevant registers, and note whether each account is simulated.</li>'
    '</ol>',
    '<p>You have now compared the offers on instrument, data, rules and checks, not on the headline account size or the discount code.</p>',

    '<h2>Common mistakes</h2>',
    cards(['Mistake', 'Better approach'], [
        ['Assuming "funded" means live capital', 'Read the terms. Look for the words simulated, demo or fictitious.'],
        ['Thinking an evaluation fee is protected like a deposit', 'It is a purchase. Customer-fund segregation covers brokerage deposits, not fees.'],
        ['Searching the brand name on a register', 'Search the legal entity from the terms page.'],
        ['Treating registration as proof of honesty', 'The CFTC itself says it won\'t protect you from fraud. It is one check of several.'],
        ['Trading spot levels on futures without adjusting', 'Futures and spot prices differ. Build levels on the instrument you trade.'],
    ]),

    '<h3>Practice exercises</h3>',
    '<ol>'
    '<li>Pick one futures firm and one forex/CFD firm. Quote the sentence in each firm\'s terms or FAQ that says whether accounts are simulated.</li>'
    '<li>Find the legal entity name for each firm. Search both on NFA BASIC (and the FCA register if relevant). Record what you find and the date.</li>'
    '<li>For your main instrument, find its point value on the exchange\'s spec page and work out how many points would hit a $2,000 loss limit at your usual size.</li>'
    '<li>Write down, in one sentence each, what is real money and what is simulated in the program you are considering.</li>'
    '</ol>',

    quiz([
        ('What does the NFA do for the CFTC?', '<p>It conducts registration and examination of futures intermediaries on the CFTC\'s behalf.</p>'),
        ('Does CFTC Regulation 1.20 protect an evaluation fee?', '<p>No. It requires FCMs to segregate futures customer funds. An evaluation fee is a purchase from a prop firm, not a deposit at an FCM.</p>'),
        ('How many points against one ES contract lose $2,000?', '<p>40 points, because ES is $50 per point.</p>'),
        ('What does FTMO say its accounts are?', '<p>Demo accounts with fully fictitious funds, used for simulated trading.</p>'),
        ('Why search the legal entity, not the brand, on NFA BASIC?', '<p>Registrations are held by legal entities, which often have a different name from the brand.</p>'),
    ]),
]

lessons = [
    ('Futures vs forex/CFD firms', '<p>Compare the two kinds of prop firm: instruments, data, contract terms and rule styles.</p>'),
    ('What "simulated" means', '<p>Read the firms\' own wording on simulated and demo accounts, and what is real money in the program.</p>'),
    ('Regulators and your money', '<p>Learn the roles of the CFTC and NFA, how customer funds are segregated, and why fees are different.</p>'),
    ('Checking a firm and sizing risk', '<p>Check registrations yourself and see how contract size turns a loss limit into points.</p>'),
]

src = [
    ('Be Smart: Check Registration & Backgrounds Before You Trade - CFTC', 'https://www.cftc.gov/check'),
    ('17 CFR 1.20 Futures customer funds to be segregated - eCFR', 'https://ecfr.gov/current/title-17/chapter-I/part-1/section-1.20'),
    ('Customer Protection & Segregation - CME Group', 'https://cmegroup.com/articles/brochures-and-handbooks/101-overview-customer-protection-and-segregation.html'),
    ('Micro E-mini Equity Index Futures FAQ - CME Group', 'https://www.cmegroup.com/articles/faqs/micro-e-mini-equity-index-futures-frequently-asked-questions.html'),
    ('Trading Combine Parameters - Topstep Help Center', 'https://help.topstep.com/en/articles/8284197-trading-combine-parameters'),
    ('Express Funded Account Parameters - Topstep Help Center', 'https://help.topstep.com/en/articles/8284215-express-funded-account-parameters'),
    ('Topstep Brokerage (FCM partner disclosure)', 'https://www.topstepbrokerage.com/'),
    ('Flex Plan $50,000: A Comprehensive Guide - My Funded Futures Help Center', 'https://help.myfundedfutures.com/en/articles/15072271-flex-plan-50-000-a-comprehensive-guide'),
    ('How does an FTMO Account work from the technical side? - FTMO FAQ', 'https://ftmo.com/en/faq/how-does-an-ftmo-account-work-from-the-technical-side'),
    ('FTMO Terms and Policies', 'https://ftmo.com/en/terms-and-policies'),
    ('FCA Firm Checker - Financial Conduct Authority', 'https://www.fca.org.uk/consumers/fca-firm-checker'),
    ('CFTC v. Traders Global Group Inc. (My Forex Funds), complaint, D.N.J., Aug 2023 - CFTC', 'https://www.cftc.gov/media/9196/enftradersglobalgroupcomplaint082923/download'),
    ('Judge sanctions CFTC over agency\'s conduct in My Forex Funds case - Reuters, May 2025', 'https://www.reuters.com/legal/government/judge-sanctions-cftc-over-agencys-conduct-my-forex-funds-case-2025-05-14'),
]

write_chapter('pf', 'PF-02', 'Futures vs Forex/CFD Firms & the Regulatory Landscape', 'foundation', '25 min', lessons, body, src)
