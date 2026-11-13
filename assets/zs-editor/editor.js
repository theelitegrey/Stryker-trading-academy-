// TradeZoro — Zscript code editor (ES module). Lazy-loaded by assets/chart-zscript.js when the Zscript tab opens.
// Depends on: assets/zs-editor/cm6.js (vendored CodeMirror 6, MIT; rebuild with tools/zs-editor/build-cm6.sh).
//
// createZsEditor(parent, { doc, builtins, onChange, onRun, lint }) -> { view, get(), set(text), focus(), showDiagnostics(list), goto(line, col) }
//   builtins  [{ name, kind, sig, doc }]  autocomplete + hover docs (from the engine catalog, assets/zs/catalog.js)
//   lint(src) -> Promise<[Diag]>          inline errors while typing (Diag = { line, col, endLine?, endCol?, severity, message, hint? }, 1-based)
// Colours come from CSS variables (--zs-*) set in assets/style.css for dark and light, so the theme switch needs no rebuild.

import {
  EditorState, EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, hoverTooltip,
  StreamLanguage, syntaxHighlighting, HighlightStyle, indentOnInput, bracketMatching, indentUnit,
  defaultKeymap, history, historyKeymap, indentWithTab, autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap,
  linter, lintGutter, setDiagnostics, searchKeymap, highlightSelectionMatches, tags
} from './cm6.js?v=970';

const KEYWORDS = new Set(['if', 'else', 'for', 'in', 'to', 'by', 'while', 'switch', 'break', 'continue', 'var', 'varip', 'and', 'or', 'not', 'import', 'export', 'method', 'type']);
const ATOMS = new Set(['true', 'false', 'na']);
const TYPES = new Set(['int', 'float', 'bool', 'string', 'color', 'series', 'simple', 'const', 'array', 'map', 'label', 'line', 'box', 'table']);
const NAMESPACES = new Set(['ta', 'math', 'str', 'color', 'input', 'request', 'array', 'map', 'label', 'line', 'box', 'table', 'plot', 'hline', 'shape', 'location', 'size', 'position', 'xloc', 'yloc', 'extend', 'book', 'flow', 'gex', 'opt', 'syminfo', 'timeframe', 'barstate']);

// Tokenizer for highlighting only (the engine owns real parsing).
export const zscriptLanguage = StreamLanguage.define({
  name: 'zscript',
  startState: () => ({}),
  token(stream){
    if (stream.eatSpace()) return null;
    if (stream.match(/^\/\/@zscript\b.*/)) return 'meta';
    if (stream.match('//')) { stream.skipToEnd(); return 'comment'; }
    const ch = stream.peek();
    if (ch === '"' || ch === "'") {
      stream.next();
      let esc = false, c;
      while ((c = stream.next()) != null) { if (c === ch && !esc) break; esc = !esc && c === '\\'; }
      return 'string';
    }
    if (stream.match(/^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?\b/)) return 'color';
    if (stream.match(/^(?:\d+\.?\d*(?:[eE][-+]?\d+)?|\.\d+)/)) return 'number';
    if (stream.match(/^[A-Za-z_]\w*/)) {
      const w = stream.current();
      if (KEYWORDS.has(w)) return 'keyword';
      if (ATOMS.has(w)) return 'atom';
      if (stream.peek() === '.' && NAMESPACES.has(w)) return 'namespace';
      if (TYPES.has(w) && !/^\s*[=(]/.test(stream.string.slice(stream.pos))) return 'typeName';
      if (/^\s*\(/.test(stream.string.slice(stream.pos))) return 'function';
      return 'variableName';
    }
    if (stream.match(/^(?::=|\+=|-=|\*=|\/=|=>|==|!=|<=|>=|[-+*/%<>=?:])/)) return 'operator';
    stream.next();
    return null;
  },
  languageData: { commentTokens: { line: '//' }, indentOnInput: /^\s*(else)$/ },
  tokenTable: { meta: tags.meta, color: tags.color, namespace: tags.namespace, function: tags.function(tags.variableName), typeName: tags.typeName }
});

const highlight = HighlightStyle.define([
  { tag: tags.comment, color: 'var(--zs-comment)', fontStyle: 'italic' },
  { tag: tags.meta, color: 'var(--zs-comment)', fontWeight: '600' },
  { tag: tags.string, color: 'var(--zs-string)' },
  { tag: [tags.number, tags.color], color: 'var(--zs-number)' },
  { tag: [tags.keyword, tags.operatorKeyword], color: 'var(--zs-keyword)', fontWeight: '600' },
  { tag: tags.atom, color: 'var(--zs-number)' },
  { tag: tags.typeName, color: 'var(--zs-type)' },
  { tag: tags.namespace, color: 'var(--zs-ns)' },
  { tag: tags.function(tags.variableName), color: 'var(--zs-fn)' },
  { tag: tags.operator, color: 'var(--zs-op)' }
]);

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '12.5px', backgroundColor: 'transparent', color: 'var(--ink-0)' },
  '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', lineHeight: '20px', overflow: 'auto' },
  '.cm-content': { padding: '8px 0', caretColor: 'var(--gold)' },
  '.cm-gutters': { backgroundColor: 'var(--bg-1)', color: 'var(--ink-3)', borderRight: '1px solid var(--line-soft)' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 6px', minWidth: '28px' },
  '.cm-activeLine': { backgroundColor: 'var(--zs-active)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--zs-active)', color: 'var(--ink-1)' },
  '&.cm-focused': { outline: 'none' },
  '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--gold)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': { backgroundColor: 'var(--zs-sel) !important' },
  '.cm-matchingBracket': { backgroundColor: 'var(--zs-sel)', outline: '1px solid var(--line)' },
  '.cm-tooltip': { backgroundColor: 'var(--bg-2)', color: 'var(--ink-1)', border: '1px solid var(--line)', borderRadius: '8px', overflow: 'hidden', boxShadow: '0 8px 24px rgba(0,0,0,.28)' },
  '.cm-tooltip-autocomplete > ul': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: '12.5px', maxHeight: '240px' },
  '.cm-tooltip-autocomplete > ul > li': { padding: '4px 10px !important', lineHeight: '20px' },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': { backgroundColor: 'var(--zs-sel)', color: 'var(--ink-0)' },
  '.cm-completionDetail': { color: 'var(--ink-3)', fontStyle: 'normal', marginLeft: '8px' },
  '.cm-completionInfo': { padding: '8px 10px', maxWidth: '320px', fontSize: '12px', lineHeight: '16px' },
  '.cm-completionIcon': { display: 'none' },
  '.zs-hover': { padding: '8px 10px', maxWidth: '340px', fontSize: '12px', lineHeight: '16px' },
  '.zs-hover-sig': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', color: 'var(--ink-0)', marginBottom: '4px', whiteSpace: 'pre-wrap' },
  '.zs-hover-doc': { color: 'var(--ink-2)' },
  '.cm-diagnostic': { padding: '6px 10px', fontSize: '12px', lineHeight: '16px' },
  '.cm-diagnostic-error': { borderLeft: '3px solid var(--zs-err)' },
  '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy var(--zs-err)', textUnderlineOffset: '3px' },
  '.cm-lint-marker-error': { content: 'none' },
  '.cm-panels': { backgroundColor: 'var(--bg-1)', color: 'var(--ink-1)' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--line-soft)' },
  '.cm-textfield': { backgroundColor: 'var(--bg-0)', color: 'var(--ink-0)', border: '1px solid var(--line)', borderRadius: '6px' },
  '.cm-button': { backgroundImage: 'none', backgroundColor: 'var(--bg-2)', color: 'var(--ink-1)', border: '1px solid var(--line)', borderRadius: '6px' }
});

// Word under/before the cursor including dots (ta.sma).
function wordAt(state, pos){
  const line = state.doc.lineAt(pos);
  const t = line.text;
  let s = pos - line.from, e = s;
  while (s > 0 && /[\w.]/.test(t[s - 1])) s--;
  while (e < t.length && /[\w]/.test(t[e])) e++;
  return { from: line.from + s, to: line.from + e, text: t.slice(s, e) };
}

// Diag (1-based line/col) -> CodeMirror diagnostic.
function toCm(doc, d){
  const ln = doc.line(Math.min(Math.max(1, d.line | 0 || 1), doc.lines));
  const from = Math.min(ln.to, ln.from + Math.max(0, (d.col | 0 || 1) - 1));
  let to;
  if (d.endLine) { const l2 = doc.line(Math.min(Math.max(1, d.endLine), doc.lines)); to = Math.min(l2.to, l2.from + Math.max(0, (d.endCol || 1) - 1)); }
  else { const m = /^[\w.]+/.exec(doc.sliceString(from, ln.to)); to = from + (m ? m[0].length : 1); }
  if (to <= from) to = Math.min(ln.to, from + 1);
  // an empty line (e.g. a missing ")" reported at the end of the file): mark the last character before it, so the underline shows
  if (to <= from) {
    let p = ln; while (p.number > 1 && p.length === 0) p = doc.line(p.number - 1);
    const f = Math.max(p.from, p.to - 1);
    return { from: f, to: Math.max(f, p.to), severity: d.severity === 'warning' ? 'warning' : 'error', message: msg(d) };
  }
  return { from, to, severity: d.severity === 'warning' ? 'warning' : 'error', message: msg(d) };
}
const msg = (d) => 'Line ' + d.line + ':' + (d.col || 1) + ' ' + d.message + (d.hint ? ' ' + d.hint : '');

export function createZsEditor(parent, opts){
  const B = opts.builtins || [];
  const byName = new Map(B.map((b) => [b.name, b]));
  const typeOf = (k) => (k === 'function' ? 'function' : k === 'keyword' ? 'keyword' : k === 'namespace' ? 'namespace' : k === 'type' ? 'type' : k === 'constant' ? 'constant' : 'variable');

  function complete(ctx){
    const w = wordAt(ctx.state, ctx.pos);
    if (!w.text && !ctx.explicit) return null;
    const line = ctx.state.doc.lineAt(ctx.pos);
    const before = line.text.slice(0, ctx.pos - line.from);
    if (/\/\//.test(before.replace(/(["'])(?:\\.|(?!\1).)*\1/g, ''))) return null;   // inside a comment
    if ((before.match(/["']/g) || []).length % 2) return null;                          // inside a string
    const prefix = w.text.slice(0, ctx.pos - w.from);
    const dot = prefix.lastIndexOf('.');
    const options = [];
    B.forEach((b) => {
      if (!b.name.startsWith(prefix)) return;
      if (dot < 0 && b.name.indexOf('.') >= 0) return;                      // top level: namespaces, not every member
      if (dot >= 0 && b.name.indexOf('.', dot + 1) >= 0) return;
      options.push({ label: b.name, type: typeOf(b.kind), detail: b.kind === 'function' ? (b.sig || '').replace(/^[\w.]+/, '') : '', info: b.doc || '',
        apply: b.kind === 'function' && !/\(\)$/.test(b.name) ? b.name + '(' : b.name, boost: b.kind === 'namespace' ? 1 : 0 });
    });
    if (dot < 0) {   // the script's own variables
      const seen = new Set(options.map((o) => o.label));
      const re = /^\s*(?:var\s+|varip\s+)?(?:(?:int|float|bool|string|color)\s+)?([A-Za-z_]\w*)\s*(?:=|\()/gm;
      let m; const txt = ctx.state.doc.toString();
      while ((m = re.exec(txt))) if (m[1].startsWith(prefix) && !seen.has(m[1]) && !KEYWORDS.has(m[1]) && m[1] !== prefix) { seen.add(m[1]); options.push({ label: m[1], type: 'variable', boost: 2 }); }
    }
    if (!options.length) return null;
    return { from: w.from, options, validFor: /^[\w.]*$/ };
  }

  const hover = hoverTooltip((view, pos) => {
    const w = wordAt(view.state, pos);
    // hovering "ta" in ta.sma shows the namespace, hovering "sma" the function
    const upto = w.text.split('.').slice(0, view.state.doc.sliceString(w.from, pos).split('.').length).join('.');
    const name = byName.has(upto) ? upto : w.text;
    const b = byName.get(name);
    if (!b) return null;
    return { pos: w.from, end: w.to, above: true, create(){
      const dom = document.createElement('div'); dom.className = 'zs-hover';
      const s = document.createElement('div'); s.className = 'zs-hover-sig'; s.textContent = b.sig || b.name;
      const d = document.createElement('div'); d.className = 'zs-hover-doc'; d.textContent = b.doc || '';
      dom.appendChild(s); if (b.doc) dom.appendChild(d);
      return { dom };
    } };
  }, { hoverTime: 350 });

  const lintExt = opts.lint ? linter(async (view) => {
    const src = view.state.doc.toString();
    let list = [];
    try { list = (await opts.lint(src)) || []; } catch (e) { return []; }
    if (view.state.doc.toString() !== src) return [];
    return list.map((d) => toCm(view.state.doc, d));
  }, { delay: 500 }) : [];

  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: opts.doc || '',
      extensions: [
        lineNumbers(), highlightActiveLineGutter(), history(), drawSelection(), indentOnInput(), bracketMatching(), closeBrackets(),
        highlightActiveLine(), highlightSelectionMatches(), indentUnit.of('    '), EditorState.tabSize.of(4),
        zscriptLanguage, syntaxHighlighting(highlight), theme,
        autocompletion({ override: [complete], icons: false, activateOnTyping: true }),
        hover, lintExt, lintGutter(),
        keymap.of([
          { key: 'Mod-Enter', run: () => { if (opts.onRun) opts.onRun(); return true; } },
          ...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...completionKeymap, indentWithTab
        ]),
        EditorView.contentAttributes.of({ 'aria-label': 'Zscript source', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false' }),
        EditorView.updateListener.of((u) => { if (u.docChanged && opts.onChange) opts.onChange(); }),
        // keep the chart's keyboard shortcuts out of the editor
        EditorView.domEventHandlers({ keydown: (e) => { e.stopPropagation(); return false; } })
      ]
    })
  });

  return {
    view,
    get: () => view.state.doc.toString(),
    set(text){ view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text || '' }, selection: { anchor: 0 }, scrollIntoView: true }); view.dispatch(setDiagnostics(view.state, [])); },
    focus: () => view.focus(),
    showDiagnostics(list){ view.dispatch(setDiagnostics(view.state, (list || []).map((d) => toCm(view.state.doc, d)))); },
    goto(line, col){
      const ln = view.state.doc.line(Math.min(Math.max(1, line || 1), view.state.doc.lines));
      const at = Math.min(ln.to, ln.from + Math.max(0, (col || 1) - 1));
      view.dispatch({ selection: { anchor: at }, effects: EditorView.scrollIntoView(at, { y: 'center' }) });
    }
  };
}
