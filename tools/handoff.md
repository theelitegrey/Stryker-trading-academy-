# Handoff: running an agent session on this repository

Read this first. It is the orientation document — what the project is, how a
change reaches production, what will bite you, and what is true right now. The
detailed runbooks live beside it in `tools/` and are linked from here; this file
does not repeat them, it tells you which one you need and corrects the parts
that have gone stale.

Written 22 September 2026, at build 305, deploy run 140.

---

## 1. What the project is

**Stryker Trading Academy** — `strykertrading.com` — a paid ICT/SMT trading
education site. Members pay for models and strategies, TradingView indicators,
a chaptered curriculum, a trading journal, backtesting, a global market
monitor, live sessions and a set of market-data "terminal" modules.

It is a **static site**: plain HTML, hand-written ES5/ES6 in `assets/*.js`, one
stylesheet. There is no build step, no bundler, no framework and no package
manager for the site itself. What is in the repo root is what is served.

Dynamic behaviour comes from two places:

- **Firebase** (Auth + Firestore) in the browser, for accounts, entitlements,
  journal data, community posts and admin editing.
- **Cloud Functions**, whose sources live in `functions-src/` and are deployed
  separately (see `functions-src/DEPLOY.md`). They are *not* part of the site
  deploy and are excluded from it.

Payments are Razorpay. The public marketing pages and the signed-in member area
are the same site, gated client-side and by Firestore rules.

---

## 2. Repository layout

```
*.html               every page, at the root. 80 of them.
assets/              all JS, CSS, images, and the three terminal data files
assets/version.json  {"build": N} — the cache-busting build number
functions-src/       Cloud Function sources (deployed separately)
tools/               runbooks and the validator. NOT deployed.
automation/          a separate self-hosted social/video automation stack
.github/workflows/   deploy-site.yml and monitor-data.yml
.claude/             skills, settings, session-start hook
graphify-out/        generated knowledge graph. NOT deployed.
```

`deploy-site.yml` rsyncs the root to a staging dir and **excludes** `.git`,
`.github`, `tools`, `.claude`, `graphify-out`, `functions-src` and
`node_modules`. Anything you put in those directories will never be published.

Branches on `origin`: `main` (production), `data` (force-pushed every 20
minutes by the monitor relay — never touch it), two `backup/*` snapshots, and
the current agent working branch.

---

## 3. The one rule that breaks everything: the version bump

Every page references its assets as `foo.js?v=305` and carries
`<meta name="stryker-build" content="305">`. `assets/version.json` holds
`{"build": 305}`. **All three must agree.** `assets/version-check.js` fetches
`version.json` uncached, compares it to the page's meta tag, and reloads once
if the page is behind. If the numbers drift apart, either every visitor reloads
forever or nobody ever recovers from a stale page.

`tools/check.py` fails the build if they disagree. Run it before every commit.

Bump when **any `.js`, `.css` or `.html` file changes**:

```bash
OLD=305; NEW=306
sed -i "s/?v=$OLD/?v=$NEW/g; s/content=\"$OLD\"/content=\"$NEW\"/" *.html
sed -i "s/: $OLD/: $NEW/" assets/version.json
python3 tools/check.py
```

**Do not bump for content-only changes** to the three terminal JSON files.
Those are data, not code; the pages that read them are unchanged.

---

## 4. Git flow

Agent sessions work on a branch and fast-forward `main`. Never commit straight
to `main` — and in particular never leave `HEAD` on `main` between tasks.

```bash
BR=claude/<your-branch>
git checkout -b "$BR"              # or checkout the existing one
# ... edit, then:
python3 tools/check.py
git add -A && git commit -F <message-file>
git fetch -q origin main && git rebase -q origin/main
git push -u origin "$BR" --force-with-lease
git checkout main && git reset --hard origin/main
git merge --ff-only "$BR" && git push origin main
git checkout "$BR"                 # <-- do not skip this line
```

Two things that have actually gone wrong here, both worth guarding against:

- **A commit made while `HEAD` was on `main` was destroyed.** The branch push
  reported success (it pushed the branch, which did not contain the commit),
  and the following `git reset --hard origin/main` discarded it. Recovered via
  `git reflog` + `git cherry-pick`. The last line of the block above is the
  fix: always return to the branch.
- **`git commit -m` breaks on quotes and backticks.** Use `-F` with a message
  file, or a heredoc.

Commit messages are normal prose, in full sentences, explaining *why*. Look at
recent history for the register. They end with the two attribution lines the
session harness supplies (`Co-Authored-By:` and `Claude-Session:`); copy them
from the harness reminder, not from memory.

Never put a model name or identifier anywhere in a repository artifact of your
own — code comments, docs, PR text. Chat replies only.

A fresh container has no git identity; set it before the first commit:

```bash
git config user.email "theelitegrey@gmail.com"
git config user.name "Stryker"
```

---

## 5. Deploy, and how to actually verify one

Push to `main` → `.github/workflows/deploy-site.yml` fires → wrangler direct-
uploads to Cloudflare Pages → the workflow then **verifies the live domain**
serves the new build number before going green.

This is the important part: **a green run is the proof, not the push.** The
workflow's `Verify the live domain serves this build` step polls
`https://strykertrading.com/assets/version.json` up to six times and prints
`attempt N: live build X (want Y)`. It exists because a deploy once went green
while the domain kept serving old content (two Pages projects, the custom
domain on the other one).

To check a run, use the GitHub MCP tools. Run-level `status` lags; the **job's
step list is conclusive**:

```
actions_list  method=list_workflow_runs  workflow_id=deploy-site.yml
actions_list  method=list_workflow_jobs  resource_id=<run id>
```

Notes that matter:

- **Cloudflare Pages preview deployments must stay OFF.** `monitor-data.yml`
  force-pushes the `data` branch every 20 minutes; with previews on, each push
  burns one of the 500 free monthly builds and the quota dies in under a week.
- `_headers` gives assets a one-year cache (safe — every change bumps `?v=`)
  and forces HTML to revalidate.
- `tools/deploy-notes.md` still describes the old GitHub Pages build-poll and a
  direct `git push origin main`. **Both are superseded** by this section. Its
  explanation of *why* the build number exists is still correct and worth
  reading.

**Known cosmetic defect:** the verify step's final line prints
`homepage meta: unreadable`. It has done so on every run since at least 137.
The `curl` for `/index.html` most likely 404s because Cloudflare serves the
homepage at `/`. Consequence: the gate passes on `version.json` alone and does
not actually confirm the HTML carries the new meta tag. Not yet fixed — the fix
is to fetch `/` instead of `/index.html` and fail the step when the meta tag is
missing.

---

## 6. The daily terminal refresh

Three files under `assets/` are dated content and are regenerated every weekday
at 05:30 UTC by a scheduled Routine:

```
assets/market-brief.json    the pre-market brief
assets/market-map.json      the cross-asset map
assets/econ-calendar.json   the economic calendar
```

**`tools/daily-refresh.md` is the instruction set**, not a summary of one — the
Routine's prompt says little more than "read this and do it", so anything that
file leaves out does not happen. Each module also has its own doc specifying
fields, tone and failure modes:

- `tools/market-brief.md`
- `tools/market-map.md`
- `tools/econ-calendar.md`

Key points that are easy to get wrong:

- **Regenerate all three or none.** A fresh brief beside a stale calendar is
  worse than two stale files, because the reader cannot tell which to believe.
- **`goodUntil`** is an optional ISO timestamp on all three files that outranks
  `staleAfterHours`. Set it to the **next scheduled run** — never later. This is
  what makes a weekend or a holiday safe without a weekend run.
- **Never invent a date or a level.** If the research does not give you a
  figure, describe the move without one. A wrong level in a trading brief is
  worse than no level.
- **Bigdata.com content is licensed.** Summarise and attribute in our own
  words. Never paste article text into a published file.
- Research discipline for the Bigdata tools: **one focus, one period, one
  aspect per call.**
- `bigdata_events_calendar` takes a `calendar_type`: `"economic_calendar"` for
  macro releases (with UTC timestamps, actual/consensus/previous/impact) and
  `"corporate_calendar"` for earnings and IPOs. An older version of
  `tools/econ-calendar.md` claimed the tool did not cover macro; that was wrong
  and has been corrected.
- `currencies[]` in the calendar file may only list currencies that have at
  least one row in `events[]`. A currency declared with zero events fails the
  test suite.
- Every `impact: "high"` event needs a `note` explaining why it matters. Also
  enforced by the test suite.

Content-only changes to these three files **do not get a version bump**.

---

## 7. Testing

### The one check that is in the repo

```bash
python3 tools/check.py
```

Validates the version/meta/build agreement, build markers, and the two mobile
width guard rules in `assets/style.css`. Must pass before every commit.

### The browser suites

```bash
cd tools/tests && npm install && node run.js      # all six
node run.js mm ec                                  # a subset
```

Six headless-Chromium suites live in `tools/tests/` — brief, map, calendar,
section padding, chapter player and phone-width layout. `run.js` starts the
local server itself and exits with the number of failing suites. Details,
stubs and options are in `tools/tests/README.md`. Run them before pushing
anything that touches the member pages or the three terminal JSON files.

Screenshot rigs (desktop feature shots, phone shots) are not suites and are
not in the repo; `richstub.js` in `tools/tests/` is the Firebase stub they
need, and `README.md` there gives the phone viewport settings.

### Two CSS traps this codebase has hit

Both caused pages to lay out wider than the phone. A browser does not clip or
scroll such a page — it **shrinks the whole thing to fit**, so it reads as a
font bug and goes unnoticed for months.

1. `flex-direction: column` together with `align-items: flex-start` stops
   children being stretched, so each one shrinks to fit its own text instead of
   spanning the card. One long unbroken string then drags the document wider.
2. A grid item defaults to `min-width: auto`, so a `1fr` track can never be
   narrower than the item's min-content width. `min-width: 0` on the item
   releases it.

Both fixes are in `assets/style.css` and `tools/check.py` fails if either rule
string disappears.

**Test candidate CSS in the browser before committing to a diagnosis.** A
plausible hypothesis about `align-items` was measured and turned out to be
wrong; only the empirical check found the rule that actually worked.

---

## 8. Hard rules — do not break these

**Secrets.** `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `TV_USERNAME`,
`TV_PASSWORD`, `TV_SESSIONID` and `BROKER_SYNC_SECRET` live **only** in
`functions/.env` on the deploy machine. Never in chat, never in the repository,
never in Firestore. `BROKER_SYNC_SECRET` in particular **cannot be regenerated**
— it derives the AES-256-GCM key for stored broker credentials, and changing it
destroys every saved credential.

**Pine sources are never committed.** The indicator source code stays out of
the repository.

**Never ship a prop firm's actual limits.** The presets in the journal set the
*shape* of a rule, not a specific firm's numbers.

**Never fabricate scarcity.** No invented countdowns, seat counts or "only N
left" figures anywhere on the site.

**Never present invented data as a product screenshot.** The indicator detail
page, for example, starts empty by design and is filled in through the admin
editor; a screenshot of it seeded with made-up copy is a lie about the product.
Drop the frame instead.

**TradingView automation violates TradingView's terms of service.** The owner
has been told and accepted the risk. Do not expand it without being asked.

---

## 9. Network reality in the cloud container

Outbound access is restricted by org policy. Concretely:

- **Blocked**, for both `curl` and WebFetch: `strykertrading.com`,
  `cdn.jsdelivr.net`, `api.binance.com`, `www.gstatic.com`.
- `raw.githubusercontent.com` is reachable from GitHub Actions runners but
  **not** from this container.
- **Working**: the GitHub API via the MCP tools, the git proxy, and the
  Bigdata.com MCP tools.

So you cannot verify the live site with `curl` from here. Use the deploy
workflow's own verify step (section 5) — that is exactly why it exists.

Preinstalled: Node 22, Python 3.11, Chromium at `/opt/pw-browsers/`
(`PLAYWRIGHT_BROWSERS_PATH` is already set; `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`
stops npm postinstall re-fetching it).

There is no `gh` CLI. Use the `mcp__github__*` tools for everything GitHub.

---

## 10. State as of 22 September 2026

- **Build 305.** 80 HTML files, 154 JS files. `check.py` clean.
- **Deploy run 140 green**, commit `f8021d6`, verified on the first attempt.
- **Chapter videos are hidden** (build 304) because no recordings exist yet. Do
  not market video content from current screenshots.
- **Two mobile width bugs fixed** (build 305): Smart Money and the model/chapter
  reader. 20 of 20 gated pages now lay out at 390px, up from 18.
- The three terminal files carry `goodUntil` `2026-09-23T05:30:00Z`.
- The Global Monitor relay is self-sustaining: each `monitor-data.yml` run
  refreshes for ~5.5 hours then dispatches its own successor. The hourly cron
  is only a backstop, and every `main` deploy revives it if the data is more
  than 45 minutes stale.

### Docs that are partly stale

- `tools/deploy-notes.md` — steps 5 and 6 are superseded by sections 4 and 5
  here. Everything else still applies.

### Open items

Repository-side:

- Fix the deploy verify step's `homepage meta: unreadable` (section 5).
- `robots.txt` omits four admin pages that exist and are linked from the admin
  nav: `sessions-admin`, `x-admin`, `giveaways-admin`, `roadmap-admin`.
- `.claude/hooks/session-start.sh` exists but is **not registered** in
  `.claude/settings.json`, so it never runs and `/graphify` needs a manual
  install in a fresh cloud session.

Owner-side, carried over and not yet done:

- Add `'seo'` to the public Firestore settings rule.
- Confirm `redeemFreeCheckout` and `onReferralWritten` are deployed.
- Redeploy the remaining Cloud Functions on Node 22 before 2026-10-30.
- Verify in the Rules Playground that a signed-in non-admin cannot create
  `admins/{uid}`.
- Flip `REQUIRE_AUTH = true` in `functions-src/replayBars.js`.
- Review the 13 tour step texts in `assets/tour.js`.

---

## 11. House style for replies

`CLAUDE.md` at the repository root sets the session rule: **every reply uses the
caveman skill at level `full`**, from the first message, without being asked.
The skill is at `.claude/skills/caveman/SKILL.md`; read it at session start.

Normal prose still applies, always, for: code, code comments, commit messages,
documentation (including this file), PR text, security warnings, and
confirmations of irreversible actions.

The owner can switch with `/caveman lite|ultra|off` or by saying "normal mode".

---

## 12. Quick start for a fresh session

```bash
cd /path/to/Stryker-trading-academy-
git config user.email "theelitegrey@gmail.com"
git config user.name  "Stryker"
git fetch origin main && git status
cat assets/version.json
python3 tools/check.py
```

Then read, in this order: this file, `CLAUDE.md`, and whichever of
`tools/daily-refresh.md` / `tools/market-*.md` / `tools/econ-calendar.md` /
`tools/deploy-notes.md` / `tools/propfirm-rules.md` the task actually needs.
