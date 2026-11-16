package com.tradezoro.app.ui.m4

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.tradezoro.app.data.GexMarket
import com.tradezoro.app.data.GexRepository
import com.tradezoro.app.data.GexView
import com.tradezoro.app.data.JournalRepository
import com.tradezoro.app.data.JournalTrade
import com.tradezoro.app.data.LearnModel
import com.tradezoro.app.data.LearnRepository
import com.tradezoro.app.data.SignInRequired
import com.tradezoro.app.data.learnModel
import com.tradezoro.app.data.newTradeDoc
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.YearMonth

// ---------------------------------------------------------------- Omega
sealed interface GexState {
    data object Loading : GexState
    data object SignedOut : GexState
    data class Ready(val view: GexView, val sample: Boolean = false) : GexState
    data class Failed(val message: String, val last: GexView?) : GexState
}

data class OmegaUiState(val market: GexMarket = GexMarket.MNQ, val gex: GexState = GexState.Loading)

class OmegaViewModel(private val load: suspend (GexMarket) -> GexView = GexRepository()::levels) : ViewModel() {
    private val _state = MutableStateFlow(OmegaUiState())
    val state: StateFlow<OmegaUiState> = _state.asStateFlow()
    private var job: Job? = null

    /** Polls every 60 s while the screen is visible (the API's edge cache is 30 s in session). */
    fun start() {
        if (job?.isActive == true) return
        job = viewModelScope.launch { while (isActive) { refresh(); delay(60_000) } }
    }
    fun stop() { job?.cancel(); job = null }

    fun select(m: GexMarket) {
        if (m == _state.value.market) return
        _state.value = OmegaUiState(m, GexState.Loading)
        stop(); start()
    }

    suspend fun refresh() {
        val m = _state.value.market
        val next = try { GexState.Ready(load(m)) } catch (e: SignInRequired) { GexState.SignedOut } catch (e: Exception) {
            if (e is kotlinx.coroutines.CancellationException) throw e
            GexState.Failed("Levels could not load. Check your connection.", lastView())
        }
        if (_state.value.market == m) _state.value = _state.value.copy(gex = next)
    }

    private fun lastView() = when (val g = _state.value.gex) { is GexState.Ready -> g.view; is GexState.Failed -> g.last; else -> null }
}

// ---------------------------------------------------------------- Mentis
sealed interface LearnState {
    data object Loading : LearnState
    /** signedIn=false: catalog only, no progress. */
    data class Ready(val model: LearnModel, val signedIn: Boolean, val sample: Boolean = false) : LearnState
}

class LearnViewModel(app: Application) : AndroidViewModel(app) {
    private val repo = LearnRepository(app)
    private val uid = MutableStateFlow<String?>(null)
    fun setUser(id: String?) { uid.value = id }

    @OptIn(ExperimentalCoroutinesApi::class)
    val state: StateFlow<LearnState> = uid.flatMapLatest { id ->
        val chapters = flow { emit(repo.chapters()) }
        if (id == null) chapters.map { LearnState.Ready(learnModel(it, emptySet()), signedIn = false) }
        else combine(chapters, repo.completed(id)) { c, done -> LearnState.Ready(learnModel(c, done), signedIn = true) }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), LearnState.Loading)
}

// ---------------------------------------------------------------- Nemesis
sealed interface JournalState {
    data object SignedOut : JournalState
    data object Loading : JournalState
    data class Ready(val trades: List<JournalTrade>, val sample: Boolean = false) : JournalState
    data class Failed(val message: String) : JournalState
}

data class NewTrade(
    val instrument: String = "NQ", val direction: String = "long", val date: String = LocalDate.now().toString(),
    val entry: String = "", val exit: String = "", val size: String = "1", val fees: String = "0",
) {
    /** Site rule (journal-form-settings.js): instrument, date, entry, exit and size are required. */
    val error: String? get() = when {
        instrument.isBlank() || runCatching { LocalDate.parse(date) }.isFailure -> "Instrument and a date (YYYY-MM-DD) are required."
        entry.toDoubleOrNull() == null || exit.toDoubleOrNull() == null || size.toDoubleOrNull() == null -> "Entry, exit and size are required."
        (size.toDoubleOrNull() ?: 0.0) <= 0 -> "Size must be above 0."
        fees.isNotBlank() && fees.toDoubleOrNull() == null -> "Fees must be a number."
        else -> null
    }
    fun doc() = newTradeDoc(instrument.trim().uppercase(), direction, date, null, entry.toDouble(), exit.toDouble(), size.toDouble(), fees.toDoubleOrNull() ?: 0.0)
}

class JournalViewModel(private val repo: JournalRepository = JournalRepository()) : ViewModel() {
    private val uid = MutableStateFlow<String?>(null)
    val month = MutableStateFlow(YearMonth.now())
    fun setUser(id: String?) { uid.value = id }
    fun shiftMonth(by: Long) { month.value = month.value.plusMonths(by) }

    @OptIn(ExperimentalCoroutinesApi::class)
    val state: StateFlow<JournalState> = uid.flatMapLatest { id ->
        if (id == null) flowOf(JournalState.SignedOut)
        else repo.trades(id).map { r -> r.fold({ JournalState.Ready(it) }, { JournalState.Failed("Your journal could not load. Check your connection.") }) }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), JournalState.Loading)

    fun add(t: NewTrade, onDone: (String?) -> Unit) = viewModelScope.launch {
        onDone(runCatching { repo.add(t.doc()) }.fold({ null }, { "That trade could not be saved. Try again." }))
    }
}
