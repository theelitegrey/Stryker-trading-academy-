// Loads the app's OWN calculation code (so seeded numbers come from the same maths the pages use), from the repo checkout.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const repoRoot = ROOT;
const require = createRequire(import.meta.url);

// journal-calc.js is a classic script of global functions
export function journalCalc() {
  const ctx = {};
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'assets/journal-calc.js'), 'utf8') +
    ';this.journalComputeDerived=journalComputeDerived;this.journalAggregateStats=journalAggregateStats;this.journalDefaultSettings=journalDefaultSettings;', ctx);
  return ctx;
}
// UMD modules with module.exports
export const replayEngine = () => require(path.join(ROOT, 'assets/replay-engine.js'));
export const paperEngine = () => require(path.join(ROOT, 'assets/paper-engine.js'));
export const replayAnalytics = () => require(path.join(ROOT, 'assets/replay-analytics.js'));
export const paperStats = () => require(path.join(ROOT, 'assets/paper-review-stats.js'));
