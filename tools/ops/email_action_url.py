#!/usr/bin/env python3
"""Email action links (verify email, reset password) -> https://tradezoro.com/__/auth/action instead of
strykertrades-e0cd8.firebaseapp.com (some mobile networks refuse firebaseapp.com: ERR_CONNECTION_REFUSED).
tradezoro.com proxies /__/auth/* to firebaseapp.com (functions/_auth-proxy.js).
Usage: FB_TOKEN_FILE=... python3 tools/ops/email_action_url.py [--apply]
"""
import json, os, sys, urllib.request

APPLY = '--apply' in sys.argv
T = open(os.environ['FB_TOKEN_FILE']).read().strip()
P = 'strykertrades-e0cd8'
U = f'https://identitytoolkit.googleapis.com/admin/v2/projects/{P}/config'
NEW = 'https://tradezoro.com/__/auth/action'


def req(url, data=None, method=None):
    r = urllib.request.Request(url, data=json.dumps(data).encode() if data is not None else None, method=method,
                               headers={'Authorization': 'Bearer ' + T, 'Content-Type': 'application/json', 'x-goog-user-project': P})
    return json.load(urllib.request.urlopen(r))


c = req(U)
se = (c.get('notification') or {}).get('sendEmail') or {}
print('BEFORE callbackUri:', se.get('callbackUri'))
print('authorizedDomains:', c.get('authorizedDomains'))
print('anonymous sign-in enabled:', ((c.get('signIn') or {}).get('anonymous') or {}).get('enabled'))
if 'tradezoro.com' not in (c.get('authorizedDomains') or []): sys.exit('tradezoro.com is not an authorized domain; not changing')
if APPLY:
    out = req(U + '?updateMask=notification.sendEmail.callbackUri', {'notification': {'sendEmail': {'callbackUri': NEW}}}, 'PATCH')
    print('AFTER callbackUri:', out['notification']['sendEmail'].get('callbackUri'))
else:
    print('DRY would set', NEW)
