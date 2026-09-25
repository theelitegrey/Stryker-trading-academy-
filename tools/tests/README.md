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
