"""TradeZoroBridge.exe --selftest: starts the helper on 127.0.0.1 with FAKE terminals, pairs, runs the protocol, checks orders are refused.
No broker, no internet, no real data. Exit code 0 = pass."""
import asyncio, json, logging, tempfile
from pathlib import Path
from bridge_core import Bridge, TokenStore, proof

logging.getLogger("websockets").setLevel(logging.CRITICAL)
ORI = "https://tradezoro.com"


async def _rx(ws):
    return json.loads(await asyncio.wait_for(ws.recv(), 5))


async def _one(name, src, sym):
    import websockets
    br = Bridge(src, TokenStore(Path(tempfile.mkdtemp()) / "selftest.tok"), log=lambda *a: None)
    srv = await br.serve(); port = br.port
    try:
        url = "ws://127.0.0.1:%d" % port
        hdr = {"Origin": ORI}
        code = br.new_code(); sn = "s" * 32
        async with websockets.connect(url, additional_headers=hdr) as ws:
            assert (await _rx(ws))["t"] == "welcome"
            await ws.send(json.dumps({"t": "pair", "code": code, "sn": sn}))
            token = (await _rx(ws))["token"]
        async with websockets.connect(url, additional_headers=hdr) as ws:
            w = await _rx(ws)
            await ws.send(json.dumps({"t": "hello", "sn": sn, "proof": proof(token, "site", sn, w["hn"], port, ORI)}))
            r = await _rx(ws)
            assert r["t"] == "ready" and r["proof"] == proof(token, "helper", sn, w["hn"], port, ORI), "helper proof"
            await ws.send(json.dumps({"t": "history", "rid": 1, "sym": sym, "tf": "1", "count": 5}))
            b = await _rx(ws); assert b["t"] == "bars" and len(b["bars"]) == 5, "history"
            await ws.send(json.dumps({"t": "subscribe", "syms": [sym], "depth": False}))
            for _ in range(10):
                m = await _rx(ws)
                if m["t"] == "tick": break
            assert m["t"] == "tick", "tick"
            await ws.send(json.dumps({"t": "order_send", "sym": sym, "volume": 1}))
            for _ in range(10):
                m = await _rx(ws)
                if m["t"] == "error": break
            assert m.get("code") == "protocol", "order refused"
        try:
            async with websockets.connect(url, additional_headers={"Origin": "https://evil.example"}) as ws:
                raise AssertionError("bad origin accepted")
        except websockets.exceptions.InvalidStatus as e:
            assert e.response.status_code == 403, "bad origin must get 403"
        print("  %s: listening on 127.0.0.1:%d, paired, welcome/ready proof OK, history OK, live tick OK, order refused, wrong origin refused" % (name, port))
    finally:
        srv.close(); await srv.wait_closed()


async def _all():
    from fakes import FakeMT5, FakeIB, fake_lib
    from mt5_source import MT5Source
    from ibkr_source import IBKRSource
    s = MT5Source(FakeMT5()); s.start(); await _one("MT5 (fake terminal)", s, "EURUSD")
    s = IBKRSource(FakeIB(), fake_lib()); await s.start(); await _one("IBKR (fake TWS)", s, "AAPL")


def run():
    print("TradeZoro Data Bridge self-test (fake terminals, nothing leaves this computer)")
    try:
        asyncio.run(_all())
    except BaseException as e:
        print("SELFTEST FAIL: %r" % (e,)); return 1
    print("SELFTEST PASS"); return 0
