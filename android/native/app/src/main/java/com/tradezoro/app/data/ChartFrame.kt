package com.tradezoro.app.data

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.longOrNull

/*
 * Native chart data (M5). The chart page (chart-bridge.js TZB.frame) sends bars and every indicator's computed
 * output; the indicator maths stays the site's own JavaScript. Everything here is immutable once built: a new
 * ChartData is made per frame, so the renderer can read it on the UI thread without locks.
 * Prices are NaN where the engine had no value (na); x positions are bar indexes into [Bars].
 */

class Bars(val n: Int, val t: LongArray, val o: DoubleArray, val h: DoubleArray, val l: DoubleArray, val c: DoubleArray, val v: DoubleArray) {
    /** Bar spacing in ms (for times past the last bar). */
    val step: Long get() = if (n >= 2) (t[n - 1] - t[n - 2]).coerceAtLeast(1) else 60_000
    /** Fractional bar index for a time (anchors can sit between or past bars). */
    fun indexOf(time: Long): Double {
        if (n == 0) return 0.0
        if (time >= t[n - 1]) return n - 1 + (time - t[n - 1]).toDouble() / step
        if (time <= t[0]) return (time - t[0]).toDouble() / step
        var lo = 0; var hi = n - 1
        while (hi - lo > 1) { val m = (lo + hi) ushr 1; if (t[m] <= time) lo = m else hi = m }
        return lo + (time - t[lo]).toDouble() / (t[hi] - t[lo]).coerceAtLeast(1)
    }
    fun timeAt(i: Double): Long = when {
        n == 0 -> 0
        i >= n - 1 -> t[n - 1] + ((i - (n - 1)) * step).toLong()
        i <= 0 -> t[0] + (i * step).toLong()
        else -> { val a = i.toInt(); t[a] + ((i - a) * (t[a + 1] - t[a])).toLong() }
    }
}

class Marker(val i: Int, val position: String, val shape: String, val color: Int, val text: String, val size: String)
class Series(
    val id: String, val kind: String, val color: Int, val width: Float, val style: String, val base: Double,
    val hidden: Boolean, val title: String, val values: DoubleArray, val colors: IntArray?, val markers: List<Marker>,
)
class Fill(val a: Int, val b: Int, val color: Int)
class PriceLine(val price: Double, val color: Int, val style: String, val width: Float, val title: String)
class Background(val from: Int, val to: Int, val color: Int)
class Seg(val x1: Double, val y1: Double, val x2: Double, val y2: Double, val color: Int, val width: Float, val style: String, val extend: String)
class BoxObj(
    val left: Double, val right: Double, val top: Double, val bottom: Double, val bg: Int, val border: Int, val borderWidth: Float,
    val borderStyle: String, val extend: String, val text: String, val textColor: Int, val hAlign: String, val vAlign: String,
)
class LabelObj(val x: Double, val y: Double, val yloc: String, val style: String, val color: Int, val text: String, val textColor: Int, val size: String)
class Poly(val xs: DoubleArray, val ys: DoubleArray, val color: Int, val width: Float, val style: String, val closed: Boolean, val fill: Int)
class LineFill(val a: Seg, val b: Seg, val color: Int)
class TableCell(val text: String, val color: Int, val bg: Int)
class TableObj(val position: String, val bg: Int, val cells: List<List<TableCell?>>)
class Drawing(val id: String, val type: String, val pane: String, val times: LongArray, val prices: DoubleArray, val color: Int, val width: Float, val style: String, val fill: Int)

class Model(
    val id: String, val title: String, val pane: String, val layer: Boolean,
    val series: List<Series>, val fills: List<Fill>, val priceLines: List<PriceLine>, val backgrounds: List<Background>,
    /** Per-bar candle colour from the script (0 = keep the candle's own colour); null when the script sets none. */
    val barColors: IntArray?,
    val lines: List<Seg>, val boxes: List<BoxObj>, val labels: List<LabelObj>, val polys: List<Poly>,
    val lineFills: List<LineFill>, val tables: List<TableObj>,
) {
    val inPrice: Boolean get() = pane == "price"
    /** True when the model has something the native renderer can draw. */
    val drawable: Boolean get() = series.any { !it.hidden } || fills.isNotEmpty() || priceLines.isNotEmpty() || backgrounds.isNotEmpty() ||
        barColors != null || lines.isNotEmpty() || boxes.isNotEmpty() || labels.isNotEmpty() || polys.isNotEmpty() || lineFills.isNotEmpty() || tables.isNotEmpty()
}

class ChartData(
    val key: String, val sym: String, val tf: String, val tz: String, val tick: Double,
    val bars: Bars, val volume: Boolean, val models: List<Model>, val drawings: List<Drawing>,
) {
    val n: Int get() = bars.n
    /** Price decimals from the tick size (0.25 -> 2, 0.01 -> 2, 1 -> 0, 0.0001 -> 4). */
    val decimals: Int get() {
        if (!(tick > 0)) return 2
        var d = 0; var x = tick
        while (d < 8 && kotlin.math.abs(x - Math.round(x)) > 1e-9) { x *= 10; d++ }
        return d
    }
}

/** Parses "#RRGGBB", "#RRGGBBAA", "#RGB", "rgb(...)", "rgba(...)" into ARGB; 0 for none/unknown. Cached (frames repeat colours). */
object ChartColors {
    private val cache = HashMap<String, Int>()
    fun parse(s: String?): Int {
        if (s.isNullOrEmpty()) return 0
        cache[s]?.let { return it }
        val v = runCatching { decode(s.trim()) }.getOrDefault(0)
        if (cache.size > 2048) cache.clear()
        cache[s] = v
        return v
    }
    private fun decode(s: String): Int {
        if (s.startsWith("#")) {
            val h = s.substring(1)
            return when (h.length) {
                3 -> { val r = h[0].digitToInt(16) * 17; val g = h[1].digitToInt(16) * 17; val b = h[2].digitToInt(16) * 17; argb(255, r, g, b) }
                6 -> (0xFF000000 or h.toLong(16)).toInt()
                8 -> { val rgb = h.substring(0, 6).toLong(16); val a = h.substring(6).toInt(16); ((a.toLong() shl 24) or rgb).toInt() }
                else -> 0
            }
        }
        val m = Regex("""rgba?\(([^)]*)\)""").find(s) ?: return 0
        val p = m.groupValues[1].split(',').map { it.trim() }
        if (p.size < 3) return 0
        val a = if (p.size >= 4) Math.round(p[3].toDouble() * 255).toInt().coerceIn(0, 255) else 255
        return argb(a, p[0].toDouble().toInt(), p[1].toDouble().toInt(), p[2].toDouble().toInt())
    }
    private fun argb(a: Int, r: Int, g: Int, b: Int) = (a shl 24) or (r shl 16) or (g shl 8) or b
}

/**
 * Turns TZB.frame() JSON into [ChartData]. Full frames rebuild everything; tail frames patch the last bars and the
 * tail of each series of the previous data, and keep object lists the page did not resend.
 * Not thread-safe: call from one coroutine at a time.
 */
class FrameStore {
    private val json = Json { ignoreUnknownKeys = true }
    var data: ChartData? = null; private set
    /** Set when a tail frame did not fit the data we hold; the next request should ask for a full frame. */
    var needFull: Boolean = true; private set

    /** One of the site's own sheets (indicators, symbol search, alerts) is open in the page. */
    var modal: Boolean = false; private set

    fun requestFull() { needFull = true }

    /** Applies one frame; returns the new data (or the old one when the frame could not be used). */
    fun apply(raw: String): ChartData? {
        val root = runCatching { json.parseToJsonElement(raw) as? JsonObject }.getOrNull() ?: return data
        modal = root.bool("modal") == true
        if (root.bool("ready") != true) return data
        val full = root.bool("full") == true
        val prev = data
        val key = root.str("key")
        if (!full && (prev == null || prev.key != key)) { needFull = true; return prev }
        val n = root.int("n") ?: return data
        val bars = readBars(root["bars"] as? JsonObject ?: return data, n, if (full) null else prev?.bars) ?: run { needFull = true; return prev }
        val prevModels = prev?.models?.associateBy { it.id } ?: emptyMap()
        val models = ArrayList<Model>()
        var ok = true
        (root["models"] as? JsonArray)?.forEach { e ->
            val o = e as? JsonObject ?: return@forEach
            val m = readModel(o, n, bars, prevModels[o.str("id")])
            if (m == null) ok = false else models.add(m)
        }
        if (!ok) { needFull = true; return prev }
        val drawings = (root["drawings"] as? JsonArray)?.let(::readDrawings) ?: prev?.drawings ?: emptyList()
        val d = ChartData(key, root.str("sym"), root.str("tf"), root.str("tz"), root.dbl("tick") ?: 0.01, bars, root.bool("vol") == true, models, drawings)
        data = d
        if (full) needFull = false
        return d
    }

    private fun readBars(o: JsonObject, n: Int, base: Bars?): Bars? {
        val off = o.int("off") ?: 0
        val t = o.arr("t"); val op = o.arr("o"); val hi = o.arr("h"); val lo = o.arr("l"); val cl = o.arr("c"); val vo = o.arr("v")
        if (base == null) {
            if (off != 0 || t.size != n) return null
            return Bars(n, LongArray(n) { t[it].long() }, dblArr(op, n), dblArr(hi, n), dblArr(lo, n), dblArr(cl, n), dblArr(vo, n))
        }
        if (base.n != n || off + t.size > n) return null
        val b = Bars(n, base.t.copyOf(), base.o.copyOf(), base.h.copyOf(), base.l.copyOf(), base.c.copyOf(), base.v.copyOf())
        for (k in t.indices) {
            val i = off + k
            b.t[i] = t[k].long(); b.o[i] = op[k].dbl(); b.h[i] = hi[k].dbl(); b.l[i] = lo[k].dbl(); b.c[i] = cl[k].dbl(); b.v[i] = vo[k].dbl().let { if (it.isNaN()) 0.0 else it }
        }
        return b
    }

    private fun readModel(o: JsonObject, n: Int, bars: Bars, prev: Model?): Model? {
        val tail = !o.containsKey("title")
        if (tail && prev == null) return null
        val sArr = o.arr("s")
        val series = ArrayList<Series>(sArr.size)
        for ((k, e) in sArr.withIndex()) {
            val s = e as? JsonObject ?: return null
            val p = if (tail) prev!!.series.getOrNull(k) ?: return null else null
            series.add(readSeries(s, n, p) ?: return null)
        }
        fun <T> objs(name: String, old: List<T>?, read: (JsonArray) -> List<T>): List<T> =
            (o[name] as? JsonArray)?.let(read) ?: old ?: emptyList()
        return Model(
            id = o.str("id"),
            title = if (tail) prev!!.title else o.str("title"),
            pane = if (tail) prev!!.pane else o.str("pane").ifEmpty { "price" },
            layer = if (tail) prev!!.layer else o.int("layer") == 1,
            series = series,
            fills = objs("fills", prev?.fills) { a -> a.mapNotNull { (it as? JsonObject)?.let { f -> Fill(f.int("a") ?: -1, f.int("b") ?: -1, ChartColors.parse(f.strN("c"))) } } },
            priceLines = objs("priceLines", prev?.priceLines) { a -> a.mapNotNull { (it as? JsonObject)?.let { l -> PriceLine(l.dbl("p") ?: Double.NaN, ChartColors.parse(l.strN("c")), l.str("ls"), (l.dbl("w") ?: 1.0).toFloat(), l.str("t")) } } },
            backgrounds = objs("backgrounds", prev?.backgrounds) { a -> a.mapNotNull { (it as? JsonObject)?.let { g -> Background(g.int("a") ?: -1, g.int("b") ?: -1, ChartColors.parse(g.strN("c"))) } } },
            barColors = (o["barColors"] as? JsonArray)?.let { a ->
                if (a.isEmpty()) null else IntArray(n).also { arr -> a.forEach { q -> val p = q as? JsonArray ?: return@forEach; val i = p[0].int(); if (i in 0 until n) arr[i] = ChartColors.parse(p[1].strN()) } }
            } ?: prev?.barColors?.takeIf { it.size == n },
            lines = objs("lines", prev?.lines) { a -> a.mapNotNull { (it as? JsonObject)?.let(::seg) } },
            boxes = objs("boxes", prev?.boxes) { a -> a.mapNotNull { (it as? JsonObject)?.let { x ->
                BoxObj(x.dbl("l") ?: Double.NaN, x.dbl("r") ?: Double.NaN, x.dbl("t") ?: Double.NaN, x.dbl("b") ?: Double.NaN, ChartColors.parse(x.strN("bg")), ChartColors.parse(x.strN("bc")),
                    (x.dbl("bw") ?: 1.0).toFloat(), x.str("bs"), x.str("ex"), x.str("tx"), ChartColors.parse(x.strN("tc")), x.str("ha"), x.str("va"))
            } } },
            labels = objs("labels", prev?.labels) { a -> a.mapNotNull { (it as? JsonObject)?.let { x ->
                LabelObj(x.dbl("x") ?: Double.NaN, x.dbl("y") ?: Double.NaN, x.str("yl"), x.str("st"), ChartColors.parse(x.strN("c")), x.str("tx"), ChartColors.parse(x.strN("tc")), x.str("sz"))
            } } },
            polys = objs("polylines", prev?.polys) { a -> a.mapNotNull { (it as? JsonObject)?.let { x ->
                val pts = x.arr("p")
                Poly(DoubleArray(pts.size) { (pts[it] as JsonArray)[0].dbl() }, DoubleArray(pts.size) { (pts[it] as JsonArray)[1].dbl() },
                    ChartColors.parse(x.strN("c")), (x.dbl("w") ?: 1.0).toFloat(), x.str("ls"), x.bool("cl") == true, ChartColors.parse(x.strN("fc")))
            } } },
            lineFills = objs("linefills", prev?.lineFills) { a -> a.mapNotNull { (it as? JsonObject)?.let { x ->
                val sa = (x["a"] as? JsonObject)?.let(::seg); val sb = (x["b"] as? JsonObject)?.let(::seg)
                if (sa == null || sb == null) null else LineFill(sa, sb, ChartColors.parse(x.strN("c")))
            } } },
            tables = objs("tables", prev?.tables) { a -> a.mapNotNull { (it as? JsonObject)?.let { x ->
                TableObj(x.str("pos"), ChartColors.parse(x.strN("bg")), x.arr("cells").map { row ->
                    (row as? JsonArray)?.map { c -> (c as? JsonArray)?.let { TableCell(it[0].strN() ?: "", ChartColors.parse(it[1].strN()), ChartColors.parse(it[2].strN())) } } ?: emptyList()
                })
            } } },
        )
    }

    private fun readSeries(s: JsonObject, n: Int, prev: Series?): Series? {
        val off = s.int("off") ?: 0
        if (prev != null && s.bool("same") == true) return prev
        val vals = s["v"] as? JsonArray
        val pcs = s["pc"] as? JsonArray
        val values: DoubleArray
        var colors: IntArray?
        if (prev == null) {
            if (off != 0) return null
            values = DoubleArray(n) { Double.NaN }
            colors = null
        } else {
            if (prev.values.size != n) return null
            values = prev.values.copyOf()
            colors = prev.colors?.copyOf()
        }
        if (vals != null) for (k in vals.indices) { val i = off + k; if (i < n) values[i] = vals[k].dbl() }
        if (pcs != null) {
            if (colors == null) colors = IntArray(n)
            for (k in pcs.indices) { val i = off + k; if (i < n) colors[i] = ChartColors.parse(pcs[k].strN()) }
        }
        val markers = if (prev != null) prev.markers else s.arr("m").mapNotNull { q ->
            val a = q as? JsonArray ?: return@mapNotNull null
            Marker(a[0].int(), a[1].strN() ?: "", a[2].strN() ?: "", ChartColors.parse(a[3].strN()), a[4].strN() ?: "", a[5].strN() ?: "")
        }
        return Series(
            id = s.str("id"), kind = prev?.kind ?: s.str("k"),
            color = prev?.color ?: ChartColors.parse(s.strN("c")), width = prev?.width ?: (s.dbl("w") ?: 1.0).toFloat(),
            style = prev?.style ?: s.str("ls"), base = prev?.base ?: (s.dbl("base") ?: 0.0), hidden = prev?.hidden ?: (s.int("hide") == 1),
            title = prev?.title ?: s.str("title"), values = values, colors = colors, markers = markers,
        )
    }

    private fun readDrawings(a: JsonArray): List<Drawing> = a.mapNotNull { e ->
        val d = e as? JsonObject ?: return@mapNotNull null
        val pts = d.arr("a")
        Drawing(d.str("id"), d.str("type"), d.str("pane").ifEmpty { "price" },
            LongArray(pts.size) { (pts[it] as JsonArray)[0].long() }, DoubleArray(pts.size) { (pts[it] as JsonArray)[1].dbl() },
            ChartColors.parse(d.strN("c")), (d.dbl("w") ?: 1.0).toFloat(), d.str("ls"), ChartColors.parse(d.strN("fc")))
    }

    private fun seg(x: JsonObject) = Seg(x.dbl("x1") ?: Double.NaN, x.dbl("y1") ?: Double.NaN, x.dbl("x2") ?: Double.NaN, x.dbl("y2") ?: Double.NaN,
        ChartColors.parse(x.strN("c")), (x.dbl("w") ?: 1.0).toFloat(), x.str("st"), x.str("ex"))

    // ---- tiny JSON helpers (null-safe, no exceptions on odd values) ----
    private fun JsonObject.str(k: String) = strN(k) ?: ""
    private fun JsonObject.strN(k: String): String? = (this[k] as? JsonPrimitive)?.takeIf { it.isString }?.content
    private fun JsonObject.int(k: String): Int? = (this[k] as? JsonPrimitive)?.intOrNull
    private fun JsonObject.dbl(k: String): Double? = (this[k] as? JsonPrimitive)?.doubleOrNull
    private fun JsonObject.bool(k: String): Boolean? = (this[k] as? JsonPrimitive)?.booleanOrNull
    private fun JsonObject.arr(k: String): JsonArray = this[k] as? JsonArray ?: JsonArray(emptyList())
    private fun JsonElement.dbl(): Double = if (this is JsonNull) Double.NaN else (this as? JsonPrimitive)?.doubleOrNull ?: Double.NaN
    private fun JsonElement.long(): Long = (this as? JsonPrimitive)?.longOrNull ?: (this as? JsonPrimitive)?.doubleOrNull?.toLong() ?: 0L
    private fun JsonElement.int(): Int = (this as? JsonPrimitive)?.intOrNull ?: -1
    private fun JsonElement.strN(): String? = (this as? JsonPrimitive)?.takeIf { it.isString }?.content
    private fun dblArr(a: JsonArray, n: Int) = DoubleArray(n) { a[it].dbl() }
}
