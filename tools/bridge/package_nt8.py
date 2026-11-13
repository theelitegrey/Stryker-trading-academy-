"""Build TradeZoroBridge-NT8.zip in NinjaTrader 8's import layout:  Info.xml + AddOns/TradeZoroBridge.cs  (forward slashes,
capital-I Info.xml; NT8 rejects a lowercase info.xml). Source only: NT8 compiles it on Tools > Import > NinjaScript Add-On.
Usage: python3 package_nt8.py [out.zip]"""
import subprocess, sys, zipfile
from pathlib import Path
HERE = Path(__file__).resolve().parent
INFO = '<?xml version="1.0" encoding="utf-8"?>\r\n<NinjaTrader>\r\n  <Export>\r\n    <Version>8.1.4.0</Version>\r\n  </Export>\r\n</NinjaTrader>\r\n'
rc = subprocess.call([sys.executable, str(HERE / "tests" / "compile_nt8.py")])
if rc == 1: sys.exit("not packaging: TradeZoroBridge.cs does not compile like NT8 would (see above)")   # rc 2 = no compiler here, CI still checks
out = Path(sys.argv[1] if len(sys.argv) > 1 else "TradeZoroBridge-NT8.zip")
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for name, data in (("Info.xml", INFO.encode()), ("AddOns/TradeZoroBridge.cs", (HERE / "ninjatrader" / "TradeZoroBridge.cs").read_bytes())):
        zi = zipfile.ZipInfo(name, (2026, 11, 4, 0, 0, 0)); zi.compress_type = zipfile.ZIP_DEFLATED; zi.external_attr = 0o644 << 16
        z.writestr(zi, data)
print("wrote", out, [i.filename for i in zipfile.ZipFile(out).infolist()])
