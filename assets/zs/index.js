// Zscript public API (SPEC.md section 11). Pure: no DOM, no network, no storage.
//   compile(source) -> { ok, diagnostics, program, meta }
//   run(program, opts) -> output            (synchronous; use runner.js for the sandboxed worker)
//   new Session(program, opts): .run(bars) .update(bar)
export { compile, LIMITS } from './compiler.js?v=895';
export { validateProgram, RUN_LIMITS, resolveInput } from './vm.js?v=895';
export { catalogJSON, FUNCTIONS, VARIABLES, CONSTANTS } from './catalog.js?v=895';
export { MESSAGES } from './errors.js?v=895';
import { Exec } from './vm.js?v=895';

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

export function run(program, opts) {
  const o = opts || {};
  return new Session(program, o).run(o.bars);
}
