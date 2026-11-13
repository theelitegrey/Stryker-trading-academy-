"""Compile check for the NinjaTrader 8 add-on, without NinjaTrader or Windows.

NT8 compiles an imported add-on on the member's PC; if that compile fails, the import fails with the generic
"Import failed. The NinjaScript Archive File may contain duplicate method names ..." message. This script compiles
TradeZoroBridge.cs the same way as closely as we can off-NT8:
  - C# language version 5 (the oldest NT8 has used; anything that builds here builds on 8.1.x),
  - only the .NET references NT8 has by default that matter here: mscorlib, System, System.Core, System.Xml, System.Data
    (NOT System.Security: ProtectedData would fail on a clean NT8 install, which is the bug this guards),
  - NinjaTrader types from stubs/NinjaTraderStubs.cs, built into their own DLL, like NT8's own assemblies,
  - the add-on must declare exactly ONE top-level type (helpers nested), so it cannot clash with another script's
    NinjaTrader.NinjaScript.AddOns.Json etc.
Compiler: mono `mcs` (Linux, apt install mono-mcs) or the .NET Framework `csc.exe` that ships with Windows.
Usage: python3 tools/bridge/tests/compile_nt8.py      exit 0 = compiles, 1 = does not, 2 = no compiler found.
"""
import glob, os, re, shutil, subprocess, sys, tempfile
from pathlib import Path

NT = Path(__file__).resolve().parent.parent / "ninjatrader"
SRC, STUBS = NT / "TradeZoroBridge.cs", NT / "stubs" / "NinjaTraderStubs.cs"
REFS = ["System.dll", "System.Core.dll", "System.Xml.dll", "System.Data.dll"]


def compiler():
    """(argv prefix, reference dir or None) for the first compiler found."""
    mcs = shutil.which("mcs")
    if mcs:
        return [mcs, "-noconfig", "-nologo", "-langversion:5", "-warn:0"], None
    for d in sorted(glob.glob(r"C:\Windows\Microsoft.NET\Framework64\v4*")) + sorted(glob.glob(r"C:\Windows\Microsoft.NET\Framework\v4*")):
        if os.path.exists(os.path.join(d, "csc.exe")):   # the framework csc.exe is C# 5 by itself
            return [os.path.join(d, "csc.exe"), "/noconfig", "/nologo", "/warn:0"], d
    return None, None


def top_level_types(text):
    """Names of types declared at brace depth 1 (inside the namespace, outside any class). Comments/strings stripped."""
    text = re.sub(r'//[^\n]*|/\*.*?\*/|@"(?:[^"]|"")*"|"(?:\\.|[^"\\\n])*"|\'(?:\\.|[^\'\\\n])+\'', '""', text, flags=re.S)
    depth, names = 0, []
    for tok in re.finditer(r'[{}]|\b(?:class|struct|interface|enum|delegate)\s+[\w<>, ]*?(\w+)\s*(?=[:{<(]|where)', text):
        t = tok.group(0)
        if t == "{": depth += 1
        elif t == "}": depth -= 1
        elif depth == 1: names.append(tok.group(1))
    return names


def main():
    tops = top_level_types(SRC.read_text(encoding="utf-8"))
    if tops != ["TradeZoroBridge"]:
        print("FAIL: TradeZoroBridge.cs must declare exactly one top-level type (TradeZoroBridge); found:", tops)
        return 1
    argv, refdir = compiler()
    if not argv:
        print("NO COMPILER: install mono-mcs (Linux) or run on Windows (.NET Framework csc.exe)")
        return 2
    ref = lambda n: os.path.join(refdir, n) if refdir else n
    flag = "/" if refdir else "-"
    with tempfile.TemporaryDirectory() as tmp:
        stub_dll = os.path.join(tmp, "NinjaTrader.Stubs.dll")
        steps = [
            ("stubs", argv + [flag + "target:library", flag + "out:" + stub_dll] + [flag + "r:" + ref(r) for r in REFS] + [str(STUBS)]),
            ("add-on", argv + [flag + "target:library", flag + "out:" + os.path.join(tmp, "TradeZoroBridge.dll")] + [flag + "r:" + ref(r) for r in REFS] + [flag + "r:" + stub_dll, str(SRC)]),
        ]
        for what, cmd in steps:
            p = subprocess.run(cmd, capture_output=True, text=True)
            out = (p.stdout + p.stderr).strip()
            if p.returncode != 0:
                print("FAIL compiling", what, "(" + os.path.basename(argv[0]) + ", C# 5, refs: mscorlib (implicit) " + " ".join(REFS) + ")")
                print(out)
                return 1
    print("NT8 COMPILE OK: TradeZoroBridge.cs builds with C# 5, default references only, one top-level type (" + os.path.basename(argv[0]) + ")")
    return 0


if __name__ == "__main__":
    sys.exit(main())
