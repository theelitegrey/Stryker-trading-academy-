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
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.tradezoro.app.data.money
import com.tradezoro.app.data.priceText
import com.tradezoro.app.data.qtyText
import com.tradezoro.app.data.roundTick
import com.tradezoro.app.ui.common.SlimPill
import com.tradezoro.app.ui.common.TzIcons
import com.tradezoro.app.ui.theme.Mint
import com.tradezoro.app.ui.theme.OnMint
import com.tradezoro.app.ui.theme.Tabular
import com.tradezoro.app.ui.theme.Tz

/** The browser order panel's tabs (assets/chart-order-panel.js). */
enum class PanelTab(val label: String) { SCALP("Scalp"), DOM("DOM"), ORDER("Order") }

internal val SellRed = Color(0xFFFF4D5E)
internal val OnSell = Color(0xFF2A060B)
internal val PaperAmber = Color(0xFFF5B942)
internal val PaperAmberLight = Color(0xFF8A5A00)

/**
 * The order panel, like the site's (chart-order-panel.js), paper only (the site's paper engine, demo money):
 *   Scalp: Buy (market) · quantity · Sell (market)
 *   DOM:   price ladder around the last price, one tick per row: tap the Buy column = buy limit there, Sell column = sell limit.
 *          Working orders and the position's average are marked. No order book sizes (the app has no book; nothing is made up).
 *   Order: Market | Limit | Stop, price, quantity, stop loss, take profit, Buy / Sell.
 *   Footer: Paper chip · position + open P&L · Flatten.
 */
@Composable
fun OrderPanel(state: TradeUiState, actions: TradeActions, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth()) {
        PanelTabs(state.tab, actions.onTab)
        Spacer(Modifier.height(16.dp))
        when (state.tab) {
            PanelTab.SCALP -> ScalpView(state, actions)
            PanelTab.DOM -> DomView(state, actions)
            PanelTab.ORDER -> OrderView(state, actions)
        }
        Spacer(Modifier.height(16.dp))
        PanelFooter(state, actions)
    }
}

@Composable
private fun PanelTabs(tab: PanelTab, onTab: (PanelTab) -> Unit) {
    Row(Modifier.fillMaxWidth().height(48.dp).clip(RoundedCornerShape(50)).background(MaterialTheme.colorScheme.surfaceVariant).padding(4.dp),
        horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        PanelTab.entries.forEach { t ->
            val on = t == tab
            Box(Modifier.weight(1f).height(40.dp).clip(RoundedCornerShape(50)).then(if (on) Modifier.background(Tz.colors.selected) else Modifier)
                .clickable(role = Role.Tab) { onTab(t) }.semantics { selected = on }, contentAlignment = Alignment.Center) {
                Text(t.label, style = MaterialTheme.typography.labelLarge.copy(fontSize = 14.sp), color = if (on) MaterialTheme.colorScheme.onBackground else Tz.colors.muted)
            }
        }
    }
}

@Composable
private fun QtyStepper(state: TradeUiState, onQty: (Int) -> Unit, modifier: Modifier = Modifier) {
    val shape = RoundedCornerShape(50)
    Row(modifier.height(48.dp).clip(shape).border(BorderStroke(1.dp, Tz.colors.hairline), shape), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = { onQty(-1) }, enabled = state.ticket.qty > state.qtyStep, modifier = Modifier.size(48.dp)) { Icon(TzIcons.Minus, contentDescription = "Less quantity") }
        Text(qtyText(state.ticket.qty), style = MaterialTheme.typography.titleSmall.merge(Tabular), textAlign = TextAlign.Center, maxLines = 1,
            modifier = Modifier.width(44.dp).semantics { contentDescription = "Quantity ${qtyText(state.ticket.qty)}" })
        IconButton(onClick = { onQty(1) }, modifier = Modifier.size(48.dp)) { Icon(TzIcons.Plus, contentDescription = "More quantity") }
    }
}

@Composable
private fun SideButton(buy: Boolean, enabled: Boolean, desc: String, onClick: () -> Unit, modifier: Modifier, label: String = if (buy) "Buy" else "Sell") {
    Button(
        onClick = onClick, enabled = enabled, shape = RoundedCornerShape(50),
        colors = ButtonDefaults.buttonColors(containerColor = if (buy) Mint else SellRed, contentColor = if (buy) OnMint else OnSell),
        modifier = modifier.height(48.dp).semantics { contentDescription = desc },
    ) { Text(label, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 1) }
}

@Composable
private fun ScalpView(state: TradeUiState, a: TradeActions) {
    val what = "${qtyText(state.ticket.qty)} ${state.ticker} at market"
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
        SideButton(true, state.canMarket, "Paper buy $what", a.onScalpBuy, Modifier.weight(1f))
        QtyStepper(state, a.onQty)
        SideButton(false, state.canMarket, "Paper sell $what", a.onScalpSell, Modifier.weight(1f))
    }
    Text("Market orders at the chart's price. ${if (state.futures) "Contracts" else "Units"}: ${qtyText(state.ticket.qty)}.",
        style = MaterialTheme.typography.bodySmall, color = Tz.colors.muted, modifier = Modifier.padding(top = 12.dp))
}

/** Ladder rows: [rows] ticks above and below the last price, newest price in the middle. */
fun domPrices(last: Double, tick: Double, rows: Int = 5): List<Double> =
    (rows downTo -rows).map { roundTick(roundTick(last, tick) + it * tick, tick) }

@Composable
private fun DomView(state: TradeUiState, a: TradeActions) {
    val s = state.snap; val spec = state.spec; val last = s.last
    if (spec == null || last == null) {
        Text("Waiting for the chart's price\u2026", style = MaterialTheme.typography.bodyMedium, color = Tz.colors.muted); return
    }
    val pos = s.positions.firstOrNull { it.sym == spec.symbol }
    val near = roundTick(last, spec.tick)
    Row(Modifier.fillMaxWidth().height(32.dp), verticalAlignment = Alignment.CenterVertically) {
        Text("Buy limit", style = MaterialTheme.typography.labelMedium, color = Tz.colors.up, modifier = Modifier.weight(1f), textAlign = TextAlign.Center)
        Text("Price", style = MaterialTheme.typography.labelMedium, color = Tz.colors.muted, modifier = Modifier.weight(1.2f), textAlign = TextAlign.Center)
        Text("Sell limit", style = MaterialTheme.typography.labelMedium, color = Tz.colors.down, modifier = Modifier.weight(1f), textAlign = TextAlign.Center)
    }
    val shape = RoundedCornerShape(12.dp)
    Column(Modifier.fillMaxWidth().clip(shape).border(1.dp, Tz.colors.hairline, shape)) {
        domPrices(last, spec.tick).forEach { p ->
            val mine = s.orders.filter { it.sym == spec.symbol && kotlin.math.abs(it.price - p) < spec.tick / 2 }
            val atLast = kotlin.math.abs(p - near) < spec.tick / 2
            val atAvg = pos != null && kotlin.math.abs(roundTick(pos.avg, spec.tick) - p) < spec.tick / 2
            val txt = priceText(p, state.decimals)
            Row(Modifier.fillMaxWidth().height(48.dp).then(if (atLast) Modifier.background(Tz.colors.selected) else Modifier), verticalAlignment = Alignment.CenterVertically) {
                DomCell(mine.filter { it.side == "buy" }.sumOf { it.qty }, true, Modifier.weight(1f), "Paper buy limit ${qtyText(state.ticket.qty)} at $txt", s.on) { a.onDom("buy", p) }
                Text(txt + if (atAvg) " \u2022" else "", style = MaterialTheme.typography.bodyMedium.merge(Tabular).copy(fontWeight = if (atLast) FontWeight.SemiBold else FontWeight.Normal),
                    textAlign = TextAlign.Center, maxLines = 1, modifier = Modifier.weight(1.2f))
                DomCell(mine.filter { it.side == "sell" }.sumOf { it.qty }, false, Modifier.weight(1f), "Paper sell limit ${qtyText(state.ticket.qty)} at $txt", s.on) { a.onDom("sell", p) }
            }
        }
    }
    Text("Tap Buy or Sell on a row for a paper limit order of ${qtyText(state.ticket.qty)} there. \u2022 = your average price.",
        style = MaterialTheme.typography.bodySmall, color = Tz.colors.muted, modifier = Modifier.padding(top = 8.dp))
    Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Text("Quantity", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
        QtyStepper(state, a.onQty)
    }
}

@Composable
private fun DomCell(working: Double, buy: Boolean, modifier: Modifier, desc: String, enabled: Boolean, onClick: () -> Unit) {
    val c = if (buy) Tz.colors.up else Tz.colors.down
    Box(modifier.height(48.dp).clickable(enabled = enabled, role = Role.Button, onClick = onClick).semantics { contentDescription = desc }, contentAlignment = Alignment.Center) {
        if (working > 0) Box(Modifier.clip(RoundedCornerShape(50)).background(c.copy(alpha = 0.18f)).padding(horizontal = 8.dp, vertical = 2.dp)) {
            Text(qtyText(working), style = MaterialTheme.typography.labelMedium.merge(Tabular), color = c)
        }
    }
}

@Composable
private fun OrderView(state: TradeUiState, a: TradeActions) {
    OrderTicket(state, a)
}

@Composable
private fun PanelFooter(state: TradeUiState, a: TradeActions) {
    val s = state.snap
    val light = MaterialTheme.colorScheme.background.luminance() > 0.5f
    val pos = s.positions.firstOrNull { it.sym == state.spec?.symbol }
    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        PaperChip(light)
        Column(Modifier.weight(1f)) {
            Text(pos?.let { "${if (it.side == "sell") "Short" else "Long"} ${qtyText(it.qty)} @ ${priceText(it.avg, state.decimals)}" } ?: "Flat",
                style = MaterialTheme.typography.bodyMedium.merge(Tabular), maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (pos != null) Text("Open P&L ${money(pos.pnl, sign = true)}", style = MaterialTheme.typography.labelMedium.merge(Tabular),
                color = when { pos.pnl > 0 -> Tz.colors.up; pos.pnl < 0 -> Tz.colors.down; else -> Tz.colors.muted })
            val wk = s.orders.size
            if (wk > 0) Text("$wk working order${if (wk == 1) "" else "s"}", style = MaterialTheme.typography.labelSmall, color = Tz.colors.muted)
        }
        SlimPill("Flatten", a.onFlatten, Modifier.testTag("flatten"), enabled = s.positions.isNotEmpty() || s.orders.isNotEmpty(),
            desc = "Flatten. Close all paper positions and cancel working orders")
    }
}

@Composable
internal fun PaperChip(light: Boolean) {
    val c = if (light) PaperAmberLight else PaperAmber
    val shape = RoundedCornerShape(8.dp)
    Box(Modifier.height(24.dp).clip(shape).border(1.dp, c.copy(alpha = 0.45f), shape).padding(horizontal = 8.dp), contentAlignment = Alignment.Center) {
        Text("Paper", style = MaterialTheme.typography.labelSmall, color = c)
    }
}

/** The chart's Trade sheet: symbol line, the panel (or "turn on paper trading"), the paper line. */
@Composable
fun TradeSheetContent(state: TradeUiState, actions: TradeActions, modifier: Modifier = Modifier) {
    val s = state.snap
    Column(modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, bottom = 24.dp)) {
        Row(Modifier.fillMaxWidth().height(40.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(state.ticker.ifEmpty { "\u2014" }, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
            Text(priceText(s.last, state.decimals), style = MaterialTheme.typography.titleSmall.merge(Tabular))
        }
        Spacer(Modifier.height(8.dp))
        when {
            !s.ready -> Text("Loading the paper account\u2026", style = MaterialTheme.typography.bodyMedium, color = Tz.colors.muted, modifier = Modifier.padding(vertical = 24.dp))
            !s.on -> {
                Text("Paper trading is off. Turn it on to place simulated orders with demo money.", style = MaterialTheme.typography.bodyMedium, color = Tz.colors.muted)
                Spacer(Modifier.height(16.dp))
                Button(onClick = actions.onPaperOn, shape = RoundedCornerShape(50), colors = ButtonDefaults.buttonColors(containerColor = Mint, contentColor = OnMint),
                    modifier = Modifier.fillMaxWidth().height(48.dp)) { Text("Turn on paper trading") }
            }
            else -> OrderPanel(state, actions)
        }
        Spacer(Modifier.height(12.dp))
        Text(if (state.sample) "Sample data" else "Paper trading uses demo money. Nothing is sent to any broker. Education only. Not financial advice.",
            style = MaterialTheme.typography.labelSmall, color = Tz.colors.muted, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
    }
}

