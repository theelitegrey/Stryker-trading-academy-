// TradeZoro — chart layout LINK IDS (Owner feature 17 Nov 2026, roadmap "layout-links") — ES module, no deps.
// Every saved chart layout gets one permanent short id, shown in the address bar as /charts/<ID>
// (e.g. /charts/VMW7HYSI). 8 characters, uppercase letters + digits with the confusable ones left out
// (no 0 O 1 I L): 31 symbols, 31^8 ≈ 8.5e11 ids. Generated once with crypto.getRandomValues and never
// changed (rename keeps it). Storage + rules: assets/chart-layouts.js and functions-src/firestore.rules
// (chartLinks/{ID} lookup doc + the layout doc's "slug" field).

export const SLUG_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // 23 letters (no I L O) + 8 digits (no 0 1)
export const SLUG_LEN = 8;
export const SLUG_RE = /^[A-HJKMNP-Z2-9]{8}$/;

// A new random id. Rejection sampling (bytes >= 248 are skipped) keeps every symbol equally likely.
export function genSlug(rand){
  const get = rand || ((a) => crypto.getRandomValues(a));
  const n = SLUG_CHARS.length, cap = 256 - (256 % n);
  let out = '';
  while (out.length < SLUG_LEN) {
    const buf = get(new Uint8Array(16));
    for (let i = 0; i < buf.length && out.length < SLUG_LEN; i++) if (buf[i] < cap) out += SLUG_CHARS[buf[i] % n];
  }
  return out;
}
export const isSlug = (s) => typeof s === 'string' && SLUG_RE.test(s);

// '/charts/VMW7HYSI' (optional trailing slash, any case typed by hand) -> 'VMW7HYSI'; anything else -> null.
export function slugFromPath(p){
  const m = /^\/charts\/([A-Za-z0-9]{8})\/?$/.exec(String(p || ''));
  if (!m) return null;
  const s = m[1].toUpperCase();
  return isSlug(s) ? s : null;
}
// Is this the charts page itself (/charts, /charts.html, /charts/<ID>)? Only there is the address bar rewritten.
export const isChartsPath = (p) => /^\/charts(\.html)?\/?$/.test(String(p || '')) || /^\/charts\/[A-Za-z0-9]{8}\/?$/.test(String(p || ''));
