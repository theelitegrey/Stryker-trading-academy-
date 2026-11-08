#!/usr/bin/env python3
"""'Scale price chart only' on Vela 0.9.0 (applied once, to vela-0.9.0-s6 = s5 + this).

Usage: cp -r assets/vendor/vela-0.9.0-s5 assets/vendor/vela-0.9.0-s6
       python3 tools/vela-090-scale-patch.py assets/vendor/vela-0.9.0-s6
Adds renderer feature "scalePriceOnly" (default off): the price pane's auto-scale then uses only the
visible candles (OHLC); overlay indicators, Pine drawings and trade markers no longer widen it.
Saved as config priceScale.scalePriceOnly (inside the cell's rendererConfig, so layouts/templates keep it).
Menu item + Chart settings > Scales row. Every edit asserts its anchor, so a changed build fails loudly.
"""
import sys, os
D = sys.argv[1]
def edit(f, old, new, count=1):
    p = os.path.join(D, f); s = open(p, encoding='utf-8').read()
    n = s.count(old)
    if n != count: sys.exit(f'{f}: anchor found {n}x (want {count}): {old[:80]!r}')
    open(p, 'w', encoding='utf-8').write(s.replace(old, new))
C, W, M = 'chunk-XIRSR3D6.js', 'chunk-4WAHYL7Y.js', 'chunk-YRCL3WMD.js'
# engine
edit(C, '    this.scaleMode = "price";\n    /** Reference price', '    this.scalePriceOnly = false;   // TradeZoro: scale to candles only\n    this.scaleMode = "price";\n    /** Reference price')
edit(C, '      pane.scaleTarget = computePaneScale(masterModels, this.bars, includeCandles, i0, s1, dr,',
        '      const spo = this.scene.scalePriceOnly === true && pane === pricePane && includeCandles;   // TradeZoro: candles only\n      pane.scaleTarget = computePaneScale(spo ? [] : masterModels, this.bars, includeCandles, i0, s1, spo ? null : dr,')
edit(C, 'if (pane === pricePane && this.scene.tradeMarkers.visible && pane.bounds.height > 0) {', 'if (pane === pricePane && !spo && this.scene.tradeMarkers.visible && pane.bounds.height > 0) {')
edit(C, '"scaleMode", "invertScale", "paneScales"', '"scaleMode", "invertScale", "scalePriceOnly", "paneScales"')
edit(C, '      case "autoScale":\n        for (const pane', '      case "scalePriceOnly":\n        this.scene.scalePriceOnly = Boolean(value);\n        break;\n      case "autoScale":\n        for (const pane')
edit(C, '      case "autoScale": {\n        const price', '      case "scalePriceOnly":\n        return this.scene.scalePriceOnly === true;\n      case "autoScale": {\n        const price')
edit(C, '        invert: this.scene.invertScale,\n        borderColor', '        invert: this.scene.invertScale,\n        scalePriceOnly: this.scene.scalePriceOnly === true,\n        borderColor')
edit(C, '      invert: isBool(ps.invert) ? ps.invert : base.priceScale.invert,', '      invert: isBool(ps.invert) ? ps.invert : base.priceScale.invert,\n      scalePriceOnly: isBool(ps.scalePriceOnly) ? ps.scalePriceOnly : base.priceScale.scalePriceOnly === true,')
edit(C, '    this.scene.invertScale = next.priceScale.invert;\n    s.borderColor', '    this.scene.invertScale = next.priceScale.invert;\n    this.scene.scalePriceOnly = next.priceScale.scalePriceOnly === true;\n    s.borderColor')
# settings dialog
edit(C, '  invertScale: msg("chart.settings.invertScale", "Invert scale"),', '  invertScale: msg("chart.settings.invertScale", "Invert scale"),\n  scalePriceOnly: msg("chart.settings.scalePriceOnly", "Scale price chart only"),')
edit(C, '"scales.price-scale.invert"));\n', '"scales.price-scale.invert"));\n    body.append(sid(this.boolRow(TEXT6.scalePriceOnly, config.priceScale.scalePriceOnly, (v) => this.emit({ priceScale: { scalePriceOnly: v } })), "scales.price-scale.scale-price-only"));\n')
edit(C, '  "scales.price-scale.invert",\n', '  "scales.price-scale.invert",\n  "scales.price-scale.scale-price-only",\n')
# context menu + phone drawer
edit(M, '  invert: msg("widget.contextMenu.invert", "Invert scale"),', '  invert: msg("widget.contextMenu.invert", "Invert scale"),\n  scalePriceOnly: msg("widget.contextMenu.scalePriceOnly", "Scale price chart only"),')
edit(M, '    { id: "invert", label: t(TEXT.invert), checked: s.invert },', '    { id: "invert", label: t(TEXT.invert), checked: s.invert },\n    { id: "scalePriceOnly", label: t(TEXT.scalePriceOnly), checked: s.scalePriceOnly },')
edit(M, '    invert: -70,\n', '    invert: -70,\n    scalePriceOnly: -65,\n')
edit(W, '        invert: pane ? pane.invert : this.flag("invertScale"),', '        invert: pane ? pane.invert : this.flag("invertScale"),\n        scalePriceOnly: this.flag("scalePriceOnly"),')
edit(W, '      invert: pane ? pane.invert : this.flag("invertScale"),\n      choice', '      invert: pane ? pane.invert : this.flag("invertScale"),\n      scalePriceOnly: this.flag("scalePriceOnly"),\n      choice')
edit(W, '    } else if (id === "invert") {', '    } else if (id === "scalePriceOnly") {\n      chart.renderer.set("scalePriceOnly", !this.flag("scalePriceOnly"));\n    } else if (id === "invert") {')
edit(W, '      if (item.id === "invert") {', '      if (item.id === "scalePriceOnly") {\n        row(item.label, {\n          checked: item.checked,\n          onClick: () => {\n            chart.renderer.set("scalePriceOnly", !this.flag("scalePriceOnly"));\n            this.render();\n          }\n        });\n        continue;\n      }\n      if (item.id === "invert") {')
open(os.path.join(D, 'CHANGES.md'), 'a').write('\nThen tools/vela-090-scale-patch.py (s6: "Scale price chart only" - candles-only price auto-scale, saved as priceScale.scalePriceOnly).\n')
print('ok')
