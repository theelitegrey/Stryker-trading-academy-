#!/usr/bin/env python3
"""Drawing settings window in the TradingView layout, on Vela 0.9.0-s1 (admin trial).

Run AFTER tools/vela-090-patch.py, on the same folder:
  python3 tools/vela-090-dsp-patch.py assets/vendor/vela-0.9.0-s4
Every edit asserts its anchor text occurs exactly once.

Owner target (2026-10-22): TradingView's Rectangle settings window for every drawing tool.
- Title = tool name (or the name the user gave it) + pencil to rename, close X.
- Tabs Style | Text | Coordinates | Visibility.
- Box: Extend, Border, Middle line, Background with on/off.
- Text: colour, font size in px (box default 12), Bold, Italic, multi-line text, alignment
  vertical + horizontal; box text is drawn inside the box at that alignment.
- Footer: Template menu (0.9.0's saved styles) + Cancel + Ok.
"""
import sys, os

D = sys.argv[1]
n_edits = 0


def edit(fname, old, new, count=1):
    global n_edits
    p = os.path.join(D, fname)
    s = open(p, encoding='utf-8').read()
    n = s.count(old)
    if n != count:
        sys.exit(f'{fname}: anchor found {n}x (want {count}): {old[:90]!r}')
    open(p, 'w', encoding='utf-8').write(s.replace(old, new))
    n_edits += 1


C = 'chunk-XIRSR3D6.js'
Y = 'chunk-YRCL3WMD.js'

# ---- font sizes in px ("12") besides the named sizes ----
edit(C, '''    case "normal":
      return 14;
    default:
      return 0;
  }
}
function autoFontSize(''', '''    case "normal":
      return 14;
    default: {
      // TradeZoro patch (dsp): a size in px ("12"), as TradingView's font-size list.
      const px = Number(size);
      return px > 0 ? px : 0;
    }
  }
}
function autoFontSize(''')
edit(Y, 'const fs = SIZE_PX[this.text?.size ?? "normal"] ?? 14;', 'const fs = SIZE_PX[this.text?.size ?? "normal"] ?? (Number(this.text?.size) || 14);')
# A new box starts with 12 px text, like TradingView.
edit(Y, '''    super(...arguments);
    this.type = "box";
  }''', '''    super(...arguments);
    this.type = "box";
    if (!this.text) this.text = { ...defaultText(), size: "12" };
  }''')

# ---- box: extend left/right, middle line ----
edit(C, '''        const x = Math.min(pts[0][0], pts[1][0]);
        const y = Math.min(pts[0][1], pts[1][1]);
        const w = Math.abs(pts[1][0] - pts[0][0]);
        const h = Math.abs(pts[1][1] - pts[0][1]);
        if (d.style.fillColor) {
          ctx.save();
          ctx.fillStyle = d.style.fillColor;
          ctx.fillRect(x, y, w, h);
          ctx.restore();
        }
        this.applyStroke(ctx, d.style);
        ctx.strokeRect(x, y, w, h);
        ctx.setLineDash([]);
        break;''', '''        // TradeZoro patch (dsp): Extend left/right and a Middle line, like TradingView.
        let x = Math.min(pts[0][0], pts[1][0]);
        const y = Math.min(pts[0][1], pts[1][1]);
        let w = Math.abs(pts[1][0] - pts[0][0]);
        const h = Math.abs(pts[1][1] - pts[0][1]);
        if (d.style.extendLeft) { w += x; x = 0; }
        if (d.style.extendRight) w = Math.max(w, proj.width - x);
        if (d.style.fillColor) {
          ctx.save();
          ctx.fillStyle = d.style.fillColor;
          ctx.fillRect(x, y, w, h);
          ctx.restore();
        }
        this.applyStroke(ctx, d.style);
        ctx.strokeRect(x, y, w, h);
        ctx.setLineDash([]);
        if (d.style.midLine) {
          this.applyStroke(ctx, { ...d.style, lineColor: d.style.midColor || d.style.lineColor, lineStyle: d.style.midStyle || "dotted", lineWidth: 1 });
          ctx.beginPath();
          ctx.moveTo(x, Math.round(y + h / 2) + 0.5);
          ctx.lineTo(x + w, Math.round(y + h / 2) + 0.5);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        break;''')

# ---- text alignment: box inside, horizontal line, line tools ----
edit(C, '''    case "box": {
      if (pts.length < 2) return null;
      return { x: (pts[0][0] + pts[1][0]) / 2, top: (pts[0][1] + pts[1][1]) / 2 - lh * lines / 2, align: "center" };
    }''', '''    case "box": {
      // TradeZoro patch (dsp): text inside the box at its alignment (TradingView), default middle/center.
      if (pts.length < 2) return null;
      const pad = 6;
      let l = Math.min(pts[0][0], pts[1][0]), r = Math.max(pts[0][0], pts[1][0]);
      if (d.style?.extendLeft) l = 0;
      if (d.style?.extendRight && proj.width) r = Math.max(r, proj.width);
      const t = Math.min(pts[0][1], pts[1][1]), bt = Math.max(pts[0][1], pts[1][1]);
      const v = text.stkV || "middle", hz = text.stkH || "center";
      const top = v === "top" ? t + pad : v === "bottom" ? bt - pad - lh * lines : (t + bt) / 2 - lh * lines / 2;
      return hz === "left" ? { x: l + pad, top, align: "left" } : hz === "right" ? { x: r - pad, top, align: "right" } : { x: (l + r) / 2, top, align: "center" };
    }''')
edit(C, '''    case "hline":
      return pts[0] ? { x: pts[0][0] + 8, top: pts[0][1] - 4 - lh * lines, align: "left" } : null;''', '''    case "hline": {
      // TradeZoro patch (dsp): vertical + horizontal text alignment.
      if (!pts[0]) return null;
      const v = text.stkV || "top", hz = text.stkH || "left";
      const W = proj.width ?? pts[0][0] * 2;
      const top = v === "bottom" ? pts[0][1] + 4 : v === "middle" ? pts[0][1] - lh * lines / 2 : pts[0][1] - 4 - lh * lines;
      return hz === "right" ? { x: W - 8, top, align: "right" } : hz === "center" ? { x: W / 2, top, align: "center" } : { x: pts[0][0] + 8, top, align: "left" };
    }''')
edit(C, '''      const below = text.side === "below";
      return {
        x: 0,
        top: below ? 6 : -6 - lh * lines,''', '''      const below = text.side === "below";
      return {
        x: 0,
        top: text.side === "middle" ? -lh * lines / 2 : below ? 6 : -6 - lh * lines,''')

# ---- the window ----
edit(C, 'var STYLE_REV = "1";', 'var STYLE_REV = "stk1";')
edit(C, '''  s.textContent = `
.vela-dsp-pass { pointer-events: none !important; }''', '''  s.textContent = STK_DSP_CSS + `
.vela-dsp-pass { pointer-events: none !important; }''')
edit(C, 'function ensureStyles4() {', r'''// TradeZoro patch (dsp): TradingView's drawing settings window (tabs, text styling, template).
var STK_DSP_CSS = `
.vela-dialog.vela-dsp { width: 380px; }
.vela-dsp .vela-dialog-title { font-size: 18px; font-weight: 600; flex: 0 1 auto; }
.vela-dsp .stk-dsp-pen { margin-right: auto; }
.stk-dsp-pen { all: unset; cursor: pointer; display: flex; padding: 4px; border-radius: 4px; color: var(--vela-fg-muted); flex: none; }
.stk-dsp-pen:hover { color: var(--vela-fg-bright); background: var(--vela-hover); }
.stk-dsp-name { font: inherit; font-size: 16px; font-weight: 600; width: 200px; background: transparent; color: var(--vela-fg-bright); border: 1px solid var(--vela-border-strong); border-radius: 4px; padding: 2px 6px; }
.stk-dsp-tabs { display: flex; gap: 20px; padding: 0 16px; position: relative; flex: none; border-bottom: 3px solid var(--vela-border); margin: 0 0 4px; }
.stk-dsp-tabs > button { all: unset; cursor: pointer; padding: 6px 0 7px; font-size: 14px; font-weight: 600; color: var(--vela-fg-muted); position: relative; margin-bottom: -3px; border-bottom: 3px solid transparent; }
.stk-dsp-tabs > button:hover { color: var(--vela-fg-bright); }
.stk-dsp-tabs > button[aria-selected='true'] { color: var(--vela-fg-bright); border-bottom-color: var(--vela-fg-bright); }
.stk-dsp-tabs > button:focus-visible { outline: 2px solid var(--vela-selected-bg); outline-offset: 2px; }
.stk-dsp-pane[hidden] { display: none; }
.stk-dsp-pane .vela-dsp-block + .vela-dsp-block { border-top: 0; padding-top: 0; }
.stk-dsp-pane .vela-dsp-fold { border-top: 0; }
.stk-dsp-pane .vela-dsp-fold-h { display: none; }
.stk-dsp-pane .vela-dsp-fold-b { padding: 12px 16px; }
.stk-dsp-cb { display: flex; align-items: center; gap: 8px; cursor: pointer; flex: 0 0 96px; color: var(--vela-fg-muted); white-space: nowrap; user-select: none; }
.stk-dsp-cb input { appearance: none; margin: 0; width: 18px; height: 18px; border: 1px solid var(--vela-fg-muted); border-radius: 4px; display: grid; place-items: center; cursor: pointer; flex: none; }
.stk-dsp-cb input:checked { background: var(--vela-fg-bright); border-color: var(--vela-fg-bright); }
.stk-dsp-cb input:checked::after { content: ""; width: 5px; height: 9px; border: solid var(--vela-bg, #000); border-width: 0 2px 2px 0; transform: translateY(-1px) rotate(45deg); }
.stk-dsp-cb input:focus-visible { outline: 2px solid var(--vela-selected-bg); outline-offset: 1px; }
.stk-dsp-vis { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px 8px; }
.stk-dsp-vis .stk-dsp-cb { flex: none; color: var(--vela-fg); }
.stk-dsp-sel { font: inherit; font-size: 13px; height: 32px; padding: 0 8px; border-radius: 6px; border: 1px solid var(--vela-border-strong); background: transparent; color: var(--vela-fg-bright); cursor: pointer; min-width: 0; }
.stk-dsp-sel option { background: var(--vela-bg, #1e1e1e); color: var(--vela-fg-bright); }
.stk-dsp-sel:focus-visible { outline: 2px solid var(--vela-selected-bg); outline-offset: 1px; }
.stk-dsp-tl { display: flex; align-items: center; gap: 8px; }
.stk-dsp-text textarea { min-height: 96px; font: inherit; font-size: 13px; }
.stk-dsp-empty { color: var(--vela-fg-muted); padding: 16px; font-size: 13px; }
.vela-dsp .vela-dialog-footer { justify-content: flex-end; }
.vela-dsp .vela-dialog-footer .vela-dsp-style { margin-right: auto; }
.vela-dsp-scroll { scrollbar-width: thin; scrollbar-color: rgba(128,128,128,.35) transparent; }
.vela-dsp-scroll::-webkit-scrollbar { width: 6px; }
.vela-dsp-scroll::-webkit-scrollbar-thumb { background: rgba(128,128,128,.35); border-radius: 3px; }
.vela-dsp-scroll::-webkit-scrollbar-thumb:hover { background: rgba(128,128,128,.6); }
.vela-dsp-scroll::-webkit-scrollbar-track, .vela-dsp-scroll::-webkit-scrollbar-button { background: transparent; display: none; }
`;
var STK_PEN = '<svg viewBox="0 0 18 18" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M3 15l.8-3.2L12.6 3a1.4 1.4 0 0 1 2 0l.4.4a1.4 1.4 0 0 1 0 2L6.2 14.2z"/><path d="M11 4.6l2.4 2.4"/></svg>';
var STK_FONT_PX = [10, 11, 12, 14, 16, 20, 24, 28, 32, 40];
var STK_TAB_MEMO = /* @__PURE__ */ new Map();
var STK_NAME_KEY = "stk-drawing-names";
function stkDrawingName(id) {
  try { return JSON.parse(localStorage.getItem(STK_NAME_KEY) || "{}")[id] || ""; } catch (e) { return ""; }
}
function stkSetDrawingName(id, name) {
  try {
    const all = JSON.parse(localStorage.getItem(STK_NAME_KEY) || "{}");
    if (name) all[id] = name; else delete all[id];
    localStorage.setItem(STK_NAME_KEY, JSON.stringify(all));
  } catch (e) {}
}
function stkSelect(options, read, pick, title) {
  const el = document.createElement("select");
  el.className = "stk-dsp-sel";
  if (title) el.title = title;
  for (const o of options) {
    const op = document.createElement("option");
    op.value = String(o.value);
    op.textContent = o.label;
    el.appendChild(op);
  }
  el.addEventListener("change", () => pick(el.value));
  el.addEventListener("keydown", (e) => { if (e.key !== "Escape") e.stopPropagation(); });
  return { el, sync: () => { el.value = String(read()); } };
}
function stkCheck(label, read, set) {
  const lab = document.createElement("label");
  lab.className = "stk-dsp-cb";
  const inp = document.createElement("input");
  inp.type = "checkbox";
  inp.addEventListener("change", () => set(inp.checked));
  lab.append(inp, document.createTextNode(label));
  return { el: lab, sync: () => { inp.checked = !!read(); } };
}
function ensureStyles4() {''')

# window build: tabs, pencil, template in the footer
edit(C, '        scroll.replaceChildren(...this.sections(build));', '        scroll.replaceChildren(...this.stkTabs(build));')
edit(C, '      title: meta?.label ?? this.t(TEXT9.settings),', '      title: stkDrawingName(first.id) || (meta?.label ?? this.t(TEXT9.settings)),')
edit(C, '    ui.titleEl.after(styleBtn.el);', '''    // TradeZoro patch (dsp): pencil to rename (kept per drawing in this browser), Template in the footer.
    const pen = document.createElement("button");
    pen.type = "button";
    pen.className = "stk-dsp-pen";
    pen.title = "Rename";
    pen.setAttribute("aria-label", "Rename");
    pen.innerHTML = STK_PEN;
    pen.addEventListener("pointerdown", (e) => e.stopPropagation());
    pen.addEventListener("click", (e) => {
      e.stopPropagation();
      const inp = document.createElement("input");
      inp.className = "stk-dsp-name";
      inp.value = ui.titleEl.textContent;
      inp.maxLength = 60;
      inp.addEventListener("pointerdown", (e) => e.stopPropagation());
      let finished = false;
      const done = (save) => {
        if (finished) return;
        finished = true;
        if (save) {
          const v = inp.value.trim();
          stkSetDrawingName(first.id, v && v !== (meta?.label ?? "") ? v : "");
          ui.titleEl.textContent = v || (meta?.label ?? this.t(TEXT9.settings));
        }
        inp.replaceWith(ui.titleEl);
        pen.hidden = false;
      };
      inp.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter") { e.preventDefault(); done(true); }
        else if (e.key === "Escape") { e.preventDefault(); done(false); }
      });
      inp.addEventListener("blur", () => { if (inp.isConnected) done(true); });
      ui.titleEl.replaceWith(inp);
      pen.hidden = true;
      inp.focus();
      inp.select();
    });
    ui.titleEl.after(pen);
    const stkFoot = ui.panel.querySelector(".vela-dialog-footer");
    if (stkFoot) stkFoot.prepend(styleBtn.el);
    else pen.after(styleBtn.el);''')
edit(C, '      label.textContent = match ? this.templateName(match) : this.t(TEXT9.style);', '      label.textContent = "Template";')

edit(C, '''  // ── sections ──
  sections(b) {''', '''  // ── TradeZoro patch (dsp): TradingView tabs ──
  stkTabs(b) {
    const d = b.live();
    const type = d.type;
    const schema = d.schema();
    const fields = schema.fields;
    const has = (path) => fields.some((f) => f.path === path);
    const style = [];
    if (type === "box") style.push(this.stkBoxStyle(b));
    else {
      const sb = this.styleBlock(b, fields, has);
      if (sb) style.push(sb);
    }
    if (d.editableLevels()) style.push(this.levelsBlock(b));
    if (d instanceof PositionTool) style.push(this.richBlock(this.t(TEXT9.position), (grid) => buildPositionSection(grid, d, b.actions, this.theme, (m, v) => this.t(m, v))));
    if (d instanceof FixedRangeVolumeProfile) style.push(this.richBlock(this.t(TEXT9.profile), (grid) => buildProfileSection(grid, d, b.actions, this.theme, (m, v) => this.t(m, v))));
    const own = this.optionsBlock(b, fields, d);
    if (own) style.push(own);
    const tabs = [];
    if (style.length) tabs.push(["style", "Style", style]);
    if (has("text.value")) tabs.push(["text", "Text", [this.stkTextPane(b, has)]]);
    else if (fields.some((f) => f.path.startsWith("text.")) && !style.length) tabs.push(["text", "Text", [block(null, row(this.t(TEXT9.text), ...this.textStyling(b, has)))]]);
    let open = openFolds.get(type);
    if (!open) openFolds.set(type, open = /* @__PURE__ */ new Set());
    open.add("points");
    open.add("show");
    const pts = this.pointsFold(b);
    tabs.push(["coords", "Coordinates", pts ? [pts] : [this.stkEmpty("This drawing has no editable points.")]]);
    tabs.push(["vis", "Visibility", [this.stkVisibility(b)]]);
    const bar = document.createElement("div");
    bar.className = "stk-dsp-tabs";
    bar.setAttribute("role", "tablist");
    const panes = [];
    const want = STK_TAB_MEMO.get(type);
    let current = tabs.some((t) => t[0] === want) ? want : tabs[0][0];
    const show = (key) => {
      current = key;
      STK_TAB_MEMO.set(type, key);
      for (const [k, btn, pane] of panes) {
        btn.setAttribute("aria-selected", String(k === key));
        btn.tabIndex = k === key ? 0 : -1;
        pane.hidden = k !== key;
      }
    };
    for (const [key, label, content] of tabs) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("role", "tab");
      btn.dataset.tab = key;
      btn.textContent = label;
      btn.addEventListener("click", () => show(key));
      bar.appendChild(btn);
      const pane = document.createElement("div");
      pane.className = "stk-dsp-pane";
      pane.dataset.pane = key;
      pane.setAttribute("role", "tabpanel");
      pane.append(...content);
      panes.push([key, btn, pane]);
    }
    bar.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      const i = panes.findIndex((p) => p[0] === current);
      const n = panes[(i + (e.key === "ArrowRight" ? 1 : panes.length - 1)) % panes.length];
      show(n[0]);
      n[1].focus();
    });
    show(current);
    return [bar, ...panes.map((p) => p[2])];
  }
  stkEmpty(text) {
    const el = document.createElement("div");
    el.className = "stk-dsp-empty";
    el.textContent = text;
    return el;
  }
  /** Rectangle Style tab: Extend, Border, Middle line, Background (TradingView). */
  stkBoxStyle(b) {
    const st = () => b.live().style;
    const rows = [];
    const ext = stkSelect([
      { value: "none", label: this.t(TEXT9.dontExtend) },
      { value: "left", label: this.t(TEXT9.extendLeft) },
      { value: "right", label: this.t(TEXT9.extendRight) },
      { value: "both", label: this.t(TEXT9.extendBothWays) }
    ], () => st().extendLeft && st().extendRight ? "both" : st().extendLeft ? "left" : st().extendRight ? "right" : "none", (v) => b.edit({ "style.extendLeft": v === "left" || v === "both", "style.extendRight": v === "right" || v === "both" }), this.t(TEXT9.extend));
    ext.el.style.flex = "1";
    b.watch(ext.sync);
    rows.push(row(this.t(TEXT9.extend), ext.el));
    const stkW = () => {
      const w = stkSelect([1, 2, 3, 4].map((n) => ({ value: n, label: `${n}px` })), () => st().lineWidth ?? 1, (v) => b.edit({ "style.lineWidth": Number(v) }), this.t(TEXT9.lineWidth));
      w.el.style.width = "68px";
      b.watch(w.sync);
      return w.el;
    };
    rows.push(row("Border",
      this.swatch(b, "Border color", () => st().lineColor || DEFAULT_DRAWING_COLOR, "style.lineColor"),
      stkW(),
      this.seg(b, this.t(TEXT9.lineStyle), LINE_STYLE_OPTIONS.map((o) => ({ value: o.value, html: dashIcon(o.value), title: this.t(o.label) })), () => st().lineStyle ?? "solid", (v) => b.edit({ "style.lineStyle": v }))));
    const mid = stkCheck("Middle line", () => st().midLine, (on) => b.edit({ "style.midLine": on }));
    b.watch(mid.sync);
    const midRow = document.createElement("div");
    midRow.className = "vela-dsp-row";
    midRow.append(mid.el,
      this.swatch(b, "Middle line color", () => st().midColor || st().lineColor || DEFAULT_DRAWING_COLOR, "style.midColor"),
      this.seg(b, "Middle line style", LINE_STYLE_OPTIONS.map((o) => ({ value: o.value, html: dashIcon(o.value), title: this.t(o.label) })), () => st().midStyle ?? "dotted", (v) => b.edit({ "style.midStyle": v })));
    rows.push(midRow);
    const bg = stkCheck(this.t(TEXT9.background), () => !!st().fillColor, (on) => {
      const s = st();
      if (on) b.edit({ "style.fillColor": s.stkFill || withAlpha(s.lineColor || DEFAULT_DRAWING_COLOR, 0.2) });
      else b.edit({ "style.stkFill": s.fillColor || s.stkFill || "", "style.fillColor": "" });
    });
    b.watch(bg.sync);
    const bgRow = document.createElement("div");
    bgRow.className = "vela-dsp-row";
    const bgSw = this.swatch(b, "Background color", () => st().fillColor || st().stkFill || withAlpha(st().lineColor || DEFAULT_DRAWING_COLOR, 0.2), "style.fillColor");
    bgRow.append(bg.el, bgSw);
    rows.push(bgRow);
    return block(null, ...rows);
  }
  /** Text tab: colour, size (px), B, I; the words; alignment (TradingView). */
  stkTextPane(b, has) {
    const tx = () => b.live().text ?? {};
    const type = b.live().type;
    const top = document.createElement("div");
    top.className = "vela-dsp-row";
    if (has("text.color")) top.appendChild(this.swatch(b, this.t(TEXT9.textColor), () => tx().color || this.theme.textColor, "text.color"));
    if (has("text.size")) {
      const cur = () => namedFontSize(tx().size ?? "normal") || 14;
      const sizes = [...new Set([...STK_FONT_PX, cur()])].sort((a, c) => a - c);
      const sel = stkSelect(sizes.map((n) => ({ value: n, label: String(n) })), cur, (v) => b.edit({ "text.size": String(v) }), "Font size");
      sel.el.style.width = "92px";
      b.watch(sel.sync);
      top.appendChild(sel.el);
    }
    if (has("text.bold")) top.appendChild(this.chip(b, "B", () => !!tx().bold, (on) => b.edit({ "text.bold": on }), this.t(TEXT9.bold)));
    if (has("text.italic")) top.appendChild(this.chip(b, "I", () => !!tx().italic, (on) => b.edit({ "text.italic": on }), this.t(TEXT9.italic)));
    const area = document.createElement("div");
    area.className = "stk-dsp-text";
    const ta = this.textArea(b, "Add text", 4);
    const tai = ta.querySelector("textarea");
    if (tai) { tai.rows = 4; }
    area.appendChild(ta);
    const rows = [top, area];
    const V = [{ value: "top", label: "Top" }, { value: "middle", label: "Middle" }, { value: "bottom", label: "Bottom" }];
    const H = [{ value: "left", label: "Left" }, { value: "center", label: "Center" }, { value: "right", label: "Right" }];
    let v = null, h = null;
    if (type === "box") {
      v = stkSelect(V, () => tx().stkV || "middle", (x) => b.edit({ "text.stkV": x }), "Vertical");
      h = stkSelect(H, () => tx().stkH || "center", (x) => b.edit({ "text.stkH": x }), "Horizontal");
    } else if (type === "hline") {
      v = stkSelect(V, () => tx().stkV || "top", (x) => b.edit({ "text.stkV": x }), "Vertical");
      h = stkSelect(H, () => tx().stkH || "left", (x) => b.edit({ "text.stkH": x }), "Horizontal");
    } else if (LINE_LABEL_TYPES.has(type)) {
      const sideOf = { top: "above", middle: "middle", bottom: "below" };
      const placeOf = { left: "start", center: "middle", right: "end" };
      const back = (m, val) => Object.keys(m).find((k) => m[k] === val);
      v = stkSelect(V, () => back(sideOf, tx().side ?? "above") || "top", (x) => b.edit({ "text.side": sideOf[x] }), "Vertical");
      h = stkSelect(H, () => back(placeOf, tx().place ?? "middle") || "center", (x) => b.edit({ "text.place": placeOf[x] }), "Horizontal");
    }
    if (v && h) {
      b.watch(v.sync);
      b.watch(h.sync);
      v.el.style.flex = h.el.style.flex = "1";
      rows.push(row("Text alignment", v.el, h.el));
    }
    return block(null, ...rows);
  }
  /** Visibility tab: one box per timeframe band (TradingView); all ticked = every timeframe. */
  stkVisibility(b) {
    const keys = TIMEFRAME_BANDS.map((t) => t.key);
    const on = () => b.live().showOn;
    const grid = document.createElement("div");
    grid.className = "stk-dsp-vis";
    const set = (next) => b.edit({ showOn: next.length === keys.length ? void 0 : next });
    const all = stkCheck(this.t(TEXT9.allTimeframes), () => !on(), (yes) => set(yes ? keys : []));
    b.watch(all.sync);
    const here = timeframeBandOf(this.env.chartBarMs());
    for (const band of TIMEFRAME_BANDS) {
      const c = stkCheck(this.t(band.label), () => on()?.includes(band.key) ?? true, (yes) => {
        const cur = new Set(on() ?? keys);
        if (yes) cur.add(band.key); else cur.delete(band.key);
        set(keys.filter((k) => cur.has(k)));
      });
      if (band.key === here) c.el.title = this.t(TEXT9.chartTimeframe);
      c.el.dataset.band = band.key;
      b.watch(c.sync);
      grid.appendChild(c.el);
    }
    const note = document.createElement("div");
    note.className = "vela-dsp-note";
    b.watch(() => {
      const s = on();
      const hidden = s != null && here != null && !s.includes(here);
      note.hidden = !hidden;
      note.textContent = s?.length === 0 ? this.t(TEXT9.hiddenOnEveryTimeframe) : this.t(TEXT9.hiddenOnThisTimeframe);
    });
    return block(null, all.el, grid, note);
  }
  // ── sections ──
  sections(b) {''')

print(f'{n_edits} edits OK')
