package com.tradezoro.app.ui.chart

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.unit.dp
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import com.tradezoro.app.data.ChartData
import com.tradezoro.app.ui.theme.Tz

/**
 * The native chart: candles/bars/line/area, volume, indicator output from the site's engine, the member's drawings,
 * crosshair (long-press, then drag), pinch-zoom and pan, double-tap = back to the live edge.
 * Drawing: with a [tool] set, each tap places an anchor; when the tool has all its anchors, [onDrawn] gets
 * (type, [(timeMs, price)]) and the caller stores it through the site's drawings controller.
 */
@Composable
fun NativeChart(
    data: ChartData?,
    vp: ChartViewport,
    style: PriceStyle,
    modifier: Modifier = Modifier,
    tool: DrawTool? = null,
    onDrawn: (DrawTool, List<Pair<Long, Double>>) -> Unit = { _, _ -> },
    onNeedHistory: () -> Unit = {},
) {
    val density = LocalDensity.current
    val painter = remember(density.density, density.fontScale) { ChartPainter(density.density, density.fontScale) }
    val dark = MaterialTheme.colorScheme.background.red < 0.5f
    val up = Tz.colors.up.toArgb(); val down = Tz.colors.down.toArgb(); val muted = Tz.colors.muted.toArgb(); val hair = Tz.colors.hairline.toArgb()
    val bg = MaterialTheme.colorScheme.background.toArgb(); val fg = MaterialTheme.colorScheme.onBackground.toArgb()
    val pal = remember(dark, up, down, muted, hair, bg, fg) {
        ChartPalette(
            bg = bg, grid = if (dark) 0xFF1C1C1F.toInt() else 0xFFEDEDF0.toInt(), text = muted, up = up, down = down,
            cross = if (dark) 0xFF9AA0AD.toInt() else 0xFF6E6E73.toInt(), tagBg = if (dark) 0xFFECECEE.toInt() else 0xFF1C1C1F.toInt(),
            tagText = if (dark) 0xFF0A0A0B.toInt() else 0xFFFFFFFF.toInt(), legend = fg,
        )
    }
    val defaultSpacing = with(density) { 7f * this.density }
    if (data != null && vp.lastData !== data) vp.onData(data, defaultSpacing)

    val toolNow = rememberUpdated(tool)
    Box(modifier) {
        Canvas(
            Modifier.matchParentSize()
                .semantics { contentDescription = data?.let { describe(it) } ?: "Chart loading" }
                .pointerInput(Unit) {
                    detectTransformGestures { centroid, pan, zoom, _ ->
                        if (vp.crossX >= 0f && zoom == 1f) return@detectTransformGestures
                        if (zoom != 1f) vp.zoom(zoom, centroid.x)
                        vp.pan(pan.x)
                        if (vp.left < 30) onNeedHistory()
                    }
                }
                .pointerInput(Unit) {
                    detectTapGestures(
                        onTap = { o ->
                            val t = toolNow.value
                            val d = vp.lastData
                            if (t != null && d != null) {
                                vp.pending.add(painter.indexAt(o.x, vp) to painter.priceAt(o.y))
                                if (vp.pending.size >= t.points) {
                                    val pts = vp.pending.map { (i, p) -> d.bars.timeAt(i) to p }
                                    vp.pending.clear(); onDrawn(t, pts)
                                }
                            } else vp.crossX = -1f
                        },
                        onDoubleTap = { vp.live() },
                        onLongPress = { o -> vp.crossX = o.x; vp.crossY = o.y },
                    )
                }
                .pointerInput(Unit) {
                    detectDragGesturesAfterLongPress(
                        onDragStart = { o -> vp.crossX = o.x; vp.crossY = o.y },
                        onDrag = { ch, _ -> vp.crossX = ch.position.x; vp.crossY = ch.position.y; ch.consume() },
                    )
                },
        ) {
            // Reading snapshot state here re-runs only the draw phase.
            vp.right; vp.spacing; vp.crossX; vp.crossY; vp.tick; vp.pending.size
            drawIntoCanvas { c -> painter.draw(c.nativeCanvas, size.width, size.height, data, vp, style, pal) }
        }
        if (data == null) Text("Loading chart\u2026", color = Tz.colors.muted, modifier = Modifier.align(Alignment.Center))
        if (tool != null) Text(
            "${tool.label}: tap ${tool.points - vp.pending.size} point${if (tool.points - vp.pending.size == 1) "" else "s"}",
            style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.align(Alignment.TopCenter).padding(top = 8.dp)
                .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(50))
                .padding(horizontal = 12.dp, vertical = 8.dp),
        )
    }
}

@Composable
private fun <T> rememberUpdated(v: T): androidx.compose.runtime.State<T> {
    val s = remember { androidx.compose.runtime.mutableStateOf(v) }
    s.value = v
    return s
}

/** TalkBack summary of the chart (the canvas itself has no text nodes). */
fun describe(d: ChartData): String {
    val b = d.bars
    if (b.n == 0) return "Chart, no data"
    val last = b.c[b.n - 1]
    val studies = d.models.map { it.title }.filter { it.isNotEmpty() }.distinct()
    return "Chart ${d.sym.substringAfter(':')}, ${b.n} bars, last ${String.format(java.util.Locale.US, "%,.${d.decimals}f", last)}" +
        (if (studies.isEmpty()) "" else ". Indicators: " + studies.joinToString(", ")) +
        ". Pinch to zoom, drag to pan, long-press for the crosshair, double-tap for the latest bar."
}
