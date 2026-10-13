# Book recorder (Crypto DOM heatmap history)

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
