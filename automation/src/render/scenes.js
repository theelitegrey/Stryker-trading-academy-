/**
 * Vertical 1080×1920 scenes for the short videos, as SVG strings rasterised
 * with resvg. Same design language as the cards: dark field, mesh-gradient
 * glows, capsule label, tight Inter Display headline, muted secondary text,
 * brand mark and site address in the safe area.
 *
 * Scene types: title, point, stat, cta. Each kind of post has an accent so a
 * viewer recognises a brief from a lesson before reading.
 *
 * Safe areas (Shorts/Reels overlays): keep content inside y 250..1560 and
 * x 80..1000. Captions are burned in later at y≈1420, so scene text stays
 * above 1300.
 */
const fs = require('fs');
const path = require('path');
const { wrap } = require('./cards');

const W = 1080, H = 1920;
const FONT_DIR = path.join(__dirname, '..', '..', 'fonts');

const C = {
  bg: '#0b0b0d', bg2: '#131316', line: '#2c2c32', ink0: '#f2f2f3', ink1: '#c9cdd3', ink2: '#8b93a0',
  mint: '#03c988', mintBright: '#4fe3ac', teal: '#00adb5', red: '#e5484d', amber: '#f5c542', violet: '#7c3aed', blue: '#3b82f6', magenta: '#ff2d75'
};
const ACCENT = { brief: [C.mint, C.teal], calendar: [C.red, C.amber], monitor: [C.blue, C.teal], lesson: [C.violet, C.blue], promo: [C.magenta, C.violet], feature: [C.magenta, C.violet], announce: [C.mint, C.violet], manual: [C.ink2, C.ink2] };

const UI = "'Inter', 'DejaVu Sans', Arial, sans-serif";
const DISPLAY = "'Inter Display', 'Inter', 'DejaVu Sans', Arial, sans-serif";

function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function lines(arr, x, y, size, lh, fill, weight, font, extra) {
  return arr.map((l, i) => `<text x="${x}" y="${y + i * lh}" font-family="${font}" font-size="${size}" font-weight="${weight}" fill="${fill}"${extra || ''}>${esc(l)}</text>`).join('');
}

function defs(a, b) {
  return `<defs>
    <radialGradient id="g1" cx="0.2" cy="0.15" r="0.7"><stop offset="0" stop-color="${a}" stop-opacity="0.55"/><stop offset="1" stop-color="${a}" stop-opacity="0"/></radialGradient>
    <radialGradient id="g2" cx="0.85" cy="0.9" r="0.7"><stop offset="0" stop-color="${b}" stop-opacity="0.45"/><stop offset="1" stop-color="${b}" stop-opacity="0"/></radialGradient>
    <linearGradient id="hl" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${C.ink0}"/><stop offset="1" stop-color="${a}"/></linearGradient>
    <filter id="blur" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="90"/></filter>
  </defs>`;
}

function frame(kind, inner, opts) {
  const [a, b] = ACCENT[kind] || ACCENT.manual;
  const glowStrength = (opts && opts.loud) ? 1 : 0.7;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${defs(a, b)}
  <rect width="${W}" height="${H}" fill="${C.bg}"/>
  <g opacity="${glowStrength}"><ellipse cx="200" cy="300" rx="620" ry="520" fill="${a}" opacity="0.35" filter="url(#blur)"/>
  <ellipse cx="900" cy="1650" rx="560" ry="480" fill="${b}" opacity="0.3" filter="url(#blur)"/></g>
  <rect width="${W}" height="${H}" fill="url(#g1)"/><rect width="${W}" height="${H}" fill="url(#g2)"/>
  ${brand(a)}
  ${inner}
  ${foot()}
</svg>`;
}

function brand(accent) {
  return `<g transform="translate(80,150)"><rect width="56" height="56" rx="14" fill="${C.bg2}" stroke="${C.line}"/>
  <path d="M15 38 L25 20 L33 30 L41 15" fill="none" stroke="${accent}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="76" y="39" font-family="${UI}" font-size="30" font-weight="600" fill="${C.ink0}">Stryker Trading Academy</text></g>`;
}
function foot() {
  return `<text x="80" y="1610" font-family="${UI}" font-size="30" font-weight="600" fill="${C.ink1}">strykertrading.com</text>
  <text x="${W - 80}" y="1610" text-anchor="end" font-family="${UI}" font-size="26" fill="${C.ink2}">Not financial advice</text>`;
}
function capsule(x, y, text, accent) {
  const w = Math.round(text.length * 15 + 48);
  return `<rect x="${x}" y="${y}" width="${w}" height="52" rx="26" fill="${accent}" fill-opacity="0.16" stroke="${accent}" stroke-opacity="0.5"/>
  <text x="${x + w / 2}" y="${y + 35}" text-anchor="middle" font-family="${UI}" font-size="24" font-weight="600" letter-spacing="2" fill="${accent}">${esc(text.toUpperCase())}</text>`;
}
function panel(x, y, w, h) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="36" fill="#ffffff" fill-opacity="0.06" stroke="#ffffff" stroke-opacity="0.12"/>
  <rect x="${x + 1}" y="${y + 1}" width="${w - 2}" height="2" rx="1" fill="#ffffff" fill-opacity="0.25"/>`;
}

const EYEBROW = { brief: 'Pre-market brief', calendar: 'Economic calendar', monitor: 'Global Monitor', lesson: 'From the curriculum', promo: 'Inside the academy', feature: 'Inside the academy', announce: 'New at the academy', manual: 'Stryker' };

/** scene: {type, heading, text, stat}; ctx: {kind, eyebrow, index, total} */
function sceneSvg(scene, ctx) {
  const kind = ctx.kind || 'manual';
  const [a] = ACCENT[kind] || ACCENT.manual;
  const eyebrow = ctx.eyebrow || EYEBROW[kind] || 'Stryker';
  const progress = ctx.total > 1
    ? `<g transform="translate(80,1680)">${Array.from({ length: ctx.total }, (_, i) =>
        `<rect x="${i * 30}" y="0" width="22" height="6" rx="3" fill="${i <= ctx.index ? a : C.line}"/>`).join('')}</g>` : '';
  let inner = capsule(80, 300, eyebrow, a);

  if (scene.type === 'title') {
    const hl = wrap(scene.heading, 96, 920, 4, { display: true });
    const sub = wrap(scene.text, 40, 900, 3, { inter: true });
    inner += lines(hl, 80, 520, 96, 108, 'url(#hl)', 700, DISPLAY, ' letter-spacing="-3"');
    inner += lines(sub, 80, 540 + hl.length * 108 + 40, 40, 54, C.ink1, 400, UI);
  } else if (scene.type === 'stat') {
    const stat = String(scene.stat || '');
    const size = stat.length > 8 ? 120 : (stat.length > 5 ? 160 : 200);
    inner += panel(80, 420, 920, 620);
    inner += `<text x="${W / 2}" y="760" text-anchor="middle" font-family="${DISPLAY}" font-size="${size}" font-weight="700" letter-spacing="-6" fill="${C.ink0}">${esc(stat)}</text>`;
    inner += lines(wrap(scene.heading, 44, 840, 2, { inter: true, bold: true }), W / 2, 880, 44, 56, a, 600, UI, ' text-anchor="middle"');
    inner += lines(wrap(scene.text, 36, 840, 2, { inter: true }), W / 2, 980, 36, 48, C.ink1, 400, UI, ' text-anchor="middle"');
  } else if (scene.type === 'cta') {
    const hl = wrap(scene.heading, 84, 920, 3, { display: true });
    inner += lines(hl, 80, 520, 84, 96, C.ink0, 700, DISPLAY, ' letter-spacing="-2.5"');
    inner += lines(wrap(scene.text, 40, 900, 3, { inter: true }), 80, 540 + hl.length * 96 + 30, 40, 54, C.ink1, 400, UI);
    inner += `<rect x="80" y="1080" width="640" height="112" rx="56" fill="${a}"/>
      <text x="400" y="1152" text-anchor="middle" font-family="${UI}" font-size="40" font-weight="700" fill="#08110d">strykertrading.com</text>
      <text x="80" y="1260" font-family="${UI}" font-size="32" fill="${C.ink2}">Free account · full curriculum · live sessions</text>`;
  } else {
    const hl = wrap(scene.heading, 76, 920, 3, { display: true });
    inner += lines(hl, 80, 520, 76, 88, C.ink0, 700, DISPLAY, ' letter-spacing="-2"');
    const body = wrap(scene.text, 42, 900, 4, { inter: true });
    if (body.length) {
      const y0 = 540 + hl.length * 88 + 30;
      inner += `<rect x="80" y="${y0 - 40}" width="6" height="${body.length * 58 + 20}" rx="3" fill="${a}"/>`;
      inner += lines(body, 112, y0, 42, 58, C.ink1, 400, UI);
    }
  }
  return frame(kind, inner + progress, { loud: scene.type === 'title' || scene.type === 'cta' });
}

let fontFiles = null;
function fonts() {
  if (fontFiles) return fontFiles;
  try { fontFiles = fs.readdirSync(FONT_DIR).filter((f) => /\.(ttf|otf)$/i.test(f)).map((f) => path.join(FONT_DIR, f)); }
  catch (e) { fontFiles = []; }
  return fontFiles;
}

function renderPng(svg) {
  const { Resvg } = require('@resvg/resvg-js');
  const r = new Resvg(svg, {
    fitTo: { mode: 'width', value: W },
    font: { fontFiles: fonts(), loadSystemFonts: true, defaultFontFamily: fonts().length ? 'Inter' : 'DejaVu Sans' },
    background: C.bg
  });
  return Buffer.from(r.render().asPng());
}

module.exports = { sceneSvg, renderPng, W, H, FONT_DIR, ACCENT };
