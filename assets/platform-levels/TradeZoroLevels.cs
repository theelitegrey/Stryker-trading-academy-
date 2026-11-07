// TradeZoro levels for NinjaTrader 8. Education only. Not financial advice.
// Install: copy this file to Documents\NinjaTrader 8\bin\Custom\Indicators, then in the NinjaScript Editor press F5 (compile). Add "TradeZoro levels" to a chart and paste your link (or a file path) into the settings.
// The link is private to you. Do not share it. It stops working when you turn it off on the TradeZoro page.
#region Using declarations
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.ComponentModel.DataAnnotations;
using System.Globalization;
using System.IO;
using System.Net.Http;
using System.Threading.Tasks;
using System.Windows.Media;
using NinjaTrader.Gui.Chart;
using NinjaTrader.NinjaScript.DrawingTools;
#endregion

namespace NinjaTrader.NinjaScript.Indicators
{
    public class TradeZoroLevels : Indicator
    {
        private static readonly HttpClient Http = new HttpClient { Timeout = TimeSpan.FromSeconds(15) };
        private readonly object gate = new object();
        private List<string[]> rows = new List<string[]>();   // type, label, price
        private DateTime lastTry = DateTime.MinValue;
        private bool busy, dirty;
        private int drawn;

        protected override void OnStateChange()
        {
            if (State == State.SetDefaults)
            {
                Name = "TradeZoro levels";
                Description = "Daily levels from TradeZoro. Education only. Not financial advice.";
                IsOverlay = true;
                Calculate = Calculate.OnPriceChange;
                DrawOnPricePanel = true;
                LevelsLink = "";
                LevelsFile = "";
                RefreshMinutes = 5;
                ShowNames = true;
            }
        }

        protected override void OnBarUpdate()
        {
            if (CurrentBar < Count - 2) return;   // only the newest bars
            if (!busy && (DateTime.UtcNow - lastTry).TotalMinutes >= Math.Max(1, RefreshMinutes)) Reload();
            if (!dirty) return;
            List<string[]> now;
            lock (gate) { now = new List<string[]>(rows); dirty = false; }
            for (int i = 0; i < drawn; i++) { RemoveDrawObject("TZ" + i); RemoveDrawObject("TZt" + i); }
            drawn = 0;
            foreach (var r in now)
            {
                double px;
                if (!double.TryParse(r[2], NumberStyles.Float, CultureInfo.InvariantCulture, out px)) continue;
                Brush b = BrushFor(r[0]);
                Draw.HorizontalLine(this, "TZ" + drawn, px, b);
                if (ShowNames) Draw.Text(this, "TZt" + drawn, r[1] + " " + px.ToString("0.##", CultureInfo.InvariantCulture), 0, px, b);
                drawn++;
            }
        }

        private void Reload()
        {
            busy = true; lastTry = DateTime.UtcNow;
            string link = (LevelsLink ?? "").Trim(), file = (LevelsFile ?? "").Trim();
            Task.Run(async () =>
            {
                try
                {
                    string text = link.Length > 0 ? await Http.GetStringAsync(link) : (file.Length > 0 && File.Exists(file) ? File.ReadAllText(file) : "");
                    var list = new List<string[]>();
                    foreach (var line in text.Split('\n'))
                    {
                        var l = line.Trim();
                        if (l.Length == 0 || l[0] == '#' || l.StartsWith("symbol,") || l.StartsWith("price,")) continue;
                        var c = l.Split(',');
                        if (c.Length >= 4) list.Add(new[] { c[1], c[2], c[3] });   // type, label, price
                    }
                    if (list.Count > 0) lock (gate) { rows = list; dirty = true; }
                }
                catch (Exception) { /* keep what is on the chart; try again next time */ }
                finally { busy = false; }
            });
        }

        private static Brush BrushFor(string type)
        {
            switch (type)
            {
                case "call_ceiling": return Brushes.Red;
                case "put_floor": return Brushes.LimeGreen;
                case "flip_line": return Brushes.Orange;
                case "zoro_level": return Brushes.DeepSkyBlue;
                case "dark_pool": return Brushes.Teal;
                case "pin_strike": return Brushes.SlateGray;
                default: return Brushes.MediumPurple;
            }
        }

        [NinjaScriptProperty]
        [Display(Name = "Levels link", Description = "Your private link from TradeZoro", Order = 1, GroupName = "TradeZoro")]
        public string LevelsLink { get; set; }

        [NinjaScriptProperty]
        [Display(Name = "Or a file path", Description = "A levels CSV saved from TradeZoro", Order = 2, GroupName = "TradeZoro")]
        public string LevelsFile { get; set; }

        [NinjaScriptProperty]
        [Range(1, 60)]
        [Display(Name = "Refresh (minutes)", Order = 3, GroupName = "TradeZoro")]
        public int RefreshMinutes { get; set; }

        [NinjaScriptProperty]
        [Display(Name = "Show names", Order = 4, GroupName = "TradeZoro")]
        public bool ShowNames { get; set; }
    }
}
