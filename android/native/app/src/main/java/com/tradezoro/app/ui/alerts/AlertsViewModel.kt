package com.tradezoro.app.ui.alerts

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.tradezoro.app.data.AlertsRepository
import com.tradezoro.app.data.AlertsState
import com.tradezoro.app.data.PriceAlert
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

class AlertsViewModel(private val repo: AlertsRepository = AlertsRepository()) : ViewModel() {
    private val uid = MutableStateFlow<String?>(null)

    @OptIn(ExperimentalCoroutinesApi::class)
    val state: StateFlow<AlertsState> = uid.flatMapLatest { repo.alerts(it) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), AlertsState.Loading)

    fun setUser(id: String?) { uid.value = id }

    fun toggle(a: PriceAlert, on: Boolean, onError: (String) -> Unit) = viewModelScope.launch {
        runCatching { repo.setActive(a.id, on) }.onFailure { onError("That alert could not be changed. Try again.") }
    }

    fun delete(a: PriceAlert, onError: (String) -> Unit) = viewModelScope.launch {
        runCatching { repo.delete(a.id) }.onFailure { onError("That alert could not be deleted. Try again.") }
    }

    fun test(onDone: (String) -> Unit) = viewModelScope.launch {
        onDone(runCatching { repo.sendTest() }.fold({ "Test sent. It should arrive in a few seconds." }, { "The test could not be sent. Try again." }))
    }
}
