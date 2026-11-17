package com.tradezoro.app.screens

import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.onNodeWithContentDescription
import com.tradezoro.app.data.LevelKind
import com.tradezoro.app.ui.common.LocalProbe
import com.tradezoro.app.ui.m4.BackTopBar
import com.tradezoro.app.ui.m4.JournalActions
import com.tradezoro.app.ui.m4.JournalContent
import com.tradezoro.app.ui.m4.LearnActions
import com.tradezoro.app.ui.m4.LearnContent
import com.tradezoro.app.ui.m4.OmegaActions
import com.tradezoro.app.ui.m4.OmegaContent
import com.tradezoro.app.ui.nav.MenuTopBar
import com.tradezoro.app.ui.nav.Tab
import com.tradezoro.app.ui.nav.TzBottomBar
import com.tradezoro.app.ui.theme.TradeZoroTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File
import kotlin.math.abs

/**
 * ALIGNMENT GATE for the M4 screens (Omega, Mentis, Nemesis), 412dp wide, xxhdpi (3 px per dp).
 * Parts hidden from semantics report their bounds through Modifier.probe. Numbers -> build/alignment-m4.txt.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w412dp-h915dp-night-xxhdpi")
class AlignmentM4Test {
    @get:Rule val rule = createComposeRule()
    private val log = StringBuilder()
    private val px = mutableMapOf<String, Rect>()
    private val W = 412f

    private data class B(val l: Float, val t: Float, val r: Float, val b: Float) { val cy get() = (t + b) / 2; val cx get() = (l + r) / 2; val w get() = r - l; val h get() = b - t }
    private fun p(name: String): B {
        val d = 3f   // xxhdpi
        val r = px[name] ?: error("no probe $name")
        return B(r.left / d, r.top / d, r.right / d, r.bottom / d).also {
            log.append(String.format("%-28s x=%6.1f y=%6.1f w=%6.1f h=%6.1f cy=%6.1f\n", name, it.l, it.t, it.w, it.h, it.cy))
        }
    }
    private fun cd(desc: String): B = rule.onNodeWithContentDescription(desc).getUnclippedBoundsInRoot().let {
        B(it.left.value, it.top.value, it.right.value, it.bottom.value).also { b -> log.append(String.format("%-28s x=%6.1f y=%6.1f w=%6.1f h=%6.1f cy=%6.1f\n", desc, b.l, b.t, b.w, b.h, b.cy)) }
    }
    private fun near(a: Float, b: Float, what: String, tol: Float = 1f) {
        log.append(String.format("  check %-46s %6.1f vs %6.1f -> %s\n", what, a, b, if (abs(a - b) <= tol) "PASS" else "FAIL"))
        assertEquals(what, b, a, tol)
    }
    private fun onGrid(v: Float, what: String) = near(v % 4f, 0f, "$what on 4-pt grid (${"%.1f".format(v)})", 0.6f)

    private fun show(top: @Composable () -> Unit, tab: Tab, body: @Composable (Modifier) -> Unit) {
        rule.setContent {
            CompositionLocalProvider(LocalProbe provides { n, r -> px[n] = r }) {
                TradeZoroTheme(dark = true) {
                    Scaffold(containerColor = MaterialTheme.colorScheme.background, topBar = top, bottomBar = { TzBottomBar(tab) {} }) { pad -> body(Modifier.padding(pad)) }
                }
            }
        }
        rule.waitForIdle()
    }

    @Test fun omega() {
        show({ BackTopBar("Omega", {}, {}) }, Tab.CHARTS) { m -> OmegaContent(M4Samples.omega, M4Samples.NOW_MS, OmegaActions(), m) }
        try {
            val back = cd("Back"); val bell = cd("Price alerts")
            near(back.cy, bell.cy, "top: back / bell centre"); near(back.l, W - bell.r, "top: left inset = right inset")
            val chips = listOf("MNQ", "MES", "MGC").map { p("chipv:$it") }
            chips.forEach { near(it.cy, chips[0].cy, "chip ${it.l} centre"); near(it.h, 32f, "chip height 32") }
            near(chips[0].l, 16f, "first chip on the 16 gutter")
            near(chips[1].l - chips[0].r, 8f, "chip gap 8"); near(chips[2].l - chips[1].r, 8f, "chip gap 8")
            val title = p("title"); val age = p("age")
            near(title.cy, age.cy, "section title / age chip centre"); near(W - age.r, 16f, "age chip right gutter 16")
            val stats = listOf("Net GEX", "Regime", "Spot vs flip").map { p("stat:$it") }
            stats.forEach { near(it.t, stats[0].t, "stat card top"); near(it.h, stats[0].h, "stat card height") }
            near(stats[0].l, 16f, "stats left gutter"); near(W - stats[2].r, 16f, "stats right gutter")
            near(stats[1].l - stats[0].r, 8f, "stat gap 8"); near(stats[2].l - stats[1].r, 8f, "stat gap 8")
            near(stats[0].w, stats[1].w, "stat widths equal", 0.5f); near(stats[1].w, stats[2].w, "stat widths equal", 0.5f)
            for (k in LevelKind.entries) {
                val row = p("lvl:$k"); val lab = p("lvl:$k:label"); val bar = p("lvl:$k:bar"); val v = p("lvl:$k:value")
                near(row.h, 48f, "$k row 48 (touch/readable)")
                near(lab.cy, row.cy, "$k label centre"); near(bar.cy, row.cy, "$k bar centre"); near(v.cy, row.cy, "$k value centre")
                near(lab.l, 32f, "$k label 32 from edge (16 + 16)"); near(W - v.r, 32f, "$k value 32 from edge")
                near(bar.l - lab.r, 12f, "$k label->bar gap 12"); near(v.l - bar.r, 12f, "$k bar->value gap 12")
            }
        } finally { File("build/alignment-m4-omega.txt").writeText(log.toString()) }
    }

    @Test fun mentis() {
        show({ MenuTopBar("Mentis", SampleAvatar, {}, {}) }, Tab.LEARN) { m -> LearnContent(M4Samples.learn, LearnActions(), m) }
        try {
            val icon = p("icon"); val kicker = p("kicker")
            near(icon.cy, kicker.cy, "continue: icon / kicker centre"); near(icon.l, 32f, "continue: icon 32 from edge")
            val btn = p("continue"); near(btn.h, 48f, "continue button 48"); near(btn.l, W - btn.r, "continue button insets equal")
            for (n in listOf("01", "02", "03", "04")) {
                val row = p("row:$n"); val ring = p("ring:$n"); val text = p("text:$n"); val chev = p("chev:$n")
                near(ring.cy, row.cy, "$n ring / row centre"); near(text.cy, ring.cy, "$n text centre"); near(chev.cy, ring.cy, "$n chevron centre")
                near(ring.l, 32f, "$n ring 32 from edge"); near(W - chev.r, 32f, "$n chevron 32 from edge")
                near(text.l - ring.r, 16f, "$n ring->text gap 16")
                near(ring.w, 48f, "$n ring 48")
            }
        } finally { File("build/alignment-m4-mentis.txt").writeText(log.toString()) }
    }

    @Test fun nemesis() {
        show({ MenuTopBar("Nemesis", SampleAvatar, {}, {}) }, Tab.JOURNAL) { m -> JournalContent(M4Samples.journal, M4Samples.month, M4Samples.today, JournalActions(), m) }
        try {
            val prev = p("prev"); val month = p("month"); val next = p("next")
            near(prev.cy, month.cy, "month header: prev / title centre"); near(next.cy, month.cy, "month header: next / title centre")
            near(prev.l, W - next.r, "month header insets equal"); near(month.cx, W / 2, "month title centred")
            near(prev.h, 48f, "month buttons 48")
            // Week rows: Mon..Fri share one centre, equal widths, gaps 8, row pitch 44 (36 + 8).
            val weeks = listOf(listOf(2, 3, 4, 5, 6), listOf(9, 10, 11, 12, 13), listOf(16, 17, 18, 19, 20))
            weeks.forEach { w ->
                val cells = w.map { p("day:$it") }
                cells.forEach { near(it.cy, cells[0].cy, "day ${w[0]} week centre"); near(it.w, cells[0].w, "day width equal", 0.5f) }
                (1 until 5).forEach { i -> near(cells[i].l - cells[i - 1].r, 8f, "day gap 8") }
                near(cells[0].l, 32f, "week left 32 (16 + 16)"); near(W - cells[4].r, 32f, "week right 32")
            }
            near(p("day:9").t - p("day:2").t, 44f, "week pitch 44")
            val s1 = p("stat:Win days"); val s2 = p("stat:Avg trade")
            near(s1.t, s2.t, "stats top"); near(s1.h, s2.h, "stats height"); near(s1.w, s2.w, "stats width", 0.5f); near(s2.l - s1.r, 8f, "stats gap 8")
            for (t in M4Samples.trades.take(3)) {
                val av = p("av:${t.id}"); val tx = p("tx:${t.id}"); val pnl = p("pnl:${t.id}")
                near(tx.cy, av.cy, "${t.id} text centre"); near(pnl.cy, av.cy, "${t.id} P&L centre")
                near(av.l, 32f, "${t.id} avatar 32 from edge"); near(W - pnl.r, 32f, "${t.id} P&L 32 from edge")
            }
            val fab = p("fab"); near(fab.w, 56f, "FAB 56"); near(W - fab.r, 16f, "FAB right 16")
        } finally { File("build/alignment-m4-nemesis.txt").writeText(log.toString()) }
    }
}
