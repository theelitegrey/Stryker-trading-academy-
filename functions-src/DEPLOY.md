# Cloud Functions — deploy notes

The functions are deployed by hand from Cloud Shell, from
`~/twitter-feed-function/functions/`. This directory is the source of record;
copy a changed file across before deploying it.

`index.js` in that directory picks up each file with:

```js
Object.assign(exports, require('./<file>'));
```

so a NEW file needs a line adding there before it can deploy.

**Always name the functions you are deploying.** A bare `firebase deploy
--only functions` deletes anything that is not in the current source tree.

---

## Outstanding after the 2026-09 security work

These four steps finish the fixes that are already in the site build. Until
they are done, the site is running the client half of a change whose server
half does not exist yet.

### 1. Deploy the two new functions

Copy `freeCheckout.js` and `referralPoints.js` across, add both to
`index.js`, then:

```bash
firebase deploy --only functions:redeemFreeCheckout,functions:onReferralWritten
```

Until `redeemFreeCheckout` exists, a fully-discounted coupon checkout shows
"Checkout is being updated right now" and grants nothing. Until
`onReferralWritten` exists, referral points are recorded but not credited;
re-saving a referral row from the Referrals admin page fires the trigger and
credits it late.

### 2. Redeploy the hardened existing functions

```bash
firebase deploy --only functions:razorpayCreateOrder,functions:razorpayVerifyPayment
firebase deploy --only functions:razorpaySubscribe,functions:razorpaySubsVerify,functions:razorpayWebhook,functions:razorpaySubsCancel
firebase deploy --only functions:replayBars
firebase deploy --only functions:brokerConnect,functions:brokerSyncNow,functions:brokerDisconnect,functions:brokerCatalog
firebase deploy --only functions:onContactMessageCreated
firebase deploy --only functions:subscriptionSweep
```

### 3. Turn on the replayBars auth requirement

`replayBars.js` ships with `REQUIRE_AUTH = false` so that a tab still open on
an older build does not break the moment the function is deployed. Once the
site has been on build 284 or later for a day, set it to `true` and redeploy
that one function. After that, only signed-in users can spend the Yahoo quota.

### 4. Publish the Firestore rules

`firestore.rules` in this directory is a reference draft, not the live rules.
Paste it into the Firebase console (Firestore → Rules), test every collection
in the Rules Playground as signed out / student / admin, and publish.

Two lines in it matter more than all the rest:

- `admins/{uid}` must not be creatable by a client. Admin status on this site
  is "does this document exist", so a client that can create it can become an
  admin.
- `chapters` and `models` must require `request.auth != null`. They are
  world-readable today, which means the whole written curriculum can be
  downloaded with one unauthenticated request.

The rules are what actually close the plan-self-grant hole. The functions make
the correct path exist; the rules are what stop the browser taking the other
one.

---

## Node runtime

`engines.node` in `package.json` must be `"22"`. Node 20 is decommissioned on
2026-10-30, and a deploy onto a decommissioned runtime hangs for twenty
minutes and then fails. `replayBars` is already on 22; every other function
moves the next time it is deployed, which the steps above cover.

If a deploy hangs on "creating Node.js 20 function <name>", cancel it, then:

```bash
firebase functions:delete <name> --region us-central1 --force
firebase deploy --only functions:<name>
```

## Secrets

These live only in `functions/.env` on the deploy machine. They are not in
this repo, not in Firestore, and must never be pasted into a chat or a commit.

```
RAZORPAY_KEY_ID          RAZORPAY_KEY_SECRET       RAZORPAY_WEBHOOK_SECRET
TV_USERNAME              TV_PASSWORD               TV_SESSIONID
BROKER_SYNC_SECRET
```

`BROKER_SYNC_SECRET` is the one that cannot be regenerated: it derives the
AES-256-GCM key that every stored broker credential is encrypted with. Lose it
and every connected broker has to be reconnected by hand.

`TWITTERAPI_KEY` is the exception — it is already in Secret Manager via
`defineSecret`, which is where the rest should end up too.
