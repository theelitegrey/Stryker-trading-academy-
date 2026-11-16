package com.tradezoro.app.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.math.BigDecimal
import java.math.RoundingMode
import java.util.Locale
import kotlin.math.abs
import kotlin.math.round

/*
 * Trade tab data. The paper account itself is the site's own engine (assets/paper-engine.js) running inside the chart
 * page; chart-bridge.js TZB.paper() returns this read-only snapshot and TZB.order/close/cancel/flatten call the site's
 * own actions, so every rule (market hours, balance, slippage, brackets, net positions) is the site's.
 * Paper trading only: demo money, simulated fills, no broker path.
 */

@Serializable data class PaperSpec(val symbol: String, val kind: String, val tick: Double, val pointValue: Double, val minQty: Double = 1.0, val maxQty: Double = 500.0, val decimals: Int = 2)
@Serializable data class PaperAcct(val balance: Double, val equity: Double, val unrealized: Double, val realized: Double, val dayPnl: Double, val start: Double)
@Serializable data class PaperPos(val sym: String, val side: String, val qty: Double, val avg: Double, val last: Double? = null, val pnl: Double = 0.0, val sl: Double? = null, val tp: Double? = null)
@Serializable data class PaperOrder(val id: Long, val sym: String, val side: String, val type: String, val qty: Double, val price: Double, val sl: Double? = null, val tp: Double? = null)
@Serializable data class PaperTrade(val id: Long, val sym: String, val side: String, val qty: Double, val entry: Double, val exit: Double, val pnl: Double, val exitAt: Long = 0, val reason: String = "")

@Serializable
data class PaperSnapshot(
    val t: String = "paper",
    val ready: Boolean = false,
    val on: Boolean = false,
    val signedIn: Boolean = false,
    val sym: String = "",
    val last: Double? = null,
    val spec: PaperSpec? = null,
    val specError: String? = null,
    val acct: PaperAcct? = null,
    val positions: List<PaperPos> = emptyList(),
    val orders: List<PaperOrder> = emptyList(),
    val trades: List<PaperTrade> = emptyList(),
)

private val paperJson = Json { ignoreUnknownKeys = true; isLenient = true }

fun parsePaper(raw: String): PaperSnapshot? =
    runCatching { paperJson.decodeFromString(PaperSnapshot.serializer(), raw) }.getOrNull()?.takeIf { it.t == "paper" }

enum class OrderType(val id: String, val label: String) { MARKET("market", "Market"), LIMIT("limit", "Limit"), STOP("stop", "Stop") }

/** Rounds to the instrument tick (same as ReplayEngine.roundTick). */
fun roundTick(v: Double, tick: Double): Double =
    if (tick <= 0) v else BigDecimal(round(v / tick) * tick).setScale(10, RoundingMode.HALF_UP).toDouble()

/**
 * Bracket leg [ticks] away from [entry] on the protective (SL) or profit (TP) side, like the site ticket's "Ticks" unit:
 * buy TP above / SL below, sell the other way round. 0 ticks = no bracket.
 */
fun bracketPrice(side: String, entry: Double, ticks: Int, tick: Double, takeProfit: Boolean): Double? {
    if (ticks <= 0 || entry <= 0 || tick <= 0) return null
    val dir = (if (side == "sell") -1 else 1) * (if (takeProfit) 1 else -1)
    return roundTick(entry + dir * ticks * tick, tick)
}

/** $ at a bracket level (positive = profit), PaperAccount.bracketValue. */
fun bracketValue(side: String, qty: Double, entry: Double, level: Double, pointValue: Double): Double =
    Math.round((level - entry) * qty * pointValue * (if (side == "sell") -1 else 1) * 100) / 100.0

/** The site ticket pre-fills limit/stop prices 10 ticks away from the last, on the side the engine accepts. */
fun defaultOrderPrice(type: OrderType, side: String, last: Double, tick: Double): Double {
    val away = (if (type == OrderType.STOP) 1 else -1) * (if (side == "sell") -1 else 1)
    return roundTick(last + away * 10 * tick, tick)
}

/** Bracket stepper size in ticks: 4 ticks for futures (1 point on the index minis); ~0.1% of price for crypto. */
fun bracketStep(spec: PaperSpec?, last: Double?): Int = when {
    spec == null || spec.kind == "futures" -> 4
    last == null || spec.tick <= 0 -> 100
    else -> maxOf(1, round(last * 0.001 / spec.tick).toInt())
}

/** JSON for TZB.order(). Only numbers and fixed words, built with a JSON writer (never string-pasted). */
fun orderJson(side: String, type: OrderType, qty: Double, price: Double?, sl: Double?, tp: Double?): String = buildJsonObject {
    put("side", if (side == "sell") "sell" else "buy")
    put("type", type.id)
    put("qty", qty)
    if (type != OrderType.MARKET && price != null) put("price", price)
    if (sl != null) put("sl", sl)
    if (tp != null) put("tp", tp)
}.toString()

fun money(v: Double, sign: Boolean = false): String {
    val s = String.format(Locale.US, "$%,.2f", abs(v))
    return when { v < 0 -> "\u2212$s"; sign && v > 0 -> "+$s"; else -> s }
}

fun priceText(v: Double?, decimals: Int): String = v?.let { String.format(Locale.US, "%,.${decimals.coerceIn(0, 8)}f", it) } ?: "\u2014"

fun qtyText(q: Double): String = BigDecimal(q).setScale(4, RoundingMode.HALF_UP).stripTrailingZeros().toPlainString()
