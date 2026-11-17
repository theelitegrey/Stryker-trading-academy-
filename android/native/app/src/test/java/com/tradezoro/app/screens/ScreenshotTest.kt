package com.tradezoro.app.screens

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Surface
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import com.github.takahirom.roborazzi.captureRoboImage
import com.tradezoro.app.data.DEFAULT_WATCHLIST
import com.tradezoro.app.data.DayPart
import com.tradezoro.app.data.Quote
import com.tradezoro.app.ui.auth.SignInContent
import com.tradezoro.app.ui.auth.SignInForm
import com.tradezoro.app.ui.home.HomeContent
import com.tradezoro.app.ui.home.HomeUiState
import com.tradezoro.app.ui.home.RowState
import com.tradezoro.app.ui.home.WatchRow
import com.tradezoro.app.ui.nav.MenuTopBar
import com.tradezoro.app.data.AlertsState
import com.tradezoro.app.data.OrderType
import com.tradezoro.app.data.PaperAcct
import com.tradezoro.app.data.PaperOrder
import com.tradezoro.app.data.PaperPos
import com.tradezoro.app.data.PaperSnapshot
import com.tradezoro.app.data.PaperSpec
import com.tradezoro.app.data.PaperTrade
import com.tradezoro.app.data.PriceAlert
import com.tradezoro.app.ui.alerts.AlertsActions
import com.tradezoro.app.ui.alerts.AlertsContent
import com.tradezoro.app.ui.alerts.AlertsTopBar
import com.tradezoro.app.ui.trade.Ticket
import com.tradezoro.app.ui.trade.TradeActions
import com.tradezoro.app.ui.trade.TradeContent
import com.tradezoro.app.ui.trade.TradeUiState
import com.tradezoro.app.ui.nav.HomeTopBar
import com.tradezoro.app.ui.nav.Tab
import com.tradezoro.app.ui.nav.TabTopBar
import com.tradezoro.app.ui.nav.TzBottomBar
import com.tradezoro.app.ui.theme.TradeZoroTheme
import com.tradezoro.app.data.Timeframe
import com.tradezoro.app.ui.chart.ChartActions
import com.tradezoro.app.ui.chart.ChartContent
import com.tradezoro.app.ui.chart.ChartTopBar
import com.tradezoro.app.ui.chart.ChartUiState
import com.tradezoro.app.ui.chart.ChartViewport
import com.tradezoro.app.ui.chart.DrawTool
import com.tradezoro.app.ui.chart.NativeChart
import com.tradezoro.app.ui.chart.PriceStyle
import com.tradezoro.app.data.FrameStore
import com.tradezoro.app.ui.m4.AddTradeForm
import com.tradezoro.app.ui.m4.BackTopBar
import com.tradezoro.app.ui.m4.GexState
import com.tradezoro.app.ui.m4.JournalActions
import com.tradezoro.app.ui.m4.JournalContent
import com.tradezoro.app.ui.m4.JournalState
import com.tradezoro.app.ui.m4.LearnActions
import com.tradezoro.app.ui.m4.LearnContent
import com.tradezoro.app.ui.m4.NewTrade
import com.tradezoro.app.ui.m4.OmegaActions
import com.tradezoro.app.ui.m4.OmegaContent
import com.tradezoro.app.ui.m4.OmegaUiState
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.RuntimeEnvironment
import kotlin.math.sin
import androidx.compose.ui.unit.dp

/** Screens rendered on the JVM (Robolectric + Roborazzi). PNGs land in app/screenshots/. */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35])
class ScreenshotTest(private val device: String, private val dark: Boolean) {
    @get:Rule val rule = createComposeRule()

    companion object {
        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "{0}-{1}")
        fun params() = listOf(
            arrayOf<Any>("w412dp-h915dp", true), arrayOf<Any>("w412dp-h915dp", false),
            arrayOf<Any>("w390dp-h844dp", true), arrayOf<Any>("w390dp-h844dp", false),
        )

        // Sample numbers for screenshots only; the screen labels them "Sample data".
        // NQ ES YM RTY GC CL EURUSD GBPUSD USDJPY BTC ETH (the site's default list).
        private val PRICES = listOf(21480.25 to 0.42, 5962.50 to 0.18, 43120.0 to 0.12, 2240.6 to -0.31, 2684.30 to -0.26, 68.42 to -0.73,
            1.0842 to 0.05, 1.2710 to -0.08, 151.42 to 0.21, 97310.0 to 1.12, 3420.5 to 0.86)
        private val SAMPLE_LISTS = listOf(
            com.tradezoro.app.data.Watchlist("sampleList0000000001", "Watchlist", com.tradezoro.app.data.DEFAULT_ITEMS),
            com.tradezoro.app.data.Watchlist("sampleList0000000002", "Metals", listOf("futures:GC1!", "futures:SI1!")),
        )
        fun sampleState(failLast: Boolean = false) = HomeUiState(
            DEFAULT_WATCHLIST.mapIndexed { i, s ->
                val (p, pct) = PRICES[i]
                val spark = List(24) { k -> p * (1 + pct / 100 * k / 23 + 0.0008 * sin(k * 0.9 + i)) }
                val q = Quote(p, p / (1 + pct / 100), spark, realtime = s.ticker == "BTC")
                WatchRow(s, if (failLast && i == DEFAULT_WATCHLIST.lastIndex) RowState.Failed(null) else RowState.Ready(q))
            },
            sample = true, lists = SAMPLE_LISTS, activeId = SAMPLE_LISTS[0].id, items = com.tradezoro.app.data.DEFAULT_ITEMS, loaded = true,
        )

        // Trade fixture, numbers from the mock; the screen labels it "Sample data".
        fun sampleTradeState() = TradeUiState(
            snap = PaperSnapshot(
                ready = true, on = true, sym = "MNQ1!", last = 21486.50,
                spec = PaperSpec("futures:MNQ1!", "futures", 0.25, 2.0),
                acct = PaperAcct(balance = 50000.0, equity = 50098.0, unrealized = 98.0, realized = 0.0, dayPnl = 0.0, start = 50000.0),
                positions = listOf(PaperPos("futures:MNQ1!", "buy", 2.0, 21462.0, 21486.5, 98.0)),
                orders = listOf(PaperOrder(7, "futures:MES1!", "buy", "limit", 1.0, 5940.25, sl = 5930.25)),
                trades = listOf(PaperTrade(5, "futures:MNQ1!", "sell", 1.0, 21510.0, 21495.5, 29.0, reason = "tp")),
            ),
            ticket = Ticket(qty = 2.0, slTicks = 40, tpTicks = 160),
            sample = true,
        )

        val SAMPLE_ALERTS = listOf(
            PriceAlert("1", "futures:NQ1!", "crossing_up", 21500.0, "Break of the high", "once", true),
            PriceAlert("2", "binance:BTCUSDT", "less", 64000.0, "", "every", true),
            PriceAlert("3", "futures:GC1!", "crossing", 2700.5, "", "once", false),
        )
    }

    // Fixture for the chart chrome only; the screen labels it "Sample data".
    private val WHEEL = listOf("futures:NQ1!", "futures:MNQ1!", "futures:ES1!", "futures:MES1!", "futures:GC1!")
    private fun sampleChart(paper: Boolean) = ChartUiState(
        ready = true, symbolId = "futures:MNQ1!", tf = Timeframe.M5, last = 27285.50, change = 0.14, changeFor = "MNQ1!", qty = 2.0,
        paperOn = paper, position = if (paper) "Long 2 @ 27,270.25" else null, sample = true,
    )

    private val name get() = (if (device.startsWith("w390")) "390" else "412") + "-" + (if (dark) "dark" else "light")

    private fun shoot(file: String, content: @Composable () -> Unit) {
        RuntimeEnvironment.setQualifiers("+$device-" + (if (dark) "night" else "notnight") + "-xxhdpi")
        rule.setContent { TradeZoroTheme(dark = dark) { content() } }
        rule.mainClock.advanceTimeBy(1000)   // debounced effects (search) settle before the shot
        rule.waitForIdle()
        rule.onRoot().captureRoboImage("screenshots/$file-$name.png")
    }

    @Composable
    private fun ChartShell(st: ChartUiState) {
        Scaffold(
            containerColor = MaterialTheme.colorScheme.background,
            topBar = { if (!st.fullscreen) ChartTopBar({}, {}, {}, state = st) },
            bottomBar = { if (!st.fullscreen) TzBottomBar(Tab.CHARTS) {} },
        ) { pad -> ChartContent(st, ChartActions(), Modifier.padding(pad), symbols = WHEEL) { m -> ChartPlaceholder(m) } }
    }

    @Composable
    private fun Shell(tab: Tab, body: @Composable (Modifier) -> Unit) {
        Scaffold(
            containerColor = MaterialTheme.colorScheme.background,
            topBar = { if (tab == Tab.HOME) HomeTopBar(SampleAvatar, {}, {}) else TabTopBar(tab.label) },
            bottomBar = { TzBottomBar(tab) {} },
        ) { pad -> body(Modifier.padding(pad)) }
    }

    @Test fun home() = shoot("1-home") {
        Shell(Tab.HOME) { m -> HomeContent(sampleState(), null, DayPart.MORNING, true, {}, {}, m) }
    }

    @Test fun homeLoadingAndError() = shoot("1b-home-loading") {
        val s = sampleState(failLast = true)
        Shell(Tab.HOME) { m ->
            HomeContent(s.copy(rows = s.rows.mapIndexed { i, r -> if (i in 2..3) r.copy(state = RowState.Loading) else r }), "Alex", DayPart.EVENING, false, {}, {}, m)
        }
    }

    @Test fun signIn() = shoot("2-signin") {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            SignInContent(SignInForm(email = "trader@example.com", error = "Incorrect email or password."), true, {}, {}, {}, {}, {}, {}, {})
        }
    }

    @Composable
    private fun TradeShell(st: TradeUiState) {
        Scaffold(
            containerColor = MaterialTheme.colorScheme.background,
            topBar = { MenuTopBar("Trade", SampleAvatar, {}, {}) },
            bottomBar = { TzBottomBar(Tab.TRADE) {} },
        ) { pad -> TradeContent(st, TradeActions(), Modifier.padding(pad)) }
    }

    @Test fun trade() = shoot("3-trade") { TradeShell(sampleTradeState()) }
    @Test fun tradeLimit() = shoot("3b-trade-limit") {
        val t = sampleTradeState()
        TradeShell(t.copy(ticket = t.ticket.copy(type = OrderType.LIMIT, priceText = "21484.00")))
    }
    @Test fun tradeOff() = shoot("3c-trade-paper-off") { TradeShell(sampleTradeState().let { it.copy(snap = it.snap.copy(on = false)) }) }

    @Composable
    private fun AlertsShell(st: AlertsState, pushOn: Boolean) {
        Scaffold(containerColor = MaterialTheme.colorScheme.background, topBar = { AlertsTopBar({}, {}) }) { pad ->
            AlertsContent(st, pushOn, AlertsActions(), Modifier.padding(pad), sample = true)
        }
    }

    @Test fun alerts() = shoot("5-alerts") { AlertsShell(AlertsState.Ready(SAMPLE_ALERTS), pushOn = true) }
    @Test fun alertsPushOff() = shoot("5b-alerts-push-off") { AlertsShell(AlertsState.Ready(SAMPLE_ALERTS.take(2)), pushOn = false) }
    @Test fun alertsSignedOut() = shoot("5c-alerts-signed-out") { AlertsShell(AlertsState.SignedOut, pushOn = false) }

    @Test fun chart() = shoot("4-chart") { ChartShell(sampleChart(paper = true)) }

    // ---- M5: native renderer on a real frame captured from tradezoro.com/charts (labelled "Sample data")
    private val frame by lazy { FrameStore().apply(javaClass.classLoader!!.getResource("frame-btc.json")!!.readText())!! }
    @Composable
    private fun NativeShell(style: PriceStyle, cross: Boolean = false, tool: DrawTool? = null) {
        val st = sampleChart(paper = true).copy(symbolId = "binance:BTCUSDT", tf = Timeframe.M15, last = frame.bars.c.last(), changeFor = "", qty = 0.01, position = null, tool = tool)
        val vp = androidx.compose.runtime.remember { ChartViewport().apply { spacing = 7f * 2.625f; if (cross) { crossX = 600f; crossY = 700f } } }
        Scaffold(
            containerColor = MaterialTheme.colorScheme.background,
            topBar = { ChartTopBar({}, {}, {}, state = st) },
            bottomBar = { TzBottomBar(Tab.CHARTS) {} },
        ) { pad -> ChartContent(st, ChartActions(), Modifier.padding(pad), symbols = WHEEL + "binance:BTCUSDT") { m -> NativeChart(frame, vp, style, m, tool = tool) } }
    }
    @Test fun nativeCandles() = shoot("9-native-candles") { NativeShell(PriceStyle.CANDLES) }
    @Test fun nativeCrosshair() = shoot("9b-native-crosshair") { NativeShell(PriceStyle.CANDLES, cross = true) }
    @Test fun nativeBars() = shoot("9c-native-bars") { NativeShell(PriceStyle.BARS) }
    @Test fun nativeLine() = shoot("9d-native-line") { NativeShell(PriceStyle.LINE) }
    @Test fun nativeArea() = shoot("9e-native-area") { NativeShell(PriceStyle.AREA, tool = DrawTool.TREND) }
    @Test fun chartPaperOff() = shoot("4b-chart-paper-off") { ChartShell(sampleChart(paper = false).copy(tf = Timeframe.M15)) }
    @Test fun chartFullscreen() = shoot("4c-chart-fullscreen") { ChartShell(sampleChart(paper = true).copy(fullscreen = true)) }

    // ---- M4: Omega, Mentis, Nemesis
    @Composable
    private fun M4Shell(top: @Composable () -> Unit, tab: Tab, body: @Composable (Modifier) -> Unit) {
        Scaffold(containerColor = MaterialTheme.colorScheme.background, topBar = top, bottomBar = { TzBottomBar(tab) {} }) { pad -> body(Modifier.padding(pad)) }
    }

    @Test fun omega() = shoot("6-omega") {
        M4Shell({ BackTopBar("Omega", {}, {}) }, Tab.CHARTS) { m -> OmegaContent(M4Samples.omega, M4Samples.NOW_MS, OmegaActions(), m) }
    }
    @Test fun omegaSignedOut() = shoot("6b-omega-signed-out") {
        M4Shell({ BackTopBar("Omega", {}, {}) }, Tab.CHARTS) { m -> OmegaContent(OmegaUiState(gex = GexState.SignedOut), M4Samples.NOW_MS, OmegaActions(), m) }
    }
    @Test fun learn() = shoot("7-mentis") {
        M4Shell({ MenuTopBar("Mentis", SampleAvatar, {}, {}) }, Tab.LEARN) { m -> LearnContent(M4Samples.learn, LearnActions(), m) }
    }
    @Test fun learnSignedOut() = shoot("7b-mentis-signed-out") {
        M4Shell({ MenuTopBar("Mentis", SampleAvatar, {}, {}) }, Tab.LEARN) { m -> LearnContent(M4Samples.learnSignedOut, LearnActions(), m) }
    }
    @Test fun journal() = shoot("8-nemesis") {
        M4Shell({ MenuTopBar("Nemesis", SampleAvatar, {}, {}) }, Tab.JOURNAL) { m -> JournalContent(M4Samples.journal, M4Samples.month, M4Samples.today, JournalActions(), m) }
    }
    @Test fun journalSignedOut() = shoot("8b-nemesis-signed-out") {
        M4Shell({ MenuTopBar("Nemesis", SampleAvatar, {}, {}) }, Tab.JOURNAL) { m -> JournalContent(JournalState.SignedOut, M4Samples.month, M4Samples.today, JournalActions(), m) }
    }
    @Test fun journalAdd() = shoot("8c-nemesis-add") {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.surface) {
            AddTradeForm(NewTrade(instrument = "MNQ", date = "2026-11-20", entry = "21462", exit = "21486.5", size = "4", fees = "1.24"), false, null, {}, {}, {})
        }
    }

    // ---- Owner feedback 17 Nov: account sheet, add symbol, trade sheet (3 tabs), signed-out sign-in
    @Test fun signInClean() = shoot("2b-signin-clean") {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            SignInContent(SignInForm(), true, {}, {}, {}, {}, {}, {}, {})
        }
    }
    @Test fun account() = shoot("10-account") {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.surface) {
            com.tradezoro.app.ui.account.AccountContent(
                com.tradezoro.app.auth.TzUser("u1", "alex@example.com", "Alex Lee", true), SampleAvatar, true,
                com.tradezoro.app.data.ThemeMode.SYSTEM, Timeframe.M5, true,
                com.tradezoro.app.data.DataAccess(signedIn = true, agreement = true, current = true),
                com.tradezoro.app.ui.account.AccountActions())
        }
    }
    @Test fun accountSignedOut() = shoot("10b-account-signed-out") {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.surface) {
            com.tradezoro.app.ui.account.AccountContent(null, null, true, com.tradezoro.app.data.ThemeMode.DARK, Timeframe.M15, false,
                com.tradezoro.app.data.DataAccess(signedIn = false), com.tradezoro.app.ui.account.AccountActions())
        }
    }
    @Test fun addSymbol() = shoot("11-add-symbol") {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.surface) {
            com.tradezoro.app.ui.home.AddSymbolContent("Watchlist", setOf("futures:NQ1!"), {}, initialQuery = "NQ")
        }
    }
    // M7: the website's own search (results as tradezoro.com/charts returned them for "XAU" on 17 Nov).
    @Test fun addSymbolSiteSearch() = shoot("11b-add-symbol-xau") {
        val site = com.tradezoro.app.data.parseFind("""[
            {"id":"bitget:XAUUSDT.P","t":"XAUUSDT.P","n":"XAU / USDT Perpetual","k":"Crypto","x":"Bitget","tick":0.01},
            {"id":"okx:XAU-USDT-SWAP","t":"XAU-USDT-SWAP","n":"XAU / USDT Perpetual","k":"Crypto","x":"OKX","tick":0.1},
            {"id":"kraken:XAUTUSD","t":"XAUTUSD","n":"Tether Gold / USD","k":"Crypto","x":"Kraken","tick":0.1},
            {"id":"futures:GC1!","t":"GC1!","n":"Gold futures","k":"Futures","x":"COMEX","tick":0.1},
            {"id":"futures:MGC1!","t":"MGC1!","n":"Micro gold futures","k":"Futures","x":"COMEX","tick":0.1}]""")
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.surface) {
            com.tradezoro.app.ui.home.AddSymbolContent("Watchlist", setOf("futures:GC1!"), {}, initialQuery = "XAU", search = { site })
        }
    }
    // M7: the Owner's list (futures saved under the site's default CRYPTO marker) shows one FUTURES header.
    @Test fun homeOwnerList() = shoot("1c-home-headers") {
        val items = listOf("###FUTURES", "futures:NQ1!", "###CRYPTO", "futures:MNQ1!", "futures:ES1!", "futures:MES1!", "futures:YM1!", "futures:MYM1!")
        val st = sampleState().let { b -> b.copy(items = items, rows = items.filterNot { it.startsWith("###") }.map { id -> b.rows.firstOrNull { it.symbol.id == id } ?: com.tradezoro.app.ui.home.WatchRow(com.tradezoro.app.data.symbolOf(id), b.rows[0].state) }) }
        Shell(Tab.HOME) { m -> HomeContent(st, null, DayPart.MORNING, true, {}, {}, m) }
    }
    @Composable
    private fun TradeSheet(tab: com.tradezoro.app.ui.trade.PanelTab) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.surface) {
            androidx.compose.foundation.layout.Box(Modifier.fillMaxSize().padding(top = 24.dp)) {
                com.tradezoro.app.ui.trade.TradeSheetContent(sampleTradeState().copy(tab = tab), TradeActions())
            }
        }
    }
    @Test fun tradeSheetScalp() = shoot("12-trade-sheet-scalp") { TradeSheet(com.tradezoro.app.ui.trade.PanelTab.SCALP) }
    @Test fun tradeSheetDom() = shoot("12b-trade-sheet-dom") { TradeSheet(com.tradezoro.app.ui.trade.PanelTab.DOM) }
    @Test fun tradeSheetOrder() = shoot("12c-trade-sheet-order") { TradeSheet(com.tradezoro.app.ui.trade.PanelTab.ORDER) }
}
