"""Run: python3 tools/bridge/tests/test_ctrader.py  (needs `websockets`). Fake cBot + fake browser; no cTrader here.
The C# is NOT compiled or run in this test: it is only scanned for trading APIs."""
import asyncio, json, re, sys, tempfile, unittest
from pathlib import Path
T = Path(__file__).resolve().parent.parent
sys.path[:0] = [str(T / "helper"), str(T / "ctrader")]
from bridge_core import Bridge, TokenStore, proof
from ctrader_source import CTraderSource
import websockets

CS = (T / "ctrader" / "TradeZoroBridge.cs").read_text()
PORT, LP, ORI = 48715, 48720, "https://tradezoro.com"
BAN = r"\b(ExecuteMarket\w*|Place\w*Order|ModifyPosition|ModifyPendingOrder|ModifyTrailingStop\w*|ClosePosition|ClosePositionAsync|CancelPendingOrder\w*|Positions|PendingOrders|Account|History|Orders?|Trade\w*|Balance|Equity|Margin\w*|Deal\w*|Portfolio|Execution\w*|FullAccess|System\.IO|File\w*|Registry|Process)\b"


class Static(unittest.TestCase):
    def code(self): return re.sub(r"//.*|/\*.*?\*/", "", CS, flags=re.S)
    def test_no_trading_api(self):
        hits = re.findall(BAN, re.sub(r'"[^"\n]*"', '""', self.code()))
        self.assertEqual(hits, [], "trading/account/file API in cBot")
    def test_scanner_would_catch(self):
        for bad in ["ExecuteMarketOrder(TradeType.Buy,s,1)", "PlaceLimitOrder(", "Positions.Count", "Account.Balance", "ClosePosition(p)", "PendingOrders", "ModifyPosition(p,1,2)"]:
            self.assertTrue(re.search(BAN, bad), bad)
    def test_permission(self): self.assertIn("AccessRights = AccessRights.Internet", CS)
    def test_loopback_only(self): self.assertEqual(set(re.findall(r'new Uri\("([^"]+)"', CS)), {"ws://127.0.0.1:48720"})


class Flow(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.src = CTraderSource("k" * 16, LP); await self.src.start()
        self.br = Bridge(self.src, TokenStore(Path(tempfile.mkdtemp()) / "t"), ports=[PORT], log=lambda *a: None); self.srv = await self.br.serve()
        self.bot = await websockets.connect("ws://127.0.0.1:%d" % LP)
        await self.bot.send(json.dumps({"t": "link", "key": "k" * 16, "v": 1})); await asyncio.sleep(0.1)
        self.serve_task = asyncio.create_task(self.fake_bot())
    async def asyncTearDown(self):
        self.serve_task.cancel(); await self.bot.close(); self.srv.close(); await self.srv.wait_closed(); await self.src.close()
    async def fake_bot(self):   # what the C# does
        async for raw in self.bot:
            m = json.loads(raw)
            if m["t"] == "hist": await self.bot.send(json.dumps({"t": "bars", "rid": m["rid"], "sym": m["sym"], "tf": m["tf"], "bars": [{"time": 1_700_000_000_000 + i * 60000, "open": 1, "high": 2, "low": 0.5, "close": 1.5, "volume": 3} for i in range(m.get("count", 3))]}))
            elif m["t"] == "sym": await self.bot.send(json.dumps({"t": "sym", "rid": m["rid"], "sym": m["sym"], "digits": 5, "desc": m["sym"]}))
            elif m["t"] == "sub":
                await self.bot.send(json.dumps({"t": "tick", "sym": m["syms"][0], "price": 1.1, "ts": 1_700_000_000_000, "size": 0}))
    async def site(self):
        ws = await websockets.connect("ws://127.0.0.1:%d" % PORT, additional_headers={"Origin": ORI}); w = json.loads(await ws.recv())
        code = self.br.new_code(); await ws.send(json.dumps({"t": "pair", "code": code, "sn": "s" * 32})); p = json.loads(await ws.recv()); self.assertEqual(p["t"], "paired"); tok = p["token"]
        ws = await websockets.connect("ws://127.0.0.1:%d" % PORT, additional_headers={"Origin": ORI}); w = json.loads(await ws.recv()); sn = "s" * 32
        await ws.send(json.dumps({"t": "hello", "sn": sn, "proof": proof(tok, "site", sn, w["hn"], PORT, ORI)})); r = json.loads(await ws.recv())
        self.assertEqual((r["t"], r["source"]), ("ready", "ctrader")); return ws, tok
    async def test_end_to_end(self):
        ws, tok = await self.site()
        await ws.send(json.dumps({"t": "history", "rid": 1, "sym": "EURUSD", "tf": "1", "count": 4})); b = json.loads(await asyncio.wait_for(ws.recv(), 5))
        self.assertEqual((b["t"], len(b["bars"])), ("bars", 4))
        await ws.send(json.dumps({"t": "symbol", "rid": 2, "sym": "EURUSD"})); self.assertEqual(json.loads(await asyncio.wait_for(ws.recv(), 5))["digits"], 5)
        await ws.send(json.dumps({"t": "subscribe", "syms": ["EURUSD"], "depth": False})); self.assertEqual(json.loads(await asyncio.wait_for(ws.recv(), 5))["t"], "tick")
        await ws.send(json.dumps({"t": "order", "sym": "EURUSD"})); self.assertEqual(json.loads(await asyncio.wait_for(ws.recv(), 5))["t"], "error")
    async def test_wrong_link_key_refused(self):
        w = await websockets.connect("ws://127.0.0.1:%d" % LP); await w.send(json.dumps({"t": "link", "key": "x" * 16, "v": 1}))
        with self.assertRaises(websockets.ConnectionClosed): await asyncio.wait_for(w.recv(), 3)
    async def test_cbot_cannot_send_unknown_frames(self):
        self.serve_task.cancel(); await asyncio.sleep(0.05)
        await self.bot.send(json.dumps({"t": "position", "id": 1}))
        with self.assertRaises(websockets.ConnectionClosed): await asyncio.wait_for(self.bot.recv(), 3)
    async def test_no_bot_gives_clear_error(self):
        await self.bot.close(); await asyncio.sleep(0.2); ws, tok = await self.site()
        await ws.send(json.dumps({"t": "history", "rid": 1, "sym": "EURUSD", "tf": "1", "count": 2})); m = json.loads(await asyncio.wait_for(ws.recv(), 5))
        self.assertEqual(m["t"], "error"); self.assertIn("cBot", m["msg"])

if __name__ == "__main__": unittest.main()
