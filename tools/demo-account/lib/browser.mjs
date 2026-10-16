// Playwright helper: logs in as the demo account (credentials read from the 0600 file, never printed) on the LIVE site.
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire('/root/projects/stryker-trading-academy/package.json');
const { chromium } = require('playwright-core');
export const CRED = process.env.DEMO_CREDENTIALS || '/root/.hermes/profiles/chief-of-staff/secure/demo-account/credentials';
export const BASE = process.env.SITE || 'https://tradezoro.com';
const creds = () => Object.fromEntries(fs.readFileSync(CRED, 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
export async function launch(w, h, extra = {}) {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/root/.cache/ms-playwright/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--disable-dev-shm-usage', '--js-flags=--max-old-space-size=768'] });
  const ctx = await b.newContext(Object.assign({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: w < 500, hasTouch: w < 500 }, extra));
  // The notifications banner's dismissal is per account in localStorage ('stryker_push_prompt_dismissed_<uid>', assets/push-prompt.js).
  try { const u = creds().uid; if (u) await ctx.addInitScript((k) => { try { localStorage.setItem(k, '1'); } catch (e) {} }, 'stryker_push_prompt_dismissed_' + u); } catch (e) {}
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errors.push('PAGEERR ' + String(e.message).slice(0, 200)));
  return { b, ctx, page, errors };
}
export async function login(page) {
  const c = creds();
  await page.goto(BASE + '/login', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#login-email', { timeout: 30000 });
  await page.waitForTimeout(2500);
  await page.fill('#login-email', c.email); await page.fill('#login-password', c.password);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(8000);
  return page.url();
}
