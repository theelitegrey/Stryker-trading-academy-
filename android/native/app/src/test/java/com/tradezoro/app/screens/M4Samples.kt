package com.tradezoro.app.screens

import com.tradezoro.app.data.Chapter
import com.tradezoro.app.data.GexLevel
import com.tradezoro.app.data.GexMarket
import com.tradezoro.app.data.GexView
import com.tradezoro.app.data.JournalTrade
import com.tradezoro.app.data.LevelKind
import com.tradezoro.app.data.learnModel
import com.tradezoro.app.ui.m4.GexState
import com.tradezoro.app.ui.m4.JournalState
import com.tradezoro.app.ui.m4.LearnState
import com.tradezoro.app.ui.m4.OmegaUiState
import java.time.LocalDate
import java.time.YearMonth

/** Screenshot fixtures for M4. Numbers from the approved mock; every screen labels them "Sample data". */
object M4Samples {
    val NOW_MS = 1_800_000_000_000L
    val omega = OmegaUiState(
        GexMarket.MNQ,
        GexState.Ready(GexView(
            GexMarket.MNQ, spot = 21486.0, netGex = 2.1e9, positive = true,
            levels = listOf(
                GexLevel(LevelKind.IV_HI, 21640.0), GexLevel(LevelKind.CALL_WALL, 21550.0), GexLevel(LevelKind.ZERO_GAMMA, 21500.0),
                GexLevel(LevelKind.SPOT, 21486.0), GexLevel(LevelKind.PUT_WALL, 21400.0), GexLevel(LevelKind.IV_LO, 21330.0),
            ),
            dataTs = NOW_MS / 1000.0 - 20, stale = false,
        ), sample = true),
    )

    private val chapters = listOf(
        Chapter("01", "Candles, Charts & the Language of Price", "core", List(6) { "Lesson ${it + 1}" }),
        Chapter("02", "How Markets Are Actually Structured", "core", listOf("Retail vs. institutional order flow", "Swing highs and lows") + List(8) { "L$it" }),
        Chapter("03", "Liquidity and Where Stops Sit", "core", List(8) { "L$it" }),
        Chapter("04", "Order Blocks", "core", List(7) { "L$it" }),
    )
    private val done = (0..5).map { "01-$it" }.toSet() + setOf("02-0") + (0..2).map { "03-$it" }
    val learn = LearnState.Ready(learnModel(chapters, done), signedIn = true, sample = true)
    val learnSignedOut = LearnState.Ready(learnModel(chapters, emptySet()), signedIn = false, sample = true)

    val month: YearMonth = YearMonth.of(2026, 11)
    val today: LocalDate = LocalDate.of(2026, 11, 20)
    private val pnl = listOf(98.0, 54.0, -42.5, 61.0, 0.0, -27.0, 33.0, 135.0, 12.0, -18.0, 40.0, null, 22.0, -60.0, 75.0, 30.0, 18.0, -12.0, 44.0, 26.0)
    private val syms = listOf("MNQ", "MES", "NQ", "MNQ")
    val trades: List<JournalTrade> = buildList {
        var d = LocalDate.of(2026, 11, 2)
        var i = 0
        while (d <= today) {
            if (d.dayOfWeek.value <= 5) {
                val p = pnl[i % pnl.size]
                if (p != 0.0) add(JournalTrade("t$i", syms[i % 4], if (i % 3 == 1) "short" else "long", d.toString(), "10:${10 + i}", (1 + i % 3).toDouble(), p))
                i++
            }
            d = d.plusDays(1)
        }
    }.sortedByDescending { it.date }
    val journal = JournalState.Ready(trades, sample = true)
}

/** Profile button fixture (initials; no photo in tests). */
val SampleAvatar = com.tradezoro.app.ui.nav.Avatar("AL")
