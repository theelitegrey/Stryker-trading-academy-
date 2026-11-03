# TradeZoro Data Bridge for NinjaTrader 8
**UNTESTED ON A REAL NINJATRADER 8.** It was written without a compiler. The protocol/crypto parts are covered by test vectors
(`vectors.json`, checked by the Python tests and by the add-on's own start-up self-test); the NinjaTrader API calls (BarsRequest, MarketDataUpdate)
are not. Expect to fix compile errors on the first import. Covers whatever data connection NT8 has (Tradovate, CQG, IQFeed, Kinetick, Rithmic).

Data only: no code references accounts, orders, positions or executions (a test scans this file). Price history and last-price ticks only.
Not built: market depth (the NT8 depth event has a "Position" member that would trip the data-only scan; add later if wanted).

## Install
1. Copy `TradeZoroBridge.cs` to `Documents\NinjaTrader 8\bin\Custom\AddOns\`.
2. NinjaTrader: New > NinjaScript Editor > right-click > Compile. If it says ProtectedData is unknown, add the reference System.Security (right-click > References).
3. Packaging for members: in NT8 use Tools > Export > NinjaScript Add-On, tick the file, save the .zip; members use Tools > Import > NinjaScript Add-On.
4. The add-on starts with NT8. Open New > NinjaScript Output: it prints "listening on 127.0.0.1:487xx" and the 8-digit pairing code.
5. On tradezoro.com: Data source > NinjaTrader > Pair, type the code. The browser may ask to allow local access: choose Allow.
Symbols are NinjaTrader instrument names, e.g. `byo:ES 12-26`, `byo:AAPL`.
