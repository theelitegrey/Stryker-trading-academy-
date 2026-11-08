# Fixture hub for the tick-engine browser test (no Worker, no key, no provider). Speaks the engine's protocol:
#   GET /te-bars?sym&tf&from&to&limit -> {b, rec, e, q, more, c} built from its own tape (x-te-lane: live). tf 'NT' = N-tick bars counted
#     from the session open (18:00 New York, = tick-engine.js tickBars). ARCHIVE EMULATION: the tape is 8 h, the "live record" starts 1 h
#     ago (LIVE); a seconds read reaching before LIVE answers `more` (bars from LIVE only) the first time that range is asked, the full
#     range the next time, like the Worker's budgeted on-demand fill.
#   WS  /ts-live (subprotocol tz-auth) -> hub_attached, ping every 5 s, {op:'tsub', symbol, since, e} -> {type:'tt', e, q, t} with replay
#   GET /kill (drop every socket), GET /stats (sockets open now, opened in total)
#   python3 tools/tests/tick-engine-hub.py 8077
import asyncio, json, random, sys, time, math, datetime
from zoneinfo import ZoneInfo
from urllib.parse import urlparse, parse_qs
from websockets.asyncio.server import serve
from websockets.http11 import Response
from websockets.datastructures import Headers

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8077
EPOCH = int(time.time() * 1000)
MIN = 60000
tape = []  # [ts_ms, px, size, side], seq = index + 1
rnd = random.Random(5)
p = 28400 / 0.25
# 8 h of history, ~6 trades/s (enough for 300 x 500-tick bars)
# DAYS mode (history-gap2 test): argv[2] = record days, argv[3] = hours of quiet before now (a weekend), one trade every 20 s
REC_DAYS = float(sys.argv[2]) if len(sys.argv) > 2 else 0
QUIET_H = float(sys.argv[3]) if len(sys.argv) > 3 else 0
t = (EPOCH - (REC_DAYS * 86400000 if REC_DAYS else 8 * 3600000)) // MIN * MIN
REC = int(t)
LIVE = (EPOCH - 3600000) // MIN * MIN if not REC_DAYS else REC
asked = set()
END = EPOCH - QUIET_H * 3600000
while t < END:
    t += rnd.randint(19000, 21000) if REC_DAYS else rnd.randint(0, 330); p += rnd.randint(-2, 2)
    tape.append([int(t), p * 0.25, rnd.randint(1, 4), 1 if rnd.random() < 0.5 else -1])
socks = set(); opened = 0; protos = []  # per socket opened: [subprotocol list sent, token present]

def spec(tf):
    if tf.endswith('S'): return ('s', int(tf[:-1]) * 1000)
    if tf == 'D': return ('D', 86400000)
    return ('m', int(tf) * MIN)

def bars(tf, frm, to):
    k, ms = spec(tf); out = []
    for x in tape:
        if x[0] < frm or x[0] >= to: continue
        b = x[0] // ms * ms
        if out and out[-1][0] == b:
            o = out[-1]; o[2] = max(o[2], x[1]); o[3] = min(o[3], x[1]); o[4] = x[1]; o[5] += x[2]; o[6] += x[2] if x[3] > 0 else 0
        else: out.append([b, x[1], x[1], x[1], x[1], x[2], x[2] if x[3] > 0 else 0])
    return out

NY = ZoneInfo('America/New_York')
def session_open(ms):
    d = datetime.datetime.fromtimestamp(ms / 1000, NY)
    day = d.date() if d.hour >= 18 else d.date() - datetime.timedelta(days=1)
    return int(datetime.datetime(day.year, day.month, day.day, 18, tzinfo=NY).timestamp() * 1000)

def tick_bars(n, to, limit):
    out = []; idx = 0; nxt = -1; last = -10 ** 18; k = 0
    for x in tape:
        if x[0] >= to: break
        if x[0] >= nxt: so = session_open(x[0]); nxt = session_open(so + 25 * 3600000); idx = 0
        if idx % n == 0:
            tm = max(x[0], last + 1); out.append([tm, x[1], x[1], x[1], x[1], 0, 0]); last = tm; k = 0
        idx += 1; o = out[-1]; o[2] = max(o[2], x[1]); o[3] = min(o[3], x[1]); o[4] = x[1]; o[5] += x[2]; o[6] += x[2] if x[3] > 0 else 0; k += 1
    return out[-limit:], (k if out else 0)

CORS = [('access-control-allow-origin', '*'), ('access-control-expose-headers', 'x-te-lane'), ('access-control-allow-headers', 'authorization'), ('cache-control', 'no-store')]
def http(conn, req):
    u = urlparse(req.path); q = {k: v[0] for k, v in parse_qs(u.query).items()}
    if u.path == '/ts-live': return None
    if u.path == '/te-bars' and q.get('tf', '').endswith('T'):
        now = int(time.time() * 1000); to = int(float(q.get('to', now + MIN))); n = int(q['tf'][:-1]); lim = int(q.get('limit', 500))
        b, c = tick_bars(n, to, lim)
        body = {'sym': q.get('sym'), 'tf': q['tf'], 'b': b, 'rec': REC, 'e': EPOCH, 'q': len(tape), 'c': c, 'more': 0, 'cut': None}
        return Response(200, 'OK', Headers(CORS + [('content-type', 'application/json'), ('x-te-lane', 'live')]), json.dumps(body).encode())
    if u.path == '/te-bars':
        k, ms = spec(q.get('tf', '1')); now = int(time.time() * 1000)
        frm = int(float(q.get('from', now - 3600000))) // ms * ms; to = int(float(q.get('to', now + MIN)))
        rec = -(-REC // ms) * ms if k != 'D' else REC + 86400000 * 10
        more = 0
        if k == 's' and frm < LIVE and (q.get('tf'), frm, to) not in asked:   # archive emulation: the first ask of an old range is cut short
            asked.add((q.get('tf'), frm, to)); more = 1; rec = -(-LIVE // ms) * ms
        body = {'sym': q.get('sym'), 'tf': q.get('tf'), 'b': [b for b in bars(q.get('tf', '1'), max(frm, rec), to)], 'rec': rec, 'e': EPOCH, 'q': len(tape), 'more': more, 'cut': None}
        return Response(200, 'OK', Headers(CORS + [('content-type', 'application/json'), ('x-te-lane', 'live')]), json.dumps(body).encode())
    if u.path == '/kill':
        for s in list(socks): asyncio.get_event_loop().create_task(s.close(4000, 'killed'))
        return Response(200, 'OK', Headers(CORS), b'killed')
    if u.path == '/ask-count':
        return Response(200, 'OK', Headers(CORS + [('content-type', 'application/json')]), json.dumps({'asked': len(asked)}).encode())
    if u.path == '/stats':
        return Response(200, 'OK', Headers(CORS + [('content-type', 'application/json')]), json.dumps({'open': len(socks), 'opened': opened, 'seq': len(tape), 'protos': protos[-20:]}).encode())
    if req.headers.get('access-control-request-method') or u.path:
        return Response(204 if req.headers.get('access-control-request-method') else 404, 'X', Headers(CORS), b'')

async def client(ws):
    global opened
    socks.add(ws); opened += 1; subs = {}
    pr = [x.strip() for x in (ws.request.headers.get('Sec-WebSocket-Protocol') or '').split(',') if x.strip()]
    protos.append([pr[0] if pr else '', len(pr) > 1 and len(pr[1]) > 0])
    try:
        await ws.send(json.dumps({'event': 'hub_attached', 'state': 'live', 'tier': 'book', 'te': {'e': EPOCH}}))
        async def pump():
            last_ping = 0
            while True:
                await asyncio.sleep(0.1)
                now = time.time()
                if now - last_ping > 5: last_ping = now; await ws.send(json.dumps({'event': 'ping', 'up': 0, 'state': 'live'}))
                for sym, seq in list(subs.items()):
                    if seq < len(tape):
                        part = tape[seq:seq + 4000]
                        await ws.send(json.dumps({'type': 'tt', 'symbol': sym, 'e': EPOCH, 'q': seq + 1, 't': [[x[1], x[2], x[3], x[0]] for x in part]}))
                        subs[sym] = seq + len(part)
        task = asyncio.create_task(pump())
        async for m in ws:
            try: m = json.loads(m)
            except Exception: continue
            if m.get('op') == 'tsub' and (m.get('symbol') == 'NQ' or REC_DAYS):   # DAYS mode: every symbol gets the same tape
                sy = m.get('symbol'); s = m.get('since')
                if s is not None and m.get('e') == EPOCH and 0 <= s <= len(tape): subs[sy] = s
                elif s is not None: await ws.send(json.dumps({'type': 'resync', 'symbol': sy, 'e': EPOCH})); subs[sy] = len(tape)
                else: subs[sy] = len(tape)
            elif m.get('op') == 'tunsub': subs.pop(m.get('symbol'), None)
        task.cancel()
    finally:
        socks.discard(ws)

async def trades():
    global p
    while True:
        await asyncio.sleep(rnd.uniform(0.01, 0.12) if not REC_DAYS else 1)
        if QUIET_H: continue   # weekend: no trades
        p += rnd.randint(-1, 1)
        tape.append([int(time.time() * 1000), p * 0.25, rnd.randint(1, 5), 1 if rnd.random() < 0.5 else -1])

async def main():
    asyncio.create_task(trades())
    async with serve(client, '127.0.0.1', PORT, process_request=http, subprotocols=['tz-auth']):
        print('hub on', PORT, flush=True); await asyncio.Future()
asyncio.run(main())
