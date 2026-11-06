# ZoroOptions fixtures (stream 1 day-1 contract)

Sample data. Computed by workers/book-recorder/zoro-feeder/zoro_feeder.py from saved Cboe chains of 2026-11-06 (SPX x3 pulls,
AAPL x2, IWM, USO) and one InsightSentry ES chain. Every UI that shows fixture data must label it "Sample".
Field list and units: stryker-notes/reports/workers/zoro-options/contract-requests.md, "S1 (feeder) ANSWERS".

File               = the body of
summary.json       POST /zo-ingest?route=summary&u=SPX       -> GET /zo/summary?u=SPX     (summary-AAPL.json: a tier-B stock)
profile.json       POST /zo-ingest?route=profile&u=SPX&x=0   -> GET /zo/profile?u=SPX&x=0 (profile-all.json: x=all, has oi_chg)
surface.json       POST /zo-ingest?route=surface&u=SPX&kind=gamma (surface-iv.json: kind=iv)
history.json       GET /zo/history?u=SPX&day= (S2 builds it from stored summaries; each snap = summary.snap, the packed /gex-history row)
activity.json      POST /zo-ingest?route=activity&u=SPX&kind=burst (activity-fresh.json: kind=fresh; activity-active.json: u=ALL&kind=active)
screen.json        POST /zo-ingest?route=screen
cme.json           POST /zo-ingest?route=cme&root=ES
note.json          GET /zo/note (shape only; stream 5 owns the note)
