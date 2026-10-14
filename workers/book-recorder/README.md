# Book recorder (Crypto DOM heatmap history + GEX compact option chains)

> GEX chains (added 2026-10-13, build 530): see "GEX compact chains" at the end.
> Order flow + 1-second path (added 2026-10-15): see "Order flow (futures footprint)" at the end.
> GEX history (added 2026-10-14, heatmap + replay): see "GEX history" at the end.

Keeps 24 h of the Binance spot order book per symbol, one sample a minute, so the Charts
"Crypto DOM Heatmap" is filled across the whole visible chart the moment it opens. Owner
approved 2026-10-12 ("heatmap recorder: yes").

    this server (systemd timer, 60 s)                Cloudflare (free plan)
    feeder/feeder.py --- GET depth limit=5000 --->  Binance (api.binance.com, then data-api.binance.vision)
          |  bucket (same rule as the client)
          +--- POST /ingest (x-ingest-key) ----->  Worker book-recorder -> Durable Object (SQLite, 24 h)
                                                         ^
    Charts page (assets/chart-orderflow.js) -- GET /book-history?symbol=&from=&to= (edge cache 30 s)

Worker URL: https://book-recorder.theelitegrey.workers.dev

## Why a feeder on our server

Binance refuses Cloudflare's egress IPs. From the Worker, api.binance.com answered HTTP 451 and
data-api.binance.vision HTTP 403 (2026-10-13). This server gets HTTP 200 from both, so the
server fetches the book and the Worker only stores and serves it. The Worker makes no Binance
calls, runs no alarms and has no cron.

Feed: Binance **spot** `/api/v3/depth?limit=5000` (5000 levels a side). api.binance.com is used
first. data-api.binance.vision is Binance's public market-data mirror of the same spot book, used
as the fallback. Binance.US is a different exchange with a much thinner book, so it is NOT used.
USD-M perps (`.P`) are a different book, so the client does not ask the recorder for them.

## Sample format (identical to the client)

The rule is the same in all three places: `src/bucket.js` (Worker), `feeder/feeder.py` (server)
and `bucketBook` / `bookStoreRule` in `assets/chart-orderflow.js` (client).

- Row step: the nice step (1 / 2 / 2.5 / 5 x 10^n) at or below 0.05% of the mid. BTC at $83.6k
  gives $25; ETH at $2.5k gives $1.
- Band: +-2% of the mid.
- Values: bids summed per row (+), asks summed per row (-). The mid's own row is left empty.
  Leading and trailing empty rows are trimmed. Values are Float32.
- Each sample also carries ts, mid, best bid, best ask, step and i0.

Wire format (little-endian): `'BKR1' | u32 count | per sample: f64 ts, mid, bb, ba, step,
i32 i0, u32 n, n x f32`.

`test/parity.test.mjs` checks that the Worker, the feeder and the client all produce
byte-identical samples from real 5000-level snapshots (fixtures/).

## API

- `GET /book-history?symbol=BTCUSDT[&from=ms][&to=ms]`: binary samples. `from` is rounded DOWN
  to 15 min (as the client asks), `to` up to the whole minute, both clamped to the last 24 h, so a
  caller changing `from` on every request still hits the same cache entries (build 526).
  Header `x-book-from` = the oldest sample held. Cached at the edge for 30 s.
  Rate limit: 20 requests/min per IP (the client needs about one per open).
- `GET /status`: JSON health (samples per symbol, from/to, the last ingest, db size). Computed at
  most once per 30 s in the Durable Object (the counts read every row), plus the 30 s edge cache.
- Deploys only from main: the deploy job runs in the GitHub environment `book-recorder-production`,
  whose branch policy allows `main` only.
- `POST /ingest?symbols=BTCUSDT,ETHUSDT`: feeder only.
  - Auth: header `x-ingest-key`, compared in constant time (SHA-256, then timingSafeEqual).
  - Body: max 64 KB.
  - Each sample is validated: symbol in SYMBOLS, ts within 3 min, step = the rule, <= 1000
    rows, rows inside +-2%, finite values.
- CORS: tradezoro.com and strykertrading.com (plus www) only. Other browser origins get 403.
  /ingest sends no CORS headers.
- Public market data only: no user data, and no keys in the client.

## Cost: Workers Free, $0

| | per day | free limit |
|---|---|---|
| Ingest requests (Worker + DO) | 1,440 | 100,000 Worker req/day, 100,000 DO req/day |
| Rows written (2 inserts + 2 trim deletes + 1 meta per minute) | ~7,200 | 100,000 |
| Stored: BTC ~71 rows x 4 B + ~60 B/row overhead ~ 344 B x 1,440 | ~0.5 MB | 5 GB |
| Stored: ETH ~102 rows x 4 B + 60 B ~ 470 B x 1,440 | ~0.7 MB | |
| Reads: 24 h of BTC = 1,440 x ~340 B | ~0.5 MB per request, ~1,440 rows read | 5M rows/day |

Reads are edge-cached per minute and per 15-min `from`, so viewers share them. A rough ceiling
is ~3,000 uncached history reads a day before rows read gets near 5M/day. Above that, look at
Workers Paid ($5/mo). It has not been needed.

Server cost: one short Python process a minute, ~15 MB RSS for ~1-2 s (MemoryMax=96M), and
~640 KB of Binance download a minute.

## Deploy

The Worker deploys from GitHub Actions: `.github/workflows/deploy-book-recorder.yml`.

- It runs on a push to main touching `workers/book-recorder/**`, or by manual dispatch.
- It runs the unit tests, `wrangler deploy`, then sets the Worker secret INGEST_SECRET from the
  repo secret BOOK_INGEST_SECRET (piped, never printed), then runs a smoke test (/ingest without
  a key = 401, /book-history = 200).
- It uses the repo's CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID, the same as the site deploy.
  No Cloudflare token lives on this server.

Feeder (on this server, as root):

    workers/book-recorder/feeder/install.sh      # copies feeder.py, installs + enables the timer
    systemctl list-timers book-feeder.timer
    journalctl -u book-feeder -n 20 -o cat       # one line per symbol + the ingest result

Config: `/root/projects/book-feeder/feeder.env`, mode 0600.

- BOOK_RECORDER_URL
- SYMBOLS
- BOOK_INGEST_SECRET

The Worker's recorded symbols are the `SYMBOLS` var in `wrangler.jsonc`. To add a symbol, add it
to both places and deploy.

## Secret (rotation)

The secret was generated with Python `secrets.token_urlsafe(48)` and is never printed. It lives
in two places: the 0600 env file above and the GitHub secret BOOK_INGEST_SECRET (which the deploy
workflow copies to the Worker). To rotate:

    python3 - <<'EOF'
    import secrets, re
    p = '/root/projects/book-feeder/feeder.env'; s = open(p).read()
    open(p, 'w').write(re.sub(r'(?m)^BOOK_INGEST_SECRET=.*$', 'BOOK_INGEST_SECRET=' + secrets.token_urlsafe(48), s))
    EOF
    grep '^BOOK_INGEST_SECRET=' /root/projects/book-feeder/feeder.env | cut -d= -f2- | tr -d '\n' | gh secret set BOOK_INGEST_SECRET
    gh workflow run "Deploy book recorder Worker"     # pushes the new value to the Worker

Ingests fail with 401 between the env-file change and the Worker update (about a minute). That
only leaves a gap in the history.

## Rollback

- Client only: set `BOOK_RECORDER_URL = ''` in assets/chart-orderflow.js (or revert the
  commit). The indicator then behaves exactly as before the recorder (local IndexedDB + live).
  The client already falls back silently on any recorder error.
- Stop recording: `systemctl disable --now book-feeder.timer`.
- Worker version: `npx wrangler@4.149.0 rollback` (from `workers/book-recorder`, with a token
  that has Workers edit). Or redeploy the previous commit through the workflow.
- Remove completely: `npx wrangler@4.149.0 delete book-recorder` (this deletes the Durable
  Object and its data), then delete the timer and the files in /root/projects/book-feeder.

## Tests

    node workers/book-recorder/test/parity.test.mjs     # parity (Worker / feeder / client), wire format, /ingest validation, merge
    CHART_BASE=http://127.0.0.1:8031 RECORDER_ONLY=1 flock /tmp/stryker-chrome.lock \
      node tools/tests/chart-crypto-dom-browser.js <shotsDir>  # mocked recorder at 390 + 1280, and the recorder failing


## GEX compact chains

Why: the full Cboe option chain is ~5 MB (QQQ) and ~13 MB (SPX). Downloading and parsing it inside
the site's `/api/gex/levels` Pages Function exceeded Cloudflare's CPU limit (error 1102, build 528,
2026-10-13). So the heavy part runs on this server, and the Worker only checks, stores and serves
the small result.

    this server (gex-feeder.timer, every 2 min, weekdays 09:00-16:20 ET + one run 16:30-16:33 ET)
    gex-feeder/gex_feeder.py --- GET Cboe chain (QQQ, _SPX, SPY) ---> cdn.cboe.com -> cdn-api.cboe.com
          | compact: near = first 3 expiries +-12%; term = expiries <= 31 days +-10% with OI > 0
          | rows [strike, cp, oi, iv, bid, ask, vol, delta], gzip JSON (QQQ ~6-10 KB, SPX ~11-17 KB)
          +--- POST /gex-ingest?sym=&part= (x-ingest-key) --->  Worker -> DO table `gex` (latest only)
    site /api/gex/levels (functions/api/gex/_engine.js fetchCompact) -- GET /gex-chain?sym=&part= (edge cache 30 s)

- `/gex-ingest`: same shared secret as `/ingest`; gzip only, <= 256 KB; validated by
  `src/gex.js validateGexChain` (symbol QQQ/SPX/SPY/GLD, part near|term, fetched_at within 10 min,
  row shape). Only the latest chain per symbol + part is kept (one row each).
- `/gex-chain`: server use only (a request with an Origin header gets 403); edge-cached 30 s.
- The API treats a chain older than 30 min during the cash session as stale and falls back to the
  InsightSentry chain (API field `sources.fallback_reason`). With the market shut the post-close
  chain stays valid.
- Server cost: one ~1 s Python run every 2 min in market hours, ~40 MB RSS peak (MemoryMax=160M),
  ~19 MB of Cboe download per run. Worker: ~6 POSTs + one DO write each per run, about 1,300
  requests/day. That is well inside the free plan.

Install / update the feeder (as root): `workers/book-recorder/gex-feeder/install.sh`.
Logs: `journalctl -u gex-feeder -n 20 -o cat`. Run now: `python3 /root/projects/book-feeder/gex_feeder.py --force`
(with the env file loaded). Stop: `systemctl disable --now gex-feeder.timer`. Then the API
falls back to InsightSentry within 30 min.
Tests: `node workers/book-recorder/test/gex.test.mjs` (also run by the deploy workflow), and
`node tools/tests/gex-cboe-test.mjs` (compact vs full parity, CPU budget, fallbacks).


## GEX history

What: every feeder run (2 min, market hours) also computes one snapshot per underlying (SPX, QQQ,
SPY) and expiry mode (0DTE, 1DTE) and POSTs the six together to `/gex-snap`. The Durable Object
keeps 90 days. The GEX page heatmap, the Charts "GEX Heatmap" indicator and bar replay read it.
Owner-approved 2026-10-14.

    gex_feeder.py snapshot()  (same compact 'near' chain it already posts)
          +--- POST /gex-snap (x-ingest-key, gzip JSON, <= 64 KB) --->  DO tables gexsnap + gexday (90 days)
    site (GEX page / Charts) -- GET /gex-history?u=SPX&dte=0&from=&to=   (edge cache per 2-min bucket)
                             -- GET /gex-sessions[?u=SPX&dte=0]           (list of recorded days)

Snapshot fields (`src/gex-history.js` has the full comment):

- `t`: Cboe's chain time (epoch s), i.e. the market moment the numbers describe. `fa` is when we
  fetched it (Cboe's delayed chain runs ~15 min behind).
- `s` spot, `x` the expiry priced, `cw` call wall, `pw` put wall, `zg` zero gamma, `n` net GEX
  (+-6%, $M), `em` = [center, sigma] of the session expected range (68% = +-sigma, 80% = +-1.2816 sigma).
- `k` / `g`: every listed strike within +-5% of spot and its net GEX ($M per 1% move; calls +,
  puts -).

The maths is a port of `functions/api/gex/_engine.js` on Cboe's own spot + IV (what the API
reports as `compare.cboe_only`). It is NOT the hybrid InsightSentry IV: the feeder has no
InsightSentry key, and a history must be reproducible from one source. So a snapshot can differ a
little from the live API's levels for the same minute. `test/gex-history.test.mjs` checks walls,
zero gamma, expected range and every strike's GEX against the JS engine on real chains
(2026-10-14 fixtures).

Rules:

- A chain whose Cboe time is not today (New York) is not snapshotted (09:00-09:30 ET runs still
  see yesterday's chain). The same chain time twice (Cboe did not reprint) replaces the row.
- Validation (`validateSnaps`): u in SPX/QQQ/SPY, d 0|1, t not in the future and < 24 h old,
  finite levels, strikes ascending and within +-5% of spot, <= 400 strikes, <= 12 snapshots per POST.
- `/gex-history`: `from`/`to` epoch seconds (ms accepted). Default the last 24 h. `from` rounded
  down to the hour, `to` up to the 2-min bucket; max 8 days per call; CORS for our two sites only
  (like /book-history), and the same 20/min per-IP rate limit. A range that ended over an hour ago
  is cached at the edge for a day, else per 2-min bucket. Reply = column arrays over one shared
  strike axis (`packHistory`; `unpackHistory` is the inverse). Cloudflare compresses it
  (gzip/brotli) for clients that accept it.
- `/gex-sessions`: `[{u, d, day, n, t0, t1}]`, newest first, from the per-day summary table.
- Plan gating (SPX 0DTE free, everything else Pro) is done by the site, as for `/api/gex/levels`.
- Trim: rows older than 90 days are deleted at most once an hour, by primary key.

### Size and cost (stays on Workers Free; measured on the 2026-10-14 chains)

| | per trading day | free limit |
|---|---|---|
| Snapshot JSON: SPX ~1.85 KB (~150 strikes), QQQ ~0.86 KB, SPY ~0.90 KB; x2 modes = ~7.2 KB per run | | |
| Runs that store (09:30-16:15 ET chain times, every 2 min) | ~205 | |
| Stored per day: ~7.2 KB x 205 + ~10% SQLite overhead | ~1.6 MB | |
| Stored for 90 days (~63 trading days) | ~100 MB | 5 GB per account (SQLite DOs) |
| Rows written: 6 snapshots + 6 day-summary upserts per run (+ hourly trims) | ~2,500 | 100,000/day (the book recorder uses ~7,200) |
| Requests: one /gex-snap POST per run (Worker + DO) | ~220 | 100,000/day |
| Rows read: a full SPX session = ~205 rows; sessions list ~1 row a day | ~205 per uncached read | 5M/day |

Reads are edge-cached (2-min buckets; finished ranges a day), so viewers share them. Even
uncached, 5M rows/day is ~24,000 full-session reads a day. Feeder cost: the snapshot maths adds
~0.1 s CPU per run (six snapshots), no extra download.

Stop collecting: remove `SNAP_SYMBOLS` handling (or set it to `()`) in gex_feeder.py and re-run
install.sh; the chains keep flowing. Delete the data: `DROP TABLE gexsnap; DROP TABLE gexday;` via a
one-off DO route, or delete the Worker (this also deletes the book history).

Tests: `node workers/book-recorder/test/gex-history.test.mjs` (feeder vs engine parity, validation,
pack/unpack, no-lookahead lookup; CI runs it) and `node workers/book-recorder/test/gex-worker-local.mjs`
(the Worker routes end to end on node:sqlite).


## News + economic calendar (InsightSentry; added 2026-10-14)

Owner approved 2026-10-14 (InsightSentry commercial licence). The feeder on this server is the
ONLY thing that talks to InsightSentry; the Worker and the browser never see the IS key.

    this server (news-feeder.timer, every 2 min)
    news-feeder/news_feeder.mjs --- GET /v3/newsfeed (1 page of 200, more only if we fell behind) ---> InsightSentry
          |                     --- every 15 min: /v3/calendar/events w=1..3, earnings w=1..2,
          |                         dividends w=1, ipos w=1..2
          | compact (src/news.js, the SAME file is installed next to the feeder): id = hash of the
          | normalised title (dedupe), t, source, title, <= 280-char summary, https link, our tags
          +--- POST /news-ingest, /cal-ingest?kind= (x-ingest-key, JSON <= 512 KB) --->  Worker -> DO
    site --- GET /news?sym=NQ&q=&from=&to=   (edge 60 s; `to` = bar-replay cut-off)
         --- GET /cal?kind=events&from=YYYY-MM-DD&to=YYYY-MM-DD (<= 45 days) | kind=earnings|dividends|ipos (edge 5 min)

- Tags: NQ ES YM GC SI CL BTC ETH from IS related symbols (index, futures, ETF and spot codes;
  mega-caps count for NQ/ES/YM only when an item names at most 3 symbols; a basket of more than 6
  related symbols counts as MACRO), plus title keyword rules; extra tags MACRO (Fed, CPI, jobs,
  yields...), CRYPTO, STOCKS. A symbol's feed = its tag + MACRO (crypto: + CRYPTO; CL: CL only).
  Rating/press-release noise not about our markets, and untagged items from non-market desks, are
  dropped at the feeder. Rules + tests: src/news.js, test/news.test.mjs.
- Storage: news one DO row per UTC hour (7 days, deduped across all of them on every ingest; a
  duplicate keeps the earliest time and gains a missing link/summary). Calendar events one row
  per UTC day (a re-fetched day is replaced whole, so a cancelled event disappears; ~13 months
  kept); earnings/dividends/IPOs latest blob per kind.
- Rate limit: InsightSentry sends no rate-limit headers; 12 back-to-back newsfeed calls all
  returned 200 (2026-10-14). We use ~1 call / 2 min + 7 calls / 15 min (~1,400/day). A 429 is
  logged, the next tick tries again. Reads: per-IP 60/min (binding RLN), edge cache shared by all.
- Cost: ~720 news ingests + ~380 calendar ingests a day; rows written ~10-30 per ingest; well
  inside the Workers/DO free tier.
- Server: one Node run per 2 min, ~45-60 MB RSS for 1-3 s (MemoryMax=150M).

Install / update (as root): `workers/book-recorder/news-feeder/install.sh`.
Logs: `journalctl -u news-feeder -n 20 -o cat`. Force a calendar pull: run the service's
ExecStart with `--cal`; re-pull 7 days of news: `--backfill`. Stop: `systemctl disable --now news-feeder.timer`
(the site keeps showing the stored items and falls back to assets/econ-calendar.json for the calendar).
Tests: `node workers/book-recorder/test/news.test.mjs` (also run by the deploy workflow).

## Order flow (futures footprint)

Owner-approved 2026-10-14. Footprint, delta, CVD, big trades and the trades volume profile on Charts
read 1-minute bars built from InsightSentry tick trades (every print carries its aggressor side).

    this server: of-feeder.service (long-running, of-feeder/of_feeder.py)
       2 x wss://realtime.insightsentry.com/live (bar_type tick, 3 symbols each: IS allows 5 per socket)
       REST /v3/symbols/{contract}/trades?date= (backfill, today's fill at start, daily rebuild 00:20 UTC)
       -> 1-minute records (of-feeder/ofcodec.py) -- POST /of-ingest (x-ingest-key, gzip, <= 300 bars) every 30 s
    Worker -> Durable Object table ofbar (sym, t, b = footprint, s = 1-second path), 90 days
    GET /orderflow?sym=NQ&day=YYYY-MM-DD | &from=&to=   binary footprint (gzip body, header x-of-gzip: 1)
    GET /ticks1s?sym=NQ&from=<s>&to=<s>  (<= 1 day)     JSON 1-second OHLCV path for tick-by-tick replay

- Symbols: NQ ES YM GC SI CL (minis; the site maps micros to them). The contract is the more
  active of the two nearest listed months, picked daily (IS's "GC1!" pointed at an idle October
  contract). A contract change restarts the feeder.
- History: InsightSentry keeps only today + the previous 6 UTC dates (older dates: HTTP 400), so
  the backfill reaches 6 days; the 90 days fill up from then on.
- Record: see src/orderflow.js. Big trade = one aggressive order (same millisecond + side, summed)
  >= the 99.5th percentile of the previous UTC day's order sizes (floor 5 lots).
- The open minute lives only in the DO's memory (no row written every 30 s); the last 26 h are
  cached in memory, so refreshing "today" reads no rows. Closed ranges are edge-cached a day,
  ranges holding now 15 s. Rate limit RL_OF: 60/min per IP for /orderflow + /ticks1s.
- /ticks1s reply: `{ v, sym, tick, prices: 'real', m: [[minuteEpochSec, [[sec 0-59, o, h, l, c, volume], ...]], ...] }`,
  only seconds that traded.
- Sizes (NQ, 2026-10-13, 364,827 prints): footprint 145 KB raw / 86 KB gzip a day; the 1-second
  path ~350 KB a day stored. Rows written ~6 x 1,440 a day. All six symbols ~1 MB/day, ~90 MB at
  90 days: Workers Free.
- Install / update on the server: `sh workers/book-recorder/of-feeder/install.sh [--backfill]`.
  Logs: `journalctl -u of-feeder`. Tests: `node test/orderflow.test.mjs` (CI), `node test/orderflow-worker-local.mjs`.
