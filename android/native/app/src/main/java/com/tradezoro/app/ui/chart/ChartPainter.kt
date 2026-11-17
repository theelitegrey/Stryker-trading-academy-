package com.tradezoro.app.ui.chart

import android.graphics.Canvas
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Typeface
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.setValue
import com.tradezoro.app.data.Bars
import com.tradezoro.app.data.ChartData
import com.tradezoro.app.data.Drawing
import com.tradezoro.app.data.Model
import com.tradezoro.app.data.Series
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import java.util.TimeZone
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt

enum class PriceStyle(val label: String) { CANDLES("Candles"), BARS("Bars"), LINE("Line"), AREA("Area") }

/** Native drawing tools. [type] is the site's drawing type id; the drawing is stored by the site's own drawings controller. */
enum class DrawTool(val type: String, val label: String, val points: Int) {
    TREND("trendline", "Trend line", 2), RAY("ray", "Ray", 2), HLINE("hline", "Horizontal line", 1),
    VLINE("vline", "Vertical line", 1), BOX("box", "Rectangle", 2), FIB("fibretracement", "Fib retracement", 2),
}

/**
 * Which bars are on screen. Snapshot state: changing it redraws the Canvas (draw phase only, no recomposition).
 * [right] is the fractional bar index at the plot's right edge; [spacing] is px per bar.
 */
class ChartViewport {
    var right by mutableDoubleStateOf(0.0)
    var spacing by mutableFloatStateOf(0f)
    /** Crosshair position in px; x < 0 = hidden. */
    var crossX by mutableFloatStateOf(-1f)
    var crossY by mutableFloatStateOf(-1f)
    /** Bumped to force a redraw (e.g. a pending drawing anchor). */
    var tick by mutableIntStateOf(0)
    /** Anchors of a drawing being placed: (bar index, price). */
    val pending = mutableStateListOf<Pair<Double, Double>>()

    // Plain fields set by the painter each frame (reading them must not trigger redraws).
    var plotW = 0f
    var minSpacing = 2f
    var maxSpacing = 60f
    internal var lastData: ChartData? = null
    private var n = 0

    val left: Double get() = if (spacing > 0f) right - plotW / spacing else right

    fun onData(d: ChartData, defaultSpacing: Float) {
        val old = lastData
        n = d.n
        if (old == null || old.sym != d.sym || old.tf != d.tf || spacing <= 0f) {
            if (spacing <= 0f) spacing = defaultSpacing
            right = d.n - 1 + RIGHT_MARGIN; if (old != null) { crossX = -1f; pending.clear() }
        } else if (d.n != old.n && d.n > 0 && old.n > 0) {
            val atLive = right >= old.n - 1
            if (d.bars.t[0] < old.bars.t[0]) right += d.bars.indexOf(old.bars.t[0])   // history prepended: keep the same bars on screen
            else if (atLive) right += d.n - old.n                                        // new bar at the live edge: follow it
        }
        lastData = d
        clamp()
    }

    fun live() { right = n - 1 + RIGHT_MARGIN; clamp() }

    /** Pans by [dx] px (finger moving right shows older bars). Returns false when it hit a limit. */
    fun pan(dx: Float): Boolean {
        if (spacing <= 0f) return false
        val before = right
        right -= dx / spacing
        clamp()
        return right != before
    }

    /** Zooms by [factor] keeping the bar under [x] (px from the plot's left) in place. */
    fun zoom(factor: Float, x: Float) {
        if (spacing <= 0f || factor == 1f) return
        val idxAtX = right - (plotW - x) / spacing
        spacing = (spacing * factor).coerceIn(minSpacing, maxSpacing)
        right = idxAtX + (plotW - x) / spacing
        clamp()
    }

    private fun clamp() {
        if (spacing <= 0f || plotW <= 0f) return
        val visible = plotW / spacing
        val maxR = n - 1 + visible * 0.5
        val minR = min(maxR, 4.0)   // keep a few bars on screen at the far left
        right = right.coerceIn(minR, max(minR, maxR))
    }

    companion object { const val RIGHT_MARGIN = 4.0 }
}

/** Colours for one theme. Mint/red from the app theme; the indicator colours are the site's own. */
data class ChartPalette(
    val bg: Int, val grid: Int, val text: Int, val up: Int, val down: Int, val cross: Int,
    val tagBg: Int, val tagText: Int, val legend: Int,
)

/**
 * Paints a [ChartData] on an android Canvas. One instance per chart; every Paint, Path and scratch buffer is reused,
 * and label strings are cached, so a frame allocates nothing in steady state.
 */
class ChartPainter(private val density: Float, private val fontScale: Float) {
    private fun dp(v: Float) = v * density
    private fun sp(v: Float) = v * density * fontScale

    private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeJoin = Paint.Join.ROUND; strokeCap = Paint.Cap.BUTT }
    private val text = Paint(Paint.ANTI_ALIAS_FLAG).apply { textSize = sp(11f); fontFeatureSettings = "tnum" }
    private val bold = Paint(Paint.ANTI_ALIAS_FLAG).apply { textSize = sp(11f); typeface = Typeface.DEFAULT_BOLD; fontFeatureSettings = "tnum" }
    private val path = Path()
    private val path2 = Path()
    private val rect = RectF()
    private val dashed = DashPathEffect(floatArrayOf(dp(6f), dp(4f)), 0f)
    private val dotted = DashPathEffect(floatArrayOf(dp(1.5f), dp(3f)), 0f)
    private val fm = Paint.FontMetrics()

    // ---- layout of the last frame (used to map touches back to bars/prices) ----
    var plotR = 0f; private set
    var priceTop = 0f; private set
    var priceBot = 0f; private set
    private var pMin = 0.0
    private var pMax = 1.0
    private var logicalTop = 0f
    private var logicalBot = 1f
    private var legendH = 0f
    private var curTop = 0f
    private var curBot = 1f

    // ---- per-frame scratch (cleared, never reallocated) ----
    private val panes = ArrayList<String>(4)
    private val paneTop = FloatArray(MAX_PANES)
    private val paneBot = FloatArray(MAX_PANES)
    private val paneMin = DoubleArray(MAX_PANES)
    private val paneMax = DoubleArray(MAX_PANES)
    private val barColorLists = ArrayList<IntArray>(4)
    private val tablePos = HashMap<String, Int>()

    // ---- string caches ----
    private val priceCache = HashMap<Long, String>()
    private var priceDecimals = -1
    private var priceFmt = "%,.2f"
    private val timeCache = HashMap<Long, String>()
    private var timeZoneId = ""
    private var zone: ZoneId = ZoneId.systemDefault()
    private var tz: TimeZone = TimeZone.getDefault()
    private val hhmm = DateTimeFormatter.ofPattern("HH:mm", Locale.US)
    private val dayMon = DateTimeFormatter.ofPattern("d MMM", Locale.US)
    private val monYear = DateTimeFormatter.ofPattern("MMM yyyy", Locale.US)
    private val fullStamp = DateTimeFormatter.ofPattern("EEE d MMM yy  HH:mm", Locale.US)
    private val dayStamp = DateTimeFormatter.ofPattern("EEE d MMM yyyy", Locale.US)
    private val titleCache = HashMap<String, String>()

    fun xOf(i: Double, vp: ChartViewport): Float = (plotR - (vp.right - i) * vp.spacing).toFloat()
    fun indexAt(x: Float, vp: ChartViewport): Double = vp.right - (plotR - x) / vp.spacing
    private fun yP(p: Double): Float = (logicalTop + (pMax - p) / (pMax - pMin) * (logicalBot - logicalTop)).toFloat()
    fun priceAt(y: Float): Double = pMax - (y - logicalTop) / (logicalBot - logicalTop) * (pMax - pMin)

    fun draw(cv: Canvas, w: Float, h: Float, d: ChartData?, vp: ChartViewport, style: PriceStyle, pal: ChartPalette) {
        cv.clipRect(0f, 0f, w, h)   // Compose does not clip a Canvas to its bounds
        fill.color = pal.bg; cv.drawRect(0f, 0f, w, h, fill)
        if (d == null || d.n == 0) return
        val b = d.bars
        setFormats(d)
        // Right axis wide enough for the longest price label.
        val axisW = max(dp(48f), text.measureText(price(max(abs(b.h[b.n - 1]), abs(b.l[b.n - 1])) * 1.1)) + dp(16f))
        val timeH = dp(24f)
        plotR = w - axisW
        vp.plotW = plotR
        vp.minSpacing = dp(1.5f); vp.maxSpacing = dp(48f)
        if (vp.spacing <= 0f) return
        val i0 = max(0, floor(vp.left).toInt())
        val i1 = min(b.n - 1, ceil(vp.right).toInt())
        if (i1 < i0) return

        // ---- panes: price + one per sub-pane used by an indicator ----
        panes.clear(); panes.add("price")
        for (m in d.models) if (!m.inPrice && m.drawable && m.pane !in panes && panes.size < MAX_PANES) panes.add(m.pane)
        val subCount = panes.size - 1
        val avail = h - timeH
        val subH = if (subCount == 0) 0f else min(dp(112f), avail * 0.45f / subCount)
        paneTop[0] = 0f; paneBot[0] = avail - subH * subCount
        for (k in 1..subCount) { paneTop[k] = paneBot[0] + subH * (k - 1); paneBot[k] = paneTop[k] + subH }
        priceTop = paneTop[0]; priceBot = paneBot[0]

        // Legend rows (OHLC + up to 2 price-pane studies + "+n more") get their own band above the candles.
        text.textSize = sp(11f); text.getFontMetrics(fm)
        var studies = 0
        for (m in d.models) if (m.inPrice && (m.drawable || m.layer)) studies++
        legendH = dp(6f) + (fm.descent - fm.ascent + dp(4f)) * (1 + min(studies, LEGEND_ROWS) + if (studies > LEGEND_ROWS) 1 else 0)

        // ---- scales ----
        for (k in panes.indices) { paneMin[k] = Double.POSITIVE_INFINITY; paneMax[k] = Double.NEGATIVE_INFINITY }
        for (i in i0..i1) {
            val lo = if (style == PriceStyle.LINE || style == PriceStyle.AREA) b.c[i] else b.l[i]
            val hi = if (style == PriceStyle.LINE || style == PriceStyle.AREA) b.c[i] else b.h[i]
            if (lo < paneMin[0]) paneMin[0] = lo
            if (hi > paneMax[0]) paneMax[0] = hi
        }
        for (m in d.models) {
            val k = panes.indexOf(m.pane); if (k < 0) continue
            for (s in m.series) if (!s.hidden && s.kind != "markers") scaleSeries(s, i0, i1, k)
            if (k > 0) for (pl in m.priceLines) if (!pl.price.isNaN()) { paneMin[k] = min(paneMin[k], pl.price); paneMax[k] = max(paneMax[k], pl.price) }
        }
        for (k in panes.indices) {
            if (paneMin[k] > paneMax[k]) { paneMin[k] = 0.0; paneMax[k] = 1.0 }
            if (paneMax[k] - paneMin[k] < 1e-9) { paneMin[k] -= 1.0; paneMax[k] += 1.0 }
        }

        // ---- grid + price axis per pane ----
        for (k in panes.indices) {
            usePane(k, d.volume && k == 0)
            gridAndAxis(cv, pal)
            if (k > 0) { stroke.color = pal.grid; stroke.strokeWidth = dp(1f); stroke.pathEffect = null; cv.drawLine(0f, paneTop[k], w, paneTop[k], stroke) }
        }

        // ---- price pane content, clipped to the plot ----
        usePane(0, d.volume)
        cv.save(); cv.clipRect(0f, priceTop, plotR, priceBot)
        for (m in d.models) if (m.inPrice) backgrounds(cv, m, vp, priceTop, priceBot)
        if (d.volume) volume(cv, b, vp, i0, i1, pal)
        for (m in d.models) if (m.inPrice) modelBody(cv, d, m, vp, i0, i1, pal)
        barColorLists.clear(); for (m in d.models) if (m.inPrice) m.barColors?.let { if (it.size == b.n) barColorLists.add(it) }
        priceSeries(cv, b, vp, i0, i1, style, pal)
        for (m in d.models) if (m.inPrice) modelObjects(cv, d, m, vp, pal)
        for (dr in d.drawings) if (dr.pane == "price") drawing(cv, b, dr, vp)
        pendingAnchors(cv, vp, pal)
        lastPrice(cv, b, pal, w, true)
        cv.restore()
        lastPrice(cv, b, pal, w, false)
        for (m in d.models) if (m.inPrice) for (pl in m.priceLines) axisTag(cv, pl.price, pl.color, w)
        tables(cv, d, pal)

        // ---- sub-panes ----
        for (k in 1..subCount) {
            usePane(k, false)
            cv.save(); cv.clipRect(0f, paneTop[k], plotR, paneBot[k])
            for (m in d.models) if (m.pane == panes[k]) { backgrounds(cv, m, vp, paneTop[k], paneBot[k]); modelBody(cv, d, m, vp, i0, i1, pal); modelObjects(cv, d, m, vp, pal) }
            cv.restore()
        }

        // ---- time axis, crosshair, legends ----
        timeAxis(cv, b, vp, i0, i1, pal, h - timeH)
        crosshair(cv, d, vp, pal, w, h - timeH)
        legends(cv, d, vp, pal)
        // a hairline between plot and axes
        stroke.color = pal.grid; stroke.strokeWidth = dp(1f); stroke.pathEffect = null
        cv.drawLine(0f, h - timeH, w, h - timeH, stroke)
    }

    // =========================================================================================== scales
    private fun scaleSeries(s: Series, i0: Int, i1: Int, k: Int) {
        val v = s.values
        if (v.size <= i1) return
        for (i in i0..i1) { val x = v[i]; if (!x.isNaN()) { if (x < paneMin[k]) paneMin[k] = x; if (x > paneMax[k]) paneMax[k] = x } }
        if (s.kind == "histogram" || s.kind == "columns") { paneMin[k] = min(paneMin[k], s.base); paneMax[k] = max(paneMax[k], s.base) }
    }

    /** Selects pane [k] for yP(): price pane keeps room for the legend at the top and for volume at the bottom. */
    private fun usePane(k: Int, vol: Boolean) {
        val top = paneTop[k]; val bot = paneBot[k]; val hh = bot - top
        pMin = paneMin[k]; pMax = paneMax[k]; curTop = top; curBot = bot
        logicalTop = top + if (k == 0) legendH + dp(8f) else dp(20f)
        logicalBot = bot - if (k == 0) (if (vol) hh * 0.2f else hh * 0.06f) else dp(6f)
    }

    private fun niceStep(range: Double, count: Int): Double {
        val raw = range / max(1, count)
        val mag = 10.0.pow(floor(log10(raw)))
        val f = raw / mag
        return mag * when { f <= 1 -> 1.0; f <= 2 -> 2.0; f <= 2.5 -> 2.5; f <= 5 -> 5.0; else -> 10.0 }
    }

    private fun gridAndAxis(cv: Canvas, pal: ChartPalette) {
        val span = logicalBot - logicalTop
        if (span <= 0f) return
        val lo = priceAt(curBot); val hi = priceAt(curTop)
        val step = niceStep(hi - lo, max(2, (span / dp(40f)).toInt()))
        var p = ceil(lo / step) * step
        stroke.color = pal.grid; stroke.strokeWidth = dp(1f); stroke.pathEffect = null
        text.color = pal.text; text.textAlign = Paint.Align.LEFT
        text.getFontMetrics(fm)
        var guard = 0
        while (p <= hi && guard++ < 40) {
            val y = yP(p)
            if (y > curTop + dp(8f) && y < curBot - dp(4f)) {
                cv.drawLine(0f, y, plotR, y, stroke)
                cv.drawText(price(p), plotR + dp(8f), y - (fm.ascent + fm.descent) / 2f, text)
            }
            p += step
        }
    }

    // =========================================================================================== price
    private fun volume(cv: Canvas, b: Bars, vp: ChartViewport, i0: Int, i1: Int, pal: ChartPalette) {
        var mx = 0.0
        for (i in i0..i1) if (b.v[i] > mx) mx = b.v[i]
        if (mx <= 0) return
        val h = (priceBot - priceTop) * 0.18f
        val bw = max(1f, vp.spacing * 0.7f)
        for (i in i0..i1) {
            val x = xOf(i.toDouble(), vp)
            val top = priceBot - (b.v[i] / mx * h).toFloat()
            fill.color = withAlpha(if (b.c[i] >= b.o[i]) pal.up else pal.down, 0.35f)
            cv.drawRect(x - bw / 2, top, x + bw / 2, priceBot, fill)
        }
    }

    private fun candleColor(i: Int, up: Boolean, pal: ChartPalette): Int {
        for (k in barColorLists.indices.reversed()) { val c = barColorLists[k][i]; if (c != 0) return c }
        return if (up) pal.up else pal.down
    }

    private fun priceSeries(cv: Canvas, b: Bars, vp: ChartViewport, i0: Int, i1: Int, style: PriceStyle, pal: ChartPalette) {
        stroke.pathEffect = null
        when (style) {
            PriceStyle.CANDLES, PriceStyle.BARS -> {
                val bw = vp.spacing * 0.7f
                stroke.strokeWidth = max(1f, dp(1f))
                for (i in i0..i1) {
                    val x = xOf(i.toDouble(), vp)
                    val up = b.c[i] >= b.o[i]
                    val col = candleColor(i, up, pal)
                    val yo = yP(b.o[i]); val yc = yP(b.c[i]); val yh = yP(b.h[i]); val yl = yP(b.l[i])
                    stroke.color = col
                    if (style == PriceStyle.CANDLES) {
                        cv.drawLine(x, yh, x, yl, stroke)
                        if (bw >= 3f) {
                            fill.color = col
                            val top = min(yo, yc); val bot = max(max(yo, yc), top + 1f)
                            cv.drawRect(x - bw / 2, top, x + bw / 2, bot, fill)
                        }
                    } else {
                        cv.drawLine(x, yh, x, yl, stroke)
                        val tw = max(1f, bw / 2)
                        cv.drawLine(x - tw, yo, x, yo, stroke)
                        cv.drawLine(x, yc, x + tw, yc, stroke)
                    }
                }
            }
            PriceStyle.LINE, PriceStyle.AREA -> {
                val col = if (b.c[b.n - 1] >= b.c[max(0, i0)]) pal.up else pal.down
                path.reset()
                for (i in i0..i1) { val x = xOf(i.toDouble(), vp); val y = yP(b.c[i]); if (i == i0) path.moveTo(x, y) else path.lineTo(x, y) }
                if (style == PriceStyle.AREA) {
                    path2.set(path)
                    path2.lineTo(xOf(i1.toDouble(), vp), priceBot); path2.lineTo(xOf(i0.toDouble(), vp), priceBot); path2.close()
                    fill.color = withAlpha(col, 0.16f); cv.drawPath(path2, fill)
                }
                stroke.color = col; stroke.strokeWidth = dp(1.6f)
                cv.drawPath(path, stroke)
            }
        }
    }

    private fun lastPrice(cv: Canvas, b: Bars, pal: ChartPalette, w: Float, line: Boolean) {
        val last = b.c[b.n - 1]
        val y = yP(last)
        if (y < priceTop || y > priceBot) return
        val col = if (b.n < 2 || last >= b.o[b.n - 1]) pal.up else pal.down
        if (line) {
            stroke.color = withAlpha(col, 0.7f); stroke.strokeWidth = dp(1f); stroke.pathEffect = dotted
            cv.drawLine(0f, y, plotR, y, stroke); stroke.pathEffect = null
        } else tag(cv, price(last), y, pal.tagBg, pal.tagText, w)
    }

    private fun axisTag(cv: Canvas, p: Double, color: Int, w: Float) {
        if (p.isNaN() || color == 0) return
        val y = yP(p); if (y < priceTop + dp(8f) || y > priceBot - dp(8f)) return
        tag(cv, price(p), y, opaque(color), if (luminance(color) > 0.55) 0xFF0A0A0B.toInt() else 0xFFFFFFFF.toInt(), w)
    }

    /** A filled price tag on the right axis. */
    private fun tag(cv: Canvas, s: String, y: Float, bg: Int, fg: Int, w: Float) {
        bold.textAlign = Paint.Align.LEFT; bold.getFontMetrics(fm)
        val th = (fm.descent - fm.ascent) + dp(6f)
        rect.set(plotR + dp(2f), y - th / 2, w - dp(2f), y + th / 2)
        fill.color = bg; cv.drawRoundRect(rect, dp(4f), dp(4f), fill)
        bold.color = fg; cv.drawText(s, plotR + dp(6f), y - (fm.ascent + fm.descent) / 2f, bold)
    }

    // =========================================================================================== indicators
    private fun backgrounds(cv: Canvas, m: Model, vp: ChartViewport, top: Float, bot: Float) {
        for (g in m.backgrounds) {
            if (g.color == 0 || g.from < 0) continue
            val to = if (g.to < 0) g.from else g.to
            val x0 = xOf(g.from - 0.5, vp); val x1 = xOf(to - 0.5, vp)
            if (x1 < 0 || x0 > plotR) continue
            fill.color = g.color; cv.drawRect(x0, top, max(x1, x0 + vp.spacing), bot, fill)
        }
    }

    /** Series, fills and per-pane price lines of one model (in the currently selected pane). */
    private fun modelBody(cv: Canvas, d: ChartData, m: Model, vp: ChartViewport, i0: Int, i1: Int, pal: ChartPalette) {
        for (f in m.fills) {
            val a = m.series.getOrNull(f.a) ?: continue; val c = m.series.getOrNull(f.b) ?: continue
            if (f.color == 0 || a.values.size <= i1 || c.values.size <= i1) continue
            fillBetween(cv, a.values, c.values, i0, i1, vp, f.color)
        }
        for (s in m.series) {
            if (s.hidden || s.values.size <= i1) continue
            when (s.kind) {
                "markers" -> markers(cv, d.bars, s, vp, i0, i1)
                "histogram", "columns" -> columns(cv, s, vp, i0, i1, s.kind == "columns")
                "circles", "cross" -> dots(cv, s, vp, i0, i1, s.kind == "cross")
                "area" -> { area(cv, s, vp, i0, i1); line(cv, s, vp, i0, i1, false) }
                "step" -> line(cv, s, vp, i0, i1, true)
                "candle", "bar" -> {}
                else -> line(cv, s, vp, i0, i1, false)
            }
        }
        for (pl in m.priceLines) {
            if (pl.price.isNaN()) continue
            val y = yP(pl.price)
            stroke.color = if (pl.color != 0) pl.color else pal.text; stroke.strokeWidth = dp(pl.width); stroke.pathEffect = effect(pl.style)
            cv.drawLine(0f, y, plotR, y, stroke)
            stroke.pathEffect = null
            if (m.inPrice && pl.title.isNotEmpty()) {
                text.color = stroke.color; text.textAlign = Paint.Align.LEFT; text.textSize = sp(10f)
                cv.drawText(pl.title, dp(8f), y - dp(4f), text); text.textSize = sp(11f)
            }
        }
    }

    private fun effect(style: String) = when {
        style.contains("dash") -> dashed
        style.contains("dot") -> dotted
        else -> null
    }

    private fun line(cv: Canvas, s: Series, vp: ChartViewport, i0: Int, i1: Int, step: Boolean) {
        val v = s.values; val cols = s.colors
        stroke.strokeWidth = dp(max(1f, s.width)); stroke.pathEffect = effect(s.style)
        val a = max(0, i0 - 1); val z = min(v.size - 1, i1 + 1)
        if (cols == null) {
            if (s.color == 0 || alpha(s.color) == 0) { stroke.pathEffect = null; return }
            path.reset(); var pen = false
            for (i in a..z) {
                val y0 = v[i]
                if (y0.isNaN()) { pen = false; continue }
                val x = xOf(i.toDouble(), vp); val y = yP(y0)
                if (!pen) { path.moveTo(x, y); pen = true } else {
                    if (step) path.lineTo(x, yP(v[i - 1]))
                    path.lineTo(x, y)
                }
            }
            stroke.color = s.color; cv.drawPath(path, stroke)
        } else {
            for (i in a + 1..z) {
                val p0 = v[i - 1]; val p1 = v[i]
                if (p0.isNaN() || p1.isNaN()) continue
                val c = if (cols[i] != 0) cols[i] else s.color
                if (c == 0 || alpha(c) == 0) continue
                stroke.color = c
                val x0 = xOf(i - 1.0, vp); val x1 = xOf(i.toDouble(), vp)
                if (step) { cv.drawLine(x0, yP(p0), x1, yP(p0), stroke); cv.drawLine(x1, yP(p0), x1, yP(p1), stroke) }
                else cv.drawLine(x0, yP(p0), x1, yP(p1), stroke)
            }
        }
        stroke.pathEffect = null
    }

    private fun area(cv: Canvas, s: Series, vp: ChartViewport, i0: Int, i1: Int) {
        val v = s.values; var start = -1
        val base = logicalBot
        path.reset()
        for (i in i0..i1 + 1) {
            val ok = i <= i1 && i < v.size && !v[i].isNaN()
            if (ok && start < 0) { start = i; path.moveTo(xOf(i.toDouble(), vp), base); path.lineTo(xOf(i.toDouble(), vp), yP(v[i])) }
            else if (ok) path.lineTo(xOf(i.toDouble(), vp), yP(v[i]))
            else if (start >= 0) { path.lineTo(xOf(i - 1.0, vp), base); path.close(); start = -1 }
        }
        fill.color = withAlpha(s.color, 0.18f); cv.drawPath(path, fill)
    }

    private fun columns(cv: Canvas, s: Series, vp: ChartViewport, i0: Int, i1: Int, wide: Boolean) {
        val v = s.values; val y0 = yP(s.base)
        val bw = if (wide) max(1f, vp.spacing * 0.7f) else max(1f, min(dp(s.width), vp.spacing * 0.7f))
        for (i in i0..i1) {
            val x = v[i]; if (x.isNaN()) continue
            val c = s.colors?.get(i)?.takeIf { it != 0 } ?: s.color
            if (c == 0) continue
            fill.color = c
            val xx = xOf(i.toDouble(), vp); val y = yP(x)
            cv.drawRect(xx - bw / 2, min(y, y0), xx + bw / 2, max(max(y, y0), min(y, y0) + 1f), fill)
        }
    }

    private fun dots(cv: Canvas, s: Series, vp: ChartViewport, i0: Int, i1: Int, cross: Boolean) {
        val r = max(dp(1.5f), min(dp(3f), vp.spacing * 0.3f))
        stroke.strokeWidth = dp(1.2f)
        for (i in i0..i1) {
            val x = s.values[i]; if (x.isNaN()) continue
            val c = s.colors?.get(i)?.takeIf { it != 0 } ?: s.color
            val xx = xOf(i.toDouble(), vp); val y = yP(x)
            if (cross) { stroke.color = c; cv.drawLine(xx - r, y, xx + r, y, stroke); cv.drawLine(xx, y - r, xx, y + r, stroke) }
            else { fill.color = c; cv.drawCircle(xx, y, r, fill) }
        }
    }

    private fun fillBetween(cv: Canvas, a: DoubleArray, c: DoubleArray, i0: Int, i1: Int, vp: ChartViewport, color: Int) {
        var i = i0
        fill.color = color
        while (i <= i1) {
            while (i <= i1 && (a[i].isNaN() || c[i].isNaN())) i++
            if (i > i1) break
            val s0 = i
            while (i <= i1 && !a[i].isNaN() && !c[i].isNaN()) i++
            val e = i - 1
            path.reset()
            for (k in s0..e) { val x = xOf(k.toDouble(), vp); if (k == s0) path.moveTo(x, yP(a[k])) else path.lineTo(x, yP(a[k])) }
            for (k in e downTo s0) path.lineTo(xOf(k.toDouble(), vp), yP(c[k]))
            path.close(); cv.drawPath(path, fill)
        }
    }

    private fun markers(cv: Canvas, b: Bars, s: Series, vp: ChartViewport, i0: Int, i1: Int) {
        for (mk in s.markers) {
            if (mk.i < i0 || mk.i > i1) continue
            val x = xOf(mk.i.toDouble(), vp)
            val sz = shapeSize(mk.size)
            val above = mk.position.startsWith("above")
            val y = when {
                above -> yP(b.h[mk.i]) - dp(4f) - sz / 2
                mk.position.startsWith("below") -> yP(b.l[mk.i]) + dp(4f) + sz / 2
                else -> yP(b.c[mk.i])
            }
            shape(cv, mk.shape.lowercase(Locale.US), x, y, sz, mk.color)
            if (mk.text.isNotEmpty()) { text.color = mk.color; text.textAlign = Paint.Align.CENTER; cv.drawText(mk.text, x, if (above) y - sz else y + sz + dp(8f), text) }
        }
    }

    /** Pine drawing objects: lines, boxes, labels, polylines, linefills (tables are drawn after the clip). */
    private fun modelObjects(cv: Canvas, d: ChartData, m: Model, vp: ChartViewport, pal: ChartPalette) {
        for (lf in m.lineFills) {
            if (lf.color == 0) continue
            path.reset()
            path.moveTo(xOf(lf.a.x1, vp), yP(lf.a.y1)); path.lineTo(xOf(lf.a.x2, vp), yP(lf.a.y2))
            path.lineTo(xOf(lf.b.x2, vp), yP(lf.b.y2)); path.lineTo(xOf(lf.b.x1, vp), yP(lf.b.y1)); path.close()
            fill.color = lf.color; cv.drawPath(path, fill)
        }
        for (bx in m.boxes) {
            if (bx.left.isNaN() || bx.right.isNaN() || bx.top.isNaN() || bx.bottom.isNaN()) continue
            var x0 = xOf(bx.left, vp); var x1 = xOf(bx.right, vp)
            if (bx.extend == "right" || bx.extend == "both") x1 = plotR
            if (bx.extend == "left" || bx.extend == "both") x0 = 0f
            rect.set(min(x0, x1), min(yP(bx.top), yP(bx.bottom)), max(x0, x1), max(yP(bx.top), yP(bx.bottom)))
            if (bx.bg != 0) { fill.color = bx.bg; cv.drawRect(rect, fill) }
            if (bx.border != 0 && bx.borderWidth > 0) { stroke.color = bx.border; stroke.strokeWidth = dp(bx.borderWidth); stroke.pathEffect = effect(bx.borderStyle); cv.drawRect(rect, stroke); stroke.pathEffect = null }
            if (bx.text.isNotEmpty()) {
                text.color = if (bx.textColor != 0) bx.textColor else pal.legend; text.textSize = sp(10f)
                text.textAlign = when (bx.hAlign) { "left" -> Paint.Align.LEFT; "right" -> Paint.Align.RIGHT; else -> Paint.Align.CENTER }
                val tx = when (bx.hAlign) { "left" -> rect.left + dp(4f); "right" -> rect.right - dp(4f); else -> rect.centerX() }
                text.getFontMetrics(fm)
                val ty = when (bx.vAlign) { "top" -> rect.top - fm.ascent + dp(2f); "bottom" -> rect.bottom - fm.descent - dp(2f); else -> rect.centerY() - (fm.ascent + fm.descent) / 2 }
                cv.drawText(bx.text, tx, ty, text); text.textSize = sp(11f)
            }
        }
        for (l in m.lines) seg(cv, l.x1, l.y1, l.x2, l.y2, l.color, l.width, l.style, l.extend, vp)
        for (p in m.polys) {
            if (p.xs.size < 2) continue
            path.reset()
            for (k in p.xs.indices) { val x = xOf(p.xs[k], vp); val y = yP(p.ys[k]); if (k == 0) path.moveTo(x, y) else path.lineTo(x, y) }
            if (p.closed) path.close()
            if (p.fill != 0) { fill.color = p.fill; cv.drawPath(path, fill) }
            if (p.color != 0) { stroke.color = p.color; stroke.strokeWidth = dp(p.width); stroke.pathEffect = effect(p.style); cv.drawPath(path, stroke); stroke.pathEffect = null }
        }
        for (lb in m.labels) label(cv, d.bars, lb.x, lb.y, lb.yloc, lb.style, lb.color, lb.text, lb.textColor, lb.size, vp, pal)
    }

    private fun seg(cv: Canvas, ix1: Double, p1: Double, ix2: Double, p2: Double, color: Int, width: Float, style: String, extend: String, vp: ChartViewport) {
        if (ix1.isNaN() || ix2.isNaN() || p1.isNaN() || p2.isNaN() || color == 0) return
        var x1 = xOf(ix1, vp); var y1 = yP(p1); var x2 = xOf(ix2, vp); var y2 = yP(p2)
        val dx = x2 - x1; val dy = y2 - y1
        val far = plotR * 4 + 1000f
        if ((extend == "right" || extend == "both") && abs(dx) > 1e-3f) { val k = (far - x2) / dx; x2 += dx * k; y2 += dy * k }
        if ((extend == "left" || extend == "both") && abs(dx) > 1e-3f) { val k = (x1 + far) / dx; x1 -= dx * k; y1 -= dy * k }
        stroke.color = color; stroke.strokeWidth = dp(max(1f, width)); stroke.pathEffect = effect(style)
        cv.drawLine(x1, y1, x2, y2, stroke); stroke.pathEffect = null
        if (style.contains("arrow")) arrowHead(cv, x1, y1, x2, y2, color)
    }

    private fun arrowHead(cv: Canvas, x1: Float, y1: Float, x2: Float, y2: Float, color: Int) {
        val ang = kotlin.math.atan2((y2 - y1).toDouble(), (x2 - x1).toDouble()); val l = dp(8f)
        path.reset(); path.moveTo(x2, y2)
        path.lineTo((x2 - l * kotlin.math.cos(ang - 0.45)).toFloat(), (y2 - l * kotlin.math.sin(ang - 0.45)).toFloat())
        path.lineTo((x2 - l * kotlin.math.cos(ang + 0.45)).toFloat(), (y2 - l * kotlin.math.sin(ang + 0.45)).toFloat()); path.close()
        fill.color = color; cv.drawPath(path, fill)
    }

    private fun shapeSize(size: String) = dp(when (size) { "tiny" -> 6f; "small" -> 9f; "large" -> 16f; "huge" -> 22f; "auto" -> 9f; else -> 12f })

    private fun label(cv: Canvas, b: Bars, x0: Double, y0: Double, yloc: String, style: String, color: Int, s: String, textColor: Int, size: String, vp: ChartViewport, pal: ChartPalette) {
        if (x0.isNaN()) return
        val i = x0.roundToInt()
        val x = xOf(x0, vp)
        if (x < -dp(80f) || x > plotR + dp(80f)) return
        val st = style.removePrefix("label_").removePrefix("style_label_").lowercase(Locale.US)
        val sz = shapeSize(size)
        val y = when {
            yloc == "abovebar" && i in 0 until b.n -> yP(b.h[i]) - dp(4f)
            yloc == "belowbar" && i in 0 until b.n -> yP(b.l[i]) + dp(4f)
            y0.isNaN() -> return
            else -> yP(y0)
        }
        val bubble = st in BUBBLES
        if (!bubble) {
            // a shape (plotshape / label.style_triangleup ...), placed fully above/below the bar
            val cy = when (yloc) { "abovebar" -> y - sz / 2; "belowbar" -> y + sz / 2; else -> y }
            if (st != "none" && color != 0) shape(cv, st, x, cy, sz, color)
            if (s.isNotEmpty()) {
                text.color = if (textColor != 0) textColor else if (color != 0) color else pal.legend; text.textAlign = Paint.Align.CENTER
                text.getFontMetrics(fm)
                cv.drawText(s, x, if (yloc == "belowbar" || st == "triangleup" || st == "arrowup") cy + sz / 2 + dp(2f) - fm.ascent else cy - sz / 2 - dp(2f) - fm.descent, text)
            }
            return
        }
        if (s.isEmpty() && color == 0) return
        val tp = text
        tp.textSize = sp(when (size) { "tiny" -> 8f; "small" -> 10f; "large" -> 14f; "huge" -> 18f; else -> 11f }); tp.textAlign = Paint.Align.CENTER
        tp.getFontMetrics(fm)
        val tw = tp.measureText(s); val th = fm.descent - fm.ascent
        val padX = dp(6f); val padY = dp(3f); val ptr = dp(5f)
        val bw = tw + padX * 2; val bh = th + padY * 2
        val down = st == "down" || (yloc == "abovebar" && st == "center")
        val up = st == "up" || (yloc == "belowbar" && st == "center")
        val cx: Float; val cy: Float
        when {
            down || st.startsWith("lower") -> { cx = x; cy = y - ptr - bh / 2 }
            up || st.startsWith("upper") -> { cx = x; cy = y + ptr + bh / 2 }
            st == "left" -> { cx = x + ptr + bw / 2; cy = y }
            st == "right" -> { cx = x - ptr - bw / 2; cy = y }
            else -> { cx = x; cy = y }
        }
        rect.set(cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2)
        if (color != 0) {
            fill.color = color; cv.drawRoundRect(rect, dp(4f), dp(4f), fill)
            path.reset()
            when {
                down || st.startsWith("lower") -> { path.moveTo(x - ptr, rect.bottom - 1); path.lineTo(x + ptr, rect.bottom - 1); path.lineTo(x, y) }
                up || st.startsWith("upper") -> { path.moveTo(x - ptr, rect.top + 1); path.lineTo(x + ptr, rect.top + 1); path.lineTo(x, y) }
                st == "left" -> { path.moveTo(rect.left + 1, y - ptr); path.lineTo(rect.left + 1, y + ptr); path.lineTo(x, y) }
                st == "right" -> { path.moveTo(rect.right - 1, y - ptr); path.lineTo(rect.right - 1, y + ptr); path.lineTo(x, y) }
            }
            path.close(); cv.drawPath(path, fill)
        }
        tp.color = if (textColor != 0) textColor else if (color != 0) (if (luminance(color) > 0.55) 0xFF0A0A0B.toInt() else 0xFFFFFFFF.toInt()) else pal.legend
        cv.drawText(s, cx, cy - (fm.ascent + fm.descent) / 2, tp)
        tp.textSize = sp(11f)
    }

    private fun shape(cv: Canvas, st: String, x: Float, y: Float, sz: Float, color: Int) {
        val r = sz / 2
        fill.color = color; stroke.color = color; stroke.strokeWidth = dp(1.5f); stroke.pathEffect = null
        path.reset()
        when (st) {
            "triangleup", "arrowup" -> { path.moveTo(x, y - r); path.lineTo(x + r, y + r); path.lineTo(x - r, y + r); path.close(); cv.drawPath(path, fill) }
            "triangledown", "arrowdown" -> { path.moveTo(x, y + r); path.lineTo(x + r, y - r); path.lineTo(x - r, y - r); path.close(); cv.drawPath(path, fill) }
            "circle" -> cv.drawCircle(x, y, r * 0.8f, fill)
            "square" -> cv.drawRect(x - r * 0.8f, y - r * 0.8f, x + r * 0.8f, y + r * 0.8f, fill)
            "diamond" -> { path.moveTo(x, y - r); path.lineTo(x + r, y); path.lineTo(x, y + r); path.lineTo(x - r, y); path.close(); cv.drawPath(path, fill) }
            "cross" -> { cv.drawLine(x - r, y, x + r, y, stroke); cv.drawLine(x, y - r, x, y + r, stroke) }
            "xcross" -> { cv.drawLine(x - r, y - r, x + r, y + r, stroke); cv.drawLine(x - r, y + r, x + r, y - r, stroke) }
            "flag" -> { cv.drawLine(x - r * 0.6f, y + r, x - r * 0.6f, y - r, stroke); path.moveTo(x - r * 0.6f, y - r); path.lineTo(x + r, y - r * 0.5f); path.lineTo(x - r * 0.6f, y); path.close(); cv.drawPath(path, fill) }
            else -> cv.drawCircle(x, y, r * 0.5f, fill)
        }
    }

    /** Pine tables, one per screen position (the newest wins, as Pine replaces them), inside the price pane. */
    private fun tables(cv: Canvas, d: ChartData, pal: ChartPalette) {
        tablePos.clear()
        for ((mi, m) in d.models.withIndex()) if (m.inPrice) for ((ti, _) in m.tables.withIndex()) tablePos[m.tables[ti].position] = mi * 1000 + ti
        if (tablePos.isEmpty()) return
        text.textSize = sp(10f); text.getFontMetrics(fm); text.textAlign = Paint.Align.LEFT
        val ch = fm.descent - fm.ascent + dp(6f); val pad = dp(6f)
        for ((pos, code) in tablePos) {
            val t = d.models[code / 1000].tables[code % 1000]
            if (t.cells.isEmpty()) continue
            val cols = t.cells.maxOf { it.size }
            var tw = 0f
            for (c in 0 until cols) { var cw = 0f; for (row in t.cells) row.getOrNull(c)?.let { cw = max(cw, text.measureText(it.text)) }; tw += cw + pad * 2 }
            val th = ch * t.cells.size
            val left = when { pos.endsWith("left") -> dp(8f); pos.endsWith("center") -> (plotR - tw) / 2; else -> plotR - tw - dp(8f) }
            val top = when { pos.startsWith("top") -> priceTop + legendH; pos.startsWith("middle") -> (priceTop + priceBot - th) / 2; else -> priceBot - th - dp(8f) }
            if (t.bg != 0) { fill.color = t.bg; rect.set(left, top, left + tw, top + th); cv.drawRect(rect, fill) }
            var x = left
            for (c in 0 until cols) {
                var cw = 0f; for (row in t.cells) row.getOrNull(c)?.let { cw = max(cw, text.measureText(it.text)) }
                for ((r, row) in t.cells.withIndex()) {
                    val cell = row.getOrNull(c) ?: continue
                    if (cell.bg != 0) { fill.color = cell.bg; cv.drawRect(x, top + r * ch, x + cw + pad * 2, top + (r + 1) * ch, fill) }
                    text.color = if (cell.color != 0 && luminance(cell.color) > 0.02) cell.color else pal.legend
                    cv.drawText(cell.text, x + pad, top + r * ch + dp(3f) - fm.ascent, text)
                }
                x += cw + pad * 2
            }
        }
        text.textSize = sp(11f)
    }

    // =========================================================================================== drawings
    private fun drawing(cv: Canvas, b: Bars, dr: Drawing, vp: ChartViewport) {
        if (dr.times.isEmpty()) return
        val col = if (dr.color != 0) dr.color else 0xFF38C0FD.toInt()
        val i0 = b.indexOf(dr.times[0]); val p0 = dr.prices[0]
        val i1 = if (dr.times.size > 1) b.indexOf(dr.times[1]) else i0; val p1 = if (dr.prices.size > 1) dr.prices[1] else p0
        when (dr.type) {
            "trendline", "arrow", "infoline", "trendangle" -> { seg(cv, i0, p0, i1, p1, col, dr.width, dr.style, "none", vp); if (dr.type == "arrow") arrowHead(cv, xOf(i0, vp), yP(p0), xOf(i1, vp), yP(p1), col) }
            "ray" -> seg(cv, i0, p0, i1, p1, col, dr.width, dr.style, "right", vp)
            "extendedline" -> seg(cv, i0, p0, i1, p1, col, dr.width, dr.style, "both", vp)
            "hline" -> { stroke.color = col; stroke.strokeWidth = dp(dr.width); stroke.pathEffect = effect(dr.style); val y = yP(p0); cv.drawLine(0f, y, plotR, y, stroke); stroke.pathEffect = null }
            "hray" -> { stroke.color = col; stroke.strokeWidth = dp(dr.width); stroke.pathEffect = effect(dr.style); val y = yP(p0); cv.drawLine(xOf(i0, vp), y, plotR, y, stroke); stroke.pathEffect = null }
            "vline" -> { stroke.color = col; stroke.strokeWidth = dp(dr.width); stroke.pathEffect = effect(dr.style); val x = xOf(i0, vp); cv.drawLine(x, priceTop, x, priceBot, stroke); stroke.pathEffect = null }
            "box", "rectangle" -> {
                rect.set(min(xOf(i0, vp), xOf(i1, vp)), min(yP(p0), yP(p1)), max(xOf(i0, vp), xOf(i1, vp)), max(yP(p0), yP(p1)))
                fill.color = if (dr.fill != 0) dr.fill else withAlpha(col, 0.2f); cv.drawRect(rect, fill)
                stroke.color = col; stroke.strokeWidth = dp(dr.width); stroke.pathEffect = null; cv.drawRect(rect, stroke)
            }
            "fibretracement" -> {
                val xa = min(xOf(i0, vp), xOf(i1, vp)); text.textSize = sp(10f); text.textAlign = Paint.Align.LEFT
                for (lv in FIB) {
                    val p = p1 + (p0 - p1) * lv; val y = yP(p)
                    stroke.color = withAlpha(col, 0.85f); stroke.strokeWidth = dp(1f); stroke.pathEffect = null
                    cv.drawLine(xa, y, plotR, y, stroke)
                    text.color = col; cv.drawText(fibLabel(lv), xa + dp(4f), y - dp(3f), text)
                }
                text.textSize = sp(11f)
            }
            "parallelchannel" -> {
                seg(cv, i0, p0, i1, p1, col, dr.width, dr.style, "none", vp)
                if (dr.prices.size > 2) { val off = dr.prices[2] - (p0 + (p1 - p0) * ((b.indexOf(dr.times[2]) - i0) / (i1 - i0).let { if (abs(it) < 1e-9) 1.0 else it })); seg(cv, i0, p0 + off, i1, p1 + off, col, dr.width, dr.style, "none", vp) }
            }
            else -> {   // other tools: connect their anchors so the drawing is at least visible
                for (k in 1 until dr.times.size) seg(cv, b.indexOf(dr.times[k - 1]), dr.prices[k - 1], b.indexOf(dr.times[k]), dr.prices[k], col, dr.width, dr.style, "none", vp)
                if (dr.times.size == 1) { fill.color = col; cv.drawCircle(xOf(i0, vp), yP(p0), dp(3f), fill) }
            }
        }
    }

    private fun pendingAnchors(cv: Canvas, vp: ChartViewport, pal: ChartPalette) {
        if (vp.pending.isEmpty()) return
        fill.color = pal.legend
        for ((i, p) in vp.pending) cv.drawCircle(xOf(i, vp), yP(p), dp(4f), fill)
    }

    // =========================================================================================== axes, crosshair, legend
    private fun timeAxis(cv: Canvas, b: Bars, vp: ChartViewport, i0: Int, i1: Int, pal: ChartPalette, top: Float) {
        val minGap = dp(72f)
        val msPerPx = b.step / vp.spacing
        val need = (minGap * msPerPx).toLong()
        val unit = TIME_STEPS.firstOrNull { it >= need } ?: TIME_STEPS.last()
        text.color = pal.text; text.textAlign = Paint.Align.CENTER; text.getFontMetrics(fm)
        val ty = top + dp(12f) - (fm.ascent + fm.descent) / 2
        var lastX = -1e9f
        var prevBucket = Long.MIN_VALUE
        for (i in max(0, i0 - 1)..i1) {
            val t = b.t[i]
            val local = t + tz.getOffset(t)
            val bucket = if (unit >= MONTH) monthIndex(local) / (unit / MONTH).toInt() else Math.floorDiv(local, unit)
            if (bucket != prevBucket && prevBucket != Long.MIN_VALUE) {
                val x = xOf(i.toDouble(), vp)
                if (x - lastX >= minGap && x > dp(16f) && x < plotR - dp(16f)) {
                    cv.drawText(timeLabel(t, unit, b.step), x, ty, text); lastX = x
                }
            }
            prevBucket = bucket
        }
    }

    private fun crosshair(cv: Canvas, d: ChartData, vp: ChartViewport, pal: ChartPalette, w: Float, h: Float) {
        if (vp.crossX < 0) return
        val b = d.bars
        val i = indexAt(vp.crossX, vp).roundToInt().coerceIn(0, b.n - 1)
        val x = xOf(i.toDouble(), vp)
        val y = vp.crossY.coerceIn(0f, h)
        stroke.color = pal.cross; stroke.strokeWidth = dp(1f); stroke.pathEffect = dashed
        cv.drawLine(x, 0f, x, h, stroke)
        cv.drawLine(0f, y, plotR, y, stroke)
        stroke.pathEffect = null
        // price tag in whichever pane the finger is in
        for (k in panes.indices) if (y >= paneTop[k] && y <= paneBot[k]) { usePane(k, d.volume && k == 0); tag(cv, price(priceAt(y)), y, pal.tagBg, pal.tagText, w); break }
        usePane(0, d.volume)
        // time tag
        val s = stamp(b.t[i], b.step)
        bold.textAlign = Paint.Align.CENTER; bold.getFontMetrics(fm)
        val tw = bold.measureText(s) + dp(12f); val tx = x.coerceIn(tw / 2, plotR - tw / 2)
        rect.set(tx - tw / 2, h + dp(2f), tx + tw / 2, h + dp(22f))
        fill.color = pal.tagBg; cv.drawRoundRect(rect, dp(4f), dp(4f), fill)
        bold.color = pal.tagText; cv.drawText(s, tx, rect.centerY() - (fm.ascent + fm.descent) / 2, bold)
    }

    private fun legends(cv: Canvas, d: ChartData, vp: ChartViewport, pal: ChartPalette) {
        val b = d.bars
        val i = if (vp.crossX >= 0) indexAt(vp.crossX, vp).roundToInt().coerceIn(0, b.n - 1) else b.n - 1
        text.textAlign = Paint.Align.LEFT; text.textSize = sp(11f); text.getFontMetrics(fm)
        val lh = fm.descent - fm.ascent + dp(4f)
        // Row 1: O H L C of the bar under the crosshair (or the last bar)
        var x = dp(8f); val y1 = priceTop + dp(6f) - fm.ascent
        val col = if (b.c[i] >= b.o[i]) pal.up else pal.down
        for (k in 0 until 4) {
            text.color = pal.text; cv.drawText(OHLC[k], x, y1, text); x += text.measureText(OHLC[k]) + dp(3f)
            val v = price(when (k) { 0 -> b.o[i]; 1 -> b.h[i]; 2 -> b.l[i]; else -> b.c[i] })
            text.color = col; cv.drawText(v, x, y1, text); x += text.measureText(v) + dp(8f)
        }
        // Then one row per price-pane study, and a title row at the top of each sub-pane.
        var row = 1; var more = 0
        for (m in d.models) {
            if (!m.drawable && !m.layer) continue
            if (m.inPrice) { if (row > LEGEND_ROWS) { more++; continue }; legendRow(cv, m, i, dp(8f), priceTop + dp(6f) + row * lh - fm.ascent, pal); row++ }
        }
        if (more > 0) { text.color = pal.text; cv.drawText("+$more more", dp(8f), priceTop + dp(6f) + row * lh - fm.ascent, text) }
        for (k in 1 until panes.size) {
            var r = 0
            for (m in d.models) if (m.pane == panes[k] && r < 2) { legendRow(cv, m, i, dp(8f), paneTop[k] + dp(4f) + r * lh - fm.ascent, pal); r++ }
        }
    }

    private fun legendRow(cv: Canvas, m: Model, i: Int, x0: Float, y: Float, pal: ChartPalette) {
        var x = x0
        val main = m.series.firstOrNull { !it.hidden && it.kind != "markers" && it.color != 0 && alpha(it.color) > 0 }
        val dot = main?.color ?: m.series.firstOrNull { it.kind == "markers" }?.markers?.firstOrNull()?.color ?: pal.legend
        fill.color = opaque(dot); cv.drawCircle(x + dp(3f), y + (fm.ascent + fm.descent) / 2, dp(3f), fill); x += dp(10f)
        val t = shortTitle(m.title)
        text.color = pal.legend; cv.drawText(t, x, y, text); x += text.measureText(t) + dp(6f)
        if (m.layer && !m.drawable) { text.color = pal.text; cv.drawText("classic chart", x, y, text); return }
        var shown = 0
        for (s in m.series) {
            if (s.hidden || s.kind == "markers" || shown >= 3 || i >= s.values.size) continue
            val v = s.values[i]; if (v.isNaN()) continue
            val c = s.colors?.get(i)?.takeIf { it != 0 } ?: s.color
            if (c == 0 || alpha(c) == 0) continue
            val str = price(v)
            text.color = opaque(c); cv.drawText(str, x, y, text); x += text.measureText(str) + dp(6f); shown++
        }
    }

    // =========================================================================================== formatting
    private fun setFormats(d: ChartData) {
        val dec = d.decimals.coerceIn(0, 8)
        if (dec != priceDecimals) { priceDecimals = dec; priceFmt = "%,.${dec}f"; priceCache.clear() }
        if (d.tz != timeZoneId) {
            timeZoneId = d.tz
            zone = runCatching { ZoneId.of(d.tz) }.getOrDefault(ZoneId.systemDefault())
            tz = TimeZone.getTimeZone(zone)
            timeCache.clear()
        }
    }

    fun price(p: Double): String {
        if (p.isNaN()) return "\u2014"
        if (p == 0.0) return if (priceDecimals == 0) "0" else "0." + "0".repeat(priceDecimals)   // never "-0.00"
        val key = java.lang.Double.doubleToLongBits(p)
        priceCache[key]?.let { return it }
        val s = when {
            abs(p) >= 1e6 && priceDecimals == 0 -> String.format(Locale.US, "%,.0f", p)
            abs(p) < 1e-3 && p != 0.0 -> String.format(Locale.US, "%.3g", p)
            else -> String.format(Locale.US, priceFmt, p).let { if (it.startsWith("-") && it.trimStart('-', '0', '.', ',').isEmpty()) it.substring(1) else it }
        }
        if (priceCache.size > 2048) priceCache.clear()
        priceCache[key] = s
        return s
    }

    private fun timeLabel(t: Long, unit: Long, step: Long): String {
        val key = t * 8 + when { unit >= MONTH -> 3; unit >= DAY -> 2; step >= DAY -> 2; else -> 1 }
        timeCache[key]?.let { return it }
        val z = Instant.ofEpochMilli(t).atZone(zone)
        val s = when {
            unit >= YEAR_ISH -> z.year.toString()
            unit >= MONTH -> if (z.monthValue == 1) z.year.toString() else monYear.format(z).substringBefore(' ')
            unit >= DAY || step >= DAY -> if (z.dayOfMonth == 1) monYear.format(z).substringBefore(' ') else dayMon.format(z)
            z.hour == 0 && z.minute == 0 -> dayMon.format(z)
            else -> hhmm.format(z)
        }
        if (timeCache.size > 1024) timeCache.clear()
        timeCache[key] = s
        return s
    }

    private fun stamp(t: Long, step: Long): String {
        val key = t * 8 + 7
        timeCache[key]?.let { return it }
        val z = Instant.ofEpochMilli(t).atZone(zone)
        val s = if (step >= DAY) dayStamp.format(z) else fullStamp.format(z)
        timeCache[key] = s
        return s
    }

    /** year*12+month of a local epoch-ms, without allocating (days-from-civil inverse, H. Hinnant). */
    private fun monthIndex(localMs: Long): Long {
        val z = Math.floorDiv(localMs, DAY) + 719468
        val era = Math.floorDiv(z, 146097)
        val doe = z - era * 146097
        val yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365
        val doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
        val mp = (5 * doy + 2) / 153
        val m = if (mp < 10) mp + 3 else mp - 9
        val y = yoe + era * 400 + if (m <= 2) 1 else 0
        return y * 12 + m
    }

    private fun shortTitle(t: String): String = titleCache.getOrPut(t) {
        val words = t.split(' ').filter { it.isNotEmpty() }
        when {
            t.length <= 18 -> t
            words.size >= 2 && words.all { it[0].isLetter() } -> words.joinToString("") { it[0].uppercase() }.take(6)
            else -> t.take(16) + "\u2026"
        }
    }

    private fun fibLabel(lv: Double): String = FIB_LABELS[FIB.indexOf(lv)]

    companion object {
        const val MAX_PANES = 5
        private const val LEGEND_ROWS = 2
        private const val MIN = 60_000L
        private const val HOUR = 60 * MIN
        const val DAY = 24 * HOUR
        private const val MONTH = 30 * DAY
        private const val YEAR_ISH = 360 * DAY
        private val TIME_STEPS = longArrayOf(MIN, 5 * MIN, 15 * MIN, 30 * MIN, HOUR, 2 * HOUR, 4 * HOUR, 6 * HOUR, 12 * HOUR, DAY, 2 * DAY, 7 * DAY, MONTH, 3 * MONTH, 6 * MONTH, 12 * MONTH)
        private val OHLC = arrayOf("O", "H", "L", "C")
        private val FIB = doubleArrayOf(0.0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0).toList()
        private val FIB_LABELS = arrayOf("0", "0.236", "0.382", "0.5", "0.618", "0.786", "1")
        private val BUBBLES = setOf("down", "up", "left", "right", "center", "lower_left", "lower_right", "upper_left", "upper_right")

        fun alpha(c: Int) = (c ushr 24) and 0xFF
        fun opaque(c: Int) = c or (0xFF shl 24)
        fun withAlpha(c: Int, a: Float) = (c and 0x00FFFFFF) or ((a * 255).toInt().coerceIn(0, 255) shl 24)
        fun luminance(c: Int): Double { val r = (c shr 16 and 0xFF) / 255.0; val g = (c shr 8 and 0xFF) / 255.0; val b = (c and 0xFF) / 255.0; return 0.2126 * r + 0.7152 * g + 0.0722 * b }
    }
}
