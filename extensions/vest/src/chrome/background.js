// Chrome/Edge (service worker): keeps the member's private levels link and fetches levels from tradezoro.com.
// No other network use. No analytics, no version ping.
importScripts('core.js');
var C = self.ZV_CORE;
async function levels(u) {
  var got = await chrome.storage.local.get('lvSecret'), secret = got.lvSecret || null;
  if (!secret) return { status: 'nolink', hasLink: false };
  var url = C.levelsUrl(secret, u);
  if (!url) return { status: 'error', error: 'No levels for this market.', hasLink: true };
  try {
    var r = await fetch(url, { credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
    if (r.status === 404) return { status: 'inactive', hasLink: true };
    if (r.status === 429) return { status: 'error', error: 'Too many levels requests. Try again in a minute.', hasLink: true };
    if (!r.ok) return { status: 'error', error: 'Levels feed answered ' + r.status + '.', hasLink: true };
    return { status: 'ok', json: await r.json(), hasLink: true };
  } catch (e) { return { status: 'error', error: 'Levels could not be loaded.', hasLink: true }; }
}
chrome.runtime.onMessage.addListener(function (msg, sender, reply) {
  if (!sender.tab || !/^https:\/\/next\.vestmarkets\.com\//.test(sender.url || '')) return false;
  if (msg && msg.op === 'levels') { levels(msg.u).then(reply); return true; }
  if (msg && msg.op === 'setLink') {
    var p = msg.secret ? chrome.storage.local.set({ lvSecret: msg.secret }) : chrome.storage.local.remove('lvSecret');
    p.then(function () { reply({ status: 'ok' }); }); return true;
  }
  return false;
});
