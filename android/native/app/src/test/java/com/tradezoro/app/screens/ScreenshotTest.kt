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
import com.tradezoro.app.ui.nav.ComingSoon
import com.tradezoro.app.ui.nav.HomeTopBar
import com.tradezoro.app.ui.nav.Tab
import com.tradezoro.app.ui.nav.TabTopBar
import com.tradezoro.app.ui.nav.TzBottomBar
import com.tradezoro.app.ui.theme.TradeZoroTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.RuntimeEnvironment
import kotlin.math.sin

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
        private val PRICES = listOf(21480.25 to 0.42, 5962.50 to 0.18, 21481.00 to 0.41, 5962.75 to 0.17, 2684.30 to -0.26, 68.42 to -0.73, 97310.0 to 1.12)
        fun sampleState(failLast: Boolean = false) = HomeUiState(
            DEFAULT_WATCHLIST.mapIndexed { i, s ->
                val (p, pct) = PRICES[i]
                val spark = List(24) { k -> p * (1 + pct / 100 * k / 23 + 0.0008 * sin(k * 0.9 + i)) }
                val q = Quote(p, p / (1 + pct / 100), spark, realtime = s.ticker == "BTC")
                WatchRow(s, if (failLast && i == DEFAULT_WATCHLIST.lastIndex) RowState.Failed(null) else RowState.Ready(q))
            },
            sample = true,
        )
    }

    private val name get() = (if (device.startsWith("w390")) "390" else "412") + "-" + (if (dark) "dark" else "light")

    private fun shoot(file: String, content: @Composable () -> Unit) {
        RuntimeEnvironment.setQualifiers("+$device-" + (if (dark) "night" else "notnight") + "-xxhdpi")
        rule.setContent { TradeZoroTheme(dark = dark) { content() } }
        rule.onRoot().captureRoboImage("screenshots/$file-$name.png")
    }

    @Composable
    private fun Shell(tab: Tab, body: @Composable (Modifier) -> Unit) {
        Scaffold(
            containerColor = MaterialTheme.colorScheme.background,
            topBar = { if (tab == Tab.HOME) HomeTopBar({}, {}) else TabTopBar(tab.label) },
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

    @Test fun charts() = shoot("3-charts-soon") {
        Shell(Tab.CHARTS) { m -> ComingSoon(Tab.CHARTS, "the next update", "/charts", m) }
    }
}

