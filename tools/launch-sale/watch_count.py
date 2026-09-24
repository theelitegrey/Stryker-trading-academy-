#!/usr/bin/env python3
"""Launch sale: read-only seat-count watcher.

    python3 tools/launch-sale/watch_count.py            # check once, append if something changed
    python3 tools/launch-sale/watch_count.py --dry-run  # print, write nothing

Cloud Functions can't write to the notes repo, so this script carries the
90 / 100 alerts (written by launchSaleOnOrder to launchSaleAlerts/{90,100})
and the live count (settings/commerce.launchSale) into
/root/projects/stryker-notes/reports/launch-sale-count.md, where the website
manager's daily report picks them up.

READ-ONLY against Firestore: GET requests only. It never changes prices,
plans or the count. Safe to run from cron as often as you like; it appends
only when the count changes or a new alert appears (state in a small JSON
file next to the report).

Token: the website manager's tok.sh (firebase-tools OAuth). Never printed.
Exit codes: 0 ok, 2 Firestore unreadable (the report gets a line saying so).
"""
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

PROJECT = 'strykertrades-e0cd8'
BASE = f'https://firestore.googleapis.com/v1/projects/{PROJECT}/databases/(default)/documents'
TOK_SH = '/root/.hermes/profiles/stryker-website-manager/cache/scratch/fn/tok.sh'
REPORT = '/root/projects/stryker-notes/reports/launch-sale-count.md'
STATE = '/root/projects/stryker-notes/reports/.launch-sale-count.state.json'


def token():
    out = subprocess.run([TOK_SH], capture_output=True, text=True, timeout=30)
    tok = out.stdout.strip()
    if not tok or ' ' in tok:
        raise RuntimeError('token helper returned nothing usable')
    return tok


def get(path, tok):
    req = urllib.request.Request(f'{BASE}/{path}', headers={'Authorization': 'Bearer ' + tok})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise


def val(v):
    """Decode one Firestore REST value."""
    if v is None:
        return None
    k, x = next(iter(v.items()))
    if k == 'integerValue':
        return int(x)
    if k == 'doubleValue':
        return float(x)
    if k == 'mapValue':
        return {a: val(b) for a, b in (x.get('fields') or {}).items()}
    if k == 'arrayValue':
        return [val(i) for i in x.get('values', [])]
    if k == 'nullValue':
        return None
    return x


def now():
    return time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime())


def append(lines, dry):
    if dry:
        print('\n'.join(lines))
        return
    new = not os.path.exists(REPORT)
    with open(REPORT, 'a') as f:
        if new:
            f.write('# Launch sale seat count\n\n'
                    'Appended by tools/launch-sale/watch_count.py (read-only). '
                    'Prices never change automatically; at 100 the Owner decides what happens next.\n\n')
        f.write('\n'.join(lines) + '\n')


def main():
    dry = '--dry-run' in sys.argv
    state = {}
    if os.path.exists(STATE):
        try:
            state = json.load(open(STATE))
        except ValueError:
            state = {}
    try:
        tok = token()
        commerce = get('settings/commerce', tok)
        alerts = {m: get(f'launchSaleAlerts/{m}', tok) for m in (90, 100)}
    except Exception as e:  # noqa: BLE001 (report and stop; never guess a number)
        msg = f'- {now()}: could not read Firestore ({type(e).__name__}); count unknown'
        if state.get('last_error') != msg[:40]:
            append([msg], dry)
        state['last_error'] = msg[:40]
        if not dry:
            json.dump(state, open(STATE, 'w'))
        return 2

    fields = (commerce or {}).get('fields', {})
    ls = val(fields.get('launchSale')) if fields.get('launchSale') else None
    if not isinstance(ls, dict):
        ls = None
    lines = []
    if not ls:
        if state.get('taken') != 'none':
            lines.append(f'- {now()}: no launch sale configured (settings/commerce.launchSale missing)')
            state['taken'] = 'none'
    else:
        taken, limit, active = ls.get('taken'), ls.get('limit'), ls.get('active')
        if taken != state.get('taken') or active != state.get('active'):
            left = (limit - taken) if isinstance(limit, int) and isinstance(taken, int) else '?'
            lines.append(f'- {now()}: {taken} of {limit} launch spots taken, {left} left'
                         + ('' if active else ' (sale INACTIVE)'))
            state['taken'], state['active'] = taken, active
    for mark, doc in alerts.items():
        key = f'alert{mark}'
        if doc and not state.get(key):
            f = doc.get('fields', {})
            at = val(f.get('at')) or doc.get('createTime', '?')
            lines.append(f'- **ALERT {mark}/100** reached ({val(f.get("taken"))} paid members) at {at}. '
                         + ('Tell the website manager and chief-of-staff today.' if mark == 90 else
                            'SOLD OUT. The banner has hidden itself; the Owner decides post-sale pricing. '
                            'Nothing changes automatically.'))
            state[key] = True
    state.pop('last_error', None)
    if lines:
        append(lines, dry)
    elif dry:
        print(f'{now()}: no change (taken={state.get("taken")})')
    if not dry:
        json.dump(state, open(STATE, 'w'))
    return 0


if __name__ == '__main__':
    sys.exit(main())
