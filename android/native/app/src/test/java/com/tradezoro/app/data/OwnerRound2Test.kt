package com.tradezoro.app.data

import com.tradezoro.app.ui.home.HomeViewModel
import com.tradezoro.app.ui.home.RowState
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.withTimeoutOrNull
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Owner feedback round 2 (17 Nov evening):
 *  1 signed agreement -> LIVE (hub socket with the member's token), not signed -> delayed poll only;
 *  3 headers from each symbol's real type;  4 active list shared with the website;  5 the site's search + ids.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class OwnerRound2Test {
    @Before fun setUp() = Dispatchers.setMain(UnconfinedTestDispatcher())
    @After fun tearDown() = Dispatchers.resetMain()

    // ---- 1: live vs delayed ----
    private val signed = DataAccess(signedIn = true, agreement = true, current = true)
    private val unsigned = DataAccess(signedIn = true, agreement = false, current = false)

    @Test fun liveOnlyWhenTheServerGrantsCurrentData() {
        assertTrue(liveWanted(signed))
        assertFalse(liveWanted(unsigned))
        assertFalse("unknown is never live", liveWanted(DataAccess(signedIn = true, agreement = true, current = null)))
        assertFalse(liveWanted(DataAccess(signedIn = false)))
        assertEquals("Live futures data.", homeDataNote(true, signed, streaming = true))
        assertEquals("Current futures data. Connecting to the live stream\u2026", homeDataNote(true, signed, streaming = false))
        assertTrue(homeDataNote(true, unsigned, streaming = false)!!.startsWith("Futures update 10 min after"))
        assertNull(homeDataNote(false, DataAccess(), streaming = false))
    }

    @Test fun hubSymbolsAndFrames() {
        assertEquals("MNQ", hubRoot("futures:MNQ1!"))
        assertNull(hubRoot("binance:BTCUSDT"))
        assertEquals("MNQ" to 27388.5, parseHubFrame("""{"type":"tt","symbol":"MNQ","e":3,"q":10,"t":[[27388.25,1,1,1],[27388.5,2,-1,2]]}"""))
        assertNull(parseHubFrame("""{"event":"hub_attached","tier":"trades"}"""))
        assertNull(parseHubFrame("""{"event":"ping"}"""))
    }

    /** A fake hub: checks the token travels as the tz-auth subprotocol and tsub is sent, then streams one trade. */
    private fun hub(): Pair<MockWebServer, CopyOnWriteArrayList<String>> {
        val got = CopyOnWriteArrayList<String>()
        val srv = MockWebServer()
        srv.enqueue(MockResponse().withWebSocketUpgrade(object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                webSocket.send("""{"event":"hub_attached","tier":"trades"}""")
            }
            override fun onMessage(webSocket: WebSocket, text: String) {
                got.add(text)
                webSocket.send("""{"type":"tt","symbol":"MNQ","e":1,"q":5,"t":[[27401.75,1,1,1]]}""")
            }
        }))
        srv.start()
        return srv to got
    }

    @Test fun signedMemberStreamsLive() = runBlocking {
        val (srv, got) = hub()
        try {
            val feed = LiveFeed(token = { "member-token" }, hubUrl = srv.url("/ts-live").toString().replace("http", "ws"))
            val prices = MutableStateFlow<Pair<String, Double>?>(null)
            var live = false
            val job = async(Dispatchers.IO) { feed.futures(setOf("MNQ"), { s, p -> prices.value = s to p }, { live = it || live }) }
            val p = withTimeout(10_000) { prices.first { it != null } }
            assertEquals("MNQ" to 27401.75, p)
            assertTrue(live)
            val req = srv.takeRequest()
            assertEquals("tz-auth, member-token", req.getHeader("Sec-WebSocket-Protocol"))
            assertTrue(got.any { it.contains("\"op\":\"tsub\"") && it.contains("\"MNQ\"") })
            job.cancelAndJoin()
        } finally { srv.shutdown() }
    }

    @Test fun homeTicksLiveWhenSignedAndStaysPolledWhenNot() = runBlocking {
        val repo = object : QuoteRepository {
            override suspend fun quote(symbol: WatchSymbol) = Quote(27000.0, 26900.0, listOf(1.0), realtime = false)
        }
        // signed: the row's last price follows the hub
        run {
            val (srv, _) = hub()
            try {
                val vm = HomeViewModel(repo, listOf(symbolOf("futures:MNQ1!")), pollMs = 60_000)
                vm.refresh()
                vm.startLive(LiveFeed(token = { "t" }, hubUrl = srv.url("/ts-live").toString().replace("http", "ws")), futuresLive = true)
                val q = withTimeout(10_000) {
                    vm.state.first { ((it.rows[0].state as? RowState.Ready)?.quote?.last) == 27401.75 }
                }.rows[0].state as RowState.Ready
                assertTrue("live price is real-time", q.quote.realtime)
                assertTrue(vm.state.value.live)
                vm.stop()
            } finally { srv.shutdown() }
        }
        // not signed: no socket is opened at all, the polled (delayed) quote stays
        run {
            val srv = MockWebServer(); srv.start()
            try {
                val vm = HomeViewModel(repo, listOf(symbolOf("futures:MNQ1!")), pollMs = 60_000)
                vm.refresh()
                vm.startLive(LiveFeed(token = { "t" }, hubUrl = srv.url("/ts-live").toString().replace("http", "ws")), futuresLive = false)
                delay(500)
                assertEquals(0, srv.requestCount)
                assertFalse(vm.state.value.live)
                assertEquals(27000.0, (vm.state.value.rows[0].state as RowState.Ready).quote.last, 0.0)
                assertTrue(vm.state.value.anyDelayed)
                vm.stop()
            } finally { srv.shutdown() }
        }
        Unit
    }

    // ---- 3: section headers from each symbol's real type ----
    @Test fun headersFollowTheSymbolType() {
        // The Owner's list: futures added under the site's default "###CRYPTO" marker.
        val owner = listOf("###FUTURES", "futures:NQ1!", "###CRYPTO", "futures:MNQ1!", "futures:ES1!", "futures:MES1!", "futures:YM1!", "futures:MYM1!")
        assertEquals(listOf("###FUTURES", "futures:NQ1!", "futures:MNQ1!", "futures:ES1!", "futures:MES1!", "futures:YM1!", "futures:MYM1!"), displayItems(owner))
        // Mixed under one type marker: each symbol gets its own type's header.
        assertEquals(listOf("###FUTURES", "futures:NQ1!", "###CRYPTO", "binance:BTCUSDT", "###FOREX", "fx:EURUSD"),
            displayItems(listOf("###FUTURES", "futures:NQ1!", "binance:BTCUSDT", "fx:EURUSD")))
        // No markers: no headers. Custom names stay as written. Empty sections hide.
        assertEquals(listOf("futures:NQ1!", "binance:BTCUSDT"), displayItems(listOf("futures:NQ1!", "binance:BTCUSDT")))
        assertEquals(listOf("###MY SCALPS", "futures:NQ1!"), displayItems(listOf("###MY SCALPS", "futures:NQ1!", "###FOREX")))
        assertEquals("STOCKS", typeOf("stocks:NASDAQ:AAPL")); assertEquals("CRYPTO", typeOf("okx:XAU-USDT-SWAP")); assertEquals("INDICES", typeOf("idx:SPX"))
    }

    // ---- 4: the active list is the website's watchlistPrefs/active doc ----
    @Test fun activeListFollowsTheOtherDevice() = runBlocking {
        val store = object : WatchStore {
            val l = MutableStateFlow<List<Watchlist>?>(listOf(Watchlist("aaaaaaaaaaaaaaaaaaaa", "Alpha", listOf("futures:NQ1!")), Watchlist("bbbbbbbbbbbbbbbbbbbb", "Beta", listOf("fx:EURUSD"))))
            val a = MutableStateFlow<String?>(null)
            val written = mutableListOf<String>()
            override val lists = l
            override val active = a
            override suspend fun setActive(id: String) { written.add(id) }
            override suspend fun save(l: Watchlist) {}
            override suspend fun remove(l: Watchlist) {}
        }
        val vm = HomeViewModel(object : QuoteRepository { override suspend fun quote(symbol: WatchSymbol) = Quote(1.0, 1.0, emptyList(), true) }, emptyList(), pollMs = 60_000)
        vm.bind(store, signedIn = true, preferred = null) {}
        assertEquals("aaaaaaaaaaaaaaaaaaaa", vm.state.value.activeId)
        store.a.value = "bbbbbbbbbbbbbbbbbbbb"            // opened on the website
        withTimeout(5000) { vm.state.first { it.activeId == "bbbbbbbbbbbbbbbbbbbb" } }
        assertEquals(listOf("fx:EURUSD"), vm.state.value.items)
        assertTrue("a remote switch is not written back", store.written.isEmpty())
        vm.select("aaaaaaaaaaaaaaaaaaaa")                 // opened here -> told to the website
        withTimeoutOrNull(2000) { while (store.written.isEmpty()) delay(20) }
        assertEquals(listOf("aaaaaaaaaaaaaaaaaaaa"), store.written)
        assertEquals("bbbbbbbbbbbbbbbbbbbbb".take(20), activeIdFrom(mapOf("id" to "bbbbbbbbbbbbbbbbbbbb")))
        assertNull(activeIdFrom(mapOf("id" to "")))
        assertNull(activeIdFrom(null))
    }

    // ---- 5: the website's search results (as the chart page returns them) ----
    @Test fun siteSearchResults() {
        // Real answer shape from tradezoro.com/charts (TZB.run 'find', "XAU"), trimmed.
        val v = """[{"id":"bitget:XAUUSDT.P","t":"XAUUSDT.P","n":"XAU / USDT Perpetual","c":"crypto","k":"Crypto","x":"Bitget","tick":0.01},
            {"id":"okx:XAU-USDT-SWAP","t":"XAU-USDT-SWAP","n":"XAU / USDT Perpetual","c":"crypto","k":"Crypto","x":"OKX","tick":0.1},
            {"id":"futures:GC1!","t":"GC1!","n":"Gold futures","c":"futures","k":"Futures","x":"COMEX","tick":0.1},
            {"id":"stocks:NASDAQ:AAPL","t":"NASDAQ:AAPL","n":"Apple Inc.","c":"stocks","k":"Stock","x":"NASDAQ","tick":0.01},
            {"id":"futures:GC1!","t":"GC1!","n":"dupe","c":"futures","k":"Futures","x":"COMEX","tick":0.1}]"""
        val r = parseFind(v)
        assertEquals(listOf("bitget:XAUUSDT.P", "okx:XAU-USDT-SWAP", "futures:GC1!", "stocks:NASDAQ:AAPL"), r.map { it.id })
        assertEquals("Crypto", r[0].kind); assertEquals("Bitget", r[0].exchange)
        assertEquals(v.length > 0, jobValue("""{"ok":true,"v":[]}""") == "[]")
        assertNull(jobValue("""{"ok":false,"e":"chart not ready"}"""))
        // Stocks keep the site's id; the row shows the plain code.
        val aapl = symbolOf("stocks:NASDAQ:AAPL")
        assertEquals("AAPL", aapl.ticker); assertEquals("AAPL", aapl.chartTicker); assertEquals(Source.OTHER, aapl.source)
        assertEquals("okx:XAU-USDT-SWAP", canonicalId("OKX:XAU-USDT-SWAP"))
        // Built-in list (offline, instant) still finds gold by name.
        assertTrue(searchCatalog("GOLD").any { it.id == "futures:GC1!" })
    }

    @Test fun pageQuoteForSymbolsWithoutADirectSource() = runBlocking {
        val q = parsePageQuote("""{"d":[[1794700800000,1,2,0.5,230.0,9],[1794787200000,1,2,0.5,232.3,9]],"i":[[1794870000,1,1,1,232.1,1],[1794870900,1,1,1,232.3,1]]}""")!!
        assertEquals(232.3, q.last, 1e-9); assertEquals(230.0, q.prevClose!!, 1e-9); assertEquals(2, q.spark.size)
        val direct = object : QuoteRepository { override suspend fun quote(symbol: WatchSymbol) = Quote(5.0, 4.0, emptyList(), false) }
        var asked: String? = null
        val repo = PageQuoteRepository(direct) { kind, arg -> asked = "$kind $arg"; """{"d":[[1,1,1,1,9.0,1],[2,1,1,1,10.0,1]],"i":[]}""" }
        assertEquals(5.0, repo.quote(symbolOf("futures:NQ1!")).last, 0.0)
        assertNull(asked)
        assertEquals(10.0, repo.quote(symbolOf("stocks:NASDAQ:AAPL")).last, 0.0)
        assertEquals("quote stocks:NASDAQ:AAPL", asked)
    }
}
