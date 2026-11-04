#!/usr/bin/env python3
"""Mark one member's email as verified (Owner: support fix; member received the mail but the link host was unreachable).
The email comes from the secret env OPS_ARG (never printed; public repo). Prints only a uid prefix.
Usage: FB_TOKEN_FILE=... OPS_ARG=<email> python3 tools/ops/verify_email.py [--apply]
"""
import json, os, sys, urllib.request, urllib.error

APPLY = '--apply' in sys.argv
T = open(os.environ['FB_TOKEN_FILE']).read().strip()
EM = os.environ.get('OPS_ARG', '').strip()
P = 'strykertrades-e0cd8'
B = f'https://identitytoolkit.googleapis.com/v1/projects/{P}'
if '@' not in EM: sys.exit('no email in OPS_ARG')


def req(path, data):
    r = urllib.request.Request(B + path, json.dumps(data).encode(), {'Authorization': 'Bearer ' + T, 'Content-Type': 'application/json', 'x-goog-user-project': P})
    try: return json.load(urllib.request.urlopen(r))
    except urllib.error.HTTPError as e: sys.exit('HTTP %s %s' % (e.code, e.read().decode()[:300]))


us = req('/accounts:lookup', {'email': [EM]}).get('users', [])
print('accounts found:', len(us))
for u in us:
    print('uid', u['localId'][:6] + '…', 'verified', u.get('emailVerified', False), 'disabled', u.get('disabled', False))
    if APPLY and not u.get('emailVerified'):
        out = req('/accounts:update', {'localId': u['localId'], 'emailVerified': True})
        print('VERIFIED', out.get('localId', '')[:6] + '…', out.get('emailVerified'))
