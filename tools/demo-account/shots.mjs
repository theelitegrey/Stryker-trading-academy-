// Walks the user-facing modules as the demo account and saves screenshots. Usage: node shots.mjs <outdir> [width]
import fs from 'node:fs';
import { launch, login, BASE } from './lib/browser.mjs';
const out = process.argv[2], W = Number(process.argv[3] || 1440), H = W < 500 ? 844 : 900;
fs.mkdirSync(out, { recursive: true });
const PAGES = [['dashboard', '/dashboard-user'], ['profile', '/profile'], ['journal', '/trade-journal'], ['paper-review', '/paper-review'], ['backtests', '/backtests'], ['replay', '/replay'],
  ['charts', '/charts'], ['achievements', '/achievements'], ['courses', '/courses'], ['learn', '/learn'], ['models', '/models'], ['indicators', '/indicators'], ['gex', '/gex'], ['market-brief', '/market-brief'],
  ['market-map', '/market-map'], ['calendar', '/economic-calendar'], ['scanner', '/scanner'], ['leaderboard', '/leaderboard'], ['giveaways', '/giveaways'], ['messages', '/messages'], ['settings', '/settings'], ['referrals', '/referrals'], ['roadmap', '/roadmap'], ['live-sessions', '/live-sessions']];
const only = process.env.ONLY ? process.env.ONLY.split(',') : null;
const { b, page, errors } = await launch(W, H);
console.log('landed', await login(page));
const log = [];
for (const [name, p] of PAGES) {
  if (only && !only.includes(name)) continue;
  errors.length = 0;
  try { await page.goto(BASE + p, { waitUntil: 'domcontentloaded', timeout: 45000 }); } catch (e) { console.log(name, 'nav', e.message.slice(0, 60)); }
  await page.waitForTimeout(name === 'charts' || name === 'gex' ? 12000 : 7000);
  await page.screenshot({ path: `${out}/${name}-${W}.png` });
  const title = await page.title();
  console.log(name.padEnd(14), page.url().replace(BASE, ''), '| errors:', errors.length, errors.slice(0, 2).join(' || ').slice(0, 220));
}
await b.close();
