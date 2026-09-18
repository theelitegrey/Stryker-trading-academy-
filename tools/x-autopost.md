# X autopost — setup and operation

The academy's X account is posted to by a scheduled Cloud Function,
`xAutopostTick`, in `functions-src/xAutopost.js`. This file is the setup guide
and the operating notes. The admin page is `x-admin.html`.

## What it posts

| Kind | Source | When | Approval |
|---|---|---|---|
| brief | `assets/market-brief.json` on the live site | weekdays at 06:30 UTC, once per `sessionDate`, only if the file is today's | automatic |
| calendar | `assets/econ-calendar.json`, `impact: "high"` events | 30 minutes before the event, never after it | automatic |
| monitor | `monitor-data.json` on the `data` branch | when the VIX regime, risk tone or DEFCON estimate changes; at most 2 a day | automatic |
| announce | a new document in `chapters`, `models`, `indicators`, `liveSessions` | 30 minutes after creation, title re-read at posting time | automatic |
| feature | the eight `features-*.html` pages, in rotation | drafted at 14:00 UTC, one per day | automatic |
| manual | typed into the composer on `x-admin.html` | next tick | none needed |

Every post is drafted by the Claude API from the source data, under a rule
that no number may appear that the source does not contain (the draft is
checked and rejected if it does), carries a 1200×675 branded card, and ends
with a link to the site tagged `utm_source=x&utm_medium=social&utm_campaign=…`.

Pacing: one post or thread per ten-minute tick, at least 45 minutes apart
(calendar alerts excepted), at most 5 a day. All of these are settings on the
admin page.

## One-time setup

### 1. The X developer app

1. Sign in to <https://developer.x.com> **with the academy account** — the
   account that will do the posting. Access tokens are minted for whichever
   account is signed in, and cannot be moved.
2. Create a project and an app inside it. The Free tier is enough to start:
   it allows posting (a monthly cap on writes; check the current figure on the
   pricing page — at five posts a day the academy uses roughly 150 a month)
   and media upload. It does not allow reading timelines, which this function
   never does.
3. In the app's **User authentication settings**, turn authentication on with
   **Read and write** permissions. Type of app: *Web App, Automated App or
   Bot*. Callback and website URL can both be `https://strykertrading.com`.
   Save.
4. Under **Keys and tokens**:
   - copy the **API Key and Secret** (also called consumer key and secret);
   - **generate** the **Access Token and Secret** for the account. The line
     under them must say *Created with Read and Write permissions*. If it says
     Read only, you turned on write after generating: regenerate them.

   Four values. Keep them somewhere safe for the next step; they are shown
   once.

### 2. Secrets on the server

From the functions project folder in Cloud Shell (the one holding
`firebase.json`; see `functions-src/DEPLOY.md`). Each command prompts for the
value and stores it in Secret Manager. Nothing goes into `.env`, Firestore,
or the repo.

```bash
firebase functions:secrets:set X_API_KEY
firebase functions:secrets:set X_API_SECRET
firebase functions:secrets:set X_ACCESS_TOKEN
firebase functions:secrets:set X_ACCESS_SECRET
firebase functions:secrets:set ANTHROPIC_API_KEY
```

`ANTHROPIC_API_KEY` comes from <https://console.anthropic.com> (API keys). The
drafting model is `claude-opus-5`; at a handful of posts a day the cost is
cents.

### 3. Dependencies and deploy

```bash
cd functions
npm install @anthropic-ai/sdk @resvg/resvg-js
grep -q "xAutopost'" index.js || echo "Object.assign(exports, require('./xAutopost'));" >> index.js
cd ..
firebase deploy --only functions:xAutopostTick,functions:xAutopostAdmin,functions:xAutopostOnChapter,functions:xAutopostOnModel,functions:xAutopostOnIndicator,functions:xAutopostOnSession
```

`@resvg/resvg-js` renders the image cards. If it fails to install, deploy
without it: the function posts text only and the admin's *Test connection*
button says "card renderer not installed".

### 4. Firestore rules

Add the three `match` lines from `functions-src/firestore.rules` (search for
`xAutopost`) to the live rules in the console. Without them the admin page
cannot read the queue.

### 5. Turn it on

Open `x-admin.html`. Press **Test connection**: it should say *Connected as
@yourhandle*. Open **Settings**, enter the handle, check the times, save. Then
**Enable posting**. The first tick runs within ten minutes; **Run now** does
not wait.

## Operating it

**Needs approval** is empty unless you park something there: *Hold for
approval* on any scheduled post moves it here. Edit the text in place, then
*Approve* (posts at the next slot the pacing allows) or *Approve & post next*
(jumps the queue but still respects the daily cap). *Redraft* asks the model
again. *Reject* means this item is never drafted again — the doc id is
the de-duplication key, so deleting a rejected feature promo lets tomorrow's
tick create it afresh, while deleting today's brief record would let the
brief post twice.

**Scheduled** shows drafts waiting for their slot, including the brief once
it has been drafted. Everything there is editable until it posts.

**Failed & skipped** is where to look when the account goes quiet. A *failed*
post shows the exact X API status: 401 is the keys, 403 is the app's
permission level (Read only) or a duplicate post X rejected, 429 is the
monthly cap. *Skipped* means a post missed its window — a calendar countdown
after the release, a brief on a day the file never updated.

The status strip at the top shows the last tick, last post, today's count,
and the last error. **A last tick older than twenty minutes means the
function is not running**, not that there was nothing to post.

## What it deliberately does not do

- It never reads X. Replies, mentions and metrics are not fetched. Traffic
  from X shows up in analytics under `utm_source=x`.
- It never invents a figure. A draft that mentions a number absent from the
  source is rejected before it is stored. If the model cannot write the post
  without one, the post fails and says why.
- It never posts a stale brief. The brief thread requires `sessionDate` to be
  today (UTC) and `goodUntil` to be in the future.
- It never posts when `enabled` is off, including from *Run now*.
