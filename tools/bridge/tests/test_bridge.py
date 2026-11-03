"""Run: python3 tools/bridge/tests/test_bridge.py   (needs `websockets`; no broker, no network beyond 127.0.0.1)"""
import ast, asyncio, json, sys, tempfile, unittest
from pathlib import Path
H = Path(__file__).resolve().parent.parent / "helper"
sys.path.insert(0, str(H))
import bridge_core as bc
from bridge_core import Bridge, TokenStore, ProtocolError, parse, build, proof
from fakes import FakeMT5, FakeIB, fake_lib
from mt5_source import MT5Source, FORBIDDEN
from ibkr_source import IBKRSource, FORBIDDEN_IB
import websockets

PORT = 48715


class Proto(unittest.TestCase):
    def test_orders_and_accounts_refused(self):
        for t in ["order", "order_send", "placeOrder", "cancel", "modify", "positions", "account", "balance", "trade", "buy", "sell", "executions", "login"]:
            with self.assertRaises(ProtocolError, msg=t): parse(json.dumps({"t": t}))
            with self.assertRaises(ProtocolError, msg=t): build(t)
        with self.assertRaises(ProtocolError): parse(json.dumps({"t": "subscribe", "syms": ["EURUSD"], "volume": 1}))   # extra field
        with self.assertRaises(ProtocolError): parse(json.dumps({"t": "history", "sym": "../x;", "tf": "1"}))
        with self.assertRaises(ProtocolError): parse(json.dumps({"t": "subscribe", "syms": ["A"] * 11}))
        with self.assertRaises(ProtocolError): parse("x" * 5000)
        with self.assertRaises(ProtocolError): parse(b"{}")

    def test_allowlist_names_are_clean(self):
        names = set(bc.C2H) | set(bc.H2C) | {k for v in (*bc.C2H.values(), *bc.H2C.values()) for k in v}
        self.assertFalse(names & set(bc.PROTO["forbiddenNames"]), names & set(bc.PROTO["forbiddenNames"]))


class Static(unittest.TestCase):
    def test_imports_and_calls(self):
        bad_calls = set(FORBIDDEN) | set(FORBIDDEN_IB)
        for f in H.glob("*.py"):
            if f.name in ("fakes.py",): continue
            tree = ast.parse(f.read_text())
            for n in ast.walk(tree):
                mods = [a.name for a in n.names] if isinstance(n, ast.Import) else [n.module] if isinstance(n, ast.ImportFrom) and n.module else []
                for m in mods:
                    if m.startswith("MetaTrader5"): self.assertEqual(f.name, "mt5_source.py", f.name)
                    if m.startswith(("ib_async", "ibapi", "ib_insync")): self.assertEqual(f.name, "ibkr_source.py", f.name)
                if isinstance(n, ast.Call):
                    fn = n.func
                    name = fn.attr if isinstance(fn, ast.Attribute) else fn.id if isinstance(fn, ast.Name) else ""
                    self.assertNotIn(name, bad_calls, "%s calls %s" % (f.name, name))
                    self.assertNotIn(name, {"setattr"} if f.name not in ("mt5_source.py", "ibkr_source.py") else set())
        nt = H.parent / "ninjatrader"
        if nt.exists():
            for f in nt.glob("*.cs"):
                src = f.read_text()
                for w in ["Account", "Order", "Position", "Execution", "SubmitOrder", "CancelOrder", "ChangeOrder", "NinjaTrader.Cbi.Account"]:
                    import re
                    self.assertIsNone(re.search(r"\b" + w + r"\b", re.sub(r"//.*|/\*.*?\*/", "", src, flags=re.S)), "%s mentions %s" % (f.name, w))

    def test_lockdown_raises(self):
        m = FakeMT5(); MT5Source(m)
        for n in FORBIDDEN:
            with self.assertRaises(RuntimeError, msg=n): getattr(m, n)()
        ib = FakeIB(); IBKRSource(ib, fake_lib()); asyncio.run(IBKRSource(ib, fake_lib()).start())
        for n in FORBIDDEN_IB:
            with self.assertRaises(RuntimeError, msg=n): getattr(ib, n)()
            with self.assertRaises(RuntimeError, msg=n): getattr(ib.client, n)()
        self.assertEqual(FakeMT5.calls, []); self.assertEqual([c for c in ib.calls if isinstance(c, str) and c != "cancelMkt"], [])


ORI = "https://tradezoro.com"


async def conn(origin=ORI, host=None, port=PORT):
    h = {"Origin": origin} if origin else {}
    if host: h["Host"] = host
    return await websockets.connect("ws://127.0.0.1:%d" % port, additional_headers=h)


async def rx(ws): return json.loads(await asyncio.wait_for(ws.recv(), 5))


async def login(br, token):
    ws = await conn(); w = await rx(ws); sn = "s" * 32
    await ws.send(json.dumps({"t": "hello", "sn": sn, "proof": proof(token, "site", sn, w["hn"], PORT, ORI)}))
    r = await rx(ws)
    return ws, w, sn, r


class Live(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.mkdtemp()
        self.src = MT5Source(FakeMT5())
        self.br = Bridge(self.src, TokenStore(Path(self.tmp) / "t"), ports=[PORT], log=lambda *a: None)
        self.srv = await self.br.serve()

    async def asyncTearDown(self):
        self.srv.close(); await self.srv.wait_closed()

    async def pair(self):
        code = self.br.new_code(); ws = await conn(); await rx(ws)
        await ws.send(json.dumps({"t": "pair", "code": code, "sn": "s" * 32})); m = await rx(ws)
        self.assertEqual(m["t"], "paired"); return m["token"]

    async def test_origin_and_host(self):
        for o in ["https://evil.example", "http://tradezoro.com", None, "null"]:
            with self.assertRaises(Exception, msg=str(o)):
                ws = await conn(o); await ws.recv()
        r, w = await asyncio.open_connection("127.0.0.1", PORT)   # DNS rebinding: right socket, wrong Host
        w.write(("GET / HTTP/1.1\r\nHost: evil.example:%d\r\nOrigin: %s\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n" % (PORT, ORI)).encode())
        self.assertIn(b" 403 ", await r.readline()); w.close()

    async def test_wrong_code_then_ok(self):
        code = self.br.new_code(); ws = await conn(); await rx(ws)
        await ws.send(json.dumps({"t": "pair", "code": "00000000" if code != "00000000" else "11111111", "sn": "s" * 32}))
        self.assertEqual((await rx(ws))["code"], "bad-code")
        await ws.send(json.dumps({"t": "pair", "code": code, "sn": "s" * 32})); self.assertEqual((await rx(ws))["t"], "paired")

    async def test_five_tries_rotates_code(self):
        code = self.br.new_code(); ws = await conn(); await rx(ws)
        for _ in range(5):
            await ws.send(json.dumps({"t": "pair", "code": "x1234567", "sn": "s" * 32})); await rx(ws)
        await ws.send(json.dumps({"t": "pair", "code": code, "sn": "s" * 32}))
        self.assertEqual((await rx(ws))["code"], "bad-code")

    async def test_no_data_before_auth_and_bad_proof(self):
        ws = await conn(); await rx(ws)
        await ws.send(json.dumps({"t": "subscribe", "syms": ["EURUSD"]})); self.assertEqual((await rx(ws))["code"], "auth")
        token = await self.pair()
        ws, w, sn, r = await login(self.br, "wrong" + token)
        self.assertEqual(r["code"], "proof")

    async def test_full_session_history_tick_and_order_refused(self):
        token = await self.pair()
        ws, w, sn, r = await login(self.br, token)
        self.assertEqual(r["t"], "ready")
        self.assertEqual(r["proof"], proof(token, "helper", sn, w["hn"], PORT, ORI))   # mutual proof the site checks
        await ws.send(json.dumps({"t": "history", "rid": 1, "sym": "EURUSD", "tf": "1", "count": 5}))
        b = await rx(ws); self.assertEqual((b["t"], len(b["bars"]), b["rid"]), ("bars", 5, 1)); self.assertGreater(b["bars"][0]["time"], 1e12)
        await ws.send(json.dumps({"t": "symbol", "rid": 2, "sym": "EURUSD"})); self.assertEqual((await rx(ws))["digits"], 5)
        await ws.send(json.dumps({"t": "subscribe", "syms": ["EURUSD"], "depth": True}))
        got = set()
        for _ in range(8):
            m = await rx(ws); got.add(m["t"])
            if {"tick", "depth"} <= got: break
        self.assertTrue({"tick", "depth"} <= got, got)
        await ws.send(json.dumps({"t": "order_send", "sym": "EURUSD", "volume": 1}))
        while True:
            m = await rx(ws)
            if m["t"] == "error": break
        self.assertEqual(m["code"], "protocol")
        with self.assertRaises(Exception):
            for _ in range(10): await asyncio.wait_for(ws.recv(), 2)   # connection is closed
        self.assertEqual(FakeMT5.calls, [])

    async def test_revoke(self):
        token = await self.pair(); self.br.revoke()
        ws, w, sn, r = await login(self.br, token); self.assertEqual(r["code"], "proof")


class IBLive(unittest.IsolatedAsyncioTestCase):
    async def test_ibkr_fake_tws(self):
        ib = FakeIB(); src = IBKRSource(ib, fake_lib()); await src.start()
        tmp = tempfile.mkdtemp(); br = Bridge(src, TokenStore(Path(tmp) / "t"), ports=[PORT], log=lambda *a: None); srv = await br.serve()
        try:
            code = br.new_code(); ws = await conn(); await rx(ws)
            await ws.send(json.dumps({"t": "pair", "code": code, "sn": "s" * 32})); token = (await rx(ws))["token"]
            ws, w, sn, r = await login(br, token); self.assertEqual((r["t"], r["source"]), ("ready", "ibkr"))
            await ws.send(json.dumps({"t": "history", "rid": 3, "sym": "AAPL", "tf": "5", "count": 3}))
            b = await rx(ws); self.assertEqual(len(b["bars"]), 3)
            await ws.send(json.dumps({"t": "subscribe", "syms": ["AAPL", "ES 12-26"], "depth": False}))
            t = await rx(ws); self.assertEqual(t["t"], "tick"); self.assertGreater(t["ts"], 1e12)
            await ws.send(json.dumps({"t": "history", "rid": 4, "sym": "NOPE", "tf": "5", "count": 3}))
            while True:
                m = await rx(ws)
                if m.get("rid") == 4: break
            self.assertEqual(m["t"], "error")
            self.assertIn(("connect", "127.0.0.1", True), ib.calls)              # read-only connection
            self.assertIn(("mkt", False, False), ib.calls)                       # no snapshots
            self.assertEqual([c for c in ib.calls if isinstance(c, str) and c not in ("cancelMkt",)], [])
        finally:
            srv.close(); await srv.wait_closed()


if __name__ == "__main__":
    unittest.main(verbosity=1)
