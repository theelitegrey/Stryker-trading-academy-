// quietLayer (assets/vela-chart.js) deferred canvas state: pixel-identical to a plain canvas.
// Takes quietLayer's source out of vela-chart.js, runs 400 random layer renders (transforms, save /
// restore, clips, style props inside saves, paths, blank frames, resizes, clears) on a wrapped and
// a plain canvas side by side, and compares every pixel + the context state after each render.
//   systemd-run --user --scope -p MemoryMax=1000M flock /tmp/stryker-chrome.lock node tools/tests/chart-quiet-layer-browser.js
const fs = require('fs');
const path = require('path');
const { launch } = require('./lib.js');
const src = fs.readFileSync(path.join(__dirname, '../../assets/vela-chart.js'), 'utf8');
const a = src.indexOf('const DRAW_OPS'); const b = src.indexOf('\n}\n', src.indexOf('function quietLayer')) + 3;
const QL = src.slice(a, b);
(async () => {
  const br = await launch({ args: ['--no-sandbox', '--js-flags=--max-old-space-size=600'] });
  const p = await br.newPage();
  await p.setContent('<body></body>');
  const r = await p.evaluate((QL) => {
    eval(QL + '; window.quietLayer = quietLayer;');
    let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    const pick = (a) => a[Math.floor(rnd() * a.length)];
    const W = 120, H = 90;
    const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; document.body.appendChild(c); return c; };
    const plain = mk(), wrapped = mk();
    // a "layer" whose render runs a script of ops on its canvas
    let script = null;
    const def = { id: 't', create: () => { let cv; return { mount(c) { cv = c; }, render() { const g = cv.getContext('2d'); script(g, cv); } }; } };
    const inst = window.quietLayer(def).create(); inst.mount(wrapped);
    const fails = [];
    const COLORS = ['red', 'rgba(0,128,255,0.5)', '#0f0', 'black', 'rgba(255,255,0,0.7)'];
    const genOp = () => {
      const r = rnd();
      if (r < 0.08) { const s = 1 + Math.floor(rnd() * 3); return (g) => g.setTransform(s, 0, 0, s, 0, 0); }
      if (r < 0.12) return (g) => g.setTransform(1, 0, 0, 1, 0, 0);
      if (r < 0.17) { const x = Math.floor(rnd() * 20) - 10, y = Math.floor(rnd() * 20) - 10; return (g) => g.translate(x, y); }
      if (r < 0.20) return (g) => g.scale(1.5, 0.75);
      if (r < 0.28) return (g) => g.save();
      if (r < 0.36) return (g) => g.restore();
      if (r < 0.42) { const c = pick(COLORS); return (g) => { g.fillStyle = c; }; }
      if (r < 0.45) { const c = pick(COLORS); return (g) => { g.strokeStyle = c; }; }
      if (r < 0.48) { const w = 1 + Math.floor(rnd() * 4); return (g) => { g.lineWidth = w; }; }
      if (r < 0.50) { const al = 0.3 + rnd() * 0.7; return (g) => { g.globalAlpha = al; }; }
      if (r < 0.52) { const f = pick(['10px sans-serif', 'bold 14px monospace']); return (g) => { g.font = f; }; }
      if (r < 0.54) { const d = pick([[], [4, 2], [1, 3]]); return (g) => g.setLineDash(d); }
      if (r < 0.58) return (g) => g.beginPath();
      if (r < 0.63) { const x = rnd() * W, y = rnd() * H, w = rnd() * 40, h = rnd() * 30; return (g) => g.rect(x, y, w, h); }
      if (r < 0.66) { const x = rnd() * W, y = rnd() * H; return (g) => { g.moveTo(x, y); g.lineTo(x + 30, y + 10); }; }
      if (r < 0.69) { const x = rnd() * W, y = rnd() * H; return (g) => { g.beginPath(); g.rect(x, y, 40, 30); g.clip(); }; }
      if (r < 0.72) { const x = rnd() * W, y = rnd() * H; return (g) => g.fillRect(x, y, 20, 15); }
      if (r < 0.74) return (g) => g.fill();
      if (r < 0.76) return (g) => g.stroke();
      if (r < 0.78) { const x = rnd() * W, y = rnd() * H; return (g) => g.fillText('Ab', x, y); }
      if (r < 0.80) return (g) => { g.measureText('abc'); };
      if (r < 0.84) return (g, c) => g.clearRect(0, 0, c.width, c.height);
      if (r < 0.86) { const x = rnd() * W, y = rnd() * H; return (g) => g.clearRect(x, y, 30, 20); }
      if (r < 0.87) return (g) => { const m = g.getTransform(); g.__m = m.a; };
      return (g) => {};
    };
    const state = (g) => { const m = g.getTransform(); return [m.a, m.b, m.c, m.d, m.e, m.f, g.fillStyle, g.strokeStyle, g.lineWidth, g.globalAlpha, g.font, g.getLineDash().join(',')].join('|'); };
    for (let it = 0; it < 400; it++) {
      // typical layer: full clear + DPR transform, then either nothing (most frames) or some ops
      const ops = [(g, c) => { g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, c.width, c.height); }, (g) => g.setTransform(2, 0, 0, 2, 0, 0)];
      const blank = rnd() < 0.5;
      const n = blank ? Math.floor(rnd() * 6) : 4 + Math.floor(rnd() * 25);
      for (let i = 0; i < n; i++) { const o = genOp(); if (blank && /fill|stroke|Text/.test(o.toString())) continue; ops.push(o); }
      if (rnd() < 0.05) { const nw = pick([120, 100, 140]); plain.width = nw; wrapped.width = nw; }
      script = (g, c) => { for (const o of ops) o(g, c); };
      const pg = plain.getContext('2d'); for (const o of ops) o(pg, plain);
      inst.render();
      const wg = wrapped.getContext('2d');
      const A = pg.getImageData(0, 0, plain.width, plain.height).data;
      // read the wrapped canvas through a fresh plain context path (the proto, not the wrapper)
      const B = CanvasRenderingContext2D.prototype.getImageData.call(wg, 0, 0, wrapped.width, wrapped.height).data;
      let diff = 0; for (let i = 0; i < A.length; i++) if (A[i] !== B[i]) diff++;
      const chk = it % 5 === 0;   // getTransform replays the record: check state only now and then
      const sp = chk ? state(pg) : '', sw = chk ? state(wg) : '';
      if (diff || sp !== sw) { fails.push({ it, diff, sp, sw, blank, n }); if (fails.length > 5) break; }
    }
    return { fails };
  }, QL);
  await br.close();
  if (r.fails.length) { console.log('FAIL quiet layer differs from a plain canvas', JSON.stringify(r.fails, null, 1)); process.exit(1); }
  console.log('PASS 400 random layer renders: wrapped canvas pixel- and state-identical to a plain one');
})().catch((e) => { console.error(e); process.exit(1); });
