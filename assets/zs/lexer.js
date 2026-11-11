// Zscript lexer: source text -> tokens, with NEWLINE / INDENT / DEDENT for blocks.
// Pure function, no globals. See SPEC.md section 2.
import { diag } from './errors.js?v=959';

export const KEYWORDS = new Set(['and', 'or', 'not', 'if', 'else', 'for', 'to', 'by', 'in', 'while', 'switch',
  'var', 'varip', 'true', 'false', 'na', 'break', 'continue', 'import', 'export', 'type', 'method']);
const OPS3 = [];
const OPS2 = [':=', '+=', '-=', '*=', '/=', '%=', '==', '!=', '<=', '>=', '=>'];
const OPS1 = '+-*/%<>=?:,.()[]';
// A line ending in one of these continues on the next line.
const CONT_END = new Set(['+', '-', '*', '/', '%', '<', '>', '<=', '>=', '==', '!=', '=', ':=', '+=', '-=', '*=', '/=', '%=',
  '?', ':', ',', 'and', 'or', 'not', '(', '[']);
// A line starting with one of these continues the previous line.
const CONT_START = new Set(['?', ':', 'and', 'or', '*', '/', '%', ')', ']', '==', '!=', '>', '<', '>=', '<=']);

export const MAX_SOURCE = 256 * 1024;
export const MAX_LINES = 20000;

export function lex(src) {
  const diags = [];
  const toks = [];
  let header = null;
  if (typeof src !== 'string') src = '';
  if (src.length > MAX_SOURCE) {
    diags.push(diag('E106', 1, 1));
    return { toks: [{ t: 'eof', v: '', l: 1, c: 1 }], diags, header };
  }
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  if (lines.length > MAX_LINES) {
    diags.push(diag('E106', 1, 1));
    return { toks: [{ t: 'eof', v: '', l: 1, c: 1 }], diags, header };
  }
  const indents = [0];
  let depth = 0;            // ( [ nesting
  let contNext = false;     // previous line asked for continuation
  let contOp = false;       // ...because it ended with an operator (not only an open bracket)
  let startWidth = 0;       // indent of the current logical line
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const ln = li + 1;
    // header: first non-blank line
    if (header === null && line.trim() !== '') {
      const m = /^\s*\/\/\s*@zscript\s+(\S+)\s*$/.exec(line);
      header = m ? { version: m[1], line: ln } : { version: null, line: ln };
    }
    // measure indent
    let i = 0, width = 0;
    while (i < line.length && (line[i] === ' ' || line[i] === '\t')) { width += line[i] === '\t' ? 4 : 1; i++; }
    if (i >= line.length || line.startsWith('//', i)) continue; // blank / comment-only line
    const lineToks = [];
    while (i < line.length) {
      const ch = line[i];
      const col = i + 1;
      if (ch === ' ' || ch === '\t') { i++; continue; }
      if (ch === '/' && line[i + 1] === '/') break;
      if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(line[i + 1] || ''))) {
        const m = /^(?:[0-9][0-9_]*)?(?:\.[0-9_]*)?(?:[eE][+-]?[0-9]+)?/.exec(line.slice(i));
        let text = m[0];
        if (!text) text = ch;
        const clean = text.replace(/_/g, '');
        const v = Number(clean);
        if (!Number.isFinite(v) || clean === '' || clean === '.') diags.push(diag('E104', ln, col, { text }));
        lineToks.push({ t: 'num', v: Number.isFinite(v) ? v : 0, int: !/[.eE]/.test(clean), l: ln, c: col, e: col + text.length });
        i += text.length;
        // 1.2.3 or 12abc
        if (/[A-Za-z_]/.test(line[i] || '')) {
          diags.push(diag('E104', ln, col, { text: text + line.slice(i).match(/^[A-Za-z_0-9]*/)[0] }));
          i += line.slice(i).match(/^[A-Za-z_0-9]*/)[0].length;
        }
        continue;
      }
      if (/[A-Za-z_]/.test(ch)) {
        const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(line.slice(i));
        const w = m[0];
        lineToks.push({ t: KEYWORDS.has(w) ? 'kw' : 'id', v: w, l: ln, c: col, e: col + w.length });
        i += w.length;
        continue;
      }
      if (ch === '"' || ch === "'") {
        let j = i + 1, s = '', closed = false;
        while (j < line.length) {
          const c2 = line[j];
          if (c2 === '\\' && j + 1 < line.length) {
            const n = line[j + 1];
            s += n === 'n' ? '\n' : n === 't' ? '\t' : n;
            j += 2; continue;
          }
          if (c2 === ch) { closed = true; j++; break; }
          s += c2; j++;
        }
        if (!closed) diags.push(diag('E102', ln, col));
        lineToks.push({ t: 'str', v: s, l: ln, c: col, e: j + 1 });
        i = j;
        continue;
      }
      if (ch === '#') {
        const m = /^#[0-9A-Za-z]*/.exec(line.slice(i));
        const text = m[0];
        if (!/^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(text)) diags.push(diag('E103', ln, col, { text }));
        const hex = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(text) ? text.toLowerCase() : '#000000';
        lineToks.push({ t: 'color', v: hex.length === 7 ? hex + 'ff' : hex, l: ln, c: col, e: col + text.length });
        i += Math.max(1, text.length);
        continue;
      }
      const two = line.substr(i, 2);
      if (OPS2.includes(two)) { lineToks.push({ t: 'op', v: two, l: ln, c: col, e: col + 2 }); i += 2; continue; }
      if (OPS1.includes(ch)) {
        lineToks.push({ t: 'op', v: ch, l: ln, c: col, e: col + 1 });
        if (ch === '(' || ch === '[') depth++;
        if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
        i++; continue;
      }
      diags.push(diag('E101', ln, col, { c: ch }));
      i++;
    }
    if (!lineToks.length) continue;
    const first = lineToks[0];
    // Inside an open bracket a continuation line must be indented deeper than the line that
    // opened it (or start with the closing bracket); otherwise the bracket was left open by
    // mistake: stop joining so one missing `)` does not swallow the rest of the file.
    let joined = toks.length && (contNext || CONT_START.has(first.v) && first.t !== 'str');
    if (joined && depth > 0 && !contOp && width <= startWidth && !CONT_START.has(first.v)) { joined = false; depth = 0; }
    if (!joined) {
      startWidth = width;
      // close the previous logical line, then handle indentation
      if (toks.length) toks.push({ t: 'nl', v: '', l: ln, c: 1 });
      const top = indents[indents.length - 1];
      if (width > top) { indents.push(width); toks.push({ t: 'indent', v: '', l: ln, c: 1 }); }
      else if (width < top) {
        while (indents.length > 1 && width < indents[indents.length - 1]) {
          indents.pop();
          toks.push({ t: 'dedent', v: '', l: ln, c: 1 });
        }
        if (width !== indents[indents.length - 1]) diags.push(diag('E105', ln, 1));
      }
    }
    for (const t of lineToks) toks.push(t);
    const last = lineToks[lineToks.length - 1];
    contOp = CONT_END.has(last.v) && last.t !== 'str' && last.v !== '(' && last.v !== '[';
    contNext = depth > 0 || contOp;
  }
  const endLine = lines.length;
  toks.push({ t: 'nl', v: '', l: endLine, c: 1 });
  while (indents.length > 1) { indents.pop(); toks.push({ t: 'dedent', v: '', l: endLine, c: 1 }); }
  toks.push({ t: 'eof', v: '', l: endLine, c: 1 });
  return { toks, diags, header };
}
