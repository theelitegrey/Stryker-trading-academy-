# TradeZoro Data Bridge for NinjaTrader 8
**NOT YET RUN ON A REAL NINJATRADER 8.** It is compile-checked on every release with `tools/bridge/tests/compile_nt8.py`
(C# 5, default .NET references only, NinjaTrader API stubs in `stubs/`), so it should import on a clean NT8 8.1+. The protocol/crypto parts are covered by test vectors
(`vectors.json`, checked by the Python tests and by the add-on's own start-up self-test); the NinjaTrader API calls (BarsRequest, MarketDataUpdate)
are not. The stubs mirror the documented NT8 API; if NT8 itself rejects a member, fix it here and in `stubs/` together. Covers whatever data connection NT8 has (Tradovate, CQG, IQFeed, Kinetick, Rithmic).

Data only: no code references accounts, orders, positions or executions (a test scans this file). Price history and last-price ticks only.
Not built: market depth (the NT8 depth event has a "Position" member that would trip the data-only scan; add later if wanted).

## Install
1. Copy `TradeZoroBridge.cs` to `Documents\NinjaTrader 8\bin\Custom\AddOns\`.
2. NinjaTrader: New > NinjaScript Editor > right-click > Compile. No extra references are needed (the token is sealed with DPAPI through crypt32 P/Invoke, not ProtectedData).
3. Packaging for members: in NT8 use Tools > Export > NinjaScript Add-On, tick the file, save the .zip; members use Tools > Import > NinjaScript Add-On.
4. The add-on starts with NT8. Open New > NinjaScript Output: it prints "listening on 127.0.0.1:487xx" and the 8-digit pairing code.
5. On tradezoro.com: Data source > NinjaTrader > Pair, type the code. The browser may ask to allow local access: choose Allow.
Symbols are NinjaTrader instrument names, e.g. `byo:ES 12-26`, `byo:AAPL`.

## Import rules (why "Import failed ... duplicate method names" happened, 2026-11-13)
NT8 compiles an imported add-on together with every other script on the PC. Anything that fails that compile gives the
generic "Import failed. The NinjaScript Archive File may contain duplicate method names..." message. Keep these true:
- Default references only. Never `System.Security` (ProtectedData), `System.Net.Http`, or any extra DLL.
- Exactly one top-level type, `TradeZoroBridge`. Helper classes go INSIDE it (a top-level `Json` clashes with other add-ons).
- C# 5 syntax (no `$"..."`, `?.`, `=>` members, `nameof`, out vars, tuples).
`python3 tools/bridge/tests/compile_nt8.py` enforces all three (needs `mcs` on Linux, or the .NET Framework csc.exe on Windows).

## Token at rest: the trade-off
The pairing token is sealed with Windows DPAPI (CryptProtectData, current-user scope) via P/Invoke to crypt32.dll, then
written to `TradeZoroBridge.tok` in the NinjaTrader 8 user folder. This is exactly what ProtectedData does (same blob format,
so tokens saved by older builds still read). It protects the file from other Windows users and from a copied disk; it does
NOT protect it from other programs running as the same Windows user (nothing in-process can). P/Invoke is chosen over a plain
ACL-protected file because the token would then be readable by anything that can read the user's Documents folder.
