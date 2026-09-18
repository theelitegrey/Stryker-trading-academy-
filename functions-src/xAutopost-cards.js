/**
 * Stryker Trading Academy — branded image cards for X posts
 *
 * Every automated post can carry a 1200×675 PNG card: the brief's headline,
 * a calendar countdown, a monitor signal, a feature promo. Posts with an
 * image get several times the reach of bare text on X, and a card in the
 * site's own palette is recognisable in a feed before the handle is read.
 *
 * HOW: the card is built as an SVG string (no DOM, no browser) and rasterised
 * with @resvg/resvg-js, which ships prebuilt binaries for the Cloud Functions
 * runtime and needs no system libraries. Text is laid out here by hand with a
 * width estimate per character — good enough for a headline and a paragraph,
 * and the only way to wrap text in SVG without a layout engine.
 *
 * The SVG string is ALSO stored on the queue document, so the admin page can
 * preview exactly what will be attached without the function rendering twice.
 *
 * Colours mirror assets/style.css (:root). Keep them in step by hand — this
 * file cannot read the stylesheet at runtime.
 */

const W = 1200;
const H = 675;

const C = {
  bg0: '#050506', bg1: '#0b0b0d', bg2: '#131316', line: '#2c2c32',
  ink0: '#eeeeee', ink1: '#c9cdd3', ink2: '#8b93a0', ink3: '#5c6472',
  mint: '#03c988', mintBright: '#4fe3ac', teal: '#00adb5',
  red: '#e5484d', amber: '#f5c542', indigo: '#13005a'
};

// Accent per post kind: the eyebrow colour and the top rule. Deliberately
// few, so a follower learns them.
const ACCENT = {
  brief: C.mint,
  calendar: C.amber,
  monitor: C.red,
  announce: C.teal,
  feature: C.mintBright,
  manual: C.mint
};

const FONT = "'DejaVu Sans', 'Liberation Sans', Arial, Helvetica, sans-serif";

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Average glyph advance as a fraction of font size for a humanist sans. Wide
// letters (m, w, capitals) push it up; narrow ones (i, l, punctuation) pull it
// down. Measured against DejaVu Sans, which the runtime is most likely to have.
function charWidth(ch, size) {
  if (/[mwMW@%]/.test(ch)) return size * 0.86;
  if (/[A-Z0-9]/.test(ch)) return size * 0.68;
  if (/[il|!.,:;'’ ]/.test(ch)) return size * 0.30;
  if (/[fjrt\-()[\]]/.test(ch)) return size * 0.40;
  return size * 0.58;
}

function textWidth(s, size) {
  let w = 0;
  for (const ch of String(s)) w += charWidth(ch, size);
  return w;
}

/** Greedy word wrap into at most `maxLines` lines; the last line is ellipsised. */
function wrap(text, size, maxWidth, maxLines) {
  const words = String(text || '').replace(/\s+/g, ' ').trim().split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const trial = cur ? cur + ' ' + w : w;
    if (textWidth(trial, size) <= maxWidth || !cur) {
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
    while (last.length && textWidth(last + '…', size) > maxWidth) last = last.slice(0, -1);
    lines[maxLines - 1] = last.replace(/[\s,.;:]+$/, '') + '…';
  }
  return lines;
}

function tspans(lines, x, y, size, lineHeight, fill, weight) {
  return lines.map((l, i) =>
    `<text x="${x}" y="${y + i * lineHeight}" font-family="${FONT}" font-size="${size}" ` +
    `font-weight="${weight || 400}" fill="${fill}">${esc(l)}</text>`).join('');
}

/**
 * Builds the SVG for one card.
 *
 * spec: { kind, eyebrow, title, body, footer, stat: { label, value }? }
 *   eyebrow  small caps line at the top ("PRE-MARKET BRIEF · 18 SEP")
 *   title    the headline; up to three lines
 *   body     supporting paragraph; up to four lines
 *   stat     optional big number on the right (countdown, VIX, DEFCON level)
 *   footer   bottom-left line, defaults to the site domain
 */
function cardSvg(spec) {
  const accent = ACCENT[spec.kind] || C.mint;
  const pad = 72;
  const hasStat = spec.stat && spec.stat.value;
  const textWidthMax = hasStat ? 700 : W - pad * 2;

  const titleSize = spec.title && spec.title.length > 90 ? 44 : 52;
  const titleLines = wrap(spec.title || '', titleSize, textWidthMax, 3);
  const titleTop = 200;
  const titleLh = Math.round(titleSize * 1.18);

  const bodyTop = titleTop + titleLines.length * titleLh + 28;
  const bodyLines = wrap(spec.body || '', 26, textWidthMax, 4);

  const stat = hasStat ? `
    <g>
      <text x="${W - pad}" y="330" text-anchor="end" font-family="${FONT}" font-size="120"
            font-weight="700" fill="${accent}">${esc(spec.stat.value)}</text>
      <text x="${W - pad}" y="372" text-anchor="end" font-family="${FONT}" font-size="22"
            font-weight="400" fill="${C.ink2}" letter-spacing="2">${esc(String(spec.stat.label || '').toUpperCase())}</text>
    </g>` : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${C.bg1}"/>
      <stop offset="1" stop-color="${C.bg0}"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.9" cy="0.1" r="0.7">
      <stop offset="0" stop-color="${C.indigo}" stop-opacity="0.9"/>
      <stop offset="1" stop-color="${C.bg0}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  <rect x="0" y="0" width="${W}" height="6" fill="${accent}"/>
  <!-- emblem: a simple mark rather than the PNG logo, so the card never depends on a file read -->
  <g transform="translate(${pad}, 78)">
    <rect x="0" y="0" width="44" height="44" rx="10" fill="${C.bg2}" stroke="${C.line}"/>
    <path d="M12 30 L20 16 L26 24 L32 12" fill="none" stroke="${accent}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/>
    <text x="60" y="30" font-family="${FONT}" font-size="22" font-weight="700" fill="${C.ink0}">Stryker Trading Academy</text>
  </g>
  <text x="${pad}" y="152" font-family="${FONT}" font-size="20" font-weight="600" fill="${accent}" letter-spacing="3">${esc(String(spec.eyebrow || '').toUpperCase())}</text>
  ${tspans(titleLines, pad, titleTop + titleSize - 10, titleSize, titleLh, C.ink0, 700)}
  ${tspans(bodyLines, pad, bodyTop + 26, 26, 38, C.ink1, 400)}
  ${stat}
  <line x1="${pad}" y1="${H - 84}" x2="${W - pad}" y2="${H - 84}" stroke="${C.line}"/>
  <text x="${pad}" y="${H - 44}" font-family="${FONT}" font-size="20" fill="${C.ink2}">${esc(spec.footer || 'strykertrading.com')}</text>
  <text x="${W - pad}" y="${H - 44}" text-anchor="end" font-family="${FONT}" font-size="20" fill="${C.ink3}">Not financial advice</text>
</svg>`;
}

/**
 * Rasterises an SVG string to a PNG buffer. Returns null if the renderer is
 * unavailable or fails — the caller then posts text only. A missing image
 * must never block a time-sensitive post.
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
    const r = new Resvg(svg, {
      fitTo: { mode: 'width', value: W },
      font: { loadSystemFonts: true, defaultFontFamily: 'DejaVu Sans' },
      background: C.bg1
    });
    return Buffer.from(r.render().asPng());
  } catch (e) {
    console.warn('xAutopost: card render failed:', e.message);
    return null;
  }
}

module.exports = { cardSvg, renderPng, wrap, W, H };
