# Zscript engine tests (assets/zs/)

Run from the repo root. All node suites are pure (no browser, no network).

| file | what | in check.py |
|---|---|---|
| zs-lang.test.mjs | lexer, parser + error recovery, checker, diagnostics, meta, catalog | yes |
| zs-ta.test.mjs | ta.* golden values vs the chart library's own indicator math (1e-9) + reference implementations | yes |
| zs-vm.test.mjs | series/var/varip/history/na, control flow, functions, str/math/color, arrays/maps, inputs, outputs, drawings, live updates, request.security, data namespaces | yes |
| zs-limits.test.mjs | infinite loops, op budget, wall clock, memory/array/map/string caps, drawing/output caps | yes |
| zs-security.test.mjs | no eval/Function/network in the engine, hostile names, tampered programs, prototype pollution, worker CSP in _headers | yes |
| zs-frames.test.mjs | data hub frames (S3 shape) -> engine data -> script values | yes |
| zs-fuzz.test.mjs | 10,500 random/mutated programs: no crash, no hang, well-formed diagnostics (`ZS_FUZZ_N=50000` for more) | no (manual, ~3 s) |
| zs-bench.test.mjs | 5,000 bars x 3 EMA + RSI < 150 ms | no (timing on a shared box) |
| zs-worker-browser.js | the real worker under its CSP in Chromium: escape attempts blocked, runner end to end, sealed (protected) run, data hub messages, loop stop, wall-clock kill | no (browser) |

    for f in lang ta vm limits security frames fuzz bench; do node tools/tests/zs-$f.test.mjs | tail -1; done
    NODE_PATH=/root/projects/stryker-trading-academy/node_modules tools/chrome-slot.sh node tools/tests/zs-worker-browser.js
