// TradeZoro levels for cTrader. Education only. Not financial advice.
// Install: cTrader > Algo > Indicators > New, name it "TradeZoroLevels", replace the code with this file, press Build.
// Add it to a chart and paste your private link (or a file path) into the parameters. Do not share the link.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net.Http;
using System.Threading.Tasks;
using cAlgo.API;

namespace cAlgo
{
    [Indicator(IsOverlay = true, AccessRights = AccessRights.FullAccess)]
    public class TradeZoroLevels : Indicator
    {
        [Parameter("Levels link", DefaultValue = "")]
        public string LevelsLink { get; set; }

        [Parameter("Or a file path", DefaultValue = "")]
        public string LevelsFile { get; set; }

        [Parameter("Refresh (minutes)", DefaultValue = 5, MinValue = 1, MaxValue = 60)]
        public int RefreshMinutes { get; set; }

        private static readonly HttpClient Http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
        private DateTime _last = DateTime.MinValue;
        private bool _busy;
        private int _drawn;

        protected override void Initialize() { Load(); }

        public override void Calculate(int index)
        {
            if (!IsLastBar || _busy) return;
            if ((DateTime.UtcNow - _last).TotalMinutes >= RefreshMinutes) Load();
        }

        private void Load()
        {
            _busy = true; _last = DateTime.UtcNow;
            string link = (LevelsLink ?? "").Trim(), file = (LevelsFile ?? "").Trim();
            Task.Run(async () =>
            {
                try
                {
                    string text = link.Length > 0 ? await Http.GetStringAsync(link) : (file.Length > 0 && File.Exists(file) ? File.ReadAllText(file) : "");
                    var list = new List<string[]>();
                    foreach (var raw in text.Split('\n'))
                    {
                        var l = raw.Trim();
                        if (l.Length == 0 || l[0] == '#' || l.StartsWith("symbol,") || l.StartsWith("price,")) continue;
                        var c = l.Split(',');
                        if (c.Length >= 4) list.Add(new[] { c[1], c[2], c[3] });
                    }
                    if (list.Count > 0) BeginInvokeOnMainThread(() => Draw(list));
                }
                catch (Exception) { /* keep the lines already drawn */ }
                finally { _busy = false; }
            });
        }

        private void Draw(List<string[]> list)
        {
            for (int i = 0; i < _drawn; i++) Chart.RemoveObject("TZ" + i);
            _drawn = 0;
            foreach (var r in list)
            {
                double px;
                if (!double.TryParse(r[2], NumberStyles.Float, CultureInfo.InvariantCulture, out px)) continue;
                var line = Chart.DrawHorizontalLine("TZ" + _drawn, px, ColorFor(r[0]));
                line.LineStyle = LineStyle.Lines;
                line.Comment = r[1];
                _drawn++;
            }
        }

        private static Color ColorFor(string type)
        {
            switch (type)
            {
                case "call_ceiling": return Color.Tomato;
                case "put_floor": return Color.LimeGreen;
                case "flip_line": return Color.Orange;
                case "zoro_level": return Color.DeepSkyBlue;
                case "dark_pool": return Color.Teal;
                case "pin_strike": return Color.SlateGray;
                default: return Color.MediumPurple;
            }
        }
    }
}
