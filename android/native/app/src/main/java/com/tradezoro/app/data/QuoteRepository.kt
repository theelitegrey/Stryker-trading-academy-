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
 *  futures, forex, indices: https://tradezoro.com/api/chart/bars/<ROOT>?tf=D (newest page) + tf=15 for the sparkline
 *  crypto:  public exchange klines (data-api mirror, as in assets/chart-*-provider.js)
 * [token] = the member's Firebase ID token, sent like assets/rt-access.js does: the SERVER decides real-time
 * (admins, members with the signed market data agreement, ...); without it futures come 10 minutes behind.
 */
class HttpQuoteRepository(
    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS).readTimeout(15, TimeUnit.SECONDS).build(),
    private val siteBase: String = "https://tradezoro.com",
    private val cryptoBase: String = "https://data-api.binance.vision/api/v3",
    private val token: suspend () -> String? = { null },
) : QuoteRepository {

    override suspend fun quote(symbol: WatchSymbol): Quote = coroutineScope {
        when (symbol.source) {
            Source.FUTURES, Source.FX, Source.INDEX -> {
                val auth = if (symbol.source == Source.FUTURES) runCatching { token() }.getOrNull() else null
                val base = "$siteBase/api/chart/bars/${symbol.chartTicker}"
                val dBody = async { get("$base?tf=D", auth) }
                val i = async { parseSiteBars(get("$base?tf=15", auth)) }
                val body = dBody.await()
                var (daily, rt) = parseSiteBars(body)
                // A fresh daily page can hold a single bar: then the previous close sits on the page before.
                val page = pageOf(body)
                if (daily.size < 2 && page != null && page > 0) daily = parseSiteBars(get("$base?tf=D&page=${page - 1}", auth)).first + daily
                // Forex / indices are not CME data: they carry no "delayed" state of their own.
                quoteFrom(daily, i.await().first, rt || symbol.source != Source.FUTURES) ?: throw IOException("no bars for ${symbol.ticker}")
            }
            Source.CRYPTO -> {
                val pair = symbol.chartTicker
                val d = async { parseKlines(get("$cryptoBase/klines?symbol=$pair&interval=1d&limit=2")) }
                val i = async { parseKlines(get("$cryptoBase/klines?symbol=$pair&interval=15m&limit=32")) }
                quoteFrom(d.await(), i.await(), realtime = true) ?: throw IOException("no bars for $pair")
            }
            Source.OTHER -> throw IOException("no quote source for ${symbol.id}")
        }
    }

    private fun pageOf(body: String): Int? = Regex("\"page\"\\s*:\\s*(\\d+)").find(body)?.groupValues?.get(1)?.toInt()

    private suspend fun get(url: String, auth: String? = null): String = withContext(Dispatchers.IO) {
        val b = Request.Builder().url(url).header("accept", "application/json")
        if (auth != null) b.header("authorization", "Bearer $auth")
        client.newCall(b.build()).execute().use { r ->
            if (!r.isSuccessful) throw IOException("HTTP ${r.code}")
            r.body?.string() ?: throw IOException("empty body")
        }
    }
}
