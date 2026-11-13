// TradeZoro Data Bridge for NinjaTrader 8. DATA ONLY. Compile-checked off-NT8 against API stubs (tools/bridge/tests/compile_nt8.py); see README.md.
// Serves market data (history + last price) to https://tradezoro.com in YOUR browser over ws://127.0.0.1:487xx.
// It reads no balances, positions or account values and has no code path that places, changes or cancels anything.
// Protocol: tools/bridge/protocol.json. Raw TcpListener on 127.0.0.1 + a minimal RFC 6455 handshake (no http.sys URL ACL needed).
#region Using declarations
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using NinjaTrader.Cbi;
using NinjaTrader.Data;
using NinjaTrader.NinjaScript;
#endregion

namespace NinjaTrader.NinjaScript.AddOns
{
	public class TradeZoroBridge : AddOnBase
	{
		static readonly int[] Ports = { 48715, 48716, 48717, 48718, 48719 };
		const string AllowedOrigin = "https://tradezoro.com";
		const string Source = "ninja";
		static readonly string[] AllowedIn = { "pair", "hello", "history", "symbol", "subscribe", "unsubscribe", "ping" };

		TcpListener listener; Thread acceptor; volatile bool stop;
		int port; string code; DateTime codeExp; int tries; int clients;
		string tokenPath;
		readonly RandomNumberGenerator rng = RandomNumberGenerator.Create();

		protected override void OnStateChange()
		{
			if (State == State.SetDefaults) { Name = "TradeZoro Data Bridge"; Description = "Data only. Prices to your own browser tab."; }
			else if (State == State.Active) { try { Start(); } catch (Exception e) { Log("start failed: " + e.Message); } }
			else if (State == State.Terminated) Stop();
		}

		void Log(string s) { NinjaTrader.Code.Output.Process("TradeZoro Data Bridge: " + s, PrintTo.OutputTab1); }

		void Start()
		{
			tokenPath = Path.Combine(NinjaTrader.Core.Globals.UserDataDir, "TradeZoroBridge.tok");
			foreach (int p in Ports)
			{
				try { listener = new TcpListener(IPAddress.Loopback, p); listener.Start(); port = p; break; }
				catch (SocketException) { listener = null; }
			}
			if (listener == null) { Log("no free port 48715-48719"); return; }
			NewCode();
			Log("listening on 127.0.0.1:" + port + ". Pairing code (type it on tradezoro.com > Data source > Pair): " + code.Substring(0, 4) + " " + code.Substring(4) + " (valid 2 minutes; turn the add-on off and on for a new one)");
			SelfTest();
			acceptor = new Thread(AcceptLoop) { IsBackground = true, Name = "TradeZoroBridge" };
			acceptor.Start();
		}

		void Stop()
		{
			stop = true;
			try { if (listener != null) listener.Stop(); } catch { }
		}

		void NewCode()
		{
			byte[] b = new byte[4]; rng.GetBytes(b);
			code = (BitConverter.ToUInt32(b, 0) % 100000000u).ToString("D8");
			codeExp = DateTime.UtcNow.AddMinutes(2); tries = 0;
		}

		// ---- crypto helpers (vectors in vectors.json; checked at start) ----
		static string Hex(byte[] b) { StringBuilder s = new StringBuilder(); foreach (byte x in b) s.Append(x.ToString("x2")); return s.ToString(); }
		static string Proof(string token, string dir, string sn, string hn, int port, string origin)
		{
			using (HMACSHA256 h = new HMACSHA256(Encoding.UTF8.GetBytes(token)))
				return Hex(h.ComputeHash(Encoding.UTF8.GetBytes(dir + "|" + sn + "|" + hn + "|" + port + "|" + origin)));
		}
		static string AcceptKey(string key)
		{
			using (SHA1 sha = SHA1.Create())
				return Convert.ToBase64String(sha.ComputeHash(Encoding.ASCII.GetBytes(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")));
		}
		static bool SameText(string a, string b)
		{
			if (a == null || b == null || a.Length != b.Length) return false;
			int d = 0; for (int i = 0; i < a.Length; i++) d |= a[i] ^ b[i]; return d == 0;
		}
		void SelfTest()
		{
			bool ok = AcceptKey("dGhlIHNhbXBsZSBub25jZQ==") == "s3pPLMBiTxaQ9kYGzzhZRbK+xOo="
				&& Proof("tok", "site", "sn", "hn", 48715, "https://tradezoro.com") == "8868584dac4fdcc6b8680bfa4fde688af06810e0ed91595bd19b6a79de3a20c3";
			Log(ok ? "self-test ok" : "SELF-TEST FAILED, do not use this build");
			if (!ok) Stop();
		}

		// ---- accept + per-client loop ----
		void AcceptLoop()
		{
			while (!stop)
			{
				TcpClient c;
				try { c = listener.AcceptTcpClient(); } catch { return; }
				if (Interlocked.Increment(ref clients) > 2) { Interlocked.Decrement(ref clients); try { c.Close(); } catch { } continue; }
				Thread t = new Thread(() => { try { Serve(c); } catch { } finally { Interlocked.Decrement(ref clients); try { c.Close(); } catch { } } }) { IsBackground = true };
				t.Start();
			}
		}

		sealed class Client { public NetworkStream S; public object Lock = new object(); public bool Authed; public string Origin; public string Sn, Hn; public List<string> Subs = new List<string>(); }
		readonly Dictionary<Client, List<string>> live = new Dictionary<Client, List<string>>();
		readonly Dictionary<string, Instrument> instr = new Dictionary<string, Instrument>();

		void Serve(TcpClient tc)
		{
			tc.ReceiveTimeout = 10000;
			Client cl = new Client { S = tc.GetStream() };
			if (!Handshake(cl)) return;
			cl.Hn = RandomHex(16);
			string token = ReadToken();
			Send(cl, "{\"t\":\"welcome\",\"hn\":\"" + cl.Hn + "\",\"v\":1,\"paired\":" + (token != null ? "true" : "false") + ",\"source\":\"" + Source + "\"}");
			try
			{
				while (!stop)
				{
					string raw = ReadFrame(cl.S);
					if (raw == null) return;
					Dictionary<string, object> m = Json.Parse(raw);
					string t = m != null && m.ContainsKey("t") ? m["t"] as string : null;
					if (t == null || Array.IndexOf(AllowedIn, t) < 0) { Err(cl, "protocol", "Message not allowed", null); return; }
					if (!cl.Authed)
					{
						if (t == "pair") { if (!DoPair(cl, m)) continue; return; }
						if (t == "hello") { if (!DoHello(cl, m, token)) return; tc.ReceiveTimeout = 0; continue; }
						Err(cl, "auth", "Pair first", null); return;
					}
					Handle(cl, t, m);
				}
			}
			finally { Drop(cl); }
		}

		bool DoPair(Client cl, Dictionary<string, object> m)
		{
			string given = m.ContainsKey("code") ? m["code"] as string : null;
			if (code == null || DateTime.UtcNow > codeExp) { Err(cl, "bad-code", "That code has expired. Use the new code.", null); NewCode(); Log("new code: " + code); return false; }
			if (!SameText(given, code)) { if (++tries >= 5) { NewCode(); Log("new code: " + code); } Err(cl, "bad-code", "That code is not right.", null); return false; }
			string token = RandomHex(32);
			File.WriteAllBytes(tokenPath, Dpapi.Protect(Encoding.UTF8.GetBytes(token)));
			code = null;
			Send(cl, "{\"t\":\"paired\",\"token\":\"" + token + "\"}");
			return true;
		}

		bool DoHello(Client cl, Dictionary<string, object> m, string token)
		{
			string sn = m.ContainsKey("sn") ? m["sn"] as string : null;
			string pr = m.ContainsKey("proof") ? m["proof"] as string : null;
			if (token == null || sn == null || sn.Length < 16 || !SameText(pr, Proof(token, "site", sn, cl.Hn, port, cl.Origin))) { Err(cl, "proof", "Pairing no longer valid. Pair again.", null); return false; }
			cl.Authed = true; cl.Sn = sn;
			Send(cl, "{\"t\":\"ready\",\"proof\":\"" + Proof(token, "helper", sn, cl.Hn, port, cl.Origin) + "\",\"source\":\"" + Source + "\",\"caps\":[\"history\",\"ticks\"]}");
			return true;
		}

		string ReadToken()
		{
			try { return Encoding.UTF8.GetString(Dpapi.Unprotect(File.ReadAllBytes(tokenPath))); } catch { return null; }
		}
		string RandomHex(int n) { byte[] b = new byte[n]; rng.GetBytes(b); return Hex(b); }

		// ---- data requests ----
		static bool SymOk(string s)
		{
			if (s == null || s.Length < 1 || s.Length > 32) return false;
			foreach (char c in s) if (!(char.IsLetterOrDigit(c) && c < 128) && ".-_/ ".IndexOf(c) < 0) return false;
			return true;
		}
		Instrument Get(string sym) { Instrument i; lock (instr) { if (!instr.TryGetValue(sym, out i)) { i = Instrument.GetInstrument(sym); if (i != null) instr[sym] = i; } } return i; }
		static long Ms(DateTime local) { return (long)(DateTime.SpecifyKind(local, DateTimeKind.Local).ToUniversalTime() - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds; }
		static string N(double d) { return d.ToString("R", CultureInfo.InvariantCulture); }

		void Handle(Client cl, string t, Dictionary<string, object> m)
		{
			object rid = m.ContainsKey("rid") ? m["rid"] : null; string ridS = rid == null ? null : Convert.ToString(rid, CultureInfo.InvariantCulture);
			string sym = m.ContainsKey("sym") ? m["sym"] as string : null;
			if (t == "ping") { Send(cl, "{\"t\":\"pong\"}"); return; }
			if (t == "symbol" || t == "history")
			{
				if (!SymOk(sym)) { Err(cl, "data", "Bad symbol", ridS); return; }
				Instrument ins = Get(sym); if (ins == null) { Err(cl, "data", "NinjaTrader does not know " + sym, ridS); return; }
				if (t == "symbol")
				{
					double ts = ins.MasterInstrument.TickSize; int digits = 0; while (digits < 8 && Math.Abs(ts * Math.Pow(10, digits) - Math.Round(ts * Math.Pow(10, digits))) > 1e-9) digits++;
					Send(cl, "{\"t\":\"symbol\",\"rid\":" + ridS + ",\"sym\":\"" + sym + "\",\"digits\":" + digits + ",\"desc\":\"" + Esc(ins.MasterInstrument.Description) + "\"}");
					return;
				}
				History(cl, ins, sym, m, ridS);
				return;
			}
			if (t == "subscribe" || t == "unsubscribe")
			{
				List<object> arr = m.ContainsKey("syms") ? m["syms"] as List<object> : null; if (arr == null || arr.Count > 10) { Err(cl, "protocol", "syms", null); return; }
				foreach (object o in arr)
				{
					string s = o as string; if (!SymOk(s)) continue; Instrument ins = Get(s);
					if (ins == null) { Err(cl, "data", "NinjaTrader does not know " + s, null); continue; }
					lock (cl.Subs)
					{
						if (t == "subscribe" && !cl.Subs.Contains(s)) { cl.Subs.Add(s); string key = s; ins.MarketDataUpdate += GetHandler(cl, key); }
						else if (t == "unsubscribe" && cl.Subs.Remove(s)) ins.MarketDataUpdate -= GetHandler(cl, s);
					}
				}
			}
		}

		readonly Dictionary<string, EventHandler<MarketDataEventArgs>> handlers = new Dictionary<string, EventHandler<MarketDataEventArgs>>();
		EventHandler<MarketDataEventArgs> GetHandler(Client cl, string sym)
		{
			string k = cl.GetHashCode() + "|" + sym; EventHandler<MarketDataEventArgs> h;
			lock (handlers)
			{
				if (!handlers.TryGetValue(k, out h))
				{
					h = (sender, e) =>
					{
						if (e.MarketDataType != MarketDataType.Last) return;
						try { Send(cl, "{\"t\":\"tick\",\"sym\":\"" + sym + "\",\"price\":" + N(e.Price) + ",\"ts\":" + Ms(e.Time) + ",\"size\":" + N(e.Volume) + "}"); } catch { }
					};
					handlers[k] = h;
				}
			}
			return h;
		}

		void History(Client cl, Instrument ins, string sym, Dictionary<string, object> m, string ridS)
		{
			string tf = Convert.ToString(m.ContainsKey("tf") ? m["tf"] : "1", CultureInfo.InvariantCulture);
			BarsPeriod bp = new BarsPeriod();
			switch (tf)
			{
				case "1": case "5": case "15": case "30": bp.BarsPeriodType = BarsPeriodType.Minute; bp.Value = int.Parse(tf); break;
				case "60": case "120": case "240": bp.BarsPeriodType = BarsPeriodType.Minute; bp.Value = int.Parse(tf); break;
				case "D": bp.BarsPeriodType = BarsPeriodType.Day; bp.Value = 1; break;
				case "W": bp.BarsPeriodType = BarsPeriodType.Week; bp.Value = 1; break;
				case "M": bp.BarsPeriodType = BarsPeriodType.Month; bp.Value = 1; break;
				default: Err(cl, "data", "Bad timeframe", ridS); return;
			}
			int count = 500; if (m.ContainsKey("count") && m["count"] is double) count = (int)Math.Min(5000, Math.Max(1, (double)m["count"]));
			BarsRequest req = new BarsRequest(ins, count) { BarsPeriod = bp, TradingHours = ins.MasterInstrument.TradingHours };
			req.Request((r, code2, msg) =>
			{
				try
				{
					if (code2 != ErrorCode.NoError) { Err(cl, "data", "NinjaTrader: " + msg, ridS); return; }
					StringBuilder sb = new StringBuilder("{\"t\":\"bars\",\"rid\":" + ridS + ",\"sym\":\"" + sym + "\",\"tf\":\"" + tf + "\",\"bars\":[");
					for (int i = 0; i < r.Bars.Count; i++)
					{
						if (i > 0) sb.Append(',');
						sb.Append("{\"time\":" + Ms(r.Bars.GetTime(i)) + ",\"open\":" + N(r.Bars.GetOpen(i)) + ",\"high\":" + N(r.Bars.GetHigh(i)) + ",\"low\":" + N(r.Bars.GetLow(i)) + ",\"close\":" + N(r.Bars.GetClose(i)) + ",\"volume\":" + N(r.Bars.GetVolume(i)) + "}");
					}
					Send(cl, sb.Append("]}").ToString());
				}
				finally { r.Dispose(); }
			});
		}

		void Drop(Client cl)
		{
			List<string> subs; lock (cl.Subs) subs = new List<string>(cl.Subs);
			foreach (string s in subs) { Instrument ins = Get(s); if (ins != null) ins.MarketDataUpdate -= GetHandler(cl, s); }
		}

		// ---- WebSocket framing (RFC 6455; text frames, server -> client unmasked, client -> server masked) ----
		static string Esc(string s) { return (s ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", " ").Replace("\n", " "); }
		void Err(Client cl, string codeS, string msg, string rid) { try { Send(cl, "{\"t\":\"error\",\"code\":\"" + codeS + "\",\"msg\":\"" + Esc(msg) + "\"" + (rid != null ? ",\"rid\":" + rid : "") + "}"); } catch { } }

		bool Handshake(Client cl)
		{
			StringBuilder sb = new StringBuilder(); byte[] one = new byte[1];
			while (sb.Length < 4096 && !sb.ToString().EndsWith("\r\n\r\n")) { if (cl.S.Read(one, 0, 1) != 1) return false; sb.Append((char)one[0]); }
			string[] lines = sb.ToString().Split(new[] { "\r\n" }, StringSplitOptions.RemoveEmptyEntries);
			Dictionary<string, string> h = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
			for (int i = 1; i < lines.Length; i++) { int k = lines[i].IndexOf(':'); if (k > 0) h[lines[i].Substring(0, k).Trim()] = lines[i].Substring(k + 1).Trim(); }
			string host, origin, key;
			// Origin must be exactly the site (missing/"null" rejected); Host must be loopback (DNS rebinding).
			bool ok = h.TryGetValue("Origin", out origin) && origin == AllowedOrigin
				&& h.TryGetValue("Host", out host) && (host == "127.0.0.1:" + port || host == "localhost:" + port)
				&& h.TryGetValue("Sec-WebSocket-Key", out key) && lines[0].StartsWith("GET ");
			if (!ok) { byte[] no = Encoding.ASCII.GetBytes("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"); cl.S.Write(no, 0, no.Length); return false; }
			cl.Origin = origin;
			byte[] resp = Encoding.ASCII.GetBytes("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + AcceptKey(h["Sec-WebSocket-Key"]) + "\r\n\r\n");
			cl.S.Write(resp, 0, resp.Length);
			return true;
		}

		static bool ReadN(Stream s, byte[] b, int n) { int o = 0; while (o < n) { int r = s.Read(b, o, n - o); if (r <= 0) return false; o += r; } return true; }
		string ReadFrame(NetworkStream s)
		{
			byte[] h = new byte[2]; if (!ReadN(s, h, 2)) return null;
			int op = h[0] & 0x0F; bool masked = (h[1] & 0x80) != 0; long len = h[1] & 0x7F;
			if (len == 126) { byte[] e = new byte[2]; if (!ReadN(s, e, 2)) return null; len = (e[0] << 8) | e[1]; }
			else if (len == 127) return null;                  // frames this large are never valid here
			if (!masked || len > 4096 || (h[0] & 0x80) == 0) return null;   // clients must mask; no fragments; max 4 KB
			byte[] mk = new byte[4]; if (!ReadN(s, mk, 4)) return null;
			byte[] d = new byte[len]; if (len > 0 && !ReadN(s, d, (int)len)) return null;
			for (int i = 0; i < d.Length; i++) d[i] ^= mk[i % 4];
			if (op == 8) return null;
			if (op == 9 || op == 10) return "{\"t\":\"ping\"}";
			if (op != 1) return null;
			return Encoding.UTF8.GetString(d);
		}
		void Send(Client cl, string text)
		{
			byte[] p = Encoding.UTF8.GetBytes(text); byte[] f;
			if (p.Length < 126) { f = new byte[2 + p.Length]; f[1] = (byte)p.Length; Buffer.BlockCopy(p, 0, f, 2, p.Length); }
			else { f = new byte[4 + p.Length]; f[1] = 126; f[2] = (byte)(p.Length >> 8); f[3] = (byte)(p.Length & 255); Buffer.BlockCopy(p, 0, f, 4, p.Length); }
			f[0] = 0x81;
			lock (cl.Lock) cl.S.Write(f, 0, f.Length);
		}

		// Token at rest: Windows DPAPI, current-user scope, via crypt32 directly. Same blob format as .NET's
		// ProtectedData.Protect(data, null, CurrentUser), so a token saved by an older build still reads. P/Invoke instead of
		// ProtectedData because ProtectedData lives in System.Security.dll, which a clean NT8 does not reference, and the
		// import then fails to compile (member bug 2026-11-13).
		internal static class Dpapi
		{
			[StructLayout(LayoutKind.Sequential)] struct Blob { public int Size; public IntPtr Data; }
			const int UiForbidden = 0x1;
			[DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
			static extern bool CryptProtectData(ref Blob dataIn, string description, IntPtr entropy, IntPtr reserved, IntPtr prompt, int flags, ref Blob dataOut);
			[DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
			static extern bool CryptUnprotectData(ref Blob dataIn, IntPtr description, IntPtr entropy, IntPtr reserved, IntPtr prompt, int flags, ref Blob dataOut);
			[DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr mem);

			public static byte[] Protect(byte[] plain) { return Run(plain, true); }
			public static byte[] Unprotect(byte[] sealedData) { return Run(sealedData, false); }
			static byte[] Run(byte[] input, bool protect)
			{
				Blob inB = new Blob(), outB = new Blob();
				GCHandle pin = GCHandle.Alloc(input, GCHandleType.Pinned);
				try
				{
					inB.Size = input.Length; inB.Data = pin.AddrOfPinnedObject();
					bool ok = protect
						? CryptProtectData(ref inB, null, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, UiForbidden, ref outB)
						: CryptUnprotectData(ref inB, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, UiForbidden, ref outB);
					if (!ok) throw new CryptographicException(Marshal.GetLastWin32Error());
					byte[] r = new byte[outB.Size]; Marshal.Copy(outB.Data, r, 0, outB.Size); return r;
				}
				finally { pin.Free(); if (outB.Data != IntPtr.Zero) LocalFree(outB.Data); }
			}
		}

		// Flat JSON reader for the protocol only (nested: a top-level "Json" would clash with any other add-on's): object of string / number / bool / array-of-string values.
		internal static class Json
		{
			public static Dictionary<string, object> Parse(string s)
			{
				int i = 0; Ws(s, ref i); if (i >= s.Length || s[i] != '{') return null; i++;
				Dictionary<string, object> d = new Dictionary<string, object>();
				while (true)
				{
					Ws(s, ref i); if (i < s.Length && s[i] == '}') return d;
					string k = Str(s, ref i); if (k == null) return null; Ws(s, ref i);
					if (i >= s.Length || s[i] != ':') return null; i++; Ws(s, ref i);
					object v = Val(s, ref i); if (v == null) return null; d[k] = v; Ws(s, ref i);
					if (i < s.Length && s[i] == ',') { i++; continue; }
					if (i < s.Length && s[i] == '}') return d; return null;
				}
			}
			static void Ws(string s, ref int i) { while (i < s.Length && char.IsWhiteSpace(s[i])) i++; }
			static string Str(string s, ref int i)
			{
				if (i >= s.Length || s[i] != '"') return null; i++; StringBuilder b = new StringBuilder();
				while (i < s.Length && s[i] != '"') { if (s[i] == '\\') { i++; if (i >= s.Length) return null; char c = s[i]; b.Append(c == 'n' ? '\n' : c == 't' ? '\t' : c); } else b.Append(s[i]); i++; }
				if (i >= s.Length) return null; i++; return b.ToString();
			}
			static object Val(string s, ref int i)
			{
				if (i >= s.Length) return null;
				if (s[i] == '"') return Str(s, ref i);
				if (s[i] == '[')
				{
					i++; List<object> l = new List<object>();
					while (true) { Ws(s, ref i); if (i < s.Length && s[i] == ']') { i++; return l; } object v = Val(s, ref i); if (v == null) return null; l.Add(v); Ws(s, ref i); if (i < s.Length && s[i] == ',') i++; }
				}
				if (string.CompareOrdinal(s, i, "true", 0, 4) == 0) { i += 4; return true; }
				if (string.CompareOrdinal(s, i, "false", 0, 5) == 0) { i += 5; return false; }
				int st = i; while (i < s.Length && "+-0123456789.eE".IndexOf(s[i]) >= 0) i++;
				double dv; return i > st && double.TryParse(s.Substring(st, i - st), NumberStyles.Float, CultureInfo.InvariantCulture, out dv) ? (object)dv : null;
			}
		}
	}
}
