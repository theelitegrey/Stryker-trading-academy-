#!/usr/bin/env python3
"""Posts/edits the ONE support-ticket panel (Components V2 card + Open button) in #help-and-support and pins it.
Idempotent: finds the bot's existing panel by its custom_id and edits it. Env: BOT (token, never printed), GUILD, MODE=info|dry|apply (default dry)."""
import json, os, re, sys, time, urllib.request, urllib.error
API = 'https://discord.com/api/v10'
TOK = os.environ.get('BOT', ''); GID = os.environ.get('GUILD', '1565740274116857887'); MODE = os.environ.get('MODE', 'dry')
def call(method, path, body=None):
    for _ in range(5):
        req = urllib.request.Request(API + path, method=method, data=json.dumps(body).encode() if body is not None else None,
            headers={'Authorization': 'Bot ' + TOK, 'Content-Type': 'application/json', 'User-Agent': 'TradeZoroSetup (tradezoro.com, 1)'})
        try:
            with urllib.request.urlopen(req) as r:
                t = r.read(); return json.loads(t) if t else {}
        except urllib.error.HTTPError as e:
            if e.code == 429: time.sleep(float(json.loads(e.read() or b'{}').get('retry_after', 2)) + 0.5); continue
            print('HTTP', e.code, method, path, (e.read() or b'')[:300].decode(errors='ignore')); return None
    return None
strip = lambda s: re.sub(r'[^a-z0-9-]', '', s.lower())
PANEL = {'flags': 32768, 'components': [{'type': 17, 'components': [
    {'type': 10, 'content': '## Need private help?'},
    {'type': 10, 'content': 'Open a private ticket for account, billing, or data/broker issues. Only you and the TradeZoro team can see it.\nGeneral questions are best asked here in the channel, so others can help and learn too.'},
    {'type': 14, 'divider': True, 'spacing': 1},
    {'type': 1, 'components': [{'type': 2, 'style': 3, 'label': 'Open a ticket', 'emoji': {'name': '🎫'}, 'custom_id': 'tzticket:open'}]}]}]}
def has_open(c):
    for x in c.get('components', []):
        if x.get('custom_id') == 'tzticket:open' or has_open(x): return True
    return False
def main():
    if not TOK: sys.exit('no BOT token')
    me = call('GET', '/users/@me') or {}
    if MODE == 'info':
        print('BOT_USER', me.get('username'))
        for g in call('GET', '/users/@me/guilds') or []: print('GUILD', g['id'], g['name'], 'perms', g.get('permissions'))
        return
    ch = [c for c in call('GET', f'/guilds/{GID}/channels') or [] if c['type'] == 0 and strip(c['name']) == 'help-and-support']
    if len(ch) != 1: sys.exit(f'expected 1 help-and-support channel, found {len(ch)}')
    cid = ch[0]['id']
    mine = next((m for m in call('GET', f'/channels/{cid}/messages?limit=100') or [] if m['author']['id'] == me.get('id') and has_open(m)), None)
    print('PLAN', 'edit ' + mine['id'] if mine else 'post new', 'in', ch[0]['name'])
    if MODE != 'apply': print('dry run: nothing changed'); return
    out = call('PATCH', f'/channels/{cid}/messages/{mine["id"]}', PANEL) if mine else call('POST', f'/channels/{cid}/messages', PANEL)
    if not out: sys.exit('failed')
    if not (mine and mine.get('pinned')): print('pin', 'ok' if call('PUT', f'/channels/{cid}/pins/{out["id"]}') is not None else 'FAILED')
    print('DONE', out['id'])
main()
