package com.tradezoro.app.data

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test

/** Hits the real public endpoints. Off by default; run with TZ_LIVE=1 ./gradlew testDebugUnitTest --tests '*LiveQuotes*'. */
class LiveQuotesSmokeTest {
    @Test fun everyWatchlistSymbolQuotes() = runBlocking {
        assumeTrue(System.getenv("TZ_LIVE") == "1")
        val repo = HttpQuoteRepository()
        val out = StringBuilder()
        DEFAULT_WATCHLIST.forEach { s ->
            val q = repo.quote(s)
            println("LIVE ${s.ticker} last=${q.last} pct=${q.changePct} spark=${q.spark.size} rt=${q.realtime}")
            assertTrue(s.ticker, q.last > 0 && q.changePct != null && q.spark.size > 1)
            out.append("${s.ticker};${q.last};${q.prevClose};${q.realtime};${q.spark.joinToString(",")}\n")
        }
        // Handed to LiveHomeShot (OkHttp inside the Robolectric sandbox hangs, so the shot reads these).
        java.io.File("build/live").mkdirs(); java.io.File("build/live/quotes.txt").writeText(out.toString())
    }
}
