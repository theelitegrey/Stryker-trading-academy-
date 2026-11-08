//+------------------------------------------------------------------+
//| TradeZoro levels for MetaTrader 5. Education only. Not financial advice.
//| Install: save the "MetaTrader 5" CSV from TradeZoro as tradezoro-levels.csv into File > Open Data Folder > MQL5\Files,
//| copy this file to MQL5\Indicators, press F7 in MetaEditor (compile), then drag "TradeZoro levels" onto a chart.
//| MetaTrader does not let an indicator fetch a web link, so this one reads the file. Save a new file to update.
//+------------------------------------------------------------------+
#property copyright "TradeZoro"
#property version   "1.00"
#property indicator_chart_window
#property indicator_plots 0

input string InpFile   = "tradezoro-levels.csv"; // File in MQL5\Files
input bool   InpNames  = true;                    // Show names
input int    InpEvery  = 60;                      // Re-read every (seconds)

string PFX = "TZL_";

color ColorFor(const string t)
{
   if(t == "call_ceiling") return clrTomato;
   if(t == "put_floor")    return clrLimeGreen;
   if(t == "flip_line")    return clrOrange;
   if(t == "zoro_level")   return clrDeepSkyBlue;
   if(t == "dark_pool")    return clrTeal;
   if(t == "pin_strike")   return clrSlateGray;
   return clrMediumPurple;
}

void Load()
{
   int h = FileOpen(InpFile, FILE_READ | FILE_TXT | FILE_ANSI);
   if(h == INVALID_HANDLE) { Comment("TradeZoro levels: file ", InpFile, " not found in MQL5\\Files"); return; }
   ObjectsDeleteAll(0, PFX);
   int n = 0;
   while(!FileIsEnding(h) && n < 60)
   {
      string line = FileReadString(h);
      StringTrimRight(line); StringTrimLeft(line);
      if(StringLen(line) == 0 || StringGetCharacter(line, 0) == '#' || StringFind(line, "symbol,") == 0) continue;
      string c[];
      if(StringSplit(line, ',', c) < 4) continue;
      double px = StringToDouble(c[3]);
      if(px <= 0) continue;
      string nm = PFX + IntegerToString(n);
      ObjectCreate(0, nm, OBJ_HLINE, 0, 0, px);
      ObjectSetInteger(0, nm, OBJPROP_COLOR, ColorFor(c[1]));
      ObjectSetInteger(0, nm, OBJPROP_STYLE, STYLE_DASH);
      ObjectSetInteger(0, nm, OBJPROP_SELECTABLE, false);
      if(InpNames) ObjectSetString(0, nm, OBJPROP_TEXT, c[2]);
      n++;
   }
   FileClose(h);
   Comment("TradeZoro levels: ", n, " lines. Education only. Not financial advice.");
   ChartRedraw();
}

int OnInit() { EventSetTimer(MathMax(10, InpEvery)); Load(); return INIT_SUCCEEDED; }
void OnDeinit(const int reason) { EventKillTimer(); ObjectsDeleteAll(0, PFX); Comment(""); }
void OnTimer() { Load(); }
int OnCalculate(const int total, const int prev, const datetime &time[], const double &open[], const double &high[],
                const double &low[], const double &close[], const long &tick_volume[], const long &volume[], const int &spread[])
{ return total; }
