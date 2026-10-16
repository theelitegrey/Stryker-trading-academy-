// Reference prices for the seeded alerts (so they sit near where NQ/ES really trade). Writes data/levels.json.
import fs from 'node:fs';
import { getBars } from './lib/bars.mjs';
const now = Math.floor(Date.UTC(2026, 9, 15) / 1000);
const out = {};
for (const s of ['NQ', 'ES']) {
  const b = await getBars(s, '60', now - 6 * 86400, now);
  out[s] = { last: b.at(-1)[4], hi: Math.max(...b.map((x) => x[2])), lo: Math.min(...b.map((x) => x[3])) };
}
console.log(out);
fs.writeFileSync(new URL('./data/levels.json', import.meta.url), JSON.stringify(out));
