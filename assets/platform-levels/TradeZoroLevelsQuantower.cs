// TradeZoro levels for Quantower. Education only. Not financial advice.
// Install: put this file in a folder under Quantower\Settings\Scripts\Indicators\TradeZoroLevels\, open Quantower's Algo panel
// (or Visual Studio), build it, then add "TradeZoro levels" to a chart and paste your private link (or a file path) in its settings.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Net.Http;
using System.Threading.Tasks;
using TradingPlatform.BusinessLayer;

namespace TradeZoroLevels
{
    public class TradeZoroLevelsIndicator : Indicator
    {
        [InputParameter("Levels link", 0)]
        public string LevelsLink = "";

        [InputParameter("Or a file path", 1)]
        public string LevelsFile = "";

        [InputParameter("Refresh (minutes)", 2, 1, 60, 1, 0)]
        public int RefreshMinutes = 5;

        private static readonly HttpClient Http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
        private readonly object gate = new object();
        private List<string[]> rows = new List<string[]>();
        private DateTime last = DateTime.MinValue;
        private bool busy;

        public TradeZoroLevelsIndicator()
        {
            Name = "TradeZoro levels";
            Description = "Daily levels from TradeZoro. Education only. Not financial advice.";
            SeparateWindow = false;
        }

        protected override void OnInit() { Reload(); }

        protected override void OnUpdate(UpdateArgs args)
        {
            if (!busy && (DateTime.UtcNow - last).TotalMinutes >= RefreshMinutes) Reload();
        }

        private void Reload()
        {
            busy = true; last = DateTime.UtcNow;
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
                    if (list.Count > 0) lock (gate) rows = list;
                }
                catch (Exception) { /* keep the lines already shown */ }
                finally { busy = false; }
            });
        }

        public override void OnPaintChart(PaintChartEventArgs args)
        {
            base.OnPaintChart(args);
            var g = args.Graphics;
            var conv = CurrentChart.MainWindow.CoordinatesConverter;
            var area = CurrentChart.MainWindow.ClientRectangle;
            List<string[]> now;
            lock (gate) now = new List<string[]>(rows);
            using (var font = new Font("Segoe UI", 8f))
            {
                foreach (var r in now)
                {
                    double px;
                    if (!double.TryParse(r[2], NumberStyles.Float, CultureInfo.InvariantCulture, out px)) continue;
                    float y = (float)conv.GetChartY(px);
                    if (y < area.Top || y > area.Bottom) continue;
                    var col = ColorFor(r[0]);
                    using (var pen = new Pen(col, 1f) { DashStyle = System.Drawing.Drawing2D.DashStyle.Dash })
                    using (var br = new SolidBrush(col))
                    {
                        g.DrawLine(pen, area.Left, y, area.Right, y);
                        g.DrawString(r[1] + " " + px.ToString("0.##", CultureInfo.InvariantCulture), font, br, area.Left + 6, y - 14);
                    }
                }
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
