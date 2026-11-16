package com.tradezoro.app.data

import java.util.Locale

/**
 * A chart price alert, Firestore students/{uid}/chartAlerts/{id} (assets/chart-alerts.js clean(); firestore.rules
 * validAlert). The server alert engine fires these and pushes the phone (FCM) through onNotificationCreated.
 */
data class PriceAlert(
    val id: String,
    val symbol: String,
    val cond: String,
    val price: Double,
    val message: String,
    val freq: String,
    val active: Boolean,
) {
    val ticker: String get() = displayAlertSymbol(symbol)
    val condLabel: String get() = ALERT_CONDS[cond] ?: "Crossing"
    val freqLabel: String get() = if (freq == "every") "Every time" else "Only once"
}

/** Same labels as the site (assets/chart-alerts.js CONDS). */
val ALERT_CONDS = linkedMapOf(
    "crossing" to "Crossing", "crossing_up" to "Crossing up", "crossing_down" to "Crossing down",
    "greater" to "Greater than", "less" to "Less than",
)

/** "futures:NQ1!" -> "NQ1!", "binance:BTCUSDT" -> "BTCUSDT" (alert_core.display_symbol). */
fun displayAlertSymbol(raw: String): String = raw.replace(Regex("^(futures|binance|coinbase|hyperliquid|fx):", RegexOption.IGNORE_CASE), "")

/**
 * Firestore doc -> alert; null when the doc is not a valid price alert (same checks as the rules / the site's clean()).
 * Values arrive as Firestore types: numbers as Long or Double.
 */
fun alertFrom(id: String, d: Map<String, Any?>): PriceAlert? {
    val symbol = d["symbol"] as? String ?: return null
    val price = (d["price"] as? Number)?.toDouble() ?: return null
    if (symbol.isEmpty() || !price.isFinite()) return null
    val cond = (d["cond"] as? String)?.takeIf { it in ALERT_CONDS } ?: "crossing"
    return PriceAlert(id, symbol, cond, price, (d["message"] as? String).orEmpty(), if (d["freq"] == "every") "every" else "once", d["active"] == true)
}

/** Alert level text: "21,450.25" (two decimals at least, more when the level has them, like alert_core.fmt_price). */
fun alertPrice(x: Double): String {
    if (kotlin.math.abs(x) < 1) return String.format(Locale.US, "%.8f", x).trimEnd('0').trimEnd('.').ifEmpty { "0" }
    val s = String.format(Locale.US, "%.6f", x).trimEnd('0')
    val dec = s.substringAfter('.', "").length
    return String.format(Locale.US, "%,.${maxOf(2, dec)}f", x)
}
