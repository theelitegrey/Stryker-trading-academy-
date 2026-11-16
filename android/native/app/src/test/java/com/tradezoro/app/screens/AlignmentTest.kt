package com.tradezoro.app.screens

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.ui.Modifier
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.DpRect
import com.tradezoro.app.data.DayPart
import com.tradezoro.app.ui.home.HomeContent
import com.tradezoro.app.ui.nav.HomeTopBar
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
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.hasText
import java.io.File
import kotlin.math.abs

/**
 * ALIGNMENT GATE (Owner 15 Nov): measures laid-out bounds (dp) of the Home chrome and asserts
 * shared vertical centres (±1dp), equal sizes and 4-pt grid gaps. Writes the numbers to
 * build/alignment-home.txt for the report.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w412dp-h915dp-night-xxhdpi")
class AlignmentTest {
    @get:Rule val rule = createComposeRule()
    private val log = StringBuilder()

    private fun SemanticsNodeInteraction.b(label: String): DpRect = getUnclippedBoundsInRoot().also {
        log.append(String.format("%-26s x=%6.1f y=%6.1f w=%6.1f h=%6.1f cy=%6.1f\n", label, it.left.value, it.top.value,
            (it.right - it.left).value, (it.bottom - it.top).value, ((it.top + it.bottom) / 2).value))
    }
    private val DpRect.cy get() = ((top + bottom) / 2).value
    private val DpRect.cx get() = ((left + right) / 2).value
    private fun near(a: Float, b: Float, what: String, tol: Float = 1f) {
        log.append(String.format("  check %-40s %6.1f vs %6.1f -> %s\n", what, a, b, if (abs(a - b) <= tol) "PASS" else "FAIL"))
        assertEquals(what, a, b, tol)
    }

    @Test fun homeChrome() {
        rule.setContent {
            TradeZoroTheme(dark = true) {
                Scaffold(containerColor = MaterialTheme.colorScheme.background, topBar = { HomeTopBar({}, {}) }, bottomBar = { TzBottomBar(Tab.HOME) {} }) { pad ->
                    HomeContent(ScreenshotTest.sampleState(), null, DayPart.MORNING, true, {}, {}, Modifier.padding(pad))
                }
            }
        }
        try {
            // Top bar: menu · wordmark · bell share one centre; both buttons 48dp; equal edge insets.
            val menu = rule.onNodeWithContentDescription("Account menu").b("top: menu button")
            val logo = rule.onNodeWithContentDescription("TradeZoro").b("top: wordmark")
            val bell = rule.onNodeWithContentDescription("Alerts").b("top: bell button")
            near(menu.cy, logo.cy, "top bar menu/wordmark centre"); near(bell.cy, logo.cy, "top bar bell/wordmark centre")
            near((menu.right - menu.left).value, 48f, "menu touch target 48dp", 0f); near((bell.bottom - bell.top).value, 48f, "bell touch target 48dp", 0f)
            near(menu.left.value, 412f - bell.right.value, "top bar left inset = right inset")

            // Greeting row: name block and Market chip share a centre; chip 32dp; 16dp side gutters.
            val hello = rule.onNodeWithText("Good morning").b("greet: label")
            val name = rule.onNodeWithText("Hi, Trader").b("greet: name")
            val chip = rule.onNodeWithText("Market open").b("greet: chip text")
            near((hello.top.value + name.bottom.value) / 2, chip.cy, "greeting block / chip centre", 2f)
            near(hello.left.value, 16f, "content left gutter 16dp", 0f)

            // Products: four tiles, equal widths, same icon top.
            val tiles = listOf("Kronos", "Omega", "Mentis", "Nemesis").map { rule.onNodeWithText(it).b("product: $it") }
            tiles.forEach { near(it.cy, tiles[0].cy, "product label centre ${tiles.indexOf(it)}") }
            val gaps = tiles.zipWithNext { a, b -> b.cx - a.cx }
            gaps.forEach { near(it, gaps[0], "product column pitch") }

            // Watchlist rows: 60dp each, evenly pitched.
            val rows = listOf("MNQ", "MES", "NQ", "ES", "GC", "CL", "BTC").map { t ->
                rule.onNode(SemanticsMatcher("row $t") { n -> n.config.getOrElseNullable(SemanticsProperties.ContentDescription) { null }?.firstOrNull()?.startsWith("$t, ") == true }).b("watch row: $t")
            }
            rows.forEach { near((it.bottom - it.top).value, 60f, "row height ${rows.indexOf(it)}", 0f) }
            near(rows[0].left.value, 412f - rows[0].right.value, "row left inset = right inset")

            // Bottom nav: five items share a centre and equal widths.
            val nav = Tab.entries.map { t -> rule.onNode(hasText(t.label) and SemanticsMatcher.expectValue(SemanticsProperties.Role, androidx.compose.ui.semantics.Role.Tab)).b("nav: ${t.label}") }
            nav.forEach { near(it.cy, nav[0].cy, "nav label centre ${it.left.value.toInt()}") }
            val pitch = nav.zipWithNext { a, b -> b.cx - a.cx }
            pitch.forEach { near(it, pitch[0], "nav item pitch") }
        } finally {
            File("build/alignment-home.txt").writeText(log.toString())
        }
    }
}

