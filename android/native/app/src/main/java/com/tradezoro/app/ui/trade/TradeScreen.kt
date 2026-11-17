package com.tradezoro.app.ui.trade

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.tradezoro.app.data.OrderType
import com.tradezoro.app.data.PaperOrder
import com.tradezoro.app.data.PaperPos
import com.tradezoro.app.data.PaperTrade
import com.tradezoro.app.data.displayTicker
import com.tradezoro.app.data.money
import com.tradezoro.app.data.priceText
import com.tradezoro.app.data.qtyText
import com.tradezoro.app.ui.common.TzIcons
import com.tradezoro.app.ui.theme.Mint
import com.tradezoro.app.ui.theme.OnMint
import com.tradezoro.app.ui.theme.Tabular
import com.tradezoro.app.ui.theme.Tz

data class TradeActions(
    val onType: (OrderType) -> Unit = {},
    val onPrice: (String) -> Unit = {},
    val onPriceStep: (Int) -> Unit = {},
    val onQty: (Int) -> Unit = {},
    val onBracket: (takeProfit: Boolean, dir: Int) -> Unit = { _, _ -> },
    val onBuy: () -> Unit = {},
    val onSell: () -> Unit = {},
    val onFlatten: () -> Unit = {},
    val onPaperOn: () -> Unit = {},
    val onClose: (String) -> Unit = {},
    val onCancel: (Long) -> Unit = {},
    val onSymbol: () -> Unit = {},
    val onTab: (PanelTab) -> Unit = {},
    val onScalpBuy: () -> Unit = {},
    val onScalpSell: () -> Unit = {},
    /** DOM ladder tap: a limit order of the ticket quantity at that price. */
    val onDom: (side: String, price: Double) -> Unit = { _, _ -> },
)

/** Trade tab, app-mock/3-trade.png. Paper trading only: the site's paper engine, demo money, no broker. */
@Composable
fun TradeContent(state: TradeUiState, actions: TradeActions, modifier: Modifier = Modifier) {
    val s = state.snap
    val light = MaterialTheme.colorScheme.background.luminance() > 0.5f
    Column(modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp)) {
        AccountCard(state, light)
        Spacer(Modifier.height(8.dp))
        SymbolCard(state, actions.onSymbol)
        if (!s.ready) {
            Text("Loading the paper account\u2026", style = MaterialTheme.typography.bodyMedium, color = Tz.colors.muted,
                modifier = Modifier.padding(vertical = 24.dp).fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite }, textAlign = TextAlign.Center)
        } else if (!s.on) {
            Spacer(Modifier.height(16.dp))
            Text("Paper trading is off. Turn it on to practise with demo money on live prices.", style = MaterialTheme.typography.bodyMedium, color = Tz.colors.muted)
            Spacer(Modifier.height(16.dp))
            Button(onClick = actions.onPaperOn, shape = RoundedCornerShape(24.dp), colors = ButtonDefaults.buttonColors(containerColor = Mint, contentColor = OnMint),
                modifier = Modifier.fillMaxWidth().height(48.dp)) { Text("Turn on paper trading", style = MaterialTheme.typography.titleSmall) }
        } else {
            Spacer(Modifier.height(16.dp))
            OrderPanel(state, actions)
            Lists(state, actions)
        }
        Spacer(Modifier.height(16.dp))
        Text(if (state.sample) "Sample data" else "Paper trading uses demo money. Nothing is sent to any broker. Education only. Not financial advice.",
            style = MaterialTheme.typography.labelSmall, color = Tz.colors.muted, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(16.dp))
    }
}

@Composable
private fun AccountCard(state: TradeUiState, light: Boolean) {
    val a = state.snap.acct
    Row(
        Modifier.fillMaxWidth().heightIn(min = 80.dp).clip(RoundedCornerShape(16.dp)).background(MaterialTheme.colorScheme.surfaceVariant)
            .padding(horizontal = 16.dp, vertical = 12.dp).semantics(mergeDescendants = true) {},
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(if (state.snap.signedIn || state.sample) "Paper account" else "Paper account \u00b7 this device",
                style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Normal), color = Tz.colors.muted)
            Text(a?.let { money(it.equity) } ?: "\u2014", style = MaterialTheme.typography.headlineSmall.merge(Tabular), maxLines = 1)
            if (a != null) {
                val day = a.dayPnl
                Text("Today ${money(day, sign = true)} \u00b7 Balance ${money(a.balance)}", style = MaterialTheme.typography.labelMedium.merge(Tabular).copy(fontWeight = FontWeight.Normal),
                    color = Tz.colors.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        val c = if (light) PaperAmberLight else PaperAmber
        val shape = RoundedCornerShape(8.dp)
        Box(Modifier.height(24.dp).clip(shape).border(1.dp, c.copy(alpha = 0.45f), shape).padding(horizontal = 8.dp), contentAlignment = Alignment.Center) {
            Text("Paper trading", style = MaterialTheme.typography.labelSmall, color = c)
        }
    }
}

/** The active chart symbol: its position (as in the mock) or its last price. Tapping opens the chart to change it. */
@Composable
private fun SymbolCard(state: TradeUiState, onSymbol: () -> Unit) {
    val s = state.snap
    val pos = s.positions.firstOrNull { it.sym == s.spec?.symbol }
    val shape = RoundedCornerShape(16.dp)
    Row(
        Modifier.fillMaxWidth().heightIn(min = 72.dp).clip(shape).background(MaterialTheme.colorScheme.surface).border(1.dp, Tz.colors.hairline, shape)
            .clickable(role = Role.Button, onClickLabel = "Change symbol on the chart") { onSymbol() }
            .padding(horizontal = 16.dp, vertical = 12.dp).semantics(mergeDescendants = true) {},
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(state.ticker.ifEmpty { "\u2014" }, style = MaterialTheme.typography.titleMedium.copy(fontWeight = FontWeight.SemiBold))
                Text(" " + (pos?.let { "${if (it.side == "sell") "Short" else "Long"} ${if (it.side == "sell") "\u2212" else "+"}${qtyText(it.qty)}" } ?: "No position"),
                    style = MaterialTheme.typography.titleMedium, color = Tz.colors.muted, maxLines = 1)
                Icon(TzIcons.ChevronDown, contentDescription = null, tint = Tz.colors.muted, modifier = Modifier.padding(start = 4.dp).size(16.dp))
            }
            val sub = if (pos != null) "Avg ${priceText(pos.avg, state.decimals)} \u00b7 Last ${priceText(s.last, state.decimals)}"
                else s.specError ?: "Last ${priceText(s.last, state.decimals)}"
            Text(sub, style = MaterialTheme.typography.labelMedium.merge(Tabular).copy(fontWeight = FontWeight.Normal), color = Tz.colors.muted, maxLines = 2)
        }
        if (pos != null) {
            Column(horizontalAlignment = Alignment.End) {
                Text(money(pos.pnl, sign = true), style = MaterialTheme.typography.titleMedium.merge(Tabular).copy(fontSize = 18.sp, fontWeight = FontWeight.SemiBold), color = pnlColor(pos.pnl))
                Text("Open P&L", style = MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Normal), color = pnlColor(pos.pnl))
            }
        }
    }
}

@Composable
private fun pnlColor(v: Double) = when { v > 0 -> Tz.colors.up; v < 0 -> Tz.colors.down; else -> Tz.colors.muted }

/** Order tab of the panel: Market | Limit | Stop, price, quantity, stop loss, take profit, Buy / Sell. */
@Composable
internal fun OrderTicket(state: TradeUiState, actions: TradeActions) {
    TypeTabs(state.ticket.type, actions.onType)
    Spacer(Modifier.height(16.dp))
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (state.ticket.type != OrderType.MARKET) PriceField(state, actions)
        StepField("Quantity (${if (state.futures) "contracts" else "units"})", qtyText(state.ticket.qty), "quantity",
            decEnabled = state.ticket.qty > state.qtyStep, onDec = { actions.onQty(-1) }, onInc = { actions.onQty(1) })
        BracketField(state, takeProfit = false, actions)
        BracketField(state, takeProfit = true, actions)
    }
    Spacer(Modifier.height(16.dp))
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        val what = "${qtyText(state.ticket.qty)} ${state.ticker} ${state.ticket.type.label.lowercase()}"
        Button(onClick = actions.onBuy, enabled = state.canTrade, shape = RoundedCornerShape(28.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Mint, contentColor = OnMint),
            modifier = Modifier.weight(1f).height(56.dp).semantics { contentDescription = "Paper buy $what" },
        ) { Text("Buy", fontSize = 18.sp, fontWeight = FontWeight.SemiBold) }
        Button(onClick = actions.onSell, enabled = state.canTrade, shape = RoundedCornerShape(28.dp),
            colors = ButtonDefaults.buttonColors(containerColor = SellRed, contentColor = OnSell),
            modifier = Modifier.weight(1f).height(56.dp).semantics { contentDescription = "Paper sell $what" },
        ) { Text("Sell", fontSize = 18.sp, fontWeight = FontWeight.SemiBold) }
    }
}

@Composable
private fun TypeTabs(type: OrderType, onType: (OrderType) -> Unit) {
    Column {
        Row(Modifier.fillMaxWidth().height(48.dp)) {
            OrderType.entries.forEach { t ->
                val on = t == type
                Box(
                    Modifier.weight(1f).fillMaxSize().clickable(role = Role.Tab) { onType(t) }.semantics { selected = on },
                    contentAlignment = Alignment.Center,
                ) {
                    Text(t.label, style = MaterialTheme.typography.titleMedium, color = if (on) MaterialTheme.colorScheme.onBackground else Tz.colors.muted)
                    if (on) Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(3.dp).background(MaterialTheme.colorScheme.onBackground))
                }
            }
        }
        HorizontalDivider(color = Tz.colors.hairline)
    }
}

/** A 56dp bordered field: small label + value on the left, steppers on the right. */
@Composable
private fun FieldRow(label: String, value: @Composable () -> Unit, trailing: @Composable () -> Unit) {
    val shape = RoundedCornerShape(12.dp)
    Row(
        Modifier.fillMaxWidth().heightIn(min = 56.dp).clip(shape).border(1.dp, Tz.colors.hairline, shape).padding(start = 16.dp, end = 12.dp),  // 12 + the 4dp touch margin = chips 16dp from the edge
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f).padding(vertical = 8.dp)) {
            Text(label, style = MaterialTheme.typography.labelSmall.copy(letterSpacing = 0.sp), color = Tz.colors.muted)
            value()
        }
        trailing()
    }
}

@Composable
private fun StepField(label: String, value: String, what: String, decEnabled: Boolean, onDec: () -> Unit, onInc: () -> Unit, extra: String? = null) {
    FieldRow(label, { ValueText(value) }) {
        if (extra != null) Text(extra, style = MaterialTheme.typography.labelLarge.merge(Tabular), color = Tz.colors.muted, modifier = Modifier.padding(end = 4.dp))
        Steppers(what, decEnabled, onDec, onInc)
    }
}

@Composable
private fun ValueText(v: String, color: Color = Color.Unspecified) =
    Text(v, style = MaterialTheme.typography.titleMedium.merge(Tabular), color = color, maxLines = 1)

/** Two 40x32 chips inside 48x48 touch boxes (mock "−" "+"). */
@Composable
private fun Steppers(what: String, decEnabled: Boolean, onDec: () -> Unit, onInc: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        StepChip(TzIcons.Minus, "Less $what", decEnabled, onDec)
        StepChip(TzIcons.Plus, "More $what", true, onInc)
    }
}

@Composable
private fun StepChip(icon: androidx.compose.ui.graphics.vector.ImageVector, desc: String, enabled: Boolean, onClick: () -> Unit) {
    IconButton(onClick = onClick, enabled = enabled, modifier = Modifier.size(48.dp)) {
        val shape = RoundedCornerShape(8.dp)
        Box(Modifier.size(width = 40.dp, height = 32.dp).clip(shape).border(1.dp, Tz.colors.hairline, shape), contentAlignment = Alignment.Center) {
            Icon(icon, contentDescription = desc, modifier = Modifier.size(16.dp), tint = if (enabled) MaterialTheme.colorScheme.onBackground else Tz.colors.muted.copy(alpha = 0.5f))
        }
    }
}

@Composable
private fun PriceField(state: TradeUiState, actions: TradeActions) {
    val label = "${state.ticket.type.label} price"
    FieldRow(label, {
        BasicTextField(
            value = state.ticket.priceText, onValueChange = actions.onPrice, singleLine = true,
            textStyle = MaterialTheme.typography.titleMedium.merge(Tabular).copy(color = MaterialTheme.colorScheme.onBackground),
            cursorBrush = SolidColor(MaterialTheme.colorScheme.onBackground),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            modifier = Modifier.fillMaxWidth().semantics { contentDescription = label },
        )
    }) { Steppers("price", true, { actions.onPriceStep(-1) }, { actions.onPriceStep(1) }) }
}

@Composable
private fun BracketField(state: TradeUiState, takeProfit: Boolean, actions: TradeActions) {
    val ticks = if (takeProfit) state.ticket.tpTicks else state.ticket.slTicks
    val label = if (takeProfit) "Take profit" else "Stop loss"
    // Ticks from the entry, so one setting fits both buttons: the level sits on the right side for Buy and for Sell.
    val value = state.legValue(takeProfit)
    FieldRow(label, {
        ValueText(if (ticks == 0) "Off" else "${if (takeProfit) "+" else "\u2212"}$ticks ticks", if (ticks == 0) Tz.colors.muted else Color.Unspecified)
        if (ticks > 0) {
            val buy = if (takeProfit) state.tp("buy") else state.sl("buy")
            val sell = if (takeProfit) state.tp("sell") else state.sl("sell")
            Text("Buy @ ${priceText(buy, state.decimals)} \u00b7 Sell @ ${priceText(sell, state.decimals)}",
                style = MaterialTheme.typography.labelSmall.merge(Tabular).copy(letterSpacing = 0.sp), color = Tz.colors.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }) {
        value?.let { Text(money(it, sign = true), style = MaterialTheme.typography.labelLarge.merge(Tabular), color = Tz.colors.muted, modifier = Modifier.padding(end = 4.dp)) }
        Steppers(label.lowercase(), ticks > 0, { actions.onBracket(takeProfit, -1) }, { actions.onBracket(takeProfit, 1) })
    }
}

@Composable
private fun SectionTitle(t: String) {
    Text(t, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 24.dp, bottom = 8.dp).semantics { heading() })
}

@Composable
private fun Lists(state: TradeUiState, actions: TradeActions) {
    val s = state.snap
    SectionTitle("Positions")
    if (s.positions.isEmpty()) Empty("No open paper positions.") else s.positions.forEach { PositionRow(it, actions.onClose) }
    SectionTitle("Working orders")
    if (s.orders.isEmpty()) Empty("No working paper orders.") else s.orders.forEach { OrderRow(it, actions.onCancel) }
    SectionTitle("Recent trades")
    if (s.trades.isEmpty()) Empty("No closed paper trades yet.") else s.trades.take(10).forEach { TradeRow(it) }
}

@Composable
private fun Empty(t: String) = Text(t, style = MaterialTheme.typography.bodyMedium, color = Tz.colors.muted, modifier = Modifier.padding(vertical = 8.dp))

@Composable
private fun ListRow(title: String, sub: String, right: @Composable () -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 56.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f).semantics(mergeDescendants = true) {}) {
            Text(title, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(sub, style = MaterialTheme.typography.labelMedium.merge(Tabular).copy(fontWeight = FontWeight.Normal), color = Tz.colors.muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        right()
    }
    HorizontalDivider(color = Tz.colors.hairline)
}

private fun sideWord(side: String) = if (side == "sell") "Short" else "Long"

@Composable
private fun PositionRow(p: PaperPos, onClose: (String) -> Unit) {
    val t = displayTicker(p.sym)
    ListRow("$t ${sideWord(p.side)} ${qtyText(p.qty)}", "Avg ${priceText(p.avg, 2)} \u00b7 Last ${priceText(p.last, 2)}") {
        Text(money(p.pnl, sign = true), style = MaterialTheme.typography.titleSmall.merge(Tabular), color = pnlColor(p.pnl))
        TextButton(onClick = { onClose(p.sym) }, modifier = Modifier.offset(x = 12.dp).heightIn(min = 48.dp).semantics { contentDescription = "Close $t paper position" }) {
            Text("Close", color = MaterialTheme.colorScheme.onBackground)
        }
    }
}

@Composable
private fun OrderRow(o: PaperOrder, onCancel: (Long) -> Unit) {
    val t = displayTicker(o.sym)
    val br = listOfNotNull(o.sl?.let { "SL ${priceText(it, 2)}" }, o.tp?.let { "TP ${priceText(it, 2)}" }).joinToString(" \u00b7 ")
    ListRow("$t ${if (o.side == "sell") "Sell" else "Buy"} ${o.type} ${qtyText(o.qty)}", "@ ${priceText(o.price, 2)}" + if (br.isNotEmpty()) " \u00b7 $br" else "") {
        TextButton(onClick = { onCancel(o.id) }, modifier = Modifier.offset(x = 12.dp).heightIn(min = 48.dp).semantics { contentDescription = "Cancel $t paper order" }) {
            Text("Cancel", color = MaterialTheme.colorScheme.onBackground)
        }
    }
}

@Composable
private fun TradeRow(t: PaperTrade) {
    val why = when (t.reason) { "tp" -> " \u00b7 Take profit"; "sl" -> " \u00b7 Stop loss"; else -> "" }
    ListRow("${displayTicker(t.sym)} ${sideWord(t.side)} ${qtyText(t.qty)}", "${priceText(t.entry, 2)} \u2192 ${priceText(t.exit, 2)}$why") {
        Text(money(t.pnl, sign = true), style = MaterialTheme.typography.titleSmall.merge(Tabular), color = pnlColor(t.pnl), modifier = Modifier.width(96.dp), textAlign = TextAlign.End)
    }
}
