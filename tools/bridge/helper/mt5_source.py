"""MetaTrader 5 source. The ONLY file that imports MetaTrader5. DATA ONLY: every trading/account function is replaced by one
that raises before any call is made (lockdown), and tests/test_bridge.py proves it."""
import asyncio, time
from bridge_core import Source

# Everything in the MetaTrader5 package that trades or reads the account. Replaced at start-up.
FORBIDDEN = ["order_send", "order_check", "order_calc_margin", "order_calc_profit", "positions_get", "positions_total", "orders_get", "orders_total",
             "account_info", "history_deals_get", "history_deals_total", "history_orders_get", "history_orders_total", "login"]
TF = {"1": "TIMEFRAME_M1", "5": "TIMEFRAME_M5", "15": "TIMEFRAME_M15", "30": "TIMEFRAME_M30", "60": "TIMEFRAME_H1", "120": "TIMEFRAME_H2", "240": "TIMEFRAME_H4", "D": "TIMEFRAME_D1", "W": "TIMEFRAME_W1", "M": "TIMEFRAME_MN1"}


def lockdown(mod):
    def blocked(*a, **k):
        raise RuntimeError("TradeZoro Data Bridge is data only")
    for n in FORBIDDEN:
        setattr(mod, n, blocked)
    return mod


class MT5Source(Source):
    id = "mt5"
    caps = ["history", "ticks", "depth"]

    def __init__(self, mod=None):
        if mod is None:
            import MetaTrader5 as mod   # Windows only
        self.m = lockdown(mod)
        self.subs, self.emit, self.task, self.off = set(), set(), None, 0

    def start(self):
        # No login/password: attaches to the terminal the member already logged in.
        if not self.m.initialize():
            raise RuntimeError("MetaTrader 5 is not running or not logged in")
        ti = self.m.terminal_info()
        if ti is not None and getattr(ti, "trade_allowed", False):
            print("NOTE: Algo Trading is ON in your MetaTrader 5. This helper never trades. Consider turning it off and using the investor password.")

    def _off(self, sym):
        # MT5 stamps bars with broker server time; shift to real UTC using the last tick (rounded to 30 min).
        t = self.m.symbol_info_tick(sym)
        if t and t.time and abs(time.time() - t.time) < 6 * 3600 * 2:
            self.off = round((t.time - time.time()) / 1800) * 1800
        return self.off

    async def history(self, sym, tf, count=None, frm=None, to=None):
        if not self.m.symbol_select(sym, True): raise RuntimeError("Unknown symbol " + sym)
        off = self._off(sym); f = getattr(self.m, TF[tf])
        def run():
            if frm is not None:
                import datetime as dt
                return self.m.copy_rates_range(sym, f, dt.datetime.utcfromtimestamp(frm / 1000 + off), dt.datetime.utcfromtimestamp((to or time.time() * 1000) / 1000 + off))
            return self.m.copy_rates_from_pos(sym, f, 0, min(int(count or 500), 5000))
        rates = await asyncio.to_thread(run)
        if rates is None: raise RuntimeError("No data for " + sym)
        return [{"time": int((r["time"] - off) * 1000), "open": float(r["open"]), "high": float(r["high"]), "low": float(r["low"]), "close": float(r["close"]), "volume": float(r["tick_volume"])} for r in rates]

    async def symbol(self, sym):
        i = self.m.symbol_info(sym)
        if not i: raise RuntimeError("Unknown symbol " + sym)
        return {"digits": int(i.digits), "desc": (i.description or sym)[:60]}

    async def subscribe(self, syms, depth, emit):
        for s in syms:
            if not self.m.symbol_select(s, True): raise RuntimeError("Unknown symbol " + s)
            if depth: self.m.market_book_add(s)
        self.subs.update(syms); self.emit.add(emit); self.depth = depth
        if not self.task: self.task = asyncio.create_task(self._poll())

    async def unsubscribe(self, syms):
        for s in syms:
            self.subs.discard(s)
            try: self.m.market_book_release(s)
            except Exception: pass

    async def _poll(self):
        last = {}
        while self.subs:
            for s in list(self.subs):
                t = self.m.symbol_info_tick(s)
                if t and (t.time_msc, t.last or t.bid) != last.get(s):
                    last[s] = (t.time_msc, t.last or t.bid)
                    msg = {"t": "tick", "sym": s, "price": float(t.last or (t.bid + t.ask) / 2), "ts": int(t.time_msc - self.off * 1000), "size": float(getattr(t, "volume", 0) or 0)}
                    for e in list(self.emit):
                        try: await e(dict(msg))
                        except Exception: self.emit.discard(e)
                if self.depth:
                    book = self.m.market_book_get(s)
                    if book:
                        bids = [[float(b.price), float(b.volume)] for b in book if b.type in (2, 4)]   # BOOK_TYPE_BUY / BUY_MARKET
                        asks = [[float(b.price), float(b.volume)] for b in book if b.type in (1, 3)]
                        for e in list(self.emit):
                            try: await e({"t": "depth", "sym": s, "bids": bids[:20], "asks": asks[:20]})
                            except Exception: self.emit.discard(e)
            await asyncio.sleep(0.25)
        self.task = None
