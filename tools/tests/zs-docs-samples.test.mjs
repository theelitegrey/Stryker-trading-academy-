// Every ```zscript / ```zs-snippet block in the manual, cookbook and course must compile with no errors
// and run on sample bars without a runtime error. Skips (exit 0, loud) until S1's engine exists.
import { samples, sampleBars, sampleData, loadEngine } from '../zs-book/lib.mjs';

const eng = await loadEngine();
const all = samples();
if (!eng) { console.log(`zs-docs-samples: engine not found yet; extracted ${all.length} samples, NOT run`); process.exit(process.env.ZS_REQUIRE ? 1 : 0); }
const { mod } = eng;
const compileOnly = !(eng.mod.runSync || eng.mod.run);
if (compileOnly) console.log('zs-docs-samples: engine has no run() yet, COMPILE ONLY (' + eng.path + ')');
const bars = sampleBars(), data = sampleData(bars);
let fail = 0, ran = 0;
for (const s of all) {
  const r = mod.compile(s.src);
  const errs = (r.diagnostics || []).filter((d) => d.severity === 'error');
  if (!r.ok || errs.length) { fail++; console.log(`FAIL compile ${s.id}: ` + errs.map((d) => `${d.line}:${d.col} ${d.code || ''} ${d.message}`).join(' | ')); continue; }
  if (compileOnly) { ran++; continue; }
  try {
    const run = mod.runSync || mod.run;
    const out = await run({ program: r.program, bars, symbol: { ticker: 'ES1!', tickerid: 'ES1!', type: 'futures', currency: 'USD', mintick: 0.25, pointvalue: 50 },
      timeframe: '5', inputs: {}, allowed: { book: true, flow: true, gex: true, opt: true }, data, securities: {} });
    if (out && out.ok === false) { fail++; console.log(`FAIL run ${s.id}: ` + JSON.stringify(out.error || out.diagnostics)); continue; }
    ran++;
  } catch (e) { fail++; console.log(`FAIL run ${s.id}: ${e.message}`); }
}
console.log(`zs-docs-samples: ${all.length} samples, ${ran} ran, ${fail} failed`);
process.exit(fail ? 1 : 0);
