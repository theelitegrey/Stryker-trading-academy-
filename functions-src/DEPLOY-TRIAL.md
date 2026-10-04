# 7-day free trial: deploy steps

Owner order 2026-10-05: 7-day free trial of Pro, card (or UPI AutoPay / card
mandate in India) required at signup, converts to paid on day 8 unless
cancelled.

The site UI is already live, but it stays hidden until the switch
`settings/commerce.trialEnabled` is set to `true`. With the switch off, every
member sees the same checkout as before. Even with it on, nobody sees a trial
until the functions below are deployed, because the client shows the trial
only when the `trialEligibility` callable says yes, and treats any error as "no
trial".

Do these steps in order, from the deploy machine (the one that holds
`functions/.env`). Never deploy from the team server: it has no `.env`.

## 0. Prerequisites (already in place for Stripe and Razorpay)

`functions/.env` already holds STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET. No new
secrets or environment variables are needed, and there are no new npm
dependencies.

If the Stripe key is a RESTRICTED key (rk_...), it now also needs:
- Payment Methods: Read (to read the card fingerprint for the one-trial-per-card rule)
- Customers: Write (already needed; used to stamp `metadata.trialUsedAt`)
- Subscriptions: Write (already needed; used to cancel a refused trial)

## 1. Copy the code

Pull `main` (or the branch `hermes/t5-trial`) and copy these files into the
functions folder:

    functions-src/trial.js          (new)
    functions-src/stripe.js
    functions-src/razorpaySubs.js
    functions-src/subscriptions.js
    functions-src/index.js          (one new line: Object.assign(exports, require('./trial')))

## 2. Deploy, naming every function

Name every function. A bare `--only functions` deletes all the others.

    firebase deploy --only functions:trialEligibility,functions:stripeCreateCheckout,functions:stripeWebhook,functions:stripePortal,functions:stripeStatus,functions:razorpaySubscribe,functions:razorpaySubsVerify,functions:razorpayWebhook,functions:razorpaySubsCancel,functions:subscriptionSweep

`trialEligibility` is the only new function. The other nine are redeployed
with the trial code.

## 3. Stripe dashboard (Developers > Webhooks > the stripeWebhook endpoint)

Add this event to the endpoint, and keep the existing ones:

- `customer.subscription.trial_will_end` (new): sent 3 days before the trial ends, and turned into an in-app reminder.

These must already be enabled. Check that they are:
`checkout.session.completed`, `checkout.session.async_payment_succeeded`,
`invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`,
`customer.subscription.deleted`.

Optional: in Settings > Billing > Subscriptions and emails, turn on "Send a
reminder email 7 days before a free trial ends". Stripe sends it.

Billing Portal: cancelling must be allowed (it already is for paid members).
A cancel during the trial is "cancel at period end". There is no charge, and
access ends at the trial end.

## 4. Razorpay dashboard (Settings > Webhooks > the razorpayWebhook URL)

Add this event, and keep the existing ones:

- `subscription.authenticated` (new): a backstop that starts the trial if the member's browser never returns from the Razorpay checkout.

These must already be enabled. Check that they are:
`subscription.charged`, `subscription.halted`, `subscription.cancelled`,
`subscription.paused` (and `subscription.completed` / `subscription.expired` if
listed).

How the INR trial works (Razorpay docs, "How Subscriptions Work" and "Create a
Subscription"):
- The subscription is created with `start_at = now + 7 days`.
- For a future start date with no upfront amount, Razorpay takes only an authentication transaction. Its docs table shows Rs 5 for cards, refunded automatically, with no invoice. The first real debit is on `start_at`.
- `expire_by` is set to now + 2 hours, so a mandate that is never authorised cannot linger.

To verify on the live account before switching on, in Razorpay TEST mode:
(a) a card mandate with a future `start_at` is accepted, and
(b) UPI AutoPay with a future `start_at` is accepted.

If UPI AutoPay refuses a future `start_at` on this account, the trial still
works on card mandates. In that case tell the engineers, and we will restrict
the INR trial to card (the code does not need to change for card).

## 5. Firestore rules (console; the repo copy is reference only)

Add these four fields to the three privileged-field lists on `students`
(`privilegedKeys`, `touchesPrivileged`, `createsPrivileged`). The reference
copy `functions-src/firestore.rules` already has them:

    'trialUsedAt', 'trialEndsAt', 'trialProvider', 'trialCancelledAt'

This is defence in depth: the real once-per-account lock is the
functions-only collection `trialClaims`, which default-deny already covers, as
it does `trialFingerprints`. No other rule change is needed.

## 6. Test in Stripe test mode first (optional but recommended)

Use a QA account (stryker-qa-...@example.com) with the TEST key:
1. Set `settings/commerce.trialEnabled = true`.
2. Open checkout for Pro. You should see "Start 7-day free trial" and the small print.
3. Pay with card 4242. The webhook grants Pro until the trial end, Settings shows "Free trial: 7 days left", and Orders shows a $0 order with kind trial.
4. Use a Stripe test clock to advance 4 days. `trial_will_end` fires and the reminder appears in notifications.
5. Advance past the trial end. `invoice.paid` fires for $39, there is a $39 order, and the member gets a "trial has ended, subscription active" notice.
6. Run it again with a new QA account and the same card. The trial is refused, the subscription is cancelled, and the member is told they can still subscribe.

## 7. Switch on

In the Firestore console, set `settings/commerce.trialEnabled` to `true`.
Members who are eligible see the trial right away. No site deploy is needed.

## Rollback

- Fastest: set `settings/commerce.trialEnabled` to `false`. Within a page load, no new trials are offered and the server refuses any trial request. Trials already running carry on: they convert or end exactly as their gateway says.
- Code: redeploy the previous versions of the nine functions with the same command, from the commit before the trial (the parent of the trial commit on main). Running trials then convert as normal subscriptions. The Stripe/Razorpay "authenticated" handling for new trials is gone, but no new trials can start while the switch is off.
- The client UI needs no rollback: with the switch off, it shows nothing.

## What a member sees

- Checkout, pricing cards and the upgrade modal, for an eligible signed-in member: "Start 7-day free trial", and right under it: "Card required. You won't be charged until <date>. Then $39/month (or Rs <live rate>/month). Cancel anytime before <date> in Billing."
- Dashboard: a strip with "Free trial: N days left", the first charge date, and a cancel/manage link.
- Settings > Plan: the same line, plus "Cancel free trial or manage card" (Stripe portal) or "Cancel free trial" (Razorpay, which cancels immediately with no charge).
- Notifications: the trial reminder (3 days before the end, from Stripe's event or the daily sweep for Razorpay), a "trial ended, subscription active" notice, or "couldn't charge your card" if the day-8 charge fails.

## Eligibility (server only; trial.js)

A member can start a trial only when all of these are true:
- The switch is on.
- The plan renews and costs money.
- The account has no `trialUsedAt`, no `trialClaims` doc, no Stripe or Razorpay subscription ever, no current paid period, no paid order ever, and is not a founding member.

At grant time the card fingerprint (Stripe), or the UPI handle / Razorpay
customer / token (Razorpay), is claimed in `trialFingerprints`. If another
account has already used it, the subscription is cancelled before anything is
granted or charged. A trial can't be combined with a coupon.
