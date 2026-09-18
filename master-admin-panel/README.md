# Master Admin Panel

One private dashboard for everything you run on the web: **what it costs, when it renews, whether it is up, how healthy it is, and who is visiting.** Zero dependencies, one `node server.js`, data stored as JSON files.

![Dashboard](docs/dashboard.png)

## What it does

| Area | Details |
|---|---|
| **Expenses & subscriptions** | Every hosting plan, domain, SaaS tool, API, email plan, CDN… with amount, currency, billing cycle, start / next-renewal / end dates, auto-renew flag, payment method and linked websites. Normalised to a monthly burn, yearly cost and year-to-date spend. Spend by month (past + projected), by category and by website. |
| **Renewal calendar** | Every upcoming charge for the next 6 months, grouped by day. Trials and contracts with an end date are tracked; anything not auto-renewing is flagged. |
| **Website health audits** | For each site: HTTP status and response time, redirects, TLS certificate issuer and expiry, DNS (A/AAAA/CNAME/MX/NS/SPF), domain registrar and expiry via RDAP, security headers (HSTS, CSP, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy), SEO basics (title, description, canonical, viewport, H1s, alt text, lang, favicon, robots.txt, sitemap.xml, page weight, mixed content) and a 0–100 score with a findings list. |
| **Uptime monitoring** | Periodic probes with response-time history, uptime %, sparklines and a full re-audit on a longer interval. |
| **Analytics** | A built-in, cookieless pageview tracker (one script tag per site) with pageviews, daily uniques, top pages, referrers and device split. Plus one-click links to your external provider (Plausible, GA4, Umami, Matomo, Fathom, Cloudflare). |
| **Alerts** | Renewals due, trials ending, sites down, TLS or domain expiring, low audit scores, overdue tasks. Shown on the dashboard and pushed once each to a Slack / Discord / generic webhook. |
| **Tasks** | Per-site to-do list with due dates; one-click "add task" from any audit finding. |
| **Admin** | Password login (scrypt-hashed, HttpOnly session cookie), settings for intervals and currency, JSON export / import, dark mode, mobile layout. |

## Run it

```bash
cd master-admin-panel
SEED_DEMO=1 node server.js          # http://localhost:8080
```

On first visit you set the admin password. Demo data is optional and can be removed from **Settings → Remove demo data**.

Environment variables (see `.env.example`):

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | Listen port |
| `DATA_DIR` | `./data` | Where the JSON files live. Back this folder up. |
| `ADMIN_PASSWORD` | – | Pre-set the password instead of using the first-run screen |
| `SEED_DEMO` | – | `1` seeds sample sites/subscriptions on an empty install |
| `ALERT_WEBHOOK_URL` | – | Initial webhook for alerts (also editable in Settings) |

## Deploying (the site itself is static, so the panel needs its own small host)

**Render, one click (recommended).** `render.yaml` at the repo root is a blueprint: Render dashboard → *New* → *Blueprint* → pick this repo → *Apply*. It builds the Dockerfile, mounts a 1 GB disk at `/app/data` so nothing is lost on redeploys, and health-checks `/healthz`. Set `ADMIN_PASSWORD` in the service's environment or leave it blank and choose one on the first visit. Then add a custom domain such as `panel.strykertrading.com` in Render and create the CNAME it shows you in Cloudflare DNS (proxy off). Persistent disks need the Starter instance, about US$7 a month.

**Fly.io.** `master-admin-panel/fly.toml` is ready: `fly launch --copy-config --no-deploy && fly volumes create panel_data -s 1 && fly deploy`.

**Any VPS with Docker.** `automation/docker-compose.yml` includes a `panel` service and `automation/Caddyfile` serves it at `panel.strykertrading.com`; set `PANEL_ADMIN_PASSWORD` in `automation/.env` and run `docker compose up -d --build panel caddy`.

## Docker (standalone)

```bash
docker build -t admin-panel .
docker run -d -p 8080:8080 -v admin-data:/app/data -e ADMIN_PASSWORD=change-me admin-panel
```

Put it behind HTTPS (Caddy, nginx, Cloudflare Tunnel). When a reverse proxy sets `X-Forwarded-Proto: https`, the session cookie is marked `Secure`.

## Tracking pageviews on your sites

Paste this before `</body>` on each site (the exact snippet with the right site ID is shown on the site's page and under Analytics):

```html
<script defer src="https://your-panel.example/track.js" data-site="SITE_ID"></script>
```

It records path, referrer host and device class only. Unique visitors are a salted hash that rotates daily, so nothing personal is stored.

## Project layout

```
server.js         HTTP server, auth, REST API, tracker collector, scheduler
lib/store.js      JSON-file document store (atomic writes)
lib/money.js      Cost normalisation, renewal and charge-calendar maths
lib/audit.js      Site audit engine (HTTP, TLS, DNS, RDAP, headers, SEO, score)
lib/alerts.js     Alert derivation + webhook delivery
lib/seed.js       Demo data
public/           Single-page UI (no build step): app.js core, views.js screens
test/             node:test unit tests  →  npm test
```

## API

All routes under `/api` require the session cookie except `auth/*`. Main resources: `sites`, `subscriptions`, `tasks`, `settings`, `summary`, `calendar`, `alerts`, `export`, `import`. Trigger an audit with `POST /api/sites/:id/audit` or `POST /api/audit/all`. `GET /healthz` is unauthenticated for your uptime monitor of the panel itself.
