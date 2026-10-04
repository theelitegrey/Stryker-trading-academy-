#!/usr/bin/env python3
"""Generate the illustrative hero SVG for home-preview-a.html (variation A).

All data is hand-built and illustrative. Y is SVG units (smaller y = higher price).
Run: python3 tools/_gen_combo_a.py > /tmp/svg.html
"""

# (open, high, low, close, volume weight) in SVG y units. bull if close < open.
C = [
    # accumulation (prev range)
    (232, 222, 244, 226, 1.0), (226, 220, 240, 234, 1.0), (234, 224, 242, 228, 0.9),
    (228, 222, 240, 236, 0.9), (236, 226, 246, 230, 1.0), (230, 224, 238, 226, 0.9),
    # rally to the first swing high (liquidity at y72)
    (226, 196, 230, 202, 1.3), (202, 176, 206, 182, 1.2), (182, 150, 186, 156, 1.1),
    (156, 128, 162, 134, 0.8), (134, 100, 138, 106, 0.7), (106, 72, 110, 80, 0.8),
    # pullback and push back up
    (80, 76, 104, 98, 0.8), (98, 92, 112, 106, 0.8), (106, 84, 110, 88, 0.8),
    (88, 78, 92, 82, 0.8),
    # Judas swing: wick sweeps the y72 high and tags the call wall (y48)
    (82, 44, 86, 78, 1.6),
    # rejection back down into the range
    (78, 74, 112, 108, 1.4), (108, 104, 136, 130, 1.1), (130, 126, 152, 148, 1.0),
    # consolidation: builds the POC (y~162)
    (148, 144, 172, 166, 1.5), (166, 152, 174, 156, 1.6), (156, 150, 178, 170, 1.7),
    (170, 156, 184, 160, 1.7), (160, 154, 176, 168, 1.6), (168, 150, 182, 172, 1.5),
    # last up candle = bearish order block (150-172)
    (172, 150, 176, 154, 1.4),
    # displacement down: breaks the y184 low (MSS), leaves FVG 176-196
    (154, 152, 214, 210, 2.0), (210, 196, 240, 236, 1.8),
    (236, 230, 250, 244, 1.2), (244, 236, 252, 240, 1.0),
    # retrace up into FVG / OB (entry zone)
    (240, 214, 244, 218, 1.0), (218, 196, 222, 200, 1.0), (200, 164, 204, 176, 1.2),
    (176, 166, 200, 196, 1.3),
    # delivery toward the put wall
    (196, 192, 228, 222, 1.2), (222, 218, 244, 240, 1.1), (240, 236, 258, 254, 1.0),
    (254, 248, 262, 252, 0.9), (252, 250, 270, 266, 1.0), (266, 256, 268, 258, 0.9),
]

X0, DX, W = 66, 7.2, 4.8
LEVEL = {
    'call': 46, 'liq': 72, 'zero': 170, 'put': 270,
    'ob': (150, 176), 'fvg': (176, 196), 'mss': 184,
}

def candles():
    out = []
    for i, (o, h, l, c, v) in enumerate(C):
        x = X0 + i * DX
        cls = 'ca-bull' if c < o else 'ca-bear'
        top, bot = min(o, c), max(o, c)
        out.append(
            f'<g class="ca-c" style="--d:{i*0.045:.2f}s">'
            f'<rect class="ca-wick" x="{x+W/2-0.6:.1f}" y="{h}" width="1.2" height="{l-h}"/>'
            f'<rect class="{cls}" x="{x:.1f}" y="{top}" width="{W}" height="{max(bot-top,2)}" rx="1"/></g>')
    return '\n'.join(out)

def profile():
    # time/volume at price, rows of 6 units from y40 to y274
    rows = list(range(40, 274, 6))
    vol = {r: 0.0 for r in rows}
    for (o, h, l, c, v) in C:
        top, bot = min(o, c), max(o, c)
        for r in rows:
            mid = r + 3
            if h <= mid <= l:
                vol[r] += v * (1.0 if top <= mid <= bot else 0.35)
    # smooth a touch so it reads like a real profile
    sm = {}
    for i, r in enumerate(rows):
        a = vol[rows[i-1]] if i else vol[r]
        b = vol[rows[i+1]] if i < len(rows)-1 else vol[r]
        sm[r] = 0.25*a + 0.5*vol[r] + 0.25*b
    mx = max(sm.values())
    poc = max(rows, key=lambda r: sm[r])
    # value area 70%
    total = sum(sm.values()); inc = {poc}; acc = sm[poc]
    lo = hi = rows.index(poc)
    while acc < 0.7*total:
        up = sm[rows[lo-1]] if lo > 0 else -1
        dn = sm[rows[hi+1]] if hi < len(rows)-1 else -1
        if up >= dn: lo -= 1; acc += up; inc.add(rows[lo])
        else: hi += 1; acc += dn; inc.add(rows[hi])
    vah, val = rows[lo], rows[hi] + 6
    bars = []
    for i, r in enumerate(rows):
        w = round(sm[r] / mx * 84, 1)
        if w < 2: continue
        cls = 'vp-poc' if r == poc else ('vp-va' if r in inc else 'vp-out')
        bars.append(f'<rect class="vp-bar {cls}" style="--d:{i*0.018:.2f}s" x="{460-w}" y="{r+0.6}" width="{w}" height="4.8"/>')
    return '\n'.join(bars), poc + 3, vah, val, {r: round(sm[r], 2) for r in rows}


def card():
    bars, poc, vah, val, _ = profile()
    L = LEVEL
    ob, fvg = L['ob'], L['fvg']
    xi = lambda i: round(X0 + i * DX, 1)
    t = lambda s: s
    return f'''<div class="chart-card ca-card" id="ca-card" data-lens="gex vp ict">
      <div class="chart-card-head">
        <div><span class="pair">Illustrative</span> · one chart, three lenses</div>
        <div class="chart-dots"><span></span><span></span><span></span></div>
      </div>
      <div class="ca-pills" role="group" aria-label="Chart layers">
        <button type="button" class="ca-pill ca-p-gex" data-lens="gex" aria-pressed="true"><i></i>GEX</button>
        <button type="button" class="ca-pill ca-p-vp" data-lens="vp" aria-pressed="true"><i></i>Volume Profile</button>
        <button type="button" class="ca-pill ca-p-ict" data-lens="ict" aria-pressed="true"><i></i>ICT</button>
      </div>
      <div class="chart-svg-wrap ca-wrap">
        <svg class="ca-svg" viewBox="0 0 460 300" width="100%" style="height:auto" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Illustrative chart combining three lenses. GEX: a call wall above, a zero-gamma flip and a put wall below. Volume profile: a point of control and value area on the right edge. ICT: a Judas swing sweeps the high into the call wall, price displaces down through a market structure shift leaving a fair value gap, and the entry is the retrace into the order block. The order block, the point of control and the zero-gamma flip line up in one confluence zone. Hand-built example, not market data.">
          <g class="ca-grid"><line x1="0" y1="60" x2="460" y2="60"/><line x1="0" y1="120" x2="460" y2="120"/><line x1="0" y1="180" x2="460" y2="180"/><line x1="0" y1="240" x2="460" y2="240"/></g>

          <!-- GEX zones (under everything) -->
          <g class="ca-layer ca-gex ca-gex-zones">
            <g class="ca-zw"><rect class="ca-zone-pos" x="0" y="{L['call']}" width="460" height="{L['zero']-L['call']}"/>
            <rect class="ca-zone-neg" x="0" y="{L['zero']}" width="460" height="{L['put']-L['zero']}"/></g>
          </g>

          <!-- confluence band: shows when all three lenses are on -->
          <g class="ca-conf"><g class="ca-cb">
            <rect class="ca-conf-band" x="0" y="{ob[0]-2}" width="460" height="{ob[1]-ob[0]+4}"/>
          </g></g>

          <!-- VOLUME PROFILE -->
          <g class="ca-layer ca-vp">
            <g class="ca-vp-bars">
{bars}
            </g>
            <g class="ca-vpl"><line class="ca-vp-va" x1="0" y1="{vah}" x2="460" y2="{vah}"/>
            <line class="ca-vp-va" x1="0" y1="{val}" x2="460" y2="{val}"/>
            <line class="ca-vp-pocl" x1="0" y1="{poc}" x2="460" y2="{poc}"/>
            <text class="ca-t ca-t-vp ca-halo" x="456" y="{vah-4}" text-anchor="end">VAH</text>
            <text class="ca-t ca-t-vp ca-t-b ca-halo" x="456" y="{poc-4}" text-anchor="end">POC</text>
            <text class="ca-t ca-t-vp ca-halo" x="456" y="{val+11}" text-anchor="end">VAL</text>
            <text class="ca-t ca-t-dim ca-sm-hide ca-halo" x="456" y="{124}" text-anchor="end">LVN</text>
            <text class="ca-t ca-t-dim ca-sm-hide ca-halo" x="456" y="{92}" text-anchor="end">HVN</text></g>
          </g>

          <!-- candles -->
          <g class="ca-candles">
{candles()}
          </g>

          <!-- ICT -->
          <g class="ca-layer ca-ict">
            <g class="ca-i" style="--d:0s">
              <line class="ca-liq" x1="{xi(10)}" y1="{L['liq']}" x2="{xi(17)+8}" y2="{L['liq']}"/>
              <text class="ca-t ca-t-dim ca-sm-hide" x="{xi(10)-4}" y="{L['liq']+3}" text-anchor="end">BSL</text>
            </g>
            <g class="ca-i" style="--d:.25s">
              <circle class="ca-judas" cx="{xi(16)+2.8}" cy="{48}" r="6"/>
              <text class="ca-t ca-halo ca-t-ict ca-t-b" x="{xi(16)+12}" y="{40}">JUDAS SWING</text>
            </g>
            <g class="ca-i" style="--d:.5s">
              <line class="ca-mss" x1="{xi(19)}" y1="{L['mss']}" x2="{xi(29)}" y2="{L['mss']}"/>
              <text class="ca-t ca-halo ca-t-mss ca-t-b" x="{xi(19)}" y="{L['mss']+11}">MSS</text>
            </g>
            <g class="ca-i" style="--d:.75s">
              <rect class="ca-fvg" x="{xi(27)}" y="{fvg[0]}" width="{xi(35)-xi(27)}" height="{fvg[1]-fvg[0]}"/>
              <text class="ca-t ca-halo ca-t-fvg" x="{xi(30)+2}" y="{fvg[0]+13}">FVG</text>
            </g>
            <g class="ca-i" style="--d:1s">
              <rect class="ca-ob" x="{xi(26)}" y="{ob[0]}" width="{xi(35)-xi(26)}" height="{ob[1]-ob[0]}"/>
              <text class="ca-t ca-halo ca-t-ob ca-t-b" x="{xi(26)+2}" y="{ob[0]-4}">OB</text>
            </g>
            <g class="ca-i" style="--d:1.25s">
              <g class="ca-bob">
                <path class="ca-entry" d="M{xi(33)+2.8} {162} l-4.5 -8 h9 z"/>
                <line class="ca-entry-l" x1="{xi(33)+2.8}" y1="{144}" x2="{xi(33)+2.8}" y2="{154}"/>
              </g>
              <text class="ca-t ca-halo ca-t-entry ca-t-b" x="{xi(33)-1}" y="{140}" text-anchor="middle">ENTRY</text>
            </g>
          </g>

          <!-- GEX lines (on top so labels stay readable) -->
          <g class="ca-layer ca-gex">
            <g class="ca-g" style="--d:0s">
              <line class="ca-wall ca-wall-call" x1="0" y1="{L['call']}" x2="460" y2="{L['call']}"/>
              <text class="ca-t ca-t-call ca-t-b ca-halo" x="4" y="{L['call']-5}">CALL WALL</text>
              <text class="ca-t ca-t-dim ca-halo ca-sm-hide" x="4" y="{L['call']+12}">+γ</text>
            </g>
            <g class="ca-g" style="--d:.2s">
              <line class="ca-wall ca-wall-zero" x1="0" y1="{L['zero']}" x2="460" y2="{L['zero']}"/>
              <text class="ca-t ca-t-zero ca-t-b ca-halo" x="4" y="{L['zero']-5}">ZERO-γ</text>
              <text class="ca-t ca-t-dim ca-halo ca-sm-hide" x="4" y="{L['zero']+12}">−γ</text>
            </g>
            <g class="ca-g" style="--d:.4s">
              <line class="ca-wall ca-wall-put" x1="0" y1="{L['put']}" x2="460" y2="{L['put']}"/>
              <text class="ca-t ca-t-put ca-t-b ca-halo" x="4" y="{L['put']-5}">PUT WALL</text>
            </g>
          </g>

          <g class="ca-conf"><g class="ca-conf-tag">
            <rect class="ca-conf-pill" x="{xi(36)-4}" y="{ob[0]-33}" width="80" height="15" rx="7.5"/>
            <text class="ca-t ca-t-conf ca-t-b" x="{xi(36)+36}" y="{ob[0]-22.5}" text-anchor="middle">CONFLUENCE</text>
          </g></g>
        </svg>
      </div>
      <div class="chart-legend ca-legend">
        <span class="ca-lg-gex"><i></i>GEX: call wall, zero-γ flip, put wall</span>
        <span class="ca-lg-vp"><i></i>Volume profile: POC, value area</span>
        <span class="ca-lg-ict"><i></i>ICT: sweep, MSS, FVG, OB entry</span>
        <span class="ca-note">Illustrative, hand-built example. Not market data. Education only. Not financial advice.</span>
      </div>
    </div>'''

def build():
    import os, re
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    src = open(os.path.join(root, 'index.html')).read()
    a = src.index('    <div class="chart-card">')
    b = src.index('</header>', a)
    b = src.rindex('  </div>', a, b)  # end of hero-inner container
    head = src[:a]; tail = src[b:]
    # the old card ends with '    </div>\n' right before '  </div>' (container)
    out = head + '    ' + card().lstrip() + '\n' + tail
    out = out.replace('<meta name="viewport"', '<meta name="robots" content="noindex, nofollow">\n<meta name="viewport"', 1)
    out = out.replace('<link rel="canonical" href="https://strykertrading.com/">\n', '', 1)
    out = out.replace('<link rel="stylesheet" href="assets/home-motion.css?v=368">',
        '<link rel="stylesheet" href="assets/home-motion.css?v=368">\n<link rel="stylesheet" href="assets/home-combo-a.css?v=368">', 1)
    out = out.replace('<script src="assets/home-motion.js?v=368"></script>',
        '<script src="assets/home-motion.js?v=368"></script>\n<script src="assets/home-combo-a.js?v=368"></script>', 1)
    open(os.path.join(root, 'home-preview-a.html'), 'w').write(out)

if __name__ == '__main__':
    import sys
    _, poc, vah, val, _d = profile()
    sys.stderr.write(f'POC y={poc} VAH y={vah} VAL y={val}\n')
    build()
