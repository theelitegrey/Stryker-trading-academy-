"""TradeZoro Data Bridge: shared server + protocol. DATA ONLY (no order/account/position message exists).
Protocol list: ../protocol.json (same file the site tests against). Design: stryker-notes/reports/workers/byo-bridge.md
"""
import asyncio, hashlib, hmac, json, os, re, secrets, sys, time
from pathlib import Path

PROTO = json.loads((Path(__file__).resolve().parent.parent / "protocol.json").read_text()) if (Path(__file__).resolve().parent.parent / "protocol.json").exists() else json.loads((Path(getattr(sys, "_MEIPASS", ".")) / "protocol.json").read_text())
C2H, H2C = PROTO["c2h"], PROTO["h2c"]
SYM = re.compile(PROTO["symbolPattern"])
ORIGIN = PROTO["origin"]
MAX_SYMS = PROTO["maxSubscribe"]
TFS = {"1", "5", "15", "30", "60", "120", "240", "D", "W", "M"}


class ProtocolError(Exception):
    pass


def parse(raw):
    """Validate ONE client frame against the exact allow-list. Anything else raises."""
    if isinstance(raw, bytes) or len(raw) > PROTO["maxFrameBytes"]:
        raise ProtocolError("frame")
    o = json.loads(raw)
    if not isinstance(o, dict) or o.get("t") not in C2H or any(k != "t" and k not in C2H[o["t"]] for k in o):
        raise ProtocolError("type")
    syms = o.get("syms", [])
    if not isinstance(syms, list) or len(syms) > MAX_SYMS:
        raise ProtocolError("syms")
    for s in [o.get("sym")] + syms if o.get("sym") is not None else syms:
        if not isinstance(s, str) or not SYM.match(s):
            raise ProtocolError("symbol")
    if o["t"] == "history" and str(o.get("tf")) not in TFS:
        raise ProtocolError("tf")
    return o


def build(t, **kw):
    """Build ONE helper frame; refuses a type or field that is not in the allow-list."""
    if t not in H2C or any(k not in H2C[t] for k in kw):
        raise ProtocolError("outgoing " + t)
    return json.dumps({"t": t, **kw}, separators=(",", ":"))


def proof(token, direction, sn, hn, port, origin):
    return hmac.new(token.encode(), "|".join([direction, sn, hn, str(port), origin]).encode(), hashlib.sha256).hexdigest()


# ---------- token store: Windows DPAPI (current user); elsewhere a 0600 file (dev/test only) ----------
class TokenStore:
    def __init__(self, path):
        self.path = Path(path)

    def _enc(self, b):
        if sys.platform != "win32":
            return b
        import ctypes, ctypes.wintypes as w
        class BLOB(ctypes.Structure):
            _fields_ = [("n", w.DWORD), ("p", ctypes.POINTER(ctypes.c_char))]
        i = BLOB(len(b), ctypes.cast(ctypes.create_string_buffer(b, len(b)), ctypes.POINTER(ctypes.c_char))); o = BLOB()
        if not ctypes.windll.crypt32.CryptProtectData(ctypes.byref(i), None, None, None, None, 0, ctypes.byref(o)):
            raise OSError("DPAPI")
        return ctypes.string_at(o.p, o.n)

    def _dec(self, b):
        if sys.platform != "win32":
            return b
        import ctypes, ctypes.wintypes as w
        class BLOB(ctypes.Structure):
            _fields_ = [("n", w.DWORD), ("p", ctypes.POINTER(ctypes.c_char))]
        i = BLOB(len(b), ctypes.cast(ctypes.create_string_buffer(b, len(b)), ctypes.POINTER(ctypes.c_char))); o = BLOB()
        if not ctypes.windll.crypt32.CryptUnprotectData(ctypes.byref(i), None, None, None, None, 0, ctypes.byref(o)):
            raise OSError("DPAPI")
        return ctypes.string_at(o.p, o.n)

    def get(self):
        try:
            return self._dec(self.path.read_bytes()).decode()
        except Exception:
            return None

    def put(self, token):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_bytes(self._enc(token.encode()))
        try:
            os.chmod(self.path, 0o600)
        except OSError:
            pass

    def clear(self):
        try:
            self.path.unlink()
        except OSError:
            pass


class Source:
    """What a platform plugs in. All methods are data-only."""
    id = "?"
    caps = ["history", "ticks"]

    async def history(self, sym, tf, count=None, frm=None, to=None): raise NotImplementedError
    async def symbol(self, sym): return {"digits": 2, "desc": sym}
    async def subscribe(self, syms, depth, emit): raise NotImplementedError
    async def unsubscribe(self, syms): pass
    async def close(self): pass


class Bridge:
    def __init__(self, source, store, ports=None, dev_origins=(), log=print):
        self.src, self.store, self.log = source, store, log
        self.ports = ports or PROTO["ports"]
        self.origins = [ORIGIN] + list(dev_origins)
        self.code, self.code_exp, self.tries = None, 0, 0
        self.clients = 0
        self.connected_note = None
        self.port = None

    # one-time code, valid 2 minutes, 5 wrong tries then a new one
    def new_code(self):
        self.code = "%08d" % secrets.randbelow(10 ** 8)
        self.code_exp = time.time() + 120; self.tries = 0
        return self.code

    def revoke(self):
        self.store.clear()

    def _host_ok(self, host):
        return host in {"127.0.0.1:%d" % self.port, "localhost:%d" % self.port}

    async def handler(self, ws):
        if self.clients >= 2:
            return await ws.close(1013)
        self.clients += 1
        hn = secrets.token_hex(16); sn = None; authed = False; subs = set()
        origin = ws.request.headers.get("Origin")
        send = lambda t, **kw: ws.send(build(t, **kw))

        async def emit(msg):   # source -> client (already built frames or dicts)
            if authed:
                await ws.send(msg if isinstance(msg, str) else build(msg.pop("t"), **msg))
        try:
            await send("welcome", hn=hn, v=PROTO["version"], paired=bool(self.store.get()), source=self.src.id)
            while True:
                try:
                    raw = await asyncio.wait_for(ws.recv(), None if authed else 10)
                except asyncio.TimeoutError:
                    return await ws.close(1008)
                try:
                    m = parse(raw)
                except (ProtocolError, ValueError):
                    await send("error", code="protocol", msg="Message not allowed"); return await ws.close(1008)
                t = m["t"]
                if not authed:
                    if t == "pair":
                        if not self.code or time.time() > self.code_exp:
                            await send("error", code="bad-code", msg="That code has expired. Use the new code in the helper window.")
                            self.new_code(); continue
                        if not hmac.compare_digest(str(m.get("code")), self.code):
                            self.tries += 1
                            if self.tries >= 5: self.new_code()
                            await send("error", code="bad-code", msg="That code is not right."); continue
                        token = secrets.token_hex(32)
                        self.store.put(token); self.code = None
                        await send("paired", token=token); self.connected_note = "paired " + str(origin)
                        return await ws.close(1000)   # site reconnects with the mutual proof
                    if t == "hello":
                        token = self.store.get(); sn = m.get("sn")
                        if not token or not isinstance(sn, str) or len(sn) < 16 or not hmac.compare_digest(str(m.get("proof")), proof(token, "site", sn, hn, self.port, origin or "")):
                            await send("error", code="proof", msg="Pairing no longer valid. Pair again."); return await ws.close(1008)
                        authed = True; self.connected_note = "Connected: tradezoro.com"
                        await send("ready", proof=proof(token, "helper", sn, hn, self.port, origin or ""), source=self.src.id, caps=self.src.caps); continue
                    await send("error", code="auth", msg="Pair first"); return await ws.close(1008)
                if t == "ping": await send("pong")
                elif t == "history":
                    try:
                        bars = await self.src.history(m["sym"], str(m["tf"]), m.get("count"), m.get("from"), m.get("to"))
                        await send("bars", rid=m.get("rid"), sym=m["sym"], tf=str(m["tf"]), bars=bars)
                    except Exception as e:
                        await send("error", code="data", msg=str(e)[:120], rid=m.get("rid"))
                elif t == "symbol":
                    try:
                        i = await self.src.symbol(m["sym"]); await send("symbol", rid=m.get("rid"), sym=m["sym"], digits=i.get("digits", 2), desc=i.get("desc", m["sym"]))
                    except Exception as e:
                        await send("error", code="data", msg=str(e)[:120], rid=m.get("rid"))
                elif t == "subscribe":
                    new = [s for s in m.get("syms", []) if s not in subs]
                    subs.update(new)
                    try: await self.src.subscribe(new, bool(m.get("depth")), emit)
                    except Exception as e: await send("error", code="data", msg=str(e)[:120])
                elif t == "unsubscribe":
                    gone = [s for s in m.get("syms", []) if s in subs]; subs.difference_update(gone)
                    await self.src.unsubscribe(gone)
        except Exception:
            pass
        finally:
            self.clients -= 1
            if subs: await self.src.unsubscribe(list(subs))
            if authed: self.connected_note = None

    async def serve(self):
        import websockets
        for p in self.ports:
            self.port = p
            try:
                async def gate(conn, req):   # Host must be loopback (DNS rebinding); Origin is checked by serve(origins=)
                    if not self._host_ok(req.headers.get("Host", "")):
                        return conn.respond(403, "no\n")
                srv = await websockets.serve(self.handler, "127.0.0.1", p, origins=self.origins, process_request=gate, max_size=PROTO["maxFrameBytes"], ping_interval=20)
                self.log("TradeZoro Data Bridge listening on 127.0.0.1:%d" % p)
                return srv
            except OSError:
                continue
        raise OSError("No free port in %s" % self.ports)
