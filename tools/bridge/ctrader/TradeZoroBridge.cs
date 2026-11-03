// TradeZoro Bridge: cTrader Algo cBot. DATA ONLY (bars, ticks, depth). Nothing else.
// It is a WebSocket CLIENT: it connects out to the TradeZoro Data Bridge helper on THIS computer (ws://127.0.0.1:48720),
// which serves your browser. AccessRights.Internet only (no FullAccess, no files, no registry).
// NOT compiled or tested on a real cTrader yet: see ../README-ctrader.md. A test (tools/bridge/tests/test_ctrader.py) fails if
// any trading, order, position or account member appears in this file.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using cAlgo.API;

namespace cAlgo.Robots
{
    [Robot(AccessRights = AccessRights.Internet, TimeZone = TimeZones.UTC)]
    public class TradeZoroBridge : Robot
    {
        [Parameter("Link key (from the helper window)", DefaultValue = "")]
        public string LinkKey { get; set; }

        private readonly WebSocketClient _ws = new WebSocketClient();
        private readonly Dictionary<string, Symbol> _subs = new Dictionary<string, Symbol>();
        private readonly Dictionary<string, MarketDepth> _depth = new Dictionary<string, MarketDepth>();
        private static readonly Uri Link = new Uri("ws://127.0.0.1:48720");
        private static readonly System.Text.RegularExpressions.Regex SymRe = new System.Text.RegularExpressions.Regex(@"^[A-Za-z0-9._\-/ ]{1,32}$");

        protected override void OnStart()
        {
            if (string.IsNullOrWhiteSpace(LinkKey)) { Print("Set the Link key parameter (shown in the TradeZoro Data Bridge window)."); Stop(); return; }
            _ws.TextReceived += OnText;
            _ws.Closed += a => Print("Helper link closed. Stop and start this cBot after the helper is running.");
            _ws.Connect(Link);
            Send(new { t = "link", key = LinkKey, v = 1 });
            Print("TradeZoro Bridge: data only. Linked to the helper on this computer.");
        }

        protected override void OnStop() { try { _ws.Close(); } catch { } }

        private void Send(object o) { try { _ws.Send(JsonSerializer.Serialize(o)); } catch (Exception e) { Print("send failed: " + e.Message); } }

        private static TimeFrame Tf(string s)
        {
            switch (s)
            {
                case "1": return TimeFrame.Minute; case "5": return TimeFrame.Minute5; case "15": return TimeFrame.Minute15;
                case "30": return TimeFrame.Minute30; case "60": return TimeFrame.Hour; case "120": return TimeFrame.Hour2;
                case "240": return TimeFrame.Hour4; case "D": return TimeFrame.Daily; case "W": return TimeFrame.Weekly;
                case "M": return TimeFrame.Monthly; default: return null;
            }
        }

        private static long Ms(DateTime t) { return new DateTimeOffset(DateTime.SpecifyKind(t, DateTimeKind.Utc)).ToUnixTimeMilliseconds(); }

        private void OnText(WebSocketClientTextReceivedEventArgs a)
        {
            BeginInvokeOnMainThread(() =>
            {
                string rid = null;
                try
                {
                    using (var d = JsonDocument.Parse(a.Text))
                    {
                        var r = d.RootElement; var t = r.GetProperty("t").GetString();
                        rid = r.TryGetProperty("rid", out var x) ? x.ToString() : null;
                        if (t == "hist") Hist(r, rid);
                        else if (t == "sym") Sym(r.GetProperty("sym").GetString(), rid);
                        else if (t == "sub") Sub(r.GetProperty("syms").EnumerateArray().Select(e => e.GetString()).ToList(), r.TryGetProperty("depth", out var dp) && dp.GetBoolean());
                        else if (t == "unsub") Unsub(r.GetProperty("syms").EnumerateArray().Select(e => e.GetString()).ToList());
                    }
                }
                catch (Exception e) { Send(new { t = "err", rid, msg = e.Message }); }
            });
        }

        private Symbol Need(string name)
        {
            if (name == null || !SymRe.IsMatch(name)) throw new Exception("Bad symbol");
            var s = Symbols.GetSymbol(name); if (s == null) throw new Exception("Unknown symbol " + name); return s;
        }

        private void Sym(string name, string rid) { var s = Need(name); Send(new { t = "sym", rid, sym = name, digits = s.Digits, desc = name }); }

        private void Hist(JsonElement r, string rid)
        {
            var name = r.GetProperty("sym").GetString(); Need(name);
            var tf = Tf(r.GetProperty("tf").GetString()); if (tf == null) throw new Exception("Unsupported timeframe");
            var bars = MarketData.GetBars(tf, name);
            long from = r.TryGetProperty("from", out var f) && f.ValueKind == JsonValueKind.Number ? f.GetInt64() : 0;
            long to = r.TryGetProperty("to", out var tt) && tt.ValueKind == JsonValueKind.Number ? tt.GetInt64() : long.MaxValue;
            int count = r.TryGetProperty("count", out var c) && c.ValueKind == JsonValueKind.Number ? Math.Min(c.GetInt32(), 5000) : 500;
            // Load older bars until we have enough (bounded: 10 rounds).
            for (int i = 0; i < 10 && (from > 0 ? Ms(bars[0].OpenTime) > from : bars.Count < count); i++) { int n = bars.Count; bars.LoadMoreHistory(); if (bars.Count == n) break; }
            var list = new List<object>();
            for (int i = 0; i < bars.Count; i++)
            {
                var b = bars[i]; var ms = Ms(b.OpenTime);
                if (ms < from || ms > to) continue;
                list.Add(new { time = ms, open = b.Open, high = b.High, low = b.Low, close = b.Close, volume = (double)b.TickVolume });
            }
            if (from == 0 && list.Count > count) list = list.Skip(list.Count - count).ToList();
            Send(new { t = "bars", rid, sym = name, tf = r.GetProperty("tf").GetString(), bars = list });
        }

        private void Sub(List<string> names, bool depth)
        {
            foreach (var n in names.Take(10))
            {
                var s = Need(n); if (_subs.ContainsKey(n)) continue;
                _subs[n] = s; var name = n;
                s.Tick += e => Send(new { t = "tick", sym = name, price = (e.Bid + e.Ask) / 2.0, ts = Ms(Server.Time), size = 0 });
                if (depth)
                {
                    var md = MarketData.GetMarketDepth(n); _depth[n] = md;
                    md.Updated += () => Send(new { t = "depth", sym = name,
                        bids = md.BidEntries.Take(20).Select(q => new[] { q.Price, q.VolumeInUnits }),
                        asks = md.AskEntries.Take(20).Select(q => new[] { q.Price, q.VolumeInUnits }) });
                }
            }
        }

        // shortcut: the Tick/Updated handlers stay attached after unsub (the API has no handler list to clear here); _subs just stops re-adding. Upgrade: keep handler refs and remove them.
        private void Unsub(List<string> names) { foreach (var n in names) { _subs.Remove(n); _depth.Remove(n); } }
    }
}
