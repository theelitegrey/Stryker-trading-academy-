# Models v2 browser suites (setup player, stats, motion)

Needs playwright-core + the preinstalled Chromium (never `playwright install`), and a local HTTPS static
server over the repo root (the one used: a small node http2 server with a self-signed cert; any static
server works if you drop `https` from the URLs). Firebase CDN scripts are stubbed in mv2.mjs, which gives a
signed-in user and empty Firestore, so models fall back to MODELS_SEED.

    node frames.mjs   https://127.0.0.1:8150 <shotdir>   # 34 checks: reduced motion, overflow, keys, swipe, speed, bad data
    node autoplay.mjs https://127.0.0.1:8150             # autoplay regression: scrolled in during the access check; short screens

Run one Chrome at a time on the 4 GB server.
