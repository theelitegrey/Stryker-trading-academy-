// Depth Heatmap (L2) maths (assets/chart-depth-heatmap.js + the 'depth' style in assets/chart-bookmap.js).
//   node tools/tests/depth-heatmap.test.mjs
// Colour map (ramp ends + order, rank anchors: median blue, top 1 % warm), draw-until-changed (held within tolerance, redrawn on a
// real change, gone when removed), smoothing (trailing average, NO lookahead: a future sample never changes an earlier output),
// incremental == full pass, bubbles (buy / sell split, one per interval), config defaults.
import assert from 'node:assert/strict';
const D = await import('../../assets/chart-depth-heatmap.js');
const BM = await import('../../assets/chart-bookmap.js');
let n = 0;
const ok = (c, m, x) => { assert.ok(c, m + (x === undefined ? '' : ' ' + JSON.stringify(x))); n++; console.log('PASS ' + m); };
const rgb = (u) => [u & 255, (u >> 8) & 255, (u >> 16) & 255];
// ---- colour map ----
const lut = BM.lutOf('depth'), S = BM.STYLES.depth;
const c0 = rgb(lut[0]), cMid = rgb(lut[Math.round(0.3 * 255)]), cW = rgb(lut[Math.round(0.7 * 255)]), cY = rgb(lut[Math.round(0.77 * 255)]), c1 = rgb(lut[255]);
ok(c0[2] > c0[0] && c0[2] > c0[1] && c0[2] >= 30, 'ramp start is deep navy, not black', c0);
ok(cMid[2] > 120 && cMid[2] > cMid[0] * 3, 'thin-to-median book is a visible blue', cMid);
ok(cW.every((x) => x >= 250), 'white sits between the blues and the warm colours', cW);
ok(cY[0] > 240 && cY[1] > 200 && cY[2] < 100, 'then yellow', cY);
ok(c1[0] > 200 && c1[1] < 60 && c1[2] < 60, 'the biggest resting orders are red', c1);
const rank = (r) => { const A = S.anchors; for (let k = 1; k < A.length; k++) if (r <= A[k][0]) return A[k - 1][1] + (A[k][1] - A[k - 1][1]) * (r - A[k - 1][0]) / (A[k][0] - A[k - 1][0]); return 1; };
ok(rank(0) >= 0.06, 'the thinnest level is still drawn as texture (ramp >= 0.06)', rank(0));
ok(rank(0.5) < 0.44 && rank(0.9) < 0.64, 'the median and p90 of the book stay blue / light blue (not white)', [rank(0.5), rank(0.9)]);
ok(rank(0.99) >= 0.77, 'the top 1 % is warm (yellow and up)', rank(0.99));
ok(BM.STYLES.bookmap.ramp === 'bookmap' && BM.STYLES.bookmap.anchors[0][1] === 0.13, 'the existing heatmap style is unchanged');
ok(BM.styleFor({ look: 'depth' }).ramps[0] === 'depth', 'styleFor knows the depth look (GPU + 2D paths share it)');
// ---- draw-until-changed ----
const smp = (ts, v, i0 = 100) => ({ ts, mid: 0, bb: 0, ba: 0, step: 1, i0, v: Float32Array.from(v) });
let h = [smp(0, [10, -20]), smp(1000, [11, -20]), smp(2000, [11.5, -26.5]), smp(3000, [14, 0])];
let o = D.dhProcess(h, 0, 0.2, {});
ok(o[1].v[0] === 10 && o[2].v[0] === 10, 'a size within 20 % of the drawn one keeps the drawn size (one continuous bar)', [...o[1].v, ...o[2].v]);
ok(o[2].v[1] === -26.5, 'a change above 20 % is redrawn', o[2].v[1]);
ok(o[3].v[0] === 14, 'a real change after holding is redrawn', o[3].v[0]);
ok(o[3].v.length < 2 || o[3].v[1] === 0, 'a removed level is gone (no ghost)', [...o[3].v]);
o = D.dhProcess([smp(0, [10]), smp(1000, [-10])], 0, 0.2, {});
ok(o[1].v[0] === -10, 'a side flip is redrawn at once');
// ---- smoothing: trailing average, no lookahead ----
const sq = []; for (let t = 0; t < 60; t++) sq.push(smp(t * 1000, [t % 2 ? 100 : 0]));   // a level that flickers on / off each second
o = D.dhProcess(sq, 10000, 0, {});
ok(Math.abs(o[30].v[0] - 50) <= 10, 'a flickering level averages to ~half over 10 s', o[30].v[0]);
ok(o.slice(12).every((s) => s.v.length && s.v[0] > 0), 'with Smooth the flicker is one continuous band', o.slice(12).map((s) => s.v[0]));
const full = D.dhProcess(sq, 30000, 0.2, {}).map((s) => Array.from(s.v));
const cut = D.dhProcess(sq.slice(0, 40), 30000, 0.2, {}).map((s) => Array.from(s.v));
ok(JSON.stringify(full.slice(0, 40)) === JSON.stringify(cut), 'no lookahead: samples after t never change the output at t (replay safe)');
const spike = sq.slice(0, 40).concat([smp(40000, [100000])]);
const sp = D.dhProcess(spike, 30000, 0.2, {});
ok(sp[39].v[0] === cut[39][0], 'a huge later sample leaves earlier columns untouched');
// incremental (live frames append) == one full pass, and unchanged outputs keep their object identity
const stI = {}; let inc = null; for (let k = 10; k <= sq.length; k += 7) inc = D.dhProcess(sq.slice(0, k), 30000, 0.2, stI);
inc = D.dhProcess(sq, 30000, 0.2, stI);
ok(JSON.stringify(inc.map((s) => Array.from(s.v))) === JSON.stringify(full), 'live appends give the same picture as a full pass');
const again = D.dhProcess(sq.slice(5), 30000, 0.2, stI);
ok(again[0] === inc[5], 'scrolling the window start keeps the processed objects (no GPU re-upload)');
ok(D.dhProcess(sq, 0, 0.2, {})[3].v[0] === 100, 'Smooth Off still holds (draw-until-changed) but does not average');
// ---- bubbles ----
const b = D.bubblesOf([[0, 100, 3, 1], [500, 101, 1, -1], [1500, 102, 2, -1]], 1000);
ok(b.length === 2 && b[0].v === 4 && b[0].b === 3 && b[0].s === 1 && Math.abs(b[0].p - 100.25) < 1e-9, 'one bubble per interval, volume-weighted price, buy / sell split', b);
// ---- config ----
const c = D.dhConfig({});
ok(c.smooth === 30000 && c.gamma === 1 && !c.hf.on && c.bubbles && c.book && c.cum && c.volume, 'defaults: Smooth 30 s, auto contrast, no cutoff, everything on', c);
ok(D.dhConfig({ heatSmooth: 'Off' }).smooth === 0 && D.dhConfig({ heatSmooth: '2 min' }).smooth === 120000, 'Smooth options');
ok(D.dhConfig({ contrastMode: 'Manual', contrast: 2 }).gamma === 2 && D.dhConfig({ contrast: 2 }).gamma === 1, 'the manual slider only counts in Manual mode');
const k = D.dhConfig({ cutoffPct: 50 }); ok(k.hf.on && Math.abs(k.hf.p - rank(0.5)) < 1e-9, 'lower cutoff hides by rank (the colours of the rest do not change)', k.hf);
ok(D.DH_SCHEMA.every((x) => x.defval !== undefined) && D.DH_TITLE === 'Depth Heatmap (L2)', 'schema has defaults; title keeps (L2)');
console.log(n + ' passed');
