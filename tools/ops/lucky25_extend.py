#!/usr/bin/env python3
"""LUCKY25 fix (Owner 11-03: "Yes 23 people get 6 months").
Members who redeemed LUCKY25 before the coupon was switched to 6 months got only 1 month.
For every LUCKY25 redemption: target = redeemedAt + 6 calendar months (end of that day, UTC).
Only EXTENDS: if the member's current paidThroughMillis is already >= target, or the member
has a paid Stripe/Razorpay subscription, or the plan is permanent (no paidThroughMillis), skip.
Usage: FB_TOKEN_FILE=... python3 tools/ops/lucky25_extend.py [--apply]
Prints only short uid prefixes and dates (no emails/names).
"""
import json, os, sys, urllib.request, datetime, calendar

APPLY = '--apply' in sys.argv
T = open(os.environ['FB_TOKEN_FILE']).read().strip()
B = 'https://firestore.googleapis.com/v1/projects/strykertrades-e0cd8/databases/(default)/documents'


def req(url, data=None, method=None):
    r = urllib.request.Request(url, data=json.dumps(data).encode() if data is not None else None, method=method,
                               headers={'Authorization': 'Bearer ' + T, 'Content-Type': 'application/json'})
    return json.load(urllib.request.urlopen(r))


def num(v):
    if not v: return None
    return int(v.get('integerValue', v.get('doubleValue', 0)) or 0) or None


def add_months(dt, m):
    y, mo = dt.year + (dt.month - 1 + m) // 12, (dt.month - 1 + m) % 12 + 1
    d = min(dt.day, calendar.monthrange(y, mo)[1])
    return dt.replace(year=y, month=mo, day=d, hour=23, minute=59, second=59, microsecond=0)


q = {'structuredQuery': {'from': [{'collectionId': 'couponRedemptions'}]}}
rows = [x['document'] for x in req(B + ':runQuery', q) if 'document' in x]
rows = [d for d in rows if d['name'].split('/')[-1].upper().startswith('LUCKY25__')]
print('LUCKY25 redemptions:', len(rows))
done = skip = 0
for d in rows:
    f = d['fields']
    uid = d['name'].split('__', 1)[1]
    red = f.get('redeemedAt', {}).get('timestampValue')
    if not red:
        print(uid[:6], 'SKIP no redeemedAt'); skip += 1; continue
    rdt = datetime.datetime.fromisoformat(red.replace('Z', '+00:00'))
    target = add_months(rdt, 6)
    tms = int(target.timestamp() * 1000)
    s = req(B + '/students/' + uid).get('fields', {})
    cur = num(s.get('paidThroughMillis'))
    plan = (s.get('plan') or {}).get('stringValue')
    paid = any(k in s for k in ('stripeSubscriptionId', 'razorpaySubscriptionId')) and (s.get('subscriptionStatus') or {}).get('stringValue') in ('active', 'trialing')
    curd = datetime.datetime.utcfromtimestamp(cur / 1000).date() if cur else None
    tag = '%s red %s plan %s now %s -> %s' % (uid[:6], rdt.date(), plan, curd, target.date())
    if paid: print(tag, 'SKIP paid subscription'); skip += 1; continue
    if cur is None: print(tag, 'SKIP no expiry (permanent or none)'); skip += 1; continue
    if cur >= tms - 86400000: print(tag, 'SKIP already >= 6 months'); skip += 1; continue
    print(tag, 'EXTEND' + ('' if APPLY else ' (dry run)'))
    if APPLY:
        patch = {'fields': {'paidThroughMillis': {'integerValue': str(tms)}, 'lucky25ExtendedAt': {'timestampValue': datetime.datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')}}}
        req(B + '/students/' + uid + '?updateMask.fieldPaths=paidThroughMillis&updateMask.fieldPaths=lucky25ExtendedAt', patch, 'PATCH')
        rp = {'fields': {'paidThroughMillis': {'integerValue': str(tms)}, 'accessMonths': {'integerValue': '6'}}}
        req(B + '/' + d['name'].split('/documents/')[1] + '?updateMask.fieldPaths=paidThroughMillis&updateMask.fieldPaths=accessMonths', rp, 'PATCH')
    done += 1
print('EXTEND' if APPLY else 'WOULD EXTEND', done, 'SKIP', skip)
