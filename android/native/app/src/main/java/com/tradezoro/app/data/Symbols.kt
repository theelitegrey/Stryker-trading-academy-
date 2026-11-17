package com.tradezoro.app.data

import java.util.Locale

/*
 * Symbols as the website's watchlist stores them (assets/chart-watchlist.js items[]):
 *   futures:NQ1!  fx:EURUSD  idx:SPX  binance:BTCUSDT  (other exchange prefixes, formula:...)  and "###NAME" section markers.
 * The same ids are the chart's own symbol ids, so a watchlist row opens the chart with no mapping.
 * Catalogue = the futures roots, forex pairs and indices the site carries (SYMBOLS in functions/api/chart/_bars.js,
 * FUT_ROOTS / FX_PAIRS / IDX_SYMS in chart-watchlist.js).
 */

/** Where a symbol's quote comes from. OTHER = shown and charted, but the app has no quote source for it. */
enum class Source { FUTURES, FX, INDEX, CRYPTO, OTHER }

data class Cat(val id: String, val name: String, val exchange: String, val tick: Double)

val CATALOG: List<Cat> = listOf(
    Cat("futures:NQ1!", "Nasdaq-100 E-mini", "CME", 0.25),
    Cat("futures:MNQ1!", "Micro Nasdaq-100 E-mini", "CME", 0.25),
    Cat("futures:ES1!", "S&P 500 E-mini", "CME", 0.25),
    Cat("futures:MES1!", "Micro S&P 500 E-mini", "CME", 0.25),
    Cat("futures:YM1!", "Dow Jones E-mini", "CBOT", 1.0),
    Cat("futures:MYM1!", "Micro Dow Jones E-mini", "CBOT", 1.0),
    Cat("futures:RTY1!", "Russell 2000 E-mini", "CME", 0.1),
    Cat("futures:M2K1!", "Micro Russell 2000 E-mini", "CME", 0.1),
    Cat("futures:GC1!", "Gold", "COMEX", 0.1),
    Cat("futures:MGC1!", "Micro Gold", "COMEX", 0.1),
    Cat("futures:SI1!", "Silver", "COMEX", 0.005),
    Cat("futures:SIL1!", "Micro Silver", "COMEX", 0.005),
    Cat("futures:HG1!", "Copper", "COMEX", 0.0005),
    Cat("futures:MHG1!", "Micro Copper", "COMEX", 0.0005),
    Cat("futures:CL1!", "Crude Oil WTI", "NYMEX", 0.01),
    Cat("futures:MCL1!", "Micro WTI Crude Oil", "NYMEX", 0.01),
    Cat("futures:NG1!", "Natural Gas", "NYMEX", 0.001),
    Cat("futures:ZN1!", "10-Year T-Note", "CBOT", 0.015625),
    Cat("futures:ZB1!", "U.S. Treasury Bond", "CBOT", 0.03125),
    Cat("futures:6E1!", "Euro FX", "CME", 0.00005),
    Cat("fx:EURUSD", "Euro / U.S. Dollar", "Forex", 0.00001),
    Cat("fx:GBPUSD", "British Pound / U.S. Dollar", "Forex", 0.00001),
    Cat("fx:USDJPY", "U.S. Dollar / Japanese Yen", "Forex", 0.001),
    Cat("fx:AUDUSD", "Australian Dollar / U.S. Dollar", "Forex", 0.00001),
    Cat("fx:USDCAD", "U.S. Dollar / Canadian Dollar", "Forex", 0.00001),
    Cat("fx:USDCHF", "U.S. Dollar / Swiss Franc", "Forex", 0.00001),
    Cat("fx:NZDUSD", "New Zealand Dollar / U.S. Dollar", "Forex", 0.00001),
    Cat("fx:EURGBP", "Euro / British Pound", "Forex", 0.00001),
    Cat("fx:EURJPY", "Euro / Japanese Yen", "Forex", 0.001),
    Cat("fx:GBPJPY", "British Pound / Japanese Yen", "Forex", 0.001),
    Cat("fx:EURCHF", "Euro / Swiss Franc", "Forex", 0.00001),
    Cat("fx:EURAUD", "Euro / Australian Dollar", "Forex", 0.00001),
    Cat("fx:EURCAD", "Euro / Canadian Dollar", "Forex", 0.00001),
    Cat("fx:AUDJPY", "Australian Dollar / Japanese Yen", "Forex", 0.001),
    Cat("fx:CADJPY", "Canadian Dollar / Japanese Yen", "Forex", 0.001),
    Cat("fx:CHFJPY", "Swiss Franc / Japanese Yen", "Forex", 0.001),
    Cat("fx:GBPCHF", "British Pound / Swiss Franc", "Forex", 0.00001),
    Cat("fx:AUDNZD", "Australian Dollar / New Zealand Dollar", "Forex", 0.00001),
    Cat("idx:SPX", "S&P 500 Index", "Index", 0.01),
    Cat("idx:NDX", "Nasdaq-100 Index", "Index", 0.01),
    Cat("idx:VIX", "CBOE Volatility Index", "Index", 0.01),
    Cat("idx:RUT", "Russell 2000 Index", "Index", 0.01),
    Cat("idx:QQQ", "Invesco QQQ", "NASDAQ", 0.01),
    Cat("idx:SPY", "SPDR S&P 500 ETF", "NYSE", 0.01),
    Cat("idx:IWM", "iShares Russell 2000 ETF", "NYSE", 0.01),
    Cat("idx:DIA", "SPDR Dow Jones ETF", "NYSE", 0.01),
    // shortcut: a fixed set of main crypto pairs (the site validates against its exchange symbol lists); add more here.
    Cat("binance:BTCUSDT", "Bitcoin", "Crypto", 0.01),
    Cat("binance:ETHUSDT", "Ethereum", "Crypto", 0.01),
    Cat("binance:SOLUSDT", "Solana", "Crypto", 0.01),
    Cat("binance:XRPUSDT", "XRP", "Crypto", 0.0001),
    Cat("binance:BNBUSDT", "BNB", "Crypto", 0.01),
    Cat("binance:DOGEUSDT", "Dogecoin", "Crypto", 0.00001),
    Cat("binance:ADAUSDT", "Cardano", "Crypto", 0.0001),
    Cat("binance:AVAXUSDT", "Avalanche", "Crypto", 0.01),
    Cat("binance:LINKUSDT", "Chainlink", "Crypto", 0.001),
    Cat("binance:LTCUSDT", "Litecoin", "Crypto", 0.01),
)
private val BY_ID = CATALOG.associateBy { it.id }

const val SECTION = "###"
fun isSection(item: String) = item.startsWith(SECTION)

data class WatchSymbol(
    /** The site's watchlist / chart id, e.g. "futures:MNQ1!". */
    val id: String,
    /** Short name for rows ("MNQ", "BTC"). */
    val ticker: String,
    val name: String,
    val source: Source,
    val decimals: Int,
    val exchange: String,
) {
    /** The chart's ticker as the site shows it: "NQ1!", "EURUSD", "BTCUSDT". */
    val chartTicker: String get() = id.substringAfter(':')
    /** Top bar of the chart: "NQ1! · CME". */
    val title: String get() = if (exchange.isEmpty()) chartTicker else "$chartTicker \u00b7 $exchange"
    /** Crypto prices span 5 orders of magnitude: decimals follow the price. */
    fun decimalsFor(price: Double): Int = if (source != Source.CRYPTO) decimals else when {
        price >= 1000 -> 0; price >= 1 -> 2; price >= 0.01 -> 4; else -> 6
    }
}

private fun decimalsOf(tick: Double): Int {
    val s = java.math.BigDecimal(tick.toString()).stripTrailingZeros().toPlainString()
    return if (s.contains('.')) s.length - s.indexOf('.') - 1 else 0
}

/** Any site watchlist item (or chart id without a prefix, like "MNQ1!") -> a display symbol. */
fun symbolOf(rawId: String): WatchSymbol {
    val id = canonicalId(rawId)
    val cat = BY_ID[id]
    val pre = id.substringBefore(':', "")
    val tk = id.substringAfter(':')
    val source = when (pre) {
        "futures" -> Source.FUTURES; "fx" -> Source.FX; "idx" -> Source.INDEX
        "binance" -> if (tk.endsWith("USDT")) Source.CRYPTO else Source.OTHER
        else -> Source.OTHER
    }
    val ticker = when {
        tk.endsWith("1!") || tk.endsWith("2!") -> tk.dropLast(2)
        pre == "binance" && tk.endsWith("USDT") && tk.length > 4 -> tk.dropLast(4)
        else -> tk
    }
    val exchange = cat?.exchange ?: when (pre) {
        "futures" -> "CME"; "fx" -> "Forex"; "idx" -> "Index"; "formula" -> ""; "" -> ""
        else -> "Crypto"
    }
    return WatchSymbol(id, ticker, cat?.name ?: tk, source, cat?.let { decimalsOf(it.tick).coerceAtMost(5) }?.let { if (source == Source.FUTURES) maxOf(2, it) else it } ?: 2, exchange)
}

/** "MNQ1!" / "CME_MINI:MNQ1!" -> "futures:MNQ1!"; "BTCUSDT" -> "binance:BTCUSDT"; known ids unchanged. */
fun canonicalId(raw: String): String {
    val s = raw.trim()
    if (s.contains(':')) {
        val pre = s.substringBefore(':').lowercase(Locale.US); val tk = s.substringAfter(':')
        if (pre in setOf("futures", "fx", "idx", "binance", "coinbase", "hyperliquid", "bybit", "okx", "bitget", "kraken", "vest", "formula")) return "$pre:$tk"
        return canonicalId(tk)
    }
    val u = s.uppercase(Locale.US)
    if (BY_ID.containsKey("futures:$u")) return "futures:$u"
    if (BY_ID.containsKey("futures:${u}1!")) return "futures:${u}1!"
    if (BY_ID.containsKey("fx:$u")) return "fx:$u"
    if (BY_ID.containsKey("idx:$u")) return "idx:$u"
    if (BY_ID.containsKey("binance:$u")) return "binance:$u"
    if (BY_ID.containsKey("binance:${u}USDT")) return "binance:${u}USDT"
    return s
}

/** Symbol search for "add to watchlist": ticker prefix first, then name matches. Max [limit]. */
fun searchCatalog(q: String, limit: Int = 30): List<Cat> {
    val t = q.trim().uppercase(Locale.US).replace("/", "")
    if (t.isEmpty()) return CATALOG.take(limit)
    fun tk(c: Cat) = c.id.substringAfter(':').uppercase(Locale.US)
    val first = CATALOG.filter { tk(it).startsWith(t) }
    val then = CATALOG.filter { it !in first && (tk(it).contains(t) || it.name.uppercase(Locale.US).contains(t)) }
    return (first + then).take(limit)
}
