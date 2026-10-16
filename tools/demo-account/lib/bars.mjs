// Historical bars from the site's own chart API (/api/chart/bars), cached on disk.
// Used only by the generator scripts (gen-*.mjs), never by seed.mjs, so seeding stays offline and repeatable.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const BASE = process.env.DEMO_BARS_BASE || 'https://strykertrading.com/api/chart/bars/';
const CACHE = process.env.DEMO_BARS_CACHE || path.join(os.tmpdir(), 'stryker-demo-bars');
const PAGE_S = { '1': 8 * 3600, '5': 2 * 86400, '15': 5 * 86400, '60': 20 * 86400 };
fs.mkdirSync(CACHE, { recursive: true });

async function page(sym, tf, pg) {
  const f = path.join(CACHE, `${sym}-${tf}-${pg}.json`);
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  let last;
  for (let i = 0; i < 4; i++) {
    try {
      const r = await fetch(`${BASE}${sym}?tf=${tf}&page=${pg}`, { headers: { 'user-agent': 'Mozilla/5.0 Chrome/120', accept: 'application/json' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      const bars = j.bars || [];
      // only cache closed pages (older than 2 pages from now)
      const nowPg = Math.floor(Date.now() / 1000 / PAGE_S[tf]);
      if (pg < nowPg - 1) fs.writeFileSync(f, JSON.stringify(bars));
      return bars;
    } catch (e) { last = e; await new Promise((r) => setTimeout(r, 800 * (i + 1))); }
  }
  throw last;
}

/** bars [t,o,h,l,c,v] for [fromSec, toSec) at timeframe tf ('1'|'5'|'60'). */
export async function getBars(sym, tf, fromSec, toSec) {
  const ps = PAGE_S[tf];
  const out = [];
  for (let pg = Math.floor(fromSec / ps); pg <= Math.floor((toSec - 1) / ps); pg++) {
    for (const b of await page(sym, tf, pg)) if (b[0] >= fromSec && b[0] < toSec) out.push(b);
  }
  out.sort((a, b) => a[0] - b[0]);
  return out.filter((b, i) => i === 0 || b[0] !== out[i - 1][0]);
}

// New York offset (seconds) with US DST rules
function nthSunday(y, m, n) { const first = Date.UTC(y, m, 1); const dow = new Date(first).getUTCDay(); return first + (((7 - dow) % 7) + 7 * (n - 1)) * 864e5; }
export function nyOffset(t) {
  const y = new Date(t * 1000).getUTCFullYear();
  const start = nthSunday(y, 2, 2) / 1000 + 7 * 3600, end = nthSunday(y, 10, 1) / 1000 + 6 * 3600;
  return t >= start && t < end ? -4 * 3600 : -5 * 3600;
}
/** epoch seconds for a New York wall-clock date (YYYY-MM-DD) and minutes-since-midnight */
export function nyToEpoch(date, minutes) {
  const [y, m, d] = date.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, minutes) / 1000;
  return guess - nyOffset(guess - nyOffset(guess));
}
export function nyParts(t) {
  const d = new Date((t + nyOffset(t)) * 1000);
  return { date: d.toISOString().slice(0, 10), minutes: d.getUTCHours() * 60 + d.getUTCMinutes(), dow: d.getUTCDay(), hhmm: d.toISOString().slice(11, 16) };
}
