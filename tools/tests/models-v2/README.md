# Models v2 browser suites (setup player, stats, motion)

Needs playwright-core + the preinstalled Chromium (never `playwright install`), and a local HTTPS static
server over the repo root (the one used: a small node http2 server with a self-signed cert; any static
server works if you drop `https` from the URLs). Firebase CDN scripts are stubbed in mv2.mjs, which gives a
signed-in user and empty Firestore, so models fall back to MODELS_SEED.

    node frames.mjs   https://127.0.0.1:8150 <shotdir>   # 34 checks: reduced motion, overflow, keys, swipe, speed, bad data
    node autoplay.mjs https://127.0.0.1:8150             # autoplay regression: scrolled in during the access check; short screens

Run one Chrome at a time on the 4 GB server.
    node list-and-sb.mjs <base> <shotdir> <model-id> "<H1>"  # models list (11) + one storyboard player
    node final.mjs <base> <shotdir> [mainBase]      # final pass: list + filter chips, the 5 new pages + fvg-model-b + orb-model-a,
                                                    # 390/1440 x night/day, Option B (no stats on any of the 11 pages),
                                                    # approved footer copy, reduced motion, signed-out paywall vs main.
                                                    # Player/no-player is read from MODELS_SEED (SEED_JS=<path> to override).
    node record.mjs <base> <outdir> <model-id> [theme] [speed]  # 4 hero PNGs + a webm of the player auto-playing every frame
