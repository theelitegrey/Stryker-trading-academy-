package com.tradezoro.app.ui.chart

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.snapping.rememberSnapFlingBehavior
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.material3.VerticalDivider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.tradezoro.app.data.Timeframe
import com.tradezoro.app.data.canonicalId
import com.tradezoro.app.data.formatPct
import com.tradezoro.app.data.symbolOf
import com.tradezoro.app.ui.common.SlimPill
import com.tradezoro.app.ui.common.TzIcons
import com.tradezoro.app.ui.theme.Tabular
import com.tradezoro.app.ui.theme.Tz
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.launch

data class ChartActions(
    val onSymbol: () -> Unit = {},
    val onTf: (Timeframe) -> Unit = {},
    val onIndicators: () -> Unit = {},
    val onDrawings: () -> Unit = {},
    val onAlerts: () -> Unit = {},
    val onSell: () -> Unit = {},
    val onBuy: () -> Unit = {},
    val onDec: () -> Unit = {},
    val onInc: () -> Unit = {},
    val onPaperOn: () -> Unit = {},
    val onExitFullscreen: () -> Unit = {},
    /** A symbol picked on the wheel (the site's watchlist id, e.g. "futures:NQ1!"). */
    val onPickSymbol: (String) -> Unit = {},
    /** Opens the trade options (bottom sheet). */
    val onTrade: () -> Unit = {},
)

/** Under 400dp some optional chrome moves or shrinks. */
@Composable
fun compactChart(): Boolean = with(LocalDensity.current) { LocalWindowInfo.current.containerSize.width.toDp() } < 400.dp

/** "NQ1! · CME" for a chart id ("MNQ1!", "futures:NQ1!", "binance:BTCUSDT"). */
fun chartTitle(symbolId: String): String = if (symbolId.isEmpty()) "" else symbolOf(canonicalId(symbolId)).title

/**
 * Chart top bar (Owner 17 Nov: no "ZoroCharts" title): back · symbol + exchange (tap = symbol search), with the last
 * price and change under it · alerts · full screen · more.
 */
@Composable
fun ChartTopBar(
    onBack: () -> Unit, onFullscreen: () -> Unit, onMore: () -> Unit, onAlerts: () -> Unit = {},
    state: ChartUiState = ChartUiState(), onSymbol: () -> Unit = {}, menu: @Composable () -> Unit = {},
) {
    Row(Modifier.fillMaxWidth().statusBarsPadding().height(64.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack, modifier = Modifier.size(48.dp)) { Icon(TzIcons.Back, contentDescription = "Back to Home") }
        val title = chartTitle(state.symbolId)
        Column(
            Modifier.weight(1f).heightIn(min = 48.dp).clip(RoundedCornerShape(8.dp))
                .clickable(role = Role.Button, onClickLabel = "Change symbol") { onSymbol() }
                .padding(horizontal = 4.dp)
                .semantics(mergeDescendants = true) { heading(); contentDescription = "${title.ifEmpty { "Loading" }}. Change symbol" }
                .testTag("chart-title"),
            verticalArrangement = Arrangement.Center,
        ) {
            Text(title.ifEmpty { "\u2014" }, style = MaterialTheme.typography.titleMedium.copy(fontSize = 17.sp, fontWeight = FontWeight.SemiBold),
                maxLines = 1, overflow = TextOverflow.Ellipsis)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(state.last?.let { ChartViewModel.trimPrice(it) } ?: " ", style = MaterialTheme.typography.labelMedium.merge(Tabular).copy(fontWeight = FontWeight.Normal),
                    color = Tz.colors.muted, maxLines = 1)
                state.changePct?.let { p ->
                    Text("  " + formatPct(p), style = MaterialTheme.typography.labelMedium.merge(Tabular), color = if (p < 0) Tz.colors.down else Tz.colors.up, maxLines = 1)
                }
            }
        }
        IconButton(onClick = onAlerts, modifier = Modifier.size(48.dp)) { Icon(TzIcons.Bell, contentDescription = "Price alerts") }
        IconButton(onClick = onFullscreen, modifier = Modifier.size(48.dp)) { Icon(TzIcons.Expand, contentDescription = "Full screen chart") }
        Box {
            IconButton(onClick = onMore, modifier = Modifier.size(48.dp)) { Icon(TzIcons.More, contentDescription = "Chart menu") }
            menu()
        }
    }
}

/**
 * Native chrome around the chart. [chart] is the chart view (native renderer or the page; a placeholder in tests).
 * Bottom bar (Owner 17 Nov, his reference picture): symbol wheel · timeframe wheel · indicators · drawings · Trade.
 */
@Composable
fun ChartContent(
    state: ChartUiState, actions: ChartActions, modifier: Modifier = Modifier,
    symbols: List<String> = emptyList(),
    chart: @Composable (Modifier) -> Unit,
) {
    Column(modifier.fillMaxSize()) {
        Box(Modifier.weight(1f).fillMaxWidth()) {
            chart(Modifier.fillMaxSize())
            if (state.fullscreen) {
                IconButton(onClick = actions.onExitFullscreen, modifier = Modifier.align(Alignment.TopEnd).statusBarsPadding().padding(4.dp).size(48.dp)) {
                    Icon(TzIcons.Close, contentDescription = "Exit full screen", tint = Tz.colors.muted)
                }
            }
            // Above the time axis (about 28dp), on its own backing so it never collides with axis labels.
            if (state.sample) Text("Sample data", style = MaterialTheme.typography.labelSmall, color = Tz.colors.muted,
                modifier = Modifier.align(Alignment.BottomStart).padding(start = 8.dp, bottom = 40.dp)
                    .clip(RoundedCornerShape(4.dp)).background(MaterialTheme.colorScheme.background.copy(alpha = 0.8f)).padding(horizontal = 4.dp))
        }
        if (!state.fullscreen) ChartBottomBar(state, actions, symbols)
    }
}

/** The ids on the symbol wheel: the active watchlist, plus the chart's symbol on top when it is not in the list. */
fun wheelSymbols(listIds: List<String>, chartSymbol: String): List<String> {
    val cur = if (chartSymbol.isEmpty()) "" else canonicalId(chartSymbol)
    val ids = listIds.map(::canonicalId).distinct()
    return if (cur.isEmpty() || cur in ids) ids else listOf(cur) + ids
}

@Composable
private fun ChartBottomBar(state: ChartUiState, actions: ChartActions, symbols: List<String>) {
    val ids = remember(symbols, state.symbolId) { wheelSymbols(symbols, state.symbolId) }
    val cur = if (state.symbolId.isEmpty()) "" else canonicalId(state.symbolId)
    Column(Modifier.fillMaxWidth()) {
        Box(Modifier.fillMaxWidth().height(1.dp).background(Tz.colors.hairline))
        Row(Modifier.fillMaxWidth().height(WHEEL_BAR_H).padding(start = 8.dp, end = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            WheelPicker(
                items = ids, selected = ids.indexOf(cur).coerceAtLeast(0), label = { symbolOf(it).chartTicker },
                width = 104.dp, what = "Symbol", onPick = { actions.onPickSymbol(ids[it]) }, tag = "wheel-symbol",
            )
            WheelPicker(
                items = Timeframe.entries, selected = state.tf?.let { Timeframe.entries.indexOf(it) } ?: -1, label = { it.label },
                width = 56.dp, what = "Timeframe", onPick = { actions.onTf(Timeframe.entries[it]) }, tag = "wheel-tf",
            )
            Spacer(Modifier.weight(1f))
            IconButton(onClick = actions.onIndicators, modifier = Modifier.size(48.dp)) { Icon(TzIcons.Indicators, contentDescription = "Indicators") }
            IconButton(onClick = actions.onDrawings, modifier = Modifier.size(48.dp)) { Icon(TzIcons.Pencil, contentDescription = "Drawing tools") }
            VerticalDivider(Modifier.height(32.dp).padding(horizontal = 8.dp), color = Tz.colors.hairline)
            SlimPill("Trade", actions.onTrade, Modifier.testTag("chart-trade"), desc = "Trade. Paper trading options")
        }
    }
}

val WHEEL_ROW: Dp = 24.dp
/** Owner 17 Nov round 2: compact. The chosen row plus HALF a row above and below (clipped, faded) = 2 rows tall. */
val WHEEL_H: Dp = WHEEL_ROW * 2
/** The bar keeps the 48dp touch height; the wheel sits centred in it. */
val WHEEL_BAR_H: Dp = 56.dp

/**
 * Scroll-wheel picker (Owner 17 Nov reference, compact since M7): the choice in the middle (bold, full colour) with half
 * of each neighbour showing above and below, faded. Flings snap to a row; when the wheel stops on a new row, [onPick] fires.
 * Tapping a faded neighbour picks it too. TalkBack: each row is a selectable item.
 */
@Composable
fun <T> WheelPicker(
    items: List<T>, selected: Int, label: (T) -> String, width: Dp, what: String,
    onPick: (Int) -> Unit, modifier: Modifier = Modifier, tag: String = "wheel",
) {
    val list = rememberLazyListState(initialFirstVisibleItemIndex = selected.coerceAtLeast(0))
    val fling = rememberSnapFlingBehavior(list)
    val scope = rememberCoroutineScope()
    val pick by rememberUpdatedState(onPick)
    val sel by rememberUpdatedState(selected)
    // The row in the middle while scrolling (the list's first item sits in the middle thanks to half a row of padding).
    val centre by remember { derivedStateOf {
        val i = list.firstVisibleItemIndex; val off = list.firstVisibleItemScrollOffset
        val rowPx = list.layoutInfo.visibleItemsInfo.firstOrNull()?.size ?: 1
        if (off > rowPx / 2) i + 1 else i
    } }
    // Settled on a new row -> pick it.
    LaunchedEffect(list, items.size) {
        snapshotFlow { list.isScrollInProgress }.distinctUntilChanged().filter { !it }.collect {
            val c = centre.coerceIn(0, (items.size - 1).coerceAtLeast(0))
            if (items.isNotEmpty() && c != sel) pick(c)
        }
    }
    // The choice changed elsewhere (chart, Home) -> move the wheel there.
    LaunchedEffect(selected, items.size) {
        if (selected >= 0 && !list.isScrollInProgress && centre != selected) list.scrollToItem(selected)
    }
    val bg = MaterialTheme.colorScheme.background
    Box(modifier.width(width).height(WHEEL_H).clipToBounds().testTag(tag)) {
        LazyColumn(state = list, flingBehavior = fling, contentPadding = PaddingValues(vertical = WHEEL_ROW / 2), modifier = Modifier.fillMaxSize()) {
            itemsIndexed(items) { i, it ->
                val on = i == centre
                Box(
                    Modifier.fillMaxWidth().height(WHEEL_ROW)
                        .clickable(role = Role.RadioButton, onClickLabel = "Choose") { scope.launch { list.animateScrollToItem(i) } }
                        .semantics { this.selected = i == selected; stateDescription = if (i == selected) "Selected" else ""; contentDescription = "$what ${label(it)}" }
                        .padding(horizontal = 8.dp),
                    contentAlignment = Alignment.CenterStart,
                ) {
                    Text(label(it), maxLines = 1, overflow = TextOverflow.Clip,
                        style = if (on) MaterialTheme.typography.titleMedium.copy(fontSize = 17.sp, fontWeight = FontWeight.Bold)
                            else MaterialTheme.typography.bodyMedium.copy(fontSize = 15.sp),
                        color = if (on) MaterialTheme.colorScheme.onBackground else Tz.colors.muted.copy(alpha = 0.8f))
                }
            }
        }
        // Fade the rows above and below into the bar.
        Box(Modifier.fillMaxWidth().height(WHEEL_ROW / 2).align(Alignment.TopCenter).background(Brush.verticalGradient(listOf(bg.copy(alpha = 0.8f), bg.copy(alpha = 0.2f)))))
        Box(Modifier.fillMaxWidth().height(WHEEL_ROW / 2).align(Alignment.BottomCenter).background(Brush.verticalGradient(listOf(bg.copy(alpha = 0.2f), bg.copy(alpha = 0.8f)))))
    }
}

