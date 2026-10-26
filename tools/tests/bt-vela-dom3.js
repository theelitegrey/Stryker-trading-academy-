const R = require('./bt-rig.js'); const q = process.argv[2] || 'chart=tz&ui=2';
(async () => { const srv = await R.serve(); const b = await R.launch(); const { p } = await R.page(b, srv, 'phone');
  await R.startSession(p, srv.base, q); await p.waitForTimeout(4500);
  console.log(JSON.stringify(await p.evaluate(() => {
    const out = {};
    out.bar = [...document.querySelectorAll('#stkc-bar *')].filter((e) => { const r = e.getBoundingClientRect(); const bg = getComputedStyle(e).backgroundColor; return r.width > 10 && r.height > 10 && r.x < 200 && /rgb\((2[3-5]\d|\d{3}), *(2[3-5]\d|\d{3}), *(2[3-5]\d)/.test(bg); }).map((e) => e.tagName + '.' + e.className.toString().slice(0, 40) + ' ' + getComputedStyle(e).backgroundColor + ' ' + Math.round(e.getBoundingClientRect().x) + ',' + Math.round(e.getBoundingClientRect().width)).slice(0, 6);
    out.tf = (() => { const t = document.querySelector('.vela-mb-tf'); return t ? [t.className, getComputedStyle(t).backgroundColor, t.textContent] : null; })();
    out.avatar = [...document.querySelectorAll('#vela-chart [class*=avatar], #vela-chart [class*=icon]')].map((e) => e.className.toString().slice(0, 40) + ':' + e.textContent.slice(0, 4)).slice(0, 6);
    out.toastHost = (() => { const h = document.getElementById('stryker-toast-host'); const r = h.getBoundingClientRect(); return [h.className, Math.round(r.y), Math.round(r.height), getComputedStyle(h).bottom, getComputedStyle(h).top]; })();
    return out; })));
  await b.close(); srv.close(); })();
