"""Idempotent TradeZoro Discord builder. Matches by name, updates, never deletes. run(call, gid, plan, apply)."""
P = dict(VIEW_CHANNEL=1<<10, SEND_MESSAGES=1<<11, CREATE_PUBLIC_THREADS=1<<35, SEND_IN_THREADS=1<<38, KICK_MEMBERS=1<<1,
         ADMINISTRATOR=1<<3, VIEW_AUDIT_LOG=1<<7, MANAGE_MESSAGES=1<<13, MUTE_MEMBERS=1<<22, MODERATE_MEMBERS=1<<40)
TYPES = dict(text=0, voice=2, category=4, announcement=5, forum=15)
bits = lambda names: str(sum(P[n] for n in names))


def run(call, gid, plan, apply):
    def do(label, method, path, body=None):
        print(('APPLY ' if apply else 'PLAN  ') + label)
        return call(method, path, body) if apply else None

    g = call('GET', f'/guilds/{gid}') or {}
    if not g: print('ERROR cannot read guild'); return
    feats = g.get('features', []); community = 'COMMUNITY' in feats
    me = call('GET', '/users/@me') or {}
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
    find = lambda name, cat: next((c for c in chans if c['name'] == name and (c['type'] == 4) == cat), None)
    cid = {}
    for cat in plan['categories']:
        ex = find(cat['name'], True); o = ow(cat['ow'])
        if ex: print('OK    category', cat['name']); cid[cat['name']] = ex['id']
        else:
            out = do(f"category create {cat['name']}", 'POST', f'/guilds/{gid}/channels', dict(name=cat['name'], type=4, permission_overwrites=o))
            cid[cat['name']] = (out or {}).get('id', f"<new:{cat['name']}>")
            if ex is None and out: chans.append(out)
        if ex: do(f"category overwrites {cat['name']}", 'PATCH', f"/channels/{ex['id']}", dict(permission_overwrites=o))
        for ch in cat['channels']:
            t = ch['type']
            if not community and t in ('announcement', 'forum'):
                print(f"NOTE  {ch['name']}: no Community, falling back to text"); t = 'text'
            # existing channel: match by name regardless of type (a type cannot be changed safely)
            ex = find(ch['name'], False)
            body = dict(name=ch['name'], type=TYPES[t], parent_id=cid[cat['name']])
            if t != 'voice' and ch.get('topic'): body['topic'] = ch['topic']
            if ch.get('slowmode') is not None and t in ('text', 'forum'): body['rate_limit_per_user'] = ch['slowmode']
            body['permission_overwrites'] = ow(ch.get('ow', cat['ow']))
            if ex:
                upd = {k: v for k, v in body.items() if k not in ('type', 'name')}
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
        c = cid.get(m['channel'])
        if not c or c.startswith('<'): print(f'PLAN  message {key} in #{m["channel"]} (channel not created yet)'); continue
        msgs = call('GET', f'/channels/{c}/messages?limit=50') or []
        if any(x['author']['id'] == me.get('id') and x['content'][:40] == m['text'][:40] for x in msgs): print('OK    message', key); continue
        out = do(f'message post+pin {key} in #{m["channel"]}', 'POST', f'/channels/{c}/messages', dict(content=m['text']))
        if out: do(f'pin {key}', 'PUT', f'/channels/{c}/pins/{out["id"]}')

    # onboarding (needs Community)
    ob = plan['onboarding']
    if community:
        prompts = [dict(title=p['title'], single_select=p['single_select'], required=p['required'], in_onboarding=True, type=0,
                        options=[dict(title=o['title'], description=o.get('description'), role_ids=[rid.get(r, '') for r in o['roles']], channel_ids=[]) for o in p['options']])
                   for p in ob['prompts']]
        do(f'onboarding PUT ({len(prompts)} prompts)', 'PUT', f'/guilds/{gid}/onboarding',
           dict(prompts=prompts, default_channel_ids=[cid[n] for n in ob['default_channels']], enabled=True, mode=0))
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
