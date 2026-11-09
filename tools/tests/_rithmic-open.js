// Test helper: open the Rithmic sheet the way a member does: Data source -> Rithmic -> Connect.
// (Clicks via the DOM so it also works when Data source sits in the phone "..." menu.)
module.exports = async function openRithmic(p) {
  await p.waitForSelector('#byo-btn', { state: 'attached', timeout: 60000 });
  await p.evaluate(() => document.getElementById('byo-btn').click());
  await p.waitForSelector('.byo-row[data-src="rithmic"] .byo-row-b', { timeout: 10000 });
  await p.evaluate(() => document.querySelector('.byo-row[data-src="rithmic"] .byo-row-b').click());
};
