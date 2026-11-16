package com.tradezoro.app.data

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** Chart page URL. The app injects assets/chart-bridge.js into it; the site itself is unchanged. */
const val CHART_URL = "https://tradezoro.com/charts"
const val CHART_ORIGIN = "https://tradezoro.com"

/** Timeframe chips from the mock. [id] is the chart's interval id (assets/chart-intervals.js parseIv). */
enum class Timeframe(val id: String, val label: String) {
    M1("1", "1m"), M5("5", "5m"), M15("15", "15m"), H1("60", "1H"), D("D", "D");

    companion object {
        /** The chart's own timeframe label ("5m", "1h", "1D", "D", "60") -> chip; null for others (e.g. 3m). */
        fun fromLabel(s: String?): Timeframe? = when (s?.trim()?.lowercase()) {
            "1", "1m" -> M1; "5", "5m" -> M5; "15", "15m" -> M15
            "60", "1h", "60m" -> H1; "d", "1d" -> D
            else -> null
        }
    }
}

@Serializable data class BridgeToast(val type: String = "info", val msg: String = "")
@Serializable data class BridgePosition(val side: String, val qty: Double, val avg: Double)

/** What chart-bridge.js posts every second (and after each action). */
@Serializable
data class BridgeState(
    val t: String = "state",
    val ready: Boolean = false,
    val sym: String = "",
    val tf: String = "",
    val last: Double? = null,
    val paper: Boolean = false,
    val pos: BridgePosition? = null,
    val signedIn: Boolean = false,
    val toasts: List<BridgeToast> = emptyList(),
)

private val bridgeJson = Json { ignoreUnknownKeys = true; isLenient = true }

/** Parses one bridge message; null for anything malformed or not a state message. */
fun parseBridge(raw: String): BridgeState? =
    runCatching { bridgeJson.decodeFromString(BridgeState.serializer(), raw) }.getOrNull()?.takeIf { it.t == "state" }

/** Watchlist ticker -> chart symbol id (futures continuous front month; crypto USDT pair). */
fun chartIdFor(s: WatchSymbol): String = when (s.source) {
    Source.FUTURES -> "${s.ticker}1!"
    Source.CRYPTO -> "binance:${s.ticker}USDT"
}

/** Chart symbol id -> display ticker: "MNQ1!" -> "MNQ", "binance:BTCUSDT" -> "BTC", others as-is without a prefix. */
fun displayTicker(chartId: String): String {
    val t = chartId.substringAfter(':')
    return when {
        t.endsWith("1!") || t.endsWith("2!") -> t.dropLast(2)
        t.endsWith("USDT") && t.length > 4 -> t.dropLast(4)
        else -> t
    }
}

/** Futures trade whole contracts; crypto in small units (paper engine qtyStep 0.0001, we step by 0.01). */
fun isFuturesId(chartId: String): Boolean = !chartId.contains(':') || chartId.substringAfter(':').let { it.endsWith("1!") || it.endsWith("2!") }

/** The bridge's JS string literal escaping (symbols come from our own list, but never trust a string into JS). */
fun jsString(s: String): String = buildString {
    append('\'')
    s.forEach { c ->
        when {
            c == '\\' || c == '\'' -> append('\\').append(c)
            c.code < 0x20 || c == '\u2028' || c == '\u2029' || c == '<' -> append(String.format("\\u%04x", c.code))
            else -> append(c)
        }
    }
    append('\'')
}
