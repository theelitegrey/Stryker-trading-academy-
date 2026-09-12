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

## Adding a rule

1. Add the field to `defaultRules()`.
2. Compute it in `evaluate()` and return it in the state object.
3. If it can end an account, push it into `pressures` so it can be the binding
   constraint.
4. Add a field to `pfRulesForm()` and read it in `pfReadRulesForm()`.
5. Write the node test **first**. `pf-rules-test.js` is the contract.
