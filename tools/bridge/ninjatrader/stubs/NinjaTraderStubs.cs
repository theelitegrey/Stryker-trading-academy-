// Compile-check stubs: the smallest slice of the NinjaTrader 8 API that TradeZoroBridge.cs uses, with NT8's namespaces,
// type kinds and member types (from the NT8 help guide). NOT NinjaTrader code and never shipped; used only by
// tools/bridge/tests/compile_nt8.sh so a release that does not compile cannot ship.
// If the add-on starts using a new NT8 member, add it here with the type NT8 documents.
using System;

namespace NinjaTrader.NinjaScript
{
	public enum State { SetDefaults, Configure, Active, DataLoaded, Historical, Transition, Realtime, Terminated, Finalized }
	public enum PrintTo { OutputTab1, OutputTab2 }
	public abstract class NinjaScriptBase
	{
		public string Name { get; set; }
		public string Description { get; set; }
		public State State { get; protected set; }
		protected virtual void OnStateChange() { }
	}
	public abstract class AddOnBase : NinjaScriptBase { }
}

namespace NinjaTrader.Code
{
	public static class Output { public static void Process(string message, NinjaTrader.NinjaScript.PrintTo printTo) { } }
}

namespace NinjaTrader.Core
{
	public static class Globals { public static string UserDataDir { get { return ""; } } }
}

namespace NinjaTrader.Data
{
	public enum MarketDataType { Ask, Bid, Last, DailyHigh, DailyLow, DailyVolume, LastClose, Opening, OpenInterest, Settlement, Unknown }
	public enum BarsPeriodType { Tick, Volume, Range, Second, Minute, Day, Week, Month, Year }
	public class MarketDataEventArgs : EventArgs
	{
		public MarketDataType MarketDataType { get; set; }
		public double Price { get; set; }
		public DateTime Time { get; set; }
		public long Volume { get; set; }
	}
	public class TradingHours { }
	public class BarsPeriod { public BarsPeriodType BarsPeriodType { get; set; } public int Value { get; set; } }
	public class Bars
	{
		public int Count { get { return 0; } }
		public DateTime GetTime(int index) { return DateTime.MinValue; }
		public double GetOpen(int index) { return 0; }
		public double GetHigh(int index) { return 0; }
		public double GetLow(int index) { return 0; }
		public double GetClose(int index) { return 0; }
		public long GetVolume(int index) { return 0; }
	}
	public class BarsRequest : IDisposable
	{
		public BarsRequest(NinjaTrader.Cbi.Instrument instrument, int barsBack) { }
		public BarsRequest(NinjaTrader.Cbi.Instrument instrument, DateTime fromLocal, DateTime toLocal) { }
		public Bars Bars { get; set; }
		public BarsPeriod BarsPeriod { get; set; }
		public TradingHours TradingHours { get; set; }
		public void Request(Action<BarsRequest, NinjaTrader.Cbi.ErrorCode, string> callback) { }
		public void Dispose() { }
	}
}

namespace NinjaTrader.Cbi
{
	public enum ErrorCode { NoError, LogOnFailed, UserAbort, Panic }
	public class MasterInstrument
	{
		public double TickSize { get; set; }
		public string Description { get; set; }
		public NinjaTrader.Data.TradingHours TradingHours { get; set; }
	}
	public class Instrument
	{
		public static Instrument GetInstrument(string name) { return null; }
		public MasterInstrument MasterInstrument { get; set; }
		public event EventHandler<NinjaTrader.Data.MarketDataEventArgs> MarketDataUpdate;
		void Touch() { if (MarketDataUpdate != null) MarketDataUpdate(this, null); }
	}
}
