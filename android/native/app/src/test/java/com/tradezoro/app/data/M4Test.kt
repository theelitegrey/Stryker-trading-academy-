package com.tradezoro.app.data

import com.tradezoro.app.ui.m4.GexState
import com.tradezoro.app.ui.m4.NewTrade
import com.tradezoro.app.ui.m4.OmegaViewModel
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException
import java.time.LocalDate
import java.time.YearMonth

class M4Test {
    private val fixture = javaClass.classLoader!!.getResource("gex-QQQ-0.json")!!.readText()

    // ---- Omega: real API response from the site's own test fixture (tools/tests/fixtures/gex/QQQ-0.json)
    @Test fun parsesFuturesLevelsFromTheApi() {
        val v = parseGex(fixture, GexMarket.MNQ)!!
        assertEquals(31332.75, v.spot, 1e-9)
        assertEquals(listOf(LevelKind.IV_HI, LevelKind.CALL_WALL, LevelKind.ZERO_GAMMA, LevelKind.SPOT, LevelKind.PUT_WALL, LevelKind.IV_LO), v.levels.map { it.kind })
        assertEquals(31451.68, v.levels.first { it.kind == LevelKind.CALL_WALL }.price, 1e-9)
        assertEquals(false, v.positive)          // regime NEGATIVE
        assertEquals(-1452338769.27, v.netGex!!, 1.0)
        assertEquals(1791387482.0, v.dataTs!!, 0.0)   // market.options_ts, as the site's dataTime()
        assertEquals(31332.75 - 31433.13, v.spotVsFlip!!, 1e-6)
        assertEquals(LevelKind.ZERO_GAMMA, v.above!!.kind)
        assertEquals(LevelKind.PUT_WALL, v.below!!.kind)
    }

    @Test fun missingContractOrErrorGivesNull() {
        assertNull(parseGex(fixture, GexMarket.MGC))
        assertNull(parseGex("""{"futures":{"MES":{"error":"no quote"}}}""", GexMarket.MES))
    }

    @Test fun gexWordingMatchesTheSite() {
        val now = 1_000_000_000_000L
        assertEquals("GEX live", gexAgo(now / 1000.0 - 30, now))
        assertEquals("GEX updated 5 min ago", gexAgo(now / 1000.0 - 300, now))
        assertEquals("GEX updated 3 h ago", gexAgo(now / 1000.0 - 3 * 3600, now))
        assertEquals("GEX updated time unknown", gexAgo(null, now))
        assertEquals("\u22121.45B", formatGex(-1.452e9))
        assertEquals("+640M", formatGex(6.4e8))
        val s = gexSummary(parseGex(fixture, GexMarket.MNQ)!!)
        assertTrue(s, s.startsWith("Spot sits between the put wall and the zero gamma."))
        assertTrue(s.contains("swings can be bigger"))
    }

    @Test fun omegaVmMapsSignInAndKeepsLastGoodLevels() = runTest {
        val good = parseGex(fixture, GexMarket.MNQ)!!
        var mode = 0
        val vm = OmegaViewModel { if (mode == 0) good else if (mode == 1) throw IOException("x") else throw SignInRequired() }
        vm.refresh(); assertTrue(vm.state.value.gex is GexState.Ready)
        mode = 1; vm.refresh()
        val f = vm.state.value.gex as GexState.Failed
        assertEquals(good, f.last)
        mode = 2; vm.refresh(); assertEquals(GexState.SignedOut, vm.state.value.gex)
    }

    // ---- Mentis
    private val chapters = listOf(
        Chapter("02", "Two", "core", listOf("a", "b")), Chapter("01", "One", "core", listOf("a", "b", "c")),
        Chapter("VP-01", "Profile", "vp", listOf("a")), Chapter("PF-01", "Prop", "pf", listOf("a", "b")),
    )

    @Test fun learnModelFollowsCoursesJs() {
        val none = learnModel(chapters, emptySet())
        assertEquals(listOf("Core curriculum", "Volume Profile & Order Flow", "Prop Firm Mastery"), none.sections.map { it.first })
        assertEquals(listOf("01", "02"), none.sections[0].second.map { it.chapter.num })
        assertNull(none.cont)                      // not started: no continue banner
        val m = learnModel(chapters, setOf("01-0", "01-2", "VP-01-0"))
        assertEquals(2, m.doneLessons); assertEquals(5, m.totalLessons)
        assertEquals("01", m.cont!!.chapter.num); assertEquals(1, m.cont!!.lessonIndex); assertEquals(67, m.sections[0].second[0].pct)
        val coreDone = learnModel(chapters, setOf("01-0", "01-1", "01-2", "02-0", "02-1"))
        assertNull(coreDone.cont); assertEquals(5, coreDone.doneLessons)
    }

    @Test fun seedFileParses() {
        val f = java.io.File("src/main/assets/chapters-seed.json")
        val list = parseSeed(f.readText())
        assertTrue(list.size >= 42)
        assertEquals("01", list.first().num)
        assertTrue(list.all { it.lessons.isNotEmpty() })
    }

    // ---- Nemesis
    @Test fun pnlMatchesJournalCalc() {
        assertEquals(98.0 - 2.0, journalPnl("long", 100.0, 149.0, 2.0, 2.0)!!, 1e-9)
        assertEquals(10.0, journalPnl("short", 105.0, 100.0, 2.0, null)!!, 1e-9)
        assertNull(journalPnl("long", null, 1.0, 1.0, 0.0))
        assertEquals("Breakeven", journalResult(0.0))
    }

    @Test fun tradeMappingSkipsReservedDocsAndDerivesMissingPnl() {
        assertNull(journalTradeFrom("_settings", mapOf("date" to "2026-11-02")))
        val t = journalTradeFrom("x", mapOf("date" to "2026-11-02", "instrument" to "NQ", "direction" to "short",
            "entryPrice" to "100", "exitPrice" to "90", "positionSize" to "1", "fees" to 0))!!
        assertEquals(10.0, t.pnl!!, 1e-9)
        assertEquals(42.5, journalTradeFrom("y", mapOf("date" to "2026-11-02", "pnl" to 42.5))!!.pnl!!, 1e-9)
    }

    @Test fun calendarAndStats() {
        val nov = YearMonth.of(2026, 11)   // 1 Nov 2026 is a Sunday: first weekday is Mon 2
        val trades = listOf(
            JournalTrade("1", "NQ", "long", "2026-11-02", null, 1.0, 100.0), JournalTrade("2", "NQ", "long", "2026-11-02", null, 1.0, -40.0),
            JournalTrade("3", "ES", "short", "2026-11-03", null, 1.0, -20.0), JournalTrade("4", "ES", "short", "2026-10-30", null, 1.0, 5.0),
            JournalTrade("5", "ES", "long", "2026-11-04", null, 1.0, null),
        )
        val cells = monthCells(nov, trades)
        assertEquals(LocalDate.of(2026, 11, 2), cells.first()!!.date)          // no lead blanks: Monday
        assertEquals(21, cells.size)                                            // weekdays in Nov 2026
        assertEquals(60.0, cells[0]!!.pnl!!, 1e-9)
        assertNull(cells[2]!!.pnl); assertEquals(1, cells[2]!!.trades)          // open trade only
        val s = monthStats(nov, trades)
        assertEquals(1, s.winDays); assertEquals(2, s.tradedDays); assertEquals(3, s.closed)
        assertEquals(40.0 / 3, s.avgTrade!!, 1e-9)
        assertEquals(3, monthCells(YearMonth.of(2026, 10), emptyList()).indexOfFirst { it != null })   // 1 Oct 2026 = Thursday
        assertEquals("\u2212$42.50", formatUsd(-42.5)); assertEquals("+$1,021.40", formatUsd(1021.4))
    }

    @Test fun newTradeValidatesAndWritesTheSiteShape() {
        assertNotNull(NewTrade(entry = "", exit = "1").error)
        assertNotNull(NewTrade(entry = "1", exit = "2", size = "0").error)
        assertNotNull(NewTrade(date = "2026-13-01", entry = "1", exit = "2").error)
        val ok = NewTrade(instrument = "mnq", direction = "short", date = "2026-11-10", entry = "21500", exit = "21480.5", size = "2", fees = "1")
        assertNull(ok.error)
        val d = ok.doc()
        assertEquals("MNQ", d["instrument"]); assertEquals("21500.0", d["entryPrice"]); assertEquals(38.0, d["pnl"] as Double, 1e-9)
        assertEquals("Win", d["result"])
        assertTrue(d.keys.containsAll(listOf("stopLoss", "takeProfit", "session", "setup", "tags", "notes", "rMultiple")))
    }
}
