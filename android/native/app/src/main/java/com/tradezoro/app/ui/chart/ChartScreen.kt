package com.tradezoro.app.ui.chart

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.tradezoro.app.data.Timeframe
import com.tradezoro.app.data.formatPct
import com.tradezoro.app.ui.common.TzIcons
import com.tradezoro.app.ui.theme.Mint
import com.tradezoro.app.ui.theme.OnMint
import com.tradezoro.app.ui.theme.Tabular
import com.tradezoro.app.ui.theme.Tz

/** Paper-trading amber from the mock's "Paper trading" chip. */
private val PaperAmber = Color(0xFFF5B942)
private val PaperAmberLight = Color(0xFF8A5A00)   // AA on white
private val SellRed = Color(0xFFFF4D5E)
private val OnSell = Color(0xFF2A060B)

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
)

/** Under 400dp the tool row cannot hold five 48dp chips and three 48dp tools: the alerts bell moves to the top bar. */
@Composable
fun compactChart(): Boolean = with(LocalDensity.current) { LocalWindowInfo.current.containerSize.width.toDp() } < 400.dp

/** Top bar from the mock: back · "ZoroCharts" · (alerts on compact phones) · fullscreen · more. */
@Composable
fun ChartTopBar(onBack: () -> Unit, onFullscreen: () -> Unit, onMore: () -> Unit, onAlerts: () -> Unit = {}, menu: @Composable () -> Unit = {}) {
    Row(Modifier.fillMaxWidth().statusBarsPadding().height(64.dp).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack, modifier = Modifier.size(48.dp)) { Icon(TzIcons.Back, contentDescription = "Back to Home") }
        Text("ZoroCharts", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f).padding(start = 8.dp).semantics { heading() })
        if (compactChart()) IconButton(onClick = onAlerts, modifier = Modifier.size(48.dp)) { Icon(TzIcons.Bell, contentDescription = "Price alerts") }
        IconButton(onClick = onFullscreen, modifier = Modifier.size(48.dp)) { Icon(TzIcons.Expand, contentDescription = "Full screen chart") }
        Box {
            IconButton(onClick = onMore, modifier = Modifier.size(48.dp)) { Icon(TzIcons.More, contentDescription = "Chart menu") }
            menu()
        }
    }
}

/**
 * Native chrome around the chart. [chart] is the embedded ZoroCharts view (a WebView in the app,
 * a placeholder in screenshot tests). Layout follows app-mock/2-chart.png.
 */
@Composable
fun ChartContent(state: ChartUiState, actions: ChartActions, modifier: Modifier = Modifier, chart: @Composable (Modifier) -> Unit) {
    Column(modifier.fillMaxSize()) {
        if (!state.fullscreen) {
            SymbolRow(state, actions.onSymbol, Modifier.padding(horizontal = 16.dp))
            // 12 / 4dp row insets + the 48dp touch boxes put the first chip and the last glyph 16dp from the edges.
            ToolRow(state.tf, actions, Modifier.padding(start = 12.dp, end = 4.dp))
        }
        Box(Modifier.weight(1f).fillMaxWidth()) {
            chart(Modifier.fillMaxSize())
            if (state.fullscreen) {
                IconButton(onClick = actions.onExitFullscreen, modifier = Modifier.align(Alignment.TopEnd).statusBarsPadding().padding(4.dp).size(48.dp)) {
                    Icon(TzIcons.Close, contentDescription = "Exit full screen", tint = Tz.colors.muted)
                }
            }
        }
        if (!state.fullscreen) {
            TradeStrip(state, actions, Modifier.padding(horizontal = 16.dp))
        }
    }
}

/** "MNQ · 5m" on the left (opens symbol search), last price + change on the right. 48dp tall. */
@Composable
private fun SymbolRow(state: ChartUiState, onSymbol: () -> Unit, modifier: Modifier = Modifier) {
    val tfLabel = state.tf?.label
    Row(modifier.fillMaxWidth().height(48.dp), verticalAlignment = Alignment.CenterVertically) {
        Row(
            Modifier.heightIn(min = 48.dp).clip(RoundedCornerShape(8.dp))
                .clickable(role = Role.Button, onClickLabel = "Change symbol") { onSymbol() }
                .semantics(mergeDescendants = true) { contentDescription = "Symbol ${state.ticker.ifEmpty { "loading" }}${tfLabel?.let { ", $it" } ?: ""}. Change symbol" },
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(state.ticker.ifEmpty { "\u2014" }, style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.SemiBold), maxLines = 1)
            if (tfLabel != null) Text(" \u00b7 $tfLabel", style = MaterialTheme.typography.bodyLarge, color = Tz.colors.muted, maxLines = 1)
            Icon(TzIcons.ChevronDown, contentDescription = null, tint = Tz.colors.muted, modifier = Modifier.padding(start = 4.dp).size(16.dp))
        }
        Spacer(Modifier.weight(1f))
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.semantics(mergeDescendants = true) {}) {
            Text(state.last?.let { ChartViewModel.trimPrice(it) } ?: "\u2014", style = MaterialTheme.typography.titleSmall.merge(Tabular), maxLines = 1)
            state.changePct?.let { p ->
                Text(" " + formatPct(p), style = MaterialTheme.typography.labelMedium.merge(Tabular), color = if (p < 0) Tz.colors.down else Tz.colors.up, maxLines = 1)
            }
        }
    }
}

/** Timeframe chips (32dp visual, 48dp touch) + indicators / drawings / alerts. */
@Composable
private fun ToolRow(tf: Timeframe?, actions: ChartActions, modifier: Modifier = Modifier) {
    Row(modifier.fillMaxWidth().height(48.dp), verticalAlignment = Alignment.CenterVertically) {
        // Scrolls only if a very narrow screen or a large font still can't fit the chips.
        Row(Modifier.weight(1f).horizontalScroll(rememberScrollState()), verticalAlignment = Alignment.CenterVertically) {
            Timeframe.entries.forEach { t -> TfChip(t, t == tf) { actions.onTf(t) } }
        }
        IconButton(onClick = actions.onIndicators, modifier = Modifier.size(48.dp)) { Icon(TzIcons.Indicators, contentDescription = "Indicators", tint = Tz.colors.muted) }
        IconButton(onClick = actions.onDrawings, modifier = Modifier.size(48.dp)) { Icon(TzIcons.Pencil, contentDescription = "Drawing tools", tint = Tz.colors.muted) }
        if (!compactChart()) IconButton(onClick = actions.onAlerts, modifier = Modifier.size(48.dp)) { Icon(TzIcons.Bell, contentDescription = "Price alerts", tint = Tz.colors.muted) }
    }
}

@Composable
private fun TfChip(t: Timeframe, selected: Boolean, onClick: () -> Unit) {
    // 48x48dp touch box around a 40x32dp chip: chips sit 8dp apart and every target is 48dp.
    Box(
        Modifier.size(48.dp).clickable(role = Role.Tab, onClick = onClick)
            .semantics { this.selected = selected; contentDescription = "Timeframe ${t.label}" },
        contentAlignment = Alignment.Center,
    ) {
        val shape = RoundedCornerShape(8.dp)
        Box(
            Modifier.height(32.dp).widthIn(min = 40.dp).clip(shape)
                .then(if (selected) Modifier.background(Tz.colors.selected) else Modifier.border(1.dp, Tz.colors.hairline, shape))
                .padding(horizontal = 4.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text(t.label, style = MaterialTheme.typography.labelLarge,
                color = if (selected) MaterialTheme.colorScheme.onSecondaryContainer else Tz.colors.muted)
        }
    }
}

/**
 * Bottom strip: last price row, Sell · qty · Buy, and the "Paper trading" chip.
 * Orders go to the site's paper engine only (demo money, simulated fills); there is no broker path.
 */
@Composable
private fun TradeStrip(state: ChartUiState, actions: ChartActions, modifier: Modifier = Modifier) {
    val light = MaterialTheme.colorScheme.background.red > 0.5f
    Column(modifier.fillMaxWidth().padding(top = 8.dp, bottom = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(Modifier.fillMaxWidth().height(32.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(state.position ?: "No open paper position", style = MaterialTheme.typography.bodySmall.merge(Tabular),
                color = if (state.position != null) MaterialTheme.colorScheme.onBackground else Tz.colors.muted,
                maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f).semantics { liveRegion = LiveRegionMode.Polite })
            PaperChip(light)
        }
        if (!state.paperOn) {
            Button(
                onClick = actions.onPaperOn, enabled = state.ready, shape = RoundedCornerShape(24.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Mint, contentColor = OnMint),
                modifier = Modifier.fillMaxWidth().height(48.dp),
            ) { Text("Turn on paper trading", style = MaterialTheme.typography.titleSmall) }
        } else {
            Row(Modifier.fillMaxWidth().height(48.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Button(
                    onClick = actions.onSell, enabled = state.ready, shape = RoundedCornerShape(24.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = SellRed, contentColor = OnSell),
                    modifier = Modifier.weight(1f).height(48.dp).semantics { contentDescription = "Paper sell ${state.qtyText} ${state.ticker} at market" },
                ) { Text("Sell", style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold)) }
                QtyStepper(state, actions)
                Button(
                    onClick = actions.onBuy, enabled = state.ready, shape = RoundedCornerShape(24.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = Mint, contentColor = OnMint),
                    modifier = Modifier.weight(1f).height(48.dp).semantics { contentDescription = "Paper buy ${state.qtyText} ${state.ticker} at market" },
                ) { Text("Buy", style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.SemiBold)) }
            }
        }
        Text(if (state.sample) "Sample data" else "Paper trading uses demo money. Education only. Not financial advice.",
            style = MaterialTheme.typography.labelSmall, color = Tz.colors.muted, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
    }
}

@Composable
private fun QtyStepper(state: ChartUiState, actions: ChartActions) {
    val shape = RoundedCornerShape(24.dp)
    Row(
        Modifier.height(48.dp).clip(shape).border(BorderStroke(1.dp, Tz.colors.hairline), shape)
            .semantics(mergeDescendants = false) { stateDescription = "Quantity ${state.qtyText}" },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(onClick = actions.onDec, enabled = state.qty > state.qtyStep, modifier = Modifier.size(48.dp)) { Icon(TzIcons.Minus, contentDescription = "Less quantity") }
        Text(state.qtyText, style = MaterialTheme.typography.titleSmall.merge(Tabular), textAlign = TextAlign.Center, maxLines = 1,
            modifier = Modifier.width(40.dp).semantics { contentDescription = "Quantity ${state.qtyText}" })
        IconButton(onClick = actions.onInc, modifier = Modifier.size(48.dp)) { Icon(TzIcons.Plus, contentDescription = "More quantity") }
    }
}

@Composable
private fun PaperChip(light: Boolean) {
    val c = if (light) PaperAmberLight else PaperAmber
    val shape = RoundedCornerShape(8.dp)
    Box(Modifier.height(24.dp).clip(shape).border(1.dp, c.copy(alpha = 0.45f), shape).semantics(mergeDescendants = true) {}.padding(horizontal = 8.dp), contentAlignment = Alignment.Center) {
        Text("Paper trading", style = MaterialTheme.typography.labelSmall, color = c)
    }
}
