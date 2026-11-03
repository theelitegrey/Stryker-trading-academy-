#!/usr/bin/env python3
"""Extra chart types on Vela 0.9.0 (applied once, to vela-0.9.0-s5 = s4 + this).

  python3 tools/vela-090-ctypes-patch.py assets/vendor/vela-0.9.0-s5

A chart type's barTransform may now set `derive: true`: it builds a DIFFERENT number of elements than the raw
bars (Renko bricks, Kagi lines, P&F columns, Range bars, Line break lines). Such a transform
  - gets the type's settings bag as 2nd argument:  full(raw, settings)
  - is re-run on every live bar update (applyBar -> stkRederive); only the changed tail is pushed to the renderer
  - is re-run when the type's settings change.
Every edit is staged in memory; nothing is written unless every anchor matches exactly once.
"""
import sys, os

D = sys.argv[1]
BUF = {}


def edit(fname, old, new, count=1):
    if fname not in BUF:
        BUF[fname] = open(os.path.join(D, fname), encoding='utf-8').read()
    n = BUF[fname].count(old)
    if n != count:
        sys.exit(f'{fname}: anchor found {n}x (want {count}): {old[:90]!r} (nothing written)')
    BUF[fname] = BUF[fname].replace(old, new)


C = 'chunk-XIRSR3D6.js'

# 1) settings bag reaches the transform (style switch + initial load)
edit(C, '    this.bars = transform ? transform.full(this.rawBars) : this.rawBars;',
        '    this.bars = transform ? transform.full(this.rawBars, this.typeSettings.get(style)) : this.rawBars;')
edit(C, '    this.bars = this.barTransform ? this.barTransform.full(raw) : raw;',
        '    this.bars = this.barTransform ? this.barTransform.full(raw, this.typeSettings.get(this.priceStyle)) : raw;')

# 2) live bar: a deriving transform rebuilds the view; others keep the O(1) path
edit(C, '''      this.barCause = "tick";
      if (this.barTransform) {''', '''      this.barCause = "tick";
      if (this.barTransform && !this.barTransform.derive) {''')
edit(C, '''      this.barCause = "bar";
      if (this.barTransform) {''', '''      this.barCause = "bar";
      if (this.barTransform && !this.barTransform.derive) {''')
edit(C, '''    this.renderer.updateBar(viewBar);
    this.events.emit("bar", bar);
    if (notify)''', '''    if (this.barTransform && this.barTransform.derive) this.stkRederive();
    else this.renderer.updateBar(viewBar);
    this.events.emit("bar", bar);
    if (notify)''')
edit(C, '''  /**
   * Reconcile one live bar into the canonical array + renderer (no gap detection).''', '''  /** TradeZoro (chart types): rebuild a deriving transform's view after a raw change and push only what changed. */
  stkRederive() {
    const old = this.bars;
    const nb = this.barTransform.full(this.rawBars, this.typeSettings.get(this.priceStyle));
    this.bars = nb;
    const same = (x, y) => x && y && x.time === y.time && x.open === y.open && x.high === y.high && x.low === y.low && x.close === y.close;
    const n0 = old.length;
    if (nb.length === n0 && same(nb[n0 - 1], old[n0 - 1]) && same(nb[n0 - 2], old[n0 - 2])) return;
    const stable = n0 > 0 && nb.length >= n0 && (n0 < 2 || same(nb[n0 - 2], old[n0 - 2])) && nb[0] && nb[0].time === old[0].time;
    if (!stable) {
      this.renderer.setBars(nb, { preserveView: true });
      this.reexecuteIndicators();
      return;
    }
    for (let k = n0 - 1; k < nb.length; k += 1) this.renderer.updateBar(nb[k]);
  }
  /**
   * Reconcile one live bar into the canonical array + renderer (no gap detection).''')

# 3) settings change: rebuild the view of the active deriving type
edit(C, '''      this.typeSettings.set(typeId, values);
      this.typeEngines.get(typeId)?.onSettings?.(values);''', '''      this.typeSettings.set(typeId, values);
      this.typeEngines.get(typeId)?.onSettings?.(values);
      if (this.barTransform && this.barTransform.derive && this.priceStyle === typeId && this.rawBars.length) {
        this.bars = this.barTransform.full(this.rawBars, values);
        this.renderer.setBars(this.bars, { preserveView: true });
        this.reexecuteIndicators();
      }''')

for f, s in BUF.items():
    open(os.path.join(D, f), 'w', encoding='utf-8').write(s)
open(os.path.join(D, 'CHANGES.md'), 'a', encoding='utf-8').write(
    '\nThen tools/vela-090-ctypes-patch.py (s5: a chart type transform with derive:true rebuilds the view on every bar and gets its settings).\n')
print('ok', len(BUF), 'file(s) patched')
