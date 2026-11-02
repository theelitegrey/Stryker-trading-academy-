#!/usr/bin/env python3
"""PLAN B relay: ONE Tick-stream socket on this server, compact frames POSTed to the book-recorder Worker.

Only used if Tick-stream refuses Cloudflare egress (the Worker then runs with TS_MODE=relay and opens no socket).
Needs: TICKSTREAM_API_KEY (tickstream.env), BOOK_RECORDER_URL + BOOK_INGEST_SECRET (feeder.env). Never logs the key.
The Worker answers every POST with {want: bool}: the socket is held only while someone watches or CME is open.
Per 250 ms batch: the LATEST book per symbol (full snapshot, so older ones are redundant) + every tick.
"""
import asyncio, json, os, sys, time, urllib.request
import websockets

KEY = os.environ.get("TICKSTREAM_API_KEY", "")
BASE = os.environ.get("BOOK_RECORDER_URL", "").rstrip("/")
SECRET = os.environ.get("BOOK_INGEST_SECRET", "")
SYMS = [s for s in os.environ.get("TS_SYMBOLS", "NQ,ES").split(",") if s]
WS = "wss://stream.tick-stream.xyz/v1/stream?key=" + KEY
BATCH_S, POLL_S, DEAD_SLOT_S = 0.25, 10, 50


def post(frames):
    req = urllib.request.Request(BASE + "/ts-ingest", data=json.dumps({"frames": frames}).encode(), method="POST",
                                 headers={"x-ingest-key": SECRET, "content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=5) as r:
        return json.loads(r.read() or b"{}")


async def hold():
    """One socket session. Returns the close code (4029 = over the 3-connection cap)."""
    books, ticks, want = {}, [], True
    async with websockets.connect(WS, ping_interval=None, max_size=4_000_000) as ws:
        for ch in ("book", "ticks"):
            await ws.send(json.dumps({"op": "subscribe", "channel": ch, "symbols": SYMS}))

        async def pump():
            nonlocal want
            while True:
                await asyncio.sleep(BATCH_S)
                frames = list(books.values()) + ticks[:200]
                books.clear(); del ticks[:200]
                if not frames:
                    continue
                try:
                    want = bool((await asyncio.to_thread(post, frames)).get("want", True))
                except Exception as e:
                    print("post failed:", type(e).__name__, flush=True)
                if not want:
                    await ws.close(); return

        task = asyncio.create_task(pump())
        try:
            async for raw in ws:
                m = json.loads(raw)
                t = m.get("type")
                if t == "ping":
                    await ws.send('{"op":"pong"}')
                elif t == "book":
                    books[m.get("symbol")] = m
                elif t == "tick":
                    ticks.append(m)
        finally:
            task.cancel()
    return 1000


async def main():
    if not (KEY and BASE and SECRET):
        sys.exit("missing TICKSTREAM_API_KEY / BOOK_RECORDER_URL / BOOK_INGEST_SECRET")
    back = 2
    while True:
        try:
            want = (await asyncio.to_thread(post, [])).get("want", False)   # cheap poll while no socket is held
        except Exception as e:
            print("poll failed:", type(e).__name__, flush=True); await asyncio.sleep(POLL_S); continue
        if not want:
            await asyncio.sleep(POLL_S); continue
        t0 = time.time()
        try:
            await hold(); print("session ended", flush=True)
        except websockets.ConnectionClosed as e:
            code = e.rcvd.code if e.rcvd else 0
            print("closed", code, flush=True)
            if code == 4029:
                await asyncio.sleep(DEAD_SLOT_S); continue
        except Exception as e:
            print("socket error:", type(e).__name__, flush=True)
        back = 2 if time.time() - t0 > 30 else min(60, back * 2)
        await asyncio.sleep(back)

asyncio.run(main())
