# Stryker social automation

A separate service that turns the academy's own content into short videos,
image cards and text posts, and publishes them to **YouTube Shorts,
Instagram Reels, Threads and X**, on a schedule, with no one at the keyboard.
The goal is reach: every post carries a UTM-tagged link back to
strykertrading.com and the videos end on a free-account call to action.

It is the successor of the X-only Cloud Function in `functions-src/xAutopost.js`
and keeps its rules: every number comes from the source, links are appended by
the system and never written by the model, and every post can be held, edited
or rejected from an admin page before it goes out.

## What it posts

| Kind | Source | When | Form |
|---|---|---|---|
| brief | `assets/market-brief.json` on the live site | weekdays 06:30 UTC, once per session | 45 s video + thread on X, Reel, Short, Threads |
| calendar | `assets/econ-calendar.json`, high-impact events | 30 min before the release | text + card |
| monitor | `monitor-data.json` on the `data` branch | on VIX / risk-tone / DEFCON change, max 2 a day | text + card |
| lesson | a chapter lesson from Firestore (or the bundled seed) | daily 12:00 UTC, rotating through the curriculum | 45–60 s educational Short |
| promo | one of the eight features pages | Tue and Fri 15:00 UTC | 40 s promo video with signup CTA |
| feature | one of the eight features pages | daily 14:00 UTC | text + card |
| announce | new chapter / model / indicator / live session in Firestore | 30 min after creation | text + card |
| manual | typed on the admin page | next tick | text + card |

All times, caps and kinds are settings on the admin page. Nothing posts until
**Enable posting** is pressed there.

## How a post is made

1. **Producers** read the sources and enqueue anything new into SQLite. The
   row id is the de-duplication key: one brief per session, one lesson per
   day, one countdown per event.
2. **Drafting** asks the Claude API (`claude-opus-5`) once for every
   platform's text, and once more for the video script (5–8 scenes with
   narration). Each draft is validated: every figure must appear in the
   source, no URLs, platform length limits. A bad draft is sent back with the
   reasons, up to three times.
3. **Rendering** builds the 1200×675 card with the same renderer the X
   function uses, and for video kinds a 1080×1920 MP4: scene PNGs with a slow
   push-in, cross-fades, narration from a self-hosted voice (Chatterbox, then
   Kokoro), an optional music bed, and burned-in captions.
4. **Publishing** sends the post to each platform inside that platform's
   pacing (gap and daily cap), records the result per platform, and retries a
   failed platform up to three times without touching the ones that worked.

Video posts wait 30 minutes after rendering before they publish, so the
preview can be watched and the post held.

## Layout

```
automation/
  src/index.js            entry: admin server + scheduler loop (or --once)
  src/scheduler.js        the tick: produce → draft → render → publish
  src/producers/          one function per post kind
  src/sources/            site JSON files, Firestore/seed chapters, features list
  src/draft/              Claude drafting + validators
  src/render/             cards (shared with functions-src), scenes, video (ffmpeg)
  src/tts/                Chatterbox / Kokoro clients with fallback and cache
  src/publish/            x, meta (Instagram + Threads), youtube, dispatcher
  src/admin/              admin page and JSON API
  scripts/                youtube-auth, meta-token, demo-video
  test/                   node --test suite (runs offline)
  Dockerfile, docker-compose.yml, Caddyfile
```

## Running it

**GETTING-STARTED.md** is the click-by-click guide (one-command install,
Connect buttons). **SETUP.md** is the reference. Locally:

```bash
cd automation
npm install
cp .env.example .env          # fill in what you have
npm test                      # offline: validators, queue, rendering
npm run demo-video            # renders data/media/demo-lesson.mp4 with no voice server
npm start                     # admin page on http://localhost:8787 (user admin)
```

`npm run tick` runs a single tick and exits, for cron-style hosting.

## Cost

At the default settings (1 video and 2–4 posts a day): a small VPS (~$12),
the Claude API (~$8), X pay-per-use (~$2–18 depending on the X link
policy). Instagram, Threads, YouTube, the voices, storage and music are $0.
