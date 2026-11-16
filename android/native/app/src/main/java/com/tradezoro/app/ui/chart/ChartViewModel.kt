package com.tradezoro.app.ui.chart

import androidx.lifecycle.ViewModel
import com.tradezoro.app.data.BridgeState
import com.tradezoro.app.data.Timeframe
import com.tradezoro.app.data.displayTicker
import com.tradezoro.app.data.isFuturesId
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import java.math.BigDecimal
import java.math.RoundingMode

/** Native chrome state around the embedded chart. Prices only ever come from the chart page itself. */
data class ChartUiState(
    val ready: Boolean = false,
    val symbolId: String = "",
    val tf: Timeframe? = null,
    val last: Double? = null,
    /** Change vs the previous daily close from the Home watchlist, for the symbol [changeFor] only. */
    val change: Double? = null,
    val changeFor: String = "",
    val qty: Double = 1.0,
    val paperOn: Boolean = false,
    val position: String? = null,
    val fullscreen: Boolean = false,
    val sample: Boolean = false,
) {
    val changePct: Double? get() = change.takeIf { changeFor == symbolId }
    val ticker: String get() = if (symbolId.isEmpty()) "" else displayTicker(symbolId)
    val futures: Boolean get() = symbolId.isEmpty() || isFuturesId(symbolId)
    val qtyStep: Double get() = if (futures) 1.0 else 0.01
    val qtyText: String get() = if (futures) qty.toLong().toString() else BigDecimal(qty).setScale(2, RoundingMode.HALF_UP).stripTrailingZeros().toPlainString()
}

class ChartViewModel : ViewModel() {
    private val _state = MutableStateFlow(ChartUiState())
    val state: StateFlow<ChartUiState> = _state.asStateFlow()

    /** Toasts from the paper engine waiting to be shown as snackbars. */
    private val _messages = MutableStateFlow<List<String>>(emptyList())
    val messages: StateFlow<List<String>> = _messages.asStateFlow()

    fun onBridge(b: BridgeState) {
        _state.update { s ->
            val symChanged = b.sym.isNotEmpty() && b.sym != s.symbolId
            s.copy(
                ready = b.ready,
                symbolId = b.sym.ifEmpty { s.symbolId },
                tf = Timeframe.fromLabel(b.tf) ?: if (b.tf.isEmpty()) s.tf else null,
                last = b.last ?: if (symChanged) null else s.last,
                paperOn = b.paper,
                position = b.pos?.let { p -> "${if (p.side == "sell") "Short" else "Long"} ${trimQty(p.qty)} @ ${trimPrice(p.avg)}" },
                qty = if (symChanged) (if (isFuturesId(b.sym)) 1.0 else 0.01) else s.qty,
            )
        }
        if (b.toasts.isNotEmpty()) _messages.update { it + b.toasts.map { t -> t.msg }.filter { m -> m.isNotBlank() } }
    }

    /** (chart id, ticker) picked on Home, applied once the chart is ready. */
    private val _pending = MutableStateFlow<Pair<String, String>?>(null)
    val pendingSymbol: StateFlow<Pair<String, String>?> = _pending.asStateFlow()
    fun openSymbol(chartId: String, ticker: String, changePct: Double?) {
        _pending.value = chartId to ticker
        _state.update { it.copy(change = changePct, changeFor = chartId) }
    }
    fun clearPending() { _pending.value = null }

    fun consumeMessage() = _messages.update { it.drop(1) }
    fun pickTf(tf: Timeframe) = _state.update { it.copy(tf = tf) }

    fun inc() = _state.update { it.copy(qty = round2(it.qty + it.qtyStep).coerceAtMost(if (it.futures) 500.0 else 1_000_000.0)) }
    fun dec() = _state.update { it.copy(qty = round2(it.qty - it.qtyStep).coerceAtLeast(it.qtyStep)) }
    fun setFullscreen(on: Boolean) = _state.update { it.copy(fullscreen = on) }

    private fun round2(v: Double) = BigDecimal(v).setScale(2, RoundingMode.HALF_UP).toDouble()

    companion object {
        fun trimQty(q: Double): String = BigDecimal(q).setScale(4, RoundingMode.HALF_UP).stripTrailingZeros().toPlainString()
        fun trimPrice(p: Double): String = String.format(java.util.Locale.US, "%,.2f", p)
    }
}
