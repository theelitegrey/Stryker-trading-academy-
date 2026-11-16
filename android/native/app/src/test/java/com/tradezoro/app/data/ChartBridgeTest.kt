package com.tradezoro.app.data

import com.tradezoro.app.ui.chart.ChartViewModel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ChartBridgeTest {
    @Test fun parsesBridgeState() {
        // Shape copied from a real TZB.state() on tradezoro.com/charts (16 Nov).
        val s = parseBridge("""{"t":"state","ready":true,"sym":"binance:BTCUSDT","tf":"5m","last":65397.67,"paper":true,
            "pos":{"side":"buy","qty":0.01,"avg":65397.67},"signedIn":false,"toasts":[{"type":"success","msg":"Paper long 0.01 BTCUSDT filled @ 65,397.67"}],"extra":1}""")!!
        assertTrue(s.ready); assertEquals("binance:BTCUSDT", s.sym); assertEquals(65397.67, s.last!!, 0.0)
        assertEquals(0.01, s.pos!!.qty, 0.0); assertEquals(1, s.toasts.size)
    }

    @Test fun rejectsGarbage() {
        assertNull(parseBridge("not json")); assertNull(parseBridge("""{"t":"other"}""")); assertNull(parseBridge("null"))
        assertNull(parseBridge("""{"t":"state","last":"oops"}"""))
    }

    @Test fun timeframeLabels() {
        assertEquals(Timeframe.M5, Timeframe.fromLabel("5m")); assertEquals(Timeframe.H1, Timeframe.fromLabel("1h"))
        assertEquals(Timeframe.H1, Timeframe.fromLabel("60")); assertEquals(Timeframe.D, Timeframe.fromLabel("1D"))
        assertNull(Timeframe.fromLabel("3m")); assertNull(Timeframe.fromLabel(null))
    }

    @Test fun symbolIds() {
        assertEquals("MNQ1!", chartIdFor(DEFAULT_WATCHLIST[0]))
        assertEquals("binance:BTCUSDT", chartIdFor(DEFAULT_WATCHLIST.last()))
        assertEquals("MNQ", displayTicker("MNQ1!")); assertEquals("BTC", displayTicker("binance:BTCUSDT")); assertEquals("EURUSD", displayTicker("fx:EURUSD"))
        assertTrue(isFuturesId("MNQ1!")); assertTrue(isFuturesId("cme:ES1!")); assertFalse(isFuturesId("binance:BTCUSDT"))
    }

    @Test fun jsStringEscapes() {
        assertEquals("'MNQ1!'", jsString("MNQ1!"))
        assertEquals("'a\\'b\\\\c\\u000a\\u003c/script>'", jsString("a'b\\c\n</script>"))
    }

    @Test fun viewModelFollowsBridge() {
        val vm = ChartViewModel()
        vm.openSymbol("MNQ1!", "MNQ", 0.42)
        vm.onBridge(BridgeState(ready = true, sym = "MNQ1!", tf = "5m", last = 21486.5, paper = false))
        var s = vm.state.value
        assertEquals("MNQ", s.ticker); assertEquals(Timeframe.M5, s.tf); assertEquals(0.42, s.changePct!!, 0.0); assertEquals("1", s.qtyText)
        vm.inc(); vm.inc(); assertEquals("3", vm.state.value.qtyText)
        vm.dec(); vm.dec(); vm.dec(); assertEquals("1", vm.state.value.qtyText)   // never below one step

        // Switching to crypto: change from Home no longer applies, qty resets to the crypto step.
        vm.onBridge(BridgeState(ready = true, sym = "binance:BTCUSDT", tf = "3m", last = 65000.0, paper = true,
            pos = BridgePosition("sell", 0.02, 65010.0), toasts = listOf(BridgeToast("error", "Market closed"))))
        s = vm.state.value
        assertNull(s.changePct); assertNull(s.tf); assertEquals("0.01", s.qtyText); assertTrue(s.paperOn)
        assertEquals("Short 0.02 @ 65,010.00", s.position)
        assertEquals(listOf("Market closed"), vm.messages.value); vm.consumeMessage(); assertTrue(vm.messages.value.isEmpty())
        vm.inc(); assertEquals("0.02", vm.state.value.qtyText)
    }

    @Test fun pendingSymbolClears() {
        val vm = ChartViewModel()
        vm.openSymbol("NQ1!", "NQ", null)
        assertEquals("NQ1!" to "NQ", vm.pendingSymbol.value)
        vm.clearPending(); assertNull(vm.pendingSymbol.value)
    }
}
