/**
 * Stryker Trading Academy — branded image cards for X posts
 *
 * Every automated post carries a 1200×675 PNG card. Each post KIND has its own
 * style, so a follower learns what a card means before reading it: the daily
 * brief always looks one way, a countdown another, a new chapter a third. The
 * loud styles are reserved for time-sensitive posts so they keep meaning
 * something.
 *
 * DEFAULT MAPPING (xAutopost/config.cardStyles overrides any row):
 *   brief     ticker     centred headline over a strip of six real prints
 *   calendar  alert      hazard stripes, minutes-to-release as the big number
 *   monitor   breaking   red label block naming the signal, news-bar footer
 *   announce  glass      brand gradient with a frosted panel
 *   feature   electric   magenta-to-violet, the one marketing-grade card
 *   manual    terminal   neutral dark card
 *
 * The other six styles (split, editorial, poster, neon, gold, splitcolor) are
 * kept so an admin can reassign a kind from the settings page without a
 * redeploy. STYLE_KEYS is the list the admin page offers.
 *
 * HOW: the card is built as an SVG string (no DOM, no browser) and rasterised
 * with @resvg/resvg-js, which ships prebuilt binaries for the Cloud Functions
 * runtime. Text is laid out here by hand with a width estimate per character;
 * bold and serif text are wider, and wrap() accounts for that. The SVG string
 * is also stored on the queue document so the admin page can preview it.
 *
 * Colours mirror assets/style.css (:root). Keep them in step by hand.
 */

const W = 1200;
const H = 675;

const C = {
  bg0: '#050506', bg1: '#0b0b0d', bg2: '#131316', bg3: '#1e1e22', line: '#2c2c32',
  ink0: '#eeeeee', ink1: '#c9cdd3', ink2: '#8b93a0', ink3: '#5c6472',
  mint: '#03c988', mintBright: '#4fe3ac', mintDim: '#027a54', teal: '#00adb5',
  red: '#e5484d', amber: '#f5c542', indigo: '#13005a', royal: '#00337c',
  cyan: '#00e5ff', magenta: '#ff2d75', violet: '#7c3aed'
};

const SANS = "'DejaVu Sans', 'Liberation Sans', Arial, Helvetica, sans-serif";
const SERIF = "'DejaVu Serif', Georgia, serif";
// Inter (SIL OFL) ships in ./fonts and is loaded by renderPng. Inter Display
// is the tight-tracked cut for large headlines; Inter for everything else.
const UI = "'Inter', 'DejaVu Sans', Arial, sans-serif";
const DISPLAY = "'Inter Display', 'Inter', 'DejaVu Sans', Arial, sans-serif";
const FONT_DIR = require('path').join(__dirname, 'fonts');

const DEFAULT_STYLES = {
  brief: 'aurora', calendar: 'countdown', monitor: 'signal',
  announce: 'sheet', feature: 'spotlight', manual: 'quiet'
};

const STYLE_KEYS = ['aurora', 'countdown', 'signal', 'sheet', 'spotlight', 'quiet',
                    'terminal', 'split', 'editorial', 'ticker', 'glass', 'poster',
                    'neon', 'alert', 'electric', 'gold', 'splitcolor', 'breaking'];

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ---- text layout -------------------------------------------------------------

// Average glyph advance as a fraction of font size for DejaVu Sans, regular.
function charWidth(ch, size) {
  if (/[mwMW@%]/.test(ch)) return size * 0.86;
  if (/[A-Z0-9]/.test(ch)) return size * 0.68;
  if (/[il|!.,:;'’ ]/.test(ch)) return size * 0.30;
  if (/[fjrt\-()[\]]/.test(ch)) return size * 0.40;
  return size * 0.58;
}

// Bold DejaVu is about a tenth wider than regular; the serif wider again.
// Inter is narrower than DejaVu; Inter Display with negative tracking narrower
// still. The factors were tuned against rendered output, not the font tables.
function textWidth(s, size, opts) {
  let f = 1;
  if (opts && opts.serif) f = 1.22;
  else if (opts && opts.display) f = 0.84;
  else if (opts && opts.inter) f = (opts.bold ? 0.95 : 0.9);
  else if (opts && opts.bold) f = 1.12;
  let w = 0;
  for (const ch of String(s)) w += charWidth(ch, size);
  return w * f;
}

/** Greedy word wrap into at most `maxLines` lines; the last line is ellipsised. */
function wrap(text, size, maxWidth, maxLines, opts) {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const trial = cur ? cur + ' ' + w : w;
    if (textWidth(trial, size, opts) <= maxWidth || !cur) {
      cur = trial;
    } else {
      lines.push(cur);
      cur = w;
      if (lines.length === maxLines) break;
    }
  }
  if (lines.length < maxLines && cur) lines.push(cur);
  if (lines.length === maxLines && words.join(' ') !== lines.join(' ')) {
    let last = lines[maxLines - 1];
    while (last.length && textWidth(last + '…', size, opts) > maxWidth) last = last.slice(0, -1);
    lines[maxLines - 1] = last.replace(/[\s,.;:]+$/, '') + '…';
  }
  return lines;
}

function L(lines, x, y, size, lh, fill, weight, o) {
  o = o || {};
  return lines.map((l, i) =>
    `<text x="${x}" y="${y + i * lh}" font-family="${o.font || SANS}" font-size="${size}" ` +
    `font-weight="${weight || 400}" fill="${fill}"${o.anchor ? ` text-anchor="${o.anchor}"` : ''}` +
    `${o.extra || ''}>${esc(l)}</text>`).join('');
}

function brand(x, y, box, stroke, text, boxStroke) {
  return `<g transform="translate(${x},${y})"><rect width="44" height="44" rx="10" fill="${box}"` +
    `${boxStroke ? ` stroke="${boxStroke}"` : ''}/><path d="M12 30 L20 16 L26 24 L32 12" fill="none" ` +
    `stroke="${stroke}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<text x="60" y="30" font-family="${SANS}" font-size="22" font-weight="700" fill="${text}">Stryker Trading Academy</text></g>`;
}

function foot(ink, ink2, x, y, boldSite) {
  x = x || 72; y = y || (H - 44);
  return `<text x="${x}" y="${y}" font-family="${SANS}" font-size="20"${boldSite ? ' font-weight="700"' : ''} fill="${ink}">strykertrading.com</text>` +
    `<text x="${W - x}" y="${y}" text-anchor="end" font-family="${SANS}" font-size="20" fill="${ink2}">Not financial advice</text>`;
}

const up = (s) => esc(String(s || '').toUpperCase());
const svgOpen = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;


// ---- illustrations -----------------------------------------------------------------
// Pure vector, drawn here so a card never depends on a file on the server. All
// decorative: none of these encode data except the gauge, which shows the
// stat value's position within the label's range when one is known.

const ILLUS = {};

/** Abstract candlesticks along the lower half, low opacity. Decorative only. */
ILLUS.candles = (x0, y0, w, h, color, opacity) => {
  // A fixed pseudo-random walk so every render is identical.
  const seq = [3, -2, 4, -1, -3, 5, 2, -4, 1, 3, -2, -1, 4, 2, -3, 5, -1, 2, 3, -2, 4, 1, -3, 2];
  const n = seq.length, cw = w / n;
  let y = y0 + h * 0.55, out = [];
  seq.forEach((d, i) => {
    const open = y, close = y - d * (h / 26);
    const hi = Math.min(open, close) - (h / 20), lo = Math.max(open, close) + (h / 20);
    const cx = x0 + i * cw + cw / 2, upc = close < open;
    out.push(`<line x1="${cx}" y1="${hi}" x2="${cx}" y2="${lo}" stroke="${color}" stroke-width="2" stroke-opacity="${opacity}"/>`);
    out.push(`<rect x="${cx - cw * 0.28}" y="${Math.min(open, close)}" width="${cw * 0.56}" height="${Math.max(3, Math.abs(close - open))}" ` +
             `fill="${upc ? color : 'none'}" stroke="${color}" stroke-width="2" fill-opacity="${opacity}" stroke-opacity="${opacity}"/>`);
    y = close;
  });
  return `<g>${out.join('')}</g>`;
};

/** Clock face with hands, plus a small bell. `minutes` sets the minute hand. */
ILLUS.clock = (cx, cy, r, color, ink, minutes) => {
  const ticks = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2, big = i % 3 === 0;
    ticks.push(`<line x1="${cx + Math.sin(a) * (r - (big ? 22 : 14))}" y1="${cy - Math.cos(a) * (r - (big ? 22 : 14))}" ` +
               `x2="${cx + Math.sin(a) * (r - 6)}" y2="${cy - Math.cos(a) * (r - 6)}" stroke="${ink}" stroke-width="${big ? 4 : 2}" stroke-opacity="0.55"/>`);
  }
  const m = ((Number(minutes) || 30) % 60) / 60 * Math.PI * 2;
  const wedge = `<path d="M${cx} ${cy} L${cx} ${cy - r + 8} A${r - 8} ${r - 8} 0 ${m > Math.PI ? 1 : 0} 1 ${cx + Math.sin(m) * (r - 8)} ${cy - Math.cos(m) * (r - 8)} Z" fill="${color}" fill-opacity="0.18"/>`;
  return `<g><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="6"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${r - 10}" fill="none" stroke="${ink}" stroke-opacity="0.15"/>${wedge}${ticks.join('')}` +
    `<line x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy - r * 0.55}" stroke="${ink}" stroke-width="7" stroke-linecap="round"/>` +
    `<line x1="${cx}" y1="${cy}" x2="${cx + Math.sin(m) * r * 0.78}" y2="${cy - Math.cos(m) * r * 0.78}" stroke="${color}" stroke-width="5" stroke-linecap="round"/>` +
    `<circle cx="${cx}" cy="${cy}" r="9" fill="${color}"/>` +
    // bell, top right of the face
    `<g transform="translate(${cx + r * 0.72},${cy - r * 0.95})"><path d="M0 26 C0 10 8 4 16 4 C24 4 32 10 32 26 L36 32 L-4 32 Z" fill="${color}"/>` +
    `<circle cx="16" cy="38" r="5" fill="${color}"/><circle cx="16" cy="2" r="3" fill="${color}"/></g></g>`;
};

/** A half-ring gauge with a needle. `frac` in 0..1; decorative when null. */
ILLUS.gauge = (cx, cy, r, colorLo, colorHi, ink, frac) => {
  const f = typeof frac === 'number' ? Math.max(0, Math.min(1, frac)) : 0.62;
  const a = Math.PI * (1 - f), nx = cx + Math.cos(a) * (r - 30), ny = cy - Math.sin(a) * (r - 30);
  const arc = (r0, w, col, op) => `<path d="M${cx - r0} ${cy} A${r0} ${r0} 0 0 1 ${cx + r0} ${cy}" fill="none" stroke="${col}" stroke-width="${w}" stroke-opacity="${op}" stroke-linecap="round"/>`;
  const seg = [];
  for (let i = 0; i < 24; i++) {
    const t0 = Math.PI * (1 - i / 24), t1 = Math.PI * (1 - (i + 0.7) / 24);
    const col = i < 8 ? colorLo : (i < 16 ? '#f5c542' : colorHi);
    seg.push(`<path d="M${cx + Math.cos(t0) * r} ${cy - Math.sin(t0) * r} A${r} ${r} 0 0 1 ${cx + Math.cos(t1) * r} ${cy - Math.sin(t1) * r}" fill="none" stroke="${col}" stroke-width="14" stroke-opacity="${i / 24 <= f ? 0.95 : 0.22}"/>`);
  }
  return `<g>${arc(r + 22, 2, ink, 0.18)}${seg.join('')}` +
    `<line x1="${cx}" y1="${cy}" x2="${nx}" y2="${ny}" stroke="${ink}" stroke-width="6" stroke-linecap="round"/>` +
    `<circle cx="${cx}" cy="${cy}" r="12" fill="${ink}"/><circle cx="${cx}" cy="${cy}" r="5" fill="${colorHi}"/></g>`;
};

/** Three stacked chapter cards with a bookmark, tilted. */
ILLUS.cards = (x, y, color, ink) => {
  const card = (dx, dy, rot, op) => `<g transform="translate(${x + dx},${y + dy}) rotate(${rot})"><rect width="220" height="150" rx="14" fill="#0b0b0d" fill-opacity="${op}" stroke="#fff" stroke-opacity="0.35"/>` +
    `<rect x="18" y="20" width="110" height="10" rx="5" fill="${ink}" fill-opacity="0.8"/><rect x="18" y="42" width="180" height="7" rx="3.5" fill="${ink}" fill-opacity="0.35"/>` +
    `<rect x="18" y="58" width="150" height="7" rx="3.5" fill="${ink}" fill-opacity="0.35"/><rect x="18" y="74" width="165" height="7" rx="3.5" fill="${ink}" fill-opacity="0.35"/>` +
    `<rect x="18" y="112" width="70" height="20" rx="10" fill="${color}"/></g>`;
  return `<g>${card(40, 30, -8, 0.55)}${card(20, 15, -4, 0.7)}${card(0, 0, 0, 0.9)}` +
    `<path d="M${x + 186} ${y - 6} L${x + 186} ${y + 52} L${x + 200} ${y + 40} L${x + 214} ${y + 52} L${x + 214} ${y - 6} Z" fill="${color}"/></g>`;
};

/** A dashboard window: title bar, a line chart pane and three bars. */
ILLUS.dashboard = (x, y, color, accent) => {
  return `<g transform="translate(${x},${y})"><rect width="300" height="210" rx="16" fill="#0b0b0d" fill-opacity="0.55" stroke="#fff" stroke-opacity="0.35"/>` +
    `<rect width="300" height="30" rx="16" fill="#fff" fill-opacity="0.12"/><circle cx="18" cy="15" r="5" fill="${accent}"/><circle cx="34" cy="15" r="5" fill="#f5c542"/><circle cx="50" cy="15" r="5" fill="${color}"/>` +
    `<rect x="18" y="46" width="176" height="120" rx="10" fill="#fff" fill-opacity="0.06"/>` +
    `<polyline points="30,150 60,120 90,132 120,96 150,104 180,70" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<circle cx="180" cy="70" r="6" fill="${color}"/>` +
    `<rect x="212" y="110" width="18" height="56" rx="4" fill="${accent}" fill-opacity="0.9"/><rect x="240" y="80" width="18" height="86" rx="4" fill="${color}"/><rect x="268" y="128" width="18" height="38" rx="4" fill="#fff" fill-opacity="0.5"/>` +
    `<rect x="18" y="180" width="120" height="8" rx="4" fill="#fff" fill-opacity="0.35"/></g>`;
};

/** The brand mark, large and faint, as a watermark. */
ILLUS.watermark = (x, y, size, color) => {
  const k = size / 44;
  return `<g transform="translate(${x},${y}) scale(${k})" opacity="0.08"><rect width="44" height="44" rx="10" fill="${color}"/>` +
    `<path d="M12 30 L20 16 L26 24 L32 12" fill="none" stroke="#000" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></g>`;
};

/** Reads a number out of a stat value like "22.4" or "4.93%" for the gauge. */
function statFrac(stat) {
  if (!stat || !stat.value) return null;
  const v = parseFloat(String(stat.value).replace(/[^\d.\-]/g, ''));
  if (isNaN(v)) return null;
  const l = String(stat.label || '').toLowerCase();
  if (l.includes('vix')) return (v - 10) / 30;          // 10 calm .. 40 extreme
  if (l.includes('defcon')) return (5 - v) / 4;          // 5 calm .. 1 max
  if (l.includes('risk')) return v / 100;                // risk score 0..100
  return null;
}

// ---- styles --------------------------------------------------------------------
// Every style takes spec = { eyebrow, title, body, stat?, ticker?, label?, kind }.

const STYLES = {};

STYLES.terminal = (s) => {
  const t = wrap(s.title, 52, 940, 3, { bold: true }), b = wrap(s.body, 26, 1056, 4);
  const bt = 200 + t.length * 61 + 28;
  return svgOpen +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${C.bg1}"/><stop offset="1" stop-color="${C.bg0}"/></linearGradient>` +
    `<radialGradient id="r" cx="0.9" cy="0.1" r="0.7"><stop offset="0" stop-color="${C.indigo}" stop-opacity="0.9"/><stop offset="1" stop-color="${C.bg0}" stop-opacity="0"/></radialGradient></defs>` +
    `<rect width="${W}" height="${H}" fill="url(#g)"/><rect width="${W}" height="${H}" fill="url(#r)"/><rect width="${W}" height="6" fill="${C.mint}"/>` +
    ILLUS.watermark(860, 250, 300, C.mint) +
    brand(72, 78, C.bg2, C.mint, C.ink0, C.line) +
    `<text x="72" y="152" font-family="${SANS}" font-size="20" font-weight="600" fill="${C.mint}" letter-spacing="3">${up(s.eyebrow)}</text>` +
    L(t, 72, 242, 52, 61, C.ink0, 700) + L(b, 72, bt + 26, 26, 38, C.ink1) +
    `<line x1="72" y1="${H - 84}" x2="${W - 72}" y2="${H - 84}" stroke="${C.line}"/>` + foot(C.ink2, C.ink3) + '</svg>';
};

STYLES.split = (s) => {
  const hasStat = s.stat && s.stat.value;
  const tw = hasStat ? 560 : 940, bw = hasStat ? 620 : 1000;
  const t = wrap(s.title, 46, tw, 3, { bold: true }), b = wrap(s.body, 24, bw, 4);
  const bt = 250 + t.length * 55 + 24;
  return svgOpen + `<rect width="${W}" height="${H}" fill="${C.bg1}"/>` +
    (hasStat ? `<rect x="800" y="0" width="400" height="${H}" fill="${C.bg2}"/><rect x="800" y="0" width="3" height="${H}" fill="${C.mint}"/>` : `<rect width="${W}" height="6" fill="${C.mint}"/>`) +
    brand(72, 78, C.bg2, C.mint, C.ink0, C.line) +
    `<text x="72" y="152" font-family="${SANS}" font-size="19" font-weight="600" fill="${C.mint}" letter-spacing="3">${up(s.eyebrow)}</text>` +
    L(t, 72, 250, 46, 55, C.ink0, 700) + L(b, 72, bt + 24, 24, 35, C.ink1) +
    (hasStat ? `<text x="1000" y="340" text-anchor="middle" font-family="${SANS}" font-size="112" font-weight="700" fill="${C.mint}">${esc(s.stat.value)}</text>` +
      `<text x="1000" y="386" text-anchor="middle" font-family="${SANS}" font-size="19" fill="${C.ink2}" letter-spacing="3">${up(s.stat.label)}</text>` +
      `<path d="M860 470 L900 440 L940 452 L980 420 L1020 430 L1060 400 L1100 410 L1140 380" fill="none" stroke="${C.mintDim}" stroke-width="3" stroke-linecap="round"/>` : '') +
    foot(C.ink2, C.ink3) + '</svg>';
};

STYLES.editorial = (s) => {
  const t = wrap(s.title, 58, 1056, 3, { serif: true }), b = wrap(s.body, 25, 760, 4);
  const bt = 230 + t.length * 68 + 30;
  return svgOpen + `<rect width="${W}" height="${H}" fill="#0e0e11"/>` +
    `<line x1="72" y1="120" x2="${W - 72}" y2="120" stroke="${C.ink3}"/><line x1="72" y1="124" x2="${W - 72}" y2="124" stroke="${C.ink3}"/>` +
    `<text x="72" y="96" font-family="${SERIF}" font-size="24" font-weight="700" fill="${C.ink0}">Stryker Trading Academy</text>` +
    `<text x="${W - 72}" y="96" text-anchor="end" font-family="${SANS}" font-size="18" fill="${C.mint}" letter-spacing="3">${up(s.eyebrow)}</text>` +
    L(t, 72, 278, 58, 68, C.ink0, 700, { font: SERIF }) +
    `<rect x="72" y="${bt}" width="4" height="${b.length * 36 + 8}" fill="${C.mint}"/>` + L(b, 96, bt + 28, 25, 36, C.ink1) +
    `<line x1="72" y1="${H - 84}" x2="${W - 72}" y2="${H - 84}" stroke="${C.ink3}"/>` + foot(C.ink2, C.ink3) + '</svg>';
};

STYLES.ticker = (s) => {
  const t = wrap(s.title, 54, 1000, 3, { bold: true });
  const grid = [];
  for (let x = 0; x <= W; x += 60) grid.push(`<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="${C.bg3}"/>`);
  for (let y = 0; y <= H; y += 60) grid.push(`<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="${C.bg3}"/>`);
  const items = (s.ticker || []).slice(0, 6);
  const tape = items.map((k, i) => {
    const x = 72 + i * 180;
    const col = k.dir > 0 ? C.mint : (k.dir < 0 ? C.red : C.ink1);
    return `<text x="${x}" y="${H - 58}" font-family="${SANS}" font-size="16" fill="${C.ink3}" letter-spacing="2">${up(k.label)}</text>` +
      `<text x="${x}" y="${H - 30}" font-family="${SANS}" font-size="24" font-weight="700" fill="${col}">${esc(k.text)}</text>`;
  }).join('');
  const body = items.length ? '' : L(wrap(s.body, 24, 900, 2), 600, 300 + t.length * 64 + 20, 24, 34, C.ink1, 400, { anchor: 'middle' });
  return svgOpen + `<defs><radialGradient id="v" cx="0.5" cy="0.45" r="0.6"><stop offset="0" stop-color="${C.bg1}" stop-opacity="0"/><stop offset="1" stop-color="${C.bg0}" stop-opacity="0.9"/></radialGradient></defs>` +
    `<rect width="${W}" height="${H}" fill="${C.bg1}"/>${grid.join('')}` +
    ILLUS.candles(60, 400, 1080, 170, C.mint, 0.22) +
    `<rect width="${W}" height="${H}" fill="url(#v)"/>` +
    brand(72, 60, C.bg2, C.mint, C.ink0, C.line) +
    `<text x="600" y="215" text-anchor="middle" font-family="${SANS}" font-size="19" font-weight="600" fill="${C.mint}" letter-spacing="4">${up(s.eyebrow)}</text>` +
    L(t, 600, 300, 54, 64, C.ink0, 700, { anchor: 'middle' }) + body +
    (items.length
      ? `<rect x="0" y="${H - 100}" width="${W}" height="100" fill="${C.bg2}"/><rect x="0" y="${H - 100}" width="${W}" height="2" fill="${C.mint}"/>${tape}`
      : `<line x1="72" y1="${H - 84}" x2="${W - 72}" y2="${H - 84}" stroke="${C.line}"/>` + foot(C.ink2, C.ink3)) + '</svg>';
};

STYLES.glass = (s) => {
  const t = wrap(s.title, 48, 640, 3, { bold: true }), b = wrap(s.body, 24, 640, 4);
  const bt = 250 + t.length * 57 + 20;
  return svgOpen + `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${C.royal}"/><stop offset="0.5" stop-color="${C.indigo}"/><stop offset="1" stop-color="${C.mintDim}"/></linearGradient></defs>` +
    `<rect width="${W}" height="${H}" fill="url(#g)"/><circle cx="1050" cy="120" r="260" fill="${C.mint}" fill-opacity="0.18"/><circle cx="120" cy="620" r="200" fill="${C.teal}" fill-opacity="0.18"/>` +
    `<rect x="72" y="120" width="1056" height="460" rx="24" fill="#000" fill-opacity="0.42" stroke="#fff" stroke-opacity="0.18"/>` +
    ILLUS.cards(830, 250, C.mint, '#fff') +
    brand(112, 160, C.bg2, C.mintBright, C.ink0, C.line) +
    `<text x="112" y="234" font-family="${SANS}" font-size="18" font-weight="600" fill="${C.mintBright}" letter-spacing="3">${up(s.eyebrow)}</text>` +
    L(t, 112, 290, 48, 57, '#fff', 700) + L(b, 112, bt + 24, 24, 34, '#d7dbe2') +
    `<text x="112" y="548" font-family="${SANS}" font-size="18" fill="#a9b0bc">strykertrading.com</text><text x="1088" y="548" text-anchor="end" font-family="${SANS}" font-size="18" fill="#8b93a0">Not financial advice</text></svg>`;
};

STYLES.poster = (s) => {
  const t = wrap(s.title, 60, 1000, 3, { bold: true }), b = wrap(s.body, 26, 900, 3);
  const bt = 230 + t.length * 70 + 24;
  return svgOpen + `<rect width="${W}" height="${H}" fill="${C.mint}"/>` + brand(72, 72, C.bg0, C.mint, C.bg0) +
    `<text x="${W - 72}" y="102" text-anchor="end" font-family="${SANS}" font-size="18" font-weight="700" fill="${C.bg0}" letter-spacing="3">${up(s.eyebrow)}</text>` +
    L(t, 72, 278, 60, 70, C.bg0, 700) + L(b, 72, bt + 26, 26, 37, '#0b2a1f') +
    `<line x1="72" y1="${H - 84}" x2="${W - 72}" y2="${H - 84}" stroke="${C.bg0}" stroke-opacity="0.35"/>` +
    `<text x="72" y="${H - 44}" font-family="${SANS}" font-size="20" font-weight="600" fill="${C.bg0}">strykertrading.com</text><text x="${W - 72}" y="${H - 44}" text-anchor="end" font-family="${SANS}" font-size="20" fill="#0b2a1f">Not financial advice</text></svg>`;
};

STYLES.neon = (s) => {
  const t = wrap(s.title, 58, 960, 3, { bold: true }), b = wrap(s.body, 25, 900, 3);
  const bt = 230 + t.length * 68 + 26;
  return svgOpen + `<defs><linearGradient id="tx" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${C.mintBright}"/><stop offset="0.55" stop-color="${C.cyan}"/><stop offset="1" stop-color="#b388ff"/></linearGradient>` +
    `<filter id="glow" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="14" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>` +
    `<radialGradient id="bg" cx="0.15" cy="0.2" r="0.9"><stop offset="0" stop-color="#0b1f1a"/><stop offset="1" stop-color="#000"/></radialGradient></defs>` +
    `<rect width="${W}" height="${H}" fill="url(#bg)"/><rect width="${W}" height="8" fill="url(#tx)"/>` + brand(72, 78, '#101418', C.mintBright, '#fff') +
    `<text x="72" y="152" font-family="${SANS}" font-size="20" font-weight="700" fill="${C.cyan}" letter-spacing="4">${up(s.eyebrow)}</text>` +
    `<g filter="url(#glow)">${L(t, 72, 278, 58, 68, 'url(#tx)', 700)}</g>` + L(b, 72, bt + 25, 25, 36, '#d9dee6') +
    `<rect y="${H - 8}" width="${W}" height="8" fill="url(#tx)"/>` + foot(C.ink2, C.ink3, 72, H - 40) + '</svg>';
};

STYLES.alert = (s) => {
  const hasStat = s.stat && s.stat.value;
  const t = wrap(s.title, 56, hasStat ? 700 : 940, 3, { bold: true }), b = wrap(s.body, 25, hasStat ? 700 : 1000, 3);
  const bt = 250 + t.length * 66 + 26;
  const stripes = [];
  for (let i = -2; i < 40; i++) stripes.push(`<polygon points="${i * 60},0 ${i * 60 + 30},0 ${i * 60 - 10},40 ${i * 60 - 40},40" fill="${C.red}"/>`);
  return svgOpen + `<rect width="${W}" height="${H}" fill="#0a0a0c"/><g>${stripes.join('')}</g><g transform="translate(0,${H - 40})">${stripes.join('')}</g>` +
    `<rect x="72" y="118" width="1056" height="4" fill="${C.red}"/><rect x="72" y="118" width="8" height="${H - 236}" fill="${C.red}"/>` +
    brand(100, 150, C.red, '#fff', '#fff') +
    `<text x="100" y="228" font-family="${SANS}" font-size="20" font-weight="700" fill="#ff6b70" letter-spacing="4">${up(s.eyebrow)}</text>` +
    L(t, 100, 302, 56, 66, '#fff', 700) + L(b, 100, bt + 25, 25, 36, C.ink1) +
    (hasStat ? ILLUS.clock(985, 300, 120, C.red, '#fff', s.stat.value) +
      `<text x="985" y="478" text-anchor="middle" font-family="${SANS}" font-size="64" font-weight="700" fill="${C.red}">${esc(s.stat.value)}</text>` +
      `<text x="985" y="512" text-anchor="middle" font-family="${SANS}" font-size="18" fill="#ff9da0" letter-spacing="3">${up(s.stat.label)}</text>` : '') +
    `<text x="100" y="${H - 64}" font-family="${SANS}" font-size="20" font-weight="700" fill="#fff">strykertrading.com</text><text x="${W - 100}" y="${H - 64}" text-anchor="end" font-family="${SANS}" font-size="20" fill="${C.ink2}">Not financial advice</text></svg>`;
};

STYLES.electric = (s) => {
  const hasStat = s.stat && s.stat.value;
  const t = wrap(s.title, 50, hasStat ? 600 : 680, 3, { bold: true }), b = wrap(s.body, 24, hasStat ? 720 : 680, 4);
  const bt = 250 + t.length * 59 + 22;
  return svgOpen + `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${C.magenta}"/><stop offset="0.6" stop-color="${C.violet}"/><stop offset="1" stop-color="#1e1b4b"/></linearGradient>` +
    `<filter id="sh"><feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="#000" flood-opacity="0.45"/></filter></defs><rect width="${W}" height="${H}" fill="url(#g)"/>` +
    (hasStat ? `<circle cx="1010" cy="330" r="190" fill="#000" fill-opacity="0.28"/><circle cx="1010" cy="330" r="190" fill="none" stroke="#fff" stroke-opacity="0.35" stroke-width="3"/>` +
      `<text x="1010" y="352" text-anchor="middle" font-family="${SANS}" font-size="96" font-weight="700" fill="#fff" filter="url(#sh)">${esc(s.stat.value)}</text>` +
      `<text x="1010" y="398" text-anchor="middle" font-family="${SANS}" font-size="18" fill="#ffd6e6" letter-spacing="3">${up(s.stat.label)}</text>`
      : `<circle cx="1040" cy="560" r="260" fill="#000" fill-opacity="0.18"/>` + ILLUS.dashboard(820, 230, '#fff', C.magenta)) +
    brand(72, 78, '#fff', C.magenta, '#fff') +
    `<text x="72" y="152" font-family="${SANS}" font-size="20" font-weight="700" fill="#ffd6e6" letter-spacing="4">${up(s.eyebrow)}</text>` +
    L(t, 72, 292, 50, 59, '#fff', 700, { extra: ' filter="url(#sh)"' }) + L(b, 72, bt + 24, 24, 35, '#f1e8ff') +
    `<text x="72" y="${H - 44}" font-family="${SANS}" font-size="20" font-weight="700" fill="#fff">strykertrading.com</text><text x="${W - 72}" y="${H - 44}" text-anchor="end" font-family="${SANS}" font-size="20" fill="#e9ddff">Not financial advice</text></svg>`;
};

STYLES.gold = (s) => {
  const t = wrap(s.title, 56, 940, 3, { bold: true }), b = wrap(s.body, 25, 1000, 3);
  const bt = 250 + t.length * 66 + 26;
  return svgOpen + `<defs><linearGradient id="au" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff2b0"/><stop offset="0.5" stop-color="${C.amber}"/><stop offset="1" stop-color="#b8860b"/></linearGradient></defs>` +
    `<rect width="${W}" height="${H}" fill="#070707"/><rect x="28" y="28" width="${W - 56}" height="${H - 56}" fill="none" stroke="url(#au)" stroke-width="2"/><rect x="40" y="40" width="${W - 80}" height="${H - 80}" fill="none" stroke="${C.amber}" stroke-opacity="0.35"/>` +
    brand(96, 96, '#1a1610', C.amber, '#f5f1e6') +
    `<text x="96" y="172" font-family="${SANS}" font-size="19" font-weight="700" fill="${C.amber}" letter-spacing="5">${up(s.eyebrow)}</text>` +
    L(t, 96, 298, 56, 66, 'url(#au)', 700) + L(b, 96, bt + 25, 25, 36, '#d8d3c4') +
    `<line x1="96" y1="${H - 96}" x2="${W - 96}" y2="${H - 96}" stroke="${C.amber}" stroke-opacity="0.5"/>` + foot('#cbbf93', '#8a8367', 96, H - 60) + '</svg>';
};

STYLES.splitcolor = (s) => {
  const hasStat = s.stat && s.stat.value;
  const t = wrap(s.title, 54, hasStat ? 640 : 960, 3, { bold: true }), b = wrap(s.body, 23, hasStat ? 620 : 960, 4);
  const bt = 230 + t.length * 63 + 22;
  return svgOpen + `<rect width="${W}" height="${H}" fill="${C.cyan}"/>` +
    (hasStat ? `<polygon points="780,0 ${W},0 ${W},${H} 700,${H}" fill="${C.magenta}"/><polygon points="770,0 790,0 710,${H} 690,${H}" fill="${C.bg0}"/>` +
      `<text x="${W - 72}" y="330" text-anchor="end" font-family="${SANS}" font-size="118" font-weight="700" fill="#fff">${esc(s.stat.value)}</text>` +
      `<text x="${W - 72}" y="376" text-anchor="end" font-family="${SANS}" font-size="19" fill="#ffe0ea" letter-spacing="3">${up(s.stat.label)}</text>`
      : `<polygon points="${W - 140},0 ${W},0 ${W},${H} ${W - 220},${H}" fill="${C.magenta}"/><polygon points="${W - 150},0 ${W - 130},0 ${W - 210},${H} ${W - 230},${H}" fill="${C.bg0}"/>`) +
    brand(72, 78, C.bg0, C.cyan, C.bg0) +
    `<text x="72" y="152" font-family="${SANS}" font-size="19" font-weight="700" fill="#053b42" letter-spacing="4">${up(s.eyebrow)}</text>` +
    L(t, 72, 276, 54, 63, C.bg0, 700) + L(b, 72, bt + 23, 23, 33, '#0b3a41') +
    `<text x="72" y="${H - 44}" font-family="${SANS}" font-size="20" font-weight="700" fill="${C.bg0}">strykertrading.com</text>` +
    (hasStat ? `<text x="${W - 72}" y="${H - 44}" text-anchor="end" font-family="${SANS}" font-size="20" fill="#ffe0ea">Not financial advice</text>` : '') + '</svg>';
};

STYLES.breaking = (s) => {
  const hasStat = s.stat && s.stat.value;
  const t = wrap(s.title, hasStat ? 54 : 60, hasStat ? 700 : 960, 3, { bold: true }), b = wrap(s.body, 25, hasStat ? 700 : 1000, 3);
  const bt = 270 + t.length * (hasStat ? 64 : 70) + 26;
  const label = String(s.label || 'MARKET BRIEF').toUpperCase().slice(0, 22);
  const lw = Math.round(textWidth(label, 26, { bold: true }) + 26 * 0.18 * label.length + 40);
  return svgOpen + `<rect width="${W}" height="${H}" fill="#000"/><rect width="${W}" height="6" fill="${C.amber}"/>` +
    `<rect x="72" y="72" width="${lw}" height="54" fill="${C.red}"/>` +
    `<text x="92" y="110" font-family="${SANS}" font-size="26" font-weight="700" fill="#fff" letter-spacing="4">${esc(label)}</text>` +
    `<text x="${72 + lw + 20}" y="110" font-family="${SANS}" font-size="22" font-weight="700" fill="${C.amber}" letter-spacing="3">${up(s.eyebrow)}</text>` +
    `<rect x="72" y="150" width="1056" height="2" fill="${C.line}"/>` +
    (hasStat ? ILLUS.gauge(980, 400, 130, C.mint, C.red, '#fff', statFrac(s.stat)) +
      `<text x="980" y="452" text-anchor="middle" font-family="${SANS}" font-size="56" font-weight="700" fill="#fff">${esc(s.stat.value)}</text>` +
      `<text x="980" y="484" text-anchor="middle" font-family="${SANS}" font-size="17" fill="${C.ink2}" letter-spacing="3">${up(s.stat.label)}</text>` : '') +
    L(t, 72, 320, hasStat ? 54 : 60, hasStat ? 64 : 70, '#fff', 700) +
    `<rect x="72" y="${bt - 6}" width="6" height="${b.length * 36 + 10}" fill="${C.amber}"/>` + L(b, 96, bt + 25, 25, 36, '#d9dee6') +
    `<rect y="${H - 70}" width="${W}" height="70" fill="${C.red}"/>` + brand(72, H - 57, '#000', '#fff', '#fff') +
    `<text x="${W - 72}" y="${H - 28}" text-anchor="end" font-family="${SANS}" font-size="20" font-weight="700" fill="#fff">strykertrading.com · not financial advice</text></svg>`;
};


// ---- Apple-style set (defaults) --------------------------------------------------
// Restraint over noise: one accent per kind, a mesh-gradient glow instead of
// hard colour blocks, translucent rounded materials with a light top edge,
// Inter Display headlines with negative tracking, sentence-case labels in
// capsules, muted secondary text, and generous margins.

const A = {
  bg: '#000000', label: '#f5f5f7', secondary: '#a1a1a6', tertiary: '#6e6e73',
  lightBg: '#f5f5f7', lightLabel: '#1d1d1f', lightSecondary: '#6e6e73',
  mint: C.mint, green: '#30d158', orange: '#ff9f0a', red: '#ff453a', purple: '#bf5af2', blue: '#0a84ff', teal: '#64d2ff'
};

// Two blurred glows in the accent, positioned per style. Filters are declared
// once per SVG in <defs>; keep ids unique inside a card.
function mesh(spots, blur) {
  return `<defs><filter id="mesh" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${blur || 90}"/></filter></defs>` +
    `<g filter="url(#mesh)">${spots.map((p) => `<ellipse cx="${p[0]}" cy="${p[1]}" rx="${p[2]}" ry="${p[3]}" fill="${p[4]}" fill-opacity="${p[5]}"/>`).join('')}</g>`;
}

/** A translucent material panel with a bright top edge. */
function material(x, y, w, h, r, dark) {
  const fill = dark ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.72)';
  const edge = dark ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.9)';
  const line = dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.06)';
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${line}"/>` +
    `<path d="M${x + r} ${y + 0.5} H${x + w - r}" stroke="${edge}" stroke-width="1"/>`;
}

/** Capsule label. */
function capsule(x, y, text, accent, dark) {
  const w = Math.round(textWidth(text, 15, { inter: true, bold: true }) + 32);
  return `<g><rect x="${x}" y="${y}" width="${w}" height="32" rx="16" fill="${accent}" fill-opacity="${dark ? 0.18 : 0.14}"/>` +
    `<circle cx="${x + 16}" cy="${y + 16}" r="4" fill="${accent}"/>` +
    `<text x="${x + 27}" y="${y + 21}" font-family="${UI}" font-size="15" font-weight="600" fill="${accent}">${esc(text)}</text></g>`;
}

function appleBrand(x, y, dark) {
  const label = dark ? A.label : A.lightLabel;
  return `<g transform="translate(${x},${y})"><rect width="36" height="36" rx="10" fill="${dark ? '#1c1c1e' : '#ffffff'}" stroke="${dark ? 'rgba(255,255,255,0.14)' : 'rgba(0,0,0,0.08)'}"/>` +
    `<path d="M10 24 L16 14 L21 20 L26 10" fill="none" stroke="${A.mint}" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<text x="48" y="24" font-family="${UI}" font-size="19" font-weight="500" fill="${label}" fill-opacity="0.92">Stryker Trading Academy</text></g>`;
}

function appleFoot(dark, y) {
  const c = dark ? A.tertiary : A.lightSecondary;
  return `<text x="72" y="${y || H - 46}" font-family="${UI}" font-size="17" font-weight="400" fill="${c}">strykertrading.com</text>` +
    `<text x="${W - 72}" y="${y || H - 46}" text-anchor="end" font-family="${UI}" font-size="17" fill="${c}">Not financial advice</text>`;
}

/** Display headline: Inter Display, tight tracking, tight leading. */
function headline(lines, x, y, size, fill, anchor) {
  const track = -(size * 0.035).toFixed(1);
  return L(lines, x, y, size, Math.round(size * 1.08), fill, 700, { font: DISPLAY, anchor, extra: ` letter-spacing="${track}"` });
}
function bodyText(lines, x, y, size, fill) {
  return L(lines, x, y, size, Math.round(size * 1.42), fill, 400, { font: UI });
}

/** Smooth area sparkline, Apple Stocks style. Decorative fixed shape. */
ILLUS.area = (x, y, w, h, color, id) => {
  const pts = [0.62, 0.58, 0.66, 0.5, 0.55, 0.42, 0.47, 0.36, 0.4, 0.3, 0.34, 0.22, 0.28, 0.18];
  const step = w / (pts.length - 1);
  let d = `M${x} ${y + h * pts[0]}`;
  for (let i = 1; i < pts.length; i++) {
    const x0 = x + (i - 1) * step, x1 = x + i * step, y0 = y + h * pts[i - 1], y1 = y + h * pts[i];
    d += ` C${x0 + step / 2} ${y0}, ${x1 - step / 2} ${y1}, ${x1} ${y1}`;
  }
  return `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity="0.35"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>` +
    `<path d="${d} L${x + w} ${y + h} L${x} ${y + h} Z" fill="url(#${id})"/>` +
    `<path d="${d}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round"/>` +
    `<circle cx="${x + w}" cy="${y + h * pts[pts.length - 1]}" r="7" fill="${color}"/><circle cx="${x + w}" cy="${y + h * pts[pts.length - 1]}" r="14" fill="${color}" fill-opacity="0.25"/>`;
};

/** Thin progress ring with the value inside. frac 0..1. */
ILLUS.ring = (cx, cy, r, accent, frac, value, label, dark) => {
  const f = Math.max(0.02, Math.min(0.999, frac));
  const a = -Math.PI / 2 + f * Math.PI * 2;
  const ex = cx + Math.cos(a) * r, ey = cy + Math.sin(a) * r;
  return `<g><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${accent}" stroke-opacity="0.18" stroke-width="14"/>` +
    `<path d="M${cx} ${cy - r} A${r} ${r} 0 ${f > 0.5 ? 1 : 0} 1 ${ex} ${ey}" fill="none" stroke="${accent}" stroke-width="14" stroke-linecap="round"/>` +
    `<text x="${cx}" y="${cy + 30}" text-anchor="middle" font-family="${DISPLAY}" font-size="104" font-weight="700" letter-spacing="-4" fill="${dark ? A.label : A.lightLabel}">${esc(value)}</text>` +
    `<text x="${cx}" y="${cy + 70}" text-anchor="middle" font-family="${UI}" font-size="18" font-weight="500" fill="${dark ? A.secondary : A.lightSecondary}">${esc(label)}</text></g>`;
};

/** Thin arc gauge with rounded caps and a soft needle dot. */
ILLUS.arc = (cx, cy, r, accent, frac, value, label) => {
  const f = typeof frac === 'number' ? Math.max(0.02, Math.min(0.98, frac)) : 0.6;
  const a = Math.PI * (1 - f);
  const px = cx + Math.cos(a) * r, py = cy - Math.sin(a) * r;
  return `<defs><linearGradient id="arcg" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${A.green}"/><stop offset="0.5" stop-color="${A.orange}"/><stop offset="1" stop-color="${A.red}"/></linearGradient></defs>` +
    `<path d="M${cx - r} ${cy} A${r} ${r} 0 0 1 ${cx + r} ${cy}" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="16" stroke-linecap="round"/>` +
    `<path d="M${cx - r} ${cy} A${r} ${r} 0 0 1 ${cx + r} ${cy}" fill="none" stroke="url(#arcg)" stroke-width="16" stroke-linecap="round" stroke-opacity="0.9"/>` +
    `<circle cx="${px}" cy="${py}" r="16" fill="#000" stroke="${accent}" stroke-width="5"/><circle cx="${px}" cy="${py}" r="30" fill="${accent}" fill-opacity="0.18"/>` +
    `<text x="${cx}" y="${cy - 8}" text-anchor="middle" font-family="${DISPLAY}" font-size="88" font-weight="700" letter-spacing="-3" fill="${A.label}">${esc(value)}</text>` +
    `<text x="${cx}" y="${cy + 30}" text-anchor="middle" font-family="${UI}" font-size="18" font-weight="500" fill="${A.secondary}">${esc(label)}</text>`;
};

/** Three glass chapter cards, softly stacked. */
ILLUS.glassCards = (x, y) => {
  const card = (dx, dy, rot, op) => `<g transform="translate(${x + dx},${y + dy}) rotate(${rot})">` +
    `<rect width="230" height="150" rx="22" fill="#fff" fill-opacity="${op}" stroke="rgba(0,0,0,0.06)"/>` +
    `<rect x="22" y="24" width="96" height="12" rx="6" fill="#1d1d1f" fill-opacity="0.85"/><rect x="22" y="48" width="180" height="8" rx="4" fill="#1d1d1f" fill-opacity="0.18"/>` +
    `<rect x="22" y="64" width="150" height="8" rx="4" fill="#1d1d1f" fill-opacity="0.18"/><rect x="22" y="80" width="166" height="8" rx="4" fill="#1d1d1f" fill-opacity="0.18"/>` +
    `<rect x="22" y="112" width="64" height="22" rx="11" fill="${A.mint}"/></g>`;
  return `<g>${card(46, 34, -7, 0.55)}${card(22, 16, -3.5, 0.75)}${card(0, 0, 0, 1)}</g>`;
};

/** LIVE badge: red capsule with a glowing dot and two pulse rings. */
ILLUS.liveBadge = (x, y) => {
  return `<g transform="translate(${x},${y})"><rect width="118" height="36" rx="18" fill="${A.red}"/>` +
    `<circle cx="20" cy="18" r="9" fill="#fff" fill-opacity="0.25"/><circle cx="20" cy="18" r="5" fill="#fff"/>` +
    `<text x="36" y="24" font-family="${UI}" font-size="16" font-weight="700" letter-spacing="1.5" fill="#fff">LIVE</text></g>`;
};

/** Broadcast mark: a red play disc with radiating signal arcs. */
ILLUS.broadcast = (cx, cy) => {
  const arc = (r, op) => `<path d="M${cx - r * 0.72} ${cy - r * 0.7} A${r} ${r} 0 0 0 ${cx - r * 0.72} ${cy + r * 0.7}" fill="none" stroke="${A.red}" stroke-opacity="${op}" stroke-width="10" stroke-linecap="round"/>` +
    `<path d="M${cx + r * 0.72} ${cy - r * 0.7} A${r} ${r} 0 0 1 ${cx + r * 0.72} ${cy + r * 0.7}" fill="none" stroke="${A.red}" stroke-opacity="${op}" stroke-width="10" stroke-linecap="round"/>`;
  return `<defs><filter id="bsh" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="14" stdDeviation="16" flood-color="${A.red}" flood-opacity="0.45"/></filter></defs>` +
    `<g>${arc(150, 0.22)}${arc(118, 0.42)}` +
    `<circle cx="${cx}" cy="${cy}" r="76" fill="${A.red}" filter="url(#bsh)"/>` +
    `<path d="M${cx - 18} ${cy - 30} L${cx + 34} ${cy} L${cx - 18} ${cy + 30} Z" fill="#fff"/>` +
    `<circle cx="${cx + 88}" cy="${cy - 78}" r="12" fill="${A.red}"/><circle cx="${cx + 88}" cy="${cy - 78}" r="22" fill="${A.red}" fill-opacity="0.3"/></g>`;
};

/** Glass dashboard with a light top edge and drop shadow. */
ILLUS.glassDash = (x, y, accent) => {
  return `<defs><filter id="dsh" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#000" flood-opacity="0.45"/></filter></defs>` +
    `<g transform="translate(${x},${y})" filter="url(#dsh)">${material(0, 0, 320, 220, 26, true)}` +
    `<circle cx="24" cy="22" r="5" fill="${A.red}"/><circle cx="42" cy="22" r="5" fill="${A.orange}"/><circle cx="60" cy="22" r="5" fill="${A.green}"/>` +
    `<rect x="20" y="46" width="184" height="128" rx="14" fill="rgba(255,255,255,0.06)"/>` +
    `<polyline points="34,160 64,128 94,140 124,100 154,110 184,72" fill="none" stroke="${accent}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<circle cx="184" cy="72" r="6" fill="${accent}"/>` +
    `<rect x="222" y="112" width="20" height="62" rx="6" fill="${A.purple}" fill-opacity="0.9"/><rect x="250" y="84" width="20" height="90" rx="6" fill="${accent}"/><rect x="278" y="132" width="20" height="42" rx="6" fill="rgba(255,255,255,0.5)"/>` +
    `<rect x="20" y="190" width="120" height="8" rx="4" fill="rgba(255,255,255,0.35)"/></g>`;
};

// aurora — the brief: dark, mint glow, sparkline, two-line headline, three
// lines of body, then a material tape of six prints
STYLES.aurora = (s) => {
  const t = wrap(s.title, 52, 1000, 2, { display: true });
  const b = wrap(s.body, 23, 1000, 3, { inter: true });
  const items = (s.ticker || []).slice(0, 6);
  const tapeY = 466, chipW = 166, gap = 12;
  const tape = items.length ? material(72, tapeY, 1056, 118, 26, true) + items.map((k, i) => {
    const x = 72 + 24 + i * (chipW + gap);
    const col = k.dir > 0 ? A.green : (k.dir < 0 ? A.red : A.label);
    return `<text x="${x}" y="${tapeY + 44}" font-family="${UI}" font-size="15" font-weight="500" fill="${A.secondary}">${esc(k.label)}</text>` +
      `<text x="${x}" y="${tapeY + 82}" font-family="${DISPLAY}" font-size="30" font-weight="600" letter-spacing="-0.8" fill="${col}">${esc(k.text)}</text>`;
  }).join('') : '';
  const headTop = 172;
  const bodyY = headTop + 44 + t.length * 56 + 16;
  return svgOpen + `<rect width="${W}" height="${H}" fill="${A.bg}"/>` +
    mesh([[1000, 120, 420, 260, A.mint, 0.42], [180, 640, 380, 200, A.teal, 0.22]]) +
    `<g opacity="0.55">${ILLUS.area(760, 130, 368, 250, A.mint, 'aur')}</g>` +
    appleBrand(72, 62, true) + capsule(W - 72 - Math.round(textWidth(s.eyebrow, 15, { inter: true, bold: true }) + 32), 64, s.eyebrow, A.mint, true) +
    headline(t, 72, headTop + 44, 52, A.label) + bodyText(b, 72, bodyY + 14, 23, '#c7c7cc') +
    tape + appleFoot(true, H - 42) + '</svg>';
};

// countdown — calendar: deep red field, red glow, ring with the minutes inside
STYLES.countdown = (s) => {
  const hasStat = s.stat && s.stat.value;
  const t = wrap(s.title, 54, hasStat ? 660 : 940, 3, { display: true }), b = wrap(s.body, 23, hasStat ? 660 : 940, 4, { inter: true });
  const mins = parseFloat(String((s.stat || {}).value || '').replace(/[^\d.]/g, ''));
  const frac = isNaN(mins) ? 0.5 : Math.min(1, mins / 60);
  return svgOpen + `<defs><linearGradient id="cdbg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5a0a0a"/><stop offset="0.55" stop-color="#2a0505"/><stop offset="1" stop-color="#120000"/></linearGradient></defs>` +
    `<rect width="${W}" height="${H}" fill="url(#cdbg)"/>` +
    mesh([[960, 340, 380, 320, A.red, 0.55], [120, 80, 340, 240, '#ff2d55', 0.28], [300, 640, 420, 180, '#c1121f', 0.35]]) +
    appleBrand(72, 62, true) + capsule(W - 72 - Math.round(textWidth(s.eyebrow, 15, { inter: true, bold: true }) + 32), 64, s.eyebrow, '#ff8a80', true) +
    (hasStat ? ILLUS.ring(960, 340, 150, '#ff6b6b', frac, s.stat.value, s.stat.label, true) : '') +
    headline(t, 72, 220 + 44, 54, A.label) + bodyText(b, 72, 220 + t.length * 58 + 46, 23, '#f2c4c4') +
    appleFoot(true) + '</svg>';
};

// signal — monitor: dark, red glow, thin gauge with the value inside
STYLES.signal = (s) => {
  const hasStat = s.stat && s.stat.value;
  const t = wrap(s.title, 56, hasStat ? 660 : 940, 3, { display: true }), b = wrap(s.body, 24, hasStat ? 660 : 940, 3, { inter: true });
  return svgOpen + `<rect width="${W}" height="${H}" fill="${A.bg}"/>` +
    mesh([[980, 420, 380, 260, A.red, 0.30], [140, 120, 320, 220, A.purple, 0.16]]) +
    appleBrand(72, 62, true) + capsule(W - 72 - Math.round(textWidth(s.label || 'Monitor', 15, { inter: true, bold: true }) + 32), 64, s.label || 'Monitor', A.red, true) +
    `<text x="72" y="176" font-family="${UI}" font-size="20" font-weight="500" fill="${A.red}">${esc(s.eyebrow)}</text>` +
    (hasStat ? ILLUS.arc(970, 420, 170, A.red, statFrac(s.stat), s.stat.value, s.stat.label) : '') +
    headline(t, 72, 240 + 45, 56, A.label) + bodyText(b, 72, 240 + t.length * 60 + 30, 24, A.secondary) +
    appleFoot(true) + '</svg>';
};

// sheet — announcements: light, white material, glass chapter cards; a live
// session gets a red LIVE badge and a broadcast mark instead
STYLES.sheet = (s) => {
  const live = /live/i.test(String(s.label || '')) || /^live session/i.test(String(s.eyebrow || ''));
  const t = wrap(s.title, 54, 620, 3, { display: true }), b = wrap(s.body, 23, 620, 4, { inter: true });
  const accent = live ? A.red : '#027a54';
  return svgOpen + `<rect width="${W}" height="${H}" fill="${A.lightBg}"/>` +
    mesh(live ? [[1040, 80, 360, 240, A.red, 0.30], [140, 620, 320, 200, '#ff2d55', 0.16]] : [[1040, 80, 360, 240, A.mint, 0.35], [140, 620, 320, 200, A.blue, 0.18]], 80) +
    `<defs><filter id="ssh" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="16" stdDeviation="18" flood-color="#000" flood-opacity="0.10"/></filter></defs>` +
    `<g filter="url(#ssh)"><rect x="60" y="56" width="1080" height="563" rx="34" fill="#fff" fill-opacity="0.82"/></g>` +
    `<path d="M94 56.5 H1106" stroke="#fff"/>` +
    appleBrand(104, 96, false) +
    (live
      ? ILLUS.liveBadge(W - 104 - 118, 96) + capsule(W - 104 - 118 - 12 - Math.round(textWidth(s.eyebrow, 15, { inter: true, bold: true }) + 32), 98, s.eyebrow, accent, false)
      : capsule(W - 104 - Math.round(textWidth(s.eyebrow, 15, { inter: true, bold: true }) + 32), 98, s.eyebrow, accent, false)) +
    (live ? ILLUS.broadcast(950, 330) : ILLUS.glassCards(820, 236)) +
    headline(t, 104, 232 + 44, 54, A.lightLabel) + bodyText(b, 104, 232 + t.length * 58 + 28, 23, A.lightSecondary) +
    `<text x="104" y="${H - 82}" font-family="${UI}" font-size="17" fill="${A.lightSecondary}">strykertrading.com</text>` +
    `<text x="${W - 104}" y="${H - 82}" text-anchor="end" font-family="${UI}" font-size="17" fill="${A.lightSecondary}">Not financial advice</text></svg>`;
};

// spotlight — feature promos: saturated blue-violet mesh, gradient display
// headline, brighter body, a solid call-to-action pill, glass dashboard
STYLES.spotlight = (s) => {
  const t = wrap(s.title, 60, 660, 3, { display: true }), b = wrap(s.body, 24, 640, 3, { inter: true });
  const ctaText = s.cta || 'Explore the academy';
  const ctaW = Math.round(textWidth(ctaText, 19, { inter: true, bold: true }) + 104);
  const ctaY = 236 + t.length * 65 + b.length * 34 + 44;
  return svgOpen + `<defs><linearGradient id="spbg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0a1a4a"/><stop offset="0.5" stop-color="#1a0a3d"/><stop offset="1" stop-color="#000"/></linearGradient>` +
    `<linearGradient id="sphl" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffffff"/><stop offset="0.6" stop-color="${A.mint}"/><stop offset="1" stop-color="${A.teal}"/></linearGradient>` +
    `<filter id="spsh" x="-20%" y="-20%" width="140%" height="180%"><feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="${A.mint}" flood-opacity="0.55"/></filter></defs>` +
    `<rect width="${W}" height="${H}" fill="url(#spbg)"/>` +
    mesh([[200, 100, 420, 300, A.blue, 0.75], [1020, 580, 460, 320, A.purple, 0.8], [900, 40, 300, 220, A.mint, 0.5], [420, 660, 360, 160, '#ff2d55', 0.35]], 100) +
    `<g opacity="0.16" stroke="#fff" stroke-width="2"><path d="M760 0 L560 675"/><path d="M840 0 L640 675"/><path d="M1200 90 L980 675"/></g>` +
    appleBrand(72, 62, true) + capsule(W - 72 - Math.round(textWidth(s.eyebrow, 15, { inter: true, bold: true }) + 32), 64, s.eyebrow, A.teal, true) +
    `<g transform="translate(760,190) scale(1.15)">${ILLUS.glassDash(0, 0, A.mint)}</g>` +
    headline(t, 72, 236 + 48, 60, 'url(#sphl)') + bodyText(b, 72, 236 + t.length * 65 + 30, 24, '#e5e5ea') +
    `<g filter="url(#spsh)"><rect x="72" y="${ctaY}" width="${ctaW}" height="52" rx="26" fill="${A.mint}"/></g>` +
    `<text x="${72 + 30}" y="${ctaY + 33}" font-family="${UI}" font-size="19" font-weight="700" fill="#03150e">${esc(ctaText)}</text>` +
    `<path d="M${72 + ctaW - 50} ${ctaY + 26} h18 m-7 -7 l7 7 l-7 7" fill="none" stroke="#03150e" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<text x="72" y="${H - 46}" font-family="${UI}" font-size="17" fill="#fff" fill-opacity="0.7">strykertrading.com</text>` +
    `<text x="${W - 72}" y="${H - 46}" text-anchor="end" font-family="${UI}" font-size="17" fill="#fff" fill-opacity="0.7">Not financial advice</text></svg>`;
};

// quiet — manual posts: dark, one soft glow, nothing else
STYLES.quiet = (s) => {
  const t = wrap(s.title, 62, 940, 3, { display: true }), b = wrap(s.body, 26, 900, 3, { inter: true });
  return svgOpen + `<rect width="${W}" height="${H}" fill="${A.bg}"/>` +
    mesh([[1040, 560, 420, 300, A.mint, 0.28]]) +
    appleBrand(72, 62, true) +
    headline(t, 72, 250 + 50, 62, A.label) + bodyText(b, 72, 250 + t.length * 67 + 26, 26, A.secondary) +
    appleFoot(true) + '</svg>';
};

// ---- API ------------------------------------------------------------------------

/** The style key for a post kind, honouring an admin override map. */
function styleFor(kind, overrides) {
  const o = overrides && overrides[kind];
  if (o && STYLES[o]) return o;
  return DEFAULT_STYLES[kind] || 'terminal';
}

/**
 * Builds the SVG for one card.
 * spec: { kind, eyebrow, title, body, stat?: {label, value}, ticker?: [{label, text, dir}], label? }
 * style: a STYLE_KEYS entry; defaults per kind.
 */
function cardSvg(spec, style) {
  const key = style && STYLES[style] ? style : styleFor(spec.kind, spec.styles);
  return STYLES[key](Object.assign({ eyebrow: '', title: '', body: '' }, spec));
}

/**
 * Rasterises an SVG string to a PNG buffer. Returns null if the renderer is
 * unavailable or fails — the caller then posts text only.
 */
async function renderPng(svg) {
  let Resvg;
  try {
    ({ Resvg } = require('@resvg/resvg-js'));
  } catch (e) {
    console.warn('xAutopost: @resvg/resvg-js is not installed; posting without cards.');
    return null;
  }
  try {
    let fontFiles = [];
    try {
      const fs = require('fs');
      fontFiles = fs.readdirSync(FONT_DIR).filter((f) => /\.(ttf|otf)$/i.test(f)).map((f) => require('path').join(FONT_DIR, f));
    } catch (e) { /* no bundled fonts: system fonts only */ }
    const r = new Resvg(svg, {
      fitTo: { mode: 'width', value: W },
      font: { fontFiles, loadSystemFonts: true, defaultFontFamily: fontFiles.length ? 'Inter' : 'DejaVu Sans' },
      background: C.bg1
    });
    return Buffer.from(r.render().asPng());
  } catch (e) {
    console.warn('xAutopost: card render failed:', e.message);
    return null;
  }
}

module.exports = { cardSvg, renderPng, wrap, styleFor, STYLE_KEYS, DEFAULT_STYLES, W, H };
