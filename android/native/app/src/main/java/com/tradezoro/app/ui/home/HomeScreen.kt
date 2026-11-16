package com.tradezoro.app.ui.home

import androidx.annotation.DrawableRes
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.tradezoro.app.R
import com.tradezoro.app.data.DayPart
import com.tradezoro.app.data.formatPct
import com.tradezoro.app.data.formatPrice
import com.tradezoro.app.data.normalise
import com.tradezoro.app.ui.theme.Tabular
import com.tradezoro.app.ui.theme.Tz

enum class Product(val title: String, val sub: String, @DrawableRes val icon: Int) {
    KRONOS("Kronos", "Replay", R.drawable.product_kronos),
    OMEGA("Omega", "Gamma", R.drawable.product_omega),
    MENTIS("Mentis", "Learning", R.drawable.product_mentis),
    NEMESIS("Nemesis", "Journal", R.drawable.product_nemesis),
}

@Composable
fun HomeContent(
    state: HomeUiState,
    firstName: String?,
    dayPart: DayPart,
    marketOpen: Boolean,
    onProduct: (Product) -> Unit,
    onSymbol: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    LazyColumn(modifier, contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 16.dp)) {
        item { Greeting(firstName, dayPart, marketOpen) }
        item { SectionTitle("Products", Modifier.padding(top = 24.dp, bottom = 8.dp)) }
        item { ProductsCard(onProduct) }
        item { SectionTitle("Watchlist", Modifier.padding(top = 24.dp, bottom = 8.dp)) }
        item {
            Card(contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp)) {
                state.rows.forEach { WatchRowView(it, onSymbol) }
            }
        }
        item {
            Text(
                when { state.sample -> "Sample data"; state.anyDelayed -> "Futures prices are delayed. Updates every 25 s."; else -> "Updates every 25 s." },
                style = MaterialTheme.typography.labelSmall, color = Tz.colors.muted, textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
            )
        }
    }
}

@Composable
private fun Greeting(firstName: String?, dayPart: DayPart, marketOpen: Boolean) {
    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(
                when (dayPart) { DayPart.MORNING -> "Good morning"; DayPart.AFTERNOON -> "Good afternoon"; DayPart.EVENING -> "Good evening" },
                style = MaterialTheme.typography.bodySmall, color = Tz.colors.muted,
            )
            Text("Hi, ${firstName ?: "Trader"}", style = MaterialTheme.typography.headlineSmall, maxLines = 1, overflow = TextOverflow.Ellipsis,
                modifier = Modifier.semantics { heading() })
        }
        MarketChip(marketOpen)
    }
}

@Composable
fun MarketChip(open: Boolean) {
    Row(
        Modifier.height(32.dp).clip(RoundedCornerShape(8.dp)).background(Tz.colors.selected).padding(horizontal = 12.dp)
            .semantics(mergeDescendants = true) {},
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Box(Modifier.size(8.dp).clip(CircleShape).background(if (open) Tz.colors.up else Tz.colors.muted))
        Text(if (open) "Market open" else "Market closed", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSecondaryContainer)
    }
}

@Composable
private fun SectionTitle(text: String, modifier: Modifier = Modifier) {
    Text(text, style = MaterialTheme.typography.titleMedium, modifier = modifier.semantics { heading() })
}

@Composable
fun Card(modifier: Modifier = Modifier, contentPadding: PaddingValues = PaddingValues(16.dp), content: @Composable () -> Unit) {
    val shape = RoundedCornerShape(16.dp)
    Column(
        modifier.fillMaxWidth().clip(shape).background(MaterialTheme.colorScheme.surface)
            .border(1.dp, Tz.colors.hairline, shape).padding(contentPadding),
    ) { content() }
}

@Composable
private fun ProductsCard(onProduct: (Product) -> Unit) {
    Card(contentPadding = PaddingValues(horizontal = 8.dp, vertical = 16.dp)) {
        Row(Modifier.fillMaxWidth()) {
            Product.entries.forEach { p ->
                Column(
                    Modifier.weight(1f).clip(RoundedCornerShape(12.dp))
                        .clickable(role = Role.Button, onClickLabel = "Open ${p.title}") { onProduct(p) }
                        .padding(vertical = 4.dp),
                    horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Image(painterResource(p.icon), contentDescription = null, contentScale = ContentScale.Crop,
                        modifier = Modifier.size(56.dp).clip(RoundedCornerShape(16.dp)))
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(p.title, style = MaterialTheme.typography.labelMedium)
                        Text(p.sub, style = MaterialTheme.typography.labelMedium.copy(fontWeight = null), color = Tz.colors.muted)
                    }
                }
            }
        }
    }
}

@Composable
private fun WatchRowView(row: WatchRow, onSymbol: (String) -> Unit) {
    val sym = row.symbol
    val q = when (val s = row.state) { is RowState.Ready -> s.quote; is RowState.Failed -> s.stale; RowState.Loading -> null }
    val pct = q?.changePct
    val trend = when { pct == null -> Tz.colors.muted; pct < 0 -> Tz.colors.down; else -> Tz.colors.up }
    val spoken = buildString {
        append("${sym.ticker}, ${sym.name}")
        when {
            q != null -> { append(", ${formatPrice(q.last, sym.decimals)}"); if (pct != null) append(", ${formatPct(pct).replace('\u2212', '-')}") }
            row.state is RowState.Failed -> append(", price unavailable")
            else -> append(", loading")
        }
    }
    Row(
        Modifier.fillMaxWidth().height(60.dp).clickable(role = Role.Button) { onSymbol(sym.ticker) }
            .clearAndSetSemantics { contentDescription = spoken },
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Column(Modifier.width(112.dp)) {
            Text(sym.ticker, style = MaterialTheme.typography.titleSmall, maxLines = 1)
            Text(sym.name, style = MaterialTheme.typography.labelSmall.copy(letterSpacing = MaterialTheme.typography.bodySmall.letterSpacing),
                color = Tz.colors.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
            if (q != null && q.spark.size > 1) Sparkline(q.spark, trend, Modifier.width(64.dp).height(24.dp))
        }
        Column(Modifier.width(96.dp), horizontalAlignment = Alignment.End) {
            Text(q?.let { formatPrice(it.last, sym.decimals) } ?: "\u2014", style = MaterialTheme.typography.titleSmall.merge(Tabular).copy(fontWeight = null), maxLines = 1)
            Text(
                pct?.let { formatPct(it) } ?: if (row.state is RowState.Failed) "Unavailable" else " ",
                style = MaterialTheme.typography.labelMedium.merge(Tabular), color = trend, maxLines = 1,
            )
        }
    }
}

@Composable
fun Sparkline(values: List<Double>, color: Color, modifier: Modifier = Modifier) {
    val pts = remember(values) { normalise(values) }
    Canvas(modifier) {
        val pad = 2.dp.toPx()
        val h = size.height - pad * 2
        val step = size.width / (pts.size - 1)
        val path = Path()
        pts.forEachIndexed { i, v ->
            val o = Offset(i * step, pad + (1f - v) * h)
            if (i == 0) path.moveTo(o.x, o.y) else path.lineTo(o.x, o.y)
        }
        drawPath(path, color, style = Stroke(width = 1.8.dp.toPx(), join = StrokeJoin.Round))
    }
}

