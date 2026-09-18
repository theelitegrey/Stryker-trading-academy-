# Getting started (no coding needed)

This takes about an hour of clicking, spread over a few days because Meta
and Google make you wait. You need: a credit card for the server, and to be
signed in to the academy's X, YouTube, Instagram, Facebook and Threads
accounts.

The order below is the order things become useful. You can stop after any
step and the platform posts to whatever is connected so far. **If you would
rather not touch any developer website, do Steps 1–2, then the Buffer section,
then Steps 6–7.**

---

## Step 1 — Rent the server (10 minutes)

1. Go to <https://www.hetzner.com/cloud> and create an account.
2. **Add Server**. Pick: location *Falkenstein* or *Helsinki* (cheapest),
   image **Ubuntu 24.04**, type **Shared vCPU → CX33** (4 vCPU, 8 GB, about
   €10 a month). Leave everything else as it is. Click **Create & Buy now**.
3. Hetzner emails you the server's IP address and root password.
4. On your computer open a terminal (Mac: *Terminal* app; Windows: *PowerShell*)
   and type, replacing the IP:

   ```
   ssh root@YOUR.SERVER.IP
   ```

   Type `yes` if asked, then the password from the email (nothing appears
   while you type it, that is normal). You are now "inside" the server.

5. Paste this one line and press Enter:

   ```
   curl -fsSL https://raw.githubusercontent.com/theelitegrey/Stryker-trading-academy-/main/automation/install.sh | sudo bash
   ```

   It runs for 10–20 minutes. At the end it prints something like:

   ```
   Open:      https://65.108.1.2.sslip.io
   User:      admin
   Password:  k3JfL9...
   ```

6. Open that address in your browser and sign in. That is the admin page.
   Bookmark it. **Posting is OFF** until you switch it on at the end.

If you prefer DigitalOcean: create a *Basic, Regular, 8 GB* droplet with
Ubuntu 24.04 and run the same line. Any provider works.

---

## Step 2 — Claude (5 minutes)

Claude writes the captions and video scripts.

1. Go to <https://console.anthropic.com>, sign up, add $10 of credit
   (Billing).
2. **API keys → Create key**, name it `stryker-social`, copy it.
3. On the admin page, under **Setup & connections → Claude**, paste it and
   press **Save keys**. Press **Test**: it should reply with a one-line
   sample post.

---

## The easy path: Buffer (do this instead of Steps 3–5)

Buffer is a $24-a-month service that already has approved connections to X,
Instagram, Threads and YouTube. You connect the four accounts inside Buffer
by signing in, paste one key here, and skip every developer site and every
review wait. Our server still makes the videos, cards and captions; Buffer
only does the posting.

1. Go to <https://buffer.com>, create an account, choose **Essentials**
   (billed per channel: 4 channels ≈ $24 a month; the free plan allows only
   3 channels and 10 queued posts each, which is too few).
2. In Buffer, **Channels → Connect channel** and sign in to each: **X**,
   **Instagram** (a Professional account; Buffer walks you through the
   Facebook Page link), **Threads**, **YouTube**. Four channels.
3. Buffer → your avatar → **Settings → API** (or
   <https://publish.buffer.com/settings/api>) → **Create API key**, copy it.
4. On the admin page under **Setup & connections → Buffer**, paste the key,
   **Save keys**, then **Test buffer**. It lists the four channels.
5. Under **Settings**, tick **Publish via Buffer** and leave the four
   "via Buffer" boxes ticked. **Save settings**.

That is it for platforms. Continue at Step 6 (voice) and Step 7 (switch on).
Buffer's API allows 7,500 requests a month on Essentials; this platform uses
roughly one per post per platform, about 400 a month at the default pacing.

Later, if you want to drop the $24, follow Steps 3–5 for a platform and untick
its "via Buffer" box; the rest keep going through Buffer.

---

## Step 3 — X (15 minutes)

*Skip this and Steps 4–5 if you use Buffer.*

1. Sign in to <https://developer.x.com> **with the academy's X account**.
   Choose the pay-per-use plan (there is no free plan any more).
2. **Projects & Apps → Create Project**, any name. Inside it, create an App.
3. Open the app → **Settings → User authentication settings → Set up**:
   - App permissions: **Read and write**
   - Type of App: **Web App, Automated App or Bot**
   - Callback URI: copy it from the admin page (it is shown under *X* in
     the Setup box, and looks like `https://…sslip.io/oauth/x/callback`)
   - Website URL: `https://strykertrading.com`
   - Save.
4. **Keys and tokens** → under *Consumer Keys*, press **Regenerate** and
   copy the **API Key** and **API Key Secret**.
5. On the admin page under **X**, paste both, **Save keys**, then press
   **Connect X**. X asks you to authorise the app; press *Authorize app*.
   You land back on the admin page with "X connected as @yourhandle".

If you already run the older X function from `tools/x-autopost.md`, turn it
off in `x-admin.html`, or both will post.

---

## Step 4 — YouTube (20 minutes, then a wait)

1. Go to <https://console.cloud.google.com> signed in with the Google account
   that owns the YouTube channel. Top bar → project picker → **New Project**,
   name `stryker-social`, Create, and select it.
2. Left menu **APIs & Services → Library**, search *YouTube Data API v3*,
   **Enable**.
3. **APIs & Services → OAuth consent screen** (Google may call it *Google
   Auth Platform*): **Get started**. App name `Stryker Social`, your email,
   audience **External**, contact email, agree, **Create**.
   Then **Audience → Test users → Add users**: the channel's Google account.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - Authorised redirect URIs → **Add URI**: copy it from the admin page
     (under *YouTube* in the Setup box, ends in `/oauth/youtube/callback`)
   - Create. Copy the **Client ID** and **Client secret**.
5. On the admin page under **YouTube**, paste both, **Save keys**, press
   **Connect YouTube**, choose the channel's account, tick the boxes, allow.
   Google shows a "this app isn't verified" warning because it is your own
   private app: click *Advanced → Go to Stryker Social*.
6. **The wait**: until Google audits the project, every upload is set to
   *private* automatically. Fill in the form at
   <https://support.google.com/youtube/contact/yt_api_form> once
   ("uploading our own educational Shorts to our own channel"). It takes one
   to three weeks. Meanwhile uploads still happen; you can make them public
   by hand in YouTube Studio, or just leave YouTube off in Settings until
   the audit passes.

---

## Step 5 — Instagram and Threads (30 minutes, then a wait)

Before you start: the academy's Instagram must be a **Professional**
account (Instagram app → Settings → Account type and tools → Switch to
professional, pick *Business*), and it must be **linked to a Facebook Page**
(same menu → Linked accounts → Facebook, create a Page if you have none).
Threads must be signed in with the same Instagram account.

1. Go to <https://developers.facebook.com>, sign in with the Facebook account
   that admins that Page. **My Apps → Create App**. Use case: **Other** →
   App type: **Business** → name `Stryker Social` → Create.
2. Left menu **App settings → Basic**: copy **App ID** and **App secret**
   (press *Show*). On the admin page under **Instagram**, paste them,
   **Save keys**.
3. Left menu **Add product** (or *Use cases → Customize*): add
   **Facebook Login for Business** and **Instagram**. Under *Facebook Login
   → Settings → Valid OAuth Redirect URIs*, paste the Instagram callback URL
   from the admin page (ends in `/oauth/instagram/callback`). Save.
4. Admin page → **Connect Instagram**. Facebook asks which Pages and
   Instagram accounts the app may use: pick the academy's. You return with
   "Instagram connected via Page …".
5. **Threads**: back in the Meta app, **Use cases → Add → Threads API** (or
   *Add product → Threads*). Open its **Settings**: copy the **Threads App
   ID** and **Threads App Secret** (they are different from the ones in step
   2), and add the Threads callback URL from the admin page under *Redirect
   Callback URLs*. Save.
   Then **Use cases → Threads API → Customize**: tick `threads_basic` and
   `threads_content_publish`.
   Then **App roles → Roles → Add people → Threads tester**: the academy's
   Threads username. Accept the invite in the Threads app (Settings →
   Account → Website permissions → Invites).
6. On the admin page under **Threads**, paste the Threads App ID and Secret,
   **Save keys**, **Connect Threads**, allow. "Threads connected."
7. **The wait**: the app is in *Development mode*, which is enough for the
   academy's own accounts. To be safe from Meta changing that, submit the
   app for review under **App review → Permissions and features**:
   `instagram_content_publish` and `threads_content_publish`. They ask for a
   short screen recording of the admin page posting; record one after your
   first successful post. One to two weeks.

---

## Step 6 — The voice (5 minutes, optional)

Out of the box the narrator is Kokoro's *am_michael* voice. For a cloned
brand voice, record 10–20 seconds of one person speaking clearly with no
music, save it as a WAV file, and upload it to the server:

```
scp stryker.wav root@YOUR.SERVER.IP:/opt/stryker/automation/voices/
```

Then on the admin page under **Voices**, type `stryker.wav` in the
Chatterbox field and **Save keys**. Press **Test chatterbox**.

Music: put royalty-free MP3s in `/opt/stryker/automation/data/music/` the
same way (`scp track.mp3 root@…:/opt/stryker/automation/data/music/`). None
means no music.

---

## Step 7 — Switch it on (2 minutes)

1. On the admin page press **Run now** once. Within a minute the *Scheduled*
   tab shows today's lesson video being drafted and rendered (a few minutes
   for the first one). Watch it in the player. Edit the text if you like.
2. Press **Posting is OFF — enable**. From now on it posts by itself.
   The first video waits 30 minutes after rendering so you can still hold it.
3. Check back the next morning: the *Posted* tab shows links to every post.

That is the whole setup. Later, to update the software when the repo
changes, run the install line from Step 1 again.

## When something goes wrong

- **"Last tick" in the status strip is older than 20 minutes**: the service
  is down. In the terminal: `cd /opt/stryker/automation && docker compose logs --tail=100 app`.
  Send me the output.
- **A post is red under "Needs attention"**: the error text says which
  platform and why. 401/403 from X means the keys; press *Connect X* again.
  *Retry* re-sends only the failed platform.
- **Lost the admin password**: `cat /opt/stryker/automation/.env` in the terminal.
