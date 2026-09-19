# Master Panel

A private operations panel for every site you run: what they cost, when the
next payment leaves the account, whether they are up, and how healthy they are.
It lives on its own subdomain — **panel.strykertrading.com** — and its own
Cloudflare Pages project, separate from the public site.

## What is in it

| View | Answers |
|---|---|
| **Overview** | What needs attention, what is about to be charged, what the estate costs. |
| **Spend & subscriptions** | Every recurring commitment and every payment made, with a monthly run-rate, cost per site, cost per category, and six months of recorded spend. CSV export for both. |
| **Renewal calendar** | A month grid of every upcoming charge, 30/60/90-day totals, and an `.ics` download so renewals land in the calendar you actually read. |
| **Sites & health** | The site registry joined against server-side checks: status, latency, uptime, TLS expiry and a weighted audit scorecard (HTTPS, HSTS, framing, CSP, nosniff, compression, title, meta description, robots, sitemap, page weight, speed). |
| **Analytics** | Students, signups, plan mix and revenue read live from the academy's own Firestore, charted against panel spend so the month's net is on one screen. Traffic numbers appear if Cloudflare Web Analytics is wired up. |
| **Alerts, incidents & tasks** | Every derived warning in one list, an incident log with durations, and a task list. |
| **Settings & backup** | Base currency and FX rates, budget, alert thresholds, where the health feed lives, and a full JSON export/import. |

## How it is put together

- **Static.** HTML, CSS and plain JavaScript on Cloudflare Pages. No server to
  run, patch or pay for.
- **Firestore for data.** The panel's own collections — `panelSites`,
  `panelSubscriptions`, `panelExpenses`, `panelIncidents`, `panelTasks` — plus
  `settings/masterPanel`. All admin-only, in both directions.
- **Authorisation is unchanged.** You are an admin if `admins/{uid}` exists,
  the same roster the main admin suite uses. The panel signs in separately
  because it is a separate origin; the Firestore rules, not the sign-in screen,
  are the boundary.
- **Health checks run in CI.** A browser cannot read another origin's status
  code, headers or certificate, so `.github/workflows/panel-health.yml` probes
  the sites from a runner and publishes `panel-health.json` to the `panel-data`
  branch. The panel reads it over `raw.githubusercontent.com`.

## Setting it up

### 1. Deploy it

Push to `main`. `.github/workflows/deploy-panel.yml` creates the Cloudflare
Pages project `stryker-master-panel` on its first run and deploys `panel/` to
it, using the same `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` secrets
the main site deploy already uses. The panel is live at
`stryker-master-panel.pages.dev` straight away.

### 2. Point the subdomain at it

In the Cloudflare dashboard: **Workers & Pages → stryker-master-panel → Custom
domains → Set up a custom domain → `panel.strykertrading.com`**. Cloudflare adds
the CNAME itself when the zone is on the same account. HTTPS is automatic.

### 3. Publish the Firestore rules

`functions-src/firestore.rules` is a reference copy — the live rules are edited
in the Firebase console. Copy the `panel*` block into the console rules and
publish, or the panel will load and every read will be denied.

### 4. Turn the health checks on

Add each property to `panel/sites.json` and push. The workflow runs on that
push, then twice an hour. Run it once by hand from the Actions tab if you do not
want to wait.

```json
{
  "id": "clientsite",
  "name": "Client site",
  "url": "https://client.example",
  "group": "Client work",
  "critical": false,
  "expectStatus": 200,
  "expectText": "Welcome",
  "paths": ["/pricing"]
}
```

`id` is permanent — the uptime history is keyed on it, so renaming one starts
that site's history over. This file is public: URLs only, never keys.

### 5. Optional — traffic numbers

Add a `CF_ANALYTICS_TOKEN` repository secret (a Cloudflare API token with
**Account Analytics: Read**) and a `"zoneTag"` on each site in `sites.json`.
The Analytics view's traffic card fills in on the next run. Without it the card
says so rather than showing zeroes.

## Day-to-day

- **Add a subscription** the moment you sign up for anything. Amount, cycle and
  start date are enough — the next charge, the run-rate and the calendar are all
  derived from those three.
- **Record a payment** when money actually leaves. The "Log payment" button on a
  subscription pre-fills it. Subscriptions are commitments; expenses are
  history. Keeping them apart is what stops a cancelled tool inflating last
  month.
- **Set `autoRenew` to false** on anything you pay manually. The panel warns
  that it will lapse rather than assuming it renews itself.
- **Set a monthly budget** in Settings to get an over-budget alert.
- **Export the JSON backup** now and then. It is the whole panel in one file.

## Things it deliberately does not do

- **No invented numbers.** Every figure traces to a record you entered or a
  check that ran. Where data is missing the panel says the data is missing.
- **No automatic FX.** Rates are yours to set in Settings, so a total never
  changes because a third-party API moved.
- **No client-side uptime claims.** The Ping button reports reachable or not
  reachable, because that is genuinely all a cross-origin `fetch` can tell you.
  Status codes, headers and certificates come from the workflow or from nowhere.
