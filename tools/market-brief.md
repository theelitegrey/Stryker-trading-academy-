# Producing the pre-market brief

`assets/market-brief.json` is written by hand or by a scheduled job and
committed. The site only renders it — there is no API key in the browser and no
per-visit cost. This is the same publish-a-file shape the Global Monitor uses.

**Ship it before the London open** if it is to be read before New York. A brief
committed after 09:00 New York time has missed its own audience.

---

## The rules that matter

**Paraphrase, never paste.** The research comes from licensed news and research
content indexed by Bigdata.com. Summarising it in our own words with the source
named is normal practice. Reproducing article text verbatim on a public page is
a different thing and may breach the licence. Every field in the JSON is our own
prose. If verbatim quotation is ever wanted, check the Bigdata.com terms first.

**Attribute by source name.** `sources[]` carries the outlet and what it
contributed. The rendered footer prints it. A brief with no sources is a brief
nobody should act on.

**Never invent a level or a time.** Every number in the brief has to come from
something retrieved. If the research does not give a figure, describe the move
without one. A wrong level in a trading brief is worse than no level.

**Say what you do not know.** "Positioning, not conviction" is a fair reading.
"The market will do X" is not. This is context, not a call.

**Staleness is handled for you, but do not rely on it.** The renderer hides the
calendar and shows a warning once the brief is past `staleAfterHours`. That is a
safety net for a missed day, not a licence to skip.

---

## Regenerating it

Research first, in focused passes rather than one broad query. What the brief
needs, in order of importance to an index-futures trader:

1. **Index futures and the overnight tape** — what moved, by how much, and why.
2. **Rates and the dollar** — the transmission mechanism. A yield at a multi-year
   high matters more to the session than any single stock.
3. **Energy and geopolitics** — the current inflation channel.
4. **Today's releases with times** — the calendar is the part people act on, so
   it has to be right.
5. **Gold and crude** if members trade them, which the setup wizard records.

Then write the JSON. Fields:

| Field | What it is |
| --- | --- |
| `generatedAt` | ISO timestamp, UTC. Drives the staleness check. |
| `sessionDate` | The trading day the brief is for. |
| `staleAfterHours` | 30 is right for a daily brief; it survives a weekend gap poorly on purpose. |
| `headline` | Eight words or fewer. The one thing that defines the session. |
| `standfirst` | Two sentences. What happened, what is due. |
| `bullets[]` | Three to five. `title` is the claim, `text` is the evidence. |
| `calendar[]` | `time` in ET, `event`, `note` on why it matters. |
| `sessionNote` | How to read the session, in trading terms not market-commentary terms. |
| `watchOut` | The single most likely way to lose money today. The most valuable field. |
| `sources[]` | Outlet name and what it contributed. |
| `archive[]` | Trim to the last seven. Yesterday's `headline` and a one-line `summary`. |

Move the outgoing brief into `archive[0]` and trim the tail before writing the
new one.

## Deploying

```bash
python3 tools/check.py          # version consistency, JS syntax
git add assets/market-brief.json && git commit && git push
```

No version bump is needed for a content-only change: `market-brief.json` is
excluded from the year-long asset cache in `_headers` and is fetched with a
cache-busting parameter, so a commit is live as soon as Cloudflare deploys it.

## The map is produced alongside it

`assets/market-map.json` covers the same session from the other direction: the
brief says what moved and what is due, the map says where it all landed across
eight asset classes. The brief page renders the map's leaders-and-laggards strip
underneath itself, so the two must describe the same board — produce them in the
same sitting. See `tools/market-map.md`.

## Automating it

A scheduled agent session can do the research and commit the file. Two things
it must be told, because neither is obvious from the schema:

- Run before the London open, not on a fixed UTC hour that drifts across the
  session for half the year.
- Skip weekends and US market holidays. A Saturday brief with a Friday calendar
  is exactly the failure the staleness check exists to catch, and it is better
  not to produce it at all than to rely on the warning.
