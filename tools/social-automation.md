# Social automation (YouTube Shorts, Instagram Reels, Threads, X)

The multi-platform successor of the X autopost function lives in
`automation/` as a standalone service for a small VPS. It generates short
vertical videos and cards from the site's own data and curriculum, narrates
them with self-hosted voices, and posts them on a schedule.

- `automation/README.md` — what it posts and how a post is made
- `automation/SETUP.md` — the server, the platform keys, turning it on

The X-only Cloud Function (`tools/x-autopost.md`) keeps working on its own;
run one or the other against the X account, not both, or the daily caps
double up.
