// TradeZoro levels for Sierra Chart. Education only. Not financial advice.
// Install: save your levels CSV from TradeZoro (the "Sierra Chart" file), copy this file to <Sierra Chart folder>\ACS_Source,
// then Analysis > Build Custom Studies DLL > Build. Add the study "TradeZoro levels" to a chart and pick the CSV in its settings.
#include "sierrachart.h"
#include <fstream>
#include <string>
#include <vector>
#include <cstdlib>
SCDLLName("TradeZoro levels")

static COLORREF ColorFor(const std::string& t)
{
    if (t == "call_ceiling") return RGB(239, 68, 68);
    if (t == "put_floor") return RGB(34, 197, 94);
    if (t == "flip_line") return RGB(245, 158, 11);
    if (t == "zoro_level") return RGB(56, 189, 248);
    if (t == "dark_pool") return RGB(0, 173, 181);
    if (t == "pin_strike") return RGB(148, 163, 184);
    return RGB(139, 124, 246);
}

SCSFExport scsf_TradeZoroLevels(SCStudyInterfaceRef sc)
{
    SCInputRef FilePath = sc.Input[0];
    SCInputRef ShowNames = sc.Input[1];
    SCInputRef Every = sc.Input[2];
    const int BaseLine = 71000;
    if (sc.SetDefaults)
    {
        sc.GraphName = "TradeZoro levels";
        sc.StudyDescription = "Daily levels from TradeZoro. Education only. Not financial advice.";
        sc.AutoLoop = 0;
        sc.GraphRegion = 0;
        sc.FreeDLL = 0;
        FilePath.Name = "Levels CSV file";
        FilePath.SetPathAndFileName("");
        ShowNames.Name = "Show names";
        ShowNames.SetYesNo(1);
        Every.Name = "Re-read every (seconds)";
        Every.SetInt(60);
        Every.SetIntLimits(10, 3600);
        return;
    }
    int& LastRead = sc.GetPersistentInt(1);
    int Now = (int)(sc.CurrentSystemDateTime.GetAsDouble() * 86400.0);
    if (LastRead != 0 && Now - LastRead < Every.GetInt() && sc.UpdateStartIndex != 0) return;
    LastRead = Now;
    std::ifstream in(FilePath.GetPathAndFileName());
    if (!in.good()) return;
    std::string line;
    int n = 0;
    while (std::getline(in, line) && n < 60)
    {
        if (line.empty() || line[0] == '#' || line.rfind("symbol,", 0) == 0) continue;
        std::vector<std::string> c; size_t a = 0, b;
        while ((b = line.find(',', a)) != std::string::npos) { c.push_back(line.substr(a, b - a)); a = b + 1; }
        c.push_back(line.substr(a));
        if (c.size() < 4) continue;
        double px = atof(c[3].c_str());
        if (px <= 0) continue;
        s_UseTool T;
        T.Clear();
        T.ChartNumber = sc.ChartNumber;
        T.DrawingType = DRAWING_HORIZONTALLINE;
        T.LineNumber = BaseLine + n;
        T.BeginValue = (float)px;
        T.Color = ColorFor(c[1]);
        T.LineWidth = 1;
        T.AddMethod = UTAM_ADD_OR_ADJUST;
        if (ShowNames.GetYesNo()) { T.Text = c[2].c_str(); T.ShowPrice = 1; }
        sc.UseTool(T);
        n++;
    }
}
