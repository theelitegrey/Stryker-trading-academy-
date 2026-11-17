package com.tradezoro.app.ui.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.tradezoro.app.data.DEFAULT_ITEMS
import com.tradezoro.app.data.DEFAULT_WATCHLIST
import com.tradezoro.app.data.HttpQuoteRepository
import com.tradezoro.app.data.MAX_LISTS
import com.tradezoro.app.data.Quote
import com.tradezoro.app.data.QuoteRepository
import com.tradezoro.app.data.WatchEdit
import com.tradezoro.app.data.WatchStore
import com.tradezoro.app.data.WatchSymbol
import com.tradezoro.app.data.Watchlist
import com.tradezoro.app.data.isSection
import com.tradezoro.app.data.newListId
import com.tradezoro.app.data.symbolOf
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.coroutineScope
import com.tradezoro.app.data.LiveFeed
import com.tradezoro.app.data.cryptoPair
import com.tradezoro.app.data.hubRoot
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

/**
 * [items] = the active list as the site stores it (symbols + "###NAME" sections), [rows] = one per symbol.
 * [sample] = fixture numbers (previews / screenshot tests); the UI then labels them "Sample data".
 */
data class HomeUiState(
    val rows: List<WatchRow>,
    val sample: Boolean = false,
    val lists: List<Watchlist> = emptyList(),
    val activeId: String = "",
    val items: List<String> = rows.map { it.symbol.id },
    /** true once the member's lists have loaded (from the account, or this phone for guests). */
    val loaded: Boolean = false,
    val signedIn: Boolean = false,
    /** Futures prices are streaming live from the hub right now (signed agreement / current data, server-confirmed). */
    val live: Boolean = false,
) {
    /** True when any shown futures quote comes from a delayed source. */
    val anyDelayed: Boolean get() = rows.any { (it.state as? RowState.Ready)?.quote?.realtime == false }
    val active: Watchlist? get() = lists.firstOrNull { it.id == activeId }
    fun row(id: String): WatchRow? = rows.firstOrNull { it.symbol.id == id }
}

class HomeViewModel(
    private val repo: QuoteRepository = HttpQuoteRepository(),
    initial: List<WatchSymbol> = DEFAULT_WATCHLIST,
    private val pollMs: Long = POLL_MS,
) : ViewModel() {

    private val _state = MutableStateFlow(HomeUiState(initial.map { WatchRow(it, RowState.Loading) }))
    val state: StateFlow<HomeUiState> = _state.asStateFlow()
    private val _notes = MutableStateFlow<String?>(null)
    /** One-line messages for a snackbar ("NQ1! is already in this list."). */
    val notes: StateFlow<String?> = _notes.asStateFlow()
    fun consumeNote() { _notes.value = null }

    private var poller: Job? = null
    private var liveJob: Job? = null
    /** Last live price per watchlist id (wins over a polled bar that is older). */
    private val liveLast = HashMap<String, Double>()
    private var store: WatchStore? = null
    private var bindJob: Job? = null
    private var activePref: (String) -> Unit = {}
    private var seeding = false

    /**
     * Connects the lists: the member's account (live, shared with the website) or this phone. [preferred] = the list
     * last open here. A member with no lists gets the site's default list, created the same way the site does.
     */
    fun bind(s: WatchStore, signedIn: Boolean, preferred: String?, onActive: (String) -> Unit) {
        store = s; activePref = onActive; seeding = false
        bindJob?.cancel()
        _state.update { it.copy(loaded = false, signedIn = signedIn, lists = emptyList(), activeId = preferred ?: "") }
        bindJob = viewModelScope.launch {
            s.lists.collect { got ->
                if (got == null) return@collect
                if (got.isEmpty()) {
                    if (!seeding) { seeding = true; runCatching { s.save(Watchlist(newListId(), "Watchlist", DEFAULT_ITEMS)) }.onFailure { seeding = false } }
                    return@collect
                }
                val sorted = got.sortedBy { it.name.lowercase() }
                _state.update { st ->
                    val active = sorted.firstOrNull { it.id == st.activeId } ?: sorted.first()
                    st.copy(lists = sorted, activeId = active.id, loaded = true).withItems(active.items)
                }
                refreshSoon()
            }
        }
    }

    /** Rebuilds the rows for [items], keeping quotes already fetched. */
    private fun HomeUiState.withItems(items: List<String>): HomeUiState {
        val syms = items.filterNot(::isSection).distinct()
        val old = rows.associateBy { it.symbol.id }
        return copy(items = items, rows = syms.map { id -> old[id] ?: WatchRow(symbolOf(id), RowState.Loading) })
    }

    private var refreshJob: Job? = null
    private fun refreshSoon() {
        if (poller?.isActive != true) return
        if (refreshJob?.isActive == true) return
        refreshJob = viewModelScope.launch { refresh(onlyLoading = true) }
    }

    fun select(id: String) {
        val l = _state.value.lists.firstOrNull { it.id == id } ?: return
        _state.update { it.copy(activeId = id).withItems(l.items) }
        activePref(id)
        refreshSoon()
    }

    // ---- edits: shown at once, then saved (the account copy syncs to the website) ----
    private fun edit(next: (Watchlist) -> Watchlist?) {
        val cur = _state.value.active ?: return
        val l = next(cur) ?: return
        if (l == cur) return
        _state.update { st -> st.copy(lists = st.lists.map { if (it.id == l.id) l else it }).withItems(l.items) }
        save(l)
        refreshSoon()
    }

    private fun save(l: Watchlist) {
        val s = store ?: return
        viewModelScope.launch {
            try { s.save(l) } catch (e: CancellationException) { throw e } catch (e: Exception) { _notes.value = "Couldn't save the list. Check your connection." }
        }
    }

    fun add(id: String) = edit { l ->
        when (val r = WatchEdit.add(l, id)) {
            is WatchEdit.Result.Ok -> { _notes.value = "${symbolOf(id).chartTicker} added to ${l.name}."; r.list }
            is WatchEdit.Result.No -> { _notes.value = r.why; null }
        }
    }
    fun remove(id: String) = edit { WatchEdit.remove(it, id) }

    /** During a drag: reorder on screen only. [commitOrder] saves once when the finger lifts. */
    fun moveLocal(id: String, over: String) {
        val cur = _state.value.active ?: return
        val l = WatchEdit.move(cur, id, over)
        if (l != cur) _state.update { st -> st.copy(lists = st.lists.map { if (it.id == l.id) l else it }).withItems(l.items) }
    }
    fun commitOrder() { _state.value.active?.let(::save) }

    fun create(name: String) {
        val st = _state.value
        if (st.lists.size >= MAX_LISTS) { _notes.value = "You can have up to $MAX_LISTS lists."; return }
        val l = Watchlist(newListId(), WatchEdit.cleanName(name).ifEmpty { "Watchlist" }, emptyList())
        _state.update { it.copy(lists = (it.lists + l).sortedBy { x -> x.name.lowercase() }, activeId = l.id).withItems(l.items) }
        activePref(l.id)
        save(l)
    }
    fun rename(name: String) = edit { WatchEdit.rename(it, name) }
    fun deleteActive() {
        val st = _state.value
        val cur = st.active ?: return
        if (st.lists.size <= 1) { _notes.value = "Keep at least one list."; return }
        val rest = st.lists.filterNot { it.id == cur.id }
        _state.update { it.copy(lists = rest, activeId = rest.first().id).withItems(rest.first().items) }
        activePref(rest.first().id)
        val s = store ?: return
        viewModelScope.launch { runCatching { s.remove(cur) }.onFailure { _notes.value = "Couldn't delete the list. Check your connection." } }
    }

    // ---- quotes ----
    /** Starts polling (call when the screen is visible); [stop] when it is not. */
    fun start() {
        if (poller?.isActive == true) return
        poller = viewModelScope.launch {
            while (isActive) { refresh(); delay(pollMs) }
        }
    }

    fun stop() { poller?.cancel(); poller = null; liveJob?.cancel(); liveJob = null; liveLast.clear(); _state.update { it.copy(live = false) } }

    /**
     * Live prices (Owner bug 17 Nov): while Home is shown, futures stream from the site's live hub when the server granted
     * current data ([futuresLive]), crypto from the exchange stream. The 25 s poll keeps running for the daily change and
     * the sparkline; a live price always replaces the polled last price.
     */
    fun startLive(feed: LiveFeed, futuresLive: Boolean) {
        liveJob?.cancel()
        liveJob = viewModelScope.launch {
            snapshotIds().collectLatest { ids ->
                coroutineScope {
                    val roots = if (futuresLive) ids.mapNotNull { id -> hubRoot(id)?.let { it to id } }.toMap() else emptyMap()
                    val pairs = ids.mapNotNull { id -> cryptoPair(id)?.let { it to id } }.toMap()
                    if (roots.isNotEmpty()) launch { feed.futures(roots.keys, { r, p -> roots[r]?.let { onLive(it, p) } }, { on -> _state.update { it.copy(live = on) } }) }
                    else _state.update { it.copy(live = false) }
                    if (pairs.isNotEmpty()) launch { feed.crypto(pairs.keys) { pr, p -> pairs[pr]?.let { onLive(it, p) } } }
                }
            }
        }
    }

    private fun snapshotIds() = _state.map { st -> st.rows.map { it.symbol.id }.toSet() }.distinctUntilChanged()

    /** One live price for watchlist id [id]: moves the row's last price (the change % follows from the daily close). */
    fun onLive(id: String, price: Double) {
        liveLast[id] = price
        _state.update { s ->
            s.copy(rows = s.rows.map { r ->
                if (r.symbol.id != id) r else when (val st = r.state) {
                    is RowState.Ready -> if (st.quote.last == price && st.quote.realtime) r else r.copy(state = RowState.Ready(st.quote.copy(last = price, realtime = true)))
                    else -> r
                }
            })
        }
    }

    suspend fun refresh(onlyLoading: Boolean = false) {
        val gate = Semaphore(4)   // at most 4 requests in flight, like the site
        val syms = _state.value.rows.filter { !onlyLoading || it.state == RowState.Loading }.map { it.symbol }
        val jobs = syms.map { sym ->
            viewModelScope.launch {
                val next = try {
                    RowState.Ready(gate.withPermit { repo.quote(sym) }.let { q -> liveLast[sym.id]?.let { q.copy(last = it, realtime = true) } ?: q })
                } catch (e: CancellationException) { throw e } catch (e: Exception) {
                    RowState.Failed(lastGood(sym))
                }
                _state.update { s -> s.copy(rows = s.rows.map { if (it.symbol.id == sym.id) it.copy(state = next) else it }) }
            }
        }
        jobs.forEach { it.join() }
    }

    private fun lastGood(sym: WatchSymbol): Quote? = when (val r = _state.value.rows.firstOrNull { it.symbol.id == sym.id }?.state) {
        is RowState.Ready -> r.quote
        is RowState.Failed -> r.stale
        else -> null
    }

    companion object { const val POLL_MS = 25_000L }
}
