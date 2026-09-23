# Launch sale: merge-time checklist

Run ONLY after the website manager + chief-of-staff (+ Owner where required)
approve the merge. Every step has its own rollback. Stop at the first failure.
Record SHAs, times and outputs in the merge report.

Pre-flight (all must be true):
- [ ] hermes/dev-launch-sale reviewed and approved; content-developer APPROVED
      reports/launch-sale-copy.md.
- [ ] `node tools/launch-sale/paytest.js` → `ALL PASSED` on the exact commit to be merged.
- [ ] `python3 tools/check.py` green on that commit.
- [ ] Nobody else is merging (one merge at a time; announce "merging <SHA>, build N").
- [ ] A Firestore backup/export exists from today (see the audit's P1-1; if
      there are still no scheduled backups, take a manual export first).

------------------------------------------------------------------------------
## 1. Functions deploy (BY NAME, from the merged commit, never a working tree)

The functions are deployed from a clean tree of the MERGED commit, so what
runs is exactly what was reviewed:

```bash
SHA=<merged main commit>
rm -rf /tmp/fn-$SHA && mkdir -p /tmp/fn-$SHA/functions
git -C /root/projects/stryker-trading-academy archive "$SHA" functions-src | tar -x -C /tmp/fn-$SHA
mv /tmp/fn-$SHA/functions-src/* /tmp/fn-$SHA/functions/ && rmdir /tmp/fn-$SHA/functions-src
cp <deploy machine>/functions/.env /tmp/fn-$SHA/functions/.env && chmod 600 /tmp/fn-$SHA/functions/.env
printf '{"functions":{"source":"functions"}}\n' > /tmp/fn-$SHA/firebase.json
cd /tmp/fn-$SHA/functions && npm ci && cd ..
```

Deploy in three groups and check the logs after each one (`firebase functions:log --only NAME`):

```bash
# 1a. the counter (new function, touches nothing that exists)
firebase deploy --project strykertrades-e0cd8 --only functions:launchSaleOnOrder

# 1b. one-time payments (razorpay.js)
firebase deploy --project strykertrades-e0cd8 --only functions:razorpayCreateOrder,functions:razorpayVerifyPayment

# 1c. subscriptions (razorpaySubs.js). The webhook + cancel share the module;
#     their code is unchanged, but redeploying them keeps the file consistent.
firebase deploy --project strykertrades-e0cd8 --only functions:razorpaySubscribe,functions:razorpaySubsVerify,functions:razorpayWebhook,functions:razorpaySubsCancel
```

Exact exported names touched: `launchSaleOnOrder` (new), `razorpayCreateOrder`,
`razorpayVerifyPayment`, `razorpaySubscribe`, `razorpaySubsVerify`,
`razorpayWebhook`, `razorpaySubsCancel`. NEVER a bare `--only functions`.

Safe before step 3: with no `priceInr` on any plan and no
`launchSaleConfig/main`, the new code charges exactly what the old code did
(paytest "Old plan … unchanged" rows), the lock lookup finds nothing, and
the counter returns early.

Rollback 1: rebuild the same tree from the PREVIOUS main SHA with the same
commands, and redeploy the same names. For `launchSaleOnOrder` only:
`firebase functions:delete launchSaleOnOrder --project strykertrades-e0cd8`
(it is new, so deleting it removes nothing that existed before).

------------------------------------------------------------------------------
## 2. Rules (optional hardening, see RULES.md)

The live rules already allow everything the sale needs (settings/commerce is
public) and deny the new collections by default. If approved, paste only the
three `match` lines from RULES.md and run the playground checks there.

Rollback 2: republish the rules backup taken first (or use console history).

------------------------------------------------------------------------------
## 3. Plan records: `tools/launch-sale/apply.py`

```bash
python3 tools/launch-sale/apply.py            # dry run: writes a backup, prints the diff
# read the diff: Pro 49/19, Rs 2499/699; Elite 129/49, Rs 5999/1999;
# proYearly (new, hidden) 490/149, Rs 24990/5499; config startAt = now
python3 tools/launch-sale/apply.py --apply    # writes with updateTime preconditions
```

It prints the backup path. Keep it in the merge report.
Check afterwards: `python3 tools/launch-sale/watch_count.py --dry-run` →
"0 of 100 launch spots taken" only after the first order fires the counter;
before that it may say the launchSale field is missing (apply.py writes
`taken: 0`, so it should read 0).

Rollback 3: `python3 tools/launch-sale/apply.py --rollback <backup.json>`
restores Pro/Elite, settings/commerce and launchSaleConfig/main, and deletes
the created docs (plans/proYearly, launchSaleConfig/main). The banner hides
itself as soon as `settings/commerce.launchSale` is gone or `active` is false.
Fastest kill switch without a rollback: set `settings/commerce.launchSale.active
= false` in the console. The banner and strip vanish on the next page load, and
prices stay whatever the plan records say.

------------------------------------------------------------------------------
## 4. Site merge (build bump, the normal procedure)

Branch → rebase on origin/main → bump build → `python3 tools/check.py` →
ff-merge → push → Deploy workflow green → live `assets/version.json` == N.

Rollback 4: `git revert` the merge commit on main, bump the build, push
(the Deploy workflow ships it), or `wrangler pages deployment` rollback in
Cloudflare. The plan records from step 3 can stay: the old site renders
`salePrice` as a normal sale.

------------------------------------------------------------------------------
## 5. Live checks (signed-out + one test account, NO real charges)

- [ ] strykertrading.com/#pricing in USD: Pro $19 (was $49) 61% OFF, MOST POPULAR,
      "or $149/year"; Elite $49 (was $129) 62% OFF; banner "up to 62% OFF · 100 spots left".
- [ ] Same page with the ₹ switch: Pro ₹699 (was ₹2,499) 72% OFF, "or ₹5,499/year";
      Elite ₹1,999 (was ₹5,999) 67% OFF; banner "up to 72% OFF".
- [ ] Slim strip on /learn, /features, /about at 390 and 1440.
- [ ] Checkout Pro monthly with the Owner test account + a TEST* coupon in Razorpay
      TEST mode only: amount shown equals the amount on the Razorpay modal.
- [ ] `firebase functions:log --only launchSaleOnOrder` shows the recount;
      the TEST* order is NOT counted (taken stays 0).
- [ ] No console errors on /, /checkout, /learn.
- [ ] Schedule `tools/launch-sale/watch_count.py` (website manager's cron).

If any check fails: kill switch (step 3), then roll back in reverse order 4 → 3 → 1.
