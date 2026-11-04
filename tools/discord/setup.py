#!/usr/bin/env python3
"""TradeZoro Discord server builder. Token comes from env BOT (GitHub secret), never printed.
MODE=info: public app id + guilds the bot is in. MODE=dry/apply: build from tools/discord/plan.json (apply never deletes)."""
import json, os, sys, time, urllib.request, urllib.error
API = 'https://discord.com/api/v10'
TOK = os.environ.get('BOT', '')
def call(method, path, body=None):
    for _ in range(5):
        req = urllib.request.Request(API + path, method=method, data=json.dumps(body).encode() if body is not None else None,
            headers={'Authorization': 'Bot ' + TOK, 'Content-Type': 'application/json', 'User-Agent': 'TradeZoroSetup (tradezoro.com, 1)'})
        try:
            with urllib.request.urlopen(req) as r:
                t = r.read(); return json.loads(t) if t else {}
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(float(json.loads(e.read() or b'{}').get('retry_after', 2)) + 0.5); continue
            print('HTTP', e.code, method, path, (e.read() or b'')[:300].decode(errors='ignore')); return None
    return None
mode = os.environ.get('MODE', 'info'); gid = os.environ.get('GUILD', '')
if not TOK: sys.exit('no BOT token')
if mode == 'info':
    me = call('GET', '/users/@me') or {}
    app = call('GET', '/oauth2/applications/@me') or {}
    print('BOT_USER', me.get('username'), 'APP_ID', app.get('id') or me.get('id'))
    for g in call('GET', '/users/@me/guilds') or []: print('GUILD', g['id'], g['name'], 'perms', g.get('permissions'))
    sys.exit(0)
plan_path = os.path.join(os.path.dirname(__file__), 'plan.json')
if not os.path.exists(plan_path): sys.exit('plan.json missing')
import builder  # noqa
builder.run(call, gid, json.load(open(plan_path)), apply=(mode == 'apply'))
