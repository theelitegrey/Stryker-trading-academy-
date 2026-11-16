package com.tradezoro.app.ui.trade

import androidx.lifecycle.ViewModel
import com.tradezoro.app.data.OrderType
import com.tradezoro.app.data.PaperSnapshot
import com.tradezoro.app.data.bracketPrice
import com.tradezoro.app.data.bracketStep
import com.tradezoro.app.data.bracketValue
import com.tradezoro.app.data.defaultOrderPrice
import com.tradezoro.app.data.orderJson
import com.tradezoro.app.data.roundTick
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import java.math.BigDecimal
import java.math.RoundingMode

/** The order ticket the member is filling in. Brackets are in ticks; 0 = off (the site ticket's "Ticks" unit). */
data class Ticket(
    val type: OrderType = OrderType.MARKET,
    val qty: Double = 1.0,
    /** Limit / stop price as typed; null until the first price arrives. */
    val priceText: String = "",
    val slTicks: Int = 0,
    val tpTicks: Int = 0,
)

data class TradeUiState(
    val snap: PaperSnapshot = PaperSnapshot(),
    val ticket: Ticket = Ticket(),
    val sample: Boolean = false,
) {
    val spec get() = snap.spec
    val futures: Boolean get() = spec?.kind != "crypto"
    val qtyStep: Double get() = if (futures) 1.0 else 0.01
    val decimals: Int get() = spec?.decimals ?: 2
    val ticker: String get() = com.tradezoro.app.data.displayTicker(snap.sym)
    val orderPrice: Double? get() = ticket.priceText.replace(",", "").toDoubleOrNull()?.takeIf { it > 0 }
    /** The entry the brackets are measured from: last for market, the typed price for limit / stop. */
    fun entry(): Double? = if (ticket.type == OrderType.MARKET) snap.last else orderPrice
    fun sl(side: String): Double? { val s = spec ?: return null; val e = entry() ?: return null; return bracketPrice(side, e, ticket.slTicks, s.tick, takeProfit = false) }
    fun tp(side: String): Double? { val s = spec ?: return null; val e = entry() ?: return null; return bracketPrice(side, e, ticket.tpTicks, s.tick, takeProfit = true) }
    /** $ at the leg for a long (the side shown in the ticket rows); null when off. */
    fun legValue(takeProfit: Boolean): Double? {
        val s = spec ?: return null; val e = entry() ?: return null
        val lvl = (if (takeProfit) tp("buy") else sl("buy")) ?: return null
        return bracketValue("buy", ticket.qty, e, lvl, s.pointValue)
    }
    val canTrade: Boolean get() = snap.ready && snap.on && spec != null && snap.last != null &&
        (ticket.type == OrderType.MARKET || orderPrice != null)
}

class TradeViewModel : ViewModel() {
    private val _state = MutableStateFlow(TradeUiState())
    val state: StateFlow<TradeUiState> = _state.asStateFlow()

    fun onSnapshot(s: PaperSnapshot) = _state.update { st ->
        val symChanged = s.sym != st.snap.sym && s.sym.isNotEmpty()
        val crypto = s.spec?.kind == "crypto"
        var t = if (symChanged) Ticket(type = st.ticket.type, qty = if (crypto) 0.01 else 1.0) else st.ticket
        // First price for a limit / stop ticket: pre-fill like the site ticket does.
        if (t.type != OrderType.MARKET && t.priceText.isEmpty() && s.last != null && s.spec != null) t = t.copy(priceText = fmt(defaultOrderPrice(t.type, "buy", s.last, s.spec.tick), s.spec.decimals))
        st.copy(snap = s, ticket = t)
    }

    fun setType(type: OrderType) = _state.update { st ->
        val s = st.spec; val last = st.snap.last
        val price = if (type != OrderType.MARKET && s != null && last != null) fmt(defaultOrderPrice(type, "buy", last, s.tick), s.decimals) else ""
        st.copy(ticket = st.ticket.copy(type = type, priceText = price))
    }

    fun setPriceText(v: String) = _state.update { it.copy(ticket = it.ticket.copy(priceText = v.filter { c -> c.isDigit() || c == '.' }.take(16))) }

    fun stepPrice(dir: Int) = _state.update { st ->
        val s = st.spec ?: return@update st
        val base = st.orderPrice ?: st.snap.last ?: return@update st
        st.copy(ticket = st.ticket.copy(priceText = fmt(roundTick(base + dir * s.tick, s.tick), s.decimals)))
    }

    fun stepQty(dir: Int) = _state.update { st ->
        val max = st.spec?.maxQty ?: if (st.futures) 500.0 else 1_000_000.0
        val q = round4(st.ticket.qty + dir * st.qtyStep).coerceIn(st.qtyStep, max)
        st.copy(ticket = st.ticket.copy(qty = q))
    }

    fun stepBracket(takeProfit: Boolean, dir: Int) = _state.update { st ->
        val step = bracketStep(st.spec, st.snap.last)
        val t = st.ticket
        val cur = if (takeProfit) t.tpTicks else t.slTicks
        // Stepping down from the first step turns the bracket off.
        val next = (cur + dir * step).coerceIn(0, 100_000)
        st.copy(ticket = if (takeProfit) t.copy(tpTicks = next) else t.copy(slTicks = next))
    }

    /** JS for the bridge, or null when the ticket is not ready (the buttons are disabled then anyway). */
    fun orderCall(side: String): String? {
        val st = _state.value
        if (!st.canTrade) return null
        val json = orderJson(side, st.ticket.type, st.ticket.qty, st.orderPrice, st.sl(side), st.tp(side))
        return "TZB.order($json)"
    }

    companion object {
        fun fmt(v: Double, decimals: Int): String = BigDecimal(v).setScale(decimals.coerceIn(0, 8), RoundingMode.HALF_UP).toPlainString()
        private fun round4(v: Double) = BigDecimal(v).setScale(4, RoundingMode.HALF_UP).toDouble()
    }
}
