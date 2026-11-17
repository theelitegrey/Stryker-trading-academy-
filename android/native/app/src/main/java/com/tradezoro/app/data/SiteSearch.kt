package com.tradezoro.app.data

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.IOException

/*
 * The website's OWN symbol search and quotes, run by the chart page the app keeps loaded (chart-bridge.js TZB.run):
 *  find  = assets/chart-search-core.js search() over the chart's full pool (futures, every crypto venue, stocks + the
 *          server stock search, forex, indices), ids normalised by assets/chart-watchlist.js normalizeSymbol, so the
 *          results, ranking and stored ids are the website's (Owner bug 17 Nov: "XAU" found nothing).
 *  quote = daily + 15-minute bars through the chart's own provider (the site watchlist's quote()), for symbols the app
 *          has no direct source for (stocks, other crypto venues).
 */
private val json = Json { ignoreUnknownKeys = true }

/** TZB.take() answer {ok, v|e} -> the "v" JSON, or null when the page failed. */
fun jobValue(raw: String): String? = runCatching {
    val o = json.parseToJsonElement(raw).jsonObject
    if (o["ok"]?.jsonPrimitive?.booleanOrNull == true) o["v"]?.toString() else null
}.getOrNull()

/** find results [{id,t,n,c,k,x,tick}] -> rows. */
fun parseFind(v: String): List<Cat> = runCatching {
    json.parseToJsonElement(v).jsonArray.mapNotNull { e ->
        val o = e as? JsonObject ?: return@mapNotNull null
        fun s(k: String) = o[k]?.jsonPrimitive?.contentOrNull.orEmpty()
        val id = canonicalId(s("id")).takeIf { it.contains(':') } ?: return@mapNotNull null
        Cat(id, s("n").ifEmpty { s("t") }, s("x"), o["tick"]?.jsonPrimitive?.doubleOrNull ?: 0.0, ticker = s("t").ifEmpty { id.substringAfter(':') }, kind = s("k").ifEmpty { kindOf(id) })
    }.distinctBy { it.id }
}.getOrDefault(emptyList())

/** quote result {d:[[t,o,h,l,c,v]..], i:[..]} (times in ms or s) -> Quote. */
fun parsePageQuote(v: String): Quote? = runCatching {
    val o = json.parseToJsonElement(v).jsonObject
    fun bars(k: String) = (o[k] as? JsonArray).orEmpty().map { el ->
        val a = el.jsonArray
        fun d(i: Int) = a.getOrNull(i)?.jsonPrimitive?.doubleOrNull ?: 0.0
        val t = d(0).toLong()
        Bar(if (t > 100_000_000_000L) t / 1000 else t, d(1), d(2), d(3), d(4), d(5))
    }
    quoteFrom(bars("d"), bars("i"), realtime = true)
}.getOrNull()

/** Symbols the app's own sources cannot quote (stocks, other crypto venues) are quoted through the chart page. */
class PageQuoteRepository(
    private val direct: QuoteRepository,
    private val page: suspend (kind: String, arg: String) -> String?,
) : QuoteRepository {
    override suspend fun quote(symbol: WatchSymbol): Quote =
        if (symbol.source != Source.OTHER) direct.quote(symbol)
        else page("quote", symbol.id)?.let(::parsePageQuote) ?: throw IOException("no quote for ${symbol.id}")
}
