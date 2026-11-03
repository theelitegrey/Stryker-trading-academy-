"""TradeZoro Data Bridge, cTrader mode.  python ctrader_main.py   (the bridge engineer can fold this into main.py as a third choice.)"""
import asyncio, os, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "helper"))
from bridge_core import Bridge, TokenStore
from ctrader_source import CTraderSource


async def amain():
    base = Path(os.environ.get("APPDATA") or Path.home() / ".config") / "TradeZoroBridge"; base.mkdir(parents=True, exist_ok=True)
    kf = base / "ctrader.key"
    key = kf.read_text().strip() if kf.exists() else None
    src = CTraderSource(key)
    if not key: kf.write_text(src.key)
    await src.start()
    br = Bridge(src, TokenStore(base / "ctrader.tok")); srv = await br.serve(); code = br.new_code()
    print("TradeZoro Data Bridge (cTrader, beta). Data only. Listens on this computer only.")
    print("cBot Link key (paste into the cBot parameter once): %s" % src.key)
    print("Pairing code (tradezoro.com > Data source > cTrader > Pair): %s %s  (valid 2 minutes)" % (code[:4], code[4:]))
    await srv.wait_closed()

if __name__ == "__main__":
    try: asyncio.run(amain())
    except KeyboardInterrupt: pass
