#!/usr/bin/env python3
"""Approve / list / revoke Rithmic review access (Stryker Charts "Connect broker").

    python3 /root/projects/stryker-notes/rithmic/rithmic-review-approve.py list
    python3 /root/projects/stryker-notes/rithmic/rithmic-review-approve.py approve <email-or-uid>
    python3 /root/projects/stryker-notes/rithmic/rithmic-review-approve.py approve-all-pending
    python3 /root/projects/stryker-notes/rithmic/rithmic-review-approve.py revoke <email-or-uid>

How it works: people who sign up on https://strykertrading.com/rithmic-review file
rithmicReview/{uid}. "approve" sets students/{uid}.rithmicBeta = true (a privileged field the
Firestore rules forbid members to write) and stamps approvedAt on the request. "revoke" sets it
false. The Charts page reads rithmicBeta on load, so no deploy is needed; the reviewer reloads.
Auth: the local firebase-tools login (admin). Prints no tokens or secrets.
"""
import json, sys, urllib.request, urllib.error, urllib.parse, datetime

P = 'strykertrades-e0cd8'
F = f'https://firestore.googleapis.com/v1/projects/{P}/databases/(default)/documents'


def token():
    import os
    if os.environ.get('FB_TOKEN_FILE'): return open(os.environ['FB_TOKEN_FILE']).read().strip()
    d = json.load(open('/root/.config/configstore/firebase-tools.json'))['tokens']
    # firebase-tools' public installed-app OAuth client (the same one the CLI uses).
    body = urllib.parse.urlencode({
        'grant_type': 'refresh_token', 'refresh_token': d['refresh_token'],
        'client_id': '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
        'client_secret': 'j9iVZfS8kkCEFUPaAeJV0sAi'}).encode()
    return json.load(urllib.request.urlopen('https://oauth2.googleapis.com/token', body))['access_token']


H = {}


def call(url, method='GET', body=None):
    rq = urllib.request.Request(url, json.dumps(body).encode() if body is not None else None,
                                dict(H, **{'Content-Type': 'application/json'}), method=method)
    try:
        r = urllib.request.urlopen(rq); t = r.read().decode(); return r.status, (json.loads(t) if t else {})
    except urllib.error.HTTPError as e:
        return e.code, {'error': e.read().decode()[:300]}


def requests():
    out, page = [], ''
    while True:
        c, r = call(f'{F}/rithmicReview?pageSize=300' + (f'&pageToken={page}' if page else ''))
        if c != 200: sys.exit(f'list failed: {c}')
        for d in r.get('documents', []):
            f = d.get('fields', {})
            out.append({'uid': d['name'].split('/')[-1], 'email': f.get('email', {}).get('stringValue', ''),
                        'name': f.get('name', {}).get('stringValue', ''),
                        'createdAt': f.get('createdAt', {}).get('timestampValue', ''),
                        'approvedAt': f.get('approvedAt', {}).get('timestampValue', '')})
        page = r.get('nextPageToken')
        if not page: return out


def beta(uid):
    c, r = call(f'{F}/students/{uid}?mask.fieldPaths=rithmicBeta')
    return c == 200 and r.get('fields', {}).get('rithmicBeta', {}).get('booleanValue') is True


def resolve(who):
    if '@' not in who: return who
    c, r = call(f'https://identitytoolkit.googleapis.com/v1/projects/{P}/accounts:lookup', 'POST', {'email': [who]})
    us = r.get('users', []) if c == 200 else []
    if not us: sys.exit(f'no account with email {who}')
    return us[0]['localId']


def set_beta(uid, on):
    now = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%fZ')
    c, r = call(f'{F}/students/{uid}?updateMask.fieldPaths=rithmicBeta&updateMask.fieldPaths=rithmicBetaAt'
                f'&currentDocument.exists=true', 'PATCH',
                {'fields': {'rithmicBeta': {'booleanValue': on}, 'rithmicBetaAt': {'timestampValue': now}}})
    if c != 200: print(f'SKIP {uid[:6]}…: no student doc yet ({c})'); return
    if on:
        call(f'{F}/rithmicReview/{uid}?updateMask.fieldPaths=approvedAt&currentDocument.exists=true', 'PATCH',
             {'fields': {'approvedAt': {'timestampValue': now}}})
    print(('APPROVED' if on else 'REVOKED'), uid[:6] + '…', '-> rithmicBeta =', beta(uid))


def main():
    if len(sys.argv) < 2: sys.exit(__doc__)
    H['Authorization'] = 'Bearer ' + token(); H['x-goog-user-project'] = P
    cmd = sys.argv[1]
    if cmd == 'list':
        rs = requests()
        for x in sorted(rs, key=lambda x: x['createdAt']):
            print(f"{x['createdAt'][:19]}  {'ON ' if beta(x['uid']) else 'pending'}  {x['email']}  {x['name']}  uid={x['uid']}")
        print(len(rs), 'request(s)')
    elif cmd == 'approve' and len(sys.argv) == 3:
        set_beta(resolve(sys.argv[2]), True)
    elif cmd == 'revoke' and len(sys.argv) == 3:
        set_beta(resolve(sys.argv[2]), False)
    elif cmd == 'approve-all-pending':
        n = 0
        for x in requests():
            if not beta(x['uid']): print(x['uid'][:6] + '…', end=': '); set_beta(x['uid'], True); n += 1
        print(n, 'approved')
    else:
        sys.exit(__doc__)


if __name__ == '__main__':
    main()
