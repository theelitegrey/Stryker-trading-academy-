// Zscript public API (SPEC.md section 11). Pure: no DOM, no network, no storage.
//   compile(source) -> { ok, diagnostics, program, meta }
//   run(program, opts) -> output            (synchronous; use runner.js for the sandboxed worker)
//   new Session(program, opts): .run(bars) .update(bar)
export { compile, LIMITS } from './compiler.js?v=951';
export { validateProgram, RUN_LIMITS, resolveInput } from './vm.js?v=951';
export { catalogJSON, FUNCTIONS, VARIABLES, CONSTANTS } from './catalog.js?v=951';
export { MESSAGES } from './errors.js?v=951';
import { Exec } from './vm.js?v=951';

export const VERSION = 1;

// Accepts a program object or its JSON text (as stored by the library).
export function decodeProgram(p) {
  const obj = typeof p === 'string' ? JSON.parse(p) : p;
  return new Exec(obj, {}).p;
}

export class Session {
  constructor(program, opts) { this.exec = new Exec(typeof program === 'string' ? JSON.parse(program) : program, opts || {}); }
  run(bars) { return this.exec.run(bars); }
  update(bar) { return this.exec.update(bar); }
}

// run(program, opts) or run({ program, bars, ... }) (both forms are used by the other streams)
export function run(program, opts) {
  if (opts === undefined && program && typeof program === 'object' && program.program && program.bars) { opts = program; program = opts.program; }
  const o = opts || {};
  return new Session(program, o).run(o.bars);
}
