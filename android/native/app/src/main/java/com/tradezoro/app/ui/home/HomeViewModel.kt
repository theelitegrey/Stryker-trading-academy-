package com.tradezoro.app.ui.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.tradezoro.app.data.DEFAULT_WATCHLIST
import com.tradezoro.app.data.HttpQuoteRepository
import com.tradezoro.app.data.Quote
import com.tradezoro.app.data.QuoteRepository
import com.tradezoro.app.data.WatchSymbol
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit

sealed interface RowState {
    data object Loading : RowState
    data class Ready(val quote: Quote) : RowState
    /** Fetch failed; [stale] is the last good quote, if any. */
    data class Failed(val stale: Quote?) : RowState
}

data class WatchRow(val symbol: WatchSymbol, val state: RowState)

/** [sample] = fixture numbers (previews / screenshot tests); the UI then labels them "Sample data". */
data class HomeUiState(val rows: List<WatchRow>, val sample: Boolean = false) {
    /** True when any shown futures quote comes from a delayed source. */
    val anyDelayed: Boolean get() = rows.any { (it.state as? RowState.Ready)?.quote?.realtime == false }
}

class HomeViewModel(
    private val repo: QuoteRepository = HttpQuoteRepository(),
    private val symbols: List<WatchSymbol> = DEFAULT_WATCHLIST,
    private val pollMs: Long = POLL_MS,
) : ViewModel() {

    private val _state = MutableStateFlow(HomeUiState(symbols.map { WatchRow(it, RowState.Loading) }))
    val state: StateFlow<HomeUiState> = _state.asStateFlow()
    private var poller: Job? = null

    /** Starts polling (call when the screen is visible); [stop] when it is not. */
    fun start() {
        if (poller?.isActive == true) return
        poller = viewModelScope.launch {
            while (isActive) { refresh(); delay(pollMs) }
        }
    }

    fun stop() { poller?.cancel(); poller = null }

    suspend fun refresh() {
        val gate = Semaphore(4)   // at most 4 requests in flight, like the site
        val jobs = symbols.map { sym ->
            viewModelScope.launch {
                val next = try {
                    RowState.Ready(gate.withPermit { repo.quote(sym) })
                } catch (e: CancellationException) { throw e } catch (e: Exception) {
                    RowState.Failed(lastGood(sym))
                }
                _state.update { s -> s.copy(rows = s.rows.map { if (it.symbol == sym) it.copy(state = next) else it }) }
            }
        }
        jobs.forEach { it.join() }
    }

    private fun lastGood(sym: WatchSymbol): Quote? = when (val r = _state.value.rows.first { it.symbol == sym }.state) {
        is RowState.Ready -> r.quote
        is RowState.Failed -> r.stale
        RowState.Loading -> null
    }

    companion object { const val POLL_MS = 25_000L }
}
