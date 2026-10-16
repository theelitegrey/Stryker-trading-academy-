// Opens a journal trade from History, edits the notes, saves, verifies, then restores the original text.
import { launch, login, BASE } from './lib/browser.mjs';
const { b, page, errors } = await launch(1440, 900);
await login(page);
await page.goto(BASE + '/trade-journal', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(8000);
await page.evaluate(() => { const b = [...document.querySelectorAll('[data-tab="history"]')].find((e) => e.offsetParent) || document.querySelector('[data-tab="history"]'); b.click(); }); await page.waitForTimeout(2500);
await page.locator('.jz-log-row').first().click(); await page.waitForTimeout(1500);
const eb = page.locator('.jz-log-detail button:has-text("Edit"), .jz-log-detail [data-edit]').first();
console.log('detail opened, edit button:', await eb.count());
await eb.click(); await page.waitForTimeout(2000);
const notes = page.locator('#jf-notes'); console.log('form visible', await notes.isVisible());
const orig = await notes.inputValue(); console.log('orig note length', orig.length);
await notes.fill(orig + ' [edit test]'); await page.click('#jf-save-btn'); await page.waitForTimeout(3500);
await page.evaluate(() => { const b = [...document.querySelectorAll('[data-tab="history"]')].find((e) => e.offsetParent) || document.querySelector('[data-tab="history"]'); b.click(); }); await page.waitForTimeout(1500);
const found = await page.evaluate(() => document.body.innerText.includes('[edit test]'));
console.log('edit visible after save:', found);
// revert
await page.evaluate(() => { const b = [...document.querySelectorAll('[data-tab="history"]')].find((e) => e.offsetParent) || document.querySelector('[data-tab="history"]'); b.click(); }); await page.waitForTimeout(2000);
await page.locator('.jz-log-row').first().click(); await page.waitForTimeout(1200);
await page.locator('.jz-log-detail button:has-text("Edit"), .jz-log-detail [data-edit]').first().click(); await page.waitForTimeout(2000);
const cur = await page.locator('#jf-notes').inputValue(); console.log('same trade reopened with edit:', cur === orig + ' [edit test]');
await page.locator('#jf-notes').fill(orig); await page.click('#jf-save-btn'); await page.waitForTimeout(3500);
await page.evaluate(() => { const b = [...document.querySelectorAll('[data-tab="history"]')].find((e) => e.offsetParent) || document.querySelector('[data-tab="history"]'); b.click(); }); await page.waitForTimeout(2000); await page.locator('.jz-log-row').first().click(); await page.waitForTimeout(1000); console.log('reverted (no edit text left):', !(await page.evaluate(() => document.body.innerText.includes('[edit test]'))));
console.log('errors', errors.filter((e) => !/Could not reach|404|400/.test(e)).slice(0, 3));
await b.close();
