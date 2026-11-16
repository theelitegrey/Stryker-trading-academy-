package com.tradezoro.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.ZonedDateTime
import java.time.ZoneId

class QuotesTest {
    @Test fun parsesSiteBars() {
        val (bars, rt) = parseSiteBars("""{"s":"NQ","tf":"D","page":28,"rt":false,"bars":[[1794546000,28399.5,28608,27690.5,28034.75,3518091],[1794805200,28059.5,28279,27234.75,27301,3503242]]}""")
        assertFalse(rt)
        assertEquals(2, bars.size)
        assertEquals(1794805200L, bars[1].time)
        assertEquals(27301.0, bars[1].close, 0.0)
    }

    @Test fun parsesSiteBarsWithoutRtOrBars() {
        val (bars, rt) = parseSiteBars("""{"s":"NQ"}""")
        assertTrue(bars.isEmpty()); assertFalse(rt)
    }

    @Test fun parsesKlinesWithStringPrices() {
        val k = parseKlines("""[[1794614400000,"68314.01","68446.21","63320.00","64150.00","32674.75",1794700799999,"0",1,"0","0","0"]]""")
        assertEquals(1794614400L, k[0].time)
        assertEquals(64150.0, k[0].close, 0.0)
    }

    @Test fun quoteUsesPreviousDailyCloseAndNewestIntraday() {
        val daily = listOf(Bar(200, 0.0, 0.0, 0.0, 110.0, 0.0), Bar(100, 0.0, 0.0, 0.0, 100.0, 0.0))
        val intra = listOf(Bar(210, 0.0, 0.0, 0.0, 111.0, 0.0), Bar(220, 0.0, 0.0, 0.0, 112.0, 0.0))
        val q = quoteFrom(daily, intra, realtime = false)!!
        assertEquals(112.0, q.last, 0.0)
        assertEquals(12.0, q.changePct!!, 1e-9)
        assertEquals(listOf(111.0, 112.0), q.spark)
    }

    @Test fun staleIntradayDoesNotOverrideDaily() {
        val daily = listOf(Bar(100, 0.0, 0.0, 0.0, 100.0, 0.0), Bar(200, 0.0, 0.0, 0.0, 105.0, 0.0))
        val q = quoteFrom(daily, listOf(Bar(150, 0.0, 0.0, 0.0, 99.0, 0.0)), realtime = true)!!
        assertEquals(105.0, q.last, 0.0)
    }

    @Test fun singleDailyBarHasNoChange() {
        val q = quoteFrom(listOf(Bar(100, 0.0, 0.0, 0.0, 100.0, 0.0)), emptyList(), true)!!
        assertNull(q.changePct)
        assertNull(quoteFrom(emptyList(), emptyList(), true))
    }

    @Test fun normaliseAndFormat() {
        assertEquals(listOf(0f, 0.5f, 1f), normalise(listOf(10.0, 15.0, 20.0)))
        assertEquals(listOf(0.5f, 0.5f), normalise(listOf(3.0, 3.0)))
        assertEquals("21,480.25", formatPrice(21480.25, 2))
        assertEquals("97,310", formatPrice(97310.4, 0))
        assertEquals("+0.42%", formatPct(0.4199))
        assertEquals("\u22120.26%", formatPct(-0.26))
    }

    private fun ny(y: Int, mo: Int, d: Int, h: Int, mi: Int) = ZonedDateTime.of(y, mo, d, h, mi, 0, 0, ZoneId.of("America/New_York")).toInstant()

    @Test fun futuresHours() {
        // 2026-11-16 is a Monday.
        assertTrue(isFuturesMarketOpen(ny(2026, 11, 16, 10, 0)))
        assertFalse(isFuturesMarketOpen(ny(2026, 11, 16, 17, 30)))   // daily break
        assertTrue(isFuturesMarketOpen(ny(2026, 11, 16, 18, 0)))
        assertFalse(isFuturesMarketOpen(ny(2026, 11, 20, 17, 0)))    // Friday close
        assertFalse(isFuturesMarketOpen(ny(2026, 11, 21, 12, 0)))    // Saturday
        assertFalse(isFuturesMarketOpen(ny(2026, 11, 22, 17, 59)))   // Sunday before open
        assertTrue(isFuturesMarketOpen(ny(2026, 11, 22, 18, 0)))
    }

    @Test fun dayParts() {
        assertEquals(DayPart.MORNING, dayPart(9)); assertEquals(DayPart.AFTERNOON, dayPart(13)); assertEquals(DayPart.EVENING, dayPart(22))
    }
}
