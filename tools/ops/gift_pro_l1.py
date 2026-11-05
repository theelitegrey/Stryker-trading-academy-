#!/usr/bin/env python3
"""Owner 06 Nov: "Move 16 members to pro for a month so they dont loose access" (L1 order-flow tools become Pro-only L2).
Targets: students with a signed market-data agreement (v1, nonProfessional) who do NOT have active Pro, not demo, not admin.
Patch (only those fields, updateMask): plan Pro, planId, subscriptionStatus active, paidThroughMillis now+31d (never shortens),
planSource 'gift', giftNote. No billing fields touched, so nothing renews or charges; Pro ends by itself after 31 days.
Aborts if the target count is over 25 (expected 16). Prints counts only, no names or emails."""
import json, os, sys, time, urllib.request, urllib.error
T = open(os.environ['FB_TOKEN_FILE']).read().strip()
P = 'strykertrades-e0cd8'
B = f'https://firestore.googleapis.com/v1/projects/{P}/databases/(default)/documents'
H = {'Authorization': 'Bearer ' + T, 'Content-Type': 'application/json', 'x-goog-user-project': P}
GRACE, DAY = 3 * 86400000, 86400000
APPLY = 'apply' in (os.environ.get('OPS_ARG') or '') or '--apply' in sys.argv


def call(method, url, body=None):
    r = urllib.request.Request(url, json.dumps(body).encode() if body is not None else None, H, method=method)
    try: return json.load(urllib.request.urlopen(r))
    except urllib.error.HTTPError as e: sys.exit('HTTP %s %s' % (e.code, e.read().decode()[:300]))


def v(x):
    if not x: return None
    for k in ('stringValue', 'booleanValue', 'integerValue', 'doubleValue', 'timestampValue'):
        if k in x: return x[k]
    return x


def listall(coll):
    out, tok = [], ''
    while True:
        j = call('GET', B + f'/{coll}?pageSize=300' + ('&pageToken=' + tok if tok else ''))
        out += j.get('documents', []); tok = j.get('nextPageToken')
        if not tok: return out


paid = set()
for d in listall('plans'):
    f = d.get('fields', {})
    if float(v(f.get('price')) or v(f.get('priceUsd')) or v(f.get('amount')) or 0) > 0:
        paid.add(d['name'].split('/')[-1].lower())
        if v(f.get('name')): paid.add(str(v(f.get('name'))).lower())
if not paid: paid = {'pro', 'elite'}
admins = {d['name'].split('/')[-1] for d in listall('admins')}

now = int(time.time() * 1000)
targets = []
for d in listall('students'):
    f = d.get('fields', {}); uid = d['name'].split('/')[-1]
    if v(f.get('demo')) is True or uid in admins: continue
    m = (f.get('marketDataAgreement') or {}).get('mapValue', {}).get('fields', {})
    if not (v(m.get('version')) == 'v1' and v(m.get('nonProfessional')) is True): continue
    plan = str(v(f.get('plan')) or '').lower(); st = v(f.get('subscriptionStatus'))
    pt = int(float(v(f.get('paidThroughMillis')) or 0))
    pro = plan in paid and st not in ('expired', 'cancelled', 'canceled') and (v(f.get('foundingMember')) is True or not (pt > 0 and now > pt + GRACE))
    if pro: continue
    targets.append((d['name'], pt))
print(json.dumps({'admins_skipped': len(admins), 'targets': len(targets), 'apply': APPLY}))
if len(targets) > 25: sys.exit('ABORT: more targets than expected')
if not APPLY: sys.exit(0)

ok = 0
end = now + 31 * DAY
for name, pt in targets:
    fields = {'plan': {'stringValue': 'Pro'}, 'planId': {'stringValue': 'Sj1bjdpwvYJUVErjNMAb'},
              'subscriptionStatus': {'stringValue': 'active'}, 'paidThroughMillis': {'integerValue': str(max(end, pt))},
              'planSource': {'stringValue': 'gift'},
              'giftNote': {'stringValue': 'Free Pro month: order-flow tools moved to Pro (06 Nov 2026)'}}
    mask = '&'.join('updateMask.fieldPaths=' + k for k in fields)
    call('PATCH', f'https://firestore.googleapis.com/v1/{name}?{mask}', {'fields': fields})
    ok += 1
# verify
again = 0
for name, _ in targets:
    f = call('GET', f'https://firestore.googleapis.com/v1/{name}').get('fields', {})
    again += v(f.get('plan')) == 'Pro' and v(f.get('planSource')) == 'gift' and int(v(f.get('paidThroughMillis')) or 0) >= end
print(json.dumps({'granted': ok, 'verified': again, 'pro_until_utc': time.strftime('%Y-%m-%d %H:%M', time.gmtime(end / 1000))}))
