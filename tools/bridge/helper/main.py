"""TradeZoro Data Bridge (MT5 + Interactive Brokers). DATA ONLY: prices to your own browser tab, nothing else.
Run:  TradeZoroBridge.exe mt5 | ibkr [--tws-port 7497]      Test mode (no broker needed): --fake
"""
import argparse, asyncio, os, sys
from pathlib import Path
from bridge_core import Bridge, TokenStore

BANNER = """TradeZoro Data Bridge (beta). Data only: no orders, no account, no balances.
Listens on this computer only (127.0.0.1). Prices go to tradezoro.com in your browser, never through TradeZoro servers."""


async def amain(a):
    if a.source == "mt5":
        from mt5_source import MT5Source
        if a.fake:
            from fakes import FakeMT5; src = MT5Source(FakeMT5())
        else: src = MT5Source()
        src.start()
    else:
        from ibkr_source import IBKRSource
        if a.fake:
            from fakes import FakeIB, fake_lib; src = IBKRSource(FakeIB(), fake_lib())
        else: src = IBKRSource(port=a.tws_port)
        await src.start()
    store = TokenStore(Path(os.environ.get("APPDATA") or Path.home() / ".config") / "TradeZoroBridge" / (a.source + ".tok"))
    if a.revoke:
        store.clear(); print("Pairing removed."); return
    br = Bridge(src, store, dev_origins=a.dev_origin)
    srv = await br.serve()
    print(BANNER)
    code = br.new_code()
    print("\nPairing code (type it on tradezoro.com > Data source > Pair): %s %s\n(valid 2 minutes; restart the helper for a new one; --revoke removes the pairing)" % (code[:4], code[4:]))
    try:
        await srv.wait_closed()
    finally:
        await src.close()


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=BANNER)
    ap.add_argument("source", nargs="?", choices=["mt5", "ibkr"]); ap.add_argument("--selftest", action="store_true", help="check the helper works, no broker needed"); ap.add_argument("--fake", action="store_true", help="test mode, fake data")
    ap.add_argument("--tws-port", type=int, default=7497); ap.add_argument("--revoke", action="store_true")
    ap.add_argument("--dev-origin", action="append", default=[], help="TEST ONLY: extra allowed Origin")
    a = ap.parse_args()
    if a.selftest:
        import selftest; sys.exit(selftest.run())
    if not a.source: ap.error("choose mt5 or ibkr")
    try: asyncio.run(amain(a))
    except KeyboardInterrupt: pass
