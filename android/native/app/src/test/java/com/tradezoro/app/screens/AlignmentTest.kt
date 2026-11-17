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
import com.tradezoro.app.data.Timeframe
import com.tradezoro.app.ui.chart.ChartActions
import com.tradezoro.app.ui.chart.ChartContent
import com.tradezoro.app.ui.chart.ChartTopBar
import com.tradezoro.app.ui.chart.ChartUiState
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
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
import androidx.compose.ui.test.onAllNodesWithText
import com.tradezoro.app.data.AlertsState
import com.tradezoro.app.ui.alerts.AlertsActions
import com.tradezoro.app.ui.alerts.AlertsContent
import com.tradezoro.app.ui.alerts.AlertsTopBar
import com.tradezoro.app.ui.nav.MenuTopBar
import com.tradezoro.app.ui.trade.TradeActions
import com.tradezoro.app.ui.trade.TradeContent
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
                Scaffold(containerColor = MaterialTheme.colorScheme.background, topBar = { HomeTopBar(SampleAvatar, {}, {}) }, bottomBar = { TzBottomBar(Tab.HOME) {} }) { pad ->
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

    @Test fun chartChrome() {
        rule.setContent {
            TradeZoroTheme(dark = true) {
                Scaffold(containerColor = MaterialTheme.colorScheme.background, topBar = { ChartTopBar({}, {}, {}) }, bottomBar = { TzBottomBar(Tab.CHARTS) {} }) { pad ->
                    ChartContent(ChartUiState(ready = true, symbolId = "MNQ1!", tf = Timeframe.M5, last = 21486.5, change = 0.42, changeFor = "MNQ1!", qty = 2.0, paperOn = true, position = "Long 2 @ 21,470.25", sample = true),
                        ChartActions(), Modifier.padding(pad)) { m -> androidx.compose.foundation.layout.Box(m.semantics { contentDescription = "chart" }) }
                }
            }
        }
        try {
            // Top bar: back · title · fullscreen · more on one centre, 48dp targets, equal insets.
            val back = rule.onNodeWithContentDescription("Back to Home").b("top: back")
            val title = rule.onNodeWithText("ZoroCharts").b("top: title")
            val full = rule.onNodeWithContentDescription("Full screen chart").b("top: fullscreen")
            val more = rule.onNodeWithContentDescription("Chart menu").b("top: more")
            listOf(title, full, more).forEach { near(it.cy, back.cy, "top bar centre") }
            listOf(back, full, more).forEach { near((it.right - it.left).value, 48f, "top icon target 48dp", 0f) }
            near(back.left.value, 412f - more.right.value, "top bar left inset = right inset")

            // Symbol row: symbol button and price share a centre; 16dp gutters.
            val sym = rule.onNodeWithContentDescription("Symbol MNQ, 5m. Change symbol").b("sym: button")
            val price = rule.onNodeWithText("21,486.50", substring = true).b("sym: price")
            near(sym.cy, price.cy, "symbol / price centre")
            near(sym.left.value, 16f, "symbol left gutter 16dp", 0f)
            near(412f - price.right.value, 16f, "price right gutter 16dp", 0.5f)

            // Tool row: 5 chips + 3 tools on one centre; chips 48dp touch; tools 48dp; right gutter 16.
            val chips = listOf("1m", "5m", "15m", "1H", "D").map { rule.onNodeWithContentDescription("Timeframe $it").b("tf chip: $it") }
            val tools = listOf("Indicators", "Drawing tools", "Price alerts").map { rule.onNodeWithContentDescription(it).b("tool: $it") }
            (chips + tools).forEach { near(it.cy, chips[0].cy, "tool row centre") }
            chips.forEach { near((it.bottom - it.top).value, 48f, "chip touch height 48dp", 0f) }
            chips.forEach { near((it.right - it.left).value, 48f, "chip touch width 48dp", 0f) }
            chips.zipWithNext { a, b -> near(b.left.value - a.right.value, 0f, "chip touch boxes abut (visual gap 8dp)", 0.5f) }
            // visual chip = 40dp centred in the 48dp box -> visual left edge = box + 4
            near(chips[0].left.value + 4f, 16f, "first chip visual left gutter 16dp", 0f)
            // last glyph (24dp centred in 48dp) -> glyph right edge = box right - 12
            near(412f - (tools.last().right.value - 12f), 16f, "last tool glyph right gutter 16dp", 0.5f)
            val free = tools.first().left.value - chips.last().right.value
            log.append(String.format("  check %-40s %6.1f >= 0 -> %s\n", "space between chips and tools (no clip)", free, if (free >= 0) "PASS" else "FAIL"))
            org.junit.Assert.assertTrue("chips clipped", free >= 0f)

            // Trade row: Sell · stepper · Buy, one centre, all 48dp tall, equal Sell/Buy widths, 8dp gaps.
            val sell = rule.onNodeWithContentDescription("Paper sell 2 MNQ at market").b("trade: sell")
            val minus = rule.onNodeWithContentDescription("Less quantity").b("trade: minus")
            val qty = rule.onNodeWithContentDescription("Quantity 2").b("trade: qty")
            val plus = rule.onNodeWithContentDescription("More quantity").b("trade: plus")
            val buy = rule.onNodeWithContentDescription("Paper buy 2 MNQ at market").b("trade: buy")
            listOf(minus, qty, plus, buy).forEach { near(it.cy, sell.cy, "trade row centre") }
            listOf(sell, minus, plus, buy).forEach { near((it.bottom - it.top).value, 48f, "trade control height 48dp", 0f) }
            near((sell.right - sell.left).value, (buy.right - buy.left).value, "sell width = buy width")
            near(minus.left.value - sell.right.value, 8f, "sell/stepper gap 8dp", 0.5f)
            near(buy.left.value - plus.right.value, 8f, "stepper/buy gap 8dp", 0.5f)
            near(sell.left.value, 412f - buy.right.value, "trade row left inset = right inset")

            // Position line and Paper chip share a centre.
            val pos = rule.onNodeWithText("Long 2 @ 21,470.25").b("strip: position")
            val chip = rule.onNodeWithText("Paper trading").b("strip: paper chip")
            near(pos.cy, chip.cy, "position / paper chip centre")
            near(412f - chip.right.value, 16f, "paper chip right gutter 16dp", 0.5f)
            rule.onNodeWithContentDescription("chart").b("chart area")
        } finally {
            File("build/alignment-chart.txt").writeText(log.toString())
        }
    }

    @Test fun tradeChrome() {
        val st = ScreenshotTest.sampleTradeState()
        rule.setContent {
            TradeZoroTheme(dark = true) {
                Scaffold(containerColor = MaterialTheme.colorScheme.background, topBar = { MenuTopBar("Trade", SampleAvatar, {}, {}) }, bottomBar = { TzBottomBar(Tab.TRADE) {} }) { pad ->
                    TradeContent(st, TradeActions(), Modifier.padding(pad))
                }
            }
        }
        try {
            val menu = rule.onNodeWithContentDescription("Account menu").b("top: menu")
            val title = rule.onAllNodesWithText("Trade")[0].b("top: title")
            val bell = rule.onNodeWithContentDescription("Price alerts").b("top: bell")
            listOf(title, bell).forEach { near(it.cy, menu.cy, "top bar centre") }
            near(menu.left.value, 412f - bell.right.value, "top bar left inset = right inset")

            // Account card: label and chip inside 16dp card padding (32dp from the screen edges).
            val acctLabel = rule.onNodeWithText("Paper account", useUnmergedTree = true).b("account: label")
            val chip = rule.onNodeWithText("Paper trading", useUnmergedTree = true).b("account: paper chip")
            near(acctLabel.left.value, 32f, "account text left 32dp (16 + 16)", 0f)
            near(412f - chip.right.value, 40f, "chip text right 40 = 16+16 card, +8 chip pad", 0.5f)

            // Order type tabs: equal widths, one centre.
            val tabs = listOf("Market", "Limit", "Stop").map { t -> rule.onNode(hasText(t) and SemanticsMatcher.expectValue(SemanticsProperties.Role, androidx.compose.ui.semantics.Role.Tab)).b("tab: $t") }
            tabs.forEach { near(it.cy, tabs[0].cy, "type tab centre"); near((it.right - it.left).value, (tabs[0].right - tabs[0].left).value, "type tab width") }
            near(tabs[0].left.value, 16f, "tabs left gutter 16", 0f); near(412f - tabs[2].right.value, 16f, "tabs right gutter 16", 0.5f)

            // Field rows: steppers vertically centred on the text block; chips 16dp inside the field border; text 16dp inside.
            for ((label, what) in listOf("Quantity (contracts)" to "quantity", "Stop loss" to "stop loss", "Take profit" to "take profit")) {
                val lab = rule.onNodeWithText(label).b("field: $label")
                val minus = rule.onNodeWithContentDescription("Less $what").b("field: $what minus")
                val plus = rule.onNodeWithContentDescription("More $what").b("field: $what plus")
                near(minus.cy, plus.cy, "$what steppers share a centre")
                near((minus.bottom - minus.top).value, 48f, "$what stepper touch 48dp", 0f)
                near(lab.left.value, 32f, "$what text 16dp inside field", 0f)
                near(412f - (plus.right.value - 4f), 32f, "$what chip 16dp inside field", 0.5f)
                near(plus.left.value - minus.right.value, 0f, "$what touch boxes abut (visual gap 8dp)", 0.5f)
            }

            // Buy / Sell: one centre, 56dp, equal widths, 8dp gap, 16dp gutters. Flatten: full width.
            val buy = rule.onNodeWithContentDescription("Paper buy 2 MNQ market").b("buy")
            val sell = rule.onNodeWithContentDescription("Paper sell 2 MNQ market").b("sell")
            near(buy.cy, sell.cy, "buy / sell centre")
            near((buy.bottom - buy.top).value, 56f, "buy height 56dp", 0f)
            near((buy.right - buy.left).value, (sell.right - sell.left).value, "buy width = sell width")
            near(sell.left.value - buy.right.value, 8f, "buy / sell gap 8dp", 0.5f)
            near(buy.left.value, 412f - sell.right.value, "buy/sell left inset = right inset")
            val flat = rule.onNodeWithText("Flatten all", useUnmergedTree = true).b("flatten (text)")
            near(flat.cx, 206f, "flatten text centred", 1f)
        } finally {
            File("build/alignment-trade.txt").writeText(log.toString())
        }
    }

    @Test fun alertsRows() {
        rule.setContent {
            TradeZoroTheme(dark = true) {
                Scaffold(containerColor = MaterialTheme.colorScheme.background, topBar = { AlertsTopBar({}, {}) }) { pad ->
                    AlertsContent(AlertsState.Ready(ScreenshotTest.SAMPLE_ALERTS), true, AlertsActions(), Modifier.padding(pad), sample = true)
                }
            }
        }
        try {
            val back = rule.onNodeWithContentDescription("Back").b("top: back")
            val add = rule.onNodeWithContentDescription("New alert on the chart").b("top: new")
            near(back.cy, add.cy, "top bar centre"); near(back.left.value, 412f - add.right.value, "top bar left inset = right inset")
            for (a in ScreenshotTest.SAMPLE_ALERTS) {
                val text = rule.onNodeWithText("${a.ticker} \u00b7 ${a.condLabel}", substring = true, useUnmergedTree = true).b("row: ${a.ticker} title")
                val sw = rule.onNodeWithContentDescription("Alert ${a.ticker} ${a.condLabel}", substring = true).b("row: ${a.ticker} switch")
                val del = rule.onNodeWithContentDescription("Delete alert ${a.ticker}", substring = true).b("row: ${a.ticker} delete")
                near(sw.cy, del.cy, "${a.ticker} switch / delete centre")
                near(text.left.value, 16f, "${a.ticker} text left gutter 16", 0f)
                near(412f - (del.right.value - 12f), 16f, "${a.ticker} delete glyph right gutter 16", 0.5f)
            }
        } finally {
            File("build/alignment-alerts.txt").writeText(log.toString())
        }
    }
}
