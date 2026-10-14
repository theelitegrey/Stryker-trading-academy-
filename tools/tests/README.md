# Browser suites

Headless-Chromium checks for the member pages. They drive a local copy of the
site, stub Firebase, block every other network call, and assert on what the
page actually rendered. `tools/` is excluded from the deploy, so nothing here
ships.

## Run

```bash
cd tools/tests
npm install            # once per checkout; only playwright-core
node run.js            # every suite
node run.js mm ec      # prefix-match a subset
```

`run.js` starts `python3 -m http.server` on port 8000 when nothing is
listening there and stops it afterwards. Its exit code is the number of
failing suites.

To run one suite by hand, start the server first:

```bash
(setsid nohup python3 -m http.server 8000 --directory ../.. >/dev/null 2>&1 &)
node ec-test.js
```

The server dies between long sessions in the cloud container; restart it
before a manual run. Do not `pkill -f "http.server 8000"` from a shell — the
pattern matches the shell's own command line and kills it.

## Chromium

Nothing is downloaded. `lib.js` looks, in order, at `STRYKER_CHROMIUM`,
`PLAYWRIGHT_BROWSERS_PATH`, `/opt/pw-browsers` and `~/.cache/ms-playwright`,
preferring the headless shell. The cloud container ships one under
`/opt/pw-browsers`; on a laptop with Playwright installed the cache directory
is found. Do not run `playwright install` in the cloud container.

## Suites

| file             | what it guards                                                        |
|------------------|-----------------------------------------------------------------------|
| `mb-test.js`     | pre-market brief: renders fresh, hides itself stale, no XSS via JSON  |
| `mm-test.js`     | market map: cells, curve, spreads, leaders, mobile scrollers, nav     |
| `ec-test.js`     | economic calendar: order, notes on high-impact rows, filters, banks   |
| `pad-test.js`    | every app `<section>` with a background or border has padding        |
| `video-test.js`  | chapters with no recording show no player                            |
| `width-check.js` | 20 gated pages lay out at 390px with no document overflow            |
| `cheatsheet-test.js` | both cheat-sheet pages signed out/in, return path, PDF, download log, UTM, links |
| `plan-pct-unit.js` | node only: "% OFF" = floor of the discount in the visitor's currency (USD 39/109 and INR 3,772/10,544 -> 64), Free/Pro display names |
| `pct-names-test.js` | home Pro price row "$39 / month  $109  64% OFF" at 390/1280 USD+INR, upgrade modal badge + mint pill, admin Recent signups and Users list Free / Pro / Pro (legacy). `PCT_SHOTS=<dir>` |
| `chart-crypto-dom-browser.js` | Charts Crypto DOM (resting liquidity) on BTCUSDT: Style switch, BTC wall labels, old settings load, no console errors, 390 px; book rows span +-1% of the price, hidden indicator keeps recording, reload keeps history (IndexedDB), Binance footer, 6 h full-cap memory <= 25 MB. Needs `chart-dev-server.mjs 8031` + Binance; ~4 min (`WAIT_MIN`) |
| `paper-leaderboard.test.js` | node only: the scheduled leaderboard function (functions-src/paperLeaderboard.js) with a fake Firestore: ranking, privacy of rows, anti-gaming, opt-out, top 50, index fallback |
| `paper-leaderboard-browser.js` | /leaderboard + the opt-in card at 1280 + 390 against fixtures built by the real function code |
| `paper-leaderboard-rules-test.py` | rules: paperTrading/public opt-in doc (owner only, strict shape) + leaderboards/* (public read, no client write). Needs FB_TOKEN_FILE |
| `paper-review-stats.test.js` | node only: Trade review + leaderboard maths (`assets/paper-review-stats.js`): R from the first stop, win rate / expectancy / profit factor / max drawdown, NY sessions, filters, CSV, leaderboard eligibility (current run only, replay never, < 5 s out, forged P&L out), 10-trade minimum, periods, and the engine's new review fields (sl0, MAE/MFE, run, src, lev) |
| `paper-review-browser.js` | Trade review (Owner 2026-10-14): paper-review.html at 1280 + 390 with a seeded member (KPIs = the maths, breakdowns, equity curve, snapshot from mocked bars, note + tags saved to cloud + local copy only, filters, CSV, Replay toggle, no overflow) and the Charts panel Review tab at 1280 + 390. Under the Chrome lock; ~1 min |
| `chart-onebar-browser.js` | Charts ONE toolbar (Owner 2026-10-14, `assets/chart-onebar.js`): at 2560/1440/1280/1024/390 + day theme, Vela's bar merged into `#stkc-bar` (phone: Vela bar hidden), one line, nothing clipped or overlapping, item order, every toolbar id opens its panel from the bar or ⋯ More, typing on a toolbar button opens symbol search, Trade hidden while paper is off and shown when on, chart height vs `BEFORE_BASE`. `CHART_BASE=... BEFORE_BASE=... node chart-onebar-browser.js <shots>` with two `chart-dev-server.mjs` instances; under the Chrome lock; ~4 min |
| `chart-resume-browser.js` | Charts recover after leaving the tab (Owner bug 2026-10-12): NQ1! 1m and BTCUSDT 1m, hidden 30 s (socket kept), 5 min (socket closed), 35 min (half-open dead socket) and a 20 s network drop, with a fake clock and CDP lifecycle frozen -> active. Asserts current-minute bar + back-filled gap within 3 s, ticks resume, one feed socket, no extra intervals. Offline (all feeds mocked), own server; run under `flock /tmp/stryker-chrome.lock`; ~2 min |

The three data suites read the live JSON under `assets/` and rebase its
timestamps to "now", so they test the file that is about to ship, not a
fixture. `ec-test` fails when a currency in `currencies[]` has no events, or
when a high-impact event has no `note`; those are content rules, and the
daily refresh is expected to trip them occasionally.

## Stubs

Two Firebase stubs, not interchangeable:

- `stub.js` — empty snapshots. For assertions, where empty is the point.
- `richstub.js` — plausible member data (Elite plan, journal rows, backtests,
  community posts, live sessions). For screenshots and for `width-check`,
  where an empty state would hide the layout bug you are looking for.

Never regex one out of another file's source; require the one the job needs.

## Optional inputs

- `STRYKER_TRACKERS_DIR` — a local checkout of `LuxAlgo/market-trackers-data`.
  With it set, `width-check` serves real filings to the Smart Money page;
  without it the page shows its "could not load" state, which still lays out
  at width, so the check passes either way.
- `fixtures/monitor-live.json` — a saved Global Monitor feed, served to the
  monitor page in place of the `data` branch, which this container cannot
  reach.
- `STRYKER_TEST_PORT` / `STRYKER_TEST_BASE` — move the server.

## Adding a suite

Copy the shape of `video-test.js`: `require('./lib.js')` for `ROOT`, `BASE`
and `launch()`, push `PASS`/`FAIL` lines into `log`, print the count, exit
non-zero on any failure. Register it in `SUITES` in `run.js`.

## Phone screenshot settings

For a phone-class capture that matches the earlier screenshot sets: viewport
390x844, `deviceScaleFactor: 3`, `isMobile: true`, `hasTouch: true`, an iPhone
user agent, `richstub.js` as the init script, and the iOS install sheet
suppressed by pre-setting `localStorage['stryker_install_prompt_shown_u1'] =
'1'` (the key is `'stryker_install_prompt_shown_' + uid`). Output is
1170x2532.
