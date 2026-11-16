package com.tradezoro.app.ui.m4

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.tradezoro.app.data.GexLevel
import com.tradezoro.app.data.GexMarket
import com.tradezoro.app.data.GexView
import com.tradezoro.app.data.LevelKind
import com.tradezoro.app.data.formatGex
import com.tradezoro.app.data.formatPrice
import com.tradezoro.app.data.formatPts
import com.tradezoro.app.data.gexAgo
import com.tradezoro.app.data.gexSummary
import com.tradezoro.app.ui.common.TzIcons
import com.tradezoro.app.ui.common.probe
import com.tradezoro.app.ui.home.Card
import com.tradezoro.app.ui.theme.Mint
import com.tradezoro.app.ui.theme.OnMint
import com.tradezoro.app.ui.theme.Tabular
import com.tradezoro.app.ui.theme.Tz

/** Back · title · bell (mock 4-omega). Same 12dp inset + 48dp buttons as every other top bar. */
@Composable
fun BackTopBar(title: String, onBack: () -> Unit, onBell: () -> Unit) {
    Row(Modifier.fillMaxWidth().statusBarsPadding().height(64.dp).padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onBack, modifier = Modifier.size(48.dp)) { Icon(TzIcons.Back, contentDescription = "Back") }
        Text(title, style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f).padding(start = 8.dp).semantics { heading() })
        IconButton(onClick = onBell, modifier = Modifier.size(48.dp)) { Icon(TzIcons.Bell, contentDescription = "Price alerts") }
    }
}

/** Level colours = the site's GEX colours (assets/chart-gex-levels.js GEX_COLORS), drawn at half strength like the mock. */
@Composable
private fun levelColor(k: LevelKind): Color = when (k) {
    LevelKind.CALL_WALL -> Color(0xFFEF4444)
    LevelKind.ZERO_GAMMA -> Color(0xFFF59E0B)
    LevelKind.PUT_WALL -> Color(0xFF22C55E)
    LevelKind.IV_HI, LevelKind.IV_LO -> Color(0xFF8B7CF6)
    LevelKind.SPOT -> MaterialTheme.colorScheme.onSurface
}

data class OmegaActions(val onMarket: (GexMarket) -> Unit = {}, val onSignIn: () -> Unit = {}, val onRetry: () -> Unit = {}, val onChart: () -> Unit = {})

@Composable
fun OmegaContent(st: OmegaUiState, nowMs: Long, actions: OmegaActions, modifier: Modifier = Modifier) {
    val view = when (val g = st.gex) { is GexState.Ready -> g.view; is GexState.Failed -> g.last; else -> null }
    val sample = (st.gex as? GexState.Ready)?.sample == true
    LazyColumn(modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(start = 16.dp, end = 16.dp, bottom = 16.dp)) {
        item { MarketChips(st.market, actions.onMarket) }
        item {
            Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("${st.market.fut} \u00b7 Gamma exposure", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f).probe("title").semantics { heading() })
                if (view != null) AgeChip(if (sample) "Sample data" else gexAgo(view.dataTs, nowMs))
            }
        }
        when {
            st.gex is GexState.SignedOut -> item {
                Notice("Sign in to use Omega. It is free.", "Omega shows the gamma levels for MNQ, MES and MGC, the same levels as on the website.", "Sign in", actions.onSignIn)
            }
            view == null && st.gex is GexState.Failed -> item { Notice((st.gex as GexState.Failed).message, null, "Try again", actions.onRetry) }
            view == null -> item { Notice("Loading levels\u2026", null, null, null) }
            else -> {
                if (st.gex is GexState.Failed) item {
                    Text("${(st.gex as GexState.Failed).message} Showing the last levels.", style = MaterialTheme.typography.bodySmall, color = Tz.colors.down,
                        modifier = Modifier.padding(top = 8.dp).semantics { liveRegion = LiveRegionMode.Polite })
                }
                item { Stats(view) }
                item { Section("Level ladder") }
                item { Ladder(view) }
                item { Section("Summary") }
                item {
                    Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(MaterialTheme.colorScheme.surfaceVariant).padding(16.dp)) {
                        Text(gexSummary(view), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.8f))
                    }
                }
                item { Section("Nearest levels") }
                item {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Nearest("Above", view.above, view, Modifier.weight(1f))
                        Nearest("Below", view.below, view, Modifier.weight(1f))
                    }
                }
                item {
                    Button(onClick = actions.onChart, shape = RoundedCornerShape(24.dp), colors = ButtonDefaults.buttonColors(containerColor = Mint, contentColor = OnMint),
                        modifier = Modifier.fillMaxWidth().padding(top = 16.dp).height(48.dp)) { Text("Open ${st.market.fut} chart") }
                }
                item {
                    Text(if (sample) "Sample data. Education only. Not financial advice." else "Futures levels converted from the options chain. Education only. Not financial advice.",
                        style = MaterialTheme.typography.labelSmall, color = Tz.colors.muted, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(top = 12.dp))
                }
            }
        }
    }
}

@Composable
private fun MarketChips(cur: GexMarket, onMarket: (GexMarket) -> Unit) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(0.dp)) {
        GexMarket.entries.forEach { m ->
            val on = m == cur
            // 48dp touch box around a 32dp chip; first chip's visual edge sits on the 16dp gutter.
            Box(Modifier.probe("chip:${m.fut}").height(48.dp).clickable(role = Role.Tab) { onMarket(m) }.semantics { selected = on; contentDescription = "${m.fut} gamma levels" }
                .padding(end = 8.dp), contentAlignment = Alignment.CenterStart) {
                Box(Modifier.probe("chipv:${m.fut}").height(32.dp).clip(RoundedCornerShape(8.dp)).background(if (on) Tz.colors.selected else Color.Transparent)
                    .border(1.dp, if (on) Tz.colors.selected else Tz.colors.hairline, RoundedCornerShape(8.dp)).padding(horizontal = 16.dp), contentAlignment = Alignment.Center) {
                    Text(m.fut, style = MaterialTheme.typography.labelLarge, color = if (on) MaterialTheme.colorScheme.onSecondaryContainer else Tz.colors.muted)
                }
            }
        }
    }
}

@Composable
private fun AgeChip(text: String) {
    val live = text == "GEX live"
    Row(Modifier.probe("age").height(32.dp).clip(RoundedCornerShape(8.dp)).background(Tz.colors.selected).padding(horizontal = 12.dp).semantics(mergeDescendants = true) {},
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(Modifier.size(8.dp).clip(CircleShape).background(if (live) Tz.colors.up else Tz.colors.muted))
        Text(text, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSecondaryContainer, maxLines = 1)
    }
}

@Composable
private fun Section(t: String) = Text(t, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 24.dp, bottom = 8.dp).semantics { heading() })

@Composable
private fun StatCard(label: String, value: String, color: Color, modifier: Modifier) {
    Column(modifier.probe("stat:$label").clip(RoundedCornerShape(16.dp)).background(MaterialTheme.colorScheme.surfaceVariant).padding(horizontal = 16.dp, vertical = 12.dp)
        .clearAndSetSemantics { contentDescription = "$label, ${value.replace('\u2212', '-')}" }) {
        Text(label, style = MaterialTheme.typography.labelSmall, color = Tz.colors.muted, maxLines = 1)
        Text(value, style = MaterialTheme.typography.titleMedium.merge(Tabular).copy(fontWeight = FontWeight.SemiBold), color = color, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun Stats(v: GexView) {
    val net = v.netGex
    Row(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        val tint = when (v.positive) { true -> Tz.colors.up; false -> Tz.colors.down; null -> MaterialTheme.colorScheme.onSurface }
        StatCard("Net GEX", net?.let { formatGex(it) } ?: "\u2014", tint, Modifier.weight(1f))
        StatCard("Regime", when (v.positive) { true -> "Calmer"; false -> "Bigger moves"; null -> "\u2014" }, MaterialTheme.colorScheme.onSurface, Modifier.weight(1f))
        val d = v.spotVsFlip
        StatCard("Spot vs flip", d?.let { formatPts(it, 2) } ?: "\u2014", MaterialTheme.colorScheme.onSurface, Modifier.weight(1f))
    }
}

/** Every level, highest first; the bar shows where each sits between the lowest and highest level shown. */
@Composable
private fun Ladder(v: GexView) {
    val lo = v.levels.minOf { it.price }
    val hi = v.levels.maxOf { it.price }
    Card(contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp, vertical = 8.dp)) {
        v.levels.forEach { l -> LadderRow(l, if (hi > lo) ((l.price - lo) / (hi - lo)).toFloat() else 1f, v) }
    }
}

@Composable
private fun LadderRow(l: GexLevel, frac: Float, v: GexView) {
    val spot = l.kind == LevelKind.SPOT
    val c = levelColor(l.kind)
    val track = MaterialTheme.colorScheme.surfaceVariant
    val spoken = "${l.kind.label}, ${formatPrice(l.price, v.market.decimals)}" + if (!spot) ", ${formatPts(l.price - v.spot).replace('\u2212', '-')} points from spot" else ""
    Row(Modifier.probe("lvl:${l.kind}").fillMaxWidth().height(48.dp).clearAndSetSemantics { contentDescription = spoken }, verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(l.kind.label.replace(" (68%)", ""), style = MaterialTheme.typography.labelMedium.copy(fontWeight = if (spot) FontWeight.SemiBold else FontWeight.Normal),
            color = if (spot) MaterialTheme.colorScheme.onSurface else Tz.colors.muted, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.width(96.dp).probe("lvl:${l.kind}:label"))
        Box(Modifier.weight(1f).height(16.dp).probe("lvl:${l.kind}:bar"), contentAlignment = Alignment.CenterStart) {
            if (spot) {
                Canvas(Modifier.fillMaxWidth().height(2.dp)) {
                    drawLine(c, Offset(0f, size.height / 2), Offset(size.width, size.height / 2), strokeWidth = size.height,
                        pathEffect = PathEffect.dashPathEffect(floatArrayOf(6.dp.toPx(), 4.dp.toPx())))
                }
            } else {
                Box(Modifier.fillMaxSize().clip(RoundedCornerShape(8.dp)).background(track))
                Box(Modifier.fillMaxWidth(frac.coerceIn(0.06f, 1f)).fillMaxHeight().clip(RoundedCornerShape(8.dp)).background(c.copy(alpha = 0.55f)))
            }
        }
        Text(formatPrice(l.price, v.market.decimals), style = MaterialTheme.typography.bodyMedium.merge(Tabular).copy(fontWeight = if (spot) FontWeight.SemiBold else FontWeight.Medium),
            textAlign = TextAlign.End, maxLines = 1, modifier = Modifier.width(88.dp).probe("lvl:${l.kind}:value"))
    }
}

@Composable
private fun Nearest(label: String, l: GexLevel?, v: GexView, modifier: Modifier) {
    StatCard(label, l?.let { "${it.kind.label.replace(" (68%)", "")} ${formatPts(it.price - v.spot, 2)}" } ?: "None in range", MaterialTheme.colorScheme.onSurface, modifier)
}

@Composable
fun Notice(title: String, body: String?, button: String?, onClick: (() -> Unit)?) {
    Column(Modifier.fillMaxWidth().padding(vertical = 32.dp, horizontal = 8.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
        body?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = Tz.colors.muted, textAlign = TextAlign.Center) }
        if (button != null && onClick != null) {
            Spacer(Modifier.height(8.dp))
            Button(onClick = onClick, shape = RoundedCornerShape(24.dp), colors = ButtonDefaults.buttonColors(containerColor = Mint, contentColor = OnMint),
                modifier = Modifier.height(48.dp)) { Text(button) }
        }
    }
}

/** True on a light background (for the few colours that need a darker light-mode variant). */
@Composable
fun isLight() = MaterialTheme.colorScheme.background.luminance() > 0.5f
