package com.tradezoro.app.data

import com.tradezoro.app.push.CH_ALERTS
import com.tradezoro.app.push.CH_GENERAL
import com.tradezoro.app.push.channelFor
import com.tradezoro.app.push.safeLink
import com.tradezoro.app.ui.trade.TradeViewModel
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PaperTest {
    // Shape of chart-bridge.js TZB.paper() (fields from assets/paper-engine.js summary()/state).
    private val raw = """{"t":"paper","ready":true,"on":true,"signedIn":false,"sym":"MNQ1!","last":21486.5,
        "spec":{"symbol":"futures:MNQ1!","kind":"futures","tick":0.25,"pointValue":2,"minQty":1,"maxQty":500,"decimals":2},
        "acct":{"balance":100000,"equity":100098,"unrealized":98,"realized":0,"dayPnl":0,"start":100000},
        "positions":[{"sym":"futures:MNQ1!","side":"buy","qty":2,"avg":21462,"last":21486.5,"pnl":98,"sl":null,"tp":null}],
        "orders":[{"id":7,"sym":"futures:MNQ1!","side":"buy","type":"limit","qty":1,"price":21400,"sl":21390,"tp":null}],
        "trades":[{"id":5,"sym":"binance:BTCUSDT","side":"sell","qty":0.01,"entry":65000,"exit":64900,"pnl":1,"exitAt":1,"reason":"tp","extra":1}]}"""

    @Test fun parsesSnapshot() {
        val s = parsePaper(raw)!!
        assertTrue(s.ready && s.on)
        assertEquals(0.25, s.spec!!.tick, 0.0)
        assertEquals(98.0, s.positions.single().pnl, 0.0)
        assertNull(s.positions.single().sl)
        assertEquals(7L, s.orders.single().id)
        assertEquals("tp", s.trades.single().reason)
    }

    @Test fun rejectsJunk() {
        assertNull(parsePaper("nope"))
        assertNull(parsePaper("""{"t":"state"}"""))
    }

    @Test fun roundsToTick() {
        assertEquals(21486.5, roundTick(21486.6, 0.25), 1e-9)
        assertEquals(68.42, roundTick(68.4249, 0.01), 1e-9)
    }

    @Test fun bracketsSitOnTheRightSide() {
        // Buy: TP above, SL below. Sell: the other way round (paper-engine _checkBracket rules).
        assertEquals(21526.5, bracketPrice("buy", 21486.5, 160, 0.25, takeProfit = true)!!, 1e-9)
        assertEquals(21476.5, bracketPrice("buy", 21486.5, 40, 0.25, takeProfit = false)!!, 1e-9)
        assertEquals(21446.5, bracketPrice("sell", 21486.5, 160, 0.25, takeProfit = true)!!, 1e-9)
        assertEquals(21496.5, bracketPrice("sell", 21486.5, 40, 0.25, takeProfit = false)!!, 1e-9)
        assertNull(bracketPrice("buy", 21486.5, 0, 0.25, takeProfit = true))
    }

    @Test fun bracketValueUsesPointValue() {
        // 2 MNQ, 10 points at $2/pt = $40; a stop is a loss.
        assertEquals(40.0, bracketValue("buy", 2.0, 100.0, 110.0, 2.0), 0.0)
        assertEquals(-40.0, bracketValue("buy", 2.0, 100.0, 90.0, 2.0), 0.0)
        assertEquals(40.0, bracketValue("sell", 2.0, 100.0, 90.0, 2.0), 0.0)
    }

    @Test fun defaultPricesAreOnTheAcceptedSide() {
        // Buy limit below, buy stop above (placeOrder rejects the others).
        assertTrue(defaultOrderPrice(OrderType.LIMIT, "buy", 100.0, 0.25) < 100.0)
        assertTrue(defaultOrderPrice(OrderType.STOP, "buy", 100.0, 0.25) > 100.0)
        assertTrue(defaultOrderPrice(OrderType.LIMIT, "sell", 100.0, 0.25) > 100.0)
    }

    @Test fun orderJsonIsStrictAndOmitsUnused() {
        val m = Json.parseToJsonElement(orderJson("sell", OrderType.MARKET, 2.0, 99.0, 101.0, null)).jsonObject
        assertEquals("sell", m["side"]!!.jsonPrimitive.content)
        assertEquals("market", m["type"]!!.jsonPrimitive.content)
        assertFalse("market orders carry no price", "price" in m)
        assertFalse("tp" in m)
        assertEquals(101.0, m["sl"]!!.jsonPrimitive.double, 0.0)
        // anything that is not "sell" is a buy (never an injected string)
        assertEquals("buy", Json.parseToJsonElement(orderJson("x');alert(1)//", OrderType.LIMIT, 1.0, 5.0, null, null)).jsonObject["side"]!!.jsonPrimitive.content)
    }

    @Test fun moneyFormat() {
        assertEquals("$100,098.00", money(100098.0))
        assertEquals("+$98.00", money(98.0, sign = true))
        assertEquals("\u2212$12.50", money(-12.5, sign = true))
    }

    @Test fun ticketBuildsOrderCall() {
        val vm = TradeViewModel()
        vm.onSnapshot(parsePaper(raw)!!)
        vm.stepQty(1)                      // 1 -> 2 contracts
        vm.stepBracket(takeProfit = false, dir = 1)   // 4 ticks
        val call = vm.orderCall("buy")!!
        val o = Json.parseToJsonElement(call.removePrefix("TZB.order(").removeSuffix(")")).jsonObject
        assertEquals(2.0, o["qty"]!!.jsonPrimitive.double, 0.0)
        assertEquals(21485.5, o["sl"]!!.jsonPrimitive.double, 1e-9)  // 4 ticks x 0.25 below 21486.5
        vm.stepBracket(takeProfit = false, dir = -1)
        assertFalse("sl" in Json.parseToJsonElement(vm.orderCall("buy")!!.removePrefix("TZB.order(").removeSuffix(")")).jsonObject)
    }

    @Test fun limitTicketPrefillsAndSteps() {
        val vm = TradeViewModel()
        vm.onSnapshot(parsePaper(raw)!!)
        vm.setType(OrderType.LIMIT)
        assertEquals("21484.00", vm.state.value.ticket.priceText)   // 10 ticks below the last
        vm.stepPrice(1)
        assertEquals("21484.25", vm.state.value.ticket.priceText)
        vm.setPriceText("abc")
        assertNull(vm.orderCall("buy"))                               // no price, no order
    }

    @Test fun noOrderWhenPaperOff() {
        val vm = TradeViewModel()
        vm.onSnapshot(parsePaper(raw)!!.copy(on = false))
        assertNull(vm.orderCall("buy"))
    }

    @Test fun qtyNeverBelowOneStep() {
        val vm = TradeViewModel()
        vm.onSnapshot(parsePaper(raw)!!)
        vm.stepQty(-1)
        assertEquals(1.0, vm.state.value.ticket.qty, 0.0)
    }

    @Test fun alertsMapLikeTheSite() {
        val a = alertFrom("a1", mapOf("symbol" to "futures:NQ1!", "cond" to "crossing_up", "price" to 21450L, "freq" to "every", "active" to true))!!
        assertEquals("NQ1!", a.ticker)
        assertEquals("Crossing up", a.condLabel)
        assertEquals("Every time", a.freqLabel)
        assertEquals(21450.0, a.price, 0.0)
        assertEquals("Crossing", alertFrom("a2", mapOf("symbol" to "binance:BTCUSDT", "cond" to "weird", "price" to 1.5))!!.condLabel)
        assertNull(alertFrom("a3", mapOf("symbol" to "", "price" to 1.0)))
        assertNull(alertFrom("a4", mapOf("symbol" to "NQ1!", "price" to "1")))
    }

    @Test fun alertPriceMatchesEngineText() {
        assertEquals("21,450.25", alertPrice(21450.25))
        assertEquals("21,450.00", alertPrice(21450.0))
        assertEquals("0.00012", alertPrice(0.00012))
        assertEquals("1.23456", alertPrice(1.23456))
    }

    @Test fun pushLinksStayOnSite() {
        assertEquals("/charts.html?symbol=NQ1!", safeLink("/charts.html?symbol=NQ1!"))
        assertNull(safeLink("https://evil.example/"))
        assertNull(safeLink("//evil.example/"))
        assertNull(safeLink(null))
        assertEquals(CH_ALERTS, channelFor("chart_alert"))
        assertEquals(CH_ALERTS, channelFor("test"))
        assertEquals(CH_GENERAL, channelFor("like"))
    }
}
