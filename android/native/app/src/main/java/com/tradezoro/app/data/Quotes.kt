package com.tradezoro.app.data

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.double

/** One OHLCV bar. [time] is epoch seconds (bar open). */
data class Bar(val time: Long, val open: Double, val high: Double, val low: Double, val close: Double, val volume: Double)

/** Where a watchlist symbol's data comes from (the same public sources the site's watchlist uses). */
enum class Source { FUTURES, CRYPTO }

data class WatchSymbol(val ticker: String, val name: String, val source: Source, val decimals: Int)

/** The Home watchlist (matches the approved mock). Futures = continuous front month. */
val DEFAULT_WATCHLIST = listOf(
    WatchSymbol("MNQ", "Micro E-mini Nasdaq", Source.FUTURES, 2),
    WatchSymbol("MES", "Micro E-mini S&P", Source.FUTURES, 2),
    WatchSymbol("NQ", "E-mini Nasdaq", Source.FUTURES, 2),
    WatchSymbol("ES", "E-mini S&P 500", Source.FUTURES, 2),
    WatchSymbol("GC", "Gold", Source.FUTURES, 2),
    WatchSymbol("CL", "Crude Oil", Source.FUTURES, 2),
    WatchSymbol("BTC", "Bitcoin", Source.CRYPTO, 0),
)

data class Quote(
    val last: Double,
    val prevClose: Double?,
    val spark: List<Double>,
    /** false when the source says the bars are delayed (futures via /api/chart/bars, rt=false). */
    val realtime: Boolean,
) {
    val change: Double? get() = prevClose?.let { last - it }
    val changePct: Double? get() = prevClose?.takeIf { it != 0.0 }?.let { (last - it) / it * 100 }
}

private val json = Json { ignoreUnknownKeys = true }

/** Parses /api/chart/bars/<SYM>1!?tf=.. : {"s","tf","page","rt","bars":[[t,o,h,l,c,v],...]}. */
fun parseSiteBars(body: String): Pair<List<Bar>, Boolean> {
    val o = json.parseToJsonElement(body).jsonObject
    val rt = o["rt"]?.jsonPrimitive?.booleanOrNull ?: false
    val bars = (o["bars"] as? JsonArray).orEmpty().map { el ->
        val a = el.jsonArray
        Bar(a[0].jsonPrimitive.double.toLong(), a[1].jsonPrimitive.double, a[2].jsonPrimitive.double,
            a[3].jsonPrimitive.double, a[4].jsonPrimitive.double, a.getOrNull(5)?.jsonPrimitive?.double ?: 0.0)
    }
    return bars to rt
}

/** Parses exchange klines: [[openMs,"o","h","l","c","v",...],...]. Prices arrive as strings. */
fun parseKlines(body: String): List<Bar> =
    json.parseToJsonElement(body).jsonArray.map { el ->
        val a = el.jsonArray
        fun d(i: Int) = a[i].jsonPrimitive.content.toDouble()
        Bar(a[0].jsonPrimitive.content.toLong() / 1000, d(1), d(2), d(3), d(4), d(5))
    }

/** Daily change = last close vs the previous daily close (same rule as the site's watchlist). */
fun quoteFrom(daily: List<Bar>, intraday: List<Bar>, realtime: Boolean, sparkPoints: Int = 32): Quote? {
    if (daily.isEmpty()) return null
    val sorted = daily.sortedBy { it.time }
    val last = intraday.maxByOrNull { it.time }?.takeIf { it.time >= sorted.last().time }?.close ?: sorted.last().close
    val prev = if (sorted.size > 1) sorted[sorted.size - 2].close else null
    val spark = intraday.sortedBy { it.time }.takeLast(sparkPoints).map { it.close }
    return Quote(last, prev, spark, realtime)
}

/** Scales a series into 0..1 (0 = lowest). A flat series sits in the middle. */
fun normalise(values: List<Double>): List<Float> {
    if (values.isEmpty()) return emptyList()
    val lo = values.min(); val hi = values.max()
    if (hi == lo) return values.map { 0.5f }
    return values.map { ((it - lo) / (hi - lo)).toFloat() }
}

fun formatPrice(v: Double, decimals: Int): String =
    String.format(java.util.Locale.US, "%,.${decimals}f", v)

/** "+0.42%" / "−0.26%" (true minus sign, as in the mock). */
fun formatPct(p: Double): String {
    val s = String.format(java.util.Locale.US, "%.2f%%", kotlin.math.abs(p))
    return if (p < 0) "\u2212$s" else "+$s"
}

