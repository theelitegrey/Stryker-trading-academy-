// Stryker Trading Academy — Giveaways teaser (giveaways.html)
// The whole animation is CSS inside the page — this file only lets the admin
// override the headline and message via settings/giveaways (a world-readable
// settings doc, edited in the Giveaways admin module). Missing doc or fields
// leave the baked-in defaults untouched.

document.addEventListener('DOMContentLoaded', () => {
  if (typeof db === 'undefined' || !db) return;
  db.collection('settings').doc('giveaways').get().then((doc) => {
    if (!doc.exists) return;
    const d = doc.data() || {};
    const headline = String(d.headline || '').trim();
    const sub = String(d.sub || '').trim();
    if (headline) document.getElementById('gv-headline').textContent = headline;
    if (sub) document.getElementById('gv-sub').textContent = sub;
  }).catch(() => { /* teaser text is cosmetic — never break the page over it */ });
});
