package com.tradezoro.app.ui

import com.tradezoro.app.data.Quote
import com.tradezoro.app.data.QuoteRepository
import com.tradezoro.app.data.Source
import com.tradezoro.app.data.WatchSymbol
import com.tradezoro.app.ui.home.HomeViewModel
import com.tradezoro.app.ui.home.RowState
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.IOException

@OptIn(ExperimentalCoroutinesApi::class)
class HomeViewModelTest {
    private val a = symbolOf("futures:NQ1!")
    private val b = symbolOf("binance:BTCUSDT")

    @Before fun setUp() = Dispatchers.setMain(UnconfinedTestDispatcher())
    @After fun tearDown() = Dispatchers.resetMain()

    private class FakeRepo : QuoteRepository {
        var fail = setOf<String>()
        override suspend fun quote(symbol: WatchSymbol): Quote {
            if (symbol.ticker in fail) throw IOException("down")
            return Quote(100.0, 99.0, listOf(1.0, 2.0), realtime = symbol.source == Source.CRYPTO)
        }
    }

    @Test fun startsLoadingThenReady() = runTest {
        val repo = FakeRepo()
        val vm = HomeViewModel(repo, listOf(a, b))
        assertTrue(vm.state.value.rows.all { it.state is RowState.Loading })
        vm.refresh()
        assertTrue(vm.state.value.rows.all { it.state is RowState.Ready })
        assertTrue("futures are delayed", vm.state.value.anyDelayed)
    }

    @Test fun failureKeepsLastGoodQuote() = runTest {
        val repo = FakeRepo()
        val vm = HomeViewModel(repo, listOf(a, b))
        vm.refresh()
        repo.fail = setOf("NQ")
        vm.refresh()
        val nq = vm.state.value.rows.first { it.symbol == a }.state as RowState.Failed
        assertEquals(100.0, nq.stale!!.last, 0.0)
        assertTrue(vm.state.value.rows.first { it.symbol == b }.state is RowState.Ready)
    }

    @Test fun failureWithNoHistoryHasNoStale() = runTest {
        val repo = FakeRepo().apply { fail = setOf("BTC") }
        val vm = HomeViewModel(repo, listOf(b))
        vm.refresh()
        assertEquals(RowState.Failed(null), vm.state.value.rows[0].state)
        assertFalse(vm.state.value.anyDelayed)
    }
}
