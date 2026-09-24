# Launch sale: Firestore rules (targeted snippet, NOT published)

Checked against the LIVE ruleset on 2026-09-23 (release cloud.firestore ->
ruleset 29606cf9, published 2026-09-23 16:20Z), read-only via the Rules API.

## What the launch sale needs, and what live already does

| Path | Needed | Live today | Change needed |
|---|---|---|---|
| settings/commerce (incl. `launchSale {active, limit, taken}`) | public READ (banner + strip are shown signed-out); admin write | `allow read: if doc in ['site','logo','favicon','commerce'] \|\| signedIn(); allow write: if isAdmin();` | **none** |
| foundingPrices/{uid} | closed to clients (functions only, Admin SDK bypasses rules) | not named, so the catch-all `match /{document=**} { allow read, write: if false; }` denies | **none** (optional explicit block below) |
| launchSaleConfig/{doc} (`main`, `members`) | closed to clients | default-deny | **none** (optional explicit block) |
| launchSaleAlerts/{mark} | closed to clients | default-deny | **none** (optional explicit block) |
| plans/{id} (incl. hidden `proYearly`, `priceInr`) | public read, admin write | `allow read: if true; allow write: if isAdmin();` | **none** |
| orders/{id} (the counter reads it with the Admin SDK) | unchanged | client write false | **none** |

Conclusion: the launch sale works under the live rules as they stand. The
snippet below is OPTIONAL. It only makes the intent explicit, so a later
edit to the catch-all can't silently open these collections.

## Optional snippet (paste ABOVE the final catch-all, inside `match /databases/{database}/documents`)

```
    // Launch sale (functions-src/launchSale.js). Written only by Cloud
    // Functions with the Admin SDK, which bypasses rules. Clients get nothing:
    // a student must never read another member's locked price, and must never
    // write their own.
    match /foundingPrices/{uid}      { allow read, write: if false; }
    match /launchSaleConfig/{doc}    { allow read, write: if false; }
    match /launchSaleAlerts/{mark}   { allow read: if isAdmin(); allow write: if false; }
```

(Admins may read the alerts for a future admin panel; nothing reads them
client-side today, so `if false` for read is equally fine.)

## How to apply (at merge time, only on approval)

1. Firebase console → Firestore → Rules. Copy the CURRENT rules into a file
   first (backup: `reports/rules-backup-<date>.rules`).
2. Paste ONLY the three `match` lines above, directly above
   `match /{document=**}`. Do not paste or publish a whole rules file from
   the repo: the repo copy (functions-src/firestore.rules) has drifted from
   live (see the 2026-09-23 audit).
3. Rules Playground, before Publish:
   - signed out, `get /settings/commerce` → ALLOW
   - signed-in student, `get /foundingPrices/<own uid>` → DENY
   - signed-in student, `create /foundingPrices/<own uid>` → DENY
   - signed-in student, `get /launchSaleConfig/main` → DENY
   - admin, `get /launchSaleAlerts/90` → ALLOW
4. Publish. Rollback: republish the backup from step 1 (console → Rules →
   history also has the previous version).
