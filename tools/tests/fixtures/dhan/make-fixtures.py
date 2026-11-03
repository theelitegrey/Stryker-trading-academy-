# Builds binary Dhan market-feed packets with struct.pack and runs the OFFICIAL DhanHQ-py (dhanhq 2.3.0) marketfeed.py decoder on them.
# Output: packets.json = [{name, hex, official}]. tools/tests/dhan.test.mjs checks assets/dhan-feed.js gives the same numbers.
# Run: pip download dhanhq==2.3.0 --no-deps; unzip the wheel; PYTHONPATH=<unzipped dir> python3 make-fixtures.py
import json, struct, sys
from dhanhq.marketfeed import MarketFeed
m = MarketFeed.__new__(MarketFeed)
def hdr(code, ln, seg, sid): return struct.pack('<BHBI', code, ln, seg, sid)
depth = b''.join(struct.pack('<IIHHff', 100 + i, 200 + i, 3 + i, 4 + i, 24500.25 - i * 0.05, 24500.5 + i * 0.05) for i in range(5))
P = []
def add(name, data, fn): P.append({'name': name, 'hex': data.hex(), 'official': fn(data)})
add('ticker NSE_EQ', hdr(2, 16, 1, 2885) + struct.pack('<fI', 1234.55, 1762167600), m.process_data)
add('ticker IDX_I', hdr(2, 16, 0, 13) + struct.pack('<fI', 24500.25, 1762167601), m.process_data)
add('prev close', hdr(6, 16, 2, 54749) + struct.pack('<fI', 24400.0, 123450), m.process_data)
add('quote NSE_FNO', hdr(4, 50, 2, 54749) + struct.pack('<fHIfIIIffff', 24510.5, 75, 1762167602, 24480.3, 987654, 5000, 6000, 24400.0, 24390.0, 24550.0, 24380.0), m.process_data)
add('quote MCX_COMM', hdr(4, 50, 5, 495213) + struct.pack('<fHIfIIIffff', 144123.0, 2, 1762167603, 143900.0, 4567, 100, 90, 143800.0, 143700.0, 144300.0, 143600.0), m.process_data)
add('oi', hdr(5, 12, 2, 54749) + struct.pack('<I', 7654321), m.process_data)
add('status', hdr(7, 8, 0, 0), m.process_data)
add('full NSE_EQ', hdr(8, 162, 1, 2885) + struct.pack('<fHIfIIIIIIffff', 1234.55, 10, 1762167604, 1230.1, 5550000, 300, 400, 0, 0, 0, 1220.0, 1225.5, 1240.0, 1215.0) + depth, m.process_data)
add('depth (5 level)', hdr(3, 112, 1, 2885) + struct.pack('<f', 1234.55) + depth, m.process_data)
add('disconnect 807 token expired', hdr(50, 10, 0, 0) + struct.pack('<H', 807), lambda d: {'type': 'disconnect', 'code': struct.unpack('<H', d[8:10])[0]})
add('disconnect 806 no data plan', hdr(50, 10, 0, 0) + struct.pack('<H', 806), lambda d: {'type': 'disconnect', 'code': struct.unpack('<H', d[8:10])[0]})
json.dump(P, open(sys.argv[1] if len(sys.argv) > 1 else 'packets.json', 'w'), indent=1)
print(len(P), 'packets')
