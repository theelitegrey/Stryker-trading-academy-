# Setup (reference)

**If you are not a developer, read GETTING-STARTED.md instead.** It is the
same setup as a numbered click-by-click guide, with the one-command
installer and the Connect buttons on the admin page. This file is the
reference for people who prefer to do it by hand with `.env`.

Everything below is done once. Budget an afternoon for the server and the
X and Threads keys; Instagram and YouTube need reviews from Meta and Google
that take one to three weeks, and the platform posts to the others while
you wait.

## 1. The server

Any Linux VPS with 4 vCPU and 8 GB (Hetzner CX33/CPX-class, DigitalOcean
Basic 8 GB) running Docker. Chatterbox on CPU needs the memory; Kokoro alone
runs on 2 GB.

```bash
git clone https://github.com/theelitegrey/Stryker-trading-academy-.git stryker
cd stryker/automation
cp .env.example .env
nano .env                       # ADMIN_PASSWORD, PUBLIC_BASE_URL, ANTHROPIC_API_KEY first
nano Caddyfile                  # your hostname
docker compose up -d --build    # first build pulls the voice models: 10–20 minutes
```

DNS: an `A` record for the hostname in `Caddyfile` (e.g.
`social.strykertrading.com`) pointing at the VPS. Caddy gets the certificate
itself. The admin page is then at `https://social.strykertrading.com`, user
`admin`, password from `.env`.

**Why a public hostname is required:** Instagram and Threads do not accept
uploads; they fetch the video from a URL. This server serves rendered media
at `PUBLIC_BASE_URL/media/…` (no login). Nothing else is public.

### The brand voice (Chatterbox)

Chatterbox clones a voice from a short clip. Record 10–20 seconds of clean
speech (no music, one speaker), save it as `automation/voices/stryker.wav`
(24 kHz mono WAV is ideal), and set `CHATTERBOX_VOICE=stryker.wav`. Without
a clip the server uses its default voice. Kokoro's preset voices are listed
at `http://kokoro:8880/v1/audio/voices` inside the compose network;
`am_michael`, `af_heart` and `bm_george` are good for narration.

### Music

Drop royalty-free tracks (Pixabay licence or your own) into
`automation/data/music/`. One is chosen per video and ducked under the
narration by `musicDb` (default −18 dB). No tracks means no music.

## 2. Claude API

`ANTHROPIC_API_KEY` from <https://console.anthropic.com>. The **Test** button
next to *claude* on the admin page drafts a one-line post to confirm it.

## 3. X

Same keys as the existing X function (`tools/x-autopost.md`, step 1): an app
in the academy's developer account with **Read and write** permission, and
the four values `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`,
`X_ACCESS_SECRET`. `X_HANDLE` is the account name without the @.

X bills per post since February 2026 and charges more for a post containing
a link. The **X link policy** setting decides which posts carry one:
`brief` (default) links only the daily brief thread; `all` links every post;
`none` relies on the link in the profile bio. Confirm the current rates at
<https://developer.x.com/en/products/x-api> before choosing `all`.

Video on X is uploaded in chunks and needs the app to have media upload
enabled, which Read and write apps do.

## 4. Meta: Instagram Reels and Threads

Prerequisites on the Instagram side: the academy's Instagram account must be
a **Business** or **Creator** account, linked to a **Facebook Page** you
admin (Instagram app → Settings → Account type and tools).

1. <https://developers.facebook.com> → **Create app** → use case *Other*,
   type *Business*. Note the App ID and App Secret → `META_APP_ID`,
   `META_APP_SECRET`.
2. Add the products **Instagram Graph API** and **Threads API** to the app.
3. **Instagram token**: open the Graph API Explorer
   (<https://developers.facebook.com/tools/explorer>), pick the app, add the
   permissions `instagram_basic`, `instagram_content_publish`,
   `pages_show_list`, `pages_read_engagement`, `business_management`, and
   generate a user token. Then on your computer:

   ```bash
   META_APP_ID=... META_APP_SECRET=... node scripts/meta-token.js <that token>
   ```

   It prints `IG_ACCESS_TOKEN` (long-lived, 60 days) and `IG_USER_ID`.
   The server refreshes the token itself once a month while it is valid.
4. **Threads token**: in the app dashboard under *Threads API → Use cases*,
   add `threads_basic` and `threads_content_publish`, add the academy's
   Threads account as a tester (accepted from the Threads app → Settings →
   Account → Website permissions), and use the dashboard's token generator
   for a long-lived token → `THREADS_ACCESS_TOKEN`. `THREADS_USER_ID` is
   returned by `GET https://graph.threads.net/v1.0/me?access_token=…`, or by
   the **Test** button once the token is set.
5. **App review**: while the app is in development mode only accounts with
   a role on the app can be published to, which is fine for the academy's
   own accounts. Submit `instagram_content_publish` and
   `threads_content_publish` for review anyway so a token cannot stop working
   when Meta tightens development mode; the review asks for a screencast of
   the admin page posting.

Publishing limits: 100 Instagram posts and 250 Threads posts per 24 hours
per account, far above the pacing defaults.

## 5. YouTube

1. <https://console.cloud.google.com> → new project → **APIs & Services →
   Enable** *YouTube Data API v3*.
2. **OAuth consent screen**: External, add the channel's Google account as a
   test user, scopes `youtube.upload` and `youtube.readonly`.
3. **Credentials → OAuth client ID**, type *Web application*, redirect URI
   `http://localhost:8790/cb` → `YT_CLIENT_ID`, `YT_CLIENT_SECRET`.
4. On your computer, signed in to the channel's Google account:

   ```bash
   YT_CLIENT_ID=... YT_CLIENT_SECRET=... node scripts/youtube-auth.js
   ```

   It prints `YT_REFRESH_TOKEN`.
5. **Audit**: uploads from a project that has not passed YouTube's API
   compliance audit are set to *private* by YouTube. Submit the *YouTube API
   Services – Audit and Quota Extension* form
   (<https://support.google.com/youtube/contact/yt_api_form>) describing the
   academy's own channel automation. Until it passes, the platform still
   uploads; the videos simply sit private and can be made public by hand.

Quota: an upload costs 1 unit against a 100-per-day upload bucket, so the
default project quota is never the limit here.

## 6. Firestore (optional)

For announcements of new chapters, models, indicators and live sessions, and
for lessons read live rather than from the bundled seed: create a service
account in the Firebase project (Project settings → Service accounts →
Generate new private key) with the *Cloud Datastore Viewer* role, save the
JSON next to `.env`, and set `FIREBASE_SERVICE_ACCOUNT=./service-account.json`.
Without it, lessons come from `assets/chapters-data.js` and announcements are
off.

## 7. Turn it on

On the admin page: press **Test** on each connection, check the times under
Settings, then **Enable posting**. The first tick runs within a minute of
enabling; **Run now** does not wait. The status strip shows the last tick,
the last post and today's count per platform. **A last tick older than
twenty minutes means the service is down**, not that there was nothing to
post: `docker compose logs -f app`.

## Operating it

- **Needs attention** holds posts you parked with *Hold for approval*,
  and anything that failed. Edit the text in place, *Approve*, *Approve &
  post next*, *Redraft*, *Re-render video* or *Reject*.
- **Scheduled** shows drafts waiting for their slot, and videos in their
  30-minute preview window with the player. Everything there is editable.
- A **partial** post went out on some platforms and failed on others; *Retry*
  re-sends only the failed ones.
- *Reject* is permanent for that id; *Delete* lets tomorrow's tick recreate
  it. Never delete today's brief row after it posted, or it posts again.
- **Always hold kinds** in Settings parks every post of those kinds for
  approval (e.g. `promo`).
- Traffic shows up in analytics under `utm_source=youtube|instagram|threads|x`
  and `utm_campaign=` the post kind.

## Updating

```bash
cd stryker && git pull && cd automation && docker compose up -d --build
```

The queue and media live in `automation/data/` (bind-mounted), so an update
never loses them. Back that folder up if the history matters.
