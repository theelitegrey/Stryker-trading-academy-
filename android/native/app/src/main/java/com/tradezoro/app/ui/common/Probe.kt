package com.tradezoro.app.ui.common

import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.layout.boundsInRoot
import androidx.compose.ui.layout.onGloballyPositioned

/** Alignment-test hook: tests provide a sink and read laid-out bounds (px) of parts hidden from semantics. Null in the app. */
val LocalProbe = staticCompositionLocalOf<((String, Rect) -> Unit)?> { null }

fun Modifier.probe(name: String): Modifier = composed {
    val sink = LocalProbe.current
    if (sink == null) this else this.onGloballyPositioned { sink(name, it.boundsInRoot()) }
}
