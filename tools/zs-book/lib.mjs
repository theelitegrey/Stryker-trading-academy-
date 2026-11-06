// Shared by the docs sample test and the chart renderer: pull code out of the markdown, make sample bars, run on S1's engine.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = path.join(ROOT, 'tools/zs-book/src');

export function samples() {
  const out = [];
  for (const dir of ['manual', 'cookbook']) {
    for (const fn of fs.readdirSync(path.join(SRC, dir)).sort()) {
      if (!fn.endsWith('.md')) continue;
      const text = fs.readFileSync(path.join(SRC, dir, fn), 'utf8');
      const re = /^```(zscript|zs-snippet)\n([\s\S]*?)^```/gm;
      let m, n = 0;
      while ((m = re.exec(text))) {
        n++;
        let src = m[2];
        if (m[1] === 'zs-snippet') src = '//@zscript 1\nindicator("Snippet", overlay=true)\n' + src;
        out.push({ id: `${dir}/${fn.replace(/\.md$/, '')}#${n}`, file: `${dir}/${fn}`, src });
      }
    }
  }
  const course = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/content/zscript-course.json'), 'utf8'));
  course.forEach((c) => {
    const re = /<pre class="zs-code"><code>([\s\S]*?)<\/code><\/pre>/g;
    let m, n = 0;
    while ((m = re.exec(c.bodyHtml))) {
      n++;
      let src = m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
      if (!src.startsWith('//@zscript')) {
        if (!/^\s*\w[\w.]*\(.*\)\s*=>/.test(src) && !/^alertcondition/.test(src)) continue;
        src = '//@zscript 1\nindicator("Snippet", overlay=true)\n' + src;
        if (/=>/.test(src) && !/plot/.test(src)) src += '\nplot(close)';
        if (/^alertcondition/m.test(src)) src = src;
      }
      out.push({ id: `course/${c.num}#${n}`, file: `course/${c.num}`, src });
    }
  });
  return out;
}

// 400 deterministic sample bars (5-minute), a seeded random walk. Sample data only.
export function sampleBars(n = 400) {
  let s = 12345; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  const bars = { time: [], open: [], high: [], low: [], close: [], volume: [] };
  let p = 5000; const t0 = Date.UTC(2026, 9, 5, 13, 30);
  for (let i = 0; i < n; i++) {
    const o = p, c = o + (rnd() - 0.48) * 6, h = Math.max(o, c) + rnd() * 3, l = Math.min(o, c) - rnd() * 3;
    bars.time.push(t0 + i * 300000); bars.open.push(o); bars.high.push(h); bars.low.push(l); bars.close.push(c);
    bars.volume.push(Math.round(800 + rnd() * 1200)); p = c;
  }
  return bars;
}

// Sample data frames in the shape of SPEC 11.3 so the data recipes run with numbers.
export function sampleData(bars) {
  const n = bars.time.length, flow = { buyvol: [], sellvol: [], trades: [], bigtrades: [], footprint: [] };
  const book = [], gex = [], opt = [];
  for (let i = 0; i < n; i++) {
    const v = bars.volume[i], up = bars.close[i] >= bars.open[i], b = Math.round(v * (up ? 0.56 : 0.44));
    flow.buyvol.push(b); flow.sellvol.push(v - b); flow.trades.push(Math.round(v / 3));
    const px = Math.round(bars.close[i]);
    flow.bigtrades.push([[px, 60, 1]]); flow.footprint.push([[px, v / 2, v / 2]]);
    const c = bars.close[i], t = bars.time[i];
    book.push({ t, bids: [[c - 0.25, 400], [c - 0.5, 700], [c - 0.75, 900]], asks: [[c + 0.25, 350], [c + 0.5, 800], [c + 0.75, 650]] });
    gex.push({ t, callwall: 5050, putwall: 4950, flip: 5000, zero_upper: 5020, zero_lower: 4980, net: 1.2, levels: [5050, 4950, 5000] });
    opt.push({ t, nodes: [5025, 4975], ranges: { day: [4970, 5030], week: [4940, 5060], expected: [4960, 5040] }, ivrank: 42, pc: 0.9, maxpain: 5000, zone: 'Sample' });
  }
  return { flow, book, gex, opt };
}

export async function loadEngine() {
  const cands = [process.env.ZS_ENGINE, path.join(ROOT, 'assets/zs/index.js'), '/root/projects/wt/web-temp-1/assets/zs/index.js'].filter(Boolean);
  for (const p of cands) if (fs.existsSync(p)) return { mod: await import(pathToFileURL(p).href), path: p };
  return null;
}
