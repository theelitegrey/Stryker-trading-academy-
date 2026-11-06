import urllib.request
U=["https://api.bybit.com/v5/market/kline?category=linear&symbol=BTCUSDT&interval=1&limit=2",
"https://api.bybit.com/v5/market/instruments-info?category=spot&limit=1",
"https://www.okx.com/api/v5/market/candles?instId=BTC-USDT&limit=2",
"https://api.bitget.com/api/v2/spot/market/candles?symbol=BTCUSDT&granularity=1min&limit=2",
"https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=1"]
for u in U:
    try:
        r=urllib.request.urlopen(urllib.request.Request(u,headers={"Origin":"https://tradezoro.com","User-Agent":"Mozilla/5.0"}),timeout=20)
        print("XP",r.status,"ACAO=",r.headers.get("access-control-allow-origin"),u[:60],r.read(90))
    except Exception as e: print("XP ERR",u[:60],e)
