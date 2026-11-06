# ZoroOptions fixtures (stream 1 day-1 contract)

Sample data. Computed by workers/book-recorder/zoro-feeder/zoro_feeder.py from saved Cboe chains of
2026-11-06 (SPX x3 pulls, AAPL x2, IWM, USO) and one InsightSentry ES chain. Regenerate with the feeder's
--analyse mode. Every UI that shows fixture data must label it "Sample".

Files = one per API route (spec section 6) + what the feeder POSTs:
- ingest-sym.json  POST /zo-ingest?kind=sym body (gzip JSON). One per symbol per pull. Keys: summary, profile
                   (per mode 0|1|w|m|all), profile_cols, activity {fresh, burst}, oi_chg, snap (history row),
                   surface {gamma, iv} (only on surface pulls: every 15 min tier A, 30 min tier B).
                   Other kinds: kind=screen {rows}, kind=cme {cme}. Worker stores the latest per (u) / (root).
- summary.json     GET /zo/summary?u=      = ingest.summary
- profile.json     GET /zo/profile?u=&x=   = ingest.profile[x] + cols + oi_chg
- surface.json     GET /zo/surface?u=&kind= = ingest.surface[kind]
- history.json     GET /zo/history?u=&day= = list of ingest.snap for the day (tier A 2 min, tier B 15 min)
- activity.json    GET /zo/activity?u=&kind=fresh|burst ; u=all&kind=active (built from screen rows)
- screen.json      GET /zo/screen          = kind=screen rows
- cme.json         GET /zo/cme?root=       = kind=cme cme
- note.json        GET /zo/note?day=       (stream 5 owns the note text; shape only)

Units and conventions
- t: epoch seconds of the Cboe chain time (the market moment the numbers describe). fa: feeder time.
- levels[mode]: cw = Call Ceiling, pw = Put Floor, zg = Flip Line, net = net GEX $M per 1 % move, zone
  cushion|swing, mp = Pin Strike, nodes = Gamma Nodes [[strike, gex $M, share of |total|]] (10), x = expiries used.
  summary.levels has modes 0 and all only; profile carries every mode.
- profile rows: [k, gex $M/1%, dex $M, vanna $M per vol point, charm $M per day, call vol, put vol, call OI, put OI],
  strikes within +-6 % of spot. Dealer-sign convention as GEX: calls +, puts -.
- range: Zoro Range rows {k: 0DTE|1DTE|Weekly|Monthly, x, days, em, pct, lo, hi, iv, iv_em, fut?}.
- iv: iv30 (Cboe, %), atm30 / skew30 (fraction), rank {rank, pct, lo, hi, n, src} or null (never invented: stocks get
  a rank after 60 days of our own iv30 record), rv20 (%), term [[x, days, atm iv, 25d put iv, 25d call iv]],
  term5 = term 5 trading days ago (null until stored), spark [[day, iv30]].
- pc: vol, oi (<= 31 days), vol_0 / oi_0 (first expiry), cvol, pvol, hist [[day, pc vol, pc oi]] (20 days).
- pin: [expiry, Pin Strike, % from spot]; pins: next 6 expiries.
- fut (index symbols only): futures-mapped levels {root, ratio, from, label "mapped from SPX", cw, pw, zg, mp}.
- activity.fresh: {x, k, cp, vol, oi, ratio, mid, prem} volume > OI, >= 500 contracts and >= $50k at mid.
- activity.burst: {t0, t1, x, k, cp, dv, mid, prem}: volume added between the pulls at t0 and t1, >= 1,000
  contracts or >= $250k at mid. Label: "Volume added between two updates. Not single trades; no buyer or seller side."
- oi_chg: [[k, call OI change, put OI change, call OI, put OI]] vs the previous trading day, or null.
- surface.gamma: k (41 strike bins over +-6 %), x (expiries <= 90 days), z[x][k] $M. surface.iv: m (moneyness 0.85..1.15),
  x, days, z[x][m] OTM IV (fraction) or null.
- cme: real levels from the CME chain {root, t, ok, src "CME options", cw, pw, zg, net, zone, mp, nodes, oi_rows, note,
  mapped {...same as summary.fut, t}}. ok=false + reason when OI is too thin.
