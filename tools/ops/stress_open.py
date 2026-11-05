#!/usr/bin/env python3
"""Market-open stress test of the futures data server (Owner 05 Nov: "stress test ... it still feeds data to users, bulk charts").
Signs in as the internal demo account (creds from secret OPS_ARG = "email\\npassword"; never printed), then for DUR seconds:
  - N_HUB sockets on /ts-live doing what a chart does ({op:'sub'}), spread over NQ ES MNQ MES YM RTY CL GC
  - N_TE sockets on /ts-live using the tick engine ({op:'tsub'}), checks the seq has no holes
  - a burst of chart-history reads (/te-bars, many timeframes) like members opening many charts at once
  - polls /ts-health and /te-health every 10 s
Prints only counts and timings. Leaves room for real members (cap 150): N_HUB + N_TE stays <= 100.
"""
import asyncio, json, os, sys, time, random, statistics, subprocess, urllib.request, urllib.error, re
subprocess.run([sys.executable, '-m', 'pip', 'install', '-q', '--target', '/tmp/pydeps', 'websockets==12.0', 'aiohttp==3.9.5'], check=True)
sys.path.insert(0, '/tmp/pydeps')
import websockets, aiohttp

B = 'https://book-recorder.theelitegrey.workers.dev'
WSB = 'wss://book-recorder.theelitegrey.workers.dev'
SYMS = ['NQ', 'ES', 'MNQ', 'MES', 'YM', 'RTY', 'CL', 'GC']
DUR = int(os.environ.get('DUR', '300'))
N_HUB, N_TE = 70, 30

em, pw = (os.environ.get('OPS_ARG', '') + '\n').split('\n')[:2]
key = sorted(set(re.findall(r'AIza[0-9A-Za-z_-]{35}', subprocess.run("git grep -h -o -E 'AIza[0-9A-Za-z_-]{35}' -- 'assets/*.js'", shell=True, capture_output=True, text=True).stdout)))[0]
r = urllib.request.Request('https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=' + key,
                           json.dumps({'email': em.strip(), 'password': pw.strip(), 'returnSecureToken': True}).encode(),
                           {'Content-Type': 'application/json', 'Referer': 'https://tradezoro.com/'})
TOK = json.loads(urllib.request.urlopen(r, timeout=20).read())['idToken']
print('signed in as the demo account')

stats = {'hub': [], 'te': []}
lat_hub, lat_te, health = [], [], []
http = {'ok': 0, 'err': 0, 'ms': [], 'codes': {}}


def now_ms(): return time.time() * 1000


async def hub_client(i):
    sym = SYMS[i % len(SYMS)]
    s = {'sym': sym, 'open': 0, 'drops': 0, 'frames': 0, 'trades': 0, 'snaps': 0, 'refused': 0, 'first_ms': None, 'err': ''}
    stats['hub'].append(s)
    end = time.time() + DUR
    while time.time() < end:
        t0 = now_ms()
        try:
            async with websockets.connect(f'{WSB}/ts-live?symbol={sym}&levels=20', subprotocols=['tz-auth', TOK], origin='https://tradezoro.com',
                                          max_size=8_000_000, open_timeout=20, ping_interval=None) as ws:
                s['open'] += 1
                await ws.send(json.dumps({'op': 'sub', 'symbol': sym, 'levels': 20}))
                while time.time() < end:
                    try: m = await asyncio.wait_for(ws.recv(), timeout=max(1, end - time.time()))
                    except asyncio.TimeoutError: break
                    s['frames'] += 1
                    if s['first_ms'] is None: s['first_ms'] = now_ms() - t0
                    try: d = json.loads(m)
                    except Exception: continue
                    if d.get('event') == 'hub_full': s['refused'] += 1
                    ty = d.get('type')
                    if ty == 'snap': s['snaps'] += 1
                    elif ty == 'ticks':
                        t = d.get('t') or []; s['trades'] += len(t)
                        if t and i % 7 == 0: lat_hub.append(now_ms() - t[-1][3])
        except Exception as e:
            s['err'] = type(e).__name__ + ':' + str(e)[:60]
        if time.time() < end: s['drops'] += 1; await asyncio.sleep(1 + random.random())


async def te_client(i):
    sym = ['NQ', 'ES', 'MNQ', 'MES'][i % 4]
    s = {'sym': sym, 'open': 0, 'drops': 0, 'frames': 0, 'trades': 0, 'holes': 0, 'resync': 0, 'first_ms': None, 'err': '', 'q': None, 'e': None}
    stats['te'].append(s)
    end = time.time() + DUR
    while time.time() < end:
        t0 = now_ms()
        try:
            async with websockets.connect(f'{WSB}/ts-live?symbol={sym}&levels=20', subprotocols=['tz-auth', TOK], origin='https://tradezoro.com',
                                          max_size=8_000_000, open_timeout=20, ping_interval=None) as ws:
                s['open'] += 1
                op = {'op': 'tsub', 'symbol': sym}
                if s['q'] is not None: op.update({'since': s['q'], 'e': s['e']})
                await ws.send(json.dumps(op))
                while time.time() < end:
                    try: m = await asyncio.wait_for(ws.recv(), timeout=max(1, end - time.time()))
                    except asyncio.TimeoutError: break
                    s['frames'] += 1
                    if s['first_ms'] is None: s['first_ms'] = now_ms() - t0
                    try: d = json.loads(m)
                    except Exception: continue
                    if d.get('type') == 'resync' or d.get('event') == 'resync': s['resync'] += 1; s['q'] = None
                    if d.get('type') == 'tt' and d.get('symbol', sym) == sym:
                        t = d.get('t') or []; q = d.get('q')
                        if 'e' in d: s['e'] = d['e']
                        if q is not None:
                            if s['q'] is not None and q - len(t) != s['q'] and q > s['q']: s['holes'] += 1
                            s['q'] = q
                        s['trades'] += len(t)
                        if t and i % 3 == 0: lat_te.append(now_ms() - t[-1][3])
        except Exception as e:
            s['err'] = type(e).__name__ + ':' + str(e)[:60]
        if time.time() < end: s['drops'] += 1; await asyncio.sleep(1 + random.random())


async def charts_burst(sess):
    # members opening many charts: 40 parallel history reads every 20 s
    tfs = ['1', '5', '15', '60', '1S', '5S']
    end = time.time() + DUR
    while time.time() < end:
        async def one():
            sym, tf = random.choice(SYMS), random.choice(tfs)
            t1 = int(time.time()); t0 = t1 - (6 * 3600 if 'S' not in tf else 1800)
            a = now_ms()
            try:
                async with sess.get(f'{B}/te-bars?sym={sym}&tf={tf}&from={t0}&to={t1}', headers={'Authorization': 'Bearer ' + TOK, 'Origin': 'https://tradezoro.com'}, timeout=aiohttp.ClientTimeout(total=30)) as r:
                    await r.read(); http['codes'][r.status] = http['codes'].get(r.status, 0) + 1
                    if r.status == 200: http['ok'] += 1; http['ms'].append(now_ms() - a)
                    else: http['err'] += 1
            except Exception: http['err'] += 1; http['codes']['exc'] = http['codes'].get('exc', 0) + 1
        await asyncio.gather(*[one() for _ in range(40)])
        await asyncio.sleep(20)


async def poll(sess):
    end = time.time() + DUR
    while time.time() < end:
        row = {'t': round(DUR - (end - time.time()))}
        for p in ('ts-health', 'te-health'):
            try:
                async with sess.get(f'{B}/{p}', timeout=aiohttp.ClientTimeout(total=15)) as r: d = await r.json(content_type=None)
                if p == 'ts-health': row.update({k: d.get(k) for k in ('clients', 'bookClients', 'refused', 'lastDataAgoMs', 'state')})
                else: row.update({'te_trades': d.get('trades'), 'te_late': d.get('late'), 'te_err': d.get('lastError')})
            except Exception as e: row[p] = 'ERR ' + type(e).__name__
        health.append(row)
        await asyncio.sleep(10)


def pct(a, p):
    if not a: return None
    a = sorted(a); return round(a[min(len(a) - 1, int(len(a) * p / 100))])


async def main():
    async with aiohttp.ClientSession() as sess:
        tasks = [hub_client(i) for i in range(N_HUB)] + [te_client(i) for i in range(N_TE)] + [charts_burst(sess), poll(sess)]
        await asyncio.gather(*tasks)
    for k in ('hub', 'te'):
        L = stats[k]
        print(f'== {k} sockets: {len(L)}  opened {sum(x["open"] for x in L)}  drops {sum(x["drops"] for x in L)}  '
              f'with no data {sum(1 for x in L if x["trades"] == 0)}  trades recv {sum(x["trades"] for x in L)}  '
              f'first-frame ms p50 {pct([x["first_ms"] for x in L if x["first_ms"]], 50)} p95 {pct([x["first_ms"] for x in L if x["first_ms"]], 95)}')
        if k == 'hub': print('   refused(hub_full)', sum(x['refused'] for x in L), ' snaps', sum(x['snaps'] for x in L))
        if k == 'te': print('   seq holes', sum(x['holes'] for x in L), ' resyncs', sum(x['resync'] for x in L))
        errs = {}
        for x in L:
            if x['err']: errs[x['err']] = errs.get(x['err'], 0) + 1
        if errs: print('   errors', errs)
        per = {}
        for x in L: per.setdefault(x['sym'], []).append(x['trades'])
        print('   trades per socket by symbol (min/max):', {s: (min(v), max(v)) for s, v in per.items()})
    print('== delivery delay, hub receive -> client (ms): hub p50', pct(lat_hub, 50), 'p95', pct(lat_hub, 95), 'p99', pct(lat_hub, 99), 'n', len(lat_hub))
    print('   engine p50', pct(lat_te, 50), 'p95', pct(lat_te, 95), 'p99', pct(lat_te, 99), 'n', len(lat_te))
    print('== chart history reads: ok', http['ok'], 'err', http['err'], 'codes', http['codes'], 'ms p50', pct(http['ms'], 50), 'p95', pct(http['ms'], 95))
    print('== server health every 10 s:')
    for row in health: print('  ', row)

asyncio.run(main())
