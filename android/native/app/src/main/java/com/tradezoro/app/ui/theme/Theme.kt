package com.tradezoro.app.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

/** Colours that Material's scheme has no slot for. Values from the approved app mock. */
@Immutable
data class TzColors(
    val up: Color,          // profits, up candles, live dot; text-safe on the background
    val down: Color,
    val muted: Color,       // secondary text
    val hairline: Color,    // card borders
    val selected: Color,    // selected chip / nav pill
    val navBar: Color,
)

val Mint = Color(0xFF03C988)
val OnMint = Color(0xFF04251A)

private val DarkTz = TzColors(
    up = Mint, down = Color(0xFFFF4D5E), muted = Color(0xFF8E8E93),
    hairline = Color(0xFF26262A), selected = Color(0xFF2A2A2E), navBar = Color(0xFF141416),
)
private val LightTz = TzColors(
    // Darker mint/red on white so text keeps WCAG AA (4.5:1).
    up = Color(0xFF00805A), down = Color(0xFFD12A3B), muted = Color(0xFF6E6E73),
    hairline = Color(0xFFE2E2E6), selected = Color(0xFFE6E6EA), navBar = Color(0xFFFFFFFF),
)

private val DarkScheme = darkColorScheme(
    primary = Mint, onPrimary = OnMint,
    background = Color(0xFF0A0A0B), onBackground = Color(0xFFECECEE),
    surface = Color(0xFF141416), onSurface = Color(0xFFECECEE),
    surfaceVariant = Color(0xFF1C1C1F), onSurfaceVariant = Color(0xFF8E8E93),
    surfaceContainer = Color(0xFF141416), surfaceContainerHigh = Color(0xFF1C1C1F),
    secondaryContainer = Color(0xFF2A2A2E), onSecondaryContainer = Color.White,
    outline = Color(0xFF3A3A3F), outlineVariant = Color(0xFF26262A),
    error = Color(0xFFFF4D5E), onError = Color(0xFF2A060B),
)
private val LightScheme = lightColorScheme(
    primary = Color(0xFF00805A), onPrimary = Color.White,
    background = Color(0xFFF5F5F7), onBackground = Color(0xFF111113),
    surface = Color.White, onSurface = Color(0xFF111113),
    surfaceVariant = Color(0xFFF0F0F2), onSurfaceVariant = Color(0xFF6E6E73),
    surfaceContainer = Color.White, surfaceContainerHigh = Color(0xFFF0F0F2),
    secondaryContainer = Color(0xFFE6E6EA), onSecondaryContainer = Color(0xFF111113),
    outline = Color(0xFFC7C7CC), outlineVariant = Color(0xFFE2E2E6),
    error = Color(0xFFD12A3B), onError = Color.White,
)

/** Type scale from the mock / design standard (Roboto, the platform font). */
val TzTypography = Typography(
    headlineSmall = TextStyle(fontSize = 24.sp, lineHeight = 28.sp, fontWeight = FontWeight.Medium),
    titleLarge = TextStyle(fontSize = 22.sp, lineHeight = 28.sp, fontWeight = FontWeight.Medium),
    titleMedium = TextStyle(fontSize = 16.sp, lineHeight = 22.sp, fontWeight = FontWeight.Medium),
    titleSmall = TextStyle(fontSize = 15.sp, lineHeight = 20.sp, fontWeight = FontWeight.SemiBold),
    bodyLarge = TextStyle(fontSize = 16.sp, lineHeight = 22.sp),
    bodyMedium = TextStyle(fontSize = 14.sp, lineHeight = 20.sp),
    bodySmall = TextStyle(fontSize = 13.sp, lineHeight = 18.sp),
    labelLarge = TextStyle(fontSize = 13.sp, lineHeight = 18.sp, fontWeight = FontWeight.Medium),
    labelMedium = TextStyle(fontSize = 12.sp, lineHeight = 16.sp, fontWeight = FontWeight.Medium),
    labelSmall = TextStyle(fontSize = 11.sp, lineHeight = 14.sp, letterSpacing = 0.3.sp),
)

/** Prices: tabular figures so columns don't jitter as they update. */
val Tabular = TextStyle(fontFeatureSettings = "tnum")

val LocalTz = staticCompositionLocalOf { DarkTz }

@Composable
fun TradeZoroTheme(dark: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    CompositionLocalProvider(LocalTz provides if (dark) DarkTz else LightTz) {
        MaterialTheme(colorScheme = if (dark) DarkScheme else LightScheme, typography = TzTypography, content = content)
    }
}

object Tz { val colors: TzColors @Composable get() = LocalTz.current }
