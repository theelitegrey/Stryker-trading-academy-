"""Interactive Brokers source (TWS or IB Gateway). The ONLY file that imports ib_async. DATA ONLY:
read-only connection, no account/positions fetch at startup, trading and account methods replaced by ones that raise."""
import asyncio, datetime as dt, time
from bridge_core import Source

FORBIDDEN_IB = ["placeOrder", "cancelOrder", "reqGlobalCancel", "reqAccountUpdates", "reqAccountUpdatesMulti", "reqAccountSummary", "reqPositions", "reqPnL", "reqPnLSingle",
                "reqExecutions", "reqOpenOrders", "reqAllOpenOrders", "reqCompletedOrders", "reqAutoOpenOrders", "whatIfOrder", "exerciseOptions", "reqFamilyCodes"]
BAR = {"1": ("1 min", 60), "5": ("5 mins", 300), "15": ("15 mins", 900), "30": ("30 mins", 1800), "60": ("1 hour", 3600), "120": ("2 hours", 7200), "240": ("4 hours", 14400), "D": ("1 day", 86400), "W": ("1 week", 604800), "M": ("1 month", 2592000)}
DUR = {"1": 86400, "5": 5 * 86400, "15": 10 * 86400, "30": 20 * 86400, "60": 30 * 86400, "120": 60 * 86400, "240": 120 * 86400, "D": 365 * 86400 * 2, "W": 365 * 86400 * 10, "M": 365 * 86400 * 20}


def lockdown(ib):
    def blocked(*a, **k):
        raise RuntimeError("TradeZoro Data Bridge is data only")
    for n in FORBIDDEN_IB:
        setattr(ib, n, blocked)
    c = getattr(ib, "client", None)   # also the low-level client
    if c is not None:
        for n in FORBIDDEN_IB:
            setattr(c, n, blocked)
    return ib


def contract_of(lib, sym):
    """AAPL -> US stock; EURUSD -> forex; ES 12-26 / ES 202612 -> CME future; anything else -> refused."""
    s = sym.strip().upper()
    if " " in s:
        root, exp = s.split(None, 1)
        return lib.Future(root, exp.replace("-", ""), "CME" if root in {"ES", "NQ", "RTY", "YM", "MES", "MNQ", "CL", "GC", "ZB", "ZN"} else "SMART", currency="USD")
    if len(s) == 6 and s.isalpha() and s[:3] in {"EUR", "GBP", "AUD", "NZD", "USD", "CAD", "CHF", "JPY"}:
        return lib.Forex(s)
    return lib.Stock(s, "SMART", "USD")


class IBKRSource(Source):
    id = "ibkr"
    caps = ["history", "ticks", "depth"]

    def __init__(self, ib=None, lib=None, host="127.0.0.1", port=7497, client_id=77):
        if ib is None:
            import ib_async as lib
            ib = lib.IB()
        self.lib, self.ib, self.host, self.port, self.cid = lib, ib, host, port, client_id
        self.emit, self.tk = set(), {}

    async def start(self):
        lockdown(self.ib)
        try:   # readonly=True; fetchFields=0 -> no positions/orders/executions/account updates on connect
            f = self.lib.StartupFetch(0)
            await self.ib.connectAsync(self.host, self.port, clientId=self.cid, readonly=True, fetchFields=f)
        except TypeError:
            await self.ib.connectAsync(self.host, self.port, clientId=self.cid, readonly=True)
        self.ib.reqMarketDataType(1)

    async def _q(self, sym):
        c = contract_of(self.lib, sym)
        r = await self.ib.qualifyContractsAsync(c)
        if not r or not r[0]: raise RuntimeError("Interactive Brokers does not know " + sym)
        return r[0]

    async def history(self, sym, tf, count=None, frm=None, to=None):
        c = await self._q(sym); size, sec = BAR[tf]
        secs = min(int(DUR[tf]), max(int(sec * min(int(count or 500), 2000) * (1.6 if tf in "1 5 15 30 60 120 240".split() else 1.1)), sec * 2))
        dur = ("%d D" % max(1, -(-secs // 86400))) if secs <= 86400 * 365 else "%d Y" % max(1, -(-secs // (86400 * 365)))
        what = "MIDPOINT" if c.secType == "CASH" else "TRADES"
        bars = await self.ib.reqHistoricalDataAsync(c, endDateTime="", durationStr=dur, barSizeSetting=size, whatToShow=what, useRTH=False, formatDate=2)
        out = [{"time": int((b.date if isinstance(b.date, dt.datetime) else dt.datetime.combine(b.date, dt.time(), dt.timezone.utc)).timestamp() * 1000), "open": float(b.open), "high": float(b.high), "low": float(b.low), "close": float(b.close), "volume": float(max(b.volume, 0))} for b in bars]
        return out[-int(count):] if count else out

    async def symbol(self, sym):
        c = await self._q(sym)
        return {"digits": 5 if c.secType == "CASH" else 2, "desc": (getattr(c, "localSymbol", "") or sym)[:60]}

    async def subscribe(self, syms, depth, emit):
        self.emit.add(emit)
        for s in syms:
            if s in self.tk: continue
            c = await self._q(s)
            t = self.ib.reqMktData(c, "", False, False)   # snapshot=False, regulatorySnapshot=False (no per-request fee)
            self.tk[s] = (c, t)
            def on(tk, s=s):
                p = tk.last if tk.last == tk.last and tk.last else tk.marketPrice()
                if p == p and p:
                    asyncio.ensure_future(self._send({"t": "tick", "sym": s, "price": float(p), "ts": int(tk.time.timestamp() * 1000) if tk.time else int(time.time() * 1000), "size": float(tk.lastSize or 0)}))
            t.updateEvent += on
            if depth: self.ib.reqMktDepth(c, 10)

    async def _send(self, msg):
        for e in list(self.emit):
            try: await e(dict(msg))
            except Exception: self.emit.discard(e)

    async def unsubscribe(self, syms):
        for s in syms:
            v = self.tk.pop(s, None)
            if v:
                self.ib.cancelMktData(v[0])

    async def close(self):
        self.ib.disconnect()
