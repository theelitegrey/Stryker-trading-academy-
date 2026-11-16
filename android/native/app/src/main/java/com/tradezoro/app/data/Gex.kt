package com.tradezoro.app.data

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlin.math.abs

/**
 * Omega (GEX). Same API the site's Omega page and chart GEX levels use: GET /api/gex/levels/<API>?dte=1 with the
 * member's Firebase ID token (functions/api/gex/_pro.js: free for signed-in members, 403 otherwise). The app shows
 * the futures-converted levels the API already returns (futures[fut].levels); nothing is recomputed here.
 */
enum class GexMarket(val fut: String, val api: String, val decimals: Int) {
    MNQ("MNQ", "QQQ", 2), MES("MES", "SPX", 2), MGC("MGC", "GLD", 1);
}

enum class LevelKind(val label: String) {
    CALL_WALL("Call wall"), ZERO_GAMMA("Zero gamma"), SPOT("Spot"), PUT_WALL("Put wall"),
    IV_HI("Expected high (68%)"), IV_LO("Expected low (68%)"),
}

data class GexLevel(val kind: LevelKind, val price: Double)

data class GexView(
    val market: GexMarket,
    val spot: Double,
    val netGex: Double?,
    val positive: Boolean?,
    /** Price levels, highest first (spot included). */
    val levels: List<GexLevel>,
    /** Epoch seconds of the GEX inputs (site: dataTime). */
    val dataTs: Double?,
    val stale: Boolean,
) {
    val zero: Double? get() = levels.firstOrNull { it.kind == LevelKind.ZERO_GAMMA }?.price
    /** Spot minus zero gamma, in futures points. */
    val spotVsFlip: Double? get() = zero?.let { spot - it }
    private val walls get() = levels.filter { it.kind != LevelKind.SPOT }
    val above: GexLevel? get() = walls.filter { it.price > spot }.minByOrNull { it.price - spot }
    val below: GexLevel? get() = walls.filter { it.price < spot }.maxByOrNull { it.price }
}

private val gexJson = Json { ignoreUnknownKeys = true }
private fun JsonObject.num(k: String): Double? = (this[k] as? JsonPrimitive)?.doubleOrNull

/** Parses one /api/gex/levels response for a futures contract. Null when the API has no levels for it. */
fun parseGex(body: String, market: GexMarket): GexView? {
    val o = gexJson.parseToJsonElement(body).jsonObject
    val fut = (o["futures"] as? JsonObject)?.get(market.fut) as? JsonObject ?: return null
    if (fut["error"] != null) return null
    val lv = fut["levels"] as? JsonObject ?: return null
    val spot = lv.num("spot") ?: fut.num("futures_price") ?: return null
    val levels = listOfNotNull(
        lv.num("call_wall")?.let { GexLevel(LevelKind.CALL_WALL, it) },
        lv.num("zero_gamma")?.let { GexLevel(LevelKind.ZERO_GAMMA, it) },
        GexLevel(LevelKind.SPOT, spot),
        lv.num("put_wall")?.let { GexLevel(LevelKind.PUT_WALL, it) },
        lv.num("iv68_hi")?.let { GexLevel(LevelKind.IV_HI, it) },
        lv.num("iv68_lo")?.let { GexLevel(LevelKind.IV_LO, it) },
    ).sortedByDescending { it.price }
    val net = o.num("net_gex")
    val regime = (o["regime"] as? JsonPrimitive)?.contentOrNull
    val m = o["market"] as? JsonObject
    val ts = m?.num("options_ts") ?: m?.num("data_ts") ?: o.num("fetched_at")
    return GexView(
        market, spot, net,
        positive = regime?.let { it == "POSITIVE" } ?: net?.let { it > 0 },
        levels = levels, dataTs = ts,
        stale = (o["stale"] as? JsonPrimitive)?.booleanOrNull == true,
    )
}

/** Site wording (assets/chart-gex-levels.js agoText): "GEX live" only under a minute old, never "real-time". */
fun gexAgo(tsSec: Double?, nowMs: Long): String {
    if (tsSec == null) return "GEX updated time unknown"
    val min = maxOf(0L, ((nowMs / 1000.0 - tsSec) / 60).toLong())
    if (min < 1) return "GEX live"
    if (min < 120) return "GEX updated $min min ago"
    val h = min / 60
    return if (h < 48) "GEX updated $h h ago" else "GEX updated ${h / 24} days ago"
}

/** "+2.10B" / "−640M" as on the site's regime badge. */
fun formatGex(v: Double): String {
    val a = abs(v)
    val amt = if (a >= 1e9) String.format(java.util.Locale.US, "%.2fB", a / 1e9) else String.format(java.util.Locale.US, "%.0fM", a / 1e6)
    return (if (v < 0) "\u2212" else "+") + amt
}

/** Signed points, e.g. "+64.25" / "−14.00". */
fun formatPts(v: Double, decimals: Int = 2): String = (if (v < 0) "\u2212" else "+") + formatPrice(abs(v), decimals)

/** Plain-language summary built only from the response (regime text from chart-gex-ladder-core.js regimeOf). */
fun gexSummary(v: GexView): String {
    val regime = when (v.positive) {
        true -> "Net GEX is positive: dealer hedging tends to dampen moves, so price is often calmer."
        false -> "Net GEX is negative: dealer hedging can add to moves, so swings can be bigger."
        null -> "Net GEX is not available for this update."
    }
    val a = v.above?.kind?.label?.lowercase()
    val b = v.below?.kind?.label?.lowercase()
    val where = when {
        a != null && b != null -> "Spot sits between the $b and the $a."
        a != null -> "Spot sits below the $a."
        b != null -> "Spot sits above the $b."
        else -> ""
    }
    return listOf(where, regime, "Levels refresh through the session.").filter { it.isNotEmpty() }.joinToString(" ")
}
