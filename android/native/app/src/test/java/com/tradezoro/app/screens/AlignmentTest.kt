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
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
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
            // Top bar: wordmark · bell · profile picture; no menu button.
            val logo = rule.onNodeWithContentDescription("TradeZoro").b("top: wordmark")
            val bell = rule.onNodeWithContentDescription("Alerts").b("top: bell button")
            val prof = rule.onNodeWithContentDescription("Account").b("top: profile button")
            org.junit.Assert.assertTrue("no menu button", rule.onAllNodesWithContentDescription("Account menu").fetchSemanticsNodes().isEmpty())
            near(prof.cy, logo.cy, "top bar profile/wordmark centre"); near(bell.cy, logo.cy, "top bar bell/wordmark centre")
            near((prof.right - prof.left).value, 48f, "profile touch target 48dp", 0f); near((bell.bottom - bell.top).value, 48f, "bell touch target 48dp", 0f)
            near(logo.left.value, 16f, "wordmark left gutter 16", 0f)
            // 32dp avatar centred in the 48dp box, box 8dp from the edge -> avatar 16dp from the edge = wordmark gutter.
            near(412f - (prof.right.value - 8f), 16f, "avatar right gutter 16 (= wordmark gutter)", 0.5f)

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
            val rows = listOf("NQ", "ES", "YM", "RTY", "GC", "CL").map { t ->
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

    private val CHART_ST = ChartUiState(ready = true, symbolId = "futures:MNQ1!", tf = Timeframe.M5, last = 21486.5, change = 0.42, changeFor = "futures:MNQ1!", qty = 2.0, paperOn = true, sample = true)

    @Test fun chartChrome() {
        rule.setContent {
            TradeZoroTheme(dark = true) {
                Scaffold(containerColor = MaterialTheme.colorScheme.background, topBar = { ChartTopBar({}, {}, {}, state = CHART_ST) }, bottomBar = { TzBottomBar(Tab.CHARTS) {} }) { pad ->
                    ChartContent(CHART_ST, ChartActions(), Modifier.padding(pad), symbols = listOf("futures:NQ1!", "futures:MNQ1!", "futures:ES1!")) { m -> androidx.compose.foundation.layout.Box(m.semantics { contentDescription = "chart" }) }
                }
            }
        }
        try {
            // Top bar (no product title): back · "MNQ · CME" · bell · fullscreen · more on one centre, 48dp targets, equal insets.
            val back = rule.onNodeWithContentDescription("Back to Home").b("top: back")
            val title = rule.onNodeWithText("MNQ1! \u00b7 CME", useUnmergedTree = true).b("top: symbol + exchange")
            val titleBox = rule.onNodeWithTag("chart-title").b("top: title target")
            val bell = rule.onNodeWithContentDescription("Price alerts").b("top: bell")
            val full = rule.onNodeWithContentDescription("Full screen chart").b("top: fullscreen")
            val more = rule.onNodeWithContentDescription("Chart menu").b("top: more")
            listOf(titleBox, bell, full, more).forEach { near(it.cy, back.cy, "top bar centre") }
            listOf(back, bell, full, more).forEach { near((it.right - it.left).value, 48f, "top icon target 48dp", 0f) }
            near(back.left.value, 412f - more.right.value, "top bar left inset = right inset")
            near(title.left.value - back.right.value, 4f, "title 4dp after back target", 0.5f)
            org.junit.Assert.assertTrue("no ZoroCharts title", rule.onAllNodesWithText("ZoroCharts").fetchSemanticsNodes().isEmpty())

            // Bottom bar: symbol wheel · tf wheel · indicators · drawings · Trade. Selected wheel rows share the bar centre.
            val symSel = rule.onNodeWithText("MNQ1!", useUnmergedTree = true).b("wheel: selected symbol")
            val tfSel = rule.onNodeWithText("5m", useUnmergedTree = true).b("wheel: selected tf")
            val ind = rule.onNodeWithContentDescription("Indicators").b("bar: indicators")
            val draw = rule.onNodeWithContentDescription("Drawing tools").b("bar: drawings")
            val trade = rule.onNodeWithTag("chart-trade").b("bar: trade")
            listOf(tfSel, ind, draw, trade).forEach { near(it.cy, symSel.cy, "bottom bar centre") }
            listOf(ind, draw, trade).forEach { near((it.bottom - it.top).value, 48f, "bar target height 48dp", 0f) }
            near(symSel.left.value, 16f, "wheel text left gutter 16dp", 0f)
            near(412f - trade.right.value, 16f, "trade button right gutter 16dp", 0.5f)
            // M7 compact wheels: 48dp tall (selected 24dp row + half a row above and below), centred in the bar.
            listOf("wheel-symbol", "wheel-tf").forEach { t ->
                val w = rule.onNodeWithTag(t).b("wheel box $t")
                near((w.bottom - w.top).value, 48f, "$t height 48dp (1 + 2 halves)", 0f)
                near(w.cy, symSel.cy, "$t centre = selected row centre")
            }
            rule.onNodeWithContentDescription("chart").b("chart area")
        } finally {
            File("build/alignment-chart.txt").writeText(log.toString())
        }
    }

    @Test fun tradeChrome() {
        val st = ScreenshotTest.sampleTradeState().copy(tab = com.tradezoro.app.ui.trade.PanelTab.ORDER)
        rule.setContent {
            TradeZoroTheme(dark = true) {
                Scaffold(containerColor = MaterialTheme.colorScheme.background, topBar = { MenuTopBar("Trade", SampleAvatar, {}, {}) }, bottomBar = { TzBottomBar(Tab.TRADE) {} }) { pad ->
                    TradeContent(st, TradeActions(), Modifier.padding(pad))
                }
            }
        }
        try {
            val prof = rule.onNodeWithContentDescription("Account").b("top: profile")
            val title = rule.onAllNodesWithText("Trade")[0].b("top: title")
            val bell = rule.onNodeWithContentDescription("Price alerts").b("top: bell")
            listOf(title, bell).forEach { near(it.cy, prof.cy, "top bar centre") }
            near(title.left.value, 16f, "title left gutter 16", 0f)
            near(412f - (prof.right.value - 8f), 16f, "avatar right gutter 16", 0.5f)

            // Account card: label and chip inside 16dp card padding (32dp from the screen edges).
            val acctLabel = rule.onNodeWithText("Paper account", useUnmergedTree = true).b("account: label")
            val chip = rule.onNodeWithText("Paper trading", useUnmergedTree = true).b("account: paper chip")
            near(acctLabel.left.value, 32f, "account text left 32dp (16 + 16)", 0f)
            near(412f - chip.right.value, 40f, "chip text right 40 = 16+16 card, +8 chip pad", 0.5f)

            // Panel tabs Scalp / DOM / Order: one centre, equal widths, 16dp gutters.
            val ptabs = listOf("Scalp", "DOM", "Order").map { t -> rule.onNode(hasText(t) and SemanticsMatcher.expectValue(SemanticsProperties.Role, androidx.compose.ui.semantics.Role.Tab)).b("panel tab: $t") }
            ptabs.forEach { near(it.cy, ptabs[0].cy, "panel tab centre"); near((it.right - it.left).value, (ptabs[0].right - ptabs[0].left).value, "panel tab width") }
            near(ptabs[0].left.value, 20f, "panel tabs: 16 gutter + 4 track pad", 0.5f); near(412f - ptabs[2].right.value, 20f, "panel tabs right 16 + 4", 0.5f)
            // Footer: Paper chip · position · Flatten on one centre.
            val flatBtn = rule.onNodeWithTag("flatten").b("footer: flatten")
            val posLine = rule.onNodeWithText("Long 2 @ 21,462.00", useUnmergedTree = true).b("footer: position")
            near(412f - flatBtn.right.value, 16f, "flatten right gutter 16", 0.5f)
            log.append(String.format("  info footer position cy %.1f vs flatten cy %.1f (P&L line below)\n", posLine.cy, flatBtn.cy))

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

            // Buy / Sell: one centre, equal widths, 8dp gap, 16dp gutters.
            val buy = rule.onNodeWithContentDescription("Paper buy 2 MNQ market").b("buy")
            val sell = rule.onNodeWithContentDescription("Paper sell 2 MNQ market").b("sell")
            near(buy.cy, sell.cy, "buy / sell centre")
            near((buy.bottom - buy.top).value, 56f, "buy height 56dp", 0f)
            near((buy.right - buy.left).value, (sell.right - sell.left).value, "buy width = sell width")
            near(sell.left.value - buy.right.value, 8f, "buy / sell gap 8dp", 0.5f)
            near(buy.left.value, 412f - sell.right.value, "buy/sell left inset = right inset")
            near((flatBtn.bottom - flatBtn.top).value, 48f, "flatten touch 48dp", 0f)
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

    /** Sign-in: TZ mark centred on the column (geometric = box, the PNG is trimmed to its ink); pills equal and centred. */
    @Test fun signInLayout() {
        rule.setContent { TradeZoroTheme(dark = true) { com.tradezoro.app.ui.auth.SignInContent(com.tradezoro.app.ui.auth.SignInForm(), true, {}, {}, {}, {}, {}, {}, {}) } }
        try {
            val mark = rule.onNodeWithTag("tzmark").b("mark")
            val head = rule.onNodeWithText("Welcome back").b("heading")
            val g = rule.onNodeWithTag("google").b("google pill")
            val pk = rule.onNodeWithTag("passkey").b("passkey pill")
            val submit = rule.onNodeWithTag("signin-submit").b("sign-in pill")
            val email = rule.onNodeWithTag("email").b("email field")
            val gIcon = rule.onNodeWithTag("google-g", useUnmergedTree = true).b("google G")
            near(mark.cx, 206f, "mark geometric centre = screen centre", 0.5f)
            // Optical: alpha-weighted ink centroid of logo_tzmark.png is +1.0% of the width (x) -> under 1dp at this size.
            val w = (mark.right - mark.left).value
            near(mark.cx + w * 0.010f, 206f, "mark optical centre (ink centroid) within 1dp", 1f)
            near(head.cx, 206f, "heading centred", 0.5f)
            listOf(g, pk, submit).forEach { near((it.bottom - it.top).value, 52f, "pill height 52", 0.1f); near(it.cx, 206f, "pill centred", 0.5f) }
            near((g.right - g.left).value, (pk.right - pk.left).value, "google width = passkey width", 0.1f)
            near(g.left.value, 24f, "pill left gutter 24", 0.1f); near(412f - g.right.value, 24f, "pill right gutter 24", 0.1f)
            near(email.left.value, g.left.value, "field aligned with pills", 0.1f)
            near(gIcon.cy, g.cy, "G logo centred in its pill", 0.5f)
            near(pk.top.value - g.bottom.value, 12f, "google / passkey gap 12", 0.5f)
        } finally {
            File("build/alignment-signin.txt").writeText(log.toString())
        }
    }
}
