# Stripe: test plan and go-live steps

Branch hermes/dev-stripe. Stripe is for every non-INR buyer; Razorpay (INR) is unchanged.

## A. Offline (no keys needed): done on the branch
- `node tools/stripe/stripetest.js`: 93 checks (pricing, founding lock, webhook grant, idempotency, renewal, failure, cancel, signature, livemode, portal, Razorpay no-op)
- `node tools/launch-sale/paytest.js`: the Razorpay INR paths, unchanged
- `python3 tools/rules-test.py functions-src/firestore.rules`: 81 cases

## B. Stripe TEST mode, automated (needs the TEST key in chief-of-staff/scripts/stripe.env)
- `node tools/stripe/live-test-mode.js /root/.hermes/profiles/chief-of-staff/scripts/stripe.env`
  - Real Checkout Session creation, then a test-clock subscription paid with 4242.
  - Renewal, locked price after the sale ends, payment_failed, cancel at period end, delete.
  - 3DS card: no grant until authenticated. Billing Portal session.
- It refuses anything that isn't a sk_test_/rk_test_ key.

## C. TEST mode on the deployed functions (after WM + chief-of-staff go; test key only)
1. functions/.env gets:
   - STRIPE_SECRET_KEY (test)
   - STRIPE_WEBHOOK_SECRET (from step 2)
   - SITE_ORIGIN=https://strykertrading.com
2. Create the webhook endpoint with the API:
   - URL: https://us-central1-strykertrades-e0cd8.cloudfunctions.net/stripeWebhook
   - Events: checkout.session.completed, checkout.session.async_payment_succeeded, invoice.paid, invoice.payment_failed, customer.subscription.updated, customer.subscription.deleted
   - Store the returned secret (whsec_…) in functions/.env. Never print it.
3. Customer Portal (test): allow payment-method update, invoice history, and cancel at period end. Don't allow plan switching.
4. Deploy by name:
   `firebase deploy --only functions:stripeCreateCheckout,functions:stripeWebhook,functions:stripePortal,functions:stripeStatus`
5. Publish the rules (stripe fields privileged). Back up the live ruleset first.
6. On a throwaway account, on the hosted page:
   - 4242 4242 4242 4242: success. The plan lands and the success state shows.
   - 4000 0025 0000 3155: 3DS challenge, then success.
   - 4000 0000 0000 0002: declined, and nothing is granted.
   - Settings > Manage billing opens the portal. Cancel there, and autopay goes off.
   - Delete the throwaway afterwards.
7. The client is only live after the site merge. Until then, test from a local server pointed at the deployed functions.

## D. LIVE (only after the test-mode review is signed off)
- Swap to the restricted LIVE key.
- Create the LIVE webhook endpoint and portal config, then redeploy the 4 functions by name.
- The webhook ignores events whose livemode doesn't match the key, so test and live can't cross.

## Rollback
- Site: revert the merge commit (INR/Razorpay code paths were not changed).
- Functions: `firebase functions:delete stripeCreateCheckout stripeWebhook stripePortal stripeStatus`. No other function changed.
- Rules: republish the backed-up ruleset.
