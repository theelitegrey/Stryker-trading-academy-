# The prop firm rule engine

`assets/propfirm-rules.js` is pure arithmetic over a list of closed trades. No
DOM, no Firestore. It is unit-tested in node because a bug here does not produce
a visual glitch — it tells someone they have room to trade when they do not.

`assets/journal-propfirm-risk.js` is the UI over it and contains no arithmetic.

---

## The rule that governs this feature

**Never ship a firm's limits.** Prop firms change their drawdown and daily-loss
percentages, and a hardcoded number that has since moved is a number a member
will trade on while blowing a real account.

So the preset picker sets the rule **shape** — which drawdown type, when the day
resets, whether the floor locks at breakeven — and never a percentage. The shape
is the part traders get wrong and the part that rarely changes. The percentages
come off the member's own dashboard in ten seconds.

Nothing is computed until `rules.confirmed` is true, which the member sets by
ticking *"I copied these from my firm dashboard, not from memory."* An
unconfirmed rule set shows the setup prompt, not a headroom. The test suite
asserts all of this.

---

## What the engine knows

### The three drawdown types

| Type | Floor |
| --- | --- |
| `static` | `start − maxDD`. Never moves. |
| `trailingClosed` | `highest closed balance − maxDD`. Rises with every new equity high and **never falls**. |
| `trailingIntraday` | Same, but the peak includes unrealised profit. An open trade that ran +$2,000 and came back to flat has permanently raised the floor by $2,000. |

`lockAtStart` makes any trailing type stop once the floor reaches the starting
balance: `floor = min(peak − maxDD, start)`.

The floor is computed by **walking the trades in order**, not by a formula.
`+5k then −5k` is a very different account from `−5k then +5k` under a trailing
rule, and no closed-form calculation can tell them apart.

### The honesty constraint

A journal records closed trades. It cannot see the intraday equity peak of an
open position. So for `trailingIntraday` the peak computed here is the peak of
the **closed** balance, which is a lower bound — the real floor may be higher.
`evaluate()` returns `optimistic: true` for that case and the panel says so in
plain words. Quietly under-reporting a floor is exactly how someone breaches.

### Session days

Futures firms reset at 17:00 New York. A trade at 18:00 Monday belongs to
**Tuesday's** session and counts against Tuesday's daily loss limit. Getting
this wrong moves a loss into the wrong bucket and can hide a breach entirely.
A bare `YYYY-MM-DD` with no time is treated as midday, not midnight, so a
dateless trade is not silently pushed into the previous session.

### Consistency

Best single winning day as a share of total profit. The useful output is not
the ratio but the action: `needMoreProfit = bestDay / cap − totalProfit` — how
much more profit, made on **other** days, before a payout request would pass.

On a losing account it returns `null` rather than `0%`, because a 0% ratio
reads as passing.

When the best day is larger than the entire profit to date — which happens
after a drawdown — the panel says so in words instead of printing "289% of
profit", which is arithmetically right and tells nobody anything.

### The binding constraint

Each active rule is scored as the fraction of **its own** allowance already
spent, and the highest is named. This is the feature: people watch the profit
target and get carried out by a trailing drawdown while still up on the account.

---

## The sizer

`sizeFor(state, riskPerUnit)` takes the money lost per contract or lot if the
planned stop is hit, and returns whole units, **always rounded down**. A sizer
that rounds up to a size that breaches is worse than no sizer.

It holds back 20% of the binding allowance by default for slippage, commission
and a gapped stop, names which rule limited the answer, and reports how many
losing trades in a row at that size would breach. When no size is safe it says
so — *"The trade this tool recommends is not taking one."*

---

## The challenge simulator

`assets/propfirm-sim.js` answers "can this account pass, and at what size" by
replaying the evaluation thousands of times against the member's own results.

**Bootstrap resampling, not a fitted distribution.** Drawing from their actual
R-multiples preserves the fat left tail, the outlier win that carries a month,
and the real win rate. Fitting a normal or lognormal would smooth exactly the
features that decide whether a drawdown rule gets hit, and would flatter almost
everyone.

**It requires R, and says so when it cannot have it.** R only exists when a
stop was recorded. The refusal names the real problem — *"66 of your 66 trades
have no stop recorded"* — rather than telling someone to trade more, which
would not fix it. Minimums are 30 graded trades and 8 trading days; below that
the output is a count of what is missing, never a probability.

**Refusals are never cached.** The profile is recomputed on every render, so
"you need 18 more trades" clears itself the moment they exist. A cached refusal
has no button to re-run — there is nothing to run — so caching one would strand
the member permanently. Studies *are* cached, and are discarded when the rules
change or the trade count moves, because a pass rate computed against limits
that no longer apply is worse than no pass rate.

**Common random numbers across the sweep.** Every risk level is replayed
against the same seeded stream, so a difference between two levels is the
sizing and not sampling noise. Without it the sweep jitters and the "best" size
moves between runs on identical input.

**The sweep must reach low enough to show under-sizing.** Risk too little and
the horizon runs out before the target is reached — a failure mode a member
reading only the breach rate never sees coming. The default range starts at
0.1% so the optimum is genuinely interior, and the summary says which side of
the best size failed for which reason.

**The independence caveat is the most important text on the block.** Resampling
assumes trades are independent; real losses cluster. Clustering makes drawdown
breaches *more* likely than independent draws suggest, so every figure is an
optimistic bound and the UI says so. A simulator that quietly overstates
someone's odds is worse than none, because they will size up on it.

**The two rule implementations are cross-checked.** `runOnce()` re-implements
the floor walk for speed. The test suite pushes fixed sequences through both it
and `propfirmRules.evaluate()` and requires the same verdict — including the
case that separates the rule types: a giveback that a trailing floor breaches
and a static floor survives.

## The news blackout guard

`assets/propfirm-news.js` turns the economic calendar's high-impact releases
into the restricted windows most firms enforce, and checks journal trades
against them.

### The timezone problem is the whole problem

A journal trade stores a date and an `HH:MM` time and **nothing about what zone
that time is in**. Members type whatever their platform showed — often broker
server time, frequently UTC+2 or +3. The calendar stores UTC. A blackout window
is four minutes wide.

Comparing an unknown-zone time against a UTC instant can be wrong by hours, and
both kinds of wrong answer here cause harm: a false accusation, or a clean bill
of health for a trade that did breach. The test suite proves the stakes —
*the same trade is clear in UTC and a breach in Berlin*.

So the audit refuses to run until the member picks their journal's zone **and
confirms it**, exactly like the rule limits. Upcoming windows need no journal
time at all and are always available, which is why the feature splits in two.

The zone picker canonicalises retired IANA names. Chromium reports
`Asia/Calcutta`, which would otherwise appear as a second entry beside
`Asia/Kolkata` — two options for one zone, one of them a name India stopped
using in 2001. `PF_TZ_ALIASES` maps them; it is presentation only and changes
no arithmetic.

`zonedToUtc()` looks the offset up **twice**. The first lookup happens at the
wrong instant and is an hour out across a DST boundary; re-reading at the
corrected instant fixes it. That is why it is not a one-liner.

### Three counts, always

The audit reports how many trades were checked, how many had no time recorded,
and how many fall outside the calendar's own range. A clean result that quietly
skipped most of the journal is not a clean result, and the two gaps have
different fixes — record entry times, versus wait for the calendar to cover
that period. `clean` is `false` when nothing was checked at all.

### What it does not do

It does not rule on compliance. Firms differ on whether the restriction covers
all high-impact news or only news affecting the instrument traded, on whether
it is symmetric, and on whether a position merely *held* through the window
counts. The defaults are the conservative reading and the panel says the
decision is the firm's.

## The payout and scaling planner

`assets/propfirm-payout.js` turns the fee-and-payout ledger from a record of
the past into a forward plan.

### The trap it exists for

**A withdrawal reduces the balance. On most trailing accounts the floor does
not come down with it.** Someone sitting $5,300 above their floor who withdraws
$3,800 is not left comfortable — they are left with $1,500, and the next losing
run ends the account. A few firms lower the floor by the withdrawn amount; most
do not.

So `payoutFloorBehaviour` is a **required choice with no default**, and the
planner's hero is the before-and-after headroom. The same account with $6,200
of profit can safely withdraw $3,800 under one behaviour and the whole $6,200
under the other. That difference is the single most expensive thing a funded
trader can be wrong about.

A withdrawal that lands the account at or below its floor is called what it is:
not a payout, but a failed account with a bank transfer attached.

### Every blocker, not just the first

`eligibility()` returns all unmet conditions — minimum profit, minimum trading
days, the payout cycle, and the consistency cap. Someone told only "you need
more profit" will hit the day requirement next and feel misled. The consistency
cap belongs here as much as in the rule engine: it is a *payout* condition, and
it is where people are blindsided having passed everything else.

With no payout history the cycle is measured from the account's start date, not
assumed satisfied — optimism in exactly the situation where a real answer
matters most.

### While ineligible, the calculator is a hypothetical

Labelling it "Withdraw" next to "not eligible yet" reads as contradiction, so
it becomes "If you withdrew". It stays useful for planning without reading as
permission.

### The ledger keeps banked money separate from paper profit

Fees paid, money actually received, net so far, and — listed apart — what is
still sitting in the account. Counting unbanked profit as a return is how
people convince themselves a losing run of challenges was working.

## Adding a rule

1. Add the field to `defaultRules()`.
2. Compute it in `evaluate()` and return it in the state object.
3. If it can end an account, push it into `pressures` so it can be the binding
   constraint.
4. Add a field to `pfRulesForm()` and read it in `pfReadRulesForm()`.
5. Write the node test **first**. `pf-rules-test.js` is the contract.
