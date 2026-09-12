# Tweet copy — Trade Journal

Ad copy for `trade-journal.html`. Every claim below is something the page
actually does today; if a feature changes, the line that sells it changes with
it.

Every tweet here has been checked against the 280 limit using X's *weighted*
count, not a raw character count: a link always counts as 23 however long it
is, and an emoji counts as 2. Six emoji bullets therefore cost 12 characters
before a single word — which is why the emoji ads carry a shorter headline
than the plain ones. Re-check with that rule if you edit a line; a naive
`len()` will tell you a 290-character tweet fits.

Ground rules used throughout:

- **No performance claims.** Nothing here promises a return, a win rate, or a
  funded account. The product is the record, not the result.
- **No invented numbers.** No student counts, no "10,000 traders", no firm
  percentages — the prop firm engine deliberately ships no firm's limits
  (`tools/propfirm-rules.md`), and the ads must not either.
- **The privacy line is literal.** The AI Coach and the P&L card both run on
  the member's device; the copy says so because it is true, not as a flourish.

---

## Lead ad — the "why" angle

> Your broker shows you a balance. It doesn't show you why.
>
> The Stryker trade journal does.
>
> → Expectancy, profit factor, drawdown
> → Your edge split by setup, session and day of week
> → Revenge trades, risk creep and fee drag, flagged
>
> strykertrading.com

Use as the default. Leads with the gap every trader already feels, then answers
it with specifics rather than adjectives.

---

## Variant — prop firm angle

> Most blown prop accounts aren't blown by a bad trade.
>
> They're blown by a rule nobody was counting.
>
> Stryker's journal knows your firm's drawdown type — static, trailing closed,
> trailing intraday — and tells you how much room is actually left.
>
> strykertrading.com

The sharpest one for a prop audience. "Trailing intraday" is the tell that the
tool was built by someone who has read the rules — an open trade that ran up
and came back to flat has permanently moved that floor, and most journals miss
it.

---

## Variant — privacy angle

> "AI trading coach" usually means your trades get uploaded somewhere.
>
> Ours doesn't.
>
> Stryker's journal runs the diagnostics a real coach runs — early exits,
> overtrading, risk creep, fee drag — on your device.
>
> Your trades never leave your account.
>
> strykertrading.com

Works as a quote-tweet of anyone shipping an upload-your-statements tool.

---

## Variant — short hook

> You don't have a strategy problem.
>
> You have a record-keeping problem.
>
> strykertrading.com

For reply-guy reach and for pairing with the shareable P&L card image.

---

## Variant — the cost of the chase

> Track what the challenges actually cost you.
>
> Stryker's journal keeps every prop firm fee you've paid next to every payout
> you've received, and shows you the net.
>
> Some people find out they're up. Some find out what the chase has really been
> costing.
>
> strykertrading.com

Uncomfortable, specific, and true to the Prop firms tab — spent, received, net,
firms tracked.

---

## Variant — image tweet (pair with a P&L card PNG)

> Every card in this journal is drawn on your own machine and saved as a PNG.
>
> Nothing is uploaded to post it.
>
> strykertrading.com

Attach a card exported from the Dashboard tab. Choose a modest month — a
four-figure card sells the tool, a screenshot of a blow-up month sells nothing.

---

## Emoji + bullets — the feature-list ads

These lead with the feature list rather than a hook. They scan faster in a
crowded timeline and carry the whole product in one post, at the cost of the
tension the hook ads open with. One emoji per line, always the same meaning
across every ad: 📊 metrics, 🎯 edge breakdown, 🧠 the coach, 🛡️ prop firm
rules, 💸 money in and out, 📥 getting data in.

### Everything it does

> 📓 Your trading, finally explained.
>
> 📊 Expectancy, profit factor, drawdown
> 🎯 Edge by setup, session & day of week
> 🧠 Revenge trades & risk creep, flagged
> 🛡️ Prop firm headroom before you breach
> 💸 Fees vs payouts, netted
> 📥 CSV import + broker sync
>
> strykertrading.com

The default of this group. Six lines is the ceiling — a seventh reads as a
spec sheet and the reader stops at three.

### Prop firm

> 🚨 The rule that ends your prop account is the one you stopped counting.
>
> The Stryker Trade Journal tracks it:
>
> 📉 Static, trailing closed or intraday drawdown
> ⏰ Daily loss limit, on your firm's reset
> 🛡️ Headroom left before the next trade breaches
>
> strykertrading.com

### Privacy

> 🔒 Every other "AI trading coach" wants your statements uploaded.
>
> Ours never sees them.
>
> 🧠 Early exits & overtrading, spotted
> 📉 Expectancy and drawdown, computed
> 🖼️ P&L cards, drawn on your machine
>
> All of it on your device.
>
> strykertrading.com

### Thread opener, if you want the emoji version pinned

> 📓 We rebuilt the trade journal.
>
> Here's everything it now does 🧵

Follows into tweets 2–6 of the thread below unchanged.

---

## Names only — no explanation

Bullets that name the feature and stop. No verbs, no benefit clause. These
read as a contents page: the reader sees the scope in two seconds and the
click does the explaining. They run short — none is over 200 weighted
characters — so there is room to attach an image without the copy fighting it.

### What's in it

> 📓 The Stryker Trade Journal
>
> 📊 Dashboard
> ➕ Add trade
> 🗓️ Calendar
> 📈 Analytics
> 📕 Playbook
> 🧠 AI Coach
> 🛡️ Prop firms
> 📥 Import & export
> 🔗 Broker sync
> 🖼️ P&L cards
>
> strykertrading.com

Ten lines is the practical ceiling for a bare list — past that it stops
scanning as a list and starts scanning as a wall.

### What it measures

> 📓 The Stryker Trade Journal
>
> 📊 Expectancy
> 📈 Profit factor
> 🎯 Win rate
> 📉 Max drawdown
> ⚖️ Consistency
> 💰 Avg win / avg loss
> 📏 R multiple
> 📅 Best & worst day
>
> strykertrading.com

For the audience that already journals and is comparing tools. Naming the
metrics is the whole pitch to them.

### Short list

> 📓 The Stryker Trade Journal
>
> 📊 Analytics
> 🗓️ Calendar
> 📕 Playbook
> 🧠 AI Coach
> 🛡️ Prop firms
> 🔗 Broker sync
> 🖼️ P&L cards
>
> strykertrading.com

Same idea with the obvious entries cut. Best of the three as an image tweet.

---

## Thread — for a pinned or launch post

**1/**
> Your journal should be able to answer one question: which part of what you do
> actually makes money?
>
> Most can't. Here's what we built instead. 🧵

**2/**
> Log the trade in seconds — the P&L, the risk in dollars and percent, and the
> R multiple calculate as you type. Attach the screenshot while the reason is
> still fresh.

**3/**
> Then the journal splits your results by instrument, setup, session, long vs
> short, day of week and account.
>
> That's usually where people find the one setup quietly paying for all the
> others.

**4/**
> The AI Coach isn't a chatbot. It's the battery of checks a real coach runs —
> expectancy, drawdown, early exits, revenge trading, overtrading, risk creep,
> fee drag.
>
> All of it on your device. Nothing uploaded.

**5/**
> And if you're on a prop account, it tracks the rule that actually ends it:
> the drawdown floor, the daily loss limit, and how much headroom is left
> before the next trade breaches.
>
> You copy the numbers off your own firm's dashboard. We never guess them.

**6/**
> Bring your history in from a CSV with your own column mapping, or sync a
> broker directly.
>
> strykertrading.com

---

## Notes for whoever posts these

- Best windows are the hour after the New York close and Sunday evening, when
  people are reviewing rather than trading.
- The prop firm variant and the privacy variant are the two worth putting
  money behind; the rest are organic.
- Don't run the lead ad and the thread on the same day — tweet 1 of the thread
  is the lead ad's job done twice.
