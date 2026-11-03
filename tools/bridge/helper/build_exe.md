# Build notes (Windows)
    py -3.11 -m pip install websockets MetaTrader5 ib_async pyinstaller
    pyinstaller --onefile --name TradeZoroBridge --add-data "..\protocol.json;." main.py
Unsigned builds trigger SmartScreen. Publish the SHA-256 (certutil -hashfile TradeZoroBridge.exe SHA256). Not hosted until the Owner approves.
Setup: MT5 = log in (investor password is enough), then `TradeZoroBridge.exe mt5`. IBKR = TWS/Gateway > Settings > API: tick "Read-Only API", "Allow connections from localhost only", socket port 7497 (paper) / 7496 (live); then `TradeZoroBridge.exe ibkr --tws-port 7496`. TWS itself sends your account numbers to any API client on connect; this helper ignores and never logs them. Live prices need your own IB market-data subscriptions.
