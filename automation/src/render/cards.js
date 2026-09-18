/**
 * The 1200×675 image cards, shared with the X Cloud Function so both post
 * the same designs. The renderer is functions-src/xAutopost-cards.js in the
 * site repo; the Dockerfile copies it to ./vendor for a standalone image.
 */
const fs = require('fs');
const path = require('path');

const CANDIDATES = [
  path.join(__dirname, '..', '..', 'vendor', 'xAutopost-cards.js'),
  path.join(__dirname, '..', '..', '..', 'functions-src', 'xAutopost-cards.js')
];

let mod = null; let modPath = null;
for (const f of CANDIDATES) {
  if (fs.existsSync(f)) { mod = require(f); modPath = f; break; }
}
if (!mod) throw new Error('Card renderer not found. Copy functions-src/xAutopost-cards.js (and its fonts/) to automation/vendor/.');

const KIND_MAP = { brief: 'brief', calendar: 'calendar', monitor: 'monitor', announce: 'announce', feature: 'feature', promo: 'feature', lesson: 'sheet', manual: 'manual' };

/** Builds the card SVG for a queue post from its drafts. */
function cardFor(post, drafts, styles) {
  const kind = KIND_MAP[post.kind] || 'manual';
  const src = typeof post.source === 'object' && post.source ? post.source : {};
  const spec = {
    kind: kind === 'sheet' ? 'announce' : kind,
    eyebrow: eyebrowFor(post), title: drafts.cardTitle || post.title || '', body: drafts.cardBody || '',
    label: labelFor(post), styles
  };
  if (post.kind === 'brief' && Array.isArray(src.prints) && src.prints.length >= 4) spec.ticker = src.prints;
  if (post.kind === 'monitor' && src.stat) spec.stat = src.stat;
  if (post.kind === 'calendar') spec.stat = { label: 'minutes', value: String(Math.max(1, Math.round(((post.expiresAtMs || 0) + 2 * 60000 - (post.scheduledForMs || 0)) / 60000))) };
  return mod.cardSvg(spec, mod.styleFor(spec.kind, styles));
}

function eyebrowFor(post) {
  const d = new Date(post.scheduledForMs || post.createdAtMs || Date.now()).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return ({ brief: 'Pre-market brief · ' + d, calendar: 'Economic calendar', monitor: 'Global Monitor · ' + d, announce: 'New at the academy',
    feature: 'Stryker Trading Academy', promo: 'Stryker Trading Academy', lesson: 'From the curriculum', manual: 'Stryker Trading Academy' })[post.kind] || 'Stryker Trading Academy';
}
function labelFor(post) {
  return ({ brief: 'BRIEF', calendar: 'HIGH IMPACT', monitor: 'SIGNAL', announce: 'NEW', feature: 'FEATURE', promo: 'FEATURE', lesson: 'LESSON', manual: 'STRYKER' })[post.kind] || 'STRYKER';
}

/**
 * Rasterises a card SVG with this package's resvg (the shared module would
 * look for resvg next to itself, where it is not installed). Fonts come
 * from the folder next to the shared module, falling back to ./fonts.
 */
let fontFiles = null;
function fonts() {
  if (fontFiles) return fontFiles;
  fontFiles = [];
  for (const dir of [path.join(path.dirname(modPath), 'fonts'), path.join(__dirname, '..', '..', 'fonts')]) {
    try { fontFiles = fs.readdirSync(dir).filter((f) => /\.(ttf|otf)$/i.test(f)).map((f) => path.join(dir, f)); if (fontFiles.length) break; } catch (e) { /* next */ }
  }
  return fontFiles;
}
async function renderPng(svg) {
  const { Resvg } = require('@resvg/resvg-js');
  const r = new Resvg(svg, {
    fitTo: { mode: 'width', value: mod.W },
    font: { fontFiles: fonts(), loadSystemFonts: true, defaultFontFamily: fonts().length ? 'Inter' : 'DejaVu Sans' },
    background: '#0b0b0d'
  });
  return Buffer.from(r.render().asPng());
}

module.exports = { cardFor, cardSvg: mod.cardSvg, renderPng, wrap: mod.wrap, STYLE_KEYS: mod.STYLE_KEYS, DEFAULT_STYLES: mod.DEFAULT_STYLES, W: mod.W, H: mod.H };
