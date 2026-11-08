#!/usr/bin/env python3
"""Same 'Scale price chart only' feature as tools/vela-090-scale-patch.py, for the rollback build.
Usage: cp -r assets/vendor/vela-0.6.17-s3 assets/vendor/vela-0.6.17-s4; python3 tools/vela-060-scale-patch.py assets/vendor/vela-0.6.17-s4
"""
import sys, os
D = sys.argv[1]
def edit(f, old, new, count=1):
    p = os.path.join(D, f); s = open(p, encoding='utf-8').read()
    n = s.count(old)
    if n != count: sys.exit(f'{f}: anchor found {n}x (want {count}): {old[:80]!r}')
    open(p, 'w', encoding='utf-8').write(s.replace(old, new))
C, W = 'chunk-YCD72KGK.js', 'chunk-OSZDSH7F.js'
edit(C, '    this.scaleMode = "price";', '    this.scalePriceOnly = false;   // TradeZoro: scale to candles only\n    this.scaleMode = "price";')
edit(C, '      pane.scaleTarget = computePaneScale(masterModels, this.bars, includeCandles, i0, i1, dr,',
        '      const spo = this.scene.scalePriceOnly === true && pane === pricePane && includeCandles;   // TradeZoro: candles only\n      pane.scaleTarget = computePaneScale(spo ? [] : masterModels, this.bars, includeCandles, i0, i1, spo ? null : dr,')
edit(C, 'if (pane === pricePane && this.scene.tradeMarkers.visible && pane.bounds.height > 0) {', 'if (pane === pricePane && !spo && this.scene.tradeMarkers.visible && pane.bounds.height > 0) {')
edit(C, '"scaleMode", "invertScale", "paneScales"', '"scaleMode", "invertScale", "scalePriceOnly", "paneScales"')
edit(C, '      case "autoScale":\n        for (const pane', '      case "scalePriceOnly":\n        this.scene.scalePriceOnly = Boolean(value);\n        break;\n      case "autoScale":\n        for (const pane')
edit(C, '      case "autoScale": {\n        const price', '      case "scalePriceOnly":\n        return this.scene.scalePriceOnly === true;\n      case "autoScale": {\n        const price')
edit(C, '        invert: this.scene.invertScale,\n', '        invert: this.scene.invertScale,\n        scalePriceOnly: this.scene.scalePriceOnly === true,\n')
edit(C, '      invert: isBool(ps.invert) ? ps.invert : base.priceScale.invert,', '      invert: isBool(ps.invert) ? ps.invert : base.priceScale.invert,\n      scalePriceOnly: isBool(ps.scalePriceOnly) ? ps.scalePriceOnly : base.priceScale.scalePriceOnly === true,')
edit(C, '    this.scene.invertScale = next.priceScale.invert;\n', '    this.scene.invertScale = next.priceScale.invert;\n    this.scene.scalePriceOnly = next.priceScale.scalePriceOnly === true;\n')
edit(C, '  "scales.price-scale.invert",\n', '  "scales.price-scale.invert",\n  "scales.price-scale.scale-price-only",\n')
edit(C, '"scales.price-scale.invert"));\n', '"scales.price-scale.invert"));\n    body.append(sid(this.boolRow("Scale price chart only", config.priceScale.scalePriceOnly, (v) => this.emit({ priceScale: { scalePriceOnly: v } })), "scales.price-scale.scale-price-only"));\n')
edit(W, '    { id: "invert", label: "Invert scale", checked: s.invert },', '    { id: "invert", label: "Invert scale", checked: s.invert },\n    { id: "scalePriceOnly", label: "Scale price chart only", checked: s.scalePriceOnly },')
edit(W, '          invert: pane ? pane.invert : this.flag("invertScale"),', '          invert: pane ? pane.invert : this.flag("invertScale"),\n          scalePriceOnly: this.flag("scalePriceOnly"),')
edit(W, '      invert: pane ? pane.invert : this.flag("invertScale"),\n      choice', '      invert: pane ? pane.invert : this.flag("invertScale"),\n      scalePriceOnly: this.flag("scalePriceOnly"),\n      choice')
edit(W, '    } else if (id === "invert") {', '    } else if (id === "scalePriceOnly") {\n      chart.renderer.set("scalePriceOnly", !this.flag("scalePriceOnly"));\n    } else if (id === "invert") {')
edit(W, '      if (item.id === "invert") {', '      if (item.id === "scalePriceOnly") {\n        row(item.label, {\n          checked: item.checked,\n          onClick: () => {\n            chart.renderer.set("scalePriceOnly", !this.flag("scalePriceOnly"));\n            this.render();\n          }\n        });\n        continue;\n      }\n      if (item.id === "invert") {')
open(os.path.join(D, 'CHANGES.md'), 'a').write('\nThen tools/vela-060-scale-patch.py (s4: "Scale price chart only").\n')
print('ok')
