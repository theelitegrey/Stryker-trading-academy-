package com.tradezoro.app.screens

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.DpRect
import com.github.takahirom.roborazzi.captureRoboImage
import com.tradezoro.app.data.AndroidRelease
import com.tradezoro.app.data.DayPart
import com.tradezoro.app.data.Dl
import com.tradezoro.app.data.UpdateKind
import com.tradezoro.app.data.UpdateUiState
import com.tradezoro.app.ui.common.UpdateBanner
import com.tradezoro.app.ui.common.UpdateRequired
import com.tradezoro.app.ui.home.HomeContent
import com.tradezoro.app.ui.nav.HomeTopBar
import com.tradezoro.app.ui.nav.Tab
import com.tradezoro.app.ui.nav.TzBottomBar
import com.tradezoro.app.ui.theme.TradeZoroTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File
import kotlin.math.abs

/** Update banner + blocking screen with a fake manifest (Sample data), shots + alignment numbers. */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35])
class UpdateBannerTest(private val device: String, private val dark: Boolean) {
    @get:Rule val rule = createComposeRule()

    companion object {
        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "{0}-{1}")
        fun params() = listOf(
            arrayOf<Any>("w412dp-h915dp", true), arrayOf<Any>("w412dp-h915dp", false),
            arrayOf<Any>("w390dp-h844dp", true), arrayOf<Any>("w390dp-h844dp", false),
        )
        val REL = AndroidRelease(10, "2.1.0", "/downloads/tradezoro-android-beta.apk", listOf("Update banner: new versions install from inside the app."), 8)
    }

    private val name get() = (if (device.startsWith("w390")) "390" else "412") + "-" + (if (dark) "dark" else "light")
    private val log = StringBuilder()

    private fun shoot(file: String, s: UpdateUiState) {
        RuntimeEnvironment.setQualifiers("+$device-" + (if (dark) "night" else "notnight") + "-xxhdpi")
        rule.setContent {
            TradeZoroTheme(dark = dark) {
                Scaffold(containerColor = MaterialTheme.colorScheme.background, topBar = { HomeTopBar(SampleAvatar, {}, {}) }, bottomBar = { TzBottomBar(Tab.HOME) {} }) { pad ->
                    Box(Modifier.padding(pad)) {
                        HomeContent(ScreenshotTest.sampleState(), null, DayPart.MORNING, true, {}, {})
                        UpdateBanner(s, {}, {})
                    }
                }
                UpdateRequired(s, {})
            }
        }
        rule.mainClock.advanceTimeBy(500); rule.waitForIdle()
        rule.onRoot().captureRoboImage("screenshots/$file-$name.png")
    }

    private fun b(tag: String): DpRect = rule.onNodeWithTag(tag, useUnmergedTree = true).getUnclippedBoundsInRoot().also {
        log.append(String.format("%-16s x=%6.1f y=%6.1f w=%6.1f h=%6.1f cy=%6.1f\n", tag, it.left.value, it.top.value, (it.right - it.left).value, (it.bottom - it.top).value, ((it.top + it.bottom) / 2).value))
    }
    private val DpRect.cy get() = ((top + bottom) / 2).value
    private fun near(a: Float, b: Float, what: String) {
        log.append(String.format("  check %-36s %6.1f vs %6.1f -> %s\n", what, a, b, if (abs(a - b) <= 1f) "PASS" else "FAIL")); assertEquals(what, a, b, 1f)
    }

    @Test fun banner() {
        shoot("13-update-banner", UpdateUiState(REL, UpdateKind.BANNER))
        val card = b("update-banner"); val pill = b("update-pill"); val x = b("update-close"); val title = b("update-title")
        near(pill.cy, card.cy, "pill centred in card"); near(x.cy, card.cy, "X centred in card")
        near(card.left.value, 12f, "card left inset"); val w = rule.onRoot().getUnclippedBoundsInRoot().right.value; near(w - card.right.value, 12f, "card right inset")
        assertTrue("title inside card", title.left >= card.left && title.right <= pill.left)
        File("build/alignment-update-$name.txt").writeText(log.toString())
    }

    @Test fun downloading() = shoot("13b-update-downloading", UpdateUiState(REL, UpdateKind.BANNER, Dl.Running(14_200_000, 23_600_000)))

    @Test fun required() {
        shoot("13c-update-required", UpdateUiState(REL, UpdateKind.BLOCKING))
        val pill = b("update-pill"); val root = b("update-required")
        near((pill.left + pill.right).value / 2, (root.left + root.right).value / 2, "pill centred on screen")
        File("build/alignment-update-required-$name.txt").writeText(log.toString())
    }
}
