// Highlight heavy activity (Footprint) + colour bubbles by the dominant side (Depth Heatmap / Liquidity Map).
//   node tools/tests/of-color.test.mjs
import assert from 'node:assert/strict';
const FD = await import('../../assets/chart-footprint-data.js');
const LM = await import('../../assets/chart-liquidity-map.js');
const DH = await import('../../assets/chart-depth-heatmap.js');
let n = 0;
const ok = (c, m, x) => { assert.ok(c, m + (x === undefined ? '' : ' ' + JSON.stringify(x))); n++; console.log('PASS ' + m); };
// heavy limit
ok(FD.heavyLimit([10, 10, 10, 10, 0], 'avg', 3, 0) === 30, 'avg mode: x times the average of the non-empty cells');
ok(FD.heavyLimit([], 'avg', 3, 0) === Infinity && FD.heavyLimit([0, 0], 'avg', 3, 0) === Infinity, 'nothing to compare: nothing is heavy');
ok(FD.heavyLimit([1, 2], 'fixed', 3, 250) === 250 && FD.heavyLimit([1], 'fixed', 3, 0) === Infinity, 'fixed mode uses the size');
// vivid
const sat = (h) => { const n = parseInt(h.slice(1), 16), r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx === mn ? 0 : (mx - mn) / (255 - Math.abs(mx + mn - 255)); };
ok(FD.vivid('#6aa89a', 1) !== '#6aa89a' && sat(FD.vivid('#6aa89a', 1)) > sat('#6aa89a'), 'vivid raises saturation');
ok(FD.vivid('#03c988', 0) === '#03c988' || sat(FD.vivid('#03c988', 0)) >= sat('#03c988') - 0.01, 'vivid(0) keeps the colour');
ok(FD.vivid('#808080', 1) === '#808080' && FD.vivid('nope', 1) === 'nope', 'grey and bad input untouched');
// bubbles
ok(LM.bubbleOpts({}) === null && LM.bubbleOpts({ bubbleDom: false }) === null, 'bubble colouring is off by default (split green / red as today)');
const o = LM.bubbleOpts({ bubbleDom: true, bubbleBuyColor: 'bad', bubbleSellColor: '#112233' });
ok(o.dom && o.buy === LM.BUBBLE_DEF.buy && o.sell === '#112233', 'bad colour falls back to the default', o);
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const dist = (a, b) => hex(a).reduce((s, v, i) => s + Math.abs(v - hex(b)[i]), 0);
ok(LM.domColor(0.9, '#00ff00', '#ff0000') !== LM.domColor(0.1, '#00ff00', '#ff0000'), 'buyers vs sellers dominant get different colours');
ok(LM.domColor(1, '#00ff00', '#ff0000') === '#00ff00' && LM.domColor(0, '#00ff00', '#ff0000') === '#ff0000', 'all buying = the buy colour, all selling = the sell colour');
ok(dist(LM.domColor(0.75, '#00ff00', '#ff0000'), '#00ff00') < dist(LM.domColor(0.55, '#00ff00', '#ff0000'), '#00ff00'), 'more one-sided = stronger colour');
ok(LM.bubbleSchema().every((x) => x.defval !== undefined) && LM.LM_SCHEMA.some((x) => x.key === 'bubbleDom') && DH.DH_SCHEMA.some((x) => x.key === 'bubbleDom'), 'setting is in both bubble layers');
ok(DH.dhConfig({}).bubDom === null && LM.lmConfig({}).bubDom === null && DH.dhConfig({ bubbleDom: true }).bubDom.dom, 'configs carry it, off by default');
console.log(n + ' passed');
