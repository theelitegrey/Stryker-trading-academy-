"""cTrader source for the TradeZoro Data Bridge. DATA ONLY.
The member's cTrader cBot (TradeZoroBridge.cs) connects OUT to 127.0.0.1:48720 and answers data requests; this Source
passes them to the browser-facing Bridge (bridge_core). No MetaTrader/IB/cTrader library is imported: just JSON frames."""
import asyncio, hmac, json, re, secrets
import websockets
from bridge_core import Source

LINK_PORT = 48720
SYM = re.compile(r"^[A-Za-z0-9._\-/ ]{1,32}$")
# Only these frame types may come FROM the cBot. Anything else (including any order/account looking type) closes the link.
FROM_BOT = {"link": ["key", "v"], "bars": ["rid", "sym", "tf", "bars"], "sym": ["rid", "sym", "digits", "desc"],
            "tick": ["sym", "price", "ts", "size"], "depth": ["sym", "bids", "asks"], "err": ["rid", "msg"]}
TO_BOT = {"hist", "sym", "sub", "unsub"}


class CTraderSource(Source):
    id = "ctrader"
    caps = ["history", "ticks", "depth"]

    def __init__(self, link_key=None, port=LINK_PORT):
        self.key = link_key or secrets.token_hex(8)
        self.port, self.bot, self.emit, self.pend, self.n, self.srv, self.subs = port, None, set(), {}, 1, None, set()

    async def start(self):
        async def gate(conn, req):   # loopback only: Host must be 127.0.0.1/localhost (DNS rebinding); the secret link key is the real check, a web page cannot know it
            if (req.headers.get("Host") or "").split(":")[0] not in ("127.0.0.1", "localhost"): return conn.respond(403, "no\n")
        self.srv = await websockets.serve(self._handler, "127.0.0.1", self.port, process_request=gate, max_size=4_000_000, max_queue=8)

    async def _handler(self, ws):
        try:
            first = json.loads(await asyncio.wait_for(ws.recv(), 10))
            if first.get("t") != "link" or not hmac.compare_digest(str(first.get("key")), self.key) or set(first) - set(FROM_BOT["link"]) - {"t"}:
                return await ws.close(4001, "bad key")
            if self.bot: await self.bot.close()
            self.bot = ws
            if self.subs: await self._tx({"t": "sub", "syms": sorted(self.subs), "depth": getattr(self, "depth", False)})
            async for raw in ws:
                m = json.loads(raw)
                t, ok = m.get("t"), FROM_BOT.get(m.get("t"))
                if not ok or t == "link" or set(m) - set(ok) - {"t"}: return await ws.close(4002, "bad frame")
                if "sym" in m and not (isinstance(m["sym"], str) and SYM.match(m["sym"])): return await ws.close(4002, "bad symbol")
                if t in ("bars", "sym", "err") and m.get("rid") in self.pend:
                    f = self.pend.pop(m["rid"])
                    if not f.done(): f.set_exception(RuntimeError(str(m.get("msg"))[:200])) if t == "err" else f.set_result(m)
                elif t in ("tick", "depth"):
                    for e in list(self.emit):
                        try: await e(m)
                        except Exception: self.emit.discard(e)
        except (asyncio.TimeoutError, ValueError, websockets.ConnectionClosed):
            pass
        finally:
            if self.bot is ws: self.bot = None

    async def _tx(self, o):
        if o["t"] not in TO_BOT: raise RuntimeError("not allowed")
        if not self.bot: raise RuntimeError("Open cTrader and start the TradeZoro Bridge cBot on a chart")
        await self.bot.send(json.dumps(o))

    async def _ask(self, o, to=20):
        rid = str(self.n); self.n += 1; o["rid"] = rid
        f = self.pend[rid] = asyncio.get_running_loop().create_future()
        try:
            await self._tx(o); return await asyncio.wait_for(f, to)
        except asyncio.TimeoutError: raise RuntimeError("cTrader did not answer")
        finally: self.pend.pop(rid, None)

    async def history(self, sym, tf, count=None, frm=None, to=None):
        q = {"t": "hist", "sym": sym, "tf": tf}
        if frm is not None: q["from"] = int(frm); q["to"] = int(to) if to is not None else None
        else: q["count"] = min(int(count or 500), 5000)
        if q.get("to") is None: q.pop("to", None)
        return (await self._ask(q))["bars"]

    async def symbol(self, sym):
        m = await self._ask({"t": "sym", "sym": sym}); return {"digits": int(m.get("digits", 2)), "desc": str(m.get("desc") or sym)[:60]}

    async def subscribe(self, syms, depth, emit):
        self.subs.update(syms); self.emit.add(emit); self.depth = depth
        await self._tx({"t": "sub", "syms": list(syms), "depth": bool(depth)})

    async def unsubscribe(self, syms):
        self.subs.difference_update(syms)
        try: await self._tx({"t": "unsub", "syms": list(syms)})
        except RuntimeError: pass

    async def close(self):
        if self.srv: self.srv.close()
