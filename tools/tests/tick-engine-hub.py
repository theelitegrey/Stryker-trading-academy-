# Fixture hub for the tick-engine browser test (no Worker, no key, no provider). Speaks the engine's protocol:
#   GET /te-bars?sym&tf&from&to -> {b, rec, e, q} built from its own tape (x-te-lane: live)
#   WS  /ts-live (subprotocol tz-auth) -> hub_attached, ping every 5 s, {op:'tsub', symbol, since, e} -> {type:'tt', e, q, t} with replay
#   GET /kill (drop every socket), GET /stats (sockets open now, opened in total)
#   python3 tools/tests/tick-engine-hub.py 8077
import asyncio, json, random, sys, time, math
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
# 3 h of history, ~3 trades/s
t = (EPOCH - 3 * 3600000) // MIN * MIN
REC = t
while t < EPOCH:
    t += rnd.randint(0, 600); p += rnd.randint(-2, 2)
    tape.append([t, p * 0.25, rnd.randint(1, 4), 1 if rnd.random() < 0.5 else -1])
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

CORS = [('access-control-allow-origin', '*'), ('access-control-expose-headers', 'x-te-lane'), ('access-control-allow-headers', 'authorization'), ('cache-control', 'no-store')]
def http(conn, req):
    u = urlparse(req.path); q = {k: v[0] for k, v in parse_qs(u.query).items()}
    if u.path == '/ts-live': return None
    if u.path == '/te-bars':
        k, ms = spec(q.get('tf', '1')); now = int(time.time() * 1000)
        frm = int(float(q.get('from', now - 3600000))) // ms * ms; to = int(float(q.get('to', now + MIN)))
        rec = -(-REC // ms) * ms if k != 'D' else REC + 86400000 * 10
        body = {'sym': q.get('sym'), 'tf': q.get('tf'), 'b': [b for b in bars(q.get('tf', '1'), max(frm, rec), to)], 'rec': rec, 'e': EPOCH, 'q': len(tape), 'cut': None}
        return Response(200, 'OK', Headers(CORS + [('content-type', 'application/json'), ('x-te-lane', 'live')]), json.dumps(body).encode())
    if u.path == '/kill':
        for s in list(socks): asyncio.get_event_loop().create_task(s.close(4000, 'killed'))
        return Response(200, 'OK', Headers(CORS), b'killed')
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
            if m.get('op') == 'tsub' and m.get('symbol') == 'NQ':
                s = m.get('since')
                if s is not None and m.get('e') == EPOCH and 0 <= s <= len(tape): subs['NQ'] = s
                elif s is not None: await ws.send(json.dumps({'type': 'resync', 'symbol': 'NQ', 'e': EPOCH})); subs['NQ'] = len(tape)
                else: subs['NQ'] = len(tape)
            elif m.get('op') == 'tunsub': subs.pop(m.get('symbol'), None)
        task.cancel()
    finally:
        socks.discard(ws)

async def trades():
    global p
    while True:
        await asyncio.sleep(rnd.uniform(0.01, 0.12))
        p += rnd.randint(-1, 1)
        tape.append([int(time.time() * 1000), p * 0.25, rnd.randint(1, 5), 1 if rnd.random() < 0.5 else -1])

async def main():
    asyncio.create_task(trades())
    async with serve(client, '127.0.0.1', PORT, process_request=http, subprotocols=['tz-auth']):
        print('hub on', PORT, flush=True); await asyncio.Future()
asyncio.run(main())
