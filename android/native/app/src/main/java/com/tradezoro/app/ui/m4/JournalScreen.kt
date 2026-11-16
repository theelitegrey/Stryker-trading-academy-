package com.tradezoro.app.ui.m4

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.tradezoro.app.data.DayCell
import com.tradezoro.app.data.JournalTrade
import com.tradezoro.app.data.formatUsd
import com.tradezoro.app.data.monthCells
import com.tradezoro.app.data.monthStats
import com.tradezoro.app.ui.common.TzIcons
import com.tradezoro.app.ui.common.probe
import com.tradezoro.app.ui.home.Card
import com.tradezoro.app.ui.theme.Mint
import com.tradezoro.app.ui.theme.OnMint
import com.tradezoro.app.ui.theme.Tabular
import com.tradezoro.app.ui.theme.Tz
import java.time.LocalDate
import java.time.YearMonth
import java.time.format.TextStyle
import java.util.Locale

data class JournalActions(val onMonth: (Long) -> Unit = {}, val onAdd: () -> Unit = {}, val onSignIn: () -> Unit = {}, val onWeb: () -> Unit = {})

/** Nemesis: month calendar (Mon-Fri), win days + avg trade, recent trades, + to add (mock 6-nemesis). */
@Composable
fun JournalContent(st: JournalState, month: YearMonth, today: LocalDate, actions: JournalActions, modifier: Modifier = Modifier) {
    Box(modifier.fillMaxSize()) {
        when (st) {
            JournalState.SignedOut -> Notice("Sign in to open your journal", "Nemesis keeps your trades in your account, the same journal as on the website.", "Sign in", actions.onSignIn)
            JournalState.Loading -> Notice("Loading your journal\u2026", null, null, null)
            is JournalState.Failed -> Notice(st.message, null, null, null)
            is JournalState.Ready -> {
                val cells = monthCells(month, st.trades)
                val stats = monthStats(month, st.trades)
                val recent = st.trades.take(10)
                LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 96.dp)) {
                    item { MonthHeader(month, actions.onMonth, canNext = month < YearMonth.from(today)) }
                    item { Calendar(cells, today) }
                    item {
                        Row(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            JStat("Win days", if (stats.tradedDays == 0) "\u2014" else "${stats.winDays} of ${stats.tradedDays}", if (stats.winDays > 0) Tz.colors.up else MaterialTheme.colorScheme.onSurface, Modifier.weight(1f))
                            JStat("Avg trade", stats.avgTrade?.let { formatUsd(it) } ?: "\u2014", MaterialTheme.colorScheme.onSurface, Modifier.weight(1f))
                        }
                    }
                    item { Text("Recent trades", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 24.dp, bottom = 8.dp).semantics { heading() }) }
                    item {
                        if (recent.isEmpty()) Notice("No trades yet", "Tap + to add your first trade, or send paper trades to Nemesis from the chart.", null, null)
                        else Card(contentPadding = PaddingValues(horizontal = 16.dp, vertical = 0.dp)) {
                            recent.forEachIndexed { i, t ->
                                if (i > 0) HorizontalDivider(color = Tz.colors.hairline)
                                TradeRow(t)
                            }
                        }
                    }
                    item {
                        Text(if (st.sample) "Sample data" else "Same journal as tradezoro.com. Education only. Not financial advice.",
                            style = MaterialTheme.typography.labelSmall, color = Tz.colors.muted, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(top = 12.dp))
                    }
                }
                FloatingActionButton(onClick = actions.onAdd, containerColor = Mint, contentColor = OnMint, shape = RoundedCornerShape(16.dp),
                    modifier = Modifier.align(Alignment.BottomEnd).padding(16.dp).size(56.dp).probe("fab")) {
                    Icon(TzIcons.Plus, contentDescription = "Add a trade")
                }
            }
        }
    }
}

@Composable
private fun MonthHeader(month: YearMonth, onMonth: (Long) -> Unit, canNext: Boolean) {
    val name = month.month.getDisplayName(TextStyle.FULL, Locale.US) + if (month.year != YearMonth.now().year) " ${month.year}" else ""
    Row(Modifier.fillMaxWidth().height(48.dp).padding(horizontal = 0.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = { onMonth(-1) }, modifier = Modifier.size(48.dp).probe("prev")) { Icon(TzIcons.Back, contentDescription = "Previous month") }
        Text(name, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center, modifier = Modifier.weight(1f).probe("month").semantics { heading() })
        IconButton(onClick = { onMonth(1) }, enabled = canNext, modifier = Modifier.size(48.dp).probe("next")) { Icon(TzIcons.Forward, contentDescription = "Next month") }
    }
}

@Composable
private fun Calendar(cells: List<DayCell?>, today: LocalDate) {
    val up = Tz.colors.up
    val down = Tz.colors.down
    val neutral = Tz.colors.hairline
    val base = MaterialTheme.colorScheme.surfaceVariant
    Card(Modifier.padding(top = 4.dp), contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("M", "T", "W", "T", "F").forEach {
                Text(it, style = MaterialTheme.typography.labelSmall, color = Tz.colors.muted, textAlign = TextAlign.Center, modifier = Modifier.weight(1f).clearAndSetSemantics { })
            }
        }
        cells.chunked(5).forEach { week ->
            Row(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                (0 until 5).forEach { i ->
                    val c = week.getOrNull(i)
                    Box(Modifier.weight(1f).height(36.dp).then(if (c != null) Modifier.probe("day:${c.date.dayOfMonth}") else Modifier), contentAlignment = Alignment.Center) {
                        if (c != null) {
                            val edge = when { c.pnl == null -> neutral; c.pnl > 0 -> up; c.pnl < 0 -> down; else -> neutral }
                            val tint = when { c.pnl == null -> Color.Transparent; c.pnl > 0 -> up.copy(alpha = 0.08f); c.pnl < 0 -> down.copy(alpha = 0.08f); else -> Color.Transparent }
                            val spoken = c.date.format(java.time.format.DateTimeFormatter.ofPattern("EEEE d MMMM", Locale.US)) +
                                (c.pnl?.let { ", ${c.trades} trade${if (c.trades == 1) "" else "s"}, ${formatUsd(it).replace('\u2212', '-')}" } ?: ", no trades")
                            Box(
                                Modifier.fillMaxSize().clip(RoundedCornerShape(8.dp)).background(base).background(tint)
                                    .drawBehind { val h = 2.dp.toPx(); drawRect(edge, Offset(0f, size.height - h), androidx.compose.ui.geometry.Size(size.width, h)) }
                                    .then(if (c.date == today) Modifier.border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(8.dp)) else Modifier)
                                    .clearAndSetSemantics { contentDescription = spoken },
                                contentAlignment = Alignment.Center,
                            ) {
                                Text("${c.date.dayOfMonth}", style = MaterialTheme.typography.labelMedium.merge(Tabular).copy(fontWeight = FontWeight.SemiBold),
                                    color = if (c.pnl == null) Tz.colors.muted else MaterialTheme.colorScheme.onSurface)
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun JStat(label: String, value: String, color: Color, modifier: Modifier) {
    Column(modifier.probe("stat:$label").clip(RoundedCornerShape(16.dp)).background(MaterialTheme.colorScheme.surfaceVariant).padding(horizontal = 16.dp, vertical = 12.dp)
        .clearAndSetSemantics { contentDescription = "$label, ${value.replace('\u2212', '-')}" }) {
        Text(label, style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Normal), color = Tz.colors.muted)
        Text(value, style = MaterialTheme.typography.headlineSmall.merge(Tabular).copy(fontWeight = FontWeight.SemiBold), color = color, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun TradeRow(t: JournalTrade) {
    val c = when { t.pnl == null -> Tz.colors.muted; t.pnl >= 0 -> Tz.colors.up; else -> Tz.colors.down }
    val dir = if (t.direction == "short") "Short" else "Long"
    val size = t.positionSize?.let { if (it % 1.0 == 0.0) it.toLong().toString() else it.toString() }
    val pnl = t.pnl?.let { formatUsd(it) } ?: "Open"
    Row(Modifier.fillMaxWidth().height(72.dp).clearAndSetSemantics { contentDescription = "${t.instrument}, $dir${size?.let { " $it" } ?: ""}, ${t.date}, ${pnl.replace('\u2212', '-')}" },
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        Box(Modifier.probe("av:${t.id}").size(48.dp).clip(CircleShape).background(c.copy(alpha = 0.16f)), contentAlignment = Alignment.Center) {
            Text(t.instrument.take(4).ifBlank { "?" }, style = MaterialTheme.typography.labelSmall.copy(fontWeight = FontWeight.Bold), color = c, maxLines = 1)
        }
        Column(Modifier.weight(1f).probe("tx:${t.id}")) {
            Text(t.instrument.ifBlank { "Trade" }, style = MaterialTheme.typography.bodyLarge, maxLines = 1)
            Text("$dir${size?.let { " \u00b7 $it" } ?: ""} \u00b7 ${shortDate(t.date)}", style = MaterialTheme.typography.bodySmall, color = Tz.colors.muted, maxLines = 1)
        }
        Text(pnl, style = MaterialTheme.typography.titleSmall.merge(Tabular), color = c, maxLines = 1, modifier = Modifier.probe("pnl:${t.id}"))
    }
}

private fun shortDate(d: String) = runCatching { LocalDate.parse(d).format(java.time.format.DateTimeFormatter.ofPattern("d MMM", Locale.US)) }.getOrDefault(d)

/** Quick add (instrument, side, date, entry, exit, size, fees). Full form (setups, tags, screenshots) stays on the website. */
@Composable
fun AddTradeForm(t: NewTrade, busy: Boolean, error: String?, onChange: (NewTrade) -> Unit, onSave: () -> Unit, onFullForm: () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(start = 24.dp, end = 24.dp, bottom = 32.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Add a trade", style = MaterialTheme.typography.titleLarge, modifier = Modifier.semantics { heading() })
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(t.instrument, { onChange(t.copy(instrument = it.take(12))) }, label = { Text("Instrument") }, singleLine = true, modifier = Modifier.weight(1f))
            OutlinedTextField(t.date, { onChange(t.copy(date = it.take(10))) }, label = { Text("Date") }, singleLine = true, modifier = Modifier.weight(1f),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number))
        }
        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
            listOf("long" to "Long", "short" to "Short").forEachIndexed { i, (v, l) ->
                SegmentedButton(selected = t.direction == v, onClick = { onChange(t.copy(direction = v)) }, shape = SegmentedButtonDefaults.itemShape(i, 2),
                    modifier = Modifier.height(48.dp)) { Text(l) }
            }
        }
        val num = KeyboardOptions(keyboardType = KeyboardType.Decimal)
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            OutlinedTextField(t.entry, { onChange(t.copy(entry = it.take(16))) }, label = { Text("Entry") }, singleLine = true, keyboardOptions = num, modifier = Modifier.weight(1f))
            OutlinedTextField(t.exit, { onChange(t.copy(exit = it.take(16))) }, label = { Text("Exit") }, singleLine = true, keyboardOptions = num, modifier = Modifier.weight(1f))
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            OutlinedTextField(t.size, { onChange(t.copy(size = it.take(10))) }, label = { Text("Size") }, singleLine = true, keyboardOptions = num, modifier = Modifier.weight(1f))
            OutlinedTextField(t.fees, { onChange(t.copy(fees = it.take(10))) }, label = { Text("Fees") }, singleLine = true, keyboardOptions = num, modifier = Modifier.weight(1f))
        }
        Text("P&L = (exit \u2212 entry) \u00d7 size \u2212 fees, the same formula as the website journal.",
            style = MaterialTheme.typography.bodySmall, color = Tz.colors.muted)
        error?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = Tz.colors.down, modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }) }
        Button(onClick = onSave, enabled = !busy, shape = RoundedCornerShape(24.dp), colors = ButtonDefaults.buttonColors(containerColor = Mint, contentColor = OnMint),
            modifier = Modifier.fillMaxWidth().height(48.dp)) { Text(if (busy) "Saving\u2026" else "Save trade") }
        androidx.compose.material3.TextButton(onClick = onFullForm, modifier = Modifier.fillMaxWidth().height(48.dp)) { Text("Full form on tradezoro.com", color = MaterialTheme.colorScheme.onSurface) }
        Spacer(Modifier.height(0.dp))
    }
}
