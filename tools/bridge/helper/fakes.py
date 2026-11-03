"""Fake MT5 module and fake TWS (ib_async-shaped) so the helpers run and are tested on Linux. Test data only."""
import asyncio, datetime as dt, time, types


class FakeMT5:
    TIMEFRAME_M1, TIMEFRAME_M5, TIMEFRAME_M15, TIMEFRAME_M30, TIMEFRAME_H1, TIMEFRAME_H2, TIMEFRAME_H4, TIMEFRAME_D1, TIMEFRAME_W1, TIMEFRAME_MN1 = range(1, 11)
    calls = []

    def __init__(self):
        self.p = 1.1000
        # These exist on the real package; lockdown() must replace them.
        for n in ["order_send", "order_check", "order_calc_margin", "order_calc_profit", "positions_get", "positions_total", "orders_get", "orders_total", "account_info",
                  "history_deals_get", "history_deals_total", "history_orders_get", "history_orders_total", "login"]:
            setattr(self, n, lambda *a, n=n, **k: self.calls.append(n) or "LEAK")

    def initialize(self, *a, **k): return True
    def terminal_info(self): return types.SimpleNamespace(trade_allowed=False)
    def symbol_select(self, s, e=True): return s in ("EURUSD", "XAUUSD", "US500")
    def symbol_info(self, s): return types.SimpleNamespace(digits=5, description="Euro vs US Dollar")
    def symbol_info_tick(self, s):
        self.p = round(self.p + 0.0001, 5); now = time.time()
        return types.SimpleNamespace(time=int(now), time_msc=int(now * 1000), bid=self.p, ask=self.p + 0.0001, last=0.0, volume=1)
    def market_book_add(self, s): return True
    def market_book_release(self, s): return True
    def market_book_get(self, s):
        B = lambda t, p, v: types.SimpleNamespace(type=t, price=p, volume=v)
        return [B(1, self.p + 0.0002, 5), B(2, self.p - 0.0001, 7)]
    def _rates(self, n, step):
        import numpy as np
        now = int(time.time()) // step * step; dtp = [("time", "i8"), ("open", "f8"), ("high", "f8"), ("low", "f8"), ("close", "f8"), ("tick_volume", "i8")]
        a = np.zeros(n, dtype=dtp)
        for i in range(n):
            o = 1.1 + i * 0.0001; a[i] = (now - (n - 1 - i) * step, o, o + 0.0003, o - 0.0003, o + 0.0001, 10 + i)
        return a
    def copy_rates_from_pos(self, s, tf, pos, n): return self._rates(n, 60)
    def copy_rates_range(self, s, tf, a, b): return self._rates(10, 60)


class _Ev(list):
    def __iadd__(self, f): self.append(f); return self


class FakeTicker:
    def __init__(self): self.last = 100.0; self.lastSize = 3; self.time = None; self.updateEvent = _Ev()
    def marketPrice(self): return self.last


class FakeIB:
    """Shaped like ib_async.IB; records every call so tests can prove nothing but market data was asked for."""
    def __init__(self):
        self.calls = []; self.client = types.SimpleNamespace()
        for n in ["placeOrder", "cancelOrder", "reqGlobalCancel", "reqAccountUpdates", "reqAccountUpdatesMulti", "reqAccountSummary", "reqPositions", "reqPnL", "reqPnLSingle",
                  "reqExecutions", "reqOpenOrders", "reqAllOpenOrders", "reqCompletedOrders", "reqAutoOpenOrders", "whatIfOrder", "exerciseOptions", "reqFamilyCodes"]:
            setattr(self, n, lambda *a, n=n, **k: self.calls.append(n) or "LEAK"); setattr(self.client, n, lambda *a, n=n, **k: self.calls.append(n) or "LEAK")
    async def connectAsync(self, host, port, clientId=0, readonly=False, fetchFields=None, **k): self.calls.append(("connect", host, readonly)); return self
    def reqMarketDataType(self, t): pass
    async def qualifyContractsAsync(self, c): return [c] if getattr(c, "symbol", "") != "NOPE" else [None]
    async def reqHistoricalDataAsync(self, c, **k):
        now = dt.datetime.now(dt.timezone.utc).replace(second=0, microsecond=0)
        return [types.SimpleNamespace(date=now - dt.timedelta(minutes=5 - i), open=100 + i, high=101 + i, low=99 + i, close=100.5 + i, volume=1000 + i) for i in range(5)]
    def reqMktData(self, c, g="", snap=False, reg=False):
        self.calls.append(("mkt", snap, reg)); t = FakeTicker(); self.t = t
        async def go():
            for _ in range(3):
                await asyncio.sleep(0.2); t.last += 0.5
                for f in list(t.updateEvent): f(t)
        asyncio.ensure_future(go()); return t
    def reqMktDepth(self, c, n): pass
    def cancelMktData(self, c): self.calls.append("cancelMkt")
    def disconnect(self): pass


def fake_lib():
    L = types.SimpleNamespace()
    mk = lambda kind: (lambda *a, **k: types.SimpleNamespace(kind=kind, symbol=a[0] if a else "", secType={"Stock": "STK", "Forex": "CASH", "Future": "FUT"}[kind], localSymbol=a[0] if a else ""))
    L.Stock, L.Forex, L.Future = mk("Stock"), mk("Forex"), mk("Future")
    L.StartupFetch = lambda n: n
    return L
