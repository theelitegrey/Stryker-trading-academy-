package com.tradezoro.app.screens

import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import com.github.takahirom.roborazzi.captureRoboImage
import com.tradezoro.app.data.DEFAULT_WATCHLIST
import com.tradezoro.app.data.Quote
import com.tradezoro.app.data.dayPart
import com.tradezoro.app.data.isFuturesMarketOpen
import com.tradezoro.app.ui.home.HomeContent
import com.tradezoro.app.ui.home.HomeUiState
import com.tradezoro.app.ui.home.RowState
import com.tradezoro.app.ui.home.WatchRow
import com.tradezoro.app.ui.nav.HomeTopBar
import com.tradezoro.app.ui.nav.Tab
import com.tradezoro.app.ui.nav.TzBottomBar
import com.tradezoro.app.ui.theme.TradeZoroTheme
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.time.Instant
import java.time.LocalTime

/** Home with REAL quotes fetched by LiveQuotesSmokeTest from the live endpoints. Off by default (TZ_LIVE=1); the PNG is evidence, not a golden. */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w412dp-h915dp-night-xxhdpi")
class LiveHomeShot {
    @get:Rule val rule = createComposeRule()

    @Test fun liveHome() {
        assumeTrue(System.getenv("TZ_LIVE") == "1")
        val f = java.io.File("build/live/quotes.txt")
        assumeTrue("run LiveQuotesSmokeTest first", f.exists())
        val got = f.readLines().filter { it.isNotBlank() }.associate { l ->
            val p = l.split(';')
            p[0] to Quote(p[1].toDouble(), p[2].toDoubleOrNull(), p[4].split(',').map { it.toDouble() }, p[3].toBoolean())
        }
        val state = HomeUiState(DEFAULT_WATCHLIST.map { s -> WatchRow(s, got[s.ticker]?.let { RowState.Ready(it) } ?: RowState.Failed(null)) })
        rule.setContent {
            TradeZoroTheme(dark = true) {
                Scaffold(containerColor = MaterialTheme.colorScheme.background, topBar = { HomeTopBar(SampleAvatar, {}, {}) }, bottomBar = { TzBottomBar(Tab.HOME) {} }) { pad ->
                    HomeContent(state, null, dayPart(LocalTime.now().hour), isFuturesMarketOpen(Instant.now()), {}, {}, Modifier.padding(pad))
                }
            }
        }
        rule.onRoot().captureRoboImage("build/live/1-home-live-412-dark.png")
    }
}
