"""Idempotent TradeZoro Discord builder. Matches by name, updates, never deletes. run(call, gid, plan, apply)."""
P = dict(VIEW_CHANNEL=1<<10, SEND_MESSAGES=1<<11, CREATE_PUBLIC_THREADS=1<<35, SEND_IN_THREADS=1<<38, KICK_MEMBERS=1<<1,
         ADMINISTRATOR=1<<3, VIEW_AUDIT_LOG=1<<7, MANAGE_MESSAGES=1<<13, MUTE_MEMBERS=1<<22, MODERATE_MEMBERS=1<<40)
TYPES = dict(text=0, voice=2, category=4, announcement=5, forum=15)
bits = lambda names: str(sum(P[n] for n in names))


import json


def run(call, gid, plan, apply):
    def do(label, method, path, body=None):
        print(('APPLY ' if apply else 'PLAN  ') + label)
        return call(method, path, body) if apply else None

    g = call('GET', f'/guilds/{gid}') or {}
    if not g: print('ERROR cannot read guild'); return
    feats = g.get('features', []); community = 'COMMUNITY' in feats
    me = call('GET', '/users/@me') or {}
    if not community:  # needs rules channel + level>=LOW + filter>=MEMBERS; welcome channel exists already
        wc = next((c for c in call('GET', f'/guilds/{gid}/channels') or [] if __import__('re').sub(r'^[^\w]+', '', c['name']) == plan['settings']['system_channel']), None)
        if wc:
            body = dict(features=sorted(set(feats) | {'COMMUNITY'}), rules_channel_id=wc['id'], public_updates_channel_id=wc['id'], preferred_locale='en-US',
                        verification_level=plan['settings']['verification_level'], explicit_content_filter=plan['settings']['explicit_content_filter'])
            if apply:
                g2 = call('PATCH', f'/guilds/{gid}', body)
                if g2: g = g2; feats = g.get('features', []); community = 'COMMUNITY' in feats
            print(('APPLY' if apply else 'PLAN ') + ' enable Community ->', community if apply else 'would try')
    print('GUILD', g.get('name'), 'community:', community, 'features:', feats)

    # settings
    s = plan['settings']; cur = {k: g.get(k) for k in ('verification_level', 'explicit_content_filter', 'default_message_notifications')}
    want = {k: s[k] for k in cur}
    ids = {}  # name -> id (roles and channels live in separate dicts)
    roles = {r['name']: r for r in call('GET', f'/guilds/{gid}/roles') or []}
    rid = {n: r['id'] for n, r in roles.items()}; rid['@everyone'] = gid
    for r in plan['roles']:
        body = dict(name=r['name'], color=int(r['color'][1:], 16), hoist=r.get('hoist', False), mentionable=False)
        ex = roles.get(r['name'])
        if ex:
            if ex['color'] != body['color'] or ex['hoist'] != body['hoist']:
                out = do(f"role update {r['name']} (colour/hoist only)", 'PATCH', f"/guilds/{gid}/roles/{ex['id']}", {k: body[k] for k in ('color', 'hoist')})
            else: print('OK    role', r['name'])
        else:
            body['permissions'] = bits(r['perms'])
            out = do(f"role create {r['name']} perms={r['perms']}", 'POST', f'/guilds/{gid}/roles', body)
            rid[r['name']] = (out or {}).get('id', f"<new:{r['name']}>")

    def ow(spec):
        return [dict(id=rid.get(n, f'<{n}>'), type=0, allow=bits(v.get('allow', [])), deny=bits(v.get('deny', []))) for n, v in spec.items()]

    chans = call('GET', f'/guilds/{gid}/channels') or []
    import re as _re
    plain = lambda n: _re.sub(r'^[^\w]+', '', n or '')
    def disp(x, cat=False):
        e = x.get('emoji')
        if not e: return x['name']
        if cat: return e + ' ' + x['name']
        return e + ' ' + x['name'] if x.get('type') == 'voice' else e + '・' + x['name']
    find = lambda name, cat: next((c for c in chans if plain(c['name']) == plain(name) and (c['type'] == 4) == cat), None)
    cid = {}
    for cat in plan['categories']:
        ex = find(cat['name'], True); o = ow(cat['ow'])
        if ex:
            cid[cat['name']] = ex['id']
            if ex['name'] != disp(cat, True): do(f"category rename {ex['name']} -> {disp(cat, True)}", 'PATCH', f"/channels/{ex['id']}", dict(name=disp(cat, True)))
            else: print('OK    category', cat['name'])
        else:
            out = do(f"category create {disp(cat, True)}", 'POST', f'/guilds/{gid}/channels', dict(name=disp(cat, True), type=4, permission_overwrites=o))
            cid[cat['name']] = (out or {}).get('id', f"<new:{cat['name']}>")
            if ex is None and out: chans.append(out)
        if ex: do(f"category overwrites {cat['name']}", 'PATCH', f"/channels/{ex['id']}", dict(permission_overwrites=o))
        for ch in cat['channels']:
            t = ch['type']
            if not community and t in ('announcement', 'forum'):
                print(f"NOTE  {ch['name']}: no Community, falling back to text"); t = 'text'
            # existing channel: match by name regardless of type (a type cannot be changed safely)
            ex = find(ch['name'], False)
            if ex and ex['type'] == 0 and t == 'announcement': do(f"channel type -> announcement #{ch['name']}", 'PATCH', f"/channels/{ex['id']}", dict(type=5))
            body = dict(name=disp(dict(ch, type=t)), type=TYPES[t], parent_id=cid[cat['name']])
            if t != 'voice' and ch.get('topic'): body['topic'] = ch['topic']
            if ch.get('slowmode') is not None and t in ('text', 'forum'): body['rate_limit_per_user'] = ch['slowmode']
            body['permission_overwrites'] = ow(ch.get('ow', cat['ow']))
            if ex:
                upd = {k: v for k, v in body.items() if k not in ('type', 'name')}
                if ex['name'] != body['name']: upd['name'] = body['name']
                if ch.get('marker') == 'welcome': upd.pop('topic', None) if ex.get('topic') else None
                do(f"channel update #{ch['name']} -> {cat['name']}", 'PATCH', f"/channels/{ex['id']}", upd)
                cid[ch['name']] = ex['id']
            else:
                out = do(f"channel create #{ch['name']} ({t}) in {cat['name']} slowmode={ch.get('slowmode', 0)}", 'POST', f'/guilds/{gid}/channels', body)
                cid[ch['name']] = (out or {}).get('id', f"<new:{ch['name']}>")

    # guild settings last, so system channel exists
    want['system_channel_id'] = cid.get(s['system_channel'])
    if {**cur, 'system_channel_id': g.get('system_channel_id')} != want:
        do(f'guild settings {want}', 'PATCH', f'/guilds/{gid}', want)
    else: print('OK    guild settings')

    # pinned messages (post only if the bot has not already posted that text)
    for key, m in plan['messages'].items():
        if key == 'roles': continue  # handled below: one message with buttons
        c = cid.get(m['channel'])
        if not c or c.startswith('<'): print(f'PLAN  message {key} in #{m["channel"]} (channel not created yet)'); continue
        msgs = call('GET', f'/channels/{c}/messages?limit=50') or []
        if any(x['author']['id'] == me.get('id') and x['content'][:40] == m['text'][:40] for x in msgs): print('OK    message', key); continue
        out = do(f'message post+pin {key} in #{m["channel"]}', 'POST', f'/channels/{c}/messages', dict(content=m['text']))
        if out: do(f'pin {key}', 'PUT', f'/channels/{c}/pins/{out["id"]}')

    # self-role buttons: ONE bot message in the roles channel (edit the existing one, never duplicate), then pin
    m = plan['messages']['roles']; c = cid.get(m['channel'])
    names = [('Futures', '📊'), ('Stocks', '🏦'), ('Crypto', '🪙'), ('Forex', '💱'), ('India', '🇮🇳'), ('Options', '🧾'), ('Beginner', '🌱'), ('Intermediate', '📘'), ('Advanced', '🧠')]
    if not c or c.startswith('<') or any(n not in roles for n, _ in names): print('PLAN  role buttons (channel or roles missing)')
    else:
        btn = lambda n, e: dict(type=2, style=2, label=n, emoji=dict(name=e), custom_id='tzrole:' + roles[n]['id'])
        rows = [dict(type=1, components=[btn(n, e) for n, e in names[:5]]), dict(type=1, components=[btn(n, e) for n, e in names[5:6]]),
                dict(type=1, components=[btn(n, e) for n, e in names[6:]])]
        body = dict(content=m['text'], components=rows)
        msgs = call('GET', f'/channels/{c}/messages?limit=50') or []
        mine = next((x for x in msgs if x['author']['id'] == me.get('id') and 'Pick your roles' in x['content'][:40]), None)
        if mine and mine['content'] == body['content'] and json.dumps([[b.get('custom_id') for b in r['components']] for r in mine.get('components', [])]) == json.dumps([[b['custom_id'] for b in r['components']] for r in rows]):
            print('OK    role buttons message')
        elif mine:
            do('role buttons: edit existing message', 'PATCH', f'/channels/{c}/messages/{mine["id"]}', body)
            if not mine.get('pinned'): do('pin role buttons', 'PUT', f'/channels/{c}/pins/{mine["id"]}')
        else:
            out = do('role buttons: post+pin', 'POST', f'/channels/{c}/messages', body)
            if out: do('pin role buttons', 'PUT', f'/channels/{c}/pins/{out["id"]}')

    # onboarding (needs Community)
    ob = plan['onboarding']
    if community:
        old = call('GET', f'/guilds/{gid}/onboarding') or {}
        oldp = {p['title']: p for p in old.get('prompts', [])}
        n = [1565740000000000000]
        def nid(): n[0] += 1; return str(n[0])
        prompts = []
        for p in ob['prompts']:
            op = oldp.get(p['title'], {}); oo = {o['title']: o for o in op.get('options', [])}
            opts = [dict(id=oo.get(o['title'], {}).get('id') or nid(), title=o['title'], description=o.get('description'),
                         role_ids=[rid[r] for r in o['roles']], channel_ids=[]) for o in p['options']]
            prompts.append(dict(id=op.get('id') or nid(), title=p['title'], single_select=p['single_select'], required=p['required'],
                                in_onboarding=True, type=0, options=opts))
        body = dict(prompts=prompts, default_channel_ids=[cid[c] for c in ob['default_channels']], enabled=True, mode=0)
        r = do(f'onboarding PUT ({len(prompts)} prompts, enabled)', 'PUT', f'/guilds/{gid}/onboarding', body)
        if apply and r is None:
            body['enabled'] = False
            do('onboarding PUT retry (saved but NOT enabled; Owner must switch it on)', 'PUT', f'/guilds/{gid}/onboarding', body)
    else: print('NOTE  no Community: onboarding skipped (Owner must enable Community, then re-run apply)')

    # automod
    am = plan['automod']; ex = {r['name']: r for r in call('GET', f'/guilds/{gid}/auto-moderation/rules') or []}
    act = [dict(type=1)]
    if cid.get(am['alert_channel'], '<').startswith('<') is False: act.append(dict(type=2, metadata=dict(channel_id=cid[am['alert_channel']])))
    exr = [rid[n] for n in am['exempt_roles'] if n in rid]
    rules = [
        ('TradeZoro: block invite links', 1, dict(keyword_filter=['*discord.gg/*', '*discord.com/invite/*', '*discordapp.com/invite/*'], allow_list=am['invite_allow'])),
        ('TradeZoro: scam phrases', 1, dict(keyword_filter=[f'*{p}*' for p in am['scam_phrases']])),
        ('TradeZoro: spam', 3, {}),
        ('TradeZoro: mention spam', 5, dict(mention_total_limit=am['mention_limit'])),
        ('TradeZoro: profanity and slurs', 4, dict(presets=[1, 3])),
    ]
    for name, tt, meta in rules:
        body = dict(name=name, event_type=1, trigger_type=tt, trigger_metadata=meta, actions=act if tt != 4 else [dict(type=1)], enabled=True, exempt_roles=exr)
        if name in ex: do(f'automod update {name}', 'PATCH', f"/guilds/{gid}/auto-moderation/rules/{ex[name]['id']}", body)
        else: do(f'automod create {name}', 'POST', f'/guilds/{gid}/auto-moderation/rules', body)
    print('DONE', 'applied' if apply else 'dry-run only, nothing changed')
