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
    val Forward = strokeIcon("forward", "M9 5l7 7-7 7")
    val Close = strokeIcon("close", "M6 6l12 12M18 6L6 18")
    val Expand = strokeIcon("expand", "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5")
    val More = strokeIcon("more", "M12 4a1 1 0 1 0 0 2a1 1 0 1 0 0-2z", "M12 11a1 1 0 1 0 0 2a1 1 0 1 0 0-2z", "M12 18a1 1 0 1 0 0 2a1 1 0 1 0 0-2z")
    val Indicators = strokeIcon("indicators", "M3 17l5-6 4 3 8-9")
    val Pencil = strokeIcon("pencil", "M4 20l4-1L19 8l-3-3L5 16z")
    val Plus = strokeIcon("plus", "M12 5v14M5 12h14")
    val Minus = strokeIcon("minus", "M5 12h14")
    val ChevronDown = strokeIcon("chevron-down", "M6 9l6 6 6-6")
    val Check = strokeIcon("check", "M5 12l5 5L20 7")
    val Person = strokeIcon("person", "M12 4a4 4 0 1 0 0 8a4 4 0 1 0 0-8z", "M4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5")
    val Search = strokeIcon("search", "M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14z", "M20 20l-4-4")
    val Drag = strokeIcon("drag", "M5 9h14M5 15h14")
    val Trash = strokeIcon("trash", "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13")
    /** Passkey: a key (the FIDO "passkey" glyph is a person + key; a plain key reads clearly at 20dp). */
    val Key = strokeIcon("key", "M8 10a4 4 0 1 0 0 8a4 4 0 1 0 0-8z", "M11 11l9-9M16 6l3 3M14 8l2 2")
    val Settings = strokeIcon("settings", "M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z",
        "M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 0 0 5 12a7 7 0 0 0 .1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6A7 7 0 0 0 19 12z")
    val Help = strokeIcon("help", "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z", "M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5V14", "M12 17.5v.01")
    val SignOut = strokeIcon("sign-out", "M14 4h5v16h-5", "M10 8l-4 4 4 4M6 12h10")
    val Shield = strokeIcon("shield", "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z", "M9 12l2 2 4-4")
}

/** Google's "G" mark, official four colours and paths (Sign in with Google branding guidelines). Draw at 18-20dp. */
val GoogleG: ImageVector = ImageVector.Builder("google-g", 20.dp, 20.dp, 48f, 48f).apply {
    addPath(addPathNodes("M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"), fill = SolidColor(Color(0xFFEA4335)))
    addPath(addPathNodes("M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"), fill = SolidColor(Color(0xFF4285F4)))
    addPath(addPathNodes("M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"), fill = SolidColor(Color(0xFFFBBC05)))
    addPath(addPathNodes("M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"), fill = SolidColor(Color(0xFF34A853)))
}.build()

/** The TZ mark (the site's assets/images/tradezoro-tzmark-1103, trimmed to its ink so it centres exactly). */
@androidx.compose.runtime.Composable
fun TzMark(modifier: Modifier = Modifier) {
    androidx.compose.foundation.Image(
        androidx.compose.ui.res.painterResource(com.tradezoro.app.R.drawable.logo_tzmark),
        contentDescription = "TradeZoro", modifier = modifier,
    )
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

