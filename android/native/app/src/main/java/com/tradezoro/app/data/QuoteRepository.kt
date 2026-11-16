package com.tradezoro.app.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.IOException
import java.util.concurrent.TimeUnit

interface QuoteRepository {
    /** Fetches one quote. Throws on network/parse failure. */
    suspend fun quote(symbol: WatchSymbol): Quote
}

/**
 * Same public endpoints the site's watchlist uses (assets/chart-watchlist.js):
 *  futures: https://tradezoro.com/api/chart/bars/<ROOT>1!?tf=D (newest page) + tf=15 for the sparkline
 *  crypto:  public exchange klines (data-api mirror, as in assets/chart-*-provider.js)
 */
class HttpQuoteRepository(
    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS).readTimeout(15, TimeUnit.SECONDS).build(),
    private val siteBase: String = "https://tradezoro.com",
    private val cryptoBase: String = "https://data-api.binance.vision/api/v3",
) : QuoteRepository {

    override suspend fun quote(symbol: WatchSymbol): Quote = coroutineScope {
        when (symbol.source) {
            Source.FUTURES -> {
                val base = "$siteBase/api/chart/bars/${symbol.ticker}1!"
                val dBody = async { get("$base?tf=D") }
                val i = async { parseSiteBars(get("$base?tf=15")) }
                val body = dBody.await()
                var (daily, rt) = parseSiteBars(body)
                // A fresh daily page can hold a single bar: then the previous close sits on the page before.
                val page = pageOf(body)
                if (daily.size < 2 && page != null && page > 0) daily = parseSiteBars(get("$base?tf=D&page=${page - 1}")).first + daily
                quoteFrom(daily, i.await().first, rt) ?: throw IOException("no bars for ${symbol.ticker}")
            }
            Source.CRYPTO -> {
                val pair = "${symbol.ticker}USDT"
                val d = async { parseKlines(get("$cryptoBase/klines?symbol=$pair&interval=1d&limit=2")) }
                val i = async { parseKlines(get("$cryptoBase/klines?symbol=$pair&interval=15m&limit=32")) }
                quoteFrom(d.await(), i.await(), realtime = true) ?: throw IOException("no bars for $pair")
            }
        }
    }

    private fun pageOf(body: String): Int? = Regex("\"page\"\\s*:\\s*(\\d+)").find(body)?.groupValues?.get(1)?.toInt()

    private suspend fun get(url: String): String = withContext(Dispatchers.IO) {
        client.newCall(Request.Builder().url(url).header("accept", "application/json").build()).execute().use { r ->
            if (!r.isSuccessful) throw IOException("HTTP ${r.code}")
            r.body?.string() ?: throw IOException("empty body")
        }
    }
}
