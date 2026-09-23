# Cloud Functions: what's deployed, and how to roll back

Project `strykertrades-e0cd8`, region `us-central1`. This directory holds the
source for all 35 live functions. `index.js` loads every module and
`package.json` pins Node 22. The site deploy excludes `functions-src/`, so
none of it is published to the website.

## Deploying

Use a folder whose `firebase.json` has `"functions": {"source": "functions"}`.
Copy this directory into `functions/`, and put the secrets listed below in
`functions/.env`.

```bash
cd functions && npm ci && cd ..
firebase deploy --only functions:NAME1,functions:NAME2
```

Always deploy by name, a few at a time, and check the logs after each group.
This tree holds all 35 functions, so a bare `--only functions` no longer
deletes anything, but it redeploys every function at once.

## What's live (hardening of 2026-09-22)

- Every function has a `maxInstances` cap. A budget alert only sends an email;
  the caps are what actually limit spend.
- Node 22 everywhere once the payment group ships; Node 20 is retired on
  2026-10-30.
- `replayBars` requires a signed-in user: no ID token means 401.
- No function changed generation, so no URL or trigger moved.

| Cap | Functions | Why |
|---|---|---|
| 1 | refreshFxRate, refreshWorldData, marketBots, mirrorTweets, brokerSyncSweep, xAutopostTick, subscriptionSweep* | Scheduled jobs: one run at a time |
| 2 | xAutopostAdmin, xAutopostOnChapter, xAutopostOnModel, xAutopostOnIndicator, xAutopostOnSession, deleteUserAccount* | Admin-only or admin-triggered |
| 3 | onContactMessageCreated | Public form fan-out (the code also throttles per hour) |
| 5 | replayBars, tvValidateUsername, tvGrantAccess, tvRevokeAccess, brokerConnect, brokerSyncNow, brokerDisconnect | Signed-in or admin calls; replayBars fans out to Yahoo |
| 10 | getNewswire, getWorldEvents, getIntel, getTwitterFeed, brokerCatalog, onReferralWritten*, razorpaySubsCancel* | Public reads served from cache; light calls |
| 20 | redeemFreeCheckout*, onNotificationCreated | Checkout; push fan-out after bulk notifications |
| 30 | razorpayCreateOrder*, razorpayVerifyPayment*, razorpaySubscribe*, razorpaySubsVerify*, razorpayWebhook* | Payments: far above real traffic, so no buyer is ever throttled |

\* **The payment group is in this source but NOT yet deployed.** It waits for
the Owner's OK, and until then it runs its previous code with no cap. Deploy
it last, after a test purchase:

```bash
firebase deploy --only functions:subscriptionSweep,functions:deleteUserAccount,functions:onReferralWritten
firebase deploy --only functions:redeemFreeCheckout
firebase deploy --only functions:razorpayCreateOrder,functions:razorpayVerifyPayment
firebase deploy --only functions:razorpaySubscribe,functions:razorpaySubsVerify,functions:razorpayWebhook,functions:razorpaySubsCancel
```

## Rolling back

- **A cap is throttling real users.** Raise or delete that function's
  `maxInstances`, then redeploy it by name.
- **The code itself is broken.** Tag `functions-pre-hardening` has every
  module as it was before the caps and replayBars auth. It does not include
  `index.js`, `package.json` or `accountAdmin.js`, which came into the repo
  after it. Copy the old module back and redeploy that function by name:
  `git show functions-pre-hardening:functions-src/FILE.js > FILE.js`
- **The fastest rollback, for 2nd Gen functions** (getTwitterFeed,
  onContactMessageCreated, onNotificationCreated, onReferralWritten and the
  four xAutopostOn* triggers): in the console, open Cloud Run, then the
  service, then Revisions, and send 100% of traffic to the previous revision.
- **Don't roll back to Node 20**, because it is being retired. Fix forward
  on 22.
- **If a deploy hangs, cancel it and rerun it for that one name.** Don't
  delete the function: that drops its trigger or changes its URL.

## Budget alert

"Stryker monthly INR 500 alert", on billing account `019C89-1DB83D-8B4CCC`.
It covers this project at INR 500 a month, and emails the billing admins at
50%, 90% and 100% of actual spend. It only notifies; it never stops spending.

## Secrets

These live only in `functions/.env` on the deploy machine. Never put them in
the repo, a chat, or Firestore.

```
RAZORPAY_KEY_ID  RAZORPAY_KEY_SECRET  RAZORPAY_WEBHOOK_SECRET  RAZORPAY_CURRENCY
TV_USERNAME      TV_PASSWORD          TV_SESSIONID             BROKER_SYNC_SECRET
```

`TWITTERAPI_KEY`, the four X keys and `ANTHROPIC_API_KEY` are in Secret
Manager. `BROKER_SYNC_SECRET` can't be regenerated, because it encrypts every
stored broker credential. If it's lost, every broker has to be reconnected by
hand.

## Firestore rules

`firestore.rules` here is a reference draft, not necessarily the live rules.
It is unchanged by this work. For the publish checklist and the curl check
for signed-out access, see this file as it was before 2026-09-22 (in git
history).

## Welcome email series (built, NOT deployed)

`welcomeEmails.js` + `emailTemplates.js`: `welcomeEmailTick` (hourly) and
`emailUnsubscribe` (public link). Deploy only after all of these hold:
1. Resend account, `send.strykertrading.com` verified, secret
   `RESEND_API_KEY` in Secret Manager (the Owner does this; nobody pastes the key anywhere else).
2. Final copy in `emailTemplates.js` (no `[COPY PENDING]` left; the tick
   refuses to send while any placeholder remains).
3. `emailSeriesConfig/welcome` written: `enabled`, `testOnly: true` +
   `testRecipients` for the first run, `launchAt`, `postalAddress`, `offerPlanId`.
4. Privacy Policy line added.

    firebase deploy --only functions:welcomeEmailTick,functions:emailUnsubscribe

Preview without sending: `node tools/preview-emails.js` then open
`tools/email-previews/day*.html`.
