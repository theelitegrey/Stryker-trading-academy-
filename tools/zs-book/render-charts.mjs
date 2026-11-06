// Render chart images for the manual and the book from REAL runs of the recipe on sample bars.
//   node tools/zs-book/render-charts.mjs
// For every `@chart <name>` line in tools/zs-book/src/**/*.md the code block just above it is compiled and run on
// the engine, and the output is drawn to tools/zs-book/charts/<name>.svg (+ <name>.json caption).
// Sample bars only (a seeded random walk): every image is captioned "Sample bars, not market data."
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, sampleBars, sampleData, loadEngine } from './lib.mjs';

const SRC = path.join(ROOT, 'tools/zs-book/src');
const OUT = path.join(ROOT, 'tools/zs-book/charts');
fs.mkdirSync(OUT, { recursive: true });
const eng = await loadEngine();
if (!eng) { console.log('engine not found; no charts rendered'); process.exit(process.env.ZS_REQUIRE ? 1 : 0); }
const { mod } = eng;

const W = 640, SHOW = 90, PAD = { l: 8, r: 52, t: 10, b: 10 };
const BG = '#0b0b0d', GRID = 'rgba(255,255,255,0.07)', TXT = 'rgba(255,255,255,0.55)', UP = '#03c988', DN = '#e5484d';
const num = (v) => (v === null || v === undefined || Number.isNaN(v) ? NaN : +v);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function col(c, fallback) {
  if (!c) return { c: fallback, o: 1 };
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(c);
  return m ? { c: '#' + m[1], o: m[2] ? parseInt(m[2], 16) / 255 : 1 } : { c: fallback, o: 1 };
}

function draw(out, bars, overlay, caption) {
  const n = bars.time.length, i0 = Math.max(0, n - SHOW), cnt = n - i0;
  const H = overlay ? 300 : 200;
  const plots = (out.plots || []).filter((p) => p.display !== 'none');
  const vals = [];
  const push = (v) => { v = num(v); if (Number.isFinite(v)) vals.push(v); };
  if (overlay) for (let i = i0; i < n; i++) { push(bars.high[i]); push(bars.low[i]); }
  plots.forEach((p) => { if (p.values) for (let i = i0; i < n; i++) if (p.kind !== 'shape' && p.kind !== 'char' && p.kind !== 'arrow' && p.kind !== 'bgcolor' && p.kind !== 'barcolor') push(p.values[i]); });
  (out.hlines || []).forEach((h) => push(h.price));
  const histLike = plots.some((p) => p.kind === 'histogram' || p.kind === 'columns');
  if (histLike) vals.push(0);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (!Number.isFinite(lo)) { lo = 0; hi = 1; }
  if (hi === lo) { hi = lo + 1; }
  const m = (hi - lo) * 0.06; lo -= m; hi += m;
  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b, step = iw / cnt;
  const X = (i) => PAD.l + (i - i0 + 0.5) * step;
  const Y = (v) => PAD.t + (1 - (v - lo) / (hi - lo)) * ih;
  const s = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(caption)}"><rect width="${W}" height="${H}" fill="${BG}"/>`];
  for (let g = 0; g <= 4; g++) {
    const v = lo + ((hi - lo) * g) / 4, y = Y(v);
    s.push(`<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${GRID}"/><text x="${W - PAD.r + 6}" y="${(y + 3.5).toFixed(1)}" font-size="10" fill="${TXT}" font-family="monospace">${Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2)}</text>`);
  }
  const bgs = out.plots.filter((p) => p.kind === 'bgcolor'), bcs = out.plots.filter((p) => p.kind === 'barcolor');
  bgs.forEach((p) => { for (let i = i0; i < n; i++) { const c = p.colors && p.colors[i]; if (c) { const k = col(c, '#888'); s.push(`<rect x="${(X(i) - step / 2).toFixed(1)}" y="${PAD.t}" width="${step.toFixed(1)}" height="${ih}" fill="${k.c}" fill-opacity="${(k.o * 0.9).toFixed(2)}"/>`); } } });
  const idOf = {};
  const baseline = Y(Math.min(Math.max(0, lo), hi));
  if (overlay) {
    for (let i = i0; i < n; i++) {
      const up = bars.close[i] >= bars.open[i]; let c = up ? UP : DN, o = 1;
      bcs.forEach((p) => { const cc = p.colors && p.colors[i]; if (cc) { const k = col(cc, c); c = k.c; o = k.o; } });
      const x = X(i), bw = Math.max(1, step * 0.62);
      s.push(`<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${Y(bars.high[i]).toFixed(1)}" y2="${Y(bars.low[i]).toFixed(1)}" stroke="${c}" stroke-opacity="${o}"/>`);
      const y1 = Y(Math.max(bars.open[i], bars.close[i])), y2 = Y(Math.min(bars.open[i], bars.close[i]));
      s.push(`<rect x="${(x - bw / 2).toFixed(1)}" y="${y1.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, y2 - y1).toFixed(1)}" fill="${c}" fill-opacity="${o}"/>`);
    }
  }
  (out.hlines || []).forEach((h) => {
    const k = col(h.color, '#8a948d'), y = Y(h.price); idOf[h.id] = { hline: h.price };
    s.push(`<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="${k.c}" stroke-opacity="${k.o}" stroke-dasharray="4 4"/>`);
  });
  plots.forEach((p) => { idOf[p.id] = p; });
  (out.fills || []).forEach((f) => {
    const a = idOf[f.a], b = idOf[f.b]; if (!a || !b) return;
    const va = (i) => (a.hline !== undefined ? a.hline : num(a.values[i])), vb = (i) => (b.hline !== undefined ? b.hline : num(b.values[i]));
    const k = col(f.color, '#8a948d'); let up = [], dn = [];
    const flush = () => { if (up.length > 1) s.push(`<polygon points="${up.concat(dn.reverse()).join(' ')}" fill="${k.c}" fill-opacity="${k.o.toFixed(2)}"/>`); up = []; dn = []; };
    for (let i = i0; i < n; i++) {
      const A = va(i), B = vb(i);
      if (!Number.isFinite(A) || !Number.isFinite(B)) { flush(); continue; }
      up.push(`${X(i).toFixed(1)},${Y(A).toFixed(1)}`); dn.push(`${X(i).toFixed(1)},${Y(B).toFixed(1)}`);
    }
    flush();
  });
  plots.forEach((p) => {
    const base = col(p.color, '#d8dedb'), lw = Math.max(1, p.linewidth || 1.5);
    const cAt = (i) => { const cc = p.colors && p.colors[i]; return cc ? col(cc, base.c) : base; };
    if (['line', 'stepline', 'area', 'areabr', 'linebr'].includes(p.kind)) {
      let d = '', prev = null, pts = [];
      for (let i = i0; i < n; i++) {
        const v = num(p.values[i]);
        if (!Number.isFinite(v)) { prev = null; continue; }
        const x = X(i), y = Y(v);
        if (prev === null) d += `M${x.toFixed(1)},${y.toFixed(1)}`; else d += p.kind === 'stepline' ? `H${x.toFixed(1)}V${y.toFixed(1)}` : `L${x.toFixed(1)},${y.toFixed(1)}`;
        prev = y; pts.push([x, y]);
      }
      if (p.kind === 'area' && pts.length > 1) s.push(`<path d="${d}L${pts[pts.length - 1][0].toFixed(1)},${baseline.toFixed(1)}L${pts[0][0].toFixed(1)},${baseline.toFixed(1)}Z" fill="${base.c}" fill-opacity="0.18"/>`);
      // per-bar colour: draw in runs of the same colour
      if (p.colors && p.colors.some(Boolean)) {
        let run = null;
        for (let i = i0 + 1; i < n; i++) {
          const v0 = num(p.values[i - 1]), v1 = num(p.values[i]);
          if (!Number.isFinite(v0) || !Number.isFinite(v1)) continue;
          const k = cAt(i);
          s.push(`<line x1="${X(i - 1).toFixed(1)}" y1="${Y(v0).toFixed(1)}" x2="${X(i).toFixed(1)}" y2="${Y(v1).toFixed(1)}" stroke="${k.c}" stroke-opacity="${k.o}" stroke-width="${lw}" stroke-linecap="round"/>`);
        }
      } else s.push(`<path d="${d}" fill="none" stroke="${base.c}" stroke-opacity="${base.o}" stroke-width="${lw}" stroke-linejoin="round"/>`);
    } else if (p.kind === 'histogram' || p.kind === 'columns') {
      const bw = Math.max(1, step * (p.kind === 'columns' ? 0.8 : 0.45));
      for (let i = i0; i < n; i++) {
        const v = num(p.values[i]); if (!Number.isFinite(v)) continue;
        const k = cAt(i), y = Y(v), y0 = Y(0);
        s.push(`<rect x="${(X(i) - bw / 2).toFixed(1)}" y="${Math.min(y, y0).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1, Math.abs(y - y0)).toFixed(1)}" fill="${k.c}" fill-opacity="${k.o}"/>`);
      }
    } else if (p.kind === 'circles' || p.kind === 'cross') {
      for (let i = i0; i < n; i++) { const v = num(p.values[i]); if (Number.isFinite(v)) { const k = cAt(i); s.push(`<circle cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="2" fill="${k.c}" fill-opacity="${k.o}"/>`); } }
    } else if (p.kind === 'shape' || p.kind === 'char' || p.kind === 'arrow') {
      for (let i = i0; i < n; i++) {
        const v = num(p.values[i]); if (!Number.isFinite(v) || v === 0 && p.kind === 'arrow') continue;
        const k = cAt(i), x = X(i), below = p.location === 'belowbar' || (p.kind === 'arrow' && v > 0), base0 = below ? bars.low[i] : bars.high[i];
        const y = Y(base0) + (below ? 9 : -9);
        const sh = p.shape || (p.kind === 'arrow' ? (v > 0 ? 'arrowup' : 'arrowdown') : 'circle');
        if (/up/.test(sh)) s.push(`<path d="M${x.toFixed(1)},${(y - 5).toFixed(1)}L${(x + 4.5).toFixed(1)},${(y + 4).toFixed(1)}L${(x - 4.5).toFixed(1)},${(y + 4).toFixed(1)}Z" fill="${k.c}"/>`);
        else if (/down/.test(sh)) s.push(`<path d="M${x.toFixed(1)},${(y + 5).toFixed(1)}L${(x + 4.5).toFixed(1)},${(y - 4).toFixed(1)}L${(x - 4.5).toFixed(1)},${(y - 4).toFixed(1)}Z" fill="${k.c}"/>`);
        else if (/cross/.test(sh)) s.push(`<path d="M${(x - 3.5).toFixed(1)},${(y - 3.5).toFixed(1)}l7,7m0,-7l-7,7" stroke="${k.c}" stroke-width="1.6"/>`);
        else s.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.2" fill="${k.c}"/>`);
      }
    }
  });
  (out.boxes || []).forEach((b) => {
    const l = Math.max(b.left, i0), r = Math.min(b.right, n - 1 + 12); if (r < i0) return;
    const bg = col(b.bgcolor, '#888'), bd = col(b.border_color, '#aaa');
    const x1 = X(l), x2 = PAD.l + (r - i0 + 0.5) * step, y1 = Y(b.top), y2 = Y(b.bottom);
    s.push(`<rect x="${x1.toFixed(1)}" y="${Math.min(y1, y2).toFixed(1)}" width="${Math.max(1, Math.min(x2, W - PAD.r) - x1).toFixed(1)}" height="${Math.max(1, Math.abs(y2 - y1)).toFixed(1)}" fill="${bg.c}" fill-opacity="${bg.o}" stroke="${bd.c}" stroke-opacity="${bd.o}"/>`);
  });
  (out.lines || []).forEach((l) => {
    const k = col(l.color, '#aaa'); let x1 = l.x1, x2 = l.x2;
    if (l.extend === 'right' || l.extend === 'both') x2 = n + 20;
    if (Math.max(x1, x2) < i0) return;
    s.push(`<line x1="${(PAD.l + (x1 - i0 + 0.5) * step).toFixed(1)}" y1="${Y(l.y1).toFixed(1)}" x2="${Math.min(W - PAD.r, PAD.l + (x2 - i0 + 0.5) * step).toFixed(1)}" y2="${Y(l.y2).toFixed(1)}" stroke="${k.c}" stroke-opacity="${k.o}" stroke-width="${l.width || 1}"/>`);
  });
  (out.labels || []).forEach((l) => {
    if (l.x < i0) return; const k = col(l.color, '#555'), t = col(l.textcolor, '#fff'), x = X(Math.min(l.x, n - 1)), y = Y(l.y);
    const w = 8 + 6.2 * String(l.text).length, down = /down|label_down/.test(l.style || ''), up = /up/.test(l.style || '') && !down;
    const yy = down ? y - 20 : up ? y + 6 : y - 8;
    s.push(`<rect x="${(x - w / 2).toFixed(1)}" y="${yy.toFixed(1)}" width="${w.toFixed(1)}" height="16" rx="3" fill="${k.c}" fill-opacity="${Math.max(0.6, k.o)}"/><text x="${x.toFixed(1)}" y="${(yy + 11.5).toFixed(1)}" text-anchor="middle" font-size="10" font-family="monospace" fill="${t.c}">${esc(l.text)}</text>`);
  });
  (out.tables || []).forEach((t) => {
    const rows = t.rows, cols = t.columns, cw = 78, rh = 17, x0 = /left/.test(t.position) ? PAD.l + 6 : W - PAD.r - cols * cw - 6, y0 = /bottom/.test(t.position) ? H - PAD.b - rows * rh - 4 : PAD.t + 6;
    s.push(`<rect x="${x0}" y="${y0}" width="${cols * cw}" height="${rows * rh}" fill="#131316" stroke="rgba(255,255,255,0.15)"/>`);
    (t.cells || []).forEach((c) => s.push(`<text x="${x0 + c.c * cw + 6}" y="${y0 + c.r * rh + 12}" font-size="10" font-family="monospace" fill="rgba(255,255,255,0.85)">${esc(c.text)}</text>`));
  });
  s.push('</svg>');
  return s.join('');
}

let made = 0;
const bars = sampleBars(400), data = sampleData(bars);
const files = [];
for (const d of ['manual', 'cookbook']) for (const f of fs.readdirSync(path.join(SRC, d)).sort()) if (f.endsWith('.md')) files.push(path.join(SRC, d, f));
for (const f of files) {
  const text = fs.readFileSync(f, 'utf8');
  const re = /```(zscript|zs-snippet)\n([\s\S]*?)```\s*\n+@chart\s+(\S+)/g;
  let m;
  while ((m = re.exec(text))) {
    const src = m[1] === 'zs-snippet' ? '//@zscript 1\nindicator("Snippet", overlay=true)\n' + m[2] : m[2];
    const r = mod.compile(src);
    if (!r.ok) { console.log('compile failed for chart', m[3]); process.exitCode = 1; continue; }
    const run = mod.runSync || mod.run;
    const out = await run({ program: r.program, bars, symbol: { ticker: 'SAMPLE', tickerid: 'SAMPLE', type: 'futures', currency: 'USD', mintick: 0.25, pointvalue: 1 },
      timeframe: '5', inputs: {}, allowed: { book: true, flow: true, gex: true, opt: true }, data, securities: {} });
    if (out.ok === false) { console.log('run failed for chart', m[3], JSON.stringify(out.error)); process.exitCode = 1; continue; }
    const overlay = !!(r.meta && r.meta.overlay);
    const cap = 'Sample bars, not market data. ' + (r.meta && r.meta.title ? r.meta.title + '.' : '');
    fs.writeFileSync(path.join(OUT, m[3] + '.svg'), draw(out, bars, overlay, cap));
    fs.writeFileSync(path.join(OUT, m[3] + '.json'), JSON.stringify({ caption: cap, source: path.relative(ROOT, f) }));
    made++;
  }
}
console.log('charts rendered:', made);
