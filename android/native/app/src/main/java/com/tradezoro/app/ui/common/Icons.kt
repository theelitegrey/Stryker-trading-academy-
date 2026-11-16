package com.tradezoro.app.ui.common

import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.unit.dp

/** 24dp stroke icons, path data copied from the approved mock's SVGs (stroke 2, round caps). */
private fun strokeIcon(name: String, vararg paths: String): ImageVector =
    ImageVector.Builder(name, 24.dp, 24.dp, 24f, 24f).apply {
        paths.forEach {
            addPath(addPathNodes(it), stroke = SolidColor(Color.Black), strokeLineWidth = 2f,
                strokeLineCap = StrokeCap.Round, strokeLineJoin = StrokeJoin.Round)
        }
    }.build()

object TzIcons {
    val Home = strokeIcon("home", "M3 11l9-8 9 8v10h-6v-6H9v6H3z")
    val Charts = strokeIcon("charts", "M3 3v18h18", "M7 15l4-5 3 3 5-7")
    val Trade = strokeIcon("trade", "M7 4v16M3 8l4-4 4 4M17 20V4M13 16l4 4 4-4")
    val Learn = strokeIcon("learn", "M2 9l10-5 10 5-10 5z", "M6 11v5c3 2 9 2 12 0v-5")
    val Journal = strokeIcon("journal", "M5 3h12a2 2 0 0 1 2 2v16H7a2 2 0 0 1-2-2z", "M9 8h6M9 12h6")
    val Menu = strokeIcon("menu", "M4 6h16M4 12h16M4 18h16")
    val Bell = strokeIcon("bell", "M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4")
    val Back = strokeIcon("back", "M15 5l-7 7 7 7")
    val Close = strokeIcon("close", "M6 6l12 12M18 6L6 18")
    val Expand = strokeIcon("expand", "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5")
    val More = strokeIcon("more", "M12 4a1 1 0 1 0 0 2a1 1 0 1 0 0-2z", "M12 11a1 1 0 1 0 0 2a1 1 0 1 0 0-2z", "M12 18a1 1 0 1 0 0 2a1 1 0 1 0 0-2z")
    val Indicators = strokeIcon("indicators", "M3 17l5-6 4 3 8-9")
    val Pencil = strokeIcon("pencil", "M4 20l4-1L19 8l-3-3L5 16z")
    val Plus = strokeIcon("plus", "M12 5v14M5 12h14")
    val Minus = strokeIcon("minus", "M5 12h14")
    val ChevronDown = strokeIcon("chevron-down", "M6 9l6 6 6-6")
}

/**
 * The TradeZoro wordmark. It is a light-on-dark mark; in light mode it is darkened
 * (as the site does with its .brand-mark filter) so the silver letters keep contrast on white.
 */
@androidx.compose.runtime.Composable
fun Wordmark(modifier: Modifier = Modifier) {
    val light = androidx.compose.material3.MaterialTheme.colorScheme.background.luminance() > 0.5f
    androidx.compose.foundation.Image(
        androidx.compose.ui.res.painterResource(com.tradezoro.app.R.drawable.logo_wordmark),
        contentDescription = "TradeZoro",
        modifier = modifier,
        colorFilter = if (light) androidx.compose.ui.graphics.ColorFilter.colorMatrix(
            androidx.compose.ui.graphics.ColorMatrix().apply { setToScale(0.45f, 0.45f, 0.45f, 1f) }) else null,
    )
}

