# Demo / marketing trader account ("Richard")

Internal account for screenshots, demos, tutorials and ads. It is flagged only by hidden fields (`students/{uid}.demo = true`,
`marketing = true`); the UI shows no demo labels. All numbers are synthetic demo data, never real performance.

## Run
    node seed.mjs --dry-run            # print what would be written
    node seed.mjs --create             # first run: Auth user + demo-flagged student doc + credentials file, then seed
    node seed.mjs --reset              # wipe ONLY this uid's seeded data, re-seed deterministically
    node seed.mjs --touch              # refresh lastActiveDate/streak (a streak a day stale is reset by the app)
    node seed.mjs --avatar file.png    # profile picture (240px JPEG data URL, as Settings stores it)
    node verify.mjs                    # recompute win rate / PF / net from the raw journal docs
    node shots.mjs <dir> [1440|390]    # log in as Richard on the live site and screenshot every module

Safety: refuses to run unless `students/{uid}.demo === true`. `--reset` only deletes under `students/{uid}/...` and the
uid's own notifications. Credentials: 0600 file `$DEMO_CREDENTIALS` (default
`/root/.hermes/profiles/chief-of-staff/secure/demo-account/credentials`), never in the repo. Firestore/Auth access uses the
server's firebase-tools login (`lib/gcp.mjs`), no keys in code.

## Data sources (all deterministic; fixed seeds)
- `gen-journal.mjs` -> `data/journal.json`, `data/playbooks.json`: 136 trades Jun-Oct 2026, prices placed inside real candles
  from `/api/chart/bars`; P&L from contract specs (NQ 20, MNQ 2, ES 50, MES 5) minus fees.
- `gen-paper.mjs` -> `data/paper-state.json`: drives the app's own `assets/paper-engine.js`.
- `gen-backtests.mjs` -> `data/backtests.json`: runs the app's own `assets/replay-engine.js` over real 5m bars. Each idea is
  run as 16 variants (NY AM vs to 14:30, 1/1.5/2/3 R, with/without HTF-bias filter); `GRID=1` prints every variant. Per idea the
  best-profit-factor variant is kept. Results are engine output, never edited.
- `gen-levels.mjs`, `data/charts.json` (layouts/templates/favourites captured from the real Charts page), alerts/watchlists in `seed.mjs`.

## Not seeded (by decision / not stored server-side)
Community posts and messages (shared public surfaces); scanner presets, calendar, dashboard layout (browser localStorage only).
Market-data feeds (GEX, bars, order flow, news) are never touched.

## Excluded from stats
`adminStats` skips `demo === true` rows. Leaderboard: `paperTrading/public.optIn = false`.
