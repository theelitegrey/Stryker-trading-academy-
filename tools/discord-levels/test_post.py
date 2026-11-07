#!/usr/bin/env python3
"""python3 tools/discord-levels/test_post.py"""
import os, sys, tempfile, json
from datetime import datetime
sys.path.insert(0, os.path.dirname(__file__))
import post

n = 0
def ok(c, m):
    global n
    assert c, m; n += 1; print('PASS', m)

NOW = datetime(2026, 11, 9, 13, 0, tzinfo=post.ET).timestamp()   # Monday 13:00 ET
S = {'built': NOW - 600, 'day': '2026-11-09', 'teaser': True,
     'levels': {'call_ceiling': 7450, 'put_floor': 7400, 'flip_line': 7514.56, 'pin': 7560, 'net': -1.0},
     'ranges': {'0': [7355.87, 7453.07], 'w': [7355.87, 7453.07]}}
m = post.morning_message(S, NOW)
ok(m and 'Call Ceiling  7450' in m and 'Flip Line     7514.56' in m and 'Put Floor     7400' in m, 'morning post has the free levels')
ok('Updated 10 min ago' in m and post.SITE + '/gex' in m and 'Education only' in m, 'morning post says updated X min ago, links the site, has the notice')
ok('Pin' not in m and 'Zoro Level' not in m and not any(w in m.lower() for w in ('delayed', 'real-time', 'live ', 'behind')), 'no Pro pieces, no banned words')
ok(post.morning_message(dict(S, day='2026-11-06', built=NOW - 3 * 86400), NOW) is None, 'yesterday\'s levels are not posted as today\'s')
ok(post.morning_message({'built': NOW, 'day': '2026-11-09', 'levels': {}}, NOW) is None, 'no levels -> no post (nothing invented)')
ok(post.morning_message(None, NOW) is None, 'bad answer -> no post')

P = {'cols': ['t', 'p', 's', 'c'], 'rows': [[(NOW - 600) * 1000, 740.0, 40000, ''],      # $29.6M ok
                                           [(NOW - 500) * 1000, 740.0, 10000, ''],      # $7.4M below
                                           [(NOW - 400) * 1000, 740.0, 100000, 'B'],    # average price: dropped
                                           [(NOW - 5 * 3600) * 1000, 740.0, 90000, ''], # too old
                                           [(NOW + 3600) * 1000, 740.0, 90000, ''],     # future
                                           [(NOW - 300) * 1000, 740.0, 50000, '']]}     # $37M ok
b = post.big_prints(P, NOW)
ok(len(b) == 2 and all(x[3] >= 25e6 for x in b), 'only market-price prints of $25M or more, recent: %d' % len(b))
ok(post.big_prints({'cols': ['x']}, NOW) == [] and post.big_prints(None, NOW) == [], 'bad part -> nothing')
t = post.print_message('SPY', b[0][0], b[0][1], b[0][2], b[0][3], NOW)
ok('$30M' in t and 'SPY' in t and '40,000 shares' in t and 'not a signal' in t, 'print post text: ' + t.split('\n')[0])
ok(post.usd_text(1.2e9) == '$1.2B', 'usd text')

with tempfile.TemporaryDirectory() as d:
    f = os.path.join(d, 'x.env')
    open(f, 'w').write('OTHER=1\nDISCORD_BOT_TOKEN="abc.def"\n')
    ok(post.read_token(f) == 'abc.def', 'token read from the env file, quotes stripped')
    os.environ['TZ_LEVELS_STATE'] = d
    post.save_state({'morning': 'x'}); ok(post.load_state() == {'morning': 'x'}, 'state round trip')
# main refuses to run without config and never echoes anything secret
os.environ.pop('DISCORD_LEVELS_CHANNEL_ID', None)
ok(post.main(['post.py', 'morning']) == 2, 'no channel / env file -> refuses (exit 2)')
print('ALL PASS', n)
